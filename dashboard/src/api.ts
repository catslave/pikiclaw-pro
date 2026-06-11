import type {
  AgentStatusResponse,
  AgentHealthResult,
  AgentAssistant,
  AssistantPromptInfo,
  AssistantHistoryItem,
  AppState,
  AutomationRule,
  BrowserSetupResponse,
  BrowserPanelSnapshot,
  BrowserStatusResponse,
  CliCatalogItem,
  CliStatus,
  DailyItem,
  FileContentResult,
  FocusOverviewResponse,
  FocusSandboxRecord,
  FocusSandboxState,
  FocusSandboxType,
  InteractionSnapshot,
  OpenTarget,
  GitChangesResult,
  GitDiffContentResult,
  GitRemoteBranchUrlResult,
  HostInfo,
  KnowledgeEntry,
  KnowledgeTreeNode,
  JiraSyncRun,
  JiraRemoteUpdateFields,
  JiraRemoteUpdateRun,
  JiraWorkflowConfig,
  JiraCycle,
  LocalModelActionResponse,
  LocalModelsProbeResponse,
  LsDirResult,
  MarkdownHtmlRenderResult,
  McpCatalogItem,
  McpHealthResult,
  McpSearchResult,
  McpServerConfig,
  NoteAsset,
  NotePage,
  NotePromotionTarget,
  NoteSearchResult,
  NoteTree,
  PermissionRequestResult,
  PlatformSkillInfo,
  ProUsageSummary,
  ProTask,
  ProTaskWorkbench,
  ProTaskKind,
  ProTaskStage,
  ProTaskStatus,
  ProSubtaskStatus,
  TaskSpace,
  TodoItem,
  TodoItemKind,
  TodoItemSource,
  VerificationResult,
  VerificationRun,
  SkillCatalogItem,
  RemoteSkillInfo,
  SessionHubResult,
  SessionGoalView,
  SessionPlanView,
  SessionMessagesResult,
  SessionContextSource,
  SkillInfo,
  StreamActivityEvents,
  StreamActivitySummary,
  StreamPlan,
  StreamPreviewMeta,
  SessionTailMessage,
  SessionsPageResult,
  WorkspaceEntry,
  WeixinLoginStartResult,
  WeixinLoginWaitResult,
  WeixinValidationResult,
} from './types';

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

