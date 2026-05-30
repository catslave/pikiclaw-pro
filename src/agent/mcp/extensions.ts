/**
 * MCP extension management — CRUD, catalog merge, health check, session merge.
 *
 * Global extensions live in ~/.pikiclaw/setting.json under extensions.mcp.
 * Workspace extensions live in <workdir>/.mcp.json (standard format).
 *
 * getCatalogItems() produces the unified list the dashboard renders:
 * recommended-registry entries merged with installed entries, with a single
 * state field per item (recommended | needs_auth | disabled | ready | unhealthy).
 *
 * mergeExtensionsForSession() is called by bridge.ts before spawning an agent —
 * it resolves disabled flags, expands OAuth Bearer headers from the token store,
 * and hands the final config map to the agent CLI.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadUserConfig, saveUserConfig } from '../../core/config/user-config.js';
import type { McpServerConfig } from '../../core/config/user-config.js';
import {
  getRecommendedMcpServers,
  type RecommendedMcpServer,
  type McpAuthSpec,
  type McpCategory,
  type RecommendedScope,
} from './registry.js';
import { hasValidMcpToken, injectOAuthHeaders } from './oauth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtensionScope = 'global' | 'workspace' | 'builtin';

export interface McpExtensionEntry {
  name: string;
  config: McpServerConfig;
  scope: ExtensionScope;
  /** Source file path (setting.json or .mcp.json). */
  source?: string;
}

export interface McpHealthResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  elapsedMs?: number;
}

export type McpCatalogState =
  | 'recommended'   // Not installed yet — show install/authorize CTA
  | 'needs_auth'    // Installed but missing credentials or OAuth token
  | 'disabled'      // Installed but turned off
  | 'ready'         // Installed, authorized, enabled
  | 'unhealthy';    // Installed+enabled but last health check failed

export interface McpCatalogItem {
  id: string;                       // catalogId if from registry, else installed name
  name: string;                     // Display name
  description: string;
  descriptionZh: string;
  category: McpCategory | 'custom';
  iconSlug?: string;
  iconUrl?: string;
  homepage?: string;
  transport: { type: 'stdio' | 'http'; summary: string; url?: string };
  auth: McpAuthSpec;
  state: McpCatalogState;
  /** True when this item comes from the recommended registry. */
  isRecommended: boolean;
  /** True when the item is in the user's config (global or workspace). */
  installed: boolean;
  /** Scope of installed entry; undefined when not installed. */
  scope?: ExtensionScope;
  /** Raw config if installed. */
  config?: McpServerConfig;
  /** Installed key (may differ from id for custom entries — custom uses name as key). */
  installedKey?: string;
  /** Intended scope from the recommended registry (undefined for custom). */
  recommendedScope?: RecommendedScope;
  /**
   * Builtin entries surface alongside catalog items but are managed by pikiclaw
   * (state derived from a config flag, no `extensions.mcp` storage). Rendered
   * in a dedicated "Built-in" section at the top of the catalog UI.
   */
  isBuiltin?: boolean;
}

interface RegisteredMcpServer {
  name: string;
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Global extensions (setting.json)
// ---------------------------------------------------------------------------

export function loadGlobalMcpExtensions(): McpExtensionEntry[] {
  const config = loadUserConfig();
  const mcp = config.extensions?.mcp;
  if (!mcp || typeof mcp !== 'object') return [];
  return Object.entries(mcp).map(([name, cfg]) => ({
    name,
    config: cfg,
    scope: 'global' as const,
  }));
}

export function addGlobalMcpExtension(name: string, config: McpServerConfig): void {
  const userConfig = loadUserConfig();
  const extensions = userConfig.extensions ?? {};
  const mcp = { ...(extensions.mcp ?? {}) };
  mcp[name] = config;
  saveUserConfig({ ...userConfig, extensions: { ...extensions, mcp } });
}

export function removeGlobalMcpExtension(name: string): boolean {
  const userConfig = loadUserConfig();
  const mcp = { ...(userConfig.extensions?.mcp ?? {}) };
  if (!(name in mcp)) return false;
  delete mcp[name];
  saveUserConfig({
    ...userConfig,
    extensions: { ...userConfig.extensions, mcp },
  });
  return true;
}

export function updateGlobalMcpExtension(name: string, patch: Partial<McpServerConfig>): boolean {
  const userConfig = loadUserConfig();
  const mcp = { ...(userConfig.extensions?.mcp ?? {}) };
  if (!(name in mcp)) return false;
  mcp[name] = { ...mcp[name], ...patch };
  saveUserConfig({
    ...userConfig,
    extensions: { ...userConfig.extensions, mcp },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Workspace extensions (.mcp.json)
// ---------------------------------------------------------------------------

function workspaceMcpJsonPath(workdir: string): string {
  return path.join(workdir, '.mcp.json');
}

function readMcpJson(filePath: string): Record<string, McpServerConfig> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const servers = parsed?.mcpServers ?? parsed;
    if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
      return servers as Record<string, McpServerConfig>;
    }
  } catch { /* not found or invalid */ }
  return {};
}

function writeMcpJson(filePath: string, servers: Record<string, McpServerConfig>): void {
  const content = JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function loadWorkspaceMcpExtensions(workdir: string): McpExtensionEntry[] {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    config: cfg,
    scope: 'workspace' as const,
    source: mcpPath,
  }));
}

