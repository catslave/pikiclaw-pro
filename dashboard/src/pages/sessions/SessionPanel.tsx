import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo, useMemo, type ReactNode } from 'react';
import { useStore } from '../../store';
import { createT } from '../../i18n';
import { api } from '../../api';
import { loadSessionMessages, peekSessionMessages } from '../../session-preload';
import { useDashboardEvent, useDashboardReconnect, type DashboardEvent } from '../../ws';
import { cn, getAgentMeta, shortenModel, sessionDisplayState } from '../../utils';
import { Spinner, Modal, ModalHeader, Button } from '../../components/ui';
import { hasPlan } from '../../components/PlanProgressCard';
import type { AgentCapabilityDescriptor, InteractionSnapshot, MessageBlock, SessionGoalView, SessionInfo, StreamActivityEvents, StreamActivitySummary, StreamPlan, StreamPreviewMeta, StreamSubAgent } from '../../types';
import { TurnView, UserBubble, TurnDivider, type SelectionActionRequest, type SelectionSideChatRequest } from './TurnView';
import { LivePreview, ThinkingDots, liveStreamShouldRender } from './LivePreview';
import { hasRenderableAssistant, insertComposerCommand, messageHasProposedPlan, textHasProposedPlan } from './AssistantContent';
import { buildReferenceContextEnvelope, InputComposer, type PendingReviewComment } from './InputComposer';
import { InteractionPromptModal } from './InteractionPromptModal';
import type { OpenFileLinkHandler } from './markdown';
import {
  normalizeTurnHistory,
  mergeOlderHistory,
  mergeLatestHistory,
  type Turn,
  type TurnHistoryWindow,
} from './utils';
import {
  assistantHasFinalOutput,
  assistantHasProcessOnlyOutput,
  isLiveStreamActive,
  isStaleStreamingSnapshotAfterDone,
  liveStreamAlreadyInHistory as computeLiveStreamAlreadyInHistory,
  isStaleDoneSnapshotForPending,
  resolveEffectiveLiveStream,
  shouldSkipEmptyStreamingHandoff,
  willQueueSendOnStart,
} from './stream-ui';

export type SessionPanelChange = { agent: string; sessionId: string; workdir: string; openInNewSlot?: boolean };
export type SessionPanelScrollRequest = { turnIndex: number; totalTurns?: number; nonce: number };

const SESSION_PAGE_TURNS = 12;
const TOP_LOAD_THRESHOLD_PX = 160;
const BOTTOM_STICK_THRESHOLD_PX = 96;
const STREAM_FOLLOW_THRESHOLD_PX = 24;
const LOCAL_SEND_TASK_ASSIGNMENT_GRACE_MS = 30_000;
const USER_SCROLL_AUTOSTICK_PAUSE_MS = 60 * 60 * 1000;
const PROGRAMMATIC_SCROLL_IGNORE_MS = 160;
const USER_SCROLL_UP_THRESHOLD_PX = 4;
const STREAM_BOTTOM_SCROLL_THROTTLE_MS = 220;

function scrollToMessageBottom(el: HTMLDivElement) {
  const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  if (Math.abs(el.scrollTop - maxScrollTop) > 1) {
    el.scrollTop = maxScrollTop;
  }
}

