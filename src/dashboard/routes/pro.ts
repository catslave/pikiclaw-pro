/**
 * Dashboard API routes for Pikiclaw Pro workflow objects.
 */

import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { loadUserConfig } from '../../core/config/user-config.js';
import { runtime } from '../runtime.js';
import { queueDashboardSessionTask } from '../session-control.js';
import { getManagedBrowserStatus } from '../../browser-profile.js';
import {
  addStageRun,
  createSubtask,
  createProTask,
  deleteProTask,
  finishVerificationRun,
  getProTask,
  isProTaskStage,
  isProTaskStatus,
  isProSubtaskStatus,
  listProTasks,
  setExclusiveMode,
  startVerificationRun,
  syncJiraTask,
  updateStageRun,
  updateSubtask,
  updateProTaskStatus,
  type VerificationResult,
} from '../../pro/tasks.js';
import { createTodoItem, deleteTodoItem, getTodoItems, linkTodoChat, listTodoItems } from '../../pro/todos.js';
import { buildProUsageSummary } from '../../pro/usage-summary.js';
import {
  createAgentAssistant,
  createAutomationRule,
  createJiraSyncRun,
  createKnowledgeEntry,
  deleteAgentAssistant,
  getJiraWorkflowConfig,
  getJiraSyncRun,
  listAgentAssistants,
  listAutomationRules,
  listJiraSyncRuns,
  listKnowledgeEntries,
  markAutomationRun,
  updateAgentAssistant,
  updateJiraSyncRun,
  updateJiraWorkflowConfig,
  upsertAutomationRuleByKey,
  type AgentAssistant,
  type AutomationRule,
} from '../../pro/workflow.js';

const app = new Hono();
const JIRA_MCP_SYNC_AUTOMATION_KEY = 'jira-mcp-sync';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickAssistantAgent(assistant?: AgentAssistant, fallbackAgent?: string | null): string | null {
  const explicit = readString(fallbackAgent);
  if (explicit) return explicit;
  const preferred = assistant?.preferredAgents?.find(agent => readString(agent));
  return preferred || null;
}

function buildAssistantPrompt(prompt: string, assistant?: AgentAssistant): string {
  if (!assistant) return prompt;
  return [
    `You are running as Pikiclaw Assistant: ${assistant.name}`,
    '',
    'Assistant responsibility:',
    assistant.responsibility,
    '',
    'Task:',
    prompt,
  ].join('\n');
}

function buildJiraMcpSyncPrompt(runId?: string): string {
  return [
    'Sync Jira through the configured Jira/Atlassian MCP server.',
    runId ? `Jira sync run id: ${runId}` : '',
    '',
    'Requirements:',
    runId ? '- Immediately call `pikiclaw_pro_report_jira_sync_progress` with this runId before each visible step.' : '',
    runId ? '- Report which Jira MCP tool/query you are using, how many tickets you found, and when task writing starts.' : '',
    '- Use the Jira MCP tools to find issues assigned to me and recently updated issues relevant to my active work.',
    '- After pulling Jira issues, call the `pikiclaw_pro_sync_jira_issues` MCP tool with an `issues` array so Pikiclaw creates or updates task cards.',
    runId ? '- Include the same runId when calling `pikiclaw_pro_sync_jira_issues`.' : '',
    '- Each issue passed to that tool should include jiraKey/key, title/summary, description, issueType, jiraUrl/url, and sprint when available.',
    '- Sync Jira tickets into Pikiclaw task context: keep title, description, ticket key, link, sprint/status, and changed remote notes.',
    '- Append remote updates as new notes instead of overwriting existing local task context.',
    '- Mark newly assigned tickets and changed tickets clearly.',
    '- Summarize what was synced, what changed, and anything that needs manual attention.',
  ].filter(Boolean).join('\n');
}

