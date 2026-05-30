/**
 * Codex CLI driver: HTTP server management, streaming, human-in-the-loop.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { registerDriver, type AgentDriver } from '../driver.js';
import { terminateProcessTree } from '../../core/process-control.js';
import {
  type StreamOpts, type StreamResult,
  type StreamPreviewMeta, type StreamPreviewPlan, type StreamPreviewPlanStep,
  type CodexCumulativeUsage, type AgentInteraction, type AgentInteractionQuestion,
  type SessionListResult, type SessionInfo, type SessionTailOpts, type SessionTailResult,
  type SessionMessagesOpts, type SessionMessagesResult,
  type TailMessage, type RichMessage, type MessageBlock,
  mimeForExt,
  type ModelListOpts, type ModelListResult, type ModelInfo,
  type UsageOpts, type UsageResult, type UsageWindowInfo,
  // shared helpers
  agentLog, agentWarn,
  buildStreamPreviewMeta, pushRecentActivity, normalizeActivityLine,
  firstNonEmptyLine, shortValue, numberOrNull,
  normalizeStreamPreviewPlan,
  IMAGE_EXTS,
  listPikiclawSessions, findPikiclawSession, isPendingSessionId,
  adoptNativeSessionTitles, mergeManagedAndNativeSessions,
    stripInjectedPrompts, stripOaiMemoryCitations, sanitizeSessionUserPreviewText, computeContext, readTailLines, applyTurnWindow,
  roundPercent, toIsoFromEpochSeconds, labelFromWindowMinutes,
  usageWindowFromRateLimit, parseJsonTail, emptyUsage,
  attachAgentImage, codexHome,
  Q,
} from '../index.js';
import {
  CODEX_APPSERVER_SPAWN_TIMEOUT_MS as _CODEX_APPSERVER_SPAWN_TIMEOUT_MS,
  CODEX_APPSERVER_IDLE_TTL_MS,
  CODEX_STREAM_HARD_KILL_GRACE_MS,
  SESSION_RUNNING_THRESHOLD_MS,
} from '../../core/constants.js';
import { getHome } from '../../core/platform.js';

// ---------------------------------------------------------------------------
// App-server JSON-RPC client
// ---------------------------------------------------------------------------

const CODEX_APPSERVER_SPAWN_TIMEOUT_MS = _CODEX_APPSERVER_SPAWN_TIMEOUT_MS;
const CODEX_STREAM_SERVER_POOL_MAX_PER_KEY = 2;

type RpcCallback = (msg: any) => void;
type NotificationHandler = (method: string, params: any) => void;
type RequestHandler = (method: string, params: any, requestId: string) => Promise<any> | any;
type StderrHandler = (text: string) => void;

export class CodexAppServer {
  private proc: ReturnType<typeof spawn> | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, RpcCallback>();
  private notificationHandlers = new Set<NotificationHandler>();
  private requestHandlers = new Set<RequestHandler>();
  private stderrHandlers = new Set<StderrHandler>();
  private ready = false;
  private startPromise: Promise<boolean> | null = null;
  private configOverrides: string[] = [];
  private extraEnv: Record<string, string> | undefined;

  async ensureRunning(extraConfig?: string[], extraEnv?: Record<string, string>): Promise<boolean> {
    if (this.ready && this.proc && !this.proc.killed) return true;
    if (this.startPromise) return this.startPromise;
    this.configOverrides = extraConfig ?? [];
    this.extraEnv = extraEnv;
    this.startPromise = this._start();
    const ok = await this.startPromise;
    this.startPromise = null;
    return ok;
  }

  private _start(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.kill(); resolve(false); }, CODEX_APPSERVER_SPAWN_TIMEOUT_MS);
      const args = ['app-server'];
      // Always enable codex's native /goal feature so pikiclaw can route through
      // codex's own `thread/goal/*` RPC + continuation engine. User-supplied -c
      // overrides win.
      const overrides = this.configOverrides.some(entry => /^features\.goals\s*=/.test(entry))
        ? this.configOverrides
        : [...this.configOverrides, 'features.goals=true'];
      for (const c of overrides) args.push('-c', c);
      agentLog(`[codex-rpc] spawning: codex ${args.join(' ')}`);
      const proc = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        detached: process.platform !== 'win32',
        env: this.extraEnv ? { ...process.env, ...this.extraEnv } : process.env,
      });
      this.proc = proc;
      this.buf = '';
      this.nextId = 1;
      this.pending.clear();
      this.ready = false;

      proc.stderr?.on('data', (c: Buffer) => {
        const text = c.toString();
        agentLog(`[codex-rpc][stderr] ${text.trim().slice(0, 200)}`);
        for (const handler of [...this.stderrHandlers]) {
          try { handler(text); } catch {}
        }
      });
      proc.stdout.on('data', (chunk: Buffer) => {
        this.buf += chunk.toString('utf-8');
        const lines = this.buf.split('\n');
        this.buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.method && msg.id != null) {
            const handlers = [...this.requestHandlers];
            if (!handlers.length) {
              this.respond(msg.id, {});
              continue;
            }
            const [handler] = handlers;
            Promise.resolve(handler(msg.method, msg.params ?? {}, String(msg.id)))
              .then(result => this.respond(msg.id, result ?? {}))
              .catch(error => {
                agentWarn(`[codex-rpc] request handler error method=${msg.method} error=${error?.message || error}`);
                this.respond(msg.id, {});
              });
            continue;
          }
          if (msg.id != null) {
            const cb = this.pending.get(msg.id);
            if (cb) { this.pending.delete(msg.id); cb(msg); }
          }
          if (msg.method && msg.id == null) {
            for (const handler of [...this.notificationHandlers]) handler(msg.method, msg.params ?? {});
          }
        }
      });

      proc.on('error', () => { clearTimeout(timer); this.ready = false; resolve(false); });
      proc.on('close', () => {
        this.ready = false;
        this.proc = null;
        // Resolve any pending RPC calls so callers don't hang forever
        for (const [id, cb] of this.pending) {
          cb({ error: { message: 'process exited before responding' } });
        }
        this.pending.clear();
      });

      // Declare experimentalApi so `thread/goal/*` is reachable. Codex 0.130+
      // gates these RPCs behind that capability — without it, every goal call
      // returns "requires experimentalApi capability".
      this.call('initialize', {
        clientInfo: { name: 'pikiclaw', version: '0.2.0' },
        capabilities: { experimentalApi: true },
      })
        .then(resp => {
          clearTimeout(timer);
          if (resp.error) { agentWarn(`[codex-rpc] init error: ${resp.error.message}`); resolve(false); return; }
          this.ready = true;
          agentLog(`[codex-rpc] initialized`);
          resolve(true);
        })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
  }

  call(method: string, params?: any, timeoutMs?: number): Promise<any> {
    return new Promise((resolve) => {
      if (!this.proc || this.proc.killed) { resolve({ error: { message: 'not connected' } }); return; }
      const id = this.nextId++;
      const wrappedResolve = (result: any) => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        resolve(result);
      };
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { message: `RPC call '${method}' timed out after ${timeoutMs}ms` } });
      }, timeoutMs) : null;
      this.pending.set(id, wrappedResolve);
      const msg: any = { jsonrpc: '2.0', id, method };
      if (params !== undefined) msg.params = params;
      try { this.proc.stdin!.write(JSON.stringify(msg) + '\n'); } catch {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        resolve({ error: { message: 'write failed' } });
      }
    });
  }

  notify(method: string, params?: any): void {
    if (!this.proc || this.proc.killed) return;
    const msg: any = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    try { this.proc.stdin!.write(JSON.stringify(msg) + '\n'); } catch {}
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => { this.notificationHandlers.delete(handler); };
  }

  offNotification(handler?: NotificationHandler): void {
    if (!handler) { this.notificationHandlers.clear(); return; }
    this.notificationHandlers.delete(handler);
  }

  kill(): void {
    terminateProcessTree(this.proc, { signal: 'SIGTERM', forceSignal: 'SIGKILL', forceAfterMs: 2000 });
    this.proc = null;
    this.ready = false;
    for (const cb of this.pending.values()) cb({ error: { message: 'app-server terminated' } });
    this.pending.clear();
    this.notificationHandlers.clear();
    this.requestHandlers.clear();
    this.stderrHandlers.clear();
  }

  get isRunning(): boolean { return this.ready && !!this.proc && !this.proc.killed; }

  onRequest(handler: RequestHandler): () => void {
    this.requestHandlers.add(handler);
    return () => { this.requestHandlers.delete(handler); };
  }

  onStderr(handler: StderrHandler): () => void {
    this.stderrHandlers.add(handler);
    return () => { this.stderrHandlers.delete(handler); };
  }

  private respond(id: any, result: any): void {
    if (!this.proc || this.proc.killed) return;
    try { this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); } catch {}
  }
}

/** Singleton app-server for shared operations (sessions, models, usage). */
let _sharedServer: CodexAppServer | null = null;
function getSharedServer(): CodexAppServer {
  if (!_sharedServer) _sharedServer = new CodexAppServer();
  return _sharedServer;
}

interface CodexStreamServerPoolEntry {
  server: CodexAppServer;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CodexStreamServerLease {
  server: CodexAppServer;
  reused: boolean;
  pooled: boolean;
  release: (discard?: boolean) => void;
}

const codexStreamServerPool = new Map<string, CodexStreamServerPoolEntry[]>();

function stableEnvEntries(env?: Record<string, string>): Array<[string, string]> {
  if (!env) return [];
  return Object.keys(env).sort().map(key => [key, String(env[key] ?? '')]);
}

function codexStreamServerPoolKey(config: string[], extraEnv?: Record<string, string>): string {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ config, env: stableEnvEntries(extraEnv) }))
    .digest('hex')
    .slice(0, 16);
  return `codex:${hash}`;
}

function acquireCodexStreamServer(config: string[], extraEnv?: Record<string, string>, opts: { disablePool?: boolean } = {}): CodexStreamServerLease {
  if (opts.disablePool) {
    const server = new CodexAppServer();
    return {
      server,
      reused: false,
      pooled: false,
      release: () => { server.kill(); },
    };
  }

  const key = codexStreamServerPoolKey(config, extraEnv);
  const bucket = codexStreamServerPool.get(key) || [];
  while (bucket.length) {
    const entry = bucket.pop()!;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.server.isRunning) {
      codexStreamServerPool.set(key, bucket);
      return {
        server: entry.server,
        reused: true,
        pooled: true,
        release: (discard = false) => releaseCodexStreamServer(key, entry.server, discard),
      };
    }
    entry.server.kill();
  }
  codexStreamServerPool.set(key, bucket);
  const server = new CodexAppServer();
  return {
    server,
    reused: false,
    pooled: true,
    release: (discard = false) => releaseCodexStreamServer(key, server, discard),
  };
}

function releaseCodexStreamServer(key: string, server: CodexAppServer, discard = false): void {
  if (discard || !server.isRunning) {
    server.kill();
    return;
  }
  const entry: CodexStreamServerPoolEntry = {
    server,
    timer: null,
  };
  entry.timer = setTimeout(() => {
    const bucket = codexStreamServerPool.get(key) || [];
    const idx = bucket.indexOf(entry);
    if (idx >= 0) bucket.splice(idx, 1);
    if (!bucket.length) codexStreamServerPool.delete(key);
    server.kill();
  }, CODEX_APPSERVER_IDLE_TTL_MS);
  const bucket = codexStreamServerPool.get(key) || [];
  bucket.push(entry);
  while (bucket.length > CODEX_STREAM_SERVER_POOL_MAX_PER_KEY) {
    const evicted = bucket.shift();
    if (!evicted) break;
    if (evicted.timer) clearTimeout(evicted.timer);
    evicted.server.kill();
  }
  codexStreamServerPool.set(key, bucket);
}

function shutdownCodexStreamServerPool(): void {
  for (const bucket of codexStreamServerPool.values()) {
    for (const entry of bucket) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.server.kill();
    }
  }
  codexStreamServerPool.clear();
}

export function shutdownCodexServer(): void {
  _sharedServer?.kill();
  _sharedServer = null;
  shutdownCodexStreamServerPool();
}

// ---------------------------------------------------------------------------
// Native /goal RPC bridge — `thread/goal/*` is exposed by codex app-server
// when `features.goals=true` (we always set that). pikiclaw treats codex's
// SQLite + continuation engine as the source of truth for codex sessions.
//
// Wire format (camelCase per codex-rs/app-server-protocol/schema/typescript/v2):
//   thread/goal/set    { threadId, objective?, status?, tokenBudget? }  → ThreadGoal
//   thread/goal/get    { threadId }                                     → ThreadGoal | null
//   thread/goal/clear  { threadId }                                     → ()
//   Status enum: "active" | "paused" | "budgetLimited" | "complete"
// ---------------------------------------------------------------------------

export type CodexGoalStatus = 'active' | 'paused' | 'budgetLimited' | 'complete';