export function addWorkspaceMcpExtension(workdir: string, name: string, config: McpServerConfig): void {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  servers[name] = config;
  writeMcpJson(mcpPath, servers);
}

export function removeWorkspaceMcpExtension(workdir: string, name: string): boolean {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  if (!(name in servers)) return false;
  delete servers[name];
  writeMcpJson(mcpPath, servers);
  return true;
}

export function updateWorkspaceMcpExtension(workdir: string, name: string, patch: Partial<McpServerConfig>): boolean {
  const mcpPath = workspaceMcpJsonPath(workdir);
  const servers = readMcpJson(mcpPath);
  if (!(name in servers)) return false;
  servers[name] = { ...servers[name], ...patch };
  writeMcpJson(mcpPath, servers);
  return true;
}

// ---------------------------------------------------------------------------
// Unified listing
// ---------------------------------------------------------------------------

export function listAllMcpExtensions(workdir?: string): McpExtensionEntry[] {
  const global = loadGlobalMcpExtensions();
  const workspace = workdir ? loadWorkspaceMcpExtensions(workdir) : [];
  const claudeMcp: McpExtensionEntry[] = [];
  if (workdir) {
    const claudePath = path.join(workdir, '.claude', '.mcp.json');
    const servers = readMcpJson(claudePath);
    for (const [name, cfg] of Object.entries(servers)) {
      claudeMcp.push({ name, config: cfg, scope: 'workspace', source: claudePath });
    }
  }
  return [...global, ...workspace, ...claudeMcp];
}

// ---------------------------------------------------------------------------
// Catalog — merged recommended + installed with state computation
// ---------------------------------------------------------------------------

function cmdSummary(config: McpServerConfig): string {
  if (config.type === 'http' && config.url) return config.url;
  const cmd = config.command || '';
  const args = (config.args || []).filter(a => a !== '-y');
  return [cmd, ...args].join(' ').trim();
}

/**
 * Generic @modelcontextprotocol/server-* demos that historically shipped in the
 * recommended list but were later removed (no product identity, overlap with
 * built-in agent capabilities like search/time). We hide them from the catalog
 * UI so old installs don't clutter the Connected section. The configs are kept
 * in setting.json untouched — users can still edit by hand if they want.
 */
const HIDDEN_GENERIC_DEMO_PACKAGES = new Set([
  '@modelcontextprotocol/server-time',
  '@modelcontextprotocol/server-fetch',
  '@modelcontextprotocol/server-memory',
  'mcp-server-time',
  'mcp-server-fetch',
  'mcp-server-memory',
]);
const HIDDEN_GENERIC_DEMO_NAMES = new Set(['time', 'fetch', 'memory']);

function isGenericDemoEntry(entry: McpExtensionEntry): boolean {
  if (HIDDEN_GENERIC_DEMO_NAMES.has(entry.name.toLowerCase())) return true;
  const args = entry.config.args || [];
  return args.some(a => HIDDEN_GENERIC_DEMO_PACKAGES.has(a));
}

