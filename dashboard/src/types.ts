export type Agent = 'claude' | 'codex' | 'copilot' | 'cursor' | 'gemini' | 'hermes';
export type OpenTarget = 'vscode' | 'cursor' | 'windsurf' | 'finder' | 'default';

export interface AgentInfo {
  agent: Agent;
  label: string;
  installed: boolean;
  version?: string;
  installCommand?: string;
}

export interface ModelInfo {
  id: string;
  alias: string | null;
}

export interface UsageWindowInfo {
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
  resetAfterSeconds: number | null;
  status: string | null;
}

export interface UsageResult {
  ok: boolean;
  agent: Agent;
  source: string | null;
  capturedAt: string | null;
  status: string | null;
  windows: UsageWindowInfo[];
  error: string | null;
}

export interface ProUsageAgentSummary {
  agent: string;
  chatCount: number;
  sessionCount: number;
  sideChatCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  activeSeconds: number;
  lifetimeSeconds: number;
}

export interface ProUsageDaySummary {
  day: string;
  chatCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

export interface ProUsageChatSummary {
  sessionId: string;
  agent: string;
  workdir: string;
  title: string;
  isSideChat: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  activeSeconds: number;
  lifetimeSeconds: number;
}

export interface ProUsageTaskTimingSummary {
  taskId: string;
  title: string;
  jiraKey?: string;
  status: string;
  refinementStartedAt: string | null;
  resolvedAt: string | null;
  refinementToResolvedSeconds: number | null;
  userFocusCount: number;
  userFocusSeconds: number;
  agentSeconds: number;
  totalLifecycleSeconds: number | null;
}

export interface ProUsageSummary {
  generatedAt: string;
  scanned: {
    workspaceCount: number;
    chatCount: number;
    limit: number;
    truncated: boolean;
  };
  totals: ProUsageAgentSummary;
  byAgent: ProUsageAgentSummary[];
  byDay: ProUsageDaySummary[];
  topChats: ProUsageChatSummary[];
  taskTimings: {
    count: number;
    resolvedCount: number;
    averageRefinementToResolvedSeconds: number | null;
    userFocusSeconds: number;
    agentSeconds: number;
    totalLifecycleSeconds: number;
    tasks: ProUsageTaskTimingSummary[];
  };
  notes: string[];
}

/**
 * Read-only snapshot of an agent's *external* configuration (e.g. Hermes'
 * ~/.hermes/config.yaml). Pikiclaw never writes to the source — this is
 * surfaced only so the dashboard can display what an unbound agent will
 * actually run with.
 */
export interface AgentNativeConfig {
  model: string;
  provider: string;
  baseURL: string | null;
  effort: string | null;
  configPath: string;
  source: string;
}

export interface AgentRuntimeStatus extends AgentInfo {
  selectedModel: string | null;
  selectedEffort: string | null;
  /** Native-auth model/effort, independent of any active BYOK Profile.
   *  AgentTab uses these when the user toggles a card back to "Native"
   *  provider, so a previously-active BYOK model id doesn't leak in as the
   *  initial value of the native-mode model field. */
  nativeSelectedModel?: string | null;
  nativeSelectedEffort?: string | null;
  isDefault: boolean;
  models: ModelInfo[];
  usage: UsageResult | null;
  /** Driver-supplied snapshot of the agent's external config, when applicable. */
  nativeConfig?: AgentNativeConfig | null;
  /** Static driver capability flags, e.g. fork support. */
  capabilities?: { fork?: boolean; modelSwitch?: boolean };
  /** BYOK provider name (e.g. "OpenRouter") when this agent has a Profile
   *  bound; null otherwise. Drives the dashboard "via <provider>" tag on
   *  turns where the bound model id matches the saved turn's model. */
  byokProviderName?: string | null;
  /** Cached model list of the BYOK-bound provider (from `/models`). Surfaced
   *  separately from the native `models` field so AgentTab can still list the
   *  CLI's native catalogue when the user previews the "native" provider.
   *  InputComposer's cascade prefers this when `byokProviderName` is set. */
  byokModels?: { id: string; alias: string | null }[] | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  updateStatus?: string | null;
  updateDetail?: string | null;
}

export interface AgentStatusResponse {
  defaultAgent: Agent;
  workdir: string;
  agents: AgentRuntimeStatus[];
}

export type ChannelStatus = 'ready' | 'missing' | 'invalid' | 'error' | 'checking';

export interface ChannelSetupState {
  channel: 'telegram' | 'feishu' | 'weixin' | 'slack' | 'discord' | 'dingtalk' | 'wecom';
  configured: boolean;
  ready: boolean;
  validated: boolean;
  status: ChannelStatus;
  detail: string;
}

export interface SetupState {
  agents: AgentInfo[];
  channel: string;
  tokenProvided: boolean;
  channels?: ChannelSetupState[];
}

export interface PermissionStatus {
  granted: boolean;
  checkable: boolean;
  detail: string;
}

export type PermissionRequestAction = 'already_granted' | 'prompted' | 'opened_settings' | 'unsupported';

export interface PermissionRequestResult {
  ok: boolean;
  action: PermissionRequestAction;
  granted: boolean;
  requiresManualGrant: boolean;
  error?: string;
}

export interface BotStatus {
  workdir: string;
  defaultAgent: Agent;
  uptime: number;
  connected: boolean;
  stats: {
    totalTurns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens?: number;
  };
  activeTasks: number;
  sessions: number;
}

export interface UserConfig {
  defaultAgent?: Agent;
  claudeModel?: string;
  claudeReasoningEffort?: string;
  codexModel?: string;
  codexReasoningEffort?: string;
  copilotModel?: string;
  copilotReasoningEffort?: string;
  cursorModel?: string;
  cursorReasoningEffort?: string;
  geminiModel?: string;
  geminiReasoningEffort?: string;
  hermesModel?: string;
  hermesReasoningEffort?: string;
  workdir?: string;
  telegramBotToken?: string;
  telegramAllowedChatIds?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  weixinBaseUrl?: string;
  weixinBotToken?: string;
  weixinAccountId?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  discordBotToken?: string;
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  wecomBotId?: string;
  wecomBotSecret?: string;
  wecomEndpoint?: string;
  channels?: string[];
  browserEnabled?: boolean;
  browserHeadless?: boolean;
}

export interface WeixinValidationResult {
  ok: boolean;
  error?: string | null;
  normalizedBaseUrl?: string;
  account?: {
    accountId: string;
    baseUrl: string;
  } | null;
}

export interface WeixinLoginStartResult {
  ok: boolean;
  sessionKey: string;
  qrcodeUrl?: string;
  message: string;
  error?: string;
}

export interface WeixinLoginWaitResult {
  ok: boolean;
  connected: boolean;
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'error';
  message: string;
  qrcodeUrl?: string;
  botToken?: string;
  accountId?: string;
  userId?: string;
  baseUrl?: string;
  error?: string;
}

export interface AppState {
  version: string;
  ready: boolean;
  configExists: boolean;
  config: UserConfig;
  runtimeWorkdir: string;
  setupState: SetupState | null;
  permissions: Record<string, PermissionStatus>;
  hostApp?: string | null;
  platform: string;
  pid: number;
  nodeVersion?: string;
  bot: BotStatus | null;
}

export interface HostInfo {
  hostName: string;
  cpuModel: string;
  cpuCount: number;
  totalMem: number;
  freeMem: number;
  memoryUsed?: number;
  memoryPercent?: number;
  platform: string;
  arch: string;
  cpuUsage?: { usedPercent: number };
  loadAverage?: { one: number; five: number; fifteen: number } | null;
  disk?: { used: string; total: string; percent: string };
  battery?: { percent: string; state: string };
}

// ---------------------------------------------------------------------------
// Local model backends (Ollama / mlx-lm)
// ---------------------------------------------------------------------------

export type LocalBackendId = 'ollama' | 'mlx';
export type LocalBackendOs = 'darwin' | 'linux' | 'win';

export interface LocalBackendInstallCommand {
  label?: string;
  cmd: string;
}

export interface LocalBackendInstallSpec {
  darwin?: LocalBackendInstallCommand[];
  linux?: LocalBackendInstallCommand[];
  win?: LocalBackendInstallCommand[];
  docs?: string;
}

export interface LocalBackendStatus {
  id: LocalBackendId;
  label: string;
  detected: boolean;
  version?: string;
  baseURL: string;
  openAIBaseURL: string;
  models: Array<{ id: string; sizeBytes?: number }>;
  /** Provider id (in the BYOK layer) already pointing at this backend, if any. */
  existingProviderId: string | null;
  homepage: string;
  install: LocalBackendInstallSpec;
  /** How to start the server after install. */
  runHint: LocalBackendInstallCommand;
  /** Template for "pull/load a model". `${model}` is substituted client-side. */
  pullCommandTemplate: string;
  /** False when the current OS isn't in the backend's supported set (e.g. mlx on Linux). */
  supportedOnThisOs: boolean;
}

export interface LocalModelCatalogEntry {
  id: string;
  name: string;
  publisher: string;
  paramsB: number;
  sizeGb: number;
  minRamGb: number;
  description: string;
  descriptionZh: string;
  ollamaTag?: string;
  mlxModel?: string;
  homepage?: string;
  installed: { backend: LocalBackendId; id: string } | null;
}

export interface LocalModelsProbeResponse {
  ok: boolean;
  backends?: LocalBackendStatus[];
  catalog?: LocalModelCatalogEntry[];
  currentOs?: LocalBackendOs;
  /** Provider ids that were created during this probe (auto-attach result).
   *  When non-empty the dashboard should refetch the upper Model Providers
   *  / agent state so the new local provider appears immediately. */
  addedProviderIds?: string[];
  error?: string;
}

/**
 * Single selectable option in a human-in-the-loop interaction question.
 * Mirrors AgentInteractionOption from the server.
 */
export interface InteractionOption {
  label: string;
  description?: string | null;
  value: string;
}

/** A single question presented in a human-in-the-loop interaction prompt. */
export interface InteractionQuestion {
  id: string;
  header: string;
  prompt: string;
  options?: InteractionOption[] | null;
  allowFreeform?: boolean;
  secret?: boolean;
  allowEmpty?: boolean;
}

/**
 * Serialisable snapshot of an active human-in-the-loop prompt. Mirrors the
 * server's InteractionSnapshot — surfaces in session stream snapshots so the
 * dashboard can render the matching popup.
 */
export interface InteractionSnapshot {
  promptId: string;
  kind: 'user-input' | 'permission' | 'confirmation';
  title: string;
  hint?: string | null;
  questions: InteractionQuestion[];
  /** 0-based index of the question currently awaiting an answer. Used by the
   *  client to render the active question on initial load / reconnect. */
  currentIndex?: number;
}

export interface SessionInfo {
  sessionId: string;
  title?: string;
  titleSource?: 'prompt' | 'agent' | 'user' | null;
  createdAt?: string;
  origin?: SessionOrigin | null;
  running?: boolean;
  isCurrent?: boolean;
  model?: string;
  thinkingEffort?: string | null;
  workdir?: string;
  runState: 'running' | 'completed' | 'incomplete';
  runDetail?: string | null;
  runUpdatedAt?: string | null;
  runStartedAt?: string | null;
  agent?: string;
  lastQuestion?: string | null;
  lastAnswer?: string | null;
  lastMessageText?: string | null;
  classification?: {
    outcome: 'answer' | 'proposal' | 'implementation' | 'partial' | 'blocked' | 'conversation';
    summary: string;
    suggestedNextAction?: string | null;
    classifiedAt?: string;
  } | null;
  userStatus?: 'inbox' | 'active' | 'review' | 'done' | 'parked' | null;
  userNote?: string | null;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: string | null;
  workspacePath?: string | null;
  migratedFrom?: SessionLineageRef | null;
  migratedTo?: SessionLineageRef | null;
  linkedSessions?: SessionLineageRef[];
  sideChatOf?: SessionSideChatParentRef | null;
  sideChats?: SessionSideChatRef[];
  numTurns?: number | null;
}

export interface SessionOrigin {
  channel: string;
  chatId: string;
  chatType?: string | null;
  sourceMessageId?: string | null;
  userId?: string | null;
  openId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reference to a related session (migration twin or fork child/parent). */
export interface SessionLineageRef {
  agent: Agent;
  sessionId: string;
  /** 'fork' = branch off at a turn, 'migrate' = cross-agent twin (default). */
  kind?: 'migrate' | 'fork';
  /** 0-based turn index where the fork occurred (set on `migratedFrom` only). */
  forkedAtTurn?: number;
}

export interface SessionSideChatParentRef {
  agent: Agent | string;
  sessionId: string;
}

export interface SessionSideChatRef {
  agent: Agent | string;
  sessionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  userStatus?: 'inbox' | 'active' | 'review' | 'done' | 'parked' | null;
  hidden?: boolean;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
}

export interface SessionHubResult {
  ok: boolean;
  workdir: string;
  workspaceName: string;
  sessions: SessionInfo[];
  statusCounts: Record<string, number>;
  total: number;
  errors: string[];
}

export interface SessionsPageResult {
  ok: boolean;
  sessions: SessionInfo[];
  error: string | null;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface SessionTailMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface MessageBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | 'plan' | 'sub_agent' | 'system_notice';
  content: string;
  toolName?: string;
  toolId?: string;
  phase?: 'commentary' | 'final_answer';
  plan?: StreamPlan | null;
  subAgent?: StreamSubAgent | null;
  /** Image block: authoritative on-disk path (server-side, opaque to client). */
  imagePath?: string;
  /** Image block: MIME type. */
  imageMime?: string;
  /** Image block: optional caption (e.g. Codex `revised_prompt`). */
  imageCaption?: string;
}

export interface RichMessage {
  role: 'user' | 'assistant';
  text: string;
  blocks: MessageBlock[];
  /** Best-effort wall-clock timestamp for this message, when available. */
  createdAt?: string | null;
  /** Per-turn token usage snapshot for assistant messages. Null when the
   *  driver does not surface per-message usage (Codex, Gemini). */
  usage?: StreamPreviewMeta | null;
}

export interface StreamPlanStep {
  step: string;
  status: 'pending' | 'inProgress' | 'completed';
}

export interface StreamPlan {
  explanation: string | null;
  steps: StreamPlanStep[];
}

export interface StreamPreviewMeta {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  /** Single-call context window occupancy. Use this for "% of context used"
   *  displays — the cumulative inputTokens/cachedInputTokens fields above
   *  double-count the same cached prefix on every tool roundtrip. */
  contextUsedTokens?: number | null;
  contextPercent: number | null;
  subAgents?: StreamSubAgent[];
  /** BYOK provider name (e.g. "OpenRouter") when the agent is bound to a
   *  Profile; absent for native-auth turns. Drives the "via <provider>" tag. */
  providerName?: string | null;
  /** Last driver/runtime event observed for this turn. */
  lastEvent?: string | null;
  /** Non-fatal agent/runtime diagnostics surfaced during the live turn. */
  diagnostics?: string[];
  /** Number of image-generation calls currently in flight for this turn.
   *  Renderers show a "Generating image…" indicator while > 0. */
  generatingImages?: number;
}

export type StreamActivityKind = 'file' | 'search' | 'command' | 'tool';

export interface StreamActivityCurrent {
  kind: StreamActivityKind;
  label: string;
}

export interface StreamActivitySummary {
  files: number;
  searches: number;
  commands: number;
  tools: number;
  current?: StreamActivityCurrent | null;
}

export interface StreamActivityEvent {
  kind: StreamActivityKind;
  label: string;
  action?: string | null;
  target?: string | null;
}

export interface StreamActivityEvents {
  files: StreamActivityEvent[];
  searches: StreamActivityEvent[];
  commands: StreamActivityEvent[];
  tools: StreamActivityEvent[];
}

export interface StreamSubAgent {
  id: string;
  kind: string | null;
  description: string | null;
  model: string | null;
  tools: Array<{ id: string; name: string; summary: string }>;
  status: 'running' | 'done' | 'failed';
}

export interface SessionMessagesWindow {
  offset: number;
  limit: number;
  returnedTurns: number;
  totalTurns: number;
  hasOlder: boolean;
  hasNewer: boolean;
  startTurn: number;
  endTurn: number;
}

export interface SessionMessagesResult {
  ok: boolean;
  messages: SessionMessage[];
  richMessages?: RichMessage[];
  totalTurns?: number;
  window?: SessionMessagesWindow;
  error: string | null;
}

export type BrowserProfileStatus = 'disabled' | 'ready' | 'needs_setup' | 'chrome_missing';

export interface BrowserStatus {
  status: BrowserProfileStatus;
  enabled: boolean;
  headlessMode: 'headless' | 'headed';
  chromeInstalled: boolean;
  profileCreated: boolean;
  running: boolean;
  pid: number | null;
  profileDir: string;
  detail?: string | null;
}

export interface BrowserStatusResponse {
  browser: BrowserStatus;
}

export interface BrowserSetupResponse {
  ok: boolean;
  browser: BrowserStatus;
  error?: string;
}

export interface SkillInfo {
  name: string;
  label: string | null;
  description: string | null;
  scope?: 'global' | 'project';
  mcpRequires?: string[];
}

export interface PlatformSkillInfo {
  id: string;
  trigger: string;
  name: string;
  description: string;
  category: 'observability' | 'dev' | 'productivity';
  status: 'ready' | 'experimental';
  examples: string[];
}

// ---------------------------------------------------------------------------
// MCP Extensions
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  disabled?: boolean;
  catalogId?: string;
}

export interface McpExtensionEntry {
  name: string;
  config: McpServerConfig;
  scope: 'global' | 'workspace' | 'builtin';
  source?: string;
}

export interface McpHealthResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  elapsedMs?: number;
  cached?: boolean;
}

