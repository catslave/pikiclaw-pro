import { useState, memo, useRef, useCallback, type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { cn, fmtTime, getAgentMeta } from '../../utils';
import { BrandIcon } from '../../components/BrandIcon';
import { createMdComponents, mdPlugins, type OpenFileLinkHandler } from './markdown';
import { stripOaiMemoryCitations } from './messageSanitizers';
import { isContinuationSummary } from './utils';
import { AssistantMsg, hasRenderableAssistant, type ScheduleProposalActionHandler, type WorkflowAskAnswerHandler } from './AssistantContent';
import type { MessageBlock, RichMessage, StreamPreviewMeta, WorkflowRunRecord } from '../../types';
import type { Turn } from './utils';

export type SelectionActionRequest = { quote: string; note: string; turnIndex?: number };
export type SelectionSideChatRequest = SelectionActionRequest & { question: string };
export type SessionMessageAnchorRole = 'user' | 'assistant';

type SelectionDraft = {
  quote: string;
  rect: { left: number; top: number; width: number; height: number };
  highlightRects: Array<{ left: number; top: number; width: number; height: number }>;
  note: string;
  creating: null | 'comment' | 'side-chat' | 'todo';
  expanded: boolean;
};

const selectionDraftCache = new Map<string, SelectionDraft>();
const assistantSelectableSelector = '[data-assistant-selectable], .session-md';
type ReviewCommentCardItem = { index: number; note: string; turn?: string; quote: string };
type ReviewCommentCardData = { comments: ReviewCommentCardItem[]; trailingText: string };

function parseReviewCommentCard(text: string): ReviewCommentCardData | null {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('Review comments to address:')) return null;
  const [commentSection, ...tail] = normalized.split(/\n{2,}/);
  const lines = commentSection.split('\n');
  const comments: ReviewCommentCardItem[] = [];
  let current: ReviewCommentCardItem | null = null;
  let readingQuote = false;

  const pushCurrent = () => {
    if (current && (current.note.trim() || current.quote.trim())) {
      comments.push({
        ...current,
        note: current.note.trim(),
        quote: current.quote.trim(),
      });
    }
  };

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trimEnd();
    const nextComment = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (nextComment) {
      pushCurrent();
      current = { index: Number(nextComment[1]), note: nextComment[2] || '', quote: '' };
      readingQuote = false;
      continue;
    }
    if (!current) continue;
    const turn = line.match(/^\s*Turn:\s*(.+)$/);
    if (turn) {
      current.turn = turn[1].trim();
      readingQuote = false;
      continue;
    }
    if (/^\s*Quote:\s*$/.test(line)) {
      readingQuote = true;
      continue;
    }
    if (readingQuote) {
      current.quote += `${current.quote ? '\n' : ''}${line.replace(/^\s*>\s?/, '')}`;
    } else if (line.trim()) {
      current.note += `${current.note ? '\n' : ''}${line.trim()}`;
    }
  }
  pushCurrent();
  if (!comments.length) return null;
  return { comments, trailingText: tail.join('\n\n').trim() };
}