function inferCustomMcpIconSlug(entry: McpExtensionEntry): string | undefined {
  const text = [
    entry.name,
    entry.config.type,
    entry.config.command,
    ...(entry.config.args || []),
    entry.config.type === 'http' ? entry.config.url : '',
  ].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('clickhouse')) return 'clickhouse';
  if (text.includes('postgres') || text.includes('postgresql')) return 'postgres';
  if (text.includes('sqlite')) return 'sqlite';
  if (text.includes('github')) return 'github';
  if (text.includes('gitlab')) return 'gitlab';
  if (text.includes('jira') || text.includes('atlassian') || text.includes('confluence')) return 'atlassian';
  return undefined;
}

function transportSummary(transport: RecommendedMcpServer['transport']): string {
  if (transport.type === 'http') return transport.url;
  return [transport.command, ...transport.args.filter(a => a !== '-y')].join(' ');
}

function hasRequiredCredentials(config: McpServerConfig, auth: McpAuthSpec): boolean {
  if (auth.type !== 'credentials') return true;
  const bag = { ...(config.env || {}), ...(config.headers || {}) };
  for (const field of auth.fields) {
    if (!field.required) continue;
    if (field.key === 'MCP_URL') {
      if (!String(config.url || '').trim()) return false;
      continue;
    }
    if (field.key === 'MCP_TOKEN') {
      const token = String(bag.MCP_TOKEN || '').trim();
      const authHeader = String(bag.Authorization || '').trim();
      if (!token && !authHeader) return false;
      continue;
    }
    if (!bag[field.key] || !String(bag[field.key]).trim()) return false;
  }
  return true;
}

function computeStateForInstalled(
  config: McpServerConfig,
  auth: McpAuthSpec,
  id: string,
  unhealthyIds?: Set<string>,
): McpCatalogState {
  if (config.enabled === false || config.disabled === true) return 'disabled';
  if (auth.type === 'credentials' && !hasRequiredCredentials(config, auth)) return 'needs_auth';
  if (auth.type === 'mcp-oauth' && !hasValidMcpToken(id)) return 'needs_auth';
  if (unhealthyIds?.has(id)) return 'unhealthy';
  return 'ready';
}

/**
 * Produce the unified catalog for the dashboard: every recommended registry
 * entry, plus any custom installed entries the user added, each with a
 * computed state field.
 *
 * When `scope` is provided, recommended entries are filtered to those whose
 * `recommendedScope` matches (or is `'both'`). Custom entries are filtered
 * by where they are installed — `scope: 'global'` excludes workspace entries
 * and vice versa.
 */