export interface SessionSendRequestOptions extends ApiRequestOptions {
  attachments?: File[];
  model?: string | null;
  effort?: string | null;
  /**
   * When sent with an empty/pending sessionId because the user just switched
   * agent, these point at the live session of the agent they switched away
   * from. The backend reads that session, compacts it, and prepends the seed
   * to this turn's prompt — see `compactForHandover` in src/agent/handover.ts.
   */
  previousAgent?: string | null;
  previousSessionId?: string | null;
  contextSources?: SessionContextSource[];
  projectContext?: { source: string; hash: string; title?: string | null } | null;
  displayPrompt?: string | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function forwardAbort(source: AbortSignal | null | undefined, controller: AbortController): () => void {
  if (!source) return () => {};
  const abort = () => controller.abort((source as AbortSignal & { reason?: unknown }).reason);
  if (source.aborted) {
    abort();
    return () => {};
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

async function json<T>(url: string, opts: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = opts;
  const controller = new AbortController();
  const cleanupAbort = forwardAbort(signal, controller);
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const raw = await res.text();
    if (!raw) throw new Error(`Empty response (${res.status})`);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Invalid server response (${res.status})`);
    }
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    if (err instanceof Error) throw err;
    throw new Error(String(err ?? 'Request failed'));
  } finally {
    clearTimeout(timer);
    cleanupAbort();
  }
}

function post<T>(url: string, body: unknown, opts: ApiRequestOptions = {}): Promise<T> {
  return json<T>(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patch<T>(url: string, body: unknown, opts: ApiRequestOptions = {}): Promise<T> {
  return json<T>(url, {
    ...opts,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del<T>(url: string, opts: ApiRequestOptions = {}): Promise<T> {
  return json<T>(url, {
    ...opts,
    method: 'DELETE',
  });
}

export const api = {
  health: (opts?: ApiRequestOptions) => json<{ ok: boolean; version?: string }>('/api/health', opts),
  getState: () => json<AppState>('/api/state'),
  getHost: () => json<HostInfo>('/api/host'),
  getAgentStatus: () => json<AgentStatusResponse>('/api/agent-status'),
  getSessions: () => json<Record<string, { sessions: unknown[] }>>('/api/sessions'),
  getSessionsPage: (agent: string, page = 0, limit = 6, opts: ApiRequestOptions = {}) =>
    json<SessionsPageResult>(
      `/api/sessions/${agent}?page=${page}&limit=${limit}`,
      opts,
    ),
  getSessionDetail: (agent: string, sessionId: string, limit = 8, opts: ApiRequestOptions = {}) =>
    json<{ ok: boolean; messages?: SessionTailMessage[]; error?: string }>(
      `/api/session-detail/${agent}/${encodeURIComponent(sessionId)}?limit=${limit}`,
      opts,
    ),
  installAgent: (agent: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string } & AgentStatusResponse>(
      '/api/agent-install',
      { agent },
      { timeoutMs: 600_000, ...opts },
    ),
  updateRuntimeAgent: (patch: Record<string, unknown>) =>
    post<{ ok: boolean; error?: string } & AgentStatusResponse>('/api/runtime-agent', patch),
  checkAgentUpdate: (agent: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string } & AgentStatusResponse>('/api/agent-check-update', { agent }, { timeoutMs: 30_000, ...opts }),
  updateAgent: (agent: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string } & AgentStatusResponse>('/api/agent-update', { agent }, { timeoutMs: 600_000, ...opts }),
  checkAgentHealth: (agent: string, opts?: ApiRequestOptions) =>
    post<AgentHealthResult>('/api/agent-health', { agent }, { timeoutMs: 12_000, ...opts }),
  startAgentService: (agent: string, opts?: ApiRequestOptions) =>
    post<AgentHealthResult>('/api/agent-service', { agent, action: 'start' }, { timeoutMs: 120_000, ...opts }),
  saveConfig: (patch: Record<string, unknown>) => post<{ ok: boolean; configPath?: string }>('/api/config', patch),
  validateTelegramConfig: (token: string, allowedChatIds = '', opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; bot?: { username: string; displayName?: string }; normalizedAllowedChatIds?: string }>(
      '/api/validate-telegram-token',
      { token, allowedChatIds },
      opts,
    ),
  validateFeishuConfig: (appId: string, appSecret: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; app?: { appId: string; displayName?: string | null } }>(
      '/api/validate-feishu-config',
      { appId, appSecret },
      opts,
    ),
  validateWeixinConfig: (baseUrl: string, botToken: string, accountId: string, opts?: ApiRequestOptions) =>
    post<WeixinValidationResult>(
      '/api/validate-weixin-config',
      { baseUrl, botToken, accountId },
      opts,
    ),
  validateSlackConfig: (botToken: string, appToken: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; bot?: { userId: string; team: string | null; username: string | null } | null }>(
      '/api/validate-slack-config',
      { botToken, appToken },
      opts,
    ),
  validateDiscordConfig: (botToken: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; bot?: { userId: string; username: string; applicationId: string | null } | null }>(
      '/api/validate-discord-config',
      { botToken },
      opts,
    ),
  validateDingtalkConfig: (clientId: string, clientSecret: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; app?: { clientId: string } | null }>(
      '/api/validate-dingtalk-config',
      { clientId, clientSecret },
      opts,
    ),
  validateWecomConfig: (botId: string, botSecret: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string | null; bot?: { botId: string } | null }>(
      '/api/validate-wecom-config',
      { botId, botSecret },
      opts,
    ),
  startWeixinLogin: (baseUrl: string, opts?: ApiRequestOptions) =>
    post<WeixinLoginStartResult>(
      '/api/weixin-login/start',
      { baseUrl },
      opts,
    ),
  waitWeixinLogin: (sessionKey: string, baseUrl: string, opts?: ApiRequestOptions) =>
    post<WeixinLoginWaitResult>(
      '/api/weixin-login/wait',
      { sessionKey, baseUrl },
      opts,
    ),
  requestPermission: (permission: string) => post<PermissionRequestResult>('/api/open-preferences', { permission }),
  restart: (opts?: ApiRequestOptions) => post<{ ok: boolean; error?: string | null; activeTasks?: number }>('/api/restart', {}, opts),
  switchWorkdir: (path: string) => post<{ ok: boolean; workdir?: string; error?: string }>('/api/switch-workdir', { path }),
  lsDir: (dir?: string, includeFiles?: boolean, includeHidden?: boolean) => {
    const params = new URLSearchParams();
    if (dir) params.set('path', dir);
    if (includeFiles) params.set('files', '1');
    if (includeHidden) params.set('hidden', '1');
    const qs = params.toString();
    return json<LsDirResult>(`/api/ls-dir${qs ? '?' + qs : ''}`);
  },
  gitChanges: (dir: string) =>
    json<GitChangesResult>(`/api/git-changes?path=${encodeURIComponent(dir)}`),
  gitRemoteBranchUrl: (workdir: string, ref: string) => {
    const params = new URLSearchParams({ workdir, ref });
    return json<GitRemoteBranchUrlResult>(`/api/git-remote-branch-url?${params.toString()}`);
  },
  fileContent: (workdir: string, filePath: string) => {
    const params = new URLSearchParams({ workdir, path: filePath });
    return json<FileContentResult>(`/api/file-content?${params.toString()}`);
  },
  renderMarkdownHtml: (workdir: string, filePath: string) =>
    post<MarkdownHtmlRenderResult>('/api/render-markdown-html', { workdir, path: filePath }),
  gitDiffContent: (workdir: string, filePath: string) => {
    const params = new URLSearchParams({ workdir, path: filePath });
    return json<GitDiffContentResult>(`/api/git-diff-content?${params.toString()}`);
  },
  openDiff: (filePath: string, target?: OpenTarget) =>
    post<{ ok: boolean; error?: string }>('/api/open-diff', { filePath, target }),
  getBrowser: () => json<BrowserStatusResponse>('/api/browser'),
  setupBrowser: (opts?: ApiRequestOptions) =>
    post<BrowserSetupResponse>('/api/browser/setup', {}, { timeoutMs: 120_000, ...opts }),

  // MCP Extensions — catalog-first surface
  getMcpCatalog: (workdir?: string, scope?: 'global' | 'workspace' | 'both') => {
    const params = new URLSearchParams();
    if (workdir) params.set('workdir', workdir);
    if (scope) params.set('scope', scope);
    const qs = params.toString();
    return json<{ ok: boolean; items: McpCatalogItem[] }>(`/api/extensions/mcp/catalog${qs ? '?' + qs : ''}`);
  },
  installMcp: (catalogId: string, scope: 'global' | 'workspace', credentials?: Record<string, string>, workdir?: string, enable = true) =>
    post<{ ok: boolean; enabled?: boolean; error?: string }>(
      '/api/extensions/mcp/install',
      { catalogId, scope, credentials, workdir, enable },
    ),
  toggleMcp: (name: string, enabled: boolean, scope: 'global' | 'workspace', workdir?: string) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/extensions/mcp/toggle',
      { name, enabled, scope, workdir },
    ),
  updateMcpExtension: (name: string, patch: Partial<McpServerConfig>, scope: 'global' | 'workspace', workdir?: string, replace = false) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>('/api/extensions/mcp/update', { name, patch, scope, workdir, replace }),
  removeMcp: (name: string, scope: 'global' | 'workspace', catalogId?: string, workdir?: string) =>
    post<{ ok: boolean; removed?: boolean; error?: string }>(
      '/api/extensions/mcp/remove',
      { name, scope, catalogId, workdir },
    ),
  addCustomMcp: (name: string, config: McpServerConfig, scope: 'global' | 'workspace', workdir?: string) =>
    post<{ ok: boolean; error?: string }>('/api/extensions/mcp/custom', { name, config, scope, workdir }),
  checkMcpHealth: (id: string, config: McpServerConfig, noCache = false, opts?: ApiRequestOptions) =>
    post<McpHealthResult>('/api/extensions/mcp/health', { id, config, noCache }, { timeoutMs: 15_000, ...opts }),
  searchMcp: (query: string) =>
    json<{ ok: boolean; results: McpSearchResult[] }>(`/api/extensions/mcp/search?q=${encodeURIComponent(query)}`),

  // MCP OAuth
  startMcpOAuth: (catalogId: string) =>
    post<{ ok: boolean; authUrl?: string; state?: string; error?: string }>(
      '/api/extensions/mcp/oauth/start',
      { catalogId },
      { timeoutMs: 30_000 },
    ),
  revokeMcpOAuth: (catalogId: string) =>
    post<{ ok: boolean; removed?: boolean; error?: string }>(
      '/api/extensions/mcp/oauth/revoke',
      { catalogId },
    ),

  // Skills — catalog-first surface
  getSkillsCatalog: (workdir: string | undefined, scope?: 'global' | 'workspace' | 'both', opts?: ApiRequestOptions) => {
    const params = new URLSearchParams();
    if (workdir) params.set('workdir', workdir);
    if (scope) params.set('scope', scope);
    return json<{ ok: boolean; items: SkillCatalogItem[]; installed: SkillInfo[] }>(
      `/api/extensions/skills/catalog?${params.toString()}`,
      { timeoutMs: 5_000, ...opts },
    );
  },
  installSkill: (source: string, global?: boolean, skill?: string, workdir?: string) =>
    post<{ ok: boolean; error?: string; output?: string }>(
      '/api/extensions/skills/install',
      { source, global, skill, workdir },
      { timeoutMs: 90_000 },
    ),
  removeExtensionSkill: (name: string, global?: boolean, workdir?: string) =>
    post<{ ok: boolean; error?: string }>('/api/extensions/skills/remove', { name, global, workdir }),
  getSkillPrompt: (name: string, global?: boolean, workdir?: string) => {
    const params = new URLSearchParams({ name, global: String(!!global) });
    if (workdir) params.set('workdir', workdir);
    return json<{ ok: boolean; path?: string; content?: string; error?: string }>(
      `/api/extensions/skills/prompt?${params.toString()}`,
    );
  },
  updateSkillPrompt: (name: string, content: string, global?: boolean, workdir?: string) =>
    post<{ ok: boolean; path?: string; error?: string }>(
      '/api/extensions/skills/prompt',
      { name, content, global, workdir },
    ),
  listRepoSkills: (source: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; skills: RemoteSkillInfo[]; partial?: boolean; error?: string }>(
      `/api/extensions/skills/list?source=${encodeURIComponent(source)}`,
      { timeoutMs: 15_000, ...opts },
    ),
  searchExtensionSkills: (query: string) =>
    json<{ ok: boolean; results: any[] }>(`/api/extensions/skills/search?q=${encodeURIComponent(query)}`),

  // Skills (legacy)
  getSkills: (workdir: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; skills: SkillInfo[]; error?: string }>(
      `/api/session-hub/skills?workdir=${encodeURIComponent(workdir)}`,
      { timeoutMs: 5_000, ...opts },
    ),
  getPlatformSkills: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; skills: PlatformSkillInfo[]; error?: string }>(
      '/api/platform-skills/catalog',
      { timeoutMs: 5_000, ...opts },
    ),

  // CLI tools — catalog + auth lifecycle
  getCliCatalog: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; items: CliCatalogItem[]; error?: string }>(
      '/api/extensions/cli/catalog',
      { timeoutMs: 10_000, ...opts },
    ),
  refreshCli: (id: string) =>
    post<{ ok: boolean; status?: CliStatus; error?: string }>(
      '/api/extensions/cli/refresh',
      { id },
      { timeoutMs: 15_000 },
    ),
  startCliAuth: (id: string) =>
    post<{ ok: boolean; sessionId?: string; error?: string }>(
      '/api/extensions/cli/auth/start',
      { id },
    ),
  startCliInstall: (id: string) =>
    post<{ ok: boolean; sessionId?: string; error?: string }>(
      '/api/extensions/cli/install',
      { id },
    ),
  cancelCliAuth: (sessionId: string) =>
    post<{ ok: boolean; cancelled?: boolean; error?: string }>(
      '/api/extensions/cli/auth/cancel',
      { sessionId },
    ),
  applyCliToken: (id: string, values: Record<string, string>) =>
    post<{ ok: boolean; status?: CliStatus; error?: string }>(
      '/api/extensions/cli/auth/token',
      { id, values },
      { timeoutMs: 15_000 },
    ),
  logoutCli: (id: string) =>
    post<{ ok: boolean; status?: CliStatus; error?: string }>(
      '/api/extensions/cli/logout',
      { id },
      { timeoutMs: 15_000 },
    ),

  // Local model backends (Ollama / mlx-lm) — auto-attach on probe; no manual
  // connect step. See src/dashboard/routes/local-models.ts for the contract.
  probeLocalModels: (opts?: ApiRequestOptions) =>
    json<LocalModelsProbeResponse>('/api/local-models/probe', { timeoutMs: 8_000, ...opts }),
  installLocalBackend: (backend: string, opts?: ApiRequestOptions) =>
    post<LocalModelActionResponse>(
      '/api/local-models/install',
      { backend },
      { timeoutMs: 20 * 60_000, ...opts },
    ),
  loadLocalModel: (backend: string, modelEntryId: string, opts?: ApiRequestOptions) =>
    post<LocalModelActionResponse>(
      '/api/local-models/load',
      { backend, modelEntryId },
      { timeoutMs: 60 * 60_000, ...opts },
    ),

  // Session hub
  getWorkspaces: () => json<{ ok: boolean; workspaces: WorkspaceEntry[] }>('/api/workspaces'),
  getWorkspaceSessions: (
    workdir: string,
    params: { archiveMode?: 'active' | 'archived' | 'all' } = {},
    opts?: ApiRequestOptions,
  ) =>
    post<SessionHubResult>(
      '/api/session-hub/sessions',
      { workdir, ...(params.archiveMode ? { archiveMode: params.archiveMode } : {}) },
      opts,
    ),
  getSessionMessages: (
    workdir: string,
    agent: string,
    sessionId: string,
    query: { lastNTurns?: number; turnOffset?: number; turnLimit?: number; rich?: boolean } = {},
    opts?: ApiRequestOptions,
  ) =>
    post<SessionMessagesResult>(
      '/api/session-hub/session/messages',
      { workdir, agent, sessionId, rich: query.rich ?? true, lastNTurns: query.lastNTurns, turnOffset: query.turnOffset, turnLimit: query.turnLimit },
      opts,
    ),
  updateSessionStatus: (
    workdir: string,
    agent: string,
    sessionId: string,
    status: 'inbox' | 'active' | 'review' | 'done' | 'parked',
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/session-hub/session/status',
      { workdir, agent, sessionId, status },
      opts,
    ),
  updateSessionNote: (
    workdir: string,
    agent: string,
    sessionId: string,
    note: string | null,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/session-hub/session/note',
      { workdir, agent, sessionId, note },
      opts,
    ),
  updateSessionTitle: (
    workdir: string,
    agent: string,
    sessionId: string,
    title: string | null,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/session-hub/session/title',
      { workdir, agent, sessionId, title },
      opts,
    ),
  updateSessionPinned: (
    workdir: string,
    agent: string,
    sessionId: string,
    pinned: boolean,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/session-hub/session/pinned',
      { workdir, agent, sessionId, pinned },
      opts,
    ),
  updateSessionArchived: (
    workdir: string,
    agent: string,
    sessionId: string,
    archived: boolean,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; updated?: boolean; error?: string }>(
      '/api/session-hub/session/archive',
      { workdir, agent, sessionId, archived },
      opts,
    ),
  moveSessionWorkspace: (
    workdir: string,
    targetWorkdir: string,
    agent: string,
    sessionId: string,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; moved?: boolean; session?: SessionInfo; sourceWorkdir?: string; targetWorkdir?: string; refusedReason?: string | null; error?: string }>(
      '/api/session-hub/session/workspace',
      { workdir, targetWorkdir, agent, sessionId },
      opts,
    ),
  deleteSession: (
    workdir: string,
    agent: string,
    sessionId: string,
    purgeNative: boolean,
    opts?: ApiRequestOptions,
  ) =>
    post<{
      ok: boolean;
      recordRemoved?: boolean;
      pikiclawPathsRemoved?: string[];
      nativePathsRemoved?: string[];
      error?: string;
    }>(
      '/api/session-hub/session/delete',
      { workdir, agent, sessionId, purgeNative },
      opts,
    ),
  deleteSideChat: (
    workdir: string,
    parentAgent: string,
    parentSessionId: string,
    agent: string,
    sessionId: string,
    purgeNative = true,
    opts?: ApiRequestOptions,
  ) =>
    post<{
      ok: boolean;
      recordRemoved?: boolean;
      sideChatRefRemoved?: boolean;
      pikiclawPathsRemoved?: string[];
      nativePathsRemoved?: string[];
      error?: string;
    }>(
      '/api/session-hub/session/side-chat/delete',
      { workdir, parentAgent, parentSessionId, agent, sessionId, purgeNative },
      opts,
    ),
  addWorkspace: (wsPath: string, name?: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; workspace?: WorkspaceEntry; error?: string }>('/api/workspaces', { path: wsPath, name }, opts),
  updateWorkspace: (
    wsPath: string,
    patch: {
      name?: string;
      preferredAgent?: string | null;
      order?: number;
      rules?: string;
      instructions?: string;
      memory?: string;
    },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; workspace?: WorkspaceEntry | null; error?: string }>('/api/workspaces', { ...opts, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: wsPath, ...patch }) }),
  reorderWorkspaces: (paths: string[], opts?: ApiRequestOptions) =>
    post<{ ok: boolean; workspaces?: WorkspaceEntry[]; error?: string }>('/api/workspaces/reorder', { paths }, opts),
  removeWorkspace: (wsPath: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; removed?: boolean; error?: string }>('/api/workspaces', { ...opts, method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: wsPath }) }),

  // Editor integration
  openInEditor: (filePath: string, target?: OpenTarget) =>
    post<{ ok: boolean; error?: string }>('/api/open-in-editor', { filePath, target }),
  openExternalUrl: (url: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string }>('/api/open-external-url', { url }, opts),

  // Session interaction
  sendSessionMessage: (
    workdir: string,
    agent: string,
    sessionId: string,
    prompt: string,
    options: SessionSendRequestOptions = {},
  ) => {
    const {
      attachments = [],
      model,
      effort,
      previousAgent,
      previousSessionId,
      contextSources = [],
      projectContext = null,
      displayPrompt,
      ...opts
    } = options;
    const prevAgent = typeof previousAgent === 'string' ? previousAgent.trim() : '';
    const prevSessionId = typeof previousSessionId === 'string' ? previousSessionId.trim() : '';
    const visiblePrompt = typeof displayPrompt === 'string' ? displayPrompt.trim() : '';
    const payload = {
      workdir,
      agent,
      sessionId,
      prompt,
      ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
      ...(typeof effort === 'string' && effort.trim() ? { effort: effort.trim() } : {}),
      ...(prevAgent && prevSessionId ? { previousAgent: prevAgent, previousSessionId: prevSessionId } : {}),
      ...(contextSources.length ? { contextSources } : {}),
      ...(projectContext?.source && projectContext.hash ? { projectContext } : {}),
      ...(visiblePrompt ? { displayPrompt: visiblePrompt } : {}),
    };

    if (!attachments.length) {
      return post<{ ok: boolean; queued?: boolean; taskId?: string; sessionKey?: string; error?: string }>(
        '/api/session-hub/session/send',
        payload,
        { timeoutMs: 30_000, ...opts },
      );
    }

    const body = new FormData();
    body.set('workdir', workdir);
    body.set('agent', agent);
    body.set('sessionId', sessionId);
    body.set('prompt', prompt);
    if (visiblePrompt) body.set('displayPrompt', visiblePrompt);
    if (typeof model === 'string' && model.trim()) body.set('model', model.trim());
    if (typeof effort === 'string' && effort.trim()) body.set('effort', effort.trim());
    if (prevAgent && prevSessionId) {
      body.set('previousAgent', prevAgent);
      body.set('previousSessionId', prevSessionId);
    }
    if (contextSources.length) body.set('contextSources', JSON.stringify(contextSources));
    if (projectContext?.source && projectContext.hash) body.set('projectContext', JSON.stringify(projectContext));
    for (const attachment of attachments) {
      body.append('attachments', attachment, attachment.name || 'image');
    }

    return json<{ ok: boolean; queued?: boolean; taskId?: string; sessionKey?: string; error?: string }>(
      '/api/session-hub/session/send',
      { method: 'POST', body, timeoutMs: 30_000, ...opts },
    );
  },
  getSessionGoal: (workdir: string, agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; goal?: SessionGoalView | null; error?: string }>(
      `/api/session-hub/session/goal?workdir=${encodeURIComponent(workdir)}&agent=${encodeURIComponent(agent)}&sessionId=${encodeURIComponent(sessionId)}`,
      opts,
    ),
  getSessionPlan: (workdir: string, agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; plan?: SessionPlanView | null; error?: string }>(
      `/api/session-hub/session/plan?workdir=${encodeURIComponent(workdir)}&agent=${encodeURIComponent(agent)}&sessionId=${encodeURIComponent(sessionId)}`,
      opts,
    ),

  // Knowledge tree
  getKnowledgeTree: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; tree: KnowledgeTreeNode[]; error?: string }>('/api/knowledge', opts),
  getKnowledgeNode: (id: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; node?: KnowledgeTreeNode; error?: string }>(
      `/api/knowledge/nodes/${encodeURIComponent(id)}`,
      opts,
    ),
  linkWorkspaceKnowledge: (workdir: string, nodeId?: string | null, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; node?: KnowledgeTreeNode; tree?: KnowledgeTreeNode[]; created?: boolean; linked?: boolean; error?: string }>(
      '/api/knowledge/workspace',
      { workdir, ...(nodeId ? { nodeId } : {}) },
      { timeoutMs: 60_000, ...opts },
    ),
  reanalyzeKnowledgeNode: (id: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; node?: KnowledgeTreeNode; tree?: KnowledgeTreeNode[]; error?: string }>(
      `/api/knowledge/nodes/${encodeURIComponent(id)}/analyze`,
      {},
      { timeoutMs: 60_000, ...opts },
    ),
  pauseSessionGoal: (workdir: string, agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; goal?: SessionGoalView | null; error?: string }>(
      '/api/session-hub/session/goal/pause',
      { workdir, agent, sessionId },
      opts,
    ),
  resumeSessionGoal: (workdir: string, agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; goal?: SessionGoalView | null; error?: string }>(
      '/api/session-hub/session/goal/resume',
      { workdir, agent, sessionId },
      opts,
    ),
  clearSessionGoal: (workdir: string, agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; error?: string }>(
      '/api/session-hub/session/goal/clear',
      { workdir, agent, sessionId },
      opts,
    ),
  /**
   * Fork a session at `atTurn` and queue a new prompt against the freshly
   * created child. Returns the queued task plus the child's pending sessionKey
   * so the caller can navigate the UI into the new session immediately.
   */
  forkSession: (
    workdir: string,
    agent: string,
    parentSessionId: string,
    atTurn: number,
    prompt: string,
    options: { model?: string | null; effort?: string | null } = {},
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; queued?: boolean; taskId?: string; sessionKey?: string; error?: string }>(
      '/api/session-hub/session/fork',
      {
        workdir,
        agent,
        sessionId: parentSessionId,
        atTurn,
        prompt,
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
      },
      { timeoutMs: 30_000, ...opts },
    ),
  createSideChat: (
    workdir: string,
    agent: string,
    parentSessionId: string,
    title?: string | null,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; session?: import('./types').SessionInfo | null; parent?: import('./types').SessionInfo | null; sessionKey?: string; error?: string | null }>(
      '/api/session-hub/session/side-chat',
      {
        workdir,
        agent,
        sessionId: parentSessionId,
        ...(title ? { title } : {}),
      },
      { timeoutMs: 30_000, ...opts },
    ),
  recallSessionMessage: (taskId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; recalled?: boolean; error?: string }>(
      '/api/session-hub/session/recall',
      { taskId },
      opts,
    ),
  /**
   * Stop the running stream AND cancel every queued task for a session.
   * Backed by `bot.stopAllSessionTasks`; takes (agent, sessionId) so it works
   * even in the small window after `sendSessionMessage` where the client
   * hasn't received the streamTaskId yet.
   */
  stopSession: (agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; interrupted?: boolean; cancelledQueued?: number; error?: string }>(
      '/api/session-hub/session/stop',
      { agent, sessionId },
      opts,
    ),
  steerSession: (taskId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; steered?: boolean; error?: string }>(
      '/api/session-hub/session/steer',
      { taskId },
      opts,
    ),
  reorderSessionQueue: (agent: string, sessionId: string, taskIds: string[], opts?: ApiRequestOptions) =>
    post<{ ok: boolean; reordered?: boolean; queuedTaskIds?: string[]; error?: string }>(
      '/api/session-hub/session/reorder-queue',
      { agent, sessionId, taskIds },
      opts,
    ),

  /** Poll current streaming state for a session. */
  getSessionStreamState: (agent: string, sessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; state: StreamSnapshot | null }>(
      `/api/session-hub/session/stream-state?agent=${encodeURIComponent(agent)}&sessionId=${encodeURIComponent(sessionId)}`,
      { timeoutMs: 5_000, ...opts },
    ),

  // Pikiclaw Pro task workflow
  getTaskSpaces: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; spaces: TaskSpace[]; error?: string }>('/api/pro/task-spaces', opts),
  createTaskSpace: (space: { name: string; defaultWorkdir?: string; defaultAgent?: string | null; defaultAssistantId?: string | null }, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; space?: TaskSpace; error?: string }>('/api/pro/task-spaces', space, opts),
  updateTaskSpace: (spaceId: string, space: { name?: string; defaultWorkdir?: string | null; defaultAgent?: string | null; defaultAssistantId?: string | null; archived?: boolean }, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; space?: TaskSpace; error?: string }>(
      `/api/pro/task-spaces/${encodeURIComponent(spaceId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(space),
        ...opts,
      },
    ),
  archiveTaskSpace: (spaceId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; space?: TaskSpace; error?: string }>(
      `/api/pro/task-spaces/${encodeURIComponent(spaceId)}`,
      { method: 'DELETE', ...opts },
    ),
  getProTasks: (optsOrSpaceId?: ApiRequestOptions | string, filters?: { plannedDate?: string }) => {
    const spaceId = typeof optsOrSpaceId === 'string' ? optsOrSpaceId : '';
    const opts = typeof optsOrSpaceId === 'string' ? undefined : optsOrSpaceId;
    const params = new URLSearchParams();
    if (spaceId && spaceId !== 'all') params.set('spaceId', spaceId);
    if (filters?.plannedDate) params.set('plannedDate', filters.plannedDate);
    const query = params.toString() ? `?${params.toString()}` : '';
    return json<{ ok: boolean; tasks: ProTask[]; error?: string }>(`/api/pro/tasks${query}`, opts);
  },
  getProTaskWorkbench: (taskId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; workbench?: ProTaskWorkbench; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/workbench`,
      opts,
    ),
  getJiraCycles: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; cycles: JiraCycle[]; error?: string }>('/api/pro/jira/cycles', opts),
  kickOffJiraCycle: (body?: { name?: string; startDate?: string; endDate?: string; taskIds?: string[] }, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; cycle?: JiraCycle; tasks?: ProTask[]; error?: string }>('/api/pro/jira/cycles/kickoff', body || {}, opts),
  closeActiveJiraCycle: (opts?: ApiRequestOptions) =>
    post<{ ok: boolean; cycle?: JiraCycle | null; error?: string }>('/api/pro/jira/cycles/close-active', {}, opts),
  deleteJiraCycle: (cycleId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; cycle?: JiraCycle; error?: string }>(
      `/api/pro/jira/cycles/${encodeURIComponent(cycleId)}`,
      { method: 'DELETE', ...opts },
    ),
  getProTodos: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; items: TodoItem[]; error?: string }>('/api/pro/todos', opts),
  getDailyItems: (date: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; items: DailyItem[]; error?: string }>(
      `/api/pro/daily-items?date=${encodeURIComponent(date)}`,
      opts,
    ),
  createDailyItems: (
    body: { date: string; titles: string[]; relatedTaskId?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; items?: DailyItem[]; error?: string }>('/api/pro/daily-items', body, opts),
  addTodoToDaily: (
    body: { date: string; todoId: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; item?: DailyItem; taskId?: string; error?: string }>(
      '/api/pro/daily-items/from-todo',
      body,
      opts,
    ),
  addTaskToDaily: (
    body: { date: string; taskId: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; item?: DailyItem; error?: string }>(
      '/api/pro/daily-items/from-task',
      body,
      opts,
    ),
  promoteDailyItems: (
    body: { date: string; itemIds: string[]; workdir?: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; items?: DailyItem[]; taskIds?: string[]; error?: string }>(
      '/api/pro/daily-items/promote',
      body,
      opts,
    ),
  reorderDailyItems: (
    body: { date: string; itemIds: string[] },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; items?: DailyItem[]; error?: string }>(
      '/api/pro/daily-items/reorder',
      body,
      opts,
    ),
  updateDailyItem: (
    itemId: string,
    body: { title?: string; status?: DailyItem['status']; relatedTaskId?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; item?: DailyItem; error?: string }>(
      `/api/pro/daily-items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...opts,
      },
    ),
  revertDailyItemTask: (itemId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; item?: DailyItem; error?: string }>(
      `/api/pro/daily-items/${encodeURIComponent(itemId)}/revert-task`,
      {},
      opts,
    ),
  deleteDailyItem: (itemId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; item?: DailyItem; error?: string }>(
      `/api/pro/daily-items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE', ...opts },
    ),
  getNotesTree: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; error?: string } & NoteTree>('/api/pro/notes/tree', opts),
  openDailyNote: (date?: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; page?: NotePage; error?: string }>('/api/pro/notes/daily', { date }, opts),
  createNotePage: (body: { title?: string; parentId?: string | null }, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; page?: NotePage; error?: string }>('/api/pro/notes/pages', body, opts),
  reorderNotePages: (body: { parentId?: string | null; pageIds: string[] }, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; pages?: NotePage[]; error?: string }>('/api/pro/notes/pages/reorder', body, opts),
  searchNotes: (query: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; results: NoteSearchResult[]; error?: string }>(
      `/api/pro/notes/search?q=${encodeURIComponent(query)}`,
      opts,
    ),
  getNotePage: (pageId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; page?: NotePage; error?: string }>(
      `/api/pro/notes/pages/${encodeURIComponent(pageId)}`,
      opts,
    ),
  updateNotePage: (
    pageId: string,
    body: { title?: string; parentId?: string | null; deletedAt?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; page?: NotePage; error?: string }>(
      `/api/pro/notes/pages/${encodeURIComponent(pageId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...opts },
    ),
  deleteNotePage: (pageId: string, permanent = false, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; page?: NotePage; error?: string }>(
      `/api/pro/notes/pages/${encodeURIComponent(pageId)}${permanent ? '?permanent=1' : ''}`,
      { method: 'DELETE', ...opts },
    ),
  getNoteDocument: (pageId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; blocks?: unknown[]; error?: string }>(
      `/api/pro/notes/pages/${encodeURIComponent(pageId)}/document`,
      opts,
    ),
  saveNoteDocument: (pageId: string, blocks: unknown[], opts?: ApiRequestOptions) =>
    json<{ ok: boolean; blocks?: unknown[]; error?: string }>(
      `/api/pro/notes/pages/${encodeURIComponent(pageId)}/document`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks }), timeoutMs: 30_000, ...opts },
    ),
  uploadNoteAsset: async (pageId: string, file: File, opts: ApiRequestOptions = {}) => {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = opts;
    const controller = new AbortController();
    const cleanupAbort = forwardAbort(signal, controller);
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    const form = new FormData();
    form.set('file', file);
    try {
      const res = await fetch(`/api/pro/notes/pages/${encodeURIComponent(pageId)}/assets`, {
        ...rest,
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Empty response (${res.status})`);
      return JSON.parse(raw) as { ok: boolean; asset?: NoteAsset; error?: string };
    } catch (err) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err ?? 'Request failed'));
    } finally {
      clearTimeout(timer);
      cleanupAbort();
    }
  },
  promoteNoteSelection: (
    body: { pageId: string; target: NotePromotionTarget; text: string; date?: string; workdir?: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; target?: NotePromotionTarget; item?: TodoItem; items?: DailyItem[]; task?: ProTask; error?: string }>(
      '/api/pro/notes/promote',
      body,
      opts,
    ),
  createProTodo: (
    item: {
      kind?: TodoItemKind;
      title?: string;
      body?: string;
      source?: TodoItemSource;
      images?: TodoItem['images'];
    },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; item?: TodoItem; error?: string }>('/api/pro/todos', item, opts),
  updateProTodo: (
    todoId: string,
    item: {
      title?: string;
      body?: string;
      status?: TodoItem['status'];
      images?: TodoItem['images'];
    },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; item?: TodoItem; error?: string }>(
      `/api/pro/todos/${encodeURIComponent(todoId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), ...opts },
    ),
  deleteProTodo: (todoId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; item?: TodoItem; error?: string }>(
      `/api/pro/todos/${encodeURIComponent(todoId)}`,
      { method: 'DELETE', ...opts },
    ),
  createProReviewComment: (
    item: {
      title?: string;
      body?: string;
      source?: TodoItemSource;
    },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; item?: TodoItem; error?: string }>('/api/pro/review-comments', item, opts),
  createProTodoChat: (
    body: { todoIds: string[]; prompt?: string; workdir?: string; agent?: string | null; model?: string | null; effort?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; items?: TodoItem[]; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      '/api/pro/todos/chat',
      body,
      { timeoutMs: 30_000, ...opts },
    ),
  getProAssistants: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; assistants: AgentAssistant[]; error?: string }>('/api/pro/assistants', opts),
  getReviewLinkMeta: (url: string, opts?: ApiRequestOptions) =>
    json<{
      ok: boolean;
      meta?: { provider: 'gitlab' | 'github' | 'unknown'; url: string; repo?: string; number?: string; title?: string; displayTitle?: string };
      error?: string;
    }>(
      `/api/pro/review-link-meta?url=${encodeURIComponent(url)}`,
      opts,
    ),
  runProAssistant: (
    assistantId: string,
    body: { prompt: string; displayPrompt?: string | null; workdir?: string; agent?: string | null; projectContext?: { source: string; hash: string; title?: string | null } | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{
      ok: boolean;
      assistant?: AgentAssistant;
      queued?: { taskId?: string; sessionKey?: string; queued?: boolean };
      session?: { workdir: string; agent: string; sessionId: string } | null;
      error?: string;
    }>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}/run`,
      body,
      { timeoutMs: 30_000, ...opts },
    ),
  getProAssistantHistory: (limit: number | 'all' = 3, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; history: Record<string, AssistantHistoryItem[]>; error?: string }>(
      `/api/pro/assistants/history?limit=${encodeURIComponent(String(limit))}`,
      opts,
    ),
  getProUsageSummary: (limit = 240, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; summary: ProUsageSummary; error?: string }>(
      `/api/pro/usage-summary?limit=${encodeURIComponent(String(limit))}`,
      { timeoutMs: 90_000, ...opts },
    ),
  getJiraWorkflowConfig: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; config: JiraWorkflowConfig; error?: string }>('/api/pro/jira/config', opts),
  updateJiraWorkflowConfig: (config: JiraWorkflowConfig, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; config: JiraWorkflowConfig; error?: string }>(
      '/api/pro/jira/config',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        ...opts,
      },
    ),
  createProAssistant: (
    body: {
      name: string;
      responsibility?: string;
      preferredAgents?: string[];
      kind?: AgentAssistant['kind'];
      surfaceId?: string;
      objectTypes?: string[];
      prompt?: string;
      defaultPrompt?: string;
      allowedActions?: string[];
      labels?: string[];
      enabled?: boolean;
    },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; assistant?: AgentAssistant; error?: string }>('/api/pro/assistants', body, opts),
  updateProAssistant: (
    assistantId: string,
    body: {
      name?: string;
      responsibility?: string;
      preferredAgents?: string[];
      kind?: AgentAssistant['kind'];
      surfaceId?: string;
      objectTypes?: string[];
      prompt?: string;
      defaultPrompt?: string;
      allowedActions?: string[];
      labels?: string[];
      enabled?: boolean;
    },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; assistant?: AgentAssistant; error?: string }>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...opts,
      },
    ),
  getProAssistantPrompt: (assistantId: string, opts?: ApiRequestOptions) =>
    json<AssistantPromptInfo>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}/prompt`,
      opts,
    ),
  updateProAssistantPrompt: (assistantId: string, body: { prompt: string }, opts?: ApiRequestOptions) =>
    json<AssistantPromptInfo>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}/prompt`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...opts,
      },
    ),
  resetProAssistantPrompt: (assistantId: string, opts?: ApiRequestOptions) =>
    post<AssistantPromptInfo>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}/reset-prompt`,
      {},
      opts,
    ),
  deleteProAssistant: (assistantId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; assistant?: AgentAssistant; error?: string }>(
      `/api/pro/assistants/${encodeURIComponent(assistantId)}`,
      { method: 'DELETE', ...opts },
    ),
  getProAutomations: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; automations: AutomationRule[]; error?: string }>('/api/pro/automations', opts),
  createProAutomation: (
    body: { key?: string; name: string; schedule?: string; prompt: string; workdir?: string; agent?: string | null; assistantId?: string | null; enabled?: boolean },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; automation?: AutomationRule; error?: string }>('/api/pro/automations', body, opts),
  runProAutomation: (automationId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; automation?: AutomationRule; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      `/api/pro/automations/${encodeURIComponent(automationId)}/run`,
      {},
      { timeoutMs: 30_000, ...opts },
    ),
  runJiraMcpSync: (
    body: { assistantId?: string | null; workdir?: string; agent?: string | null } = {},
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; run?: JiraSyncRun; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      '/api/pro/jira/mcp-sync/run',
      body,
      { timeoutMs: 30_000, ...opts },
    ),
  getJiraMcpSyncRuns: (opts?: ApiRequestOptions) =>
    json<{ ok: boolean; runs: JiraSyncRun[]; error?: string }>('/api/pro/jira/mcp-sync/runs', opts),
  getJiraMcpSyncRun: (runId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; run?: JiraSyncRun; error?: string }>(
      `/api/pro/jira/mcp-sync/runs/${encodeURIComponent(runId)}`,
      opts,
    ),
  stopJiraMcpSyncRun: (runId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: JiraSyncRun; error?: string }>(
      `/api/pro/jira/mcp-sync/runs/${encodeURIComponent(runId)}/stop`,
      {},
      opts,
    ),
  applyJiraMcpSyncRun: (runId: string, itemIds: string[], opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: JiraSyncRun; error?: string }>(
      `/api/pro/jira/mcp-sync/runs/${encodeURIComponent(runId)}/apply`,
      { itemIds },
      opts,
    ),
  getAnalyzeTicketPrompt: (opts?: ApiRequestOptions) =>
    get<{ ok: boolean; prompt?: string; defaultPrompt?: string; customized?: boolean; error?: string }>(
      '/api/pro/jira/analyze-ticket/prompt',
      opts,
    ),
  updateAnalyzeTicketPrompt: (body: { prompt: string }, opts?: ApiRequestOptions) =>
    patch<{ ok: boolean; prompt?: string; defaultPrompt?: string; customized?: boolean; error?: string }>(
      '/api/pro/jira/analyze-ticket/prompt',
      body,
      opts,
    ),
  resetAnalyzeTicketPrompt: (opts?: ApiRequestOptions) =>
    post<{ ok: boolean; prompt?: string; defaultPrompt?: string; customized?: boolean; error?: string }>(
      '/api/pro/jira/analyze-ticket/prompt/reset',
      {},
      opts,
    ),
  analyzeJiraTicket: (
    body: { query: string; workdir?: string; agent?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{
      ok: boolean;
      task?: import('./types').ProTask;
      queued?: { taskId?: string; sessionKey?: string; queued?: boolean };
      workdirResolution?: import('./types').WorkdirResolution;
      issueLookupError?: string;
      session?: { workdir: string; agent: string; sessionId: string };
      error?: string;
    }>(
      '/api/pro/jira/analyze-ticket',
      body,
      { timeoutMs: 60_000, ...opts },
    ),
  syncJiraTicket: (
    body: { query: string; projectKey?: string; workdir?: string; spaceId?: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; task?: ProTask; issueKey?: string; action?: 'created' | 'updated'; source?: string; tried?: string[]; error?: string }>(
      '/api/pro/jira/sync-ticket',
      body,
      { timeoutMs: 60_000, ...opts },
    ),
  scheduleJiraMcpSync: (
    body: { schedule: string; assistantId?: string | null; workdir?: string; enabled?: boolean },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; automation?: AutomationRule; error?: string }>(
      '/api/pro/jira/mcp-sync/schedule',
      body,
      opts,
    ),
  getProKnowledge: (
    filters?: { query?: string; tag?: string; sourceType?: string; workspace?: string; status?: string; kind?: string },
    opts?: ApiRequestOptions,
  ) => {
    const params = new URLSearchParams();
    if (filters?.query) params.set('query', filters.query);
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.sourceType) params.set('sourceType', filters.sourceType);
    if (filters?.workspace) params.set('workspace', filters.workspace);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.kind) params.set('kind', filters.kind);
    const qs = params.toString();
    return json<{ ok: boolean; knowledge: KnowledgeEntry[]; error?: string }>(`/api/pro/knowledge${qs ? '?' + qs : ''}`, opts);
  },
  createProKnowledge: (
    body: {
      title: string;
      body: string;
      summary?: string;
      kind?: KnowledgeEntry['kind'];
      status?: KnowledgeEntry['status'];
      tags?: string[];
      source?: KnowledgeEntry['source'];
      sourceRefs?: KnowledgeEntry['sourceRefs'];
      artifactRefs?: KnowledgeEntry['artifactRefs'];
      confidence?: KnowledgeEntry['confidence'];
      createdBy?: KnowledgeEntry['createdBy'];
    },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; entry?: KnowledgeEntry; error?: string }>('/api/pro/knowledge', body, opts),
  updateProKnowledge: (
    id: string,
    body: Partial<Pick<KnowledgeEntry, 'title' | 'body' | 'summary' | 'kind' | 'status' | 'tags' | 'confidence' | 'sourceRefs' | 'artifactRefs'>>,
    opts?: ApiRequestOptions,
  ) =>
    patch<{ ok: boolean; entry?: KnowledgeEntry; error?: string }>(`/api/pro/knowledge/${encodeURIComponent(id)}`, body, opts),
  deleteProKnowledge: (id: string, opts?: ApiRequestOptions) =>
    del<{ ok: boolean; entry?: KnowledgeEntry | null; error?: string }>(`/api/pro/knowledge/${encodeURIComponent(id)}`, opts),
  getFocusOverview: (opts?: ApiRequestOptions & { orchestrate?: boolean }) =>
    json<FocusOverviewResponse>(`/api/focus/overview${opts?.orchestrate ? '?orchestrate=1' : ''}`, opts),
  orchestrateFocus: (body?: { userIntent?: string | null }, opts?: ApiRequestOptions) =>
    post<FocusOverviewResponse>('/api/focus/orchestrate', body || {}, { timeoutMs: 60_000, ...opts }),
  submitFocusIntent: (text: string, opts?: ApiRequestOptions) =>
    post<FocusOverviewResponse>('/api/focus/intent', { text }, { timeoutMs: 60_000, ...opts }),
  createFocusSandbox: (
    body: { kind: FocusSandboxType; title: string; workdir: string; jiraKey?: string; taskId?: string; sessionRef?: { workdir: string; agent: string; sessionId: string } },
    opts?: ApiRequestOptions,
  ) => post<{ ok: boolean; sandbox?: FocusSandboxRecord; error?: string }>('/api/focus/sandboxes', body, opts),
  updateFocusSandbox: (id: string, body: { state?: FocusSandboxState; title?: string }, opts?: ApiRequestOptions) =>
    patch<{ ok: boolean; sandbox?: FocusSandboxRecord; error?: string }>(`/api/focus/sandboxes/${encodeURIComponent(id)}`, body, opts),
  promoteFocusSandbox: (id: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; sandbox?: FocusSandboxRecord; error?: string }>(`/api/focus/sandboxes/${encodeURIComponent(id)}/promote`, {}, opts),
  syncFocusTaskJira: (taskId: string, fields?: Record<string, unknown>, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: unknown; error?: string }>(`/api/focus/tasks/${encodeURIComponent(taskId)}/jira-sync`, { fields }, opts),
  runFocusMaintenance: (opts?: ApiRequestOptions) =>
    post<{ ok: boolean; archived: string[]; queued: string[]; digestsQueued?: string[]; skipped: Array<{ key: string; reason: string }>; errors: Array<{ key: string; error: string }> }>(
      '/api/focus/maintenance',
      {},
      { timeoutMs: 60_000, ...opts },
    ),
  extractFocusChat: (
    body: { workdir: string; agent: string; sessionId: string; force?: boolean },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; queued?: boolean; key?: string; skipped?: string; error?: string }>('/api/focus/extract-chat', body, { timeoutMs: 30_000, ...opts }),
  runSkillQuickSetup: (
    body: { repo: string; workdir?: string; agent?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      '/api/pro/skill-quick-setup',
      body,
      { timeoutMs: 30_000, ...opts },
    ),
  runSkillCommand: (
    body: { command: 'test' | 'login' | 'create-account'; environment: string; subject?: string; workdir?: string; agent?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      '/api/pro/skill-command',
      body,
      { timeoutMs: 30_000, ...opts },
    ),
  createProTask: (
    task: {
      title: string;
      description?: string;
      kind?: ProTaskKind;
      status?: ProTaskStatus;
      plannedDate?: string;
      linkedTaskId?: string;
      spaceId?: string;
      workdir?: string;
      prUrl?: string;
      defaultAgent?: string | null;
      defaultAssistantId?: string | null;
      jiraKey?: string;
      jiraUrl?: string;
      sprint?: string;
    },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; task?: ProTask; error?: string }>('/api/pro/tasks', task, opts),
  syncJiraTasks: (
    issues: Array<{
      title: string;
      description?: string;
      issueType?: string;
      jiraKey?: string;
      jiraUrl?: string;
      sprint?: string;
      spaceId?: string;
      workdir?: string;
      prUrl?: string;
      reporter?: string;
      assignee?: string;
      fixVersion?: string;
      fixVersions?: unknown[];
      ticketStatus?: string;
      status?: string;
      dueDate?: string;
      priority?: string;
      labels?: string[];
      updatedAt?: string;
      updated?: string;
      rawFields?: Record<string, unknown>;
      fields?: Record<string, unknown>;
    }>,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; tasks?: ProTask[]; error?: string }>('/api/pro/jira/sync', { issues }, opts),
  syncJiraFromRemote: (
    config: { baseUrl: string; token: string; email?: string; jql?: string; sprint?: string; workdir?: string; spaceId?: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; tasks?: ProTask[]; error?: string }>('/api/pro/jira/sync', config, { timeoutMs: 60_000, ...opts }),
  updateProTaskStatus: (taskId: string, status: ProTaskStatus, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        ...opts,
      },
    ),
  updateProTaskJiraFields: (
    taskId: string,
    fields: { reporter?: string; assignee?: string; status?: string; sprint?: string; dueDate?: string; fixVersion?: string; fixVersions?: string[] | string; priority?: string; labels?: string[] | string; issueType?: string; updatedAt?: string },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/jira-fields`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
        ...opts,
      },
    ),
  syncProTaskJiraFromRemote: (taskId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; task?: ProTask; source?: string; tried?: string[]; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/jira-sync`,
      {},
      { timeoutMs: 60_000, ...opts },
    ),
  getJiraRemoteUpdates: (taskId?: string, opts?: ApiRequestOptions) => {
    const qs = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    return json<{ ok: boolean; runs: JiraRemoteUpdateRun[]; error?: string }>(`/api/pro/jira/remote-updates${qs}`, opts);
  },
  createJiraRemoteUpdate: (taskId: string, fields: JiraRemoteUpdateFields, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: JiraRemoteUpdateRun; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/jira-remote-updates`,
      { fields },
      opts,
    ),
  applyJiraRemoteUpdate: (runId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: JiraRemoteUpdateRun; task?: ProTask; error?: string }>(
      `/api/pro/jira/remote-updates/${encodeURIComponent(runId)}/apply`,
      {},
      { timeoutMs: 120_000, ...opts },
    ),
  cancelJiraRemoteUpdate: (runId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; run?: JiraRemoteUpdateRun; error?: string }>(
      `/api/pro/jira/remote-updates/${encodeURIComponent(runId)}/cancel`,
      {},
      opts,
    ),
  deleteProTask: (taskId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE', ...opts },
    ),
  resetProTask: (taskId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/reset`,
      {},
      opts,
    ),
  setProTaskExclusiveMode: (taskId: string, enabled: boolean, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/exclusive-mode`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
        ...opts,
      },
    ),
  updateProTaskExecution: (
    taskId: string,
    execution: {
      ownerMode?: 'status' | 'agent' | 'assistant';
      agent?: string | null;
      assistantId?: string | null;
      defaultAssistantId?: string | null;
      mode?: 'direct' | 'interactive';
      model?: string | null;
      effort?: string | null;
    },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/execution`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(execution),
        ...opts,
      },
    ),
  updateProTaskCycle: (taskId: string, cycleId: string | null, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/cycle`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleId }),
        ...opts,
      },
    ),
  updateProTaskMeta: (taskId: string, meta: { workdir?: string | null; prUrl?: string | null; plannedDate?: string | null; linkedTaskId?: string | null }, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/meta`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
        ...opts,
      },
    ),
  updateProTaskBackground: (taskId: string, summary: string, opts?: ApiRequestOptions) =>
    patch<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/background`,
      { summary },
      opts,
    ),
  confirmProTaskStageOutput: (taskId: string, stageRunId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/stage-runs/${encodeURIComponent(stageRunId)}/confirm-output`,
      {},
      opts,
    ),
  startProTaskFocusSession: (taskId: string, source?: string, opts?: ApiRequestOptions) =>
    post<{
      ok: boolean;
      task?: ProTask;
      focusSession?: NonNullable<ProTask['focusSessions']>[number];
      error?: string;
    }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/focus-sessions`,
      { source },
      opts,
    ),
  finishProTaskFocusSession: (taskId: string, focusSessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/focus-sessions/${encodeURIComponent(focusSessionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        ...opts,
      },
    ),
  startProTaskStage: (
    taskId: string,
    stage: ProTaskStage,
    options: { prompt?: string; displayPrompt?: string | null; agent?: string | null; assistantId?: string | null; model?: string | null; effort?: string | null; workdir?: string | null; executionMode?: 'direct' | 'interactive'; subtaskId?: string | null } = {},
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; task?: ProTask; queued?: { taskId?: string; sessionKey?: string; queued?: boolean }; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/stage-runs`,
      {
        stage,
        ...(options.prompt ? { prompt: options.prompt } : {}),
        ...(options.displayPrompt ? { displayPrompt: options.displayPrompt } : {}),
        ...(options.agent ? { agent: options.agent } : {}),
        ...(options.assistantId ? { assistantId: options.assistantId } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.workdir ? { workdir: options.workdir } : {}),
        ...(options.executionMode ? { executionMode: options.executionMode } : {}),
        ...(options.subtaskId ? { subtaskId: options.subtaskId } : {}),
      },
      { timeoutMs: 30_000, ...opts },
    ),
  updateProTaskStageRun: (
    taskId: string,
    stageRunId: string,
    patch: {
      status?: string;
      session?: { workdir: string; agent: string; sessionId: string };
      summary?: string;
      estimate?: unknown;
      branch?: string;
      diffSummary?: string;
      changedFiles?: string[];
      testResultId?: string;
      focus?: unknown;
      knowledgeRefs?: string[];
    },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/stage-runs/${encodeURIComponent(stageRunId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        ...opts,
      },
    ),
  createProSubtask: (
    taskId: string,
    body: { title: string; description?: string; status?: ProSubtaskStatus; assignedAgent?: string | null; assistantId?: string | null; workdir?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/subtasks`,
      body,
      opts,
    ),
  updateProSubtask: (
    taskId: string,
    subtaskId: string,
    body: { title?: string; description?: string; status?: ProSubtaskStatus; assignedAgent?: string | null; assistantId?: string | null; workdir?: string | null; stageRunId?: string | null },
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...opts,
      },
    ),
  startVerificationRun: (
    taskId: string,
    body: { environment: string; url: string; stageRunId?: string; pipeline?: unknown },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; task?: ProTask; verificationRun?: VerificationRun; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/verification-runs`,
      body,
      opts,
    ),
  openBrowserPanelSession: (url: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; snapshot?: BrowserPanelSnapshot; error?: string }>(
      '/api/pro/browser-sessions',
      { url },
      { timeoutMs: 45_000, ...opts },
    ),
  getBrowserPanelSession: (sessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; snapshot?: BrowserPanelSnapshot; error?: string }>(
      `/api/pro/browser-sessions/${encodeURIComponent(sessionId)}`,
      { timeoutMs: 20_000, ...opts },
    ),
  browserPanelAction: (
    sessionId: string,
    body: { action: 'navigate'; url: string } | { action: 'reload' } | { action: 'click'; xRatio: number; yRatio: number } | { action: 'type'; text: string },
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; snapshot?: BrowserPanelSnapshot; error?: string }>(
      `/api/pro/browser-sessions/${encodeURIComponent(sessionId)}/actions`,
      body,
      { timeoutMs: 45_000, ...opts },
    ),
  closeBrowserPanelSession: (sessionId: string, opts?: ApiRequestOptions) =>
    json<{ ok: boolean; error?: string }>(
      `/api/pro/browser-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', ...opts },
    ),
  finishVerificationRun: (
    taskId: string,
    verificationRunId: string,
    result: VerificationResult,
    notes?: string,
    opts?: ApiRequestOptions,
  ) =>
    json<{ ok: boolean; task?: ProTask; error?: string }>(
      `/api/pro/tasks/${encodeURIComponent(taskId)}/verification-runs/${encodeURIComponent(verificationRunId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result, notes }),
        ...opts,
      },
    ),

  // Human-in-the-loop interaction (im_ask_user / Codex requestUserInput)
  /** Pick a predefined option as the answer to the current question. */
  interactionSelectOption: (
    promptId: string,
    value: string,
    requestFreeform?: boolean,
    opts?: ApiRequestOptions,
  ) =>
    post<{ ok: boolean; completed?: boolean; advanced?: boolean; error?: string }>(
      `/api/interaction/${encodeURIComponent(promptId)}/select`,
      { value, requestFreeform: !!requestFreeform },
      opts,
    ),
  /** Submit freeform text as the answer to the current question. */
  interactionSubmitText: (promptId: string, text: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; completed?: boolean; advanced?: boolean; error?: string }>(
      `/api/interaction/${encodeURIComponent(promptId)}/text`,
      { text },
      opts,
    ),
  /** Skip the current question (mark as answered with no value). */
  interactionSkip: (promptId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; completed?: boolean; advanced?: boolean; error?: string }>(
      `/api/interaction/${encodeURIComponent(promptId)}/skip`,
      {},
      opts,
    ),
  /** Cancel the prompt entirely — the agent receives an error. */
  interactionCancel: (promptId: string, opts?: ApiRequestOptions) =>
    post<{ ok: boolean; cancelled?: boolean; error?: string }>(
      `/api/interaction/${encodeURIComponent(promptId)}/cancel`,
      {},
      opts,
    ),
};

/** Snapshot of the latest streaming state for a session (returned by polling endpoint). */
export interface StreamSnapshot {
  phase: 'queued' | 'streaming' | 'done';
  taskId: string;
  prompt?: string;
  /** Number of live tasks ahead of this task when phase is queued. */
  queuePosition?: number;
  /** Wall-clock timestamp when the active task started streaming. */
  startedAt?: number;
  /** Wall-clock timestamp when the active task finished. */
  completedAt?: number;
  /** Task IDs queued behind the currently displayed one, in enqueue order. */
  queuedTaskIds?: string[];
  /** Per-queued-task prompt previews (same order as queuedTaskIds). */
  queuedTasks?: Array<{ taskId: string; prompt: string }>;
  text?: string;
  thinking?: string;
  activity?: string;
  activitySummary?: StreamActivitySummary | null;
  activityEvents?: StreamActivityEvents | null;
  plan?: StreamPlan | null;
  previewMeta?: StreamPreviewMeta | null;
  sessionId?: string | null;
  error?: string;
  /** Active human-in-the-loop interaction prompts (im_ask_user / Codex user-input). */
  interactions?: InteractionSnapshot[];
  updatedAt: number;
}
