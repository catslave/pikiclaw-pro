import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastSessionKey?: string;
  assistantId?: string;
  runHistory?: Array<{
    id: string;
    ranAt: string;
    sessionKey?: string;
    status: 'queued' | 'failed';
  }>;
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
  if (workdir) ref.workdir = workdir;
  if (agent) ref.agent = agent;
  if (sessionId) ref.sessionId = sessionId;
  if (taskId) ref.taskId = taskId;
  if (outputId) ref.outputId = outputId;
  if (filePath) ref.path = filePath;
  if (url) ref.url = url;
  if (title) ref.title = title;
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

function readFile(): WorkflowFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(workflowFilePath(), 'utf-8')) as WorkflowFile;
    return {
      version: 1,
      assistants: Array.isArray(parsed?.assistants) ? parsed.assistants.filter(item => item?.id && item?.name) : [],
      deletedAssistantIds: Array.isArray(parsed?.deletedAssistantIds) ? parsed.deletedAssistantIds.map(String).filter(Boolean) : [],
      automations: Array.isArray(parsed?.automations) ? parsed.automations.filter(item => item?.id && item?.name) : [],
      jiraSyncRuns: Array.isArray(parsed?.jiraSyncRuns) ? parsed.jiraSyncRuns.filter(item => item?.id) : [],
      jiraRemoteUpdateRuns: Array.isArray(parsed?.jiraRemoteUpdateRuns) ? parsed.jiraRemoteUpdateRuns.filter(item => item?.id && item?.taskId) : [],
      knowledge: Array.isArray(parsed?.knowledge)
        ? parsed.knowledge.map(normalizeKnowledgeEntry).filter((item): item is KnowledgeEntry => !!item)
        : [],
      jira: parsed?.jira && typeof parsed.jira === 'object' ? parsed.jira : undefined,
    };
  } catch {
    return { version: 1, assistants: [], deletedAssistantIds: [], automations: [], jiraSyncRuns: [], jiraRemoteUpdateRuns: [], knowledge: [] };
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

export function createAutomationRule(input: { key?: unknown; name: unknown; schedule?: unknown; prompt?: unknown; workdir?: unknown; agent?: unknown; assistantId?: unknown; enabled?: unknown }): AutomationRule {
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
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.automations.unshift(rule);
  writeFile(file);
  return rule;
}

export function upsertAutomationRuleByKey(keyInput: string, input: { name: unknown; schedule?: unknown; prompt?: unknown; workdir?: unknown; agent?: unknown; assistantId?: unknown; enabled?: unknown }): AutomationRule {
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
    rule.updatedAt = now;
  }
  writeFile(file);
  return rule;
}

export function markAutomationRun(id: string, sessionKey: string | undefined): AutomationRule {
  const file = readFile();
  const rule = file.automations.find(item => item.id === id);
  if (!rule) throw new Error('automation not found');
  const now = new Date().toISOString();
  rule.lastRunAt = now;
  rule.lastSessionKey = sessionKey;
  const status: 'queued' | 'failed' = sessionKey ? 'queued' : 'failed';
  rule.runHistory = [
    { id: newId('run'), ranAt: now, sessionKey, status },
    ...(rule.runHistory || []),
  ].slice(0, 20);
  rule.updatedAt = now;
  writeFile(file);
  return rule;
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
