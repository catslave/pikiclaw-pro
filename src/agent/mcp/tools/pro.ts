/**
 * tools/pro.ts — Pikiclaw Pro workflow tools exposed to agent sessions.
 */

import type { McpToolModule, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';
import { syncJiraTask } from '../../../pro/tasks.js';

const tools: McpToolModule['tools'] = [
  {
    name: 'pikiclaw_pro_sync_jira_issues',
    description: 'Create or update Pikiclaw Jira tasks from Jira issue data pulled by MCP tools. Use this after fetching Jira tickets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issues: {
          type: 'array',
          description: 'Jira issues to sync. Each item should include key/jiraKey, title/summary, description, issueType, url/jiraUrl, sprint.',
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
              jiraUrl: { type: 'string' },
              url: { type: 'string' },
              sprint: { type: 'string' },
              workdir: { type: 'string' },
            },
          },
        },
      },
      required: ['issues'],
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

function handleSyncJiraIssues(args: Record<string, unknown>, workdir?: string): ToolResult {
  const issues = Array.isArray(args.issues) ? args.issues : [];
  if (!issues.length) return toolResult('Error: issues array is required', true);

  const tasks = [];
  const errors = [];
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
        jiraUrl: text(issueField(issue, 'jiraUrl', 'url', 'browseUrl', 'webUrl'), 2048),
        sprint: text(issueField(issue, 'sprint', 'sprintName'), 120),
        workdir: text(issueField(issue, 'workdir'), 2048) || workdir,
      });
      tasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        kind: task.kind,
        jiraKey: task.jiraKey,
        sprint: task.sprint,
        updatedAt: task.updatedAt,
      });
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  toolLog('pikiclaw_pro_sync_jira_issues', `synced=${tasks.length} errors=${errors.length}`);
  return toolResult(JSON.stringify({ ok: errors.length === 0, synced: tasks.length, tasks, errors }, null, 2), errors.length > 0 && tasks.length === 0);
}

export const proTools: McpToolModule = {
  tools,
  handle(name, args, ctx) {
    switch (name) {
      case 'pikiclaw_pro_sync_jira_issues': return handleSyncJiraIssues(args, ctx.workdir);
      default: return toolResult(`Unknown pro tool: ${name}`, true);
    }
  },
};