export interface CodexThreadGoal {
  threadId: string;
  objective: string;
  status: CodexGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

const CODEX_GOAL_RPC_TIMEOUT_MS = 15_000;
const CODEX_THREAD_GOALS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (
        'active',
        'paused',
        'blocked',
        'usage_limited',
        'budget_limited',
        'complete'
    )),
    token_budget INTEGER,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);`;
let codexGoalCompatSchemaChecked = false;

async function ensureSharedServerForGoal(): Promise<CodexAppServer | null> {
  ensureCodexGoalCompatSchema();
  const srv = getSharedServer();
  if (!(await srv.ensureRunning())) return null;
  return srv;
}

function unwrapGoal(raw: any): CodexThreadGoal | null {
  const g = raw?.goal ?? raw;
  if (!g || typeof g !== 'object') return null;
  if (typeof g.threadId !== 'string') return null;
  return {
    threadId: g.threadId,
    objective: String(g.objective ?? ''),
    status: (g.status as CodexGoalStatus) || 'active',
    tokenBudget: typeof g.tokenBudget === 'number' ? g.tokenBudget : null,
    tokensUsed: typeof g.tokensUsed === 'number' ? g.tokensUsed : 0,
    timeUsedSeconds: typeof g.timeUsedSeconds === 'number' ? g.timeUsedSeconds : 0,
    createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
    updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : 0,
  };
}

function isMissingThreadGoalsError(error: unknown): boolean {
  const message = typeof error === 'string'
    ? error
    : typeof (error as any)?.message === 'string'
      ? (error as any).message
      : String(error ?? '');
  return /no such table:\s*thread_goals/i.test(message);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqliteExec(dbPath: string, sql: string): void {
  execSync(`sqlite3 ${Q(dbPath)} ${Q(sql)}`, {
    encoding: 'utf-8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sqliteJsonRows(dbPath: string, sql: string): any[] {
  const out = execSync(`sqlite3 -json ${Q(dbPath)} ${Q(sql)}`, {
    encoding: 'utf-8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
}

function latestCodexSqlite(root: string, pattern: RegExp): string | null {
  if (!fs.existsSync(root)) return null;
  try {
    const files = fs.readdirSync(root)
      .filter(name => pattern.test(name))
      .map(name => ({ name, full: path.join(root, name), mtime: fs.statSync(path.join(root, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.full || null;
  } catch { return null; }
}

function codexGoalStateDbPath(): string | null {
  return latestCodexSqlite(codexHome(), /^state.*\.sqlite$/i);
}

function codexGoalDbPath(): string {
  const root = codexHome();
  return latestCodexSqlite(root, /^goals.*\.sqlite$/i) || path.join(root, 'goals_1.sqlite');
}

function ensureCodexGoalCompatSchema(): void {
  if (codexGoalCompatSchemaChecked) return;
  codexGoalCompatSchemaChecked = true;
  const dbPath = codexGoalStateDbPath();
  if (!dbPath) return;
  try {
    sqliteExec(dbPath, CODEX_THREAD_GOALS_SCHEMA_SQL);
  } catch (error) {
    agentWarn(`[codex-rpc] failed to ensure thread_goals compatibility schema: ${(error as any)?.message || error}`);
  }
}

function normalizeCodexGoalStatus(status: unknown): CodexGoalStatus {
  if (status === 'paused') return 'paused';
  if (status === 'complete') return 'complete';
  if (status === 'budgetLimited' || status === 'budget_limited' || status === 'usage_limited') return 'budgetLimited';
  if (status === 'blocked') return 'paused';
  return 'active';
}

function codexStatusToDbStatus(status: CodexGoalStatus): string {
  return status === 'budgetLimited' ? 'budget_limited' : status;
}

function dbRowToCodexGoal(row: any): CodexThreadGoal | null {
  if (!row || typeof row.threadId !== 'string') return null;
  return {
    threadId: row.threadId,
    objective: String(row.objective ?? ''),
    status: normalizeCodexGoalStatus(row.status),
    tokenBudget: typeof row.tokenBudget === 'number' ? row.tokenBudget : null,
    tokensUsed: typeof row.tokensUsed === 'number' ? row.tokensUsed : 0,
    timeUsedSeconds: typeof row.timeUsedSeconds === 'number' ? row.timeUsedSeconds : 0,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  };
}

function readCodexGoalFromDb(threadId: string): CodexThreadGoal | null {
  const candidates = [codexGoalStateDbPath(), codexGoalDbPath()].filter((v, idx, arr): v is string => !!v && arr.indexOf(v) === idx);
  for (const dbPath of candidates) {
    try {
      if (path.basename(dbPath).startsWith('goals')) sqliteExec(dbPath, CODEX_THREAD_GOALS_SCHEMA_SQL);
      const rows = sqliteJsonRows(dbPath, `
SELECT
  thread_id AS threadId,
  objective AS objective,
  status AS status,
  token_budget AS tokenBudget,
  tokens_used AS tokensUsed,
  time_used_seconds AS timeUsedSeconds,
  created_at_ms AS createdAt,
  updated_at_ms AS updatedAt
FROM thread_goals
WHERE thread_id = ${sqlString(threadId)}
LIMIT 1;`);
      const goal = dbRowToCodexGoal(rows[0]);
      if (goal) return goal;
    } catch {}
  }
  return null;
}

function writeCodexGoalToDb(opts: {
  threadId: string;
  objective?: string;
  status?: CodexGoalStatus;
  tokenBudget?: number | null;
}): { ok: true; goal: CodexThreadGoal | null } | { ok: false; error: string } {
  const dbPath = codexGoalStateDbPath() || codexGoalDbPath();
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    sqliteExec(dbPath, CODEX_THREAD_GOALS_SCHEMA_SQL);
    const existing = readCodexGoalFromDb(opts.threadId);
    if (!existing && typeof opts.objective !== 'string') return { ok: true, goal: null };

    const now = Date.now();
    const objective = typeof opts.objective === 'string' ? opts.objective : existing?.objective || '';
    const status = codexStatusToDbStatus(opts.status ?? existing?.status ?? 'active');
    const tokenBudget = opts.tokenBudget !== undefined
      ? (typeof opts.tokenBudget === 'number' && opts.tokenBudget > 0 ? Math.floor(opts.tokenBudget) : null)
      : existing?.tokenBudget ?? null;
    const createdAt = existing?.createdAt || now;
    const goalId = `piki-${crypto.randomUUID()}`;

    sqliteExec(dbPath, `
