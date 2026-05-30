/**
 * Dashboard API: Local Model backends (Ollama / mlx-lm).
 *
 * Surfaces a probe endpoint plus a connect action that links a detected
 * backend into the Provider/Profile model layer so the agent cards above
 * pick it up without any further configuration.
 *
 *   GET  /api/local-models/probe    → which backends are running, what models
 *                                     they expose, install/run hints, and
 *                                     whether a Provider already points at each.
 *   POST /api/local-models/install  → install / start the named backend.
 *   POST /api/local-models/load     → pull / start the chosen model.
 *
 * Endpoints we expect:
 *   - Ollama  baseURL → http://127.0.0.1:11434
 *             version  → GET /api/version
 *             models   → GET /api/tags
 *             OpenAI   → /v1/chat/completions, /v1/models
 *
 *   - mlx-lm  baseURL → http://127.0.0.1:8080   (mlx_lm.server default)
 *             probe   → GET /v1/models   (200 OK iff server up; no version)
 *
 * The dashboard can now run the safe local install/load paths directly. Manual
 * commands remain in the response for transparency and fallback.
 */

import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { LOCAL_MODELS, type LocalModelEntry } from '../../catalog/local-models.js';
import {
  listProviders, addProvider, listProfiles, addProfile,
  type ProviderConfig,
} from '../../model/index.js';
import { processEnvWithUserBins, resolveExecutablePath } from '../../core/platform.js';
import { runtime } from '../runtime.js';

const router = new Hono();

// ---------------------------------------------------------------------------
// Backend descriptors — CLI-style install spec lives here so the dashboard
// renders identical UX to the Extensions → CLI page.
// ---------------------------------------------------------------------------

type BackendId = 'ollama' | 'mlx';
type OsKey = 'darwin' | 'linux' | 'win';

interface InstallCommand { label?: string; cmd: string }

interface InstallSpec {
  darwin?: InstallCommand[];
  linux?: InstallCommand[];
  win?: InstallCommand[];
  docs?: string;
}

interface BackendSpec {
  id: BackendId;
  label: string;
  baseURL: string;          // host root, no /v1 suffix
  openAIBaseURL: string;    // passed to ProviderConfig.baseURL
  /** 200-OK probe — doubles as version source when available. */
  probePath: string;
  homepage: string;
  install: InstallSpec;
  /** Command to start the server (after install). */
  runHint: InstallCommand;
  /** Template for "pull/load a specific model". `${model}` is substituted. */
  pullCommandTemplate: string;
  /** Per-entry id field used to fill `${model}` in pullCommandTemplate. */
  modelField: keyof Pick<LocalModelEntry, 'ollamaTag' | 'mlxModel'>;
  /** Platforms where this backend can run. mlx is Apple Silicon only. */
  platforms: OsKey[];
}

