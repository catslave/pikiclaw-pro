/**
 * Session workspace management, metadata persistence, classification, and export/import.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ManagedSessionRecord,
  SessionTitleSource,
  SessionRunState,
  SessionClassification,
  SessionInfo,
  StreamResult,
  StreamPreviewPlan,
  Agent,
  SessionMessagesOpts,
  SessionMessagesResult,
  TailMessage,
  RichMessage,
  ExportSessionOpts,
  ExportSessionResult,
  ImportSessionOpts,
  ImportSessionResult,
  StreamOpts,
  EnsureManagedSessionOpts,
  StageSessionFilesOpts,
  StageSessionFilesResult,
  SessionListOpts,
  SessionListResult,
  SessionTailOpts,
  SessionTailResult,
  SessionMessagesWindow,
  HandoverRef,
  SessionSideChatParentRef,
  SessionSideChatRef,
  SessionOrigin,
} from './types.js';
import {
  dedupeStrings,
  shortValue,
  firstNonEmptyLine,
  normalizeErrorMessage,
  normalizeStreamPreviewPlan,
  isPendingSessionId,
  agentLog,
} from './utils.js';
import { getDriver } from './driver.js';
import { collapseSkillPrompt } from './skills.js';
import { SESSION_RUNNING_THRESHOLD_MS } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string) { fs.mkdirSync(dirPath, { recursive: true }); }

function readJsonFile<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T; } catch { return fallback; }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function removeFileIfExists(filePath: string) { try { fs.rmSync(filePath, { force: true }); } catch {} }

function trimSessionText(value: unknown, max = 24_000): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIKICLAW_DIR = '.pikiclaw';
const PIKICLAW_SESSIONS_DIR = path.join(PIKICLAW_DIR, 'sessions');
const PIKICLAW_SESSION_INDEX = path.join(PIKICLAW_SESSIONS_DIR, 'index.json');
const PIKICLAW_LEGACY_WORKSPACES_DIR = path.join(PIKICLAW_DIR, 'workspaces');
const SESSION_WORKSPACE_DIR = 'workspace';
const SESSION_META_FILE = 'session.json';
// return.json and artifact constants removed — file return is now handled by MCP bridge

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function sessionIndexPath(workdir: string): string { return path.join(workdir, PIKICLAW_SESSION_INDEX); }
function sessionDirPath(workdir: string, agent: Agent, sessionId: string): string { return path.join(workdir, PIKICLAW_SESSIONS_DIR, agent, sessionId); }
function legacySessionWorkspacePath(workdir: string, agent: Agent, sessionId: string): string { return path.join(workdir, PIKICLAW_LEGACY_WORKSPACES_DIR, agent, sessionId); }
function sessionWorkspacePath(workdir: string, agent: Agent, sessionId: string): string { return path.join(sessionDirPath(workdir, agent, sessionId), SESSION_WORKSPACE_DIR); }
function sessionRootFromWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  return path.basename(resolved) === SESSION_WORKSPACE_DIR ? path.dirname(resolved) : resolved;
}
function sessionMetaPath(workspacePath: string): string { return path.join(sessionRootFromWorkspacePath(workspacePath), SESSION_META_FILE); }
function legacySessionMetaPath(workspacePath: string): string { return path.join(workspacePath, PIKICLAW_DIR, SESSION_META_FILE); }

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

/** Generate a temporary session ID for new sessions before the agent assigns one. */
function nextPendingSessionId(): string { return `pending_${crypto.randomBytes(6).toString('hex')}`; }
function nextThreadId(): string { return `thread_${crypto.randomBytes(6).toString('hex')}`; }
function legacyThreadId(agent: Agent, sessionId: string): string { return `legacy:${agent}:${sessionId}`; }
function normalizeThreadId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSessionTitleSource(value: unknown): SessionTitleSource | null {
  return value === 'prompt' || value === 'agent' || value === 'user' ? value : null;
}

function promptDerivedTitle(prompt: string | null | undefined): string | null {
  return summarizePromptTitle(prompt) || null;
}

function canAdoptAgentTitle(record: Pick<ManagedSessionRecord | SessionInfo, 'title' | 'titleSource'>): boolean {
  if (record.titleSource === 'prompt') return true;
  return !record.title && !record.titleSource;
}

function nativeAgentTitle(native: Pick<SessionInfo, 'title' | 'titleSource'> | null | undefined): string | null {
  if (!native || native.titleSource !== 'agent') return null;
  return promptDerivedTitle(native.title);
}

// ---------------------------------------------------------------------------
// Run state helpers
// ---------------------------------------------------------------------------

function normalizeSessionRunState(rawState: unknown): SessionRunState {
  const state = typeof rawState === 'string' ? rawState.trim().toLowerCase() : '';
  if (state === 'completed' || state === 'incomplete' || state === 'running') return state;
  return 'completed';
}

function normalizeSessionRunDetail(_rawState: unknown, rawDetail: unknown): string | null {
  const detail = typeof rawDetail === 'string' ? rawDetail.trim() : '';
  if (detail) return shortValue(detail, 180);
  return null;
}

function normalizeSessionRunUpdatedAt(rawUpdatedAt: unknown, fallback: string): string {
  return typeof rawUpdatedAt === 'string' && rawUpdatedAt.trim() ? rawUpdatedAt : fallback;
}

export function setSessionRunState(record: ManagedSessionRecord, runState: SessionRunState, runDetail: string | null, runUpdatedAt?: string) {
  record.runState = runState;
  record.runDetail = runDetail ? shortValue(runDetail, 180) : null;
  record.runUpdatedAt = runUpdatedAt || new Date().toISOString();
  record.runPid = runState === 'running' ? process.pid : null;
}

function incompleteRunDetail(result: Pick<StreamResult, 'error' | 'stopReason' | 'message'>): string | null {
  if (result.stopReason === 'interrupted') return 'Interrupted by user.';
  if (result.stopReason === 'timeout') return 'Timed out before completion.';
  if (result.stopReason === 'max_tokens') return 'Stopped before completion: max tokens reached.';
  const error = normalizeErrorMessage(result.error);
  if (error) return shortValue(error, 180);
  const stopReason = normalizeErrorMessage(result.stopReason);
  if (stopReason) return `Stopped before completion: ${shortValue(stopReason, 120)}`;
  const message = firstNonEmptyLine(result.message || '');
  return message ? shortValue(message, 180) : 'Last run did not complete.';
}

/**
 * Check whether a process is still alive. Returns true when the PID exists and we can
 * signal it, false when the process is definitively gone, and null when we cannot tell
 * (e.g. owned by a different user — permission denied).
 */
export function isProcessAlive(pid: number | null | undefined): boolean | null {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err?.code === 'ESRCH') return false;
    if (err?.code === 'EPERM') return true;
    return null;
  }
}

/**
 * Heuristic staleness check for a session record marked 'running'. Returns true when
 * the record should be downgraded to 'incomplete' — i.e. the owning process is gone,
 * or (if PID is missing) the last update is older than `ageThresholdMs`.
 *
 * Returns false if the session might still be live and should be left alone.
 */
export function isRunningSessionStale(
  record: Pick<ManagedSessionRecord, 'runState' | 'runPid' | 'runUpdatedAt'>,
  ageThresholdMs: number,
): boolean {
  if (record.runState !== 'running') return false;
  const alive = isProcessAlive(record.runPid ?? null);
  if (alive === false) return true;
  if (alive === true) return false;
  const age = record.runUpdatedAt ? Date.now() - Date.parse(record.runUpdatedAt) : Infinity;
  return age > ageThresholdMs;
}

/**
 * Scan the session index for a workdir and downgrade any 'running' record whose
 * owning process is no longer alive (or that has gone stale past `ageThresholdMs`).
 * Returns the number of records downgraded. Safe to call at startup and periodically.
 */
export function reconcileOrphanedRunningSessions(workdir: string, ageThresholdMs = 30 * 60_000): number {
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  const downgraded: ManagedSessionRecord[] = [];
  for (const record of index.sessions) {
    if (!isRunningSessionStale(record, ageThresholdMs)) continue;
    setSessionRunState(record, 'incomplete', 'Process exited before reporting completion.');
    downgraded.push(record);
  }
  if (downgraded.length > 0) {
    writeSessionIndex(resolvedWorkdir, index.sessions);
    for (const record of downgraded) {
      try { writeSessionMeta(record); } catch {}
    }
    agentLog(`[sessions] reconciled ${downgraded.length} orphaned running session(s) in ${resolvedWorkdir}`);
  }
  return downgraded.length;
}