INSERT INTO thread_goals (
  thread_id,
  goal_id,
  objective,
  status,
  token_budget,
  tokens_used,
  time_used_seconds,
  created_at_ms,
  updated_at_ms
) VALUES (
  ${sqlString(opts.threadId)},
  ${sqlString(goalId)},
  ${sqlString(objective)},
  ${sqlString(status)},
  ${tokenBudget == null ? 'NULL' : String(tokenBudget)},
  ${existing?.tokensUsed ?? 0},
  ${existing?.timeUsedSeconds ?? 0},
  ${createdAt},
  ${now}
) ON CONFLICT(thread_id) DO UPDATE SET
  goal_id = excluded.goal_id,
  objective = excluded.objective,
  status = excluded.status,
  token_budget = excluded.token_budget,
  tokens_used = excluded.tokens_used,
  time_used_seconds = excluded.time_used_seconds,
  created_at_ms = excluded.created_at_ms,
  updated_at_ms = excluded.updated_at_ms;`);

    return { ok: true, goal: readCodexGoalFromDb(opts.threadId) };
  } catch (error) {
    return { ok: false, error: String((error as any)?.message || error) };
  }
}

function clearCodexGoalFromDb(threadId: string): { ok: boolean; error?: string } {
  const candidates = [codexGoalStateDbPath(), codexGoalDbPath()].filter((v, idx, arr): v is string => !!v && arr.indexOf(v) === idx);
  try {
    for (const dbPath of candidates) {
      if (path.basename(dbPath).startsWith('goals')) sqliteExec(dbPath, CODEX_THREAD_GOALS_SCHEMA_SQL);
      sqliteExec(dbPath, `DELETE FROM thread_goals WHERE thread_id = ${sqlString(threadId)};`);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String((error as any)?.message || error) };
  }
}

/** Set / replace the active goal on a codex thread. Codex auto-starts a continuation turn if it is idle. */
export async function setCodexGoal(opts: {
  threadId: string;
  objective?: string;
  status?: CodexGoalStatus;
  tokenBudget?: number | null;
}): Promise<{ ok: true; goal: CodexThreadGoal | null } | { ok: false; error: string }> {
  const srv = await ensureSharedServerForGoal();
  if (!srv) return { ok: false, error: 'codex app-server unavailable' };
  const params: Record<string, unknown> = { threadId: opts.threadId };
  if (typeof opts.objective === 'string') params.objective = opts.objective;
  if (opts.status) params.status = opts.status;
  if (opts.tokenBudget !== undefined) params.tokenBudget = opts.tokenBudget;
  const resp = await srv.call('thread/goal/set', params, CODEX_GOAL_RPC_TIMEOUT_MS);
  if (resp?.error) {
    if (isMissingThreadGoalsError(resp.error)) {
      agentWarn(`[codex-rpc] thread/goal/set hit missing thread_goals table; using sqlite fallback`);
      return writeCodexGoalToDb(opts);
    }
    return { ok: false, error: String(resp.error.message || 'thread/goal/set failed') };
  }
  return { ok: true, goal: unwrapGoal(resp?.result) };
}

export async function getCodexGoal(threadId: string): Promise<CodexThreadGoal | null> {
  const srv = await ensureSharedServerForGoal();
  if (!srv) return null;
  const resp = await srv.call('thread/goal/get', { threadId }, CODEX_GOAL_RPC_TIMEOUT_MS);
  if (resp?.error) {
    if (isMissingThreadGoalsError(resp.error)) {
      agentWarn(`[codex-rpc] thread/goal/get hit missing thread_goals table; using sqlite fallback`);
      return readCodexGoalFromDb(threadId);
    }
    agentWarn(`[codex-rpc] thread/goal/get error: ${resp.error.message || resp.error}`);
    return null;
  }
  return unwrapGoal(resp?.result);
}

export async function clearCodexGoal(threadId: string): Promise<{ ok: boolean; error?: string }> {
  const srv = await ensureSharedServerForGoal();
  if (!srv) return { ok: false, error: 'codex app-server unavailable' };
  const resp = await srv.call('thread/goal/clear', { threadId }, CODEX_GOAL_RPC_TIMEOUT_MS);
  if (resp?.error) {
    if (isMissingThreadGoalsError(resp.error)) {
      agentWarn(`[codex-rpc] thread/goal/clear hit missing thread_goals table; using sqlite fallback`);
      return clearCodexGoalFromDb(threadId);
    }
    return { ok: false, error: String(resp.error.message || 'thread/goal/clear failed') };
  }
  return { ok: true };
}

export async function pauseCodexGoal(threadId: string) {
  return setCodexGoal({ threadId, status: 'paused' });
}

export async function resumeCodexGoal(threadId: string) {
  return setCodexGoal({ threadId, status: 'active' });
}

// ---------------------------------------------------------------------------
// Effort mapping
// ---------------------------------------------------------------------------

const EFFORT_MAP: Record<string, string> = {
  low: 'low', medium: 'medium', high: 'high', min: 'minimal', max: 'xhigh',
};
function mapEffort(effort: string): string { return EFFORT_MAP[effort] ?? effort; }

// ---------------------------------------------------------------------------
// Tool call helpers
// ---------------------------------------------------------------------------

interface CodexActiveToolCall { kind: string; summary: string; }
interface PendingCodexAssistantMessage {
  blocks: MessageBlock[];
  toolNamesByCallId: Map<string, string>;
  createdAt: string | null;
}

function codexMessageCreatedAt(message: any, container?: any): string | null {
  for (const value of [
    message?.createdAt,
    message?.created_at,
    message?.timestamp,
    message?.time,
    container?.createdAt,
    container?.created_at,
    container?.timestamp,
    container?.time,
  ]) {
    const iso = normalizeMessageTimestamp(value);
    if (iso) return iso;
  }
  return null;
}

function normalizeMessageTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function isCodexToolCallItem(item: any): boolean {
  return item?.type === 'dynamicToolCall' || item?.type === 'mcpToolCall' || item?.type === 'collabAgentToolCall';
}

function codexToolKind(name: unknown): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) return 'tool';
  const parts = raw.split('.');
  return parts[parts.length - 1] || raw;
}

function codexToolName(item: any): string {
  return typeof item?.tool === 'string' && item.tool.trim()
    ? item.tool.trim()
    : (typeof item?.name === 'string' ? item.name.trim() : '');
}

function codexToolArgs(item: any): unknown {
  return item?.arguments ?? item?.input ?? item?.args ?? item?.parameters ?? item?.params ?? item?.call?.arguments ?? null;
}

function commandPreview(command: unknown, max = 160): string {
  const raw = typeof command === 'string' ? command.trim() : '';
  if (!raw) return '';
  const oneLine = raw.split('\n').map(line => line.trim()).find(Boolean) || raw;
  return shortValue(oneLine, max);
}

function summarizeCodexCommand(command: unknown): string {
  const preview = commandPreview(command);
  return preview ? `Bash: ${preview}` : 'Bash';
}

function compactPathTarget(value: unknown, max = 80): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const compact = parts.length >= 2 ? parts.slice(-2).join('/') : normalized;
  if (compact.length <= max) return compact;
  return `...${compact.slice(-(max - 3))}`;
}

function codexArgValue(args: any, keys: string[]): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function codexPathArg(args: any): string {
  return compactPathTarget(codexArgValue(args, ['file_path', 'path', 'absolute_path', 'relative_path', 'target_file', 'filename']), 120);
}

function codexSearchArg(args: any): string {
  const value = codexArgValue(args, ['pattern', 'query', 'search_query', 'regex', 'glob']);
  return typeof value === 'string' ? shortValue(value, 120) : '';
}

function summarizeCodexToolCall(item: any): CodexActiveToolCall | null {
  const rawName = codexToolName(item);
  const kind = codexToolKind(rawName);
  const args = parseCodexArguments(codexToolArgs(item));
  switch (kind) {
    case 'apply_patch': return { kind, summary: 'Edit files' };
    case 'exec_command': {
      const command = args && typeof args === 'object' && !Array.isArray(args) ? (args as any).cmd : null;
      const preview = commandPreview(command);
      return { kind, summary: preview ? `Bash: ${preview}` : 'Bash' };
    }
    case 'local_shell_call': {
      const command = args && typeof args === 'object' && !Array.isArray(args)
        ? ((args as any).cmd ?? (args as any).command ?? (args as any).action?.command)
        : null;
      const preview = commandPreview(command);
      return { kind, summary: preview ? `Bash: ${preview}` : 'Bash' };
    }
    case 'read':
    case 'open':
    case 'view':
    case 'view_file':
    case 'read_file': {
      const target = codexPathArg(args);
      return { kind, summary: target ? `Read ${target}` : 'Read file' };
    }
    case 'edit':
    case 'write':
    case 'create_file':
    case 'update_file': {
      const target = codexPathArg(args);
      const label = kind === 'write' || kind === 'create_file' ? 'Write' : 'Edit';
      return { kind, summary: target ? `${label} ${target}` : `${label} file` };
    }
    case 'grep':
    case 'search':
    case 'find':
    case 'glob': {
      const pattern = codexSearchArg(args);
      return { kind, summary: pattern ? `Search ${pattern}` : 'Search files' };
    }
    case 'list':
    case 'ls':
    case 'list_files':
    case 'list_directory': {
      const target = codexPathArg(args) || compactPathTarget(codexArgValue(args, ['dir', 'directory', 'dir_path']), 120);
      return { kind, summary: target ? `List ${target}` : 'List files' };
    }
    case 'update_plan': return { kind, summary: 'Update plan' };
    case 'request_user_input': return { kind, summary: 'Request user input' };
    case 'view_image': {
      const target = codexPathArg(args);
      return { kind, summary: target ? `Inspect image ${target}` : 'Inspect image' };
    }
    case 'parallel': return { kind, summary: 'Run multiple tools' };
    default: {
      const target = codexPathArg(args) || codexSearchArg(args)
        || shortValue(codexArgValue(args, ['cmd', 'command', 'description', 'url']), 120);
      if (target) return { kind, summary: `Use ${kind.replace(/_/g, ' ')}: ${target}` };
      const label = shortValue(kind.replace(/_/g, ' '), 80);
      return label ? { kind, summary: `Use ${label}` } : null;
    }
  }
}

function summarizeCodexFileChange(item: any): string {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const paths = changes.map((c: any) => compactPathTarget(c?.path, 90)).filter(Boolean);
  if (paths.length === 1) return `Updated ${paths[0]}`;
  if (paths.length > 1) return `Updated ${paths.length} files`;
  return 'Updated files';
}

function summarizeCodexRawResponseItem(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  switch (item.type) {
    case 'function_call': {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) return null;
      const tool = summarizeCodexToolCall({
        name,
        arguments: item.arguments,
      });
      return tool?.summary || shortValue(name, 120);
    }
    case 'function_call_output': {
      const output = formatCodexArguments(item.output).trim();
      if (!output || output === 'Plan updated') return null;
      const firstLine = firstNonEmptyLine(output);
      return firstLine ? `Result: ${shortValue(firstLine, 140)}` : null;
    }
    case 'web_search_call': {
      const action = item.action || {};
      if (action.type === 'search') {
        const query = shortValue(action.query, 120);
        return query ? `Search web: ${query}` : 'Search web';
      }
      if (action.type === 'open_page') {
        const url = shortValue(action.url, 120);
        return url ? `Open ${url}` : 'Open web page';
      }
      return 'Search web';
    }
    case 'custom_tool_call': {
      const name = shortValue(item.name, 80);
      return name ? `Use ${name}` : 'Use tool';
    }
    case 'local_shell_call': {
      return summarizeCodexCommand(item.action?.command || item.action?.cmd);
    }
    default:
      return null;
  }
}

function extractCodexMessageText(content: unknown): string {
  if (typeof content === 'string') return stripOaiMemoryCitations(content).trim();
  if (!Array.isArray(content)) return '';
  return stripOaiMemoryCitations(content
    .map((entry: any) => {
      if (!entry || typeof entry !== 'object') return '';
      if ((entry.type === 'output_text' || entry.type === 'input_text' || entry.type === 'text') && typeof entry.text === 'string') {
        return entry.text.trim();
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()).trim();
}

function extractCodexReasoningText(payload: any): string {
  const fromSummary = Array.isArray(payload?.summary)
    ? payload.summary
      .map((entry: any) => typeof entry === 'string' ? entry : (typeof entry?.text === 'string' ? entry.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
    : '';
  if (fromSummary) return fromSummary;
  if (Array.isArray(payload?.content)) {
    return payload.content
      .map((entry: any) => typeof entry === 'string' ? entry : (typeof entry?.text === 'string' ? entry.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return typeof payload?.content === 'string' ? payload.content.trim() : '';
}

function parseCodexArguments(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return raw; }
}

function formatCodexArguments(raw: unknown): string {
  const parsed = parseCodexArguments(raw);
  if (parsed == null) return '';
  if (typeof parsed === 'string') return parsed.trim();
  try { return JSON.stringify(parsed, null, 2); } catch {}
  return String(parsed);
}

function formatCodexPlanSummary(plan: StreamPreviewPlan): string {
  const lines: string[] = [];
  if (plan.explanation?.trim()) lines.push(plan.explanation.trim());
  for (const step of plan.steps) lines.push(`[${step.status}] ${step.step}`);
  return lines.join('\n').trim();
}

/**
 * Resolve the on-disk path Codex writes generated images to. Format:
 *   `$CODEX_HOME/generated_images/<sessionId>/<call_id>.png`
 *
 * The developer-message Codex injects when its built-in `image_gen` tool fires
 * documents this convention (`Generated images are saved to … as …/<id>.png`).
 * We honour `$CODEX_HOME`; the SKILL.md prescribes `.png` as the only output
 * format for the built-in tool.
 */
function codexImagePathFor(sessionId: string, callId: string): string {
  return path.join(codexHome(), 'generated_images', sessionId, `${callId}.png`);
}

/** Build an image MessageBlock from a Codex `image_generation_call` payload. */
function buildCodexImageBlock(sessionId: string, payload: any, phase?: 'commentary' | 'final_answer'): MessageBlock | null {
  const callId = typeof payload?.id === 'string' ? payload.id
    : typeof payload?.call_id === 'string' ? payload.call_id
    : '';
  if (!callId) return null;
  const filePath = codexImagePathFor(sessionId, callId);
  const caption = typeof payload?.revised_prompt === 'string' ? payload.revised_prompt : undefined;
  return attachAgentImage({ imagePath: filePath, caption, phase });
}

/**
 * Idempotently push the image MessageBlock for a Codex `image_gen` call to the
 * stream state. Returns true if a block was emitted on this invocation.
 *
 * Codex emits image_generation_call across several inconsistent paths depending
 * on the app-server build: `item/started`, `item/completed`, and
 * `rawResponseItem/completed` may all fire — or some may be skipped (we've seen
 * runs where only `image_generation_end` lands and the response item is frozen
 * at status="generating", so no completion notification ever arrives). This
 * helper lets every code path call into one place; the pendingImageGen map is
 * the source of truth for "not yet emitted." On success we drop the pending
 * entry and decrement the in-flight counter; on miss (file not yet on disk) we
 * leave the entry so a later event — or the turn-end drain — can retry.
 */
function tryEmitCodexImageBlock(s: CodexStreamState, callId: string, revisedPrompt?: string): boolean {
  if (!callId || !s.sessionId) return false;
  const pending = s.pendingImageGen.get(callId);
  if (!pending) return false;
  const prompt = revisedPrompt ?? pending.revisedPrompt;
  const block = buildCodexImageBlock(s.sessionId, { id: callId, revised_prompt: prompt });
  if (!block) return false;
  s.pendingImageGen.delete(callId);
  if (s.generatingImages > 0) s.generatingImages--;
  s.imageBlocks.push(block);
  pushRecentActivity(s.recentNarrative, 'Image ready');
  return true;
}

function buildCodexAssistantText(blocks: MessageBlock[]): string {
  const finalText = blocks
    .filter(block => block.type === 'text' && block.phase === 'final_answer' && block.content.trim())
    .map(block => block.content.trim())
    .join('\n\n')
    .trim();
  if (finalText) return finalText;

  const commentaryText = blocks
    .filter(block => block.type === 'text' && block.content.trim())
    .map(block => block.content.trim())
    .join('\n\n')
    .trim();
  if (commentaryText) return commentaryText;

  const latestPlan = [...blocks].reverse().find(block => block.type === 'plan' && block.plan?.steps?.length);
  if (latestPlan?.content.trim()) return latestPlan.content.trim();

  const thinking = blocks.find(block => block.type === 'thinking' && block.content.trim())?.content.trim();
  if (thinking) return thinking;

  const toolNames = blocks
    .filter(block => block.type === 'tool_use')
    .map(block => block.toolName?.trim() || '')
    .filter(Boolean);
  if (toolNames.length) return toolNames.join(', ');

  return blocks.find(block => block.type === 'tool_result' && block.content.trim())?.content.trim() || '';
}

function overlayCodexManagedPreview(workdir: string, sessionId: string, richMessages: RichMessage[]): RichMessage[] {
  const managed = findPikiclawSession(workdir, 'codex', sessionId);
  if (!managed) return richMessages;
  const assistantIndex = [...richMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(entry => entry.message.role === 'assistant')?.index ?? -1;
  if (assistantIndex < 0) return richMessages;

  const current = richMessages[assistantIndex];
  const blocks = [...current.blocks];
  let changed = false;

  if (managed.lastThinking?.trim() && !blocks.some(block => block.type === 'thinking' && block.content.trim())) {
    const thinkingBlock: MessageBlock = { type: 'thinking', content: managed.lastThinking.trim() };
    const insertIndex = blocks.findIndex(block => block.type === 'text' && block.phase === 'final_answer');
    if (insertIndex >= 0) blocks.splice(insertIndex, 0, thinkingBlock);
    else blocks.push(thinkingBlock);
    changed = true;
  }

  if (managed.lastPlan?.steps?.length && !blocks.some(block => block.type === 'plan' && block.plan?.steps?.length)) {
    const planBlock: MessageBlock = {
      type: 'plan',
      content: formatCodexPlanSummary(managed.lastPlan),
      plan: managed.lastPlan,
    };
    const insertIndex = blocks.findIndex(block => block.type === 'text' && block.phase === 'final_answer');
    if (insertIndex >= 0) blocks.splice(insertIndex, 0, planBlock);
    else blocks.push(planBlock);
    changed = true;
  }

  if (!changed) return richMessages;

  const merged = [...richMessages];
  merged[assistantIndex] = {
    ...current,
    text: buildCodexAssistantText(blocks) || current.text,
    blocks,
  };
  return merged;
}

function toAgentInteraction(method: string, params: any, requestId: string): AgentInteraction | null {
  if (method === 'item/tool/requestUserInput') {
    const raw = Array.isArray(params?.questions) ? params.questions : [];
    const questions: AgentInteractionQuestion[] = raw
      .map((q: any) => ({
        id: String(q?.id || ''),
        header: String(q?.header || '') || 'Question',
        prompt: String(q?.question || ''),
        options: Array.isArray(q?.options)
          ? q.options.map((o: any) => ({
            label: String(o?.label || ''),
            description: String(o?.description || ''),
            value: String(o?.label || ''),
          }))
          : null,
        allowFreeform: !!q?.isOther || !Array.isArray(q?.options) || !q.options.length,
        secret: !!q?.isSecret,
        allowEmpty: true,
      }))
      .filter((q: AgentInteractionQuestion) => q.id && q.prompt);
    return {
      kind: 'user-input',
      id: requestId,
      title: 'User Input Required',
      hint: 'Use the buttons when available. Reply with text when prompted.',
      questions,
      resolveWith: (answers) => ({
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, vals]) => [id, { answers: vals }]),
        ),
      }),
    };
  }
  return null;
}

function defaultAgentInteractionResponse(interaction: AgentInteraction): Record<string, any> {
  const answers: Record<string, { answers: string[] }> = {};
  for (const q of interaction.questions) answers[q.id] = { answers: [] };
  return { answers };
}

function defaultCodexServerRequestResponse(method: string): Record<string, any> {
  if (method === 'item/commandExecution/requestApproval') return { decision: 'accept' };
  if (method === 'item/fileChange/requestApproval') return { decision: 'accept' };
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
  if (method === 'item/tool/requestUserInput') return { answers: {} };
  return {};
}

function isCodexToolCallFailure(item: any): boolean {
  if (!item || !isCodexToolCallItem(item)) return false;
  return item.success === false || !!item.error || item.status === 'failed' || item.status === 'error';
}

function buildCodexActivityPreview(s: {
  recentNarrative: string[]; recentFailures: string[];
  commentaryByItem: Map<string, string>;
  commentaryParts: string[];
  activeCommands: Map<string, string>;
  activeToolCalls: Map<string, CodexActiveToolCall>;
  completedCommands: number;
}, opts: { includeCommentary?: boolean } = {}): string {
  const commentaryLines = opts.includeCommentary === false
    ? new Set(s.commentaryParts.map(text => normalizeActivityLine(text)).filter(Boolean))
    : null;
  const lines = commentaryLines
    ? s.recentNarrative.filter(line => !commentaryLines.has(line))
    : [...s.recentNarrative];
  if (opts.includeCommentary !== false) {
    for (const text of s.commentaryByItem.values()) {
      const cleaned = normalizeActivityLine(text);
      if (cleaned && lines[lines.length - 1] !== cleaned) lines.push(cleaned);
    }
  }
  for (const failure of s.recentFailures) {
    if (lines[lines.length - 1] !== failure) lines.push(failure);
  }
  if (s.completedCommands > 0) lines.push(s.completedCommands === 1 ? 'Executed 1 command.' : `Executed ${s.completedCommands} commands.`);
  for (const summary of s.activeCommands.values()) {
    const running = summary.endsWith('...') ? summary : `${summary}...`;
    if (lines[lines.length - 1] !== running) lines.push(running);
  }
  for (const tool of s.activeToolCalls.values()) {
    const running = tool.summary.endsWith('...') ? tool.summary : `${tool.summary}...`;
    if (lines[lines.length - 1] !== running) lines.push(running);
  }
  return lines.join('\n');
}

function buildCodexPreviewText(s: {
  text: string;
  commentaryParts: string[];
  commentaryByItem: Map<string, string>;
}): string {
  const commentary = [
    ...s.commentaryParts,
    ...s.commentaryByItem.values(),
  ]
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const finalText = s.text.trim();
  if (commentary && finalText) return `${commentary}\n\n${finalText}`;
  return commentary || finalText;
}

function stripAnsi(text: string): string {
  return String(text || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function codexDiagnosticsFromStderr(text: string): string[] {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map(line => normalizeActivityLine(line))
    .filter(Boolean)
    .filter(line => /(AuthRequired|invalid YAML|failed|error|quota|rate limit|timeout|MODEL_CAPACITY|capacity)/i.test(line))
    .map(line => {
      if (/AuthRequired/i.test(line)) return `MCP auth required: ${shortValue(line, 180)}`;
      if (/invalid YAML/i.test(line)) return `Skill config error: ${shortValue(line, 180)}`;
      return `Codex diagnostic: ${shortValue(line, 180)}`;
    });
}

function markCodexProgress(s: { diagnostics: string[]; lastEvent: string | null }, label: string): void {
  s.lastEvent = label;
  pushRecentActivity(s.diagnostics, `Codex connection: ${label}`, 8);
}

function formatTimingMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildCodexTimingDiagnostic(s: CodexStreamState): string {
  const timings = s.phaseTimings;
  const parts: string[] = [];
  const queue = formatTimingMs(timings.queueWaitMs);
  const mcp = formatTimingMs(timings.mcpBridgeSetupMs);
  const app = formatTimingMs(timings.appServerMs);
  const thread = formatTimingMs(timings.threadMs);
  const turnStart = formatTimingMs(timings.turnStartMs);
  const firstEvent = formatTimingMs(timings.firstEventMs);
  const total = formatTimingMs(timings.totalMs);
  if (queue) parts.push(`queue ${queue}`);
  if (mcp) parts.push(`mcp ${mcp}`);
  if (timings.appServerReused) parts.push('app-server reused');
  else if (app) parts.push(`app-server ${app}`);
  if (thread) parts.push(`thread ${thread}`);
  if (turnStart) parts.push(`turn-start ${turnStart}`);
  if (firstEvent) parts.push(`first-event ${firstEvent}`);
  if (total) parts.push(`total ${total}`);
  return `Timing: ${parts.join(', ') || 'unavailable'}`;
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

function buildCodexCumulativeUsage(raw: any): CodexCumulativeUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = numberOrNull(raw.inputTokens, raw.input_tokens);
  const output = numberOrNull(raw.outputTokens, raw.output_tokens);
  const cached = numberOrNull(raw.cachedInputTokens, raw.cached_input_tokens);
  if (input == null && output == null && cached == null) return null;
  return { input: input ?? 0, output: output ?? 0, cached: cached ?? 0 };
}

function buildCodexContextUsage(raw: any): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const total = numberOrNull(raw.totalTokens, raw.total_tokens);
  if (total != null && total >= 0) return total;

  const input = numberOrNull(raw.inputTokens, raw.input_tokens);
  const output = numberOrNull(raw.outputTokens, raw.output_tokens);
  if (input != null && output != null) return input + output;
  if (input != null) return input;
  return null;
}


function applyCodexTokenUsage(
  s: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    contextWindow: number | null;
    contextUsedTokens: number | null;
    /** When set, codex-advertised model_context_window updates are ignored. */
    byokContextWindow?: number | null;
    codexCumulative: CodexCumulativeUsage | null;
  },
  rawUsage: any, prev?: CodexCumulativeUsage,
) {
  if (!rawUsage || typeof rawUsage !== 'object') return;
  const info = rawUsage.info && typeof rawUsage.info === 'object' ? rawUsage.info : rawUsage;
  const last = info.last ?? info.lastTokenUsage ?? info.last_token_usage ?? rawUsage.last;
  const lastInput = numberOrNull(last?.inputTokens, last?.input_tokens);
  const lastOutput = numberOrNull(last?.outputTokens, last?.output_tokens);
  const lastCached = numberOrNull(last?.cachedInputTokens, last?.cached_input_tokens);
  const lastCacheCreation = numberOrNull(last?.cacheCreationInputTokens, last?.cache_creation_input_tokens);
  if (lastInput != null) s.inputTokens = lastInput;
  if (lastOutput != null) s.outputTokens = lastOutput;
  if (lastCached != null) s.cachedInputTokens = lastCached;
  if (lastCacheCreation != null) s.cacheCreationInputTokens = lastCacheCreation;
  const lastContextUsage = buildCodexContextUsage(last);
  if (lastContextUsage != null) s.contextUsedTokens = lastContextUsage;

  const totalUsage = info.total ?? info.totalTokenUsage ?? info.total_token_usage ?? rawUsage.total ?? rawUsage;
  const total = buildCodexCumulativeUsage(totalUsage);
  if (total) {
    s.codexCumulative = total;
    if (lastInput == null) s.inputTokens = prev ? Math.max(0, total.input - prev.input) : total.input;
    if (lastOutput == null) s.outputTokens = prev ? Math.max(0, total.output - prev.output) : total.output;
    if (lastCached == null) s.cachedInputTokens = prev ? Math.max(0, total.cached - prev.cached) : total.cached;
  }
  // NOTE: do NOT set s.contextUsedTokens from cumulative totals —
  // those counters span the full thread, not the current turn. Use the per-turn
  // `last` usage only. `cached_input_tokens` is already a subset of
  // `input_tokens`, so adding it again inflates the context percentage.
  if (!s.byokContextWindow) {
    const contextWindow = numberOrNull(
      info.modelContextWindow,
      info.model_context_window,
      rawUsage.modelContextWindow,
      rawUsage.model_context_window,
    );
    if (contextWindow != null && contextWindow > 0) s.contextWindow = contextWindow;
  }
}

// ---------------------------------------------------------------------------
// Turn input
// ---------------------------------------------------------------------------

export function buildCodexTurnInput(prompt: string, attachments: string[]): any[] {
  const input: any[] = [];
  for (const filePath of attachments) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      input.push({ type: 'localImage', path: filePath });
      continue;
    }
    input.push({ type: 'text', text: `[Attached file: ${filePath}]` });
  }
  input.push({ type: 'text', text: prompt });
  return input;
}

// ---------------------------------------------------------------------------
// Stream state
// ---------------------------------------------------------------------------

interface CodexStreamState {
  startedAtMs: number;
  sessionId: string | null;
  text: string;
  thinking: string;
  activity: string;
  msgs: string[];
  thinkParts: string[];
  model: string | null;
  thinkingEffort: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  contextWindow: number | null;
  contextUsedTokens: number | null;
  /** When set, ignore codex-advertised model_context_window updates. */
  byokContextWindow: number | null;
  /** BYOK provider display name surfaced in preview meta + IM footers. */
  byokProviderName: string | null;
  codexCumulative: CodexCumulativeUsage | null;
  turnId: string | null;
  turnStatus: string | null;
  turnError: string | null;
  messagePhases: Map<string, string>;
  /**
   * Item IDs whose final-answer text we've already absorbed via deltas. When
   * `item/completed` fires for a final_answer that *did* stream incrementally,
   * `s.text` already holds the content and we skip the append in
   * handleCompletedAgentMessage. For messages that arrive as a single
   * `item/completed` (no preceding deltas), the itemId is absent here so we
   * append the completed text and emit — without this the preview stays empty
   * until the turn-end backfill in doCodexStream, which is exactly the
   * "answer only shows up after everything finishes" bug.
   */
  deltaSeenForItem: Set<string>;
  commentaryByItem: Map<string, string>;
  commentaryParts: string[];
  activeCommands: Map<string, string>;
  activeToolCalls: Map<string, CodexActiveToolCall>;
  recentNarrative: string[];
  recentFailures: string[];
  diagnostics: string[];
  lastEvent: string | null;
  phaseTimings: {
    queueWaitMs?: number | null;
    mcpBridgeSetupMs?: number | null;
    appServerMs?: number | null;
    appServerReused?: boolean;
    appServerPooled?: boolean;
    threadMs?: number | null;
    turnStartMs?: number | null;
    firstEventMs?: number | null;
    totalMs?: number | null;
  };
  completedCommands: number;
  plan: StreamPreviewPlan | null;
  /** Image blocks emitted this turn by Codex's built-in `image_gen` tool. */
  imageBlocks: MessageBlock[];
  /** call_id → revised_prompt while an image is generating. Lets us emit the
   *  block on `image_generation_end` even if the live payload lacked the
   *  prompt (some Codex versions only emit it on `_start`). */
  pendingImageGen: Map<string, { revisedPrompt?: string }>;
  /** Count of image generations currently in flight (start - end). Surfaced
   *  to the live preview as `meta.generatingImages` so renderers can show a
   *  "Generating image…" chip while the actual block has yet to land. */
  generatingImages: number;
}

function createCodexStreamState(opts: StreamOpts): CodexStreamState {
  // BYOK: lock in the provider-cached context window so codex's own (often
  // wrong, model-dependent) `model_context_window` reports get ignored later.
  const byokWindow = opts.byokContextWindow && opts.byokContextWindow > 0
    ? opts.byokContextWindow
    : null;
  const byokProvider = opts.byokProviderName || null;
  return {
    startedAtMs: Date.now(),
    sessionId: opts.sessionId,
    text: '', thinking: '', activity: '', msgs: [], thinkParts: [],
    model: opts.model, thinkingEffort: opts.thinkingEffort,
    inputTokens: null, outputTokens: null,
    cachedInputTokens: null, cacheCreationInputTokens: null,
    contextWindow: byokWindow, contextUsedTokens: null,
    byokContextWindow: byokWindow,
    byokProviderName: byokProvider,
    codexCumulative: null,
    turnId: null, turnStatus: null, turnError: null,
    messagePhases: new Map(),
    deltaSeenForItem: new Set(),
    commentaryByItem: new Map(),
    commentaryParts: [],
    activeCommands: new Map(),
    activeToolCalls: new Map(),
    recentNarrative: [], recentFailures: [],
    diagnostics: [], lastEvent: null,
    phaseTimings: {
      queueWaitMs: opts.queueWaitMs ?? null,
      mcpBridgeSetupMs: opts.codexMcpBridgeSetupMs ?? null,
      firstEventMs: null,
    },
    completedCommands: 0,
    plan: null,
    imageBlocks: [],
    pendingImageGen: new Map(),
    generatingImages: 0,
  };
}

function codexErrorResult(
  error: string, start: number,
  sessionId: string | null, model: string | null, thinkingEffort: string,
): StreamResult {
  return {
    ok: false, message: error, thinking: null,
    plan: null,
    sessionId, workspacePath: null,
    model, thinkingEffort,
    elapsedS: (Date.now() - start) / 1000, inputTokens: null, outputTokens: null,
    cachedInputTokens: null, cacheCreationInputTokens: null, contextWindow: null,
    contextUsedTokens: null, contextPercent: null, error,
    codexCumulative: null, stopReason: null, incomplete: true, activity: null,
  };
}

// ---------------------------------------------------------------------------
// Stream notification handler (extracted from doCodexStream)
// ---------------------------------------------------------------------------

function handleCodexNotification(
  method: string, params: any,
  s: CodexStreamState, opts: StreamOpts,
  deadline: number,
  emit: () => void,
  hardTimer: ReturnType<typeof setTimeout>,
  settleTurnDone: (() => void) | null,
  publishTurnControl?: () => void,
): void {
  if (Date.now() > deadline) return;
  if (params.threadId !== s.sessionId) {
    // Only turn/started and model/rerouted are checked below; all others already filter on threadId.
    if (method !== 'turn/started' && method !== 'model/rerouted') return;
    if (params.threadId !== s.sessionId) return;
  }
  s.lastEvent = method;
  if (s.phaseTimings.firstEventMs == null) {
    s.phaseTimings.firstEventMs = Date.now() - s.startedAtMs;
  }

  switch (method) {
    case 'item/started':
      handleItemStarted(params.item || {}, s, emit);
      return;
    case 'item/agentMessage/delta':
      handleAgentMessageDelta(params, s, emit);
      return;
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
      s.thinking += params.delta || '';
      emit();
      return;
    case 'item/completed':
      handleItemCompleted(params.item || {}, s, emit);
      return;
    case 'rawResponseItem/completed':
      handleRawResponseItemCompleted(params.item || {}, s, emit);
      return;
    case 'thread/tokenUsage/updated':
      applyCodexTokenUsage(s, params.tokenUsage, opts.codexPrevCumulative);
      emit();
      return;
    case 'turn/plan/updated':
      handleTurnPlanUpdated(params, s, emit);
      return;
    case 'serverRequest/resolved': {
      const requestId = String(params.requestId || '');
      if (requestId) pushRecentActivity(s.recentNarrative, 'Human input resolved');
      emit();
      return;
    }
    case 'turn/completed': {
      const turn = params.turn || {};
      applyCodexTokenUsage(s, params.tokenUsage || turn.tokenUsage || turn.usage, opts.codexPrevCumulative);
      s.turnStatus = turn.status ?? null;
      if (turn.error) s.turnError = turn.error.message || turn.error.code || JSON.stringify(turn.error);
      s.turnId = turn.id ?? s.turnId;
      clearTimeout(hardTimer);
      settleTurnDone?.();
      return;
    }
    case 'turn/started':
      s.turnId = params.turn?.id ?? null;
      publishTurnControl?.();
      return;
    case 'model/rerouted':
      s.model = params.model ?? s.model;
      return;
  }
}

function handleItemStarted(item: any, s: CodexStreamState, emit: () => void): void {
  if (item.type === 'agentMessage' && item.id) {
    const phase = item.phase || 'final_answer';
    s.messagePhases.set(item.id, phase);
    if (phase !== 'final_answer') { s.commentaryByItem.set(item.id, item.text || ''); emit(); }
  }
  if (item.type === 'commandExecution' && item.id && item.command) {
    const summary = summarizeCodexCommand(item.command);
    pushRecentActivity(s.recentNarrative, summary);
    s.activeCommands.set(item.id, summary);
    emit();
  }
  if (item.id && isCodexToolCallItem(item)) {
    const toolCall = summarizeCodexToolCall(item);
    if (toolCall) { s.activeToolCalls.set(item.id, toolCall); emit(); }
  }
  // Codex's built-in `image_gen` tool surfaces as a distinct item type. Track
  // the in-flight count so renderers can show "Generating image…" while the
  // bytes are being written. Item id naming differs across Codex versions
  // (`imageGenerationCall` / `image_generation_call`); accept either form.
  if (item.id && (item.type === 'imageGenerationCall' || item.type === 'image_generation_call')) {
    if (!s.pendingImageGen.has(item.id)) s.generatingImages++;
    s.pendingImageGen.set(item.id, {
      revisedPrompt: typeof item.revisedPrompt === 'string' ? item.revisedPrompt
        : typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
    });
    pushRecentActivity(s.recentNarrative, 'Generating image...');
    // Some codex builds never fire a "completed" event for image_generation_call
    // (rollout shows the item frozen at status="generating"). The PNG is on
    // disk by the time item/started lands, so try an opportunistic emit here;
    // tryEmit is a no-op when the file isn't ready yet — handleItemCompleted /
    // rawResponseItem/completed / the turn-end drain will pick it up later.
    tryEmitCodexImageBlock(s, item.id);
    emit();
  }
}

function handleAgentMessageDelta(params: any, s: CodexStreamState, emit: () => void): void {
  const delta = params.delta || '';
  const phase = params.itemId ? (s.messagePhases.get(params.itemId) || 'final_answer') : 'final_answer';
  if (phase === 'final_answer') {
    s.text += delta;
    if (params.itemId) s.deltaSeenForItem.add(params.itemId);
  } else if (params.itemId) {
    const prev = s.commentaryByItem.get(params.itemId) || '';
    s.commentaryByItem.set(params.itemId, prev + delta);
  }
  emit();
}

function handleItemCompleted(item: any, s: CodexStreamState, emit: () => void): void {
  if (item.type === 'agentMessage' && item.id) {
    handleCompletedAgentMessage(item, s, emit);
  }
  if (item.type === 'reasoning') {
    const parts = [...(item.summary || []), ...(item.content || [])];
    const text = parts.join('\n').trim();
    if (text) { s.thinkParts.push(text); emit(); }
  }
  if (item.type === 'commandExecution' && item.id) {
    handleCompletedCommand(item, s, emit);
  }
  if (item.id && isCodexToolCallItem(item)) {
    handleCompletedToolCall(item, s, emit);
  }
  if (item.type === 'fileChange') {
    pushRecentActivity(s.recentNarrative, summarizeCodexFileChange(item));
    emit();
  }
  if (item.id && (item.type === 'imageGenerationCall' || item.type === 'image_generation_call')) {
    const revised = typeof item.revised_prompt === 'string' ? item.revised_prompt
      : typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined;
    if (tryEmitCodexImageBlock(s, item.id, revised)) emit();
  }
}

function handleRawResponseItemCompleted(item: any, s: CodexStreamState, emit: () => void): void {
  if (item?.type === 'reasoning') {
    const summary = Array.isArray(item.summary)
      ? item.summary
        .map((entry: any) => (typeof entry === 'string' ? entry : entry?.text || ''))
        .filter(Boolean)
        .join('\n')
        .trim()
      : '';
    if (summary) {
      s.thinkParts.push(summary);
      emit();
      return;
    }
  }
  // image_generation_call: Codex's built-in image_gen has just finished writing
  // the file at $CODEX_HOME/generated_images/<sessionId>/<id>.png. Read it into
  // an image MessageBlock so the bot's final-reply path can dispatch it to IM
  // channels and the dashboard renders it inline.
  if (item?.type === 'image_generation_call' || item?.type === 'imageGenerationCall') {
    const callId = typeof item.id === 'string' ? item.id
      : typeof item.call_id === 'string' ? item.call_id : '';
    if (callId) {
      // Merge revised_prompt from this event with anything we stashed earlier —
      // different Codex builds attach it on different events. Idempotent helper
      // handles the dedupe against item/started + handleItemCompleted paths.
      const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt
        : typeof item.revisedPrompt === 'string' ? item.revisedPrompt
        : undefined;
      tryEmitCodexImageBlock(s, callId, revisedPrompt);
      emit();
      return;
    }
  }
  const summary = summarizeCodexRawResponseItem(item);
  if (!summary) return;
  pushRecentActivity(s.recentNarrative, summary);
  emit();
}

function handleCompletedAgentMessage(item: any, s: CodexStreamState, emit: () => void): void {
  const phase = item.phase || s.messagePhases.get(item.id) || 'final_answer';
  if (phase === 'final_answer') {
    const text = item.text?.trim();
    if (text) {
      s.msgs.push(text);
      // When Codex emits the final-answer body without intervening deltas
      // (short replies, certain provider configs), `s.text` is empty and the
      // preview would stay blank until doCodexStream's turn-end backfill.
      // Append the completed body now so the live stream catches up. The
      // delta-seen set tells us whether we'd be duplicating content already
      // accumulated via item/agentMessage/delta.
      const alreadyStreamed = item.id && s.deltaSeenForItem.has(item.id);
      if (!alreadyStreamed) {
        s.text = s.text.trim() ? `${s.text.trim()}\n\n${text}` : text;
      }
    }
    emit();
  } else {
    const commentary = item.text?.trim() || s.commentaryByItem.get(item.id)?.trim() || '';
    if (commentary) {
      s.commentaryParts.push(commentary);
      pushRecentActivity(s.recentNarrative, commentary);
    }
    s.commentaryByItem.delete(item.id);
    emit();
  }
  if (item.id) s.deltaSeenForItem.delete(item.id);
  s.messagePhases.delete(item.id);
}

function handleCompletedCommand(item: any, s: CodexStreamState, emit: () => void): void {
  const cmd = item.command || s.activeCommands.get(item.id) || '';
  s.activeCommands.delete(item.id);
  if (cmd) {
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null;
    if (exitCode != null && exitCode !== 0) pushRecentActivity(s.recentFailures, `Command failed (${exitCode}): ${cmd}`, 4);
    else s.completedCommands++;
  }
  emit();
}

function handleCompletedToolCall(item: any, s: CodexStreamState, emit: () => void): void {
  const toolCall = s.activeToolCalls.get(item.id) || summarizeCodexToolCall(item);
  s.activeToolCalls.delete(item.id);
  if (toolCall) {
    if (isCodexToolCallFailure(item)) pushRecentActivity(s.recentFailures, `${toolCall.summary} failed`, 4);
    else if (toolCall.kind !== 'apply_patch') pushRecentActivity(s.recentNarrative, `${toolCall.summary} done`);
  }
  emit();
}

function handleTurnPlanUpdated(params: any, s: CodexStreamState, emit: () => void): void {
  const rawPlan = Array.isArray(params.plan) ? params.plan : [];
  s.plan = {
    explanation: typeof params.explanation === 'string' ? params.explanation : null,
    steps: rawPlan
      .map((entry: any) => ({
        step: typeof entry?.step === 'string' ? entry.step : '',
        status: entry?.status === 'completed' || entry?.status === 'pending' || entry?.status === 'inProgress' ? entry.status : 'pending',
      }))
      .filter((entry: StreamPreviewPlanStep) => entry.step.trim()),
  };
  emit();
}

// ---------------------------------------------------------------------------
// Stream request handler (extracted from doCodexStream)
// ---------------------------------------------------------------------------

async function handleCodexRequest(
  method: string, params: any, requestId: string,
  s: CodexStreamState, opts: StreamOpts,
  emit: () => void,
): Promise<Record<string, any>> {
  const interaction = toAgentInteraction(method, params, requestId);
  if (!interaction) return defaultCodexServerRequestResponse(method);

  pushRecentActivity(s.recentNarrative, interaction.kind === 'user-input' ? 'Waiting for user input' : 'Waiting for approval');
  emit();

  try {
    if (opts.onInteraction) {
      const response = await opts.onInteraction(interaction);
      return response ?? defaultAgentInteractionResponse(interaction);
    }
  } catch (error: any) {
    pushRecentActivity(s.recentFailures, `Human input failed: ${shortValue(error?.message || error, 120)}`, 4);
    emit();
  }
  return defaultAgentInteractionResponse(interaction);
}

// ---------------------------------------------------------------------------
// Stream via app-server
// ---------------------------------------------------------------------------

export async function doCodexStream(opts: StreamOpts): Promise<StreamResult> {
  const start = Date.now();
  let serverLease: CodexStreamServerLease | null = null;
  let discardServerLease = true;
  let timedOut = false;
  let interrupted = false;
  let unsubscribeNotifications = () => {};
  let unsubscribeRequests = () => {};
  let unsubscribeStderr = () => {};
  let settleTurnDone: (() => void) | null = null;
  let emitPreview = () => {};
  let publishedTurnControl = false;
  const s = createCodexStreamState(opts);
  const emit = () => {
    s.activity = buildCodexActivityPreview(s);
    const previewText = buildCodexPreviewText(s);
    const previewActivity = buildCodexActivityPreview(s, { includeCommentary: false });
    opts.onText(previewText, s.thinking, previewActivity, buildStreamPreviewMeta(s), s.plan);
  };
  emitPreview = emit;

  try {
    const config: string[] = [];
    if (opts.codexExtraArgs?.length) {
      for (let i = 0; i < opts.codexExtraArgs.length; i++) {
        if (opts.codexExtraArgs[i] === '-c' && opts.codexExtraArgs[i + 1]) config.push(opts.codexExtraArgs[++i]);
      }
    }
    // Enable codex's native `/goal` feature so `thread/goal/*` RPCs work and
    // the model gets the native `create_goal` / `update_goal` / `get_goal`
    // tools + continuation engine. User-provided -c overrides win.
    if (!config.some(entry => /^features\.goals\s*=/.test(entry))) {
      config.push('features.goals=true');
    }

    serverLease = acquireCodexStreamServer(config, opts.extraEnv, { disablePool: !!opts.codexMcpBridgeActive });
    const srv = serverLease.server;
    s.phaseTimings.appServerReused = serverLease.reused;
    s.phaseTimings.appServerPooled = serverLease.pooled;
    unsubscribeStderr = srv.onStderr(text => {
      const diagnostics = codexDiagnosticsFromStderr(text);
      if (!diagnostics.length) return;
      for (const diagnostic of diagnostics) pushRecentActivity(s.diagnostics, diagnostic, 6);
      s.lastEvent = 'Codex stderr';
      emit();
    });

    markCodexProgress(s, serverLease.reused ? 'Reusing Codex app-server' : 'Starting Codex app-server');
    emit();
    const appServerStart = Date.now();
    if (!(await srv.ensureRunning(config, opts.extraEnv))) {
      return codexErrorResult('Failed to start codex app-server.', start, opts.sessionId, opts.model, opts.thinkingEffort);
    }
    s.phaseTimings.appServerMs = Date.now() - appServerStart;
    markCodexProgress(s, 'Codex app-server initialized');
    emit();

    const publishTurnControl = () => {
      if (publishedTurnControl || !opts.onCodexTurnReady || !s.sessionId || !s.turnId) return;
      publishedTurnControl = true;
      try {
        const control = {
          threadId: s.sessionId,
          turnId: s.turnId,
          steer: async (prompt: string, attachments: string[] = []) => {
            if (!s.sessionId || !s.turnId) return false;
            const expectedTurnId = s.turnId;
            const clippedPrompt = prompt.slice(0, 200);
            agentLog(`[codex-rpc] turn/steer turn=${expectedTurnId} prompt="${clippedPrompt}${prompt.length > 200 ? '…' : ''}"`);
            const steerResp = await srv.call('turn/steer', {
              threadId: s.sessionId,
              expectedTurnId,
              input: buildCodexTurnInput(prompt, attachments),
            }, 30_000);
            if (steerResp.error) {
              const errMsg = steerResp.error.message || 'turn/steer failed';
              agentWarn(`[codex-rpc] turn/steer error: ${errMsg}`);
              pushRecentActivity(s.recentFailures, `Steer failed: ${shortValue(errMsg, 120)}`, 4);
              emitPreview();
              return false;
            }
            s.turnId = steerResp.result?.turnId ?? s.turnId;
            pushRecentActivity(s.recentNarrative, 'Applied steer input');
            emitPreview();
            return true;
          },
        };
        opts.onSteerReady?.(control.steer);
        opts.onCodexTurnReady?.(control);
      } catch (error: any) {
        agentWarn(`[codex-rpc] onCodexTurnReady error: ${error?.message || error}`);
      }
    };

    // thread/start or thread/resume
    let threadResp: any;
    const threadParams = {
      cwd: opts.workdir,
      model: opts.codexModel || null,
      approvalPolicy: opts.codexFullAccess ? 'never' : undefined,
      sandbox: opts.codexFullAccess ? 'danger-full-access' : undefined,
      developerInstructions: opts.codexDeveloperInstructions || undefined,
    };
    if (opts.sessionId) {
      markCodexProgress(s, 'Resuming Codex thread');
      emit();
      agentLog(`[codex-rpc] thread/resume id=${opts.sessionId}`);
      const threadStart = Date.now();
      threadResp = await srv.call('thread/resume', { threadId: opts.sessionId, ...threadParams }, 60_000);
      s.phaseTimings.threadMs = Date.now() - threadStart;
    } else {
      markCodexProgress(s, 'Starting Codex thread');
      emit();
      agentLog(`[codex-rpc] thread/start cwd=${opts.workdir} model=${opts.codexModel || '(default)'}`);
      const threadStart = Date.now();
      threadResp = await srv.call('thread/start', threadParams, 60_000);
      s.phaseTimings.threadMs = Date.now() - threadStart;
    }

    if (threadResp.error) {
      const errMsg = threadResp.error.message || 'thread/start failed';
      agentWarn(`[codex-rpc] thread error: ${errMsg}`);
      return codexErrorResult(errMsg, start, opts.sessionId, opts.model, opts.thinkingEffort);
    }

    const threadResult = threadResp.result;
    s.sessionId = threadResult.thread?.id ?? s.sessionId;
    s.model = threadResult.model ?? s.model;
    if (s.sessionId) {
      try { opts.onSessionId?.(s.sessionId); } catch (error: any) {
        agentWarn(`[codex-rpc] onSessionId error: ${error?.message || error}`);
      }
    }
    agentLog(`[codex-rpc] thread ready: id=${s.sessionId} model=${s.model}`);
    markCodexProgress(s, 'Codex thread ready');
    emit();

    // turn/start
    const input = buildCodexTurnInput(opts.prompt, opts.attachments || []);
    const deadline = start + opts.timeout * 1000;

    const turnDone = new Promise<void>((resolve) => {
      let settled = false;
      settleTurnDone = () => {
        if (settled) return;
        settled = true;
        settleTurnDone = null;
        resolve();
      };
      const hardTimer = setTimeout(() => {
        timedOut = true;
        agentWarn('[codex-rpc] timeout: interrupting turn');
        if (s.turnId && s.sessionId) srv.call('turn/interrupt', { threadId: s.sessionId, turnId: s.turnId }).catch(() => {});
        settleTurnDone?.();
      }, opts.timeout * 1000 + CODEX_STREAM_HARD_KILL_GRACE_MS);

      unsubscribeNotifications = srv.onNotification((method, params) => {
        handleCodexNotification(method, params, s, opts, deadline, emit, hardTimer, settleTurnDone, publishTurnControl);
      });
      unsubscribeRequests = srv.onRequest((method, params, requestId) => {
        return handleCodexRequest(method, params, requestId, s, opts, emit);
      });
    });

    const abortStream = () => {
      if (interrupted) return;
      interrupted = true;
      s.turnStatus = s.turnStatus || 'interrupted';
      s.turnError = s.turnError || 'Interrupted by user.';
      agentWarn(`[codex-rpc] abort requested thread=${s.sessionId || '?'} turn=${s.turnId || '?'}`);
      if (s.turnId && s.sessionId) {
        // Send turn/interrupt and wait for Codex to acknowledge before settling.
        // Don't kill the process here — let the finally block handle it after
        // Codex has had time to persist the interrupted session state.
        srv.call('turn/interrupt', { threadId: s.sessionId, turnId: s.turnId }, 5_000)
          .finally(() => settleTurnDone?.());
      } else {
        srv.kill();
        settleTurnDone?.();
      }
    };
    if (opts.abortSignal?.aborted) abortStream();
    opts.abortSignal?.addEventListener('abort', abortStream, { once: true });

    // Log equivalent CLI command for reproducibility
    const cliParts = ['codex'];
    if (opts.codexModel) cliParts.push('--model', opts.codexModel);
    if (opts.codexFullAccess) cliParts.push('--full-access');
    const effort = mapEffort(opts.thinkingEffort);
    if (effort) cliParts.push('--effort', effort);
    if (opts.sessionId) cliParts.push('--resume', opts.sessionId);
    if (opts.codexExtraArgs?.length) cliParts.push(...opts.codexExtraArgs);
    cliParts.push('-p', `"${opts.prompt.slice(0, 300)}${opts.prompt.length > 300 ? '…' : ''}"`);
    agentLog(`[codex-rpc] full command: cd ${Q(opts.workdir)} && ${cliParts.join(' ')}`);

    agentLog(`[codex-rpc] turn/start prompt="${opts.prompt.slice(0, 300)}${opts.prompt.length > 300 ? '…' : ''}" effort=${effort}`);
    markCodexProgress(s, 'Starting Codex turn');
    emit();
    const turnStart = Date.now();
    const turnResp = await srv.call('turn/start', {
      threadId: s.sessionId, input,
      model: opts.codexModel || undefined,
      effort: mapEffort(opts.thinkingEffort),
    }, 60_000);
    s.phaseTimings.turnStartMs = Date.now() - turnStart;

    if (turnResp.error) {
      opts.abortSignal?.removeEventListener('abort', abortStream);
      unsubscribeNotifications();
      unsubscribeRequests();
      const errMsg = turnResp.error.message || 'turn/start failed';
      agentWarn(`[codex-rpc] turn/start error: ${errMsg}`);
      return codexErrorResult(errMsg, start, s.sessionId, s.model, s.thinkingEffort);
    }
    s.turnId = turnResp.result?.turn?.id ?? null;
    markCodexProgress(s, 'Codex turn started');
    emit();
    publishTurnControl();

    await turnDone;
    opts.abortSignal?.removeEventListener('abort', abortStream);
    unsubscribeNotifications();
    unsubscribeRequests();

    if (!s.text.trim() && s.msgs.length) s.text = s.msgs.join('\n\n');
    if (!s.thinking.trim() && s.thinkParts.length) s.thinking = s.thinkParts.join('\n\n');
    // Drain any image_gen calls that started but never received a completion
    // event. We've observed runs where the response_item stays at
    // status="generating" and no `rawResponseItem/completed` fires — the PNG
    // is on disk, we just never got told to emit it. Try once at turn end;
    // tryEmit is a no-op for already-emitted entries.
    for (const callId of [...s.pendingImageGen.keys()]) {
      tryEmitCodexImageBlock(s, callId);
    }

    const ok = s.turnStatus === 'completed' && !timedOut && !interrupted;
    const error = s.turnError
      || (interrupted ? 'Interrupted by user.' : null)
      || (timedOut ? `Timed out after ${opts.timeout}s waiting for turn completion.` : null)
      || (!ok ? `Turn ${s.turnStatus || 'unknown'}.` : null);
    const stopReason = timedOut ? 'timeout' : ((interrupted || s.turnStatus === 'interrupted') ? 'interrupted' : null);
    s.phaseTimings.totalMs = Date.now() - start;
    pushRecentActivity(s.diagnostics, buildCodexTimingDiagnostic(s), 6);
    emit();
    discardServerLease = !ok;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    agentLog(`[codex-rpc] result: ok=${ok} elapsed=${elapsed}s text=${s.text.length}chars session=${s.sessionId} status=${s.turnStatus}`);

    return {
      ok, sessionId: s.sessionId,
      workspacePath: null, model: s.model, thinkingEffort: s.thinkingEffort,
      message: stripOaiMemoryCitations(s.text).trim() || error || '(no textual response)',
      thinking: s.thinking.trim() || null,
      plan: s.plan?.steps?.length ? s.plan : null,
      elapsedS: (Date.now() - start) / 1000,
      inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      cachedInputTokens: s.cachedInputTokens, cacheCreationInputTokens: s.cacheCreationInputTokens,
      contextWindow: s.contextWindow, ...computeContext(s),
      codexCumulative: s.codexCumulative, error, stopReason, incomplete: !ok,
      activity: s.activity.trim() || null,
      assistantBlocks: s.imageBlocks.length ? [...s.imageBlocks] : undefined,
    };
  } finally {
    unsubscribeNotifications();
    unsubscribeRequests();
    unsubscribeStderr();
    serverLease?.release(discardServerLease);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Load title index from ~/.codex/session_index.jsonl (deduped, last entry wins). */
