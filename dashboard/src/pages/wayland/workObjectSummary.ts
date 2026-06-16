import type { ProTask } from '../../types';
import type { WorkItemJiraReviewRunMap } from './workItemJiraReview';
import type { WorkItemOperationalSummary, WorkItemOperationalTone } from './workItemOperationalState';
import { summarizeWorkItemOperationalState } from './workItemOperationalState';
import type { WorkItemRemoteBoundarySummary, WorkItemRemoteBoundaryTone } from './workItemRemoteBoundary';
import { summarizeWorkItemRemoteBoundary } from './workItemRemoteBoundary';
import type { WorkItemSourceHealthSummary, WorkItemSourceHealthTone } from './workItemSourceHealth';
import { summarizeWorkItemSourceHealth } from './workItemSourceHealth';

export type WorkObjectKind = 'automation-run' | 'inbox-capture' | 'jira-remote' | 'local-work';
export type WorkObjectTone = WorkItemOperationalTone | WorkItemRemoteBoundaryTone | WorkItemSourceHealthTone | 'default';

export type WorkObjectSummary = {
  kind: WorkObjectKind;
  identityLabel: string;
  boundaryLabel: string;
  evidenceLabel: string;
  actionLabel: string;
  actionDetail: string;
  primaryTone: WorkObjectTone;
  boundaryTone: WorkObjectTone;
  evidenceTone: WorkObjectTone;
  attentionRank: number;
  chips: Array<{
    key: string;
    label: string;
    detail: string;
    tone: WorkObjectTone;
  }>;
};

function taskKind(task: ProTask): WorkObjectKind {
  if (task.jiraKey || task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic') return 'jira-remote';
  if (task.kind === 'todo') return 'inbox-capture';
  if (task.kind === 'automation') return 'automation-run';
  return 'local-work';
}

function identityLabel(task: ProTask, kind: WorkObjectKind): string {
  if (kind === 'jira-remote') return task.jiraKey ? `Jira ${task.jiraKey}` : 'Jira work';
  if (kind === 'inbox-capture') return task.localKey ? `Inbox ${task.localKey}` : 'Inbox capture';
  if (kind === 'automation-run') return task.localKey ? `Automation ${task.localKey}` : 'Automation work';
  return task.localKey ? `Local ${task.localKey}` : 'Local work';
}

function attentionRank(input: {
  operational: WorkItemOperationalSummary;
  remoteBoundary: WorkItemRemoteBoundarySummary;
  sourceHealth: WorkItemSourceHealthSummary;
}): number {
  if (input.operational.stateTone === 'err' || input.remoteBoundary.tone === 'err') return 0;
  if (input.remoteBoundary.state === 'write-back-draft' || input.remoteBoundary.state === 'applying') return 1;
  if (input.operational.riskCount > 0) return 2;
  if (input.sourceHealth.tone === 'warn' || input.sourceHealth.stale) return 3;
  if (input.operational.stateTone === 'running') return 4;
  return 99;
}

export function buildWorkObjectSummary(input: {
  task: ProTask;
  operational: WorkItemOperationalSummary;
  remoteBoundary: WorkItemRemoteBoundarySummary;
  sourceHealth: WorkItemSourceHealthSummary;
  reviewCount?: number;
}): WorkObjectSummary {
  const { task, operational, remoteBoundary, sourceHealth, reviewCount = 0 } = input;
  const kind = taskKind(task);
  const chips: WorkObjectSummary['chips'] = [
    {
      key: 'boundary',
      label: remoteBoundary.label,
      detail: remoteBoundary.detail,
      tone: remoteBoundary.tone,
    },
    {
      key: 'evidence',
      label: sourceHealth.label,
      detail: sourceHealth.detail,
      tone: sourceHealth.tone,
    },
  ];

  if (reviewCount > 0) {
    chips.unshift({
      key: 'review',
      label: `${reviewCount} review${reviewCount === 1 ? '' : 's'}`,
      detail: 'Jira write-back needs review before remote state changes.',
      tone: 'warn',
    });
  }

  if (operational.riskCount > 0) {
    chips.unshift({
      key: 'risk',
      label: `${operational.riskCount} risk${operational.riskCount === 1 ? '' : 's'}`,
      detail: operational.guardrailLabel,
      tone: operational.stateTone,
    });
  }

  return {
    kind,
    identityLabel: identityLabel(task, kind),
    boundaryLabel: remoteBoundary.remoteKey || remoteBoundary.label,
    evidenceLabel: `${sourceHealth.evidenceCount} evidence`,
    actionLabel: operational.nextActionLabel,
    actionDetail: operational.nextActionDetail,
    primaryTone: operational.stateTone,
    boundaryTone: remoteBoundary.tone,
    evidenceTone: sourceHealth.tone,
    attentionRank: attentionRank({ operational, remoteBoundary, sourceHealth }),
    chips,
  };
}

function parseTime(value?: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function buildWorkObjectSummaryForTask(
  task: ProTask,
  jiraRunsByTask: WorkItemJiraReviewRunMap | Record<string, Parameters<typeof summarizeWorkItemRemoteBoundary>[1]> = {},
  nowInput: Date | number = new Date(),
): WorkObjectSummary {
  const runs = jiraRunsByTask[task.id] || [];
  return buildWorkObjectSummary({
    task,
    operational: summarizeWorkItemOperationalState(task, nowInput),
    remoteBoundary: summarizeWorkItemRemoteBoundary(task, runs),
    sourceHealth: summarizeWorkItemSourceHealth(task, nowInput),
    reviewCount: runs.filter(run => run.status === 'draft' || run.status === 'failed' || run.status === 'applying').length,
  });
}

export function compareWorkObjectsByAttention(
  a: ProTask,
  b: ProTask,
  jiraRunsByTask: WorkItemJiraReviewRunMap | Record<string, Parameters<typeof summarizeWorkItemRemoteBoundary>[1]> = {},
  nowInput: Date | number = new Date(),
): number {
  const left = buildWorkObjectSummaryForTask(a, jiraRunsByTask, nowInput);
  const right = buildWorkObjectSummaryForTask(b, jiraRunsByTask, nowInput);
  if (left.attentionRank !== right.attentionRank) return left.attentionRank - right.attentionRank;
  return parseTime(b.updatedAt) - parseTime(a.updatedAt);
}
