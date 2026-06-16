import { describe, expect, it } from 'vitest';
import type { AutomationRule, WorkflowRunRecord, WorkflowTemplate } from '../dashboard/src/types.ts';
import {
  summarizeWorkflowRecipeActivity,
  workflowRecipeMatchesAutomation,
  workflowRecipeMatchesRun,
} from '../dashboard/src/pages/wayland/workflowRecipeActivity.ts';

const recipe: WorkflowTemplate = {
  id: 'release-gate',
  name: 'Release Gate',
  description: 'Validate release readiness.',
  category: 'Release',
  tags: ['release'],
};

function run(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: 'run-1',
    workflowId: 'release-gate',
    workflowName: 'Release Gate',
    title: 'Release Gate',
    currentStep: 1,
    totalSteps: 2,
    steps: [
      { index: 1, title: 'Inspect', status: 'now' },
      { index: 2, title: 'Report', status: 'todo' },
    ],
    asks: [],
    status: 'running',
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:10:00.000Z',
    ...overrides,
  };
}

function automation(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'auto-1',
    name: 'Release Gate',
    schedule: 'weekly@1@09:00',
    prompt: 'Run release gate',
    enabled: true,
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:00:00.000Z',
    ...overrides,
  };
}

describe('Wayland workflow recipe activity summary', () => {
  it('matches runs by workflow id or workflow name', () => {
    expect(workflowRecipeMatchesRun(recipe, run({ workflowId: 'release-gate', workflowName: 'Old label' }))).toBe(true);
    expect(workflowRecipeMatchesRun(recipe, run({ workflowId: undefined, workflowName: 'Release Gate' }))).toBe(true);
    expect(workflowRecipeMatchesRun(recipe, run({ workflowId: 'triage', workflowName: 'Bug Triage' }))).toBe(false);
  });

  it('matches scheduled jobs by current recipe name', () => {
    expect(workflowRecipeMatchesAutomation(recipe, automation({ name: 'Release Gate' }))).toBe(true);
    expect(workflowRecipeMatchesAutomation(recipe, automation({ name: 'Weekly Triage' }))).toBe(false);
  });

  it('summarizes active runs, latest run, jobs, and attention state', () => {
    const blocked = run({
      id: 'run-blocked',
      status: 'blocked',
      updatedAt: '2026-06-14T02:00:00.000Z',
      asks: [{
        id: 'ask-1',
        stepIndex: 1,
        question: 'Ship?',
        type: 'boolean',
        status: 'pending',
        askedAt: '2026-06-14T02:00:00.000Z',
      }],
    });
    const done = run({
      id: 'run-done',
      status: 'done',
      updatedAt: '2026-06-14T01:30:00.000Z',
    });
    const failedJob = automation({
      id: 'auto-failed',
      runHistory: [{
        id: 'history-1',
        ranAt: '2026-06-14T02:05:00.000Z',
        status: 'failed',
      }],
    });

    const summary = summarizeWorkflowRecipeActivity(recipe, [done, blocked], [failedJob]);

    expect(summary.recentRuns.map(item => item.id)).toEqual(['run-blocked', 'run-done']);
    expect(summary.activeRuns.map(item => item.id)).toEqual(['run-blocked']);
    expect(summary.latestRun?.id).toBe('run-blocked');
    expect(summary.scheduledJobs.map(item => item.id)).toEqual(['auto-failed']);
    expect(summary.needsAttention).toBe(true);
  });
});
