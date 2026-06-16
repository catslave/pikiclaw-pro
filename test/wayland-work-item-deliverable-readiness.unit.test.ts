import { describe, expect, it } from 'vitest';
import type { ProTask, ProTaskWorkbench, StageRun } from '../dashboard/src/types.ts';
import { summarizeWorkItemDeliverableReadiness } from '../dashboard/src/pages/wayland/workItemDeliverableReadiness.ts';

const now = '2026-06-16T00:00:00.000Z';

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-ready',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Continue',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-ready',
    title: 'Review deliverables',
    kind: 'manual',
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
  const baseTask = task();
  return {
    task: baseTask,
    activeStageRun: null,
    outputs: [],
    sideChats: [],
    files: [],
    ticketSnapshot: { title: baseTask.title },
    ...input,
  };
}

describe('Wayland Work Item deliverable readiness', () => {
  it('marks saved outputs and files as ready', () => {
    const summary = summarizeWorkItemDeliverableReadiness({
      task: task(),
      workbench: workbench({
        outputs: [{ id: 'out-1', taskId: 'task-ready', kind: 'final', title: 'Summary', createdAt: now }],
        files: [{ path: '/repo/pikiclaw/report.md', label: 'report.md' }],
      }),
    });

    expect(summary).toMatchObject({
      label: 'Deliverables ready',
      tone: 'ok',
      outputCount: 1,
      fileCount: 1,
    });
  });

  it('prioritizes failed or waiting stage runs over existing outputs', () => {
    const summary = summarizeWorkItemDeliverableReadiness({
      task: task({
        stageRuns: [stageRun({ id: 'verify', stage: 'verification', status: 'failed' })],
        outputs: [{ id: 'out-1', taskId: 'task-ready', kind: 'diff', title: 'Diff', createdAt: now }],
      }),
    });

    expect(summary).toMatchObject({
      label: 'Review needed',
      tone: 'err',
      reviewCount: 1,
      outputCount: 1,
    });
  });

  it('shows running work before deliverables exist', () => {
    const summary = summarizeWorkItemDeliverableReadiness({
      task: task({ stageRuns: [stageRun({ id: 'code', stage: 'coding', status: 'running' })] }),
    });

    expect(summary).toMatchObject({
      label: 'In progress',
      tone: 'running',
    });
  });

  it('falls back to an empty state', () => {
    const summary = summarizeWorkItemDeliverableReadiness({ task: task() });

    expect(summary).toMatchObject({
      label: 'No deliverables',
      tone: 'idle',
      outputCount: 0,
      fileCount: 0,
    });
  });
});
