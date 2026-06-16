import { describe, expect, it } from 'vitest';
import type { DailyItem, JiraRemoteUpdateRun, NotePage, ProTask, TodoItem } from '../dashboard/src/types';
import {
  balanceWorkItemActionQueueItems,
  buildWorkItemActionQueueItems,
  nextWorkItemActionQueueFocusIndex,
  type WorkItemActionQueueItem,
  type WorkItemActionQueueKind,
} from '../dashboard/src/pages/wayland/workItemActionQueue';

const now = '2026-06-16T00:00:00.000Z';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    localKey: input.localKey || 'PCL-1',
    title: input.title || 'Work item',
    kind: input.kind || 'manual',
    status: input.status || 'backlog',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Inbox capture',
    status: input.status || 'open',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function daily(input: Partial<DailyItem> = {}): DailyItem {
  return {
    id: input.id || 'daily-1',
    date: input.date || '2026-06-16',
    title: input.title || 'Daily item',
    status: input.status || 'open',
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function note(input: Partial<NotePage> = {}): NotePage {
  return {
    id: input.id || 'note-1',
    kind: input.kind || 'daily',
    title: input.title || 'Daily note',
    date: input.date || '2026-06-16',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    deletedAt: null,
    parentId: input.parentId,
    ...input,
  };
}

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    jiraKey: 'PCL-9',
    fields: {},
    diff: [],
    createdAt: now,
    updatedAt: now,
    events: [],
    ...input,
  };
}

function queueItem(
  kind: WorkItemActionQueueKind,
  priority: number,
  key: string,
  input: Partial<WorkItemActionQueueItem> = {},
): WorkItemActionQueueItem {
  return {
    key,
    kind,
    sourceLabel: kind,
    actionLabel: 'Open',
    title: key,
    detail: 'Detail',
    to: `/work-items?item=${key}`,
    priority,
    tone: 'primary',
    keys: ['Open'],
    ...input,
  };
}

