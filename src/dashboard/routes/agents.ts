/**
 * Dashboard API routes: agent detection, model listing, installation.
 */

import { Hono } from 'hono';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAgentInstallCommand, getAgentLabel, getAgentPackage } from '../../agent/npm.js';
import { copilotAuthEnv } from '../../agent/copilot-auth.js';
import { loadUserConfig, saveUserConfig, applyUserConfig, type UserConfig } from '../../core/config/user-config.js';
import { detectAgentBin, setAgentBoundModelId, type AgentDetectOptions, type UsageResult } from '../../agent/index.js';
import { getAgentUpdateState, getAllAgentUpdateStates, checkAgentLatestVersion, manualAgentUpdate } from '../../agent/auto-update.js';
import type { Agent } from '../../agent/index.js';
import { getDriver, getDriverCapabilities } from '../../agent/driver.js';
import {
  getActiveProfile, getProvider,
  peekProviderModelList, prefetchProviderModels,
} from '../../model/index.js';
import { DASHBOARD_TIMEOUTS } from '../../core/constants.js';
import { withTimeoutFallback } from '../../core/utils.js';
import { processEnvWithNodeAtLeast, processEnvWithUserBins, resolveExecutablePath } from '../../core/platform.js';
import { runtime } from '../runtime.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_STATUS_MODELS_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentStatusModels;
const AGENT_STATUS_USAGE_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentStatusUsage;
const AGENT_STATUS_CACHE_TTL_MS = DASHBOARD_TIMEOUTS.agentStatusCacheTtl;
const AGENT_INSTALL_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentInstall;
const AGENT_HEALTH_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentHealth;
const OPENCLAW_GATEWAY_GUIDANCE = 'OpenClaw CLI is installed, but its Gateway is not running or not reachable. Click Start on the OpenClaw card, or run `openclaw gateway start` if you are outside pikiclaw.';
const OPENCLAW_NODE_MIN_VERSION = '22.19.0';
const OPENCLAW_ACP_BACKEND = 'acpx';
const OPENCLAW_ACP_AGENT_IDS = ['codex', 'cursor'] as const;
const OPENCLAW_ACP_INSTALL_COMMAND = 'Install Codex CLI and Cursor Agent from the pikiclaw Agents page, then start OpenClaw again.';
const COMPUTER_USE_MCP_SERVER = {
  command: 'npx',
  args: ['-y', '-p', '@steipete/peekaboo', 'peekaboo-mcp'],
};
type OpenClawAcpAgentId = (typeof OPENCLAW_ACP_AGENT_IDS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupeModels(models: { id: string; alias: string | null }[]): { id: string; alias: string | null }[] {
  const seen = new Set<string>();
  const deduped: { id: string; alias: string | null }[] = [];
  for (const model of models) {
    const id = String(model?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, alias: model.alias?.trim() || null });
  }
  return deduped;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; stdin?: string } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const spawnEnv = processEnvWithUserBins({
      ...process.env,
      ...(opts.env || {}),
      npm_config_yes: 'true',
      npm_config_fetch_retries: '1',
      npm_config_fetch_timeout: '30000',
      npm_config_fetch_retry_mintimeout: '1000',
      npm_config_fetch_retry_maxtimeout: '5000',
    });
    const resolvedCmd = resolveExecutablePath(cmd, spawnEnv) || cmd;
    const child = spawn(resolvedCmd, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
    });
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    else child.stdin?.end();
    const timeoutMs = Math.max(500, opts.timeoutMs ?? DASHBOARD_TIMEOUTS.runCommand);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error: err.message });
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        error: code === 0 ? null : (stderr.trim() || stdout.trim() || `Exited with code ${code}`),
      });
    });
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function openClawCommandEnv(): Record<string, string> {
  return stringEnv(processEnvWithNodeAtLeast(OPENCLAW_NODE_MIN_VERSION));
}

/**
 * Parse `ENOTEMPTY: ... rename 'A' -> 'B'` paths out of npm stderr and remove
 * any staging dirs (siblings of the package dir whose name starts with `.`).
 * Never touches the live package dir itself.
 */
function cleanupNpmStagingFromError(stderr: string): string[] {
  const removed: string[] = [];
  const re = /rename\s+'([^']+)'\s+->\s+'([^']+)'/g;
  const candidates = new Set<string>();
  for (let m: RegExpExecArray | null; (m = re.exec(stderr));) {
    candidates.add(m[1]);
    candidates.add(m[2]);
  }
  for (const p of candidates) {
    const base = path.basename(p);
    if (!base.startsWith('.')) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(p);
    } catch { /* best effort */ }
  }
  return removed;
}