export function getCatalogItems(opts: {
  workdir?: string;
  unhealthyIds?: Set<string>;
  scope?: RecommendedScope;
} = {}): McpCatalogItem[] {
  const recommended = getRecommendedMcpServers();
  const installed: McpExtensionEntry[] = [
    ...loadGlobalMcpExtensions(),
    ...(opts.workdir ? loadWorkspaceMcpExtensions(opts.workdir) : []),
  ];

  // Build lookup: catalogId -> installed entry (preferring global).
  const installedByCatalogId = new Map<string, McpExtensionEntry>();
  const customEntries: McpExtensionEntry[] = [];

  for (const entry of installed) {
    const catalogId = entry.config.catalogId;
    if (catalogId && recommended.some(r => r.id === catalogId)) {
      if (!installedByCatalogId.has(catalogId)) installedByCatalogId.set(catalogId, entry);
    } else {
      customEntries.push(entry);
    }
  }

  const scopeMatchesRec = (rec: RecommendedMcpServer): boolean => {
    if (!opts.scope) return true;
    return rec.recommendedScope === opts.scope || rec.recommendedScope === 'both';
  };

  const scopeMatchesEntry = (entry: McpExtensionEntry): boolean => {
    if (!opts.scope) return true;
    if (opts.scope === 'both') return true;
    return entry.scope === opts.scope;
  };

  const items: McpCatalogItem[] = [];
  // Builtin items derive their installed/state from a top-level config flag
  // rather than `extensions.mcp`. Each catalogId maps to one flag — extend the
  // switch when adding a new builtin.
  const userConfig = loadUserConfig();
  const builtinInstalled = (catalogId: string): boolean => {
    if (catalogId === 'pikiclaw-browser') return userConfig.browserEnabled === true;
    if (catalogId === 'computer-use' || catalogId === 'peekaboo') {
      return userConfig.computerUseEnabled === true || userConfig.peekabooEnabled === true;
    }
    return false;
  };

  // 1. Registry entries — preserve registry ordering.
  for (const rec of recommended) {
    if (!scopeMatchesRec(rec)) continue;
    const entry = installedByCatalogId.get(rec.id);
    let state: McpCatalogState;
    let installed: boolean;
    let installedKey: string | undefined;
    let scope: ExtensionScope | undefined;
    let config: McpServerConfig | undefined;
    if (rec.isBuiltin) {
      installed = builtinInstalled(rec.id);
      state = installed ? 'ready' : 'recommended';
      installedKey = installed ? rec.id : undefined;
      // Leave scope undefined: builtins aren't tied to global/workspace
      // storage, and the catalog UI's scope filter ignores items with no scope.
      scope = undefined;
    } else {
      state = entry
        ? computeStateForInstalled(entry.config, rec.auth, rec.id, opts.unhealthyIds)
        : 'recommended';
      installed = !!entry;
      installedKey = entry?.name;
      scope = entry?.scope;
      config = entry?.config;
    }
    items.push({
      id: rec.id,
      name: rec.name,
      description: rec.description,
      descriptionZh: rec.descriptionZh,
      category: rec.category,
      iconSlug: rec.iconSlug,
      iconUrl: rec.iconUrl,
      homepage: rec.homepage,
      transport: {
        type: rec.transport.type,
        summary: transportSummary(rec.transport),
        ...(rec.transport.type === 'http' ? { url: rec.transport.url } : {}),
      },
      auth: rec.auth,
      state,
      isRecommended: true,
      installed,
      scope,
      config,
      installedKey,
      recommendedScope: rec.recommendedScope,
      isBuiltin: rec.isBuiltin,
    });
  }

  // 2. Custom entries — user-added servers not in the recommended registry.
  for (const entry of customEntries) {
    if (!scopeMatchesEntry(entry)) continue;
    if (isGenericDemoEntry(entry)) continue;
    const auth: McpAuthSpec = { type: 'none' };
    const state = computeStateForInstalled(entry.config, auth, entry.name, opts.unhealthyIds);
    items.push({
      id: entry.name,
      name: entry.name,
      description: cmdSummary(entry.config),
      descriptionZh: cmdSummary(entry.config),
      category: 'custom',
      iconSlug: inferCustomMcpIconSlug(entry),
      transport: {
        type: entry.config.type === 'http' ? 'http' : 'stdio',
        summary: cmdSummary(entry.config),
        ...(entry.config.type === 'http' && entry.config.url ? { url: entry.config.url } : {}),
      },
      auth,
      state,
      isRecommended: false,
      installed: true,
      scope: entry.scope,
      config: entry.config,
      installedKey: entry.name,
    });
  }

  return items;
}

export function getCatalogItem(id: string, opts: { workdir?: string } = {}): McpCatalogItem | undefined {
  return getCatalogItems(opts).find(i => i.id === id);
}

/**
 * Build an `McpServerConfig` from a recommended entry plus user-supplied
 * credentials. Used when installing a recommended server via the catalog flow.
 */
export function buildInstalledConfigFromRecommended(
  rec: RecommendedMcpServer,
  opts: { enabled: boolean; credentials?: Record<string, string> } = { enabled: false },
): McpServerConfig {
  const creds = opts.credentials || {};

  if (rec.transport.type === 'stdio') {
    const env: Record<string, string> = {};
    if (rec.auth.type === 'credentials') {
      for (const f of rec.auth.fields) if (creds[f.key]) env[f.key] = creds[f.key];
    }
    return {
      type: 'stdio',
      command: rec.transport.command,
      args: rec.transport.args,
      ...(Object.keys(env).length ? { env } : {}),
      enabled: opts.enabled,
      catalogId: rec.id,
    };
  }

  const headers: Record<string, string> = {};
  let url = rec.transport.url;
  if (rec.auth.type === 'credentials') {
    const urlField = rec.auth.fields.find(f => f.key === 'MCP_URL');
    if (urlField && creds[urlField.key]?.trim()) url = creds[urlField.key].trim();
    const tokenField = rec.auth.fields.find(f => f.key === 'MCP_TOKEN')
      || rec.auth.fields.find(f => /token|key|secret/i.test(f.key));
    if (tokenField && creds[tokenField.key]?.trim()) {
      const token = creds[tokenField.key].trim();
      headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    } else {
      // Convention: first non-URL credential becomes Authorization: Bearer <value>.
      // Matches how Stripe, Perplexity, and similar providers expect the token.
      const first = rec.auth.fields.find(f => f.key !== 'MCP_URL' && creds[f.key]);
      if (first) headers.Authorization = `Bearer ${creds[first.key]}`;
    }
  }
  return {
    type: 'http',
    url,
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled: opts.enabled,
    catalogId: rec.id,
  };
}