function loadCodexSessionIndex(): Map<string, { threadName: string; updatedAt: string }> {
  const home = getHome();
  if (!home) return new Map();
  const indexPath = path.join(home, '.codex', 'session_index.jsonl');
  if (!fs.existsSync(indexPath)) return new Map();
  const map = new Map<string, { threadName: string; updatedAt: string }>();
  try {
    const data = fs.readFileSync(indexPath, 'utf8');
    for (const line of data.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.id) map.set(entry.id, { threadName: entry.thread_name || '', updatedAt: entry.updated_at || '' });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map;
}

const CODEX_TITLE_SCAN_MAX_BYTES = 8 * 1024 * 1024;
const CODEX_TITLE_SCAN_CHUNK_BYTES = 64 * 1024;
const CODEX_TITLE_SCAN_MAX_LINE_CHARS = 1024 * 1024;

function readCodexHeadLines(filePath: string, maxLines = 80): string[] {
  const lines: string[] = [];
  try {
    const stat = fs.statSync(filePath);
    const maxBytes = Math.min(CODEX_TITLE_SCAN_MAX_BYTES, stat.size);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(CODEX_TITLE_SCAN_CHUNK_BYTES);
    let offset = 0;
    let carry = '';
    let discardingLongLine = false;

    try {
      while (offset < maxBytes && lines.length < maxLines) {
        const readSize = Math.min(buf.length, maxBytes - offset);
        const bytesRead = fs.readSync(fd, buf, 0, readSize, offset);
        if (bytesRead <= 0) break;
        offset += bytesRead;

        const parts = buf.toString('utf8', 0, bytesRead).split('\n');
        for (let i = 0; i < parts.length; i++) {
          const segment = parts[i];
          const ended = i < parts.length - 1;

          if (discardingLongLine) {
            if (ended) {
              discardingLongLine = false;
              carry = '';
            }
            continue;
          }

          if (carry.length + segment.length > CODEX_TITLE_SCAN_MAX_LINE_CHARS) {
            carry = '';
            discardingLongLine = !ended;
            continue;
          }

          carry += segment;
          if (ended) {
            const line = carry.trim();
            if (line) lines.push(line);
            carry = '';
            if (lines.length >= maxLines) break;
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* skip */ }
  return lines;
}

function isCodexContextOnlyUserMessage(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('<permissions instructions>');
}

function readCodexInitialQuestion(filePath: string): string | null {
  let responseItemFallback: string | null = null;
  for (const raw of readCodexHeadLines(filePath)) {
    if (!raw || raw[0] !== '{') continue;
    let ev: any;
    try { ev = JSON.parse(raw); } catch { continue; }

    if (ev?.type === 'event_msg' && ev.payload?.type === 'user_message' && typeof ev.payload.message === 'string') {
      const text = sanitizeSessionUserPreviewText(ev.payload.message);
      if (text) return shortValue(text, 120);
      continue;
    }

    if (!responseItemFallback
      && ev?.type === 'response_item'
      && ev.payload?.type === 'message'
      && ev.payload?.role === 'user') {
      const rawText = extractCodexMessageText(ev.payload.content);
      if (isCodexContextOnlyUserMessage(rawText)) continue;
      const text = sanitizeSessionUserPreviewText(rawText);
      if (text) responseItemFallback = shortValue(text, 120);
    }
  }
  return responseItemFallback;
}

/** Scan ~/.codex/sessions/ rollout files to find sessions matching the given workdir. */
function extractCodexTailQA(filePath: string): { lastQuestion: string | null; lastAnswer: string | null; lastMessageText: string | null } {
  const lines = readTailLines(filePath, 128 * 1024);
  let lastQuestion: string | null = null;
  let lastAnswer: string | null = null;
  let lastMessageText: string | null = null;
  for (const raw of lines) {
    if (!raw || raw[0] !== '{' || !raw.includes('"event_msg"')) continue;
    try {
      const ev = JSON.parse(raw);
      if (ev?.type !== 'event_msg' || !ev.payload || typeof ev.payload !== 'object') continue;
      if (ev.payload.type === 'user_message' && typeof ev.payload.message === 'string') {
        const text = sanitizeSessionUserPreviewText(ev.payload.message);
        if (text) {
          lastQuestion = shortValue(text, 500);
          lastMessageText = shortValue(text, 500);
        }
      } else if (ev.payload.type === 'agent_message' && typeof ev.payload.message === 'string') {
        const text = stripOaiMemoryCitations(ev.payload.message).trim();
        if (text) {
          lastAnswer = shortValue(text, 500);
          lastMessageText = shortValue(text, 500);
        }
      }
    } catch { /* skip */ }
  }
  return { lastQuestion, lastAnswer, lastMessageText };
}

function readCodexSessionHead(filePath: string): { sessionId: string; cwd: string; timestamp: string | null; isSubagent: boolean } | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8', 0, bytesRead);
    if (!head.includes('"session_meta"')) return null;

    const idMatch = head.match(/"id"\s*:\s*"([^"]+)"/);
    const cwdMatch = head.match(/"cwd"\s*:\s*"([^"]+)"/);
    const tsMatch = head.match(/"timestamp"\s*:\s*"([^"]+)"/);
    if (!idMatch || !cwdMatch) return null;

    return {
      sessionId: idMatch[1],
      cwd: cwdMatch[1],
      timestamp: tsMatch?.[1] || null,
      isSubagent: /"source"\s*:\s*\{\s*"subagent"\s*:/.test(head) || /"thread_spawn"\s*:/.test(head),
    };
  } catch {
    return null;
  }
}

function getNativeCodexSessions(workdir: string): SessionInfo[] {
  const home = getHome();
  if (!home) return [];
  const sessionsDir = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  const resolvedWorkdir = path.resolve(workdir);
  const titleIndex = loadCodexSessionIndex();
  const sessions: SessionInfo[] = [];
  const seenIds = new Set<string>();

  // Walk year/month/day directories
  const walkDir = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkDir(fullPath); continue; }
      if (!entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;

      // Read first chunk to extract session_meta fields via regex
      // (first line can be very large due to base_instructions, so we avoid full JSON parse)
      try {
        const meta = readCodexSessionHead(fullPath);
        if (!meta) continue;
        if (meta.isSubagent) continue;
        if (path.resolve(meta.cwd) !== resolvedWorkdir) continue;
        const metaId = meta.sessionId;
        const metaCwd = meta.cwd;
        if (seenIds.has(metaId)) continue;
        seenIds.add(metaId);

        const stat = fs.statSync(fullPath);
        const idx = titleIndex.get(metaId);
        const title = idx?.threadName || readCodexInitialQuestion(fullPath);
        const titleSource = idx?.threadName ? 'agent' as const : 'prompt' as const;
        const updatedAt = idx?.updatedAt || stat.mtime.toISOString();
        const tailQA = extractCodexTailQA(fullPath);

        sessions.push({
          sessionId: metaId,
          agent: 'codex',
          workdir: metaCwd,
          workspacePath: null,
          model: null,
          createdAt: meta.timestamp || stat.birthtime.toISOString(),
          title,
          titleSource,
          running: Date.now() - Date.parse(updatedAt) < SESSION_RUNNING_THRESHOLD_MS,
          runState: Date.now() - Date.parse(updatedAt) < SESSION_RUNNING_THRESHOLD_MS ? 'running' : 'completed',
          runDetail: null,
          runUpdatedAt: updatedAt,
          classification: null,
          userStatus: null,
          userNote: null,
          lastQuestion: tailQA.lastQuestion,
          lastAnswer: tailQA.lastAnswer,
          lastMessageText: tailQA.lastMessageText,
          migratedFrom: null,
          migratedTo: null,
          linkedSessions: [],
          numTurns: null,
        });
      } catch { /* skip */ }
    }
  };

  walkDir(sessionsDir);
  return sessions;
}

