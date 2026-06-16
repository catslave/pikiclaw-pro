import { describe, expect, it } from 'vitest';
import type { WorkflowRunRecord } from '../dashboard/src/types.ts';
import { summarizeWorkflowRunOperationalState } from '../dashboard/src/pages/wayland/workflowRunStatus.ts';

function workflowRun(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: 'run-1',
    workflowId: 'release-gate',
    workflowName: 'Release Gate',
    title: 'Release Gate',
    workdir: '/repo/pikiclaw',
    agent: 'codex',
    sessionKey: 'codex:session-1',
    sessionId: 'session-1',
    currentStep: 2,
    totalSteps: 4,
    status: 'running',
    steps: [
      { index: 1, title: 'Inspect diff', status: 'done' },
      { index: 2, title: 'Run checks', status: 'now' },
      { index: 3, title: 'Check browser UX', status: 'todo' },
      { index: 4, title: 'Summarize result', status: 'todo' },
    ],
    asks: [],
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:08:00.000Z',
    ...overrides,
  };
}

describe('Wayland workflow run operational summary', () => {
  it('estimates elapsed time and remaining work for active runs', () => {
    const summary = summarizeWorkflowRunOperationalState(
      workflowRun(),
      new Date('2026-06-14T01:10:00.000Z'),
    );

    expect(summary).toMatchObject({
      doneSteps: 1,
      remainingSteps: 3,
      elapsedLabel: '10m',
      etaLabel: '~30m left',
      updatedLabel: '2m ago',
      stateLabel: 'Running',
      stateTone: 'primary',
    });
  });

  it('prioritizes pending asks as user attention', () => {
    const summary = summarizeWorkflowRunOperationalState(
      workflowRun({
        asks: [
          {
            id: 'ask-1',
            stepIndex: 2,
            question: 'Which release branch should be validated?',
            type: 'text',
            status: 'pending',
            askedAt: '2026-06-14T01:09:00.000Z',
          },
        ],
      }),
      new Date('2026-06-14T01:10:00.000Z'),
    );

    expect(summary.pendingAskCount).toBe(1);
    expect(summary.etaLabel).toBe('Waiting on input');
    expect(summary.stateLabel).toBe('Needs answer');
    expect(summary.stateTone).toBe('warn');
  });

  it('surfaces autonomous worker failures as review attention', () => {
    const summary = summarizeWorkflowRunOperationalState(
      workflowRun({
        steps: [
          { index: 1, title: 'Inspect diff', status: 'done' },
          {
            index: 2,
            title: 'Run checks',
            status: 'now',
            autonomousRun: {
              dispatchId: 'dispatch-1',
              state: 'failed',
              startedAt: '2026-06-14T01:04:00.000Z',
              completedAt: '2026-06-14T01:08:00.000Z',
            },
          },
          { index: 3, title: 'Check browser UX', status: 'todo' },
          { index: 4, title: 'Summarize result', status: 'todo' },
        ],
      }),
      new Date('2026-06-14T01:10:00.000Z'),
    );

    expect(summary.workerAttentionCount).toBe(1);
    expect(summary.stateLabel).toBe('Needs review');
    expect(summary.stateTone).toBe('warn');
  });

  it('summarizes completed runs as reviewable', () => {
    const summary = summarizeWorkflowRunOperationalState(
      workflowRun({
        status: 'done',
        currentStep: 4,
        completedAt: '2026-06-14T01:30:00.000Z',
        steps: [
          { index: 1, title: 'Inspect diff', status: 'done' },
          { index: 2, title: 'Run checks', status: 'done' },
          { index: 3, title: 'Check browser UX', status: 'done' },
          { index: 4, title: 'Summarize result', status: 'done' },
        ],
      }),
      new Date('2026-06-14T01:45:00.000Z'),
    );

    expect(summary).toMatchObject({
      doneSteps: 4,
      remainingSteps: 0,
      elapsedLabel: '30m',
      etaLabel: 'Complete',
      stateLabel: 'Reviewable',
      stateTone: 'ok',
    });
  });
});
