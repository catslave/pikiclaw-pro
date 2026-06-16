import { loadUserConfig } from '../core/config/user-config.js';
import type { SyncJiraTaskInput } from './tasks.js';
import type { JiraRemoteUpdateRun } from './workflow.js';

const DEFAULT_JIRA_MCP_SERVICE_URL = 'http://xia01-i01-dkr01.int.rclabenv.com:8000/mcp/';
const JIRA_SYNC_FIELDS = 'summary,description,issuetype,status,assignee,reporter,fixVersions,duedate,priority,labels,updated,issuelinks,customfield_10652';
const JIRA_SYNC_COMMENT_LIMIT = 5;

function text(value: unknown, max = 16_000): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.length > max ? raw.slice(0, max).trimEnd() : raw;
}

function issueField(issue: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = issue[key];
    if (value != null && String(value).trim()) return value;
  }
  const fields = issue.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields === 'object') {
    for (const key of keys) {
      const value = fields[key];
      if (value != null && String(value).trim()) return value;
    }
  }
  return undefined;
}

function normalizeDescription(value: unknown): string {
  if (typeof value === 'string') return text(value, 32_000);
  if (value == null) return '';
  try {
    return JSON.stringify(value).slice(0, 32_000);
  } catch {
    return String(value).slice(0, 32_000);
  }
}

function personName(value: unknown): string {
  if (typeof value === 'string') return text(value, 240);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return text(object.displayName || object.name || object.emailAddress || object.accountId, 240);
  }
  return '';
}

function namedValue(value: unknown): string {
  if (typeof value === 'string') return text(value, 240);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return text(object.name || object.value || object.id, 240);
  }
  return '';
}

function sprintNameFromText(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const match = raw.match(/\bname=([^,\]]+)/);
  return text(match?.[1] || raw, 240);
}

function collectSprintNames(value: unknown, output: string[] = []): string[] {
  if (value == null) return output;
  if (typeof value === 'string') {
    const name = sprintNameFromText(value);
    if (name) output.push(name);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSprintNames(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.name === 'string') {
      const name = sprintNameFromText(object.name);
      if (name) output.push(name);
    }
    if (object.value != null) collectSprintNames(object.value, output);
    if (object.values != null) collectSprintNames(object.values, output);
  }
  return output;
}

function sprintValue(value: unknown): string {
  return [...new Set(collectSprintNames(value))].join(', ');
}

function parseMcpEventJson(body: string): any {
  const dataLines = body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice(6));
  const payload = dataLines.join('\n').trim() || body.trim();
  return payload ? JSON.parse(payload) : {};
}

