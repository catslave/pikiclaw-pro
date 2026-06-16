import type { WorkflowRunRecord } from '../../types';

export type WorkflowRunOperationalSummary = {
  doneSteps: number;
  remainingSteps: number;
  blockedSteps: number;
  pendingAskCount: number;
  workerRunningCount: number;
  workerAttentionCount: number;
  elapsedLabel: string;
  etaLabel: string;
  updatedLabel: string;
  stateLabel: string;
  stateTone: 'primary' | 'warn' | 'ok' | 'muted';
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function shortDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE_MS) return '<1m';
  if (safe < HOUR_MS) return `${Math.round(safe / MINUTE_MS)}m`;
  const hours = Math.floor(safe / HOUR_MS);
  const minutes = Math.round((safe % HOUR_MS) / MINUTE_MS);
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function statusFromSteps(run: WorkflowRunRecord, status: WorkflowRunRecord['steps'][number]['status']): number {
  return run.steps.filter(step => step.status === status).length;
}

export function summarizeWorkflowRunOperationalState(
  run: WorkflowRunRecord,
  nowInput: Date | number = new Date(),
): WorkflowRunOperationalSummary {
  const now = typeof nowInput === 'number' ? nowInput : nowInput.getTime();
  const startedAt = parseTime(run.createdAt) ?? now;
  const completedAt = parseTime(run.completedAt);
  const updatedAt = parseTime(run.updatedAt) ?? startedAt;
  const endTime = completedAt ?? now;
  const doneSteps = run.status === 'done'
    ? Math.max(run.totalSteps, statusFromSteps(run, 'done'))
    : statusFromSteps(run, 'done');
  const remainingSteps = Math.max(0, run.totalSteps - doneSteps);
  const blockedSteps = statusFromSteps(run, 'blocked');
  const pendingAskCount = (run.asks || []).filter(ask => ask.status === 'pending').length;
  const workerRunningCount = run.steps.filter(step => step.autonomousRun?.state === 'running').length;
  const workerAttentionCount = run.steps.filter(step => {
    const state = step.autonomousRun?.state;
    return state === 'failed' || state === 'stalled';
  }).length;
  const elapsedMs = Math.max(0, endTime - startedAt);

  let etaLabel = 'ETA pending';
  if (run.status === 'done') {
    etaLabel = 'Complete';
  } else if (pendingAskCount || blockedSteps) {
    etaLabel = 'Waiting on input';
  } else if (doneSteps > 0 && remainingSteps > 0) {
    etaLabel = `~${shortDuration((elapsedMs / doneSteps) * remainingSteps)} left`;
  } else if (workerRunningCount > 0) {
    etaLabel = 'Worker active';
  }

  let stateLabel = 'Running';
  let stateTone: WorkflowRunOperationalSummary['stateTone'] = 'primary';
  if (run.status === 'done') {
    stateLabel = 'Reviewable';
    stateTone = 'ok';
  } else if (pendingAskCount > 0) {
    stateLabel = 'Needs answer';
    stateTone = 'warn';
  } else if (blockedSteps > 0 || run.status === 'blocked' || workerAttentionCount > 0) {
    stateLabel = 'Needs review';
    stateTone = 'warn';
  } else if (!run.workdir || (!run.sessionId && !run.sessionKey)) {
    stateLabel = 'Detached';
    stateTone = 'muted';
  }

  return {
    doneSteps,
    remainingSteps,
    blockedSteps,
    pendingAskCount,
    workerRunningCount,
    workerAttentionCount,
    elapsedLabel: shortDuration(elapsedMs),
    etaLabel,
    updatedLabel: `${shortDuration(Math.max(0, now - updatedAt))} ago`,
    stateLabel,
    stateTone,
  };
}
