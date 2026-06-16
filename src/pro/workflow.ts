import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAILY_ASSISTANT_ID } from './assistant-defaults.js';
import { DEFAULT_ANALYZE_TICKET_PROMPT } from './jira-analyze.js';
import { syncJiraTask } from './tasks.js';

export interface AgentAssistant {
  id: string;
  name: string;
  kind?: 'page-owner' | 'task-stage' | 'creation' | 'automation' | 'custom';
  surfaceId?: string;
  objectTypes?: string[];
  responsibility: string;
  prompt?: string;
  defaultPrompt?: string;
  preferredAgents: string[];
  allowedActions?: string[];
  labels?: string[];
  builtIn?: boolean;
  enabled?: boolean;
  avatarSeed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRule {
  id: string;
  key?: string;
  name: string;
  schedule: string;
  prompt: string;
  workdir?: string;
  agent?: string;
  enabled: boolean;
  includeProjectReferences?: boolean;
  projectReferenceNames?: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastSessionKey?: string;
  assistantId?: string;
  runHistory?: Array<{
    id: string;
    ranAt: string;
    scheduledFor?: string;
    taskId?: string;
    sessionKey?: string;
    status: 'queued' | 'failed' | 'missed';
    error?: string;
    code?: string;
    budgetId?: string;
    budgetName?: string;
  }>;
}

export type CustomWorkflowEffort = 'low' | 'medium' | 'high';

export interface CustomWorkflowRecipe {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  outputs: string[];
  steps: string[];
  capabilities: string[];
  promptHint: string;
  cadence: string;
  defaultEffort: CustomWorkflowEffort;
  builtIn?: false;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunStatus = 'running' | 'blocked' | 'done';
export type WorkflowRunStepStatus = 'todo' | 'now' | 'blocked' | 'done';
export type WorkflowRunAskType = 'text' | 'number' | 'choice' | 'boolean' | 'rating';
export type WorkflowRunAskStatus = 'pending' | 'answered' | 'skipped';
export type WorkflowRunAskDeliveryStatus = 'not_sent' | 'sending' | 'sent' | 'failed';
export type WorkflowRunStepAutonomousState = 'running' | 'done' | 'failed' | 'stalled';

export interface WorkflowRunStepAutonomousRun {
  dispatchId: string;
  state: WorkflowRunStepAutonomousState;
  startedAt: string;
  completedAt?: string;
  childAgent?: string;
  childSessionId?: string;
  childSessionKey?: string;
  taskId?: string;
  error?: string;
}

export interface WorkflowRunAutonomousWatchdogResult {
  scannedRuns: number;
  scannedWorkers: number;
  stalled: Array<{ run: WorkflowRunRecord; step: WorkflowRunStep }>;
}

export interface WorkflowRunStep {
  index: number;
  title: string;
  status: WorkflowRunStepStatus;
  startedAt?: string;
  completedAt?: string;
  autonomousRun?: WorkflowRunStepAutonomousRun;
}

export interface WorkflowRunAsk {
  id: string;
  stepIndex: number;
  question: string;
  type: WorkflowRunAskType;
  options?: string[];
  max?: number;
  placeholder?: string;
  answer?: string;
  status: WorkflowRunAskStatus;
  deliveryStatus?: WorkflowRunAskDeliveryStatus;
  deliveryError?: string;
  deliveryTaskId?: string;
  deliveredAt?: string;
  askedAt: string;
  answeredAt?: string;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId?: string;
  workflowName: string;
  title: string;
  workdir?: string;
  agent?: string;
  model?: string;
  effort?: CustomWorkflowEffort;
  assistantId?: string;
  assistantName?: string;
  sessionKey?: string;
  sessionId?: string;
  note?: string;
  currentStep: number;
  totalSteps: number;
  steps: WorkflowRunStep[];
  asks: WorkflowRunAsk[];
  status: WorkflowRunStatus;
  lastMarker?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowMarkerAsk {
  question: string;
  type: WorkflowRunAskType;
  options?: string[];
  max?: number;
  placeholder?: string;
}

export interface WorkflowMarkerProgress {
  currentStep: number;
  totalSteps: number;
  title: string;
  status: WorkflowRunStatus;
  raw: string;
}

export interface WorkflowMarkerReconcileResult {
  run: WorkflowRunRecord | null;
  scannedMessages: number;
  scannedAssistantMessages: number;
  markerMessages: number;
  progressMarkers: number;
  askMarkers: number;
}

export interface WorkflowMarkerMessage {
  role?: unknown;
  text?: unknown;
  blocks?: Array<{ type?: unknown; content?: unknown; phase?: unknown }>;
}

export interface JiraSyncRunEvent {
  id: string;
  at: string;
  label: string;
  detail?: string;
}

export interface JiraSyncRunChange {
  taskId?: string;
  jiraKey?: string;
  title: string;
  action: 'created' | 'updated' | 'unchanged';
  summary?: string;
  status?: string;
  kind?: string;
  sprint?: string;
  assignee?: string;
  priority?: string;
  dueDate?: string;
  updatedAt?: string;
}

export interface JiraSyncRunItem {
  id: string;
  jiraKey?: string;
  key?: string;
  title: string;
  summary?: string;
  description?: string;
  issueType?: string;
  jiraUrl?: string;
  url?: string;
  sprint?: string;
  fixVersion?: string;
  fixVersions?: string[];
  reporter?: string;
  assignee?: string;
  ticketStatus?: string;
  status?: 'candidate' | 'applied';
  jiraStatus?: string;
  dueDate?: string;
  priority?: string;
  labels?: string[];
  updatedAt?: string;
  selected?: boolean;
  taskId?: string;
  syncAction?: 'created' | 'updated' | 'unchanged';
}

export interface JiraSyncRun {
  id: string;
  status: 'starting' | 'queued' | 'syncing' | 'completed' | 'failed' | 'stopped';
  assistantId?: string;
  assistantName?: string;
  agent?: string;
  workdir?: string;
  sessionKey?: string;
  ticketCount?: number;
  taskCount?: number;
  analysisSummary?: string;
  issueKeys?: string[];
  changes?: JiraSyncRunChange[];
  items?: JiraSyncRunItem[];
  error?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  events: JiraSyncRunEvent[];
}

export type JiraRemoteUpdateField = 'status' | 'fixVersions' | 'sprint' | 'dueDate';
export type JiraRemoteUpdateStatus = 'draft' | 'applying' | 'applied' | 'failed' | 'cancelled';

export interface JiraRemoteUpdateFields {
  status?: string;
  fixVersions?: string[];
  sprint?: string;
  dueDate?: string;
}

export interface JiraRemoteUpdateDiff {
  field: JiraRemoteUpdateField;
  from?: string | string[];
  to?: string | string[];
}

export interface JiraRemoteUpdateRun {
  id: string;
  taskId: string;
  jiraKey?: string;
  jiraUrl?: string;
  status: JiraRemoteUpdateStatus;
  fields: JiraRemoteUpdateFields;
  diff: JiraRemoteUpdateDiff[];
  error?: string;
  remoteTool?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  events: JiraSyncRunEvent[];
}

export type KnowledgeEntryKind = 'knowledge-card' | 'session-digest';
export type KnowledgeEntryStatus = 'published' | 'hidden';
export type KnowledgeEntryConfidence = 'low' | 'medium' | 'high';
export type KnowledgeEntryCreatedBy = 'auto' | 'manual' | 'agent';
export type KnowledgeSourceFreshness = 'unchecked' | 'fresh' | 'stale' | 'missing' | 'unreadable' | 'unsupported';

export interface KnowledgeSourceRef {
  type: 'manual' | 'chat' | 'task' | 'output' | 'file' | 'link';
  workdir?: string;
  agent?: string;
  sessionId?: string;
  taskId?: string;
  outputId?: string;
  path?: string;
  url?: string;
  title?: string;
  sourceFreshness?: KnowledgeSourceFreshness;
  sourceCheckedAt?: string;
  sourceAcceptedAt?: string;
  sourceHash?: string;
  sourceMtimeMs?: number;
  sourceSize?: number;
  sourceCurrentHash?: string;
  sourceCurrentMtimeMs?: number;
  sourceCurrentSize?: number;
  sourceError?: string;
}

export interface KnowledgeArtifactRef {
  kind?: string;
  title?: string;
  outputId?: string;
  workdir?: string;
  agent?: string;
  sessionId?: string;
  path?: string;
  url?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  kind: KnowledgeEntryKind;
  status: KnowledgeEntryStatus;
  summary?: string;
  source?: {
    type: 'manual' | 'chat' | 'task';
    workdir?: string;
    agent?: string;
    sessionId?: string;
    taskId?: string;
  };
  sourceRefs: KnowledgeSourceRef[];
  artifactRefs: KnowledgeArtifactRef[];
  confidence: KnowledgeEntryConfidence;
  createdBy: KnowledgeEntryCreatedBy;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntryFilters {
  query?: unknown;
  tag?: unknown;
  sourceType?: unknown;
  workspace?: unknown;
  status?: unknown;
  kind?: unknown;
}

export type JiraWorkspaceRouteMatchType = 'project' | 'component' | 'label' | 'text';

export interface JiraWorkspaceRoute {
  match: string;
  matchType: JiraWorkspaceRouteMatchType;
  workdir: string;
}

export interface JiraWorkflowConfig {
  executionOwnerMode?: 'status' | 'agent' | 'assistant';
  lifecycleAgent?: string;
  lifecycleAssistantId?: string;
  executionMode?: 'direct' | 'interactive';
  refinementAssistantId?: string;
  codingAssistantId?: string;
  ticketSyncAssistantId?: string;
  knowledgeAssistantId?: string;
  chiefOfStaffAssistantId?: string;
  focusAdvancedSensorsEnabled?: boolean;
  runKnowledgeOnRefinement?: boolean;
  runKnowledgeOnCoding?: boolean;
  analyzeTicketPrompt?: string;
  jiraWorkspaceRoutes?: JiraWorkspaceRoute[];
  statusWorkflows?: Partial<Record<'backlog' | 'refinement' | 'coding' | 'resolved' | 'done', {
    instruction?: string;
    assistantId?: string;
    modelPool?: string[];
  }>>;
}

interface WorkflowFile {
  version: 1;
  assistants: AgentAssistant[];
  deletedAssistantIds?: string[];
  customWorkflows?: CustomWorkflowRecipe[];
  workflowRuns?: WorkflowRunRecord[];
  automations: AutomationRule[];
  jiraSyncRuns?: JiraSyncRun[];
  jiraRemoteUpdateRuns?: JiraRemoteUpdateRun[];
  knowledge: KnowledgeEntry[];
  jira?: JiraWorkflowConfig;
}

const DEFAULT_JIRA_CONFIG: JiraWorkflowConfig = {
  executionOwnerMode: 'status',
  executionMode: 'direct',
  refinementAssistantId: 'assistant_refinement',
  codingAssistantId: 'assistant_coding',
  ticketSyncAssistantId: 'assistant_ticket_sync',
  knowledgeAssistantId: 'assistant_knowledge',
  chiefOfStaffAssistantId: 'assistant_chief_of_staff',
  runKnowledgeOnRefinement: true,
  runKnowledgeOnCoding: true,
  statusWorkflows: {
    refinement: { assistantId: 'assistant_refinement', instruction: 'Explain what the Jira task is, what needs to be done, retrieve relevant local/context material, state your understanding, open questions, risks, acceptance criteria, and a recommended plan. Do not code until the user confirms the goal and plan.' },
    coding: { assistantId: 'assistant_coding', instruction: 'Implement only after the confirmed Goal & Plan. Keep changes minimal, inspect relevant code paths first, summarize changed files, why each change was made, verification run, and remaining risk. Stop in Review; do not commit, create an MR, update Jira remotely, or mark Done until user approval.' },
    resolved: { assistantId: 'assistant_coding', instruction: 'Review the implementation with the user. Compare against the confirmed Goal & Plan, explain changed files and tradeoffs, collect user approval, and prepare the Verification plan. Do not write Jira remotely or submit an MR without explicit confirmation.' },
  },
};

const HERMES_ANALYSIS_ASSISTANT_PROMPT = 'You are the Hermes ACP planning assistant for Pikiclaw task analysis. When the user assigns a task or stage to you, assume they want analysis and solution planning before implementation. Use the selected task, Jira context, subtasks, notes, and available MCP tools to clarify goal, scope, constraints, dependencies, risks, acceptance criteria, and likely implementation paths. Do not modify repository files unless the user explicitly asks you to implement. Produce a concise Goal & Plan with: goal, current evidence, assumptions, open questions, recommended approach, affected areas to inspect, risk/unknowns, acceptance criteria, estimated effort split, and recommended next agent/stage for coding or review. Keep provider/model assumptions explicit, prefer Hermes native config unless a Pikiclaw Profile is bound, and report ACP/session failures with the selected model/provider and concrete recovery steps.';

const DEFAULT_ASSISTANTS: AgentAssistant[] = [
  {
    id: 'assistant_dashboard_owner',
    name: 'Dashboard Assistant',
    kind: 'page-owner',
    surfaceId: 'dashboard',
    objectTypes: ['jira-task', 'task', 'task-stage', 'jira-sync'],
    responsibility: 'Own the Jira dashboard workbench, help the user clarify tickets, start coding work, track progress, and coordinate manual Jira sync without automatically closing remote tickets.',
    prompt: 'You are the Dashboard/Jira owner assistant for Pikiclaw. Your job is to help the user complete every task in the dashboard. Use the lifecycle backlog -> refinement -> working -> done. In refinement, inspect the ticket and context, produce a task brief with goals, questions, risks, acceptance points, and estimate. Only start coding after the user confirms. In working, report concrete progress: files viewed, searches, commands/tests, changed files count, current step, and remaining risk. Never transition remote Jira automatically; only prepare or perform remote updates when the user explicitly asks for manual sync/update.',
    defaultPrompt: 'You are the Dashboard/Jira owner assistant for Pikiclaw. Your job is to help the user complete every task in the dashboard. Use the lifecycle backlog -> refinement -> working -> done. In refinement, inspect the ticket and context, produce a task brief with goals, questions, risks, acceptance points, and estimate. Only start coding after the user confirms. In working, report concrete progress: files viewed, searches, commands/tests, changed files count, current step, and remaining risk. Never transition remote Jira automatically; only prepare or perform remote updates when the user explicitly asks for manual sync/update.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-task', 'sync-jira', 'analyze-task', 'start-refinement', 'start-working', 'edit-prompt', 'history'],
    labels: ['builtin', 'page-owner'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: 'assistant_agents_owner',
    name: 'Agent Page Assistant',
    kind: 'page-owner',
    surfaceId: 'agents',
    objectTypes: ['agent', 'assistant', 'model', 'profile', 'automation'],
    responsibility: 'Own the Agents page, help the user create and maintain agents, assistants, model/profile bindings, tests, prompts, and assistant history.',
    prompt: 'You are the Agents page owner assistant for Pikiclaw. Help the user create agents and assistants through dialogue, ask only necessary clarifying questions, then create or update the right configuration or files. You also help test assistants, explain model/profile choices, review prompt changes, and maintain assistant history. Treat each assistant as an owned product object with responsibility, scope, prompt, allowed actions, test path, and rollback/reset behavior.',
    defaultPrompt: 'You are the Agents page owner assistant for Pikiclaw. Help the user create agents and assistants through dialogue, ask only necessary clarifying questions, then create or update the right configuration or files. You also help test assistants, explain model/profile choices, review prompt changes, and maintain assistant history. Treat each assistant as an owned product object with responsibility, scope, prompt, allowed actions, test path, and rollback/reset behavior.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-agent', 'create-assistant', 'test-assistant', 'edit-prompt', 'prompt-diff', 'history'],
    labels: ['builtin', 'page-owner'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: 'assistant_skills_owner',
    name: 'Skills Assistant',
    kind: 'page-owner',
    surfaceId: 'skills',
    objectTypes: ['skill', 'skill-prompt', 'skill-test'],
    responsibility: 'Own the Skills page, help the user create, install, edit, test, and troubleshoot Skills and their prompts.',
    prompt: 'You are the Skills page owner assistant for Pikiclaw. Help the user create or improve Skills. Clarify triggers, workflow, tools, safety limits, expected outputs, files/scripts/templates, and validation. Keep skill files scoped, explain test steps, and prefer existing skill conventions. When editing a prompt, propose a clear prompt diff before applying changes.',
    defaultPrompt: 'You are the Skills page owner assistant for Pikiclaw. Help the user create or improve Skills. Clarify triggers, workflow, tools, safety limits, expected outputs, files/scripts/templates, and validation. Keep skill files scoped, explain test steps, and prefer existing skill conventions. When editing a prompt, propose a clear prompt diff before applying changes.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-skill', 'install-skill', 'edit-skill', 'test-skill', 'edit-prompt', 'prompt-diff', 'history'],
    labels: ['builtin', 'page-owner'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: 'assistant_mcp_owner',
    name: 'MCP Assistant',
    kind: 'page-owner',
    surfaceId: 'mcp',
    objectTypes: ['mcp-server', 'mcp-auth', 'mcp-tool', 'mcp-health'],
    responsibility: 'Own MCP setup, help the user create, configure, authenticate, test, and troubleshoot MCP servers.',
    prompt: 'You are the MCP page owner assistant for Pikiclaw. Help the user create and maintain MCP servers. Clarify transport, command or URL, auth fields, scopes, environment variables, workspace/global scope, validation steps, and restart requirements. Prefer safe configuration edits and clear health checks. Do not mix Skills work into MCP work unless the user explicitly asks for a combined extension.',
    defaultPrompt: 'You are the MCP page owner assistant for Pikiclaw. Help the user create and maintain MCP servers. Clarify transport, command or URL, auth fields, scopes, environment variables, workspace/global scope, validation steps, and restart requirements. Prefer safe configuration edits and clear health checks. Do not mix Skills work into MCP work unless the user explicitly asks for a combined extension.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-mcp', 'configure-auth', 'test-tools', 'troubleshoot', 'edit-prompt', 'prompt-diff', 'history'],
    labels: ['builtin', 'page-owner'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: 'assistant_extensions_owner',
    name: 'Extensions Assistant',
    kind: 'page-owner',
    surfaceId: 'extensions',
    objectTypes: ['extension', 'catalog-item', 'cli-tool', 'installation', 'troubleshooting'],
    responsibility: 'Own the Extensions page, recommend, install, validate, and troubleshoot extension catalog items without replacing the dedicated Skills or MCP assistants.',
    prompt: 'You are the Extensions page owner assistant for Pikiclaw. Help the user choose, install, validate, and troubleshoot extensions across MCP, Skills, and CLI catalog items. Recommend the right extension path, identify missing credentials or local dependencies, and route deep Skills or MCP creation work to the dedicated owner assistant when appropriate. Keep installed state, scope, and validation evidence explicit.',
    defaultPrompt: 'You are the Extensions page owner assistant for Pikiclaw. Help the user choose, install, validate, and troubleshoot extensions across MCP, Skills, and CLI catalog items. Recommend the right extension path, identify missing credentials or local dependencies, and route deep Skills or MCP creation work to the dedicated owner assistant when appropriate. Keep installed state, scope, and validation evidence explicit.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'recommend', 'install', 'validate-extension', 'troubleshoot', 'edit-prompt', 'prompt-diff', 'history'],
    labels: ['builtin', 'page-owner'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: DAILY_ASSISTANT_ID,
    name: 'Daily Assistant',
    kind: 'task-stage',
    surfaceId: 'daily',
    objectTypes: ['daily-item', 'todo', 'task', 'task-stage'],
    responsibility: 'Turn daily plan items and inbox Todos into focused execution work: clarify the goal, confirm the plan, execute with progress updates, and ask for review before marking work done.',
    prompt: 'You are the Daily Assistant for Pikiclaw. Help the user turn today’s Todo or Daily item into a focused work session. First clarify the concrete goal and missing context. Then propose a short Goal & Plan with assumptions, risks, and acceptance checks. Start execution only after the user confirms or the request is already explicit. During execution, report concrete progress, files or sources checked, commands or checks run, changed artifacts, and remaining risk. When finished, ask the user to review. If the user rejects the result, continue iterating; if they accept it, help mark the work done.',
    defaultPrompt: 'You are the Daily Assistant for Pikiclaw. Help the user turn today’s Todo or Daily item into a focused work session. First clarify the concrete goal and missing context. Then propose a short Goal & Plan with assumptions, risks, and acceptance checks. Start execution only after the user confirms or the request is already explicit. During execution, report concrete progress, files or sources checked, commands or checks run, changed artifacts, and remaining risk. When finished, ask the user to review. If the user rejects the result, continue iterating; if they accept it, help mark the work done.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'clarify', 'plan-today', 'start-working', 'run-tests', 'request-review', 'mark-done', 'edit-prompt', 'history'],
    labels: ['builtin', 'task', 'daily'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  },
  {
    id: 'assistant_refinement',
    name: 'Refinement Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['task', 'jira-task', 'task-brief'],
    responsibility: 'Clarify ticket/task goal, boundary, acceptance points, risks, and estimate coding, review, verification, and user-understanding time.',
    prompt: 'Clarify ticket/task goal, boundary, acceptance points, risks, and estimate coding, review, verification, and user-understanding time. Output a concise task brief with open questions, assumptions, risks, acceptance criteria, and a recommendation for whether coding can start.',
    defaultPrompt: 'Clarify ticket/task goal, boundary, acceptance points, risks, and estimate coding, review, verification, and user-understanding time. Output a concise task brief with open questions, assumptions, risks, acceptance criteria, and a recommendation for whether coding can start.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'analyze-task', 'start-working', 'edit-prompt', 'history'],
    labels: ['builtin', 'task'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_coding',
    name: 'Coding Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['task', 'code-change', 'validation'],
    responsibility: 'Implement scoped changes, keep diffs reviewable, run focused validation, and respond to review comments with follow-up coding.',
    prompt: 'Implement scoped changes with minimal diffs. Keep changes reviewable, inspect relevant files before editing, run focused validation when available, summarize changed files/tests/risks, and respond to review comments with follow-up coding.',
    defaultPrompt: 'Implement scoped changes with minimal diffs. Keep changes reviewable, inspect relevant files before editing, run focused validation when available, summarize changed files/tests/risks, and respond to review comments with follow-up coding.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'start-working', 'run-tests', 'summarize-files', 'edit-prompt', 'history'],
    labels: ['builtin', 'task'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_ticket_sync',
    name: 'Ticket Sync Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['jira-sync', 'jira-task'],
    responsibility: 'Sync only Jira tickets assigned to the current user into Pikiclaw tasks, append remote updates without overwriting local task history, and flag newly assigned or changed work.',
    prompt: 'Sync only Jira tickets assigned to the current user into Pikiclaw tasks. Append remote updates without overwriting local task history, flag newly assigned or changed work, and do not automatically close or transition remote Jira issues.',
    defaultPrompt: 'Sync only Jira tickets assigned to the current user into Pikiclaw tasks. Append remote updates without overwriting local task history, flag newly assigned or changed work, and do not automatically close or transition remote Jira issues.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'sync-jira', 'summarize-sync', 'edit-prompt', 'history'],
    labels: ['builtin', 'task'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_mr_review',
    name: 'MR Review Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['merge-request', 'pull-request', 'code-review'],
    responsibility: 'Review merge requests and pull requests for correctness, regressions, missing tests, maintainability risks, and follow-up questions before the user responds or merges.',
    prompt: 'Review the provided MR/PR link, diff, branch, or pasted context. Prioritize concrete bugs, regressions, missing tests, risky behavior changes, and unclear requirements. Lead with findings ordered by severity, cite files or changed areas when available, then summarize residual risk and recommended next action. Do not make code changes unless explicitly asked.',
    defaultPrompt: 'Review the provided MR/PR link, diff, branch, or pasted context. Prioritize concrete bugs, regressions, missing tests, risky behavior changes, and unclear requirements. Lead with findings ordered by severity, cite files or changed areas when available, then summarize residual risk and recommended next action. Do not make code changes unless explicitly asked.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'review-mr', 'inspect-diff', 'run-tests', 'edit-prompt', 'history'],
    labels: ['builtin', 'quick-assistant'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  },
  {
    id: 'assistant_log_analysis',
    name: 'Log Analysis Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['log', 'trace', 'session-id', 'incident'],
    responsibility: 'Investigate logs, trace IDs, session IDs, and incident snippets; reconstruct likely timelines, root causes, affected components, and next diagnostic steps.',
    prompt: 'Analyze the provided log keyword, trace ID, session ID, pasted log snippet, or incident description. First identify the target system and time window when possible, then gather relevant evidence with available tools, build a concise timeline, explain likely root cause and confidence, and list concrete next checks. Keep assumptions explicit.',
    defaultPrompt: 'Analyze the provided log keyword, trace ID, session ID, pasted log snippet, or incident description. First identify the target system and time window when possible, then gather relevant evidence with available tools, build a concise timeline, explain likely root cause and confidence, and list concrete next checks. Keep assumptions explicit.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'trace-logs', 'summarize-evidence', 'diagnose', 'edit-prompt', 'history'],
    labels: ['builtin', 'quick-assistant'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  },
  {
    id: 'assistant_bug_analysis',
    name: 'Bug Analysis Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['bug', 'ticket', 'jira-bug', 'reproducer'],
    responsibility: 'Analyze bug tickets or rough bug descriptions, clarify reproduction, isolate likely causes, propose verification, and prepare a focused fix plan before implementation.',
    prompt: 'Analyze the provided bug ticket, Jira link/key, reproduction note, or free-form bug description. Extract expected versus actual behavior, impacted users, scope, likely code areas, reproduction plan, evidence gaps, and a minimal fix strategy. Ask only blocking clarification questions; otherwise continue with evidence gathering and a concise analysis.',
    defaultPrompt: 'Analyze the provided bug ticket, Jira link/key, reproduction note, or free-form bug description. Extract expected versus actual behavior, impacted users, scope, likely code areas, reproduction plan, evidence gaps, and a minimal fix strategy. Ask only blocking clarification questions; otherwise continue with evidence gathering and a concise analysis.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'analyze-bug', 'reproduce', 'inspect-code', 'plan-fix', 'edit-prompt', 'history'],
    labels: ['builtin', 'quick-assistant'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  },
  {
    id: 'assistant_chief_of_staff',
    name: 'Chief of Staff',
    kind: 'automation',
    surfaceId: 'dashboard',
    objectTypes: ['task', 'standup', 'checkout'],
    responsibility: 'Synthesize git, Jira, sandbox, and session signals into a concise daily command-center plan with prioritized recommendations.',
    prompt: 'Synthesize git, Jira, sandbox, and session signals into a concise daily command-center plan. Output structured JSON only: headline plus prioritized recommendations. No long prose.',
    defaultPrompt: 'Synthesize git, Jira, sandbox, and session signals into a concise daily command-center plan. Output structured JSON only: headline plus prioritized recommendations. No long prose.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'orchestrate', 'edit-prompt', 'history'],
    labels: ['builtin', 'focus'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  },
  {
    id: 'assistant_knowledge',
    name: 'Knowledge Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['knowledge', 'task-summary'],
    responsibility: 'After refinement completes, extract reusable concepts, terminology, assumptions, and basic knowledge points that help the user understand the task faster.',
    prompt: 'After refinement completes, extract reusable concepts, terminology, assumptions, and basic knowledge points that help the user understand the task faster. Keep notes concise, source-grounded, and reusable.',
    defaultPrompt: 'After refinement completes, extract reusable concepts, terminology, assumptions, and basic knowledge points that help the user understand the task faster. Keep notes concise, source-grounded, and reusable.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'extract-knowledge', 'edit-prompt', 'history'],
    labels: ['builtin', 'task'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_idea_guide',
    name: 'Idea Guide Assistant',
    kind: 'creation',
    surfaceId: 'dashboard',
    objectTypes: ['idea', 'task'],
    responsibility: 'Guide the user from a rough intent to a clear idea. First research mainstream related products, implementations, patterns, and pitfalls; then ask step-by-step questions about goal, audience, boundary, workflow, constraints, risks, and acceptance points; finally synthesize a structured idea with options, tradeoffs, and next steps.',
    prompt: 'Guide the user from a rough intent to a clear idea. First research mainstream related products, implementations, patterns, and pitfalls when useful; then ask step-by-step questions about goal, audience, boundary, workflow, constraints, risks, and acceptance points; finally synthesize a structured idea with options, tradeoffs, and next steps.',
    defaultPrompt: 'Guide the user from a rough intent to a clear idea. First research mainstream related products, implementations, patterns, and pitfalls when useful; then ask step-by-step questions about goal, audience, boundary, workflow, constraints, risks, and acceptance points; finally synthesize a structured idea with options, tradeoffs, and next steps.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'research', 'create-task', 'edit-prompt', 'history'],
    labels: ['builtin', 'creation'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_hermes_acp',
    name: 'Hermes ACP Assistant',
    kind: 'task-stage',
    surfaceId: 'dashboard',
    objectTypes: ['task', 'jira-task', 'task-brief', 'solution-plan', 'acp-session', 'agent-session'],
    responsibility: 'Analyze assigned tasks through Hermes ACP as a planning assistant: clarify goal, scope, constraints, risks, acceptance criteria, and implementation options before coding starts.',
    prompt: HERMES_ANALYSIS_ASSISTANT_PROMPT,
    defaultPrompt: HERMES_ANALYSIS_ASSISTANT_PROMPT,
    preferredAgents: ['hermes'],
    allowedActions: ['chat', 'run-task', 'resume', 'use-mcp', 'edit-prompt', 'history'],
    labels: ['builtin', 'task'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  },
  {
    id: 'assistant_mcp_creator',
    name: 'MCP Creator Assistant',
    kind: 'creation',
    surfaceId: 'mcp',
    objectTypes: ['mcp-server', 'mcp-auth'],
    responsibility: 'Help the user create or configure MCP servers. Collect transport, command or URL, auth fields, scopes, environment variables, validation steps, and restart requirements; then create or update the MCP configuration when enough information is available.',
    prompt: 'Help the user create or configure MCP servers. Collect transport, command or URL, auth fields, scopes, environment variables, validation steps, and restart requirements; then create or update the MCP configuration when enough information is available.',
    defaultPrompt: 'Help the user create or configure MCP servers. Collect transport, command or URL, auth fields, scopes, environment variables, validation steps, and restart requirements; then create or update the MCP configuration when enough information is available.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-mcp', 'configure-auth', 'test-tools', 'edit-prompt', 'history'],
    labels: ['builtin', 'creation'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
  },
  {
    id: 'assistant_skill_creator',
    name: 'Skill Creator Assistant',
    kind: 'creation',
    surfaceId: 'skills',
    objectTypes: ['skill', 'skill-prompt'],
    responsibility: 'Help the user create Pikiclaw/Codex skills. Clarify the workflow, trigger phrases, required inputs, tools, scripts, safety boundaries, and expected outputs; then create or update the skill files and explain how to validate them.',
    prompt: 'Help the user create Pikiclaw/Codex skills. Clarify the workflow, trigger phrases, required inputs, tools, scripts, safety boundaries, and expected outputs; then create or update the skill files and explain how to validate them.',
    defaultPrompt: 'Help the user create Pikiclaw/Codex skills. Clarify the workflow, trigger phrases, required inputs, tools, scripts, safety boundaries, and expected outputs; then create or update the skill files and explain how to validate them.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-skill', 'edit-skill', 'test-skill', 'edit-prompt', 'history'],
    labels: ['builtin', 'creation'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
  },
  {
    id: 'assistant_task_creator',
    name: 'Task Creator Assistant',
    kind: 'creation',
    surfaceId: 'dashboard',
    objectTypes: ['task', 'jira-task'],
    responsibility: 'Help the user create useful tasks from rough intent. Clarify goal, boundary, assumptions, acceptance points, workspace, owner mode, direct or interactive execution mode, and expected evidence before creating or drafting the task.',
    prompt: 'Help the user create useful tasks from rough intent. Clarify goal, boundary, assumptions, acceptance points, workspace, owner mode, direct or interactive execution mode, and expected evidence before creating or drafting the task.',
    defaultPrompt: 'Help the user create useful tasks from rough intent. Clarify goal, boundary, assumptions, acceptance points, workspace, owner mode, direct or interactive execution mode, and expected evidence before creating or drafting the task.',
    preferredAgents: ['codex'],
    allowedActions: ['chat', 'create-task', 'edit-prompt', 'history'],
    labels: ['builtin', 'creation'],
    builtIn: true,
    enabled: true,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
  },
];

function workflowFilePath() {
  return process.env.PIKICLAW_PRO_WORKFLOW_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'workflow.json');
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function newAvatarSeed() {
  return crypto.randomBytes(6).toString('hex');
}

function normalizeText(value: unknown, max = 16_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function jiraBrowseUrlForKey(value: unknown): string | undefined {
  const key = normalizeText(value, 80);
  return key ? `https://jira.ringcentral.com/browse/${encodeURIComponent(key)}` : undefined;
}

function issueField(issue: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = issue[key];
    if (value != null && String(value).trim()) return value;
  }
  const fields = issue.fields;
  if (fields && typeof fields === 'object') {
    for (const key of keys) {
      const value = (fields as Record<string, unknown>)[key];
      if (value != null && String(value).trim()) return value;
    }
  }
  return undefined;
}

function namedValue(value: unknown): string {
  if (typeof value === 'string') return normalizeText(value, 240);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return normalizeText(object.name || object.value || object.displayName || object.display_name || object.email || object.emailAddress, 240);
  }
  return '';
}

function sprintNameFromText(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const match = raw.match(/\bname=([^,\]]+)/);
  return normalizeText(match?.[1] || raw, 240);
}

function collectSprintNames(value: unknown, output: string[] = []): string[] {
  if (value == null) return output;
  if (typeof value === 'string') {
    const name = sprintNameFromText(value);
    if (name) output.push(name);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSprintNames(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.name === 'string') {
      const name = sprintNameFromText(object.name);
      if (name) output.push(name);
    }
    if (object.value != null) collectSprintNames(object.value, output);
    if (object.values != null) collectSprintNames(object.values, output);
  }
  return output;
}

function sprintValue(value: unknown): string {
  return [...new Set(collectSprintNames(value))].join(', ');
}

function arrayText(value: unknown, max = 120): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(item => namedValue(item) || normalizeText(item, max)).filter(Boolean);
  return items.length ? items.slice(0, 40) : undefined;
}

function isClosedJiraStatus(status: string): boolean {
  return /^(closed|close|cancelled|canceled)$/i.test(status.trim());
}

function normalizeJiraSyncItem(issue: Record<string, unknown>): JiraSyncRunItem | null {
  const jiraKey = normalizeText(issueField(issue, 'jiraKey', 'key', 'issueKey'), 80);
  const title = normalizeText(issueField(issue, 'title', 'summary', 'name'), 240);
  if (!jiraKey && !title) return null;
  const jiraStatus = namedValue(issueField(issue, 'ticketStatus', 'status', 'jiraStatus'));
  if (isClosedJiraStatus(jiraStatus)) return null;
  const fixVersions = arrayText(issueField(issue, 'fixVersions', 'fix_versions', 'fixVersion', 'fixversion'));
  const jiraUrl = normalizeText(issueField(issue, 'jiraUrl', 'url', 'browseUrl', 'webUrl'), 2048) || jiraBrowseUrlForKey(jiraKey);
  return {
    id: newId('jira_item'),
    jiraKey: jiraKey || undefined,
    key: jiraKey || undefined,
    title: title || jiraKey || 'Untitled Jira issue',
    summary: title || undefined,
    description: normalizeText(issueField(issue, 'description', 'body'), 32_000) || undefined,
    issueType: namedValue(issueField(issue, 'issueType', 'type', 'issuetype', 'issue_type')) || undefined,
    jiraUrl,
    url: jiraUrl,
    sprint: sprintValue(issueField(issue, 'sprint', 'sprintName', 'customfield_10652')) || undefined,
    fixVersions,
    fixVersion: fixVersions?.join(', '),
    reporter: namedValue(issueField(issue, 'reporter')) || undefined,
    assignee: namedValue(issueField(issue, 'assignee')) || undefined,
    ticketStatus: jiraStatus || undefined,
    jiraStatus: jiraStatus || undefined,
    status: 'candidate',
    dueDate: normalizeText(issueField(issue, 'dueDate', 'duedate'), 80) || undefined,
    priority: namedValue(issueField(issue, 'priority')) || undefined,
    labels: arrayText(issueField(issue, 'labels')),
    updatedAt: normalizeText(issueField(issue, 'updatedAt', 'updated'), 80) || undefined,
    selected: true,
  };
}

function normalizeKnowledgeKind(value: unknown): KnowledgeEntryKind {
  return value === 'session-digest' ? 'session-digest' : 'knowledge-card';
}

function normalizeKnowledgeStatus(value: unknown): KnowledgeEntryStatus {
  return value === 'hidden' ? 'hidden' : 'published';
}

function normalizeKnowledgeConfidence(value: unknown): KnowledgeEntryConfidence {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function normalizeKnowledgeCreatedBy(value: unknown): KnowledgeEntryCreatedBy {
  return value === 'auto' || value === 'agent' ? value : 'manual';
}

function normalizeKnowledgeSourceFreshness(value: unknown): KnowledgeSourceFreshness | undefined {
  return value === 'fresh'
    || value === 'stale'
    || value === 'missing'
    || value === 'unreadable'
    || value === 'unsupported'
    || value === 'unchecked'
    ? value
    : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeKnowledgeSourceRef(value: unknown): KnowledgeSourceRef | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type === 'chat' || raw.type === 'task' || raw.type === 'output' || raw.type === 'file' || raw.type === 'link'
    ? raw.type
    : 'manual';
  const ref: KnowledgeSourceRef = { type };
  const workdir = normalizeText(raw.workdir, 1_000);
  const agent = normalizeText(raw.agent, 120);
  const sessionId = normalizeText(raw.sessionId, 260);
  const taskId = normalizeText(raw.taskId, 260);
  const outputId = normalizeText(raw.outputId, 260);
  const filePath = normalizeText(raw.path, 2_000);
  const url = normalizeText(raw.url, 2_000);
  const title = normalizeText(raw.title, 240);
  const sourceFreshness = normalizeKnowledgeSourceFreshness(raw.sourceFreshness);
  const sourceCheckedAt = normalizeText(raw.sourceCheckedAt, 80);
  const sourceAcceptedAt = normalizeText(raw.sourceAcceptedAt, 80);
  const sourceHash = normalizeText(raw.sourceHash, 160);
  const sourceCurrentHash = normalizeText(raw.sourceCurrentHash, 160);
  const sourceError = normalizeText(raw.sourceError, 500);
  if (workdir) ref.workdir = workdir;
  if (agent) ref.agent = agent;
  if (sessionId) ref.sessionId = sessionId;
  if (taskId) ref.taskId = taskId;
  if (outputId) ref.outputId = outputId;
  if (filePath) ref.path = filePath;
  if (url) ref.url = url;
  if (title) ref.title = title;
  if (sourceFreshness) ref.sourceFreshness = sourceFreshness;
  if (sourceCheckedAt) ref.sourceCheckedAt = sourceCheckedAt;
  if (sourceAcceptedAt) ref.sourceAcceptedAt = sourceAcceptedAt;
  if (sourceHash) ref.sourceHash = sourceHash;
  if (sourceCurrentHash) ref.sourceCurrentHash = sourceCurrentHash;
  const sourceMtimeMs = normalizeOptionalNumber(raw.sourceMtimeMs);
  const sourceSize = normalizeOptionalNumber(raw.sourceSize);
  const sourceCurrentMtimeMs = normalizeOptionalNumber(raw.sourceCurrentMtimeMs);
  const sourceCurrentSize = normalizeOptionalNumber(raw.sourceCurrentSize);
  if (sourceMtimeMs !== undefined) ref.sourceMtimeMs = sourceMtimeMs;
  if (sourceSize !== undefined) ref.sourceSize = sourceSize;
  if (sourceCurrentMtimeMs !== undefined) ref.sourceCurrentMtimeMs = sourceCurrentMtimeMs;
  if (sourceCurrentSize !== undefined) ref.sourceCurrentSize = sourceCurrentSize;
  if (sourceError) ref.sourceError = sourceError;
  return ref;
}

function normalizeKnowledgeArtifactRef(value: unknown): KnowledgeArtifactRef | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const ref: KnowledgeArtifactRef = {};
  const kind = normalizeText(raw.kind, 80);
  const title = normalizeText(raw.title, 240);
  const outputId = normalizeText(raw.outputId, 260);
  const workdir = normalizeText(raw.workdir, 1_000);
  const agent = normalizeText(raw.agent, 120);
  const sessionId = normalizeText(raw.sessionId, 260);
  const filePath = normalizeText(raw.path, 2_000);
  const url = normalizeText(raw.url, 2_000);
  if (kind) ref.kind = kind;
  if (title) ref.title = title;
  if (outputId) ref.outputId = outputId;
  if (workdir) ref.workdir = workdir;
  if (agent) ref.agent = agent;
  if (sessionId) ref.sessionId = sessionId;
  if (filePath) ref.path = filePath;
  if (url) ref.url = url;
  return Object.keys(ref).length ? ref : null;
}

function normalizeKnowledgeRefs<T>(
  value: unknown,
  normalize: (item: unknown) => T | null,
  maxItems = 12,
): T[] {
  return Array.isArray(value)
    ? value.map(normalize).filter((item: T | null): item is T => !!item).slice(0, maxItems)
    : [];
}

function sourceRefFromLegacySource(source: KnowledgeEntry['source'] | undefined): KnowledgeSourceRef[] {
  if (!source) return [];
  return [{ ...source }];
}

function normalizeKnowledgeEntry(raw: any): KnowledgeEntry | null {
  const id = normalizeText(raw?.id, 160);
  const title = normalizeText(raw?.title, 200);
  if (!id || !title) return null;
  const body = normalizeText(raw?.body, 48_000);
  const legacySource = normalizeKnowledgeSourceRef(raw?.source);
  const source = legacySource && (legacySource.type === 'manual' || legacySource.type === 'chat' || legacySource.type === 'task')
    ? {
      type: legacySource.type,
      workdir: legacySource.workdir,
      agent: legacySource.agent,
      sessionId: legacySource.sessionId,
      taskId: legacySource.taskId,
    }
    : undefined;
  const sourceRefs = normalizeKnowledgeRefs(raw?.sourceRefs, normalizeKnowledgeSourceRef);
  const artifactRefs = normalizeKnowledgeRefs(raw?.artifactRefs, normalizeKnowledgeArtifactRef);
  const now = new Date().toISOString();
  return {
    id,
    title,
    body,
    kind: normalizeKnowledgeKind(raw?.kind),
    status: normalizeKnowledgeStatus(raw?.status),
    summary: normalizeText(raw?.summary, 1_000) || undefined,
    source,
    sourceRefs: sourceRefs.length ? sourceRefs : sourceRefFromLegacySource(source),
    artifactRefs,
    confidence: normalizeKnowledgeConfidence(raw?.confidence),
    createdBy: normalizeKnowledgeCreatedBy(raw?.createdBy),
    tags: normalizeStringList(raw?.tags, 20, 60),
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now,
  };
}

function normalizeCustomWorkflowEffort(value: unknown): CustomWorkflowEffort {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function normalizeCustomWorkflowRecipe(raw: any): CustomWorkflowRecipe | null {
  const id = normalizeText(raw?.id, 160);
  const name = normalizeText(raw?.name, 160);
  const description = normalizeText(raw?.description, 1_000);
  if (!id || !name || !description) return null;
  const now = new Date().toISOString();
  return {
    id,
    name,
    description,
    category: normalizeText(raw?.category, 120) || 'Custom',
    tags: normalizeStringList(raw?.tags, 24, 80),
    outputs: normalizeStringList(raw?.outputs, 12, 160),
    steps: normalizeStringList(raw?.steps, 20, 240),
    capabilities: normalizeStringList(raw?.capabilities, 12, 120),
    promptHint: normalizeText(raw?.promptHint, 4_000) || description,
    cadence: normalizeText(raw?.cadence, 80) || 'On demand',
    defaultEffort: normalizeCustomWorkflowEffort(raw?.defaultEffort),
    builtIn: false,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now,
  };
}

function normalizeWorkflowRunStatus(value: unknown): WorkflowRunStatus {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'blocked') return 'blocked';
  if (raw === 'done' || raw === 'complete' || raw === 'completed') return 'done';
  return 'running';
}

function normalizeWorkflowRunStepStatus(value: unknown): WorkflowRunStepStatus {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'blocked') return 'blocked';
  if (raw === 'done' || raw === 'complete' || raw === 'completed') return 'done';
  if (raw === 'now' || raw === 'running' || raw === 'active') return 'now';
  return 'todo';
}

function normalizeWorkflowRunStepAutonomousState(value: unknown): WorkflowRunStepAutonomousState {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'done' || raw === 'complete' || raw === 'completed' || raw === 'success') return 'done';
  if (raw === 'stalled' || raw === 'stale' || raw === 'timeout' || raw === 'timed_out') return 'stalled';
  if (raw === 'failed' || raw === 'error' || raw === 'errored') return 'failed';
  return 'running';
}

function clampWorkflowStep(value: unknown, totalSteps: number): number {
  const numeric = Number(value);
  const total = Math.max(1, Math.floor(totalSteps));
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(Math.floor(numeric), total));
}

function normalizeWorkflowRunStepAutonomousRun(raw: unknown, now: string): WorkflowRunStepAutonomousRun | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const childAgent = normalizeText(item.childAgent ?? item.child_agent, 120);
  const childSessionId = normalizeText(item.childSessionId ?? item.child_session_id, 260);
  const childSessionKey = normalizeText(item.childSessionKey ?? item.child_session_key, 260) || workflowRunSessionKey(childAgent, childSessionId);
  const dispatchId = normalizeText(item.dispatchId ?? item.dispatch_id, 160)
    || normalizeText(item.taskId ?? item.task_id, 160)
    || normalizeText(item.id, 160);
  if (!dispatchId && !childSessionKey) return undefined;
  return {
    dispatchId: dispatchId || `workflow_dispatch_${crypto.randomBytes(8).toString('hex')}`,
    state: normalizeWorkflowRunStepAutonomousState(item.state ?? item.status),
    startedAt: normalizeText(item.startedAt ?? item.started_at, 80) || now,
    completedAt: normalizeText(item.completedAt ?? item.completed_at, 80) || undefined,
    childAgent: childAgent || undefined,
    childSessionId: childSessionId || undefined,
    childSessionKey: childSessionKey || undefined,
    taskId: normalizeText(item.taskId ?? item.task_id, 160) || undefined,
    error: normalizeText(item.error ?? item.message, 1_000) || undefined,
  };
}

function normalizeWorkflowRunStep(raw: unknown, index: number): WorkflowRunStep | null {
  const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : { title: raw };
  const title = normalizeText(item.title ?? item.name ?? item.label, 240) || `Step ${index + 1}`;
  const rawIndex = Number(item.index ?? item.n ?? index + 1);
  const now = new Date().toISOString();
  return {
    index: Number.isFinite(rawIndex) && rawIndex > 0 ? Math.floor(rawIndex) : index + 1,
    title,
    status: normalizeWorkflowRunStepStatus(item.status),
    startedAt: normalizeText(item.startedAt, 80) || undefined,
    completedAt: normalizeText(item.completedAt, 80) || undefined,
    autonomousRun: normalizeWorkflowRunStepAutonomousRun(item.autonomousRun ?? item.autonomous_run, now),
  };
}

function normalizeWorkflowRunAskType(value: unknown): WorkflowRunAskType {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'number' || raw === 'choice' || raw === 'boolean' || raw === 'rating') return raw;
  return 'text';
}

function normalizeWorkflowRunAskStatus(value: unknown, answer?: string): WorkflowRunAskStatus {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'skipped' || raw === 'skip') return 'skipped';
  if (raw === 'answered' || raw === 'done' || raw === 'complete' || answer) return 'answered';
  return 'pending';
}

function normalizeWorkflowRunAskDeliveryStatus(value: unknown, askStatus: WorkflowRunAskStatus): WorkflowRunAskDeliveryStatus | undefined {
  const raw = normalizeText(value, 40).toLowerCase();
  if (raw === 'not_sent' || raw === 'not-sent' || raw === 'unsent') return 'not_sent';
  if (raw === 'sending' || raw === 'queued' || raw === 'pending') return 'sending';
  if (raw === 'sent' || raw === 'delivered' || raw === 'done') return 'sent';
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (askStatus === 'answered' || askStatus === 'skipped') return 'sent';
  return undefined;
}

function normalizeWorkflowRunAsk(raw: unknown, index: number, totalSteps: number, now: string): WorkflowRunAsk | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const question = normalizeText(item.question ?? item.prompt ?? item.text, 2_000);
  if (!question) return null;
  const answer = normalizeText(item.answer, 4_000) || undefined;
  const id = normalizeText(item.id, 160) || newId('workflow_ask');
  const options = normalizeStringList(item.options, 12, 160);
  const max = Math.max(1, Math.min(10, Math.floor(Number(item.max) || 0)));
  const status = normalizeWorkflowRunAskStatus(item.status, answer);
  const deliveryStatus = normalizeWorkflowRunAskDeliveryStatus(item.deliveryStatus ?? item.delivery_status, status);
  return {
    id,
    stepIndex: clampWorkflowStep(item.stepIndex ?? item.step_n ?? item.step ?? index + 1, totalSteps),
    question,
    type: normalizeWorkflowRunAskType(item.type),
    options: options.length ? options : undefined,
    max: Number.isFinite(max) && max > 0 ? max : undefined,
    placeholder: normalizeText(item.placeholder, 240) || undefined,
    answer,
    status,
    deliveryStatus,
    deliveryError: normalizeText(item.deliveryError ?? item.delivery_error, 1_000) || undefined,
    deliveryTaskId: normalizeText(item.deliveryTaskId ?? item.delivery_task_id, 220) || undefined,
    deliveredAt: normalizeText(item.deliveredAt ?? item.delivered_at, 80) || (deliveryStatus === 'sent' && answer ? now : undefined),
    askedAt: normalizeText(item.askedAt ?? item.asked_at, 80) || now,
    answeredAt: normalizeText(item.answeredAt ?? item.answered_at, 80) || (answer ? now : undefined),
  };
}

function normalizeWorkflowRunAsks(raw: unknown, totalSteps: number, now: string): WorkflowRunAsk[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => normalizeWorkflowRunAsk(item, index, totalSteps, now))
    .filter((item): item is WorkflowRunAsk => !!item)
    .slice(0, 40);
}

function workflowRunAskBlocksProgress(ask: WorkflowRunAsk): boolean {
  if (ask.status === 'pending') return true;
  return !!ask.deliveryStatus && ask.deliveryStatus !== 'sent';
}

function normalizeWorkflowRunRecord(raw: any): WorkflowRunRecord | null {
  const id = normalizeText(raw?.id, 160);
  const workflowName = normalizeText(raw?.workflowName ?? raw?.name, 160);
  if (!id || !workflowName) return null;
  const now = new Date().toISOString();
  const rawSteps: WorkflowRunStep[] = Array.isArray(raw?.steps)
    ? raw.steps
      .map((item: unknown, index: number) => normalizeWorkflowRunStep(item, index))
      .filter((item: WorkflowRunStep | null): item is WorkflowRunStep => !!item)
    : [];
  const totalSteps = Math.max(
    1,
    Math.floor(Number(raw?.totalSteps) || 0),
    rawSteps.length,
  );
  const currentStep = clampWorkflowStep(raw?.currentStep, totalSteps);
  const status = normalizeWorkflowRunStatus(raw?.status);
  return {
    id,
    workflowId: normalizeText(raw?.workflowId, 160) || undefined,
    workflowName,
    title: normalizeText(raw?.title, 200) || workflowName,
    workdir: normalizeText(raw?.workdir, 2_048) || undefined,
    agent: normalizeText(raw?.agent, 120) || undefined,
    model: normalizeText(raw?.model, 240) || undefined,
    effort: normalizeCustomWorkflowEffort(raw?.effort),
    assistantId: normalizeText(raw?.assistantId, 160) || undefined,
    assistantName: normalizeText(raw?.assistantName, 160) || undefined,
    sessionKey: normalizeText(raw?.sessionKey, 260) || undefined,
    sessionId: normalizeText(raw?.sessionId, 260) || undefined,
    note: normalizeText(raw?.note, 2_000) || undefined,
    currentStep,
    totalSteps,
    steps: rawSteps.length ? rawSteps : buildWorkflowRunSteps([], [], currentStep, totalSteps, status, now),
    asks: normalizeWorkflowRunAsks(raw?.asks, totalSteps, now),
    status,
    lastMarker: normalizeText(raw?.lastMarker, 1_000) || undefined,
    createdAt: normalizeText(raw?.createdAt, 80) || now,
    updatedAt: normalizeText(raw?.updatedAt, 80) || now,
    completedAt: normalizeText(raw?.completedAt, 80) || (status === 'done' ? now : undefined),
  };
}

function readFile(): WorkflowFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(workflowFilePath(), 'utf-8')) as WorkflowFile;
    return {
      version: 1,
      assistants: Array.isArray(parsed?.assistants) ? parsed.assistants.filter(item => item?.id && item?.name) : [],
      deletedAssistantIds: Array.isArray(parsed?.deletedAssistantIds) ? parsed.deletedAssistantIds.map(String).filter(Boolean) : [],
      customWorkflows: Array.isArray(parsed?.customWorkflows)
        ? parsed.customWorkflows.map(normalizeCustomWorkflowRecipe).filter((item): item is CustomWorkflowRecipe => !!item)
        : [],
      workflowRuns: Array.isArray(parsed?.workflowRuns)
        ? parsed.workflowRuns.map(normalizeWorkflowRunRecord).filter((item): item is WorkflowRunRecord => !!item)
        : [],
      automations: Array.isArray(parsed?.automations) ? parsed.automations.filter(item => item?.id && item?.name) : [],
      jiraSyncRuns: Array.isArray(parsed?.jiraSyncRuns) ? parsed.jiraSyncRuns.filter(item => item?.id) : [],
      jiraRemoteUpdateRuns: Array.isArray(parsed?.jiraRemoteUpdateRuns) ? parsed.jiraRemoteUpdateRuns.filter(item => item?.id && item?.taskId) : [],
      knowledge: Array.isArray(parsed?.knowledge)
        ? parsed.knowledge.map(normalizeKnowledgeEntry).filter((item): item is KnowledgeEntry => !!item)
        : [],
      jira: parsed?.jira && typeof parsed.jira === 'object' ? parsed.jira : undefined,
    };
  } catch {
    return { version: 1, assistants: [], deletedAssistantIds: [], customWorkflows: [], workflowRuns: [], automations: [], jiraSyncRuns: [], jiraRemoteUpdateRuns: [], knowledge: [] };
  }
}

function normalizeStringList(value: unknown, maxItems = 12, maxLength = 160): string[] {
  return Array.isArray(value)
    ? value.map(item => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeAssistantKind(value: unknown): AgentAssistant['kind'] {
  return value === 'page-owner' || value === 'task-stage' || value === 'creation' || value === 'automation' || value === 'custom'
    ? value
    : undefined;
}

function withAssistantDefaults(assistant: AgentAssistant): AgentAssistant {
  const builtin = DEFAULT_ASSISTANTS.find(item => item.id === assistant.id);
  const merged = builtin ? { ...builtin, ...assistant } : assistant;
  const responsibility = normalizeText(merged.responsibility) || builtin?.responsibility || 'Handle a specific workflow when assigned.';
  const defaultPrompt = normalizeText(merged.defaultPrompt) || builtin?.defaultPrompt || responsibility;
  return {
    ...merged,
    kind: normalizeAssistantKind(merged.kind) || builtin?.kind || 'custom',
    surfaceId: normalizeText(merged.surfaceId, 160) || builtin?.surfaceId,
    objectTypes: normalizeStringList(merged.objectTypes, 16, 120),
    responsibility,
    prompt: normalizeText(merged.prompt, 48_000) || defaultPrompt,
    defaultPrompt,
    preferredAgents: normalizeStringList(merged.preferredAgents, 8, 60),
    allowedActions: normalizeStringList(merged.allowedActions, 24, 120),
    labels: normalizeStringList(merged.labels, 16, 80),
    builtIn: builtin ? true : merged.builtIn === true,
    enabled: merged.enabled !== false,
    avatarSeed: merged.avatarSeed || merged.id,
  };
}

function titleFromPrompt(prompt: string): string {
  return prompt.split(/\s+/).filter(Boolean).slice(0, 10).join(' ').slice(0, 120) || 'Automation job';
}

function workflowNameSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeWorkflowDraft(input: {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  tags?: unknown;
  outputs?: unknown;
  steps?: unknown;
  capabilities?: unknown;
  promptHint?: unknown;
  cadence?: unknown;
  defaultEffort?: unknown;
}) {
  const name = normalizeText(input.name, 160);
  const description = normalizeText(input.description, 1_000);
  if (!name) throw new Error('workflow name is required');
  if (!description) throw new Error('workflow description is required');
  const steps = normalizeStringList(input.steps, 20, 240);
  if (!steps.length) throw new Error('workflow steps are required');
  const outputs = normalizeStringList(input.outputs, 12, 160);
  return {
    name,
    description,
    category: normalizeText(input.category, 120) || 'Custom',
    tags: normalizeStringList(input.tags, 24, 80),
    outputs: outputs.length ? outputs : ['workflow output'],
    steps,
    capabilities: normalizeStringList(input.capabilities, 12, 120),
    promptHint: normalizeText(input.promptHint, 4_000) || description,
    cadence: normalizeText(input.cadence, 80) || 'On demand',
    defaultEffort: normalizeCustomWorkflowEffort(input.defaultEffort),
  };
}

function buildWorkflowRunSteps(
  existingSteps: WorkflowRunStep[],
  inputSteps: string[],
  currentStep: number,
  totalSteps: number,
  status: WorkflowRunStatus,
  now: string,
): WorkflowRunStep[] {
  const existingByIndex = new Map(existingSteps.map(step => [step.index, step]));
  const titles = inputSteps.length ? inputSteps : existingSteps.map(step => step.title);
  return Array.from({ length: Math.max(1, totalSteps) }, (_, index) => {
    const stepIndex = index + 1;
    const existing = existingByIndex.get(stepIndex);
    const title = normalizeText(titles[index], 240) || existing?.title || `Step ${stepIndex}`;
    let stepStatus: WorkflowRunStepStatus = 'todo';
    if (status === 'done') stepStatus = 'done';
    else if (stepIndex < currentStep) stepStatus = 'done';
    else if (stepIndex === currentStep) stepStatus = status === 'blocked' ? 'blocked' : 'now';
    const startedAt = existing?.startedAt || (stepStatus === 'now' || stepStatus === 'blocked' || stepStatus === 'done' ? now : undefined);
    const completedAt = existing?.completedAt || (stepStatus === 'done' ? now : undefined);
    return {
      index: stepIndex,
      title,
      status: stepStatus,
      startedAt,
      completedAt,
      autonomousRun: existing?.autonomousRun,
    };
  });
}

function workflowRunSessionKey(agent: string | undefined, sessionId: string | undefined): string | undefined {
  return agent && sessionId ? `${agent}:${sessionId}` : undefined;
}

const WORKFLOW_MARKER_FENCE_RE = /^\s*```/;
const DEFAULT_WORKFLOW_AUTONOMOUS_STALL_MS = 45 * 60 * 1000;
const WORKFLOW_LEGACY_PROGRESS_RE = /^Workflow progress:\s*Step\s+(\d+)\s*\/\s*(\d+)\s*(.*)$/i;
const WORKFLOW_PIPE_PROGRESS_RE = /^Workflow progress:\s*(.+)$/i;
const WORKFLOW_COMPLETE_RE = /^Workflow complete\b/i;
const WORKFLOW_STATUS_RE = /(?:[-–—:]\s*)?(running|blocked|done|completed|complete)\.?\s*$/i;
const WORKFLOW_ASK_SOURCE_RE = /<ask\s+[^>]*?>[\s\S]*?<\/ask>|&lt;ask\s+[\s\S]*?&gt;[\s\S]*?&lt;\/ask&gt;/gi;
const WORKFLOW_ASK_RE = /^<ask\s+([^>]*?)>([\s\S]*?)<\/ask>$/i;
const WORKFLOW_ASK_ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

function normalizeWorkflowMarkerStatus(value: string | null | undefined): WorkflowRunStatus {
  const raw = value?.trim().toLowerCase();
  if (raw === 'blocked') return 'blocked';
  if (raw === 'done' || raw === 'completed' || raw === 'complete') return 'done';
  return 'running';
}

function parseWorkflowProgressLine(line: string): WorkflowMarkerProgress | null {
  const legacy = line.trim().match(WORKFLOW_LEGACY_PROGRESS_RE);
  if (legacy) {
    const rawCurrent = Number(legacy[1]);
    const rawTotal = Number(legacy[2]);
    const totalSteps = Math.max(1, Number.isFinite(rawTotal) ? Math.floor(rawTotal) : 1);
    const currentStep = clampWorkflowStep(rawCurrent, totalSteps);
    let rest = (legacy[3] || '').trim().replace(/^[-–—:\s]+/, '');
    const statusMatch = rest.match(WORKFLOW_STATUS_RE);
    const status = normalizeWorkflowMarkerStatus(statusMatch?.[1]);
    if (statusMatch) rest = rest.slice(0, statusMatch.index).replace(/[-–—:\s]+$/, '').trim();
    return { currentStep, totalSteps, title: rest || `Step ${currentStep}`, status, raw: line.trim() };
  }

  const pipe = line.trim().match(WORKFLOW_PIPE_PROGRESS_RE);
  if (!pipe) return null;
  const parts = pipe[1].split('|').map(part => part.trim()).filter(Boolean);
  let title = '';
  let stepMatch: RegExpMatchArray | null = null;
  let status: WorkflowRunStatus = 'running';
  for (const part of parts) {
    const maybeStep = part.match(/^step\s+(\d+)\s*\/\s*(\d+)/i) || part.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (maybeStep) {
      stepMatch = maybeStep;
      continue;
    }
    const maybeStatus = part.match(/^status\s+(.+)$/i);
    if (maybeStatus) {
      status = normalizeWorkflowMarkerStatus(maybeStatus[1]);
      continue;
    }
    if (!title) title = part;
  }
  if (!stepMatch) return null;
  const rawCurrent = Number(stepMatch[1]);
  const rawTotal = Number(stepMatch[2]);
  const totalSteps = Math.max(1, Number.isFinite(rawTotal) ? Math.floor(rawTotal) : 1);
  const currentStep = clampWorkflowStep(rawCurrent, totalSteps);
  return { currentStep, totalSteps, title: title || `Step ${currentStep}`, status, raw: line.trim() };
}

function normalizeWorkflowAskMarkerType(value: string | undefined): WorkflowRunAskType | null {
  const raw = value?.trim().toLowerCase();
  if (raw === 'text' || raw === 'number' || raw === 'choice' || raw === 'boolean' || raw === 'rating') return raw;
  return null;
}

function parseWorkflowAskAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  WORKFLOW_ASK_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORKFLOW_ASK_ATTR_RE.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function decodeWorkflowHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseWorkflowAskMarker(attrsText: string, questionText: string): WorkflowMarkerAsk | null {
  const attrs = parseWorkflowAskAttrs(attrsText);
  const type = normalizeWorkflowAskMarkerType(attrs.type);
  const question = normalizeText(questionText, 2_000);
  if (!type || !question) return null;
  const rawMax = Number(attrs.max);
  const ask: WorkflowMarkerAsk = {
    question,
    type,
  };
  const options = attrs.options ? attrs.options.split(',').map(item => normalizeText(item, 160)).filter(Boolean).slice(0, 12) : [];
  if (options.length) ask.options = options;
  if (Number.isFinite(rawMax) && rawMax > 0) ask.max = Math.min(10, Math.floor(rawMax));
  const placeholder = normalizeText(attrs.placeholder, 240);
  if (placeholder) ask.placeholder = placeholder;
  return ask;
}

function collectWorkflowInlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let tickCount = 1;
    while (text[index + tickCount] === '`') tickCount += 1;
    const marker = '`'.repeat(tickCount);
    const close = text.indexOf(marker, index + tickCount);
    if (close < 0) {
      index += tickCount;
      continue;
    }
    ranges.push([index, close + tickCount]);
    index = close + tickCount;
  }
  return ranges;
}

function workflowOffsetInRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function extractWorkflowAskMarkersFromSource(text: string): WorkflowMarkerAsk[] {
  const asks: WorkflowMarkerAsk[] = [];
  const inlineCodeRanges = collectWorkflowInlineCodeRanges(text);
  WORKFLOW_ASK_SOURCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORKFLOW_ASK_SOURCE_RE.exec(text)) !== null) {
    if (workflowOffsetInRanges(match.index, inlineCodeRanges)) continue;
    const source = match[0];
    const decoded = source.includes('&lt;') ? decodeWorkflowHtmlEntities(source) : source;
    const markerMatch = decoded.match(WORKFLOW_ASK_RE);
    if (!markerMatch) continue;
    const ask = parseWorkflowAskMarker(markerMatch[1], markerMatch[2]);
    if (ask) asks.push(ask);
  }
  return asks;
}

