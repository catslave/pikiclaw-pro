import type { MessageBlock } from '../../types';

export type StreamPhase = 'queued' | 'streaming' | 'done' | null;

export function assistantHasFinalOutput(message: { blocks?: MessageBlock[] } | null | undefined): boolean {
  return !!message?.blocks?.some(block => (
    block.type === 'image'
    || (block.type === 'text' && block.phase !== 'commentary' && !!block.content.trim())
  ));
}

export function assistantHasProcessOnlyOutput(message: { blocks?: MessageBlock[] } | null | undefined): boolean {
  if (!message?.blocks?.length || assistantHasFinalOutput(message)) return false;
  return message.blocks.some(block => (
    block.type === 'tool_use'
    || block.type === 'tool_result'
    || block.type === 'thinking'
    || block.type === 'plan'
    || block.type === 'sub_agent'
    || (block.type === 'text' && block.phase === 'commentary' && !!block.content.trim())
  ));
}

export type SendQueueContext = {
  streaming: boolean;
  streamPhase: StreamPhase;
  pendingPrompt: string | null | undefined;
  pendingTaskId: string | null | undefined;
  queuedTaskCount: number;
};

/** True when a follow-up send should enter the composer queue instead of owning pendingPrompt. */
export function hasRunningTurnForQueue(ctx: SendQueueContext): boolean {
  if (ctx.streaming || ctx.streamPhase === 'streaming') return true;
  const hasPendingAcceptedTask = !!(ctx.pendingPrompt?.trim() && ctx.pendingTaskId);
  if (!hasPendingAcceptedTask) return false;
  // During done→history handoff the prior taskId is still on pending until
  // loadLatestTurns clears it; that must not block a fresh send.
  return ctx.streamPhase !== 'done';
}

export function willQueueSendOnStart(ctx: SendQueueContext): boolean {
  return hasRunningTurnForQueue(ctx) || ctx.queuedTaskCount > 0;
}

export type SessionCommandStateInput = {
  pendingPrompt: string | null | undefined;
  pendingTaskId: string | null | undefined;
  pendingImageCount: number;
  streamPhase: StreamPhase;
  streamTaskId: string | null | undefined;
  streaming: boolean;
  sessionRunning?: boolean;
  streamStateChecked?: boolean;
  queuedTaskCount: number;
  pendingQueuedSendCount: number;
  activity?: string | null;
};

export type SessionCommandStateKind =
  | 'pending-send'
  | 'provider-wake'
  | 'queued'
  | 'streaming'
  | 'command-queue';

export type SessionCommandStateSummary = {
  kind: SessionCommandStateKind;
  title: string;
  detail: string;
  count: number;
  activeTaskId: string | null;
};

export function summarizeSessionCommandState(input: SessionCommandStateInput): SessionCommandStateSummary | null {
  const pendingText = input.pendingPrompt?.trim() || '';
  const hasPendingContent = !!pendingText || input.pendingImageCount > 0;
  const queuedCount = Math.max(0, input.queuedTaskCount + input.pendingQueuedSendCount);
  const activeTaskId = input.streamTaskId || input.pendingTaskId || null;

  if (input.streaming || input.streamPhase === 'streaming') {
    return {
      kind: queuedCount > 0 ? 'command-queue' : 'streaming',
      title: queuedCount > 0 ? 'Command queue active' : 'Agent is working',
      detail: input.activity?.trim() || (queuedCount > 0 ? 'Running current command with follow-ups waiting.' : 'Streaming response and tool activity.'),
      count: queuedCount,
      activeTaskId,
    };
  }

  if (input.streamPhase === 'queued') {
    return {
      kind: 'queued',
      title: 'Command queued',
      detail: queuedCount > 1 ? `${queuedCount} commands waiting for this session.` : 'Waiting for the active session turn to finish.',
      count: Math.max(1, queuedCount),
      activeTaskId,
    };
  }

  if (hasPendingContent && !input.pendingTaskId && input.streamPhase !== 'done') {
    return {
      kind: 'pending-send',
      title: 'Sending command',
      detail: 'Handing the message to the selected agent.',
      count: queuedCount,
      activeTaskId: null,
    };
  }

  if (input.sessionRunning && !input.streamStateChecked) {
    return {
      kind: 'provider-wake',
      title: 'Reconnecting runtime',
      detail: 'Checking the provider stream for the latest command state.',
      count: queuedCount,
      activeTaskId,
    };
  }

  if (queuedCount > 0) {
    return {
      kind: 'command-queue',
      title: 'Command queue',
      detail: `${queuedCount} follow-up${queuedCount === 1 ? '' : 's'} waiting behind the active turn.`,
      count: queuedCount,
      activeTaskId,
    };
  }

  return null;
}

