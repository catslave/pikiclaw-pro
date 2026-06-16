import type { DailyItem, NotePage, ProTask, TodoItem } from '../../types';

export type LocalWorkRecoveryTone = 'ok' | 'warn' | 'running' | 'idle';
export type LocalWorkRecoveryKind = 'inbox-promoted' | 'daily-promoted' | 'note-promoted' | 'planned-work' | 'orphaned-inbox' | 'stale-daily' | 'deleted-note-source';
export type LocalWorkRecoveryTarget = 'work-item' | 'inbox' | 'daily-plan' | 'note';

export interface LocalWorkRecoveryItem {
  id: string;
  kind: LocalWorkRecoveryKind;
  title: string;
  label: string;
  detail: string;
  meta: string;
  tone: LocalWorkRecoveryTone;
  updatedAt: string;
  target: LocalWorkRecoveryTarget;
  taskId?: string;
  todoId?: string;
  dailyId?: string;
  noteId?: string;
}

export interface BuildLocalWorkRecoveryInput {
  tasks: ProTask[];
  todos?: TodoItem[];
  dailyItems?: DailyItem[];
  notes?: NotePage[];
  todayDate?: string;
  limit?: number;
}

function time(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskKey(task: ProTask): string {
  return task.jiraKey || task.localKey || task.id.slice(0, 8);
}

function recoveryRank(tone: LocalWorkRecoveryTone): number {
  if (tone === 'warn') return 0;
  if (tone === 'running') return 1;
  if (tone === 'ok') return 2;
  return 3;
}

export function buildLocalWorkRecoveryItems(input: BuildLocalWorkRecoveryInput): LocalWorkRecoveryItem[] {
  const tasks = input.tasks || [];
  const todos = input.todos || [];
  const dailyItems = input.dailyItems || [];
  const notes = input.notes || [];
  const todayDate = input.todayDate || '';
  const limit = Math.max(1, input.limit || 6);
  const todosById = new Map(todos.map(item => [item.id, item]));
  const dailyById = new Map(dailyItems.map(item => [item.id, item]));
  const notesById = new Map(notes.map(item => [item.id, item]));
  const taskByOrigin = new Map<string, ProTask>();
  const items: LocalWorkRecoveryItem[] = [];

  for (const task of tasks) {
    if (task.origin?.type === 'todo' && task.origin.key) {
      taskByOrigin.set(`todo:${task.origin.key}`, task);
      const source = todosById.get(task.origin.key);
      const sourceStatus = source?.status || 'unknown';
      items.push({
        id: `task-origin-todo:${task.id}`,
        kind: 'inbox-promoted',
        title: task.title,
        label: 'Inbox promoted',
        detail: source && source.status !== 'archived'
          ? `Source inbox item is ${source.status}; review whether it should still be open.`
          : 'Created a Work Item from an inbox capture and preserved the source key.',
        meta: `${taskKey(task)} · source ${task.origin.key.slice(0, 8)} · ${sourceStatus}`,
        tone: source && source.status !== 'archived' ? 'warn' : 'ok',
        updatedAt: task.updatedAt,
        target: 'work-item',
        taskId: task.id,
        todoId: task.origin.key,
      });
    }

    if (task.origin?.type === 'daily' && task.origin.key) {
      taskByOrigin.set(`daily:${task.origin.key}`, task);
      const daily = dailyById.get(task.origin.key);
      const linked = daily?.taskId === task.id;
      items.push({
        id: `task-origin-daily:${task.id}`,
        kind: 'daily-promoted',
        title: task.title,
        label: 'Daily promoted',
        detail: daily && !linked
          ? 'Daily item exists but no longer points at this Work Item.'
          : 'Created a Work Item from a daily plan item.',
        meta: `${taskKey(task)} · daily ${task.origin.key.slice(0, 8)}${daily?.date ? ` · ${daily.date}` : ''}`,
        tone: daily && !linked ? 'warn' : 'ok',
        updatedAt: task.updatedAt,
        target: 'work-item',
        taskId: task.id,
        dailyId: task.origin.key,
      });
    }

    if (task.origin?.type === 'note' && task.origin.key) {
      taskByOrigin.set(`note:${task.origin.key}`, task);
      const note = notesById.get(task.origin.key);
      items.push({
        id: `task-origin-note:${task.id}`,
        kind: note?.deletedAt ? 'deleted-note-source' : 'note-promoted',
        title: task.title,
        label: note?.deletedAt ? 'Note source deleted' : 'Note promoted',
        detail: note
          ? note.deletedAt
            ? 'The source note has been deleted. Review before relying on note context.'
            : `Created a Work Item from ${note.kind === 'daily' ? 'a daily note' : note.kind === 'inbox' ? 'an inbox note' : 'a note page'}.`
          : 'Created from a note source that is not visible in the current Notes tree.',
        meta: `${taskKey(task)} · note ${task.origin.key.slice(0, 8)}${note?.date ? ` · ${note.date}` : ''}`,
        tone: !note || note.deletedAt ? 'warn' : note.kind === 'daily' && note.date === todayDate ? 'running' : 'ok',
        updatedAt: task.updatedAt,
        target: 'work-item',
        taskId: task.id,
        noteId: task.origin.key,
      });
    }

    if (task.plannedDate) {
      items.push({
        id: `task-planned:${task.id}:${task.plannedDate}`,
        kind: 'planned-work',
        title: task.title,
        label: task.plannedDate === todayDate ? 'Planned today' : 'Planned work',
        detail: task.plannedDate === todayDate
          ? 'This Work Item is on today’s plan.'
          : `This Work Item is scheduled for ${task.plannedDate}.`,
        meta: `${taskKey(task)} · ${task.status}`,
        tone: task.plannedDate === todayDate ? 'running' : 'idle',
        updatedAt: task.updatedAt,
        target: 'work-item',
        taskId: task.id,
      });
    }
  }

  for (const todo of todos) {
    const linkedTask = taskByOrigin.get(`todo:${todo.id}`);
    if (todo.status === 'archived' && !linkedTask) {
      items.push({
        id: `orphaned-inbox:${todo.id}`,
        kind: 'orphaned-inbox',
        title: todo.title,
        label: 'Archived inbox',
        detail: 'This inbox capture is archived, but the current Work Item list does not show a linked promoted task.',
        meta: `${todo.kind} · ${todo.id.slice(0, 8)}`,
        tone: 'warn',
        updatedAt: todo.updatedAt,
        target: 'inbox',
        todoId: todo.id,
      });
    }
  }

  for (const daily of dailyItems) {
    if (daily.status === 'task-created' && !daily.taskId) {
      items.push({
        id: `stale-daily:${daily.id}`,
        kind: 'stale-daily',
        title: daily.title,
        label: 'Daily link stale',
        detail: 'Daily is marked as task-created but no Work Item id is attached.',
        meta: `${daily.date} · ${daily.id.slice(0, 8)}`,
        tone: 'warn',
        updatedAt: daily.updatedAt,
        target: 'daily-plan',
        dailyId: daily.id,
      });
    }
  }

  const seen = new Set<string>();
  return items
    .sort((a, b) => recoveryRank(a.tone) - recoveryRank(b.tone) || time(b.updatedAt) - time(a.updatedAt))
    .filter(item => {
      const key = `${item.kind}:${item.taskId || item.todoId || item.dailyId || item.noteId || item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
