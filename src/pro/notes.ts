import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyItems } from './daily-items.js';
import { createProTask } from './tasks.js';
import { createTodoItem } from './todos.js';

export type NotePageKind = 'inbox' | 'page' | 'daily';

export interface NotePage {
  id: string;
  kind: NotePageKind;
  title: string;
  parentId?: string | null;
  date?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface NoteTree {
  pages: NotePage[];
  todayDate: string;
  inboxId: string;
}

export interface CreateNotePageInput {
  title?: string;
  parentId?: string | null;
}

export interface UpdateNotePageInput {
  title?: string;
  parentId?: string | null;
  deletedAt?: string | null;
}

export interface NoteSearchResult {
  page: NotePage;
  snippet: string;
}

export interface NoteAssetUpload {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

export interface NoteAsset {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export type NotePromotionTarget = 'todo' | 'daily' | 'task';

export interface PromoteNoteSelectionInput {
  pageId: string;
  target: NotePromotionTarget;
  text: string;
  date?: string;
  workdir?: string;
}

interface NotesIndex {
  version: 1;
  pages: NotePage[];
}

const INBOX_ID = 'inbox';
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;

function rootDir() {
  return process.env.PIKICLAW_PRO_NOTES_DIR || path.join(os.homedir(), '.pikiclaw', 'pro', 'notes');
}

function indexPath() {
  return path.join(rootDir(), 'index.json');
}

function documentsDir() {
  return path.join(rootDir(), 'documents');
}

function assetsDir() {
  return path.join(rootDir(), 'assets');
}

function documentPath(pageId: string) {
  return path.join(documentsDir(), `${pageId}.json`);
}

function pageAssetsDir(pageId: string) {
  return path.join(assetsDir(), pageId);
}

function nowIso() {
  return new Date().toISOString();
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

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function normalizePage(raw: NotePage): NotePage | null {
  const id = normalizeText(raw.id, 160);
  if (!id || !isValidId(id)) return null;
  const kind: NotePageKind = raw.kind === 'inbox' || raw.kind === 'daily' ? raw.kind : 'page';
  const title = normalizeText(raw.title, 240) || (kind === 'inbox' ? 'Inbox' : kind === 'daily' ? `Daily ${normalizeDate(raw.date) || localDate()}` : 'Untitled');
  const date = kind === 'daily' ? normalizeDate(raw.date) : undefined;
  return {
    id,
    kind,
    title,
    parentId: normalizeText(raw.parentId, 160) || null,
    date,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    createdAt: normalizeText(raw.createdAt, 80) || nowIso(),
    updatedAt: normalizeText(raw.updatedAt, 80) || normalizeText(raw.createdAt, 80) || nowIso(),
    deletedAt: normalizeText(raw.deletedAt, 80) || undefined,
  };
}

function inboxPage(): NotePage {
  const now = nowIso();
  return {
    id: INBOX_ID,
    kind: 'inbox',
    title: 'Inbox',
    parentId: null,
    sortOrder: -1,
    createdAt: now,
    updatedAt: now,
  };
}

function ensureDirs() {
  fs.mkdirSync(documentsDir(), { recursive: true });
  fs.mkdirSync(assetsDir(), { recursive: true });
}

function readIndex(): NotesIndex {
  ensureDirs();
  let file: NotesIndex = { version: 1, pages: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf-8')) as NotesIndex;
    if (parsed?.version === 1 && Array.isArray(parsed.pages)) file = parsed;
  } catch {
    file = { version: 1, pages: [] };
  }

  const seen = new Set<string>();
  const pages = file.pages
    .map(page => normalizePage(page))
    .filter((page): page is NotePage => {
      if (!page || seen.has(page.id)) return false;
      seen.add(page.id);
      return true;
    });

  if (!pages.some(page => page.id === INBOX_ID)) {
    pages.unshift(inboxPage());
  }

  const knownIds = new Set(pages.map(page => page.id));
  for (const page of pages) {
    if (page.id === INBOX_ID) page.kind = 'inbox';
    if (page.parentId && !knownIds.has(page.parentId)) page.parentId = null;
    if (page.parentId === page.id) page.parentId = null;
  }

  return { version: 1, pages };
}

function writeIndex(file: NotesIndex) {
  const target = indexPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, target);
}

function defaultDocument() {
  return [{ type: 'paragraph', content: [] }];
}

function nextSortOrder(pages: NotePage[], parentId: string | null | undefined) {
  const normalizedParentId = parentId || null;
  return pages
    .filter(page => (page.parentId || null) === normalizedParentId && !page.deletedAt)
    .reduce((max, page) => Math.max(max, page.sortOrder), -1) + 1;
}

function assertPage(file: NotesIndex, pageId: string): NotePage {
  const id = normalizeText(pageId, 160);
  if (!id || !isValidId(id)) throw new Error('note page id is required');
  const page = file.pages.find(candidate => candidate.id === id);
  if (!page) throw new Error('note page not found');
  return page;
}

function wouldCreateCycle(file: NotesIndex, pageId: string, parentId: string | null | undefined): boolean {
  let current = parentId || null;
  const visited = new Set<string>();
  while (current) {
    if (current === pageId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = file.pages.find(page => page.id === current)?.parentId || null;
  }
  return false;
}

function ensureDocument(pageId: string) {
  const filePath = documentPath(pageId);
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(defaultDocument(), null, 2));
}

export function listNoteTree(): NoteTree {
  const file = readIndex();
  return {
    pages: [...file.pages].sort((a, b) => (
      Number(!!a.deletedAt) - Number(!!b.deletedAt)
      || a.sortOrder - b.sortOrder
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )),
    todayDate: localDate(),
    inboxId: INBOX_ID,
  };
}

export function getNotePage(pageId: string): NotePage | null {
  const file = readIndex();
  return file.pages.find(page => page.id === pageId) || null;
}

export function createNotePage(input: CreateNotePageInput = {}): NotePage {
  const file = readIndex();
  const parentId = normalizeText(input.parentId, 160) || null;
  if (parentId && (!isValidId(parentId) || !file.pages.some(page => page.id === parentId && !page.deletedAt))) {
    throw new Error('parent note page not found');
  }
  const now = nowIso();
  const page: NotePage = {
    id: newId('note'),
    kind: 'page',
    title: normalizeText(input.title, 240) || 'Untitled',
    parentId,
    sortOrder: nextSortOrder(file.pages, parentId),
    createdAt: now,
    updatedAt: now,
  };
  file.pages.push(page);
  writeIndex(file);
  ensureDocument(page.id);
  return page;
}

export function getOrCreateDailyNote(dateInput?: string): NotePage {
  const date = normalizeDate(dateInput) || localDate();
  const file = readIndex();
  const existing = file.pages.find(page => page.kind === 'daily' && page.date === date);
  if (existing) {
    if (existing.deletedAt) delete existing.deletedAt;
    existing.updatedAt = nowIso();
    writeIndex(file);
    ensureDocument(existing.id);
    return existing;
  }
  const now = nowIso();
  const page: NotePage = {
    id: newId('daily'),
    kind: 'daily',
    title: `Daily ${date}`,
    parentId: null,
    date,
    sortOrder: nextSortOrder(file.pages, null),
    createdAt: now,
    updatedAt: now,
  };
  file.pages.push(page);
  writeIndex(file);
  ensureDocument(page.id);
  return page;
}

export function updateNotePage(pageId: string, input: UpdateNotePageInput): NotePage {
  const file = readIndex();
  const page = assertPage(file, pageId);
  const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title');
  const hasParentId = Object.prototype.hasOwnProperty.call(input, 'parentId');
  const hasDeletedAt = Object.prototype.hasOwnProperty.call(input, 'deletedAt');

  if (hasTitle) {
    page.title = normalizeText(input.title, 240) || (page.kind === 'inbox' ? 'Inbox' : 'Untitled');
  }

  if (hasParentId) {
    const parentId = normalizeText(input.parentId, 160) || null;
    if (page.kind === 'inbox') throw new Error('inbox cannot be moved');
    if (parentId && (!isValidId(parentId) || !file.pages.some(candidate => candidate.id === parentId && !candidate.deletedAt))) {
      throw new Error('parent note page not found');
    }
    if (wouldCreateCycle(file, page.id, parentId)) throw new Error('note page cannot be moved into itself');
    page.parentId = parentId;
    page.sortOrder = nextSortOrder(file.pages.filter(candidate => candidate.id !== page.id), parentId);
  }

  if (hasDeletedAt) {
    const deletedAt = normalizeText(input.deletedAt, 80);
    if (deletedAt) page.deletedAt = deletedAt;
    else delete page.deletedAt;
  }

  page.updatedAt = nowIso();
  writeIndex(file);
  return page;
}

export function reorderNotePages(parentIdInput: string | null | undefined, pageIdsInput: string[]): NotePage[] {
  const file = readIndex();
  const parentId = normalizeText(parentIdInput, 160) || null;
  if (parentId && !file.pages.some(page => page.id === parentId && !page.deletedAt)) throw new Error('parent note page not found');
  const pageIds = pageIdsInput.map(id => normalizeText(id, 160)).filter(id => id && isValidId(id));
  const wanted = new Set(pageIds);
  const siblings = file.pages.filter(page => (page.parentId || null) === parentId && !page.deletedAt && wanted.has(page.id));
  if (siblings.length !== wanted.size) throw new Error('one or more note pages are not reorderable siblings');
  const now = nowIso();
  for (const [index, pageId] of pageIds.entries()) {
    const page = file.pages.find(candidate => candidate.id === pageId)!;
    page.sortOrder = index;
    page.updatedAt = now;
  }
  writeIndex(file);
  return file.pages.filter(page => wanted.has(page.id));
}

function descendantIds(file: NotesIndex, pageId: string): Set<string> {
  const ids = new Set<string>([pageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of file.pages) {
      if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function deleteNotePage(pageId: string, permanent = false): NotePage {
  const file = readIndex();
  const page = assertPage(file, pageId);
  if (page.kind === 'inbox') throw new Error('inbox cannot be deleted');

  if (permanent) {
    const ids = descendantIds(file, page.id);
    file.pages = file.pages.filter(candidate => !ids.has(candidate.id));
    writeIndex(file);
    for (const id of ids) {
      try { fs.rmSync(documentPath(id), { force: true }); } catch {}
      try { fs.rmSync(pageAssetsDir(id), { recursive: true, force: true }); } catch {}
    }
    return page;
  }

  const ids = descendantIds(file, page.id);
  const deletedAt = nowIso();
  for (const candidate of file.pages) {
    if (!ids.has(candidate.id)) continue;
    candidate.deletedAt = deletedAt;
    candidate.updatedAt = deletedAt;
  }
  writeIndex(file);
  return page;
}

export function readNoteDocument(pageId: string): unknown[] {
  const file = readIndex();
  assertPage(file, pageId);
  ensureDocument(pageId);
  const filePath = documentPath(pageId);
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('note document is too large');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(parsed) ? parsed : defaultDocument();
}

export function writeNoteDocument(pageId: string, blocks: unknown): unknown[] {
  const file = readIndex();
  const page = assertPage(file, pageId);
  if (!Array.isArray(blocks)) throw new Error('note document blocks must be an array');
  const encoded = JSON.stringify(blocks, null, 2);
  if (Buffer.byteLength(encoded, 'utf-8') > MAX_DOCUMENT_BYTES) throw new Error('note document is too large');
  fs.mkdirSync(documentsDir(), { recursive: true });
  const target = documentPath(pageId);
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, encoded);
  fs.renameSync(tmpPath, target);
  page.updatedAt = nowIso();
  writeIndex(file);
  return blocks;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/jpg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    case 'image/svg+xml': return '.svg';
    case 'image/avif': return '.avif';
    case 'image/bmp': return '.bmp';
    default: return '.png';
  }
}

function sanitizeAssetStem(name: string): string {
  const parsed = path.parse(path.basename(name || 'image'));
  return (parsed.name || 'image')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'image';
}

export function saveNoteAsset(pageId: string, input: NoteAssetUpload): NoteAsset {
  const file = readIndex();
  assertPage(file, pageId);
  const mimeType = normalizeText(input.mimeType, 120) || 'image/png';
  if (!mimeType.toLowerCase().startsWith('image/')) throw new Error('only image assets are supported');
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new Error('asset file is required');
  if (input.bytes.length > MAX_ASSET_BYTES) throw new Error('note asset is too large');
  const ext = extensionForMime(mimeType);
  const fileName = `${newId('asset')}-${sanitizeAssetStem(input.name)}${ext}`;
  const dir = pageAssetsDir(pageId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), input.bytes);
  return {
    url: `/api/pro/notes/assets/${encodeURIComponent(pageId)}/${encodeURIComponent(fileName)}`,
    fileName,
    mimeType,
    size: input.bytes.length,
  };
}

export function resolveNoteAsset(pageId: string, fileName: string): { filePath: string; mimeType: string } {
  const normalizedPageId = normalizeText(pageId, 160);
  const rawFileName = normalizeText(fileName, 260);
  const normalizedFileName = path.basename(rawFileName);
  if (rawFileName !== normalizedFileName) throw new Error('invalid note asset path');
  if (!normalizedPageId || !isValidId(normalizedPageId) || !normalizedFileName) throw new Error('invalid note asset path');
  const filePath = path.resolve(pageAssetsDir(normalizedPageId), normalizedFileName);
  const root = path.resolve(pageAssetsDir(normalizedPageId));
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('invalid note asset path');
  const ext = path.extname(normalizedFileName).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.avif' ? 'image/avif'
    : ext === '.bmp' ? 'image/bmp'
    : 'image/png';
  return { filePath, mimeType };
}

function collectText(value: unknown, parts: string[] = []): string[] {
  if (typeof value === 'string') {
    parts.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' || key === 'props') continue;
      collectText(item, parts);
    }
  }
  return parts;
}

export function searchNotes(queryInput: string): NoteSearchResult[] {
  const query = normalizeText(queryInput, 120).toLowerCase();
  if (!query) return [];
  const file = readIndex();
  const results: NoteSearchResult[] = [];
  for (const page of file.pages) {
    if (page.deletedAt) continue;
    const title = page.title.toLowerCase();
    let body = '';
    try {
      body = collectText(readNoteDocument(page.id)).join(' ').replace(/\s+/g, ' ').trim();
    } catch {
      body = '';
    }
    const haystack = `${title} ${body.toLowerCase()}`;
    if (!haystack.includes(query)) continue;
    const bodyIndex = body.toLowerCase().indexOf(query);
    const snippet = bodyIndex >= 0
      ? body.slice(Math.max(0, bodyIndex - 60), bodyIndex + query.length + 120)
      : page.title;
    results.push({ page, snippet });
  }
  return results.sort((a, b) => Date.parse(b.page.updatedAt) - Date.parse(a.page.updatedAt)).slice(0, 50);
}

export function promoteNoteSelection(input: PromoteNoteSelectionInput) {
  const text = normalizeText(input.text, 16_000);
  if (!text) throw new Error('selected note text is required');
  const page = getNotePage(input.pageId);
  if (!page) throw new Error('note page not found');
  const title = text.split(/\s+/).slice(0, 14).join(' ') || page.title;
  const body = `From note: ${page.title}\n\n${text}`;
  if (input.target === 'todo') {
    return { target: 'todo' as const, item: createTodoItem({ title, body, source: { type: 'quick-capture', quote: text } }) };
  }
  if (input.target === 'daily') {
    return { target: 'daily' as const, items: createDailyItems({ date: normalizeDate(input.date) || localDate(), titles: [title] }) };
  }
  return {
    target: 'task' as const,
    task: createProTask({
      title,
      description: body,
      kind: 'manual',
      status: 'backlog',
      origin: { type: 'note', key: page.id },
      workdir: normalizeText(input.workdir, 2048) || undefined,
    }),
  };
}
