import { describe, expect, it } from 'vitest';
import type { WorkflowRunRecord } from '../dashboard/src/types.ts';
import { buildWorkflowRunCommandItems } from '../dashboard/src/pages/wayland/workflowRunCommand.ts';

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

describe('Wayland workflow run command items', () => {
  it('turns active workflow runs into attention-first command items', () => {
    const items = buildWorkflowRunCommandItems({
      now: new Date('2026-06-14T01:20:00.000Z'),
      runs: [
        run({ id: 'normal', updatedAt: '2026-06-14T01:19:00.000Z' }),
        run({
          id: 'ask',
          updatedAt: '2026-06-14T01:12:00.000Z',
          asks: [{
            id: 'ask-1',
            stepIndex: 2,
            question: 'Which release branch should be validated before merging?',
            type: 'text',
            status: 'pending',
            askedAt: '2026-06-14T01:11:00.000Z',
          }],
        }),
        run({ id: 'done', status: 'done', updatedAt: '2026-06-14T01:20:00.000Z' }),
      ],
    });

    expect(items.map(item => item.key)).toEqual(['active-workflow:ask', 'active-workflow:normal']);
    expect(items[0]).toMatchObject({
      title: 'Workflow ask: Release Gate',
      to: '/workflows?run=ask',
      tone: 'warn',
      keys: ['Needs answer', 'Answer'],
    });
    expect(items[0].detail).toContain('Answer ask');
    expect(items[0].detail).toContain('1/3 steps');
    expect(items[0].keywords).toContain('workflow ask');
  });

  it('labels blocked runs as review work', () => {
    const items = buildWorkflowRunCommandItems({
      runs: [
        run({
          id: 'blocked',
          status: 'blocked',
          steps: [
            { index: 1, title: 'Inspect diff', status: 'done' },
            { index: 2, title: 'Resolve failed check', status: 'blocked' },
            { index: 3, title: 'Summarize result', status: 'todo' },
          ],
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      title: 'Workflow review: Release Gate',
      tone: 'warn',
      keys: ['Needs review', 'Review'],
    });
    expect(items[0].detail).toContain('Resolve failed check');
  });
});
