import { describe, expect, it } from 'vitest';
import type { WorkflowRunRecord } from '../dashboard/src/types.ts';
import { buildChatHomeWorkflowRunSummaries } from '../dashboard/src/pages/wayland/workflowRunChatHome.ts';

function run(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: overrides.id || 'run-1',
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

describe('Wayland Chat Home workflow run summaries', () => {
  it('prioritizes active runs that need user attention', () => {
    const summaries = buildChatHomeWorkflowRunSummaries({
      now: new Date('2026-06-14T01:20:00.000Z'),
      runs: [
        run({ id: 'normal', updatedAt: '2026-06-14T01:19:00.000Z' }),
        run({
          id: 'ask',
          updatedAt: '2026-06-14T01:12:00.000Z',
          asks: [{
            id: 'ask-1',
            stepIndex: 2,
            question: 'Which release branch should be validated?',
            type: 'text',
            status: 'pending',
            askedAt: '2026-06-14T01:11:00.000Z',
          }],
        }),
      ],
    });

    expect(summaries.map(item => [item.run.id, item.nextAction.kind, item.operational.stateLabel])).toEqual([
      ['ask', 'answer-ask', 'Needs answer'],
      ['normal', 'resume-current-step', 'Running'],
    ]);
  });

  it('filters done runs and respects project scope', () => {
    const summaries = buildChatHomeWorkflowRunSummaries({
      projectPath: '/repo/pikiclaw',
      runs: [
        run({ id: 'active', workdir: '/repo/pikiclaw' }),
        run({ id: 'other', workdir: '/repo/other' }),
        run({ id: 'done', status: 'done', workdir: '/repo/pikiclaw' }),
      ],
    });

    expect(summaries.map(item => item.run.id)).toEqual(['active']);
    expect(summaries[0]).toMatchObject({
      progressLabel: '1/3 steps',
      projectLabel: 'pikiclaw',
    });
  });
});
