import { describe, expect, it } from 'vitest';
import type { JiraRemoteUpdateRun, ProTask } from '../dashboard/src/types.ts';
import {
  compareWorkItemsByJiraReview,
  groupJiraReviewRunsByTask,
  jiraRemoteUpdateNeedsReview,
  workItemHasJiraReview,
  workItemJiraReviewRuns,
} from '../dashboard/src/pages/wayland/workItemJiraReview.ts';

function task(id: string, jiraKey = `IVAS-${id}`): ProTask {
  return {
    id,
    title: `Task ${id}`,
    kind: 'jira-ticket',
    status: 'backlog',
    jiraKey,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T01:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
  };
}

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    id: input.id,
    taskId: input.taskId,
    jiraKey: input.jiraKey || 'IVAS-1',
    status: input.status,
    fields: input.fields || { status: 'Done' },
    diff: input.diff || [{ field: 'status', from: 'Open', to: 'Done' }],
    createdAt: input.createdAt || '2026-06-14T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-06-14T01:00:00.000Z',
    events: input.events || [],
  };
}

describe('Wayland Work Item Jira review lane', () => {
  it('treats draft, applying, and failed remote updates as review work', () => {
    expect(jiraRemoteUpdateNeedsReview(run({ id: 'draft', taskId: 'a', status: 'draft' }))).toBe(true);
    expect(jiraRemoteUpdateNeedsReview(run({ id: 'applying', taskId: 'a', status: 'applying' }))).toBe(true);
    expect(jiraRemoteUpdateNeedsReview(run({ id: 'failed', taskId: 'a', status: 'failed' }))).toBe(true);
    expect(jiraRemoteUpdateNeedsReview(run({ id: 'applied', taskId: 'a', status: 'applied' }))).toBe(false);
    expect(jiraRemoteUpdateNeedsReview(run({ id: 'cancelled', taskId: 'a', status: 'cancelled' }))).toBe(false);
  });

  it('groups only reviewable runs by task and sorts failed before drafts', () => {
    const grouped = groupJiraReviewRunsByTask([
      run({ id: 'applied', taskId: 'a', status: 'applied', updatedAt: '2026-06-14T05:00:00.000Z' }),
      run({ id: 'draft-new', taskId: 'a', status: 'draft', updatedAt: '2026-06-14T04:00:00.000Z' }),
      run({ id: 'failed-old', taskId: 'a', status: 'failed', updatedAt: '2026-06-14T03:00:00.000Z' }),
    ]);

    expect(grouped.a.map(item => item.id)).toEqual(['failed-old', 'draft-new']);
    expect(workItemHasJiraReview(task('a'), grouped)).toBe(true);
    expect(workItemJiraReviewRuns(task('b'), grouped)).toEqual([]);
  });

  it('treats a linked Jira task without a remote snapshot as boundary review work', () => {
    const jiraWithoutSnapshot = task('sync-needed');
    const synced = task('synced');
    synced.jiraFields = { status: 'In Progress', updatedAt: '2026-06-14T02:00:00.000Z' };

    expect(workItemHasJiraReview(jiraWithoutSnapshot, {})).toBe(true);
    expect(workItemHasJiraReview(synced, {})).toBe(false);
    expect(workItemHasJiraReview({ ...jiraWithoutSnapshot, jiraKey: undefined, kind: 'manual' }, {})).toBe(false);
  });

  it('sorts Work Items by most urgent Jira review run', () => {
    const syncNeeded = task('sync-needed');
    const tasks = [task('draft'), task('failed'), task('applying'), syncNeeded];
    const grouped = groupJiraReviewRunsByTask([
      run({ id: 'r1', taskId: 'draft', status: 'draft', updatedAt: '2026-06-14T05:00:00.000Z' }),
      run({ id: 'r2', taskId: 'failed', status: 'failed', updatedAt: '2026-06-14T02:00:00.000Z' }),
      run({ id: 'r3', taskId: 'applying', status: 'applying', updatedAt: '2026-06-14T06:00:00.000Z' }),
    ]);

    expect([...tasks].sort((a, b) => compareWorkItemsByJiraReview(a, b, grouped)).map(item => item.id))
      .toEqual(['failed', 'draft', 'applying', 'sync-needed']);
  });
});