export const TurnView = memo(function TurnView({ turn, turnIndex, agent, meta, model, effort, providerName, previewMeta, liveAssistant, t, onResend, onEdit, onFork, onOpenFileLink, onCreateSideChatFromSelection, onCreateTodoFromSelection, onCreateReviewCommentFromSelection, workdir, retryProminent, assistantRunError, highlightRole, workflowRun, workflowAskBusyId, onWorkflowAskAnswer, scheduleProposalBusyKey, onScheduleProposalCreate }: {
  turn: Turn; turnIndex?: number; agent: string; meta: ReturnType<typeof getAgentMeta>; model?: string | null; effort?: string | null; t: (k: string) => string;
  /** BYOK provider name shown on the assistant turn header — set when the
   *  agent is currently bound to a Profile. Saved turns lack this in their
   *  usage payload, so we accept it from the caller as a session-level prop. */
  providerName?: string | null;
  previewMeta?: StreamPreviewMeta | null;
  liveAssistant?: ReactNode;
  onResend?: (text: string) => void;
  onEdit?: (text: string) => void;
  /** When defined, the user-bubble shows a fork action that opens a fork composer scoped to this turn. */
  onFork?: (atTurn: number) => void;
  onOpenFileLink?: OpenFileLinkHandler;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  onCreateTodoFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onCreateReviewCommentFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  workdir?: string;
  retryProminent?: boolean;
  assistantRunError?: string | null;
  highlightRole?: SessionMessageAnchorRole | null;
  workflowRun?: WorkflowRunRecord | null;
  workflowAskBusyId?: string | null;
  onWorkflowAskAnswer?: WorkflowAskAnswerHandler;
  scheduleProposalBusyKey?: string | null;
  onScheduleProposalCreate?: ScheduleProposalActionHandler;
}) {
  // Detect system continuation messages stored as user role (context compression summaries,
  // interruption markers). These should not render as user bubbles regardless of whether
  // the turn also contains an assistant response.
  const isSystemMsg = turn.user && isContinuationSummary(turn.user.text);
  const handleFork = onFork && typeof turnIndex === 'number' ? () => onFork(turnIndex) : undefined;
  // Skip the assistant header entirely when there's nothing to put under it —
  // a phantom header reads as "Claude said something invisible" to users.
  const showAssistant = !!turn.assistant && hasRenderableAssistant(turn.assistant);
  const showLiveAssistant = !!liveAssistant;
  const showRunErrorOnly = !!assistantRunError && !showAssistant && !showLiveAssistant;
  const mdComponents = createMdComponents({ onOpenFileLink, workdir });
  const userAnchor = typeof turnIndex === 'number' ? `${turnIndex}:user` : undefined;
  const assistantAnchor = typeof turnIndex === 'number' ? `${turnIndex}:assistant` : undefined;
  const searchAnchorHighlightClass = 'bg-primary/[0.075] shadow-[0_0_0_1px_rgba(125,160,255,0.22)]';

  return (
    <div className="session-turn pk-conversation-turn">
      {turn.user && !isSystemMsg && (
        <div
          data-session-message-anchor={userAnchor}
          className={cn(
            'rounded-xl transition-[background-color,box-shadow] duration-500',
            highlightRole === 'user' && searchAnchorHighlightClass,
          )}
        >
          <UserBubble text={turn.user.text} blocks={turn.user.blocks} createdAt={turn.user.createdAt} t={t} onResend={onResend} onEdit={onEdit} onFork={handleFork} retryProminent={retryProminent} />
        </div>
      )}
      {isSystemMsg && turn.user && !turn.assistant && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[rgba(255,255,255,0.02)] border border-edge/20 text-[12.5px] leading-[1.7] text-fg-4">
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {turn.user.text}
          </ReactMarkdown>
        </div>
      )}
      {(showAssistant || showLiveAssistant || showRunErrorOnly) && (
        <div
          data-session-message-anchor={assistantAnchor}
          className={cn(
            'rounded-xl transition-[background-color,box-shadow] duration-500',
            highlightRole === 'assistant' && searchAnchorHighlightClass,
          )}
        >
          <TurnDivider agent={agent} meta={meta} model={model} effort={effort} providerName={providerName} previewMeta={previewMeta ?? turn.assistant?.usage ?? null} />
          {showLiveAssistant
            ? <AssistantMessageFrame liveContent={liveAssistant} turnIndex={turnIndex} t={t} startedAt={turn.user?.createdAt ?? null} onFork={handleFork} onOpenFileLink={onOpenFileLink} onCreateSideChatFromSelection={onCreateSideChatFromSelection} onCreateTodoFromSelection={onCreateTodoFromSelection} onCreateReviewCommentFromSelection={onCreateReviewCommentFromSelection} workdir={workdir} cacheKeyExtra="live" scheduleProposalBusyKey={scheduleProposalBusyKey} onScheduleProposalCreate={onScheduleProposalCreate} />
            : showAssistant
              ? <AssistantMessageFrame message={turn.assistant!} turnIndex={turnIndex} t={t} startedAt={turn.user?.createdAt ?? null} runError={assistantRunError ?? null} onFork={handleFork} onOpenFileLink={onOpenFileLink} onCreateSideChatFromSelection={onCreateSideChatFromSelection} onCreateTodoFromSelection={onCreateTodoFromSelection} onCreateReviewCommentFromSelection={onCreateReviewCommentFromSelection} workdir={workdir} workflowRun={workflowRun} workflowAskBusyId={workflowAskBusyId} onWorkflowAskAnswer={onWorkflowAskAnswer} scheduleProposalBusyKey={scheduleProposalBusyKey} onScheduleProposalCreate={onScheduleProposalCreate} />
              : <RunErrorNotice detail={assistantRunError!} t={t} />}
        </div>
      )}
    </div>
  );
});

