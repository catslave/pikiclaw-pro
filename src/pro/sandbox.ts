import { getJiraWorkflowConfig } from './workflow.js';

export type FocusSandboxKind = 'jira' | 'todo' | 'bug' | 'review' | 'chat';
export type FocusSandboxRecordState = 'active' | 'paused' | 'completed';

export interface FocusSandboxSessionRef {
  workdir: string;
  agent: string;
  sessionId: string;
}

export interface FocusSandboxScope {
  workdir: string;
  branch?: string | null;
  fileGlobs?: string[];
}

export interface FocusSandboxRecord {
  id: string;
  kind: FocusSandboxKind;
  state: FocusSandboxRecordState;
  title: string;
  jiraKey?: string | null;
  taskId?: string | null;
  sessionRef?: FocusSandboxSessionRef | null;
  scope: FocusSandboxScope;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface CreateFocusSandboxInput {
  kind: FocusSandboxKind;
  title: string;
  workdir: string;
  jiraKey?: string | null;
  taskId?: string | null;
  sessionRef?: FocusSandboxSessionRef | null;
  branch?: string | null;
  fileGlobs?: string[];
}

export interface UpdateFocusSandboxInput {
  state?: FocusSandboxRecordState;
  title?: string;
  branch?: string | null;
  fileGlobs?: string[];
}

const SANDBOX_KINDS = new Set<FocusSandboxKind>(['jira', 'todo', 'bug', 'review', 'chat']);
const SANDBOX_STATES = new Set<FocusSandboxRecordState>(['active', 'paused', 'completed']);

export function normalizeSandboxKind(value: unknown): FocusSandboxKind | null {
  const kind = typeof value === 'string' ? value.trim() : '';
  return SANDBOX_KINDS.has(kind as FocusSandboxKind) ? kind as FocusSandboxKind : null;
}

export function normalizeSandboxState(value: unknown): FocusSandboxRecordState | null {
  const state = typeof value === 'string' ? value.trim() : '';
  return SANDBOX_STATES.has(state as FocusSandboxRecordState) ? state as FocusSandboxRecordState : null;
}

export function normalizeSessionRef(value: unknown): FocusSandboxSessionRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Record<string, unknown>;
  const workdir = typeof ref.workdir === 'string' ? ref.workdir.trim() : '';
  const agent = typeof ref.agent === 'string' ? ref.agent.trim() : '';
  const sessionId = typeof ref.sessionId === 'string' ? ref.sessionId.trim() : '';
  if (!workdir || !agent || !sessionId) return null;
  return { workdir, agent, sessionId };
}

export function canTransitionSandboxState(from: FocusSandboxRecordState, to: FocusSandboxRecordState): boolean {
  if (from === to) return true;
  if (from === 'completed') return false;
  if (to === 'completed') return true;
  return from === 'active' && to === 'paused' || from === 'paused' && to === 'active';
}

export const FOCUS_ACTIVE_SANDBOX_CAP = 3;

export function resolveExecutorAgentForSandboxKind(kind: FocusSandboxKind): string | null {
  const config = getJiraWorkflowConfig();
  if (kind === 'bug' || kind === 'todo' || kind === 'review') return config.codingAssistantId || 'assistant_coding';
  if (kind === 'jira') return config.refinementAssistantId || 'assistant_refinement';
  return null;
}