function splitWorkflowTextOutsideFences(text: string): Array<{ text: string; inFence: boolean }> {
  const out: Array<{ text: string; inFence: boolean }> = [];
  const lines = String(text || '').split('\n');
  let inFence = false;
  let current: string[] = [];
  let currentFence = false;
  const flush = () => {
    if (current.length) out.push({ text: current.join('\n'), inFence: currentFence });
    current = [];
  };
  for (const line of lines) {
    if (WORKFLOW_MARKER_FENCE_RE.test(line)) {
      flush();
      out.push({ text: line, inFence });
      inFence = !inFence;
      currentFence = inFence;
      continue;
    }
    if (current.length && currentFence !== inFence) flush();
    currentFence = inFence;
    current.push(line);
  }
  flush();
  return out;
}

export function extractWorkflowRunMarkersFromText(text: string): { progress: WorkflowMarkerProgress | null; asks: WorkflowMarkerAsk[] } {
  let progress: WorkflowMarkerProgress | null = null;
  let sawComplete = false;
  const asks: WorkflowMarkerAsk[] = [];

  for (const part of splitWorkflowTextOutsideFences(text)) {
    if (part.inFence) continue;
    for (const line of part.text.split('\n')) {
      const parsed = parseWorkflowProgressLine(line);
      if (parsed) {
        progress = parsed;
        continue;
      }
      if (WORKFLOW_COMPLETE_RE.test(line.trim())) sawComplete = true;
    }
    asks.push(...extractWorkflowAskMarkersFromSource(part.text));
  }

  if (progress && sawComplete) {
    progress = { ...progress, currentStep: progress.totalSteps, status: 'done' };
  }
  return { progress, asks };
}