export type EffectiveLiveStreamInput = {
  liveStream: {
    taskId?: string | null;
    prompt?: string | null;
  } | null;
  pendingPrompt: string | null | undefined;
  pendingTaskId: string | null | undefined;
  streamSnapshotActive: boolean;
  streamTaskId: string | null | undefined;
  displayModel: string | null;
  displayEffort: string | null;
  /** Session record says running even when the stream snapshot hasn't arrived yet. */
  sessionRunning?: boolean;
  /** True after the client has asked the backend for this session's stream state at least once. */
  streamStateChecked?: boolean;
};

export type EffectiveLiveStreamShell = {
  taskId: string | null;
  prompt: string | null;
  phase: 'streaming';
  text: string;
  thinking: string;
  activity: string;
  activitySummary: null;
  activityEvents: null;
  plan: null;
  startedAt: null;
  completedAt: null;
  updatedAt: null;
  model: string | null;
  effort: string | null;
  previewMeta: null;
  subAgents: null;
  generatingImages: number;
  error: null;
};

export function resolveEffectiveLiveStream<T extends EffectiveLiveStreamInput['liveStream']>(
  input: EffectiveLiveStreamInput,
): T | EffectiveLiveStreamShell | null {
  const pendingTrimmed = input.pendingPrompt?.trim() || '';
  const live = input.liveStream;
  const livePromptTrimmed = live?.prompt?.trim() || '';
  const liveMatchesPending = !pendingTrimmed
    || !livePromptTrimmed
    || livePromptTrimmed === pendingTrimmed;
  const liveMatchesTask = !input.pendingTaskId
    || !live?.taskId
    || live.taskId === input.pendingTaskId;
  const canSynthesizeRunningShell = !!input.sessionRunning && !input.streamStateChecked;
  // The backend may expand slash commands such as `/plan clarify ...` into a
  // longer internal prompt. When the task id matches, the live stream is still
  // the authoritative process state; dropping it would replace real activity
  // with an empty "waiting" shell.
  if (live && input.pendingTaskId && live.taskId === input.pendingTaskId) return live as T;
  if (live && liveMatchesPending && liveMatchesTask) return live as T;
  if (!input.streamSnapshotActive) {
    if (canSynthesizeRunningShell) {
      return {
        taskId: input.streamTaskId ?? null,
        prompt: pendingTrimmed || livePromptTrimmed || null,
        phase: 'streaming' as const,
        text: '',
        thinking: '',
        activity: 'Working...',
        activitySummary: null,
        activityEvents: null,
        plan: null,
        startedAt: null,
        completedAt: null,
        updatedAt: null,
        model: input.displayModel,
        effort: input.displayEffort,
        previewMeta: { lastEvent: 'Working...' },
        subAgents: null,
        generatingImages: 0,
        error: null,
      };
    }
    return null;
  }
  return {
    taskId: input.streamTaskId ?? null,
    prompt: pendingTrimmed || livePromptTrimmed || null,
    phase: 'streaming' as const,
    text: '',
    thinking: '',
    activity: canSynthesizeRunningShell ? 'Working...' : '',
    activitySummary: null,
    activityEvents: null,
    plan: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
    model: input.displayModel,
    effort: input.displayEffort,
    previewMeta: null,
    subAgents: null,
    generatingImages: 0,
    error: null,
  };
}

