import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun } from '../dashboard/src/types';
import { summarizeWorkItemJiraHistory } from '../dashboard/src/pages/wayland/workItemJiraHistory';

const now = '2026-06-16T00:00:00.000Z';

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    jiraKey: 'PK-1',
    fields: {},
    diff: [{ field: 'status', from: 'Open', to: 'Done' }],
    createdAt: now,
    updatedAt: now,
    events: [],
    ...input,
  };
}

describe('Wayland Work Item Jira write-back history', () => {
  it('summarizes an empty history as a draft-first next step', () => {
    const summary = summarizeWorkItemJiraHistory([]);

    expect(summary).toMatchObject({
      latestRun: null,
      latestLabel: 'No history',
      tone: 'idle',
      nextAction: 'Draft a reviewed update before touching remote Jira.',
    });
  });

  it('prioritizes failed runs even when a newer apply succeeded', () => {
    const summary = summarizeWorkItemJiraHistory([
      run({
        id: 'applied-new',
        taskId: 'task-1',
        status: 'applied',
        updatedAt: '2026-06-16T03:00:00.000Z',
      }),
      run({
        id: 'failed-old',
        taskId: 'task-1',
        status: 'failed',
        error: 'Jira rejected transition',
        updatedAt: '2026-06-16T02:00:00.000Z',
      }),
    ]);

    expect(summary.latestRun?.id).toBe('applied-new');
    expect(summary.latestLabel).toBe('Failure needs review');
    expect(summary.latestDetail).toContain('Jira rejected transition');
    expect(summary.tone).toBe('err');
    expect(summary.failedCount).toBe(1);
    expect(summary.appliedCount).toBe(1);
  });

  it('shows last applied when no active review or failure remains', () => {
    const summary = summarizeWorkItemJiraHistory([
      run({
        id: 'applied',
        taskId: 'task-1',
        status: 'applied',
        diff: [
          { field: 'status', from: 'In Progress', to: 'Done' },
          { field: 'fixVersions', from: [], to: ['2026.06'] },
        ],
      }),
    ]);

    expect(summary.latestLabel).toBe('Last applied');
    expect(summary.latestDetail).toContain('2 fields');
    expect(summary.tone).toBe('ok');
    expect(summary.nextAction).toContain('source sync');
  });

  it('treats draft and applying states as active write-back work', () => {
    const draft = summarizeWorkItemJiraHistory([
      run({ id: 'draft', taskId: 'task-1', status: 'draft' }),
    ]);
    const applying = summarizeWorkItemJiraHistory([
      run({ id: 'applying', taskId: 'task-1', status: 'applying' }),
    ]);

    expect(draft).toMatchObject({ latestLabel: 'Draft ready', tone: 'warn', draftCount: 1 });
    expect(applying).toMatchObject({ latestLabel: 'Applying', tone: 'running', applyingCount: 1 });
  });
});
