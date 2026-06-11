/**
 * Dashboard Focus routes: Daily Command Center overview and maintenance.
 */

import path from 'node:path';
import { Hono } from 'hono';
import { loadUserConfig, type WorkspaceEntry } from '../../core/config/user-config.js';
import { runtime } from '../runtime.js';
import { queueFocusExtraction } from '../focus-service.js';
import { buildFocusCommandCenter, inspectFocusGit } from '../focus-command-center.js';
import { buildDigestIndex, queueFocusDigest, queueStaleDigests } from '../focus-digest-service.js';
import {
  createFocusSandbox,
  enforceFocusActiveCap,
  getFocusSandbox,
  listFocusSandboxes,
  promoteFocusSandbox,
  updateFocusSandbox,
} from '../focus-sandbox-store.js';
import {
  buildOrchestratorPrompt,
  buildRulesOrchestratorPlan,
  loadOrchestratorMeta,
  loadOrchestratorPlan,
  resolveChiefOfStaffAgentId,
  saveOrchestratorPlan,
} from '../focus-orchestrator.js';
import {
  collectFocusSensorSnapshot,
  loadSensorSnapshot,
  saveSensorSnapshot,
} from '../focus-sensors/index.js';
import {
  loadWorkspaces,
  querySessions,
  updateSession,
  resolveUserStatus,
  type WorkspaceSessionInfo,
} from '../../bot/session-hub.js';
import type { Agent, SessionInfo, SessionOutput } from '../../agent/index.js';
import {
  focusSessionKey,
  getSessionValueSignals,
  hasKnowledgeForSession,
  isAutoSinkEligible,
  isKnowledgeCandidate,
} from '../../pro/focus.js';
import {
  createJiraRemoteUpdateRun,
  getAgentAssistant,
  getJiraWorkflowConfig,
  listKnowledgeEntries,
} from '../../pro/workflow.js';
import { getProTask, listProTasks } from '../../pro/tasks.js';
import { normalizeSandboxKind, normalizeSandboxState, normalizeSessionRef } from '../../pro/sandbox.js';
import { queueDashboardSessionTask } from '../session-control.js';

const app = new Hono();

