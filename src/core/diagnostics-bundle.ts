/**
 * Local diagnostics bundle generation for user-controlled troubleshooting.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadUserConfig, getUserConfigPath, type UserConfig } from './config/user-config.js';
import { VERSION } from './version.js';

const DIAGNOSTICS_SCHEMA_VERSION = 1;
const DIAGNOSTICS_LOG_MAX_BYTES = 180_000;
const DIAGNOSTICS_LOG_MAX_LINES = 1_200;
const DIAGNOSTICS_RATE_WINDOW_MS = 60_000;
const DIAGNOSTICS_RATE_LIMIT = 5;

const SENSITIVE_KEY_RE = /(?:token|secret|password|passwd|credential|authorization|cookie|bearer|private|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|refresh[_-]?token|bot[_-]?token|app[_-]?secret)/i;
const TEXT_SECRET_RES = [
  /(\b(?:authorization|bearer)\s*[:=]\s*)([^\s'",}]+)/gi,
  /(\b(?:token|secret|password|passwd|api[_-]?key|client[_-]?secret|bot[_-]?token|app[_-]?secret)\s*[:=]\s*)([^\s'",}]+)/gi,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(xox[a-z]-[A-Za-z0-9-]{12,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g,
] as const;

const SAFE_ENV_KEYS = [
  'NODE_ENV',
  'PIKICLAW_CONFIG',
  'PIKICLAW_LOG_LEVEL',
  'PIKICLAW_DEV_BACKGROUND',
  'PIKICLAW_DEV_FOREGROUND',
  'PIKICLAW_DEV_DETACHED',
  'PIKICLAW_LOG_MAX_LINES',
  'PIKICLAW_LOG_MAX_AGE_MS',
  'PIKICLAW_LOG_TRIM_EVERY_WRITES',
] as const;

export interface DiagnosticsRuntimeSnapshot {
  dashboardAttached?: boolean;
  workdir?: string;
  defaultAgent?: string;
  defaultModel?: string | null;
  knownAgents?: string[];
}

export interface DiagnosticsLogEntry {
  path: string;
  exists: boolean;
  bytes?: number;
  modifiedAt?: string;
  truncated?: boolean;
  content?: string;
  error?: string;
}

export interface DiagnosticsBundlePayload {
  schemaVersion: number;
  generatedAt: string;
  app: {
    name: 'pikiclaw';
    version: string;
  };
  process: {
    pid: number;
    cwd: string;
    platform: string;
    arch: string;
    nodeVersion: string;
  };
  runtime: unknown;
  config: {
    path: string;
    exists: boolean;
    data: unknown;
  };
  environment: Record<string, string>;
  logs: DiagnosticsLogEntry[];
}

export interface DiagnosticsBundleResult {
  filename: string;
  contentType: 'application/gzip';
  data: Buffer;
  byteLength: number;
  payload: DiagnosticsBundlePayload;
}

export interface BuildDiagnosticsBundleOptions {
  now?: Date;
  config?: Partial<UserConfig>;
  configPath?: string;
  runtime?: DiagnosticsRuntimeSnapshot;
  logPaths?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homeDir?: string;
  cwd?: string;
  pid?: number;
  platform?: NodeJS.Platform | string;
  arch?: string;
  nodeVersion?: string;
}

const diagnosticsRequestTimestamps: number[] = [];

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function diagnosticsFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `pikiclaw-diagnostics-${stamp}.json.gz`;
}

function redactTextSecrets(text: string): string {
  let next = text;
  for (const re of TEXT_SECRET_RES) {
    next = next.replace(re, (match, prefix) => {
      if (typeof prefix === 'string' && prefix.length < match.length) return `${prefix}[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return next;
}

function looksLikeSensitiveKey(keyPath: string[]): boolean {
  return keyPath.some(key => SENSITIVE_KEY_RE.test(key));
}

export function redactDiagnosticsValue(value: unknown, keyPath: string[] = []): unknown {
  if (value == null) return value;
  if (looksLikeSensitiveKey(keyPath)) return '[REDACTED]';
  if (typeof value === 'string') return redactTextSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item, index) => redactDiagnosticsValue(item, [...keyPath, String(index)]));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDiagnosticsValue(child, [...keyPath, key]);
    }
    return out;
  }
  return String(value);
}

function pickDiagnosticsEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  return out;
}

function readFileTail(filePath: string, maxBytes = DIAGNOSTICS_LOG_MAX_BYTES, maxLines = DIAGNOSTICS_LOG_MAX_LINES): DiagnosticsLogEntry {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { path: filePath, exists: false, error: 'not a regular file' };
    }
    const bytesToRead = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - bytesToRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, start);
      let content = buffer.toString('utf8');
      if (start > 0) {
        const firstBreak = content.indexOf('\n');
        if (firstBreak >= 0) content = content.slice(firstBreak + 1);
      }
      const lines = content.replace(/\r\n/g, '\n').split('\n');
      const truncatedByLines = lines.length > maxLines;
      if (truncatedByLines) content = lines.slice(-maxLines).join('\n');
      return {
        path: filePath,
        exists: true,
        bytes: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        truncated: start > 0 || truncatedByLines,
        content: redactTextSecrets(content),
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return {
      path: filePath,
      exists: false,
      error: err instanceof Error ? err.message : String(err ?? 'unknown error'),
    };
  }
}

function defaultLogPaths(homeDir: string): string[] {
  return uniqueStrings([
    path.join(homeDir, '.pikiclaw', 'dev', 'dev.log'),
    path.join(homeDir, '.pikiclaw', 'pikiclaw.log'),
  ]);
}

export function buildDiagnosticsBundle(options: BuildDiagnosticsBundleOptions = {}): DiagnosticsBundleResult {
  const now = options.now || new Date();
  const homeDir = options.homeDir || os.homedir();
  const configPath = options.configPath || getUserConfigPath();
  const config = options.config || loadUserConfig();
  const logPaths = uniqueStrings(options.logPaths || defaultLogPaths(homeDir));
  const payload: DiagnosticsBundlePayload = {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    app: {
      name: 'pikiclaw',
      version: VERSION,
    },
    process: {
      pid: options.pid ?? process.pid,
      cwd: options.cwd || process.cwd(),
      platform: options.platform || process.platform,
      arch: options.arch || process.arch,
      nodeVersion: options.nodeVersion || process.version,
    },
    runtime: redactDiagnosticsValue(options.runtime || {}),
    config: {
      path: configPath,
      exists: safeExists(configPath),
      data: redactDiagnosticsValue(config),
    },
    environment: redactDiagnosticsValue(pickDiagnosticsEnv(options.env || process.env)) as Record<string, string>,
    logs: logPaths.map(filePath => readFileTail(filePath)),
  };
  const json = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const data = zlib.gzipSync(json);
  return {
    filename: diagnosticsFilename(now),
    contentType: 'application/gzip',
    data,
    byteLength: data.byteLength,
    payload,
  };
}

export function checkDiagnosticsRateLimit(now = Date.now()): { allowed: boolean; retryAfterMs?: number } {
  const cutoff = now - DIAGNOSTICS_RATE_WINDOW_MS;
  while (diagnosticsRequestTimestamps.length && diagnosticsRequestTimestamps[0] < cutoff) {
    diagnosticsRequestTimestamps.shift();
  }
  if (diagnosticsRequestTimestamps.length >= DIAGNOSTICS_RATE_LIMIT) {
    const retryAfterMs = Math.max(1000, DIAGNOSTICS_RATE_WINDOW_MS - (now - diagnosticsRequestTimestamps[0]));
    return { allowed: false, retryAfterMs };
  }
  diagnosticsRequestTimestamps.push(now);
  return { allowed: true };
}

export function resetDiagnosticsRateLimitForTests(): void {
  diagnosticsRequestTimestamps.length = 0;
}
