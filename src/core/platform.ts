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

function parseNodeVersion(value: string): [number, number, number] | null {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nodeVersionAtLeast(value: string, minimum: string): boolean {
  const current = parseNodeVersion(value);
  const min = parseNodeVersion(minimum);
  if (!current || !min) return false;
  for (let i = 0; i < 3; i++) {
    if (current[i] > min[i]) return true;
    if (current[i] < min[i]) return false;
  }
  return true;
}

function compareNodeVersionDesc(a: string, b: string): number {
  const av = parseNodeVersion(a) || [0, 0, 0];
  const bv = parseNodeVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return bv[i] - av[i];
  }
  return 0;
}

function resolveNvmAliasVersion(aliasValue: string, installedVersions: string[]): string | null {
  const alias = String(aliasValue || '').trim().split(/\s+/)[0];
  if (!alias) return null;
  if (installedVersions.includes(alias)) return alias;
  const numeric = alias.match(/^(\d+)(?:\.(\d+))?$/);
  if (numeric) {
    const prefix = `v${numeric[1]}${numeric[2] ? `.${numeric[2]}` : ''}`;
    return installedVersions
      .filter(version => version === prefix || version.startsWith(`${prefix}.`))
      .sort(compareNodeVersionDesc)[0] || null;
  }
  return null;
}

/** nvm node bin dirs satisfying a minimum version, default alias first. */
export function nvmNodeBinDirsAtLeast(minimumVersion = '22.19.0', env: NodeJS.ProcessEnv = process.env): string[] {
  if (IS_WIN) return [];
  const nvmDir = env.NVM_DIR || path.join(getHome(), '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  let installedVersions: string[] = [];
  try {
    installedVersions = fs.readdirSync(versionsDir)
      .filter(name => nodeVersionAtLeast(name, minimumVersion))
      .sort(compareNodeVersionDesc);
  } catch {
    return [];
  }
  if (!installedVersions.length) return [];

  let defaultVersion: string | null = null;
  try {
    defaultVersion = resolveNvmAliasVersion(
      fs.readFileSync(path.join(nvmDir, 'alias', 'default'), 'utf8'),
      installedVersions,
    );
  } catch { /* no default alias */ }

  const ordered = [
    ...(defaultVersion ? [defaultVersion] : []),
    ...installedVersions,
  ];
  const seen = new Set<string>();
  return ordered
    .filter(version => {
      if (seen.has(version)) return false;
      seen.add(version);
      return true;
    })
    .map(version => path.join(versionsDir, version, 'bin'))
    .filter(dir => {
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

/** Return an env that prefers a locally installed Node satisfying minimumVersion. */
export function processEnvWithNodeAtLeast(
  minimumVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const base = processEnvWithUserBins(env);
  const current = String(base.PATH || '');
  const parts = current.split(path.delimiter).filter(Boolean);
  const seen = new Set<string>();
  const prepend = nvmNodeBinDirsAtLeast(minimumVersion, base);
  const merged = [...prepend, ...parts].filter(dir => {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
  return { ...base, PATH: merged.join(path.delimiter) };
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
