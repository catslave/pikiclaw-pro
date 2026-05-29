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
  if (live && liveMatchesPending && liveMatchesTask) return live as T;
  if (!input.streamSnapshotActive) return null;
  return {
    taskId: input.streamTaskId ?? null,
    prompt: pendingTrimmed || livePromptTrimmed || null,
    phase: 'streaming' as const,
    text: '',
    thinking: '',
    activity: '',
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
}): boolean {
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
