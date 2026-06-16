import { describe, expect, it } from 'vitest';
import type { WorkflowRunRecord } from '../dashboard/src/types.ts';
import { workflowRunSessionNextAction } from '../dashboard/src/pages/wayland/workflowRunSession.ts';

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
    totalSteps: 3,
    status: 'running',
    steps: [
      { index: 1, title: 'Inspect diff', status: 'done' },
      { index: 2, title: 'Run checks', status: 'now' },
      { index: 3, title: 'Summarize result', status: 'todo' },
    ],
    asks: [],
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:10:00.000Z',
    ...overrides,
  };
}

describe('Wayland workflow run session model', () => {
  it('prioritizes pending asks over step resume actions', () => {
    const action = workflowRunSessionNextAction(workflowRun({
      asks: [
        {
          id: 'ask-2',
          stepIndex: 2,
          question: 'Which release branch should this gate validate before continuing?',
          type: 'text',
          status: 'pending',
          askedAt: '2026-06-14T01:09:00.000Z',
        },
      ],
    }));

    expect(action).toMatchObject({
      kind: 'answer-ask',
      label: 'Answer ask',
      tone: 'warn',
      stepIndex: 2,
      askId: 'ask-2',
    });
    expect(action.detail).toContain('Which release branch');
  });

  it('points blocked runs at the blocked step', () => {
    const action = workflowRunSessionNextAction(workflowRun({
      status: 'blocked',
      steps: [
        { index: 1, title: 'Inspect diff', status: 'done' },
        { index: 2, title: 'Collect missing browser evidence', status: 'blocked' },
      ],
    }));

    expect(action).toMatchObject({
      kind: 'resume-blocked-step',
      label: 'Resume blocked step',
      tone: 'warn',
      stepIndex: 2,
    });
    expect(action.detail).toContain('Collect missing browser evidence');
  });

  it('returns resume-current-step for a linked active run', () => {
    const action = workflowRunSessionNextAction(workflowRun());

    expect(action).toMatchObject({
      kind: 'resume-current-step',
      label: 'Resume current step',
      tone: 'primary',
      stepIndex: 2,
    });
  });

  it('keeps completed runs review-oriented', () => {
    const action = workflowRunSessionNextAction(workflowRun({
      status: 'done',
      currentStep: 3,
      completedAt: '2026-06-14T01:20:00.000Z',
      steps: [
        { index: 1, title: 'Inspect diff', status: 'done' },
        { index: 2, title: 'Run checks', status: 'done' },
        { index: 3, title: 'Summarize result', status: 'done' },
      ],
    }));

    expect(action).toMatchObject({
      kind: 'review-run',
      label: 'Review run',
      tone: 'ok',
    });
    expect(action.detail).toContain('2026-06-14T01:20:00.000Z');
  });
});