async function postMcpJson(url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`);
  return { response, payload: parseMcpEventJson(responseText) };
}

function mcpSessionHeaders(headers: Record<string, string>, sessionId: string | null): Record<string, string> {
  return sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers;
}

async function initializeMcpSession(url: string, headers: Record<string, string>): Promise<string | null> {
  const initialized = await postMcpJson(url, headers, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'pikiclaw-jira-remote-update', version: '0.0.0' },
    },
  });
  const sessionId = initialized.response.headers.get('mcp-session-id');
  await postMcpJson(url, mcpSessionHeaders(headers, sessionId), {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  return sessionId;
}

async function listMcpTools(url: string, headers: Record<string, string>, sessionId: string | null): Promise<string[]> {
  const { payload } = await postMcpJson(url, mcpSessionHeaders(headers, sessionId), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return Array.isArray(payload?.result?.tools) ? payload.result.tools.map((tool: any) => text(tool?.name, 120)).filter(Boolean) : [];
}

async function callMcpTool(url: string, headers: Record<string, string>, sessionId: string | null, name: string, args: Record<string, unknown>) {
  const { payload } = await postMcpJson(url, mcpSessionHeaders(headers, sessionId), {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  if (payload?.result?.isError) {
    throw new Error(mcpTextResult(payload.result).slice(0, 1000) || 'MCP tool returned an error');
  }
  return payload?.result;
}

function mcpTextResult(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  const textParts = content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text);
  if (textParts.length) return textParts.join('\n');
  return typeof result === 'string' ? result : JSON.stringify(result || {});
}

function parseMcpJsonText(result: any): any {
  const raw = mcpTextResult(result).trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`MCP tool returned non-JSON text: ${raw.slice(0, 500)}`);
  }
}

function jiraReadTokenHeaders(jiraToken: string, confluenceToken: string): Record<string, string> {
  return {
    'jira-read-token': jiraToken,
    ...(confluenceToken ? { 'confluence-read-token': confluenceToken } : {}),
  };
}

function jiraMcpConfigs(): Array<{ name: string; url: string; headers: Record<string, string> }> {
  const configs: Array<{ name: string; url: string; headers: Record<string, string> }> = [];
  const jiraToken = text(process.env.RC_JIRA_READ_TOKEN, 4000);
  const confluenceToken = text(process.env.RC_CONFLUENCE_READ_TOKEN, 4000);
  if (jiraToken) {
    configs.push({
      name: 'mcp-atlassian-service',
      url: text(process.env.PIKICLAW_JIRA_MCP_SERVICE_URL, 2048) || DEFAULT_JIRA_MCP_SERVICE_URL,
      headers: jiraReadTokenHeaders(jiraToken, confluenceToken),
    });
  }
  const atlassian = loadUserConfig().extensions?.mcp?.atlassian;
  if (atlassian?.enabled !== false && !atlassian?.disabled && atlassian?.url) {
    if (jiraToken) {
      configs.push({
        name: 'atlassian:jira-read-token',
        url: atlassian.url,
        headers: jiraReadTokenHeaders(jiraToken, confluenceToken),
      });
    }
    configs.push({
      name: 'atlassian',
      url: atlassian.url,
      headers: atlassian.headers || {},
    });
  }
  return configs;
}

function projectKeyHint(value: unknown): string {
  const raw = text(value, 120);
  if (!raw) return '';
  const issueKey = raw.match(/\b([A-Z][A-Z0-9]+)-\d+\b/i);
  if (issueKey?.[1]) return issueKey[1].toUpperCase();
  const projectKey = raw.match(/\b([A-Z][A-Z0-9]+)\b/i);
  return projectKey?.[1] ? projectKey[1].toUpperCase() : '';
}

export function resolveJiraIssueKeyInput(query: unknown, projectHint?: unknown): string {
  const raw = text(query, 2048);
  if (!raw) return '';
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const direct = decoded.match(/\b([A-Z][A-Z0-9]+)-(\d+)\b/i);
  if (direct) return `${direct[1].toUpperCase()}-${direct[2]}`;
  const spaced = decoded.match(/\b([A-Z][A-Z0-9]+)\s+(\d+)\b/i);
  if (spaced) return `${spaced[1].toUpperCase()}-${spaced[2]}`;
  const numberOnly = decoded.match(/^\s*#?(\d+)\s*$/);
  const project = projectKeyHint(projectHint);
  if (numberOnly && project) return `${project}-${numberOnly[1]}`;
  return '';
}

function normalizeJiraIssueForSync(issue: Record<string, unknown>, fallbackKey?: string): SyncJiraTaskInput {
  const fields = issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : {};
  const key = text(issueField(issue, 'jiraKey', 'key', 'issueKey'), 80) || text(fallbackKey, 80);
  const issueType = namedValue(issueField(issue, 'issueType', 'issue_type', 'type', 'issuetype'));
  const status = namedValue(issueField(issue, 'ticketStatus', 'status'));
  const rawSprint = issueField(issue, 'sprint', 'sprintName', 'customfield_10652');
  const fixVersions = issueField(issue, 'fixVersions', 'fix_versions', 'fixVersion');
  const jiraUrl = text(issueField(issue, 'jiraUrl', 'url'), 2048) || (key ? `https://jira.ringcentral.com/browse/${key}` : '');
  return {
    jiraKey: key,
    title: text(issueField(issue, 'title', 'summary'), 240) || key || 'Untitled Jira issue',
    description: normalizeDescription(issueField(issue, 'description')),
    issueType,
    jiraUrl,
    sprint: sprintValue(rawSprint),
    fixVersions: Array.isArray(fixVersions) ? fixVersions.map(namedValue).filter(Boolean) : undefined,
    fixVersion: Array.isArray(fixVersions) ? fixVersions.map(namedValue).filter(Boolean).join(', ') : namedValue(fixVersions),
    reporter: personName(issueField(issue, 'reporter')),
    assignee: personName(issueField(issue, 'assignee')),
    ticketStatus: status,
    dueDate: text(issueField(issue, 'dueDate', 'duedate'), 80),
    priority: namedValue(issueField(issue, 'priority')),
    labels: Array.isArray(issueField(issue, 'labels')) ? (issueField(issue, 'labels') as unknown[]).map(label => text(label, 120)).filter(Boolean) : undefined,
    updatedAt: text(issueField(issue, 'updatedAt', 'updated'), 80),
    rawFields: Object.keys(fields).length ? fields : issue,
  };
}