function remainingToMessageBottom(el: HTMLDivElement) {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/* ── Stale-while-revalidate: persist last-known history across mount/unmount ── */
const MAX_HISTORY_SNAPSHOTS = 20;
const historySnapshots = new Map<string, TurnHistoryWindow>();
function snapshotKey(agent: string, sessionId: string) { return `${agent}:${sessionId}`; }
function saveHistorySnapshot(key: string, h: TurnHistoryWindow) {
  historySnapshots.delete(key); // refresh LRU position
  historySnapshots.set(key, h);
  while (historySnapshots.size > MAX_HISTORY_SNAPSHOTS) {
    historySnapshots.delete(historySnapshots.keys().next().value!);
  }
}

type EditReplacement = { fromTurn: number; prompt: string };
const EDIT_REPLACEMENTS_STORAGE_KEY = 'pikiclaw-session-edit-replacements';

function readEditReplacements(): Record<string, EditReplacement> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(EDIT_REPLACEMENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readEditReplacement(agent: string | null | undefined, sessionId: string | null | undefined): EditReplacement | null {
  if (!agent || !sessionId) return null;
  const value = readEditReplacements()[snapshotKey(agent, sessionId)];
  return typeof value?.fromTurn === 'number' && typeof value.prompt === 'string' ? value : null;
}

function writeEditReplacement(agent: string | null | undefined, sessionId: string | null | undefined, replacement: EditReplacement) {
  if (typeof window === 'undefined' || !agent || !sessionId) return;
  const key = snapshotKey(agent, sessionId);
  const all = readEditReplacements();
  all[key] = replacement;
  try { window.localStorage.setItem(EDIT_REPLACEMENTS_STORAGE_KEY, JSON.stringify(all)); } catch {}
}

function bridgePendingImagesIntoHistory(history: TurnHistoryWindow, pendingPrompt: string | null, imageUrls: string[]): { history: TurnHistoryWindow; transferred: boolean } {
  if (!imageUrls.length || !history.turns.length) return { history, transferred: false };
  let turnIndex = -1;
  for (let i = history.turns.length - 1; i >= 0; i--) {
    if (history.turns[i].user) {
      turnIndex = i;
      break;
    }
  }
  if (turnIndex < 0) return { history, transferred: false };
  const turn = history.turns[turnIndex];
  if (!turn.user) return { history, transferred: false };

  const prompt = (pendingPrompt || '').trim();
  const userText = (turn.user.text || '').trim();
  if (prompt ? userText !== prompt : !!userText) return { history, transferred: false };

  const serverImageCount = turn.user.blocks.filter(block => block.type === 'image').length;
  if (serverImageCount >= imageUrls.length) return { history, transferred: false };

  const bridgedImages: MessageBlock[] = imageUrls.slice(serverImageCount).map(url => ({ type: 'image', content: url }));
  const nextTurns = [...history.turns];
  nextTurns[turnIndex] = {
    ...turn,
    user: {
      ...turn.user,
      blocks: [...turn.user.blocks, ...bridgedImages],
    },
  };
  return { history: { ...history, turns: nextTurns }, transferred: true };
}

function GoalStatusBar({
  goal,
  capability,
  busy,
  compact,
  onPause,
  onResume,
  onClear,
}: {
  goal: SessionGoalView | null;
  capability?: AgentCapabilityDescriptor | null;
  busy: boolean;
  compact: boolean;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  if (!goal) return null;
  const active = goal.status === 'active';
  const paused = goal.status === 'paused';
  const actions = new Set(capability?.actions || []);
  const canPause = actions.has('pause');
  const canResume = actions.has('resume');
  const canClear = actions.has('clear');
  return (
    <div className={cn('mx-auto flex items-center gap-2 px-3 py-1.5', compact ? 'w-[calc(100%_-_32px)] max-w-[640px]' : 'max-w-[860px]')}>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-edge/45 bg-panel-alt/70 px-2.5 py-1.5 text-[11px] text-fg-4">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-emerald-400/80' : 'bg-fg-5/50')} />
        <span className="shrink-0 font-semibold uppercase tracking-wider text-fg-5">Goal</span>
        <span className="min-w-0 truncate text-fg-2">{goal.objective}</span>
        <span className="shrink-0 rounded border border-edge/35 bg-control px-1.5 py-[1px] font-mono text-[10px] text-fg-5">
          {goal.source}:{goal.status}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {active && canPause && <Button variant="ghost" size="sm" disabled={busy} onClick={onPause}>Pause</Button>}
        {paused && canResume && <Button variant="ghost" size="sm" disabled={busy} onClick={onResume}>Resume</Button>}
        {canClear && <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>Clear</Button>}
      </div>
    </div>
  );
}

function PlanDecisionBar({ compact }: { compact: boolean }) {
  return (
    <div className={cn('mx-auto', compact ? 'w-[calc(100%_-_32px)] max-w-[640px] px-2.5 pt-1.5' : 'w-full max-w-[860px] px-4 pt-2 sm:px-3')}>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.07] px-3 py-2 shadow-[0_8px_22px_rgba(15,23,42,0.08)] backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-sky-300">Proposed plan</span>
          <span className="min-w-0 truncate text-[11px] text-fg-5">Choose the next step when you are ready.</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertComposerCommand('/plan implement')}
            className="rounded-md border border-sky-400/30 bg-sky-400/[0.14] px-2.5 py-1 text-[11px] font-semibold text-sky-200 transition hover:bg-sky-400/[0.2]"
          >
            Implement
          </button>
          <button
            type="button"
            onClick={() => insertComposerCommand('/plan clarify ')}
            className="rounded-md border border-edge/50 bg-control px-2.5 py-1 text-[11px] font-semibold text-fg-3 transition hover:border-edge-h hover:bg-panel-h"
          >
            Continue Clarifying
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SessionPanel
   ═══════════════════════════════════════════════════════════════ */
export const SessionPanel = memo(function SessionPanel({
  session, workdir, active = true, readOnly = false, compact = false, transcriptHeader, transcriptFooter, referenceContextPrompt = null, referenceContextLabel = null, initialRuntimeSelection = null, onReferenceContextClear, onSessionChange, onMultiSessionChange, onRuntimeSelectionChange, onOpenFileLink, onCreateSideChatFromSelection, onCreateTodoFromSelection, onCreateReviewCommentFromSelection, onTranscriptScroll, scrollToTurnRequest = null, initialDraftPrompt = null, suppressLiveStreamState = false, initialPendingPrompt, initialPendingImageUrls, initialPendingCreatedAt, onPendingPromptConsumed,
}: {
  session: SessionInfo;
  workdir: string;
  active?: boolean;
  readOnly?: boolean;
  compact?: boolean;
  transcriptHeader?: ReactNode;
  transcriptFooter?: ReactNode;
  referenceContextPrompt?: string | null;
  referenceContextLabel?: string | null;
  initialRuntimeSelection?: { agent?: string | null; model?: string | null; effort?: string | null } | null;
  onReferenceContextClear?: () => void;
  onSessionChange?: (next: SessionPanelChange) => void;
  onMultiSessionChange?: (next: SessionPanelChange[], prompt: string) => void;
  onRuntimeSelectionChange?: (next: { agent: string; model: string | null; effort: string | null }) => void;
  onOpenFileLink?: OpenFileLinkHandler;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  onCreateTodoFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onCreateReviewCommentFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onTranscriptScroll?: (state: { scrollTop: number }) => void;
  scrollToTurnRequest?: SessionPanelScrollRequest | null;
  initialDraftPrompt?: string | null;
  suppressLiveStreamState?: boolean;
  initialPendingPrompt?: string | null;
  /** Blob-URL previews for images attached to the first message of a new session.
   *  Ownership transfers to this panel: we revoke them once the turn completes. */
  initialPendingImageUrls?: string[];
  initialPendingCreatedAt?: string | null;
  onPendingPromptConsumed?: () => void;
}) {
  const locale = useStore(s => s.locale);
  const agentRuntime = useStore(s => s.agentStatus?.agents?.find(a => a.agent === session.agent) ?? null);
  const globalEffort = agentRuntime?.selectedEffort ?? null;
  const globalModel = agentRuntime?.selectedModel ?? null;
  // BYOK attribution surfaces on every turn so the user knows the agent is
  // routing through a third-party provider. `agentRuntime.byokProviderName`
  // is null when no Profile is bound (native auth) — falsy values hide the
  // tag, so we don't need to gate display further.
  const byokProviderName = agentRuntime?.byokProviderName ?? null;
  const t = useMemo(() => createT(locale), [locale]);
  const meta = getAgentMeta(session.agent || '');
  const displayState = sessionDisplayState(session);

  const hasInitialPending = !!initialPendingPrompt || !!(initialPendingImageUrls && initialPendingImageUrls.length);
  const [history, setHistory] = useState<TurnHistoryWindow | null>(null);
  const [loading, setLoading] = useState(!hasInitialPending);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingReviewComments, setPendingReviewComments] = useState<PendingReviewComment[]>([]);
  const [liveStream, setLiveStream] = useState<{
    taskId: string | null;
    prompt?: string | null;
    phase: 'streaming' | 'done';
    text: string;
    thinking: string;
    activity?: string;
    activitySummary?: StreamActivitySummary | null;
    activityEvents?: StreamActivityEvents | null;
    plan?: StreamPlan | null;
    startedAt?: number | null;
    completedAt?: number | null;
    updatedAt?: number | null;
    model?: string | null;
    effort?: string | null;
    previewMeta?: StreamPreviewMeta | null;
    subAgents?: StreamSubAgent[] | null;
    generatingImages?: number;
    error?: string | null;
  } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string | null>(null);
  const [streamStateChecked, setStreamStateChecked] = useState(false);
  const [streamPollNonce, setStreamPollNonce] = useState(0);
  const [streamTaskId, setStreamTaskId] = useState<string | null>(null);
  const [lastContextMeta, setLastContextMeta] = useState<StreamPreviewMeta | null>(null);
  const [queuedTaskIds, setQueuedTaskIds] = useState<string[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Array<{ taskId: string; prompt: string }>>([]);
  // Active human-in-the-loop prompts attached to this session — driven by the
  // `interactions` field of the stream snapshot. The latest entry is rendered
  // as a modal popup; the server clears entries as users answer them.
  const [interactions, setInteractions] = useState<InteractionSnapshot[]>([]);
  const [goalView, setGoalView] = useState<SessionGoalView | null>(null);
  const [goalBusy, setGoalBusy] = useState(false);
  // Optimistic state for the RUNNING task only — the user message bubble that
  // backs the in-flight turn until rawTurns picks it up. Earlier this slot
  // doubled as the optimistic source for queued sends, which meant sending a
  // new follow-up while a task was still streaming would overwrite the
  // running task's bubble. Queued sends now live in `pendingQueuedSends`.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(initialPendingPrompt || null);
  const [pendingCreatedAt, setPendingCreatedAt] = useState<string | null>(hasInitialPending ? (initialPendingCreatedAt || new Date().toISOString()) : null);
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>(initialPendingImageUrls || []);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingStopped, setPendingStopped] = useState(false);
  const pendingPromptRef = useRef<string | null>(null);
  pendingPromptRef.current = pendingPrompt;
  const pendingTaskIdRef = useRef<string | null>(null);
  pendingTaskIdRef.current = pendingTaskId;
  const pendingCreatedAtRef = useRef<string | null>(null);
  pendingCreatedAtRef.current = pendingCreatedAt;
  const pendingStoppedRef = useRef(false);
  pendingStoppedRef.current = pendingStopped;
  // Optimistic state for queued sends — one entry per send made while another
  // task was already streaming. Each entry carries an opaque localId so we can
  // match the API-assigned taskId back to the right entry even if responses
  // arrive out of order. InputComposer reads this array to fill its queued-row
  // prompts before the server snapshot's `queuedTasks` catches up.
  type PendingQueuedSend = { localId: string; taskId: string | null; prompt: string; imageUrls: string[]; createdAt: string };
  const [pendingQueuedSends, setPendingQueuedSends] = useState<PendingQueuedSend[]>([]);
  const pendingQueuedSendsRef = useRef<PendingQueuedSend[]>([]);
  pendingQueuedSendsRef.current = pendingQueuedSends;
  // Routes the next onSendTaskAssigned callback. Set in handleSendStart based
  // on whether the send went to the queue or kicked off a new running turn.
  // Sends are sequential (InputComposer guards with `sending`), so a single
  // ref is sufficient.
  const lastSendQueuedLocalIdRef = useRef<string | null>(null);
  const [editRequest, setEditRequest] = useState<{ atTurn: number | null; text: string; draftPending: boolean } | null>(null);
  const [editReplacement, setEditReplacement] = useState<EditReplacement | null>(() => readEditReplacement(session.agent, session.sessionId));
  const [forkRequest, setForkRequest] = useState<{ atTurn: number } | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');
  const [forkSubmitting, setForkSubmitting] = useState(false);
  const canFork = !!session.agent && !!session.sessionId;
  const submitForkRef = useRef<(() => Promise<void>) | null>(null);
  const pendingImageUrlsRef = useRef<string[]>(initialPendingImageUrls || []);
  const liveStreamRef = useRef(liveStream);
  const streamingRef = useRef(streaming);
  const streamPhaseRef = useRef(streamPhase);
  const streamTaskIdRef = useRef(streamTaskId);
  const queuedTaskIdsRef = useRef(queuedTaskIds);
  liveStreamRef.current = liveStream;
  streamingRef.current = streaming;
  streamPhaseRef.current = streamPhase;
  streamTaskIdRef.current = streamTaskId;
  queuedTaskIdsRef.current = queuedTaskIds;
  const scrollRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const pendingRecallScrollTurnRef = useRef<number | null>(null);
  const lastRecallScrollNonceRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const scrollToBottomRef = useRef(false);
  const forceScrollToBottomRef = useRef(false);
  const bottomScrollFrameRef = useRef<number | null>(null);
  const bottomScrollForceRef = useRef(false);
  const bottomScrollTimerRef = useRef<number | null>(null);
  const lastBottomScrollAtRef = useRef(0);
  const autoStickPausedUntilRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const lastStreamAutoScrollRef = useRef<{ taskId: string | null; textLength: number } | null>(null);
  // Re-entrancy guard for loadLatestTurns. Scoped to a specific session id so a
  // fetch for sessionA can't block a fetch for sessionB — important during the
  // pending→native promotion of a brand-new session: the in-flight `pending_xxx`
  // fetch (which the server answers with "Session file not found") would
  // otherwise lock out the subsequent native-UUID fetch via a boolean guard,
  // and the panel ends up never seeing the lifted image block from history.
  // `null` = idle.
  const loadingLatestRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const localStreamPendingRef = useRef(hasInitialPending);
  const clearPendingOnLoadRef = useRef<{ taskId: string | null; pendingCreatedAt: string | null } | true | false>(false);
  // When a task ends, we wait for loadLatestTurns to commit its final text to
  // history before clearing liveStream. We remember which task triggered the
  // clear so that if a new task has already started streaming into liveStream
  // by the time history arrives, we don't accidentally wipe the new task's
  // preview. `true` = no specific task (used for non-handoff shutdown paths).
  const clearLiveStreamOnLoadRef = useRef<{ taskId: string | null } | true | false>(false);
  // The backend keeps a completed stream snapshot around briefly so reconnects
  // can recover the terminal state. Treat each done task as a one-shot handoff:
  // once we've kicked off the history refresh for it, repeated done snapshots
  // must not resurrect the live Working card over the persisted "Worked for"
  // history row.
  const doneHandoffTaskIdRef = useRef<string | null>(null);
  const initialPendingConsumedRef = useRef(false);
  const promotingRef = useRef(false);

  const canAutoStickToBottom = useCallback(() => {
    if (!stickToBottomRef.current || Date.now() < autoStickPausedUntilRef.current) return false;
    const el = scrollRef.current;
    if (!el) return true;
    if (remainingToMessageBottom(el) > BOTTOM_STICK_THRESHOLD_PX) {
      stickToBottomRef.current = false;
      scrollToBottomRef.current = false;
      return false;
    }
    return true;
  }, []);

  const canFollowStreamToBottom = useCallback(() => {
    if (!stickToBottomRef.current || Date.now() < autoStickPausedUntilRef.current) return false;
    const el = scrollRef.current;
    if (!el) return true;
    if (remainingToMessageBottom(el) > STREAM_FOLLOW_THRESHOLD_PX) {
      stickToBottomRef.current = false;
      scrollToBottomRef.current = false;
      return false;
    }
    return true;
  }, []);

  const canApplyRequestedBottomScroll = useCallback(() => (
    stickToBottomRef.current && Date.now() >= autoStickPausedUntilRef.current
  ), []);

  const runBottomScroll = useCallback((force: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!force && !canApplyRequestedBottomScroll()) return;
    autoStickPausedUntilRef.current = 0;
    stickToBottomRef.current = true;
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    scrollToMessageBottom(el);
    lastBottomScrollAtRef.current = Date.now();
    lastScrollTopRef.current = el.scrollTop;
  }, [canApplyRequestedBottomScroll]);

  const scheduleBottomScroll = useCallback((force: boolean) => {
    bottomScrollForceRef.current = bottomScrollForceRef.current || force;
    if (bottomScrollFrameRef.current != null) {
      cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
    const requestFrame = () => {
      if (bottomScrollFrameRef.current != null) {
        cancelAnimationFrame(bottomScrollFrameRef.current);
        bottomScrollFrameRef.current = null;
      }
      bottomScrollFrameRef.current = requestAnimationFrame(() => {
        const shouldForce = bottomScrollForceRef.current;
        bottomScrollForceRef.current = false;
        bottomScrollFrameRef.current = null;
        runBottomScroll(shouldForce);
      });
    };
    if (force) {
      if (bottomScrollTimerRef.current != null) {
        window.clearTimeout(bottomScrollTimerRef.current);
        bottomScrollTimerRef.current = null;
      }
      requestFrame();
      return;
    }
    const elapsed = Date.now() - lastBottomScrollAtRef.current;
    if (elapsed >= STREAM_BOTTOM_SCROLL_THROTTLE_MS) {
      requestFrame();
      return;
    }
    if (bottomScrollTimerRef.current != null) return;
    bottomScrollTimerRef.current = window.setTimeout(() => {
      bottomScrollTimerRef.current = null;
      requestFrame();
    }, STREAM_BOTTOM_SCROLL_THROTTLE_MS - elapsed);
  }, [runBottomScroll]);

  useEffect(() => () => {
    if (bottomScrollTimerRef.current != null) {
      window.clearTimeout(bottomScrollTimerRef.current);
      bottomScrollTimerRef.current = null;
    }
    if (bottomScrollFrameRef.current != null) {
      cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
    bottomScrollForceRef.current = false;
  }, []);

  // Consume initialPendingPrompt/initialPendingImageUrls from new-session flow.
  // State (pendingPrompt, pendingImageUrls, loading, localStreamPendingRef) is already initialized
  // from the props so the very first render shows the user message — no spinner flash.
  // This effect only triggers the remaining side effects (polling + parent notify).
  useEffect(() => {
    if (initialPendingConsumedRef.current || !hasInitialPending) return;
    initialPendingConsumedRef.current = true;
    setStreamPollNonce(n => n + 1);
    onPendingPromptConsumed?.();
  }, [hasInitialPending, onPendingPromptConsumed]);

  useEffect(() => {
    setEditRequest(null);
    setEditReplacement(readEditReplacement(session.agent, session.sessionId));
  }, [session.agent, session.sessionId]);

  const clearPending = useCallback((opts: { revokeImages?: boolean } = {}) => {
    const revokeImages = opts.revokeImages !== false;
    setPendingPrompt(null);
    setPendingCreatedAt(null);
    setPendingImageUrls(prev => {
      if (revokeImages) for (const u of prev) URL.revokeObjectURL(u);
      return [];
    });
    pendingImageUrlsRef.current = [];
    setPendingTaskId(null);
    setPendingStopped(false);
  }, []);

  const clearPendingQueuedSends = useCallback(() => {
    setPendingQueuedSends(prev => {
      if (!prev.length) return prev;
      for (const s of prev) for (const url of s.imageUrls) URL.revokeObjectURL(url);
      return [];
    });
    lastSendQueuedLocalIdRef.current = null;
  }, []);

  const handleSendStart = useCallback((prompt: string, imageUrls?: string[]) => {
    const willBeQueued = willQueueSendOnStart({
      streaming: streamingRef.current,
      streamPhase: streamPhaseRef.current as 'queued' | 'streaming' | 'done' | null,
      pendingPrompt: pendingPromptRef.current,
      pendingTaskId: pendingTaskIdRef.current,
      queuedTaskCount: queuedTaskIdsRef.current.length,
    });
    const urls = imageUrls || [];
    const createdAt = new Date().toISOString();
    if (willBeQueued) {
      // Don't disturb the running task's optimistic bubble — append to the
      // queued-sends list so the InputComposer queue row gets its prompt and
      // the conversation history keeps showing the in-flight running turn.
      const localId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      lastSendQueuedLocalIdRef.current = localId;
      setPendingQueuedSends(prev => [...prev, { localId, taskId: null, prompt: prompt || '', imageUrls: urls, createdAt }]);
      return;
    }
    // No active stream — this send is the (about-to-be) running task. Replace
    // the running pending slot wholesale and revoke any stale image URLs.
    autoStickPausedUntilRef.current = 0;
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    scrollToBottomRef.current = true;
    for (const u of pendingImageUrlsRef.current) URL.revokeObjectURL(u);
    lastSendQueuedLocalIdRef.current = null;
    localStreamPendingRef.current = true;
    setLiveStream(null);
    doneHandoffTaskIdRef.current = null;
    clearLiveStreamOnLoadRef.current = false;
    clearPendingOnLoadRef.current = false;
    setPendingPrompt(prompt || null);
    setPendingCreatedAt(createdAt);
    setPendingImageUrls(urls);
    pendingImageUrlsRef.current = urls;
    setPendingTaskId(null);
    setPendingStopped(false);
  }, []);

  const handleAppendReviewCommentFromSelection = useCallback(async (request: SelectionActionRequest) => {
    if (!request.quote.trim() || !request.note.trim()) return;
    setPendingReviewComments(prev => [
      ...prev,
      {
        id: `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        quote: request.quote,
        note: request.note,
        turnIndex: request.turnIndex,
      },
    ]);
  }, []);

  const handleSendTaskAssigned = useCallback((taskId: string) => {
    const queuedLocalId = lastSendQueuedLocalIdRef.current;
    if (queuedLocalId) {
      lastSendQueuedLocalIdRef.current = null;
      setPendingQueuedSends(prev => {
        const idx = prev.findIndex(s => s.localId === queuedLocalId);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], taskId };
        return next;
      });
      return;
    }
    setPendingTaskId(taskId);
  }, []);

  const handleSendFailed = useCallback(() => {
    localStreamPendingRef.current = false;
    const queuedLocalId = lastSendQueuedLocalIdRef.current;
    if (queuedLocalId) {
      lastSendQueuedLocalIdRef.current = null;
      setPendingQueuedSends(prev => {
        let changed = false;
        const next: PendingQueuedSend[] = [];
        for (const send of prev) {
          if (send.localId === queuedLocalId) {
            for (const url of send.imageUrls) URL.revokeObjectURL(url);
            changed = true;
          } else {
            next.push(send);
          }
        }
        return changed ? next : prev;
      });
      return;
    }
    clearPending();
  }, [clearPending]);

  const submitFork = useCallback(async () => {
    if (!forkRequest) return;
    const trimmed = forkPrompt.trim();
    if (!trimmed) return;
    setForkSubmitting(true);
    try {
      const res = await api.forkSession(
        workdir,
        session.agent || '',
        session.sessionId,
        forkRequest.atTurn,
        trimmed,
        {},
      );
      if (!res.ok || !res.sessionKey) {
        // Bubble the error inline by leaving the modal open; consumer can retry.
        setForkSubmitting(false);
        return;
      }
      const [agent, sessionId] = res.sessionKey.split(':');
      setForkRequest(null);
      setForkPrompt('');
      // Hand off to the parent so the new child session opens in its own panel.
      onSessionChange?.({ agent, sessionId, workdir, openInNewSlot: true });
    } finally {
      setForkSubmitting(false);
    }
  }, [forkRequest, forkPrompt, workdir, session.agent, session.sessionId, onSessionChange]);
  submitForkRef.current = submitFork;

  const fetchTurnWindow = useCallback(async (
    query: { turnOffset?: number; turnLimit?: number; lastNTurns?: number },
    opts: { force?: boolean } = {},
  ) => {
    try {
      const res = await loadSessionMessages({
        workdir,
        agent: session.agent || '',
        sessionId: session.sessionId,
        rich: true,
        turnOffset: query.turnOffset,
        turnLimit: query.turnLimit,
        lastNTurns: query.lastNTurns,
      }, { force: opts.force });
      if (!res.ok) return null;
      return normalizeTurnHistory(res);
    } catch {
      return null;
    }
  }, [workdir, session.agent, session.sessionId]);

  const loadLatestTurns = useCallback(async ({ keepOlder, force = false, scrollToBottom = false }: { keepOlder: boolean; force?: boolean; scrollToBottom?: boolean }) => {
    const callSessionId = session.sessionId;
    // Per-session re-entrancy guard. A fetch already in flight for *this* session
    // is dropped (genuine duplicate); a fetch for a *different* session never
    // blocks — pending→native promotion needs the new fetch to fire even while
    // the in-flight `pending_xxx` fetch (server replies "Session file not
    // found") is still resolving.
    if (loadingLatestRef.current === callSessionId) return false;
    loadingLatestRef.current = callSessionId;
    try {
      const fetched = await fetchTurnWindow({ turnOffset: 0, turnLimit: SESSION_PAGE_TURNS }, { force });
      if (!fetched) return false;
      const { history: next, transferred: transferredPendingImages } = bridgePendingImagesIntoHistory(
        fetched,
        pendingPromptRef.current,
        pendingImageUrlsRef.current,
      );
      // Drop stale results: if the panel's session id has rotated since this
      // call started (e.g. promotion happened while we were awaiting), the
      // response belongs to the old session and must not clobber the new
      // session's history — which has already (or will shortly) be fetched
      // separately. Without this guard, an empty/partial old result could
      // overwrite a freshly loaded native-UUID history.
      if (session.sessionId !== callSessionId) return false;
      // Set scroll flag right before setHistory so React batches both into
      // the same render and the layoutEffect sees the flag when turns update.
      if (scrollToBottom) scrollToBottomRef.current = true;
      setHistory(current => {
        if (!current || !keepOlder) return next;
        const hasPendingLocalTurn = !!(pendingPrompt || pendingImageUrlsRef.current.length || localStreamPendingRef.current);
        if (hasPendingLocalTurn && current.turns.length > 0) {
          const staleOrShrunkWindow = next.totalTurns < current.totalTurns
            || (next.endTurn <= current.endTurn && next.turns.length < current.turns.length);
          if (staleOrShrunkWindow) return current;
        }
        return mergeLatestHistory(current, next);
      });
      // Clear pending + liveStream in the same synchronous block as setHistory so
      // React batches all updates into a single render (avoids flash/scroll jump)
      if (clearPendingOnLoadRef.current) {
        const pendingClear = clearPendingOnLoadRef.current;
        clearPendingOnLoadRef.current = false;
        const scopedTaskId = pendingClear !== true ? pendingClear.taskId : null;
        const scopedPendingCreatedAt = pendingClear !== true ? pendingClear.pendingCreatedAt : null;
        const ownsPending = pendingClear === true
          || (!!scopedTaskId && pendingTaskIdRef.current === scopedTaskId)
          || (!!scopedPendingCreatedAt && pendingCreatedAtRef.current === scopedPendingCreatedAt);
        if (ownsPending) clearPending({ revokeImages: !transferredPendingImages });
      }
      if (clearLiveStreamOnLoadRef.current) {
        const pending = clearLiveStreamOnLoadRef.current;
        clearLiveStreamOnLoadRef.current = false;
        // If the pending clear was scoped to a specific (finished) task, only
        // drop liveStream when it still belongs to that task. A new task that
        // started streaming during the fetch has already replaced liveStream,
        // and its content must be preserved.
        const scopedTaskId = pending !== true ? pending.taskId : null;
        const owned = !!liveStreamRef.current
          && (pending === true || liveStreamRef.current.taskId === scopedTaskId);
        if (owned) setLiveStream(null);
      }
      return true;
    } finally {
      // Only release the guard if we still own it for this session; a
      // concurrent fetch for a different session may have replaced it already.
      if (loadingLatestRef.current === callSessionId) {
        loadingLatestRef.current = null;
      }
    }
  }, [fetchTurnWindow, clearPending, session.sessionId]);

  const loadOlderTurns = useCallback(async () => {
    if (!history?.hasOlder || loadingOlderRef.current) return;
    const el = scrollRef.current;
    if (el) prependAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const next = await fetchTurnWindow({
        turnOffset: Math.max(0, history.totalTurns - history.startTurn),
        turnLimit: SESSION_PAGE_TURNS,
      });
      if (next) setHistory(current => current ? mergeOlderHistory(current, next) : next);
      else prependAnchorRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [fetchTurnWindow, history]);

  const prevPhaseRef = useRef<'queued' | 'streaming' | 'done' | null>(null);

  /** Apply a stream snapshot to local state — called from both WS push and poll fallback.
   *  All open panels receive full updates regardless of active state. */
  const applyStreamSnapshot = useCallback((state: any | null) => {
    setStreamStateChecked(true);
    // Detect session promotion: backend promoted pending_XXX → native ID.
    // Update sessionKeyRef immediately so subsequent WS events match the new key,
    // then notify parent — but do NOT return: the snapshot carries live stream data
    // that must be applied to avoid swallowing content during promotion.
    if (state?.sessionId && state.sessionId !== session.sessionId) {
      promotingRef.current = true;
      sessionKeyRef.current = `${session.agent}:${state.sessionId}`;
      onSessionChange?.({ agent: session.agent || '', sessionId: state.sessionId, workdir });
    }
    if (!state) {
      const prev = prevPhaseRef.current;
      setStreaming(false);
      if (prev === 'streaming') {
        // Delay liveStream clearing — same pattern as the 'done' handler
        clearPendingOnLoadRef.current = {
          taskId: liveStreamRef.current?.taskId ?? null,
          pendingCreatedAt: pendingCreatedAtRef.current,
        };
        clearLiveStreamOnLoadRef.current = true;
        void loadLatestTurns({ keepOlder: true, force: true, scrollToBottom: stickToBottomRef.current });
      } else {
        setLiveStream(null);
      }
      if (prev === 'done') {
        if (!pendingStoppedRef.current) clearPending();
        clearPendingQueuedSends();
      } else if (prev === null && localStreamPendingRef.current) {
        // Do NOT clear pending here — for slow uploads (e.g. images via FormData),
        // the poll may return null before the stream actually starts. The pending
        // bubble should stay visible until the stream begins or the safety cleanup
        // effect fires (displayState !== 'running' && !streaming && !liveStream).
        void loadLatestTurns({ keepOlder: true, force: true });
      }
      localStreamPendingRef.current = false;
      setStreamTaskId(null);
      setStreamPhase(null);
      setQueuedTaskIds([]);
      setQueuedTasks([]);
      setInteractions([]);
      lastStreamAutoScrollRef.current = null;
      prevPhaseRef.current = null;
      return;
    }
    const queuePosition = typeof state.queuePosition === 'number' ? state.queuePosition : 0;
    const queuedBehind = Array.isArray(state.queuedTaskIds) ? state.queuedTaskIds : [];
    const visibleQueuedTaskIds = state.phase === 'queued' && state.taskId && queuePosition > 0
      ? [state.taskId, ...queuedBehind.filter((id: string) => id !== state.taskId)]
      : queuedBehind;
    const visibleQueuedTasks = (() => {
      const tasks = Array.isArray(state.queuedTasks) ? state.queuedTasks : [];
      if (state.phase !== 'queued' || !state.taskId || queuePosition <= 0) return tasks;
      if (tasks.some((task: { taskId?: string }) => task.taskId === state.taskId)) return tasks;
      return [{ taskId: state.taskId, prompt: typeof state.prompt === 'string' ? state.prompt : '' }, ...tasks];
    })();

    if (isStaleDoneSnapshotForPending({
      phase: state.phase,
      pendingPrompt: pendingPromptRef.current,
      pendingTaskId: pendingTaskIdRef.current,
      pendingCreatedAt: pendingCreatedAtRef.current,
      snapshotTaskId: state.taskId || null,
      snapshotPrompt: typeof state.prompt === 'string' ? state.prompt : null,
      snapshotCompletedAt: state.completedAt ?? null,
      snapshotUpdatedAt: state.updatedAt ?? null,
    })) {
      return;
    }
    if (isStaleStreamingSnapshotAfterDone({
      phase: state.phase,
      snapshotTaskId: state.taskId || null,
      doneHandoffTaskId: doneHandoffTaskIdRef.current,
    })) {
      return;
    }

    setStreamPhase(state.phase);
    setStreamTaskId(state.taskId || null);
    setQueuedTaskIds(visibleQueuedTaskIds.length ? visibleQueuedTaskIds : []);
    setQueuedTasks(visibleQueuedTasks.length ? visibleQueuedTasks : []);
    setInteractions(Array.isArray(state.interactions) && state.interactions.length ? state.interactions : []);
    if (state.phase === 'streaming') {
      if (state.taskId && doneHandoffTaskIdRef.current === state.taskId) {
        return;
      }
      // Steer handoff: a previous task just ended ('done' triggered loadLatestTurns
      // and armed clearLiveStreamOnLoadRef). The new task's initial snapshot carries
      // an empty text — overwriting liveStream here would flash the previous task's
      // partial response away before loadLatestTurns has a chance to commit it to
      // history. Skip the empty overwrite; the new task's subsequent text events
      // (or the loadLatestTurns completion) will replace liveStream naturally.
      const handingOffPrevTask = shouldSkipEmptyStreamingHandoff({
        clearLiveStreamOnLoad: !!clearLiveStreamOnLoadRef.current,
        liveStreamTaskId: liveStreamRef.current?.taskId ?? null,
        incomingTaskId: state.taskId || null,
        incomingText: String(state.text || ''),
        pendingPrompt: pendingPromptRef.current,
        liveStreamPrompt: liveStreamRef.current?.prompt ?? null,
      });
      if (!handingOffPrevTask) {
        setLiveStream({
          taskId: state.taskId || null,
          prompt: typeof state.prompt === 'string' ? state.prompt : liveStreamRef.current?.prompt ?? null,
          phase: 'streaming',
          text: state.text || '',
          thinking: state.thinking || '',
          activity: state.activity,
          activitySummary: state.activitySummary ?? null,
          activityEvents: state.activityEvents ?? null,
          plan: state.plan ?? null,
          startedAt: state.startedAt ?? null,
          completedAt: state.completedAt ?? null,
          updatedAt: state.updatedAt ?? null,
          model: state.model ?? null,
          effort: state.effort ?? null,
          previewMeta: state.previewMeta ?? null,
          subAgents: state.previewMeta?.subAgents ?? null,
          generatingImages: state.previewMeta?.generatingImages ?? 0,
          error: null,
        });
      }
      setStreaming(true);
      // Promote a queued send to the running pending slot when the streaming
      // task is one we previously queued. Without this, the queued send's
      // optimistic bubble would never appear in the conversation while it
      // runs — we'd be stuck showing the prior task's deduped pendingPrompt.
      if (state.taskId && state.taskId !== pendingTaskIdRef.current) {
        const queue = pendingQueuedSendsRef.current;
        const idx = queue.findIndex(s => s.taskId === state.taskId);
        if (idx >= 0) {
          const promoted = queue[idx];
          // Revoke the previous running slot's images before overwriting.
          for (const url of pendingImageUrlsRef.current) URL.revokeObjectURL(url);
          setPendingPrompt(promoted.prompt || null);
          setPendingCreatedAt(promoted.createdAt || new Date().toISOString());
          setPendingImageUrls(promoted.imageUrls);
          pendingImageUrlsRef.current = promoted.imageUrls;
          setPendingTaskId(state.taskId);
          setPendingQueuedSends(prev => prev.filter((_, i) => i !== idx));
        } else if (typeof state.prompt === 'string' && state.prompt.trim()) {
          const serverPrompt = state.prompt.trim();
          const optimisticPrompt = pendingPromptRef.current?.trim() || '';
          if (!optimisticPrompt || optimisticPrompt === serverPrompt) {
            for (const url of pendingImageUrlsRef.current) URL.revokeObjectURL(url);
            setPendingPrompt(serverPrompt);
            setPendingCreatedAt(state.startedAt ? new Date(state.startedAt).toISOString() : new Date().toISOString());
            setPendingImageUrls([]);
            pendingImageUrlsRef.current = [];
          }
          setPendingTaskId(state.taskId);
        }
      }
      const nextTaskId = state.taskId || null;
      const nextTextLength = String(state.text || '').length;
      const previousAutoScroll = lastStreamAutoScrollRef.current;
      const shouldFollowStream = !previousAutoScroll
        || previousAutoScroll.taskId !== nextTaskId
        || nextTextLength > previousAutoScroll.textLength;
      lastStreamAutoScrollRef.current = { taskId: nextTaskId, textLength: nextTextLength };
      if (shouldFollowStream && canFollowStreamToBottom()) {
        scrollToBottomRef.current = true;
      }
    } else if (state.phase === 'queued') {
      const awaitingOwnTask = !!(pendingPromptRef.current && !pendingTaskIdRef.current);
      if (!awaitingOwnTask) setLiveStream(null);
      setStreaming(false);
      lastStreamAutoScrollRef.current = null;
    } else if (state.phase === 'done') {
      // Don't clear liveStream here — keep it visible so the scroll position stays
      // stable while loadLatestTurns fetches the full history.  The live preview is
      // cleared atomically with the history update inside loadLatestTurns to avoid
      // the intermediate "empty" render that causes a scroll jump.
      setStreaming(false);
      const hasMoreQueued = !!state.queuedTaskIds?.length;
      const stoppedOrIncomplete = !!state.incomplete || /stopped by user/i.test(String(state.error || ''));
      const doneTaskId = state.taskId || null;
      const firstDoneSnapshotForTask = !doneTaskId || doneHandoffTaskIdRef.current !== doneTaskId;
      if (firstDoneSnapshotForTask && doneTaskId) doneHandoffTaskIdRef.current = doneTaskId;
      // Mark the live preview as finished and forward any error from the
      // snapshot so a content-less failure surfaces a reason instead of a phantom.
      setLiveStream(prev => (prev && firstDoneSnapshotForTask) ? {
        ...prev,
        prompt: typeof state.prompt === 'string' ? state.prompt : prev.prompt ?? null,
        phase: 'done',
        error: state.error ?? null,
        completedAt: state.completedAt ?? state.updatedAt ?? prev.completedAt ?? null,
        updatedAt: state.updatedAt ?? prev.updatedAt ?? null,
        previewMeta: state.previewMeta ?? prev.previewMeta ?? null,
      } : prev);
      if (stoppedOrIncomplete && (pendingPrompt || pendingImageUrlsRef.current.length > 0)) {
        setPendingStopped(true);
      }
      if (firstDoneSnapshotForTask) {
        if (!hasMoreQueued && !stoppedOrIncomplete) {
          clearPendingOnLoadRef.current = {
            taskId: doneTaskId,
            pendingCreatedAt: pendingCreatedAtRef.current,
          };
        }
        // Scope the pending clear to the finishing task so a steer handoff can
        // start a new task's stream without losing its preview when the history
        // fetch resolves.
        clearLiveStreamOnLoadRef.current = { taskId: doneTaskId };
        void loadLatestTurns({ keepOlder: true, force: true, scrollToBottom: stickToBottomRef.current });
      }
      if (!hasMoreQueued && !pendingPromptRef.current && !pendingImageUrlsRef.current.length) {
        localStreamPendingRef.current = false;
      }
    }
    // Prune queued-send optimistic entries whose server-assigned taskId no
    // longer appears in the live snapshot — covers server-side cancel /
    // completion paths where the entry would otherwise leak until the safety
    // effect kicks in. Entries with taskId === null are kept (their API
    // response is still in flight).
    const liveTaskIds = new Set<string>();
    if (state.taskId) liveTaskIds.add(state.taskId);
    if (Array.isArray(state.queuedTaskIds)) for (const id of state.queuedTaskIds) liveTaskIds.add(id);
    setPendingQueuedSends(prev => {
      let changed = false;
      const next: PendingQueuedSend[] = [];
      for (const send of prev) {
        if (!send.taskId || liveTaskIds.has(send.taskId)) {
          next.push(send);
        } else {
          for (const url of send.imageUrls) URL.revokeObjectURL(url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    prevPhaseRef.current = state.phase;
  }, [canFollowStreamToBottom, clearPending, clearPendingQueuedSends, loadLatestTurns, pendingPrompt, session.sessionId, session.agent, onSessionChange, workdir]);

  useEffect(() => {
    setStreamStateChecked(false);
  }, [session.agent, session.sessionId]);

  const requestStreamPolling = useCallback(() => {
    localStreamPendingRef.current = true;
    setStreamPollNonce(current => current + 1);
  }, []);

  const handleReorderQueuedTasks = useCallback(async (taskIds: string[]) => {
    if (!session.agent || !session.sessionId || taskIds.length < 2) return;
    const order = new Map(taskIds.map((taskId, idx) => [taskId, idx]));
    setQueuedTaskIds(taskIds);
    setQueuedTasks(prev => {
      const byId = new Map(prev.map(task => [task.taskId, task]));
      return taskIds.map(taskId => byId.get(taskId)).filter((task): task is { taskId: string; prompt: string } => !!task);
    });
    setPendingQueuedSends(prev => [...prev].sort((a, b) => {
      const ai = a.taskId ? order.get(a.taskId) : undefined;
      const bi = b.taskId ? order.get(b.taskId) : undefined;
      if (ai == null && bi == null) return 0;
      if (ai == null) return 1;
      if (bi == null) return -1;
      return ai - bi;
    }));
    try {
      const res = await api.reorderSessionQueue(session.agent, session.sessionId, taskIds);
      if (!res.ok) requestStreamPolling();
      if (res.queuedTaskIds?.length) setQueuedTaskIds(res.queuedTaskIds);
    } catch {
      requestStreamPolling();
    }
  }, [requestStreamPolling, session.agent, session.sessionId]);

  const handleRecallTask = useCallback(async (taskId: string) => {
    try {
      await api.recallSessionMessage(taskId);
      // The running task (pendingTaskId) being recalled is the rare case — the
      // common recall is for a queued entry. Both branches must clean their
      // own optimistic state so the bubble / queue row vanishes immediately.
      if (pendingTaskIdRef.current === taskId) clearPending();
      setPendingQueuedSends(prev => {
        let changed = false;
        const next: PendingQueuedSend[] = [];
        for (const send of prev) {
          if (send.taskId === taskId) {
            for (const url of send.imageUrls) URL.revokeObjectURL(url);
            changed = true;
          } else {
            next.push(send);
          }
        }
        return changed ? next : prev;
      });
      // Optimistic: clear the specific task reference so UI responds immediately
      setQueuedTaskIds(prev => prev.filter(id => id !== taskId));
      setQueuedTasks(prev => prev.filter(t => t.taskId !== taskId));
      setStreamTaskId(prev => prev === taskId ? null : prev);
    } catch {}
  }, [clearPending]);

  const handleSteerTask = useCallback(async (taskId: string) => {
    try { await api.steerSession(taskId); } catch {}
  }, []);

  // Stop EVERYTHING for this session (running + queued). Bound to the main
  // stop button so the user's expectation that "stop = halt this conversation"
  // holds even when they've already queued follow-ups behind the active turn.
  const handleStopAll = useCallback(async () => {
    const taskIds = [
      streamTaskIdRef.current,
      pendingTaskIdRef.current,
      liveStreamRef.current?.taskId ?? null,
      ...queuedTaskIdsRef.current,
    ].filter((taskId): taskId is string => !!taskId);
    const uniqueTaskIds = [...new Set(taskIds)];

    setPendingStopped(true);
    setStreaming(false);
    setStreamPhase('done');
    setStreamTaskId(null);
    setQueuedTaskIds([]);
    setQueuedTasks([]);
    setInteractions([]);
    clearPendingQueuedSends();
    localStreamPendingRef.current = false;
    clearLiveStreamOnLoadRef.current = true;
    setLiveStream(prev => prev ? {
      ...prev,
      phase: 'done',
      error: prev.error || 'Stopped by user',
      completedAt: prev.completedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } : prev);

    try {
      await api.stopSession(session.agent || '', session.sessionId);
    } catch { /* server-side already logged */ }
    if (uniqueTaskIds.length) {
      await Promise.all(uniqueTaskIds.map(taskId => api.recallSessionMessage(taskId).catch(() => null)));
    }
    requestStreamPolling();
    void loadLatestTurns({ keepOlder: true, force: true, scrollToBottom: false });
  }, [clearPendingQueuedSends, loadLatestTurns, requestStreamPolling, session.agent, session.sessionId]);

  const handleResendText = useCallback((txt: string) => {
    const referenceContext = buildReferenceContextEnvelope(String(referenceContextPrompt || ''));
    const prompt = [referenceContext, txt].filter(Boolean).join('\n\n');
    forceScrollToBottomRef.current = true;
    scrollToBottomRef.current = true;
    handleSendStart(txt);
    requestStreamPolling();
    api.sendSessionMessage(workdir, session.agent || '', session.sessionId, prompt, {
      displayPrompt: prompt !== txt ? txt : undefined,
    })
      .then((res) => {
        if (!res.ok) {
          handleSendFailed();
          return;
        }
        if (res.taskId) handleSendTaskAssigned(res.taskId);
      })
      .catch(() => { handleSendFailed(); });
  }, [handleSendFailed, handleSendStart, handleSendTaskAssigned, referenceContextPrompt, requestStreamPolling, session.agent, session.sessionId, workdir]);

  const sk = snapshotKey(session.agent || '', session.sessionId);
  useEffect(() => {
    // During session promotion (pending→native), the sessionId prop changes but the
    // panel stays mounted (stable mountKey). Skip the full reset to preserve live
    // stream state — only refresh history with the new session ID.
    if (promotingRef.current) {
      promotingRef.current = false;
      void loadLatestTurns({ keepOlder: true, force: true });
      return;
    }
    let c = false;
    const cachedLatest = peekSessionMessages({
      workdir,
      agent: session.agent || '',
      sessionId: session.sessionId,
      rich: true,
      turnOffset: 0,
      turnLimit: SESSION_PAGE_TURNS,
    }, { allowStale: true });
    const isNewSession = hasInitialPending;
    // Stale-while-revalidate: API cache → history snapshot → loading spinner
    const initialHistory = cachedLatest?.ok
      ? normalizeTurnHistory(cachedLatest)
      : historySnapshots.get(sk) || null;
    setLoading(isNewSession ? false : !initialHistory);
    setHistory(initialHistory);
    setLiveStream(null);
    setStreaming(false);
    setStreamPhase(null);
    setQueuedTaskIds([]);
    setQueuedTasks([]);
    setInteractions([]);
    lastStreamAutoScrollRef.current = null;
    // Reset the previous session's optimistic state (pending bubble, queued
    // sends, deferred clear flags). Without this, navigating to another
    // session via onSessionChange — including the fork flow that swaps the
    // slot in-place — leaves a stale pendingPrompt that renders as a ghost
    // user bubble in the new session's history. Skip on the new-session
    // mount path, which seeds pending state from props via useState.
    if (!isNewSession) {
      clearPending();
      clearPendingQueuedSends();
      localStreamPendingRef.current = false;
      clearPendingOnLoadRef.current = false;
      clearLiveStreamOnLoadRef.current = false;
      doneHandoffTaskIdRef.current = null;
    }
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = false;
    scrollToBottomRef.current = true;
    if (!isNewSession) {
      loadLatestTurns({ keepOlder: false, force: true }).finally(() => { if (!c) setLoading(false); });
    }
    return () => { c = true; };
  }, [loadLatestTurns, session.agent, session.sessionId, workdir, sk, clearPending, clearPendingQueuedSends]);

  // Persist history snapshot for stale-while-revalidate on re-mount
  useEffect(() => {
    if (history && history.turns.length > 0) saveHistorySnapshot(sk, history);
  }, [sk, history]);

  /* ── Poll stream state — works identically across multiple tabs ── */
  useEffect(() => {
    if (!active) return;
    void loadLatestTurns({ keepOlder: true, force: true });
  }, [active, loadLatestTurns]);

  /* ── WS-driven: apply stream snapshots for ALL open panels (active or not).
     Active panels get full liveStream text; inactive panels get phase/status only. ── */
  const sessionKeyRef = useRef(`${session.agent}:${session.sessionId}`);
  sessionKeyRef.current = `${session.agent}:${session.sessionId}`;

  useDashboardEvent(
    'stream-update',
    useCallback((event: DashboardEvent) => {
      if (suppressLiveStreamState) return;
      if (event.key !== sessionKeyRef.current) return;
      applyStreamSnapshot(event.snapshot ?? null);
    }, [applyStreamSnapshot, suppressLiveStreamState]),
  );

  useEffect(() => {
    if (!suppressLiveStreamState) return;
    applyStreamSnapshot(null);
  }, [applyStreamSnapshot, suppressLiveStreamState]);

  /* ── Initial stream-state fetch (WS handles all subsequent updates).
     Runs for ALL open panels so inactive panels know the current phase. ── */
  useEffect(() => {
    if (suppressLiveStreamState) return;
    let mounted = true;
    void api.getSessionStreamState(session.agent || '', session.sessionId).then(res => {
      if (mounted) applyStreamSnapshot(res.state);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [applyStreamSnapshot, session.agent, session.sessionId, streamPollNonce, suppressLiveStreamState]);

  /* ── Refresh stream state after WS reconnect (covers missed events) ── */
  useDashboardReconnect(useCallback(() => {
    if (!suppressLiveStreamState) {
      void api.getSessionStreamState(session.agent || '', session.sessionId).then(res => {
        applyStreamSnapshot(res.state);
      }).catch(() => {});
    }
    void loadLatestTurns({ keepOlder: true, force: true });
  }, [applyStreamSnapshot, session.agent, session.sessionId, loadLatestTurns, suppressLiveStreamState]));

  /* ── Poll stream state while a session is running (WS fallback) ── */
  useEffect(() => {
    if (suppressLiveStreamState) return;
    const sessionRunning = session.running || session.runState === 'running';
    const streamActive = streaming || streamPhase === 'streaming' || streamPhase === 'queued';
    if (!sessionRunning && !streamActive) return;
    const timer = window.setInterval(() => {
      void api.getSessionStreamState(session.agent || '', session.sessionId).then(res => {
        applyStreamSnapshot(res.state);
      }).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [applyStreamSnapshot, session.agent, session.sessionId, session.running, session.runState, streaming, streamPhase, suppressLiveStreamState]);

  /* ── Safety: clear stale pending state when session stops running ── */
  // Must wait until the stream snapshot is gone (streamPhase null, no queued
  // tasks). Otherwise a steer/recall mid-flight — where session.running can
  // briefly flip to false between task A finishing and queued task B starting —
  // would clear pendingPrompt and "lose" the optimistic bubble for the queued
  // message until loadLatestTurns later picks it up as a persisted turn.
  useEffect(() => {
    const pendingAwaitingTask = !!(pendingPrompt || pendingImageUrls.length > 0) && !pendingTaskId;
    const pendingCreatedAtMs = pendingCreatedAt ? Date.parse(pendingCreatedAt) : NaN;
    const pendingAgeMs = Number.isFinite(pendingCreatedAtMs) ? Date.now() - pendingCreatedAtMs : Infinity;
    const queuedAssignmentGraceActive = pendingQueuedSends.some(send => {
      if (send.taskId) return false;
      const createdAtMs = Date.parse(send.createdAt);
      const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : Infinity;
      return ageMs < LOCAL_SEND_TASK_ASSIGNMENT_GRACE_MS;
    });
    const pendingAssignmentGraceActive =
      (pendingAwaitingTask && pendingAgeMs < LOCAL_SEND_TASK_ASSIGNMENT_GRACE_MS)
      || queuedAssignmentGraceActive;
    const hasPendingContent = !!(pendingPrompt || pendingImageUrls.length);
    const streamLocallyActive = !!(streaming || liveStream || streamPhase);
    if (hasPendingContent && (streamLocallyActive || pendingTaskId || pendingAssignmentGraceActive || localStreamPendingRef.current)) {
      return;
    }
    if (displayState !== 'running' && !streamLocallyActive
        && !streamPhase && queuedTaskIds.length === 0
        && !localStreamPendingRef.current
        && !pendingStopped
        && !pendingAssignmentGraceActive) {
      clearPending();
      clearPendingQueuedSends();
      localStreamPendingRef.current = false;
    }
  }, [displayState, streaming, liveStream, streamPhase, queuedTaskIds.length, pendingPrompt, pendingImageUrls.length, pendingTaskId, pendingCreatedAt, pendingQueuedSends, pendingStopped, clearPending, clearPendingQueuedSends]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    prependAnchorRef.current = null;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [history?.turns.length]);

  const historyScrollKey = history ? `${history.startTurn}:${history.endTurn}:${history.turns.length}` : 'none';
  const liveScrollKey = liveStream ? `${liveStream.taskId || ''}:${liveStream.phase}:${(liveStream.text || '').length}` : 'none';

  const scrollLoadedTurnIntoView = useCallback((turnIndex: number): boolean => {
    const el = scrollRef.current;
    if (!el) return false;
    const target = el.querySelector<HTMLElement>(`[data-session-turn-index="${turnIndex}"]`);
    if (!target) return false;
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, []);

  const scheduleRecallTurnScroll = useCallback((turnIndex: number) => {
    pendingRecallScrollTurnRef.current = turnIndex;
    const run = () => {
      if (pendingRecallScrollTurnRef.current !== turnIndex) return;
      if (scrollLoadedTurnIntoView(turnIndex)) pendingRecallScrollTurnRef.current = null;
    };
    if (typeof window === 'undefined') {
      run();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }, [scrollLoadedTurnIntoView]);

  useLayoutEffect(() => {
    const pendingTurn = pendingRecallScrollTurnRef.current;
    if (pendingTurn == null) return;
    if (scrollLoadedTurnIntoView(pendingTurn)) pendingRecallScrollTurnRef.current = null;
  }, [historyScrollKey, scrollLoadedTurnIntoView]);

  useEffect(() => {
    if (!scrollToTurnRequest) return;
    if (lastRecallScrollNonceRef.current === scrollToTurnRequest.nonce) return;
    lastRecallScrollNonceRef.current = scrollToTurnRequest.nonce;
    const turnIndex = Math.max(0, Math.floor(scrollToTurnRequest.turnIndex));
    if (history && turnIndex >= history.startTurn && turnIndex < history.endTurn) {
      scheduleRecallTurnScroll(turnIndex);
      return;
    }
    const totalTurns = Math.max(
      turnIndex + 1,
      scrollToTurnRequest.totalTurns || 0,
      history?.totalTurns || 0,
      session.numTurns || 0,
    );
    const desiredStart = Math.max(
      0,
      Math.min(
        Math.max(0, turnIndex - Math.floor(SESSION_PAGE_TURNS / 2)),
        Math.max(0, totalTurns - SESSION_PAGE_TURNS),
      ),
    );
    const desiredEnd = Math.min(totalTurns, desiredStart + SESSION_PAGE_TURNS);
    const turnLimit = Math.max(1, desiredEnd - desiredStart);
    const turnOffset = Math.max(0, totalTurns - desiredEnd);
    pendingRecallScrollTurnRef.current = turnIndex;
    void fetchTurnWindow({ turnOffset, turnLimit }, { force: true }).then(next => {
      if (!next) return;
      setHistory(current => {
        if (!current) return next;
        if (next.endTurn <= current.startTurn) return mergeOlderHistory(current, next);
        if (next.startTurn >= current.endTurn) return mergeLatestHistory(current, next);
        return next;
      });
      scheduleRecallTurnScroll(turnIndex);
    });
  }, [fetchTurnWindow, history, scheduleRecallTurnScroll, scrollToTurnRequest, session.numTurns]);

  useEffect(() => {
    if (!scrollToBottomRef.current) return;
    const force = forceScrollToBottomRef.current;
    forceScrollToBottomRef.current = false;
    scrollToBottomRef.current = false;
    scheduleBottomScroll(force);
  }, [historyScrollKey, liveScrollKey, scheduleBottomScroll]);

  // Scroll to bottom when the running task's pending prompt appears.
  // Queued follow-ups stay in the task bar and should not move the transcript.
  useEffect(() => {
    if (!pendingPrompt && pendingImageUrls.length === 0) return;
    const force = forceScrollToBottomRef.current;
    forceScrollToBottomRef.current = false;
    scheduleBottomScroll(force);
  }, [pendingPrompt, pendingImageUrls.length, scheduleBottomScroll]);

  const hasActiveTurn = !!(liveStream || streaming || streamPhase || pendingPrompt);

  useEffect(() => {
    if (!history?.hasOlder || loading || loadingOlder) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + TOP_LOAD_THRESHOLD_PX) {
      void loadOlderTurns();
    }
  }, [history?.hasOlder, history?.turns.length, loadOlderTurns, loading, loadingOlder]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const previousScrollTop = lastScrollTopRef.current;
    const nextScrollTop = el.scrollTop;
    onTranscriptScroll?.({ scrollTop: nextScrollTop });
    lastScrollTopRef.current = nextScrollTop;
    const userMovedUp = nextScrollTop < previousScrollTop - USER_SCROLL_UP_THRESHOLD_PX;
    const remaining = remainingToMessageBottom(el);
    const atBottom = remaining <= 2;
    if (Date.now() < programmaticScrollUntilRef.current) {
      // Programmatic bottom-follow can be active almost continuously while a
      // task streams. If the user drags the scrollbar upward during that
      // window, do not classify it as our own scroll; otherwise the next stream
      // snapshot will pull the panel back to bottom and the scrollbar appears
      // to jitter.
      if (userMovedUp && remaining > 2) {
        autoStickPausedUntilRef.current = Date.now() + USER_SCROLL_AUTOSTICK_PAUSE_MS;
        stickToBottomRef.current = false;
        scrollToBottomRef.current = false;
        if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX) void loadOlderTurns();
        return;
      }
      if (remaining <= BOTTOM_STICK_THRESHOLD_PX && atBottom) {
        stickToBottomRef.current = true;
      }
      return;
    }
    const autoStickPaused = Date.now() < autoStickPausedUntilRef.current;
    if (userMovedUp) {
      autoStickPausedUntilRef.current = Date.now() + USER_SCROLL_AUTOSTICK_PAUSE_MS;
      stickToBottomRef.current = false;
      scrollToBottomRef.current = false;
      if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX) void loadOlderTurns();
      return;
    }
    if (remaining <= BOTTOM_STICK_THRESHOLD_PX) {
      if (atBottom && !autoStickPaused) {
        autoStickPausedUntilRef.current = 0;
        stickToBottomRef.current = true;
      } else {
        stickToBottomRef.current = false;
        scrollToBottomRef.current = false;
      }
    } else {
      stickToBottomRef.current = false;
      if (autoStickPaused) scrollToBottomRef.current = false;
    }
    if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX) void loadOlderTurns();
  }, [loadOlderTurns, onTranscriptScroll]);

  const pauseAutoStickForUserScroll = useCallback((event?: { deltaY?: number }) => {
    const deltaY = event?.deltaY ?? 0;
    const el = scrollRef.current;
    if (el) {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (deltaY > 0 && remaining <= 2) {
        autoStickPausedUntilRef.current = 0;
        stickToBottomRef.current = true;
        return;
      }
    }
    if (deltaY >= 0) return;
    autoStickPausedUntilRef.current = Date.now() + USER_SCROLL_AUTOSTICK_PAUSE_MS;
    stickToBottomRef.current = false;
    scrollToBottomRef.current = false;
  }, []);

  // Effective model + effort to display: live stream wins (it carries the truth
  // for the in-flight turn), then the session's persisted choice, then the
  // agent's runtime default. Always resolves to something so the divider never
  // shows a bare label without context.
  const displayModel = (liveStream?.model || session.model || globalModel) || null;
  const displayEffort = (liveStream?.effort || session.thinkingEffort || globalEffort) || null;
  const displayModelShort = displayModel ? shortenModel(displayModel) : null;

  const rawTurns = history?.turns || [];
  const sessionRunning = !suppressLiveStreamState && !!(session.running || session.runState === 'running');
  const streamSnapshotActive = isLiveStreamActive({
    streaming,
    streamPhase: suppressLiveStreamState ? null : streamPhase as 'queued' | 'streaming' | 'done' | null,
    liveStreamPhase: suppressLiveStreamState ? null : liveStream?.phase ?? null,
    pendingPrompt,
    pendingTaskId,
    pendingImageCount: pendingImageUrls.length,
    sessionRunning,
    streamStateChecked,
  });
  const effectiveLiveStream = useMemo(() => resolveEffectiveLiveStream({
    liveStream: suppressLiveStreamState ? null : liveStream,
    pendingPrompt,
    pendingTaskId,
    streamSnapshotActive,
    streamTaskId,
    displayModel,
    displayEffort,
    sessionRunning,
    streamStateChecked,
  }), [
    suppressLiveStreamState,
    liveStream,
    streamSnapshotActive,
    pendingPrompt,
    pendingTaskId,
    streamTaskId,
    displayModel,
    displayEffort,
    sessionRunning,
    streamStateChecked,
  ]);
  const activeLivePrompt = (pendingPrompt || effectiveLiveStream?.prompt || '').trim();
  // When a live stream is active, the stream prompt owns where the live assistant
  // card attaches. Pending input can be a queued follow-up, so it must not steal
  // ownership from the currently running turn.
  const pendingMatchesLastServerUser = useMemo(() => {
    if (!pendingPrompt || !rawTurns.length) return false;
    const last = rawTurns[rawTurns.length - 1];
    return (last.user?.text?.trim() || '') === pendingPrompt.trim();
  }, [rawTurns, pendingPrompt]);
  const liveCanAttachToLastServerTurn = useMemo(() => {
    if (!effectiveLiveStream || !activeLivePrompt || !rawTurns.length) return false;
    const last = rawTurns[rawTurns.length - 1];
    if (!last.user || last.user.text?.trim() !== activeLivePrompt) return false;
    // Do not attach a restored live stream to an older historical assistant just
    // because the prompt text happens to match. The optimistic pending prompt is
    // the signal that this browser instance owns the currently running turn.
    return pendingMatchesLastServerUser || !last.assistant;
  }, [effectiveLiveStream, activeLivePrompt, rawTurns, pendingMatchesLastServerUser]);
  // True when the server's matching user lacks the images we're holding.
  const optimisticBridgesImages = useMemo(() => {
    if (!pendingImageUrls.length || !pendingMatchesLastServerUser || !rawTurns.length) return false;
    const last = rawTurns[rawTurns.length - 1];
    if (!last.user) return false;
    const serverImages = last.user.blocks.filter(b => b.type === 'image').length;
    return serverImages < pendingImageUrls.length;
  }, [rawTurns, pendingMatchesLastServerUser, pendingImageUrls.length]);

  const liveStreamAlreadyInHistory = useMemo(() => {
    if (!effectiveLiveStream || !rawTurns.length) return false;
    const last = rawTurns[rawTurns.length - 1];
    return computeLiveStreamAlreadyInHistory({
      hasEffectiveLiveStream: true,
      lastTurnUserText: last.user?.text,
      lastAssistantHasFinalOutput: !!last.assistant && assistantHasFinalOutput(last.assistant),
      activeLivePrompt: activeLivePrompt || '',
      effectiveTaskId: effectiveLiveStream.taskId,
      doneHandoffTaskId: doneHandoffTaskIdRef.current,
    });
  }, [effectiveLiveStream, rawTurns, activeLivePrompt]);
  const liveStreamVisible = !!effectiveLiveStream
    && !liveStreamAlreadyInHistory
    && liveStreamShouldRender(effectiveLiveStream);
  const streamIsActive = streamSnapshotActive;

  const turns = useMemo(() => {
    let result = rawTurns;
    // If the server echoed the matching user without the local image previews,
    // keep the optimistic bubble as the visible source for that turn. Text-only
    // sends should use the server user once it arrives, otherwise a later
    // pending cleanup can leave only the Working card visible.
    if (effectiveLiveStream && optimisticBridgesImages) {
      result = result.slice(0, -1);
    }
    // While the just-sent user turn has not been echoed by history yet, keep
    // history immutable. The live preview will render under the optimistic
    // pending bubble below; stripping the last assistant here makes the previous
    // completed turn disappear and visually attaches new work to the old user.
    if (pendingPrompt && !pendingMatchesLastServerUser) return result;
    if (effectiveLiveStream && result.length) {
      const last = result[result.length - 1];
      const activePromptMatches = !!activeLivePrompt && last.user?.text?.trim() === activeLivePrompt;
      const canOwnPromptlessLatestTurn = !activeLivePrompt && streamIsActive;
      if ((activePromptMatches || canOwnPromptlessLatestTurn)
          && last.assistant
          && assistantHasProcessOnlyOutput(last.assistant)) {
        return [...result.slice(0, -1), { ...last, assistant: null }];
      }
    }
    if (effectiveLiveStream && !activeLivePrompt) return result;
    if (!effectiveLiveStream || !result.length) return result;
    if (!liveCanAttachToLastServerTurn) return result;
    const last = result[result.length - 1];
    if (!last.assistant) return result;
    // If a pending prompt exists and doesn't match the last turn's user message,
    // the live stream is for a new follow-up turn, not the last one in history.
    if (activeLivePrompt && last.user?.text?.trim() !== activeLivePrompt) return result;
    return [...result.slice(0, -1), { ...last, assistant: null }];
  }, [rawTurns, effectiveLiveStream, activeLivePrompt, pendingPrompt, pendingMatchesLastServerUser, optimisticBridgesImages, liveCanAttachToLastServerTurn, streamIsActive]);
  const displayTurnItems = useMemo(() => {
    const normalizedReplacementPrompt = editReplacement?.prompt.trim();
    const replacementSourceIndex = editReplacement && normalizedReplacementPrompt
      ? turns.findIndex((turn, sourceIndex) => {
        const absoluteTurnIndex = (history?.startTurn || 0) + sourceIndex;
        return absoluteTurnIndex > editReplacement.fromTurn
          && turn.user?.text?.trim() === normalizedReplacementPrompt;
      })
      : -1;
    return turns
      .map((turn, index) => ({ turn, sourceIndex: index }))
      .filter(({ sourceIndex }) => {
        if (!editReplacement) return true;
        const absoluteTurnIndex = (history?.startTurn || 0) + sourceIndex;
        if (absoluteTurnIndex < editReplacement.fromTurn) return true;
        return replacementSourceIndex >= 0 && sourceIndex >= replacementSourceIndex;
      });
  }, [editReplacement, history?.startTurn, turns]);
  const pendingBubble = (pendingPrompt || pendingImageUrls.length > 0)
    ? (
      <UserBubble
        text={pendingPrompt || ''}
        blocks={pendingImageUrls.map(u => ({ type: 'image' as const, content: u }))}
        createdAt={pendingCreatedAt}
        t={t}
        onResend={pendingStopped ? handleResendText : undefined}
        onEdit={pendingStopped ? (txt) => setEditRequest({ atTurn: null, text: txt, draftPending: true }) : undefined}
        retryProminent={pendingStopped}
      />
    )
    : null;
  const pendingVisibleInTurns = useMemo(() => {
    const trimmed = pendingPrompt?.trim();
    if (!trimmed || !turns.length) return false;
    const last = turns[turns.length - 1];
    return (last.user?.text?.trim() || '') === trimmed;
  }, [turns, pendingPrompt]);
  const showStandalonePending = !!pendingBubble
    && (!pendingVisibleInTurns || optimisticBridgesImages);
  const liveStreamAttachIndex = useMemo(() => {
    if (showStandalonePending) return -1;
    if (!liveStreamVisible || !turns.length) return -1;
    const index = turns.length - 1;
    const last = turns[index];
    if (!last.user) return -1;
    const activePromptMatches = !!activeLivePrompt && last.user.text?.trim() === activeLivePrompt;
    const promptlessActiveTurn = !activeLivePrompt && streamIsActive;
    if ((activePromptMatches || promptlessActiveTurn)
        && last.assistant
        && assistantHasProcessOnlyOutput(last.assistant)) {
      return index;
    }
    if (!activeLivePrompt) return -1;
    if (!liveCanAttachToLastServerTurn) return -1;
    if (!activePromptMatches) return -1;
    return index;
  }, [showStandalonePending, liveStreamVisible, activeLivePrompt, streamIsActive, liveCanAttachToLastServerTurn, turns]);
  const latestContextMeta = useMemo(() => {
    const liveMeta = effectiveLiveStream?.previewMeta;
    if (liveMeta?.contextPercent != null || liveMeta?.contextUsedTokens != null) return liveMeta;
    for (let i = rawTurns.length - 1; i >= 0; i -= 1) {
      const usage = rawTurns[i].assistant?.usage;
      if (usage?.contextPercent != null || usage?.contextUsedTokens != null) return usage;
    }
    return null;
  }, [effectiveLiveStream?.previewMeta, rawTurns]);
  useEffect(() => {
    if (latestContextMeta) setLastContextMeta(latestContextMeta);
  }, [latestContextMeta]);
  const refreshGoalView = useCallback(async () => {
    const agent = session.agent || '';
    const sessionId = session.sessionId || '';
    if (!agent || !sessionId || sessionId.startsWith('pending_')) {
      setGoalView(null);
      return;
    }
    try {
      const res = await api.getSessionGoal(workdir, agent, sessionId);
      if (res.ok) setGoalView(res.goal || null);
    } catch {
      setGoalView(null);
    }
  }, [session.agent, session.sessionId, workdir]);
  useEffect(() => {
    void refreshGoalView();
  }, [refreshGoalView, streamPhase]);
  const runGoalAction = useCallback(async (action: 'pause' | 'resume' | 'clear') => {
    const agent = session.agent || '';
    const sessionId = session.sessionId || '';
    if (!agent || !sessionId || sessionId.startsWith('pending_')) return;
    setGoalBusy(true);
    try {
      if (action === 'pause') {
        const res = await api.pauseSessionGoal(workdir, agent, sessionId);
        if (res.ok) setGoalView(res.goal || null);
      } else if (action === 'resume') {
        const res = await api.resumeSessionGoal(workdir, agent, sessionId);
        if (res.ok) setGoalView(res.goal || null);
      } else {
        const res = await api.clearSessionGoal(workdir, agent, sessionId);
        if (res.ok) setGoalView(null);
      }
    } finally {
      setGoalBusy(false);
    }
  }, [session.agent, session.sessionId, workdir]);
  const composerContextMeta = latestContextMeta ?? lastContextMeta;
  const hasImmediateMessageContent = !!(pendingPrompt || pendingImageUrls.length || effectiveLiveStream);
  const staleRuntimeConfirmed = sessionRunning
    && streamStateChecked
    && !streaming
    && !liveStream
    && !streamPhase;
  const showStaleRuntimeNotice = staleRuntimeConfirmed
    && !pendingPrompt
    && pendingImageUrls.length === 0;
  const composerSession = staleRuntimeConfirmed
    ? {
      ...session,
      running: false,
      runState: session.runState === 'running' ? 'incomplete' as const : session.runState,
      runDetail: session.runDetail || 'No active runtime for this session.',
    }
    : session;
  const transcriptTailKey = [
    showStandalonePending ? 1 : 0,
    liveStreamVisible ? 1 : 0,
    liveStreamAlreadyInHistory ? 1 : 0,
    liveStreamAttachIndex,
    turns.length,
    pendingPrompt?.length || 0,
    effectiveLiveStream?.text?.length || 0,
    effectiveLiveStream?.activity?.length || 0,
  ].join(':');
  const hasVisiblePlanDecision = useMemo(() => {
    if (streamIsActive) return false;
    if (textHasProposedPlan(effectiveLiveStream?.text)) return true;
    const latestTurn = turns[turns.length - 1];
    return messageHasProposedPlan(latestTurn?.assistant);
  }, [effectiveLiveStream?.text, streamIsActive, turns]);
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    scheduleBottomScroll(scrollToBottomRef.current || forceScrollToBottomRef.current);
    scrollToBottomRef.current = false;
    forceScrollToBottomRef.current = false;
  }, [transcriptTailKey, scheduleBottomScroll]);
  const transcriptClass = compact
    ? 'w-[calc(100%_-_32px)] max-w-[640px] mx-auto px-3 pt-3 pb-6 space-y-0'
    : 'max-w-[860px] mx-auto px-6 pt-6 pb-12 space-y-0';

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-[var(--th-session-bg)]', compact && 'text-[12px]')}>
      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={pauseAutoStickForUserScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none]"
      >
        {loading && !hasImmediateMessageContent ? (
          <div className="flex items-center justify-center py-20"><Spinner className="h-5 w-5 text-fg-4" /></div>
        ) : turns.length === 0 && !pendingPrompt && !pendingImageUrls.length && !effectiveLiveStream ? (
          <div className={transcriptClass}>
            {transcriptHeader && (
              <div className="mb-4">
                {transcriptHeader}
              </div>
            )}
            <div className={cn('text-center text-fg-5', compact ? 'py-12 text-[12px]' : 'py-20 text-[13px]')}>{t('hub.noMessages')}</div>
          </div>
        ) : (
          <div className={transcriptClass}>
            {(history?.hasOlder || loadingOlder) && !hasActiveTurn && (
              <div className="mb-4 flex items-center justify-center gap-2 text-[11px] text-fg-5">
                {loadingOlder ? <Spinner className="h-3 w-3 text-fg-5" /> : <span className="h-1.5 w-1.5 rounded-full bg-fg-5/35" />}
                <span>{loadingOlder ? t('hub.loadingOlderTurns') : t('hub.loadOlderTurnsHint')}</span>
              </div>
            )}
            {session.migratedFrom?.kind === 'fork' && session.migratedFrom.sessionId && (
              <button
                type="button"
                onClick={() => onSessionChange?.({
                  agent: session.migratedFrom!.agent || session.agent || '',
                  sessionId: session.migratedFrom!.sessionId,
                  workdir,
                })}
                className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-edge bg-panel-alt px-2.5 py-1 text-[11px] text-fg-5 transition hover:border-edge-h hover:text-fg-2"
                title={`#${session.migratedFrom.sessionId.slice(0, 8)}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
                  <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
                </svg>
                <span>{t('hub.forkBadge')}</span>
                <span className="font-mono">#{session.migratedFrom.sessionId.slice(0, 8)}</span>
                {typeof session.migratedFrom.forkedAtTurn === 'number' && (
                  <span className="text-fg-5/70">· {t('hub.forkBadgeAt').replace('{turn}', String(session.migratedFrom.forkedAtTurn + 1))}</span>
                )}
              </button>
            )}
            {transcriptHeader && (
              <div className="mb-4">
                {transcriptHeader}
              </div>
            )}
            {displayTurnItems.map(({ turn, sourceIndex }) => {
              const absoluteTurnIndex = (history?.startTurn || 0) + sourceIndex;
              const isLatestVisibleTurn = sourceIndex === turns.length - 1;
              const retryProminent = isLatestVisibleTurn
                && displayState === 'incomplete'
                && !streaming
                && !liveStream
                && !streamPhase
                && !!turn.user?.text;
              const assistantRunError = isLatestVisibleTurn
                && displayState === 'incomplete'
                && !streaming
                && !liveStream
                && !streamPhase
                ? (session.runDetail || t('dashboard.incompleteHint'))
                : null;
              return (
                <div key={`${history?.startTurn || 0}:${sourceIndex}`} data-session-turn-index={absoluteTurnIndex}>
                  <TurnView
                    turn={turn}
                    turnIndex={absoluteTurnIndex}
                    agent={session.agent || ''} meta={meta} model={displayModelShort} effort={displayEffort} providerName={byokProviderName} t={t}
                    previewMeta={sourceIndex === liveStreamAttachIndex && effectiveLiveStream ? effectiveLiveStream.previewMeta ?? null : undefined}
                    liveAssistant={sourceIndex === liveStreamAttachIndex && effectiveLiveStream ? <LivePreview stream={effectiveLiveStream} streamActive={streamIsActive} t={t} onOpenFileLink={onOpenFileLink} workdir={workdir} onStopAll={handleStopAll} /> : undefined}
                    onResend={handleResendText}
                    onEdit={(txt) => setEditRequest({ atTurn: absoluteTurnIndex, text: txt, draftPending: true })}
                    onFork={canFork ? (atTurn) => { setForkPrompt(''); setForkRequest({ atTurn }); } : undefined}
                    onOpenFileLink={onOpenFileLink}
                    onCreateSideChatFromSelection={onCreateSideChatFromSelection}
                    onCreateTodoFromSelection={onCreateTodoFromSelection}
                    onCreateReviewCommentFromSelection={handleAppendReviewCommentFromSelection}
                    workdir={workdir}
                    retryProminent={retryProminent}
                    assistantRunError={assistantRunError}
                  />
                </div>
              );
            })}
            {/* Optimistic pending message — represents the RUNNING task's user
                turn until rawTurns picks it up. Deduped against the last loaded
                user turn to avoid double-rendering after history refresh. When
                the server's matching turn lacks images we still hold,
                optimisticBridgesImages keeps this rendered (the matching server
                user is also stripped from `turns` above). Queued sends never
                land in pendingPrompt — they live in `pendingQueuedSends` and
                surface in InputComposer's queue rows instead.
                Note: we deliberately do NOT gate on clearPendingOnLoadRef here.
                That ref signals an in-flight history fetch triggered by 'done',
                and the actual pending clear is batched with setHistory/
                setLiveStream(null) inside loadLatestTurns. Hiding here would
                create a gap between 'done' and fetch completion where neither
                the optimistic bubble nor the server turn is visible. */}
            {showStandalonePending && (
              <div className="session-turn">
                {pendingBubble}
                {liveStreamVisible && liveStreamAttachIndex < 0 && effectiveLiveStream
                  ? (
                    <>
                      <TurnDivider agent={session.agent || ''} meta={meta} model={displayModelShort} effort={displayEffort} providerName={byokProviderName} previewMeta={effectiveLiveStream.previewMeta ?? null} />
                      <div className="mb-6">
                        <LivePreview stream={effectiveLiveStream} streamActive={streamIsActive} t={t} onOpenFileLink={onOpenFileLink} workdir={workdir} onStopAll={handleStopAll} />
                      </div>
                    </>
                  ) : !liveStream && !pendingStopped && (
                    <div className="mt-3 mb-5 animate-in">
                      <ThinkingDots className="text-fg-5" />
                    </div>
                  )}
              </div>
            )}
            {/* Live stream preview — skip entirely when the stream has nothing to show
                (no body, no error). Prevents a phantom header above an empty body. */}
            {liveStreamVisible && liveStreamAttachIndex < 0 && !showStandalonePending && effectiveLiveStream && (
              <div className="mb-6">
                <TurnDivider agent={session.agent || ''} meta={meta} model={displayModelShort} effort={displayEffort} providerName={byokProviderName} previewMeta={effectiveLiveStream.previewMeta} />
                <LivePreview stream={effectiveLiveStream} streamActive={streamIsActive} t={t} onOpenFileLink={onOpenFileLink} workdir={workdir} onStopAll={handleStopAll} />
              </div>
            )}
            {showStaleRuntimeNotice && (
              <div className="mb-6 rounded-lg border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2.5 text-[12px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                <div className="font-semibold text-amber-900 dark:text-amber-100">No active runtime</div>
                <div className="mt-0.5 text-amber-900/70 dark:text-amber-100/70">
                  This session was last saved as running, but the live stream is gone. Continue the chat or restart the task stage to create a new run.
                </div>
              </div>
            )}
            {transcriptFooter && (
              <div className="mb-6">
                {transcriptFooter}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Input ── */}
      {readOnly ? (
        <div className={cn('shrink-0 border-t border-edge/40 bg-[var(--th-session-bg)] shadow-[0_-12px_28px_rgba(15,23,42,0.04)]', compact ? 'px-3 py-2' : 'px-4 py-3')}>
          <div className={cn('mx-auto flex items-center justify-center rounded-md border border-edge bg-panel-alt px-3 py-2 text-fg-5', compact ? 'w-[calc(100%_-_32px)] max-w-[640px] text-[11px]' : 'max-w-[860px] text-[12px]')}>
            Archived assistant history. This chat is read-only.
          </div>
        </div>
      ) : (
      <div className={cn(
        'shrink-0 border-t border-edge/30 bg-[var(--th-session-bg)] shadow-[0_-12px_28px_rgba(15,23,42,0.04)]',
        compact && 'border-edge/45 bg-panel/85',
      )}>
          <GoalStatusBar
            goal={goalView}
            capability={agentRuntime?.capabilities?.goal || null}
            busy={goalBusy}
            compact={compact}
            onPause={() => void runGoalAction('pause')}
            onResume={() => void runGoalAction('resume')}
            onClear={() => void runGoalAction('clear')}
          />
          {hasVisiblePlanDecision && <PlanDecisionBar compact={compact} />}
          <InputComposer
            session={composerSession}
            workdir={workdir}
            compact={compact}
            initialDraftPrompt={initialDraftPrompt}
            referenceContextPrompt={referenceContextPrompt}
            referenceContextLabel={referenceContextLabel}
            initialRuntimeSelection={initialRuntimeSelection}
            onReferenceContextClear={onReferenceContextClear}
            onStreamQueued={requestStreamPolling}
            onSendStart={handleSendStart}
            onSendTaskAssigned={handleSendTaskAssigned}
            onSendFailed={handleSendFailed}
            onSessionChange={onSessionChange}
            onMultiSessionChange={onMultiSessionChange}
            onRuntimeSelectionChange={onRuntimeSelectionChange}
            t={t}
            streamPhase={suppressLiveStreamState ? null : streamPhase}
            streamTaskId={suppressLiveStreamState ? null : streamTaskId}
            queuedTaskIds={suppressLiveStreamState ? [] : queuedTaskIds}
            queuedTasks={suppressLiveStreamState ? [] : queuedTasks}
            pendingQueuedSends={pendingQueuedSends}
            pendingReviewComments={pendingReviewComments}
            onRemovePendingReviewComment={(id) => setPendingReviewComments(prev => prev.filter(comment => comment.id !== id))}
            onClearPendingReviewComments={() => setPendingReviewComments([])}
            contextMeta={composerContextMeta}
            onRecall={handleRecallTask}
            onSteer={handleSteerTask}
            onStopAll={suppressLiveStreamState ? undefined : handleStopAll}
            onReorderQueued={handleReorderQueuedTasks}
            editDraft={editRequest?.draftPending ? editRequest.text : null}
            editAtTurn={editRequest?.atTurn ?? null}
            onEditDraftConsumed={() => setEditRequest(current => current ? { ...current, draftPending: false } : current)}
            onEditSendStart={(prompt, atTurn) => {
              const replacement = { fromTurn: atTurn, prompt };
              setEditReplacement(replacement);
              writeEditReplacement(session.agent, session.sessionId, replacement);
              setEditRequest(null);
            }}
          />
      </div>
      )}

      {/* ── Fork composer modal ── */}
      {forkRequest && (
        <Modal open onClose={() => { if (!forkSubmitting) setForkRequest(null); }}>
          <ModalHeader
            title={t('hub.forkPromptTitle')}
            description={t('hub.forkPromptHint')}
            onClose={() => { if (!forkSubmitting) setForkRequest(null); }}
          />
          <textarea
            autoFocus
            value={forkPrompt}
            disabled={forkSubmitting}
            onChange={(e) => setForkPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && forkPrompt.trim() && !forkSubmitting) {
                e.preventDefault();
                void submitForkRef.current?.();
              }
            }}
            placeholder={t('hub.forkPromptPlaceholder')}
            className="w-full min-h-[120px] resize-y rounded-md border border-edge bg-panel-alt px-3 py-2 text-[13px] leading-relaxed text-fg outline-none focus:border-edge-h"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={forkSubmitting} onClick={() => setForkRequest(null)}>
              {t('modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={forkSubmitting || !forkPrompt.trim()}
              onClick={() => void submitForkRef.current?.()}
            >
              {forkSubmitting ? t('hub.forkSubmitting') : t('hub.forkSubmit')}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Human-in-the-loop ask-user modal ──
          Renders the most recently opened active prompt; if multiple are queued,
          we resolve them in LIFO order so a fresh sub-question pops on top. */}
      {active && interactions.length > 0 && (
        <InteractionPromptModal
          key={interactions[interactions.length - 1].promptId}
          snapshot={interactions[interactions.length - 1]}
        />
      )}
    </div>
  );
});