function readCodexSessionMeta(filePath: string): { sessionId: string; cwd: string } | null {
  const meta = readCodexSessionHead(filePath);
  if (!meta) return null;
  return { sessionId: meta.sessionId, cwd: meta.cwd };
}

function findCodexRolloutPath(sessionId: string, workdir: string): string | null {
  const home = getHome();
  if (!home) return null;
  const sessionsRoot = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(sessionsRoot)) return null;
  const resolvedWorkdir = path.resolve(workdir);

  const walkDir = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walkDir(fullPath);
        if (found) return found;
        continue;
      }
      if (!entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;
      const meta = readCodexSessionMeta(fullPath);
      if (!meta) continue;
      if (meta.sessionId === sessionId && path.resolve(meta.cwd) === resolvedWorkdir) return fullPath;
    }
    return null;
  };

  return walkDir(sessionsRoot);
}

function getCodexSessionTailFromRollout(opts: SessionTailOpts): SessionTailResult {
  const limit = opts.limit ?? 4;
  const rolloutPath = findCodexRolloutPath(opts.sessionId, opts.workdir);
  if (!rolloutPath) return { ok: false, messages: [], error: 'Session history file not found' };

  try {
    const lines = readTailLines(rolloutPath, 512 * 1024);
    const allMsgs: { role: 'user' | 'assistant'; text: string }[] = [];
    for (const raw of lines) {
      if (!raw || raw[0] !== '{' || !raw.includes('"event_msg"')) continue;
      let ev: any;
      try { ev = JSON.parse(raw); } catch { continue; }
      if (ev?.type !== 'event_msg' || !ev.payload || typeof ev.payload !== 'object') continue;
      if (ev.payload.type === 'user_message' && typeof ev.payload.message === 'string') {
        const text = stripInjectedPrompts(ev.payload.message).trim();
        if (text) allMsgs.push({ role: 'user', text });
      } else if (ev.payload.type === 'agent_message' && typeof ev.payload.message === 'string') {
        const text = stripOaiMemoryCitations(ev.payload.message).trim();
        if (text) allMsgs.push({ role: 'assistant', text });
      }
    }
    return { ok: true, messages: allMsgs.slice(-limit), error: null };
  } catch (error: any) {
    return { ok: false, messages: [], error: error?.message || 'Failed to read session history' };
  }
}