async function installAgentViaNpm(
  agent: Agent,
  log: (msg: string) => void,
  workdir?: string,
  config: Partial<UserConfig> = loadUserConfig(),
): Promise<void> {
  const pkg = getAgentPackage(agent);
  if (!pkg) throw new Error(`Unsupported agent: ${agent}`);
  log(`Installing ${getAgentLabel(agent)} via npm...`);
  let result = await runCommand('npm', ['install', '-g', `${pkg}@latest`], {
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
    env: agent === 'openclaw' ? openClawCommandEnv() : undefined,
  });
  if (!result.ok && /ENOTEMPTY/.test(result.stderr)) {
    const removed = cleanupNpmStagingFromError(result.stderr);
    if (removed.length > 0) {
      log(`Cleaned npm staging dirs after ENOTEMPTY: ${removed.join(', ')}; retrying...`);
      result = await runCommand('npm', ['install', '-g', `${pkg}@latest`], {
        timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
        env: agent === 'openclaw' ? openClawCommandEnv() : undefined,
      });
    }
  }
  if (!result.ok) throw new Error(result.error || `Failed to install ${pkg}`);
  if (agent === 'openclaw') {
    await completeOpenClawGatewayInstall(log, workdir, config);
  }
  log(`${getAgentLabel(agent)} installation complete.`);
}

function commandOutput(result: { stdout: string; stderr: string; error: string | null }): string {
  return clipHealthOutput([result.stdout, result.stderr, result.error || ''].filter(Boolean).join('\n'));
}

function isOpenClawGatewayReady(output: string): boolean {
  const text = String(output || '');
  if (!text.trim()) return false;
  if (/connect\s+ECONNREFUSED/i.test(text)) return false;
  if (/Connectivity probe:\s*failed/i.test(text)) return false;
  if (/Service (?:unit )?not found/i.test(text)) return false;
  if (/Service not installed/i.test(text)) return false;
  if (/Could not find service/i.test(text)) return false;
  if (/Gateway is not running/i.test(text)) return false;
  return true;
}

async function runOpenClawCommand(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; stdin?: string } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  return runCommand('openclaw', args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? AGENT_HEALTH_TIMEOUT_MS,
    env: openClawCommandEnv(),
    stdin: opts.stdin,
  });
}

