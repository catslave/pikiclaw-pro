import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import { compareWorkItemsBySourceRefresh, summarizeWorkItemSourceHealth } from '../dashboard/src/pages/wayland/workItemSourceHealth.ts';

function workItem(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    localKey: 'W-1',
    title: 'Review source health',
    kind: 'manual',
    status: 'backlog',
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:10:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

describe('Wayland Work Item source health', () => {
  it('asks Jira work items to sync when no remote snapshot exists', () => {
    const summary = summarizeWorkItemSourceHealth(
      workItem({ kind: 'jira-ticket', jiraKey: 'IVAS-1234' }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      label: 'Sync Jira',
      tone: 'warn',
      stale: false,
      refreshRank: 0,
    });
  });

  it('marks old Jira snapshots as stale', () => {
    const summary = summarizeWorkItemSourceHealth(
      workItem({
        kind: 'jira-bug',
        jiraKey: 'IVAS-1234',
        jiraFields: {
          status: 'In Progress',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      label: 'Jira stale',
      tone: 'warn',
      stale: true,
      refreshRank: 1,
    });
  });

  it('summarizes fresh Jira metadata and saved MR links as linked', () => {
    const summary = summarizeWorkItemSourceHealth(
      workItem({
        kind: 'jira-ticket',
        jiraKey: 'IVAS-1234',
        prUrl: 'https://gitlab.example/group/repo/-/merge_requests/12',
        jiraFields: {
          status: 'In Review',
          assignee: 'Michael',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary.label).toBe('Jira linked');
    expect(summary.tone).toBe('ok');
    expect(summary.detail).toContain('In Review');
    expect(summary.evidenceCount).toBeGreaterThanOrEqual(2);
  });

  it('recognizes rich inbox todo evidence', () => {
    const summary = summarizeWorkItemSourceHealth(
      workItem({
        kind: 'todo',
        description: [
          'Inbox note: Debug this screenshot',
          'Quoted source: user saw the broken button',
          'Images:',
          '- broken-button.png (image/png)',
          'Source session: codex:s1',
        ].join('\n'),
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      label: 'Inbox rich',
      tone: 'ok',
      stale: false,
      refreshRank: 99,
    });
    expect(summary.evidenceCount).toBeGreaterThanOrEqual(4);
  });

  it('distinguishes manual notes with and without evidence', () => {
    expect(summarizeWorkItemSourceHealth(workItem()).label).toBe('Manual');
    expect(summarizeWorkItemSourceHealth(workItem({
      description: 'From note: note-123\n\nCaptured requirement.',
    })).label).toBe('Evidence ready');
  });

  it('sorts source-refresh work by repair urgency', () => {
    const missingSnapshot = workItem({
      id: 'missing',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-100',
      updatedAt: '2026-06-14T01:00:00.000Z',
    });
    const staleOldest = workItem({
      id: 'stale-oldest',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-101',
      jiraFields: { status: 'Open', updatedAt: '2026-05-20T00:00:00.000Z' },
      updatedAt: '2026-06-14T03:00:00.000Z',
    });
    const staleNewer = workItem({
      id: 'stale-newer',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-102',
      jiraFields: { status: 'Open', updatedAt: '2026-06-01T00:00:00.000Z' },
      updatedAt: '2026-06-14T04:00:00.000Z',
    });
    const thinTodo = workItem({
      id: 'thin-todo',
      kind: 'todo',
      updatedAt: '2026-06-14T05:00:00.000Z',
    });

    const sorted = [thinTodo, staleNewer, staleOldest, missingSnapshot]
      .sort((a, b) => compareWorkItemsBySourceRefresh(a, b, new Date('2026-06-14T12:00:00.000Z')));

    expect(sorted.map(item => item.id)).toEqual(['missing', 'stale-oldest', 'stale-newer', 'thin-todo']);
  });
});