async function queueAutomationRule(rule: AutomationRule) {
  const config = loadUserConfig();
  const assistant = rule.assistantId ? listAgentAssistants().find(item => item.id === rule.assistantId) : undefined;
  const agent = pickAssistantAgent(assistant, rule.agent);
  const workdir = rule.workdir || runtime.getRequestWorkdir(config);
  const syncRun = rule.key === JIRA_MCP_SYNC_AUTOMATION_KEY
    ? createJiraSyncRun({ assistantId: rule.assistantId, assistantName: assistant?.name, agent, workdir })
    : null;
  if (syncRun) {
    updateJiraSyncRun(syncRun.id, {
      status: 'starting',
      event: { label: 'Scheduled sync triggered', detail: `${rule.schedule} · ${assistant?.name || 'assistant'} · ${agent || runtime.getRuntimeDefaultAgent(config)}` },
    });
  }
  const queued = await queueDashboardSessionTask({
    workdir,
    agent,
    sessionId: '',
    prompt: buildAssistantPrompt(syncRun ? buildJiraMcpSyncPrompt(syncRun.id) : rule.prompt, assistant),
    attachments: [],
  });
  if (!queued.ok) {
    if (syncRun) updateJiraSyncRun(syncRun.id, { status: 'failed', error: queued.error, event: { label: 'Failed to start scheduled sync session', detail: queued.error } });
    return { queued, updated: markAutomationRun(rule.id, undefined) };
  }
  if (syncRun) updateJiraSyncRun(syncRun.id, { status: 'queued', sessionKey: queued.sessionKey, event: { label: 'Scheduled agent session queued', detail: queued.sessionKey || queued.taskId || 'Queued' } });
  return { queued, updated: markAutomationRun(rule.id, queued.sessionKey) };
}

function parseSchedule(schedule: string): { cadence: string; time: string; weekday?: number; day?: number } | null {
  const raw = readString(schedule);
  if (!raw || raw === 'manual' || raw === 'one-time') return null;
  if (raw === 'daily') return { cadence: 'daily', time: '09:00' };
  if (raw === 'weekly') return { cadence: 'weekly', weekday: 1, time: '09:00' };
  if (raw === 'biweekly') return { cadence: 'biweekly', weekday: 1, time: '09:00' };
  if (raw === 'monthly') return { cadence: 'monthly', day: 1, time: '09:00' };
  const parts = raw.split('@');
  const cadence = parts[0] || '';
  const time = parts[parts.length - 1] || '';
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  if (cadence === 'daily') return { cadence, time };
  if (cadence === 'weekly' || cadence === 'biweekly') {
    const weekday = Number(parts[1] ?? 1);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    return { cadence, weekday, time };
  }
  if (cadence === 'monthly') {
    const day = Number(parts[1] ?? 1);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    return { cadence, day, time };
  }
  return null;
}

function automationDueSlot(rule: AutomationRule, now = new Date()): string | null {
  if (!rule.enabled) return null;
  const parsed = parseSchedule(rule.schedule);
  if (!parsed) return null;
  const [hour, minute] = parsed.time.split(':').map(Number);
  if (now.getHours() !== hour || now.getMinutes() !== minute) return null;
  const dateKey = now.toISOString().slice(0, 10);
  if (parsed.cadence === 'daily') return `${rule.id}:${dateKey}:${parsed.time}`;
  if (parsed.cadence === 'weekly') {
    if (now.getDay() !== parsed.weekday) return null;
    return `${rule.id}:week:${dateKey}:${parsed.time}`;
  }
  if (parsed.cadence === 'biweekly') {
    if (now.getDay() !== parsed.weekday) return null;
    const week = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
    if (week % 2 !== 0) return null;
    return `${rule.id}:biweek:${dateKey}:${parsed.time}`;
  }
  if (parsed.cadence === 'monthly') {
    if (now.getDate() !== parsed.day) return null;
    return `${rule.id}:month:${dateKey}:${parsed.time}`;
  }
  return null;
}

const runningScheduleSlots = new Set<string>();

