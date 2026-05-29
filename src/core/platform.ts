/**
 * Cross-platform primitives. All OS-dependent behavior must route through here
 * so the rest of the codebase stays platform-neutral.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import which from 'which';
import { envBool } from './utils.js';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';

/** Detect if running inside a Docker container. */
export function isInsideContainer(): boolean {
  return envBool('PIKICLAW_DOCKER', false);
}

/**
 * User home directory. Re-reads each call so runtime `$HOME`/`$USERPROFILE`
 * overrides (and tests that mutate them) stay honored. Works on Windows
 * where `$HOME` is not set by default — `os.homedir()` falls back to
 * `$USERPROFILE`.
 */
export function getHome(): string {
  return os.homedir();
}

/** Expand a leading `~` (or `~/`, `~\`) to the user's home directory. */
export function expandTilde(p: string): string {
  if (!p || p[0] !== '~') return p;
  const home = getHome();
  if (p === '~') return home;
  if (p.startsWith('~/') || (IS_WIN && p.startsWith('~\\'))) {
    return path.join(home, p.slice(2));
  }
  return p;
}

/** Locate an executable on PATH, honoring PATHEXT on Windows. */
export function whichSync(cmd: string): string | null {
  return which.sync(cmd, { nothrow: true, path: processEnvWithUserBins().PATH }) || null;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (IS_WIN) return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableCandidates(cmd: string): string[] {
  if (!IS_WIN) return [cmd];
  const ext = path.extname(cmd).toLowerCase();
  if (ext) return [cmd];
  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(value => value.trim())
    .filter(Boolean);
  return [cmd, ...pathExt.map(value => `${cmd}${value.toLowerCase()}`)];
}

/** User-level bin dirs that GUI-launched processes often miss. */
export function userBinDirs(home = getHome()): string[] {
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(dir => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });
}

/** Return an env with common user bin dirs appended to PATH. */
export function processEnvWithUserBins(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const current = String(env.PATH || '');
  const parts = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(parts.map(part => path.resolve(part)));
  const append = userBinDirs()
    .filter(dir => !seen.has(path.resolve(dir)));
  if (!append.length) return { ...env };
  return { ...env, PATH: [...parts, ...append].join(path.delimiter) };
}

/** Resolve a command using PATH plus common user bin dirs. */
export function resolveExecutablePath(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(cmd || '').trim();
  if (!raw) return null;

  const hasPathSeparator = raw.includes('/') || raw.includes('\\');
  if (hasPathSeparator) {
    const absolutePath = path.resolve(expandTilde(raw));
    for (const candidate of executableCandidates(absolutePath)) {
      if (isExecutableFile(candidate)) return candidate;
    }
    return null;
  }

  const expandedEnv = processEnvWithUserBins(env);
  const searchPaths = String(expandedEnv.PATH || '')
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
  for (const dir of searchPaths) {
    for (const candidate of executableCandidates(path.join(dir, raw))) {
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Encode an absolute workdir path as a single directory-name segment.
 * Mirrors Claude Code's scheme under `~/.claude/projects/`: every non
 * alphanumeric character collapses to `-`. Critically that includes
 * underscores and dots (e.g. `/path/to/harness_ppt` → `-path-to-harness-ppt`),
 * which matches the encoding Claude Code uses on disk. Replacing only path
 * separators leaves a workdir whose name contains `_` (or `.`) pointing at
 * a directory that does not exist, so session JSONL lookups silently fall
 * back to an empty/truncated result.
 */
export function encodePathAsDirName(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Match a path segment regardless of separator. Useful for probing whether a
 * resolved script path runs under a given binary (e.g. `tsx`, `ts-node`)
 * without hardcoding `/` — which fails on Windows.
 */
export function pathContainsSegment(p: string, segment: string): boolean {
  const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[\\\\/]${escaped}([\\\\/]|$)`).test(p);
}

/** Null-redirect suffix for shell commands. */
export const DEV_NULL_REDIRECT = IS_WIN ? '2>nul' : '2>/dev/null';