function workflowMarkerMessageText(message: WorkflowMarkerMessage): string {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const blockText = blocks
    .filter(block => block?.type === 'text' || block?.type == null)
    .map(block => typeof block.content === 'string' ? block.content : '')
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (blockText) return blockText;
  return typeof message.text === 'string' ? message.text : '';
}

function workflowAskMarkerStableId(sessionKey: string, stepIndex: number, ask: WorkflowMarkerAsk): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${sessionKey}\n${stepIndex}\n${ask.type}\n${ask.question}`)
    .digest('hex')
    .slice(0, 16);
  return `workflow_ask_${hash}`;
}

function workflowMarkerStepTitles(progress: WorkflowMarkerProgress | null): string[] {
  const total = Math.max(1, progress?.totalSteps || 1);
  return Array.from({ length: total }, (_, index) => {
    const stepIndex = index + 1;
    if (progress && stepIndex === progress.currentStep) return progress.title;
    return `Step ${stepIndex}`;
  });
}

export function ingestWorkflowRunMarkersFromMessages(input: {
  workdir?: unknown;
  agent?: unknown;
  sessionId?: unknown;
  messages?: WorkflowMarkerMessage[];
}): WorkflowRunRecord | null {
  const agent = normalizeText(input.agent, 120);
  const sessionId = normalizeText(input.sessionId, 260);
  const sessionKey = workflowRunSessionKey(agent, sessionId);
  if (!sessionKey) return null;
  const workdir = normalizeText(input.workdir, 2_048);
  const messages = Array.isArray(input.messages) ? input.messages : [];

  let latestProgress: WorkflowMarkerProgress | null = null;
  const askByKey = new Map<string, { stepIndex: number; ask: WorkflowMarkerAsk }>();
  for (const message of messages) {
    if (message?.role !== 'assistant') continue;
    const text = workflowMarkerMessageText(message);
    if (!text) continue;
    const markers = extractWorkflowRunMarkersFromText(text);
    if (markers.progress) latestProgress = markers.progress;
    for (const ask of markers.asks) {
      const markerStep = latestProgress?.currentStep || 1;
      askByKey.set(`${markerStep}:${ask.type}:${ask.question}`, { stepIndex: markerStep, ask });
    }
  }

  const askEntries = [...askByKey.values()];
  if (!latestProgress && !askEntries.length) return null;

  const existingRun = (readFile().workflowRuns || []).find(run => run.sessionKey === sessionKey) || null;
  const currentStep = latestProgress?.currentStep || existingRun?.currentStep || 1;
  const totalSteps = Math.max(1, latestProgress?.totalSteps || existingRun?.totalSteps || currentStep);
  const allMarkerAsksAnswered = askEntries.length > 0 && askEntries.every(({ stepIndex, ask }) => {
    const askId = workflowAskMarkerStableId(sessionKey, stepIndex, ask);
    const existingAsk = existingRun?.asks?.find(item => item.id === askId);
    return existingAsk?.status === 'answered' || existingAsk?.status === 'skipped';
  });
  const markerStatus = latestProgress?.status || (askEntries.length ? 'blocked' : existingRun?.status || 'running');
  const status = markerStatus === 'blocked' && allMarkerAsksAnswered
    ? (existingRun?.status || 'running')
    : markerStatus;
  let run = recordWorkflowRun({
    workflowName: latestProgress?.title || existingRun?.workflowName || 'Chat workflow',
    title: latestProgress?.title || existingRun?.title || 'Chat workflow',
    workdir,
    agent,
    sessionId,
    sessionKey,
    currentStep,
    totalSteps,
    steps: latestProgress ? workflowMarkerStepTitles(latestProgress) : existingRun?.steps?.map(step => step.title),
    status,
    lastMarker: latestProgress?.raw,
  });

  for (const { stepIndex, ask } of askEntries) {
    const askId = workflowAskMarkerStableId(sessionKey, stepIndex, ask);
    const existingAsk = run.asks.find(item => item.id === askId);
    if (existingAsk?.status === 'answered' || existingAsk?.status === 'skipped') continue;
    run = recordWorkflowRunAsk(run.id, {
      id: askId,
      stepIndex,
      question: ask.question,
      type: ask.type,
      options: ask.options,
      max: ask.max,
      placeholder: ask.placeholder,
    }).run;
  }
  return run;
}

export function reconcileWorkflowRunMarkersFromMessages(input: {
  workdir?: unknown;
  agent?: unknown;
  sessionId?: unknown;
  messages?: WorkflowMarkerMessage[];
}): WorkflowMarkerReconcileResult {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  let scannedAssistantMessages = 0;
  let markerMessages = 0;
  let progressMarkers = 0;
  let askMarkers = 0;

  for (const message of messages) {
    if (message?.role !== 'assistant') continue;
    scannedAssistantMessages += 1;
    const text = workflowMarkerMessageText(message);
    if (!text) continue;
    const markers = extractWorkflowRunMarkersFromText(text);
    if (markers.progress) progressMarkers += 1;
    askMarkers += markers.asks.length;
    if (markers.progress || markers.asks.length) markerMessages += 1;
  }

  const run = ingestWorkflowRunMarkersFromMessages(input);
  return {
    run,
    scannedMessages: messages.length,
    scannedAssistantMessages,
    markerMessages,
    progressMarkers,
    askMarkers,
  };
}

function writeFile(file: WorkflowFile) {
  const filePath = workflowFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

export function listAgentAssistants(): AgentAssistant[] {
  const file = readFile();
  const fileAssistants = file.assistants;
  const customIds = new Set(fileAssistants.map(item => item.id));
  const deletedIds = new Set(file.deletedAssistantIds || []);
  return [
    ...fileAssistants,
    ...DEFAULT_ASSISTANTS.filter(item => !customIds.has(item.id) && !deletedIds.has(item.id)),
  ].map(withAssistantDefaults).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getAgentAssistant(id: string): AgentAssistant | undefined {
  const assistantId = normalizeText(id, 160);
  if (!assistantId) return undefined;
  return listAgentAssistants().find(item => item.id === assistantId);
}

export function getAssistantPrompt(id: string): { assistant: AgentAssistant; prompt: string; defaultPrompt: string; customized: boolean } {
  const assistant = getAgentAssistant(id);
  if (!assistant) throw new Error('assistant not found');
  const defaultPrompt = assistant.defaultPrompt || assistant.responsibility;
  const prompt = assistant.prompt || defaultPrompt;
  return {
    assistant,
    prompt,
    defaultPrompt,
    customized: prompt.trim() !== defaultPrompt.trim(),
  };
}

export function listCustomWorkflowRecipes(): CustomWorkflowRecipe[] {
  return (readFile().customWorkflows || []).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function createCustomWorkflowRecipe(input: {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  tags?: unknown;
  outputs?: unknown;
  steps?: unknown;
  capabilities?: unknown;
  promptHint?: unknown;
  cadence?: unknown;
  defaultEffort?: unknown;
}): CustomWorkflowRecipe {
  const draft = normalizeWorkflowDraft(input);
  const file = readFile();
  const now = new Date().toISOString();
  const baseSlug = workflowNameSlug(draft.name) || 'workflow';
  let id = `workflow_${baseSlug}`;
  const existingIds = new Set((file.customWorkflows || []).map(item => item.id));
  if (existingIds.has(id)) id = `${id}_${crypto.randomBytes(3).toString('hex')}`;
  const recipe: CustomWorkflowRecipe = {
    id,
    ...draft,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  file.customWorkflows = [recipe, ...(file.customWorkflows || [])];
  writeFile(file);
  return recipe;
}

export function updateCustomWorkflowRecipe(id: string, input: {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  tags?: unknown;
  outputs?: unknown;
  steps?: unknown;
  capabilities?: unknown;
  promptHint?: unknown;
  cadence?: unknown;
  defaultEffort?: unknown;
}): CustomWorkflowRecipe {
  const recipeId = normalizeText(id, 160);
  if (!recipeId) throw new Error('workflow id is required');
  const file = readFile();
  const recipe = (file.customWorkflows || []).find(item => item.id === recipeId);
  if (!recipe) throw new Error('workflow not found');
  const has = (key: keyof typeof input) => Object.prototype.hasOwnProperty.call(input, key);
  const draft = normalizeWorkflowDraft({
    name: has('name') ? input.name : recipe.name,
    description: has('description') ? input.description : recipe.description,
    category: has('category') ? input.category : recipe.category,
    tags: has('tags') ? input.tags : recipe.tags,
    outputs: has('outputs') ? input.outputs : recipe.outputs,
    steps: has('steps') ? input.steps : recipe.steps,
    capabilities: has('capabilities') ? input.capabilities : recipe.capabilities,
    promptHint: has('promptHint') ? input.promptHint : recipe.promptHint,
    cadence: has('cadence') ? input.cadence : recipe.cadence,
    defaultEffort: has('defaultEffort') ? input.defaultEffort : recipe.defaultEffort,
  });
  Object.assign(recipe, draft, { updatedAt: new Date().toISOString() });
  writeFile(file);
  return recipe;
}

export function deleteCustomWorkflowRecipe(id: string): CustomWorkflowRecipe {
  const recipeId = normalizeText(id, 160);
  if (!recipeId) throw new Error('workflow id is required');
  const file = readFile();
  const index = (file.customWorkflows || []).findIndex(item => item.id === recipeId);
  if (index < 0) throw new Error('workflow not found');
  const [removed] = file.customWorkflows!.splice(index, 1);
  writeFile(file);
  return removed;
}

export function listWorkflowRuns(input: { activeOnly?: unknown; limit?: unknown } = {}): WorkflowRunRecord[] {
  const activeOnly = input.activeOnly === true || input.activeOnly === 'true';
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 75)));
  return [...(readFile().workflowRuns || [])]
    .filter(run => !activeOnly || run.status === 'running' || run.status === 'blocked')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export function getWorkflowRun(id: string): WorkflowRunRecord | null {
  const runId = normalizeText(id, 160);
  if (!runId) return null;
  return (readFile().workflowRuns || []).find(run => run.id === runId) || null;
}

export function recordWorkflowRun(input: {
  id?: unknown;
  workflowId?: unknown;
  workflowName?: unknown;
  title?: unknown;
  workdir?: unknown;
  agent?: unknown;
  model?: unknown;
  effort?: unknown;
  assistantId?: unknown;
  assistantName?: unknown;
  sessionKey?: unknown;
  sessionId?: unknown;
  note?: unknown;
  currentStep?: unknown;
  totalSteps?: unknown;
  steps?: unknown;
  asks?: unknown;
  status?: unknown;
  lastMarker?: unknown;
}): WorkflowRunRecord {
  const file = readFile();
  const id = normalizeText(input.id, 160);
  const agent = normalizeText(input.agent, 120);
  const sessionId = normalizeText(input.sessionId, 260);
  const incomingSessionKey = normalizeText(input.sessionKey, 260) || workflowRunSessionKey(agent, sessionId);
  const runs = file.workflowRuns || [];
  const existing = (id ? runs.find(run => run.id === id) : null)
    || (incomingSessionKey ? runs.find(run => run.sessionKey === incomingSessionKey) : null)
    || null;
  const sessionKey = incomingSessionKey || existing?.sessionKey;
  const workflowId = normalizeText(input.workflowId, 160) || existing?.workflowId;
  const workflowName = normalizeText(input.workflowName, 160)
    || normalizeText(input.title, 160)
    || existing?.workflowName
    || 'Workflow run';
  const requestedStatus = normalizeWorkflowRunStatus(input.status ?? existing?.status);
  const inputSteps = normalizeStringList(input.steps, 40, 240);
  const existingSteps = existing?.steps || [];
  const totalSteps = Math.max(
    1,
    Math.floor(Number(input.totalSteps) || 0),
    inputSteps.length,
    existing?.totalSteps || 0,
  );
  const now = new Date().toISOString();
  const inputAsks = Object.prototype.hasOwnProperty.call(input, 'asks')
    ? normalizeWorkflowRunAsks(input.asks, totalSteps, now)
    : null;
  const asks = inputAsks ?? existing?.asks ?? [];
  const status = requestedStatus !== 'done' && asks.some(workflowRunAskBlocksProgress) ? 'blocked' : requestedStatus;
  const currentStep = status === 'done'
    ? totalSteps
    : clampWorkflowStep(input.currentStep ?? existing?.currentStep ?? 1, totalSteps);
  const run: WorkflowRunRecord = {
    id: existing?.id || id || newId('workflow_run'),
    workflowId,
    workflowName,
    title: normalizeText(input.title, 200) || existing?.title || workflowName,
    workdir: normalizeText(input.workdir, 2_048) || existing?.workdir,
    agent: agent || existing?.agent,
    model: normalizeText(input.model, 240) || existing?.model,
    effort: normalizeCustomWorkflowEffort(input.effort ?? existing?.effort),
    assistantId: normalizeText(input.assistantId, 160) || existing?.assistantId,
    assistantName: normalizeText(input.assistantName, 160) || existing?.assistantName,
    sessionKey,
    sessionId: sessionId || existing?.sessionId,
    note: normalizeText(input.note, 2_000) || existing?.note,
    currentStep,
    totalSteps,
    steps: buildWorkflowRunSteps(existingSteps, inputSteps, currentStep, totalSteps, status, now),
    asks,
    status,
    lastMarker: normalizeText(input.lastMarker, 1_000) || existing?.lastMarker,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    completedAt: status === 'done' ? (existing?.completedAt || now) : undefined,
  };
  file.workflowRuns = [run, ...runs.filter(item => item.id !== run.id)].slice(0, 75);
  writeFile(file);
  return run;
}

export function recordWorkflowRunStepAutonomousDispatch(runId: string, stepIndexInput: unknown, input: {
  dispatchId?: unknown;
  childAgent?: unknown;
  childSessionId?: unknown;
  childSessionKey?: unknown;
  taskId?: unknown;
  startedAt?: unknown;
} = {}): { run: WorkflowRunRecord; step: WorkflowRunStep } {
  const id = normalizeText(runId, 160);
  if (!id) throw new Error('workflow run id is required');
  const file = readFile();
  const runs = file.workflowRuns || [];
  const run = runs.find(item => item.id === id);
  if (!run) throw new Error('workflow run not found');
  const stepIndex = clampWorkflowStep(stepIndexInput, run.totalSteps);
  const target = run.steps.find(step => step.index === stepIndex);
  if (!target) throw new Error('workflow step not found');
  if (target.status === 'done') throw new Error('workflow step is already done');

  const now = new Date().toISOString();
  const requestedDispatchId = normalizeText(input.dispatchId, 160);
  if (
    target.autonomousRun?.state === 'running'
    && (!requestedDispatchId || target.autonomousRun.dispatchId !== requestedDispatchId)
  ) {
    throw new Error('workflow step already has a running autonomous worker');
  }
  const childAgent = normalizeText(input.childAgent, 120);
  const childSessionId = normalizeText(input.childSessionId, 260);
  const childSessionKey = normalizeText(input.childSessionKey, 260) || workflowRunSessionKey(childAgent, childSessionId);
  const reuseRunningDispatch = target.autonomousRun?.state === 'running';
  const autonomousRun: WorkflowRunStepAutonomousRun = {
    dispatchId: requestedDispatchId || (reuseRunningDispatch ? target.autonomousRun?.dispatchId : undefined) || newId('workflow_dispatch'),
    state: 'running',
    startedAt: normalizeText(input.startedAt, 80) || (reuseRunningDispatch ? (target.autonomousRun?.startedAt || now) : now),
    childAgent: childAgent || undefined,
    childSessionId: childSessionId || undefined,
    childSessionKey: childSessionKey || undefined,
    taskId: normalizeText(input.taskId, 160) || undefined,
  };

  const steps = buildWorkflowRunSteps(run.steps, run.steps.map(step => step.title), stepIndex, run.totalSteps, 'running', now)
    .map(step => step.index === stepIndex ? { ...step, autonomousRun } : step);
  const updated: WorkflowRunRecord = {
    ...run,
    currentStep: stepIndex,
    status: 'running',
    steps,
    lastMarker: `Workflow progress: Step ${stepIndex}/${run.totalSteps} - ${target.title} - running`,
    updatedAt: now,
    completedAt: undefined,
  };
  file.workflowRuns = [updated, ...runs.filter(item => item.id !== updated.id)].slice(0, 75);
  writeFile(file);
  return { run: updated, step: steps.find(step => step.index === stepIndex)! };
}

export function completeWorkflowRunStepAutonomous(runId: string, stepIndexInput: unknown, input: {
  state?: unknown;
  error?: unknown;
  taskId?: unknown;
  childAgent?: unknown;
  childSessionId?: unknown;
  childSessionKey?: unknown;
} = {}): { run: WorkflowRunRecord; step: WorkflowRunStep } {
  const id = normalizeText(runId, 160);
  if (!id) throw new Error('workflow run id is required');
  const file = readFile();
  const runs = file.workflowRuns || [];
  const run = runs.find(item => item.id === id);
  if (!run) throw new Error('workflow run not found');
  const stepIndex = clampWorkflowStep(stepIndexInput, run.totalSteps);
  const target = run.steps.find(step => step.index === stepIndex);
  if (!target) throw new Error('workflow step not found');

  const now = new Date().toISOString();
  const requestedState = normalizeWorkflowRunStepAutonomousState(input.state);
  const state: WorkflowRunStepAutonomousState = input.state == null && requestedState === 'running' ? 'done' : requestedState;
  const existingRun = target.autonomousRun;
  const childAgent = normalizeText(input.childAgent, 120) || existingRun?.childAgent || '';
  const childSessionId = normalizeText(input.childSessionId, 260) || existingRun?.childSessionId || '';
  const childSessionKey = normalizeText(input.childSessionKey, 260)
    || existingRun?.childSessionKey
    || workflowRunSessionKey(childAgent, childSessionId);
  const taskId = normalizeText(input.taskId, 160) || existingRun?.taskId;
  const autonomousRun: WorkflowRunStepAutonomousRun = {
    dispatchId: existingRun?.dispatchId || taskId || newId('workflow_dispatch'),
    state,
    startedAt: existingRun?.startedAt || now,
    completedAt: now,
    childAgent: childAgent || undefined,
    childSessionId: childSessionId || undefined,
    childSessionKey: childSessionKey || undefined,
    taskId: taskId || undefined,
    error: state === 'failed' || state === 'stalled'
      ? (
          normalizeText(input.error, 1_000)
          || existingRun?.error
          || (state === 'stalled'
            ? 'Autonomous worker appears stalled. Retry the worker or resume the step in the parent chat.'
            : 'Autonomous worker failed.')
        )
      : undefined,
  };

  const nextStatus: WorkflowRunStatus = state === 'done'
    ? (stepIndex >= run.totalSteps ? 'done' : 'running')
    : 'blocked';
  const nextCurrentStep = state === 'done'
    ? Math.max(run.currentStep, Math.min(run.totalSteps, stepIndex + 1))
    : stepIndex;
  const completedStepStatus: WorkflowRunStepStatus = state === 'done' ? 'done' : 'blocked';
  const steps: WorkflowRunStep[] = buildWorkflowRunSteps(
    run.steps,
    run.steps.map(step => step.title),
    nextCurrentStep,
    run.totalSteps,
    nextStatus,
    now,
  ).map((step): WorkflowRunStep => {
    if (step.index !== stepIndex) return step;
    return {
      ...step,
      status: completedStepStatus,
      completedAt: state === 'done' ? now : step.completedAt,
      autonomousRun,
    };
  });
  const updated: WorkflowRunRecord = {
    ...run,
    currentStep: nextCurrentStep,
    status: nextStatus,
    steps,
    lastMarker: `Workflow progress: Step ${stepIndex}/${run.totalSteps} - ${target.title} - ${state === 'done' ? 'done' : 'blocked'}`,
    updatedAt: now,
    completedAt: nextStatus === 'done' ? (run.completedAt || now) : undefined,
  };
  file.workflowRuns = [updated, ...runs.filter(item => item.id !== updated.id)].slice(0, 75);
  writeFile(file);
  return { run: updated, step: steps.find(step => step.index === stepIndex)! };
}

export function markStalledWorkflowRunAutonomousWorkers(input: {
  now?: unknown;
  timeoutMs?: unknown;
  limit?: unknown;
} = {}): WorkflowRunAutonomousWatchdogResult {
  const timeoutMs = Math.max(
    1_000,
    Math.min(24 * 60 * 60 * 1000, Math.floor(Number(input.timeoutMs) || DEFAULT_WORKFLOW_AUTONOMOUS_STALL_MS)),
  );
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 200)));
  const rawNow = typeof input.now === 'number'
    ? input.now
    : typeof input.now === 'string' && input.now.trim()
      ? Date.parse(input.now)
      : Date.now();
  const nowMs = Number.isFinite(rawNow) ? rawNow : Date.now();
  const candidates: Array<{ runId: string; stepIndex: number; ageMs: number }> = [];
  const runs = listWorkflowRuns({ activeOnly: true, limit });
  let scannedWorkers = 0;

  for (const run of runs) {
    for (const step of run.steps || []) {
      const autonomousRun = step.autonomousRun;
      if (autonomousRun?.state !== 'running') continue;
      scannedWorkers += 1;
      const startedAtMs = Date.parse(autonomousRun.startedAt || '');
      if (!Number.isFinite(startedAtMs)) continue;
      const ageMs = nowMs - startedAtMs;
      if (ageMs >= timeoutMs) candidates.push({ runId: run.id, stepIndex: step.index, ageMs });
    }
  }

  const stalled: WorkflowRunAutonomousWatchdogResult['stalled'] = [];
  for (const candidate of candidates) {
    const minutes = Math.max(1, Math.round(candidate.ageMs / 60_000));
    stalled.push(completeWorkflowRunStepAutonomous(candidate.runId, candidate.stepIndex, {
      state: 'stalled',
      error: `Autonomous worker has not completed after ${minutes} minutes. Retry the worker or resume this step in the parent chat.`,
    }));
  }

  return {
    scannedRuns: runs.length,
    scannedWorkers,
    stalled,
  };
}

export function findWorkflowRunByAutonomousRunRef(input: {
  taskId?: unknown;
  sessionKey?: unknown;
  agent?: unknown;
  sessionId?: unknown;
}): { run: WorkflowRunRecord; step: WorkflowRunStep } | null {
  const taskId = normalizeText(input.taskId, 160);
  const directSessionKey = normalizeText(input.sessionKey, 260);
  const agent = normalizeText(input.agent, 120);
  const sessionId = normalizeText(input.sessionId, 260);
  const sessionKey = directSessionKey || workflowRunSessionKey(agent, sessionId);
  if (!taskId && !sessionKey) return null;
  for (const run of listWorkflowRuns({ limit: 200 })) {
    for (const step of run.steps || []) {
      const autonomousRun = step.autonomousRun;
      if (!autonomousRun) continue;
      if (taskId && autonomousRun.taskId === taskId) return { run, step };
      if (sessionKey && autonomousRun.childSessionKey === sessionKey) return { run, step };
    }
  }
  return null;
}

export function recordWorkflowRunAsk(runId: string, input: {
  id?: unknown;
  stepIndex?: unknown;
  question?: unknown;
  type?: unknown;
  options?: unknown;
  max?: unknown;
  placeholder?: unknown;
}): { run: WorkflowRunRecord; ask: WorkflowRunAsk } {
  const targetRunId = normalizeText(runId, 160);
  if (!targetRunId) throw new Error('workflow run id is required');
  const file = readFile();
  const runs = file.workflowRuns || [];
  const index = runs.findIndex(item => item.id === targetRunId);
  if (index < 0) throw new Error('workflow run not found');
  const run = runs[index];
  const now = new Date().toISOString();
  const question = normalizeText(input.question, 2_000);
  if (!question) throw new Error('ask question is required');
  const stepIndex = clampWorkflowStep(input.stepIndex ?? run.currentStep, run.totalSteps);
  const askId = normalizeText(input.id, 160);
  const options = normalizeStringList(input.options, 12, 160);
  const max = Math.max(1, Math.min(10, Math.floor(Number(input.max) || 0)));
  const existingAsk = (run.asks || []).find(item => (
    (askId && item.id === askId)
    || (item.status === 'pending' && item.stepIndex === stepIndex && item.question === question)
  ));
  const ask: WorkflowRunAsk = {
    id: existingAsk?.id || askId || newId('workflow_ask'),
    stepIndex,
    question,
    type: normalizeWorkflowRunAskType(input.type),
    options: options.length ? options : existingAsk?.options,
    max: Number.isFinite(max) && max > 0 ? max : existingAsk?.max,
    placeholder: normalizeText(input.placeholder, 240) || existingAsk?.placeholder,
    answer: existingAsk?.answer,
    status: existingAsk?.status && existingAsk.status !== 'answered' && existingAsk.status !== 'skipped' ? existingAsk.status : 'pending',
    deliveryStatus: existingAsk?.deliveryStatus,
    deliveryError: existingAsk?.deliveryError,
    deliveryTaskId: existingAsk?.deliveryTaskId,
    deliveredAt: existingAsk?.deliveredAt,
    askedAt: existingAsk?.askedAt || now,
    answeredAt: existingAsk?.answeredAt,
  };
  const asks = [ask, ...(run.asks || []).filter(item => item.id !== ask.id)].slice(0, 40);
  const updated: WorkflowRunRecord = {
    ...run,
    currentStep: stepIndex,
    status: 'blocked',
    steps: buildWorkflowRunSteps(run.steps, run.steps.map(step => step.title), stepIndex, run.totalSteps, 'blocked', now),
    asks,
    lastMarker: `Workflow ask: Step ${stepIndex}/${run.totalSteps} - ${question}`,
    updatedAt: now,
  };
  file.workflowRuns = [updated, ...runs.filter(item => item.id !== updated.id)].slice(0, 75);
  writeFile(file);
  return { run: updated, ask };
}

export function answerWorkflowRunAsk(runId: string, askId: string, input: {
  answer?: unknown;
  skipped?: unknown;
}): { run: WorkflowRunRecord; ask: WorkflowRunAsk } {
  const targetRunId = normalizeText(runId, 160);
  const targetAskId = normalizeText(askId, 160);
  if (!targetRunId) throw new Error('workflow run id is required');
  if (!targetAskId) throw new Error('workflow ask id is required');
  const answer = normalizeText(input.answer, 4_000);
  const skipped = input.skipped === true || input.skipped === 'true';
  if (!answer && !skipped) throw new Error('workflow ask answer is required');
  const file = readFile();
  const runs = file.workflowRuns || [];
  const index = runs.findIndex(item => item.id === targetRunId);
  if (index < 0) throw new Error('workflow run not found');
  const run = runs[index];
  const now = new Date().toISOString();
  const ask = (run.asks || []).find(item => item.id === targetAskId);
  if (!ask) throw new Error('workflow ask not found');
  const answered: WorkflowRunAsk = {
    ...ask,
    answer: skipped ? (answer || 'skip') : answer,
    status: skipped ? 'skipped' : 'answered',
    deliveryStatus: 'sending',
    deliveryError: undefined,
    deliveryTaskId: undefined,
    deliveredAt: undefined,
    answeredAt: now,
  };
  const asks = (run.asks || []).map(item => item.id === targetAskId ? answered : item);
  const stillBlocked = asks.some(workflowRunAskBlocksProgress);
  const updated: WorkflowRunRecord = {
    ...run,
    currentStep: answered.stepIndex,
    status: stillBlocked ? 'blocked' : 'running',
    steps: buildWorkflowRunSteps(
      run.steps,
      run.steps.map(step => step.title),
      answered.stepIndex,
      run.totalSteps,
      stillBlocked ? 'blocked' : 'running',
      now,
    ),
    asks,
    lastMarker: `Workflow answer: Step ${answered.stepIndex}/${run.totalSteps} - ${answered.question}`,
    updatedAt: now,
  };
  file.workflowRuns = [updated, ...runs.filter(item => item.id !== updated.id)].slice(0, 75);
  writeFile(file);
  return { run: updated, ask: answered };
}

export function updateWorkflowRunAskDelivery(runId: string, askId: string, input: {
  deliveryStatus?: unknown;
  status?: unknown;
  error?: unknown;
  taskId?: unknown;
}): { run: WorkflowRunRecord; ask: WorkflowRunAsk } {
  const targetRunId = normalizeText(runId, 160);
  const targetAskId = normalizeText(askId, 160);
  if (!targetRunId) throw new Error('workflow run id is required');
  if (!targetAskId) throw new Error('workflow ask id is required');
  const file = readFile();
  const runs = file.workflowRuns || [];
  const index = runs.findIndex(item => item.id === targetRunId);
  if (index < 0) throw new Error('workflow run not found');
  const run = runs[index];
  const ask = (run.asks || []).find(item => item.id === targetAskId);
  if (!ask) throw new Error('workflow ask not found');
  const rawDeliveryStatus = input.deliveryStatus ?? input.status;
  const deliveryStatus = normalizeWorkflowRunAskDeliveryStatus(rawDeliveryStatus, ask.status);
  if (rawDeliveryStatus == null || !deliveryStatus) throw new Error('workflow ask delivery status is required');
  const now = new Date().toISOString();
  const taskId = normalizeText(input.taskId, 220);
  const error = normalizeText(input.error, 1_000);
  const updatedAsk: WorkflowRunAsk = {
    ...ask,
    deliveryStatus,
    deliveryError: deliveryStatus === 'failed' ? (error || 'Delivery failed') : undefined,
    deliveryTaskId: taskId || (deliveryStatus === 'sent' ? ask.deliveryTaskId : undefined),
    deliveredAt: deliveryStatus === 'sent' ? now : undefined,
  };
  const asks = (run.asks || []).map(item => item.id === targetAskId ? updatedAsk : item);
  const stillBlocked = asks.some(workflowRunAskBlocksProgress);
  const updated: WorkflowRunRecord = {
    ...run,
    status: stillBlocked ? 'blocked' : 'running',
    steps: buildWorkflowRunSteps(
      run.steps,
      run.steps.map(step => step.title),
      updatedAsk.stepIndex,
      run.totalSteps,
      stillBlocked ? 'blocked' : 'running',
      now,
    ),
    asks,
    lastMarker: deliveryStatus === 'failed'
      ? `Workflow answer delivery failed: Step ${updatedAsk.stepIndex}/${run.totalSteps} - ${updatedAsk.question}`
      : deliveryStatus === 'sent'
        ? `Workflow answer delivered: Step ${updatedAsk.stepIndex}/${run.totalSteps} - ${updatedAsk.question}`
        : run.lastMarker,
    updatedAt: now,
  };
  file.workflowRuns = [updated, ...runs.filter(item => item.id !== updated.id)].slice(0, 75);
  writeFile(file);
  return { run: updated, ask: updatedAsk };
}

export function deleteWorkflowRun(id: string): WorkflowRunRecord {
  const runId = normalizeText(id, 160);
  if (!runId) throw new Error('workflow run id is required');
  const file = readFile();
  const index = (file.workflowRuns || []).findIndex(item => item.id === runId);
  if (index < 0) throw new Error('workflow run not found');
  const [removed] = file.workflowRuns!.splice(index, 1);
  writeFile(file);
  return removed;
}

export function getJiraWorkflowConfig(): JiraWorkflowConfig {
  return { ...DEFAULT_JIRA_CONFIG, ...(readFile().jira || {}) };
}

export function getAnalyzeTicketPrompt(): { prompt: string; defaultPrompt: string; customized: boolean } {
  const config = getJiraWorkflowConfig();
  const defaultPrompt = DEFAULT_ANALYZE_TICKET_PROMPT;
  const prompt = normalizeText(config.analyzeTicketPrompt, 48_000) || defaultPrompt;
  return {
    prompt,
    defaultPrompt,
    customized: prompt.trim() !== defaultPrompt.trim(),
  };
}

export function updateAnalyzeTicketPrompt(input: { prompt?: unknown }): { prompt: string; defaultPrompt: string; customized: boolean } {
  const nextPrompt = normalizeText(input.prompt, 48_000);
  if (!nextPrompt) throw new Error('prompt is required');
  updateJiraWorkflowConfig({ analyzeTicketPrompt: nextPrompt });
  return getAnalyzeTicketPrompt();
}

export function resetAnalyzeTicketPrompt(): { prompt: string; defaultPrompt: string; customized: boolean } {
  const file = readFile();
  const current = { ...DEFAULT_JIRA_CONFIG, ...(file.jira || {}) };
  delete current.analyzeTicketPrompt;
  file.jira = current;
  writeFile(file);
  return getAnalyzeTicketPrompt();
}

function normalizeJiraWorkspaceRoutes(value: unknown): JiraWorkspaceRoute[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const routes = value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<JiraWorkspaceRoute>;
      const match = normalizeText(raw.match, 160);
      const workdir = normalizeText(raw.workdir, 2048);
      const matchType = raw.matchType === 'project' || raw.matchType === 'component' || raw.matchType === 'label' || raw.matchType === 'text'
        ? raw.matchType
        : 'text';
      if (!match || !workdir) return null;
      return { match, matchType, workdir };
    })
    .filter((item): item is JiraWorkspaceRoute => !!item)
    .slice(0, 32);
  return routes.length ? routes : undefined;
}

export function updateJiraWorkflowConfig(input: Partial<JiraWorkflowConfig>): JiraWorkflowConfig {
  const file = readFile();
  const current = { ...DEFAULT_JIRA_CONFIG, ...(file.jira || {}) };
  const statusWorkflows: JiraWorkflowConfig['statusWorkflows'] = { ...(current.statusWorkflows || {}) };
  if (input.statusWorkflows && typeof input.statusWorkflows === 'object') {
    for (const status of ['backlog', 'refinement', 'coding', 'resolved', 'done'] as const) {
      const raw = input.statusWorkflows[status];
      if (!raw || typeof raw !== 'object') continue;
      statusWorkflows[status] = {
        instruction: normalizeText(raw.instruction, 6000) || undefined,
        assistantId: normalizeText(raw.assistantId, 160) || undefined,
        modelPool: Array.isArray(raw.modelPool)
          ? raw.modelPool.map(model => normalizeText(model, 240)).filter(Boolean).slice(0, 12)
          : [],
      };
    }
  }
  const next: JiraWorkflowConfig = {
    executionOwnerMode: input.executionOwnerMode === 'agent' || input.executionOwnerMode === 'assistant' || input.executionOwnerMode === 'status'
      ? input.executionOwnerMode
      : current.executionOwnerMode,
    lifecycleAgent: input.lifecycleAgent !== undefined ? normalizeText(input.lifecycleAgent, 80) || undefined : current.lifecycleAgent,
    lifecycleAssistantId: input.lifecycleAssistantId !== undefined ? normalizeText(input.lifecycleAssistantId, 160) || undefined : current.lifecycleAssistantId,
    executionMode: input.executionMode === 'interactive' || input.executionMode === 'direct' ? input.executionMode : current.executionMode,
    refinementAssistantId: normalizeText(input.refinementAssistantId, 160) || current.refinementAssistantId,
    codingAssistantId: normalizeText(input.codingAssistantId, 160) || current.codingAssistantId,
    ticketSyncAssistantId: normalizeText(input.ticketSyncAssistantId, 160) || current.ticketSyncAssistantId,
    knowledgeAssistantId: normalizeText(input.knowledgeAssistantId, 160) || current.knowledgeAssistantId,
    chiefOfStaffAssistantId: normalizeText(input.chiefOfStaffAssistantId, 160) || current.chiefOfStaffAssistantId,
    focusAdvancedSensorsEnabled: typeof input.focusAdvancedSensorsEnabled === 'boolean'
      ? input.focusAdvancedSensorsEnabled
      : current.focusAdvancedSensorsEnabled,
    runKnowledgeOnRefinement: typeof input.runKnowledgeOnRefinement === 'boolean' ? input.runKnowledgeOnRefinement : current.runKnowledgeOnRefinement,
    runKnowledgeOnCoding: typeof input.runKnowledgeOnCoding === 'boolean' ? input.runKnowledgeOnCoding : current.runKnowledgeOnCoding,
    analyzeTicketPrompt: input.analyzeTicketPrompt !== undefined
      ? normalizeText(input.analyzeTicketPrompt, 48_000) || undefined
      : current.analyzeTicketPrompt,
    jiraWorkspaceRoutes: input.jiraWorkspaceRoutes !== undefined
      ? normalizeJiraWorkspaceRoutes(input.jiraWorkspaceRoutes)
      : current.jiraWorkspaceRoutes,
    statusWorkflows,
  };
  file.jira = next;
  writeFile(file);
  return next;
}

export function createAgentAssistant(input: { name: unknown; responsibility?: unknown; preferredAgents?: unknown; kind?: unknown; surfaceId?: unknown; objectTypes?: unknown; prompt?: unknown; defaultPrompt?: unknown; allowedActions?: unknown; labels?: unknown; enabled?: unknown }): AgentAssistant {
  const name = normalizeText(input.name, 120);
  if (!name) throw new Error('name is required');
  const now = new Date().toISOString();
  const responsibility = normalizeText(input.responsibility) || 'Handle a specific workflow when assigned.';
  const defaultPrompt = normalizeText(input.defaultPrompt, 48_000) || normalizeText(input.prompt, 48_000) || responsibility;
  const assistant: AgentAssistant = {
    id: newId('assistant'),
    name,
    kind: normalizeAssistantKind(input.kind) || 'custom',
    surfaceId: normalizeText(input.surfaceId, 160) || undefined,
    objectTypes: normalizeStringList(input.objectTypes, 16, 120),
    responsibility,
    prompt: normalizeText(input.prompt, 48_000) || defaultPrompt,
    defaultPrompt,
    preferredAgents: normalizeStringList(input.preferredAgents, 8, 60),
    allowedActions: normalizeStringList(input.allowedActions, 24, 120),
    labels: normalizeStringList(input.labels, 16, 80),
    builtIn: false,
    enabled: input.enabled !== false,
    avatarSeed: newAvatarSeed(),
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.assistants.unshift(assistant);
  writeFile(file);
  return withAssistantDefaults(assistant);
}

export function updateAgentAssistant(id: string, input: { name?: unknown; responsibility?: unknown; preferredAgents?: unknown; kind?: unknown; surfaceId?: unknown; objectTypes?: unknown; prompt?: unknown; defaultPrompt?: unknown; allowedActions?: unknown; labels?: unknown; enabled?: unknown }): AgentAssistant {
  const assistantId = normalizeText(id, 160);
  if (!assistantId) throw new Error('assistant id is required');
  const file = readFile();
  let assistant = file.assistants.find(item => item.id === assistantId);
  if (!assistant) {
    const builtin = DEFAULT_ASSISTANTS.find(item => item.id === assistantId);
    if (!builtin) throw new Error('assistant not found');
    assistant = { ...builtin, avatarSeed: builtin.avatarSeed || assistantId };
    file.assistants.unshift(assistant);
    file.deletedAssistantIds = (file.deletedAssistantIds || []).filter(item => item !== assistantId);
  }
  const builtin = DEFAULT_ASSISTANTS.find(item => item.id === assistantId);
  const name = normalizeText(input.name, 120);
  if (name) assistant.name = name;
  const responsibility = normalizeText(input.responsibility);
  if (responsibility) assistant.responsibility = responsibility;
  const kind = normalizeAssistantKind(input.kind);
  if (kind) assistant.kind = kind;
  if (input.surfaceId !== undefined) assistant.surfaceId = normalizeText(input.surfaceId, 160) || undefined;
  if (Array.isArray(input.objectTypes)) assistant.objectTypes = normalizeStringList(input.objectTypes, 16, 120);
  if (input.defaultPrompt !== undefined) assistant.defaultPrompt = normalizeText(input.defaultPrompt, 48_000) || builtin?.defaultPrompt || assistant.responsibility;
  if (input.prompt !== undefined) assistant.prompt = normalizeText(input.prompt, 48_000) || assistant.defaultPrompt || builtin?.defaultPrompt || assistant.responsibility;
  if (Array.isArray(input.preferredAgents)) assistant.preferredAgents = normalizeStringList(input.preferredAgents, 8, 60);
  if (Array.isArray(input.allowedActions)) assistant.allowedActions = normalizeStringList(input.allowedActions, 24, 120);
  if (Array.isArray(input.labels)) assistant.labels = normalizeStringList(input.labels, 16, 80);
  if (typeof input.enabled === 'boolean') assistant.enabled = input.enabled;
  assistant.updatedAt = new Date().toISOString();
  writeFile(file);
  return withAssistantDefaults(assistant);
}

export function updateAgentAssistantPrompt(id: string, input: { prompt?: unknown }): AgentAssistant {
  return updateAgentAssistant(id, { prompt: input.prompt });
}

export function resetAgentAssistantPrompt(id: string): AgentAssistant {
  const assistantId = normalizeText(id, 160);
  if (!assistantId) throw new Error('assistant id is required');
  const current = getAgentAssistant(assistantId);
  if (!current) throw new Error('assistant not found');
  return updateAgentAssistant(assistantId, { prompt: current.defaultPrompt || current.responsibility });
}

export function deleteAgentAssistant(id: string): AgentAssistant {
  const assistantId = normalizeText(id, 160);
  if (!assistantId) throw new Error('assistant id is required');
  const file = readFile();
  const index = file.assistants.findIndex(item => item.id === assistantId);
  const existing = index >= 0 ? file.assistants[index] : DEFAULT_ASSISTANTS.find(item => item.id === assistantId);
  if (!existing) throw new Error('assistant not found');
  if (index >= 0) file.assistants.splice(index, 1);
  if (DEFAULT_ASSISTANTS.some(item => item.id === assistantId)) {
    const deleted = new Set(file.deletedAssistantIds || []);
    deleted.add(assistantId);
    file.deletedAssistantIds = [...deleted];
  }
  writeFile(file);
  return withAssistantDefaults(existing);
}

export function listAutomationRules(): AutomationRule[] {
  return readFile().automations.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function normalizeReferenceNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  for (const item of value) {
    const name = normalizeText(item, 240);
    if (name && !name.includes('/') && !name.includes('\\')) seen.add(name);
  }
  return [...seen].slice(0, 20);
}

export function createAutomationRule(input: { key?: unknown; name: unknown; schedule?: unknown; prompt?: unknown; workdir?: unknown; agent?: unknown; assistantId?: unknown; enabled?: unknown; includeProjectReferences?: unknown; projectReferenceNames?: unknown }): AutomationRule {
  const prompt = normalizeText(input.prompt, 24_000);
  if (!prompt) throw new Error('prompt is required');
  const name = normalizeText(input.name, 160) || titleFromPrompt(prompt);
  const key = normalizeText(input.key, 160) || undefined;
  const now = new Date().toISOString();
  const rule: AutomationRule = {
    id: newId('automation'),
    key,
    name,
    schedule: normalizeText(input.schedule, 160) || 'manual',
    prompt,
    workdir: normalizeText(input.workdir, 2048) || undefined,
    agent: normalizeText(input.agent, 80) || undefined,
    assistantId: normalizeText(input.assistantId, 120) || undefined,
    enabled: input.enabled !== false,
    includeProjectReferences: input.includeProjectReferences === true,
    projectReferenceNames: normalizeReferenceNames(input.projectReferenceNames),
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.automations.unshift(rule);
  writeFile(file);
  return rule;
}

export function upsertAutomationRuleByKey(keyInput: string, input: { name: unknown; schedule?: unknown; prompt?: unknown; workdir?: unknown; agent?: unknown; assistantId?: unknown; enabled?: unknown; includeProjectReferences?: unknown; projectReferenceNames?: unknown }): AutomationRule {
  const key = normalizeText(keyInput, 160);
  if (!key) throw new Error('automation key is required');
  const prompt = normalizeText(input.prompt, 24_000);
  if (!prompt) throw new Error('prompt is required');
  const file = readFile();
  const now = new Date().toISOString();
  let rule = file.automations.find(item => item.key === key);
  if (!rule) {
    rule = {
      id: newId('automation'),
      key,
      name: normalizeText(input.name, 160) || titleFromPrompt(prompt),
      schedule: normalizeText(input.schedule, 160) || 'manual',
      prompt,
      workdir: normalizeText(input.workdir, 2048) || undefined,
      agent: normalizeText(input.agent, 80) || undefined,
      assistantId: normalizeText(input.assistantId, 120) || undefined,
      enabled: input.enabled !== false,
      includeProjectReferences: input.includeProjectReferences === true,
      projectReferenceNames: normalizeReferenceNames(input.projectReferenceNames),
      createdAt: now,
      updatedAt: now,
    };
    file.automations.unshift(rule);
  } else {
    rule.name = normalizeText(input.name, 160) || rule.name;
    rule.schedule = normalizeText(input.schedule, 160) || rule.schedule;
    rule.prompt = prompt;
    rule.workdir = normalizeText(input.workdir, 2048) || undefined;
    rule.agent = normalizeText(input.agent, 80) || undefined;
    rule.assistantId = normalizeText(input.assistantId, 120) || undefined;
    rule.enabled = input.enabled !== false;
    rule.includeProjectReferences = input.includeProjectReferences === true;
    rule.projectReferenceNames = normalizeReferenceNames(input.projectReferenceNames);
    rule.updatedAt = now;
  }
  writeFile(file);
  return rule;
}

export function updateAutomationRule(id: string, input: { name?: unknown; schedule?: unknown; prompt?: unknown; workdir?: unknown; agent?: unknown; assistantId?: unknown; enabled?: unknown; includeProjectReferences?: unknown; projectReferenceNames?: unknown }): AutomationRule {
  const automationId = normalizeText(id, 160);
  if (!automationId) throw new Error('automation id is required');
  const file = readFile();
  const rule = file.automations.find(item => item.id === automationId);
  if (!rule) throw new Error('automation not found');
  const has = (key: keyof typeof input) => Object.prototype.hasOwnProperty.call(input, key);
  if (has('name')) {
    const name = normalizeText(input.name, 160);
    if (name) rule.name = name;
  }
  if (has('schedule')) {
    rule.schedule = normalizeText(input.schedule, 160) || 'manual';
  }
  if (has('prompt')) {
    const prompt = normalizeText(input.prompt, 24_000);
    if (!prompt) throw new Error('prompt is required');
    rule.prompt = prompt;
    if (!rule.name) rule.name = titleFromPrompt(prompt);
  }
  if (has('workdir')) rule.workdir = normalizeText(input.workdir, 2048) || undefined;
  if (has('agent')) rule.agent = normalizeText(input.agent, 80) || undefined;
  if (has('assistantId')) rule.assistantId = normalizeText(input.assistantId, 120) || undefined;
  if (has('enabled')) rule.enabled = input.enabled !== false;
  if (has('includeProjectReferences')) rule.includeProjectReferences = input.includeProjectReferences === true;
  if (has('projectReferenceNames')) rule.projectReferenceNames = normalizeReferenceNames(input.projectReferenceNames);
  rule.updatedAt = new Date().toISOString();
  writeFile(file);
  return rule;
}

export function deleteAutomationRule(id: string): AutomationRule {
  const automationId = normalizeText(id, 160);
  if (!automationId) throw new Error('automation id is required');
  const file = readFile();
  const index = file.automations.findIndex(item => item.id === automationId);
  if (index < 0) throw new Error('automation not found');
  const [removed] = file.automations.splice(index, 1);
  writeFile(file);
  return removed;
}

export function markAutomationRun(id: string, sessionKey: string | undefined, details?: { taskId?: unknown; error?: unknown; code?: unknown; budgetId?: unknown; budgetName?: unknown }): AutomationRule {
  const file = readFile();
  const rule = file.automations.find(item => item.id === id);
  if (!rule) throw new Error('automation not found');
  const now = new Date().toISOString();
  rule.lastRunAt = now;
  rule.lastSessionKey = sessionKey;
  const status: 'queued' | 'failed' = sessionKey ? 'queued' : 'failed';
  const entry: NonNullable<AutomationRule['runHistory']>[number] = { id: newId('run'), ranAt: now, sessionKey, status };
  const taskId = normalizeText(details?.taskId, 160);
  if (taskId) entry.taskId = taskId;
  if (status === 'failed') {
    const error = normalizeText(details?.error, 1_000);
    const code = normalizeText(details?.code, 120);
    const budgetId = normalizeText(details?.budgetId, 160);
    const budgetName = normalizeText(details?.budgetName, 160);
    if (error) entry.error = error;
    if (code) entry.code = code;
    if (budgetId) entry.budgetId = budgetId;
    if (budgetName) entry.budgetName = budgetName;
  }
  rule.runHistory = [
    entry,
    ...(rule.runHistory || []),
  ].slice(0, 20);
  rule.updatedAt = now;
  writeFile(file);
  return rule;
}

export function markAutomationMissedRun(id: string, scheduledForInput: unknown, details?: { error?: unknown }): AutomationRule {
  const file = readFile();
  const rule = file.automations.find(item => item.id === id);
  if (!rule) throw new Error('automation not found');
  const scheduledFor = normalizeText(scheduledForInput, 80);
  if (!scheduledFor) throw new Error('scheduledFor is required');
  const existing = (rule.runHistory || []).find(item => item.status === 'missed' && item.scheduledFor === scheduledFor);
  if (existing) return rule;
  const now = new Date().toISOString();
  const error = normalizeText(details?.error, 1_000) || `Missed scheduled run at ${scheduledFor}.`;
  const entry: NonNullable<AutomationRule['runHistory']>[number] = {
    id: newId('run'),
    ranAt: now,
    scheduledFor,
    status: 'missed',
    error,
  };
  rule.runHistory = [
    entry,
    ...(rule.runHistory || []),
  ].slice(0, 20);
  rule.updatedAt = now;
  writeFile(file);
  return rule;
}

export function findAutomationRuleByRunRef(input: { taskId?: unknown; sessionKey?: unknown }): AutomationRule | null {
  const taskId = normalizeText(input.taskId, 160);
  const sessionKey = normalizeText(input.sessionKey, 260);
  if (!taskId && !sessionKey) return null;
  for (const rule of listAutomationRules()) {
    for (const run of rule.runHistory || []) {
      if (taskId && run.taskId === taskId) return rule;
      if (sessionKey && run.sessionKey === sessionKey) return rule;
    }
  }
  return null;
}

export function createJiraSyncRun(input: { assistantId?: unknown; assistantName?: unknown; agent?: unknown; workdir?: unknown }): JiraSyncRun {
  const now = new Date().toISOString();
  const run: JiraSyncRun = {
    id: newId('jira_sync'),
    status: 'starting',
    assistantId: normalizeText(input.assistantId, 160) || undefined,
    assistantName: normalizeText(input.assistantName, 160) || undefined,
    agent: normalizeText(input.agent, 80) || undefined,
    workdir: normalizeText(input.workdir, 2048) || undefined,
    startedAt: now,
    updatedAt: now,
    events: [{ id: newId('event'), at: now, label: 'Sync requested', detail: 'Preparing Jira MCP sync run.' }],
  };
  const file = readFile();
  file.jiraSyncRuns = [run, ...(file.jiraSyncRuns || [])].slice(0, 50);
  writeFile(file);
  return run;
}

export function listJiraSyncRuns(): JiraSyncRun[] {
  return [...(readFile().jiraSyncRuns || [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getJiraSyncRun(id: string): JiraSyncRun | undefined {
  const runId = normalizeText(id, 160);
  return (readFile().jiraSyncRuns || []).find(run => run.id === runId);
}

export function updateJiraSyncRun(id: string, patch: Partial<Omit<JiraSyncRun, 'id' | 'startedAt' | 'events'>> & { event?: { label: unknown; detail?: unknown } }): JiraSyncRun {
  const runId = normalizeText(id, 160);
  const file = readFile();
  const run = (file.jiraSyncRuns || []).find(item => item.id === runId);
  if (!run) throw new Error('jira sync run not found');
  const now = new Date().toISOString();
  if (patch.status) run.status = patch.status;
  if (patch.assistantId !== undefined) run.assistantId = normalizeText(patch.assistantId, 160) || undefined;
  if (patch.assistantName !== undefined) run.assistantName = normalizeText(patch.assistantName, 160) || undefined;
  if (patch.agent !== undefined) run.agent = normalizeText(patch.agent, 80) || undefined;
  if (patch.workdir !== undefined) run.workdir = normalizeText(patch.workdir, 2048) || undefined;
  if (patch.sessionKey !== undefined) run.sessionKey = normalizeText(patch.sessionKey, 240) || undefined;
  if (typeof patch.ticketCount === 'number') run.ticketCount = Math.max(0, Math.floor(patch.ticketCount));
  if (typeof patch.taskCount === 'number') run.taskCount = Math.max(0, Math.floor(patch.taskCount));
  if (patch.analysisSummary !== undefined) run.analysisSummary = normalizeText(patch.analysisSummary, 4000) || undefined;
  if (Array.isArray(patch.issueKeys)) run.issueKeys = patch.issueKeys.map(key => normalizeText(key, 80)).filter(Boolean).slice(0, 80);
  if (Array.isArray((patch as any).items)) run.items = ((patch as any).items as JiraSyncRunItem[]).slice(0, 500);
  if (Array.isArray(patch.changes)) {
    run.changes = patch.changes.slice(0, 100).map(change => ({
      taskId: normalizeText(change.taskId, 160) || undefined,
      jiraKey: normalizeText(change.jiraKey, 80) || undefined,
      title: normalizeText(change.title, 240) || normalizeText(change.jiraKey, 80) || 'Untitled Jira issue',
      action: change.action === 'created' || change.action === 'updated' || change.action === 'unchanged' ? change.action : 'updated',
      summary: normalizeText(change.summary, 800) || undefined,
      status: normalizeText(change.status, 120) || undefined,
      kind: normalizeText(change.kind, 80) || undefined,
      sprint: normalizeText(change.sprint, 120) || undefined,
      assignee: normalizeText(change.assignee, 240) || undefined,
      priority: normalizeText(change.priority, 120) || undefined,
      dueDate: normalizeText(change.dueDate, 80) || undefined,
      updatedAt: normalizeText(change.updatedAt, 80) || undefined,
    }));
  }
  if (patch.error !== undefined) run.error = normalizeText(patch.error, 2000) || undefined;
  if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'stopped') run.completedAt = now;
  const label = normalizeText(patch.event?.label, 240);
  if (label) {
    run.events.push({
      id: newId('event'),
      at: now,
      label,
      detail: normalizeText(patch.event?.detail, 2000) || undefined,
    });
  }
  run.updatedAt = now;
  file.jiraSyncRuns = [run, ...(file.jiraSyncRuns || []).filter(item => item.id !== run.id)].slice(0, 50);
  writeFile(file);
  return run;
}

export function recordJiraSyncCandidates(runId: string, issues: unknown[]): JiraSyncRun {
  const run = getJiraSyncRun(runId);
  if (!run) throw new Error('jira sync run not found');
  if (run.status === 'stopped') throw new Error('jira sync run stopped');
  const rawIssues = Array.isArray(issues) ? issues : [];
  const items = rawIssues
    .map(issue => issue && typeof issue === 'object' ? normalizeJiraSyncItem(issue as Record<string, unknown>) : null)
    .filter((item): item is JiraSyncRunItem => !!item);
  const excluded = rawIssues.length - items.length;
  const summary = [
    `Found ${rawIssues.length} Jira ticket${rawIssues.length === 1 ? '' : 's'}.`,
    `Prepared ${items.length} sync candidate${items.length === 1 ? '' : 's'}.`,
    excluded ? `Excluded ${excluded} closed/cancelled or invalid ticket${excluded === 1 ? '' : 's'}.` : '',
  ].filter(Boolean).join(' ');
  return updateJiraSyncRun(runId, {
    status: 'completed',
    ticketCount: items.length,
    taskCount: 0,
    issueKeys: items.map(item => item.jiraKey).filter((key): key is string => !!key),
    items,
    analysisSummary: summary,
    event: { label: `Prepared ${items.length} Jira sync candidate${items.length === 1 ? '' : 's'}`, detail: summary },
  } as any);
}

export function stopJiraSyncRun(runId: string, reason: unknown = 'Jira sync stopped by user'): JiraSyncRun {
  return updateJiraSyncRun(runId, {
    status: 'stopped',
    error: normalizeText(reason, 1000) || 'Jira sync stopped by user',
    event: { label: 'Jira sync stopped', detail: normalizeText(reason, 1000) || 'Stopped by user.' },
  });
}

export function applyJiraSyncRunItems(runId: string, itemIds: unknown[]): JiraSyncRun {
  const run = getJiraSyncRun(runId);
  if (!run) throw new Error('jira sync run not found');
  if (run.status === 'stopped') throw new Error('jira sync run stopped');
  const selectedIds = new Set((Array.isArray(itemIds) ? itemIds : []).map(item => normalizeText(item, 160)).filter(Boolean));
  if (!selectedIds.size) throw new Error('at least one sync item is required');
  const items = (run.items || []).map(item => ({ ...item, selected: selectedIds.has(item.id) }));
  const tasks = [];
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const changes: JiraSyncRunChange[] = [];
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    const task = syncJiraTask({
      title: item.title,
      description: item.description,
      issueType: item.issueType,
      jiraKey: item.jiraKey,
      jiraUrl: item.jiraUrl || item.url,
      sprint: item.sprint,
      fixVersions: item.fixVersions,
      reporter: item.reporter,
      assignee: item.assignee,
      ticketStatus: item.ticketStatus || item.jiraStatus,
      dueDate: item.dueDate,
      priority: item.priority,
      labels: item.labels,
      updatedAt: item.updatedAt,
    });
    const latestEvent = task.events?.[0];
    const action: 'created' | 'updated' | 'unchanged' = latestEvent?.type === 'jira-updated'
      ? 'updated'
      : latestEvent?.summary?.includes('no field changes')
        ? 'unchanged'
        : 'created';
    counts[action] += 1;
    item.status = 'applied';
    item.taskId = task.id;
    item.syncAction = action;
    tasks.push(task);
    changes.push({
      taskId: task.id,
      jiraKey: task.jiraKey,
      title: task.title,
      action,
      summary: latestEvent?.summary,
      status: task.status,
      kind: task.kind,
      sprint: task.sprint,
      assignee: task.jiraFields?.assignee,
      priority: task.jiraFields?.priority,
      dueDate: task.jiraFields?.dueDate,
      updatedAt: task.updatedAt,
    });
  }
  const detail = `created=${counts.created}, updated=${counts.updated}, unchanged=${counts.unchanged}.`;
  return updateJiraSyncRun(runId, {
    status: 'completed',
    ticketCount: run.ticketCount || items.length,
    taskCount: tasks.length,
    items,
    changes,
    issueKeys: changes.map(change => change.jiraKey).filter((key): key is string => !!key),
    analysisSummary: `Applied ${tasks.length} Jira sync item${tasks.length === 1 ? '' : 's'}: ${detail}`,
    event: { label: `Applied ${tasks.length} Jira sync item${tasks.length === 1 ? '' : 's'}`, detail },
  } as any);
}

function normalizeRemoteFixVersions(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(item => namedValue(item) || normalizeText(item, 120)).filter(Boolean).slice(0, 20);
  const text = normalizeText(value, 1000);
  if (!text) return undefined;
  return text.split(/[,，;；\n]+/).map(item => normalizeText(item, 120)).filter(Boolean).slice(0, 20);
}

function normalizeRemoteUpdateFields(input: unknown): JiraRemoteUpdateFields {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const fields: JiraRemoteUpdateFields = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'status')) {
    const status = normalizeText(raw.status, 120);
    if (status) fields.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sprint')) fields.sprint = normalizeText(raw.sprint, 120);
  if (Object.prototype.hasOwnProperty.call(raw, 'dueDate')) fields.dueDate = normalizeText(raw.dueDate, 80);
  if (Object.prototype.hasOwnProperty.call(raw, 'fixVersions') || Object.prototype.hasOwnProperty.call(raw, 'fixVersion')) {
    fields.fixVersions = normalizeRemoteFixVersions(raw.fixVersions ?? raw.fixVersion) || [];
  }
  return fields;
}

function sameRemoteValue(a: string | string[] | undefined, b: string | string[] | undefined): boolean {
  const normalize = (value: string | string[] | undefined) => Array.isArray(value)
    ? value.map(item => item.trim()).filter(Boolean).join('\u0000')
    : normalizeText(value, 1000);
  return normalize(a) === normalize(b);
}

function remoteUpdateDiff(current: JiraRemoteUpdateFields, fields: JiraRemoteUpdateFields): JiraRemoteUpdateDiff[] {
  const diff: JiraRemoteUpdateDiff[] = [];
  for (const field of ['status', 'fixVersions', 'sprint', 'dueDate'] as JiraRemoteUpdateField[]) {
    const to = fields[field];
    if (to === undefined) continue;
    const from = current[field];
    if (!sameRemoteValue(from, to)) diff.push({ field, from, to });
  }
  return diff;
}

export function listJiraRemoteUpdateRuns(taskId?: unknown): JiraRemoteUpdateRun[] {
  const normalizedTaskId = normalizeText(taskId, 160);
  return [...(readFile().jiraRemoteUpdateRuns || [])]
    .filter(run => !normalizedTaskId || run.taskId === normalizedTaskId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getJiraRemoteUpdateRun(id: string): JiraRemoteUpdateRun | undefined {
  const runId = normalizeText(id, 160);
  return (readFile().jiraRemoteUpdateRuns || []).find(run => run.id === runId);
}

export function createJiraRemoteUpdateRun(input: {
  taskId: unknown;
  jiraKey?: unknown;
  jiraUrl?: unknown;
  currentFields?: JiraRemoteUpdateFields;
  fields?: unknown;
}): JiraRemoteUpdateRun {
  const taskId = normalizeText(input.taskId, 160);
  if (!taskId) throw new Error('taskId is required');
  const fields = normalizeRemoteUpdateFields(input.fields);
  const diff = remoteUpdateDiff(input.currentFields || {}, fields);
  if (!diff.length) throw new Error('no jira field changes');
  const now = new Date().toISOString();
  const run: JiraRemoteUpdateRun = {
    id: newId('jira_remote_update'),
    taskId,
    jiraKey: normalizeText(input.jiraKey, 80) || undefined,
    jiraUrl: normalizeText(input.jiraUrl, 2048) || undefined,
    status: 'draft',
    fields,
    diff,
    createdAt: now,
    updatedAt: now,
    events: [{ id: newId('event'), at: now, label: 'Jira update drafted', detail: diff.map(item => item.field).join(', ') }],
  };
  const file = readFile();
  file.jiraRemoteUpdateRuns = [run, ...(file.jiraRemoteUpdateRuns || [])].slice(0, 100);
  writeFile(file);
  return run;
}

export function updateJiraRemoteUpdateRun(id: string, patch: {
  status?: JiraRemoteUpdateStatus;
  error?: unknown;
  remoteTool?: unknown;
  event?: { label: unknown; detail?: unknown };
}): JiraRemoteUpdateRun {
  const runId = normalizeText(id, 160);
  const file = readFile();
  const run = (file.jiraRemoteUpdateRuns || []).find(item => item.id === runId);
  if (!run) throw new Error('jira remote update run not found');
  const now = new Date().toISOString();
  if (patch.status) {
    run.status = patch.status;
    if (patch.status === 'applying' && !run.startedAt) run.startedAt = now;
    if (patch.status === 'applied' || patch.status === 'failed' || patch.status === 'cancelled') run.completedAt = now;
  }
  if (patch.error !== undefined) run.error = normalizeText(patch.error, 2000) || undefined;
  if (patch.remoteTool !== undefined) run.remoteTool = normalizeText(patch.remoteTool, 240) || undefined;
  const label = normalizeText(patch.event?.label, 240);
  if (label) {
    run.events.push({
      id: newId('event'),
      at: now,
      label,
      detail: normalizeText(patch.event?.detail, 2000) || undefined,
    });
  }
  run.updatedAt = now;
  file.jiraRemoteUpdateRuns = [run, ...(file.jiraRemoteUpdateRuns || []).filter(item => item.id !== run.id)].slice(0, 100);
  writeFile(file);
  return run;
}

export function cancelJiraRemoteUpdateRun(id: string): JiraRemoteUpdateRun {
  const run = getJiraRemoteUpdateRun(id);
  if (!run) throw new Error('jira remote update run not found');
  if (run.status === 'applied') throw new Error('applied jira update cannot be cancelled');
  return updateJiraRemoteUpdateRun(id, {
    status: 'cancelled',
    event: { label: 'Jira update cancelled', detail: 'Cancelled before remote apply.' },
  });
}

function knowledgeEntryMatches(entry: KnowledgeEntry, filters: KnowledgeEntryFilters = {}): boolean {
  const query = normalizeText(filters.query, 200).toLowerCase();
  const tag = normalizeText(filters.tag, 80).toLowerCase();
  const sourceType = normalizeText(filters.sourceType, 80);
  const workspace = normalizeText(filters.workspace, 1_000);
  const status = normalizeText(filters.status, 80);
  const kind = normalizeText(filters.kind, 80);
  if (query) {
    const haystack = [
      entry.title,
      entry.summary || '',
      entry.body,
      ...(entry.tags || []),
      ...(entry.sourceRefs || []).map(ref => [ref.title, ref.workdir, ref.agent, ref.sessionId, ref.taskId, ref.path, ref.url].filter(Boolean).join(' ')),
    ].join('\n').toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (tag && !(entry.tags || []).some(item => item.toLowerCase() === tag)) return false;
  if (sourceType && !(entry.sourceRefs || []).some(ref => ref.type === sourceType) && entry.source?.type !== sourceType) return false;
  if (workspace && !(entry.sourceRefs || []).some(ref => ref.workdir === workspace) && entry.source?.workdir !== workspace) return false;
  if (status && entry.status !== status) return false;
  if (kind && entry.kind !== kind) return false;
  return true;
}

export function listKnowledgeEntries(filters: KnowledgeEntryFilters = {}): KnowledgeEntry[] {
  return readFile().knowledge
    .filter(entry => knowledgeEntryMatches(entry, filters))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getKnowledgeEntry(id: string): KnowledgeEntry | undefined {
  const entryId = normalizeText(id, 160);
  if (!entryId) return undefined;
  return readFile().knowledge.find(entry => entry.id === entryId);
}

export function createKnowledgeEntry(input: {
  title: unknown;
  body?: unknown;
  kind?: unknown;
  status?: unknown;
  summary?: unknown;
  source?: KnowledgeEntry['source'];
  sourceRefs?: unknown;
  artifactRefs?: unknown;
  confidence?: unknown;
  createdBy?: unknown;
  tags?: unknown;
}): KnowledgeEntry {
  const title = normalizeText(input.title, 200);
  const body = normalizeText(input.body, 48_000);
  if (!title) throw new Error('title is required');
  if (!body) throw new Error('body is required');
  const source = input.source ? normalizeKnowledgeEntry({ id: 'tmp', title, body, source: input.source })?.source : undefined;
  const sourceRefs = normalizeKnowledgeRefs(input.sourceRefs, normalizeKnowledgeSourceRef);
  const artifactRefs = normalizeKnowledgeRefs(input.artifactRefs, normalizeKnowledgeArtifactRef);
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: newId('knowledge'),
    title,
    body,
    kind: normalizeKnowledgeKind(input.kind),
    status: normalizeKnowledgeStatus(input.status),
    summary: normalizeText(input.summary, 1_000) || undefined,
    source,
    sourceRefs: sourceRefs.length ? sourceRefs : sourceRefFromLegacySource(source),
    artifactRefs,
    confidence: normalizeKnowledgeConfidence(input.confidence),
    createdBy: normalizeKnowledgeCreatedBy(input.createdBy),
    tags: normalizeStringList(input.tags, 20, 60),
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.knowledge.unshift(entry);
  writeFile(file);
  return entry;
}

export function updateKnowledgeEntry(
  id: string,
  patch: Partial<{
    title: unknown;
    body: unknown;
    kind: unknown;
    status: unknown;
    summary: unknown;
    tags: unknown;
    confidence: unknown;
    sourceRefs: unknown;
    artifactRefs: unknown;
  }>,
): KnowledgeEntry {
  const entryId = normalizeText(id, 160);
  if (!entryId) throw new Error('knowledge id is required');
  const file = readFile();
  const index = file.knowledge.findIndex(entry => entry.id === entryId);
  if (index < 0) throw new Error('knowledge entry not found');
  const current = file.knowledge[index];
  const next: KnowledgeEntry = {
    ...current,
    title: patch.title !== undefined ? normalizeText(patch.title, 200) : current.title,
    body: patch.body !== undefined ? normalizeText(patch.body, 48_000) : current.body,
    kind: patch.kind !== undefined ? normalizeKnowledgeKind(patch.kind) : current.kind,
    status: patch.status !== undefined ? normalizeKnowledgeStatus(patch.status) : current.status,
    summary: patch.summary !== undefined ? normalizeText(patch.summary, 1_000) || undefined : current.summary,
    tags: patch.tags !== undefined ? normalizeStringList(patch.tags, 20, 60) : current.tags,
    confidence: patch.confidence !== undefined ? normalizeKnowledgeConfidence(patch.confidence) : current.confidence,
    sourceRefs: patch.sourceRefs !== undefined ? normalizeKnowledgeRefs(patch.sourceRefs, normalizeKnowledgeSourceRef) : current.sourceRefs,
    artifactRefs: patch.artifactRefs !== undefined ? normalizeKnowledgeRefs(patch.artifactRefs, normalizeKnowledgeArtifactRef) : current.artifactRefs,
    updatedAt: new Date().toISOString(),
  };
  if (!next.title) throw new Error('title is required');
  if (!next.body) throw new Error('body is required');
  file.knowledge[index] = next;
  writeFile(file);
  return next;
}

export function deleteKnowledgeEntry(id: string, options: { hard?: boolean } = {}): KnowledgeEntry | null {
  const entryId = normalizeText(id, 160);
  if (!entryId) throw new Error('knowledge id is required');
  const file = readFile();
  const index = file.knowledge.findIndex(entry => entry.id === entryId);
  if (index < 0) return null;
  if (options.hard) {
    const [removed] = file.knowledge.splice(index, 1);
    writeFile(file);
    return removed || null;
  }
  const hidden = {
    ...file.knowledge[index],
    status: 'hidden' as const,
    updatedAt: new Date().toISOString(),
  };
  file.knowledge[index] = hidden;
  writeFile(file);
  return hidden;
}
