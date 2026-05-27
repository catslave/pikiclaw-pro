/**
 * Minimal Pro task store.
 *
 * This is the first durable layer above raw agent sessions. A ProTask owns the
 * Jira/task workflow state; each stage run points back to the chat session that
 * actually performed the work.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProTaskKind = 'manual' | 'todo' | 'jira-ticket' | 'jira-bug' | 'jira-epic' | 'automation';
export type ProTaskStatus = 'backlog' | 'refinement' | 'coding' | 'resolved' | 'done';
export type ProTaskStage = 'refinement' | 'focus' | 'coding' | 'verification' | 'demo' | 'bugfix' | 'knowledge';
export type ProStageRunStatus = 'queued' | 'running' | 'waiting-user' | 'completed' | 'failed' | 'cancelled';
export type VerificationResult = 'passed' | 'failed' | 'blocked' | 'not-run';

export interface TaskEstimate {
  estimatePoint?: number;
  codingMinutes?: number;
  userUnderstandingMinutes?: number;
  reviewMinutes?: number;
  verificationMinutes?: number;
  totalMinutes?: number;
  confidence?: 'low' | 'medium' | 'high';
  assumptions?: string[];
}

export interface StageSessionRef {
  workdir: string;
  agent: string;
  sessionId: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  kind: 'goal' | 'scope' | 'constraint' | 'risk' | 'acceptance' | 'plan' | 'question';
  parentId?: string;
  status?: 'open' | 'confirmed' | 'risk' | 'done';
}

export interface FocusQuestion {
  id: string;
  topic: 'goal' | 'boundary' | 'acceptance' | 'risk' | 'dependency' | 'estimate';
  question: string;
  answer?: string;
  status: 'open' | 'answered' | 'skipped';
}

export interface FocusSessionState {
  mindMap: MindMapNode[];
  questions: FocusQuestion[];
  confirmed?: boolean;
}

export interface VerificationRun {
  id: string;
  taskId: string;
  stageRunId?: string;
  environment: string;
  pipeline?: {
    provider?: 'gitlab' | 'github' | 'jenkins' | 'manual';
    pipelineId?: string;
    url?: string;
    status?: 'unknown' | 'running' | 'success' | 'failed';
    commit?: string;
    branch?: string;
  };
  browserSession?: {
    url: string;
    profile: 'pikiclaw-managed';
    loginStatus?: 'auto-login-ok' | 'manual-required' | 'failed';
  };
  result?: VerificationResult;
  notes?: string;
  startedAt: string;
  completedAt?: string;
}

export interface StageRun {
  id: string;
  taskId: string;
  stage: ProTaskStage;
  status: ProStageRunStatus;
  assistantId?: string;
  selectedAgent?: string;
  selectedAgentReason?: string;
  session: StageSessionRef;
  prompt: string;
  startedAt?: string;
  completedAt?: string;
  focus?: FocusSessionState;
  verificationRunId?: string;
  output?: {
    summary?: string;
    estimate?: TaskEstimate;
    branch?: string;
    diffSummary?: string;
    changedFiles?: string[];
    testResultId?: string;
    knowledgeRefs?: string[];
  };
}

export interface ProTaskEvent {
  id: string;
  taskId: string;
  type:
    | 'jira-synced'
    | 'jira-updated'
    | 'status-changed'
    | 'assistant-run'
    | 'comment'
    | 'bug-added'
    | 'knowledge-created'
    | 'verification-started'
    | 'verification-finished'
    | 'deployment-linked'
    | 'focus-started'
    | 'focus-finished'
    | 'exclusive-mode-changed';
  createdAt: string;
  actor: 'user' | 'system' | 'assistant';
  summary: string;
  diff?: unknown;
}

export interface ProTask {
  id: string;
  title: string;
  description?: string;
  kind: ProTaskKind;
  status: ProTaskStatus;
  workdir?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  jiraKey?: string;
  jiraUrl?: string;
  sprint?: string;
  createdAt: string;
  updatedAt: string;
  stageRuns: StageRun[];
  verificationRuns: VerificationRun[];
  exclusiveMode?: boolean;
  events: ProTaskEvent[];
}

interface ProTaskFile {
  version: 1;
  tasks: ProTask[];
}

export interface CreateProTaskInput {
  title: string;
  description?: string;
  kind?: ProTaskKind;
  status?: ProTaskStatus;
  workdir?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  jiraKey?: string;
  jiraUrl?: string;
  sprint?: string;
}

export interface StartStageRunInput {
  taskId: string;
  stage: ProTaskStage;
  status?: ProStageRunStatus;
  prompt: string;
  session: StageSessionRef;
  assistantId?: string;
  selectedAgentReason?: string;
}

export interface SyncJiraTaskInput {
  title: string;
  description?: string;
  issueType?: string;
  jiraKey?: string;
  jiraUrl?: string;
  sprint?: string;
  workdir?: string;
}

export interface UpdateStageRunInput {
  status?: ProStageRunStatus;
  summary?: string;
  estimate?: TaskEstimate;
  branch?: string;
  diffSummary?: string;
  changedFiles?: string[];
  testResultId?: string;
  knowledgeRefs?: string[];
  focus?: FocusSessionState;
}

export interface StartVerificationInput {
  environment: string;
  url: string;
  pipeline?: VerificationRun['pipeline'];
  stageRunId?: string;
}

const VALID_STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const VALID_KINDS: ProTaskKind[] = ['manual', 'todo', 'jira-ticket', 'jira-bug', 'jira-epic', 'automation'];
const VALID_STAGES: ProTaskStage[] = ['refinement', 'focus', 'coding', 'verification', 'demo', 'bugfix', 'knowledge'];

function taskFilePath() {
  return process.env.PIKICLAW_PRO_TASK_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'tasks.json');
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeText(value: unknown, max = 16_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function readFile(): ProTaskFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskFilePath(), 'utf-8')) as ProTaskFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
    return {
      version: 1,
      tasks: parsed.tasks.filter(task => task && typeof task.id === 'string' && typeof task.title === 'string'),
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeFile(file: ProTaskFile) {
  const filePath = taskFilePath();
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function appendEvent(task: ProTask, event: Omit<ProTaskEvent, 'id' | 'taskId' | 'createdAt'>) {
  task.events.unshift({
    id: newId('event'),
    taskId: task.id,
    createdAt: new Date().toISOString(),
    ...event,
  });
}

function taskKindFromIssueType(issueType: string | undefined): ProTaskKind {
  const normalized = normalizeText(issueType, 80).toLowerCase();
  if (normalized === 'bug') return 'jira-bug';
  if (normalized === 'epic' || normalized === 'initiative' || normalized === 'init') return 'jira-epic';
  return 'jira-ticket';
}

function defaultFocusState(task: Pick<ProTask, 'title' | 'description'>): FocusSessionState {
  return {
    mindMap: [
      { id: 'goal', label: `Goal: ${task.title}`, kind: 'goal', status: 'open' },
      { id: 'scope', label: 'Scope', kind: 'scope', parentId: 'goal', status: 'open' },
      { id: 'non-goals', label: 'Non-goals / boundaries', kind: 'constraint', parentId: 'goal', status: 'open' },
      { id: 'acceptance', label: 'Acceptance criteria', kind: 'acceptance', parentId: 'goal', status: 'open' },
      { id: 'risks', label: 'Risks', kind: 'risk', parentId: 'goal', status: 'open' },
      { id: 'plan', label: 'Plan', kind: 'plan', parentId: 'goal', status: 'open' },
    ],
    questions: [
      { id: newId('q'), topic: 'goal', question: 'What is the exact user/business goal of this ticket?', status: 'open' },
      { id: newId('q'), topic: 'boundary', question: 'What is explicitly out of scope for this task?', status: 'open' },
      { id: newId('q'), topic: 'acceptance', question: 'What observable checks prove this is done?', status: 'open' },
      { id: newId('q'), topic: 'risk', question: 'Which regressions or dependencies should be watched?', status: 'open' },
      { id: newId('q'), topic: 'estimate', question: 'How much time should be reserved for coding, review, understanding, and verification?', status: 'open' },
    ],
    confirmed: false,
  };
}

export function isProTaskStatus(value: string): value is ProTaskStatus {
  return VALID_STATUSES.includes(value as ProTaskStatus);
}

export function isProTaskStage(value: string): value is ProTaskStage {
  return VALID_STAGES.includes(value as ProTaskStage);
}

export function listProTasks(): ProTask[] {
  return readFile().tasks.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getProTask(taskId: string): ProTask | null {
  return readFile().tasks.find(task => task.id === taskId) || null;
}

export function createProTask(input: CreateProTaskInput): ProTask {
  const now = new Date().toISOString();
  const title = normalizeText(input.title, 240);
  if (!title) throw new Error('title is required');
  const kind = input.kind && VALID_KINDS.includes(input.kind) ? input.kind : 'jira-ticket';
  const status = input.status && VALID_STATUSES.includes(input.status) ? input.status : 'backlog';
  const task: ProTask = {
    id: newId('task'),
    title,
    description: normalizeText(input.description),
    kind,
    status,
    workdir: normalizeText(input.workdir, 2048) || undefined,
    defaultAgent: normalizeText(input.defaultAgent, 80) || undefined,
    defaultAssistantId: normalizeText(input.defaultAssistantId, 120) || undefined,
    jiraKey: normalizeText(input.jiraKey, 80) || undefined,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    sprint: normalizeText(input.sprint, 120) || undefined,
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    verificationRuns: [],
    exclusiveMode: false,
    events: [],
  };
  appendEvent(task, { type: 'jira-synced', actor: 'user', summary: 'Task created in Pikiclaw.' });
  const file = readFile();
  file.tasks.unshift(task);
  writeFile(file);
  return task;
}

export function syncJiraTask(input: SyncJiraTaskInput): ProTask {
  const title = normalizeText(input.title, 240);
  if (!title) throw new Error('title is required');
  const jiraKey = normalizeText(input.jiraKey, 80) || undefined;
  const file = readFile();
  const now = new Date().toISOString();
  const existing = jiraKey
    ? file.tasks.find(task => task.jiraKey && task.jiraKey.toLowerCase() === jiraKey.toLowerCase())
    : null;

  if (existing) {
    const changes: string[] = [];
    if (existing.title !== title) changes.push('title');
    const description = normalizeText(input.description);
    if ((existing.description || '') !== description) changes.push('description');
    const sprint = normalizeText(input.sprint, 120) || undefined;
    if ((existing.sprint || '') !== (sprint || '')) changes.push('sprint');
    existing.title = title;
    existing.description = description;
    existing.kind = taskKindFromIssueType(input.issueType);
    existing.jiraUrl = normalizeText(input.jiraUrl, 2048) || existing.jiraUrl;
    existing.sprint = sprint;
    existing.workdir = normalizeText(input.workdir, 2048) || existing.workdir;
    existing.updatedAt = now;
    appendEvent(existing, {
      type: changes.length ? 'jira-updated' : 'jira-synced',
      actor: 'system',
      summary: changes.length
        ? `Jira issue ${jiraKey} updated: ${changes.join(', ')}.`
        : `Jira issue ${jiraKey} synced with no field changes.`,
    });
    writeFile(file);
    return existing;
  }

  const task: ProTask = {
    id: newId('task'),
    title,
    description: normalizeText(input.description),
    kind: taskKindFromIssueType(input.issueType),
    status: 'backlog',
    workdir: normalizeText(input.workdir, 2048) || undefined,
    jiraKey,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    sprint: normalizeText(input.sprint, 120) || undefined,
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    verificationRuns: [],
    exclusiveMode: false,
    events: [],
  };
  appendEvent(task, { type: 'jira-synced', actor: 'system', summary: jiraKey ? `Jira issue ${jiraKey} synced.` : 'Jira issue synced.' });
  file.tasks.unshift(task);
  writeFile(file);
  return task;
}

export function updateProTaskStatus(taskId: string, status: ProTaskStatus): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  if (task.status !== status) {
    const previous = task.status;
    task.status = status;
    task.updatedAt = new Date().toISOString();
    appendEvent(task, {
      type: 'status-changed',
      actor: 'user',
      summary: `Status changed from ${previous} to ${status}.`,
    });
    writeFile(file);
  }
  return task;
}

export function addStageRun(input: StartStageRunInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === input.taskId);
  if (!task) throw new Error('task not found');
  const now = new Date().toISOString();
  const run: StageRun = {
    id: newId('stage'),
    taskId: task.id,
    stage: input.stage,
    status: input.status || 'queued',
    assistantId: normalizeText(input.assistantId, 160) || undefined,
    selectedAgent: input.session.agent,
    selectedAgentReason: normalizeText(input.selectedAgentReason, 500) || 'Selected by current runtime/default agent.',
    session: input.session,
    prompt: normalizeText(input.prompt, 24_000),
    startedAt: now,
    ...(input.stage === 'focus' ? { focus: defaultFocusState(task) } : {}),
  };
  task.stageRuns.unshift(run);
  task.updatedAt = now;
  appendEvent(task, {
    type: input.stage === 'focus' ? 'focus-started' : input.stage === 'verification' ? 'verification-started' : 'assistant-run',
    actor: 'system',
    summary: `${input.stage} stage queued in ${input.session.agent}:${input.session.sessionId}.`,
  });
  writeFile(file);
  return task;
}

export function updateStageRun(taskId: string, stageRunId: string, input: UpdateStageRunInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const run = task.stageRuns.find(candidate => candidate.id === stageRunId);
  if (!run) throw new Error('stage run not found');
  const now = new Date().toISOString();
  if (input.status) {
    run.status = input.status;
    if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') run.completedAt = now;
  }
  if (input.focus) run.focus = input.focus;
  run.output = {
    ...(run.output || {}),
    ...(normalizeText(input.summary) ? { summary: normalizeText(input.summary) } : {}),
    ...(input.estimate ? { estimate: input.estimate } : {}),
    ...(normalizeText(input.branch, 240) ? { branch: normalizeText(input.branch, 240) } : {}),
    ...(normalizeText(input.diffSummary, 4000) ? { diffSummary: normalizeText(input.diffSummary, 4000) } : {}),
    ...(input.changedFiles ? { changedFiles: input.changedFiles.map(file => normalizeText(file, 1000)).filter(Boolean) } : {}),
    ...(normalizeText(input.testResultId, 240) ? { testResultId: normalizeText(input.testResultId, 240) } : {}),
    ...(input.knowledgeRefs ? { knowledgeRefs: input.knowledgeRefs.filter(ref => typeof ref === 'string' && ref.trim()) } : {}),
  };
  task.updatedAt = now;
  appendEvent(task, {
    type: run.stage === 'focus' && input.status === 'completed' ? 'focus-finished' : 'assistant-run',
    actor: 'user',
    summary: `${run.stage} stage updated${input.status ? ` to ${input.status}` : ''}.`,
  });
  writeFile(file);
  return task;
}

export function setExclusiveMode(taskId: string, enabled: boolean): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  if (!!task.exclusiveMode !== enabled) {
    task.exclusiveMode = enabled;
    task.updatedAt = new Date().toISOString();
    appendEvent(task, {
      type: 'exclusive-mode-changed',
      actor: 'user',
      summary: enabled
        ? 'Exclusive mode enabled for this task. Other work should remain queued while coding.'
        : 'Exclusive mode disabled for this task.',
    });
    writeFile(file);
  }
  return task;
}

export function startVerificationRun(taskId: string, input: StartVerificationInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const now = new Date().toISOString();
  const environment = normalizeText(input.environment, 120) || 'manual';
  const url = normalizeText(input.url, 2048);
  if (!url) throw new Error('url is required');
  const stageRunId = normalizeText(input.stageRunId, 160) || undefined;
  const linkedStageRun = stageRunId
    ? task.stageRuns.find(candidate => candidate.id === stageRunId)
    : undefined;
  if (stageRunId && !linkedStageRun) throw new Error('stage run not found');
  const run: VerificationRun = {
    id: newId('verify'),
    taskId,
    stageRunId,
    environment,
    pipeline: input.pipeline,
    browserSession: {
      url,
      profile: 'pikiclaw-managed',
      loginStatus: 'manual-required',
    },
    result: 'not-run',
    startedAt: now,
  };
  task.verificationRuns.unshift(run);
  if (linkedStageRun) linkedStageRun.verificationRunId = run.id;
  task.updatedAt = now;
  appendEvent(task, {
    type: 'verification-started',
    actor: 'user',
    summary: `Verification started for ${environment}: ${url}`,
  });
  writeFile(file);
  return task;
}

export function finishVerificationRun(taskId: string, verificationRunId: string, result: VerificationResult, notes?: string): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const run = task.verificationRuns.find(candidate => candidate.id === verificationRunId);
  if (!run) throw new Error('verification run not found');
  run.result = result;
  run.notes = normalizeText(notes, 4000) || undefined;
  run.completedAt = new Date().toISOString();
  task.updatedAt = run.completedAt;
  appendEvent(task, {
    type: 'verification-finished',
    actor: 'user',
    summary: `Verification ${result}${run.environment ? ` on ${run.environment}` : ''}.`,
  });
  writeFile(file);
  return task;
}