export function applySessionRunResult(
  record: ManagedSessionRecord,
  result: Pick<StreamResult, 'ok' | 'incomplete' | 'error' | 'stopReason' | 'message'> & { activity?: string | null },
) {
  if (result.ok && !result.incomplete) {
    setSessionRunState(record, 'completed', null);
  } else {
    setSessionRunState(record, 'incomplete', incompleteRunDetail(result));
  }

  // Auto-classify the stream result
  const classification = classifySession({ ...result, activity: result.activity ?? null });
  record.classification = classification;
  // Only set userStatus if not manually overridden by the user
  if (!record.userStatus) {
    record.userStatus = deriveUserStatus(classification.outcome);
  }
}

// ---------------------------------------------------------------------------
// Record normalization
// ---------------------------------------------------------------------------

interface SessionIndexData {
  version: number;
  sessions: ManagedSessionRecord[];
}

interface EnsureSessionWorkspaceOpts {
  agent: Agent;
  workdir: string;
  sessionId?: string | null;
  title?: string | null;
  threadId?: string | null;
  handoverFrom?: HandoverRef | null;
  origin?: Partial<SessionOrigin> | null;
}

function normalizeHandoverRef(value: unknown): HandoverRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { agent?: unknown; sessionId?: unknown };
  const agent = typeof v.agent === 'string' ? v.agent.trim() : '';
  const sessionId = typeof v.sessionId === 'string' ? v.sessionId.trim() : '';
  if (!agent || !sessionId) return null;
  return { agent: agent as Agent, sessionId };
}

function normalizeSessionOrigin(value: unknown, fallbackCreatedAt?: string | null): SessionOrigin | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SessionOrigin>;
  const channel = typeof v.channel === 'string' ? v.channel.trim() : '';
  const chatId = typeof v.chatId === 'string' ? v.chatId.trim() : '';
  if (!channel || !chatId) return null;
  const now = new Date().toISOString();
  const createdAt = typeof v.createdAt === 'string' && v.createdAt.trim()
    ? v.createdAt
    : (fallbackCreatedAt || now);
  const updatedAt = typeof v.updatedAt === 'string' && v.updatedAt.trim()
    ? v.updatedAt
    : now;
  return {
    channel,
    chatId,
    chatType: typeof v.chatType === 'string' && v.chatType.trim() ? v.chatType.trim() : null,
    sourceMessageId: typeof v.sourceMessageId === 'string' && v.sourceMessageId.trim() ? v.sourceMessageId.trim() : null,
    userId: typeof v.userId === 'string' && v.userId.trim() ? v.userId.trim() : null,
    openId: typeof v.openId === 'string' && v.openId.trim() ? v.openId.trim() : null,
    createdAt,
    updatedAt,
  };
}

function normalizeSideChatParentRef(value: unknown): SessionSideChatParentRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { agent?: unknown; sessionId?: unknown };
  const agent = typeof v.agent === 'string' ? v.agent.trim() : '';
  const sessionId = typeof v.sessionId === 'string' ? v.sessionId.trim() : '';
  if (!agent || !sessionId) return null;
  return { agent: agent as Agent, sessionId };
}

function normalizeSideChatRef(value: unknown): SessionSideChatRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const parent = normalizeSideChatParentRef(value);
  if (!parent) return null;
  const createdAt = typeof v.createdAt === 'string' && v.createdAt.trim() ? v.createdAt : new Date().toISOString();
  const updatedAt = typeof v.updatedAt === 'string' && v.updatedAt.trim() ? v.updatedAt : createdAt;
  return {
    ...parent,
    title: typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null,
    createdAt,
    updatedAt,
    userStatus: v.userStatus === 'inbox' || v.userStatus === 'active' || v.userStatus === 'review' || v.userStatus === 'done' || v.userStatus === 'parked'
      ? v.userStatus
      : null,
    ...(v.hidden === true ? { hidden: true } : {}),
  };
}

