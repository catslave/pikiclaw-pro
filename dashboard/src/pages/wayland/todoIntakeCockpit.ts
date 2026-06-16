import type { TodoItem } from '../../types';

export type TodoIntakeTone = 'ok' | 'warn' | 'idle';

export interface TodoIntakeItem {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: TodoIntakeTone;
  updatedAt: string;
  evidenceCount: number;
  todo: TodoItem;
}

export interface TodoIntakeSummary {
  totalOpen: number;
  richCount: number;
  thinCount: number;
  imageCount: number;
  linkedChatCount: number;
  sourceSessionCount: number;
  items: TodoIntakeItem[];
}

export interface BuildTodoIntakeCockpitInput {
  todos: TodoItem[];
  limit?: number;
}

function time(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(value: string | undefined, fallback: string): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function evidenceKinds(todo: TodoItem): string[] {
  const kinds: string[] = [];
  if (todo.source?.quote) kinds.push('quote');
  if (todo.source?.agent && todo.source.sessionId) kinds.push('source chat');
  if (todo.linkedChat?.agent && todo.linkedChat.sessionId) kinds.push('linked chat');
  if ((todo.images || []).length) kinds.push(`${todo.images!.length} image${todo.images!.length === 1 ? '' : 's'}`);
  if (todo.source?.workdir) kinds.push('workspace');
  if (todo.body) kinds.push('note');
  return kinds;
}

function todoRank(item: TodoIntakeItem): number {
  if (item.tone === 'ok') return 0;
  if (item.tone === 'warn') return 1;
  return 2;
}

export function buildTodoIntakeCockpit(input: BuildTodoIntakeCockpitInput): TodoIntakeSummary {
  const limit = Math.max(1, input.limit || 6);
  const openTodos = (input.todos || []).filter(todo => todo.status === 'open');
  const items = openTodos.map(todo => {
    const evidence = evidenceKinds(todo);
    const evidenceCount = evidence.length;
    const tone: TodoIntakeTone = evidenceCount >= 2 ? 'ok' : evidenceCount === 1 ? 'warn' : 'idle';
    return {
      id: todo.id,
      title: todo.title,
      detail: compact(todo.body || todo.source?.quote, evidenceCount ? `Evidence: ${evidence.join(', ')}` : 'Thin inbox capture. Add context or promote with care.'),
      meta: evidenceCount ? evidence.join(' · ') : 'no preserved source',
      tone,
      updatedAt: todo.updatedAt || todo.createdAt,
      evidenceCount,
      todo,
    };
  });

  return {
    totalOpen: openTodos.length,
    richCount: items.filter(item => item.tone === 'ok').length,
    thinCount: items.filter(item => item.tone === 'idle').length,
    imageCount: openTodos.filter(todo => (todo.images || []).length > 0).length,
    linkedChatCount: openTodos.filter(todo => !!todo.linkedChat?.sessionId).length,
    sourceSessionCount: openTodos.filter(todo => !!todo.source?.agent && !!todo.source.sessionId).length,
    items: items
      .sort((a, b) => todoRank(a) - todoRank(b) || time(b.updatedAt) - time(a.updatedAt))
      .slice(0, limit),
  };
}
