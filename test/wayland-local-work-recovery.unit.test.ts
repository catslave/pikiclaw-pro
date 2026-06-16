import { describe, expect, it } from 'vitest';
import type { DailyItem, NotePage, ProTask, TodoItem } from '../dashboard/src/types';
import { buildLocalWorkRecoveryItems } from '../dashboard/src/pages/wayland/localWorkRecovery';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    localKey: input.localKey || 'MY-0001',
    title: input.title || 'Promoted work',
    kind: input.kind || 'manual',
    status: input.status || 'backlog',
    origin: input.origin,
    plannedDate: input.plannedDate,
    createdAt: input.createdAt || '2026-06-16T08:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T09:00:00.000Z',
    stageRuns: input.stageRuns || [],
    verificationRuns: input.verificationRuns || [],
    subTasks: input.subTasks || [],
    events: input.events || [],
  };
}

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Captured todo',
    status: input.status || 'open',
    createdAt: input.createdAt || '2026-06-16T07:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T08:30:00.000Z',
  };
}

function daily(input: Partial<DailyItem> = {}): DailyItem {
  return {
    id: input.id || 'daily-1',
    date: input.date || '2026-06-16',
    title: input.title || 'Daily plan',
    status: input.status || 'open',
    sortOrder: input.sortOrder || 0,
    taskId: input.taskId,
    sourceTodoId: input.sourceTodoId,
    createdAt: input.createdAt || '2026-06-16T07:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T08:00:00.000Z',
  };
}

function note(input: Partial<NotePage> = {}): NotePage {
  return {
    id: input.id || 'note-1',
    kind: input.kind || 'page',
    title: input.title || 'Source note',
    date: input.date,
    sortOrder: input.sortOrder || 0,
    createdAt: input.createdAt || '2026-06-16T07:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T08:00:00.000Z',
    deletedAt: input.deletedAt,
  };
}

describe('Wayland local work recovery', () => {
  it('summarizes promoted inbox tasks and treats archived sources as healthy', () => {
    const items = buildLocalWorkRecoveryItems({
      tasks: [task({ origin: { type: 'todo', key: 'todo-1' }, kind: 'todo' })],
      todos: [todo({ id: 'todo-1', status: 'archived' })],
      todayDate: '2026-06-16',
    });

    expect(items[0]).toMatchObject({
      kind: 'inbox-promoted',
      label: 'Inbox promoted',
      tone: 'ok',
      taskId: 'task-1',
      todoId: 'todo-1',
      target: 'work-item',
    });
  });

  it('raises orphaned archived inbox captures above healthy history', () => {
    const items = buildLocalWorkRecoveryItems({
      tasks: [task({ id: 'task-planned', plannedDate: '2026-06-16', updatedAt: '2026-06-16T11:00:00.000Z' })],
      todos: [todo({ id: 'todo-orphan', status: 'archived', updatedAt: '2026-06-16T10:00:00.000Z' })],
      todayDate: '2026-06-16',
    });

    expect(items.map(item => item.kind)).toEqual(['orphaned-inbox', 'planned-work']);
    expect(items[0]).toMatchObject({
      tone: 'warn',
      target: 'inbox',
      todoId: 'todo-orphan',
    });
  });

  it('warns when a daily-created item has lost its task link', () => {
    const items = buildLocalWorkRecoveryItems({
      tasks: [],
      dailyItems: [daily({ status: 'task-created', taskId: undefined })],
      todayDate: '2026-06-16',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'stale-daily',
      label: 'Daily link stale',
      tone: 'warn',
      target: 'daily-plan',
    });
  });

  it('summarizes Work Items promoted from Notes as recoverable source history', () => {
    const items = buildLocalWorkRecoveryItems({
      tasks: [
        task({
          id: 'task-note',
          title: 'Promoted from daily note',
          origin: { type: 'note', key: 'note-daily' },
        }),
      ],
      notes: [note({ id: 'note-daily', kind: 'daily', date: '2026-06-16' })],
      todayDate: '2026-06-16',
    });

    expect(items[0]).toMatchObject({
      kind: 'note-promoted',
      label: 'Note promoted',
      tone: 'running',
      target: 'work-item',
      taskId: 'task-note',
      noteId: 'note-daily',
    });
  });

  it('warns when a promoted Work Item points at a deleted note source', () => {
    const items = buildLocalWorkRecoveryItems({
      tasks: [
        task({
          id: 'task-deleted-note',
          origin: { type: 'note', key: 'note-deleted' },
        }),
      ],
      notes: [note({ id: 'note-deleted', deletedAt: '2026-06-16T09:00:00.000Z' })],
      todayDate: '2026-06-16',
    });

    expect(items[0]).toMatchObject({
      kind: 'deleted-note-source',
      label: 'Note source deleted',
      tone: 'warn',
      noteId: 'note-deleted',
    });
  });
});
