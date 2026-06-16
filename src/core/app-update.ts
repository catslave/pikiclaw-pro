import { VERSION } from './version.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const PACKAGE_NAME = 'pikiclaw';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;
const DEFAULT_TIMEOUT_MS = 12_000;
const INSTALL_COMMAND = `npm install -g ${PACKAGE_NAME}@latest`;
const execFileAsync = promisify(execFile);

export interface AppUpdateStatus {
  ok: boolean;
  packageName: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  registryUrl: string;
  packageUrl: string;
  installCommand: string;
  detail: string;
  error?: string;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function cleanVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

function parseVersion(value: string): { parts: number[]; prerelease: string } {
  const withoutBuild = cleanVersion(value).split('+')[0] || '';
  const [core = '', prerelease = ''] = withoutBuild.split('-', 2);
  const parts = core.split('.').slice(0, 3).map(part => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease };
}

export function compareAppVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = left.parts[index] - right.parts[index];
    if (diff < 0) return -1;
    if (diff > 0) return 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function buildAppUpdateStatus(currentVersion: string, latestVersion: string | null, checkedAt = new Date().toISOString()): AppUpdateStatus {
  const current = cleanVersion(currentVersion || VERSION);
  const latest = latestVersion ? cleanVersion(latestVersion) : null;
  const updateAvailable = latest ? compareAppVersions(current, latest) < 0 : false;
  return {
    ok: Boolean(latest),
    packageName: PACKAGE_NAME,
    currentVersion: current,
    latestVersion: latest,
    updateAvailable,
    checkedAt,
    registryUrl: REGISTRY_URL,
    packageUrl: NPM_PACKAGE_URL,
    installCommand: INSTALL_COMMAND,
    detail: !latest
      ? 'Could not read the latest package version.'
      : updateAvailable
        ? `Pikiclaw ${latest} is available on npm.`
        : `Pikiclaw ${current} is current.`,
  };
}

export async function checkAppUpdate(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
} = {}): Promise<AppUpdateStatus> {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('Fetch is not available in this runtime.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    try {
      const response = await fetchImpl(REGISTRY_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
      const raw = await response.json();
      const latestVersion = raw && typeof raw === 'object' && typeof (raw as { version?: unknown }).version === 'string'
        ? (raw as { version: string }).version
        : null;
      return buildAppUpdateStatus(VERSION, latestVersion);
    } catch (fetchErr) {
      const latestVersion = await readLatestVersionWithNpmCli(options.timeoutMs || DEFAULT_TIMEOUT_MS);
      const status = buildAppUpdateStatus(VERSION, latestVersion);
      return {
        ...status,
        detail: `${status.detail} Checked with npm CLI after registry fetch failed.`,
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr || ''),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readLatestVersionWithNpmCli(timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync('npm', ['view', PACKAGE_NAME, 'version', '--json'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024,
  });
  const trimmed = String(stdout || '').trim();
  if (!trimmed) throw new Error('npm view returned an empty version.');
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
  } catch {
    // Plain stdout is accepted below.
  }
  return trimmed.replace(/^"|"$/g, '').trim();
}

export function buildAppUpdateErrorStatus(error: unknown): AppUpdateStatus {
  const message = error instanceof Error ? error.message : String(error || 'Update check failed.');
  return {
    ...buildAppUpdateStatus(VERSION, null),
    ok: false,
    detail: 'Could not check npm for the latest Pikiclaw release.',
    error: message,
  };
}
