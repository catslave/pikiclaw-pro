import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types';
import { buildTodoSourceRepairDraft, workItemNeedsTodoSourceRepair } from '../dashboard/src/pages/wayland/workItemTodoRepair';
import type { WorkItemSourceHealthSummary } from '../dashboard/src/pages/wayland/workItemSourceHealth';

function task(patch: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task_todo_1',
    localKey: 'PCL-12',
    title: 'Confirm Todo source context',
    description: '',
    kind: 'todo',
    status: 'backlog',
    stage: 'triage',
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...patch,
  } as ProTask;
}

function health(patch: Partial<WorkItemSourceHealthSummary> = {}): WorkItemSourceHealthSummary {
  return {
    label: 'Source thin',
    detail: 'No todo evidence was preserved.',
    tone: 'warn',
    evidenceCount: 0,
    stale: false,
    refreshRank: 2,
    ...patch,
  };
}

describe('Wayland work item Todo repair', () => {
  it('only offers repair for source-thin Todo work items', () => {
    expect(workItemNeedsTodoSourceRepair(task(), health())).toBe(true);
    expect(workItemNeedsTodoSourceRepair(task({ kind: 'manual' }), health())).toBe(false);
    expect(workItemNeedsTodoSourceRepair(task(), health({ refreshRank: 99, label: 'Inbox captured' }))).toBe(false);
  });

  it('builds a focused evidence capture draft linked back to the original work item', () => {
    expect(buildTodoSourceRepairDraft(task({ workdir: '/repo/pikiclaw' }), '/fallback')).toEqual({
      source: 'todo',
      title: 'Evidence for PCL-12',
      description: [
        'Repair source evidence for: Confirm Todo source context',
        'Original Work Item: PCL-12',
        '',
        'Paste the missing chat quote, note, file path, screenshot context, or reproduction details here.',
      ].join('\n'),
      status: 'backlog',
      workdir: '/repo/pikiclaw',
      repairTargetTaskId: 'task_todo_1',
    });
  });
});
