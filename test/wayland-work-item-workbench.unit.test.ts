import { describe, expect, it } from 'vitest';
import type { ProTask, ProTaskWorkbench, StageRun } from '../dashboard/src/types';
import {
  summarizeWorkItemWorkbench,
  workItemWorkbenchSessionCount,
} from '../dashboard/src/pages/wayland/workItemWorkbench';

const now = '2026-06-14T00:00:00.000Z';

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-1',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Do the work',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    title: 'Ship workbench',
    kind: 'jira-ticket',
    status: 'coding',
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

function workbench(input: Partial<ProTaskWorkbench> = {}): ProTaskWorkbench {
  const activeStageRun = input.activeStageRun ?? stageRun({ id: 'run-1', stage: 'coding', status: 'running' });
  const baseTask = task({ stageRuns: [activeStageRun] });
  return {
    task: baseTask,
    activeStageRun,
    outputs: [],
    sideChats: [],
    files: [],
    ticketSnapshot: {
      title: baseTask.title,
      status: 'In Progress',
      assignee: 'Michael',
    },
    ...input,
  };
}

describe('work item workbench summary', () => {
  it('summarizes the active stage, ticket, and linked artifacts', () => {
    const summary = summarizeWorkItemWorkbench(workbench({
      outputs: [
        { id: 'out-1', kind: 'diff', title: 'Diff', taskId: 'task-1', createdAt: now },
      ],
      sideChats: [
        { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'side-1', title: 'Clarify scope' },
      ],
      files: [
        { path: '/repo/pikiclaw/src/foo.ts', label: 'foo.ts' },
        { path: '/repo/pikiclaw/src/bar.ts', label: 'bar.ts' },
      ],
    }));

    expect(summary.activeStageLabel).toBe('coding · running');
    expect(summary.activeStageTone).toBe('running');
    expect(summary.ticketStatus).toBe('In Progress');
    expect(summary.ticketOwner).toBe('Michael');
    expect(summary.chips).toEqual(['2 sessions', '1 side chats', '2 files', '1 outputs']);
  });

  it('deduplicates the active stage session when a side chat points at the same session', () => {
    const active = stageRun({ id: 'run-1', stage: 'refinement', status: 'completed' });
    const wb = workbench({
      activeStageRun: active,
      task: task({ stageRuns: [active] }),
      sideChats: [{ ...active.session, title: 'Same session' }],
    });

    expect(workItemWorkbenchSessionCount(wb)).toBe(1);
    expect(summarizeWorkItemWorkbench(wb).activeStageTone).toBe('ok');
  });

  it('falls back cleanly when there is no active stage or Jira owner', () => {
    const summary = summarizeWorkItemWorkbench(workbench({
      activeStageRun: null,
      task: task({ status: 'backlog', stageRuns: [] }),
      ticketSnapshot: { title: 'Local task' },
    }));

    expect(summary.activeStageLabel).toBe('No active stage');
    expect(summary.activeStageTone).toBe('idle');
    expect(summary.ticketStatus).toBe('backlog');
    expect(summary.ticketOwner).toBe('Unassigned');
  });
});
