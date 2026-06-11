/**
 * tools/pro.ts — Pikiclaw Pro workflow tools exposed to agent sessions.
 */

import type { McpToolModule, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';
import { loadUserConfig } from '../../../core/config/user-config.js';
import { syncJiraTask } from '../../../pro/tasks.js';
import { createKnowledgeEntry, getJiraSyncRun, recordJiraSyncCandidates, updateJiraSyncRun } from '../../../pro/workflow.js';

const DEFAULT_JIRA_MCP_SERVICE_URL = 'http://xia01-i01-dkr01.int.rclabenv.com:8000/mcp/';
const JIRA_SYNC_FIELDS = 'summary,description,issuetype,status,assignee,reporter,fixVersions,duedate,priority,labels,updated,issuelinks,customfield_10652';

const tools: McpToolModule['tools'] = [
  {
    name: 'pikiclaw_pro_save_knowledge',
    description: 'Save a reusable Pikiclaw knowledge card or session digest with source chat and output/file/link evidence references.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short reusable title.' },
        body: { type: 'string', description: 'Grounded explanation, decision, pattern, summary, or reusable note.' },
        summary: { type: 'string', description: 'One or two sentence card preview.' },
        kind: { type: 'string', enum: ['knowledge-card', 'session-digest'] },
        status: { type: 'string', enum: ['published', 'hidden'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        tags: { type: 'array', items: { type: 'string' } },
        source: {
          type: 'object',
          description: 'Legacy single source reference. Prefer sourceRefs for new cards.',
          properties: {
            type: { type: 'string', enum: ['manual', 'chat', 'task'] },
            workdir: { type: 'string' },
            agent: { type: 'string' },
            sessionId: { type: 'string' },
            taskId: { type: 'string' },
          },
        },
        sourceRefs: {
          type: 'array',
          description: 'Evidence sources such as chat, task, output, file, or link references.',
          items: { type: 'object' },
        },
        artifactRefs: {
          type: 'array',
          description: 'Output/file/link references created by the source chat.',
          items: { type: 'object' },
        },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'pikiclaw_pro_report_jira_sync_progress',
    description: 'Report visible progress for the current Jira sync run: tool being used, number of tickets found, or current sync stage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'Jira sync run id provided in the prompt.' },
        label: { type: 'string', description: 'Short progress label, e.g. "Searching Jira tickets".' },
        detail: { type: 'string', description: 'Optional detail, e.g. tool name, query, or result summary.' },
        status: { type: 'string', enum: ['syncing', 'completed', 'failed'] },
        ticketCount: { type: 'number' },
        taskCount: { type: 'number' },
      },
      required: ['runId', 'label'],
    },
  },
  {
    name: 'pikiclaw_pro_sync_jira_issues',
    description: 'Create or update Pikiclaw Jira tasks from Jira issue data pulled by MCP tools. Use this after fetching Jira tickets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issues: {
          type: 'array',
          description: 'Jira issues to sync. Each item should include key/jiraKey, title/summary, description, issueType, url/jiraUrl, sprint, fixVersion/fixVersions, reporter, assignee, status, dueDate, priority, labels, updatedAt, linked issues, remote links, and development/MR links when available.',
          items: {
            type: 'object',
            properties: {
              jiraKey: { type: 'string' },
              key: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              description: { type: 'string' },
              issueType: { type: 'string' },
              type: { type: 'string' },
              reporter: { type: 'string' },
              assignee: { type: 'string' },
              status: { type: 'string' },
              ticketStatus: { type: 'string' },
              dueDate: { type: 'string' },
              priority: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              updatedAt: { type: 'string' },
              updated: { type: 'string' },
              jiraUrl: { type: 'string' },
              prUrl: { type: 'string' },
              mergeRequestUrl: { type: 'string' },
              url: { type: 'string' },
              sprint: { type: 'string' },
              fixVersion: { type: 'string' },
              fixVersions: { type: 'array', items: { type: 'string' } },
              workdir: { type: 'string' },
            },
          },
        },
        runId: {
          type: 'string',
          description: 'Optional Jira sync run id. Include this so Pikiclaw can show ticket/task counts in the progress timeline.',
        },
      },
      required: ['issues'],
    },
  },
  {
    name: 'pikiclaw_pro_record_jira_sync_candidates',
    description: 'Record Jira issues as reviewable sync candidates without creating or updating Pikiclaw tasks. Use this after fetching assigned current-sprint Jira tickets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issues: {
          type: 'array',
          description: 'Jira issues to stage for user review. Closed and Cancelled issues are excluded.',
          items: { type: 'object' },
        },
        runId: {
          type: 'string',
          description: 'Jira sync run id. Required so Pikiclaw can show the review list.',
        },
      },
      required: ['runId', 'issues'],
    },
  },
  {
    name: 'pikiclaw_pro_pull_jira_sync_candidates',
    description: 'Pull assigned Jira issues through the configured Jira MCP service and record them as reviewable sync candidates. This does not create or update Pikiclaw tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: {
          type: 'string',
          description: 'Jira sync run id. Required so Pikiclaw can show progress and the review list.',
        },
        jql: {
          type: 'string',
          description: 'Assignee-scoped JQL. Defaults to currentUser open sprint active work.',
        },
        fallbackJql: {
          type: 'string',
          description: 'Fallback assignee-scoped JQL if the default sprint JQL is unsupported.',
        },
      },
      required: ['runId'],
    },
  },
];

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

