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
  createProTask,
  finishVerificationRun,
  getProTask,
  isProTaskStage,
  isProTaskStatus,
  listProTasks,
  setExclusiveMode,
  startVerificationRun,
  syncJiraTask,
  updateStageRun,
  updateProTaskStatus,
  type VerificationResult,
} from '../../pro/tasks.js';

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

    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || task.workdir || runtime.getRequestWorkdir(config);
    const prompt = readString(body?.prompt) || buildDefaultStagePrompt(task, stage);
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
    if (!session) return c.json({ ok: false, error: 'stage session was not created' }, 500);

    const updated = addStageRun({
      taskId,
      stage,
      prompt,
      session: { workdir, agent: session.agent, sessionId: session.sessionId },
      assistantId: readString(body?.assistantId) || undefined,
      selectedAgentReason: readString(body?.agent)
        ? 'Selected by user for this stage.'
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

function buildDefaultStagePrompt(task: NonNullable<ReturnType<typeof getProTask>>, stage: string): string {
  const common = [
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
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