function RunErrorNotice({ detail, t }: { detail: string; t: (key: string) => string }) {
  return (
    <div className="mb-6 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-100/90">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/80 dark:text-amber-200/80">
        {t('hub.statusStopped')}
      </div>
      <div>{detail}</div>
    </div>
  );
}

/** Lightbox for full-screen image preview */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

/** Threshold above which a user bubble's text starts collapsed behind a toggle.
 *  Picked to comfortably fit a paragraph or short snippet inline while folding
 *  large pastes (logs, code, the cross-agent `<handover>` seed). */
const LONG_USER_TEXT_CHAR_THRESHOLD = 1500;
const LONG_USER_TEXT_LINE_THRESHOLD = 16;
/** Lines kept visible above the "show all" toggle when collapsed. */
const COLLAPSED_PREVIEW_LINES = 8;

function previewFromText(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= COLLAPSED_PREVIEW_LINES) return text;
  return lines.slice(0, COLLAPSED_PREVIEW_LINES).join('\n');
}

/** User message bubble with actions */
export function UserBubble({ text, blocks, createdAt, t, onResend, onEdit, onFork, retryProminent }: {
  text: string;
  blocks?: MessageBlock[];
  createdAt?: string | null;
  t: (k: string) => string;
  onResend?: (text: string) => void;
  onEdit?: (text: string) => void;
  /** When provided, hover action bar shows a fork button that branches off this turn. */
  onFork?: () => void;
  retryProminent?: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const reviewCommentCard = parseReviewCommentCard(text);
  const totalLines = text ? text.split('\n').length : 0;
  const isLong = !!text && (text.length > LONG_USER_TEXT_CHAR_THRESHOLD || totalLines > LONG_USER_TEXT_LINE_THRESHOLD);
  const [expanded, setExpanded] = useState(false);
  const displayText = !text ? '' : (isLong && !expanded ? previewFromText(text) : text);
  const hasActions = !!(createdAt || text || onResend || onEdit || onFork);
  const imageBlocks = dedupeImageBlocks(blocks?.filter(b => b.type === 'image') || []);

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const expandLabel = t('hub.expand')
    .replace('{chars}', text ? text.length.toLocaleString() : '0')
    .replace('{lines}', String(totalLines));

  return (
    <div
      className="pk-conversation-user-turn flex flex-col items-end mb-5 group/bubble"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={cn(
        'pk-conversation-user-bubble min-w-0 rounded-md border border-fg-6 bg-panel text-fg shadow-sm',
        reviewCommentCard ? 'w-full max-w-[760px] px-0 py-0' : 'max-w-[72%] px-4 py-3 text-[13.5px] leading-[1.72]',
      )}>
        {reviewCommentCard ? (
          <ReviewCommentsUserCard data={reviewCommentCard} />
        ) : text ? (
          <div className="whitespace-pre-wrap break-words">
            {displayText}
            {isLong && !expanded && <span className="text-fg-5/60">…</span>}
          </div>
        ) : null}
        {!reviewCommentCard && isLong && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-2 text-[11.5px] text-fg-4 hover:text-fg-2 underline decoration-fg-5/40 underline-offset-2 transition-colors"
          >
            {expanded ? t('hub.collapse') : expandLabel}
          </button>
        )}
        {imageBlocks.length > 0 && (
          <div className={cn('flex min-w-0 max-w-full flex-wrap gap-2', text && !reviewCommentCard && 'mt-2', reviewCommentCard && 'px-4 pb-4')}>
            {imageBlocks.map((img, i) => (
              <img
                key={i}
                src={img.content}
                className="h-auto w-full max-w-[min(280px,100%)] max-h-[200px] rounded border border-fg-6/50 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
                onClick={() => setLightboxSrc(img.content)}
              />
            ))}
          </div>
        )}
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      {/* Action bar — appears below the bubble on hover */}
      {hasActions && (
        <HoverMessageActions
          align="right"
          visible={showActions || !!retryProminent}
          createdAt={createdAt}
          canCopy={!!text}
          copied={copied}
          t={t}
          onCopy={handleCopy}
          onResend={onResend ? () => onResend(text) : undefined}
          resendLabel={retryProminent ? t('hub.retry') : undefined}
          resendEmphasis={retryProminent}
          onEdit={onEdit ? () => onEdit(text) : undefined}
          onFork={onFork}
        />
      )}
    </div>
  );
}