function jiraRawFields(issue: Record<string, unknown>): Record<string, unknown> | undefined {
  const fields = issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : {};
  const fixVersion = issueField(issue, 'fixVersion', 'fixVersions', 'fixversion', 'fixversions');
  const raw = {
    ...fields,
    ...(fixVersion != null ? { fixVersions: fixVersion } : {}),
  };
  return Object.keys(raw).length ? raw : undefined;
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
  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${textBody.slice(0, 500)}`);
  }
  return {
    response,
    payload: parseMcpEventJson(textBody),
  };
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
      clientInfo: { name: 'pikiclaw-jira-sync', version: '0.0.0' },
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

async function callMcpTool(url: string, headers: Record<string, string>, sessionId: string | null, name: string, args: Record<string, unknown>) {
  const { payload } = await postMcpJson(url, mcpSessionHeaders(headers, sessionId), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  if (payload?.error) {
    throw new Error(payload.error.message || JSON.stringify(payload.error));
  }
  if (payload?.result?.isError) {
    throw new Error(mcpTextResult(payload.result).slice(0, 1000) || 'MCP tool returned an error');
  }
  return payload?.result;
}

async function listMcpTools(url: string, headers: Record<string, string>, sessionId: string | null): Promise<string[]> {
  const { payload } = await postMcpJson(url, mcpSessionHeaders(headers, sessionId), {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {},
  });
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return Array.isArray(payload?.result?.tools) ? payload.result.tools.map((tool: any) => text(tool?.name, 120)).filter(Boolean) : [];
}

function mcpTextResult(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  const textParts = content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text);
  if (textParts.length) return textParts.join('\n');
  return typeof result === 'string' ? result : JSON.stringify(result || {});
}

function parseJiraSearchIssues(result: any): any[] {
  const raw = mcpTextResult(result).trim();
  if (!raw) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`MCP tool returned non-JSON text: ${raw.slice(0, 500)}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.issues)) return parsed.issues;
  if (Array.isArray(parsed.results)) return parsed.results;
  return [];
}

