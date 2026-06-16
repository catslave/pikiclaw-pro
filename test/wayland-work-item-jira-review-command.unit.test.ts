import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun, ProTask } from '../dashboard/src/types';
import { buildWorkItemJiraReviewCommandItems } from '../dashboard/src/pages/wayland/workItemJiraReviewCommand';

const now = '2026-06-16T00:00:00.000Z';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Review remote state',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'coding',
    jiraKey: input.jiraKey || 'PK-1',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    jiraKey: 'PK-1',
    fields: {},
    diff: [],
    createdAt: now,
    updatedAt: now,
    events: [],
    ...input,
  };
}

describe('Wayland Work Item Jira review command items', () => {
  it('builds a failed write-back command with a jiraRun deep link', () => {
    const items = buildWorkItemJiraReviewCommandItems([
      task({
        id: 'task-failed',
        title: 'Fix failed write-back',
        jiraKey: 'PK-42',
        jiraUrl: 'https://jira.example/browse/PK-42',
      }),
    ], {
      'task-failed': [run({
        id: 'run-failed',
        taskId: 'task-failed',
        status: 'failed',
        error: 'Jira rejected transition',
        diff: [{ field: 'status', from: 'In Progress', to: 'Done' }],
      })],
    });

    expect(items[0]).toMatchObject({
      key: 'jira-review:run-failed',
      title: 'Jira write-back failed: Fix failed write-back',
      to: '/work-items?task=task-failed&tab=source&jiraRun=run-failed',
      secondaryTo: 'https://jira.example/browse/PK-42',
      secondaryLabel: 'Open Jira',
      priority: 48,
      lanes: [
        { label: 'Source', value: 'Jira', tone: 'source' },
        { label: 'Execution', value: 'Failed', tone: 'attention' },
      ],
      tone: 'warn',
      keys: ['Failed', 'Retry'],
    });
    expect(items[0].detail).toContain('PK-42');
    expect(items[0].detail).toContain('1 field');
    expect(items[0].keywords.join(' ')).toContain('Jira rejected transition');
  });

  it('prioritizes failed runs before drafts and applying states', () => {
    const items = buildWorkItemJiraReviewCommandItems([
      task({ id: 'task-draft', title: 'Draft update', jiraKey: 'PK-2' }),
      task({ id: 'task-applying', title: 'Applying update', jiraKey: 'PK-3' }),
      task({ id: 'task-failed', title: 'Failed update', jiraKey: 'PK-4' }),
    ], {
      'task-draft': [run({ id: 'run-draft', taskId: 'task-draft', status: 'draft' })],
      'task-applying': [run({ id: 'run-applying', taskId: 'task-applying', status: 'applying' })],
      'task-failed': [run({ id: 'run-failed', taskId: 'task-failed', status: 'failed' })],
    });

    expect(items.map(item => item.key)).toEqual([
      'jira-review:run-failed',
      'jira-review:run-draft',
      'jira-review:run-applying',
    ]);
  });

  it('includes linked Jira tasks that need an initial remote sync', () => {
    const items = buildWorkItemJiraReviewCommandItems([
      task({ id: 'task-sync', title: 'Sync missing snapshot', jiraKey: 'PK-9', jiraFields: undefined }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'jira-review:task-sync',
      title: 'Sync Jira source: Sync missing snapshot',
      to: '/work-items?task=task-sync&tab=source&source=ticket',
      tone: 'warn',
      keys: ['Sync', 'Jira'],
    });
  });

  it('omits the secondary Jira action when no external URL is known', () => {
    const items = buildWorkItemJiraReviewCommandItems([
      task({ id: 'task-no-url', title: 'Review local Jira task', jiraKey: 'PK-12' }),
    ], {
      'task-no-url': [run({ id: 'run-no-url', taskId: 'task-no-url', status: 'failed' })],
    });

    expect(items[0].secondaryTo).toBeUndefined();
    expect(items[0].secondaryLabel).toBeUndefined();
  });

  it('omits local and already-synced work items', () => {
    const items = buildWorkItemJiraReviewCommandItems([
      task({ id: 'local', jiraKey: undefined, kind: 'manual' }),
      task({ id: 'synced', jiraKey: 'PK-10', jiraFields: { status: 'Done', raw: { key: 'PK-10' } } }),
    ]);

    expect(items).toEqual([]);
  });
});
