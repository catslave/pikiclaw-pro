/**
 * Daily Command Center projection for Focus.
 *
 * Focus is no longer a chat-management screen. This file turns chats, Pro tasks,
 * outputs, knowledge cards, and lightweight Git snapshots into a small set of
 * task sandboxes and suggested actions for the dashboard.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceEntry } from '../core/config/user-config.js';
import type { SessionInfo } from '../agent/types.js';
import type { WorkspaceSessionInfo } from '../bot/session-hub.js';
import type { ProTask, ProTaskKind, ProTaskStatus, StageRun } from '../pro/tasks.js';
import type { KnowledgeEntry, KnowledgeSourceRef } from '../pro/workflow.js';
import {
  focusSessionKey,
  getSessionValueSignals,
  hasKnowledgeForSession,
  isAutoSinkEligible,
} from '../pro/focus.js';
import { FOCUS_ACTIVE_SANDBOX_CAP, type FocusSandboxRecord } from '../pro/sandbox.js';

const execFileAsync = promisify(execFile);

export type FocusSandboxType = 'jira' | 'todo' | 'bug' | 'review' | 'chat';
export type FocusSandboxState = 'active' | 'paused' | 'completed';
export type FocusPriority = 'high' | 'medium' | 'low';
export type FocusActionKind = 'continue' | 'open-source' | 'open-task' | 'open-output' | 'maintain' | 'sync';

export interface FocusAction {
  kind: FocusActionKind;
  label: string;
  sourceRef?: KnowledgeSourceRef | null;
  taskId?: string | null;
  outputId?: string | null;
  url?: string | null;
}

export interface FocusBriefItem {
  id: string;
  title: string;
  summary?: string | null;
  updatedAt?: string | null;
  workspaceName?: string | null;
  priority?: FocusPriority;
  action?: FocusAction | null;
}

export interface FocusRecommendation extends FocusBriefItem {
  sandboxId?: string | null;
  reason?: string | null;
}

export interface FocusEvidence {
  kind: 'chat' | 'output' | 'knowledge' | 'git' | 'task' | 'plan';
  label: string;
  count?: number;
}

export interface FocusSandbox {
  id: string;
  type: FocusSandboxType;
  state: FocusSandboxState;
  title: string;
  summary?: string | null;
  progress: number;
  workdir?: string | null;
  workspaceName?: string | null;
  agent?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  jiraKey?: string | null;
  jiraUrl?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  breakpoint?: string | null;
  nextActions: string[];
  evidence: FocusEvidence[];
  sourceRef?: KnowledgeSourceRef | null;
}

export interface FocusGitSnapshot {
  workdir: string;
  workspaceName: string;
  branch?: string | null;
  changedFiles: number;
  lastCommitMessage?: string | null;
  hasUnstaged?: boolean;
  ok: boolean;
  error?: string | null;
}

export type FocusCanvasBlockType = 'standup' | 'sandbox-grid' | 'checkout' | 'memory-strip' | 'intent-echo';

export interface FocusCanvasBlock {
  type: FocusCanvasBlockType;
  title?: string | null;
  standup?: FocusCommandCenter['standup'];
  sandboxes?: FocusSandbox[];
  maxVisible?: number;
  checkout?: FocusCommandCenter['checkout'];
  memory?: FocusCommandCenter['memory'];
  artifacts?: FocusOutputProjection[];
  userIntent?: string | null;
  revisedHeadline?: string | null;
}

export interface FocusCommandCenter {
  generatedAt: string;
  localDay: string;
  headline: string;
  standup: {
    yesterdayReview: FocusBriefItem[];
    todayIncoming: FocusBriefItem[];
    recommendations: FocusRecommendation[];
  };
  sandboxes: {
    active: FocusSandbox[];
    paused: FocusSandbox[];
    completed: FocusSandbox[];
  };
  checkout: {
    completedToday: FocusBriefItem[];
    syncProposals: FocusBriefItem[];
    cleanupCandidates: FocusBriefItem[];
  };
  memory: {
    knowledgeCount: number;
    hiddenKnowledgeCount: number;
    outputCount: number;
    candidateCount: number;
  };
  git: FocusGitSnapshot[];
  canvas?: FocusCanvasBlock[];
}

export interface FocusOutputProjection {
  id: string;
  kind: string;
  title: string;
  summary?: string | null;
  path?: string | null;
  url?: string | null;
  createdAt?: string | null;
  workdir?: string | null;
  workspaceName?: string | null;
  agent?: string | null;
  sessionId?: string | null;
  sessionTitle?: string | null;
}

export interface BuildFocusCommandCenterInput {
  sessions: WorkspaceSessionInfo[];
  tasks: ProTask[];
  workspaces: WorkspaceEntry[];
  knowledge: KnowledgeEntry[];
  hiddenKnowledgeCount: number;
  outputs: FocusOutputProjection[];
  candidateCount: number;
  git: FocusGitSnapshot[];
  persistedSandboxes?: FocusSandboxRecord[];
  digestBySessionKey?: Map<string, string>;
  orchestratorHeadline?: string | null;
  orchestratorRecommendations?: FocusRecommendation[];
  now?: Date;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function timeOf(value?: string | null): number {
  return Date.parse(value || '') || 0;
}

function newestTime(...values: Array<string | null | undefined>): number {
  return Math.max(0, ...values.map(timeOf));
}

function compactText(text: string | null | undefined, max = 180): string | null {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 1).trim()}…` : normalized;
}

function latestStageRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])]
    .sort((a, b) => newestTime(b.completedAt, b.startedAt) - newestTime(a.completedAt, a.startedAt))[0] || null;
}

function activeStageRun(task: ProTask): StageRun | null {
  return (task.stageRuns || []).find(run => run.status === 'running' || run.status === 'waiting-user' || run.status === 'queued') || null;
}

function taskType(task: ProTask): FocusSandboxType {
  const issueType = String(task.jiraFields?.issueType || '').toLowerCase();
  const title = `${task.title} ${task.description || ''}`.toLowerCase();
  if (task.kind === 'jira-bug' || issueType.includes('bug')) return 'bug';
  if (task.prUrl || title.includes('review') || title.includes('mr ') || title.includes('pr ')) return 'review';
  if (task.kind === 'jira-ticket' || task.kind === 'jira-epic' || task.jiraKey || task.origin?.type === 'jira') return 'jira';
  return 'todo';
}

function taskState(task: ProTask): FocusSandboxState {
  if (task.status === 'done' || task.status === 'resolved') return 'completed';
  if (activeStageRun(task) || task.status === 'coding' || task.status === 'refinement') return 'active';
  return 'paused';
}

function taskProgress(task: ProTask): number {
  const baseByStatus: Record<ProTaskStatus, number> = {
    backlog: 10,
    refinement: 35,
    coding: 65,
    resolved: 90,
    done: 100,
  };
  let progress = baseByStatus[task.status] ?? 20;
  const subtasks = task.subTasks || [];
  if (subtasks.length) {
    const done = subtasks.filter(item => item.status === 'done').length;
    progress = Math.max(progress, Math.round((done / subtasks.length) * 80) + 10);
  }
  const active = activeStageRun(task);
  if (active?.status === 'waiting-user') progress = Math.max(progress, 55);
  if (active?.status === 'running') progress = Math.max(progress, 60);
  return clampProgress(progress);
}

function sourceRefFromStageRun(run: StageRun | null, title: string): KnowledgeSourceRef | null {
  if (!run?.session?.workdir || !run.session.agent || !run.session.sessionId) return null;
  return {
    type: 'chat',
    workdir: run.session.workdir,
    agent: run.session.agent,
    sessionId: run.session.sessionId,
    title,
  };
}

function taskWorkspaceName(task: ProTask, workspaces: WorkspaceEntry[]): string | null {
  if (!task.workdir) return null;
  const workspace = workspaces.find(item => item.path === task.workdir);
  return workspace?.name || task.workdir.split('/').filter(Boolean).at(-1) || task.workdir;
}

function taskNextActions(task: ProTask): string[] {
  const active = activeStageRun(task);
  if (active?.status === 'waiting-user') return ['处理等待中的问题', '继续当前沙盒'];
  if (task.status === 'backlog') return ['确认范围', '加入今日计划'];
  if (task.status === 'refinement') return ['补齐上下文', '生成执行计划'];
  if (task.status === 'coding') return ['继续实现', '运行验证'];
  if (task.status === 'resolved') return ['同步 Jira', '沉淀产出'];
  return ['复盘产出', '清理工作区'];
}

function taskEvidence(task: ProTask, knowledge: KnowledgeEntry[], git: FocusGitSnapshot[]): FocusEvidence[] {
  const evidence: FocusEvidence[] = [];
  const stageCount = task.stageRuns?.length || 0;
  const outputCount = task.outputs?.length || 0;
  const knowledgeCount = knowledge.filter(entry => (
    entry.source?.taskId === task.id
    || (entry.sourceRefs || []).some(ref => ref.taskId === task.id)
  )).length;
  const gitSnapshot = task.workdir ? git.find(item => item.workdir === task.workdir) : null;
  if (stageCount) evidence.push({ kind: 'chat', label: 'Agent runs', count: stageCount });
  if (outputCount) evidence.push({ kind: 'output', label: 'Outputs', count: outputCount });
  if (knowledgeCount) evidence.push({ kind: 'knowledge', label: 'Memory', count: knowledgeCount });
  if (gitSnapshot?.changedFiles) evidence.push({ kind: 'git', label: 'Changed files', count: gitSnapshot.changedFiles });
  return evidence.length ? evidence : [{ kind: 'task', label: 'Task', count: 1 }];
}

function taskSummary(task: ProTask): string | null {
  const latest = latestStageRun(task);
  return compactText(
    latest?.output?.summary
    || latest?.output?.diffSummary
    || task.description
    || task.jiraFields?.status
    || null,
  );
}

function taskBreakpoint(task: ProTask): string | null {
  const active = activeStageRun(task);
  if (active?.status === 'waiting-user') return compactText('Agent 正在等待你处理一个决策点。', 120);
  const latest = latestStageRun(task);
  if (latest?.output?.changedFiles?.length) return compactText(`最近改动：${latest.output.changedFiles.slice(0, 3).join(', ')}`, 120);
  if (latest?.output?.branch) return compactText(`当前分支：${latest.output.branch}`, 120);
  return compactText(latest?.output?.summary || null, 120);
}

function taskToSandbox(task: ProTask, workspaces: WorkspaceEntry[], knowledge: KnowledgeEntry[], git: FocusGitSnapshot[]): FocusSandbox {
  const run = activeStageRun(task) || latestStageRun(task);
  const sourceRef = sourceRefFromStageRun(run, task.title);
  return {
    id: `task:${task.id}`,
    type: taskType(task),
    state: taskState(task),
    title: task.jiraKey ? `${task.jiraKey} · ${task.title}` : task.title,
    summary: taskSummary(task),
    progress: taskProgress(task),
    workdir: task.workdir || run?.session?.workdir || null,
    workspaceName: taskWorkspaceName(task, workspaces),
    agent: task.execution?.agent || task.defaultAgent || run?.session?.agent || null,
    sessionId: run?.session?.sessionId || null,
    taskId: task.id,
    jiraKey: task.jiraKey || task.origin?.key || null,
    jiraUrl: task.jiraUrl || task.origin?.url || null,
    status: task.status,
    updatedAt: task.updatedAt,
    breakpoint: taskBreakpoint(task),
    nextActions: taskNextActions(task),
    evidence: taskEvidence(task, knowledge, git),
    sourceRef,
  };
}

function sessionSourceRef(session: WorkspaceSessionInfo): KnowledgeSourceRef | null {
  if (!session.workdir || !session.agent || !session.sessionId) return null;
  return {
    type: 'chat',
    workdir: session.workdir,
    agent: session.agent,
    sessionId: session.sessionId,
    title: session.title || session.lastQuestion || undefined,
  };
}

function isExtractionSession(session: SessionInfo): boolean {
  return typeof session.origin?.chatId === 'string' && session.origin.chatId.startsWith('focus-knowledge:');
}

function isSessionSandbox(session: WorkspaceSessionInfo, knowledge: KnowledgeEntry[]): boolean {
  if (session.archived || isExtractionSession(session)) return false;
  if (session.running || session.runState === 'running' || session.runState === 'incomplete') return true;
  const outcome = session.classification?.outcome;
  if (outcome === 'blocked' || outcome === 'partial') return true;
  if (session.userStatus === 'active' || session.userStatus === 'review') return true;
  if (session.pinned || session.lastPlan || session.outputs?.length || hasKnowledgeForSession(knowledge, session)) return true;
  return false;
}

function sessionState(session: WorkspaceSessionInfo): FocusSandboxState {
  if (session.userStatus === 'done' || session.runState === 'completed' && session.classification?.outcome === 'implementation') return 'completed';
  if (session.running || session.runState === 'running' || session.runState === 'incomplete') return 'active';
  if (session.classification?.outcome === 'blocked' || session.classification?.outcome === 'partial') return 'active';
  if (session.userStatus === 'active' || session.userStatus === 'review') return 'active';
  return 'paused';
}

function sessionProgress(session: WorkspaceSessionInfo): number {
  if (session.running || session.runState === 'running') return 50;
  if (session.runState === 'incomplete') return 35;
  const outcome = session.classification?.outcome;
  if (outcome === 'blocked') return 45;
  if (outcome === 'partial') return 55;
  if (outcome === 'proposal') return 30;
  if (outcome === 'implementation') return 80;
  if (session.lastPlan) return 40;
  if (session.outputs?.length) return 75;
  return 20;
}

function sessionNextActions(session: WorkspaceSessionInfo): string[] {
  const suggested = compactText(session.classification?.suggestedNextAction || null, 80);
  if (suggested) return [suggested, '继续现场'];
  if (session.runState === 'incomplete') return ['恢复中断', '查看最近输出'];
  if (session.classification?.outcome === 'blocked') return ['解除阻塞', '补充上下文'];
  if (session.lastPlan?.steps?.some(step => step.status !== 'completed')) return ['推进下一步', '运行验证'];
  return ['继续现场', '沉淀产出'];
}

function sessionEvidence(session: WorkspaceSessionInfo, knowledge: KnowledgeEntry[]): FocusEvidence[] {
  const signals = getSessionValueSignals(session);
  const evidence: FocusEvidence[] = [];
  if (signals.length) evidence.push({ kind: 'plan', label: 'Signals', count: signals.length });
  if (session.outputs?.length) evidence.push({ kind: 'output', label: 'Outputs', count: session.outputs.length });
  if (hasKnowledgeForSession(knowledge, session)) evidence.push({ kind: 'knowledge', label: 'Memory', count: 1 });
  if (session.numTurns) evidence.push({ kind: 'chat', label: 'Turns', count: session.numTurns });
  return evidence.length ? evidence : [{ kind: 'chat', label: 'Chat', count: 1 }];
}

function sessionToSandbox(session: WorkspaceSessionInfo, knowledge: KnowledgeEntry[], digestBySessionKey?: Map<string, string>): FocusSandbox {
  const key = focusSessionKey(session.workdir, session.agent, session.sessionId);
  const digestBreakpoint = digestBySessionKey?.get(key);
  return {
    id: `chat:${key}`,
    type: 'chat',
    state: sessionState(session),
    title: session.title || session.lastQuestion || 'Untitled sandbox',
    summary: compactText(session.classification?.summary || session.lastAnswer || session.lastQuestion || null),
    progress: sessionProgress(session),
    workdir: session.workdir || null,
    workspaceName: session.workspaceName || null,
    agent: session.agent || null,
    sessionId: session.sessionId || null,
    taskId: null,
    jiraKey: null,
    jiraUrl: null,
    status: session.userStatus || session.runState || null,
    updatedAt: session.runUpdatedAt || session.createdAt || null,
    breakpoint: digestBreakpoint || compactText(session.classification?.suggestedNextAction || session.lastPlan?.steps?.find(step => step.status !== 'completed')?.step || null, 120),
    nextActions: sessionNextActions(session),
    evidence: sessionEvidence(session, knowledge),
    sourceRef: sessionSourceRef(session),
  };
}

function sandboxSort(a: FocusSandbox, b: FocusSandbox): number {
  const stateScore = (item: FocusSandbox) => item.state === 'active' ? 3 : item.state === 'paused' ? 2 : 1;
  const priorityDelta = stateScore(b) - stateScore(a);
  if (priorityDelta) return priorityDelta;
  const progressDelta = b.progress - a.progress;
  if (progressDelta) return progressDelta;
  return timeOf(b.updatedAt) - timeOf(a.updatedAt);
}

function briefFromSandbox(sandbox: FocusSandbox, action?: FocusAction | null): FocusBriefItem {
  return {
    id: sandbox.id,
    title: sandbox.title,
    summary: sandbox.breakpoint || sandbox.summary || null,
    updatedAt: sandbox.updatedAt || null,
    workspaceName: sandbox.workspaceName || null,
    action: action ?? primaryActionForSandbox(sandbox),
  };
}

function primaryActionForSandbox(sandbox: FocusSandbox): FocusAction | null {
  if (sandbox.sourceRef) return { kind: 'continue', label: '继续现场', sourceRef: sandbox.sourceRef };
  if (sandbox.taskId) return { kind: 'open-task', label: '打开任务', taskId: sandbox.taskId, url: sandbox.jiraUrl || null };
  if (sandbox.jiraUrl) return { kind: 'sync', label: '打开 Jira', url: sandbox.jiraUrl };
  return null;
}

function recommendationForSandbox(sandbox: FocusSandbox, index: number): FocusRecommendation {
  const high = sandbox.state === 'active' && (sandbox.status === 'coding' || sandbox.status === 'review' || sandbox.progress >= 50);
  return {
    ...briefFromSandbox(sandbox),
    priority: high || index === 0 ? 'high' : index === 1 ? 'medium' : 'low',
    sandboxId: sandbox.id,
    reason: sandbox.state === 'active'
      ? '这个沙盒已经有进展或阻塞点，最适合直接接回现场。'
      : '这个沙盒有明确上下文，适合排进今日计划。',
  };
}

function buildHeadline(activeCount: number, incomingCount: number, cleanupCount: number): string {
  if (activeCount > 0) return `今天先看 ${Math.min(activeCount, 3)} 个活跃沙盒，外部新增 ${incomingCount} 项，待清理 ${cleanupCount} 个低价值 chat。`;
  if (incomingCount > 0) return `没有正在燃烧的沙盒，先处理 ${incomingCount} 个新进入项。`;
  if (cleanupCount > 0) return `当前工作台很安静，可以先做一次记忆沉淀和噪音清理。`;
  return '当前工作台清爽，适合直接开启一个新任务沙盒。';
}

function sessionLinkedToTaskKeys(tasks: ProTask[]): Set<string> {
  const keys = new Set<string>();
  for (const task of tasks) {
    for (const run of task.stageRuns || []) {
      if (run.session?.workdir && run.session.agent && run.session.sessionId) {
        keys.add(focusSessionKey(run.session.workdir, run.session.agent, run.session.sessionId));
      }
    }
    for (const output of task.outputs || []) {
      if (output.session?.workdir && output.session.agent && output.session.sessionId) {
        keys.add(focusSessionKey(output.session.workdir, output.session.agent, output.session.sessionId));
      }
    }
  }
  return keys;
}

function workspaceNameFor(workdir: string, workspaces: WorkspaceEntry[]): string | null {
  const workspace = workspaces.find(item => item.path === workdir);
  return workspace?.name || workdir.split('/').filter(Boolean).at(-1) || workdir;
}

function persistedRecordToSandbox(
  record: FocusSandboxRecord,
  projectedById: Map<string, FocusSandbox>,
  workspaces: WorkspaceEntry[],
): FocusSandbox {
  const linkedId = record.taskId ? `task:${record.taskId}` : record.sessionRef
    ? `chat:${focusSessionKey(record.sessionRef.workdir, record.sessionRef.agent, record.sessionRef.sessionId)}`
    : null;
  const projected = linkedId ? projectedById.get(linkedId) : null;
  const sourceRef = record.sessionRef ? {
    type: 'chat' as const,
    workdir: record.sessionRef.workdir,
    agent: record.sessionRef.agent,
    sessionId: record.sessionRef.sessionId,
    title: record.title,
  } : projected?.sourceRef || null;
  return {
    id: `store:${record.id}`,
    type: record.kind,
    state: record.state,
    title: record.jiraKey ? `${record.jiraKey} · ${record.title}` : record.title,
    summary: projected?.summary || null,
    progress: projected?.progress ?? (record.state === 'completed' ? 100 : record.state === 'active' ? 55 : 25),
    workdir: record.scope.workdir,
    workspaceName: workspaceNameFor(record.scope.workdir, workspaces),
    agent: projected?.agent || record.sessionRef?.agent || null,
    sessionId: projected?.sessionId || record.sessionRef?.sessionId || null,
    taskId: record.taskId || projected?.taskId || null,
    jiraKey: record.jiraKey || projected?.jiraKey || null,
    jiraUrl: projected?.jiraUrl || null,
    status: projected?.status || record.state,
    updatedAt: record.updatedAt,
    breakpoint: projected?.breakpoint || null,
    nextActions: projected?.nextActions || ['继续现场'],
    evidence: projected?.evidence || [{ kind: 'task', label: record.kind, count: 1 }],
    sourceRef,
  };
}

function mergeSandboxes(
  projected: FocusSandbox[],
  persisted: FocusSandboxRecord[],
  workspaces: WorkspaceEntry[],
): FocusSandbox[] {
  const projectedById = new Map(projected.map(item => [item.id, item]));
  const persistedIds = new Set(persisted.map(item => item.id));
  const fromStore = persisted.map(record => persistedRecordToSandbox(record, projectedById, workspaces));
  const storeLinkedProjectedIds = new Set<string>();
  for (const record of persisted) {
    if (record.taskId) storeLinkedProjectedIds.add(`task:${record.taskId}`);
    if (record.sessionRef) {
      storeLinkedProjectedIds.add(`chat:${focusSessionKey(record.sessionRef.workdir, record.sessionRef.agent, record.sessionRef.sessionId)}`);
    }
  }
  const unlinkedProjected = projected.filter(item => !storeLinkedProjectedIds.has(item.id));
  return [...fromStore, ...unlinkedProjected].sort(sandboxSort);
}

export function buildFocusCanvas(command: FocusCommandCenter, outputs: FocusOutputProjection[]): FocusCanvasBlock[] {
  return [
    { type: 'standup', title: 'Daily standup', standup: command.standup },
    { type: 'sandbox-grid', title: 'Active sandboxes', sandboxes: command.sandboxes.active, maxVisible: FOCUS_ACTIVE_SANDBOX_CAP },
    { type: 'checkout', title: 'Check-out', checkout: command.checkout },
    { type: 'memory-strip', title: 'Memory layer', memory: command.memory, artifacts: outputs.slice(0, 8) },
  ];
}

export function buildFocusCommandCenter(input: BuildFocusCommandCenterInput): FocusCommandCenter {
  const now = input.now || new Date();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const taskLinkedSessions = sessionLinkedToTaskKeys(input.tasks);
  const taskSandboxes = input.tasks.map(task => taskToSandbox(task, input.workspaces, input.knowledge, input.git));
  const chatSandboxes = input.sessions
    .filter(session => !taskLinkedSessions.has(focusSessionKey(session.workdir, session.agent, session.sessionId)))
    .filter(session => isSessionSandbox(session, input.knowledge))
    .map(session => sessionToSandbox(session, input.knowledge, input.digestBySessionKey));

  const projectedSandboxes = [...taskSandboxes, ...chatSandboxes];
  const allSandboxes = mergeSandboxes(projectedSandboxes, input.persistedSandboxes || [], input.workspaces);
  const activeAll = allSandboxes.filter(item => item.state === 'active');
  const active = activeAll.slice(0, FOCUS_ACTIVE_SANDBOX_CAP);
  const overflowActive = activeAll.slice(FOCUS_ACTIVE_SANDBOX_CAP);
  const paused = [...overflowActive, ...allSandboxes.filter(item => item.state === 'paused')].slice(0, 12);
  const completed = allSandboxes.filter(item => item.state === 'completed').slice(0, 12);
  const recentlyUpdated = allSandboxes.filter(item => {
    const updated = timeOf(item.updatedAt);
    return updated >= yesterdayStart.getTime() && updated < todayStart.getTime();
  });
  const todayIncoming = [
    ...input.tasks
      .filter(task => task.plannedDate === localDateKey(now) || newestTime(task.jiraFields?.updatedAt, task.updatedAt) >= todayStart.getTime())
      .slice(0, 8)
      .map(task => briefFromSandbox(taskToSandbox(task, input.workspaces, input.knowledge, input.git))),
    ...input.sessions
      .filter(session => !session.archived && (session.runState === 'running' || session.runState === 'incomplete'))
      .slice(0, 4)
      .map(session => briefFromSandbox(sessionToSandbox(session, input.knowledge, input.digestBySessionKey))),
  ].slice(0, 8);
  const cleanupCandidates = input.sessions
    .filter(session => !session.archived && isAutoSinkEligible(session, new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)))
    .slice(0, 8)
    .map(session => ({
      id: `cleanup:${focusSessionKey(session.workdir, session.agent, session.sessionId)}`,
      title: session.title || session.lastQuestion || 'Low-value chat',
      summary: '已处理且没有产物/计划/知识信号，适合自动下沉。',
      updatedAt: session.userStatusUpdatedAt || session.runUpdatedAt || session.createdAt || null,
      workspaceName: session.workspaceName || null,
      action: sessionSourceRef(session) ? { kind: 'open-source' as const, label: '查看来源', sourceRef: sessionSourceRef(session) } : null,
    }));
  const completedToday = completed
    .filter(item => timeOf(item.updatedAt) >= todayStart.getTime())
    .slice(0, 8)
    .map(item => briefFromSandbox(item));
  const syncProposals = input.tasks
    .filter(task => task.status === 'resolved' && (task.jiraKey || task.jiraUrl))
    .slice(0, 8)
    .map(task => ({
      ...briefFromSandbox(taskToSandbox(task, input.workspaces, input.knowledge, input.git), {
        kind: 'sync',
        label: '同步 Jira',
        taskId: task.id,
        url: task.jiraUrl || null,
      }),
      summary: '代码侧已进入 resolved，可以确认是否流转 Jira / QA。',
    }));

  const recommendations = input.orchestratorRecommendations?.length
    ? input.orchestratorRecommendations.slice(0, 3)
    : [...active, ...paused].slice(0, 3).map((sandbox, index) => recommendationForSandbox(sandbox, index));

  const command: FocusCommandCenter = {
    generatedAt: now.toISOString(),
    localDay: localDateKey(now),
    headline: input.orchestratorHeadline || buildHeadline(active.length, todayIncoming.length, cleanupCandidates.length),
    standup: {
      yesterdayReview: recentlyUpdated.slice(0, 6).map(item => briefFromSandbox(item)),
      todayIncoming,
      recommendations,
    },
    sandboxes: { active, paused, completed },
    checkout: {
      completedToday,
      syncProposals,
      cleanupCandidates,
    },
    memory: {
      knowledgeCount: input.knowledge.length,
      hiddenKnowledgeCount: input.hiddenKnowledgeCount,
      outputCount: input.outputs.length,
      candidateCount: input.candidateCount,
    },
    git: input.git,
  };
  command.canvas = buildFocusCanvas(command, input.outputs);
  return command;
}

export async function inspectFocusGit(workspaces: WorkspaceEntry[]): Promise<FocusGitSnapshot[]> {
  const limited = workspaces.slice(0, 12);
  return Promise.all(limited.map(async workspace => {
    try {
      const [branch, status, log] = await Promise.all([
        execFileAsync('git', ['-C', workspace.path, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 1500, maxBuffer: 64 * 1024 }),
        execFileAsync('git', ['-C', workspace.path, 'status', '--short'], { timeout: 1500, maxBuffer: 128 * 1024 }),
        execFileAsync('git', ['-C', workspace.path, 'log', '-1', '--pretty=%s'], { timeout: 1500, maxBuffer: 64 * 1024 }).catch(() => ({ stdout: '' })),
      ]);
      const changedLines = status.stdout.split('\n').filter(line => line.trim());
      const changedFiles = changedLines.length;
      return {
        workdir: workspace.path,
        workspaceName: workspace.name,
        branch: branch.stdout.trim() || null,
        changedFiles,
        lastCommitMessage: log.stdout.trim() || null,
        hasUnstaged: changedLines.some(line => line.startsWith(' M') || line.startsWith('??') || line.startsWith(' M')),
        ok: true,
      };
    } catch (error: any) {
      return {
        workdir: workspace.path,
        workspaceName: workspace.name,
        changedFiles: 0,
        ok: false,
        error: error?.message || String(error),
      };
    }
  }));
}