// ---------------------------------------------------------------------------
// Merge for session — called by bridge.ts
// ---------------------------------------------------------------------------

/**
 * Build the merged MCP server list for a session.
 * Priority (low → high): global → workspace .mcp.json → .claude/.mcp.json → ~/.claude/.mcp.json → builtins.
 * Disabled servers are filtered out. OAuth Bearer headers are injected for
 * any http-type server that has a valid token in the token store.
 */
export function mergeExtensionsForSession(
  builtinServers: RegisteredMcpServer[],
  workdir?: string,
): Record<string, any> {
  const merged: Record<string, any> = {};

  // 1. Global extensions from setting.json (lowest priority)
  const userConfig = loadUserConfig();
  const globalMcp = userConfig.extensions?.mcp;
  if (globalMcp) {
    for (const [name, cfg] of Object.entries(globalMcp)) {
      if (cfg.enabled === false || cfg.disabled) continue;
      if (cfg.type === 'http' && cfg.url) {
        const oauthKey = cfg.catalogId || name;
        const headers = injectOAuthHeaders(oauthKey, { headers: cfg.headers });
        merged[name] = {
          type: 'http',
          url: cfg.url,
          ...(Object.keys(headers).length ? { headers } : {}),
        };
      } else if (cfg.command) {
        merged[name] = {
          type: 'stdio',
          command: cfg.command,
          args: cfg.args || [],
          ...(cfg.env ? { env: cfg.env } : {}),
        };
      }
    }
  }

  // 2. Workspace .mcp.json files (overwrite global)
  if (workdir) {
    for (const candidate of [
      path.join(workdir, '.mcp.json'),
      path.join(workdir, '.claude', '.mcp.json'),
      path.join(os.homedir(), '.claude', '.mcp.json'),
    ]) {
      try {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        const servers = parsed?.mcpServers ?? parsed;
        if (servers && typeof servers === 'object') {
          for (const [name, cfg] of Object.entries(servers) as [string, any][]) {
            if (cfg?.disabled === true) {
              delete merged[name];
            } else {
              Object.assign(merged, { [name]: cfg });
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // 3. Built-in servers (highest priority)
  for (const server of builtinServers) {
    merged[server.name] = {
      type: 'stdio',
      command: server.command,
      args: server.args,
      ...(server.env ? { env: server.env } : {}),
    };
  }

  // Filter out any remaining disabled entries
  for (const [name, cfg] of Object.entries(merged)) {
    if (cfg?.disabled === true || cfg?.enabled === false) {
      delete merged[name];
    }
  }

  return merged;
}

/**
 * Convert global/workspace extensions to RegisteredMcpServer[] for agents
 * that use server arrays instead of merged configs.
 */
export function getGlobalExtensionsAsServers(workdir?: string): RegisteredMcpServer[] {
  const merged: Map<string, RegisteredMcpServer> = new Map();

  const userConfig = loadUserConfig();
  const globalMcp = userConfig.extensions?.mcp;
  if (globalMcp) {
    for (const [name, cfg] of Object.entries(globalMcp)) {
      if (cfg.enabled === false || cfg.disabled) continue;
      if (cfg.type === 'http' && cfg.url) {
        const oauthKey = cfg.catalogId || name;
        const headers = injectOAuthHeaders(oauthKey, { headers: cfg.headers });
        merged.set(name, {
          name,
          type: 'http',
          url: cfg.url,
          ...(Object.keys(headers).length ? { headers } : {}),
        });
      } else if (cfg.command) {
        merged.set(name, { name, type: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env });
      }
    }
  }

  if (workdir) {
    const wsServers = readMcpJson(workspaceMcpJsonPath(workdir));
    for (const [name, cfg] of Object.entries(wsServers)) {
      if (cfg.disabled) {
        merged.delete(name);
      } else if (cfg.type === 'http' && cfg.url) {
        const oauthKey = cfg.catalogId || name;
        const headers = injectOAuthHeaders(oauthKey, { headers: cfg.headers });
        merged.set(name, {
          name,
          type: 'http',
          url: cfg.url,
          ...(Object.keys(headers).length ? { headers } : {}),
        });
      } else if (cfg.command) {
        merged.set(name, { name, type: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env });
      }
    }
  }

  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Health check — spawn + MCP initialize handshake
// ---------------------------------------------------------------------------

interface CachedHealth {
  result: McpHealthResult;
  fingerprint: string;
  cachedAt: number;
}

const HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;
const healthCache = new Map<string, CachedHealth>();

function healthFingerprint(config: McpServerConfig): string {
  return JSON.stringify({
    type: config.type || 'stdio',
    url: config.url,
    command: config.command,
    args: config.args,
    hasEnv: !!config.env && Object.keys(config.env).length > 0,
    headers: config.headers || {},
  });
}

export function getCachedHealth(id: string, config: McpServerConfig): McpHealthResult | undefined {
  const entry = healthCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > HEALTH_CACHE_TTL_MS) return undefined;
  if (entry.fingerprint !== healthFingerprint(config)) return undefined;
  return entry.result;
}

export function cacheHealth(id: string, config: McpServerConfig, result: McpHealthResult): void {
  healthCache.set(id, { result, fingerprint: healthFingerprint(config), cachedAt: Date.now() });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mcpJsonRpcRequest(id: number, method: string, params: Record<string, any> = {}): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
}

function httpMcpHeaders(config: McpServerConfig): Record<string, string> {
  return {
    ...(config.headers || {}),
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
}

function extractMcpError(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.message;
    if (message) return String(message);
  } catch { /* not JSON */ }
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, 220) : undefined;
}

async function readResponseSnippet(res: Response, max = 4000): Promise<string> {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return '';
  }
}

function responseLooksLikeMcpSuccess(text: string): boolean {
  if (!text.trim()) return false;
  if (text.includes('"result"') || text.includes('"serverInfo"')) return true;
  if (text.includes('event:') && (text.includes('message') || text.includes('endpoint'))) return true;
  return false;
}

function extractToolsFromText(text: string): string[] {
  const tools = new Set<string>();
  try {
    const parsed = JSON.parse(text);
    const candidates = [
      ...(Array.isArray(parsed?.tools) ? parsed.tools : []),
      ...(Array.isArray(parsed?.result?.tools) ? parsed.result.tools : []),
    ];
    for (const tool of candidates) {
      if (tool?.name) tools.add(String(tool.name));
    }
  } catch { /* fall through to regex extraction */ }

  const nameMatches = text.matchAll(/"name"\s*:\s*"([^"]+)"/g);
  for (const match of nameMatches) {
    if (match[1]) tools.add(match[1]);
  }

  return [...tools];
}

async function checkHttpMcpHealth(config: McpServerConfig, timeoutMs: number): Promise<McpHealthResult> {
  const url = config.url?.trim();
  if (!url) return { ok: false, error: 'no URL specified' };

  const start = Date.now();
  const elapsed = () => Date.now() - start;
  const initBody = mcpJsonRpcRequest(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pikiclaw-health-check', version: '1.0.0' },
  });

  try {
    const initRes = await fetchWithTimeout(url, {
      method: 'POST',
      headers: httpMcpHeaders(config),
      body: initBody,
    }, timeoutMs);

    const initText = await readResponseSnippet(initRes);
    if (initRes.status === 401 || initRes.status === 403) {
      return { ok: false, error: `authentication failed (HTTP ${initRes.status})`, elapsedMs: elapsed() };
    }

    if (initRes.ok && responseLooksLikeMcpSuccess(initText)) {
      const toolsBody = mcpJsonRpcRequest(2, 'tools/list');
      try {
        const toolsRes = await fetchWithTimeout(url, {
          method: 'POST',
          headers: httpMcpHeaders(config),
          body: toolsBody,
        }, Math.min(timeoutMs, 5000));
        const toolsText = await readResponseSnippet(toolsRes);
        return {
          ok: true,
          tools: toolsRes.ok ? extractToolsFromText(toolsText) : undefined,
          elapsedMs: elapsed(),
        };
      } catch {
        return { ok: true, elapsedMs: elapsed() };
      }
    }

    // Some HTTP MCP servers expose an SSE endpoint where GET opens the stream
    // and POST is not accepted on the same URL. Fall back to a reachability
    // check, but still treat auth errors as real failures.
    if (initRes.status !== 404 && initRes.status !== 405) {
      const detail = extractMcpError(initText);
      return {
        ok: false,
        error: detail ? `HTTP ${initRes.status}: ${detail}` : `HTTP ${initRes.status}`,
        elapsedMs: elapsed(),
      };
    }
  } catch (e: any) {
    const message = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (e?.message || 'unreachable');
    return { ok: false, error: message, elapsedMs: elapsed() };
  }

  try {
    const getRes = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        ...(config.headers || {}),
        accept: 'text/event-stream, application/json',
      },
    }, timeoutMs);
    try { await getRes.body?.cancel(); } catch { /* best effort */ }

    if (getRes.status === 401 || getRes.status === 403) {
      return { ok: false, error: `authentication failed (HTTP ${getRes.status})`, elapsedMs: elapsed() };
    }
    if (getRes.ok) return { ok: true, elapsedMs: elapsed() };
    return { ok: false, error: `HTTP ${getRes.status}`, elapsedMs: elapsed() };
  } catch (e: any) {
    const message = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (e?.message || 'unreachable');
    return { ok: false, error: message, elapsedMs: elapsed() };
  }
}