function normalizeSideChatRefs(value: unknown): SessionSideChatRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: SessionSideChatRef[] = [];
  for (const entry of value) {
    const ref = normalizeSideChatRef(entry);
    if (!ref) continue;
    const key = `${ref.agent}:${ref.sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

interface SessionWorkspaceInfo {
  sessionId: string;
  workspacePath: string;
  record: ManagedSessionRecord;
}

function normalizeSessionRecord(raw: any, workdir: string): ManagedSessionRecord | null {
  // Support both new format (sessionId) and legacy format (localSessionId + engineSessionId)
  const sessionId = typeof raw?.sessionId === 'string' ? raw.sessionId.trim()
    : typeof raw?.engineSessionId === 'string' && raw.engineSessionId.trim() ? raw.engineSessionId.trim()
    : typeof raw?.localSessionId === 'string' ? raw.localSessionId.trim()
    : '';
  const agent = typeof raw?.agent === 'string' ? raw.agent.trim() : null;
  if (!sessionId || !agent) return null;
  const workspacePath = typeof raw?.workspacePath === 'string' && raw.workspacePath.trim()
    ? path.resolve(raw.workspacePath)
    : sessionWorkspacePath(workdir, agent, sessionId);
  return {
    sessionId, agent, workdir,
    workspacePath,
    threadId: normalizeThreadId(raw?.threadId) || legacyThreadId(agent, sessionId),
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : new Date().toISOString(),
    origin: normalizeSessionOrigin(raw?.origin, typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : null),
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : null,
    titleSource: normalizeSessionTitleSource(raw?.titleSource),
    model: typeof raw?.model === 'string' && raw.model.trim() ? raw.model.trim() : null,
    thinkingEffort: typeof raw?.thinkingEffort === 'string' && raw.thinkingEffort.trim() ? raw.thinkingEffort.trim() : null,
    stagedFiles: Array.isArray(raw?.stagedFiles) ? dedupeStrings(raw.stagedFiles.filter((v: unknown) => typeof v === 'string')) : [],
    runState: normalizeSessionRunState(raw?.runState),
    runDetail: normalizeSessionRunDetail(raw?.runState, raw?.runDetail),
    runUpdatedAt: normalizeSessionRunUpdatedAt(raw?.runUpdatedAt, typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : new Date().toISOString()),
    runPid: typeof raw?.runPid === 'number' && Number.isFinite(raw.runPid) ? raw.runPid : null,
    classification: raw?.classification ?? null,
    userStatus: raw?.userStatus ?? null,
    userNote: typeof raw?.userNote === 'string' ? raw.userNote : null,
    pinned: raw?.pinned === true,
    archived: raw?.archived === true,
    archivedAt: typeof raw?.archivedAt === 'string' && raw.archivedAt.trim() ? raw.archivedAt : null,
    lastQuestion: typeof raw?.lastQuestion === 'string' ? raw.lastQuestion : null,
    lastAnswer: typeof raw?.lastAnswer === 'string' ? raw.lastAnswer : null,
    lastMessageText: typeof raw?.lastMessageText === 'string' ? raw.lastMessageText : null,
    lastThinking: trimSessionText(raw?.lastThinking),
    lastPlan: normalizeStreamPreviewPlan(raw?.lastPlan),
    migratedFrom: raw?.migratedFrom ?? null,
    migratedTo: raw?.migratedTo ?? null,
    linkedSessions: Array.isArray(raw?.linkedSessions) ? raw.linkedSessions : [],
    sideChatOf: normalizeSideChatParentRef(raw?.sideChatOf),
    sideChats: normalizeSideChatRefs(raw?.sideChats),
    handoverFrom: normalizeHandoverRef(raw?.handoverFrom),
  };
}

// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

function loadSessionIndex(workdir: string): SessionIndexData {
  const parsed = readJsonFile<any>(sessionIndexPath(workdir), { version: 1, sessions: [] });
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  return {
    version: 1,
    sessions: sessions
      .map((entry: any) => normalizeSessionRecord(entry, workdir))
      .filter((entry: ManagedSessionRecord | null): entry is ManagedSessionRecord => !!entry)
      .filter((entry: ManagedSessionRecord) => !isPendingSessionId(entry.sessionId) || fs.existsSync(sessionRootFromWorkspacePath(entry.workspacePath))),
  };
}

function writeSessionIndex(workdir: string, sessions: ManagedSessionRecord[]) {
  writeJsonFile(sessionIndexPath(workdir), { version: 1, sessions });
}

function writeSessionMeta(record: ManagedSessionRecord) {
  writeJsonFile(sessionMetaPath(record.workspacePath), {
    sessionId: record.sessionId, agent: record.agent, workdir: record.workdir,
    workspacePath: record.workspacePath,
    threadId: record.threadId,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    title: record.title, titleSource: record.titleSource ?? null, model: record.model, thinkingEffort: record.thinkingEffort, stagedFiles: record.stagedFiles,
    runState: record.runState, runDetail: record.runDetail, runUpdatedAt: record.runUpdatedAt,
    runPid: record.runPid,
    classification: record.classification,
    userStatus: record.userStatus,
    userNote: record.userNote,
    pinned: record.pinned === true,
    archived: record.archived === true,
    archivedAt: record.archivedAt ?? null,
    lastQuestion: record.lastQuestion,
    lastAnswer: record.lastAnswer,
    lastMessageText: record.lastMessageText,
    lastThinking: record.lastThinking,
    lastPlan: record.lastPlan,
    migratedFrom: record.migratedFrom,
    migratedTo: record.migratedTo,
    linkedSessions: record.linkedSessions,
    sideChatOf: record.sideChatOf ?? null,
    sideChats: record.sideChats ?? [],
    handoverFrom: record.handoverFrom ?? null,
  });
}

// ---------------------------------------------------------------------------
// File / directory helpers
// ---------------------------------------------------------------------------

function copyPath(sourcePath: string, targetPath: string) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) { fs.cpSync(sourcePath, targetPath, { recursive: true, force: true }); return; }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function createSessionDirAlias(aliasPath: string, targetPath: string) {
  if (fs.existsSync(aliasPath) || !fs.existsSync(targetPath)) return;
  try {
    ensureDir(path.dirname(aliasPath));
    const relativeTarget = path.relative(path.dirname(aliasPath), targetPath) || '.';
    fs.symlinkSync(relativeTarget, aliasPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {}
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function migrateSessionLayout(workdir: string, record: ManagedSessionRecord): ManagedSessionRecord {
  const targetSessionDir = sessionDirPath(workdir, record.agent, record.sessionId);
  const targetWorkspacePath = sessionWorkspacePath(workdir, record.agent, record.sessionId);
  const currentWorkspacePath = path.resolve(record.workspacePath || targetWorkspacePath);
  const legacyWp = path.resolve(legacySessionWorkspacePath(workdir, record.agent, record.sessionId));

  ensureDir(targetSessionDir);
  ensureDir(targetWorkspacePath);

  for (const sourceWorkspacePath of dedupeStrings([currentWorkspacePath, legacyWp])) {
    if (sourceWorkspacePath === targetWorkspacePath || !fs.existsSync(sourceWorkspacePath)) continue;
    if (!fs.statSync(sourceWorkspacePath).isDirectory()) continue;
    for (const entry of fs.readdirSync(sourceWorkspacePath)) {
      if (entry === PIKICLAW_DIR) continue;
      copyPath(path.join(sourceWorkspacePath, entry), path.join(targetWorkspacePath, entry));
    }
    if (sourceWorkspacePath === legacyWp) fs.rmSync(sourceWorkspacePath, { recursive: true, force: true });
  }
  record.workspacePath = path.resolve(targetWorkspacePath);
  return record;
}

// ---------------------------------------------------------------------------
// Save / update
// ---------------------------------------------------------------------------

function upsertSideChatRef(parent: ManagedSessionRecord, child: ManagedSessionRecord, now: string) {
  const refs = Array.isArray(parent.sideChats) ? parent.sideChats : [];
  const nextRef: SessionSideChatRef = {
    agent: child.agent,
    sessionId: child.sessionId,
    title: child.title,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt || now,
    userStatus: child.userStatus ?? null,
  };
  const idx = refs.findIndex(ref => ref.agent === child.agent && ref.sessionId === child.sessionId);
  parent.sideChats = idx >= 0
    ? refs.map((ref, i) => i === idx ? { ...ref, ...nextRef, hidden: ref.hidden === true ? true : undefined } : ref)
    : [...refs, nextRef];
}

export function saveSessionRecord(workdir: string, record: ManagedSessionRecord): ManagedSessionRecord {
  record = migrateSessionLayout(workdir, record);
  ensureDir(sessionDirPath(workdir, record.agent, record.sessionId));
  ensureDir(record.workspacePath);
  const index = loadSessionIndex(workdir);
  record.threadId = normalizeThreadId(record.threadId) || legacyThreadId(record.agent, record.sessionId);
  record.updatedAt = new Date().toISOString();
  const pos = index.sessions.findIndex(entry => entry.agent === record.agent && entry.sessionId === record.sessionId);
  if (pos >= 0) index.sessions[pos] = record;
  else index.sessions.unshift(record);
  const parentRef = record.sideChatOf;
  const parentRecord = parentRef
    ? index.sessions.find(entry => entry.agent === parentRef.agent && entry.sessionId === parentRef.sessionId)
    : null;
  if (parentRecord) {
    upsertSideChatRef(parentRecord, record, record.updatedAt);
    parentRecord.updatedAt = record.updatedAt;
  }
  index.sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  writeSessionIndex(workdir, index.sessions);
  if (parentRecord) writeSessionMeta(parentRecord);
  writeSessionMeta(record);
  return record;
}

/**
 * Update mutable session metadata (classification, userStatus, userNote, links, migration).
 * User-owned metadata can be written to native-only sessions by creating a lightweight
 * managed overlay, so actions like pin/rename persist for sessions discovered from an
 * agent's own history.
 */
export function updateSessionMeta(
  workdir: string,
  agent: Agent,
  sessionId: string,
  patch: Partial<Pick<ManagedSessionRecord, 'title' | 'userStatus' | 'userNote' | 'pinned' | 'archived' | 'classification' | 'migratedFrom' | 'migratedTo'>> & {
    addLink?: { agent: Agent; sessionId: string };
  },
): boolean {
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  let record = index.sessions.find(s => s.sessionId === sessionId && s.agent === agent);
  if (!record) {
    const canCreateMetadataOverlay = (
      patch.title !== undefined
      || patch.userStatus !== undefined
      || patch.userNote !== undefined
      || patch.pinned !== undefined
      || patch.archived !== undefined
    );
    if (!canCreateMetadataOverlay) return false;

    const now = new Date().toISOString();
    record = {
      sessionId,
      agent,
      workdir: resolvedWorkdir,
      workspacePath: sessionWorkspacePath(resolvedWorkdir, agent, sessionId),
      threadId: legacyThreadId(agent, sessionId),
      createdAt: now,
      updatedAt: now,
      origin: null,
      title: null,
      titleSource: null,
      model: null,
      thinkingEffort: null,
      stagedFiles: [],
      runState: 'completed',
      runDetail: null,
      runUpdatedAt: null,
      runPid: null,
      classification: null,
      userStatus: null,
      userNote: null,
      pinned: false,
      archived: false,
      archivedAt: null,
      lastQuestion: null,
      lastAnswer: null,
      lastMessageText: null,
      lastThinking: null,
      lastPlan: null,
      migratedFrom: null,
      migratedTo: null,
      linkedSessions: [],
      sideChatOf: null,
      sideChats: [],
      handoverFrom: null,
    };
    index.sessions.unshift(record);
  }

  if (patch.title !== undefined) {
    record.title = patch.title;
    record.titleSource = patch.title ? 'user' : null;
  }
  if (patch.userStatus !== undefined) record.userStatus = patch.userStatus;
  if (patch.userNote !== undefined) record.userNote = patch.userNote;
  if (patch.pinned !== undefined) record.pinned = patch.pinned === true;
  if (patch.archived !== undefined) {
    record.archived = patch.archived === true;
    record.archivedAt = record.archived ? (record.archivedAt || new Date().toISOString()) : null;
  }
  if (patch.classification !== undefined) record.classification = patch.classification;
  if (patch.migratedFrom !== undefined) record.migratedFrom = patch.migratedFrom;
  if (patch.migratedTo !== undefined) record.migratedTo = patch.migratedTo;
  if (patch.addLink) {
    if (!record.linkedSessions) record.linkedSessions = [];
    const exists = record.linkedSessions.some(
      l => l.agent === patch.addLink!.agent && l.sessionId === patch.addLink!.sessionId,
    );
    if (!exists) record.linkedSessions.push(patch.addLink);
  }

  record.updatedAt = new Date().toISOString();
  const parentRef = record.sideChatOf;
  const parentRecord = parentRef
    ? index.sessions.find(entry => entry.agent === parentRef.agent && entry.sessionId === parentRef.sessionId)
    : null;
  if (parentRecord) {
    upsertSideChatRef(parentRecord, record, record.updatedAt);
    parentRecord.updatedAt = record.updatedAt;
    writeSessionMeta(parentRecord);
  }
  writeSessionIndex(resolvedWorkdir, index.sessions);
  writeSessionMeta(record);
  return true;
}

export function adoptAgentSessionTitle(workdir: string, agent: Agent, sessionId: string, title: string | null | undefined): boolean {
  const nextTitle = promptDerivedTitle(title);
  if (!nextTitle) return false;
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  const record = index.sessions.find(s => s.sessionId === sessionId && s.agent === agent);
  if (!record || !canAdoptAgentTitle(record)) return false;

  record.title = nextTitle;
  record.titleSource = 'agent';
  record.updatedAt = new Date().toISOString();

  const parentRef = record.sideChatOf;
  const parentRecord = parentRef
    ? index.sessions.find(entry => entry.agent === parentRef.agent && entry.sessionId === parentRef.sessionId)
    : null;
  if (parentRecord) {
    upsertSideChatRef(parentRecord, record, record.updatedAt);
    parentRecord.updatedAt = record.updatedAt;
    writeSessionMeta(parentRecord);
  }
  writeSessionIndex(resolvedWorkdir, index.sessions);
  writeSessionMeta(record);
  return true;
}

export function adoptNativeSessionTitles(
  workdir: string,
  agent: Agent,
  managedSessions: SessionInfo[],
  nativeSessions: SessionInfo[],
): SessionInfo[] {
  const nativeById = new Map<string, SessionInfo>();
  for (const native of nativeSessions) {
    if (native.sessionId) nativeById.set(native.sessionId, native);
  }
  return managedSessions.map((managed) => {
    if (!managed.sessionId || !canAdoptAgentTitle(managed)) return managed;
    const nextTitle = nativeAgentTitle(nativeById.get(managed.sessionId));
    if (!nextTitle) return managed;
    if (!adoptAgentSessionTitle(workdir, agent, managed.sessionId, nextTitle)) return managed;
    return { ...managed, title: nextTitle, titleSource: 'agent' };
  });
}

/**
 * Promote a pending session to a real session ID. Renames the workspace directory
 * and updates the index. Called after the first stream returns the agent's native ID.
 */
export function promoteSessionId(workdir: string, agent: Agent, pendingId: string, nativeId: string): void {
  if (!isPendingSessionId(pendingId) || !nativeId.trim()) return;
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  const record = index.sessions.find(entry => entry.sessionId === pendingId && entry.agent === agent);
  if (!record) return;

  const oldDir = sessionDirPath(resolvedWorkdir, agent, pendingId);
  const newDir = sessionDirPath(resolvedWorkdir, agent, nativeId);

  // Move workspace directory if it exists
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    try { fs.renameSync(oldDir, newDir); } catch { /* cross-device: copy+delete */ try { fs.cpSync(oldDir, newDir, { recursive: true }); fs.rmSync(oldDir, { recursive: true, force: true }); } catch {} }
    createSessionDirAlias(oldDir, newDir);
  }

  writeSessionIndex(
    resolvedWorkdir,
    index.sessions.filter(entry => entry.agent !== agent || (entry.sessionId !== pendingId && entry.sessionId !== nativeId)),
  );
  record.sessionId = nativeId;
  record.workspacePath = sessionWorkspacePath(resolvedWorkdir, agent, nativeId);
  if (record.sideChatOf) {
    const parent = index.sessions.find(entry => (
      entry.agent === record.sideChatOf!.agent
      && entry.sessionId === record.sideChatOf!.sessionId
    ));
    if (parent?.sideChats?.length) {
      const now = new Date().toISOString();
      parent.sideChats = parent.sideChats.map(ref => (
        ref.agent === agent && ref.sessionId === pendingId
          ? { ...ref, sessionId: nativeId, title: record.title ?? ref.title, updatedAt: now }
          : ref
      ));
      parent.updatedAt = now;
      writeSessionMeta(parent);
      const refreshed = loadSessionIndex(resolvedWorkdir);
      const parentIdx = refreshed.sessions.findIndex(entry => entry.agent === parent.agent && entry.sessionId === parent.sessionId);
      if (parentIdx >= 0) {
        refreshed.sessions[parentIdx] = parent;
        writeSessionIndex(resolvedWorkdir, refreshed.sessions);
      }
    }
  }
  saveSessionRecord(resolvedWorkdir, record);
}

// ---------------------------------------------------------------------------
// Fork lineage
// ---------------------------------------------------------------------------

/**
 * Record a fork relationship between two pikiclaw-managed sessions.
 *
 * Sets `migratedFrom` (with kind='fork' + forkedAtTurn) on the child and
 * appends the reverse link on the parent's `linkedSessions`. Both sides also
 * get `migratedTo` set on the parent so the child is a discoverable twin.
 *
 * No-op if either record is missing — call sites are expected to ensure both
 * managed records exist (the child is created via the fork stream completion).
 */
export function recordFork(workdir: string, opts: {
  parent: { agent: Agent; sessionId: string };
  child: { agent: Agent; sessionId: string };
  atTurn: number;
}): void {
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  const parent = index.sessions.find(e => e.agent === opts.parent.agent && e.sessionId === opts.parent.sessionId);
  const child = index.sessions.find(e => e.agent === opts.child.agent && e.sessionId === opts.child.sessionId);
  if (!parent || !child) return;

  child.migratedFrom = {
    agent: parent.agent,
    sessionId: parent.sessionId,
    kind: 'fork',
    forkedAtTurn: opts.atTurn,
  };
  if (!parent.linkedSessions) parent.linkedSessions = [];
  const childRef = { agent: child.agent, sessionId: child.sessionId, kind: 'fork' as const, forkedAtTurn: opts.atTurn };
  if (!parent.linkedSessions.some(l => l.agent === child.agent && l.sessionId === child.sessionId)) {
    parent.linkedSessions.push(childRef);
  }

  child.updatedAt = new Date().toISOString();
  parent.updatedAt = new Date().toISOString();
  writeSessionIndex(resolvedWorkdir, index.sessions);
  writeSessionMeta(parent);
  writeSessionMeta(child);
}

export function recordSideChat(workdir: string, opts: {
  parent: { agent: Agent; sessionId: string };
  child: { agent: Agent; sessionId: string };
}): boolean {
  const resolvedWorkdir = path.resolve(workdir);
  const index = loadSessionIndex(resolvedWorkdir);
  const parent = index.sessions.find(e => e.agent === opts.parent.agent && e.sessionId === opts.parent.sessionId);
  const child = index.sessions.find(e => e.agent === opts.child.agent && e.sessionId === opts.child.sessionId);
  if (!parent || !child) return false;

  const now = new Date().toISOString();
  child.sideChatOf = { agent: parent.agent, sessionId: parent.sessionId };
  upsertSideChatRef(parent, child, now);
  parent.updatedAt = now;
  child.updatedAt = now;

  writeSessionIndex(resolvedWorkdir, index.sessions);
  writeSessionMeta(parent);
  writeSessionMeta(child);
  return true;
}

// ---------------------------------------------------------------------------
// Identity sync
// ---------------------------------------------------------------------------

export function syncManagedSessionIdentity(session: SessionWorkspaceInfo, workdir: string, nativeId: string): boolean {
  const resolvedId = nativeId.trim();
  if (!resolvedId || session.sessionId === resolvedId) return false;

  const resolvedWorkdir = path.resolve(workdir);
  const previousId = session.sessionId;
  if (isPendingSessionId(previousId)) {
    // Pending → native: move the workspace dir into the native slot and
    // remove the pending index entry (handled by promoteSessionId).
    promoteSessionId(resolvedWorkdir, session.record.agent, previousId, resolvedId);
  } else {
    // Native → native rotation (Claude `--resume` can rewrite the session id
    // mid-stream). Drop the old index entry so the dashboard does not show a
    // stale duplicate; both jsonl files stay on disk and the workspace stays
    // under its original native id (the next saveSessionRecord will lay down
    // a fresh dir under the new id).
    const index = loadSessionIndex(resolvedWorkdir);
    const filtered = index.sessions.filter(e => !(e.agent === session.record.agent && e.sessionId === previousId));
    if (filtered.length !== index.sessions.length) writeSessionIndex(resolvedWorkdir, filtered);
  }

  session.sessionId = resolvedId;
  session.workspacePath = sessionWorkspacePath(resolvedWorkdir, session.record.agent, resolvedId);
  session.record.sessionId = resolvedId;
  session.record.workspacePath = session.workspacePath;
  return true;
}

// ---------------------------------------------------------------------------
// Title / filename helpers
// ---------------------------------------------------------------------------

export function summarizePromptTitle(prompt: string | null | undefined): string | null {
  const raw = String(prompt || '').replace(/\r\n?/g, '\n');
  const text = firstNonEmptyLine(raw).replace(/\s+/g, ' ').trim()
    || raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= 120 ? text : `${text.slice(0, 117).trimEnd()}...`;
}

function safeWorkspaceFilename(filename: string): string {
  const base = path.basename(filename || 'file');
  const sanitized = base.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').trim();
  return sanitized || `file-${Date.now()}`;
}

function uniqueWorkspaceFilename(workspacePath: string, desiredName: string): string {
  const ext = path.extname(desiredName);
  const stem = ext ? desiredName.slice(0, -ext.length) : desiredName;
  let candidate = desiredName;
  let index = 2;
  while (fs.existsSync(path.join(workspacePath, candidate))) { candidate = `${stem}-${index}${ext}`; index++; }
  return candidate;
}

// ---------------------------------------------------------------------------
// Workspace file import
// ---------------------------------------------------------------------------

export function importFilesIntoWorkspace(workspacePath: string, files: string[]): string[] {
  const imported: string[] = [];
  const realWorkspace = fs.realpathSync(workspacePath);
  for (const filePath of files) {
    const sourcePath = path.resolve(filePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    let relPath = path.relative(realWorkspace, sourcePath);
    if (relPath && !relPath.startsWith('..') && !path.isAbsolute(relPath)) {
      imported.push(relPath.split(path.sep).join(path.posix.sep));
      continue;
    }
    const targetName = uniqueWorkspaceFilename(workspacePath, safeWorkspaceFilename(path.basename(sourcePath)));
    fs.copyFileSync(sourcePath, path.join(workspacePath, targetName));
    imported.push(targetName);
  }
  return dedupeStrings(imported);
}

// ---------------------------------------------------------------------------
// Ensure session workspace
// ---------------------------------------------------------------------------

export function ensureSessionWorkspace(opts: EnsureSessionWorkspaceOpts): SessionWorkspaceInfo {
  const workdir = path.resolve(opts.workdir);
  const index = loadSessionIndex(workdir);
  let record = index.sessions.find(entry => entry.agent === opts.agent && opts.sessionId && entry.sessionId === opts.sessionId)
    || null;
  if (!record) {
    const sessionId = opts.sessionId?.trim() || nextPendingSessionId();
    const threadId = normalizeThreadId(opts.threadId)
      || (opts.sessionId ? legacyThreadId(opts.agent, sessionId) : nextThreadId());
    const title = promptDerivedTitle(opts.title);
    const now = new Date().toISOString();
    record = {
      sessionId, agent: opts.agent, workdir,
      workspacePath: sessionWorkspacePath(workdir, opts.agent, sessionId),
      threadId,
      createdAt: now, updatedAt: now,
      origin: normalizeSessionOrigin(opts.origin, now),
      title, titleSource: title ? 'prompt' : null, model: null, thinkingEffort: null, stagedFiles: [],
      runState: 'completed', runDetail: null, runUpdatedAt: now,
      runPid: null,
      classification: null, userStatus: null, userNote: null, pinned: false,
      archived: false, archivedAt: null,
      lastQuestion: null, lastAnswer: null, lastMessageText: null,
      lastThinking: null, lastPlan: null,
      migratedFrom: null, migratedTo: null, linkedSessions: [],
      sideChatOf: null, sideChats: [],
      handoverFrom: normalizeHandoverRef(opts.handoverFrom),
    };
  }
  if (!record.threadId) record.threadId = normalizeThreadId(opts.threadId) || legacyThreadId(record.agent, record.sessionId);
  // Backfill handoverFrom on first staging only — never overwrite an existing one.
  if (!record.handoverFrom) record.handoverFrom = normalizeHandoverRef(opts.handoverFrom);
  if (!record.origin) {
    record.origin = normalizeSessionOrigin(opts.origin, record.createdAt);
  } else {
    const nextOrigin = normalizeSessionOrigin(opts.origin, record.origin.createdAt);
    if (nextOrigin && record.origin.channel === nextOrigin.channel && record.origin.chatId === nextOrigin.chatId) {
      record.origin = {
        ...record.origin,
        chatType: nextOrigin.chatType ?? record.origin.chatType ?? null,
        sourceMessageId: nextOrigin.sourceMessageId ?? record.origin.sourceMessageId ?? null,
        userId: nextOrigin.userId ?? record.origin.userId ?? null,
        openId: nextOrigin.openId ?? record.origin.openId ?? null,
        updatedAt: nextOrigin.updatedAt,
      };
    }
  }
  if (!record.title && opts.title) {
    const title = promptDerivedTitle(opts.title);
    if (title) {
      record.title = title;
      record.titleSource = record.titleSource || 'prompt';
    }
  }
  record.workspacePath = path.resolve(record.workspacePath);
  saveSessionRecord(workdir, record);
  return { sessionId: record.sessionId, workspacePath: record.workspacePath, record };
}

// ---------------------------------------------------------------------------
// Record to SessionInfo
// ---------------------------------------------------------------------------

function managedRecordToSessionInfo(record: ManagedSessionRecord): SessionInfo {
  // Collapse pre-fix records that stored the canonical skill expansion as the
  // title / lastQuestion / lastMessageText. New records get collapsed at write
  // time in `prepareStreamOpts`; this read-time pass keeps existing sessions
  // from showing the long instruction in the sidebar after the fix lands.
  const title = collapseSkillPrompt(record.title) ?? record.title;
  const lastQuestion = collapseSkillPrompt(record.lastQuestion) ?? record.lastQuestion;
  const lastMessageText = collapseSkillPrompt(record.lastMessageText) ?? record.lastMessageText;
  return {
    sessionId: record.sessionId,
    agent: record.agent,
    workdir: record.workdir,
    workspacePath: record.workspacePath,
    threadId: record.threadId,
    model: record.model,
    thinkingEffort: record.thinkingEffort,
    createdAt: record.createdAt,
    origin: record.origin ?? null,
    title,
    titleSource: record.titleSource ?? null,
    running: record.runState === 'running',
    runState: record.runState,
    runDetail: record.runDetail,
    runUpdatedAt: record.runUpdatedAt,
    runPid: record.runPid,
    classification: record.classification,
    userStatus: record.userStatus,
    userNote: record.userNote,
    pinned: record.pinned === true,
    archived: record.archived === true,
    archivedAt: record.archivedAt ?? null,
    lastQuestion,
    lastAnswer: record.lastAnswer,
    lastMessageText,
    migratedFrom: record.migratedFrom,
    migratedTo: record.migratedTo,
    linkedSessions: record.linkedSessions,
    sideChatOf: record.sideChatOf ?? null,
    sideChats: record.sideChats ?? [],
    numTurns: record.numTurns ?? null,
    handoverFrom: record.handoverFrom ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public session queries
// ---------------------------------------------------------------------------

export interface ListPikiclawSessionsOptions {
  includeSideChats?: boolean;
}

// Exported for drivers
export function listPikiclawSessions(
  workdir: string,
  agent: Agent,
  limit?: number,
  opts: ListPikiclawSessionsOptions = {},
): ManagedSessionRecord[] {
  const records = loadSessionIndex(path.resolve(workdir)).sessions
    .filter(entry => entry.agent === agent)
    .filter(entry => opts.includeSideChats === true || !entry.sideChatOf)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return typeof limit === 'number' ? records.slice(0, limit) : records;
}

export function findPikiclawSession(workdir: string, agent: Agent, sessionId: string): ManagedSessionRecord | null {
  return listPikiclawSessions(workdir, agent, undefined, { includeSideChats: true }).find(entry => entry.sessionId === sessionId) || null;
}

export function findPikiclawSessionInfo(workdir: string, agent: Agent, sessionId: string): SessionInfo | null {
  const record = findPikiclawSession(workdir, agent, sessionId);
  return record ? managedRecordToSessionInfo(record) : null;
}

export interface DeleteAgentSessionOpts {
  workdir: string;
  agent: Agent;
  sessionId: string;
  /**
   * Also delete the agent's native session file (Claude jsonl / Codex rollout /
   * Gemini chat). Defaults to false — by default we only clean pikiclaw's own
   * index and per-session directory so the agent CLI can still resume the
   * conversation outside pikiclaw.
   */
  purgeNative?: boolean;
}

export interface DeleteAgentSessionResult {
  ok: boolean;
  /** True if a managed session record was removed from the index. */
  recordRemoved: boolean;
  /** Absolute paths of pikiclaw-owned directories that were removed. */
  pikiclawPathsRemoved: string[];
  /** Absolute paths of native agent files removed when purgeNative was set. */
  nativePathsRemoved: string[];
  /**
   * Set when the operation refused to act because the session is still running
   * (record marked 'running' AND not stale). Caller should surface this to the
   * user, not auto-force.
   */
  refusedReason: 'session-running' | null;
}

export interface DeleteSideChatSessionOpts extends DeleteAgentSessionOpts {
  parentAgent: Agent;
  parentSessionId: string;
}

export interface DeleteSideChatSessionResult extends DeleteAgentSessionResult {
  /** True when the parent session's sideChats ref was removed. */
  sideChatRefRemoved: boolean;
}

/**
 * Delete a pikiclaw-managed session. Two scopes:
 *   - default: drop the index entry + recursively delete the per-session dir
 *     under `<workdir>/.pikiclaw/sessions/<agent>/<sessionId>/` (and the legacy
 *     `workspaces/` path). Native agent transcript is left in place so the
 *     user can still resume the conversation outside pikiclaw.
 *   - `purgeNative: true`: also call the driver's `deleteNativeSession` to
 *     remove the underlying jsonl/rollout file.
 *
 * Refuses to delete a session whose record is currently marked running and
 * not stale (active process or recent mtime) — caller should stop the
 * stream first.
 *
 * Sessions that exist only in the agent's native store (no pikiclaw record)
 * are still purgeable when `purgeNative` is set.
 */
export async function deleteAgentSession(opts: DeleteAgentSessionOpts): Promise<DeleteAgentSessionResult> {
  const resolvedWorkdir = path.resolve(opts.workdir);
  const { agent, sessionId } = opts;
  const result: DeleteAgentSessionResult = {
    ok: false,
    recordRemoved: false,
    pikiclawPathsRemoved: [],
    nativePathsRemoved: [],
    refusedReason: null,
  };

  const index = loadSessionIndex(resolvedWorkdir);
  const recordIdx = index.sessions.findIndex(s => s.agent === agent && s.sessionId === sessionId);
  const record = recordIdx >= 0 ? index.sessions[recordIdx] : null;

  if (record && record.runState === 'running' && !isRunningSessionStale(record, SESSION_RUNNING_THRESHOLD_MS)) {
    result.refusedReason = 'session-running';
    return result;
  }

  if (record) {
    const now = new Date().toISOString();
    if (record.sideChatOf) {
      const parent = index.sessions.find(s => s.agent === record.sideChatOf!.agent && s.sessionId === record.sideChatOf!.sessionId);
      if (parent?.sideChats?.length) {
        parent.sideChats = parent.sideChats.filter(ref => !(ref.agent === agent && ref.sessionId === sessionId));
        parent.updatedAt = now;
        writeSessionMeta(parent);
      }
    }
    if (record.sideChats?.length) {
      const childKeys = new Set(record.sideChats.map(ref => `${ref.agent}:${ref.sessionId}`));
      for (const child of index.sessions) {
        if (!child.sideChatOf || !childKeys.has(`${child.agent}:${child.sessionId}`)) continue;
        if (child.sideChatOf.agent !== agent || child.sideChatOf.sessionId !== sessionId) continue;
        child.sideChatOf = null;
        child.updatedAt = now;
        writeSessionMeta(child);
      }
    }
    index.sessions.splice(recordIdx, 1);
    writeSessionIndex(resolvedWorkdir, index.sessions);
    result.recordRemoved = true;
  }

  for (const dir of [sessionDirPath(resolvedWorkdir, agent, sessionId), legacySessionWorkspacePath(resolvedWorkdir, agent, sessionId)]) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      result.pikiclawPathsRemoved.push(dir);
    } catch (err) {
      agentLog(`[sessions] failed to remove ${dir}: ${(err as Error).message}`);
    }
  }

  if (opts.purgeNative) {
    try {
      const driver = getDriver(agent);
      if (typeof driver.deleteNativeSession === 'function') {
        const removed = await driver.deleteNativeSession(resolvedWorkdir, sessionId);
        result.nativePathsRemoved = Array.isArray(removed) ? removed : [];
      }
    } catch (err) {
      agentLog(`[sessions] native session purge failed for ${agent}/${sessionId}: ${(err as Error).message}`);
    }
  }

  result.ok = true;
  return result;
}

export async function deleteSideChatSession(opts: DeleteSideChatSessionOpts): Promise<DeleteSideChatSessionResult> {
  const resolvedWorkdir = path.resolve(opts.workdir);
  const beforeIndex = loadSessionIndex(resolvedWorkdir);
  const wasLinked = beforeIndex.sessions
    .find(s => s.agent === opts.parentAgent && s.sessionId === opts.parentSessionId)
    ?.sideChats?.some(ref => ref.agent === opts.agent && ref.sessionId === opts.sessionId) === true;

  const result = await deleteAgentSession(opts);
  const out: DeleteSideChatSessionResult = { ...result, sideChatRefRemoved: result.refusedReason ? false : wasLinked };
  if (result.refusedReason) return out;

  const index = loadSessionIndex(resolvedWorkdir);
  const parent = index.sessions.find(s => s.agent === opts.parentAgent && s.sessionId === opts.parentSessionId);
  if (parent?.sideChats?.length) {
    const before = parent.sideChats.length;
    parent.sideChats = parent.sideChats.filter(ref => !(ref.agent === opts.agent && ref.sessionId === opts.sessionId));
    const removedNow = parent.sideChats.length !== before;
    out.sideChatRefRemoved = out.sideChatRefRemoved || removedNow;
    if (removedNow) {
      const now = new Date().toISOString();
      parent.updatedAt = now;
      writeSessionIndex(resolvedWorkdir, index.sessions);
      writeSessionMeta(parent);
    }
  }

  out.ok = true;
  return out;
}

/**
 * Look up the persisted model and thinkingEffort for an existing session.
 * Returns null values when the session is not found or fields are not set.
 */
export function getSessionStoredConfig(workdir: string, agent: Agent, sessionId: string): { model: string | null; thinkingEffort: string | null } {
  const record = findPikiclawSession(workdir, agent, sessionId);
  return { model: record?.model ?? null, thinkingEffort: record?.thinkingEffort ?? null };
}

export function ensureManagedSession(opts: EnsureManagedSessionOpts): SessionInfo {
  const session = ensureSessionWorkspace({
    agent: opts.agent,
    workdir: opts.workdir,
    sessionId: opts.sessionId,
    title: opts.title,
    threadId: opts.threadId,
    origin: opts.origin,
  });
  if (!session.record.title && opts.title) {
    const title = promptDerivedTitle(opts.title);
    if (title) {
      session.record.title = title;
      session.record.titleSource = session.record.titleSource || 'prompt';
    }
  }
  if (!session.record.model && opts.model) session.record.model = opts.model.trim() || null;
  saveSessionRecord(opts.workdir, session.record);
  return managedRecordToSessionInfo(session.record);
}

export function findManagedThreadSession(workdir: string, threadId: string, agent: Agent): SessionInfo | null {
  const record = loadSessionIndex(path.resolve(workdir)).sessions
    .filter(entry => entry.threadId === threadId && entry.agent === agent)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null;
  return record ? managedRecordToSessionInfo(record) : null;
}

export function stageSessionFiles(opts: StageSessionFilesOpts): StageSessionFilesResult {
  const session = ensureSessionWorkspace({
    agent: opts.agent,
    workdir: opts.workdir,
    sessionId: opts.sessionId,
    title: opts.title,
    threadId: opts.threadId,
    handoverFrom: opts.handoverFrom,
    origin: opts.origin,
  });
  const importedFiles = importFilesIntoWorkspace(session.workspacePath, opts.files);
  if (importedFiles.length) {
    session.record.stagedFiles = dedupeStrings([...session.record.stagedFiles, ...importedFiles]);
    /* title will be set when the first text prompt arrives */
    saveSessionRecord(opts.workdir, session.record);
  }
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    threadId: session.record.threadId,
    importedFiles,
    handoverFrom: session.record.handoverFrom ?? null,
  };
}

// ---------------------------------------------------------------------------
// Merge managed and native sessions
// ---------------------------------------------------------------------------

function sessionTimelineAt(session: Pick<SessionInfo, 'runUpdatedAt' | 'createdAt'>): number {
  const ts = Date.parse(session.runUpdatedAt || session.createdAt || '');
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function preferNativeSessionTimeline(managed: SessionInfo, native: SessionInfo): boolean {
  const managedTs = sessionTimelineAt(managed);
  const nativeTs = sessionTimelineAt(native);
  return nativeTs > managedTs;
}

export function mergeManagedAndNativeSessions(managedSessions: SessionInfo[], nativeSessions: SessionInfo[]): SessionInfo[] {
  const managedById = new Map<string, SessionInfo>();
  const merged: SessionInfo[] = [];
  const seen = new Set<string>();

  for (const session of managedSessions) {
    if (!session.sessionId || isPendingSessionId(session.sessionId)) continue;
    managedById.set(session.sessionId, session);
  }

  for (const native of nativeSessions) {
    const sessionId = native.sessionId;
    if (sessionId) seen.add(sessionId);
    const managed = sessionId ? managedById.get(sessionId) : null;
    if (!managed) {
      merged.push(native);
      continue;
    }
    const useNativeTimeline = preferNativeSessionTimeline(managed, native);
    const adoptedTitle = canAdoptAgentTitle(managed) ? nativeAgentTitle(native) : null;
    merged.push({
      ...managed,
      ...native,
      workdir: native.workdir || managed.workdir,
      workspacePath: managed.workspacePath || native.workspacePath,
      threadId: managed.threadId ?? native.threadId ?? null,
      running: managed.running || native.running,
      runState: managed.runState === 'running'
        ? managed.runState
        : (useNativeTimeline ? native.runState : managed.runState),
      runDetail: useNativeTimeline ? (native.runDetail ?? managed.runDetail) : (managed.runDetail ?? native.runDetail),
      runUpdatedAt: useNativeTimeline ? (native.runUpdatedAt ?? managed.runUpdatedAt) : (managed.runUpdatedAt ?? native.runUpdatedAt),
      // User renames are explicit and stable. Prompt-derived placeholders may
      // be replaced once by an agent-native title generated after the first turn.
      title: adoptedTitle || managed.title || native.title,
      titleSource: adoptedTitle ? 'agent' : (managed.titleSource ?? native.titleSource ?? null),
      model: native.model || managed.model,
      createdAt: native.createdAt || managed.createdAt,
      origin: managed.origin ?? native.origin ?? null,
      classification: managed.classification ?? native.classification ?? null,
      userStatus: managed.userStatus ?? native.userStatus ?? null,
      userNote: managed.userNote ?? native.userNote ?? null,
      pinned: managed.pinned === true,
      archived: managed.archived === true,
      archivedAt: managed.archivedAt ?? native.archivedAt ?? null,
      lastQuestion: useNativeTimeline
        ? (native.lastQuestion ?? managed.lastQuestion ?? null)
        : (managed.lastQuestion ?? native.lastQuestion ?? null),
      lastAnswer: useNativeTimeline
        ? (native.lastAnswer ?? managed.lastAnswer ?? null)
        : (managed.lastAnswer ?? native.lastAnswer ?? null),
      lastMessageText: useNativeTimeline
        ? (native.lastMessageText ?? managed.lastMessageText ?? native.lastAnswer ?? native.lastQuestion ?? managed.lastAnswer ?? managed.lastQuestion ?? null)
        : (managed.lastMessageText ?? native.lastMessageText ?? managed.lastAnswer ?? managed.lastQuestion ?? native.lastAnswer ?? native.lastQuestion ?? null),
      migratedFrom: managed.migratedFrom ?? native.migratedFrom ?? null,
      migratedTo: managed.migratedTo ?? native.migratedTo ?? null,
      linkedSessions: managed.linkedSessions?.length ? managed.linkedSessions : (native.linkedSessions ?? []),
      sideChatOf: managed.sideChatOf ?? native.sideChatOf ?? null,
      sideChats: managed.sideChats?.length ? managed.sideChats : (native.sideChats ?? []),
      numTurns: useNativeTimeline ? (native.numTurns ?? managed.numTurns ?? null) : (managed.numTurns ?? native.numTurns ?? null),
    });
  }

  for (const managed of managedSessions) {
    if (!managed.sessionId || isPendingSessionId(managed.sessionId) || seen.has(managed.sessionId)) continue;
    merged.push(managed);
  }

  const visible = merged.filter(session => !session.sideChatOf);
  visible.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  return visible;
}

// ---------------------------------------------------------------------------
// getSessions / getSessionTail / getSessionMessages
// ---------------------------------------------------------------------------

export function getSessions(opts: SessionListOpts): Promise<SessionListResult> {
  const workdir = path.resolve(opts.workdir);
  agentLog(`[sessions] request agent=${opts.agent} workdir=${workdir} limit=${opts.limit ?? 'all'}`);
  return getDriver(opts.agent).getSessions(workdir, opts.limit).then(result => {
    agentLog(`[sessions] result agent=${opts.agent} ok=${result.ok} count=${result.sessions.length} error=${result.error || '(none)'}`);
    return result;
  });
}

export function getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> {
  return getDriver(opts.agent).getSessionTail(opts);
}

export function getSessionMessages(opts: SessionMessagesOpts & { agent: Agent }): Promise<SessionMessagesResult> {
  return getDriver(opts.agent).getSessionMessages(opts);
}

// ---------------------------------------------------------------------------
// Turn windowing
// ---------------------------------------------------------------------------

function normalizeTurnWindowValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Slice messages by turn window and count total turns. Exported for drivers. */
export function applyTurnWindow(
  allMsgs: TailMessage[],
  opts: Pick<SessionMessagesOpts, 'lastNTurns' | 'turnOffset' | 'turnLimit'> = {},
  richMsgs?: RichMessage[],
): SessionMessagesResult {
  let totalTurns = 0;
  const turnStartIndexes: number[] = [];
  for (let i = 0; i < allMsgs.length; i++) {
    if (allMsgs[i].role === 'user') {
      turnStartIndexes.push(i);
      totalTurns++;
    }
  }

  // If no rich messages provided, synthesize from plain messages so the
  // API always returns a consistent richMessages array.
  const rich = richMsgs ?? allMsgs.map(m => ({ role: m.role, text: m.text, blocks: [{ type: 'text' as const, content: m.text }] }));

  if (totalTurns <= 0) {
    return {
      ok: true,
      messages: allMsgs,
      richMessages: rich,
      totalTurns,
      window: {
        offset: 0,
        limit: 0,
        returnedTurns: 0,
        totalTurns: 0,
        hasOlder: false,
        hasNewer: false,
        startTurn: 0,
        endTurn: 0,
      },
      error: null,
    };
  }

  const offset = normalizeTurnWindowValue(opts.turnOffset, 0);
  const availableTurns = Math.max(0, totalTurns - offset);
  const rawLimit = normalizeTurnWindowValue(opts.turnLimit ?? opts.lastNTurns, availableTurns);
  const limit = rawLimit > 0 ? Math.min(rawLimit, availableTurns) : availableTurns;

  if (limit <= 0 || availableTurns <= 0) {
    const emptyTurn = Math.max(0, totalTurns - offset);
    return {
      ok: true,
      messages: [],
      richMessages: [],
      totalTurns,
      window: {
        offset,
        limit,
        returnedTurns: 0,
        totalTurns,
        hasOlder: emptyTurn > 0,
        hasNewer: offset > 0,
        startTurn: emptyTurn,
        endTurn: emptyTurn,
      },
      error: null,
    };
  }

  const endTurn = Math.max(0, totalTurns - offset);
  const startTurn = Math.max(0, endTurn - limit);
  const startIdx = turnStartIndexes[startTurn] ?? 0;
  const endIdx = endTurn < totalTurns ? (turnStartIndexes[endTurn] ?? allMsgs.length) : allMsgs.length;

  return {
    ok: true,
    messages: allMsgs.slice(startIdx, endIdx),
    richMessages: rich.slice(startIdx, endIdx),
    totalTurns,
    window: {
      offset,
      limit,
      returnedTurns: endTurn - startTurn,
      totalTurns,
      hasOlder: startTurn > 0,
      hasNewer: endTurn < totalTurns,
      startTurn,
      endTurn,
    },
    error: null,
  };
}

/** Filter messages to last N turns and count total turns. Exported for drivers. */
export function applyTurnFilter(allMsgs: TailMessage[], lastNTurns?: number, richMsgs?: RichMessage[]): SessionMessagesResult {
  return applyTurnWindow(allMsgs, { lastNTurns }, richMsgs);
}

// ---------------------------------------------------------------------------
// Session classification
// ---------------------------------------------------------------------------

const PROPOSAL_PATTERNS = /方案|option[s ]?[A-C]|plan|approach|建议|recommend|alternatively|trade-?off|pros?\s+(and|&)\s+cons?|选择|比较/i;
const IMPLEMENTATION_PATTERNS = /已完成|committed|done|implemented|fixed|created|wrote|修复|完成|写入|提交|applied|updated|modified|refactored/i;
const BLOCKED_PATTERNS = /error|failed|permission denied|cannot|无法|失败|报错|blocked|timed?\s*out/i;

export function classifySession(
  result: Pick<StreamResult, 'ok' | 'incomplete' | 'error' | 'stopReason' | 'message' | 'activity'>,
): SessionClassification {
  const now = new Date().toISOString();
  const message = result.message || '';
  const firstLine = message.split('\n').find(l => l.trim())?.trim() || '';
  const summaryText = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;

  // 1. Structural signals from StreamResult
  if (result.incomplete) {
    return {
      outcome: 'partial',
      suggestedNextAction: result.stopReason === 'interrupted' ? 'Resume or restart the interrupted task' : 'Continue the incomplete task',
      summary: summaryText || 'Task did not complete',
      classifiedAt: now,
    };
  }

  if (!result.ok) {
    const errorDetail = result.error || result.stopReason || 'unknown error';
    return {
      outcome: 'blocked',
      suggestedNextAction: `Resolve error: ${errorDetail.slice(0, 100)}`,
      summary: summaryText || `Failed: ${errorDetail.slice(0, 100)}`,
      classifiedAt: now,
    };
  }

  // 2. Activity signals (tool use indicates implementation)
  const activity = result.activity || '';
  if (/\b(Edit|Write|Bash)\b/.test(activity)) {
    return {
      outcome: 'implementation',
      suggestedNextAction: 'Verify the changes made',
      summary: summaryText,
      classifiedAt: now,
    };
  }

  // 3. Content-based classification
  if (BLOCKED_PATTERNS.test(message.slice(0, 500))) {
    return {
      outcome: 'blocked',
      suggestedNextAction: 'Review the error and provide guidance',
      summary: summaryText,
      classifiedAt: now,
    };
  }

  if (PROPOSAL_PATTERNS.test(message.slice(0, 1000))) {
    return {
      outcome: 'proposal',
      suggestedNextAction: 'Review the proposal and decide on next steps',
      summary: summaryText,
      classifiedAt: now,
    };
  }

  if (IMPLEMENTATION_PATTERNS.test(message.slice(0, 500))) {
    return {
      outcome: 'implementation',
      suggestedNextAction: 'Verify the changes made',
      summary: summaryText,
      classifiedAt: now,
    };
  }

  // 4. Default: informational answer
  return {
    outcome: 'answer',
    suggestedNextAction: null,
    summary: summaryText,
    classifiedAt: now,
  };
}

/** Derive a default userStatus from classification outcome */
export function deriveUserStatus(outcome: SessionClassification['outcome']): 'review' | 'done' | 'active' {
  switch (outcome) {
    case 'partial': return 'active';
    default: return 'review';
  }
}

// ---------------------------------------------------------------------------
// Session export/import
// ---------------------------------------------------------------------------

export async function exportSession(opts: ExportSessionOpts): Promise<ExportSessionResult> {
  try {
    // Rich mode so we can include image blocks in the export. The session
    // pipeline always returns plain messages even when rich is set; rich is
    // additive.
    const result = await getSessionMessages({ ...opts, agent: opts.agent, rich: true });
    if (!result.ok) return { ok: false, content: '', filename: '', error: result.error };

    const messages = result.messages;
    const richMessages = result.richMessages;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let content: string;
    let ext: string;

    switch (opts.format) {
      case 'json': {
        // Materialize image bytes into inline data URLs so the JSON is a
        // self-contained artefact (no dangling filesystem references).
        const { materializeImage } = await import('./images.js');
        const enrichedRichMessages = richMessages?.map(message => ({
          ...message,
          blocks: message.blocks.map(block => {
            if (block.type !== 'image') return block;
            const resolved = materializeImage(block);
            if (!resolved) return block;
            return {
              ...block,
              content: `data:${resolved.mime};base64,${resolved.bytes.toString('base64')}`,
            };
          }),
        }));
        content = JSON.stringify({
          agent: opts.agent,
          sessionId: opts.sessionId,
          exportedAt: new Date().toISOString(),
          messages,
          richMessages: enrichedRichMessages,
        }, null, 2);
        ext = 'json';
        break;
      }
      case 'text':
        content = messages.map(m => `[${m.role}]\n${m.text}`).join('\n\n---\n\n');
        ext = 'txt';
        break;
      case 'markdown':
      default:
        content = await renderMarkdownExport(opts.agent, timestamp, messages, richMessages);
        ext = 'md';
        break;
    }

    const filename = `session-${opts.agent}-${opts.sessionId.slice(0, 8)}-${timestamp}.${ext}`;
    return { ok: true, content, filename, error: null };
  } catch (e: any) {
    return { ok: false, content: '', filename: '', error: e.message };
  }
}

/**
 * Render an export-friendly markdown view. Each turn renders the role header,
 * the text body, and (for image blocks) an inlined `![caption](data:…)` ref
 * so the markdown is self-contained and renders correctly in any viewer
 * (VSCode preview, GitHub, etc.) without external file lookups.
 */
async function renderMarkdownExport(
  agent: Agent,
  timestamp: string,
  messages: TailMessage[],
  richMessages: RichMessage[] | undefined,
): Promise<string> {
  const lines: string[] = [`# Session Export (${agent}, ${timestamp})`, ''];
  const { materializeImage } = await import('./images.js');
  // Walk by index so we can pair messages[i] with richMessages[i] when present.
  const indexed = richMessages?.length === messages.length ? richMessages : null;
  const sections: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const sectionHeader = `## ${m.role === 'user' ? 'User' : 'Assistant'}`;
    const sectionParts: string[] = [sectionHeader, '', m.text];
    const rich = indexed?.[i];
    if (rich) {
      for (const block of rich.blocks) {
        if (block.type !== 'image') continue;
        const resolved = materializeImage(block);
        if (!resolved) continue;
        const altText = (block.imageCaption || '').replace(/[\r\n]+/g, ' ').slice(0, 120);
        const dataUrl = `data:${resolved.mime};base64,${resolved.bytes.toString('base64')}`;
        sectionParts.push('', `![${altText}](${dataUrl})`);
        if (block.imageCaption) sectionParts.push('', `_${altText}_`);
      }
    }
    sections.push(sectionParts.join('\n'));
  }
  return lines.join('\n') + sections.join('\n\n---\n\n');
}