function allWorkspaces(): WorkspaceEntry[] {
  const config = loadUserConfig();
  const currentWorkdir = runtime.getRequestWorkdir(config);
  const seen = new Set<string>();
  const workspaces = [...loadWorkspaces()];
  if (currentWorkdir && !workspaces.some(item => path.resolve(item.path) === path.resolve(currentWorkdir))) {
    workspaces.unshift({
      name: path.basename(currentWorkdir),
      path: currentWorkdir,
      addedAt: new Date().toISOString(),
    });
  }
  return workspaces.filter(workspace => {
    const key = path.resolve(workspace.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sessionTime(session: SessionInfo): number {
  return Date.parse(session.runUpdatedAt || session.createdAt || '') || 0;
}

function isAttentionSession(session: SessionInfo): boolean {
  if (session.archived) return false;
  if (session.running || session.runState === 'running' || session.runState === 'incomplete') return true;
  if (session.classification?.outcome === 'blocked' || session.classification?.outcome === 'partial') return true;
  const status = resolveUserStatus(session);
  return status === 'active' || status === 'review';
}

function isFocusExtractionSession(session: SessionInfo): boolean {
  return typeof session.origin?.chatId === 'string' && session.origin.chatId.startsWith('focus-knowledge:');
}

function publicSessionItem(session: WorkspaceSessionInfo) {
  return {
    key: focusSessionKey(session.workdir, session.agent, session.sessionId),
    workdir: session.workdir,
    workspaceName: session.workspaceName,
    agent: session.agent,
    sessionId: session.sessionId,
    session,
    signals: getSessionValueSignals(session),
  };
}

function publicOutputItem(output: SessionOutput, session: WorkspaceSessionInfo) {
  return {
    id: output.id,
    kind: output.kind,
    title: output.title,
    summary: output.summary,
    path: output.path,
    url: output.url,
    createdAt: output.createdAt,
    workdir: output.session?.workdir || session.workdir,
    workspaceName: session.workspaceName,
    agent: output.session?.agent || session.agent,
    sessionId: output.session?.sessionId || session.sessionId,
    sessionTitle: session.title,
    output,
  };
}

async function loadFocusSessions() {
  const results = await Promise.all(allWorkspaces().map(async workspace => {
    try {
      return await querySessions({ workdir: workspace.path, archiveMode: 'all' });
    } catch (error: any) {
      return {
        ok: false,
        workdir: workspace.path,
        workspaceName: workspace.name,
        sessions: [] as WorkspaceSessionInfo[],
        statusCounts: { inbox: 0, active: 0, review: 0, done: 0, parked: 0, unknown: 0 },
        total: 0,
        errors: [error?.message || String(error)],
      };
    }
  }));
  return {
    sessions: results.flatMap(result => result.sessions),
    workspaces: allWorkspaces(),
    errors: results.flatMap(result => result.errors || []),
  };
}

async function buildOverviewPayload(options?: { userIntent?: string | null; orchestrate?: boolean }) {
  enforceFocusActiveCap();
  const { sessions, workspaces, errors } = await loadFocusSessions();
  const knowledge = listKnowledgeEntries({ status: 'published' });
  const hiddenKnowledgeCount = listKnowledgeEntries({ status: 'hidden' }).length;
  const digestBySessionKey = buildDigestIndex(knowledge);
  const tasks = listProTasks();
  const attention = sessions
    .filter(isAttentionSession)
    .sort((a, b) => sessionTime(b) - sessionTime(a))
    .slice(0, 80)
    .map(publicSessionItem);
  const outputs = sessions
    .flatMap(session => (session.outputs || []).map(output => publicOutputItem(output, session)))
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
    .slice(0, 120);
  const recentlySunk = sessions
    .filter(session => session.archived && session.archivedAt)
    .sort((a, b) => Date.parse(b.archivedAt || '') - Date.parse(a.archivedAt || ''))
    .slice(0, 60)
    .map(publicSessionItem);
  const candidates = sessions
    .filter(session => !isFocusExtractionSession(session) && isKnowledgeCandidate(session) && !hasKnowledgeForSession(knowledge, session))
    .map(publicSessionItem)
    .slice(0, 80);
  const git = await inspectFocusGit(workspaces);
  const persistedSandboxes = listFocusSandboxes();
  const baseCommand = buildFocusCommandCenter({
    sessions,
    tasks,
    workspaces,
    knowledge,
    hiddenKnowledgeCount,
    outputs,
    candidateCount: candidates.length,
    git,
    persistedSandboxes,
    digestBySessionKey,
  });
  const sensorSnapshot = await collectFocusSensorSnapshot({
    workspaces,
    sessions,
    tasks,
    activeSandboxes: baseCommand.sandboxes.active,
  });
  saveSensorSnapshot(sensorSnapshot);
  const fallbackPlan = buildRulesOrchestratorPlan({
    snapshot: sensorSnapshot,
    recommendations: baseCommand.standup.recommendations,
    userIntent: options?.userIntent || null,
  });
  let plan = loadOrchestratorPlan(sensorSnapshot.localDay) || fallbackPlan;
  if (options?.orchestrate || options?.userIntent) {
    plan = fallbackPlan;
    const assistant = getAgentAssistant(resolveChiefOfStaffAgentId());
    const preferredAgent = assistant?.preferredAgents?.find(Boolean) || null;
    if (preferredAgent && getJiraWorkflowConfig().focusAdvancedSensorsEnabled !== false) {
      void queueDashboardSessionTask({
        workdir: workspaces[0]?.path || process.cwd(),
        agent: preferredAgent,
        sessionId: '',
        prompt: buildOrchestratorPrompt(sensorSnapshot, baseCommand.standup.recommendations, options?.userIntent || null),
        origin: { channel: 'task', chatId: `focus-orchestrator:${sensorSnapshot.localDay}` },
      });
    }
    saveOrchestratorPlan(sensorSnapshot.localDay, plan);
  }
  const commandCenter = buildFocusCommandCenter({
    sessions,
    tasks,
    workspaces,
    knowledge,
    hiddenKnowledgeCount,
    outputs,
    candidateCount: candidates.length,
    git,
    persistedSandboxes,
    digestBySessionKey,
    orchestratorHeadline: plan.headline,
    orchestratorRecommendations: plan.recommendations,
  });
  if (options?.userIntent) {
    commandCenter.canvas = [
      ...(commandCenter.canvas || []),
      { type: 'intent-echo', userIntent: options.userIntent, revisedHeadline: plan.headline },
    ];
  }
  return {
    workspaces,
    commandCenter,
    attention,
    knowledge,
    outputs,
    recentlySunk,
    candidates,
    errors,
    sensorSnapshot,
    orchestratorMeta: {
      ...loadOrchestratorMeta(),
      userIntent: plan.userIntent || null,
      source: plan.source,
    },
  };
}

app.get('/api/focus/overview', async (c) => {
  const orchestrate = c.req.query('orchestrate') === '1';
  const payload = await buildOverviewPayload({ orchestrate });
  return c.json({ ok: true, ...payload });
});

app.post('/api/focus/orchestrate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const payload = await buildOverviewPayload({
    orchestrate: true,
    userIntent: typeof body?.userIntent === 'string' ? body.userIntent.trim() : null,
  });
  return c.json({ ok: true, ...payload });
});

app.post('/api/focus/intent', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userIntent = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!userIntent) return c.json({ ok: false, error: 'text is required' }, 400);
  const payload = await buildOverviewPayload({ orchestrate: true, userIntent });
  return c.json({ ok: true, ...payload });
});