function getCodexSessions(workdir: string, limit?: number): SessionListResult {
  const resolvedWorkdir = path.resolve(workdir);
  const pikiclawSessions = listPikiclawSessions(resolvedWorkdir, 'codex', undefined, { includeSideChats: true }).map(record => ({
    sessionId: record.sessionId,
    agent: 'codex' as const,
    workdir: record.workdir,
    workspacePath: record.workspacePath,
    threadId: record.threadId,
    model: record.model,
    createdAt: record.createdAt,
    title: record.title,
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
    lastQuestion: record.lastQuestion,
    lastAnswer: record.lastAnswer,
    lastMessageText: record.lastMessageText,
    migratedFrom: record.migratedFrom,
    migratedTo: record.migratedTo,
    linkedSessions: record.linkedSessions,
    sideChatOf: record.sideChatOf ?? null,
    sideChats: record.sideChats ?? [],
    numTurns: record.numTurns ?? null,
  }));
  const nativeSessions = getNativeCodexSessions(resolvedWorkdir);
  const managedSessions = adoptNativeSessionTitles(resolvedWorkdir, 'codex', pikiclawSessions, nativeSessions);
  const nativeById = new Map(nativeSessions.map(session => [session.sessionId, session]));
  const mergedSessions = managedSessions.map((managed) => {
    const native = managed.sessionId ? nativeById.get(managed.sessionId) : null;
    return native ? mergeManagedAndNativeSessions([managed], [native])[0] || managed : managed;
  });
  const sessions = typeof limit === 'number' ? mergedSessions.slice(0, limit) : mergedSessions;
  const sessionsDir = path.join(getHome(), '.codex', 'sessions');
  agentLog(
    `[sessions:codex] workdir=${resolvedWorkdir} sessionsDir=${sessionsDir} sessionsDirExists=${fs.existsSync(sessionsDir)} ` +
    `pikiclaw=${pikiclawSessions.length} native=${nativeSessions.length} returned=${sessions.length}`
  );
  return { ok: true, sessions, error: null };
}