export function importSession(opts: ImportSessionOpts): ImportSessionResult {
  try {
    const format = opts.format || detectImportFormat(opts.content);
    let messages: TailMessage[];

    switch (format) {
      case 'json': {
        const parsed = JSON.parse(opts.content);
        messages = Array.isArray(parsed.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [];
        break;
      }
      case 'markdown': {
        messages = parseMarkdownConversation(opts.content);
        break;
      }
      case 'text':
      default: {
        messages = parseTextConversation(opts.content);
        break;
      }
    }

    return { ok: true, messages, error: null };
  } catch (e: any) {
    return { ok: false, messages: [], error: e.message };
  }
}

function detectImportFormat(content: string): 'json' | 'markdown' | 'text' {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('#')) return 'markdown';
  return 'text';
}

function parseMarkdownConversation(content: string): TailMessage[] {
  const messages: TailMessage[] = [];
  const sections = content.split(/^## /m).slice(1);
  for (const section of sections) {
    const firstLine = section.split('\n')[0].trim().toLowerCase();
    const role: 'user' | 'assistant' = firstLine.includes('user') ? 'user' : 'assistant';
    // Strip inlined image data URLs (`![alt](data:image/...;base64,...)`) so
    // the imported text body stays readable. The base64 payload itself isn't
    // re-attached as a MessageBlock because the import API returns plain
    // TailMessages; downstream agents that re-process the export will see the
    // alt text "[image: alt]" placeholder where the markdown image stood.
    const stripped = section
      .split('\n')
      .slice(1)
      .join('\n')
      .replace(/^---\s*$/m, '')
      .replace(/!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+\)/g, (_, alt) => alt ? `[image: ${alt}]` : '[image]')
      .trim();
    if (stripped) messages.push({ role, text: stripped });
  }
  return messages;
}

function parseTextConversation(content: string): TailMessage[] {
  const messages: TailMessage[] = [];
  const blocks = content.split(/\n---\n/).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const match = block.match(/^\[(user|assistant)\]\n([\s\S]+)$/i);
    if (match) {
      messages.push({ role: match[1].toLowerCase() as 'user' | 'assistant', text: match[2].trim() });
    }
  }
  return messages;
}