app.get('/api/focus/sandboxes/search', (c) => {
  const query = c.req.query('q') || undefined;
  const stateRaw = c.req.query('state');
  const state = stateRaw ? stateRaw.split(',').map(item => normalizeSandboxState(item)).filter(Boolean) : undefined;
  const kind = normalizeSandboxKind(c.req.query('kind') || undefined) || undefined;
  return c.json({ ok: true, sandboxes: listFocusSandboxes({ query, state: state as any, kind }) });
});

app.post('/api/focus/sandboxes', async (c) => {
  try {
    const body = await c.req.json();
    const kind = normalizeSandboxKind(body?.kind);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const workdir = typeof body?.workdir === 'string' ? body.workdir.trim() : '';
    if (!kind || !title || !workdir) return c.json({ ok: false, error: 'kind, title, and workdir are required' }, 400);
    const sandbox = createFocusSandbox({
      kind,
      title,
      workdir,
      jiraKey: body?.jiraKey,
      taskId: body?.taskId,
      sessionRef: normalizeSessionRef(body?.sessionRef),
      branch: body?.branch,
      fileGlobs: Array.isArray(body?.fileGlobs) ? body.fileGlobs : undefined,
    });
    return c.json({ ok: true, sandbox });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/focus/sandboxes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const state = body?.state !== undefined ? normalizeSandboxState(body.state) : undefined;
    if (body?.state !== undefined && !state) return c.json({ ok: false, error: 'invalid state' }, 400);
    const sandbox = updateFocusSandbox(id, {
      state: state || undefined,
      title: body?.title,
      branch: body?.branch,
      fileGlobs: Array.isArray(body?.fileGlobs) ? body.fileGlobs : undefined,
    });
    if (!sandbox) return c.json({ ok: false, error: 'sandbox not found' }, 404);
    if (sandbox.state === 'completed' && sandbox.sessionRef) {
      updateSession(
        sandbox.sessionRef.workdir,
        sandbox.sessionRef.agent as Agent,
        sandbox.sessionRef.sessionId,
        { archived: true },
      );
    }
    return c.json({ ok: true, sandbox });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/focus/sandboxes/:id/promote', (c) => {
  const sandbox = promoteFocusSandbox(c.req.param('id'));
  if (!sandbox) return c.json({ ok: false, error: 'sandbox not found' }, 404);
  return c.json({ ok: true, sandbox });
});

app.get('/api/focus/sandboxes/:id', (c) => {
  const sandbox = getFocusSandbox(c.req.param('id'));
  if (!sandbox) return c.json({ ok: false, error: 'sandbox not found' }, 404);
  return c.json({ ok: true, sandbox });
});

app.post('/api/focus/maintenance', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const now = body?.now ? new Date(String(body.now)) : new Date();
  const { sessions } = await loadFocusSessions();
  const archived: string[] = [];
  const queued: string[] = [];
  const digestsQueued: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const errors: Array<{ key: string; error: string }> = [];

  for (const session of sessions) {
    const key = focusSessionKey(session.workdir, session.agent, session.sessionId);
    if (isAutoSinkEligible(session, now)) {
      const ok = updateSession(session.workdir || '', session.agent as Agent, session.sessionId || '', { archived: true });
      if (ok) archived.push(key);
      continue;
    }
    if (!isKnowledgeCandidate(session)) continue;
    const result = await queueFocusExtraction(session);
    if (result.ok && result.queued) queued.push(key);
    else if (result.ok && result.skipped) skipped.push({ key, reason: result.skipped });
    else if (!result.ok) errors.push({ key, error: result.error || 'failed to queue extraction' });
  }
  const digestResult = await queueStaleDigests(sessions.filter(isAttentionSession));
  digestsQueued.push(...digestResult.queued);
  enforceFocusActiveCap();

  return c.json({ ok: errors.length === 0, archived, queued, digestsQueued, skipped, errors });
});