async function requireOpenClawCommand(
  label: string,
  args: string[],
  log: (msg: string) => void,
  opts: { cwd?: string; timeoutMs?: number; stdin?: string } = {},
): Promise<void> {
  log(`${label}: openclaw ${args.join(' ')}`);
  const result = await runOpenClawCommand(args, opts);
  if (!result.ok) {
    throw new Error(`${label} failed: ${commandOutput(result) || result.error || 'unknown error'}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeUniqueStrings(values: unknown, additions: readonly string[]): string[] {
  const merged = new Set<string>();
  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) merged.add(value.trim());
    }
  }
  for (const value of additions) merged.add(value);
  return [...merged];
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function setStringDefault(target: Record<string, unknown>, key: string, value: string | null | undefined): void {
  if (nonEmptyString(target[key])) return;
  const next = nonEmptyString(value);
  if (next) target[key] = next;
}

function cursorAcpCommand(): Record<string, unknown> {
  return {
    command: resolveExecutablePath('cursor-agent', openClawCommandEnv()) || 'cursor-agent',
    args: ['acp'],
  };
}

function openClawCodexAcpPlatformPackage(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'codex-acp-darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'codex-acp-darwin-x64';
  if (platform === 'linux' && arch === 'arm64') return 'codex-acp-linux-arm64';
  if (platform === 'linux' && arch === 'x64') return 'codex-acp-linux-x64';
  if (platform === 'win32' && arch === 'arm64') return 'codex-acp-win32-arm64';
  if (platform === 'win32' && arch === 'x64') return 'codex-acp-win32-x64';
  return null;
}

function codexAcpBinaryIsRunnable(binPath: string): boolean {
  try {
    const result = spawnSync(binPath, ['--help'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function restoreCodexAcpBinaryFromOfflineCache(binPath: string, packageName: string, log: (msg: string) => void): boolean {
  const packageSpec = `@zed-industries/${packageName}@0.13.0`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-codex-acp-'));
  try {
    const pack = spawnSync('npm', ['pack', '--offline', packageSpec], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 60_000,
      env: processEnvWithUserBins(process.env),
    });
    if (pack.status !== 0) return false;
    const tarball = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tarball) return false;
    const unpack = spawnSync('tar', ['-xzf', tarball, '-C', tempDir], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (unpack.status !== 0) return false;
    const fallbackBin = path.join(tempDir, 'package', 'bin', process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp');
    const stat = fs.statSync(fallbackBin);
    if (!stat.isFile()) return false;
    fs.copyFileSync(fallbackBin, binPath);
    if (process.platform !== 'win32') fs.chmodSync(binPath, 0o755);
    log(`Restored OpenClaw Codex ACP binary from offline npm cache (${packageSpec}).`);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function repairOpenClawAcpxBinaryPermissions(log: (msg: string) => void, configFile: string | null): void {
  const home = process.env.HOME || '';
  if (!home) return;
  const openClawHome = path.join(home, '.openclaw');
  const resolvedConfigFile = configFile ? path.resolve(configFile) : '';
  if (!resolvedConfigFile.startsWith(`${path.resolve(openClawHome)}${path.sep}`)) return;
  const zedScopeDir = path.join(
    openClawHome,
    'npm',
    'node_modules',
    '@openclaw',
    'acpx',
    'node_modules',
    '@zed-industries',
  );
  let repaired = 0;
  try {
    for (const packageName of fs.readdirSync(zedScopeDir)) {
      if (!packageName.startsWith('codex-acp-')) continue;
      const binPath = path.join(zedScopeDir, packageName, 'bin', 'codex-acp');
      let stat: fs.Stats;
      try { stat = fs.statSync(binPath); } catch { continue; }
      if (!stat.isFile()) continue;
      if ((stat.mode & 0o111) !== 0) continue;
      fs.chmodSync(binPath, stat.mode | 0o755);
      repaired++;
    }
  } catch {
    return;
  }
  if (repaired > 0) log(`Repaired OpenClaw Codex ACP executable permissions (${repaired} file${repaired === 1 ? '' : 's'}).`);

  const platformPackage = openClawCodexAcpPlatformPackage();
  if (!platformPackage) return;
  const binName = process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp';
  const binPath = path.join(zedScopeDir, platformPackage, 'bin', binName);
  try {
    if (process.platform !== 'win32') {
      const stat = fs.statSync(binPath);
      if (stat.isFile() && (stat.mode & 0o111) === 0) fs.chmodSync(binPath, stat.mode | 0o755);
    }
  } catch {
    return;
  }
  if (codexAcpBinaryIsRunnable(binPath)) return;
  if (restoreCodexAcpBinaryFromOfflineCache(binPath, platformPackage, log) && codexAcpBinaryIsRunnable(binPath)) return;
  log('OpenClaw Codex ACP binary is present but not runnable; Codex ACP may need OpenClaw/acpx reinstall.');
}

function openClawAcpAgentPatch(
  existingConfig: unknown,
  workdir: string,
  config: Partial<UserConfig> = loadUserConfig(),
): Record<string, unknown> {
  const existing = isPlainObject(existingConfig) ? existingConfig : {};
  const existingAcp = isPlainObject(existing.acp) ? existing.acp : {};
  const existingDispatch = isPlainObject(existingAcp.dispatch) ? existingAcp.dispatch : {};
  const existingRuntime = isPlainObject(existingAcp.runtime) ? existingAcp.runtime : {};
  const existingAgents = isPlainObject(existing.agents) ? existing.agents : {};
  const existingPlugins = isPlainObject(existing.plugins) ? existing.plugins : {};
  const existingPluginEntries = isPlainObject(existingPlugins.entries) ? existingPlugins.entries : {};
  const existingAcpxEntry = isPlainObject(existingPluginEntries.acpx) ? existingPluginEntries.acpx : {};
  const existingAcpxConfig = isPlainObject(existingAcpxEntry.config) ? existingAcpxEntry.config : {};
  const existingAcpxAgents = isPlainObject(existingAcpxConfig.agents) ? existingAcpxConfig.agents : {};
  const existingMcp = isPlainObject(existing.mcp) ? existing.mcp : {};
  const existingMcpServers = isPlainObject(existingMcp.servers) ? existingMcp.servers : {};
  const existingList = Array.isArray(existingAgents.list) ? existingAgents.list : [];
  const nextList = existingList
    .filter(item => isPlainObject(item) && typeof item.id === 'string' && item.id.trim())
    .map(item => ({ ...item }));

  const upsertAcpAgent = (id: OpenClawAcpAgentId, name: string) => {
    const index = nextList.findIndex(item => item.id === id);
    const current = index >= 0 ? nextList[index] : { id };
    const currentRuntime = isPlainObject(current.runtime) ? current.runtime : {};
    const currentRuntimeAcp = isPlainObject(currentRuntime.acp) ? currentRuntime.acp : {};
    const currentWorkspace = typeof current.workspace === 'string' && current.workspace.trim()
      ? current.workspace.trim()
      : workdir;
    const next = {
      ...current,
      id,
      name: typeof current.name === 'string' && current.name.trim() ? current.name : name,
      description: typeof current.description === 'string' && current.description.trim()
        ? current.description
        : `${name} exposed to OpenClaw through pikiclaw ACP integration.`,
      workspace: currentWorkspace,
      runtime: {
        ...currentRuntime,
        type: 'acp',
        acp: {
          ...currentRuntimeAcp,
          agent: id,
          backend: typeof currentRuntimeAcp.backend === 'string' && currentRuntimeAcp.backend.trim()
            ? currentRuntimeAcp.backend
            : OPENCLAW_ACP_BACKEND,
          mode: typeof currentRuntimeAcp.mode === 'string' && currentRuntimeAcp.mode.trim()
            ? currentRuntimeAcp.mode
            : 'persistent',
          cwd: typeof currentRuntimeAcp.cwd === 'string' && currentRuntimeAcp.cwd.trim()
            ? currentRuntimeAcp.cwd
            : currentWorkspace,
        },
      },
    };
    if (id === 'cursor') {
      delete next.model;
      delete next.thinkingDefault;
    } else {
      setStringDefault(next, 'model', runtime.getRuntimeModel(id, config));
      setStringDefault(next, 'thinkingDefault', runtime.getRuntimeEffort(id, config));
    }
    if (index >= 0) nextList[index] = next;
    else nextList.push(next);
  };

  upsertAcpAgent('codex', 'Codex');
  upsertAcpAgent('cursor', 'Cursor');

  const nextAcpxAgents: Record<string, unknown> = { ...existingAcpxAgents };
  if (!isPlainObject(nextAcpxAgents.cursor)) nextAcpxAgents.cursor = cursorAcpCommand();

  const computerUseEnabled = (config as Record<string, unknown>).computerUseEnabled === true
    || (config as Record<string, unknown>).peekabooEnabled === true;
  const nextMcpServers: Record<string, unknown> = { ...existingMcpServers };
  if (computerUseEnabled && process.platform === 'darwin') {
    nextMcpServers['computer-use'] = isPlainObject(nextMcpServers['computer-use'])
      ? { ...COMPUTER_USE_MCP_SERVER, ...nextMcpServers['computer-use'] }
      : COMPUTER_USE_MCP_SERVER;
  }

  return {
    acp: {
      ...existingAcp,
      enabled: true,
      backend: typeof existingAcp.backend === 'string' && existingAcp.backend.trim()
        ? existingAcp.backend
        : OPENCLAW_ACP_BACKEND,
      defaultAgent: typeof existingAcp.defaultAgent === 'string' && existingAcp.defaultAgent.trim()
        ? existingAcp.defaultAgent
        : 'codex',
      allowedAgents: mergeUniqueStrings(existingAcp.allowedAgents, OPENCLAW_ACP_AGENT_IDS),
      dispatch: {
        ...existingDispatch,
        enabled: true,
      },
      runtime: {
        ...existingRuntime,
        installCommand: typeof existingRuntime.installCommand === 'string' && existingRuntime.installCommand.trim()
          ? existingRuntime.installCommand
        : OPENCLAW_ACP_INSTALL_COMMAND,
      },
    },
    plugins: {
      ...existingPlugins,
      entries: {
        ...existingPluginEntries,
        acpx: {
          ...existingAcpxEntry,
          enabled: true,
          config: {
            ...existingAcpxConfig,
            cwd: nonEmptyString(existingAcpxConfig.cwd) || workdir,
            probeAgent: nonEmptyString(existingAcpxConfig.probeAgent) || 'codex',
            agents: nextAcpxAgents,
          },
        },
      },
    },
    mcp: {
      ...existingMcp,
      servers: nextMcpServers,
    },
    agents: {
      list: nextList,
    },
  };
}

async function readOpenClawConfig(workdir?: string): Promise<{ config: unknown; file: string | null }> {
  const fileResult = await runOpenClawCommand(['config', 'file'], {
    cwd: workdir,
    timeoutMs: AGENT_HEALTH_TIMEOUT_MS,
  });
  if (!fileResult.ok) return { config: {}, file: null };
  const file = fileResult.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!file) return { config: {}, file: null };
  try {
    return { config: JSON.parse(fs.readFileSync(file, 'utf8')), file };
  } catch {
    return { config: {}, file };
  }
}

async function ensureOpenClawAcpAgents(
  log: (msg: string) => void,
  workdir: string,
  config: Partial<UserConfig> = loadUserConfig(),
): Promise<void> {
  const { config: existingConfig, file: configFile } = await readOpenClawConfig(workdir);
  const patch = openClawAcpAgentPatch(existingConfig, workdir, config);
  await requireOpenClawCommand(
    'Configuring OpenClaw ACP agents for Codex and Cursor',
    ['config', 'patch', '--stdin', '--replace-path', 'agents.list'],
    log,
    {
      cwd: workdir,
      timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
      stdin: JSON.stringify(patch),
    },
  );
  await requireOpenClawCommand('Validating OpenClaw ACP config', ['config', 'validate'], log, {
    cwd: workdir,
    timeoutMs: AGENT_HEALTH_TIMEOUT_MS,
  });
  repairOpenClawAcpxBinaryPermissions(log, configFile);
}

async function completeOpenClawGatewayInstall(
  log: (msg: string) => void,
  workdir?: string,
  config: Partial<UserConfig> = loadUserConfig(),
): Promise<void> {
  // OpenClaw's Gateway is a managed service. A dashboard "Install" should leave
  // the card ready to use instead of requiring the user to discover daemon setup
  // in a terminal.
  await requireOpenClawCommand('Initializing OpenClaw baseline config', ['setup'], log, {
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
  });
  await ensureOpenClawAcpAgents(log, workdir || process.cwd(), config);
  await requireOpenClawCommand('Installing OpenClaw Gateway service', ['gateway', 'install', '--force'], log, {
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
  });
  log('Starting OpenClaw Gateway service: openclaw gateway start');
  const startResult = await runOpenClawCommand(['gateway', 'start'], { timeoutMs: AGENT_HEALTH_TIMEOUT_MS });
  if (!startResult.ok) {
    const statusAfterStart = await runOpenClawCommand(['gateway', 'status'], { timeoutMs: AGENT_HEALTH_TIMEOUT_MS });
    if (!statusAfterStart.ok) {
      throw new Error(`Starting OpenClaw Gateway service failed: ${commandOutput(startResult) || startResult.error || 'unknown error'}`);
    }
    log('OpenClaw Gateway was already reachable after start attempt.');
  }
  await requireOpenClawCommand('Verifying OpenClaw Gateway service', ['gateway', 'status'], log, {
    timeoutMs: AGENT_HEALTH_TIMEOUT_MS,
  });
}

function clipHealthOutput(value: string, max = 900): string {
  const text = String(value || '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

export async function runAgentHealthCheck(agent: Agent, workdir: string): Promise<{
  ok: boolean;
  agent: Agent;
  checkedAt: string;
  detail: string;
  output: string | null;
}> {
  const checkedAt = new Date().toISOString();
  let command: { cmd: string; args: string[]; timeoutMs?: number };
  switch (agent) {
    case 'claude':
      command = { cmd: 'claude', args: ['--version'], timeoutMs: 8_000 };
      break;
    case 'codex':
      command = { cmd: 'codex', args: ['login', 'status'], timeoutMs: 8_000 };
      break;
    case 'copilot':
      command = { cmd: 'copilot', args: ['--version'], timeoutMs: 8_000 };
      break;
    case 'cursor':
      command = { cmd: 'cursor-agent', args: ['--version'], timeoutMs: 8_000 };
      break;
    case 'gemini':
      command = { cmd: 'gemini', args: ['--version'], timeoutMs: 8_000 };
      break;
    case 'hermes':
      command = { cmd: 'hermes', args: ['auth', 'list'], timeoutMs: 8_000 };
      break;
    case 'openclaw':
      command = { cmd: 'openclaw', args: ['gateway', 'status'], timeoutMs: 20_000 };
      break;
    default:
      command = { cmd: agent, args: ['--version'] };
      break;
  }

  const agentState = detectAgentBin(command.cmd, agent, { refresh: true });
  if (!agentState.installed) {
    return { ok: false, agent, checkedAt, detail: `${getAgentLabel(agent)} CLI is not installed or not on PATH.`, output: null };
  }

  const result = await runCommand(command.cmd, command.args, {
    cwd: workdir,
    timeoutMs: command.timeoutMs ?? AGENT_HEALTH_TIMEOUT_MS,
    env: agent === 'copilot'
      ? copilotAuthEnv()
      : agent === 'openclaw'
        ? openClawCommandEnv()
        : undefined,
  });
  const output = clipHealthOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (!result.ok) {
    if (agent === 'openclaw') {
      return {
        ok: false,
        agent,
        checkedAt,
        detail: OPENCLAW_GATEWAY_GUIDANCE,
        output: output || result.error || null,
      };
    }
    return {
      ok: false,
      agent,
      checkedAt,
      detail: result.error || `${getAgentLabel(agent)} health check failed.`,
      output: output || null,
    };
  }

  if (agent === 'openclaw' && !isOpenClawGatewayReady(output || result.stdout || result.stderr)) {
    return {
      ok: false,
      agent,
      checkedAt,
      detail: OPENCLAW_GATEWAY_GUIDANCE,
      output: output || result.error || null,
    };
  }

  if (agent === 'hermes') {
    const nativeConfig = getDriver('hermes').getNativeConfig?.() || null;
    const hasCredentials = /\(.+credentials?\):/i.test(output) || /\boauth\b/i.test(output);
    if (!nativeConfig && !getActiveProfile('hermes')) {
      return {
        ok: false,
        agent,
        checkedAt,
        detail: 'Hermes has credentials, but no native config or pikiclaw Profile is bound.',
        output: output || null,
      };
    }
    if (!hasCredentials) {
      return {
        ok: false,
        agent,
        checkedAt,
        detail: 'Hermes did not report any auth credentials.',
        output: output || null,
      };
    }
  }

  return {
    ok: true,
    agent,
    checkedAt,
    detail: `${getAgentLabel(agent)} responded to the health check.`,
    output: output || null,
  };
}

export async function startOpenClawGatewayService(
  workdir: string,
  config: Partial<UserConfig> = loadUserConfig(),
): Promise<{
  ok: boolean;
  agent: Agent;
  checkedAt: string;
  detail: string;
  output: string | null;
}> {
  const checkedAt = new Date().toISOString();
  const log = (msg: string) => runtime.log(`[agents] ${msg}`);
  const setupResult = await runOpenClawCommand(['setup'], {
    cwd: workdir,
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
  });
  if (!setupResult.ok) {
    return {
      ok: false,
      agent: 'openclaw',
      checkedAt,
      detail: 'OpenClaw Gateway start failed because setup failed.',
      output: commandOutput(setupResult),
    };
  }
  try {
    await ensureOpenClawAcpAgents(log, workdir, config);
  } catch (err) {
    return {
      ok: false,
      agent: 'openclaw',
      checkedAt,
      detail: 'OpenClaw Gateway start failed because Codex/Cursor ACP config failed.',
      output: err instanceof Error ? err.message : String(err),
    };
  }

  const startResult = await runOpenClawCommand(['gateway', 'start'], { cwd: workdir });
  const statusAfterStart = await runAgentHealthCheck('openclaw', workdir);
  if (statusAfterStart.ok) {
    return {
      ...statusAfterStart,
      detail: startResult.ok
        ? 'OpenClaw Gateway started with Codex/Cursor ACP agents configured.'
        : 'OpenClaw Gateway is already running with Codex/Cursor ACP agents configured.',
    };
  }

  const installResult = await runOpenClawCommand(['gateway', 'install', '--force'], {
    cwd: workdir,
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
  });
  if (!installResult.ok) {
    return {
      ok: false,
      agent: 'openclaw',
      checkedAt,
      detail: `OpenClaw Gateway start failed, and service install also failed.`,
      output: commandOutput({ ...installResult, error: installResult.error || startResult.error }),
    };
  }

  const retryStart = await runOpenClawCommand(['gateway', 'start'], { cwd: workdir });
  if (!retryStart.ok) {
    return {
      ok: false,
      agent: 'openclaw',
      checkedAt,
      detail: 'OpenClaw Gateway service is installed, but start failed.',
      output: commandOutput(retryStart),
    };
  }

  const health = await runAgentHealthCheck('openclaw', workdir);
  if (health.ok) return { ...health, detail: 'OpenClaw Gateway started with Codex/Cursor ACP agents configured.' };
  return health;
}

// ---------------------------------------------------------------------------
// Agent status builder
// ---------------------------------------------------------------------------

function emptyUsage(agent: Agent, error: string): UsageResult {
  return { ok: false, agent, source: null, capturedAt: null, status: null, windows: [], error };
}

async function buildAgentStatusResponse(config = loadUserConfig(), agentOptions: AgentDetectOptions = {}) {
  const setupState = runtime.getSetupState(config, { includeVersion: true, ...agentOptions });
  const workdir = runtime.getRuntimeWorkdir(config);
  const defaultAgent = runtime.getRuntimeDefaultAgent(config);
  const agents = await Promise.all(setupState.agents.map(async (agentState) => {
    const agentId = runtime.isAgent(agentState.agent) ? agentState.agent : null;
    if (!agentId) {
      return {
        ...agentState,
        selectedModel: null,
        selectedEffort: null,
        isDefault: false,
        models: [],
        usage: null,
      };
    }

    const runtimeSelectedModel = runtime.getRuntimeModel(agentId, config);
    const runtimeSelectedEffort = runtime.getRuntimeEffort(agentId, config);
    let models: { id: string; alias: string | null }[] = [];
    let usage: UsageResult = emptyUsage(agentId, 'Agent not installed.');
    let nativeConfig: ReturnType<NonNullable<ReturnType<typeof getDriver>['getNativeConfig']>> = null;

    if (agentState.installed) {
      try {
        const driver = getDriver(agentId);
        if (driver.getNativeConfig) {
          try { nativeConfig = driver.getNativeConfig(); } catch { /* tolerate driver errors */ }
        }
        const modelFallback = runtimeSelectedModel ? [{ id: runtimeSelectedModel, alias: null }] : [];
        const cachedUsage = driver.getUsage({ agent: agentId, model: runtimeSelectedModel });
        // The dashboard agent card lets the user *edit* the binding — when
        // they toggle the provider to "Native", the model field must show
        // the agent CLI's own catalogue, not the provider's. We deliberately
        // call the driver's `listModels` directly (bypassing
        // `resolveAgentModels`'s BYOK substitution) so `models` is always the
        // native list; the BYOK catalogue is exposed separately as
        // `byokModels` below.
        const [resolvedModels, resolvedUsage] = await Promise.all([
          withTimeoutFallback(
            driver.listModels({ workdir, currentModel: runtimeSelectedModel }).then(result => dedupeModels([
              ...modelFallback,
              ...result.models,
            ])),
            AGENT_STATUS_MODELS_TIMEOUT_MS,
            modelFallback,
          ),
          driver.getUsageLive
            ? withTimeoutFallback(
              driver.getUsageLive({ agent: agentId, model: runtimeSelectedModel }),
              AGENT_STATUS_USAGE_TIMEOUT_MS,
              cachedUsage,
            )
            : Promise.resolve(cachedUsage),
        ]);
        models = resolvedModels;
        usage = resolvedUsage;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        usage = emptyUsage(agentId, detail || 'Usage query failed.');
      }
    }

    const updateState = getAgentUpdateState(agentId);

    // BYOK binding — when an active Profile exists, it overrides the native
    // model/effort surfaces. Otherwise the values fall through to the user's
    // runtime override and then to the driver's native config.
    const activeProfile = getActiveProfile(agentId);
    const byokProvider = activeProfile ? getProvider(activeProfile.providerId) : null;
    const byokProviderName = byokProvider?.name || null;

    // Native model/effort — what the user would run under the agent CLI's
    // own auth, independent of any active BYOK Profile. AgentTab uses these
    // as defaults when the user toggles a card's provider back to "Native".
    const nativeSelectedModel = runtimeSelectedModel || nativeConfig?.model || null;
    const nativeSelectedEffort = runtimeSelectedEffort || nativeConfig?.effort || null;
    // The BYOK-bound model is what the agent will ACTUALLY run (the injector
    // overrides `--model`/codex `model` at spawn). Surface it everywhere the
    // UI quotes "current model" — the InputComposer pill, the cascade label,
    // the agent card. Falling back to the native values when no Profile is
    // bound preserves the existing native-auth path.
    const selectedModel = activeProfile?.modelId || nativeSelectedModel;
    const selectedEffort = activeProfile?.effort || nativeSelectedEffort;

    // Likewise, the InputComposer cascade should list the bound provider's
    // catalogue — those are the models the agent can actually serve through
    // BYOK, not the native CLI's hardcoded list. We expose it as a SEPARATE
    // `byokModels` field rather than overwriting `models`, because AgentTab's
    // provider/model row falls back to `models` whenever the user temporarily
    // switches the editor to the native provider — we mustn't silently leak
    // BYOK ids into that view. Read from the provider-models cache
    // synchronously; miss triggers a background refresh and we degrade to the
    // bound model id alone so the user can at least see it selected.
    let byokModels: { id: string; alias: string | null }[] | null = null;
    if (activeProfile && byokProvider) {
      const cachedList = peekProviderModelList(byokProvider.id);
      if (cachedList && cachedList.length) {
        byokModels = cachedList.map(info => ({ id: info.id, alias: info.name || null }));
      } else {
        prefetchProviderModels(byokProvider.id);
        byokModels = [{ id: activeProfile.modelId, alias: null }];
      }
    }

    return {
      ...agentState,
      selectedModel,
      selectedEffort,
      nativeSelectedModel,
      nativeSelectedEffort,
      isDefault: agentId === defaultAgent,
      models,
      usage,
      nativeConfig,
      byokProviderName,
      byokModels,
      capabilities: getDriverCapabilities(agentId),
      latestVersion: updateState?.latestVersion || null,
      updateAvailable: updateState?.updateAvailable || false,
      updateStatus: updateState?.status || null,
      updateDetail: updateState?.detail || null,
    };
  }));

  return { defaultAgent, workdir, agents };
}

// ---------------------------------------------------------------------------
// Stale-while-revalidate cache
// ---------------------------------------------------------------------------

type AgentStatusData = Awaited<ReturnType<typeof buildAgentStatusResponse>>;

const statusCache: {
  data: AgentStatusData | null;
  createdAt: number;
  expiresAt: number;
  pending: Promise<AgentStatusData> | null;
} = { data: null, createdAt: 0, expiresAt: 0, pending: null };

function refreshStatusCache(config?: Partial<UserConfig>, opts?: AgentDetectOptions) {
  if (!statusCache.pending) {
    statusCache.pending = buildAgentStatusResponse(config, opts)
      .then(result => {
        statusCache.data = result;
        statusCache.createdAt = Date.now();
        statusCache.expiresAt = Date.now() + AGENT_STATUS_CACHE_TTL_MS;
        return result;
      })
      .finally(() => { statusCache.pending = null; });
  }
  return statusCache.pending;
}

function isLiveUpdateStatus(status: unknown): boolean {
  return status === 'checking' || status === 'updating';
}

function hasLiveUpdateStateInMemory(): boolean {
  return Object.values(getAllAgentUpdateStates()).some(state => isLiveUpdateStatus(state.status));
}

function hasLiveUpdateStateInSnapshot(data: AgentStatusData | null): boolean {
  return !!data?.agents?.some(agent => isLiveUpdateStatus((agent as { updateStatus?: unknown }).updateStatus));
}

function getCachedAgentStatus() {
  if (statusCache.data) {
    const ageMs = Date.now() - statusCache.createdAt;
    const updateStateIsMoving = hasLiveUpdateStateInMemory() || hasLiveUpdateStateInSnapshot(statusCache.data);
    if (Date.now() >= statusCache.expiresAt || (updateStateIsMoving && ageMs > 1_000)) return refreshStatusCache();
    return Promise.resolve(statusCache.data);
  }
  return refreshStatusCache();
}

function invalidateAgentStatus(config?: Partial<UserConfig>, opts?: AgentDetectOptions) {
  statusCache.pending = null;
  return refreshStatusCache(config, opts);
}

export function preloadAgentStatus() { void refreshStatusCache(); }

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const app = new Hono();

app.get('/api/agent-status', async (c) => {
  return c.json(await getCachedAgentStatus());
});

app.post('/api/agent-install', async (c) => {
  const body = await c.req.json();
  const agent = String(body?.agent || '').trim();
  if (!runtime.isAgent(agent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
  runtime.log(`[agents] install requested agent=${agent} command="${getAgentInstallCommand(agent) || '(unknown)'}"`);
  try {
    const config = loadUserConfig();
    const workdir = runtime.getRuntimeWorkdir(config);
    await installAgentViaNpm(agent, msg => runtime.log(`[agents] ${msg}`), workdir, config);
    return c.json({ ok: true, ...(await invalidateAgentStatus(loadUserConfig(), { refresh: true })) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[agents] install failed agent=${agent} error=${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

// Agent list (lightweight)
app.get('/api/agents', (c) => {
  return c.json({ agents: runtime.getSetupState(loadUserConfig(), { includeVersion: true }).agents });
});

app.post('/api/agent-check-update', async (c) => {
  const body = await c.req.json();
  const agent = String(body?.agent || '').trim();
  if (!runtime.isAgent(agent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
  runtime.log(`[agents] check-update requested agent=${agent}`);
  try {
    const config = loadUserConfig();
    const setupState = runtime.getSetupState(config, { includeVersion: true });
    const agentState = setupState.agents.find(a => a.agent === agent);
    if (!agentState?.installed) return c.json({ ok: false, error: 'Agent not installed' }, 400);
    const updateState = await checkAgentLatestVersion(agentState);
    return c.json({ ok: true, ...updateState, ...(await invalidateAgentStatus(config)) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[agents] check-update failed agent=${agent} error=${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

app.post('/api/agent-update', async (c) => {
  const body = await c.req.json();
  const agent = String(body?.agent || '').trim();
  if (!runtime.isAgent(agent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
  runtime.log(`[agents] manual update requested agent=${agent}`);
  try {
    const config = loadUserConfig();
    const setupState = runtime.getSetupState(config, { includeVersion: true });
    const agentState = setupState.agents.find(a => a.agent === agent);
    if (!agentState?.installed) return c.json({ ok: false, error: 'Agent not installed' }, 400);
    const result = await manualAgentUpdate(agentState, msg => runtime.log(`[agents] ${msg}`));
    if (!result.ok) return c.json({ ok: false, error: result.error }, 500);
    return c.json({ ok: true, ...(await invalidateAgentStatus(loadUserConfig(), { refresh: true })) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[agents] manual update failed agent=${agent} error=${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

app.post('/api/agent-health', async (c) => {
  const body = await c.req.json();
  const agent = String(body?.agent || '').trim();
  if (!runtime.isAgent(agent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
  runtime.log(`[agents] health check requested agent=${agent}`);
  try {
    const workdir = runtime.getRuntimeWorkdir(loadUserConfig());
    const result = await runAgentHealthCheck(agent, workdir);
    runtime.log(`[agents] health check result agent=${agent} ok=${result.ok} detail=${result.detail}`);
    return c.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[agents] health check failed agent=${agent} error=${detail}`);
    return c.json({
      ok: false,
      agent,
      checkedAt: new Date().toISOString(),
      detail,
      output: null,
    }, 500);
  }
});

