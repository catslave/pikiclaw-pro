/**
 * Session plan view — a driver-agnostic representation of native or portable
 * planning output. Native agents still own their lifecycle; pikiclaw stores a
 * small view so dashboard/IM can render and recover the current plan shape.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent, AgentCapabilityMode, StreamPreviewPlanStep } from './types.js';

export type SessionPlanStatus =
  | 'draft'
  | 'needs_clarification'
  | 'approved'
  | 'implementing'
  | 'cancelled'
  | 'completed';

export interface SessionPlanView {
  planId: string;
  agent: Agent;
  source: string;
  mode: AgentCapabilityMode;
  status: SessionPlanStatus;
  content: string;
  steps: StreamPreviewPlanStep[];
  createdAt: string;
  updatedAt: string;
}

const PLAN_FILE = 'plan.json';

export function sessionPlanPath(workdir: string, agent: Agent, sessionId: string): string {
  return path.join(workdir, '.pikiclaw', 'sessions', agent, sessionId, PLAN_FILE);
}

export function readSessionPlan(workdir: string, agent: Agent, sessionId: string): SessionPlanView | null {
  const file = sessionPlanPath(workdir, agent, sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return normalizePlanView(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

export function writeSessionPlan(workdir: string, agent: Agent, sessionId: string, plan: SessionPlanView): SessionPlanView {
  const file = sessionPlanPath(workdir, agent, sessionId);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const next: SessionPlanView = { ...plan, updatedAt: new Date().toISOString() };
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

export function clearSessionPlan(workdir: string, agent: Agent, sessionId: string): void {
  const file = sessionPlanPath(workdir, agent, sessionId);
  try { fs.rmSync(file, { force: true }); } catch {}
}

export function createSessionPlanView(opts: {
  agent: Agent;
  source: string;
  mode: AgentCapabilityMode;
  status?: SessionPlanStatus;
  content?: string;
  steps?: StreamPreviewPlanStep[];
}): SessionPlanView {
  const now = new Date().toISOString();
  return {
    planId: `plan_${crypto.randomBytes(6).toString('hex')}`,
    agent: opts.agent,
    source: opts.source,
    mode: opts.mode,
    status: opts.status || 'draft',
    content: opts.content || '',
    steps: normalizeSteps(opts.steps || []),
    createdAt: now,
    updatedAt: now,
  };
}

export function extractProposedPlan(text: string): string | null {
  const match = text.match(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/i);
  const body = match?.[1]?.trim();
  return body || null;
}

function normalizePlanView(raw: any): SessionPlanView | null {
  if (!raw || typeof raw !== 'object') return null;
  const planId = typeof raw.planId === 'string' && raw.planId.trim() ? raw.planId.trim() : '';
  const agent = typeof raw.agent === 'string' && raw.agent.trim() ? raw.agent.trim() : '';
  const source = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : 'unknown';
  const mode = raw.mode === 'native' || raw.mode === 'portable' || raw.mode === 'unsupported' ? raw.mode : 'portable';
  const status = normalizePlanStatus(raw.status);
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
  return {
    planId: planId || `plan_${crypto.randomBytes(6).toString('hex')}`,
    agent,
    source,
    mode,
    status,
    content: typeof raw.content === 'string' ? raw.content : '',
    steps: normalizeSteps(Array.isArray(raw.steps) ? raw.steps : []),
    createdAt,
    updatedAt,
  };
}

function normalizePlanStatus(value: any): SessionPlanStatus {
  switch (value) {
    case 'draft':
    case 'needs_clarification':
    case 'approved':
    case 'implementing':
    case 'cancelled':
    case 'completed':
      return value;
    default:
      return 'draft';
  }
}

function normalizeSteps(steps: any[]): StreamPreviewPlanStep[] {
  return steps
    .map(step => {
      const label = typeof step?.step === 'string' ? step.step.trim() : '';
      if (!label) return null;
      const status = step.status === 'completed' || step.status === 'inProgress' ? step.status : 'pending';
      return { step: label, status };
    })
    .filter(Boolean) as StreamPreviewPlanStep[];
}
