import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun, ProTask } from '../dashboard/src/types.ts';
import { summarizeWorkItemRemoteBoundary } from '../dashboard/src/pages/wayland/workItemRemoteBoundary.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    title: 'Review remote boundary',
    kind: 'todo',
    status: 'backlog',
    createdAt: '2026-06-15T01:00:00.000Z',
    updatedAt: '2026-06-15T01:10:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

function run(status: JiraRemoteUpdateRun['status'], overrides: Partial<JiraRemoteUpdateRun> = {}): JiraRemoteUpdateRun {
  return {
    id: `run-${status}`,
    taskId: 'task-1',
    jiraKey: 'IVAS-123',
    status,
    fields: { status: 'Done' },
    diff: [{ field: 'status', from: 'Open', to: 'Done' }],
    createdAt: '2026-06-15T02:00:00.000Z',
    updatedAt: '2026-06-15T02:05:00.000Z',
    events: [],
    ...overrides,
  };
}

describe('Wayland Work Item remote boundary', () => {
  it('marks non-Jira work as local only', () => {
    expect(summarizeWorkItemRemoteBoundary(task())).toMatchObject({
      state: 'local-only',
      label: 'Local only',
      tone: 'idle',
      remoteKey: '',
    });
  });

  it('asks for sync when a Jira key exists without a remote snapshot', () => {
    expect(summarizeWorkItemRemoteBoundary(task({ kind: 'jira-ticket', jiraKey: 'IVAS-123' }))).toMatchObject({
      state: 'sync-needed',
      label: 'Sync needed',
      tone: 'warn',
      remoteKey: 'IVAS-123',
    });
  });

  it('marks Jira tasks with a snapshot as remote synced', () => {
    expect(summarizeWorkItemRemoteBoundary(task({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-123',
      jiraFields: { status: 'In Progress', assignee: 'Michael', updatedAt: '2026-06-15T00:00:00.000Z' },
    }))).toMatchObject({
      state: 'remote-synced',
      label: 'Remote synced',
      tone: 'ok',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
  });

  it('promotes draft, applying, and failed write-back runs above synced state', () => {
    const jiraTask = task({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-123',
      jiraFields: { status: 'Open', updatedAt: '2026-06-15T00:00:00.000Z' },
    });

    expect(summarizeWorkItemRemoteBoundary(jiraTask, [run('draft')])).toMatchObject({
      state: 'write-back-draft',
      tone: 'warn',
      pendingRunCount: 1,
    });
    expect(summarizeWorkItemRemoteBoundary(jiraTask, [run('applying')])).toMatchObject({
      state: 'applying',
      tone: 'running',
      pendingRunCount: 1,
    });
    expect(summarizeWorkItemRemoteBoundary(jiraTask, [run('failed', { error: 'Permission denied' })])).toMatchObject({
      state: 'failed',
      label: 'Failed',
      detail: 'Permission denied',
      tone: 'err',
      pendingRunCount: 1,
    });
  });

  it('uses the highest-risk pending run when multiple runs exist', () => {
    const summary = summarizeWorkItemRemoteBoundary(
      task({ kind: 'jira-ticket', jiraKey: 'IVAS-123', jiraFields: { raw: { key: 'IVAS-123' } } }),
      [run('draft'), run('applying'), run('failed', { updatedAt: '2026-06-15T01:00:00.000Z' })],
    );

    expect(summary.state).toBe('failed');
    expect(summary.pendingRunCount).toBe(3);
  });
});
