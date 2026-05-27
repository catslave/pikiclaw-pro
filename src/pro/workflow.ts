import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentAssistant {
  id: string;
  name: string;
  responsibility: string;
  preferredAgents: string[];
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

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  source?: {
    type: 'manual' | 'chat' | 'task';
    workdir?: string;
    agent?: string;
    sessionId?: string;
    taskId?: string;
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JiraWorkflowConfig {
  refinementAssistantId?: string;
  codingAssistantId?: string;
  ticketSyncAssistantId?: string;
  knowledgeAssistantId?: string;
  runKnowledgeOnRefinement?: boolean;
  runKnowledgeOnCoding?: boolean;
}

interface WorkflowFile {
  version: 1;
  assistants: AgentAssistant[];
  deletedAssistantIds?: string[];
  automations: AutomationRule[];
  knowledge: KnowledgeEntry[];
  jira?: JiraWorkflowConfig;
}

const DEFAULT_JIRA_CONFIG: JiraWorkflowConfig = {
  refinementAssistantId: 'assistant_refinement',
  codingAssistantId: 'assistant_coding',
  ticketSyncAssistantId: 'assistant_ticket_sync',
  knowledgeAssistantId: 'assistant_knowledge',
  runKnowledgeOnRefinement: true,
  runKnowledgeOnCoding: true,
};

const DEFAULT_ASSISTANTS: AgentAssistant[] = [
  {
    id: 'assistant_refinement',
    name: 'Refinement Assistant',
    responsibility: 'Clarify ticket/task goal, boundary, acceptance points, risks, and estimate coding, review, verification, and user-understanding time.',
    preferredAgents: ['codex', 'claude'],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_coding',
    name: 'Coding Assistant',
    responsibility: 'Implement scoped changes, keep diffs reviewable, run focused validation, and respond to review comments with follow-up coding.',
    preferredAgents: ['codex', 'claude'],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_ticket_sync',
    name: 'Ticket Sync Assistant',
    responsibility: 'Sync Jira tickets into Pikiclaw tasks, append remote updates without overwriting local task history, and flag newly assigned or changed work.',
    preferredAgents: ['codex'],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_knowledge',
    name: 'Knowledge Assistant',
    responsibility: 'After refinement completes, extract reusable concepts, terminology, assumptions, and basic knowledge points that help the user understand the task faster.',
    preferredAgents: ['codex', 'claude'],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  },
  {
    id: 'assistant_idea_guide',
    name: 'Idea Guide Assistant',
    responsibility: 'Guide the user from a rough intent to a clear idea. First research mainstream related products, implementations, patterns, and pitfalls; then ask step-by-step questions about goal, audience, boundary, workflow, constraints, risks, and acceptance points; finally synthesize a structured idea with options, tradeoffs, and next steps.',
    preferredAgents: ['codex', 'claude'],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
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

function readFile(): WorkflowFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(workflowFilePath(), 'utf-8')) as WorkflowFile;
    return {
      version: 1,
      assistants: Array.isArray(parsed?.assistants) ? parsed.assistants.filter(item => item?.id && item?.name) : [],
      deletedAssistantIds: Array.isArray(parsed?.deletedAssistantIds) ? parsed.deletedAssistantIds.map(String).filter(Boolean) : [],
      automations: Array.isArray(parsed?.automations) ? parsed.automations.filter(item => item?.id && item?.name) : [],
      knowledge: Array.isArray(parsed?.knowledge) ? parsed.knowledge.filter(item => item?.id && item?.title) : [],
      jira: parsed?.jira && typeof parsed.jira === 'object' ? parsed.jira : undefined,
    };
  } catch {
    return { version: 1, assistants: [], deletedAssistantIds: [], automations: [], knowledge: [] };
  }
}

function withAssistantAvatar(assistant: AgentAssistant): AgentAssistant {
  return assistant.avatarSeed ? assistant : { ...assistant, avatarSeed: assistant.id };
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
  ].map(withAssistantAvatar).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getJiraWorkflowConfig(): JiraWorkflowConfig {
  return { ...DEFAULT_JIRA_CONFIG, ...(readFile().jira || {}) };
}

export function updateJiraWorkflowConfig(input: Partial<JiraWorkflowConfig>): JiraWorkflowConfig {
  const file = readFile();
  const current = { ...DEFAULT_JIRA_CONFIG, ...(file.jira || {}) };
  const next: JiraWorkflowConfig = {
    refinementAssistantId: normalizeText(input.refinementAssistantId, 160) || current.refinementAssistantId,
    codingAssistantId: normalizeText(input.codingAssistantId, 160) || current.codingAssistantId,
    ticketSyncAssistantId: normalizeText(input.ticketSyncAssistantId, 160) || current.ticketSyncAssistantId,
    knowledgeAssistantId: normalizeText(input.knowledgeAssistantId, 160) || current.knowledgeAssistantId,
    runKnowledgeOnRefinement: typeof input.runKnowledgeOnRefinement === 'boolean' ? input.runKnowledgeOnRefinement : current.runKnowledgeOnRefinement,
    runKnowledgeOnCoding: typeof input.runKnowledgeOnCoding === 'boolean' ? input.runKnowledgeOnCoding : current.runKnowledgeOnCoding,
  };
  file.jira = next;
  writeFile(file);
  return next;
}

export function createAgentAssistant(input: { name: unknown; responsibility?: unknown; preferredAgents?: unknown }): AgentAssistant {
  const name = normalizeText(input.name, 120);
  if (!name) throw new Error('name is required');
  const now = new Date().toISOString();
  const assistant: AgentAssistant = {
    id: newId('assistant'),
    name,
    responsibility: normalizeText(input.responsibility) || 'Handle a specific workflow when assigned.',
    preferredAgents: Array.isArray(input.preferredAgents)
      ? input.preferredAgents.map(agent => normalizeText(agent, 60)).filter(Boolean).slice(0, 8)
      : [],
    avatarSeed: newAvatarSeed(),
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.assistants.unshift(assistant);
  writeFile(file);
  return assistant;
}

export function updateAgentAssistant(id: string, input: { name?: unknown; responsibility?: unknown; preferredAgents?: unknown }): AgentAssistant {
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
  const name = normalizeText(input.name, 120);
  if (name) assistant.name = name;
  const responsibility = normalizeText(input.responsibility);
  if (responsibility) assistant.responsibility = responsibility;
  if (Array.isArray(input.preferredAgents)) {
    assistant.preferredAgents = input.preferredAgents.map(agent => normalizeText(agent, 60)).filter(Boolean).slice(0, 8);
  }
  assistant.updatedAt = new Date().toISOString();
  writeFile(file);
  return withAssistantAvatar(assistant);
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
  return withAssistantAvatar(existing);
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

export function listKnowledgeEntries(): KnowledgeEntry[] {
  return readFile().knowledge.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function createKnowledgeEntry(input: { title: unknown; body?: unknown; source?: KnowledgeEntry['source']; tags?: unknown }): KnowledgeEntry {
  const title = normalizeText(input.title, 200);
  const body = normalizeText(input.body, 48_000);
  if (!title) throw new Error('title is required');
  if (!body) throw new Error('body is required');
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: newId('knowledge'),
    title,
    body,
    source: input.source,
    tags: Array.isArray(input.tags) ? input.tags.map(tag => normalizeText(tag, 60)).filter(Boolean).slice(0, 12) : [],
    createdAt: now,
    updatedAt: now,
  };
  const file = readFile();
  file.knowledge.unshift(entry);
  writeFile(file);
  return entry;
}
