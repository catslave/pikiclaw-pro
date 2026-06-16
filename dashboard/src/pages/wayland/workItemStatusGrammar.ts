import type { ProTask } from '../../types';
import type { WorkItemOperationalSummary, WorkItemOperationalTone } from './workItemOperationalState';
import type { WorkItemRemoteBoundarySummary, WorkItemRemoteBoundaryTone } from './workItemRemoteBoundary';
import type { WorkItemSourceHealthSummary, WorkItemSourceHealthTone } from './workItemSourceHealth';

export type WorkItemStatusTone = WorkItemOperationalTone | WorkItemSourceHealthTone | WorkItemRemoteBoundaryTone | 'default';

export type WorkItemStatusChip = {
  key: string;
  label: string;
  detail?: string;
  tone: WorkItemStatusTone;
};

export type WorkItemStatusGrammar = {
  primary: WorkItemStatusChip;
  secondary: WorkItemStatusChip[];
  hiddenCount: number;
  allSignals: WorkItemStatusChip[];
};

export type WorkItemStatusGrammarInput = {
  task: ProTask;
  operational: WorkItemOperationalSummary;
  sourceHealth: WorkItemSourceHealthSummary;
  remoteBoundary: WorkItemRemoteBoundarySummary;
  reviewCount?: number;
  attention?: boolean;
  maxSecondary?: number;
};

function remoteNeedsAttention(remoteBoundary: WorkItemRemoteBoundarySummary): boolean {
  return remoteBoundary.state === 'write-back-draft'
    || remoteBoundary.state === 'applying'
    || remoteBoundary.state === 'failed';
}

function sourceNeedsAttention(sourceHealth: WorkItemSourceHealthSummary): boolean {
  return sourceHealth.stale || sourceHealth.tone === 'warn';
}

export function buildWorkItemStatusGrammar(input: WorkItemStatusGrammarInput): WorkItemStatusGrammar {
  const { task, operational, sourceHealth, remoteBoundary, maxSecondary = 2 } = input;
  const signals: WorkItemStatusChip[] = [];

  if (remoteNeedsAttention(remoteBoundary)) {
    signals.push({
      key: 'remote',
      label: remoteBoundary.label,
      detail: remoteBoundary.detail,
      tone: remoteBoundary.tone,
    });
  }

  if ((input.reviewCount || 0) > 0) {
    signals.push({
      key: 'review',
      label: `${input.reviewCount} review${input.reviewCount === 1 ? '' : 's'}`,
      detail: 'Jira write-back needs review.',
      tone: 'warn',
    });
  }

  if (sourceNeedsAttention(sourceHealth)) {
    signals.push({
      key: 'source',
      label: sourceHealth.label,
      detail: sourceHealth.detail,
      tone: sourceHealth.tone,
    });
  }

  if (input.attention && signals.length === 0) {
    signals.push({
      key: 'attention',
      label: 'Attention',
      detail: 'This Work Item has a blocked, waiting, failed, overdue, or stale signal.',
      tone: 'warn',
    });
  }

  if (task.stageRuns.some(run => run.status === 'running' || run.status === 'queued')) {
    signals.push({
      key: 'running',
      label: 'Running',
      detail: 'An execution run is active.',
      tone: 'running',
    });
  }

  const deduped = signals.filter((signal, index) => signals.findIndex(item => item.key === signal.key) === index);
  const visibleCount = Math.max(0, maxSecondary);

  return {
    primary: {
      key: 'primary',
      label: operational.stateLabel || task.status,
      detail: operational.nextActionDetail,
      tone: operational.stateTone,
    },
    secondary: deduped.slice(0, visibleCount),
    hiddenCount: Math.max(0, deduped.length - visibleCount),
    allSignals: deduped,
  };
}