export function shouldSkipEmptyStreamingHandoff(input: {
  clearLiveStreamOnLoad: boolean;
  liveStreamTaskId: string | null;
  incomingTaskId: string | null;
  incomingText: string;
  pendingPrompt: string | null | undefined;
  liveStreamPrompt: string | null | undefined;
}): boolean {
  if (!input.clearLiveStreamOnLoad || !input.liveStreamTaskId) return false;
  if (input.liveStreamTaskId === input.incomingTaskId) return false;
  if (input.incomingText.trim()) return false;
  const pending = input.pendingPrompt?.trim() || '';
  const livePrompt = input.liveStreamPrompt?.trim() || '';
  if (pending && pending !== livePrompt) return false;
  return true;
}

function toTimeMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isStaleDoneSnapshotForPending(input: {
  phase: StreamPhase;
  pendingPrompt: string | null | undefined;
  pendingTaskId: string | null | undefined;
  pendingCreatedAt: string | null | undefined;
  snapshotTaskId: string | null | undefined;
  snapshotPrompt: string | null | undefined;
  snapshotCompletedAt: number | string | null | undefined;
  snapshotUpdatedAt: number | string | null | undefined;
}): boolean {
  if (input.phase !== 'done') return false;
  const pendingPrompt = input.pendingPrompt?.trim() || '';
  if (!pendingPrompt) return false;

  const snapshotTaskId = input.snapshotTaskId || null;
  const pendingTaskId = input.pendingTaskId || null;
  if (pendingTaskId && snapshotTaskId && pendingTaskId === snapshotTaskId) return false;

  const snapshotPrompt = input.snapshotPrompt?.trim() || '';
  if (snapshotPrompt && snapshotPrompt === pendingPrompt) return false;

  const pendingCreatedAt = toTimeMs(input.pendingCreatedAt);
  const snapshotCompletedAt = toTimeMs(input.snapshotCompletedAt);
  const snapshotUpdatedAt = toTimeMs(input.snapshotUpdatedAt);
  const snapshotAt = Math.max(snapshotCompletedAt ?? 0, snapshotUpdatedAt ?? 0) || null;
  if (pendingCreatedAt != null && snapshotAt != null && snapshotAt < pendingCreatedAt) return true;
  if (pendingTaskId && snapshotTaskId && pendingTaskId !== snapshotTaskId) return true;
  if (snapshotPrompt && snapshotPrompt !== pendingPrompt) return true;
  return false;
}

export function isLiveStreamActive(input: {
  streaming: boolean;
  streamPhase: StreamPhase;
  liveStreamPhase: 'streaming' | 'done' | null | undefined;
  pendingPrompt: string | null | undefined;
  pendingTaskId: string | null | undefined;
  pendingImageCount: number;
  sessionRunning?: boolean;
  streamStateChecked?: boolean;
}): boolean {
  if (input.sessionRunning && !input.streamStateChecked) return true;
  if (input.streaming || input.streamPhase === 'streaming' || input.streamPhase === 'queued') return true;
  if (input.liveStreamPhase === 'streaming') return true;
  const hasPendingContent = !!input.pendingPrompt?.trim() || input.pendingImageCount > 0;
  return hasPendingContent && !input.pendingTaskId && input.streamPhase !== 'done';
}

export function isStaleStreamingSnapshotAfterDone(input: {
  phase: StreamPhase;
  snapshotTaskId: string | null | undefined;
  doneHandoffTaskId: string | null | undefined;
}): boolean {
  return input.phase === 'streaming'
    && !!input.snapshotTaskId
    && !!input.doneHandoffTaskId
    && input.snapshotTaskId === input.doneHandoffTaskId;
}

export function liveStreamAlreadyInHistory(input: {
  hasEffectiveLiveStream: boolean;
  lastTurnUserText: string | null | undefined;
  lastAssistantHasFinalOutput: boolean;
  activeLivePrompt: string;
  effectiveTaskId: string | null | undefined;
  doneHandoffTaskId: string | null | undefined;
}): boolean {
  if (!input.hasEffectiveLiveStream || !input.lastAssistantHasFinalOutput) return false;
  const livePrompt = input.activeLivePrompt.trim();
  if (livePrompt) return (input.lastTurnUserText?.trim() || '') === livePrompt;
  return !!input.effectiveTaskId && input.effectiveTaskId === input.doneHandoffTaskId;
}
