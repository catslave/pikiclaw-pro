import { querySessionMessages, querySessions, type RichMessage, type SessionInfo } from '../bot/session-hub.js';
import { loadUserConfig, loadWorkspaces } from '../core/config/user-config.js';
import { listProTasks, type ProTask } from './tasks.js';

export interface UsageAgentSummary {
  agent: string;
  chatCount: number;
  sessionCount: number;
  sideChatCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  activeSeconds: number;
  lifetimeSeconds: number;
}

export interface UsageDaySummary {
  day: string;
  chatCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

export interface UsageChatSummary {
  sessionId: string;
  agent: string;
  workdir: string;
  title: string;
  isSideChat: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  activeSeconds: number;
  lifetimeSeconds: number;
}

export interface UsageTaskTimingSummary {
  taskId: string;
  title: string;
  jiraKey?: string;
  status: string;
  refinementStartedAt: string | null;
  resolvedAt: string | null;
  refinementToResolvedSeconds: number | null;
  userFocusCount: number;
  userFocusSeconds: number;
  agentSeconds: number;
  totalLifecycleSeconds: number | null;
}

export interface ProUsageSummary {
  generatedAt: string;
  scanned: {
    workspaceCount: number;
    chatCount: number;
    limit: number;
    truncated: boolean;
  };
  totals: UsageAgentSummary;
  byAgent: UsageAgentSummary[];
  byDay: UsageDaySummary[];
  topChats: UsageChatSummary[];
  taskTimings: {
    count: number;
    resolvedCount: number;
    averageRefinementToResolvedSeconds: number | null;
    userFocusSeconds: number;
    agentSeconds: number;
    totalLifecycleSeconds: number;
    tasks: UsageTaskTimingSummary[];
  };
  notes: string[];
}

interface SessionScanResult {
  chat: UsageChatSummary;
  dayTurns: Map<string, number>;
  dayUsage: Map<string, Pick<UsageDaySummary, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'totalTokens'>>;
}

const EMPTY_AGENT_SUMMARY: UsageAgentSummary = {
  agent: 'all',
  chatCount: 0,
  sessionCount: 0,
  sideChatCount: 0,
  turnCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  activeSeconds: 0,
  lifetimeSeconds: 0,
};

function parseLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 240;
  return Math.max(20, Math.min(600, Math.floor(n)));
}

function addSeconds(start: string | null | undefined, end: string | null | undefined): number {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 1000);
}

function dayKey(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString().slice(0, 10);
}

function emptyAgent(agent: string): UsageAgentSummary {
  return { ...EMPTY_AGENT_SUMMARY, agent };
}

function addUsage(target: Pick<UsageAgentSummary, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'totalTokens'>, usage: RichMessage['usage']) {
  if (!usage) return;
  const input = Math.max(0, Math.floor(Number(usage.inputTokens || 0)));
  const output = Math.max(0, Math.floor(Number(usage.outputTokens || 0)));
  const cached = Math.max(0, Math.floor(Number(usage.cachedInputTokens || 0)));
  target.inputTokens += input;
  target.outputTokens += output;
  target.cachedInputTokens += cached;
  target.totalTokens += input + output;
}

function mergeAgent(target: UsageAgentSummary, chat: UsageChatSummary) {
  target.chatCount += 1;
  if (chat.isSideChat) target.sideChatCount += 1;
  else target.sessionCount += 1;
  target.turnCount += chat.turnCount;
  target.inputTokens += chat.inputTokens;
  target.outputTokens += chat.outputTokens;
  target.cachedInputTokens += chat.cachedInputTokens;
  target.totalTokens += chat.totalTokens;
  target.activeSeconds += chat.activeSeconds;
  target.lifetimeSeconds += chat.lifetimeSeconds;
}