export async function fetchJiraIssueFromMcp(jiraKey: string): Promise<{ issue: SyncJiraTaskInput; source: string; tried: string[] }> {
  const key = text(jiraKey, 80);
  if (!key) throw new Error('jiraKey is required');
  const tried: string[] = [];
  for (const config of jiraMcpConfigs()) {
    try {
      const sessionId = await initializeMcpSession(config.url, config.headers);
      const tools = await listMcpTools(config.url, config.headers, sessionId);
      if (!tools.includes('jira_get_issue')) {
        tried.push(`${config.name}: jira_get_issue not available`);
        continue;
      }
      const result = await callMcpTool(config.url, config.headers, sessionId, 'jira_get_issue', {
        issue_key: key,
        fields: JIRA_SYNC_FIELDS,
        comment_limit: JIRA_SYNC_COMMENT_LIMIT,
      });
      const parsed = parseMcpJsonText(result);
      const issue = parsed?.issue && typeof parsed.issue === 'object' ? parsed.issue : parsed;
      return {
        issue: normalizeJiraIssueForSync(issue && typeof issue === 'object' ? issue : {}, key),
        source: config.name,
        tried,
      };
    } catch (error: any) {
      tried.push(`${config.name}: ${error?.message || error}`);
    }
  }
  throw new Error(tried.join(' | ') || 'No configured Jira MCP server was available');
}

function jiraUpdateFields(run: JiraRemoteUpdateRun): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (run.fields.dueDate !== undefined) fields.duedate = run.fields.dueDate || null;
  if (run.fields.fixVersions !== undefined) fields.fixVersions = run.fields.fixVersions.map(name => ({ name }));
  if (run.fields.sprint !== undefined) fields.customfield_10652 = run.fields.sprint;
  return fields;
}

async function applyStatusTransition(url: string, headers: Record<string, string>, sessionId: string | null, tools: string[], jiraKey: string, status: string): Promise<string | null> {
  if (!status) return null;
  if (tools.includes('jira_transition_issue')) {
    await callMcpTool(url, headers, sessionId, 'jira_transition_issue', { issue_key: jiraKey, transition_name: status });
    return 'jira_transition_issue';
  }
  if (tools.includes('jira_transition')) {
    await callMcpTool(url, headers, sessionId, 'jira_transition', { issue_key: jiraKey, transition_name: status });
    return 'jira_transition';
  }
  return null;
}

async function applyFieldUpdate(url: string, headers: Record<string, string>, sessionId: string | null, tools: string[], jiraKey: string, fields: Record<string, unknown>): Promise<string | null> {
  if (!Object.keys(fields).length) return null;
  if (tools.includes('jira_update_issue')) {
    await callMcpTool(url, headers, sessionId, 'jira_update_issue', { issue_key: jiraKey, fields });
    return 'jira_update_issue';
  }
  if (tools.includes('jira_update')) {
    await callMcpTool(url, headers, sessionId, 'jira_update', { issue_key: jiraKey, fields });
    return 'jira_update';
  }
  return null;
}

export async function applyJiraRemoteUpdate(run: JiraRemoteUpdateRun): Promise<{ remoteTool: string }> {
  const jiraKey = text(run.jiraKey, 80);
  if (!jiraKey) throw new Error('jiraKey is required for remote update');
  const fieldPatch = jiraUpdateFields(run);
  const tried: string[] = [];
  for (const config of jiraMcpConfigs()) {
    try {
      const sessionId = await initializeMcpSession(config.url, config.headers);
      const tools = await listMcpTools(config.url, config.headers, sessionId);
      const usedTools: string[] = [];
      const fieldTool = await applyFieldUpdate(config.url, config.headers, sessionId, tools, jiraKey, fieldPatch);
      if (fieldTool) usedTools.push(fieldTool);
      const statusTool = await applyStatusTransition(config.url, config.headers, sessionId, tools, jiraKey, run.fields.status || '');
      if (statusTool) usedTools.push(statusTool);
      if (!usedTools.length) {
        tried.push(`${config.name}: no supported update/transition tool`);
        continue;
      }
      return { remoteTool: `${config.name}:${usedTools.join('+')}` };
    } catch (error: any) {
      tried.push(`${config.name}: ${error?.message || error}`);
    }
  }
  throw new Error(tried.join(' | ') || 'No configured Jira MCP server was available');
}
