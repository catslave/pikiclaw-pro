/**
 * Dashboard API routes: configuration, channels, extensions, permissions.
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { loadUserConfig, saveUserConfig, applyUserConfig, hasUserConfigFile } from '../../core/config/user-config.js';
import { expandTilde } from '../../core/platform.js';
import { isSetupReady } from '../../cli/onboarding.js';
import {
  validateDingtalkConfig,
  validateDiscordConfig,
  validateFeishuConfig,
  validateSlackConfig,
  validateTelegramConfig,
  validateWecomConfig,
  validateWeixinConfig,
} from '../../core/config/validation.js';
import { resolveGuiIntegrationConfig } from '../../agent/mcp/bridge.js';
import {
  normalizeWeixinBaseUrl,
  startWeixinQrLogin,
  waitForWeixinQrLogin,
} from '../../channels/weixin/api.js';
import {
  getManagedBrowserStatus,
  launchManagedBrowserSetup,
} from '../../browser-profile.js';
import {
  requestProcessRestart,
} from '../../core/process-control.js';
import {
  checkPermissions,
  detectHostTerminalApp,
  isValidPermissionKey,
  requestPermission,
} from '../platform.js';
import { VERSION } from '../../core/version.js';
import { runtime } from '../runtime.js';
import { writeScopedLog } from '../../core/logging.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildBrowserStatusResponse(config = loadUserConfig(), browserState = getManagedBrowserStatus()) {
  const gui = resolveGuiIntegrationConfig(config);
  return {
    browser: {
      status: gui.browserEnabled ? browserState.status : 'disabled',
      enabled: gui.browserEnabled,
      headlessMode: gui.browserHeadless ? 'headless' : 'headed',
      chromeInstalled: browserState.chromeInstalled,
      profileCreated: browserState.profileCreated,
      running: browserState.running,
      pid: browserState.pid,
      profileDir: browserState.profileDir || gui.browserProfileDir,
      detail: gui.browserEnabled
        ? browserState.detail
        : 'Browser automation is disabled. No browser MCP server will be injected into agent sessions. On macOS, operate your main browser directly with open, osascript, and screencapture when needed.',
    },
  };
}

type OpenTarget = 'vscode' | 'cursor' | 'windsurf' | 'finder' | 'default';

function isOpenTarget(value: unknown): value is OpenTarget {
  return value === 'vscode'
    || value === 'cursor'
    || value === 'windsurf'
    || value === 'finder'
    || value === 'default';
}

function countLiveSessionTasks(botRef: NonNullable<ReturnType<typeof runtime.getBotRef>>): number {
  const ids = new Set<string>();
  for (const session of botRef.sessionStates.values()) {
    for (const taskId of session.runningTaskIds) {
      if (botRef.activeTasks.has(taskId)) ids.add(taskId);
    }
  }
  return ids.size;
}

function runOpenCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `Failed to run ${command} ${args.join(' ')}`);
  }
}

function openPathWithTarget(filePath: string, target: OpenTarget, isDirectory: boolean) {
  if (process.platform === 'darwin') {
    switch (target) {
      case 'finder':
        runOpenCommand('open', isDirectory ? [filePath] : ['-R', filePath]);
        return;
      case 'default':
        runOpenCommand('open', [filePath]);
        return;
      case 'cursor':
        runOpenCommand('open', ['-a', 'Cursor', filePath]);
        return;
      case 'windsurf':
        runOpenCommand('open', ['-a', 'Windsurf', filePath]);
        return;
      case 'vscode':
      default:
        runOpenCommand('open', ['-a', 'Visual Studio Code', filePath]);
        return;
    }
  }

  if (process.platform === 'win32') {
    switch (target) {
      case 'cursor':
        runOpenCommand('cursor', [filePath]);
        return;
      case 'windsurf':
        runOpenCommand('windsurf', [filePath]);
        return;
      case 'finder':
      case 'default':
        runOpenCommand('cmd', ['/c', 'start', '', filePath]);
        return;
      case 'vscode':
      default:
        runOpenCommand('code', [filePath]);
        return;
    }
  }

  switch (target) {
    case 'cursor':
      runOpenCommand('cursor', [filePath]);
      return;
    case 'windsurf':
      runOpenCommand('windsurf', [filePath]);
      return;
    case 'finder':
    case 'default':
      runOpenCommand('xdg-open', [filePath]);
      return;
    case 'vscode':
    default:
      runOpenCommand('code', [filePath]);
      return;
  }
}

const INLINE_FILE_MAX_BYTES = 512 * 1024;
const INLINE_DIFF_MAX_BYTES = 1024 * 1024;

function isPathInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function resolveWorkspacePreviewPath(workdir: string, requestedPath: string) {
  const logicalRoot = path.resolve(workdir);
  const root = fs.realpathSync(logicalRoot);
  const logicalTarget = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(logicalRoot, requestedPath);

  if (!isPathInside(logicalRoot, logicalTarget)) {
    throw new Error('Path is outside the workspace');
  }

  const abs = fs.existsSync(logicalTarget) ? fs.realpathSync(logicalTarget) : logicalTarget;
  if (fs.existsSync(logicalTarget) && !isPathInside(root, abs)) {
    throw new Error('Path is outside the workspace');
  }

  return {
    root: logicalRoot,
    abs,
    logicalTarget,
    relativePath: path.relative(logicalRoot, logicalTarget),
  };
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

// Full state (config from file only)
app.get('/api/state', async (c) => {
  const config = loadUserConfig();
  const setupState = await runtime.buildValidatedSetupState(config);
  const permissions = checkPermissions();
  const botRef = runtime.getBotRef();
  const activeTasks = botRef ? countLiveSessionTasks(botRef) : 0;
  return c.json({
    version: VERSION,
    ready: isSetupReady(setupState),
    configExists: hasUserConfigFile(),
    config,
    runtimeWorkdir: runtime.getRuntimeWorkdir(config),
    setupState,
    permissions,
    hostApp: detectHostTerminalApp(),
    platform: process.platform,
    pid: process.pid,
    nodeVersion: process.versions.node,
    bot: botRef ? {
      workdir: botRef.workdir,
      defaultAgent: botRef.defaultAgent,
      uptime: Date.now() - botRef.startedAt,
      connected: botRef.connected,
      stats: botRef.stats,
      activeTasks,
      sessions: botRef.sessionStates.size,
    } : null,
  });
});

// Host info
app.get('/api/host', (c) => {
  const botRef = runtime.getBotRef();
  if (botRef) return c.json(botRef.getHostData());
  const cpus = os.cpus();
  const [one, five, fifteen] = os.loadavg();
  return c.json({
    hostName: os.hostname(), cpuModel: cpus[0]?.model || 'unknown',
    cpuCount: cpus.length, totalMem: os.totalmem(), freeMem: os.freemem(),
    loadAverage: { one, five, fifteen },
    platform: process.platform, arch: os.arch(),
  });
});

// Permissions
app.get('/api/permissions', (c) => {
  const data = { ...checkPermissions(), hostApp: detectHostTerminalApp() };
  return c.json(data);
});

// Save config (to ~/.pikiclaw/setting.json). Channel reconciliation is
// handled by ChannelSupervisor via the onUserConfigChange listener — adding,
// removing, or swapping credentials of an IM channel takes effect in-process
// without restarting pikiclaw.
app.post('/api/config', async (c) => {
  const body = await c.req.json();
  const merged = { ...loadUserConfig(), ...body };
  const configPath = saveUserConfig(merged);
  applyUserConfig(loadUserConfig());
  return c.json({ ok: true, configPath });
});

// Validate Telegram token
app.post('/api/validate-telegram-token', async (c) => {
  const body = await c.req.json();
  const result = await validateTelegramConfig(body.token || '', body.allowedChatIds || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    bot: result.bot,
    normalizedAllowedChatIds: result.normalizedAllowedChatIds,
  });
});

// Validate Feishu credentials
app.post('/api/validate-feishu-config', async (c) => {
  const body = await c.req.json();
  const startedAt = Date.now();
  const rawAppId = String(body.appId || '').trim();
  const maskedAppId = !rawAppId
    ? '(missing)'
    : rawAppId.length <= 10
      ? rawAppId
      : `${rawAppId.slice(0, 6)}...${rawAppId.slice(-4)}`;
  writeScopedLog('dashboard', `[feishu-config] request app=${maskedAppId}`, { level: 'debug' });
  const result = await validateFeishuConfig(body.appId || '', body.appSecret || '');
  writeScopedLog(
    'dashboard',
    `[feishu-config] result app=${maskedAppId} ok=${result.state.ready} status=${result.state.status} elapsedMs=${Date.now() - startedAt}`,
    { level: 'debug' },
  );
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    app: result.app,
  });
});

// Validate Weixin credentials
app.post('/api/validate-weixin-config', async (c) => {
  const body = await c.req.json();
  const result = await validateWeixinConfig(body.baseUrl || '', body.botToken || '', body.accountId || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    account: result.account,
    normalizedBaseUrl: result.normalizedBaseUrl,
  });
});

// Validate Slack credentials
app.post('/api/validate-slack-config', async (c) => {
  const body = await c.req.json();
  const result = await validateSlackConfig(body.botToken || '', body.appToken || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    bot: result.bot,
  });
});

// Validate Discord credentials
app.post('/api/validate-discord-config', async (c) => {
  const body = await c.req.json();
  const result = await validateDiscordConfig(body.botToken || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    bot: result.bot,
  });
});

// Validate DingTalk credentials
app.post('/api/validate-dingtalk-config', async (c) => {
  const body = await c.req.json();
  const result = await validateDingtalkConfig(body.clientId || '', body.clientSecret || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    app: result.app,
  });
});

// Validate WeChat Work (企业微信) credentials
app.post('/api/validate-wecom-config', async (c) => {
  const body = await c.req.json();
  const result = await validateWecomConfig(body.botId || '', body.botSecret || '');
  return c.json({
    ok: result.state.ready,
    error: result.state.ready ? null : result.state.detail,
    bot: result.bot,
  });
});

// Start Weixin QR login
app.post('/api/weixin-login/start', async (c) => {
  const body = await c.req.json();
  const result = await startWeixinQrLogin({
    baseUrl: normalizeWeixinBaseUrl(body.baseUrl || ''),
    sessionKey: body.sessionKey || undefined,
  });
  return c.json(result, result.ok ? 200 : 500);
});

// Wait for Weixin QR login
app.post('/api/weixin-login/wait', async (c) => {
  const body = await c.req.json();
  const result = await waitForWeixinQrLogin({
    baseUrl: normalizeWeixinBaseUrl(body.baseUrl || ''),
    sessionKey: String(body.sessionKey || '').trim(),
  });
  return c.json(result, result.ok ? 200 : 500);
});

// Open macOS preferences
app.post('/api/open-preferences', async (c) => {
  const body = await c.req.json();
  const permission = String(body.permission || '');
  if (!isValidPermissionKey(permission)) {
    return c.json({
      ok: false,
      action: 'unsupported',
      granted: false,
      requiresManualGrant: false,
      error: 'Invalid permission.',
    }, 400);
  }
  const result = requestPermission(permission);
  runtime.log(
    `[permissions] permission=${permission} action=${result.action} granted=${result.granted} manual=${result.requiresManualGrant} ok=${result.ok}`
  );
  return c.json(result, result.ok ? 200 : 500);
});

// Restart process
app.post('/api/restart', (c) => {
  const botRef = runtime.getBotRef();
  const activeTasks = botRef ? countLiveSessionTasks(botRef) : 0;
  if (activeTasks > 0) {
    return c.json({
      ok: false,
      error: `Cannot restart while ${activeTasks} task${activeTasks === 1 ? '' : 's'} are active. Wait for the current task to finish, then retry.`,
      activeTasks,
    }, 409);
  }
  setTimeout(() => {
    void requestProcessRestart({ log: message => runtime.log(message) });
  }, 50);
  return c.json({ ok: true });
});

// Switch workdir
app.post('/api/switch-workdir', async (c) => {
  const body = await c.req.json();
  const newPath = body.path;
  if (!newPath) return c.json({ ok: false, error: 'Missing path' }, 400);
  const resolvedPath = path.resolve(expandTilde(String(newPath)));
  const botRef = runtime.getBotRef();
  if (botRef) {
    botRef.switchWorkdir(resolvedPath);
    return c.json({ ok: true, workdir: botRef.workdir });
  }
  const { setUserWorkdir } = await import('../../core/config/user-config.js');
  const saved = setUserWorkdir(resolvedPath);
  return c.json({ ok: true, workdir: saved.workdir });
});

// Browser profile status
app.get('/api/browser', async (c) => {
  const config = loadUserConfig();
  const data = await buildBrowserStatusResponse(config);
  return c.json(data);
});

// Launch managed browser profile for login/setup
app.post('/api/browser/setup', async (c) => {
  runtime.log('[browser] setup requested');
  try {
    const config = loadUserConfig();
    const gui = resolveGuiIntegrationConfig(config);
    if (!gui.browserEnabled) {
      return c.json({
        ok: false,
        error: 'Browser automation is disabled. Enable it first if you want pikiclaw to launch the managed browser profile.',
      }, 400);
    }
    const launch = launchManagedBrowserSetup();
    runtime.log(`[browser] launched managed profile at ${launch.profileDir} pid=${launch.pid ?? 'unknown'}`);
    const payload = await buildBrowserStatusResponse(config, launch);
    return c.json({
      ok: true,
      browser: {
        ...payload.browser,
        detail: launch.running
          ? 'Managed browser is open. Sign in to the sites you want pikiclaw to reuse. If it is still open later, pikiclaw will close it automatically before browser automation starts.'
          : payload.browser.detail,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[browser] setup failed: ${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

// List directory entries for tree browser
app.get('/api/ls-dir', (c) => {
  const dir = c.req.query('path') || os.homedir();
  const includeFiles = c.req.query('files') === '1';
  const includeHidden = c.req.query('hidden') === '1';
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries
      .filter(e => (includeHidden || !e.name.startsWith('.')) && (includeFiles || e.isDirectory()))
      .map(e => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const isGit = fs.existsSync(path.join(dir, '.git'));
    return c.json({ ok: true, path: dir, parent: path.dirname(dir), dirs, isGit });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Git changes for a directory (uncommitted + staged)
app.get('/api/git-changes', (c) => {
  const dir = c.req.query('path');
  if (!dir) return c.json({ ok: false, error: 'path is required' }, 400);
  try {
    const workspaceDir = path.resolve(dir);
    const gitRoot = findGitRootOrNull(workspaceDir);
    const gitRoots = gitRoot ? [gitRoot] : findImmediateGitRoots(workspaceDir);
    if (gitRoots.length === 0) {
      return c.json({ ok: true, changes: [], isGit: false });
    }
    const changes = gitRoots.flatMap(root => readGitChanges(root, workspaceDir));
    return c.json({ ok: true, changes, isGit: true });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Resolve `origin/branch-name` style refs to the remote GitHub/GitLab branch URL.
app.get('/api/git-remote-branch-url', (c) => {
  const workdir = c.req.query('workdir');
  const ref = c.req.query('ref');
  if (!workdir || !ref) return c.json({ ok: false, error: 'workdir and ref are required' }, 400);

  const parsedRef = parseRemoteBranchRef(ref);
  if (!parsedRef) return c.json({ ok: false, error: 'Not a remote branch ref' }, 400);

  try {
    const gitRoot = findGitRootOrNull(path.resolve(workdir));
    if (!gitRoot) return c.json({ ok: false, error: 'Not a git repository' }, 404);

    const remoteResult = spawnSync('git', ['config', '--get', `remote.${parsedRef.remote}.url`], {
      cwd: gitRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2_000,
    });
    const remoteUrl = remoteResult.stdout.trim();
    if (remoteResult.status !== 0 || !remoteUrl) {
      return c.json({ ok: false, remote: parsedRef.remote, branch: parsedRef.branch, error: 'Remote not found' }, 404);
    }

    const url = buildRemoteBranchUrl(remoteUrl, parsedRef.branch);
    if (!url) {
      return c.json({ ok: false, remote: parsedRef.remote, branch: parsedRef.branch, error: 'Unsupported remote host' }, 400);
    }
    return c.json({ ok: true, remote: parsedRef.remote, branch: parsedRef.branch, url });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Read a text file for in-dashboard preview.
app.get('/api/file-content', (c) => {
  const workdir = c.req.query('workdir');
  const requestedPath = c.req.query('path');
  if (!workdir || !requestedPath) return c.json({ ok: false, error: 'workdir and path are required' }, 400);

  try {
    const target = resolveWorkspacePreviewPath(workdir, requestedPath);
    if (!fs.existsSync(target.abs)) return c.json({ ok: false, error: 'File not found' }, 404);
    const stat = fs.statSync(target.abs);
    if (stat.isDirectory()) return c.json({ ok: false, error: 'Path is a directory' }, 400);
    if (stat.size > INLINE_FILE_MAX_BYTES) {
      return c.json({
        ok: false,
        error: `File is too large to preview (${Math.round(stat.size / 1024)} KB)`,
        path: target.abs,
        relativePath: target.relativePath,
        size: stat.size,
        tooLarge: true,
      }, 413);
    }

    const buffer = fs.readFileSync(target.abs);
    if (looksBinary(buffer)) {
      return c.json({
        ok: false,
        error: 'Binary file cannot be previewed',
        path: target.abs,
        relativePath: target.relativePath,
        size: stat.size,
        binary: true,
      }, 415);
    }

    return c.json({
      ok: true,
      path: target.abs,
      relativePath: target.relativePath,
      size: stat.size,
      content: buffer.toString('utf8'),
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Read a git diff for in-dashboard preview.
app.get('/api/git-diff-content', (c) => {
  const workdir = c.req.query('workdir');
  const requestedPath = c.req.query('path');
  if (!workdir || !requestedPath) return c.json({ ok: false, error: 'workdir and path are required' }, 400);

  try {
    const target = resolveWorkspacePreviewPath(workdir, requestedPath);
    const gitSearchDir = fs.existsSync(target.logicalTarget) && fs.statSync(target.logicalTarget).isDirectory()
      ? target.logicalTarget
      : path.dirname(target.logicalTarget);
    const gitRoot = findGitRoot(gitSearchDir);
    if (!fs.existsSync(path.join(gitRoot, '.git'))) {
      return c.json({ ok: false, error: 'Not a git repository', isGit: false }, 400);
    }
    if (!isPathInside(target.root, gitRoot) && !isPathInside(gitRoot, target.root)) {
      return c.json({ ok: false, error: 'Git repository is outside the workspace' }, 400);
    }
    const relFromGitRoot = path.relative(gitRoot, target.logicalTarget);
    if (!relFromGitRoot || relFromGitRoot.startsWith('..')) {
      return c.json({ ok: false, error: 'Path is outside the git repository' }, 400);
    }

    const statusCode = readGitPathStatus(gitRoot, relFromGitRoot);
    if ((!gitHasHead(gitRoot) || statusCode === '??') && fs.existsSync(target.abs)) {
      const synthetic = buildAddedFileDiff(target.abs, relFromGitRoot);
      return c.json({
        ok: true,
        path: target.logicalTarget,
        relativePath: path.relative(target.root, target.logicalTarget),
        content: synthetic.content,
        truncated: synthetic.truncated,
        isGit: true,
      });
    }

    const result = spawnSync('git', ['diff', '--no-ext-diff', '--color=never', 'HEAD', '--', relFromGitRoot], {
      cwd: gitRoot,
      timeout: 5_000,
      encoding: 'utf-8',
      maxBuffer: INLINE_DIFF_MAX_BYTES + 64 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.error) throw result.error;
    if ((result.status ?? 0) !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim();
      if (fs.existsSync(target.abs) && detail.includes('bad revision')) {
        const synthetic = buildAddedFileDiff(target.abs, relFromGitRoot);
        return c.json({
          ok: true,
          path: target.logicalTarget,
          relativePath: path.relative(target.root, target.logicalTarget),
          content: synthetic.content,
          truncated: synthetic.truncated,
          isGit: true,
        });
      }
      throw new Error(detail || 'Failed to read git diff');
    }

    const raw = String(result.stdout || '');
    const truncated = Buffer.byteLength(raw, 'utf8') > INLINE_DIFF_MAX_BYTES;
    const content = truncated ? raw.slice(0, INLINE_DIFF_MAX_BYTES) : raw;
    return c.json({
      ok: true,
      path: target.logicalTarget,
      relativePath: path.relative(target.root, target.logicalTarget),
      content,
      truncated,
      isGit: true,
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Open file/directory in a selected editor or file browser
app.post('/api/open-in-editor', async (c) => {
  try {
    const body = await c.req.json();
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const target = isOpenTarget(body?.target) ? body.target : 'vscode';
    if (!filePath) return c.json({ ok: false, error: 'filePath is required' }, 400);
    if (!fs.existsSync(filePath)) return c.json({ ok: false, error: 'Path not found' }, 404);
    const stat = fs.statSync(filePath);
    openPathWithTarget(filePath, target, stat.isDirectory());
    return c.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[open-in-editor] failed: ${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

// Open git diff for a file in the selected editor
app.post('/api/open-diff', async (c) => {
  try {
    const body = await c.req.json();
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const target = isOpenTarget(body?.target) ? body.target : 'vscode';
    if (!filePath) return c.json({ ok: false, error: 'filePath is required' }, 400);

    const dir = path.dirname(filePath);
    const relFile = path.basename(filePath);

    // Write the original (HEAD) version to a temp file
    const origResult = spawnSync('git', ['show', `HEAD:${path.relative(findGitRoot(dir), filePath)}`], {
      cwd: dir,
      timeout: 5_000,
      encoding: 'buffer',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });

    if (origResult.status !== 0) {
      // New file — no HEAD version, just open the file
      openPathWithTarget(filePath, target, false);
      return c.json({ ok: true });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-diff-'));
    const origPath = path.join(tmpDir, `${relFile}.orig`);
    fs.writeFileSync(origPath, origResult.stdout);

    // Use editor CLI diff command (fire-and-forget)
    const cli = target === 'cursor' ? 'cursor' : target === 'windsurf' ? 'windsurf' : 'code';
    const child = spawn(cli, ['--diff', origPath, filePath], {
      cwd: dir,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    // Clean up temp after a delay
    setTimeout(() => fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {}), 30_000);
    return c.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runtime.log(`[open-diff] failed: ${detail}`);
    return c.json({ ok: false, error: detail }, 500);
  }
});

function normalizeGitChangeStatus(statusCode: string): 'added' | 'modified' | 'deleted' {
  if (statusCode.includes('D') && !statusCode.includes('A')) return 'deleted';
  if (statusCode.includes('A') || statusCode.includes('?')) return 'added';
  return 'modified';
}

function readGitChanges(gitRoot: string, workspaceDir: string) {
  // --no-optional-locks avoids contention with other git processes.
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: gitRoot,
    timeout: 5_000,
    encoding: 'utf-8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || 'Failed to read git status');
  }

  const lines = String(result.stdout || '').split('\n').filter(line => line.trim().length > 0);
  return lines.map(line => {
    const statusCode = line.slice(0, 2);
    const relFromGitRoot = parseGitStatusPath(line.slice(3));
    const absPath = path.resolve(gitRoot, relFromGitRoot);
    if (!isPathInside(workspaceDir, absPath)) return null;
    return {
      status: normalizeGitChangeStatus(statusCode),
      file: path.relative(workspaceDir, absPath),
      path: absPath,
    };
  }).filter(Boolean);
}

function parseGitStatusPath(pathSpec: string): string {
  const renamedSeparator = ' -> ';
  const renamedIndex = pathSpec.lastIndexOf(renamedSeparator);
  const rawPath = renamedIndex >= 0 ? pathSpec.slice(renamedIndex + renamedSeparator.length) : pathSpec;
  return unquoteGitPath(rawPath.trim());
}

function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function gitHasHead(gitRoot: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: gitRoot,
    timeout: 5_000,
    encoding: 'utf-8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return (result.status ?? 1) === 0;
}

function readGitPathStatus(gitRoot: string, relFromGitRoot: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', relFromGitRoot], {
    cwd: gitRoot,
    timeout: 5_000,
    encoding: 'utf-8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if ((result.status ?? 0) !== 0) return '';
  return String(result.stdout || '').split('\n').find(Boolean)?.slice(0, 2) || '';
}

function buildAddedFileDiff(absPath: string, relFromGitRoot: string): { content: string; truncated: boolean } {
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) return { content: '', truncated: false };
  if (stat.size > INLINE_DIFF_MAX_BYTES) {
    return {
      content: `diff --git a/${relFromGitRoot} b/${relFromGitRoot}\nnew file mode 100644\n--- /dev/null\n+++ b/${relFromGitRoot}\n@@ -0,0 +1 @@\n+File is too large to preview (${Math.round(stat.size / 1024)} KB)\n`,
      truncated: true,
    };
  }

  const buffer = fs.readFileSync(absPath);
  if (looksBinary(buffer)) {
    return {
      content: `diff --git a/${relFromGitRoot} b/${relFromGitRoot}\nnew file mode 100644\n--- /dev/null\n+++ b/${relFromGitRoot}\n@@ -0,0 +1 @@\n+Binary file cannot be previewed\n`,
      truncated: false,
    };
  }

  const text = buffer.toString('utf8');
  const lines = text.length > 0 ? text.replace(/\n$/, '').split('\n') : [];
  const body = lines.map(line => `+${line}`).join('\n');
  const content = [
    `diff --git a/${relFromGitRoot} b/${relFromGitRoot}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relFromGitRoot}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    body || '+',
  ].join('\n');
  return { content: `${content}\n`, truncated: false };
}

function findGitRootOrNull(dir: string): string | null {
  let current = path.resolve(dir);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    current = path.dirname(current);
  }
  return null;
}

function findImmediateGitRoots(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dir, entry.name))
      .filter(child => fs.existsSync(path.join(child, '.git')))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function findGitRoot(dir: string): string {
  return findGitRootOrNull(dir) ?? dir;
}

function parseRemoteBranchRef(ref: string): { remote: string; branch: string } | null {
  const trimmed = ref.trim();
  const match = /^([A-Za-z0-9._-]+)\/(.+)$/.exec(trimmed);
  if (!match) return null;
  const remote = match[1];
  const branch = match[2];
  if (!remote || !branch) return null;
  if (/[\s\\~^:?*[\]\0-\x1F\x7F]/.test(branch)) return null;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) return null;
  if (branch.endsWith('.lock')) return null;
  return { remote, branch };
}

function encodeBranchPath(branch: string): string {
  return branch.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function normalizeGitRemoteUrl(remoteUrl: string): { host: string; repoUrl: string } | null {
  const cleaned = remoteUrl.trim().replace(/\/+$/, '');
  let host = '';
  let repoPath = '';

  const scpLike = /^git@([^:]+):(.+)$/i.exec(cleaned);
  if (scpLike) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else {
    const sshLike = /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(cleaned);
    const webLike = /^https?:\/\/([^/]+)\/(.+)$/i.exec(cleaned);
    const match = sshLike || webLike;
    if (!match) return null;
    host = match[1];
    repoPath = match[2];
  }

  repoPath = repoPath.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!host || !repoPath) return null;
  return { host, repoUrl: `https://${host}/${repoPath}` };
}

function buildRemoteBranchUrl(remoteUrl: string, branch: string): string | null {
  const normalized = normalizeGitRemoteUrl(remoteUrl);
  if (!normalized) return null;
  const host = normalized.host.toLowerCase();
  const encodedBranch = encodeBranchPath(branch);
  if (host.includes('github.')) return `${normalized.repoUrl}/tree/${encodedBranch}`;
  if (host.includes('gitlab.')) return `${normalized.repoUrl}/-/tree/${encodedBranch}`;
  return null;
}

export default app;
