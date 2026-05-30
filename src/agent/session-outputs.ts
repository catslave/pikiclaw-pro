/**
 * Session output registry.
 *
 * Agents can create durable documents wherever the workspace policy requires
 * (for example Obsidian), then register a small pointer here so the dashboard
 * can show it in the chat's Output tab.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent, SessionOutput, SessionOutputKind, SessionOutputRef } from './types.js';

const SESSION_WORKSPACE_DIR = 'workspace';
const SESSION_OUTPUTS_FILE = 'outputs.json';
const SESSION_OUTPUTS_DIR = 'outputs';
const MAX_TEXT = 24_000;
const MAX_SUMMARY = 8_000;

export const SESSION_OUTPUT_KINDS: readonly SessionOutputKind[] = [
  'final',
  'document',
  'image',
  'file',
  'diff',
  'estimate',
  'stage-summary',
  'link',
];

export interface SaveSessionOutputInput {
  id?: string;
  kind?: SessionOutputKind;
  title: string;
  summary?: string;
  path?: string;
  url?: string;
  content?: string;
  pinned?: boolean;
}

export interface SaveSessionOutputOptions {
  workspacePath: string;
  workdir?: string;
  agent?: Agent | string;
  sessionId?: string;
  input: SaveSessionOutputInput;
}

function sessionRootFromWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  return path.basename(resolved) === SESSION_WORKSPACE_DIR ? path.dirname(resolved) : resolved;
}

function sessionRefFromWorkspacePath(workspacePath: string, workdir?: string, agent?: string, sessionId?: string): SessionOutputRef {
  const root = sessionRootFromWorkspacePath(workspacePath);
  return {
    workdir: workdir || '',
    agent: agent || path.basename(path.dirname(root)) || '',
    sessionId: sessionId || path.basename(root) || '',
  };
}

function sessionOutputsPath(workspacePath: string): string {
  return path.join(sessionRootFromWorkspacePath(workspacePath), SESSION_OUTPUTS_FILE);
}

function sessionOutputDir(workspacePath: string): string {
  return path.join(path.resolve(workspacePath), SESSION_OUTPUTS_DIR);
}

function normalizeText(value: unknown, max = MAX_TEXT): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function isOutputKind(value: unknown): value is SessionOutputKind {
  return SESSION_OUTPUT_KINDS.includes(value as SessionOutputKind);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'output';
}

function uniqueOutputPath(workspacePath: string, title: string): string {
  const dir = sessionOutputDir(workspacePath);
  fs.mkdirSync(dir, { recursive: true });
  const stem = slugify(title);
  let candidate = path.join(dir, `${stem}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function readOutputsFile(workspacePath: string): SessionOutput[] {
  const file = sessionOutputsPath(workspacePath);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return normalizeSessionOutputs(Array.isArray(parsed?.outputs) ? parsed.outputs : [], workspacePath);
  } catch {
    return [];
  }
}

function writeOutputsFile(workspacePath: string, outputs: SessionOutput[]) {
  const file = sessionOutputsPath(workspacePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, outputs }, null, 2));
  fs.renameSync(tmp, file);
}

export function normalizeSessionOutputs(outputs: unknown[], workspacePath: string, fallback?: Partial<SessionOutputRef>): SessionOutput[] {
  const ref = sessionRefFromWorkspacePath(workspacePath, fallback?.workdir, fallback?.agent, fallback?.sessionId);
  return outputs
    .map((raw: any): SessionOutput | null => {
      if (!raw || typeof raw !== 'object') return null;
      const title = normalizeText(raw.title, 240);
      if (!title) return null;
      const id = normalizeText(raw.id, 180) || `output_${crypto.randomBytes(6).toString('hex')}`;
      const session = raw.session && typeof raw.session === 'object'
        ? {
          workdir: normalizeText(raw.session.workdir, 2048) || ref.workdir,
          agent: normalizeText(raw.session.agent, 80) || ref.agent,
          sessionId: normalizeText(raw.session.sessionId, 240) || ref.sessionId,
        }
        : ref;
      return {
        id,
        kind: isOutputKind(raw.kind) ? raw.kind : 'document',
        title,
        summary: normalizeText(raw.summary, MAX_SUMMARY) || undefined,
        taskId: normalizeText(raw.taskId, 180) || `session:${ref.sessionId}`,
        stageRunId: normalizeText(raw.stageRunId, 180) || undefined,
        session,
        turnIndex: typeof raw.turnIndex === 'number' && Number.isFinite(raw.turnIndex) ? raw.turnIndex : undefined,
        path: normalizeText(raw.path, 4096) || undefined,
        url: normalizeText(raw.url, 4096) || undefined,
        createdAt: normalizeText(raw.createdAt, 80) || new Date().toISOString(),
        pinned: raw.pinned === true,
      };
    })
    .filter((output): output is SessionOutput => !!output)
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export function readSessionOutputs(workspacePath: string, fallback?: Partial<SessionOutputRef>): SessionOutput[] {
  return normalizeSessionOutputs(readOutputsFile(workspacePath), workspacePath, fallback);
}

export function saveSessionOutput(opts: SaveSessionOutputOptions): SessionOutput {
  const title = normalizeText(opts.input.title, 240) || 'Output';
  const existingOutputs = readOutputsFile(opts.workspacePath);
  const existing = opts.input.id ? existingOutputs.find(output => output.id === opts.input.id) : null;
  let outputPath = normalizeText(opts.input.path, 4096) || existing?.path || '';
  const content = normalizeText(opts.input.content, MAX_TEXT);
  if (content) {
    outputPath = existing?.path || outputPath || uniqueOutputPath(opts.workspacePath, title);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content.endsWith('\n') ? content : `${content}\n`);
  }

  const ref = sessionRefFromWorkspacePath(opts.workspacePath, opts.workdir, opts.agent, opts.sessionId);
  const output: SessionOutput = {
    id: normalizeText(opts.input.id, 180) || existing?.id || `output_${crypto.randomBytes(6).toString('hex')}`,
    kind: isOutputKind(opts.input.kind) ? opts.input.kind : (existing?.kind || 'document'),
    title,
    summary: normalizeText(opts.input.summary, MAX_SUMMARY) || existing?.summary || undefined,
    taskId: existing?.taskId || `session:${ref.sessionId}`,
    session: ref,
    path: outputPath || undefined,
    url: normalizeText(opts.input.url, 4096) || existing?.url || undefined,
    createdAt: existing?.createdAt || new Date().toISOString(),
    pinned: opts.input.pinned === true || existing?.pinned === true,
  };

  const next = [output, ...existingOutputs.filter(item => item.id !== output.id)]
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  writeOutputsFile(opts.workspacePath, next);
  return output;
}

export function resolveOutputPathAlias(value: string, workspacePath: string, workdir?: string): string {
  const raw = normalizeText(value, 4096);
  if (!raw) return '';
  if (raw.startsWith('@workspace/')) return path.resolve(workspacePath, raw.slice('@workspace/'.length));
  if (raw === '@workspace') return path.resolve(workspacePath);
  if (workdir && raw.startsWith('@workdir/')) return path.resolve(workdir, raw.slice('@workdir/'.length));
  if (workdir && raw === '@workdir') return path.resolve(workdir);
  if (raw.startsWith('~/')) return path.join(process.env.HOME || '', raw.slice(2));
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(workspacePath, raw);
}