function ReviewCommentsUserCard({ data }: { data: ReviewCommentCardData }) {
  return (
    <div className="overflow-hidden rounded-md">
      <div className="flex items-center justify-between gap-3 border-b border-edge/50 bg-panel-alt/45 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-fg">Review comments</div>
          <div className="mt-0.5 text-[11px] text-fg-5">Comments queued for the next agent turn</div>
        </div>
        <div className="shrink-0 rounded-full border border-primary/20 bg-primary/[0.08] px-2.5 py-1 text-[11px] font-semibold text-primary">
          {data.comments.length} item{data.comments.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="divide-y divide-edge/45">
        {data.comments.map(comment => (
          <div key={`${comment.index}-${comment.note}`} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-edge/65 bg-inset text-[11px] font-semibold text-fg-4">
                {comment.index}
              </div>
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-fg">
                  {comment.note}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] font-medium text-fg-5">
                  {comment.turn && <span className="rounded border border-edge/55 bg-control/70 px-1.5 py-0.5">Turn {comment.turn}</span>}
                  <span className="rounded border border-edge/55 bg-control/70 px-1.5 py-0.5">Quote</span>
                </div>
                {comment.quote && (
                  <blockquote className="mt-2 border-l-2 border-primary/30 bg-inset/65 px-3 py-2 text-[12px] leading-relaxed text-fg-4">
                    <div className="line-clamp-4 whitespace-pre-wrap break-words">{comment.quote}</div>
                  </blockquote>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {data.trailingText && (
        <div className="border-t border-edge/50 bg-panel/70 px-4 py-3">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-5">Message</div>
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-3">{data.trailingText}</div>
        </div>
      )}
    </div>
  );
}

function dedupeImageBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const seen = new Set<string>();
  const out: MessageBlock[] = [];
  for (const block of blocks) {
    const key = block.imagePath || block.content;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(block);
  }
  return out;
}

function AssistantMessageFrame({
  message,
  liveContent,
  cacheKeyExtra,
  turnIndex,
  t,
  startedAt,
  runError,
  onFork,
  onOpenFileLink,
  onCreateSideChatFromSelection,
  onCreateTodoFromSelection,
  onCreateReviewCommentFromSelection,
  workdir,
  workflowRun,
  workflowAskBusyId,
  onWorkflowAskAnswer,
  scheduleProposalBusyKey,
  onScheduleProposalCreate,
}: {
  message?: RichMessage;
  liveContent?: ReactNode;
  cacheKeyExtra?: string;
  turnIndex?: number;
  t: (k: string) => string;
  startedAt?: string | null;
  runError?: string | null;
  onFork?: () => void;
  onOpenFileLink?: OpenFileLinkHandler;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  onCreateTodoFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onCreateReviewCommentFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  workdir?: string;
  workflowRun?: WorkflowRunRecord | null;
  workflowAskBusyId?: string | null;
  onWorkflowAskAnswer?: WorkflowAskAnswerHandler;
  scheduleProposalBusyKey?: string | null;
  onScheduleProposalCreate?: ScheduleProposalActionHandler;
}) {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const copyText = message ? stripOaiMemoryCitations(message.text || message.blocks.map(block => block.content).filter(Boolean).join('\n\n')) : '';
  const messageCreatedAt = message?.createdAt || '';
  const selectionDraftCacheKey = `${workdir || ''}:${turnIndex ?? ''}:${cacheKeyExtra || messageCreatedAt}:${copyText.length}:${copyText.slice(0, 80)}`;
  const [selectionDraft, setSelectionDraftState] = useState<SelectionDraft | null>(() => selectionDraftCache.get(selectionDraftCacheKey) ?? null);

  useEffect(() => {
    setSelectionDraftState(selectionDraftCache.get(selectionDraftCacheKey) ?? null);
  }, [selectionDraftCacheKey]);

  const setSelectionDraft: Dispatch<SetStateAction<SelectionDraft | null>> = useCallback((next) => {
    setSelectionDraftState(current => {
      const resolved = typeof next === 'function'
        ? (next as (value: SelectionDraft | null) => SelectionDraft | null)(current)
        : next;
      if (resolved) selectionDraftCache.set(selectionDraftCacheKey, resolved);
      return resolved;
    });
  }, [selectionDraftCacheKey]);

  const clearSelectionDraft = useCallback((opts: { forget?: boolean } = {}) => {
    if (opts.forget) selectionDraftCache.delete(selectionDraftCacheKey);
    setSelectionDraftState(null);
  }, [selectionDraftCacheKey]);

  const handleCopy = () => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  useEffect(() => {
    if (!selectionDraft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelectionDraft({ forget: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-selection-side-chat-popover]')) return;
      if (selectionDraft.expanded && selectionDraft.note.trim()) return;
      if (target?.closest(assistantSelectableSelector)) {
        window.getSelection()?.removeAllRanges();
        clearSelectionDraft({ forget: true });
        return;
      }
      if (frameRef.current?.contains(target)) return;
      clearSelectionDraft({ forget: true });
    };
    const clearTransientSelectionDraft = () => {
      if (selectionDraft.expanded && selectionDraft.note.trim()) return;
      window.getSelection()?.removeAllRanges();
      clearSelectionDraft({ forget: true });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', clearTransientSelectionDraft, true);
    window.addEventListener('resize', clearTransientSelectionDraft);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', clearTransientSelectionDraft, true);
      window.removeEventListener('resize', clearTransientSelectionDraft);
    };
  }, [clearSelectionDraft, selectionDraft]);

  const handleSelectionEnd = () => {
    if (!frameRef.current || (!onCreateSideChatFromSelection && !onCreateTodoFromSelection && !onCreateReviewCommentFromSelection)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const rawQuote = selection.toString().replace(/\s+\n/g, '\n').trim();
    if (!rawQuote) return;
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const element = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as Element
      : ancestor.parentElement;
    if (!element || !frameRef.current.contains(element)) return;
    if (!element.closest(assistantSelectableSelector)) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const highlightRects = Array.from(range.getClientRects())
      .filter(item => item.width > 0 && item.height > 0)
      .slice(0, 24)
      .map(item => ({ left: item.left, top: item.top, width: item.width, height: item.height }));
    setSelectionDraft({
      quote: rawQuote.slice(0, 8000),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      highlightRects,
      note: '',
      creating: null,
      expanded: false,
    });
  };

  const handleSelectionStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectionDraft) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest(assistantSelectableSelector)) return;
    if (selectionDraft.expanded && selectionDraft.note.trim()) return;
    window.getSelection()?.removeAllRanges();
    clearSelectionDraft({ forget: true });
  };

  const submitSelectionAction = async (action: 'comment' | 'side-chat' | 'todo') => {
    if (!selectionDraft || selectionDraft.creating) return;
    const note = selectionDraft.note.trim();
    if (!note) return;
    const request = { quote: selectionDraft.quote, note, turnIndex };
    setSelectionDraft(current => current ? { ...current, creating: action } : current);
    try {
      if (action === 'side-chat') {
        if (!onCreateSideChatFromSelection) return;
        await onCreateSideChatFromSelection({ ...request, question: note });
      } else if (action === 'todo') {
        if (!onCreateTodoFromSelection) return;
        await onCreateTodoFromSelection(request);
      } else {
        if (!onCreateReviewCommentFromSelection) return;
        await onCreateReviewCommentFromSelection(request);
      }
      window.getSelection()?.removeAllRanges();
      clearSelectionDraft({ forget: true });
    } catch {
      setSelectionDraft(current => current ? { ...current, creating: null } : current);
    }
  };

  return (
    <div
      ref={frameRef}
      className="pk-conversation-assistant-turn mb-6 group/assistant"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onMouseDown={handleSelectionStart}
      onMouseUp={handleSelectionEnd}
      onKeyUp={handleSelectionEnd}
    >
      {liveContent ?? (message ? <AssistantMsg message={message} t={t} startedAt={startedAt ?? null} completedAt={message.createdAt ?? null} runError={runError ?? null} onOpenFileLink={onOpenFileLink} workdir={workdir} workflowRun={workflowRun} workflowAskBusyId={workflowAskBusyId} onWorkflowAskAnswer={onWorkflowAskAnswer} scheduleProposalBusyKey={scheduleProposalBusyKey} onScheduleProposalCreate={onScheduleProposalCreate} /> : null)}
      <HoverMessageActions
        align="left"
        visible={showActions && !!message}
        createdAt={message?.createdAt}
        canCopy={!!copyText}
        copied={copied}
        t={t}
        onCopy={handleCopy}
        onFork={onFork}
      />
      {selectionDraft && createPortal(
        <>
          {selectionDraft.highlightRects.map((rect, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="pointer-events-none fixed z-[9998] rounded-[3px] bg-primary/15 ring-1 ring-primary/20"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          ))}
          {selectionDraft.expanded ? (
            <div
              data-selection-side-chat-popover
              className="fixed z-[10000]"
              style={{
                left: Math.min(
                  window.innerWidth - 380,
                  Math.max(12, selectionDraft.rect.left - 190 + (selectionDraft.rect.width / 2)),
                ),
                top: Math.min(window.innerHeight - 148, Math.max(12, selectionDraft.rect.top + selectionDraft.rect.height + 8)),
              }}
              onClick={event => event.stopPropagation()}
            >
              <div className="w-[360px] rounded-xl border border-edge-h bg-panel p-2 shadow-xl">
                <div className="mb-2 max-h-[42px] overflow-hidden rounded-lg bg-panel-alt px-2 py-1.5 text-[11px] leading-relaxed text-fg-5">
                  {selectionDraft.quote}
                </div>
                <input
                  autoFocus
                  value={selectionDraft.note}
                  onChange={event => setSelectionDraft(current => current ? { ...current, note: event.target.value } : current)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void submitSelectionAction('side-chat');
                    }
                  }}
                  placeholder={t('session.selectionActionPlaceholder')}
                  className="h-8 w-full rounded-lg border border-control-border bg-control px-2 text-[12px] text-fg outline-none transition placeholder:text-fg-5/60 focus:border-control-border-h focus:ring-2 focus:ring-[color:var(--th-selection-ring)]"
                />
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={!selectionDraft.note.trim() || !!selectionDraft.creating || !onCreateReviewCommentFromSelection}
                    onClick={() => void submitSelectionAction('comment')}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-panel-alt px-3 text-[12px] font-semibold text-fg-3 transition hover:bg-panel-h hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectionDraft.creating === 'comment' ? t('session.savingComment') : t('session.selectionComment')}
                  </button>
                  <button
                    type="button"
                    disabled={!selectionDraft.note.trim() || !!selectionDraft.creating || !onCreateSideChatFromSelection}
                    onClick={() => void submitSelectionAction('side-chat')}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-panel-alt px-3 text-[12px] font-semibold text-fg-3 transition hover:bg-panel-h hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectionDraft.creating === 'side-chat' ? t('session.creatingSideChat') : t('session.createSideChat')}
                  </button>
                  <button
                    type="button"
                    disabled={!selectionDraft.note.trim() || !!selectionDraft.creating || !onCreateTodoFromSelection}
                    onClick={() => void submitSelectionAction('todo')}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-edge-h bg-panel-h px-3 text-[12px] font-semibold text-fg transition hover:bg-control disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectionDraft.creating === 'todo' ? t('session.savingTodo') : t('session.selectionTodo')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-selection-side-chat-popover
              className="fixed z-[10000] inline-flex h-7 w-7 items-center justify-center rounded-full border border-edge-h bg-panel/95 text-[16px] font-semibold leading-none text-fg-3 shadow-[0_10px_28px_rgba(15,23,42,0.20)] ring-1 ring-white/[0.05] backdrop-blur transition-[background,color,transform] hover:-translate-y-px hover:bg-panel-h hover:text-primary"
              style={{
                left: Math.min(window.innerWidth - 40, Math.max(12, selectionDraft.rect.left + selectionDraft.rect.width + 8)),
                top: Math.min(window.innerHeight - 40, Math.max(12, selectionDraft.rect.top + selectionDraft.rect.height + 6)),
              }}
              aria-label={t('hub.add')}
              title={t('hub.add')}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                setSelectionDraft(current => current ? { ...current, expanded: true } : current);
              }}
            >
              +
            </button>
          )}
        </>,
        document.body,
      )}
    </div>
  );
}