export type McpCatalogState = 'recommended' | 'needs_auth' | 'disabled' | 'ready' | 'unhealthy';

export interface McpCredentialField {
  key: string;
  label: string;
  labelZh: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  helpUrl?: string;
}

export type McpAuthSpec =
  | { type: 'none' }
  | { type: 'credentials'; fields: McpCredentialField[] }
  | {
      type: 'mcp-oauth';
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      registrationEndpoint?: string;
      clientId?: string;
      scopes?: string[];
    };

export type RecommendedScope = 'global' | 'workspace' | 'both';

export interface McpCatalogItem {
  id: string;
  name: string;
  description: string;
  descriptionZh: string;
  category: 'dev' | 'productivity' | 'communication' | 'data' | 'search' | 'utility' | 'custom';
  iconSlug?: string;
  iconUrl?: string;
  homepage?: string;
  transport: { type: 'stdio' | 'http'; summary: string; url?: string };
  auth: McpAuthSpec;
  state: McpCatalogState;
  isRecommended: boolean;
  installed: boolean;
  scope?: 'global' | 'workspace' | 'builtin';
  config?: McpServerConfig;
  installedKey?: string;
  recommendedScope?: RecommendedScope;
  isBuiltin?: boolean;
}

export interface RecommendedSkillRepo {
  id: string;
  name: string;
  description: string;
  descriptionZh: string;
  source: string;
  skills?: string[];
  category?: string;
  homepage?: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  descriptionZh: string;
  source: string;
  category: string;
  recommendedScope?: RecommendedScope;
  homepage?: string;
  installed: boolean;
  scope?: 'global' | 'project';
  installedNames: string[];
  stars?: number;
  pushedAt?: string;
  iconUrl?: string;
  totalCount?: number;
  partial?: boolean;
}

