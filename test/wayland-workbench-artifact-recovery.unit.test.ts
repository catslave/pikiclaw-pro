import { describe, expect, it } from 'vitest';
import type { ProOutput, ProTask, ProTaskWorkbench, StageRun } from '../dashboard/src/types';
import { buildWorkbenchArtifactRecoveryItems } from '../dashboard/src/pages/wayland/workbenchArtifactRecovery';

const now = '2026-06-16T08:00:00.000Z';

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: input.taskId || 'task-1',
    session: {
      workdir: '/Users/michael.yang/Codes/Personal/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Run the stage',
    ...input,
  };
}

function output(input: Partial<ProOutput> = {}): ProOutput {
  return {
    id: input.id || 'out-1',
    kind: input.kind || 'final',
    title: input.title || 'Final summary',
    taskId: input.taskId || 'task-1',
    createdAt: input.createdAt || now,
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    localKey: input.localKey || 'MY-0001',
    title: input.title || 'Ship the workbench lane',
    kind: input.kind || 'manual',
    status: input.status || 'coding',
    createdAt: input.createdAt || '2026-06-16T07:00:00.000Z',
    updatedAt: input.updatedAt || now,
    stageRuns: input.stageRuns || [],
    outputs: input.outputs || [],
    verificationRuns: input.verificationRuns || [],
    subTasks: input.subTasks || [],
    events: input.events || [],
    ...input,
  };
}

function workbench(baseTask: ProTask, input: Partial<ProTaskWorkbench> = {}): ProTaskWorkbench {
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

describe('Wayland workbench artifact recovery', () => {
  it('surfaces active sessions, stage outputs, changed files, and direct deliverables', () => {
    const run = stageRun({
      id: 'run-1',
      stage: 'coding',
      status: 'running',
      startedAt: '2026-06-16T10:00:00.000Z',
      output: {
        summary: 'Implemented the mission control workbench artifact lane.',
        changedFiles: ['dashboard/src/pages/wayland/WaylandShell.tsx', 'dashboard/src/pages/wayland/workbenchArtifactRecovery.ts'],
      },
    });
    const items = buildWorkbenchArtifactRecoveryItems({
      tasks: [task({
        stageRuns: [run],
        outputs: [output({ id: 'out-final', kind: 'final', summary: 'Ready for review.' })],
      })],
      limit: 10,
    });

    expect(items.map(item => item.kind)).toEqual([
      'active-session',
      'stage-output',
      'changed-files',
      'output-ready',
    ]);
    expect(items[0]).toMatchObject({
      label: 'Active session',
      tone: 'running',
      target: 'workbench',
      stageRunId: 'run-1',
    });
    expect(items.find(item => item.kind === 'changed-files')).toMatchObject({
      label: 'Changed files',
      changedFiles: ['dashboard/src/pages/wayland/WaylandShell.tsx', 'dashboard/src/pages/wayland/workbenchArtifactRecovery.ts'],
    });
    expect(items.find(item => item.kind === 'output-ready')).toMatchObject({
      label: 'Final output',
      target: 'deliverables',
      outputId: 'out-final',
    });
  });

  it('ranks waiting-user and failed work before completed outputs', () => {
    const items = buildWorkbenchArtifactRecoveryItems({
      tasks: [
        task({
          id: 'task-ok',
          title: 'Completed docs',
          outputs: [output({ id: 'out-doc', taskId: 'task-ok', kind: 'document', createdAt: '2026-06-16T12:00:00.000Z' })],
        }),
        task({
          id: 'task-waiting',
          title: 'Needs user answer',
          stageRuns: [stageRun({ id: 'run-waiting', taskId: 'task-waiting', stage: 'refinement', status: 'waiting-user', startedAt: '2026-06-16T09:00:00.000Z' })],
        }),
      ],
      limit: 10,
    });

    expect(items[0]).toMatchObject({
      taskId: 'task-waiting',
      label: 'Waiting input',
      tone: 'warn',
    });
    expect(items[1]).toMatchObject({
      taskId: 'task-ok',
      label: 'Document',
      tone: 'ok',
    });
  });

  it('surfaces hydrated workbench side chats as resumable artifact branches', () => {
    const baseTask = task({
      id: 'task-side-chat',
      title: 'Recover Workbench side chat',
      stageRuns: [
        stageRun({
          id: 'run-parent',
          taskId: 'task-side-chat',
          stage: 'coding',
          status: 'completed',
          completedAt: '2026-06-16T10:30:00.000Z',
        }),
      ],
    });

    const items = buildWorkbenchArtifactRecoveryItems({
      tasks: [baseTask],
      workbenches: {
        [baseTask.id]: workbench(baseTask, {
          sideChats: [
            {
              workdir: '/Users/michael.yang/Codes/Personal/pikiclaw',
              agent: 'codex',
              sessionId: 'side-clarify-scope',
              title: 'Clarify source boundary',
              parentStageRunId: 'run-parent',
            },
          ],
        }),
      },
      limit: 10,
    });

    expect(items[0]).toMatchObject({
      kind: 'side-chat',
      label: 'Side chat',
      detail: 'Clarify source boundary',
      tone: 'running',
      target: 'workbench',
      taskId: 'task-side-chat',
      stageRunId: 'run-parent',
      sessionId: 'side-clarify-scope',
    });
  });

  it('does not duplicate a final deliverable as a stage output for the same run', () => {
    const items = buildWorkbenchArtifactRecoveryItems({
      tasks: [task({
        stageRuns: [
          stageRun({
            id: 'run-final',
            stage: 'coding',
            status: 'completed',
            completedAt: '2026-06-16T10:00:00.000Z',
            output: {
              summary: 'Implemented the final workbench recovery lane.',
            },
          }),
        ],
        outputs: [
          output({
            id: 'out-final',
            kind: 'final',
            stageRunId: 'run-final',
            summary: 'Ready for review.',
            createdAt: '2026-06-16T10:05:00.000Z',
          }),
        ],
      })],
      limit: 10,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'output-ready',
      label: 'Final output',
      target: 'deliverables',
      outputId: 'out-final',
      stageRunId: 'run-final',
    });
  });
});
