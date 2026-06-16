import type { JiraRemoteUpdateRun, ProTask } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';
import {
  summarizeWorkItemRemoteBoundary,
  type WorkItemRemoteBoundaryState,
} from './workItemRemoteBoundary';

export interface WorkItemJiraReviewCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  priority?: number;
  lanes?: WorkItemCommandLane[];
  keys: string[];
  tone: 'primary' | 'ok' | 'warn' | 'idle';
  keywords: string[];
}

export interface WorkItemJiraReviewCommandOptions {
  limit?: number;
}

const STATE_RANK: Record<WorkItemRemoteBoundaryState, number> = {
  failed: 0,
  'write-back-draft': 1,
  applying: 2,
  'sync-needed': 3,
  'remote-synced': 8,
  'local-only': 9,
};

function parseTime(value?: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function fieldLabel(run: JiraRemoteUpdateRun | null): string {
  if (!run) return '';
  const count = run.diff?.length || Object.keys(run.fields || {}).length;
  return `${count} field${count === 1 ? '' : 's'}`;
}

function fieldKeywords(run: JiraRemoteUpdateRun | null): string[] {
  if (!run) return [];
  return [
    run.status,
    run.remoteTool || '',
    run.error || '',
    ...Object.entries(run.fields || {}).flatMap(([field, value]) => [
      field,
      Array.isArray(value) ? value.join(' ') : String(value || ''),
    ]),
    ...(run.diff || []).flatMap(diff => [
      diff.field,
      Array.isArray(diff.from) ? diff.from.join(' ') : String(diff.from || ''),
      Array.isArray(diff.to) ? diff.to.join(' ') : String(diff.to || ''),
    ]),
  ].filter(Boolean);
}

function targetUrl(taskId: string, state: WorkItemRemoteBoundaryState, run: JiraRemoteUpdateRun | null): string {
  const params = new URLSearchParams();
  params.set('task', taskId);
  params.set('tab', 'source');
  if (state === 'sync-needed') params.set('source', 'ticket');
  if (run?.id) params.set('jiraRun', run.id);
  return `/work-items?${params.toString()}`;
}

function titlePrefix(state: WorkItemRemoteBoundaryState): string {
  if (state === 'failed') return 'Jira write-back failed';
  if (state === 'write-back-draft') return 'Review Jira write-back';
  if (state === 'applying') return 'Jira write-back applying';
  if (state === 'sync-needed') return 'Sync Jira source';
  return 'Jira remote boundary';
}

function keysFor(state: WorkItemRemoteBoundaryState): string[] {
  if (state === 'failed') return ['Failed', 'Retry'];
  if (state === 'write-back-draft') return ['Review', 'Draft'];
  if (state === 'applying') return ['Applying', 'Wait'];
  if (state === 'sync-needed') return ['Sync', 'Jira'];
  return ['Jira'];
}

function toneFor(state: WorkItemRemoteBoundaryState): WorkItemJiraReviewCommandItem['tone'] {
  if (state === 'failed' || state === 'write-back-draft' || state === 'sync-needed') return 'warn';
  if (state === 'applying') return 'primary';
  return 'idle';
}

function priorityFor(state: WorkItemRemoteBoundaryState): number {
  if (state === 'failed') return 48;
  if (state === 'write-back-draft') return 36;
  if (state === 'applying') return 24;
  if (state === 'sync-needed') return 16;
  return 0;
}

export function buildWorkItemJiraReviewCommandItems(
  tasks: ProTask[],
  runsByTask: Record<string, JiraRemoteUpdateRun[]> = {},
  options: WorkItemJiraReviewCommandOptions = {},
): WorkItemJiraReviewCommandItem[] {
  const limit = options.limit ?? 12;

  return tasks
    .filter(task => !!task.jiraKey)
    .map(task => {
      const runs = runsByTask[task.id] || [];
      const boundary = summarizeWorkItemRemoteBoundary(task, runs);
      if (
        boundary.state !== 'failed'
        && boundary.state !== 'write-back-draft'
        && boundary.state !== 'applying'
        && boundary.state !== 'sync-needed'
      ) return null;
      const run = boundary.primaryRun;
      const fields = fieldLabel(run);
      return {
        key: `jira-review:${run?.id || task.id}`,
        title: `${titlePrefix(boundary.state)}: ${task.title}`,
        detail: `${boundary.remoteKey || task.jiraKey || 'Jira'} · ${fields ? `${fields} · ` : ''}${boundary.detail}`,
        to: targetUrl(task.id, boundary.state, run),
        secondaryTo: task.jiraUrl || undefined,
        secondaryLabel: task.jiraUrl ? 'Open Jira' : undefined,
        priority: priorityFor(boundary.state),
        lanes: [
          commandLane('Source', 'Jira', 'source'),
          commandLane('Execution', boundary.state === 'failed' ? 'Failed' : boundary.state === 'write-back-draft' ? 'Review' : boundary.state === 'applying' ? 'Applying' : 'Sync', boundary.state === 'failed' || boundary.state === 'write-back-draft' || boundary.state === 'sync-needed' ? 'attention' : 'execution'),
        ],
        keys: keysFor(boundary.state),
        tone: toneFor(boundary.state),
        keywords: [
          'jira review',
          'jira write-back',
          'writeback',
          'write-back',
          'remote boundary',
          'remote sync',
          'sync needed',
          boundary.state,
          boundary.label,
          boundary.detail,
          task.id,
          task.title,
          task.jiraKey || '',
          task.jiraUrl || '',
          task.workdir || '',
          task.jiraFields?.status || '',
          task.jiraFields?.assignee || '',
          task.jiraFields?.priority || '',
          ...(task.jiraFields?.labels || []),
          ...fieldKeywords(run),
        ].filter(Boolean),
        sortRank: STATE_RANK[boundary.state] ?? 99,
        sortTime: parseTime(boundary.updatedAt || run?.updatedAt || task.updatedAt),
      };
    })
    .filter((item): item is WorkItemJiraReviewCommandItem & { sortRank: number; sortTime: number } => !!item)
    .sort((a, b) => a.sortRank - b.sortRank || b.sortTime - a.sortTime)
    .slice(0, limit)
    .map(({ sortRank: _sortRank, sortTime: _sortTime, ...item }) => item);
}
