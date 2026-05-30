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
export type ProSubtaskStatus = 'todo' | 'running' | 'review' | 'done' | 'blocked';
export type ProOutputKind = 'final' | 'document' | 'image' | 'file' | 'diff' | 'estimate' | 'stage-summary' | 'link';
export type TaskSpaceKind = 'personal' | 'jira' | 'custom';

export interface TaskSpace {
  id: string;
  name: string;
  kind: TaskSpaceKind;
  defaultWorkdir?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskOrigin {
  type: 'manual' | 'jira';
  key?: string;
  url?: string;
}

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

export interface ProOutput {
  id: string;
  kind: ProOutputKind;
  title: string;
  summary?: string;
  taskId: string;
  stageRunId?: string;
  session?: StageSessionRef;
  turnIndex?: number;
  path?: string;
  url?: string;
  createdAt: string;
  pinned?: boolean;
}

export interface StageRun {
  id: string;
  taskId: string;
  subtaskId?: string;
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
  outputIds?: string[];
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
    | 'task-created'
    | 'exclusive-mode-changed'
    | 'subtask-created'
    | 'subtask-updated'
    | 'user-focus-started'
    | 'user-focus-finished';
  createdAt: string;
  actor: 'user' | 'system' | 'assistant';
  summary: string;
  diff?: unknown;
}

export interface UserFocusSession {
  id: string;
  taskId: string;
  openedAt: string;
  closedAt?: string;
  durationSeconds?: number;
}

export interface ProSubtask {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  status: ProSubtaskStatus;
  assignedAgent?: string;
  assistantId?: string;
  workdir?: string;
  createdAt: string;
  updatedAt: string;
  stageRunIds: string[];
}

export interface ProTask {
  id: string;
  title: string;
  description?: string;
  kind: ProTaskKind;
  status: ProTaskStatus;
  spaceId?: string;
  origin?: TaskOrigin;
  workdir?: string;
  prUrl?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  execution?: {
    ownerMode?: 'status' | 'agent' | 'assistant';
    agent?: string;
    assistantId?: string;
    mode?: 'direct' | 'interactive';
  };
  jiraKey?: string;
  jiraUrl?: string;
  jiraFields?: {
    reporter?: string;
    assignee?: string;
    status?: string;
    dueDate?: string;
    priority?: string;
    labels?: string[];
    issueType?: string;
    updatedAt?: string;
    raw?: Record<string, unknown>;
  };
  sprint?: string;
  cycleId?: string;
  createdAt: string;
  updatedAt: string;
  stageRuns: StageRun[];
  outputs?: ProOutput[];
  verificationRuns: VerificationRun[];
  subTasks: ProSubtask[];
  focusSessions?: UserFocusSession[];
  exclusiveMode?: boolean;
  events: ProTaskEvent[];
}

interface ProTaskFile {
  version: 1;
  taskSpaces?: TaskSpace[];
  tasks: ProTask[];
}

export interface CreateTaskSpaceInput {
  name: unknown;
  kind?: unknown;
  defaultWorkdir?: unknown;
  defaultAgent?: unknown;
  defaultAssistantId?: unknown;
}

export interface UpdateTaskSpaceInput {
  name?: unknown;
  defaultWorkdir?: unknown;
  defaultAgent?: unknown;
  defaultAssistantId?: unknown;
  archived?: unknown;
}

export interface CreateProTaskInput {
  title: string;
  description?: string;
  kind?: ProTaskKind;
  status?: ProTaskStatus;
  spaceId?: string;
  workdir?: string;
  prUrl?: string;
  defaultAgent?: string;
  defaultAssistantId?: string;
  jiraKey?: string;
  jiraUrl?: string;
  sprint?: string;
}

export interface StartStageRunInput {
  taskId: string;
  subtaskId?: string;
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
  spaceId?: string;
  workdir?: string;
  prUrl?: string;
  reporter?: string;
  assignee?: string;
  ticketStatus?: string;
  dueDate?: string;
  priority?: string;
  labels?: string[];
  updatedAt?: string;
  rawFields?: Record<string, unknown>;
}

export interface UpdateJiraFieldsInput {
  reporter?: unknown;
  assignee?: unknown;
  status?: unknown;
  dueDate?: unknown;
  priority?: unknown;
  labels?: unknown;
  issueType?: unknown;
  updatedAt?: unknown;
}

export interface UpdateTaskExecutionInput {
  ownerMode?: unknown;
  agent?: unknown;
  assistantId?: unknown;
  defaultAssistantId?: unknown;
  mode?: unknown;
}

export interface UpdateTaskCycleInput {
  cycleId?: unknown;
}

export interface UpdateTaskMetaInput {
  workdir?: unknown;
  prUrl?: unknown;
}

export interface UpdateStageRunInput {
  status?: ProStageRunStatus;
  session?: StageSessionRef;
  summary?: string;
  estimate?: TaskEstimate;
  branch?: string;
  diffSummary?: string;
  changedFiles?: string[];
  testResultId?: string;
  knowledgeRefs?: string[];
  outputIds?: string[];
  focus?: FocusSessionState;
}

export interface ProTaskWorkbench {
  task: ProTask;
  activeStageRun: StageRun | null;
  outputs: ProOutput[];
  sideChats: Array<StageSessionRef & { parentStageRunId?: string; title?: string }>;
  files: Array<{ path: string; workdir?: string; stageRunId?: string; outputId?: string; label?: string }>;
  ticketSnapshot: {
    jiraKey?: string;
    jiraUrl?: string;
    title: string;
    description?: string;
    reporter?: string;
    assignee?: string;
    status?: string;
    dueDate?: string;
    priority?: string;
    labels?: string[];
    issueType?: string;
    sprint?: string;
    updatedAt?: string;
  };
}

export interface StartVerificationInput {
  environment: string;
  url: string;
  pipeline?: VerificationRun['pipeline'];
  stageRunId?: string;
}

export interface CreateSubtaskInput {
  title: unknown;
  description?: unknown;
  status?: unknown;
  assignedAgent?: unknown;
  assistantId?: unknown;
  workdir?: unknown;
}

export interface UpdateSubtaskInput {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  assignedAgent?: unknown;
  assistantId?: unknown;
  workdir?: unknown;
  stageRunId?: unknown;
}

export interface StartUserFocusInput {
  source?: unknown;
}

const VALID_STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const VALID_KINDS: ProTaskKind[] = ['manual', 'todo', 'jira-ticket', 'jira-bug', 'jira-epic', 'automation'];
const VALID_STAGES: ProTaskStage[] = ['refinement', 'focus', 'coding', 'verification', 'demo', 'bugfix', 'knowledge'];
const VALID_SUBTASK_STATUSES: ProSubtaskStatus[] = ['todo', 'running', 'review', 'done', 'blocked'];
const VALID_TASK_SPACE_KINDS: TaskSpaceKind[] = ['personal', 'jira', 'custom'];
export const JIRA_TASK_SPACE_ID = 'jira';
export const PERSONAL_TASK_SPACE_ID = 'personal';
const BUILTIN_TASK_SPACES: TaskSpace[] = [
  {
    id: JIRA_TASK_SPACE_ID,
    name: 'Jira',
    kind: 'jira',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  },
  {
    id: PERSONAL_TASK_SPACE_ID,
    name: 'Personal',
    kind: 'personal',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  },
];

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

function isJiraTaskKind(kind: ProTaskKind | undefined): boolean {
  return kind === 'jira-ticket' || kind === 'jira-bug' || kind === 'jira-epic';
}

function defaultSpaceIdForTask(task: Pick<ProTask, 'kind' | 'jiraKey'>): string {
  return isJiraTaskKind(task.kind) || !!task.jiraKey ? JIRA_TASK_SPACE_ID : PERSONAL_TASK_SPACE_ID;
}

function defaultOriginForTask(task: Pick<ProTask, 'kind' | 'jiraKey' | 'jiraUrl'>): TaskOrigin {
  if (isJiraTaskKind(task.kind) || task.jiraKey || task.jiraUrl) {
    return { type: 'jira', key: task.jiraKey, url: task.jiraUrl };
  }
  return { type: 'manual' };
}

function normalizeTaskSpaceId(value: unknown): string | undefined {
  return normalizeText(value, 160) || undefined;
}

function knownTaskSpaceIds(file: ProTaskFile): Set<string> {
  return new Set([...BUILTIN_TASK_SPACES, ...(file.taskSpaces || [])].filter(space => !space.archived).map(space => space.id));
}

function resolveTaskSpaceId(inputSpaceId: unknown, task: Pick<ProTask, 'kind' | 'jiraKey'>, file: ProTaskFile): string {
  const candidate = normalizeTaskSpaceId(inputSpaceId);
  const known = knownTaskSpaceIds(file);
  if (candidate && known.has(candidate)) return candidate;
  return defaultSpaceIdForTask(task);
}

function normalizeTaskOrigin(value: unknown, task: Pick<ProTask, 'kind' | 'jiraKey' | 'jiraUrl'>): TaskOrigin {
  if (!value || typeof value !== 'object') return defaultOriginForTask(task);
  const origin = value as Partial<TaskOrigin>;
  const type = origin.type === 'jira' ? 'jira' : origin.type === 'manual' ? 'manual' : defaultOriginForTask(task).type;
  return {
    type,
    key: normalizeText(origin.key, 120) || (type === 'jira' ? task.jiraKey : undefined),
    url: normalizeText(origin.url, 2048) || (type === 'jira' ? task.jiraUrl : undefined),
  };
}

function normalizeTaskSpace(value: unknown): TaskSpace | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TaskSpace>;
  const id = normalizeText(raw.id, 160);
  const name = normalizeText(raw.name, 160);
  const kind = VALID_TASK_SPACE_KINDS.includes(raw.kind as TaskSpaceKind) ? raw.kind as TaskSpaceKind : 'custom';
  if (!id || !name) return null;
  return {
    id,
    name,
    kind,
    defaultWorkdir: normalizeText(raw.defaultWorkdir, 2048) || undefined,
    defaultAgent: normalizeText(raw.defaultAgent, 80) || undefined,
    defaultAssistantId: normalizeText(raw.defaultAssistantId, 160) || undefined,
    archived: raw.archived === true,
    createdAt: normalizeText(raw.createdAt, 80) || new Date().toISOString(),
    updatedAt: normalizeText(raw.updatedAt, 80) || new Date().toISOString(),
  };
}

