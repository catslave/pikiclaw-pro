/**
 * Public session task control surface for dashboard and API routes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getProjectSkillPaths,
  listSkills,
  stageSessionFiles,
  ensureManagedSession,
  findPikiclawSession,
  findPikiclawSessionInfo,
  getDriverCapabilities,
  isPendingSessionId,
  recordFork,
  recordSideChat,
  createSessionPlanView,
  writeSessionPlan,
  readSessionPlan,
  clearSessionPlan,
  resolveCapabilityRoute,
  type Agent,
  type CapabilityRouteDecision,
  type AgentCapabilityDescriptor,
  type HandoverRef,
  type SessionOrigin,
  type SessionContextSource,
} from '../agent/index.js';
import { normalizeSessionContextSources } from '../agent/context-sources.js';
import { loadUserConfig } from '../core/config/user-config.js';
import { isLogTraceSlash, runLogTraceSkill, stripLogTraceSlash } from '../platform/logtrace.js';
import { runtime } from './runtime.js';

const KNOWN_AGENTS = new Set<Agent>(['claude', 'codex', 'copilot', 'cursor', 'agy', 'gemini', 'hermes']);

function hasOpenClawCodexAuth(): boolean {
  if (String(process.env.OPENAI_API_KEY || '').trim()) return true;
  const authPath = path.join(os.homedir(), '.openclaw', 'agents', 'codex', 'agent', 'auth-profiles.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return false;
    return JSON.stringify(parsed).trim().length > 2;
  } catch {
    return false;
  }
}

/**
 * Parse a `/goal[ args]` prompt typed in the dashboard chat box. Returns null
 * when the prompt is not a goal slash command. Sub-commands mirror the IM
 * `handleGoalCommand` semantics (set / clear / pause / resume / status).
 *
 * Routing /goal through the native bridge is the dashboard's analog of what
 * channels/{telegram,feishu,weixin}/bot.ts do via `handleGoalCommand` — before
 * this hook, dashboard /goal was matched by the legacy `goal` skill resolver
 * and silently rewritten to "Read SKILL.md and execute", which bypassed both
 * the claude native /goal slash command and codex's thread/goal RPC.
 */
