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
import {
  createAgentAssistant,
  createAutomationRule,
  createKnowledgeEntry,
  deleteAgentAssistant,
  getJiraWorkflowConfig,
  listAgentAssistants,
  listAutomationRules,
  listKnowledgeEntries,
  markAutomationRun,
  updateAgentAssistant,
  updateJiraWorkflowConfig,
} from '../../pro/workflow.js';

const app = new Hono();

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    const config = loadUserConfig();
    const queued = await queueDashboardSessionTask({
      workdir: automation.workdir || runtime.getRequestWorkdir(config),
      agent: automation.agent || null,
      sessionId: '',
      prompt: automation.prompt,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const updated = markAutomationRun(automation.id, queued.sessionKey);
    return c.json({ ok: true, automation: updated, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
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