function normalizeJiraIssueForCandidate(issue: Record<string, unknown>): Record<string, unknown> {
  const fields = issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : {};
  const key = text(issueField(issue, 'jiraKey', 'key', 'issueKey'), 80);
  const issueType = namedValue(issueField(issue, 'issueType', 'type', 'issuetype'));
  const status = namedValue(issueField(issue, 'ticketStatus', 'status'));
  const rawSprint = issueField(issue, 'sprint', 'sprintName', 'customfield_10652');
  const fixVersions = issueField(issue, 'fixVersions', 'fixVersion');
  const jiraUrl = text(issueField(issue, 'jiraUrl', 'url'), 2048) || (key ? `https://jira.ringcentral.com/browse/${key}` : '');
  return {
    jiraKey: key,
    key,
    title: text(issueField(issue, 'title', 'summary'), 240),
    summary: text(issueField(issue, 'summary', 'title'), 240),
    description: normalizeDescription(issueField(issue, 'description')),
    issueType,
    jiraUrl,
    url: jiraUrl,
    sprint: sprintValue(rawSprint),
    fixVersions: Array.isArray(fixVersions) ? fixVersions.map(namedValue).filter(Boolean) : undefined,
    fixVersion: Array.isArray(fixVersions) ? fixVersions.map(namedValue).filter(Boolean).join(', ') : namedValue(fixVersions),
    reporter: personName(issueField(issue, 'reporter')),
    assignee: personName(issueField(issue, 'assignee')),
    ticketStatus: status,
    status,
    dueDate: text(issueField(issue, 'dueDate', 'duedate'), 80),
    priority: namedValue(issueField(issue, 'priority')),
    labels: Array.isArray(issueField(issue, 'labels')) ? (issueField(issue, 'labels') as unknown[]).map(label => text(label, 120)).filter(Boolean) : undefined,
    updatedAt: text(issueField(issue, 'updatedAt', 'updated'), 80),
    rawFields: Object.keys(fields).length ? fields : jiraRawFields(issue),
  };
}

