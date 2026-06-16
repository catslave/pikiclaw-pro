import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import { buildWorkObjectCockpitSummary } from '../dashboard/src/pages/wayland/workObjectCockpit.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: overrides.id || 'task-1',
    localKey: overrides.localKey || 'PCL-1',
    title: overrides.title || 'Review native work object',
    kind: overrides.kind || 'manual',
    status: overrides.status || 'backlog',
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T01:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

describe('Wayland Work Object cockpit summary', () => {
  it('prioritizes Jira write-back review above other work', () => {
    const summary = buildWorkObjectCockpitSummary({
      tasks: [
        task({ id: 'jira', kind: 'jira-ticket', jiraKey: 'IVAS-321', jiraFields: { status: 'Open', updatedAt: '2026-06-16T01:00:00.000Z' } }),
        task({ id: 'todo', kind: 'todo' }),
      ],
      inboxIntakeCount: 2,
      jiraReviewCount: 1,
    });

    expect(summary).toMatchObject({
      title: 'Review Jira writes',
      tone: 'warn',
    });
    expect(summary.lanes.map(lane => [lane.key, lane.count, lane.tone])).toEqual([
      ['inbox', 3, 'ok'],
      ['ticket', 1, 'warn'],
      ['manual', 0, 'idle'],
      ['automation', 0, 'idle'],
    ]);
  });

  it('surfaces source repair when active tasks have thin evidence', () => {
    const summary = buildWorkObjectCockpitSummary({
      tasks: [
        task({ id: 'todo-thin', kind: 'todo' }),
      ],
    });

    expect(summary.title).toBe('Repair source first');
    expect(summary.tone).toBe('warn');
    expect(summary.chips[0]).toBe('1 source refresh');
  });

  it('treats todo, notes, and daily items as one intake mix', () => {
    const summary = buildWorkObjectCockpitSummary({
      tasks: [],
      inboxIntakeCount: 4,
      dailyIntakeCount: 2,
      noteIntakeCount: 3,
    });

    expect(summary).toMatchObject({
      title: 'Promote intake',
      tone: 'ok',
    });
    expect(summary.lanes.map(lane => [lane.key, lane.count])).toEqual([
      ['inbox', 4],
      ['ticket', 0],
      ['manual', 5],
      ['automation', 0],
    ]);
  });
});
