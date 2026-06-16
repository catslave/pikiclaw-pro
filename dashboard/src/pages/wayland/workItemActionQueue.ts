import type { DailyItem, JiraRemoteUpdateRun, NotePage, ProTask, TodoItem } from '../../types';
import { buildWorkItemDailyCommandItems } from './workItemDailyCommand';
import { buildWorkItemDeliverableCommandItems } from './workItemDeliverableCommand';
import { buildWorkItemInboxCommandItems } from './workItemInboxCommand';
import { buildWorkItemJiraReviewCommandItems } from './workItemJiraReviewCommand';
import { buildWorkItemNoteCommandItems } from './workItemNoteCommand';
import { compareWorkItemsBySourceRefresh, summarizeWorkItemSourceHealth, workItemSourceNeedsRefresh } from './workItemSourceHealth';
import type { WorkItemCommandLane } from './workItemCommandLanes';

export type WorkItemActionQueueKind =
  | 'jira'
  | 'source'
  | 'deliverable'
  | 'inbox'
  | 'daily'
  | 'note';

export type WorkItemActionQueueTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkItemActionQueueItem {
  key: string;
  kind: WorkItemActionQueueKind;
  sourceLabel: string;
  actionLabel: string;
  title: string;
  detail: string;
  to: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  priority: number;
  tone: WorkItemActionQueueTone;
  keys: string[];
  lanes?: WorkItemCommandLane[];
}

export interface BuildWorkItemActionQueueInput {
  tasks: ProTask[];
  todos: TodoItem[];
  dailyItems: DailyItem[];
  notePages: NotePage[];
  jiraRunsByTask?: Record<string, JiraRemoteUpdateRun[]>;
  todayDate: string;
  limit?: number;
}

export type WorkItemActionQueueFocusCommand = 'next' | 'previous' | 'first' | 'last';

function workItemDetailUrl(taskId: string, tab: string): string {
  const params = new URLSearchParams();
  params.set('task', taskId);
  params.set('tab', tab);
  return `/work-items?${params.toString()}`;
}

function sourceRefreshItems(tasks: ProTask[]): WorkItemActionQueueItem[] {
  return tasks
    .filter(workItemSourceNeedsRefresh)
    .sort((a, b) => compareWorkItemsBySourceRefresh(a, b))
    .slice(0, 12)
    .map(task => {
      const sourceHealth = summarizeWorkItemSourceHealth(task);
      return {
        key: `source-refresh:${task.id}`,
        kind: 'source' as const,
        sourceLabel: task.jiraKey ? 'Jira source' : task.kind === 'todo' ? 'Todo source' : 'Source',
        actionLabel: task.jiraKey ? 'Sync / repair' : 'Attach source',
        title: `Repair source: ${task.title}`,
        detail: `${sourceHealth.label} · ${sourceHealth.detail}`,
        to: workItemDetailUrl(task.id, 'source'),
        priority: 34,
        tone: 'warn' as const,
        keys: ['Source', 'Repair'],
      };
    });
}

function rankTone(tone: WorkItemActionQueueTone): number {
  if (tone === 'warn') return 0;
  if (tone === 'primary') return 1;
  if (tone === 'ok') return 2;
  return 3;
}

function dedupeActionQueue(items: WorkItemActionQueueItem[]): WorkItemActionQueueItem[] {
  const seen = new Set<string>();
  const result: WorkItemActionQueueItem[] = [];
  for (const item of items) {
    const taskKey = item.to.match(/[?&]task=([^&]+)/)?.[1];
    const dedupeKey = taskKey ? `task:${taskKey}` : item.key;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(item);
  }
  return result;
}

function actionQueueRank(a: WorkItemActionQueueItem, b: WorkItemActionQueueItem): number {
  return b.priority - a.priority
    || rankTone(a.tone) - rankTone(b.tone)
    || a.sourceLabel.localeCompare(b.sourceLabel)
    || a.title.localeCompare(b.title);
}

