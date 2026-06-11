/**
 * Focus chief-of-staff orchestrator: merges sensor data into command center plans.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FocusRecommendation } from './focus-command-center.js';
import type { FocusSensorSnapshot } from './focus-sensors/index.js';
import { loadPreviousSensorSnapshot, sensorDigestSummary } from './focus-sensors/index.js';
import { getJiraWorkflowConfig } from '../pro/workflow.js';

export interface FocusOrchestratorPlan {
  headline: string;
  recommendations: FocusRecommendation[];
  userIntent?: string | null;
  generatedAt: string;
  source: 'agent' | 'rules';
}

export interface FocusOrchestratorMeta {
  lastRun: string | null;
  stale: boolean;
  source: 'agent' | 'rules' | null;
  userIntent?: string | null;
}

function focusDir() {
  return process.env.PIKICLAW_FOCUS_DIR || path.join(os.homedir(), '.pikiclaw', 'focus');
}

function planPath(localDay: string) {
  return path.join(focusDir(), `plan-${localDay}.json`);
}

function metaPath() {
  return path.join(focusDir(), 'orchestrator-meta.json');
}

export function loadOrchestratorPlan(localDay: string): FocusOrchestratorPlan | null {
  const filePath = planPath(localDay);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FocusOrchestratorPlan;
  } catch {
    return null;
  }
}

export function saveOrchestratorPlan(localDay: string, plan: FocusOrchestratorPlan) {
  fs.mkdirSync(focusDir(), { recursive: true });
  fs.writeFileSync(planPath(localDay), JSON.stringify(plan, null, 2));
  const meta: FocusOrchestratorMeta = {
    lastRun: plan.generatedAt,
    stale: false,
    source: plan.source,
    userIntent: plan.userIntent || null,
  };
  fs.writeFileSync(metaPath(), JSON.stringify(meta, null, 2));
}

export function loadOrchestratorMeta(): FocusOrchestratorMeta {
  if (!fs.existsSync(metaPath())) return { lastRun: null, stale: true, source: null };
  try {
    return JSON.parse(fs.readFileSync(metaPath(), 'utf8')) as FocusOrchestratorMeta;
  } catch {
    return { lastRun: null, stale: true, source: null };
  }
}

export function buildRulesOrchestratorPlan(input: {
  snapshot: FocusSensorSnapshot;
  recommendations: FocusRecommendation[];
  userIntent?: string | null;
}): FocusOrchestratorPlan {
  const previous = loadPreviousSensorSnapshot(input.snapshot.localDay);
  const summary = sensorDigestSummary(input.snapshot, previous);
  const urgentJira = input.snapshot.jira.todayIncoming.length;
  const dirtyGit = input.snapshot.git.filter(item => item.changedFiles > 0).length;
  let headline = '当前工作台清爽，适合直接开启一个新任务沙盒。';
  if (input.snapshot.session.blocked > 0) {
    headline = `有 ${input.snapshot.session.blocked} 个阻塞会话需要先处理。`;
  } else if (urgentJira > 0) {
    headline = `今日外部接入 ${urgentJira} 项 Jira 变更，建议先对齐优先级。`;
  } else if (input.recommendations.length > 0) {
    headline = `建议先接回 ${Math.min(input.recommendations.length, 3)} 个活跃沙盒。`;
  } else if (dirtyGit > 0) {
    headline = `${dirtyGit} 个工作区有未提交改动，适合先做一次结算。`;
  }
  if (input.userIntent) {
    headline = `已纳入你的补充：${input.userIntent}。${headline}`;
  }
  return {
    headline,
    recommendations: input.recommendations,
    userIntent: input.userIntent || null,
    generatedAt: new Date().toISOString(),
    source: 'rules',
  };
}

export function buildOrchestratorPrompt(snapshot: FocusSensorSnapshot, recommendations: FocusRecommendation[], userIntent?: string | null): string {
  const previous = loadPreviousSensorSnapshot(snapshot.localDay);
  return [
    'You are the Pikiclaw chief-of-staff orchestrator.',
    'Do not write long prose. Output one JSON object only with keys: headline, recommendations.',
    'recommendations must reuse sandboxId/title/reason/priority from the input when possible.',
    'headline must be one short Chinese sentence for the daily command center.',
    '',
    `Sensor summary:\n${sensorDigestSummary(snapshot, previous)}`,
    '',
    `Sensor JSON:\n${JSON.stringify(snapshot, null, 2)}`,
    '',
    `Candidate recommendations:\n${JSON.stringify(recommendations.slice(0, 6), null, 2)}`,
    userIntent ? `User intent override:\n${userIntent}` : '',
    '',
    'JSON schema example:',
    JSON.stringify({
      headline: '今天先看 2 个活跃沙盒，Jira 有 1 个紧急变更。',
      recommendations: [{
        id: 'example',
        title: 'Example sandbox',
        summary: 'Resume point',
        priority: 'high',
        sandboxId: 'task:123',
        reason: 'Why now',
      }],
    }, null, 2),
  ].filter(Boolean).join('\n');
}

export function parseOrchestratorJson(text: string): Pick<FocusOrchestratorPlan, 'headline' | 'recommendations'> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    const parsed = JSON.parse(candidate) as { headline?: unknown; recommendations?: unknown };
    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter(item => item && typeof item === 'object') as FocusRecommendation[]
      : [];
    if (!headline) return null;
    return { headline, recommendations };
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as { headline?: unknown; recommendations?: unknown };
      const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
      const recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(item => item && typeof item === 'object') as FocusRecommendation[]
        : [];
      if (!headline) return null;
      return { headline, recommendations };
    } catch {
      return null;
    }
  }
}

export function resolveChiefOfStaffAgentId(): string {
  const config = getJiraWorkflowConfig();
  return config.chiefOfStaffAssistantId || 'assistant_chief_of_staff';
}

export function mergeOrchestratorPlan(
  fallback: FocusOrchestratorPlan,
  parsed: Pick<FocusOrchestratorPlan, 'headline' | 'recommendations'> | null,
  source: 'agent' | 'rules',
): FocusOrchestratorPlan {
  if (!parsed) return { ...fallback, source: 'rules' };
  return {
    headline: parsed.headline || fallback.headline,
    recommendations: parsed.recommendations.length ? parsed.recommendations : fallback.recommendations,
    userIntent: fallback.userIntent || null,
    generatedAt: new Date().toISOString(),
    source,
  };
}

export function resetOrchestratorStoreForTests() {
  const dir = focusDir();
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('plan-') || name === 'orchestrator-meta.json') {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}