async function runDueAutomations() {
  for (const rule of listAutomationRules()) {
    const slot = automationDueSlot(rule);
    if (!slot || runningScheduleSlots.has(slot)) continue;
    const lastRunKey = rule.lastRunAt ? automationDueSlot({ ...rule, lastRunAt: undefined }, new Date(rule.lastRunAt)) : null;
    if (lastRunKey === slot) continue;
    runningScheduleSlots.add(slot);
    void queueAutomationRule(rule).finally(() => {
      setTimeout(() => runningScheduleSlots.delete(slot), 70_000);
    });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __pikiclawProAutomationSchedulerStarted: boolean | undefined;
}

if (!globalThis.__pikiclawProAutomationSchedulerStarted) {
  globalThis.__pikiclawProAutomationSchedulerStarted = true;
  setInterval(() => { void runDueAutomations(); }, 60_000).unref?.();
  setTimeout(() => { void runDueAutomations(); }, 5_000).unref?.();
}

function parseSessionKey(sessionKey: string | null | undefined): { agent: string; sessionId: string } | null {
  const raw = readString(sessionKey);
  if (!raw) return null;
  const index = raw.indexOf(':');
  if (index <= 0 || index >= raw.length - 1) return null;
  return { agent: raw.slice(0, index), sessionId: raw.slice(index + 1) };
}

app.get('/api/pro/tasks', (c) => {
  return c.json({ ok: true, tasks: listProTasks() });
});

app.get('/api/pro/usage-summary', async (c) => {
  try {
    return c.json({ ok: true, summary: await buildProUsageSummary(c.req.query('limit')) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/todos', (c) => {
  return c.json({ ok: true, items: listTodoItems() });
});

app.post('/api/pro/todos', async (c) => {
  try {
    const body = await c.req.json();
    const item = createTodoItem({
      kind: body?.kind,
      title: body?.title,
      body: body?.body,
      source: body?.source,
    });
    return c.json({ ok: true, item });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.delete('/api/pro/todos/:todoId', (c) => {
  try {
    const item = deleteTodoItem(c.req.param('todoId'));
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'todo not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/todos/chat', async (c) => {
  try {
    const body = await c.req.json();
    const todoIds = Array.isArray(body?.todoIds) ? body.todoIds.map(String) : [];
    const items = getTodoItems(todoIds);
    if (!items.length) return c.json({ ok: false, error: 'todoIds are required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || items.find(item => item.source?.workdir)?.source?.workdir || runtime.getRequestWorkdir(config);
    const userPrompt = readString(body?.prompt);
    const prompt = [
      'Please start a focused chat for the following captured todo/review items.',
      '',
      ...items.map((item, index) => [
        `Item ${index + 1}: ${item.title}`,
        item.body ? `Note: ${item.body}` : '',
        item.source?.quote ? `Quoted context:\n${item.source.quote}` : '',
        item.source?.agent && item.source?.sessionId ? `Source session: ${item.source.agent}:${item.source.sessionId}${typeof item.source.turnIndex === 'number' ? ` turn ${item.source.turnIndex}` : ''}` : '',
      ].filter(Boolean).join('\n')),
      userPrompt ? `\nUser instruction:\n${userPrompt}` : '',
    ].join('\n\n');
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: readString(body?.agent) || null,
      sessionId: '',
      prompt,
      model: readString(body?.model) || null,
      effort: readString(body?.effort) || null,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const session = parseSessionKey(queued.sessionKey);
    if (session) {
      for (const item of items) {
        linkTodoChat(item.id, { workdir, agent: session.agent, sessionId: session.sessionId });
      }
    }
    return c.json({ ok: true, queued, items: getTodoItems(items.map(item => item.id)) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/review-comments', async (c) => {
  try {
    const body = await c.req.json();
    const item = createTodoItem({
      kind: 'review-comment',
      title: body?.title,
      body: body?.body,
      source: { ...(body?.source || {}), type: 'review-comment' },
    });
    return c.json({ ok: true, item });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/assistants', (c) => {
  return c.json({ ok: true, assistants: listAgentAssistants() });
});

app.get('/api/pro/jira/config', (c) => {
  return c.json({ ok: true, config: getJiraWorkflowConfig() });
});

app.patch('/api/pro/jira/config', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ ok: true, config: updateJiraWorkflowConfig({
      refinementAssistantId: body?.refinementAssistantId,
      codingAssistantId: body?.codingAssistantId,
      ticketSyncAssistantId: body?.ticketSyncAssistantId,
      knowledgeAssistantId: body?.knowledgeAssistantId,
      runKnowledgeOnRefinement: body?.runKnowledgeOnRefinement,
      runKnowledgeOnCoding: body?.runKnowledgeOnCoding,
    }) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/assistants', async (c) => {
  try {
    const body = await c.req.json();
    const assistant = createAgentAssistant({
      name: body?.name,
      responsibility: body?.responsibility,
      preferredAgents: body?.preferredAgents,
    });
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/assistants/:assistantId', async (c) => {
  try {
    const body = await c.req.json();
    const assistant = updateAgentAssistant(c.req.param('assistantId'), {
      name: body?.name,
      responsibility: body?.responsibility,
      preferredAgents: body?.preferredAgents,
    });
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/assistants/:assistantId', (c) => {
  try {
    const assistant = deleteAgentAssistant(c.req.param('assistantId'));
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/automations', (c) => {
  return c.json({ ok: true, automations: listAutomationRules() });
});

app.post('/api/pro/automations', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const automation = createAutomationRule({
      key: body?.key,
      name: body?.name,
      schedule: body?.schedule,
      prompt: body?.prompt,
      workdir: body?.workdir || runtime.getRequestWorkdir(config),
      agent: body?.agent,
      assistantId: body?.assistantId,
      enabled: body?.enabled,
    });
    return c.json({ ok: true, automation });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/automations/:automationId/run', async (c) => {
  try {
    const automation = listAutomationRules().find(item => item.id === c.req.param('automationId'));
    if (!automation) return c.json({ ok: false, error: 'automation not found' }, 404);
    const { queued, updated } = await queueAutomationRule(automation);
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, automation: updated, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/jira/mcp-sync/run', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config = loadUserConfig();
    const assistantId = readString(body?.assistantId) || getJiraWorkflowConfig().ticketSyncAssistantId;
    const assistant = assistantId ? listAgentAssistants().find(item => item.id === assistantId) : undefined;
    const agent = pickAssistantAgent(assistant, readString(body?.agent) || null);
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const run = createJiraSyncRun({ assistantId, assistantName: assistant?.name, agent, workdir });
    updateJiraSyncRun(run.id, {
      status: 'starting',
      event: {
        label: `Using ${assistant?.name || 'selected assistant'}`,
        detail: `Agent: ${agent || runtime.getRuntimeDefaultAgent(config)} · Workdir: ${workdir}`,
      },
    });
    const queued = await queueDashboardSessionTask({
      workdir,
      agent,
      sessionId: '',
      prompt: buildAssistantPrompt(buildJiraMcpSyncPrompt(run.id), assistant),
      attachments: [],
    });
    if (!queued.ok) {
      updateJiraSyncRun(run.id, {
        status: 'failed',
        error: queued.error,
        event: { label: 'Failed to start sync session', detail: queued.error },
      });
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const updated = updateJiraSyncRun(run.id, {
      status: 'queued',
      sessionKey: queued.sessionKey,
      event: { label: 'Agent session queued', detail: queued.sessionKey || queued.taskId || 'Queued' },
    });
    return c.json({ ok: true, queued, run: updated });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/jira/mcp-sync/runs', (c) => {
  return c.json({ ok: true, runs: listJiraSyncRuns() });
});

app.get('/api/pro/jira/mcp-sync/runs/:runId', (c) => {
  const run = getJiraSyncRun(c.req.param('runId'));
  if (!run) return c.json({ ok: false, error: 'jira sync run not found' }, 404);
  return c.json({ ok: true, run });
});

app.post('/api/pro/jira/mcp-sync/schedule', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const schedule = readString(body?.schedule);
    if (!schedule || !parseSchedule(schedule)) return c.json({ ok: false, error: 'valid schedule is required' }, 400);
    const assistantId = readString(body?.assistantId) || getJiraWorkflowConfig().ticketSyncAssistantId;
    const automation = upsertAutomationRuleByKey(JIRA_MCP_SYNC_AUTOMATION_KEY, {
      name: 'Jira MCP sync',
      schedule,
      prompt: buildJiraMcpSyncPrompt(),
      workdir: readString(body?.workdir) || runtime.getRequestWorkdir(config),
      assistantId,
      enabled: body?.enabled !== false,
    });
    return c.json({ ok: true, automation });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/knowledge', (c) => {
  return c.json({ ok: true, knowledge: listKnowledgeEntries() });
});

app.post('/api/pro/knowledge', async (c) => {
  try {
    const body = await c.req.json();
    const entry = createKnowledgeEntry({
      title: body?.title,
      body: body?.body,
      source: body?.source,
      tags: body?.tags,
    });
    return c.json({ ok: true, entry });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/skill-quick-setup', async (c) => {
  try {
    const body = await c.req.json();
    const repo = readString(body?.repo);
    if (!repo) return c.json({ ok: false, error: 'repo is required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const prompt = [
      'Quick setup this GitHub project for me.',
      '',
      `Repository: ${repo}`,
      '',
      'Requirements:',
      '- Inspect the repository README and install/setup docs.',
      '- Clone or use the repository as appropriate inside this workspace.',
      '- Install required dependencies with the safest package manager implied by the repo.',
      '- Run the documented validation command or the closest local smoke test.',
      '- Report exact commands executed, files changed, and anything that still needs manual credentials.',
    ].join('\n');
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: readString(body?.agent) || null,
      sessionId: '',
      prompt,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/skill-command', async (c) => {
  try {
    const body = await c.req.json();
    const command = readString(body?.command);
    const environment = readString(body?.environment);
    const subject = readString(body?.subject);
    if (!['test', 'login', 'create-account'].includes(command)) {
      return c.json({ ok: false, error: 'unsupported command' }, 400);
    }
    if (!environment) return c.json({ ok: false, error: 'environment is required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const displayCommand = command === 'create-account' ? 'create account' : command;
    const slashCommand = command === 'create-account'
      ? `/create ${environment} account`
      : `/${command} ${environment}${subject ? ` ${subject}` : ''}`;
    const prompt = [
      `Execute Pikiclaw skill command: ${slashCommand}`,
      '',
      `Action: ${displayCommand}`,
      `Environment: ${environment}`,
      subject ? `Subject: ${subject}` : '',
      '',
      'Requirements:',
      '- Use the managed browser/profile if login or UI validation is needed.',
      '- For test, open the target environment, validate the requested flow, and summarize the result/status.',
      '- For login, open the environment and complete or verify login state.',
      '- For create account, prepare the account flow and report the created account handoff without exposing secrets in logs.',
      '- When the browser is closed or the flow finishes, return a concise execution result that can update the task/test state.',
    ].filter(Boolean).join('\n');
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: readString(body?.agent) || null,
      sessionId: '',
      prompt,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/tasks/:taskId', (c) => {
  const task = getProTask(c.req.param('taskId'));
  if (!task) return c.json({ ok: false, error: 'task not found' }, 404);
  return c.json({ ok: true, task });
});

app.delete('/api/pro/tasks/:taskId', (c) => {
  try {
    const task = deleteProTask(c.req.param('taskId'));
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const task = createProTask({
      title: body?.title,
      description: body?.description,
      kind: body?.kind,
      status: body?.status,
      workdir: body?.workdir || runtime.getRequestWorkdir(config),
      defaultAgent: body?.defaultAgent,
      defaultAssistantId: body?.defaultAssistantId,
      jiraKey: body?.jiraKey,
      jiraUrl: body?.jiraUrl,
      sprint: body?.sprint,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/jira/sync', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const issues = readString(body?.baseUrl) && readString(body?.token)
      ? await fetchJiraIssues({
          baseUrl: body.baseUrl,
          token: body.token,
          jql: body.jql,
          email: body.email,
          sprint: body.sprint,
          workdir: body.workdir || runtime.getRequestWorkdir(config),
        })
      : Array.isArray(body?.issues)
      ? body.issues
      : [{
          title: body?.title,
          description: body?.description,
          issueType: body?.issueType,
          jiraKey: body?.jiraKey,
          jiraUrl: body?.jiraUrl,
          sprint: body?.sprint,
          workdir: body?.workdir,
        }];
    const tasks = issues.map((issue: any) => syncJiraTask({
      title: issue?.title,
      description: issue?.description,
      issueType: issue?.issueType,
      jiraKey: issue?.jiraKey,
      jiraUrl: issue?.jiraUrl,
      sprint: issue?.sprint,
      workdir: issue?.workdir || runtime.getRequestWorkdir(config),
    }));
    return c.json({ ok: true, tasks });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/tasks/:taskId/status', async (c) => {
  try {
    const body = await c.req.json();
    const status = readString(body?.status);
    if (!isProTaskStatus(status)) return c.json({ ok: false, error: 'invalid status' }, 400);
    const task = updateProTaskStatus(c.req.param('taskId'), status);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/exclusive-mode', async (c) => {
  try {
    const body = await c.req.json();
    const task = setExclusiveMode(c.req.param('taskId'), !!body?.enabled);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/stage-runs', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const task = getProTask(taskId);
    if (!task) return c.json({ ok: false, error: 'task not found' }, 404);

    const body = await c.req.json();
    const stage = readString(body?.stage);
    if (!isProTaskStage(stage)) return c.json({ ok: false, error: 'invalid stage' }, 400);

    const assistantId = readString(body?.assistantId) || task.defaultAssistantId || undefined;
    const assistant = assistantId ? listAgentAssistants().find(item => item.id === assistantId) : undefined;
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || task.workdir || runtime.getRequestWorkdir(config);
    const prompt = readString(body?.prompt) || buildDefaultStagePrompt(task, stage, assistant);
    const requestedAgent = readString(body?.agent) || task.defaultAgent || assistant?.preferredAgents?.[0] || null;
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: requestedAgent,
      sessionId: '',
      prompt,
      model: readString(body?.model) || null,
      effort: readString(body?.effort) || null,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const session = parseSessionKey(queued.sessionKey);
    if (!session) return c.json({ ok: false, error: 'stage session was not created' }, 500);

    const updated = addStageRun({
      taskId,
      stage,
      prompt,
      session: { workdir, agent: session.agent, sessionId: session.sessionId },
      assistantId,
      selectedAgentReason: requestedAgent
        ? assistant
          ? `Selected by ${assistant.name}.`
          : 'Selected by task default or user stage setting.'
        : 'Selected by Pikiclaw runtime default agent.',
    });
    return c.json({ ok: true, task: updated, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.patch('/api/pro/tasks/:taskId/stage-runs/:stageRunId', async (c) => {
  try {
    const body = await c.req.json();
    const status = readString(body?.status);
    const task = updateStageRun(c.req.param('taskId'), c.req.param('stageRunId'), {
      ...(status ? { status: status as any } : {}),
      summary: body?.summary,
      estimate: body?.estimate,
      branch: body?.branch,
      diffSummary: body?.diffSummary,
      changedFiles: Array.isArray(body?.changedFiles) ? body.changedFiles : undefined,
      testResultId: body?.testResultId,
      knowledgeRefs: Array.isArray(body?.knowledgeRefs) ? body.knowledgeRefs : undefined,
      focus: body?.focus,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/subtasks', async (c) => {
  try {
    const body = await c.req.json();
    const task = createSubtask(c.req.param('taskId'), {
      title: body?.title,
      description: body?.description,
      status: body?.status,
      assignedAgent: body?.assignedAgent,
      assistantId: body?.assistantId,
      workdir: body?.workdir,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/subtasks/:subtaskId', async (c) => {
  try {
    const body = await c.req.json();
    const rawStatus = readString(body?.status);
    if (rawStatus && !isProSubtaskStatus(rawStatus)) return c.json({ ok: false, error: 'invalid subtask status' }, 400);
    const task = updateSubtask(c.req.param('taskId'), c.req.param('subtaskId'), {
      title: body?.title,
      description: body?.description,
      status: body?.status,
      assignedAgent: body?.assignedAgent,
      assistantId: body?.assistantId,
      workdir: body?.workdir,
      stageRunId: body?.stageRunId,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/verification-runs', async (c) => {
  try {
    const body = await c.req.json();
    const task = startVerificationRun(c.req.param('taskId'), {
      environment: body?.environment,
      url: body?.url,
      stageRunId: body?.stageRunId,
      pipeline: body?.pipeline,
    });
    const latest = task.verificationRuns[0];
    if (latest?.browserSession?.url) void openUrl(latest.browserSession.url);
    return c.json({ ok: true, task, verificationRun: latest });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/verification-runs/:verificationRunId', async (c) => {
  try {
    const body = await c.req.json();
    const rawResult = readString(body?.result);
    const result = isVerificationResult(rawResult) ? rawResult : 'not-run';
    const task = finishVerificationRun(c.req.param('taskId'), c.req.param('verificationRunId'), result, body?.notes);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

function isVerificationResult(value: string): value is VerificationResult {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'not-run';
}

async function fetchJiraIssues(opts: {
  baseUrl: string;
  token: string;
  email?: string;
  jql?: string;
  sprint?: string;
  workdir?: string;
}) {
  const baseUrl = readString(opts.baseUrl).replace(/\/+$/, '');
  const token = readString(opts.token);
  if (!baseUrl || !token) throw new Error('baseUrl and token are required');
  const params = new URLSearchParams();
  params.set('jql', readString(opts.jql) || 'assignee = currentUser() ORDER BY updated DESC');
  params.set('maxResults', '50');
  params.set('fields', 'summary,description,issuetype,assignee,status,updated');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const email = readString(opts.email);
  headers.Authorization = email
    ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
    : `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/rest/api/3/search?${params.toString()}`, { headers });
  if (!response.ok) {
    throw new Error(`Jira sync failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { issues?: any[] };
  return (payload.issues || []).map(issue => ({
    jiraKey: issue?.key,
    jiraUrl: issue?.key ? `${baseUrl}/browse/${issue.key}` : undefined,
    title: issue?.fields?.summary || issue?.key || 'Untitled Jira issue',
    description: jiraDescriptionToText(issue?.fields?.description),
    issueType: issue?.fields?.issuetype?.name,
    sprint: opts.sprint,
    workdir: opts.workdir,
  }));
}

function jiraDescriptionToText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const chunks: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') chunks.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };
  visit(value);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function openUrl(url: string) {
  const browser = getManagedBrowserStatus();
  if (browser.launchCommand.length) {
    const [command, ...args] = browser.launchCommand;
    execFile(command, [...args, url], (error) => {
      if (error) fallbackOpenUrl(url);
    });
    return;
  }
  fallbackOpenUrl(url);
}

function fallbackOpenUrl(url: string) {
  const opener = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(opener, args, () => {});
}

function buildDefaultStagePrompt(task: NonNullable<ReturnType<typeof getProTask>>, stage: string, assistant?: ReturnType<typeof listAgentAssistants>[number]): string {
  const common = [
    assistant ? `Assistant: ${assistant.name}\nResponsibility:\n${assistant.responsibility}` : '',
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
    task.subTasks?.length
      ? `Subtasks:\n${task.subTasks.map((subtask, index) => `${index + 1}. [${subtask.status}] ${subtask.title}${subtask.assignedAgent ? ` (agent: ${subtask.assignedAgent})` : ''}`).join('\n')}`
      : 'Subtasks: none yet. If the work naturally spans multiple projects or independent streams, propose subtasks with title, scope, recommended agent/assistant, and dependencies.',
  ].filter(Boolean).join('\n\n');

  if (stage === 'focus') {
    return `${common}\n\nEnter Focus Mode. Discuss the requirement with me before coding. Keep asking for goal, boundary, constraints, risks, and acceptance criteria until they are clear. Maintain a concise mind-map outline in markdown with nodes for Goal, Scope, Non-goals, Constraints, Risks, Acceptance Criteria, Open Questions, and Plan. End with an estimated completion time split into coding, user understanding, review, and verification time.`;
  }
  if (stage === 'refinement') {
    return `${common}\n\nRefine this task. Analyze goal, scope, risks, dependencies, acceptance criteria, implementation approach, estimate point, and estimated completion time split into coding, user understanding, review, and verification time. Do not modify files yet.`;
  }
  if (stage === 'coding') {
    return `${common}\n\nImplement this task with minimal changes. After coding, summarize branch/status, changed files, tests run, remaining uncertainty, and verification steps.`;
  }
  if (stage === 'verification' || stage === 'demo') {
    return `${common}\n\nPrepare ${stage} for this task. Identify the target environment, deployment/pipeline checks needed, browser entry URL if known, login assumptions, and the manual steps I should verify. Do not proceed with destructive actions.`;
  }
  if (stage === 'bugfix') {
    return `${common}\n\nAnalyze the reported bug, identify likely root cause, propose a minimal fix, implement it if enough evidence is available, and summarize verification steps.`;
  }
  return `${common}\n\nWork on the ${stage} stage for this task and summarize the result.`;
}

export default app;
