/**
 * Dashboard API routes for Pikiclaw Pro workflow objects.
 */

import { Hono } from 'hono';
import { loadUserConfig } from '../../core/config/user-config.js';
import { runtime } from '../runtime.js';
import { queueDashboardSessionTask } from '../session-control.js';
import {
  addStageRun,
  createProTask,
  getProTask,
  isProTaskStage,
  isProTaskStatus,
  listProTasks,
  updateProTaskStatus,
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
