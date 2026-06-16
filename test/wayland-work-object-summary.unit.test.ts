import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import {
  buildWorkObjectSummary,
  buildWorkObjectSummaryForTask,
  compareWorkObjectsByAttention,
} from '../dashboard/src/pages/wayland/workObjectSummary.ts';
import { summarizeWorkItemOperationalState } from '../dashboard/src/pages/wayland/workItemOperationalState.ts';
import { summarizeWorkItemRemoteBoundary } from '../dashboard/src/pages/wayland/workItemRemoteBoundary.ts';
import { summarizeWorkItemSourceHealth } from '../dashboard/src/pages/wayland/workItemSourceHealth.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    localKey: 'PCL-1',
    title: 'Review native work object',
    kind: 'manual',
    status: 'backlog',
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

function summary(input: Partial<ProTask> = {}, runs: Parameters<typeof summarizeWorkItemRemoteBoundary>[1] = []) {
  const item = task(input);
  return buildWorkObjectSummary({
    task: item,
    operational: summarizeWorkItemOperationalState(item, Date.parse('2026-06-15T02:00:00.000Z')),
    remoteBoundary: summarizeWorkItemRemoteBoundary(item, runs),
    sourceHealth: summarizeWorkItemSourceHealth(item, Date.parse('2026-06-15T02:00:00.000Z')),
    reviewCount: runs?.filter(run => run.status === 'draft' || run.status === 'failed' || run.status === 'applying').length || 0,
  });
}

describe('Wayland native Work Object summary', () => {
  it('labels Jira work by remote boundary instead of treating it as a generic task', () => {
    expect(summary({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-123',
      jiraFields: { status: 'In Progress', assignee: 'Michael', updatedAt: '2026-06-15T01:30:00.000Z' },
    })).toMatchObject({
      kind: 'jira-remote',
      identityLabel: 'Jira IVAS-123',
      boundaryLabel: 'IVAS-123',
      evidenceLabel: '1 evidence',
      attentionRank: 99,
    });
  });

  it('promotes Jira write-back drafts above ordinary source work', () => {
    const item = summary({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-124',
      jiraFields: { status: 'Open', updatedAt: '2026-06-15T01:30:00.000Z' },
    }, [{
      id: 'run-1',
      taskId: 'task-1',
      jiraKey: 'IVAS-124',
      status: 'draft',
      fields: { summary: 'New summary' },
      diff: [{ field: 'summary', before: 'Old', after: 'New' }],
      createdAt: '2026-06-15T01:40:00.000Z',
      updatedAt: '2026-06-15T01:40:00.000Z',
      events: [],
    }]);

    expect(item.attentionRank).toBe(1);
    expect(item.chips.map(chip => chip.key)).toEqual(['review', 'boundary', 'evidence']);
  });

  it('treats Todo items as inbox captures and highlights thin source evidence', () => {
    expect(summary({ kind: 'todo' })).toMatchObject({
      kind: 'inbox-capture',
      identityLabel: 'Inbox PCL-1',
      evidenceLabel: '0 evidence',
      evidenceTone: 'warn',
      attentionRank: 3,
    });
  });

  it('keeps manual work local unless a remote boundary is linked', () => {
    expect(summary({ kind: 'manual', localKey: 'PCL-44' })).toMatchObject({
      kind: 'local-work',
      identityLabel: 'Local PCL-44',
      boundaryLabel: 'Local only',
      attentionRank: 99,
    });
  });

  it('builds the same summary directly from a task and Jira run map', () => {
    const item = task({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-125',
      jiraFields: { status: 'Open', updatedAt: '2026-06-15T01:30:00.000Z' },
    });

    expect(buildWorkObjectSummaryForTask(item, {
      [item.id]: [{
        id: 'run-1',
        taskId: item.id,
        jiraKey: 'IVAS-125',
        status: 'failed',
        fields: {},
        diff: [],
        error: 'Permission denied',
        createdAt: '2026-06-15T01:40:00.000Z',
        updatedAt: '2026-06-15T01:40:00.000Z',
        events: [],
      }],
    })).toMatchObject({
      kind: 'jira-remote',
      attentionRank: 0,
      boundaryTone: 'err',
    });
  });

  it('sorts Work Objects by real attention rank before recency', () => {
    const normal = task({ id: 'normal', updatedAt: '2026-06-15T01:59:00.000Z' });
    const todoThin = task({ id: 'todo-thin', kind: 'todo', updatedAt: '2026-06-15T01:58:00.000Z' });
    const writeback = task({
      id: 'writeback',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-126',
      jiraFields: { status: 'Open', updatedAt: '2026-06-15T01:00:00.000Z' },
      updatedAt: '2026-06-15T01:00:00.000Z',
    });
    const runs = {
      writeback: [{
        id: 'run-1',
        taskId: 'writeback',
        jiraKey: 'IVAS-126',
        status: 'draft' as const,
        fields: { summary: 'New' },
        diff: [{ field: 'summary', before: 'Old', after: 'New' }],
        createdAt: '2026-06-15T01:40:00.000Z',
        updatedAt: '2026-06-15T01:40:00.000Z',
        events: [],
      }],
    };

    expect([normal, todoThin, writeback].sort((a, b) => compareWorkObjectsByAttention(a, b, runs)).map(item => item.id))
      .toEqual(['writeback', 'todo-thin', 'normal']);
  });
});
