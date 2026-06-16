import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAILY_ASSISTANT_ID } from './assistant-defaults.js';
import { createProTask, getProTask, updateProTaskMeta } from './tasks.js';
import { getTodoItems, updateTodoItem } from './todos.js';
import { todoToWorkItemDescription } from './todo-work-item-evidence.js';

export type DailyItemStatus = 'open' | 'task-created' | 'done' | 'archived';

export interface DailyItem {
  id: string;
  date: string;
  title: string;
  status: DailyItemStatus;
  sortOrder: number;
  taskId?: string;
  taskKey?: string;
  relatedTaskId?: string;
  sourceTodoId?: string;
  sourceTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

interface DailyItemFile {
  version: 1;
  items: DailyItem[];
}

export interface CreateDailyItemsInput {
  date: string;
  titles: string[];
  relatedTaskId?: string;
}

export interface PromoteDailyItemsOptions {
  workdir?: string;
}

function filePath() {
  return process.env.PIKICLAW_PRO_DAILY_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'daily-items.json');
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeText(value: unknown, max = 16_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function normalizeDate(value: unknown): string | undefined {
  const text = normalizeText(value, 32);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function normalizeStatus(value: unknown): DailyItemStatus {
  return value === 'task-created' || value === 'done' || value === 'archived' ? value : 'open';
}

function taskKeyForTaskId(taskId: string | undefined): string | undefined {
  if (!taskId) return undefined;
  const task = getProTask(taskId);
  return task?.jiraKey || task?.localKey || undefined;
}

function normalizeItem(raw: DailyItem): DailyItem | null {
  const id = normalizeText(raw.id, 160);
  const date = normalizeDate(raw.date);
  const title = normalizeText(raw.title, 240);
  if (!id || !date || !title) return null;
  return {
    id,
    date,
    title,
    status: normalizeStatus(raw.status),
    sortOrder: Number.isFinite(Number((raw as any).sortOrder)) ? Number((raw as any).sortOrder) : 0,
    taskId: normalizeText(raw.taskId, 160) || undefined,
    taskKey: normalizeText(raw.taskKey, 160) || taskKeyForTaskId(normalizeText(raw.taskId, 160) || undefined),
    relatedTaskId: normalizeText(raw.relatedTaskId, 160) || undefined,
    sourceTodoId: normalizeText(raw.sourceTodoId, 160) || undefined,
    sourceTaskId: normalizeText(raw.sourceTaskId, 160) || undefined,
    createdAt: normalizeText(raw.createdAt, 80) || new Date().toISOString(),
    updatedAt: normalizeText(raw.updatedAt, 80) || normalizeText(raw.createdAt, 80) || new Date().toISOString(),
  };
}

function readFile(): DailyItemFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf-8')) as DailyItemFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
    return {
      version: 1,
      items: parsed.items
        .map(item => normalizeItem(item))
        .filter((item): item is DailyItem => !!item),
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeFile(file: DailyItemFile) {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, target);
}

function statusRank(status: DailyItemStatus): number {
  return status === 'open' ? 0 : status === 'task-created' ? 1 : status === 'done' ? 2 : 3;
}

function nextSortOrder(items: DailyItem[], date: string): number {
  return items
    .filter(item => item.date === date)
    .reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
}

function reconcileTaskLinks(file: DailyItemFile): boolean {
  let changed = false;
  for (const item of file.items) {
    if (!item.taskId || item.status !== 'task-created') continue;
    const task = getProTask(item.taskId);
    if (task?.plannedDate === item.date) continue;
    delete item.taskId;
    delete item.taskKey;
    item.status = 'open';
    item.updatedAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

export function listDailyItems(date?: string): DailyItem[] {
  const normalizedDate = date ? normalizeDate(date) : undefined;
  const file = readFile();
  if (reconcileTaskLinks(file)) writeFile(file);
  return file.items
    .filter(item => !normalizedDate || item.date === normalizedDate)
    .sort((a, b) => (
      a.sortOrder - b.sortOrder
      || statusRank(a.status) - statusRank(b.status)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    ));
}

export function createDailyItems(input: CreateDailyItemsInput): DailyItem[] {
  const date = normalizeDate(input.date);
  if (!date) throw new Error('daily date is required');
  const titles = input.titles.map(title => normalizeText(title, 240)).filter(Boolean);
  if (!titles.length) return [];
  const relatedTaskId = normalizeText(input.relatedTaskId, 160) || undefined;
  if (relatedTaskId && !getProTask(relatedTaskId)) throw new Error('related task not found');
  const now = new Date().toISOString();
  const file = readFile();
  let sortOrder = nextSortOrder(file.items, date);
  const items = titles.map(title => ({
    id: newId('daily'),
    date,
    title,
    status: 'open' as const,
    sortOrder: sortOrder++,
    relatedTaskId,
    createdAt: now,
    updatedAt: now,
  }));
  file.items.unshift(...items);
  writeFile(file);
  return items;
}

export function addTaskToDaily(date: string, taskId: string): { item: DailyItem } {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) throw new Error('daily date is required');
  const task = getProTask(normalizeText(taskId, 160));
  if (!task) throw new Error('task not found');
  updateProTaskMeta(task.id, { plannedDate: normalizedDate });
  const now = new Date().toISOString();
  const file = readFile();
  const existing = file.items.find(item => item.date === normalizedDate && item.taskId === task.id);
  if (existing) return { item: existing };
  const item: DailyItem = {
    id: newId('daily'),
    date: normalizedDate,
    title: task.title,
    status: 'task-created',
    sortOrder: nextSortOrder(file.items, normalizedDate),
    taskId: task.id,
    taskKey: task.jiraKey || task.localKey,
    relatedTaskId: task.linkedTaskId || undefined,
    sourceTaskId: task.id,
    createdAt: now,
    updatedAt: now,
  };
  file.items.unshift(item);
  writeFile(file);
  return { item };
}

export function addTodoToDaily(date: string, todoId: string): { item: DailyItem; taskId: string } {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) throw new Error('daily date is required');
  const todo = getTodoItems([todoId])[0];
  if (!todo) throw new Error('todo not found');
  const task = createProTask({
    title: todo.title,
    description: todoToWorkItemDescription(todo) || todo.body,
    kind: 'todo',
    status: 'backlog',
    plannedDate: normalizedDate,
    origin: { type: 'todo', key: todo.id },
    defaultAssistantId: DAILY_ASSISTANT_ID,
  });
  updateTodoItem(todo.id, { status: 'archived' });
  const now = new Date().toISOString();
  const item: DailyItem = {
    id: newId('daily'),
    date: normalizedDate,
    title: todo.title,
    status: 'task-created',
    sortOrder: nextSortOrder(readFile().items, normalizedDate),
    taskId: task.id,
    taskKey: task.jiraKey || task.localKey,
    sourceTodoId: todo.id,
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  item.sortOrder = nextSortOrder(file.items, normalizedDate);
  file.items.push(item);
  writeFile(file);
  return { item, taskId: task.id };
}

export function promoteDailyItemsToTasks(date: string, dailyItemIds: string[], options: PromoteDailyItemsOptions = {}): { items: DailyItem[]; taskIds: string[] } {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) throw new Error('daily date is required');
  const wanted = new Set(dailyItemIds.map(id => normalizeText(id, 160)).filter(Boolean));
  if (!wanted.size) return { items: [], taskIds: [] };
  const workdir = normalizeText(options.workdir, 2048) || undefined;
  const file = readFile();
  const updatedItems: DailyItem[] = [];
  const taskIds: string[] = [];
  for (const item of file.items) {
    if (!wanted.has(item.id) || item.date !== normalizedDate || item.taskId) continue;
    const task = createProTask({
      title: item.title,
      kind: 'manual',
      status: 'backlog',
      plannedDate: normalizedDate,
      linkedTaskId: item.relatedTaskId,
      origin: { type: 'daily', key: item.id },
      workdir,
      defaultAssistantId: DAILY_ASSISTANT_ID,
    });
    item.taskId = task.id;
    item.taskKey = task.jiraKey || task.localKey;
    item.status = 'task-created';
    item.updatedAt = new Date().toISOString();
    updatedItems.push(item);
    taskIds.push(task.id);
  }
  if (updatedItems.length) writeFile(file);
  return { items: updatedItems, taskIds };
}

export function updateDailyItem(itemId: string, patch: { title?: string; status?: DailyItemStatus; relatedTaskId?: string | null }): DailyItem {
  const file = readFile();
  const item = file.items.find(candidate => candidate.id === normalizeText(itemId, 160));
  if (!item) throw new Error('daily item not found');
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    const title = normalizeText(patch.title, 240);
    if (title) item.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status') && patch.status) {
    item.status = normalizeStatus(patch.status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'relatedTaskId')) {
    const relatedTaskId = normalizeText(patch.relatedTaskId, 160) || undefined;
    if (relatedTaskId && !getProTask(relatedTaskId)) throw new Error('related task not found');
    item.relatedTaskId = relatedTaskId;
  }
  item.updatedAt = new Date().toISOString();
  writeFile(file);
  return item;
}

export function revertDailyItemTask(itemId: string): DailyItem {
  const file = readFile();
  const item = file.items.find(candidate => candidate.id === normalizeText(itemId, 160));
  if (!item) throw new Error('daily item not found');
  const taskId = item.taskId;
  if (taskId) {
    const task = getProTask(taskId);
    if (task?.plannedDate) updateProTaskMeta(task.id, { plannedDate: null });
  }
  delete item.taskId;
  delete item.taskKey;
  item.status = 'open';
  item.updatedAt = new Date().toISOString();
  writeFile(file);
  return item;
}

export function revertDailyItemTaskForTask(taskId: string): DailyItem | null {
  const normalizedTaskId = normalizeText(taskId, 160);
  if (!normalizedTaskId) return null;
  const file = readFile();
  const item = file.items.find(candidate => candidate.taskId === normalizedTaskId);
  if (!item) return null;
  const task = getProTask(normalizedTaskId);
  if (task?.plannedDate) updateProTaskMeta(task.id, { plannedDate: null });
  delete item.taskId;
  delete item.taskKey;
  item.status = 'open';
  item.updatedAt = new Date().toISOString();
  writeFile(file);
  return item;
}

export function reorderDailyItems(date: string, orderedItemIds: string[]): DailyItem[] {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) throw new Error('daily date is required');
  const wanted = orderedItemIds.map(id => normalizeText(id, 160)).filter(Boolean);
  if (!wanted.length) return [];
  const file = readFile();
  const itemsForDate = file.items.filter(item => item.date === normalizedDate);
  const byId = new Map(itemsForDate.map(item => [item.id, item]));
  const ordered: DailyItem[] = [];
  for (const id of wanted) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  const remainder = itemsForDate.filter(item => !wanted.includes(item.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const finalOrder = [...ordered, ...remainder];
  const now = new Date().toISOString();
  finalOrder.forEach((item, index) => {
    item.sortOrder = index;
    item.updatedAt = now;
  });
  writeFile(file);
  return finalOrder;
}

export function deleteDailyItem(itemId: string): DailyItem {
  const id = normalizeText(itemId, 160);
  const file = readFile();
  const index = file.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error('daily item not found');
  const [item] = file.items.splice(index, 1);
  writeFile(file);
  return item;
}
