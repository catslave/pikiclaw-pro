/**
 * tools/pro.ts — Pikiclaw Pro workflow tools exposed to agent sessions.
 */

import type { McpToolModule, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';
import { syncJiraTask } from '../../../pro/tasks.js';
import { updateJiraSyncRun } from '../../../pro/workflow.js';

const tools: McpToolModule['tools'] = [
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
              reporter: { type: 'string' },
              assignee: { type: 'string' },
              status: { type: 'string' },
              ticketStatus: { type: 'string' },
              dueDate: { type: 'string' },
              priority: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              jiraUrl: { type: 'string' },
              url: { type: 'string' },
              sprint: { type: 'string' },
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

function handleSyncJiraIssues(args: Record<string, unknown>, workdir?: string): ToolResult {
  const issues = Array.isArray(args.issues) ? args.issues : [];
  if (!issues.length) return toolResult('Error: issues array is required', true);
  const runId = text(args.runId, 160);
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
        jiraUrl: text(issueField(issue, 'jiraUrl', 'url', 'browseUrl', 'webUrl'), 2048),
        sprint: text(issueField(issue, 'sprint', 'sprintName'), 120),
        workdir: text(issueField(issue, 'workdir'), 2048) || workdir,
        reporter: personName(issueField(issue, 'reporter')),
        assignee: personName(issueField(issue, 'assignee')),
        ticketStatus: namedValue(issueField(issue, 'ticketStatus', 'status')),
        dueDate: text(issueField(issue, 'dueDate', 'duedate'), 80),
        priority: namedValue(issueField(issue, 'priority')),
        labels: Array.isArray(issueField(issue, 'labels')) ? (issueField(issue, 'labels') as unknown[]).map(label => text(label, 120)).filter(Boolean) : undefined,
        rawFields: issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : undefined,
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
        updatedAt: task.updatedAt,
        syncAction: action,
      });
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  toolLog('pikiclaw_pro_sync_jira_issues', `synced=${tasks.length} errors=${errors.length}`);
  if (runId) {
    try {
      updateJiraSyncRun(runId, {
        status: errors.length ? 'failed' : 'completed',
        ticketCount: issues.length,
        taskCount: tasks.length,
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
  return toolResult(JSON.stringify({ ok: errors.length === 0, synced: tasks.length, counts, tasks, errors }, null, 2), errors.length > 0 && tasks.length === 0);
}

function handleReportProgress(args: Record<string, unknown>): ToolResult {
  const runId = text(args.runId, 160);
  const label = text(args.label, 240);
  if (!runId) return toolResult('Error: runId is required', true);
  if (!label) return toolResult('Error: label is required', true);
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

export const proTools: McpToolModule = {
  tools,
  handle(name, args, ctx) {
    switch (name) {
      case 'pikiclaw_pro_report_jira_sync_progress': return handleReportProgress(args);
      case 'pikiclaw_pro_sync_jira_issues': return handleSyncJiraIssues(args, ctx.workdir);
      default: return toolResult(`Unknown pro tool: ${name}`, true);
    }
  },
};
