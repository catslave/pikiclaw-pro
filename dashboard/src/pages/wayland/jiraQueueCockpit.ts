import type { JiraRemoteUpdateRun, ProTask } from '../../types';
import { summarizeWorkItemJiraHistory } from './workItemJiraHistory';
import { summarizeWorkItemJiraSourceSync } from './workItemJiraSourceSync';
import { summarizeWorkItemRemoteBoundary } from './workItemRemoteBoundary';

export type JiraQueueCockpitTone = 'ok' | 'warn' | 'err' | 'running' | 'idle';
export type JiraQueueCockpitAction =
  | 'open-failed-run'
  | 'review-draft'
  | 'wait-applying'
  | 'sync-source'
  | 'sync-remote'
  | 'draft-update'
  | 'monitor';

export interface JiraQueueCockpitItem {
  task: ProTask;
  runs: JiraRemoteUpdateRun[];
  latestRun: JiraRemoteUpdateRun | null;
  primaryRun: JiraRemoteUpdateRun | null;
  title: string;
  label: string;
  detail: string;
  actionLabel: string;
  action: JiraQueueCockpitAction;
  tone: JiraQueueCockpitTone;
  updatedAt: string;
  chips: string[];
}

export interface BuildJiraQueueCockpitInput {
  tasks: ProTask[];
  runsByTask: Record<string, JiraRemoteUpdateRun[]>;
  limit?: number;
}

function time(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemRank(item: JiraQueueCockpitItem): number {
  if (item.tone === 'err') return 0;
  if (item.action === 'review-draft') return 1;
  if (item.tone === 'running') return 2;
  if (item.action === 'sync-source' || item.action === 'sync-remote') return 3;
  if (item.action === 'draft-update') return 4;
  if (item.tone === 'ok') return 5;
  return 6;
}

function latestRunTime(run: JiraRemoteUpdateRun | null): string | null {
  return run?.updatedAt || run?.completedAt || run?.startedAt || run?.createdAt || null;
}

function isJiraTask(task: ProTask): boolean {
  return !!task.jiraKey || task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic';
}

export function buildJiraQueueCockpitItems(input: BuildJiraQueueCockpitInput): JiraQueueCockpitItem[] {
  const limit = Math.max(1, input.limit || 6);
  return (input.tasks || [])
    .filter(isJiraTask)
    .map(task => {
      const runs = input.runsByTask[task.id] || [];
      const history = summarizeWorkItemJiraHistory(runs);
      const boundary = summarizeWorkItemRemoteBoundary(task, runs);
      const sourceSync = summarizeWorkItemJiraSourceSync(task, runs);
      const updatedAt = latestRunTime(history.latestRun)
        || latestRunTime(boundary.primaryRun)
        || boundary.updatedAt
        || task.jiraFields?.updatedAt
        || task.updatedAt;
      const baseChips = [
        task.jiraKey || task.localKey || 'Jira',
        `${history.appliedCount} applied`,
        `${history.failedCount} failed`,
        `${history.draftCount + history.applyingCount} pending`,
      ];

      if (boundary.state === 'failed') {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: boundary.primaryRun,
          title: task.title,
          label: 'Write-back failed',
          detail: boundary.detail,
          actionLabel: 'Open failed run',
          action: 'open-failed-run' as const,
          tone: 'err' as const,
          updatedAt,
          chips: baseChips,
        };
      }

      if (boundary.state === 'write-back-draft') {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: boundary.primaryRun,
          title: task.title,
          label: 'Draft ready',
          detail: boundary.detail,
          actionLabel: 'Review draft',
          action: 'review-draft' as const,
          tone: 'warn' as const,
          updatedAt,
          chips: baseChips,
        };
      }

      if (boundary.state === 'applying') {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: boundary.primaryRun,
          title: task.title,
          label: 'Applying',
          detail: boundary.detail,
          actionLabel: 'Wait for apply',
          action: 'wait-applying' as const,
          tone: 'running' as const,
          updatedAt,
          chips: baseChips,
        };
      }

      if (sourceSync.needsSync) {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: sourceSync.latestAppliedRun,
          title: task.title,
          label: 'Source stale',
          detail: sourceSync.detail,
          actionLabel: 'Sync source',
          action: 'sync-source' as const,
          tone: 'warn' as const,
          updatedAt,
          chips: [...baseChips, 'source stale'],
        };
      }

      if (boundary.state === 'sync-needed') {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: boundary.primaryRun,
          title: task.title,
          label: 'Remote snapshot missing',
          detail: boundary.detail,
          actionLabel: 'Sync remote',
          action: 'sync-remote' as const,
          tone: 'warn' as const,
          updatedAt,
          chips: [...baseChips, 'needs snapshot'],
        };
      }

      if (boundary.state === 'remote-synced' && runs.length === 0) {
        return {
          task,
          runs,
          latestRun: history.latestRun,
          primaryRun: boundary.primaryRun,
          title: task.title,
          label: 'Ready to draft',
          detail: boundary.detail,
          actionLabel: 'Draft update',
          action: 'draft-update' as const,
          tone: 'ok' as const,
          updatedAt,
          chips: [...baseChips, 'snapshot ready'],
        };
      }

      return {
        task,
        runs,
        latestRun: history.latestRun,
        primaryRun: boundary.primaryRun || history.latestRun,
        title: task.title,
        label: history.latestLabel,
        detail: sourceSync.hasAppliedHistory ? sourceSync.detail : history.latestDetail,
        actionLabel: sourceSync.hasAppliedHistory ? sourceSync.label : 'Monitor',
        action: 'monitor' as const,
        tone: sourceSync.tone === 'ok' || history.tone === 'ok' ? 'ok' as const : 'idle' as const,
        updatedAt,
        chips: baseChips,
      };
    })
    .filter(item => item.action !== 'monitor' || item.runs.length > 0)
    .sort((a, b) => itemRank(a) - itemRank(b) || time(b.updatedAt) - time(a.updatedAt))
    .slice(0, limit);
}
