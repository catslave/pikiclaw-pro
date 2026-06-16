import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun, ProTask } from '../dashboard/src/types';
import { summarizeWorkItemJiraSourceSync } from '../dashboard/src/pages/wayland/workItemJiraSourceSync';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Jira task',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'backlog',
    jiraKey: input.jiraKey || 'PIKI-1',
    jiraFields: input.jiraFields,
    createdAt: input.createdAt || '2026-06-16T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T01:00:00.000Z',
    stageRuns: input.stageRuns || [],
    verificationRuns: input.verificationRuns || [],
    subTasks: input.subTasks || [],
    events: input.events || [],
  };
}

function run(input: Partial<JiraRemoteUpdateRun> = {}): JiraRemoteUpdateRun {
  return {
    id: input.id || 'run-1',
    taskId: input.taskId || 'task-1',
    jiraKey: input.jiraKey || 'PIKI-1',
    status: input.status || 'applied',
    fields: input.fields || { status: 'Done' },
    diff: input.diff || [{ field: 'status', from: 'Open', to: 'Done' }],
    createdAt: input.createdAt || '2026-06-16T01:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T02:00:00.000Z',
    completedAt: input.completedAt,
    events: input.events || [],
  };
}

describe('Wayland Work Item Jira source sync guidance', () => {
  it('stays idle when no write-back has been applied', () => {
    const summary = summarizeWorkItemJiraSourceSync(task(), [
      run({ status: 'draft' }),
    ]);

    expect(summary).toMatchObject({
      hasAppliedHistory: false,
      needsSync: false,
      tone: 'idle',
    });
  });

  it('asks for source sync when applied write-back is newer than the Jira snapshot', () => {
    const summary = summarizeWorkItemJiraSourceSync(
      task({ jiraFields: { updatedAt: '2026-06-16T01:30:00.000Z', raw: {} } }),
      [run({ status: 'applied', completedAt: '2026-06-16T02:00:00.000Z' })],
    );

    expect(summary).toMatchObject({
      hasAppliedHistory: true,
      needsSync: true,
      label: 'Confirm source sync',
      tone: 'warn',
    });
  });

  it('confirms the source when the Jira snapshot is newer than the applied run', () => {
    const summary = summarizeWorkItemJiraSourceSync(
      task({ jiraFields: { updatedAt: '2026-06-16T02:30:00.000Z', raw: {} } }),
      [run({ status: 'applied', completedAt: '2026-06-16T02:00:00.000Z' })],
    );

    expect(summary).toMatchObject({
      hasAppliedHistory: true,
      needsSync: false,
      label: 'Source confirmed',
      tone: 'ok',
    });
  });
});