function incrementDayUsage(map: Map<string, Pick<UsageDaySummary, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'totalTokens'>>, key: string, usage: RichMessage['usage']) {
  const current = map.get(key) || { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
  addUsage(current, usage);
  map.set(key, current);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

async function scanSession(session: SessionInfo): Promise<SessionScanResult> {
  const agent = session.agent || 'unknown';
  const workdir = session.workdir || session.workspacePath || '';
  const sessionId = session.sessionId || '';
  const base: UsageChatSummary = {
    sessionId,
    agent,
    workdir,
    title: session.title || session.lastQuestion || sessionId,
    isSideChat: !!session.sideChatOf,
    createdAt: session.createdAt || null,
    updatedAt: session.runUpdatedAt || session.createdAt || null,
    turnCount: Math.max(0, Number(session.numTurns || 0)),
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    activeSeconds: 0,
    lifetimeSeconds: addSeconds(session.createdAt, session.runUpdatedAt || session.createdAt),
  };
  const dayTurns = new Map<string, number>();
  const dayUsage = new Map<string, Pick<UsageDaySummary, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'totalTokens'>>();

  if (!workdir || !sessionId) {
    const key = dayKey(base.createdAt);
    dayTurns.set(key, base.turnCount);
    return { chat: base, dayTurns, dayUsage };
  }

  try {
    const messages = await querySessionMessages({ workdir, agent: agent as any, sessionId, rich: true });
    if (messages.ok) {
      base.turnCount = Math.max(base.turnCount, messages.totalTurns || 0);
      const richMessages = messages.richMessages || [];
      const times = richMessages
        .map(message => message.createdAt ? Date.parse(message.createdAt) : NaN)
        .filter(Number.isFinite);
      if (times.length > 1) base.activeSeconds = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
      for (const message of richMessages) {
        const key = dayKey(message.createdAt || base.createdAt);
        if (message.role === 'user') dayTurns.set(key, (dayTurns.get(key) || 0) + 1);
        if (message.role === 'assistant') {
          addUsage(base, message.usage);
          incrementDayUsage(dayUsage, key, message.usage);
        }
      }
    }
  } catch {
    // Keep list-derived counts even when a transcript cannot be read.
  }

  if (!dayTurns.size) dayTurns.set(dayKey(base.createdAt), base.turnCount);
  return { chat: base, dayTurns, dayUsage };
}

function statusChangedAt(task: ProTask, status: string): string | null {
  const events = [...(task.events || [])].reverse();
  for (const event of events) {
    if (event.type !== 'status-changed') continue;
    if (event.summary.includes(` to ${status}.`) || event.summary.endsWith(` to ${status}`)) return event.createdAt;
  }
  return null;
}

function taskTimingSummary(task: ProTask): UsageTaskTimingSummary {
  const refinementStartedAt = statusChangedAt(task, 'refinement') || task.stageRuns.find(run => run.stage === 'refinement')?.startedAt || null;
  const resolvedAt = statusChangedAt(task, 'resolved') || (task.status === 'resolved' || task.status === 'done' ? task.updatedAt : null);
  const now = new Date().toISOString();
  const focusSessions = task.focusSessions || [];
  const userFocusSeconds = focusSessions.reduce((sum, session) => {
    return sum + (typeof session.durationSeconds === 'number'
      ? Math.max(0, session.durationSeconds)
      : addSeconds(session.openedAt, session.closedAt || now));
  }, 0);
  const agentSeconds = (task.stageRuns || []).reduce((sum, run) => sum + addSeconds(run.startedAt, run.completedAt || now), 0);
  const lifecycleEnd = task.status === 'done' || task.status === 'resolved' ? task.updatedAt : now;
  return {
    taskId: task.id,
    title: task.title,
    jiraKey: task.jiraKey,
    status: task.status,
    refinementStartedAt,
    resolvedAt,
    refinementToResolvedSeconds: refinementStartedAt && resolvedAt ? addSeconds(refinementStartedAt, resolvedAt) : null,
    userFocusCount: focusSessions.length,
    userFocusSeconds,
    agentSeconds,
    totalLifecycleSeconds: addSeconds(task.createdAt, lifecycleEnd),
  };
}

export async function buildProUsageSummary(rawLimit?: unknown): Promise<ProUsageSummary> {
  const limit = parseLimit(rawLimit);
  const config = loadUserConfig();
  const workspaces = loadWorkspaces();
  if (config.workdir && !workspaces.some(workspace => workspace.path === config.workdir)) {
    workspaces.unshift({
      path: config.workdir,
      name: config.workdir.split('/').pop() || config.workdir,
      addedAt: new Date(0).toISOString(),
    });
  }
  if (!workspaces.length) {
    const cwd = process.cwd();
    workspaces.push({ path: cwd, name: cwd.split('/').pop() || cwd, addedAt: new Date(0).toISOString() });
  }
  const sessionMap = new Map<string, SessionInfo>();
  const notes = ['Historical token totals are best-effort; some agents do not expose per-turn token usage in saved transcripts.'];

  for (const workspace of workspaces) {
    try {
      const result = await querySessions({ workdir: workspace.path, archiveMode: 'all' });
      for (const session of result.sessions) {
        const key = `${session.workdir || workspace.path}:${session.agent}:${session.sessionId}`;
        if (session.sessionId) sessionMap.set(key, session);
      }
    } catch {
      notes.push(`Failed to scan sessions for ${workspace.path}.`);
    }
  }

  const sessions = [...sessionMap.values()]
    .sort((a, b) => Date.parse(b.runUpdatedAt || b.createdAt || '') - Date.parse(a.runUpdatedAt || a.createdAt || ''))
    .slice(0, limit);
  const truncated = sessionMap.size > sessions.length;
  const scanned = await mapWithConcurrency(sessions, 4, scanSession);
  const totals = emptyAgent('all');
  const byAgent = new Map<string, UsageAgentSummary>();
  const byDay = new Map<string, UsageDaySummary>();

  for (const result of scanned) {
    mergeAgent(totals, result.chat);
    const agent = byAgent.get(result.chat.agent) || emptyAgent(result.chat.agent);
    mergeAgent(agent, result.chat);
    byAgent.set(result.chat.agent, agent);
    for (const [day, turns] of result.dayTurns) {
      const row = byDay.get(day) || { day, chatCount: 0, turnCount: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
      row.turnCount += turns;
      row.chatCount += 1;
      byDay.set(day, row);
    }
    for (const [day, usage] of result.dayUsage) {
      const row = byDay.get(day) || { day, chatCount: 0, turnCount: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.cachedInputTokens += usage.cachedInputTokens;
      row.totalTokens += usage.totalTokens;
      byDay.set(day, row);
    }
  }

  const taskRows = listProTasks().map(taskTimingSummary);
  const resolvedTaskRows = taskRows.filter(task => typeof task.refinementToResolvedSeconds === 'number');
  const average = resolvedTaskRows.length
    ? Math.round(resolvedTaskRows.reduce((sum, task) => sum + (task.refinementToResolvedSeconds || 0), 0) / resolvedTaskRows.length)
    : null;
  const userFocusSeconds = taskRows.reduce((sum, task) => sum + task.userFocusSeconds, 0);
  const agentSeconds = taskRows.reduce((sum, task) => sum + task.agentSeconds, 0);
  const totalLifecycleSeconds = taskRows.reduce((sum, task) => sum + (task.totalLifecycleSeconds || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    scanned: {
      workspaceCount: workspaces.length,
      chatCount: sessions.length,
      limit,
      truncated,
    },
    totals,
    byAgent: [...byAgent.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.turnCount - a.turnCount),
    byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30),
    topChats: scanned.map(result => result.chat).sort((a, b) => b.totalTokens - a.totalTokens || b.turnCount - a.turnCount).slice(0, 20),
    taskTimings: {
      count: taskRows.length,
      resolvedCount: resolvedTaskRows.length,
      averageRefinementToResolvedSeconds: average,
      userFocusSeconds,
      agentSeconds,
      totalLifecycleSeconds,
      tasks: taskRows
        .sort((a, b) => b.userFocusSeconds - a.userFocusSeconds || (b.refinementToResolvedSeconds || 0) - (a.refinementToResolvedSeconds || 0))
        .slice(0, 20),
    },
    notes: truncated ? [...notes, `Only the latest ${limit} chats were scanned.`] : notes,
  };
}
