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

export interface TodoImageAttachment {
  id: string;
  kind: 'image';
  name: string;
  mimeType: string;
  size?: number;
  dataUrl: string;
}

export interface TodoItem {
  id: string;
  kind: TodoItemKind;
  title: string;
  body?: string;
  status: TodoItemStatus;
  createdAt: string;
  updatedAt: string;
  images?: TodoImageAttachment[];
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
  images?: unknown;
}

export interface UpdateTodoInput {
  title?: string;
  body?: string;
  images?: unknown;
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

function normalizeTodoImages(value: unknown): TodoImageAttachment[] {
  if (!Array.isArray(value)) return [];
  const images: TodoImageAttachment[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<TodoImageAttachment>;
    const dataUrl = normalizeText(item.dataUrl, 12 * 1024 * 1024);
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) continue;
    const mimeType = normalizeText(item.mimeType, 120) || (dataUrl.match(/^data:([^;,]+)[;,]/i)?.[1] || 'image/png');
    if (!mimeType.toLowerCase().startsWith('image/')) continue;
    images.push({
      id: normalizeText(item.id, 120) || newId('img'),
      kind: 'image',
      name: normalizeText(item.name, 240) || 'todo-image.png',
      mimeType,
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? Math.round(item.size) : undefined,
      dataUrl,
    });
  }
  return images;
}

function deriveTodoTitle(kind: TodoItemKind, body: string, source?: TodoItemSource, hasImages = false): string {
  const quoteTitle = source?.quote ? source.quote.split(/\s+/).slice(0, 12).join(' ') : '';
  return body.split(/\s+/).slice(0, 14).join(' ')
    || quoteTitle
    || (hasImages ? 'Image todo' : '')
    || (kind === 'review-comment' ? 'Review comment' : 'Todo');
}

function normalizeTodoItem(raw: TodoItem): TodoItem | null {
  const id = normalizeText(raw.id, 160);
  const kind: TodoItemKind = raw.kind === 'review-comment' ? 'review-comment' : 'todo';
  const source = normalizeSource(raw.source);
  const body = normalizeText(raw.body);
  const images = normalizeTodoImages(raw.images);
  const title = normalizeText(raw.title, 240) || deriveTodoTitle(kind, body, source, images.length > 0);
  if (!id || !title) return null;
  const status: TodoItemStatus = raw.status === 'chat-created' || raw.status === 'done' || raw.status === 'archived'
    ? raw.status
    : 'open';
  return {
    id,
    kind,
    title,
    body: body || undefined,
    status,
    createdAt: normalizeText(raw.createdAt, 80) || new Date().toISOString(),
    updatedAt: normalizeText(raw.updatedAt, 80) || normalizeText(raw.createdAt, 80) || new Date().toISOString(),
    images: images.length ? images : undefined,
    source,
    linkedChat: raw.linkedChat && typeof raw.linkedChat === 'object'
      ? {
        workdir: normalizeText(raw.linkedChat.workdir, 2048),
        agent: normalizeText(raw.linkedChat.agent, 120),
        sessionId: normalizeText(raw.linkedChat.sessionId, 240),
      }
      : undefined,
  };
}

function readFile(): TodoFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(todoFilePath(), 'utf-8')) as TodoFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
    return {
      version: 1,
      items: parsed.items
        .filter(item => item && typeof item.id === 'string')
        .map(item => normalizeTodoItem(item))
        .filter((item): item is TodoItem => !!item),
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
  const images = normalizeTodoImages(input.images);
  const title = explicitTitle || deriveTodoTitle(kind, body, source, images.length > 0);
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: newId(kind === 'review-comment' ? 'comment' : 'todo'),
    kind,
    title,
    body: body || undefined,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    images: images.length ? images : undefined,
    source,
  };
  const file = readFile();
  file.items.unshift(item);
  writeFile(file);
  return item;
}

export function updateTodoItem(todoId: string, input: UpdateTodoInput): TodoItem {
  const id = normalizeText(todoId, 160);
  if (!id) throw new Error('todo id is required');
  const file = readFile();
  const item = file.items.find(candidate => candidate.id === id);
  if (!item) throw new Error('todo not found');

  const hasBody = Object.prototype.hasOwnProperty.call(input, 'body');
  const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title');
  const hasImages = Object.prototype.hasOwnProperty.call(input, 'images');
  const nextBody = hasBody ? normalizeText(input.body) : normalizeText(item.body);
  const nextImages = hasImages ? normalizeTodoImages(input.images) : (item.images || []);
  const nextTitle = hasTitle
    ? normalizeText(input.title, 240)
    : normalizeText(item.title, 240);

  item.body = nextBody || undefined;
  item.images = nextImages.length ? nextImages : undefined;
  item.title = nextTitle || deriveTodoTitle(item.kind, nextBody, item.source, nextImages.length > 0);
  item.updatedAt = new Date().toISOString();
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