function readFile(): ProTaskFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskFilePath(), 'utf-8')) as ProTaskFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
    const taskSpaces = Array.isArray((parsed as any).taskSpaces)
      ? (parsed as any).taskSpaces.map(normalizeTaskSpace).filter((space: TaskSpace | null): space is TaskSpace => !!space && !BUILTIN_TASK_SPACES.some(item => item.id === space.id))
      : [];
    return {
      version: 1,
      taskSpaces,
      tasks: parsed.tasks
        .filter(task => task && typeof task.id === 'string' && typeof task.title === 'string')
        .map(task => {
          const kind = VALID_KINDS.includes((task as any).kind) ? (task as any).kind as ProTaskKind : taskKindFromIssueType((task as any).jiraFields?.issueType);
          const normalized: ProTask = {
          ...(task as any),
          kind,
          spaceId: normalizeTaskSpaceId((task as any).spaceId) || defaultSpaceIdForTask({ kind, jiraKey: (task as any).jiraKey }),
          origin: normalizeTaskOrigin((task as any).origin, { kind, jiraKey: (task as any).jiraKey, jiraUrl: (task as any).jiraUrl }),
          workdir: normalizeText((task as any).workdir, 2048) || undefined,
          prUrl: normalizeText((task as any).prUrl ?? (task as any).mergeRequestUrl, 2048) || undefined,
          subTasks: Array.isArray((task as any).subTasks) ? (task as any).subTasks : [],
          stageRuns: Array.isArray(task.stageRuns)
            ? task.stageRuns.map((run: any) => ({
                ...run,
                outputIds: Array.isArray(run.outputIds) ? run.outputIds.filter((id: unknown) => typeof id === 'string' && id.trim()) : [],
              }))
            : [],
          outputs: Array.isArray((task as any).outputs) ? normalizeOutputs((task as any).outputs, task.id) : [],
          verificationRuns: Array.isArray(task.verificationRuns) ? task.verificationRuns : [],
          focusSessions: Array.isArray((task as any).focusSessions) ? (task as any).focusSessions : [],
          cycleId: normalizeText((task as any).cycleId, 120) || undefined,
          jiraFields: (task as any).jiraFields && typeof (task as any).jiraFields === 'object' ? (task as any).jiraFields : undefined,
          events: Array.isArray(task.events) ? task.events : [],
          };
          return normalized;
        }),
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function normalizeOutputs(outputs: unknown[], taskId: string): ProOutput[] {
  return outputs
    .filter((output: any) => output && typeof output.id === 'string' && typeof output.title === 'string')
    .map((output: any) => ({
      id: normalizeText(output.id, 160),
      kind: isOutputKind(output.kind) ? output.kind : 'stage-summary',
      title: normalizeText(output.title, 240) || 'Output',
      summary: normalizeText(output.summary, 8000) || undefined,
      taskId,
      stageRunId: normalizeText(output.stageRunId, 160) || undefined,
      session: normalizeSessionRef(output.session),
      turnIndex: typeof output.turnIndex === 'number' && Number.isFinite(output.turnIndex) ? output.turnIndex : undefined,
      path: normalizeText(output.path, 2048) || undefined,
      url: normalizeText(output.url, 2048) || undefined,
      createdAt: normalizeText(output.createdAt, 80) || new Date().toISOString(),
      pinned: output.pinned === true,
    }))
    .filter(output => output.id);
}

function isOutputKind(value: unknown): value is ProOutputKind {
  return value === 'final'
    || value === 'document'
    || value === 'image'
    || value === 'file'
    || value === 'diff'
    || value === 'estimate'
    || value === 'stage-summary'
    || value === 'link';
}

function normalizeSessionRef(value: unknown): StageSessionRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const session = value as Partial<StageSessionRef>;
  const workdir = normalizeText(session.workdir, 2048);
  const agent = normalizeText(session.agent, 80);
  const sessionId = normalizeText(session.sessionId, 240);
  if (!workdir || !agent || !sessionId) return undefined;
  return { workdir, agent, sessionId };
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

function durationSeconds(start: string | undefined, end: string | undefined): number {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(0, Math.round((b - a) / 1000));
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

function stageRunTimestamp(run: StageRun): number {
  const parsed = Date.parse(run.completedAt || run.startedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveOutputKind(run: StageRun, output: NonNullable<StageRun['output']>): ProOutputKind {
  if (output.diffSummary || output.changedFiles?.length) return 'diff';
  if (output.estimate) return 'estimate';
  if (output.knowledgeRefs?.length) return 'document';
  if (output.branch || output.testResultId) return 'stage-summary';
  return run.stage === 'demo' ? 'final' : 'stage-summary';
}

function outputTitleForRun(run: StageRun, kind: ProOutputKind): string {
  const stageLabel = `${run.stage.slice(0, 1).toUpperCase()}${run.stage.slice(1)}`;
  if (kind === 'diff') return `${stageLabel} diff`;
  if (kind === 'estimate') return `${stageLabel} estimate`;
  if (kind === 'final') return `${stageLabel} result`;
  if (kind === 'document') return `${stageLabel} notes`;
  return `${stageLabel} output`;
}

function createOutputFromStageRun(task: ProTask, run: StageRun): ProOutput | null {
  const output = run.output;
  if (!output) return null;
  const summary = normalizeText(output.summary, 8000)
    || normalizeText(output.diffSummary, 8000)
    || (output.changedFiles?.length ? output.changedFiles.slice(0, 5).join('\n') : '')
    || (output.estimate ? 'Estimate updated.' : '')
    || (run.status === 'completed' ? `${run.stage} stage completed.` : '');
  if (!summary && run.status !== 'completed') return null;
  const kind = deriveOutputKind(run, output);
  return {
    id: newId('output'),
    kind,
    title: outputTitleForRun(run, kind),
    summary,
    taskId: task.id,
    stageRunId: run.id,
    session: run.session,
    createdAt: new Date().toISOString(),
    pinned: false,
  };
}

function deriveStoredOutput(task: ProTask, run: StageRun): ProOutput | null {
  const output = run.output;
  if (!output) return null;
  const kind = deriveOutputKind(run, output);
  const createdAt = run.completedAt || run.startedAt || task.updatedAt || task.createdAt;
  const summary = normalizeText(output.summary, 8000)
    || normalizeText(output.diffSummary, 8000)
    || (output.changedFiles?.length ? output.changedFiles.slice(0, 8).join('\n') : '')
    || (output.estimate ? 'Estimate updated.' : '')
    || `${run.stage} stage output.`;
  return {
    id: `derived-${run.id}`,
    kind,
    title: outputTitleForRun(run, kind),
    summary,
    taskId: task.id,
    stageRunId: run.id,
    session: run.session,
    createdAt,
    pinned: false,
  };
}

function taskOutputs(task: ProTask): ProOutput[] {
  const explicit = Array.isArray(task.outputs) ? task.outputs : [];
  const explicitRunIds = new Set(explicit.map(output => output.stageRunId).filter(Boolean));
  const derived = (task.stageRuns || [])
    .filter(run => run.output && !explicitRunIds.has(run.id))
    .map(run => deriveStoredOutput(task, run))
    .filter((output): output is ProOutput => !!output);
  return [...explicit, ...derived]
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

function activeStageRunForTask(task: ProTask): StageRun | null {
  const runs = [...(task.stageRuns || [])].sort((a, b) => stageRunTimestamp(b) - stageRunTimestamp(a));
  return runs.find(run => run.status === 'running' || run.status === 'waiting-user' || run.status === 'queued')
    || runs[0]
    || null;
}

function ticketSnapshotForTask(task: ProTask): ProTaskWorkbench['ticketSnapshot'] {
  const fields = task.jiraFields || {};
  return {
    jiraKey: task.jiraKey,
    jiraUrl: task.jiraUrl,
    title: task.title,
    description: task.description,
    reporter: fields.reporter,
    assignee: fields.assignee,
    status: fields.status,
    dueDate: fields.dueDate,
    priority: fields.priority,
    labels: fields.labels,
    issueType: fields.issueType,
    sprint: task.sprint,
    updatedAt: fields.updatedAt || task.updatedAt,
  };
}

function filesForTask(task: ProTask, outputs: ProOutput[]): ProTaskWorkbench['files'] {
  const files: ProTaskWorkbench['files'] = [];
  const seen = new Set<string>();
  const add = (entry: ProTaskWorkbench['files'][number]) => {
    const key = `${entry.workdir || ''}:${entry.path}`;
    if (!entry.path || seen.has(key)) return;
    seen.add(key);
    files.push(entry);
  };
  for (const output of outputs) {
    if (output.path) {
      add({
        path: output.path,
        workdir: output.session?.workdir || task.workdir,
        stageRunId: output.stageRunId,
        outputId: output.id,
        label: output.title,
      });
    }
  }
  for (const run of task.stageRuns || []) {
    for (const file of run.output?.changedFiles || []) {
      add({
        path: file,
        workdir: run.session?.workdir || task.workdir,
        stageRunId: run.id,
        label: `${run.stage} changed file`,
      });
    }
  }
  return files;
}

export function isProTaskStatus(value: string): value is ProTaskStatus {
  return VALID_STATUSES.includes(value as ProTaskStatus);
}

export function isProTaskStage(value: string): value is ProTaskStage {
  return VALID_STAGES.includes(value as ProTaskStage);
}

export function isProSubtaskStatus(value: string): value is ProSubtaskStatus {
  return VALID_SUBTASK_STATUSES.includes(value as ProSubtaskStatus);
}

export function listTaskSpaces(options: { includeArchived?: boolean } = {}): TaskSpace[] {
  const file = readFile();
  const custom = (file.taskSpaces || []).filter(space => options.includeArchived || !space.archived);
  return [...BUILTIN_TASK_SPACES, ...custom]
    .sort((a, b) => {
      if (a.kind !== 'custom' && b.kind === 'custom') return -1;
      if (a.kind === 'custom' && b.kind !== 'custom') return 1;
      return Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '');
    });
}

export function createTaskSpace(input: CreateTaskSpaceInput): TaskSpace {
  const name = normalizeText(input.name, 160);
  if (!name) throw new Error('name is required');
  const now = new Date().toISOString();
  const rawKind = normalizeText(input.kind, 40);
  const kind: TaskSpaceKind = rawKind === 'personal' || rawKind === 'jira' ? rawKind : 'custom';
  if (kind !== 'custom') throw new Error('built-in task spaces already exist');
  const space: TaskSpace = {
    id: newId('space'),
    name,
    kind,
    defaultWorkdir: normalizeText(input.defaultWorkdir, 2048) || undefined,
    defaultAgent: normalizeText(input.defaultAgent, 80) || undefined,
    defaultAssistantId: normalizeText(input.defaultAssistantId, 160) || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.taskSpaces = [space, ...(file.taskSpaces || [])];
  writeFile(file);
  return space;
}

export function updateTaskSpace(spaceId: string, input: UpdateTaskSpaceInput): TaskSpace {
  const cleanId = normalizeTaskSpaceId(spaceId);
  if (!cleanId) throw new Error('task space not found');
  if (cleanId === JIRA_TASK_SPACE_ID || cleanId === PERSONAL_TASK_SPACE_ID) {
    const builtin = BUILTIN_TASK_SPACES.find(space => space.id === cleanId);
    if (!builtin) throw new Error('task space not found');
    return builtin;
  }
  const file = readFile();
  const space = (file.taskSpaces || []).find(candidate => candidate.id === cleanId);
  if (!space) throw new Error('task space not found');
  const name = Object.prototype.hasOwnProperty.call(input, 'name') ? normalizeText(input.name, 160) : '';
  if (name) space.name = name;
  if (Object.prototype.hasOwnProperty.call(input, 'defaultWorkdir')) {
    space.defaultWorkdir = normalizeText(input.defaultWorkdir, 2048) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'defaultAgent')) {
    space.defaultAgent = normalizeText(input.defaultAgent, 80) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'defaultAssistantId')) {
    space.defaultAssistantId = normalizeText(input.defaultAssistantId, 160) || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'archived')) space.archived = input.archived === true;
  space.updatedAt = new Date().toISOString();
  writeFile(file);
  return space;
}

export function archiveTaskSpace(spaceId: string): TaskSpace {
  return updateTaskSpace(spaceId, { archived: true });
}

export function listProTasks(options: { spaceId?: string } = {}): ProTask[] {
  const spaceId = normalizeTaskSpaceId(options.spaceId);
  return readFile().tasks
    .filter(task => !spaceId || task.spaceId === spaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getProTask(taskId: string): ProTask | null {
  return readFile().tasks.find(task => task.id === taskId) || null;
}

export function getProTaskWorkbench(taskId: string): ProTaskWorkbench | null {
  const task = getProTask(taskId);
  if (!task) return null;
  const outputs = taskOutputs(task);
  const activeStageRun = activeStageRunForTask(task);
  const sideChats: ProTaskWorkbench['sideChats'] = [];
  return {
    task,
    activeStageRun,
    outputs,
    sideChats,
    files: filesForTask(task, outputs),
    ticketSnapshot: ticketSnapshotForTask(task),
  };
}

export function deleteProTask(taskId: string): ProTask {
  const file = readFile();
  const index = file.tasks.findIndex(task => task.id === taskId);
  if (index < 0) throw new Error('task not found');
  const [task] = file.tasks.splice(index, 1);
  writeFile(file);
  return task;
}

export function createProTask(input: CreateProTaskInput): ProTask {
  const now = new Date().toISOString();
  const title = normalizeText(input.title, 240);
  if (!title) throw new Error('title is required');
  const file = readFile();
  const requestedKind = input.kind && VALID_KINDS.includes(input.kind) ? input.kind : undefined;
  const spaceId = resolveTaskSpaceId(input.spaceId, { kind: requestedKind || 'manual', jiraKey: input.jiraKey }, file);
  const kind = requestedKind || (spaceId === JIRA_TASK_SPACE_ID ? 'jira-ticket' : 'manual');
  const status = input.status && VALID_STATUSES.includes(input.status) ? input.status : 'backlog';
  const task: ProTask = {
    id: newId('task'),
    title,
    description: normalizeText(input.description),
    kind,
    status,
    spaceId,
    origin: defaultOriginForTask({ kind, jiraKey: input.jiraKey, jiraUrl: input.jiraUrl }),
    workdir: normalizeText(input.workdir, 2048) || undefined,
    prUrl: normalizeText(input.prUrl, 2048) || undefined,
    defaultAgent: normalizeText(input.defaultAgent, 80) || undefined,
    defaultAssistantId: normalizeText(input.defaultAssistantId, 120) || undefined,
    jiraKey: normalizeText(input.jiraKey, 80) || undefined,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    jiraFields: undefined,
    sprint: normalizeText(input.sprint, 120) || undefined,
    cycleId: undefined,
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    focusSessions: [],
    exclusiveMode: false,
    events: [],
  };
  appendEvent(task, { type: 'task-created', actor: 'user', summary: 'Task created in Pikiclaw.' });
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
  const spaceId = resolveTaskSpaceId(input.spaceId || JIRA_TASK_SPACE_ID, { kind: 'jira-ticket', jiraKey }, file);
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
    const nextJiraFields = normalizeJiraFields(input, existing.jiraFields);
    const issueType = nextJiraFields?.issueType || '';
    if ((existing.jiraFields?.issueType || '') !== issueType) changes.push('issueType');
    for (const [key, nextValue] of Object.entries({
      reporter: nextJiraFields?.reporter,
      assignee: nextJiraFields?.assignee,
      status: nextJiraFields?.status,
      dueDate: nextJiraFields?.dueDate,
      priority: nextJiraFields?.priority,
    })) {
      if (((existing.jiraFields as any)?.[key] || '') !== (nextValue || '')) changes.push(`jira.${key}`);
    }
    existing.kind = issueType ? taskKindFromIssueType(issueType) : existing.kind;
    existing.spaceId = spaceId;
    existing.origin = { type: 'jira', key: jiraKey, url: normalizeText(input.jiraUrl, 2048) || existing.jiraUrl };
    existing.jiraUrl = normalizeText(input.jiraUrl, 2048) || existing.jiraUrl;
    existing.sprint = sprint;
    existing.workdir = normalizeText(input.workdir, 2048) || existing.workdir;
    existing.prUrl = normalizeText(input.prUrl, 2048) || existing.prUrl;
    existing.jiraFields = nextJiraFields;
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
    spaceId,
    origin: { type: 'jira', key: jiraKey, url: normalizeText(input.jiraUrl, 2048) || undefined },
    workdir: normalizeText(input.workdir, 2048) || undefined,
    prUrl: normalizeText(input.prUrl, 2048) || undefined,
    jiraKey,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    jiraFields: normalizeJiraFields(input),
    sprint: normalizeText(input.sprint, 120) || undefined,
    cycleId: undefined,
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    focusSessions: [],
    exclusiveMode: false,
    events: [],
  };
  appendEvent(task, { type: 'jira-synced', actor: 'system', summary: jiraKey ? `Jira issue ${jiraKey} synced.` : 'Jira issue synced.' });
  file.tasks.unshift(task);
  writeFile(file);
  return task;
}

function normalizeJiraFields(input: SyncJiraTaskInput, current?: ProTask['jiraFields']): ProTask['jiraFields'] {
  const issueType = normalizeText(input.issueType, 80) || current?.issueType;
  return {
    ...(current || {}),
    reporter: normalizeText(input.reporter, 240) || current?.reporter,
    assignee: normalizeText(input.assignee, 240) || current?.assignee,
    status: normalizeText(input.ticketStatus, 120) || current?.status,
    dueDate: normalizeText(input.dueDate, 80) || current?.dueDate,
    priority: normalizeText(input.priority, 120) || current?.priority,
    issueType,
    labels: Array.isArray(input.labels) ? input.labels.map(label => normalizeText(label, 120)).filter(Boolean).slice(0, 40) : current?.labels,
    updatedAt: normalizeText(input.updatedAt, 80) || current?.updatedAt || new Date().toISOString(),
    raw: input.rawFields && typeof input.rawFields === 'object' ? input.rawFields : current?.raw,
  };
}

export function updateJiraFields(taskId: string, input: UpdateJiraFieldsInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const current = task.jiraFields || {};
  const labels = Array.isArray(input.labels)
    ? input.labels.map(label => normalizeText(label, 120)).filter(Boolean).slice(0, 40)
    : typeof input.labels === 'string'
      ? input.labels.split(',').map(label => normalizeText(label, 120)).filter(Boolean).slice(0, 40)
      : current.labels;
  task.jiraFields = {
    ...current,
    reporter: normalizeText(input.reporter, 240) || current.reporter,
    assignee: normalizeText(input.assignee, 240) || current.assignee,
    status: normalizeText(input.status, 120) || current.status,
    dueDate: normalizeText(input.dueDate, 80) || current.dueDate,
    priority: normalizeText(input.priority, 120) || current.priority,
    issueType: normalizeText(input.issueType, 80) || current.issueType,
    labels,
    updatedAt: normalizeText(input.updatedAt, 80) || current.updatedAt || new Date().toISOString(),
  };
  task.updatedAt = new Date().toISOString();
  appendEvent(task, { type: 'jira-updated', actor: 'user', summary: 'Jira native fields updated manually in Pikiclaw.' });
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

export function updateProTaskExecution(taskId: string, input: UpdateTaskExecutionInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const ownerMode = normalizeText(input.ownerMode, 40);
  const mode = normalizeText(input.mode, 40);
  if (Object.prototype.hasOwnProperty.call(input, 'defaultAssistantId')) {
    task.defaultAssistantId = normalizeText(input.defaultAssistantId, 160) || undefined;
  }
  task.execution = {
    ownerMode: ownerMode === 'agent' || ownerMode === 'assistant' ? ownerMode : ownerMode === 'status' ? 'status' : task.execution?.ownerMode,
    agent: normalizeText(input.agent, 80) || undefined,
    assistantId: normalizeText(input.assistantId, 160) || undefined,
    mode: mode === 'interactive' ? 'interactive' : mode === 'direct' ? 'direct' : task.execution?.mode,
  };
  if (!task.execution.ownerMode && !task.execution.agent && !task.execution.assistantId && !task.execution.mode) delete task.execution;
  task.updatedAt = new Date().toISOString();
  appendEvent(task, {
    type: 'status-changed',
    actor: 'user',
    summary: `Task execution settings updated${task.execution?.mode ? ` (${task.execution.mode})` : ''}.`,
  });
  writeFile(file);
  return task;
}

export function updateProTaskCycle(taskId: string, input: UpdateTaskCycleInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const cycleId = normalizeText(input.cycleId, 120) || undefined;
  if ((task.cycleId || '') !== (cycleId || '')) {
    task.cycleId = cycleId;
    task.updatedAt = new Date().toISOString();
    appendEvent(task, {
      type: 'status-changed',
      actor: 'user',
      summary: cycleId ? `Task assigned to cycle ${cycleId}.` : 'Task removed from cycle.',
    });
    writeFile(file);
  }
  return task;
}

export function updateProTaskMeta(taskId: string, input: UpdateTaskMetaInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const changed: string[] = [];
  if (Object.prototype.hasOwnProperty.call(input, 'workdir')) {
    const workdir = normalizeText(input.workdir, 2048) || undefined;
    if ((task.workdir || '') !== (workdir || '')) {
      task.workdir = workdir;
      changed.push('workspace');
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'prUrl')) {
    const prUrl = normalizeText(input.prUrl, 2048) || undefined;
    if ((task.prUrl || '') !== (prUrl || '')) {
      task.prUrl = prUrl;
      changed.push('PR');
    }
  }
  if (changed.length) {
    task.updatedAt = new Date().toISOString();
    appendEvent(task, {
      type: 'jira-updated',
      actor: 'user',
      summary: `Task metadata updated: ${changed.join(', ')}.`,
    });
    writeFile(file);
  }
  return task;
}

export function assignProTasksToCycle(taskIds: string[], cycleId: string): ProTask[] {
  const file = readFile();
  const uniqueIds = new Set(taskIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()));
  const cleanCycleId = normalizeText(cycleId, 120);
  if (!cleanCycleId || uniqueIds.size === 0) return [];
  const now = new Date().toISOString();
  const changed: ProTask[] = [];
  for (const task of file.tasks) {
    if (!uniqueIds.has(task.id) || task.cycleId === cleanCycleId) continue;
    task.cycleId = cleanCycleId;
    task.updatedAt = now;
    appendEvent(task, { type: 'status-changed', actor: 'system', summary: `Task assigned to cycle ${cleanCycleId}.` });
    changed.push(task);
  }
  if (changed.length) writeFile(file);
  return changed;
}

export function startUserFocusSession(taskId: string, input: StartUserFocusInput = {}): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const now = new Date().toISOString();
  task.focusSessions = Array.isArray(task.focusSessions) ? task.focusSessions : [];
  const session: UserFocusSession = {
    id: newId('focus'),
    taskId: task.id,
    openedAt: now,
  };
  task.focusSessions.unshift(session);
  task.updatedAt = now;
  const source = normalizeText(input.source, 120);
  appendEvent(task, {
    type: 'user-focus-started',
    actor: 'user',
    summary: `User entered ticket focus mode${source ? ` from ${source}` : ''}.`,
  });
  writeFile(file);
  return task;
}

export function finishUserFocusSession(taskId: string, focusSessionId: string): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  task.focusSessions = Array.isArray(task.focusSessions) ? task.focusSessions : [];
  const session = task.focusSessions.find(item => item.id === focusSessionId);
  if (!session) throw new Error('focus session not found');
  if (!session.closedAt) {
    const now = new Date().toISOString();
    session.closedAt = now;
    session.durationSeconds = durationSeconds(session.openedAt, session.closedAt);
    task.updatedAt = now;
    appendEvent(task, {
      type: 'user-focus-finished',
      actor: 'user',
      summary: `User left ticket focus mode after ${Math.max(1, Math.round((session.durationSeconds || 0) / 60))} min.`,
      diff: { focusSessionId: session.id, durationSeconds: session.durationSeconds || 0 },
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
  const subtaskId = normalizeText(input.subtaskId, 160) || undefined;
  const subtask = subtaskId ? task.subTasks.find(candidate => candidate.id === subtaskId) : undefined;
  if (subtaskId && !subtask) throw new Error('subtask not found');
  const run: StageRun = {
    id: newId('stage'),
    taskId: task.id,
    subtaskId,
    stage: input.stage,
    status: input.status || 'queued',
    assistantId: normalizeText(input.assistantId, 160) || undefined,
    selectedAgent: input.session.agent,
    selectedAgentReason: normalizeText(input.selectedAgentReason, 500) || 'Selected by current runtime/default agent.',
    session: input.session,
    prompt: normalizeText(input.prompt, 24_000),
    startedAt: now,
    outputIds: [],
    ...(input.stage === 'focus' ? { focus: defaultFocusState(task) } : {}),
  };
  task.stageRuns.unshift(run);
  if (subtask) {
    subtask.stageRunIds = Array.from(new Set([run.id, ...(subtask.stageRunIds || [])]));
    if (subtask.status === 'todo') subtask.status = 'running';
    subtask.updatedAt = now;
  }
  task.updatedAt = now;
  appendEvent(task, {
    type: input.stage === 'focus' ? 'focus-started' : input.stage === 'verification' ? 'verification-started' : 'assistant-run',
    actor: 'system',
    summary: `${input.stage} stage queued in ${input.session.agent}:${input.session.sessionId}${subtask ? ` for subtask ${subtask.title}` : ''}.`,
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
  const previousStatus = run.status;
  if (input.status) {
    run.status = input.status;
    if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') run.completedAt = now;
  }
  if (input.session?.workdir && input.session.agent && input.session.sessionId) {
    run.session = {
      workdir: normalizeText(input.session.workdir, 1000),
      agent: normalizeText(input.session.agent, 80),
      sessionId: normalizeText(input.session.sessionId, 240),
    };
    run.selectedAgent = run.session.agent;
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
  if (input.outputIds?.length) {
    run.outputIds = Array.from(new Set([...(run.outputIds || []), ...input.outputIds.filter(id => typeof id === 'string' && id.trim())]));
  }
  const hasOutputPatch = !!(
    normalizeText(input.summary)
    || input.estimate
    || normalizeText(input.branch, 240)
    || normalizeText(input.diffSummary, 4000)
    || input.changedFiles?.length
    || normalizeText(input.testResultId, 240)
    || input.knowledgeRefs?.length
  );
  if (hasOutputPatch || (input.status === 'completed' && previousStatus !== 'completed')) {
    const output = createOutputFromStageRun(task, run);
    if (output) {
      task.outputs = [output, ...(task.outputs || [])];
      run.outputIds = Array.from(new Set([output.id, ...(run.outputIds || [])]));
    }
  }
  if (run.subtaskId && input.status) {
    const subtask = task.subTasks.find(candidate => candidate.id === run.subtaskId);
    if (subtask) {
      if (input.status === 'completed' && subtask.status !== 'done') subtask.status = 'review';
      if (input.status === 'failed' || input.status === 'cancelled') subtask.status = 'blocked';
      if ((run.outputIds || []).length) {
        subtask.stageRunIds = Array.from(new Set([run.id, ...(subtask.stageRunIds || [])]));
      }
      subtask.updatedAt = now;
    }
  }
  task.updatedAt = now;
  appendEvent(task, {
    type: run.stage === 'focus' && input.status === 'completed' ? 'focus-finished' : 'assistant-run',
    actor: 'user',
    summary: `${run.stage} stage updated${input.status ? ` to ${input.status}` : ''}.`,
  });
  writeFile(file);
  return task;
}

export function createSubtask(taskId: string, input: CreateSubtaskInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const title = normalizeText(input.title, 240);
  if (!title) throw new Error('title is required');
  const now = new Date().toISOString();
  const rawStatus = normalizeText(input.status, 40);
  const subtask: ProSubtask = {
    id: newId('subtask'),
    taskId: task.id,
    title,
    description: normalizeText(input.description) || undefined,
    status: isProSubtaskStatus(rawStatus) ? rawStatus : 'todo',
    assignedAgent: normalizeText(input.assignedAgent, 80) || task.defaultAgent || undefined,
    assistantId: normalizeText(input.assistantId, 160) || task.defaultAssistantId || undefined,
    workdir: normalizeText(input.workdir, 2048) || task.workdir || undefined,
    createdAt: now,
    updatedAt: now,
    stageRunIds: [],
  };
  task.subTasks.unshift(subtask);
  task.updatedAt = now;
  appendEvent(task, {
    type: 'subtask-created',
    actor: 'user',
    summary: `Subtask created: ${title}.`,
    diff: { subtaskId: subtask.id },
  });
  writeFile(file);
  return task;
}

export function updateSubtask(taskId: string, subtaskId: string, input: UpdateSubtaskInput): ProTask {
  const file = readFile();
  const task = file.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('task not found');
  const subtask = task.subTasks.find(candidate => candidate.id === subtaskId);
  if (!subtask) throw new Error('subtask not found');
  const previousStatus = subtask.status;
  const title = normalizeText(input.title, 240);
  const description = normalizeText(input.description);
  const status = normalizeText(input.status, 40);
  if (title) subtask.title = title;
  if (description) subtask.description = description;
  if (isProSubtaskStatus(status)) subtask.status = status;
  const assignedAgent = normalizeText(input.assignedAgent, 80);
  if (assignedAgent) subtask.assignedAgent = assignedAgent;
  const assistantId = normalizeText(input.assistantId, 160);
  if (assistantId) subtask.assistantId = assistantId;
  const workdir = normalizeText(input.workdir, 2048);
  if (workdir) subtask.workdir = workdir;
  const stageRunId = normalizeText(input.stageRunId, 120);
  if (stageRunId && !subtask.stageRunIds.includes(stageRunId)) subtask.stageRunIds.unshift(stageRunId);
  const now = new Date().toISOString();
  subtask.updatedAt = now;
  task.updatedAt = now;
  appendEvent(task, {
    type: 'subtask-updated',
    actor: 'user',
    summary: previousStatus !== subtask.status
      ? `Subtask ${subtask.title} moved from ${previousStatus} to ${subtask.status}.`
      : `Subtask updated: ${subtask.title}.`,
    diff: { subtaskId: subtask.id },
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