function jiraMcpConfigs(): Array<{ name: string; url: string; headers: Record<string, string> }> {
  const configs: Array<{ name: string; url: string; headers: Record<string, string> }> = [];
  const jiraToken = text(process.env.RC_JIRA_READ_TOKEN, 4000);
  const confluenceToken = text(process.env.RC_CONFLUENCE_READ_TOKEN, 4000);
  const jiraReadTokenHeaders = jiraToken
    ? {
        'jira-read-token': jiraToken,
        ...(confluenceToken ? { 'confluence-read-token': confluenceToken } : {}),
      }
    : null;
  if (jiraToken) {
    configs.push({
      name: 'mcp-atlassian-service',
      url: text(process.env.PIKICLAW_JIRA_MCP_SERVICE_URL, 2048) || DEFAULT_JIRA_MCP_SERVICE_URL,
      headers: jiraReadTokenHeaders!,
    });
  }
  const atlassian = loadUserConfig().extensions?.mcp?.atlassian;
  if (atlassian?.enabled !== false && !atlassian?.disabled && atlassian?.url) {
    if (jiraReadTokenHeaders) {
      configs.push({
        name: 'atlassian:jira-read-token',
        url: atlassian.url,
        headers: jiraReadTokenHeaders,
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

async function pullJiraCandidatesFromMcp(jql: string, fallbackJql: string): Promise<{ issues: Record<string, unknown>[]; source: string; tried: string[] }> {
  const tried: string[] = [];
  for (const config of jiraMcpConfigs()) {
    try {
      const sessionId = await initializeMcpSession(config.url, config.headers);
      const tools = await listMcpTools(config.url, config.headers, sessionId);
      if (!tools.includes('jira_search')) {
        tried.push(`${config.name}: jira_search not available`);
        continue;
      }
      for (const query of [jql, fallbackJql].filter(Boolean)) {
        try {
          const result = await callMcpTool(config.url, config.headers, sessionId, 'jira_search', {
            jql: query,
            fields: JIRA_SYNC_FIELDS,
            limit: 50,
            start_at: 0,
          });
          return {
            issues: parseJiraSearchIssues(result).map(issue => normalizeJiraIssueForCandidate(issue && typeof issue === 'object' ? issue : {})),
            source: `${config.name}: ${query}`,
            tried,
          };
        } catch (e: any) {
          tried.push(`${config.name}: ${query}: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      tried.push(`${config.name}: ${e?.message || e}`);
    }
  }
  throw new Error(tried.join(' | ') || 'No configured Jira MCP server was available');
}

function buildSyncAnalysis(tasks: Array<{ title: string; status: string; kind: string; jiraKey?: string; sprint?: string; syncAction: string }>, counts: { created: number; updated: number; unchanged: number }): string {
  if (!tasks.length) return 'No Jira tickets were converted into Pikiclaw tasks.';
  const byKind = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const bySprint = new Map<string, number>();
  for (const task of tasks) {
    byKind.set(task.kind, (byKind.get(task.kind) || 0) + 1);
    byStatus.set(task.status, (byStatus.get(task.status) || 0) + 1);
    if (task.sprint) bySprint.set(task.sprint, (bySprint.get(task.sprint) || 0) + 1);
  }
  const formatCounts = (items: Map<string, number>) => [...items.entries()].map(([key, count]) => `${key}: ${count}`).join(', ') || 'none';
  const highlights = tasks
    .slice(0, 8)
    .map(task => `${task.jiraKey || 'No key'} - ${task.title}`)
    .join('\n');
  return [
    `Synced ${tasks.length} Jira ticket${tasks.length === 1 ? '' : 's'}: created ${counts.created}, updated ${counts.updated}, unchanged ${counts.unchanged}.`,
    `Types: ${formatCounts(byKind)}.`,
    `Pikiclaw statuses: ${formatCounts(byStatus)}.`,
    bySprint.size ? `Sprints: ${formatCounts(bySprint)}.` : '',
    highlights ? `Tickets:\n${highlights}` : '',
  ].filter(Boolean).join('\n');
}

function handleSyncJiraIssues(args: Record<string, unknown>, workdir?: string): ToolResult {
  const issues = Array.isArray(args.issues) ? args.issues : [];
  if (!issues.length) return toolResult('Error: issues array is required', true);
  const runId = text(args.runId, 160);
  if (runId && getJiraSyncRun(runId)?.status === 'stopped') {
    return toolResult('Jira sync run stopped; task writing skipped.');
  }
  if (runId) {
    try {
      updateJiraSyncRun(runId, {
        status: 'syncing',
        ticketCount: issues.length,
        event: { label: `Found ${issues.length} Jira ticket${issues.length === 1 ? '' : 's'}`, detail: 'Starting Pikiclaw task sync.' },
      });
    } catch { /* progress is best effort */ }
  }

  const tasks = [];
  const errors = [];
  const counts = { created: 0, updated: 0, unchanged: 0 };
  for (const raw of issues.slice(0, 100)) {
    const issue = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    try {
      const title = text(issueField(issue, 'title', 'summary', 'name'), 240);
      const jiraKey = text(issueField(issue, 'jiraKey', 'key', 'issueKey'), 80);
      const issueTypeRaw = issueField(issue, 'issueType', 'type', 'issuetype');
      const issueType = typeof issueTypeRaw === 'object' && issueTypeRaw
        ? text((issueTypeRaw as Record<string, unknown>).name || (issueTypeRaw as Record<string, unknown>).value, 80)
        : text(issueTypeRaw, 80);
      const task = syncJiraTask({
        title,
        description: normalizeDescription(issueField(issue, 'description', 'body')),
        issueType,
        jiraKey,
        jiraUrl: text(issueField(issue, 'jiraUrl', 'url', 'browseUrl', 'webUrl'), 2048) || (jiraKey ? `https://jira.ringcentral.com/browse/${encodeURIComponent(jiraKey)}` : ''),
        prUrl: text(issueField(issue, 'prUrl', 'mergeRequestUrl', 'pullRequestUrl', 'mrUrl'), 2048),
        sprint: sprintValue(issueField(issue, 'sprint', 'sprintName', 'customfield_10652')),
        workdir: text(issueField(issue, 'workdir'), 2048) || workdir,
        reporter: personName(issueField(issue, 'reporter')),
        assignee: personName(issueField(issue, 'assignee')),
        ticketStatus: namedValue(issueField(issue, 'ticketStatus', 'status')),
        dueDate: text(issueField(issue, 'dueDate', 'duedate'), 80),
        priority: namedValue(issueField(issue, 'priority')),
        labels: Array.isArray(issueField(issue, 'labels')) ? (issueField(issue, 'labels') as unknown[]).map(label => text(label, 120)).filter(Boolean) : undefined,
        updatedAt: text(issueField(issue, 'updatedAt', 'updated'), 80),
        rawFields: jiraRawFields(issue),
      });
      const latestEvent = task.events?.[0];
      const action = latestEvent?.type === 'jira-updated'
        ? 'updated'
        : latestEvent?.summary?.includes('no field changes')
          ? 'unchanged'
          : 'created';
      counts[action]++;
      tasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        kind: task.kind,
        jiraKey: task.jiraKey,
        sprint: task.sprint,
        assignee: task.jiraFields?.assignee,
        priority: task.jiraFields?.priority,
        dueDate: task.jiraFields?.dueDate,
        updatedAt: task.updatedAt,
        syncAction: action,
        summary: latestEvent?.summary,
      });
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  toolLog('pikiclaw_pro_sync_jira_issues', `synced=${tasks.length} errors=${errors.length}`);
  const analysisSummary = buildSyncAnalysis(tasks, counts);
  const issueKeys = tasks.map(task => task.jiraKey).filter((key): key is string => !!key);
  if (runId) {
    try {
      updateJiraSyncRun(runId, {
        status: errors.length ? 'failed' : 'completed',
        ticketCount: issues.length,
        taskCount: tasks.length,
        analysisSummary,
        issueKeys,
        changes: tasks.map(task => ({
          taskId: task.id,
          jiraKey: task.jiraKey,
          title: task.title,
          action: task.syncAction as 'created' | 'updated' | 'unchanged',
          summary: task.summary,
          status: task.status,
          kind: task.kind,
          sprint: task.sprint,
          assignee: task.assignee,
          priority: task.priority,
          dueDate: task.dueDate,
          updatedAt: task.updatedAt,
        })),
        error: errors.join('; ') || undefined,
        event: {
          label: errors.length ? 'Jira task sync failed' : `Synced ${tasks.length} Pikiclaw task${tasks.length === 1 ? '' : 's'}`,
          detail: errors.length
            ? errors.join('; ')
            : `created=${counts.created}, updated=${counts.updated}, unchanged=${counts.unchanged}. ${tasks.map(task => task.jiraKey || task.title).filter(Boolean).join(', ')}`,
        },
      });
    } catch { /* progress is best effort */ }
  }
  return toolResult(JSON.stringify({ ok: errors.length === 0, synced: tasks.length, counts, analysisSummary, tasks, errors }, null, 2), errors.length > 0 && tasks.length === 0);
}

function handleRecordJiraSyncCandidates(args: Record<string, unknown>): ToolResult {
  const runId = text(args.runId, 160);
  const issues = Array.isArray(args.issues) ? args.issues : [];
  if (!runId) return toolResult('Error: runId is required', true);
  try {
    const run = recordJiraSyncCandidates(runId, issues);
    return toolResult(JSON.stringify({
      ok: true,
      runId: run.id,
      candidates: run.items?.length || 0,
      ticketCount: run.ticketCount || 0,
      analysisSummary: run.analysisSummary,
    }, null, 2));
  } catch (e: any) {
    return toolResult(`Error recording Jira sync candidates: ${e?.message || e}`, true);
  }
}

async function handlePullJiraSyncCandidates(args: Record<string, unknown>): Promise<ToolResult> {
  const runId = text(args.runId, 160);
  if (!runId) return toolResult('Error: runId is required', true);
  const jql = text(args.jql, 1000) || 'assignee = currentUser() AND sprint in openSprints() AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC';
  const fallbackJql = text(args.fallbackJql, 1000) || 'assignee = currentUser() AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC';
  try {
    updateJiraSyncRun(runId, {
      status: 'syncing',
      event: {
        label: 'Pulling Jira tickets',
        detail: `Using Pikiclaw Jira MCP puller. Primary JQL: ${jql}`,
      },
    });
    const pulled = await pullJiraCandidatesFromMcp(jql, fallbackJql);
    const activeIssues = pulled.issues.filter(issue => {
      const status = text(issue.ticketStatus || issue.status, 120).toLowerCase();
      return status !== 'closed' && status !== 'cancelled';
    });
    updateJiraSyncRun(runId, {
      status: 'syncing',
      ticketCount: activeIssues.length,
      event: {
        label: `Found ${activeIssues.length} Jira ticket${activeIssues.length === 1 ? '' : 's'}`,
        detail: `Source: ${pulled.source}. Recording candidates starts now.`,
      },
    });
    const run = recordJiraSyncCandidates(runId, activeIssues);
    return toolResult(JSON.stringify({
      ok: true,
      runId: run.id,
      source: pulled.source,
      tried: pulled.tried,
      candidates: run.items?.length || 0,
      ticketCount: run.ticketCount || 0,
      analysisSummary: run.analysisSummary,
      issues: activeIssues,
    }, null, 2));
  } catch (e: any) {
    const message = e?.message || String(e);
    try {
      updateJiraSyncRun(runId, {
        status: 'failed',
        error: message,
        event: { label: 'Jira MCP pull failed', detail: message },
      });
    } catch { /* progress is best effort */ }
    return toolResult(`Error pulling Jira sync candidates: ${message}`, true);
  }
}

function handleReportProgress(args: Record<string, unknown>): ToolResult {
  const runId = text(args.runId, 160);
  const label = text(args.label, 240);
  if (!runId) return toolResult('Error: runId is required', true);
  if (!label) return toolResult('Error: label is required', true);
  if (getJiraSyncRun(runId)?.status === 'stopped') {
    return toolResult(JSON.stringify({ ok: true, runId, status: 'stopped' }, null, 2));
  }
  try {
    const run = updateJiraSyncRun(runId, {
      status: args.status === 'completed' || args.status === 'failed' ? args.status : 'syncing',
      ticketCount: typeof args.ticketCount === 'number' ? args.ticketCount : undefined,
      taskCount: typeof args.taskCount === 'number' ? args.taskCount : undefined,
      event: { label, detail: text(args.detail, 2000) || undefined },
    });
    return toolResult(JSON.stringify({ ok: true, runId: run.id, status: run.status }, null, 2));
  } catch (e: any) {
    return toolResult(`Error reporting progress: ${e?.message || e}`, true);
  }
}

function handleSaveKnowledge(args: Record<string, unknown>, ctx: Parameters<McpToolModule['handle']>[2]): ToolResult {
  const sourceRefs = Array.isArray(args.sourceRefs) ? [...args.sourceRefs] : [];
  const hasCurrentSource = sourceRefs.some(ref => (
    ref
    && typeof ref === 'object'
    && (ref as Record<string, unknown>).type === 'chat'
    && (ref as Record<string, unknown>).workdir === ctx.workdir
    && (ref as Record<string, unknown>).agent === ctx.agent
    && (ref as Record<string, unknown>).sessionId === ctx.sessionId
  ));
  if (!hasCurrentSource && ctx.workdir && ctx.agent && ctx.sessionId) {
    sourceRefs.unshift({
      type: 'chat',
      workdir: ctx.workdir,
      agent: ctx.agent,
      sessionId: ctx.sessionId,
    });
  }
  try {
    const entry = createKnowledgeEntry({
      title: args.title,
      body: args.body,
      summary: args.summary,
      kind: args.kind,
      status: args.status,
      source: args.source as any,
      sourceRefs,
      artifactRefs: args.artifactRefs,
      confidence: args.confidence,
      createdBy: 'agent',
      tags: args.tags,
    });
    toolLog('pikiclaw_pro_save_knowledge', `entry=${entry.id} sourceRefs=${entry.sourceRefs.length} artifactRefs=${entry.artifactRefs.length}`);
    return toolResult(JSON.stringify({
      ok: true,
      entryId: entry.id,
      title: entry.title,
      kind: entry.kind,
      status: entry.status,
      sourceRefs: entry.sourceRefs.length,
      artifactRefs: entry.artifactRefs.length,
    }, null, 2));
  } catch (e: any) {
    return toolResult(`Error saving knowledge: ${e?.message || e}`, true);
  }
}

export const proTools: McpToolModule = {
  tools,
  handle(name, args, ctx) {
    switch (name) {
      case 'pikiclaw_pro_save_knowledge': return handleSaveKnowledge(args, ctx);
      case 'pikiclaw_pro_report_jira_sync_progress': return handleReportProgress(args);
      case 'pikiclaw_pro_sync_jira_issues': return handleSyncJiraIssues(args, ctx.workdir);
      case 'pikiclaw_pro_record_jira_sync_candidates': return handleRecordJiraSyncCandidates(args);
      case 'pikiclaw_pro_pull_jira_sync_candidates': return handlePullJiraSyncCandidates(args);
      default: return toolResult(`Unknown pro tool: ${name}`, true);
    }
  },
};
