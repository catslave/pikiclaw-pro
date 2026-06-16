import { describe, expect, it } from 'vitest';
import type { DailyItem, ProTask, TodoItem } from '../dashboard/src/types';
import { buildWorkItemDailyCommandItems } from '../dashboard/src/pages/wayland/workItemDailyCommand';

const now = '2026-06-16T00:00:00.000Z';

function daily(input: Partial<DailyItem> = {}): DailyItem {
  return {
    id: input.id || 'daily-1',
    date: input.date || '2026-06-16',
    title: input.title || 'Review today plan',
    status: input.status || 'open',
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Source todo',
    status: input.status || 'open',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Source task',
    kind: input.kind || 'manual',
    status: input.status || 'coding',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

describe('Wayland Work Item daily command items', () => {
  it('builds a deep-linked command for an open daily plan item', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({
        id: 'daily-plan',
        title: 'Review today command surface',
        sourceTodoId: 'todo-123',
      }),
    ], {
      todos: [
        todo({
          id: 'todo-123',
          linkedChat: {
            workdir: '/repo/pikiclaw',
            agent: 'codex',
            sessionId: 'linked-session',
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'daily:daily-plan',
      title: 'Daily plan: Review today command surface',
      detail: '2026-06-16 · From inbox · todo-123',
      to: '/work-items?source=manual&date=2026-06-16&daily=daily-plan',
      secondaryLabel: 'Open linked chat',
      priority: 30,
      lanes: [
        { label: 'Source', value: 'Inbox', tone: 'source' },
        { label: 'Execution', value: 'Plan', tone: 'execution' },
      ],
      keys: ['Plan', 'Inbox'],
      tone: 'ok',
    });
    expect(items[0].secondaryTo).toContain('/conversations/session?');
    expect(items[0].secondaryTo).toContain('workdir=%2Frepo%2Fpikiclaw');
    expect(items[0].secondaryTo).toContain('agent=codex');
    expect(items[0].secondaryTo).toContain('session=linked-session');
    expect(items[0].keywords).toContain('todo-123');
  });

  it('falls back to source todo intake when the todo cannot be resolved', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({ id: 'daily-todo', title: 'Plan unresolved todo', sourceTodoId: 'todo-missing' }),
    ]);

    expect(items[0]).toMatchObject({
      secondaryTo: '/work-items?source=inbox&todo=todo-missing',
      secondaryLabel: 'Open source todo',
      priority: 16,
    });
  });

  it('links source work item plans back to the source task', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({ id: 'daily-work', title: 'Follow source task', sourceTaskId: 'task-42' }),
    ], {
      tasks: [task({ id: 'task-42', jiraKey: 'PK-42' })],
    });

    expect(items[0]).toMatchObject({
      secondaryTo: '/work-items?task=task-42&tab=source',
      secondaryLabel: 'Open source task',
      priority: 22,
      keys: ['Plan', 'Work'],
      tone: 'ok',
    });
  });

  it('orders open items by date and sort order', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({ id: 'later', date: '2026-06-17', sortOrder: 0 }),
      daily({ id: 'second', sortOrder: 2 }),
      daily({ id: 'first', sortOrder: 1 }),
    ]);

    expect(items.map(item => item.key)).toEqual(['daily:first', 'daily:second', 'daily:later']);
  });

  it('omits closed or already task-created daily items', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({ id: 'done', status: 'done' }),
      daily({ id: 'task-created', taskId: 'task-1', status: 'task-created' }),
      daily({ id: 'open', status: 'open' }),
    ]);

    expect(items.map(item => item.key)).toEqual(['daily:open']);
  });

  it('keeps standalone daily captures without a secondary source action', () => {
    const items = buildWorkItemDailyCommandItems([
      daily({ id: 'standalone', title: 'Standalone daily capture' }),
    ]);

    expect(items[0]).toMatchObject({
      priority: 0,
      keys: ['Plan', 'Daily'],
      tone: 'idle',
    });
    expect(items[0].secondaryTo).toBeUndefined();
    expect(items[0].secondaryLabel).toBeUndefined();
  });
});