const BACKENDS: BackendSpec[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseURL: 'http://127.0.0.1:11434',
    openAIBaseURL: 'http://127.0.0.1:11434/v1',
    probePath: '/api/version',
    homepage: 'https://ollama.com/',
    install: {
      docs: 'https://github.com/ollama/ollama#ollama',
      darwin: [
        { label: 'Homebrew', cmd: 'brew install ollama' },
        { label: 'Install script', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
      ],
      linux: [
        { label: 'Install script', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
      ],
      win: [
        { label: 'winget', cmd: 'winget install Ollama.Ollama' },
      ],
    },
    runHint: { label: 'Start the daemon', cmd: 'ollama serve' },
    pullCommandTemplate: 'ollama pull ${model}',
    modelField: 'ollamaTag',
    platforms: ['darwin', 'linux', 'win'],
  },
  {
    id: 'mlx',
    label: 'mlx-lm',
    baseURL: 'http://127.0.0.1:8080',
    openAIBaseURL: 'http://127.0.0.1:8080/v1',
    // mlx_lm.server has no /api/version; /v1/models doubles as liveness probe.
    probePath: '/v1/models',
    homepage: 'https://github.com/ml-explore/mlx-lm',
    install: {
      docs: 'https://github.com/ml-explore/mlx-lm#installation',
      darwin: [
        { label: 'pipx (recommended)', cmd: 'pipx install mlx-lm' },
        { label: 'pip', cmd: 'pip install mlx-lm' },
      ],
    },
    runHint: {
      label: 'Start the server (replace model)',
      cmd: 'mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080',
    },
    // mlx-lm loads a single model per server instance — "pull" here means
    // re-launching the server with that model id.
    pullCommandTemplate: 'mlx_lm.server --model ${model} --port 8080',
    modelField: 'mlxModel',
    platforms: ['darwin'],
  },
];

const PROBE_TIMEOUT_MS = 1500;
const BACKEND_INSTALL_TIMEOUT_MS = 20 * 60_000;
const MODEL_PULL_TIMEOUT_MS = 60 * 60_000;
const OLLAMA_START_TIMEOUT_MS = 20_000;
const MLX_START_TIMEOUT_MS = 45_000;
const OUTPUT_LIMIT = 16_000;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clipOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null; exitCode: number | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const spawnEnv = processEnvWithUserBins({
      ...process.env,
      ...(opts.env || {}),
      NO_COLOR: '1',
      TERM: 'dumb',
    });
    const resolvedCmd = resolveExecutablePath(cmd, spawnEnv) || cmd;
    const child = spawn(resolvedCmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
      shell: process.platform === 'win32' && !resolvedCmd.toLowerCase().endsWith('.exe'),
      windowsHide: true,
    });
    const timeoutMs = Math.max(1_000, opts.timeoutMs ?? 30_000);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s`,
        exitCode: null,
      });
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout = clipOutput(stdout + String(chunk)); });
    child.stderr?.on('data', chunk => { stderr = clipOutput(stderr + String(chunk)); });
    child.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: clipOutput(stdout), stderr: clipOutput(stderr), error: err.message, exitCode: null });
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        error: code === 0 ? null : `Command exited with code ${code}`,
        exitCode: code,
      });
    });
  });
}

function spawnDetached(cmd: string, args: string[], label: string): void {
  const env = processEnvWithUserBins({ ...process.env, NO_COLOR: '1', TERM: 'dumb' });
  const resolvedCmd = resolveExecutablePath(cmd, env);
  if (!resolvedCmd) throw new Error(`${cmd} is not installed or not on PATH.`);
  const child = spawn(resolvedCmd, args, {
    stdio: 'ignore',
    env,
    detached: true,
    shell: process.platform === 'win32' && !resolvedCmd.toLowerCase().endsWith('.exe'),
    windowsHide: true,
  });
  child.on('error', err => runtime.log(`[local-models] ${label} failed: ${err.message}`));
  child.unref();
  runtime.log(`[local-models] ${label} started pid=${child.pid || 'unknown'}`);
}

function backendBinary(spec: BackendSpec): string {
  return spec.id === 'ollama' ? 'ollama' : 'mlx_lm.server';
}

function isBackendBinaryAvailable(spec: BackendSpec): boolean {
  return !!resolveExecutablePath(backendBinary(spec), processEnvWithUserBins());
}

async function waitForBackend(spec: BackendSpec, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = spec.id === 'ollama' ? await probeOllama(spec) : await probeMlx(spec);
    if (status.detected) return true;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return false;
}

async function ensureOllamaServer(spec: BackendSpec): Promise<{ ok: boolean; started: boolean; error?: string }> {
  const current = await probeOllama(spec);
  if (current.detected) return { ok: true, started: false };
  if (!isBackendBinaryAvailable(spec)) return { ok: false, started: false, error: 'Ollama CLI is not installed or not on PATH.' };
  try {
    spawnDetached('ollama', ['serve'], 'ollama serve');
  } catch (e: any) {
    return { ok: false, started: false, error: e?.message || 'Failed to start Ollama.' };
  }
  const ready = await waitForBackend(spec, OLLAMA_START_TIMEOUT_MS);
  return ready
    ? { ok: true, started: true }
    : { ok: false, started: true, error: 'Ollama was started, but did not become ready yet.' };
}

function resolveBackendInstallCommand(spec: BackendSpec): { label: string; cmd: string; args: string[] } | null {
  const os = currentOs();
  if (!spec.platforms.includes(os)) return null;

  if (spec.id === 'ollama') {
    if (os === 'darwin' && resolveExecutablePath('brew')) {
      return { label: 'Homebrew', cmd: 'brew', args: ['install', 'ollama'] };
    }
    if (os === 'linux') {
      return { label: 'Install script', cmd: 'sh', args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'] };
    }
    if (os === 'win') {
      return {
        label: 'winget',
        cmd: 'winget',
        args: ['install', 'Ollama.Ollama', '--accept-package-agreements', '--accept-source-agreements'],
      };
    }
  }

  if (spec.id === 'mlx' && os === 'darwin') {
    if (resolveExecutablePath('pipx')) return { label: 'pipx', cmd: 'pipx', args: ['install', 'mlx-lm'] };
    if (resolveExecutablePath('python3')) return { label: 'pip', cmd: 'python3', args: ['-m', 'pip', 'install', '--user', 'mlx-lm'] };
    if (resolveExecutablePath('python')) return { label: 'pip', cmd: 'python', args: ['-m', 'pip', 'install', '--user', 'mlx-lm'] };
  }

  return null;
}

async function ensureBackendInstalled(spec: BackendSpec): Promise<{ ok: boolean; output?: string; error?: string; installedNow: boolean }> {
  if (isBackendBinaryAvailable(spec)) return { ok: true, installedNow: false };
  const command = resolveBackendInstallCommand(spec);
  if (!command) {
    return { ok: false, installedNow: false, error: `No automatic installer is available for ${spec.label} on this machine.` };
  }
  runtime.log(`[local-models] installing ${spec.id} via ${command.label}: ${command.cmd} ${command.args.join(' ')}`);
  const result = await runCommand(command.cmd, command.args, { timeoutMs: BACKEND_INSTALL_TIMEOUT_MS });
  const output = clipOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (!result.ok) {
    return { ok: false, installedNow: false, output, error: result.error || output || `Failed to install ${spec.label}.` };
  }
  return { ok: true, output, installedNow: true };
}

function currentOs(): OsKey {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

// ---------------------------------------------------------------------------
// Per-backend detection
// ---------------------------------------------------------------------------

interface DetectedModel {
  id: string;
  sizeBytes?: number;
}

interface BackendStatus {
  id: BackendId;
  label: string;
  detected: boolean;
  version?: string;
  baseURL: string;
  openAIBaseURL: string;
  models: DetectedModel[];
  existingProviderId: string | null;
  homepage: string;
  install: InstallSpec;
  runHint: InstallCommand;
  pullCommandTemplate: string;
  /** True when the current OS is in `platforms` — UI uses this to mark a tile
   *  unsupported rather than just "not detected". */
  supportedOnThisOs: boolean;
}

async function probeOllama(spec: BackendSpec): Promise<{ detected: boolean; version?: string; models: DetectedModel[] }> {
  type VersionRes = { version: string };
  type TagsRes = { models?: Array<{ name: string; size?: number }> };
  const ver = await fetchJson<VersionRes>(`${spec.baseURL}${spec.probePath}`);
  if (!ver) return { detected: false, models: [] };
  const tags = await fetchJson<TagsRes>(`${spec.baseURL}/api/tags`, 3000);
  const models: DetectedModel[] = (tags?.models || []).map(m => ({
    id: m.name,
    sizeBytes: typeof m.size === 'number' ? m.size : undefined,
  }));
  return { detected: true, version: ver.version, models };
}

async function probeMlx(spec: BackendSpec): Promise<{ detected: boolean; version?: string; models: DetectedModel[] }> {
  type ModelsRes = { data?: Array<{ id: string }> };
  const res = await fetchJson<ModelsRes>(`${spec.baseURL}${spec.probePath}`, 3000);
  if (!res) return { detected: false, models: [] };
  return {
    detected: true,
    models: (res.data || []).map(m => ({ id: m.id })),
  };
}

/**
 * Normalize a provider baseURL for comparison: drop trailing slashes and
 * collapse the localhost ↔ 127.0.0.1 distinction.
 */
function normalizeBaseURL(raw: string): string {
  return raw
    .replace(/\/+$/, '')
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1')
    .replace(/^https:\/\/localhost(?=[:/]|$)/i, 'https://127.0.0.1');
}

function findProviderForBackend(providers: ProviderConfig[], spec: BackendSpec): ProviderConfig | null {
  const target = normalizeBaseURL(spec.openAIBaseURL);
  return providers.find(p => normalizeBaseURL(p.baseURL) === target) || null;
}

async function probeBackend(spec: BackendSpec, providers: ProviderConfig[]): Promise<BackendStatus> {
  const os = currentOs();
  const supported = spec.platforms.includes(os);
  const result = !supported
    ? { detected: false, models: [] as DetectedModel[] }
    : spec.id === 'ollama' ? await probeOllama(spec) : await probeMlx(spec);
  const existing = findProviderForBackend(providers, spec);
  return {
    id: spec.id,
    label: spec.label,
    detected: result.detected,
    version: result.version,
    baseURL: spec.baseURL,
    openAIBaseURL: spec.openAIBaseURL,
    models: result.models,
    existingProviderId: existing?.id || null,
    homepage: spec.homepage,
    install: spec.install,
    runHint: spec.runHint,
    pullCommandTemplate: spec.pullCommandTemplate,
    supportedOnThisOs: supported,
  };
}

// ---------------------------------------------------------------------------
// Catalog join — recommended models × backend availability
// ---------------------------------------------------------------------------

function isEntryInstalled(entry: LocalModelEntry, spec: BackendSpec, installed: DetectedModel[]): string | null {
  const target = entry[spec.modelField];
  if (!target) return null;
  const base = target.split(':')[0].toLowerCase();
  for (const m of installed) {
    if (m.id.toLowerCase().startsWith(base)) return m.id;
  }
  return null;
}

interface CatalogJoinEntry extends LocalModelEntry {
  installed: { backend: BackendId; id: string } | null;
}

function joinCatalog(backends: BackendStatus[]): CatalogJoinEntry[] {
  return LOCAL_MODELS.map(entry => {
    for (const b of backends) {
      if (!b.detected) continue;
      const spec = BACKENDS.find(s => s.id === b.id);
      if (!spec) continue;
      const hit = isEntryInstalled(entry, spec, b.models);
      if (hit) return { ...entry, installed: { backend: b.id, id: hit } };
    }
    return { ...entry, installed: null };
  });
}

/**
 * For a connected local backend, mirror every detected model as a Profile under
 * its Provider so the unified picker shows them without an extra user gesture.
 * Idempotent. Never deletes Profiles — a model that disappears from probe
 * output might be a transient blip.
 */
function syncLocalProfilesForBackend(providerId: string, detected: DetectedModel[]): { added: number } {
  if (!providerId || !detected.length) return { added: 0 };
  const existing = new Set(
    listProfiles().filter(p => p.providerId === providerId).map(p => p.modelId)
  );
  let added = 0;
  for (const m of detected) {
    if (!m.id || existing.has(m.id)) continue;
    try {
      addProfile({ providerId, modelId: m.id });
      added += 1;
      existing.add(m.id);
    } catch {
      // Provider may have been removed between calls — skip; next probe retries.
    }
  }
  return { added };
}

/**
 * Idempotently create a Provider pointing at this backend. Returns the
 * provider id. The placeholder API key is a sentinel ("local-no-auth") rather
 * than something that looks like a real key, so future code can recognize and
 * special-case local providers.
 */
async function ensureProviderForBackend(spec: BackendSpec): Promise<string | null> {
  const providers = listProviders();
  const existing = findProviderForBackend(providers, spec);
  if (existing) return existing.id;
  try {
    const provider = await addProvider({
      kind: 'openai-compatible',
      name: spec.label,
      baseURL: spec.openAIBaseURL,
      apiKey: 'local-no-auth',
    });
    return provider.id;
  } catch {
    return null;
  }
}

async function probeAndAttachLocalModels(): Promise<{
  backends: BackendStatus[];
  catalog: CatalogJoinEntry[];
  currentOs: OsKey;
  addedProviderIds: string[];
}> {
  const initialProviders = listProviders();
  const backends = await Promise.all(BACKENDS.map(spec => probeBackend(spec, initialProviders)));
  const addedProviderIds: string[] = [];
  for (const b of backends) {
    if (!b.detected) continue;
    const spec = BACKENDS.find(s => s.id === b.id);
    if (!spec) continue;
    let providerId = b.existingProviderId;
    if (!providerId) {
      providerId = await ensureProviderForBackend(spec);
      if (providerId) {
        b.existingProviderId = providerId;
        addedProviderIds.push(providerId);
      }
    }
    if (providerId) syncLocalProfilesForBackend(providerId, b.models);
  }
  return {
    backends,
    catalog: joinCatalog(backends),
    currentOs: currentOs(),
    addedProviderIds,
  };
}

function backendById(raw: unknown): BackendSpec | null {
  const id = String(raw || '').trim();
  return BACKENDS.find(b => b.id === id) || null;
}

function modelTargetForBackend(spec: BackendSpec, entryId: string): { entry: LocalModelEntry; model: string } | null {
  const entry = LOCAL_MODELS.find(e => e.id === entryId);
  if (!entry) return null;
  const model = entry[spec.modelField];
  if (!model) return null;
  return { entry, model };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Single probe-and-attach endpoint. The Local Models page no longer asks the
 * user to "connect" — every detected backend becomes a Provider automatically
 * so its models show up in the unified picker without an extra click.
 *
 *   - Backend detected, no existing Provider → create one, then sync Profiles.
 *   - Backend detected, Provider already exists → just sync Profiles.
 *   - Backend not detected → leave existing Provider in place (a transient
 *     blip during a restart shouldn't tear down config).
 *
 * Response includes `addedProviderIds` so the dashboard can refetch the upper
 * Model Providers / agent layer exactly when something new appears.
 */
router.get('/api/local-models/probe', async c => {
  try {
    return c.json({ ok: true, ...(await probeAndAttachLocalModels()) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.post('/api/local-models/install', async c => {
  try {
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const spec = backendById(body.backend);
    if (!spec) return c.json({ ok: false, error: 'Invalid backend' }, 400);
    if (!spec.platforms.includes(currentOs())) {
      return c.json({ ok: false, error: `${spec.label} is not supported on this OS.` }, 400);
    }

    const install = await ensureBackendInstalled(spec);
    if (!install.ok) return c.json({ ok: false, error: install.error, output: install.output }, 500);

    let serviceStarted = false;
    let serviceReady = spec.id === 'mlx';
    if (spec.id === 'ollama') {
      const service = await ensureOllamaServer(spec);
      serviceStarted = service.started;
      serviceReady = service.ok;
      if (!service.ok) {
        return c.json({
          ok: false,
          error: service.error,
          output: install.output,
          installedNow: install.installedNow,
          serviceStarted,
        }, 500);
      }
    }

    const snapshot = await probeAndAttachLocalModels();
    const backend = snapshot.backends.find(b => b.id === spec.id) || null;
    return c.json({
      ok: true,
      backend,
      output: install.output,
      installedNow: install.installedNow,
      serviceStarted,
      serviceReady,
      ...snapshot,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.post('/api/local-models/load', async c => {
  try {
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const spec = backendById(body.backend);
    if (!spec) return c.json({ ok: false, error: 'Invalid backend' }, 400);
    if (!spec.platforms.includes(currentOs())) {
      return c.json({ ok: false, error: `${spec.label} is not supported on this OS.` }, 400);
    }
    const target = modelTargetForBackend(spec, String(body.modelEntryId || '').trim());
    if (!target) return c.json({ ok: false, error: 'Model is not available for this backend.' }, 400);

    const install = await ensureBackendInstalled(spec);
    if (!install.ok) return c.json({ ok: false, error: install.error, output: install.output }, 500);

    if (spec.id === 'ollama') {
      const service = await ensureOllamaServer(spec);
      if (!service.ok) return c.json({ ok: false, error: service.error }, 500);

      runtime.log(`[local-models] pulling ollama model ${target.model}`);
      const pull = await runCommand('ollama', ['pull', target.model], { timeoutMs: MODEL_PULL_TIMEOUT_MS });
      const output = clipOutput([pull.stdout, pull.stderr].filter(Boolean).join('\n'));
      if (!pull.ok) {
        return c.json({ ok: false, error: pull.error || output || `Failed to load ${target.entry.name}.`, output }, 500);
      }
      return c.json({
        ok: true,
        ready: true,
        model: target.model,
        output,
        ...(await probeAndAttachLocalModels()),
      });
    }

    const current = await probeMlx(spec);
    if (current.detected) {
      const already = current.models.some(m => m.id === target.model);
      if (!already) {
        const loaded = current.models.map(m => m.id).filter(Boolean).join(', ') || 'another model';
        return c.json({
          ok: false,
          error: `mlx-lm is already running with ${loaded}. Stop that server before switching models.`,
        }, 409);
      }
      return c.json({ ok: true, ready: true, model: target.model, ...(await probeAndAttachLocalModels()) });
    }

    runtime.log(`[local-models] starting mlx-lm model ${target.model}`);
    spawnDetached('mlx_lm.server', ['--model', target.model, '--port', '8080'], `mlx_lm.server ${target.model}`);
    const ready = await waitForBackend(spec, MLX_START_TIMEOUT_MS);
    return c.json({
      ok: true,
      ready,
      model: target.model,
      message: ready
        ? undefined
        : 'mlx-lm is starting or downloading the model. Refresh this panel in a moment.',
      ...(await probeAndAttachLocalModels()),
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

export default router;