function parseGoalSlash(prompt: string): { action: 'set' | 'clear' | 'pause' | 'resume' | 'status'; objective: string } | null {
  const trimmed = prompt.trim();
  const m = trimmed.match(/^\/goal(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const args = (m[1] || '').trim();
  if (!args) return { action: 'status', objective: '' };
  const lower = args.toLowerCase();
  if (lower === 'clear' || lower === 'cancel' || lower === 'stop') return { action: 'clear', objective: '' };
  if (lower === 'pause') return { action: 'pause', objective: '' };
  if (lower === 'resume') return { action: 'resume', objective: '' };
  return { action: 'set', objective: args };
}

type PlanSlashAction = 'start' | 'clarify' | 'approve' | 'cancel' | 'implement' | 'status';

function parsePlanSlash(prompt: string): { action: PlanSlashAction; input: string } | null {
  const trimmed = prompt.trim();
  const m = trimmed.match(/^\/plan(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const args = (m[1] || '').trim();
  if (!args) return { action: 'start', input: '' };
  const first = args.match(/^([a-zA-Z_-]+)(?:\s+([\s\S]*))?$/);
  const verb = (first?.[1] || '').toLowerCase();
  const rest = (first?.[2] || '').trim();
  if (verb === 'clarify') return { action: 'clarify', input: rest };
  if (verb === 'approve') return { action: 'approve', input: rest };
  if (verb === 'cancel' || verb === 'clear') return { action: 'cancel', input: rest };
  if (verb === 'implement' || verb === 'apply') return { action: 'implement', input: rest };
  if (verb === 'status') return { action: 'status', input: rest };
  return { action: 'start', input: args };
}

function buildPlanStartPrompt(input: string, capability: AgentCapabilityDescriptor): string {
  const modeLabel = capability.mode === 'native'
    ? 'Use your native planning lifecycle when available.'
    : 'Use pikiclaw portable planning format; do not claim this is native agent state.';
  const task = input.trim() || 'Clarify the user goal and produce an implementation plan for this session.';
  return [
    'Enter planning mode for this task. Do not modify files, run destructive actions, or implement yet.',
    modeLabel,
    '',
    'If critical requirements are ambiguous, ask concise clarification questions using your available human-input path. Otherwise produce the plan directly.',
    'Render the final proposed plan inside exactly one <proposed_plan>...</proposed_plan> block.',
    'Inside that block include: Summary, Key Changes, Implementation Order, Test Plan, and Assumptions.',
    'After the block, ask whether to implement, continue clarifying, or cancel.',
    '',
    `Task:\n${task}`,
  ].join('\n');
}

function buildPlanClarifyPrompt(input: string): string {
  return [
    'Continue planning mode for the current session. Do not implement yet.',
    'Use this clarification or open question to revise the plan.',
    '',
    input.trim() || 'Ask the next clarification question needed to make the plan actionable.',
    '',
    'When ready, render the revised proposed plan inside <proposed_plan>...</proposed_plan>.',
  ].join('\n');
}

function buildPlanImplementPrompt(input: string): string {
  const extra = input.trim();
  return [
    'Implement the latest proposed plan for this session.',
    'If no proposed plan is available in context, first summarize the inferred plan briefly, then implement with minimal, scoped changes.',
    'Keep the user updated and verify the result.',
    extra ? `\nAdditional instruction:\n${extra}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Resolve a `/skill-name [args]` prompt into the full skill execution prompt.
 * Returns null if the prompt is not a skill invocation or the skill is not found.
 */
function resolveSkillFromPrompt(workdir: string, prompt: string): { resolvedPrompt: string; skillName: string } | null {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return null;
  // Extract command name and args: "/skill-name some args" → name="skill-name", args="some args"
  const match = trimmed.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
  if (!match) return null;
  const name = match[1];
  const args = (match[2] || '').trim();

  const { skills } = listSkills(workdir);
  // Match by exact skill name (case-insensitive)
  const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (!skill) return null;

  const extra = args ? ` Additional context: ${args}` : '';
  const workdirHint = `[Project directory: ${workdir}]\n\n`;
  const paths = getProjectSkillPaths(workdir, skill.name);
  const skillFile = paths.claudeSkillFile || paths.sharedSkillFile || paths.agentsSkillFile;
  const targetPath = skillFile || `${workdir}/.pikiclaw/skills/${skill.name}/SKILL.md`;
  const resolvedPrompt = `${workdirHint}Read the skill definition at \`${targetPath}\` and execute the instructions defined there.${extra}`;
  return { resolvedPrompt, skillName: skill.name };
}

export interface QueueSessionTaskRequest {
  workdir: string;
  agent?: Agent | string | null;
  sessionId: string;
  prompt: string;
  displayPrompt?: string | null;
  model?: string | null;
  effort?: string | null;
  attachments?: string[];
  /**
   * When the user just switched agent from a live session, pass the source
   * (agent, sessionId) so cross-agent handover can replay its context as the
   * first turn of the new session. Ignored when `sessionId` resolves to an
   * existing (non-pending) session — we don't replay handover on top of an
   * agent's own history.
   */
  previousAgent?: Agent | string | null;
  previousSessionId?: string | null;
  origin?: Partial<SessionOrigin> | null;
  contextSources?: SessionContextSource[];
}

/**
 * Resolve a `handoverFrom` ref from the request's `previousAgent` /
 * `previousSessionId` fields, validating that it points to a real, non-self,
 * different-agent session managed by pikiclaw. Returns null when the inputs
 * are absent or invalid — handover is best-effort and silent-skip on bad data.
 */
function resolveHandoverFrom(request: QueueSessionTaskRequest, targetAgent: Agent): HandoverRef | null {
  const prevAgent = typeof request.previousAgent === 'string' ? request.previousAgent.trim() : '';
  const prevSessionId = typeof request.previousSessionId === 'string' ? request.previousSessionId.trim() : '';
  if (!prevAgent || !prevSessionId) return null;
  if (!KNOWN_AGENTS.has(prevAgent as Agent)) return null;
  if (prevAgent === targetAgent) return null;        // same-agent continuation goes via --resume, not handover
  if (isPendingSessionId(prevSessionId)) return null; // no native history yet → nothing to compact
  const record = findPikiclawSession(request.workdir, prevAgent as Agent, prevSessionId);
  if (!record) return null;
  return { agent: prevAgent as Agent, sessionId: prevSessionId };
}

export async function queueDashboardSessionTask(request: QueueSessionTaskRequest) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  if (!request.workdir || (!request.prompt && !(request.attachments || []).length)) {
    return { ok: false as const, error: 'workdir and either prompt or attachments are required' };
  }
  const userPrompt = request.prompt || '';
  const displayPrompt = typeof request.displayPrompt === 'string'
    ? request.displayPrompt.trim()
    : request.displayPrompt === null
      ? null
      : undefined;

  const config = loadUserConfig();
  const resolvedAgent = typeof request.agent === 'string' && KNOWN_AGENTS.has(request.agent as Agent)
    ? request.agent as Agent
    : runtime.getRuntimeDefaultAgent(config);
  const modelId = typeof request.model === 'string' ? request.model.trim() : '';
  let effectiveAgent = resolvedAgent;
  let capabilityRoute: CapabilityRouteDecision | null = null;
  let thinkingEffort = effectiveAgent === 'gemini'
    ? ''
    : (typeof request.effort === 'string' ? request.effort.trim().toLowerCase() : '');

  let sessionId = request.sessionId;
  let attachments = request.attachments || [];
  const contextSources = normalizeSessionContextSources(request.contextSources);
  if (contextSources.length && sessionId && !isPendingSessionId(sessionId)) {
    return { ok: false as const, error: 'contextSources can only be used when creating a new session' };
  }

  // /logtrace — platform-owned skill. Pikiclaw runs the log CLI through a
  // controlled adapter first, then sends the collected trace/report evidence to
  // the selected agent for the actual explanation.
  if (request.prompt && isLogTraceSlash(request.prompt)) {
    const rawArgs = stripLogTraceSlash(request.prompt);
    const session = ensureManagedSession({
      workdir: request.workdir,
      agent: resolvedAgent,
      sessionId: sessionId || '',
      title: userPrompt || 'Log trace',
      threadId: null,
      origin: { channel: 'dashboard', chatId: 'dashboard' },
      ...(modelId ? { model: modelId } : {}),
    });
    sessionId = session.sessionId || sessionId;
    const logTrace = await runLogTraceSkill({
      rawArgs,
      sessionWorkspace: session.workspacePath || request.workdir,
    });
    request.prompt = logTrace.prompt;
    runtime.debug(
      `[session-send] resolved platform skill: logtrace ok=${logTrace.ok} ` +
      `artifact=${logTrace.artifactPath || 'none'} traceDir=${logTrace.traceOutputDir || 'none'} ` +
      `error=${logTrace.error || 'none'}`,
    );
  }

  // /goal — route directly to the goal bridge (claude native slash, codex RPC,
  // or portable goal.json for gemini/hermes). Must run BEFORE skill resolution
  // so the legacy `goal` skill doesn't grab the prompt and rewrite it into a
  // "Read SKILL.md" instruction.
  const goalCmd = parseGoalSlash(request.prompt || '');
  if (goalCmd && request.sessionId && !isPendingSessionId(request.sessionId)) {
    return runDashboardGoalSlash(bot, resolvedAgent, request, goalCmd, modelId, thinkingEffort);
  }

  // /plan — route through the capability-aware planning controller before
  // skill resolution. Some workspaces may define a `plan` skill; the slash
  // command here is a first-class agent capability entry point.
  const planCmd = parsePlanSlash(request.prompt || '');
  if (planCmd) {
    const planHandled = runDashboardPlanSlash(resolvedAgent, request, planCmd);
    if (planHandled.kind === 'response') return planHandled.response;
    request.prompt = planHandled.prompt;
  }

  // Resolve /skill-name prompts into full skill execution prompts
  let prompt = request.prompt;
  const skillResult = prompt ? resolveSkillFromPrompt(request.workdir, prompt) : null;
  if (skillResult) {
    prompt = skillResult.resolvedPrompt;
    runtime.debug(`[session-send] resolved skill: ${skillResult.skillName}`);
  }

  if (!skillResult) {
    capabilityRoute = resolveCapabilityRoute({
      prompt: prompt || '',
      selectedAgent: resolvedAgent,
      attachments,
      openclawAvailable: hasOpenClawCodexAuth(),
    });
    if (capabilityRoute) {
      const previousAgent = resolvedAgent;
      const previousSessionId = sessionId;
      effectiveAgent = capabilityRoute.agent;
      prompt = capabilityRoute.prompt;
      thinkingEffort = effectiveAgent === 'gemini'
        ? ''
        : (typeof request.effort === 'string' ? request.effort.trim().toLowerCase() : '');
      if (previousAgent !== effectiveAgent) {
        if (previousSessionId && !isPendingSessionId(previousSessionId)) {
          request.previousAgent = previousAgent;
          request.previousSessionId = previousSessionId;
        }
        sessionId = '';
      }
      runtime.debug(
        `[session-send] auto capability route=${capabilityRoute.capability} ` +
        `agent=${effectiveAgent} openclawAgent=${capabilityRoute.openclawAgent} reason=${capabilityRoute.reason}`,
      );
    }
  }

  // Resolve handover source. Only meaningful when we're about to stage a fresh
  // session (sessionId blank or pending). For an existing session we never
  // replay handover — that session's own --resume history is canonical.
  const isFreshSession = !sessionId || isPendingSessionId(sessionId);
  const existingHandoverFrom = isFreshSession && sessionId
    ? (findPikiclawSession(request.workdir, effectiveAgent, sessionId)?.handoverFrom ?? null)
    : null;
  const handoverFrom = isFreshSession ? (resolveHandoverFrom(request, effectiveAgent) ?? existingHandoverFrom) : null;

  // Stage files into the session workspace so temp uploads survive cleanup.
  // Also creates a new pending session when no sessionId is provided.
  if (!sessionId || attachments.length) {
    const staged = stageSessionFiles({
      agent: effectiveAgent,
      workdir: request.workdir,
      files: attachments,
      sessionId: sessionId || null,
      title: displayPrompt || userPrompt || request.prompt || 'New session',
      threadId: null,
      handoverFrom,
      contextSources,
      origin: request.origin,
    });
    if (!sessionId) sessionId = staged.sessionId;
    if (staged.importedFiles.length) {
      attachments = staged.importedFiles.map(f => path.join(staged.workspacePath, f));
    }
  }

  return bot.submitSessionTask({
    workdir: request.workdir,
    agent: effectiveAgent,
    sessionId,
    prompt: prompt || 'Please inspect the attached file(s).',
    ...(displayPrompt !== undefined ? { displayPrompt } : (userPrompt && userPrompt !== prompt) ? { displayPrompt: userPrompt } : {}),
    attachments,
    ...(modelId ? { modelId } : {}),
    ...(thinkingEffort ? { thinkingEffort } : {}),
    ...(handoverFrom ? { handoverFrom } : {}),
    ...(contextSources.length ? { contextSources } : {}),
    ...(capabilityRoute ? { capabilityRoute } : {}),
  });
}

function runDashboardPlanSlash(
  agent: Agent,
  request: QueueSessionTaskRequest,
  cmd: { action: PlanSlashAction; input: string },
): { kind: 'response'; response: any } | { kind: 'prompt'; prompt: string } {
  const capability = getDriverCapabilities(agent).plan;
  const mode = capability?.mode || 'unsupported';
  const sessionKey = `${agent}:${request.sessionId || ''}`;
  const taskId = `plan-${cmd.action}-${Date.now().toString(36)}`;

  if (mode === 'unsupported') {
    return {
      kind: 'response',
      response: {
        ok: false as const,
        error: `${agent} does not advertise /plan support.`,
        capability,
      },
    };
  }

  const existingSessionId = request.sessionId && !isPendingSessionId(request.sessionId) ? request.sessionId : '';
  if (cmd.action === 'status') {
    const plan = existingSessionId ? readSessionPlan(request.workdir, agent, existingSessionId) : null;
    return { kind: 'response', response: { ok: true as const, taskId, sessionKey, queued: false, plan, capability } };
  }
  if (cmd.action === 'cancel') {
    if (existingSessionId) clearSessionPlan(request.workdir, agent, existingSessionId);
    return { kind: 'response', response: { ok: true as const, taskId, sessionKey, queued: false, cancelled: true, capability } };
  }

  if (existingSessionId && (cmd.action === 'start' || cmd.action === 'clarify' || cmd.action === 'approve')) {
    const current = readSessionPlan(request.workdir, agent, existingSessionId);
    const status = cmd.action === 'clarify' ? 'needs_clarification' : 'draft';
    writeSessionPlan(request.workdir, agent, existingSessionId, current
      ? { ...current, mode, source: capability?.source || current.source, status }
      : createSessionPlanView({
        agent,
        mode,
        source: capability?.source || 'pikiclaw plan controller',
        status,
      }));
  }
  if (existingSessionId && (cmd.action === 'implement' || cmd.action === 'approve')) {
    const current = readSessionPlan(request.workdir, agent, existingSessionId);
    if (current) writeSessionPlan(request.workdir, agent, existingSessionId, { ...current, status: 'implementing' });
  }

  if (cmd.action === 'implement' || cmd.action === 'approve') {
    return { kind: 'prompt', prompt: buildPlanImplementPrompt(cmd.input) };
  }
  if (cmd.action === 'clarify') {
    return { kind: 'prompt', prompt: buildPlanClarifyPrompt(cmd.input) };
  }
  return { kind: 'prompt', prompt: buildPlanStartPrompt(cmd.input, capability!) };
}

async function runDashboardGoalSlash(
  bot: NonNullable<ReturnType<typeof runtime.getBotRef>>,
  agent: Agent,
  request: QueueSessionTaskRequest,
  cmd: { action: 'set' | 'clear' | 'pause' | 'resume' | 'status'; objective: string },
  modelId: string,
  thinkingEffort: string,
) {
  const opts = { chatId: 'dashboard' as const, modelId: modelId || undefined, thinkingEffort: thinkingEffort || undefined };
  const sessionKey = `${agent}:${request.sessionId}`;
  // Synthetic task id — for set / clear / resume on agents that internally
  // submit a follow-up task (claude native slash, portable continuation),
  // the real task id is owned by submitSessionTask. The dashboard's SSE
  // stream listener picks that up via session events; this id is just to
  // give the HTTP caller a non-empty taskId field.
  const taskId = `goal-${cmd.action}-${Date.now().toString(36)}`;
  try {
    if (cmd.action === 'status') {
      const goal = await bot.getSessionGoal(request.workdir, agent, request.sessionId);
      return { ok: true as const, taskId, sessionKey, queued: false, goal };
    }
    if (cmd.action === 'clear') {
      await bot.clearSessionGoal(request.workdir, agent, request.sessionId, opts);
      return { ok: true as const, taskId, sessionKey, queued: false };
    }
    if (cmd.action === 'pause') {
      const goal = await bot.pauseSessionGoal(request.workdir, agent, request.sessionId);
      return { ok: true as const, taskId, sessionKey, queued: false, goal };
    }
    if (cmd.action === 'resume') {
      const goal = await bot.resumeSessionGoal(request.workdir, agent, request.sessionId, opts);
      return { ok: true as const, taskId, sessionKey, queued: false, goal };
    }
    // set
    const goal = await bot.setSessionGoal(request.workdir, agent, request.sessionId, {
      objective: cmd.objective,
      ...opts,
    });
    return { ok: true as const, taskId, sessionKey, queued: true, goal };
  } catch (e: any) {
    return { ok: false as const, error: e?.message || String(e) };
  }
}

export interface ForkSessionTaskRequest {
  workdir: string;
  agent: Agent | string;
  parentSessionId: string;
  atTurn: number;
  prompt: string;
  model?: string | null;
  effort?: string | null;
  attachments?: string[];
}

export function forkDashboardSessionTask(request: ForkSessionTaskRequest) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  if (!request.workdir || !request.parentSessionId || !request.prompt) {
    return { ok: false as const, error: 'workdir, parentSessionId, and prompt are required' };
  }

  if (!KNOWN_AGENTS.has(request.agent as Agent)) {
    return { ok: false as const, error: `Unknown agent: ${request.agent}` };
  }
  const agent = request.agent as Agent;
  const supportsNativeFork = getDriverCapabilities(agent).fork;

  const modelId = typeof request.model === 'string' ? request.model.trim() : '';
  const thinkingEffort = agent === 'gemini'
    ? ''
    : (typeof request.effort === 'string' ? request.effort.trim().toLowerCase() : '');

  // Resolve /skill-name shorthand the same way send/queue does, so a forked
  // turn that starts with `/skill-name` runs the skill against the child.
  let prompt = request.prompt;
  const skillResult = prompt ? resolveSkillFromPrompt(request.workdir, prompt) : null;
  if (skillResult) prompt = skillResult.resolvedPrompt;

  // Make sure the parent has a managed record so `recordFork` (called after the
  // child stream completes) can write the lineage on both sides. Native-only
  // sessions (started outside pikiclaw) won't have a record yet.
  ensureManagedSession({
    agent,
    workdir: request.workdir,
    sessionId: request.parentSessionId,
  });

  // Always create a fresh pending session for the child. stageSessionFiles
  // also handles attachment imports into the new workspace.
  const staged = stageSessionFiles({
    agent,
    workdir: request.workdir,
    files: request.attachments || [],
    sessionId: null,
    title: request.prompt || `Fork from ${request.parentSessionId.slice(0, 8)}`,
    threadId: null,
  });
  const attachments = staged.importedFiles.length
    ? staged.importedFiles.map(f => path.join(staged.workspacePath, f))
    : [];

  if (!supportsNativeFork) {
    try {
      recordFork(request.workdir, {
        parent: { agent, sessionId: request.parentSessionId },
        child: { agent, sessionId: staged.sessionId },
        atTurn: request.atTurn,
      });
    } catch {
      // Best-effort metadata only; the child task can still run with handover context.
    }
  }

  return bot.submitSessionTask({
    workdir: request.workdir,
    agent,
    sessionId: staged.sessionId,
    prompt: prompt || 'Please inspect the attached file(s).',
    attachments,
    ...(supportsNativeFork ? {} : { handoverFrom: { agent, sessionId: request.parentSessionId } }),
    ...(supportsNativeFork ? { forkOf: { parentSessionId: request.parentSessionId, atTurn: request.atTurn } } : {}),
    ...(modelId ? { modelId } : {}),
    ...(thinkingEffort ? { thinkingEffort } : {}),
  });
}

export interface CreateSideChatRequest {
  workdir: string;
  agent: Agent | string;
  parentSessionId: string;
  title?: string | null;
}

export function createDashboardSideChat(request: CreateSideChatRequest) {
  if (!request.workdir || !request.parentSessionId || !request.agent) {
    return { ok: false as const, error: 'workdir, agent, and parentSessionId are required' };
  }
  if (!KNOWN_AGENTS.has(request.agent as Agent)) {
    return { ok: false as const, error: `Unknown agent: ${request.agent}` };
  }

  const agent = request.agent as Agent;
  const title = typeof request.title === 'string' && request.title.trim()
    ? request.title.trim()
    : `Side chat from ${request.parentSessionId.slice(0, 8)}`;

  ensureManagedSession({
    agent,
    workdir: request.workdir,
    sessionId: request.parentSessionId,
  });

  const staged = stageSessionFiles({
    agent,
    workdir: request.workdir,
    files: [],
    sessionId: null,
    title,
    threadId: null,
    handoverFrom: { agent, sessionId: request.parentSessionId },
  });
  const recorded = recordSideChat(request.workdir, {
    parent: { agent, sessionId: request.parentSessionId },
    child: { agent, sessionId: staged.sessionId },
  });
  const session = findPikiclawSessionInfo(request.workdir, agent, staged.sessionId);
  const parent = findPikiclawSessionInfo(request.workdir, agent, request.parentSessionId);
  return {
    ok: recorded && !!session,
    session,
    parent,
    sessionKey: `${agent}:${staged.sessionId}`,
    error: recorded && session ? null : 'Failed to create side chat',
  };
}

export function getSessionStreamState(agent: string, sessionId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: true as const, state: null };
  return { ok: true as const, state: bot.getStreamSnapshot(`${agent}:${sessionId}`) };
}

export function cancelSessionTask(taskId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.cancelTask(taskId);
  return { ok: true as const, recalled: result.cancelled || result.interrupted };
}

/**
 * Stop the running task AND cancel every queued task in a session — the
 * "stop everything for this session" surface used by the dashboard's main
 * stop button. Works on (agent, sessionId) rather than a single taskId so it
 * still functions during the brief window after send/before the queued WS
 * snapshot reaches the client.
 */
export function stopSessionTasks(agent: string, sessionId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.stopAllSessionTasks(`${agent}:${sessionId}`);
  return { ok: true as const, ...result };
}

export async function steerSessionTask(taskId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = await bot.steerTask(taskId);
  return { ok: true as const, steered: result.steered };
}

export function reorderSessionQueuedTasks(agent: string, sessionId: string, taskIds: string[]) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.reorderSessionQueuedTasks(`${agent}:${sessionId}`, taskIds);
  return {
    ok: !result.error,
    reordered: result.reordered,
    queuedTaskIds: result.queuedTaskIds,
    ...(result.error ? { error: result.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Interaction prompt control (human-in-the-loop)
// ---------------------------------------------------------------------------

export function interactionSelectOption(promptId: string, optionValue: string, opts?: { requestFreeform?: boolean }) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.interactionSelectOption(promptId, optionValue, opts);
  if (!result) return { ok: false as const, error: 'Prompt not found or no longer active' };
  return { ok: true as const, completed: result.completed, advanced: result.advanced };
}

export function interactionSubmitText(promptId: string, text: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.interactionSubmitText(promptId, text);
  if (!result) return { ok: false as const, error: 'Prompt not found or not awaiting text' };
  return { ok: true as const, completed: result.completed, advanced: result.advanced };
}

export function interactionSkip(promptId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.interactionSkip(promptId);
  if (!result) return { ok: false as const, error: 'Prompt not found or no longer active' };
  return { ok: true as const, completed: result.completed, advanced: result.advanced };
}

export function interactionCancel(promptId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.interactionCancel(promptId);
  if (!result) return { ok: false as const, error: 'Prompt not found or no longer active' };
  return { ok: true as const };
}

export function getInteractionPrompt(promptId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const prompt = bot.interactionPrompt(promptId);
  if (!prompt) return { ok: true as const, prompt: null };
  return {
    ok: true as const,
    prompt: {
      promptId: prompt.promptId,
      taskId: prompt.taskId,
      title: prompt.title,
      hint: prompt.hint,
      questions: prompt.questions,
      currentIndex: prompt.currentIndex,
      answers: prompt.answers,
    },
  };
}