function isCriticalActionQueueItem(item: WorkItemActionQueueItem): boolean {
  return item.priority >= 40 || (item.kind === 'jira' && item.tone === 'warn');
}

export function balanceWorkItemActionQueueItems(
  rankedItems: WorkItemActionQueueItem[],
  limit: number,
): WorkItemActionQueueItem[] {
  const safeLimit = Math.max(1, limit);
  const selected: WorkItemActionQueueItem[] = [];
  const selectedKeys = new Set<string>();
  const selectedKinds = new Set<WorkItemActionQueueKind>();

  const add = (item: WorkItemActionQueueItem): boolean => {
    if (selected.length >= safeLimit || selectedKeys.has(item.key)) return false;
    selected.push(item);
    selectedKeys.add(item.key);
    selectedKinds.add(item.kind);
    return true;
  };

  for (const item of rankedItems) {
    if (isCriticalActionQueueItem(item)) add(item);
    if (selected.length >= safeLimit) return selected;
  }

  for (const item of rankedItems) {
    if (!selectedKinds.has(item.kind)) add(item);
    if (selected.length >= safeLimit) return selected;
  }

  for (const item of rankedItems) {
    add(item);
    if (selected.length >= safeLimit) return selected;
  }

  return selected;
}

export function buildWorkItemActionQueueItems(input: BuildWorkItemActionQueueInput): WorkItemActionQueueItem[] {
  const limit = Math.max(1, input.limit || 10);
  const jiraRunsByTask = input.jiraRunsByTask || {};
  const items: WorkItemActionQueueItem[] = [
    ...buildWorkItemJiraReviewCommandItems(input.tasks, jiraRunsByTask, { limit: 12 }).map(item => ({
      ...item,
      kind: 'jira' as const,
      sourceLabel: 'Jira',
      actionLabel: item.keys[0] || 'Review',
      priority: item.priority || 0,
    })),
    ...sourceRefreshItems(input.tasks),
    ...buildWorkItemDeliverableCommandItems(input.tasks, { limit: 12 }).map(item => ({
      ...item,
      kind: 'deliverable' as const,
      sourceLabel: 'Output',
      actionLabel: item.keys[0] || 'Open',
      priority: item.priority || 0,
    })),
    ...buildWorkItemInboxCommandItems(input.todos, { limit: 12 }).map(item => ({
      ...item,
      kind: 'inbox' as const,
      sourceLabel: 'Inbox',
      actionLabel: item.keys[0] || 'Promote',
      priority: item.priority || 0,
    })),
    ...buildWorkItemDailyCommandItems(input.dailyItems, { limit: 12, todos: input.todos, tasks: input.tasks }).map(item => ({
      ...item,
      kind: 'daily' as const,
      sourceLabel: 'Daily',
      actionLabel: item.keys[0] || 'Plan',
      priority: item.priority || 0,
    })),
    ...buildWorkItemNoteCommandItems(input.notePages, { todayDate: input.todayDate, limit: 12 }).map(item => ({
      ...item,
      kind: 'note' as const,
      sourceLabel: 'Notes',
      actionLabel: item.keys[0] || 'Promote',
      priority: item.tone === 'primary' ? 18 : item.tone === 'ok' ? 12 : 4,
    })),
  ];

  const ranked = dedupeActionQueue(items).sort(actionQueueRank);
  return balanceWorkItemActionQueueItems(ranked, limit);
}

export function nextWorkItemActionQueueFocusIndex(
  currentIndex: number,
  count: number,
  command: WorkItemActionQueueFocusCommand,
): number {
  if (count <= 0) return -1;
  if (command === 'first') return 0;
  if (command === 'last') return count - 1;
  const normalized = currentIndex >= 0 && currentIndex < count ? currentIndex : command === 'previous' ? 0 : count - 1;
  if (command === 'previous') return (normalized - 1 + count) % count;
  return (normalized + 1) % count;
}