async function getCodexSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> {
  const limit = opts.limit ?? 4;
  const srv = getSharedServer();
  if (!(await srv.ensureRunning())) return getCodexSessionTailFromRollout(opts);

  const resp = await srv.call('thread/read', { threadId: opts.sessionId, includeTurns: true });
  if (resp.error) {
    const fallback = getCodexSessionTailFromRollout(opts);
    return fallback.ok ? fallback : { ok: false, messages: [], error: resp.error.message || fallback.error || 'thread/read failed' };
  }
  const thread = resp.result?.thread;
  if (!thread) {
    const fallback = getCodexSessionTailFromRollout(opts);
    return fallback.ok ? fallback : { ok: false, messages: [], error: 'No thread data returned' };
  }

  const allMsgs: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const turn of (thread.turns ?? [])) {
    for (const item of (turn.items ?? [])) {
      if (item.type === 'userMessage') {
        const parts: string[] = [];
        for (const c of (item.content ?? [])) { if (c.type === 'text' && c.text) parts.push(c.text); }
        const text = stripInjectedPrompts(parts.join('\n')).trim();
        if (text) allMsgs.push({ role: 'user', text });
      } else if (item.type === 'agentMessage') {
        if (item.text) allMsgs.push({ role: 'assistant', text: item.text });
      }
    }
  }
  const messages = allMsgs.slice(-limit);
  if (messages.length > 0) return { ok: true, messages, error: null };
  return getCodexSessionTailFromRollout(opts);
}

// ---------------------------------------------------------------------------
// Session messages (full content)
// ---------------------------------------------------------------------------

async function getCodexSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> {
  if (opts.rich) {
    const rolloutResult = getCodexSessionMessagesFromRollout(opts);
    if (rolloutResult.ok) return rolloutResult;
  }

  // Try RPC first
  const srv = getSharedServer();
  if (await srv.ensureRunning()) {
    try {
      const resp = await srv.call('thread/read', { threadId: opts.sessionId, includeTurns: true });
      if (!resp.error && resp.result?.thread) {
        const thread = resp.result.thread;
        const allMsgs: TailMessage[] = [];
        const richMsgs: RichMessage[] = [];
        for (const turn of (thread.turns ?? [])) {
          for (const item of (turn.items ?? [])) {
            const createdAt = codexMessageCreatedAt(item, turn);
            if (item.type === 'userMessage') {
              const user = codexUserContentToRich(item.content ?? []);
              if (user.text || user.imageBlocks.length) {
                const blocks: MessageBlock[] = user.text
                  ? [{ type: 'text', content: user.text }, ...user.imageBlocks]
                  : [...user.imageBlocks];
                const text = user.text;
                allMsgs.push({ role: 'user', text });
                richMsgs.push({ role: 'user', text, blocks, createdAt });
              }
            } else if (item.type === 'agentMessage') {
              if (item.text) {
                allMsgs.push({ role: 'assistant', text: item.text });
                richMsgs.push({
                  role: 'assistant',
                  text: item.text,
                  createdAt,
                  blocks: [{
                    type: 'text',
                    content: item.text,
                    phase: item.phase === 'commentary' ? 'commentary' : 'final_answer',
                  }],
                });
              }
            }
          }
        }
        if (allMsgs.length > 0) {
          return applyTurnWindow(allMsgs, opts, richMsgs);
        }
      }
    } catch { /* fall through to rollout */ }
  }

  // Fallback: read full rollout file
  return getCodexSessionMessagesFromRollout(opts);
}

function imageBlockFromCodexImageUrl(rawUrl: unknown): MessageBlock | null {
  const imageUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!imageUrl) return null;

  const dataMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  if (dataMatch) {
    return { type: 'image', content: imageUrl, imageMime: dataMatch[1].toLowerCase() };
  }

  if (imageUrl.startsWith('file://')) {
    const filePath = imageUrl.slice('file://'.length);
    return attachAgentImage({ imagePath: filePath }) || { type: 'image', content: imageUrl, imagePath: filePath };
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return { type: 'image', content: imageUrl };
  }

  return null;
}

function imageBlocksFromCodexLocalImages(value: unknown): MessageBlock[] {
  const paths = Array.isArray(value) ? value : [];
  const blocks: MessageBlock[] = [];
  for (const entry of paths) {
    const imagePath = typeof entry === 'string'
      ? entry
      : typeof entry?.path === 'string'
        ? entry.path
        : '';
    if (!imagePath) continue;
    const block = attachAgentImage({ imagePath });
    if (block) blocks.push(block);
  }
  return blocks;
}

function imageBlocksFromCodexImages(value: unknown): MessageBlock[] {
  const images = Array.isArray(value) ? value : [];
  const blocks: MessageBlock[] = [];
  for (const entry of images) {
    const rawUrl = typeof entry === 'string'
      ? entry
      : entry?.image_url ?? entry?.url ?? entry?.data ?? null;
    const block = imageBlockFromCodexImageUrl(rawUrl);
    if (block) blocks.push(block);
  }
  return blocks;
}

function dedupeImageBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const seen = new Set<string>();
  const out: MessageBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'image') {
      out.push(block);
      continue;
    }
    const key = block.imagePath || block.content;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(block);
  }
  return out;
}

function codexUserContentToRich(content: unknown[]): { text: string; imageBlocks: MessageBlock[] } {
  const parts: string[] = [];
  const imageBlocks: MessageBlock[] = [];
  for (const item of content) {
    const block = item as any;
    if (!block || typeof block !== 'object') continue;
    if ((block.type === 'text' || block.type === 'input_text') && typeof block.text === 'string') {
      parts.push(block.text);
      continue;
    }
    if (block.type === 'localImage' && typeof block.path === 'string') {
      const image = attachAgentImage({ imagePath: block.path });
      if (image) imageBlocks.push(image);
      continue;
    }
    if (block.type === 'input_image' || block.type === 'image_url') {
      const image = imageBlockFromCodexImageUrl(block.image_url ?? block.url);
      if (image) imageBlocks.push(image);
    }
  }
  return { text: stripInjectedPrompts(parts.join('\n')).trim(), imageBlocks: dedupeImageBlocks(imageBlocks) };
}

function getCodexSessionMessagesFromRollout(opts: SessionMessagesOpts): SessionMessagesResult {
  const rolloutPath = findCodexRolloutPath(opts.sessionId, opts.workdir);
  if (!rolloutPath) return { ok: false, messages: [], totalTurns: 0, error: 'Session history file not found' };

  try {
    const content = fs.readFileSync(rolloutPath, 'utf-8');
    const lines = content.split('\n');
    const allMsgs: TailMessage[] = [];
    const richMsgs: RichMessage[] = [];
    const fallbackMsgs: TailMessage[] = [];
    const fallbackRichMsgs: RichMessage[] = [];
    let pendingAssistant: PendingCodexAssistantMessage | null = null;
    let sawAssistantResponseItems = false;

    const ensureAssistant = (createdAt?: string | null): PendingCodexAssistantMessage => {
      if (!pendingAssistant) pendingAssistant = { blocks: [], toolNamesByCallId: new Map(), createdAt: createdAt || null };
      else if (!pendingAssistant.createdAt && createdAt) pendingAssistant.createdAt = createdAt;
      return pendingAssistant;
    };

    const flushAssistant = () => {
      if (!pendingAssistant) return;
      const blocks = pendingAssistant.blocks.filter(block =>
        block.type === 'plan'
        || block.type === 'image'
        || block.type === 'tool_use'
        || block.type === 'tool_result'
        || !!block.content.trim(),
      );
      const createdAt = pendingAssistant.createdAt;
      pendingAssistant = null;
      if (!blocks.length) return;
      const text = buildCodexAssistantText(blocks);
      allMsgs.push({ role: 'assistant', text });
      richMsgs.push({ role: 'assistant', text, blocks, createdAt });
    };

    for (const raw of lines) {
      if (!raw || raw[0] !== '{') continue;
      let ev: any;
      try { ev = JSON.parse(raw); } catch { continue; }
      if (!ev?.payload || typeof ev.payload !== 'object') continue;
      const createdAt = codexMessageCreatedAt(ev.payload, ev);

      if (ev.type === 'event_msg') {
        if (ev.payload.type === 'user_message' && typeof ev.payload.message === 'string') {
          flushAssistant();
          const text = stripInjectedPrompts(ev.payload.message).trim();
          const imageBlocks = dedupeImageBlocks([
            ...imageBlocksFromCodexLocalImages(ev.payload.local_images),
            ...imageBlocksFromCodexImages(ev.payload.images),
          ]);
          if (!text && imageBlocks.length === 0) continue;
          const userMessage: TailMessage = { role: 'user', text };
          const blocks: MessageBlock[] = text
            ? [{ type: 'text', content: text }, ...imageBlocks]
            : imageBlocks;
          fallbackMsgs.push(userMessage);
          fallbackRichMsgs.push({ role: 'user', text, blocks, createdAt });
          allMsgs.push(userMessage);
          richMsgs.push({ role: 'user', text, blocks, createdAt });
        } else if (ev.payload.type === 'agent_message' && typeof ev.payload.message === 'string') {
          const text = stripOaiMemoryCitations(ev.payload.message).trim();
          if (text) {
            fallbackMsgs.push({ role: 'assistant', text });
            fallbackRichMsgs.push({
              role: 'assistant',
              text,
              blocks: [{ type: 'text', content: text, phase: 'final_answer' }],
              createdAt,
            });
          }
        }
        continue;
      }

      if (ev.type !== 'response_item') continue;
      const payload = ev.payload;

      if (payload.type === 'message') {
        if (payload.role !== 'assistant') continue;
        const text = extractCodexMessageText(payload.content);
        if (!text) continue;
        ensureAssistant(createdAt).blocks.push({
          type: 'text',
          content: text,
          phase: payload.phase === 'commentary' ? 'commentary' : 'final_answer',
        });
        sawAssistantResponseItems = true;
        continue;
      }

      if (payload.type === 'reasoning') {
        const text = extractCodexReasoningText(payload);
        if (!text) continue;
        ensureAssistant(createdAt).blocks.push({ type: 'thinking', content: text });
        sawAssistantResponseItems = true;
        continue;
      }

      if (payload.type === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name) continue;
        const assistant = ensureAssistant(createdAt);
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        if (callId) assistant.toolNamesByCallId.set(callId, name);
        if (name === 'update_plan') {
          const plan = normalizeStreamPreviewPlan(parseCodexArguments(payload.arguments));
          if (plan) {
            assistant.blocks.push({
              type: 'plan',
              content: formatCodexPlanSummary(plan),
              plan,
            });
            sawAssistantResponseItems = true;
          }
          continue;
        }
        assistant.blocks.push({
          type: 'tool_use',
          content: formatCodexArguments(payload.arguments),
          toolName: name,
          toolId: callId || undefined,
        });
        sawAssistantResponseItems = true;
        continue;
      }

      if (payload.type === 'function_call_output') {
        const assistant = ensureAssistant(createdAt);
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const toolName = assistant.toolNamesByCallId.get(callId) || '';
        const output = formatCodexArguments(payload.output);
        if (toolName === 'update_plan' && output === 'Plan updated') continue;
        assistant.blocks.push({
          type: 'tool_result',
          content: output,
          toolName: toolName || undefined,
          toolId: callId || undefined,
        });
        sawAssistantResponseItems = true;
        continue;
      }

      // image_generation_call: Codex's built-in `image_gen` tool — surface the
      // file on disk as an image block so historical sessions render images
      // (not just text). Path: $CODEX_HOME/generated_images/<sessionId>/<id>.png
      if (payload.type === 'image_generation_call' || payload.type === 'imageGenerationCall') {
        const block = buildCodexImageBlock(opts.sessionId, payload);
        if (block) {
          ensureAssistant(createdAt).blocks.push(block);
          sawAssistantResponseItems = true;
        }
        continue;
      }

      const fallbackSummary = summarizeCodexRawResponseItem(payload);
      if (fallbackSummary) {
        ensureAssistant(createdAt).blocks.push({
          type: 'tool_use',
          content: formatCodexArguments(payload),
          toolName: fallbackSummary,
        });
        sawAssistantResponseItems = true;
      }
    }
    flushAssistant();

    if (!sawAssistantResponseItems && fallbackMsgs.some(message => message.role === 'assistant')) {
      return applyTurnWindow(fallbackMsgs, opts, opts.rich ? fallbackRichMsgs : undefined);
    }

    const richWithOverlay = overlayCodexManagedPreview(opts.workdir, opts.sessionId, richMsgs);
    const plainWithOverlay = richWithOverlay.map(message => ({ role: message.role, text: message.text }));
    return applyTurnWindow(plainWithOverlay, opts, opts.rich ? richWithOverlay : undefined);
  } catch (e: any) {
    return { ok: false, messages: [], totalTurns: 0, error: e?.message || 'Failed to read session history' };
  }
}

