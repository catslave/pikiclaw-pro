import { describe, expect, it } from 'vitest';
import type { ProTask, StageRun } from '../dashboard/src/types';
import {
  buildWorkItemStageActions,
  recommendedWorkItemStage,
} from '../dashboard/src/pages/wayland/workItemStageActions';

const now = '2026-06-14T00:00:00.000Z';

function run(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-1',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: input.id,
    },
    prompt: 'stage prompt',
    startedAt: now,
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    title: 'Lifecycle task',
    kind: 'jira-ticket',
    status: 'backlog',
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

describe('work item stage actions', () => {
  it('recommends the latest open stage and exposes its session for opening', () => {
    const source = task({
      status: 'coding',
      stageRuns: [run({ id: 'coding-session', stage: 'coding', status: 'running' })],
    });
    const action = buildWorkItemStageActions(source).find(item => item.stage === 'coding');

    expect(recommendedWorkItemStage(source)).toBe('coding');
    expect(action?.recommended).toBe(true);
    expect(action?.actionLabel).toBe('Open');
    expect(action?.tone).toBe('running');
    expect(action?.activeSession?.sessionId).toBe('coding-session');
  });

  it('recommends bugfix for backlog Jira bugs', () => {
    const actions = buildWorkItemStageActions(task({ kind: 'jira-bug', status: 'backlog' }));
    const bugfix = actions.find(item => item.stage === 'bugfix');

    expect(recommendedWorkItemStage(task({ kind: 'jira-bug', status: 'backlog' }))).toBe('bugfix');
    expect(bugfix?.recommended).toBe(true);
    expect(bugfix?.actionLabel).toBe('Start next');
  });

  it('recommends verification for resolved work and marks completed stages ready', () => {
    const actions = buildWorkItemStageActions(task({
      status: 'resolved',
      stageRuns: [run({ id: 'refine-done', stage: 'refinement', status: 'completed' })],
    }));

    expect(actions.find(item => item.stage === 'verification')?.recommended).toBe(true);
    expect(actions.find(item => item.stage === 'refinement')?.tone).toBe('ok');
  });
});
