import type { DailyItem, ProTask, TodoItem } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';

export interface WorkItemDailyCommandItem {
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

export interface WorkItemDailyCommandOptions {
  limit?: number;
  todos?: TodoItem[];
  tasks?: ProTask[];
}

function dailySourceLabel(item: DailyItem): string {
  if (item.taskId || item.taskKey) return 'Work Item created';
  if (item.sourceTodoId) return 'From inbox';
  if (item.sourceTaskId || item.relatedTaskId) return 'From Work Item';
  return 'Daily capture';
}

function dailyTime(item: DailyItem): number {
  const updated = Date.parse(item.updatedAt || '');
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(item.createdAt || '');
  return Number.isFinite(created) ? created : 0;
}

function chatFocusUrl(args: { workdir?: string; agent?: string; sessionId?: string }): string | null {
  if (!args.workdir || !args.agent || !args.sessionId) return null;
  const params = new URLSearchParams();
  params.set('workdir', args.workdir);
  params.set('agent', args.agent);
  params.set('session', args.sessionId);
  params.set('nonce', String(Date.now()));
  return `/conversations/session?${params.toString()}`;
}

function todoChatTarget(todo: TodoItem | undefined): { to: string; label: string } | null {
  if (!todo) return null;
  const linked = chatFocusUrl(todo.linkedChat || {});
  if (linked) return { to: linked, label: 'Open linked chat' };
  const source = chatFocusUrl(todo.source || {});
  if (source) return { to: source, label: 'Open source chat' };
  return null;
}

function workItemUrl(taskId: string): string {
  return `/work-items?task=${encodeURIComponent(taskId)}&tab=source`;
}

function dailySecondaryTarget(
  item: DailyItem,
  todosById: Map<string, TodoItem>,
  tasksById: Map<string, ProTask>,
): { to: string; label: string; priority: number } | null {
  if (item.sourceTodoId) {
    const chat = todoChatTarget(todosById.get(item.sourceTodoId));
    if (chat) return { ...chat, priority: 30 };
    return { to: `/work-items?source=inbox&todo=${encodeURIComponent(item.sourceTodoId)}`, label: 'Open source todo', priority: 16 };
  }
  const taskId = item.sourceTaskId || item.relatedTaskId || '';
  if (taskId && tasksById.has(taskId)) return { to: workItemUrl(taskId), label: 'Open source task', priority: 22 };
  if (taskId) return { to: workItemUrl(taskId), label: 'Open source task', priority: 12 };
  return null;
}

export function buildWorkItemDailyCommandItems(
  items: DailyItem[],
  options: WorkItemDailyCommandOptions = {},
): WorkItemDailyCommandItem[] {
  const limit = options.limit ?? 12;
  const todosById = new Map((options.todos || []).map(item => [item.id, item]));
  const tasksById = new Map((options.tasks || []).map(item => [item.id, item]));

  return items
    .filter(item => item.status === 'open' && !item.taskId)
    .sort((a, b) => (
      a.date.localeCompare(b.date)
      || a.sortOrder - b.sortOrder
      || dailyTime(b) - dailyTime(a)
    ))
    .slice(0, limit)
    .map(item => {
      const source = dailySourceLabel(item);
      const linked = item.sourceTodoId || item.sourceTaskId || item.relatedTaskId || '';
      const secondary = dailySecondaryTarget(item, todosById, tasksById);
      return {
        key: `daily:${item.id}`,
        title: `Daily plan: ${item.title}`,
        detail: `${item.date} · ${source}${linked ? ` · ${linked}` : ''}`,
        to: `/work-items?source=manual&date=${encodeURIComponent(item.date)}&daily=${encodeURIComponent(item.id)}`,
        secondaryTo: secondary?.to,
        secondaryLabel: secondary?.label,
        priority: secondary?.priority || 0,
        lanes: [
          commandLane('Source', item.sourceTodoId ? 'Inbox' : item.sourceTaskId || item.relatedTaskId ? 'Work' : 'Daily', secondary ? 'source' : 'idle'),
          commandLane('Execution', 'Plan', 'execution'),
        ],
        keys: item.sourceTodoId ? ['Plan', 'Inbox'] : item.sourceTaskId || item.relatedTaskId ? ['Plan', 'Work'] : ['Plan', 'Daily'],
        tone: item.sourceTodoId || item.sourceTaskId || item.relatedTaskId ? 'ok' as const : 'idle' as const,
        keywords: [
          'daily plan',
          'today plan',
          'plan today',
          'daily item',
          'promote daily',
          'work item intake',
          item.id,
          item.date,
          item.title,
          item.status,
          item.taskKey || '',
          item.sourceTodoId || '',
          item.sourceTaskId || '',
          item.relatedTaskId || '',
          source,
        ].filter(Boolean),
      };
    });
}