describe('Wayland Work Item action queue', () => {
  it('mixes native Pikiclaw sources into one prioritized command queue', () => {
    const jiraTask = task({
      id: 'jira-task',
      kind: 'jira-ticket',
      title: 'Review failed Jira update',
      jiraKey: 'PCL-9',
      jiraUrl: 'https://jira.example/browse/PCL-9',
    });
    const deliverableTask = task({
      id: 'deliverable-task',
      title: 'Review generated report',
      outputs: [{
        id: 'out-1',
        kind: 'file',
        title: 'Report',
        path: '/tmp/report.md',
        createdAt: now,
      }],
    });

    const items = buildWorkItemActionQueueItems({
      tasks: [deliverableTask, jiraTask],
      todos: [todo({ id: 'todo-rich', title: 'Captured bug', body: 'Needs follow-up', source: { type: 'chat-selection', quote: 'Bug note' } })],
      dailyItems: [daily({ id: 'daily-plan', title: 'Plan refactor' })],
      notePages: [note({ id: 'note-today', title: 'Today notes' })],
      jiraRunsByTask: {
        'jira-task': [run({ id: 'run-failed', taskId: 'jira-task', status: 'failed', error: 'Permission denied' })],
      },
      todayDate: '2026-06-16',
      limit: 5,
    });

    expect(items.map(item => [item.kind, item.actionLabel])).toEqual([
      ['jira', 'Failed'],
      ['deliverable', 'Ready'],
      ['note', 'Today'],
      ['inbox', 'Promote'],
      ['daily', 'Plan'],
    ]);
    expect(items[0]).toMatchObject({
      sourceLabel: 'Jira',
      tone: 'warn',
      secondaryLabel: 'Open Jira',
    });
  });

  it('surfaces source repair before ordinary intake', () => {
    const thinTodoTask = task({
      id: 'thin-task',
      kind: 'todo',
      title: 'Thin promoted todo',
    });

    const items = buildWorkItemActionQueueItems({
      tasks: [thinTodoTask],
      todos: [todo({ id: 'plain', title: 'Plain inbox' })],
      dailyItems: [],
      notePages: [],
      todayDate: '2026-06-16',
    });

    expect(items[0]).toMatchObject({
      key: 'source-refresh:thin-task',
      kind: 'source',
      actionLabel: 'Attach source',
      tone: 'warn',
    });
    expect(items[0].to).toBe('/work-items?task=thin-task&tab=source');
  });

  it('respects the requested limit after ranking', () => {
    const items = buildWorkItemActionQueueItems({
      tasks: [],
      todos: [
        todo({ id: 'one', title: 'One' }),
        todo({ id: 'two', title: 'Two' }),
        todo({ id: 'three', title: 'Three' }),
      ],
      dailyItems: [daily({ id: 'daily' })],
      notePages: [note({ id: 'note' })],
      todayDate: '2026-06-16',
      limit: 2,
    });

    expect(items).toHaveLength(2);
  });

  it('balances the first screen across work source types after priority ranking', () => {
    const items = balanceWorkItemActionQueueItems([
      queueItem('source', 34, 'source-1', { tone: 'warn' }),
      queueItem('deliverable', 32, 'deliverable-1'),
      queueItem('deliverable', 32, 'deliverable-2'),
      queueItem('deliverable', 32, 'deliverable-3'),
      queueItem('note', 18, 'note-1'),
      queueItem('inbox', 12, 'inbox-1'),
      queueItem('daily', 0, 'daily-1', { tone: 'idle' }),
    ], 4);

    expect(items.map(item => item.kind)).toEqual(['source', 'deliverable', 'note', 'inbox']);
  });

  it('keeps critical Jira review items before source-type balancing', () => {
    const items = balanceWorkItemActionQueueItems([
      queueItem('jira', 48, 'jira-1', { tone: 'warn' }),
      queueItem('jira', 48, 'jira-2', { tone: 'warn' }),
      queueItem('source', 34, 'source-1', { tone: 'warn' }),
      queueItem('deliverable', 32, 'deliverable-1'),
      queueItem('inbox', 12, 'inbox-1'),
    ], 4);

    expect(items.map(item => item.kind)).toEqual(['jira', 'jira', 'source', 'deliverable']);
  });

  it('keeps local deliverable file targets as secondary actions', () => {
    const items = buildWorkItemActionQueueItems({
      tasks: [
        task({
          id: 'file-output',
          title: 'Open local report',
          outputs: [{
            id: 'out-file',
            kind: 'file',
            title: 'Local report',
            path: '/Users/michael.yang/report.md',
            createdAt: now,
          }],
        }),
      ],
      todos: [],
      dailyItems: [],
      notePages: [],
      todayDate: '2026-06-16',
    });

    expect(items[0]).toMatchObject({
      kind: 'deliverable',
      secondaryTo: '/Users/michael.yang/report.md',
      secondaryLabel: 'Open file',
    });
  });

  it('moves keyboard focus through primary and secondary queue controls predictably', () => {
    expect(nextWorkItemActionQueueFocusIndex(0, 4, 'next')).toBe(1);
    expect(nextWorkItemActionQueueFocusIndex(3, 4, 'next')).toBe(0);
    expect(nextWorkItemActionQueueFocusIndex(0, 4, 'previous')).toBe(3);
    expect(nextWorkItemActionQueueFocusIndex(2, 4, 'first')).toBe(0);
    expect(nextWorkItemActionQueueFocusIndex(2, 4, 'last')).toBe(3);
    expect(nextWorkItemActionQueueFocusIndex(-1, 4, 'next')).toBe(0);
    expect(nextWorkItemActionQueueFocusIndex(-1, 4, 'previous')).toBe(3);
    expect(nextWorkItemActionQueueFocusIndex(0, 0, 'next')).toBe(-1);
  });
});