export interface RemoteSkillInfo {
  name: string;
  description?: string;
  path: string;
}

export interface McpSearchResult {
  name: string;
  description: string;
  npmPackage?: string;
  source?: string;
}

export interface GitChange {
  status: 'added' | 'modified' | 'deleted';
  file: string;
  path: string;
}

export interface GitChangesResult {
  ok: boolean;
  changes: GitChange[];
  isGit: boolean;
  error?: string;
}

export interface GitRemoteBranchUrlResult {
  ok: boolean;
  url?: string;
  remote?: string;
  branch?: string;
  error?: string;
}

export interface FileContentResult {
  ok: boolean;
  path?: string;
  relativePath?: string;
  content?: string;
  size?: number;
  tooLarge?: boolean;
  binary?: boolean;
  error?: string;
}

export interface GitDiffContentResult {
  ok: boolean;
  path?: string;
  relativePath?: string;
  content?: string;
  size?: number;
  truncated?: boolean;
  isGit?: boolean;
  error?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir?: boolean;
}

export interface LsDirResult {
  ok: boolean;
  path: string;
  parent: string;
  dirs: DirEntry[];
  isGit: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// CLI Extensions
// ---------------------------------------------------------------------------

export type CliCategory = 'dev' | 'cloud' | 'data' | 'commerce' | 'social' | 'content';
export type CliState = 'not_installed' | 'installed_not_auth' | 'ready' | 'unknown';
export type CliAuthType = 'oauth-web' | 'token' | 'none';

export interface CliInstallCommand {
  cmd: string;
  label?: string;
}

export interface CliInstallSpec {
  darwin?: CliInstallCommand[];
  linux?: CliInstallCommand[];
  win?: CliInstallCommand[];
  docs?: string;
}

export interface CliAuthSpec {
  type: CliAuthType;
  statusArgv?: string[];
  /** statusArgv stdout must match this pattern for the CLI to be considered authed. */
  statusReadyPattern?: string;
  loginArgv?: string[];
  logoutArgv?: string[];
  tokenFields?: McpCredentialField[];
  applyTokenArgv?: string[];
  envKey?: string;
  loginHint?: string;
  loginHintZh?: string;
  /** When set, the dashboard surfaces these as copyable commands instead of spawning loginArgv. */
  manualLoginCommands?: { label?: string; cmd: string }[];
}

export interface CliCatalogItem {
  id: string;
  binary: string;
  name: string;
  description: string;
  descriptionZh: string;
  category: CliCategory;
  iconSlug?: string;
  iconUrl?: string;
  homepage?: string;
  install: CliInstallSpec;
  auth: CliAuthSpec;
  state: CliState;
  version?: string;
  authDetail?: string;
  platform: 'darwin' | 'linux' | 'win';
  /** Present when the CLI has an npm-only install command that's safe to auto-run. */
  autoInstall?: { label: string };
}

export interface CliStatus {
  id: string;
  binary: string;
  state: CliState;
  version?: string;
  authDetail?: string;
  error?: string;
  checkedAt: number;
}

export type CliAuthStreamEvent =
  | { type: 'output'; chunk: string }
  | { type: 'status'; status: CliStatus }
  | { type: 'error'; message: string }
  | { type: 'done'; ok: boolean; exitCode: number | null };

// ---------------------------------------------------------------------------
// Pikiclaw Pro task workflow
// ---------------------------------------------------------------------------

export type ProTaskKind = 'manual' | 'todo' | 'jira-ticket' | 'jira-bug' | 'jira-epic' | 'automation';
export type ProTaskStatus = 'backlog' | 'refinement' | 'coding' | 'resolved' | 'done';
export type ProTaskStage = 'refinement' | 'focus' | 'coding' | 'verification' | 'demo' | 'bugfix' | 'knowledge';
export type ProSubtaskStatus = 'todo' | 'running' | 'review' | 'done' | 'blocked';
export type ProStageRunStatus = 'queued' | 'running' | 'waiting-user' | 'completed' | 'failed' | 'cancelled';
export type VerificationResult = 'passed' | 'failed' | 'blocked' | 'not-run';

export interface TaskEstimate {
  estimatePoint?: number;
  codingMinutes?: number;
  userUnderstandingMinutes?: number;
  reviewMinutes?: number;
  verificationMinutes?: number;
  totalMinutes?: number;
  confidence?: 'low' | 'medium' | 'high';
  assumptions?: string[];
}

export interface StageSessionRef {
  workdir: string;
  agent: string;
  sessionId: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  kind: 'goal' | 'scope' | 'constraint' | 'risk' | 'acceptance' | 'plan' | 'question';
  parentId?: string;
  status?: 'open' | 'confirmed' | 'risk' | 'done';
}

export interface FocusQuestion {
  id: string;
  topic: 'goal' | 'boundary' | 'acceptance' | 'risk' | 'dependency' | 'estimate';
  question: string;
  answer?: string;
  status: 'open' | 'answered' | 'skipped';
}

export interface FocusSessionState {
  mindMap: MindMapNode[];
  questions: FocusQuestion[];
  confirmed?: boolean;
}

export interface VerificationRun {
  id: string;
  taskId: string;
  stageRunId?: string;
  environment: string;
  pipeline?: {
    provider?: 'gitlab' | 'github' | 'jenkins' | 'manual';
    pipelineId?: string;
    url?: string;
    status?: 'unknown' | 'running' | 'success' | 'failed';
    commit?: string;
    branch?: string;
  };
  browserSession?: {
    url: string;
    profile: 'pikiclaw-managed';
    loginStatus?: 'auto-login-ok' | 'manual-required' | 'failed';
  };
  result?: VerificationResult;
  notes?: string;
  startedAt: string;
  completedAt?: string;
}

export interface StageRun {
  id: string;
  taskId: string;
  stage: ProTaskStage;
  status: ProStageRunStatus;
  assistantId?: string;
  selectedAgent?: string;
  selectedAgentReason?: string;
  session: StageSessionRef;
  prompt: string;
  startedAt?: string;
  completedAt?: string;
  focus?: FocusSessionState;
  verificationRunId?: string;
  output?: {
    summary?: string;
    estimate?: TaskEstimate;
    branch?: string;
    diffSummary?: string;
    changedFiles?: string[];
    testResultId?: string;
    knowledgeRefs?: string[];
  };
}

export interface ProTaskEvent {
  id: string;
  taskId: string;
  type: string;
  createdAt: string;
  actor: 'user' | 'system' | 'assistant';
  summary: string;
  diff?: unknown;
}

export interface ProSubtask {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  status: ProSubtaskStatus;
  assignedAgent?: string;
  assistantId?: string;
  workdir?: string;
  createdAt: string;
  updatedAt: string;
  stageRunIds: string[];
}

export interface ProTask {
  id: string;
  title: string;
  description?: string;
  kind: ProTaskKind;
  status: ProTaskStatus;
  workdir?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  execution?: {
    ownerMode?: 'status' | 'agent' | 'assistant';
    agent?: string;
    assistantId?: string;
    mode?: 'direct' | 'interactive';
  };
  jiraKey?: string;
  jiraUrl?: string;
  jiraFields?: {
    reporter?: string;
    assignee?: string;
    status?: string;
    dueDate?: string;
    priority?: string;
    labels?: string[];
    issueType?: string;
    updatedAt?: string;
    raw?: Record<string, unknown>;
  };
  sprint?: string;
  createdAt: string;
  updatedAt: string;
  stageRuns: StageRun[];
  verificationRuns: VerificationRun[];
  subTasks: ProSubtask[];
  focusSessions?: Array<{
    id: string;
    taskId: string;
    openedAt: string;
    closedAt?: string;
    durationSeconds?: number;
  }>;
  exclusiveMode?: boolean;
  events: ProTaskEvent[];
}

export type TodoItemKind = 'todo' | 'review-comment';
export type TodoItemStatus = 'open' | 'chat-created' | 'done' | 'archived';

export interface TodoItemSource {
  type: 'quick-capture' | 'chat-selection' | 'review-comment';
  workdir?: string;
  agent?: string;
  sessionId?: string;
  turnIndex?: number;
  quote?: string;
}

export interface TodoItem {
  id: string;
  kind: TodoItemKind;
  title: string;
  body?: string;
  status: TodoItemStatus;
  createdAt: string;
  updatedAt: string;
  source?: TodoItemSource;
  linkedChat?: {
    workdir: string;
    agent: string;
    sessionId: string;
  };
}

export interface AgentAssistant {
  id: string;
  name: string;
  responsibility: string;
  preferredAgents: string[];
  avatarSeed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JiraWorkflowConfig {
  executionOwnerMode?: 'status' | 'agent' | 'assistant';
  lifecycleAgent?: string;
  lifecycleAssistantId?: string;
  executionMode?: 'direct' | 'interactive';
  refinementAssistantId?: string;
  codingAssistantId?: string;
  ticketSyncAssistantId?: string;
  knowledgeAssistantId?: string;
  runKnowledgeOnRefinement?: boolean;
  runKnowledgeOnCoding?: boolean;
  statusWorkflows?: Partial<Record<ProTaskStatus, {
    instruction?: string;
    assistantId?: string;
    modelPool?: string[];
  }>>;
}

export interface AutomationRule {
  id: string;
  key?: string;
  name: string;
  schedule: string;
  prompt: string;
  workdir?: string;
  agent?: string;
  assistantId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastSessionKey?: string;
  runHistory?: Array<{
    id: string;
    ranAt: string;
    sessionKey?: string;
    status: 'queued' | 'failed';
  }>;
}

export interface JiraSyncRunEvent {
  id: string;
  at: string;
  label: string;
  detail?: string;
}

export interface JiraSyncRun {
  id: string;
  status: 'starting' | 'queued' | 'syncing' | 'completed' | 'failed';
  assistantId?: string;
  assistantName?: string;
  agent?: string;
  workdir?: string;
  sessionKey?: string;
  ticketCount?: number;
  taskCount?: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  events: JiraSyncRunEvent[];
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  source?: {
    type: 'manual' | 'chat' | 'task';
    workdir?: string;
    agent?: string;
    sessionId?: string;
    taskId?: string;
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
