import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TodoItemKind = 'todo' | 'review-comment';
export type TodoItemStatus = 'open' | 'chat-created' | 'done' | 'archived';

export interface TodoItemSource {
  type: 'quick-capture' | 'chat-selection' | 'review-comment';
  workdir?: string;
  agent?: string;
  sessionId?: string;
  turnIndex?: number;
  quote?: string;
}

export interface TodoItem {
  id: string;
  kind: TodoItemKind;
  title: string;
  body?: string;
  status: TodoItemStatus;
  createdAt: string;
  updatedAt: string;
  source?: TodoItemSource;
  linkedChat?: {
    workdir: string;
    agent: string;
    sessionId: string;
  };
}

interface TodoFile {
  version: 1;
  items: TodoItem[];
}

export interface CreateTodoInput {
  kind?: TodoItemKind;
  title?: string;
  body?: string;
  source?: TodoItemSource;
}

function todoFilePath() {
  return process.env.PIKICLAW_PRO_TODO_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'todos.json');
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeText(value: unknown, max = 16_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function readFile(): TodoFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(todoFilePath(), 'utf-8')) as TodoFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
    return {
      version: 1,
      items: parsed.items.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string'),
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeFile(file: TodoFile) {
  const filePath = todoFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function normalizeSource(source: TodoItemSource | undefined): TodoItemSource | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const type = source.type === 'chat-selection' || source.type === 'review-comment' ? source.type : 'quick-capture';
  const normalized: TodoItemSource = {
    type,
    workdir: normalizeText(source.workdir, 2048) || undefined,
    agent: normalizeText(source.agent, 120) || undefined,
    sessionId: normalizeText(source.sessionId, 240) || undefined,
    quote: normalizeText(source.quote) || undefined,
  };
  if (typeof source.turnIndex === 'number' && Number.isFinite(source.turnIndex)) normalized.turnIndex = source.turnIndex;
  return normalized;
}

export function listTodoItems(): TodoItem[] {
  return readFile().items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getTodoItems(todoIds: string[]): TodoItem[] {
  const wanted = new Set(todoIds.map(id => normalizeText(id, 160)).filter(Boolean));
  if (!wanted.size) return [];
  return readFile().items.filter(item => wanted.has(item.id));
}

export function createTodoItem(input: CreateTodoInput): TodoItem {
  const kind: TodoItemKind = input.kind === 'review-comment' ? 'review-comment' : 'todo';
  const body = normalizeText(input.body);
  const explicitTitle = normalizeText(input.title, 240);
  const source = normalizeSource(input.source);
  const quoteTitle = source?.quote ? source.quote.split(/\s+/).slice(0, 12).join(' ') : '';
  const title = explicitTitle || body.split(/\s+/).slice(0, 14).join(' ') || quoteTitle || (kind === 'review-comment' ? 'Review comment' : 'Todo');
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: newId(kind === 'review-comment' ? 'comment' : 'todo'),
    kind,
    title,
    body: body || undefined,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    source,
  };
  const file = readFile();
  file.items.unshift(item);
  writeFile(file);
  return item;
}

export function linkTodoChat(todoId: string, linkedChat: TodoItem['linkedChat']): TodoItem {
  const file = readFile();
  const item = file.items.find(candidate => candidate.id === todoId);
  if (!item) throw new Error('todo not found');
  item.linkedChat = linkedChat;
  item.status = 'chat-created';
  item.updatedAt = new Date().toISOString();
  writeFile(file);
  return item;
}

export function deleteTodoItem(todoId: string): TodoItem {
  const id = normalizeText(todoId, 160);
  if (!id) throw new Error('todo id is required');
  const file = readFile();
  const index = file.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error('todo not found');
  const [item] = file.items.splice(index, 1);
  writeFile(file);
  return item;
}
