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

export interface TaskEstimate {
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
  output?: {
    summary?: string;
    estimate?: TaskEstimate;
    branch?: string;
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
    | 'focus-finished';
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
  jiraKey?: string;
  jiraUrl?: string;
  sprint?: string;
  createdAt: string;
  updatedAt: string;
  stageRuns: StageRun[];
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
    jiraKey: normalizeText(input.jiraKey, 80) || undefined,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    sprint: normalizeText(input.sprint, 120) || undefined,
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    events: [],
  };
  appendEvent(task, { type: 'jira-synced', actor: 'user', summary: 'Task created in Pikiclaw.' });
  const file = readFile();
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