export async function checkMcpHealth(config: McpServerConfig, timeoutMs = 10_000): Promise<McpHealthResult> {
  if (config.type === 'http') {
    return checkHttpMcpHealth(config, timeoutMs);
  }

  if (!config.command) return { ok: false, error: 'no command specified' };

  return new Promise((resolve) => {
    const start = Date.now();
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
      clearTimeout(timer);
    };

    const child = spawn(config.command!, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms`, elapsedMs: Date.now() - start });
    }, timeoutMs);

    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });

    child.on('error', (err) => {
      cleanup();
      resolve({ ok: false, error: err.message, elapsedMs: Date.now() - start });
    });

    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pikiclaw-health-check', version: '1.0.0' },
      },
    });
    const header = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n`;

    try {
      child.stdin?.write(header + initRequest);
    } catch {
      cleanup();
      resolve({ ok: false, error: 'failed to write to stdin', elapsedMs: Date.now() - start });
      return;
    }

    checkInterval = setInterval(() => {
      const hasResponse = stdout.includes('"result"') || stdout.includes('"serverInfo"');
      if (!hasResponse) return;

      cleanup();

      const toolsRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      const toolsHeader = `Content-Length: ${Buffer.byteLength(toolsRequest)}\r\n\r\n`;

      try { child.stdin?.write(toolsHeader + toolsRequest); } catch { /* best-effort */ }

      setTimeout(() => {
        child.kill();
        const tools: string[] = [];
        try {
          const jsonMatches = stdout.match(/\{[^{}]*"tools"\s*:\s*\[[\s\S]*?\]\s*[^{}]*\}/g);
          if (jsonMatches) {
            for (const m of jsonMatches) {
              try {
                const parsed = JSON.parse(m);
                if (Array.isArray(parsed.tools)) {
                  for (const tool of parsed.tools) if (tool.name) tools.push(tool.name);
                }
                if (parsed.result?.tools) {
                  for (const tool of parsed.result.tools) if (tool.name) tools.push(tool.name);
                }
              } catch { /* try next match */ }
            }
          }
        } catch { /* best effort */ }

        resolve({ ok: true, tools: tools.length ? tools : undefined, elapsedMs: Date.now() - start });
      }, 1500);
    }, 100);
  });
}
