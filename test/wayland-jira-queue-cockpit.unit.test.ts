import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun, ProTask } from '../dashboard/src/types';
import { buildJiraQueueCockpitItems } from '../dashboard/src/pages/wayland/jiraQueueCockpit';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Review Jira queue',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'coding',
    jiraKey: Object.prototype.hasOwnProperty.call(input, 'jiraKey') ? input.jiraKey : 'PIKI-1',
    jiraFields: input.jiraFields,
    createdAt: input.createdAt || '2026-06-16T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-16T01:00:00.000Z',
    stageRuns: input.stageRuns || [],
    verificationRuns: input.verificationRuns || [],
    subTasks: input.subTasks || [],
    events: input.events || [],
  };
}

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    jiraKey: 'PIKI-1',
    fields: { status: 'Done' },
    diff: [{ field: 'status', from: 'In Progress', to: 'Done' }],
    createdAt: '2026-06-16T02:00:00.000Z',
    updatedAt: '2026-06-16T02:10:00.000Z',
    events: [],
    ...input,
  };
}

describe('Wayland Jira queue cockpit', () => {
  it('prioritizes failed, draft, applying, source sync, and missing snapshot states', () => {
    const tasks = [
      task({ id: 'ready', title: 'Ready synced', jiraFields: { status: 'In Progress', updatedAt: '2026-06-16T02:30:00.000Z' } }),
      task({ id: 'stale', title: 'Needs source sync', jiraFields: { status: 'Done', updatedAt: '2026-06-16T01:00:00.000Z' } }),
      task({ id: 'draft', title: 'Draft queued', jiraFields: { status: 'In Progress', updatedAt: '2026-06-16T02:00:00.000Z' } }),
      task({ id: 'failed', title: 'Failed write', jiraFields: { status: 'In Progress', updatedAt: '2026-06-16T02:00:00.000Z' } }),
      task({ id: 'applying', title: 'Applying write', jiraFields: { status: 'In Progress', updatedAt: '2026-06-16T02:00:00.000Z' } }),
      task({ id: 'missing', title: 'Missing snapshot', jiraFields: undefined }),
    ];
    const items = buildJiraQueueCockpitItems({
      tasks,
      runsByTask: {
        failed: [run({ id: 'run-failed', taskId: 'failed', status: 'failed', error: 'Permission denied' })],
        draft: [run({ id: 'run-draft', taskId: 'draft', status: 'draft' })],
        applying: [run({ id: 'run-applying', taskId: 'applying', status: 'applying' })],
        stale: [run({ id: 'run-applied', taskId: 'stale', status: 'applied', completedAt: '2026-06-16T03:00:00.000Z' })],
      },
      limit: 10,
    });

    expect(items.map(item => [item.task.id, item.actionLabel, item.tone])).toEqual([
      ['failed', 'Open failed run', 'err'],
      ['draft', 'Review draft', 'warn'],
      ['applying', 'Wait for apply', 'running'],
      ['stale', 'Sync source', 'warn'],
      ['missing', 'Sync remote', 'warn'],
      ['ready', 'Draft update', 'ok'],
    ]);
    expect(items[0].detail).toBe('Permission denied');
    expect(items.find(item => item.task.id === 'stale')?.chips).toContain('source stale');
  });

  it('omits local-only non-Jira work and inactive monitored history when there is nothing to review', () => {
    const items = buildJiraQueueCockpitItems({
      tasks: [
        task({ id: 'local', kind: 'manual', jiraKey: undefined }),
        task({ id: 'done', jiraFields: { status: 'Done', updatedAt: '2026-06-16T03:00:00.000Z' } }),
      ],
      runsByTask: {
        done: [run({ id: 'run-applied', taskId: 'done', status: 'applied', completedAt: '2026-06-16T02:00:00.000Z' })],
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actionLabel: 'Source confirmed',
      tone: 'ok',
    });
  });
});
