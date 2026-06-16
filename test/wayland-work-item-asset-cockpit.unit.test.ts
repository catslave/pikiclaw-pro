import { describe, expect, it } from 'vitest';
import type { ProTask, ProTaskWorkbench, StageRun, WorkflowRunRecord } from '../dashboard/src/types.ts';
import { buildWorkItemAssetCockpit } from '../dashboard/src/pages/wayland/workItemAssetCockpit.ts';
import type { WorkItemWorkflowArtifact } from '../dashboard/src/pages/wayland/workItemWorkflowArtifacts.ts';

const now = '2026-06-16T00:00:00.000Z';

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-assets',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Continue the task',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-assets',
    title: 'Ship work asset cockpit',
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

function workflowArtifact(id = 'workflow-run'): WorkItemWorkflowArtifact {
  return {
    match: 'task-id',
    reason: 'Mentions task id',
    score: 110,
    run: {
      id,
      workflowId: 'release-gate',
      workflowName: 'Release Gate',
      currentStep: 1,
      totalSteps: 2,
      status: 'running',
      steps: [],
      asks: [],
      createdAt: now,
      updatedAt: now,
    } as WorkflowRunRecord,
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

describe('Wayland Work Item asset cockpit', () => {
  it('groups sessions, workflow runs, outputs, and files into operational lanes', () => {
    const run = stageRun({ id: 'coding', stage: 'coding', status: 'running' });
    const summary = buildWorkItemAssetCockpit({
      task: task({ stageRuns: [run] }),
      workbench: workbench({
        outputs: [{ id: 'out-1', taskId: 'task-assets', kind: 'final', title: 'Final summary', createdAt: now, pinned: true }],
        sideChats: [{ workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'side-1', title: 'Clarify scope' }],
        files: [{ path: '/repo/pikiclaw/src/foo.ts', label: 'foo.ts' }],
      }),
      workflowArtifacts: [workflowArtifact()],
    });

    expect(summary).toMatchObject({
      title: 'Work assets ready',
      totalCount: 6,
      tone: 'running',
    });
    expect(summary.lanes.map(lane => [lane.key, lane.count, lane.tone, lane.targetTab])).toEqual([
      ['work', 2, 'primary', 'workbench'],
      ['runs', 2, 'running', 'runs'],
      ['outputs', 1, 'ok', 'deliverables'],
      ['files', 1, 'ok', 'workbench'],
    ]);
  });

  it('surfaces failed or waiting stage runs as review work', () => {
    const summary = buildWorkItemAssetCockpit({
      task: task({ stageRuns: [stageRun({ id: 'verify', stage: 'verification', status: 'failed' })] }),
    });

    expect(summary.title).toBe('Work assets need review');
    expect(summary.tone).toBe('err');
    expect(summary.lanes.find(lane => lane.key === 'runs')).toMatchObject({ count: 1, tone: 'err' });
  });

  it('keeps a useful loading state while the workbench is restoring', () => {
    const summary = buildWorkItemAssetCockpit({
      task: task(),
      workbenchLoading: true,
    });

    expect(summary.totalCount).toBe(1);
    expect(summary.lanes.find(lane => lane.key === 'work')).toMatchObject({
      count: 1,
      tone: 'running',
      detail: 'Restoring sessions',
    });
  });
});
