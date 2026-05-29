/**
 * Dashboard API routes: agent detection, model listing, installation.
 */

import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getAgentInstallCommand, getAgentLabel, getAgentPackage } from '../../agent/npm.js';
import { copilotAuthEnv } from '../../agent/copilot-auth.js';
import { loadUserConfig, saveUserConfig, applyUserConfig, type UserConfig } from '../../core/config/user-config.js';
import { setAgentBoundModelId, type AgentDetectOptions, type UsageResult } from '../../agent/index.js';
import { getAgentUpdateState, checkAgentLatestVersion, manualAgentUpdate } from '../../agent/auto-update.js';
import type { Agent } from '../../agent/index.js';
import { getDriver, getDriverCapabilities } from '../../agent/driver.js';
import {
  getActiveProfile, getProvider,
  peekProviderModelList, prefetchProviderModels,
} from '../../model/index.js';
import { DASHBOARD_TIMEOUTS } from '../../core/constants.js';
import { withTimeoutFallback } from '../../core/utils.js';
import { processEnvWithUserBins, resolveExecutablePath } from '../../core/platform.js';
import { runtime } from '../runtime.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_STATUS_MODELS_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentStatusModels;
const AGENT_STATUS_USAGE_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentStatusUsage;
const AGENT_STATUS_CACHE_TTL_MS = DASHBOARD_TIMEOUTS.agentStatusCacheTtl;
const AGENT_INSTALL_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentInstall;
const AGENT_HEALTH_TIMEOUT_MS = DASHBOARD_TIMEOUTS.agentHealth;

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
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const spawnEnv = processEnvWithUserBins({ ...process.env, ...(opts.env || {}), npm_config_yes: 'true' });
    const resolvedCmd = resolveExecutablePath(cmd, spawnEnv) || cmd;
    const child = spawn(resolvedCmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    });
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

async function installAgentViaNpm(agent: Agent, log: (msg: string) => void): Promise<void> {
  const pkg = getAgentPackage(agent);
  if (!pkg) throw new Error(`Unsupported agent: ${agent}`);
  log(`Installing ${getAgentLabel(agent)} via npm...`);
  let result = await runCommand('npm', ['install', '-g', `${pkg}@latest`], {
    timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
  });
  if (!result.ok && /ENOTEMPTY/.test(result.stderr)) {
    const removed = cleanupNpmStagingFromError(result.stderr);
    if (removed.length > 0) {
      log(`Cleaned npm staging dirs after ENOTEMPTY: ${removed.join(', ')}; retrying...`);
      result = await runCommand('npm', ['install', '-g', `${pkg}@latest`], {
        timeoutMs: AGENT_INSTALL_TIMEOUT_MS,
      });
    }
  }
  if (!result.ok) throw new Error(result.error || `Failed to install ${pkg}`);
  log(`${getAgentLabel(agent)} installation complete.`);
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
  const setupState = runtime.getSetupState(loadUserConfig(), { includeVersion: true, refresh: true });
  const agentState = setupState.agents.find(item => item.agent === agent);
  if (!agentState?.installed) {
    return { ok: false, agent, checkedAt, detail: `${getAgentLabel(agent)} CLI is not installed or not on PATH.`, output: null };
  }

  let command: { cmd: string; args: string[]; timeoutMs?: number };
  switch (agent) {
    case 'claude':
      command = { cmd: 'claude', args: ['-p', 'Say OK only.', '--output-format', 'text'] };
      break;
    case 'codex':
      command = { cmd: 'codex', args: ['login', 'status'] };
      break;
    case 'copilot':
      command = { cmd: 'copilot', args: ['-p', 'Say OK only.', '-s', '--allow-all', '--no-ask-user'] };
      break;
    case 'cursor':
      command = { cmd: 'cursor-agent', args: ['--print', '--output-format', 'text', '--trust', '--workspace', workdir, '--force', 'Say OK only.'] };
      break;
    case 'gemini':
      command = { cmd: 'gemini', args: ['-p', 'Say OK only.', '--output-format', 'text', '--approval-mode', 'yolo', '--sandbox', 'false'] };
      break;
    case 'hermes':
      command = { cmd: 'hermes', args: ['auth', 'list'] };
      break;
    case 'openclaw':
      command = { cmd: 'openclaw', args: ['gateway', 'status'] };
      break;
    default:
      command = { cmd: agent, args: ['--version'] };
      break;
  }

  const result = await runCommand(command.cmd, command.args, {
    cwd: workdir,
    timeoutMs: command.timeoutMs ?? AGENT_HEALTH_TIMEOUT_MS,
    env: agent === 'copilot' ? copilotAuthEnv() : undefined,
  });
  const output = clipHealthOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (!result.ok) {
    if (agent === 'openclaw') {
      return {
        ok: false,
        agent,
        checkedAt,
        detail: 'OpenClaw CLI is installed, but its Gateway is not running or not reachable. Run `openclaw onboard --install-daemon` or start the Gateway, then check again.',
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
  expiresAt: number;
  pending: Promise<AgentStatusData> | null;
} = { data: null, expiresAt: 0, pending: null };

function refreshStatusCache(config?: Partial<UserConfig>, opts?: AgentDetectOptions) {
  if (!statusCache.pending) {
    statusCache.pending = buildAgentStatusResponse(config, opts)
      .then(result => { statusCache.data = result; statusCache.expiresAt = Date.now() + AGENT_STATUS_CACHE_TTL_MS; return result; })
      .finally(() => { statusCache.pending = null; });
  }
  return statusCache.pending;
}

function getCachedAgentStatus() {
  if (statusCache.data) {
    if (Date.now() >= statusCache.expiresAt) void refreshStatusCache();
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
    await installAgentViaNpm(agent, msg => runtime.log(`[agents] ${msg}`));
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