app.post('/api/focus/extract-chat', async (c) => {
  try {
    const body = await c.req.json();
    const workdir = typeof body?.workdir === 'string' ? body.workdir : '';
    const agent = typeof body?.agent === 'string' ? body.agent : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (!workdir || !agent || !sessionId) return c.json({ ok: false, error: 'workdir, agent, and sessionId are required' }, 400);
    const result = await querySessions({ workdir, agent: agent as Agent, archiveMode: 'all' });
    const session = result.sessions.find(item => item.agent === agent && item.sessionId === sessionId);
    if (!session) return c.json({ ok: false, error: 'session not found' }, 404);
    const queued = await queueFocusExtraction(session, body?.force === true);
    if (!queued.ok) return c.json({ ok: false, error: queued.error || 'failed to queue extraction' }, 400);
    return c.json(queued);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/focus/digest-chat', async (c) => {
  try {
    const body = await c.req.json();
    const workdir = typeof body?.workdir === 'string' ? body.workdir : '';
    const agent = typeof body?.agent === 'string' ? body.agent : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (!workdir || !agent || !sessionId) return c.json({ ok: false, error: 'workdir, agent, and sessionId are required' }, 400);
    const result = await querySessions({ workdir, agent: agent as Agent, archiveMode: 'all' });
    const session = result.sessions.find(item => item.agent === agent && item.sessionId === sessionId);
    if (!session) return c.json({ ok: false, error: 'session not found' }, 404);
    const queued = await queueFocusDigest(session, body?.force === true);
    if (!queued.ok) return c.json({ ok: false, error: queued.error || 'failed to queue digest' }, 400);
    return c.json(queued);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/focus/tasks/:taskId/jira-sync', async (c) => {
  try {
    const task = getProTask(c.req.param('taskId'));
    if (!task) return c.json({ ok: false, error: 'task not found' }, 404);
    if (!task.jiraKey) return c.json({ ok: false, error: 'task is not linked to a Jira ticket' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const run = createJiraRemoteUpdateRun({
      taskId: task.id,
      jiraKey: task.jiraKey,
      jiraUrl: task.jiraUrl,
      currentFields: {
        status: task.jiraFields?.status,
        fixVersions: task.jiraFields?.fixVersions,
        sprint: task.sprint,
        dueDate: task.jiraFields?.dueDate,
      },
      fields: body?.fields || { status: 'Ready for QA' },
    });
    return c.json({ ok: true, run });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/focus/sensors/:localDay', (c) => {
  const snapshot = loadSensorSnapshot(c.req.param('localDay'));
  if (!snapshot) return c.json({ ok: false, error: 'snapshot not found' }, 404);
  return c.json({ ok: true, snapshot });
});

export default app;
