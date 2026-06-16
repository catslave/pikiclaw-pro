import type { JiraRemoteUpdateRun, ProTask } from '../../types';

export type WorkItemRemoteBoundaryState =
  | 'local-only'
  | 'sync-needed'
  | 'remote-synced'
  | 'write-back-draft'
  | 'applying'
  | 'failed';

export type WorkItemRemoteBoundaryTone = 'ok' | 'warn' | 'err' | 'running' | 'idle';

export interface WorkItemRemoteBoundarySummary {
  state: WorkItemRemoteBoundaryState;
  label: string;
  detail: string;
  tone: WorkItemRemoteBoundaryTone;
  remoteKey: string;
  runCount: number;
  pendingRunCount: number;
  updatedAt: string | null;
  primaryRun: JiraRemoteUpdateRun | null;
}

const REVIEW_STATUS_RANK: Record<JiraRemoteUpdateRun['status'], number> = {
  failed: 0,
  applying: 1,
  draft: 2,
  applied: 3,
  cancelled: 4,
};

function parseTime(value?: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function newestFirst(a: JiraRemoteUpdateRun, b: JiraRemoteUpdateRun): number {
  return parseTime(b.updatedAt || b.completedAt || b.startedAt || b.createdAt)
    - parseTime(a.updatedAt || a.completedAt || a.startedAt || a.createdAt);
}

function reviewFirst(a: JiraRemoteUpdateRun, b: JiraRemoteUpdateRun): number {
  const leftRank = REVIEW_STATUS_RANK[a.status] ?? 99;
  const rightRank = REVIEW_STATUS_RANK[b.status] ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return newestFirst(a, b);
}

function fieldCount(run: JiraRemoteUpdateRun): string {
  const count = run.diff?.length || Object.keys(run.fields || {}).length;
  return `${count} field${count === 1 ? '' : 's'}`;
}

export function summarizeWorkItemRemoteBoundary(
  task: ProTask,
  runs: JiraRemoteUpdateRun[] = [],
): WorkItemRemoteBoundarySummary {
  const sortedRuns = [...runs].sort(reviewFirst);
  const primaryRun = sortedRuns.find(run => run.status === 'failed' || run.status === 'applying' || run.status === 'draft') || null;
  const pendingRunCount = sortedRuns.filter(run => run.status === 'failed' || run.status === 'applying' || run.status === 'draft').length;
  const latestRun = [...runs].sort(newestFirst)[0] || null;
  const remoteKey = task.jiraKey || task.origin?.key || '';

  if (primaryRun?.status === 'failed') {
    return {
      state: 'failed',
      label: 'Failed',
      detail: primaryRun.error || `Jira write-back failed for ${fieldCount(primaryRun)}. Review before retrying.`,
      tone: 'err',
      remoteKey,
      runCount: runs.length,
      pendingRunCount,
      updatedAt: primaryRun.updatedAt || primaryRun.completedAt || primaryRun.startedAt || primaryRun.createdAt || null,
      primaryRun,
    };
  }

  if (primaryRun?.status === 'applying') {
    return {
      state: 'applying',
      label: 'Applying',
      detail: `Jira write-back is applying ${fieldCount(primaryRun)}. Avoid starting another remote mutation until it settles.`,
      tone: 'running',
      remoteKey,
      runCount: runs.length,
      pendingRunCount,
      updatedAt: primaryRun.updatedAt || primaryRun.startedAt || primaryRun.createdAt || null,
      primaryRun,
    };
  }

  if (primaryRun?.status === 'draft') {
    return {
      state: 'write-back-draft',
      label: 'Write-back draft',
      detail: `A Jira update draft is waiting for review: ${fieldCount(primaryRun)} prepared, not applied remotely.`,
      tone: 'warn',
      remoteKey,
      runCount: runs.length,
      pendingRunCount,
      updatedAt: primaryRun.updatedAt || primaryRun.createdAt || null,
      primaryRun,
    };
  }

  if (!task.jiraKey) {
    return {
      state: 'local-only',
      label: 'Local only',
      detail: 'This Work Item has no remote Jira target. Actions stay inside Pikiclaw until a ticket is linked.',
      tone: 'idle',
      remoteKey: '',
      runCount: runs.length,
      pendingRunCount: 0,
      updatedAt: task.updatedAt || null,
      primaryRun: latestRun,
    };
  }

  if (!task.jiraFields?.updatedAt && !task.jiraFields?.raw) {
    return {
      state: 'sync-needed',
      label: 'Sync needed',
      detail: 'A Jira key is linked, but Pikiclaw has no remote snapshot yet. Sync before relying on assignee, status, or due date.',
      tone: 'warn',
      remoteKey,
      runCount: runs.length,
      pendingRunCount: 0,
      updatedAt: latestRun?.updatedAt || task.updatedAt || null,
      primaryRun: latestRun,
    };
  }

  return {
    state: 'remote-synced',
    label: 'Remote synced',
    detail: task.jiraFields?.status
      ? `Jira snapshot is available: ${task.jiraFields.status}${task.jiraFields.assignee ? ` · ${task.jiraFields.assignee}` : ''}.`
      : 'Jira snapshot is available. Remote mutations still require an explicit write-back draft.',
    tone: 'ok',
    remoteKey,
    runCount: runs.length,
    pendingRunCount: 0,
    updatedAt: task.jiraFields?.updatedAt || latestRun?.updatedAt || task.updatedAt || null,
    primaryRun: latestRun,
  };
}