function HoverMessageActions({ align, visible, createdAt, canCopy, copied, t, onCopy, onResend, resendLabel, resendEmphasis, onEdit, onFork }: {
  align: 'left' | 'right';
  visible: boolean;
  createdAt?: string | null;
  canCopy: boolean;
  copied: boolean;
  t: (k: string) => string;
  onCopy: () => void;
  onResend?: () => void;
  resendLabel?: string;
  resendEmphasis?: boolean;
  onEdit?: () => void;
  onFork?: () => void;
}) {
  if (!createdAt && !canCopy && !onResend && !onEdit && !onFork) return null;
  return (
    <div className={cn(
      'flex min-h-7 items-center gap-1 mt-1.5 transition-opacity duration-150',
      align === 'right' ? 'mr-1 justify-end' : 'ml-1 justify-start',
      visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
    )}>
      {createdAt && (
        <span className="px-1.5 text-[10.5px] tabular-nums text-fg-5/70" title={formatFullMessageTime(createdAt)}>
          {formatCompactMessageTime(createdAt)}
        </span>
      )}
      {canCopy && (
        <BubbleAction label={copied ? t('hub.copied') : t('hub.copy')} onClick={onCopy}>
          {copied
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          }
        </BubbleAction>
      )}
      {onResend && (
        <BubbleAction label={resendLabel || t('hub.rerun')} onClick={onResend} tone={resendEmphasis ? 'warn' : 'default'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </BubbleAction>
      )}
      {onEdit && (
        <BubbleAction label={t('hub.edit')} onClick={onEdit}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </BubbleAction>
      )}
      {onFork && (
        <BubbleAction label={t('hub.fork')} onClick={onFork}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
            <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
          </svg>
        </BubbleAction>
      )}
    </div>
  );
}

function formatCompactMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return fmtTime(iso);
}

function formatFullMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function BubbleAction({ label, onClick, children, tone = 'default' }: { label: string; onClick: () => void; children: ReactNode; tone?: 'default' | 'warn' }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'group/action inline-flex h-7 max-w-7 items-center justify-center overflow-hidden rounded border bg-panel px-[7px] text-[11px] leading-none shadow-sm transition-all duration-150',
        'hover:max-w-[132px] hover:justify-start hover:gap-1.5 hover:px-2 focus-visible:max-w-[132px] focus-visible:justify-start focus-visible:gap-1.5 focus-visible:px-2',
        tone === 'warn'
          ? 'border-warn/35 text-warn hover:border-warn/60 hover:bg-warn/10'
          : 'border-fg-6 text-fg-4 hover:text-fg-2 hover:border-edge-h hover:bg-panel-h',
      )}
    >
      <span className="shrink-0">{children}</span>
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/action:max-w-[104px] group-hover/action:opacity-100 group-focus-visible/action:max-w-[104px] group-focus-visible/action:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

export function TurnDivider({ agent, meta, model, effort, providerName: providerNameProp, previewMeta }: {
  agent: string;
  meta: ReturnType<typeof getAgentMeta>;
  model?: string | null;
  effort?: string | null;
  /** Session-level BYOK provider fallback used when previewMeta lacks one
   *  (saved messages don't carry usage / providerName). */
  providerName?: string | null;
  /** Live token / context-window stats — when present, rendered as a trailing chip. */
  previewMeta?: StreamPreviewMeta | null;
}) {
  const ctxPct = typeof previewMeta?.contextPercent === 'number' && Number.isFinite(previewMeta.contextPercent)
    ? Math.max(0, Math.min(100, previewMeta.contextPercent))
    : null;
  // Use the per-call context occupancy (input + cache_read + cache_creation
  // for the latest LLM call) — NOT the cumulative inputTokens/cachedInputTokens,
  // which double-count the same cached prefix on every tool roundtrip.
  const ctxTokens = previewMeta?.contextUsedTokens ?? 0;
  const showCtx = ctxPct != null || ctxTokens > 0;
  // Prefer live preview's providerName (most accurate per-turn); fall back to
  // the session-level prop for saved turns whose `usage` lacks the field.
  const providerName = previewMeta?.providerName ?? providerNameProp ?? null;
  return (
    <div className="pk-turn-divider flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 mt-1 mb-3">
      <BrandIcon brand={agent} size={13} />
      <span className="pk-turn-divider-agent shrink-0 text-[12px] font-semibold text-fg-2" style={{ color: meta.color }}>{meta.label}</span>
      {(model || effort) && (
        <span className="min-w-0 truncate text-[10px] font-mono text-fg-4">
          {model || ''}{model && effort ? ' · ' : ''}{effort || ''}
        </span>
      )}
      {providerName && (
        <span
          className="shrink-0 text-[10px] font-mono text-fg-4 px-1.5 py-px rounded bg-fg-5/8"
          title={`This turn is routed through ${providerName} (BYOK), not the agent CLI's native auth.`}
        >
          via {providerName}
        </span>
      )}
      {showCtx && (
        <span className="ml-auto inline-flex min-w-0 shrink-0 justify-end items-center gap-1 text-[10px] font-mono tabular-nums text-fg-5/55" title={formatContextTitle(previewMeta)}>
          {ctxPct != null && <ContextDot pct={ctxPct} />}
          <span>{ctxPct != null ? `${ctxPct.toFixed(1)}%` : ''}</span>
          {ctxTokens > 0 && <span className="text-fg-5/40">· {formatTokens(ctxTokens)}</span>}
        </span>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${n} tok`;
}

function formatContextTitle(meta: StreamPreviewMeta | null | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.contextPercent === 'number' && Number.isFinite(meta.contextPercent)) {
    parts.push(`Context: ${Math.max(0, Math.min(100, meta.contextPercent)).toFixed(1)}%`);
  }
  if (typeof meta.contextUsedTokens === 'number' && Number.isFinite(meta.contextUsedTokens)) {
    parts.push(`Tokens: ${meta.contextUsedTokens.toLocaleString()}`);
  }
  return parts.join('  ·  ');
}

function ContextDot({ pct }: { pct: number }) {
  const color = pct >= 85 ? 'bg-rose-400/70' : pct >= 60 ? 'bg-amber-400/70' : 'bg-emerald-400/70';
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}
