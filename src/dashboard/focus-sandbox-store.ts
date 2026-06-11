import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canTransitionSandboxState,
  FOCUS_ACTIVE_SANDBOX_CAP,
  normalizeSandboxKind,
  normalizeSandboxState,
  normalizeSessionRef,
  type CreateFocusSandboxInput,
  type FocusSandboxKind,
  type FocusSandboxRecord,
  type FocusSandboxRecordState,
  type UpdateFocusSandboxInput,
} from '../pro/sandbox.js';

interface SandboxFile {
  version: 1;
  sandboxes: FocusSandboxRecord[];
}

function storePath() {
  return process.env.PIKICLAW_FOCUS_SANDBOX_FILE || path.join(os.homedir(), '.pikiclaw', 'focus', 'sandboxes.json');
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function newId() {
  return `sandbox_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeText(value: unknown, max = 400): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function readFile(): SandboxFile {
  const filePath = storePath();
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) return { version: 1, sandboxes: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SandboxFile;
    return { version: 1, sandboxes: Array.isArray(parsed?.sandboxes) ? parsed.sandboxes.map(normalizeRecord).filter(Boolean) as FocusSandboxRecord[] : [] };
  } catch {
    return { version: 1, sandboxes: [] };
  }
}

function writeFile(data: SandboxFile) {
  const filePath = storePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeRecord(raw: unknown): FocusSandboxRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const kind = normalizeSandboxKind(item.kind);
  const state = normalizeSandboxState(item.state);
  const workdir = normalizeText(item.scope && typeof item.scope === 'object' ? (item.scope as Record<string, unknown>).workdir : item.workdir, 2048);
  const title = normalizeText(item.title, 400);
  const id = normalizeText(item.id, 160);
  if (!kind || !state || !workdir || !title || !id) return null;
  const scopeRaw = item.scope && typeof item.scope === 'object' ? item.scope as Record<string, unknown> : {};
  const fileGlobs = Array.isArray(scopeRaw.fileGlobs)
    ? scopeRaw.fileGlobs.map(entry => normalizeText(entry, 240)).filter(Boolean).slice(0, 20)
    : undefined;
  return {
    id,
    kind,
    state,
    title,
    jiraKey: normalizeText(item.jiraKey, 80) || null,
    taskId: normalizeText(item.taskId, 160) || null,
    sessionRef: normalizeSessionRef(item.sessionRef),
    scope: {
      workdir,
      branch: normalizeText(scopeRaw.branch, 240) || null,
      fileGlobs,
    },
    createdAt: normalizeText(item.createdAt, 64) || new Date().toISOString(),
    updatedAt: normalizeText(item.updatedAt, 64) || new Date().toISOString(),
    completedAt: normalizeText(item.completedAt, 64) || null,
  };
}

function touch(record: FocusSandboxRecord): FocusSandboxRecord {
  return { ...record, updatedAt: new Date().toISOString() };
}

export function listFocusSandboxes(filter?: {
  state?: FocusSandboxRecordState | FocusSandboxRecordState[];
  kind?: FocusSandboxKind;
  query?: string;
}): FocusSandboxRecord[] {
  const states = filter?.state
    ? (Array.isArray(filter.state) ? filter.state : [filter.state])
    : null;
  const query = normalizeText(filter?.query, 120).toLowerCase();
  return readFile().sandboxes
    .filter(item => !states || states.includes(item.state))
    .filter(item => !filter?.kind || item.kind === filter.kind)
    .filter(item => !query || item.title.toLowerCase().includes(query) || (item.jiraKey || '').toLowerCase().includes(query))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getFocusSandbox(id: string): FocusSandboxRecord | null {
  return readFile().sandboxes.find(item => item.id === id) || null;
}

export function createFocusSandbox(input: CreateFocusSandboxInput): FocusSandboxRecord {
  const kind = normalizeSandboxKind(input.kind);
  const title = normalizeText(input.title, 400);
  const workdir = normalizeText(input.workdir, 2048);
  if (!kind || !title || !workdir) throw new Error('kind, title, and workdir are required');
  const now = new Date().toISOString();
  const record: FocusSandboxRecord = {
    id: newId(),
    kind,
    state: 'active',
    title,
    jiraKey: normalizeText(input.jiraKey, 80) || null,
    taskId: normalizeText(input.taskId, 160) || null,
    sessionRef: normalizeSessionRef(input.sessionRef),
    scope: {
      workdir,
      branch: normalizeText(input.branch, 240) || null,
      fileGlobs: Array.isArray(input.fileGlobs) ? input.fileGlobs.map(item => normalizeText(item, 240)).filter(Boolean).slice(0, 20) : undefined,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  const file = readFile();
  enforceActiveCapOnCreate(file.sandboxes, record);
  file.sandboxes.unshift(record);
  writeFile(file);
  return record;
}

function enforceActiveCapOnCreate(existing: FocusSandboxRecord[], incoming: FocusSandboxRecord) {
  if (incoming.state !== 'active') return;
  const active = existing.filter(item => item.state === 'active');
  if (active.length < FOCUS_ACTIVE_SANDBOX_CAP) return;
  const demote = active
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .slice(0, active.length - FOCUS_ACTIVE_SANDBOX_CAP + 1);
  for (const item of demote) {
    item.state = 'paused';
    item.updatedAt = new Date().toISOString();
  }
}

export function updateFocusSandbox(id: string, input: UpdateFocusSandboxInput): FocusSandboxRecord | null {
  const file = readFile();
  const index = file.sandboxes.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = file.sandboxes[index];
  const nextState = input.state ? normalizeSandboxState(input.state) : current.state;
  if (!nextState) throw new Error('invalid sandbox state');
  if (!canTransitionSandboxState(current.state, nextState)) throw new Error(`cannot transition from ${current.state} to ${nextState}`);
  let next: FocusSandboxRecord = touch({
    ...current,
    state: nextState,
    title: input.title !== undefined ? normalizeText(input.title, 400) || current.title : current.title,
    scope: {
      ...current.scope,
      branch: input.branch !== undefined ? normalizeText(input.branch, 240) || null : current.scope.branch,
      fileGlobs: input.fileGlobs !== undefined
        ? input.fileGlobs.map(item => normalizeText(item, 240)).filter(Boolean).slice(0, 20)
        : current.scope.fileGlobs,
    },
    completedAt: nextState === 'completed' ? (current.completedAt || new Date().toISOString()) : null,
  });
  if (nextState === 'active') {
    enforceActiveCapOnCreate(file.sandboxes.filter((_, i) => i !== index), next);
  }
  file.sandboxes[index] = next;
  writeFile(file);
  return next;
}

export function promoteFocusSandbox(id: string): FocusSandboxRecord | null {
  return updateFocusSandbox(id, { state: 'active' });
}

export function enforceFocusActiveCap(): FocusSandboxRecord[] {
  const file = readFile();
  const active = file.sandboxes.filter(item => item.state === 'active');
  if (active.length <= FOCUS_ACTIVE_SANDBOX_CAP) return [];
  const demoted: FocusSandboxRecord[] = [];
  const overflow = active
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .slice(0, active.length - FOCUS_ACTIVE_SANDBOX_CAP);
  for (const item of overflow) {
    const index = file.sandboxes.findIndex(entry => entry.id === item.id);
    if (index < 0) continue;
    file.sandboxes[index] = touch({ ...item, state: 'paused' });
    demoted.push(file.sandboxes[index]);
  }
  if (demoted.length) writeFile(file);
  return demoted;
}

export function resetFocusSandboxStoreForTests() {
  writeFile({ version: 1, sandboxes: [] });
}