app.post('/api/agent-service', async (c) => {
  const body = await c.req.json();
  const agent = String(body?.agent || '').trim();
  const action = String(body?.action || '').trim();
  if (!runtime.isAgent(agent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
  if (agent !== 'openclaw' || action !== 'start') {
    return c.json({ ok: false, error: 'Unsupported agent service action' }, 400);
  }
  runtime.log(`[agents] service action requested agent=${agent} action=${action}`);
  try {
    const config = loadUserConfig();
    const workdir = runtime.getRuntimeWorkdir(config);
    const result = await startOpenClawGatewayService(workdir, config);
    runtime.log(`[agents] service action result agent=${agent} action=${action} ok=${result.ok} detail=${result.detail}`);
    return c.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[agents] service action failed agent=${agent} action=${action} error=${detail}`);
    return c.json({
      ok: false,
      agent,
      checkedAt: new Date().toISOString(),
      detail,
      output: null,
    }, 500);
  }
});

app.post('/api/runtime-agent', async (c) => {
  const body = await c.req.json();
  const config = loadUserConfig();
  const nextConfig: Partial<UserConfig> = { ...config };
  const defaultAgent = body?.defaultAgent;
  const targetAgent = body?.agent;
  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  const effort = typeof body?.effort === 'string' ? body.effort.trim().toLowerCase() : '';
  const botRef = runtime.getBotRef();

  if (defaultAgent != null) {
    if (!runtime.isAgent(defaultAgent)) return c.json({ ok: false, error: 'Invalid defaultAgent' }, 400);
    runtime.runtimePrefs.defaultAgent = defaultAgent;
    process.env.DEFAULT_AGENT = defaultAgent;
    nextConfig.defaultAgent = defaultAgent;
    if (botRef) botRef.setDefaultAgent(defaultAgent);
  }

  if (model || effort) {
    if (!runtime.isAgent(targetAgent)) return c.json({ ok: false, error: 'Invalid agent' }, 400);
    if (model) {
      runtime.runtimePrefs.models[targetAgent] = model;
      runtime.setModelEnv(targetAgent, model);
      if (targetAgent === 'claude') nextConfig.claudeModel = model;
      if (targetAgent === 'codex') nextConfig.codexModel = model;
      if (targetAgent === 'copilot') nextConfig.copilotModel = model;
      if (targetAgent === 'cursor') nextConfig.cursorModel = model;
      if (targetAgent === 'agy') nextConfig.agyModel = model;
      if (targetAgent === 'gemini') nextConfig.geminiModel = model;
      if (targetAgent === 'openclaw') nextConfig.openclawModel = model;
      if (targetAgent === 'hermes') {
        // Prefer the active BYOK Profile (the only surface `hermes acp` honors
        // at runtime); fall back to the legacy `hermesModel` field only when no
        // Profile is bound, so older configs keep working.
        if (!setAgentBoundModelId('hermes', model)) nextConfig.hermesModel = model;
      }
      if (botRef) botRef.setModelForAgent(targetAgent, model);
    }
    if (effort) {
      runtime.runtimePrefs.efforts[targetAgent] = effort;
      runtime.setEffortEnv(targetAgent, effort);
      if (targetAgent === 'claude') nextConfig.claudeReasoningEffort = effort;
      if (targetAgent === 'codex') nextConfig.codexReasoningEffort = effort;
      if (targetAgent === 'copilot') nextConfig.copilotReasoningEffort = effort;
      if (targetAgent === 'cursor') nextConfig.cursorReasoningEffort = effort;
      if (targetAgent === 'agy') nextConfig.agyReasoningEffort = effort;
      if (targetAgent === 'gemini') nextConfig.geminiReasoningEffort = effort;
      if (targetAgent === 'hermes') nextConfig.hermesReasoningEffort = effort;
      if (targetAgent === 'openclaw') nextConfig.openclawReasoningEffort = effort;
      if (botRef) botRef.setEffortForAgent(targetAgent, effort);
    }
  }

  saveUserConfig(nextConfig);
  applyUserConfig(nextConfig);
  return c.json({ ok: true, ...(await invalidateAgentStatus(nextConfig)) });
});

export default app;
