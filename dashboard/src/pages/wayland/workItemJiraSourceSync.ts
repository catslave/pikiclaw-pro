import type { JiraRemoteUpdateRun, ProTask } from '../../types';

export type WorkItemJiraSourceSyncTone = 'ok' | 'warn' | 'idle';

export interface WorkItemJiraSourceSyncSummary {
  hasAppliedHistory: boolean;
  needsSync: boolean;
  label: string;
  detail: string;
  tone: WorkItemJiraSourceSyncTone;
  latestAppliedRun: JiraRemoteUpdateRun | null;
  sourceUpdatedAt: string | null;
}

function parseTime(value?: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function runTime(run: JiraRemoteUpdateRun): number {
  return parseTime(run.completedAt)
    || parseTime(run.updatedAt)
    || parseTime(run.startedAt)
    || parseTime(run.createdAt);
}

export function summarizeWorkItemJiraSourceSync(
  task: ProTask,
  runs: JiraRemoteUpdateRun[] = [],
): WorkItemJiraSourceSyncSummary {
  const latestAppliedRun = [...runs]
    .filter(run => run.status === 'applied')
    .sort((a, b) => runTime(b) - runTime(a))[0] || null;
  const sourceUpdatedAt = task.jiraFields?.updatedAt || null;

  if (!latestAppliedRun) {
    return {
      hasAppliedHistory: false,
      needsSync: false,
      label: 'No applied write-back',
      detail: 'No Jira write-back has been applied yet.',
      tone: 'idle',
      latestAppliedRun: null,
      sourceUpdatedAt,
    };
  }

  const appliedAt = runTime(latestAppliedRun);
  const sourceAt = parseTime(sourceUpdatedAt);
  const needsSync = !sourceAt || sourceAt + 1000 < appliedAt;

  if (needsSync) {
    return {
      hasAppliedHistory: true,
      needsSync: true,
      label: 'Confirm source sync',
      detail: 'A Jira write-back was applied after the last known source snapshot. Sync Jira before trusting status, assignee, due date, or fix version.',
      tone: 'warn',
      latestAppliedRun,
      sourceUpdatedAt,
    };
  }

  return {
    hasAppliedHistory: true,
    needsSync: false,
    label: 'Source confirmed',
    detail: 'The Jira source snapshot is newer than the latest applied write-back.',
    tone: 'ok',
    latestAppliedRun,
    sourceUpdatedAt,
  };
}