// ---------------------------------------------------------------------------
// Models (with TTL cache + stale fallback)
// ---------------------------------------------------------------------------

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let modelCache: { result: ModelListResult; fetchedAt: number } | null = null;

function pushModel(models: ModelInfo[], seen: Set<string>, id: string, alias: string | null) {
  const cleanId = id.trim();
  if (!cleanId || seen.has(cleanId)) return;
  seen.add(cleanId);
  models.push({ id: cleanId, alias: alias?.trim() || null });
}

/** Merge currentModel into a cached result so the selected model always appears first. */
function withCurrentModel(cached: ModelListResult, currentModel: string | null | undefined): ModelListResult {
  if (!currentModel?.trim()) return cached;
  const cm = currentModel.trim();
  if (cached.models.some(m => m.id === cm)) return cached;
  return { ...cached, models: [{ id: cm, alias: null }, ...cached.models] };
}

async function discoverCodexModels(opts: ModelListOpts): Promise<ModelListResult> {
  // Return cached result if still fresh
  if (modelCache && Date.now() - modelCache.fetchedAt < MODEL_CACHE_TTL_MS) {
    return withCurrentModel(modelCache.result, opts.currentModel);
  }

  // Try fetching fresh
  const srv = getSharedServer();
  if (!(await srv.ensureRunning())) {
    if (modelCache) return withCurrentModel(modelCache.result, opts.currentModel);
    return { agent: 'codex', models: [], sources: [], note: 'Failed to start codex app-server.' };
  }

  const resp = await srv.call('model/list', { includeHidden: false });
  if (resp.error) {
    if (modelCache) return withCurrentModel(modelCache.result, opts.currentModel);
    return { agent: 'codex', models: [], sources: [], note: resp.error.message || 'model/list failed' };
  }

  const data: any[] = resp.result?.data ?? [];
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  if (opts.currentModel?.trim()) pushModel(models, seen, opts.currentModel.trim(), null);
  for (const entry of data) {
    const id = entry.model || entry.id;
    if (!id || seen.has(id)) continue;
    pushModel(models, seen, id, entry.displayName && entry.displayName !== id ? entry.displayName : null);
  }

  const result: ModelListResult = { agent: 'codex', models, sources: ['app-server model/list'], note: null };
  modelCache = { result, fetchedAt: Date.now() };
  return result;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function getCodexStateDbPath(home: string): string | null {
  const root = path.join(home, '.codex');
  if (!fs.existsSync(root)) return null;
  try {
    const files = fs.readdirSync(root)
      .filter(name => /^state.*\.sqlite$/i.test(name))
      .map(name => ({ name, full: path.join(root, name), mtime: fs.statSync(path.join(root, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.full || null;
  } catch { return null; }
}

function codexUsageFromRateLimits(rateLimits: any, capturedAt: string | null, source: string): UsageResult | null {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const windows = [
    usageWindowFromRateLimit('Primary', rateLimits.primary),
    usageWindowFromRateLimit('Secondary', rateLimits.secondary),
  ].filter((v): v is UsageWindowInfo => !!v);
  if (!windows.length) return null;
  let status: string | null = null;
  if (rateLimits.limit_reached === true) status = 'limit_reached';
  else if (rateLimits.allowed === true) status = 'allowed';
  return { ok: true, agent: 'codex', source, capturedAt, status, windows, error: null };
}

function getCodexUsageFromStateDb(home: string): UsageResult | null {
  const dbPath = getCodexStateDbPath(home);
  if (!dbPath) return null;
  try {
    const query = "SELECT ts || '|' || message FROM logs WHERE message LIKE '%codex.rate_limits%' ORDER BY ts DESC LIMIT 1;";
    // stdio: 'pipe' keeps sqlite3 stderr ("no such table", "unable to open") out
    // of pikiclaw's own stderr — this probe is best-effort and the catch below
    // already swallows failures.
    const out = execSync(`sqlite3 -noheader ${Q(dbPath)} ${Q(query)}`, { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!out) return null;
    const sep = out.indexOf('|');
    const rawTs = sep >= 0 ? out.slice(0, sep) : '';
    const rawMessage = sep >= 0 ? out.slice(sep + 1) : out;
    const payload = parseJsonTail(rawMessage);
    const capturedAt = toIsoFromEpochSeconds(rawTs);
    return codexUsageFromRateLimits(payload?.rate_limits, capturedAt, 'state-db');
  } catch { return null; }
}

function getCodexUsageFromSessions(home: string): UsageResult | null {
  const sessionsRoot = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(sessionsRoot)) return null;

  const all: { path: string; mtime: number }[] = [];
  try {
    for (const year of fs.readdirSync(sessionsRoot)) {
      const yp = path.join(sessionsRoot, year);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const month of fs.readdirSync(yp)) {
        const mp = path.join(yp, month);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const day of fs.readdirSync(mp)) {
          const dp = path.join(mp, day);
          if (!fs.statSync(dp).isDirectory()) continue;
          for (const f of fs.readdirSync(dp)) {
            if (!f.endsWith('.jsonl')) continue;
            all.push({ path: path.join(dp, f), mtime: fs.statSync(path.join(dp, f)).mtimeMs });
          }
        }
      }
    }
  } catch { return null; }

  all.sort((a, b) => b.mtime - a.mtime);
  for (const entry of all.slice(0, 30)) {
    try {
      const lines = fs.readFileSync(entry.path, 'utf-8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
        const raw = lines[i];
        if (!raw || raw[0] !== '{' || !raw.includes('rate_limits')) continue;
        let ev: any;
        try { ev = JSON.parse(raw); } catch { continue; }
        const result = codexUsageFromRateLimits(ev?.payload?.rate_limits, typeof ev?.timestamp === 'string' ? ev.timestamp : null, 'session-history');
        if (result) return result;
      }
    } catch {}
  }
  return null;
}

function parseRateLimitWindow(label: string, rl: any): UsageWindowInfo | null {
  if (!rl || typeof rl !== 'object') return null;
  const usedPercent = roundPercent(rl.usedPercent);
  return {
    label: labelFromWindowMinutes(rl.windowDurationMins, label),
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.max(0, Math.round((100 - usedPercent) * 10) / 10),
    resetAt: toIsoFromEpochSeconds(rl.resetsAt),
    resetAfterSeconds: rl.resetsAt ? Math.max(0, Math.round(rl.resetsAt - Date.now() / 1000)) : null,
    status: null,
  };
}

export async function getCodexUsageLive(): Promise<UsageResult> {
  const home = getHome();
  const srv = getSharedServer();
  if (!(await srv.ensureRunning())) {
    return getCodexUsageFromStateDb(home) || emptyUsage('codex', 'Failed to start codex app-server.');
  }

  const resp = await srv.call('account/rateLimits/read');
  if (resp.error) return getCodexUsageFromStateDb(home) || emptyUsage('codex', resp.error.message || 'account/rateLimits/read failed');

  const rl = resp.result?.rateLimits;
  if (!rl) return getCodexUsageFromStateDb(home) || emptyUsage('codex', 'No rate limits in response.');

  const capturedAt = new Date().toISOString();
  const windows: UsageWindowInfo[] = [];
  const w1 = parseRateLimitWindow('Primary', rl.primary);
  if (w1) windows.push(w1);
  const w2 = parseRateLimitWindow('Secondary', rl.secondary);
  if (w2) windows.push(w2);

  return {
    ok: windows.length > 0, agent: 'codex', source: 'app-server-live', capturedAt, status: null,
    windows, error: windows.length > 0 ? null : 'No rate limit windows.',
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

class CodexDriver implements AgentDriver {
  readonly id = 'codex';
  readonly cmd = 'codex';
  readonly thinkLabel = 'Reasoning';
  readonly capabilities = {
    fork: false,
    modelSwitch: true,
    plan: {
      mode: 'native',
      source: 'turn/plan/updated + proposed_plan',
      statusSource: 'codex app-server stream',
      commands: ['/plan'],
      actions: ['start', 'clarify', 'approve', 'cancel', 'implement'],
    },
    goal: {
      mode: 'native',
      source: 'thread/goal/* RPC',
      statusSource: 'codex goals sqlite/app-server',
      commands: ['/goal'],
      actions: ['set', 'pause', 'resume', 'clear', 'status'],
    },
    humanInput: {
      mode: 'native',
      source: 'item/tool/requestUserInput',
      actions: ['ask'],
    },
    approval: {
      mode: 'native',
      source: 'Codex app-server approval events',
      actions: ['approveTool'],
    },
    artifacts: {
      mode: 'native',
      source: 'Codex stream items',
      actions: ['render', 'recover'],
    },
    resume: {
      mode: 'native',
      source: 'Codex rollout/thread id',
      actions: ['resume', 'recover'],
    },
    forkCapability: {
      mode: 'unsupported',
      note: 'Codex fork is not exposed through the current app-server contract.',
    },
    steer: {
      mode: 'native',
      source: 'Codex turn control',
      actions: ['steer'],
    },
    mcp: {
      mode: 'native',
      source: 'session-scoped MCP bridge',
      actions: ['useMcp'],
    },
    imageGeneration: {
      mode: 'native',
      source: 'imageGenerationCall/image_generation_call',
      actions: ['generate', 'render'],
    },
  } satisfies import('../types.js').AgentDriverCapabilities;
  readonly acceptedProviderKinds = ['openai', 'openai-compatible'] as const;

  async doStream(opts: StreamOpts): Promise<StreamResult> { return doCodexStream(opts); }

  async getSessions(workdir: string, limit?: number): Promise<SessionListResult> {
    return getCodexSessions(workdir, limit);
  }

  async getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> {
    return getCodexSessionTail(opts);
  }

  async getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> {
    return getCodexSessionMessages(opts);
  }

  async listModels(opts: ModelListOpts): Promise<ModelListResult> { return discoverCodexModels(opts); }

  getUsage(opts: UsageOpts): UsageResult {
    const home = getHome();
    if (!home) return emptyUsage('codex', 'HOME is not set.');
    return getCodexUsageFromStateDb(home)
      || getCodexUsageFromSessions(home)
      || emptyUsage('codex', 'No recent Codex usage data found.');
  }

  async getUsageLive(opts: UsageOpts): Promise<UsageResult> { return getCodexUsageLive(); }

  async deleteNativeSession(workdir: string, sessionId: string): Promise<string[]> {
    return deleteNativeCodexSession(workdir, sessionId);
  }

  shutdown() { shutdownCodexServer(); }
}

/**
 * Locate and remove the codex rollout file backing a session. Codex stores
 * sessions under `~/.codex/sessions/<year>/<month>/<day>/rollout-<...>.jsonl`,
 * keyed by `meta.sessionId` inside the file rather than the filename — so we
 * walk the tree and match on the parsed head metadata, scoped to `workdir`.
 */
async function deleteNativeCodexSession(workdir: string, sessionId: string): Promise<string[]> {
  const home = getHome();
  if (!home || !sessionId) return [];
  const sessionsDir = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  const resolvedWorkdir = path.resolve(workdir);
  const removed: string[] = [];

  const walk = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(full)) return true;
        continue;
      }
      if (!entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;
      try {
        const meta = readCodexSessionHead(full);
        if (!meta || meta.sessionId !== sessionId) continue;
        if (path.resolve(meta.cwd) !== resolvedWorkdir) continue;
        fs.rmSync(full, { force: true });
        removed.push(full);
        return true;
      } catch { /* skip */ }
    }
    return false;
  };

  walk(sessionsDir);
  return removed;
}

registerDriver(new CodexDriver());
