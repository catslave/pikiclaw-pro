import type { JiraRemoteUpdateRun } from '../../types';

export type WorkItemJiraHistoryTone = 'ok' | 'warn' | 'err' | 'running' | 'idle';

export interface WorkItemJiraHistorySummary {
  latestRun: JiraRemoteUpdateRun | null;
  latestLabel: string;
  latestDetail: string;
  tone: WorkItemJiraHistoryTone;
  appliedCount: number;
  failedCount: number;
  draftCount: number;
  applyingCount: number;
  cancelledCount: number;
  nextAction: string;
}

function parseTime(value?: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function runTime(run: JiraRemoteUpdateRun): number {
  return parseTime(run.updatedAt)
    || parseTime(run.completedAt)
    || parseTime(run.startedAt)
    || parseTime(run.createdAt);
}

function fieldCount(run: JiraRemoteUpdateRun | null): string {
  const count = run ? (run.diff?.length || Object.keys(run.fields || {}).length) : 0;
  return `${count} field${count === 1 ? '' : 's'}`;
}

export function summarizeWorkItemJiraHistory(runs: JiraRemoteUpdateRun[]): WorkItemJiraHistorySummary {
  const latestRun = [...runs].sort((a, b) => runTime(b) - runTime(a))[0] || null;
  const appliedCount = runs.filter(run => run.status === 'applied').length;
  const failedCount = runs.filter(run => run.status === 'failed').length;
  const draftCount = runs.filter(run => run.status === 'draft').length;
  const applyingCount = runs.filter(run => run.status === 'applying').length;
  const cancelledCount = runs.filter(run => run.status === 'cancelled').length;

  if (!latestRun) {
    return {
      latestRun: null,
      latestLabel: 'No history',
      latestDetail: 'No Jira write-back has been prepared for this Work Item yet.',
      tone: 'idle',
      appliedCount,
      failedCount,
      draftCount,
      applyingCount,
      cancelledCount,
      nextAction: 'Draft a reviewed update before touching remote Jira.',
    };
  }

  if (failedCount > 0) {
    const failed = [...runs].filter(run => run.status === 'failed').sort((a, b) => runTime(b) - runTime(a))[0] || latestRun;
    return {
      latestRun,
      latestLabel: 'Failure needs review',
      latestDetail: failed.error || `Latest failed write-back touched ${fieldCount(failed)}. Inspect Jira before retrying.`,
      tone: 'err',
      appliedCount,
      failedCount,
      draftCount,
      applyingCount,
      cancelledCount,
      nextAction: 'Open the failed run, compare Jira source state, then retry or cancel the draft.',
    };
  }

  if (applyingCount > 0) {
    return {
      latestRun,
      latestLabel: 'Applying',
      latestDetail: `A write-back is currently applying ${fieldCount(latestRun)}.`,
      tone: 'running',
      appliedCount,
      failedCount,
      draftCount,
      applyingCount,
      cancelledCount,
      nextAction: 'Wait for the remote mutation to settle before creating another Jira update.',
    };
  }

  if (draftCount > 0) {
    return {
      latestRun,
      latestLabel: 'Draft ready',
      latestDetail: `A reviewed Jira draft is waiting with ${fieldCount(latestRun)}.`,
      tone: 'warn',
      appliedCount,
      failedCount,
      draftCount,
      applyingCount,
      cancelledCount,
      nextAction: 'Apply only after confirming the diff against source evidence.',
    };
  }

  if (latestRun.status === 'applied') {
    return {
      latestRun,
      latestLabel: 'Last applied',
      latestDetail: `Latest write-back applied ${fieldCount(latestRun)} to remote Jira.`,
      tone: 'ok',
      appliedCount,
      failedCount,
      draftCount,
      applyingCount,
      cancelledCount,
      nextAction: 'Use Jira source sync to confirm the remote snapshot after apply.',
    };
  }

  return {
    latestRun,
    latestLabel: 'No active write-back',
    latestDetail: cancelledCount
      ? 'Recent Jira drafts were cancelled before touching remote Jira.'
      : 'No Jira write-back is currently active.',
    tone: 'idle',
    appliedCount,
    failedCount,
    draftCount,
    applyingCount,
    cancelledCount,
    nextAction: 'Create a new draft only when the local execution state is ready.',
  };
}
