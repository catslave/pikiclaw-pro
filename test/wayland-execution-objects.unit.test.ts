import { describe, expect, it } from 'vitest';
import type { AutomationRule, ProTask, WorkflowRunRecord } from '../dashboard/src/types.ts';
import {
  buildAutomationRunExecutionObjects,
  buildExecutionObjects,
  buildStageRunExecutionObjects,
  buildWorkflowRunExecutionObjects,
} from '../dashboard/src/pages/wayland/executionObjects.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    title: 'Implement command execution lane',
    kind: 'jira-ticket',
    status: 'coding',
    jiraKey: 'IVAS-1',
    workdir: '/repo/pikiclaw',
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

function workflowRun(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: 'workflow-run-1',
    workflowId: 'release-review',
    workflowName: 'Release Review',
    title: 'Release Review for Pikiclaw',
    workdir: '/repo/pikiclaw',
    agent: 'codex',
    sessionKey: 'codex:session-1',
    sessionId: 'session-1',
    currentStep: 2,
    totalSteps: 3,
    status: 'running',
    steps: [
      { index: 1, title: 'Read source', status: 'done' },
      { index: 2, title: 'Check browser UI', status: 'now' },
      { index: 3, title: 'Summarize migration', status: 'todo' },
    ],
    asks: [],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    ...overrides,
  };
}

function automation(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'automation-1',
    name: 'Morning Jira Review',
    schedule: 'daily@09:00',
    prompt: 'Review Jira queue.',
    enabled: true,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    ...overrides,
  };
}

describe('Wayland execution object model', () => {
  it('promotes stage runs into deep-linkable execution objects', () => {
    const [failed, running] = buildStageRunExecutionObjects([
      task({
        stageRuns: [
          {
            id: 'run-ok',
            taskId: 'task-1',
            stage: 'coding',
            status: 'running',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-1' },
            prompt: 'Code it',
            startedAt: '2026-06-15T01:00:00.000Z',
          },
          {
            id: 'run-failed',
            taskId: 'task-1',
            stage: 'verification',
            status: 'failed',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-2' },
            prompt: 'Verify it',
            startedAt: '2026-06-15T00:30:00.000Z',
          },
        ],
      }),
    ]);

    expect(failed).toMatchObject({
      key: 'stage-run:task-1:run-failed',
      kind: 'stage-run',
      tone: 'warn',
      keys: ['Failed'],
      to: '/work-items?task=task-1&tab=runs&stageRun=run-failed',
    });
    expect(running).toMatchObject({ tone: 'primary', keys: ['Running'] });
  });

  it('keeps only the newest stage run for the same task, stage, and status', () => {
    const objects = buildStageRunExecutionObjects([
      task({
        stageRuns: [
          {
            id: 'older',
            taskId: 'task-1',
            stage: 'refinement',
            status: 'queued',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-old' },
            prompt: 'Refine it',
            startedAt: '2026-06-15T00:30:00.000Z',
          },
          {
            id: 'newer',
            taskId: 'task-1',
            stage: 'refinement',
            status: 'queued',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-new' },
            prompt: 'Refine it again',
            startedAt: '2026-06-15T01:30:00.000Z',
          },
        ],
      }),
    ]);

    expect(objects).toHaveLength(1);
    expect(objects[0].key).toBe('stage-run:task-1:newer');
  });

  it('prioritizes workflow runs waiting for an answer', () => {
    const [ask, running] = buildWorkflowRunExecutionObjects([
      workflowRun({ id: 'running-run', updatedAt: '2026-06-15T01:10:00.000Z' }),
      workflowRun({
        id: 'ask-run',
        asks: [{
          id: 'ask-1',
          stepIndex: 2,
          question: 'Which environment should be validated?',
          type: 'text',
          status: 'pending',
          askedAt: '2026-06-15T01:01:00.000Z',
        }],
      }),
    ]);

    expect(ask).toMatchObject({
      key: 'workflow-run:ask-run',
      kind: 'workflow-run',
      tone: 'warn',
      keys: ['Answer'],
      to: '/workflows?run=ask-run',
    });
    expect(ask.detail).toContain('Waiting for answer');
    expect(running).toMatchObject({ key: 'workflow-run:running-run', tone: 'primary' });
  });

  it('promotes automation run history with scheduled task deep links', () => {
    const [failed, missed, queued] = buildAutomationRunExecutionObjects([
      automation({
        runHistory: [
          { id: 'queued', ranAt: '2026-06-15T01:00:00.000Z', status: 'queued', sessionKey: 'codex:session' },
          { id: 'missed', ranAt: '2026-06-15T01:05:00.000Z', status: 'missed', scheduledFor: '2026-06-15T01:00:00.000Z', error: 'App was offline.' },
          { id: 'failed', ranAt: '2026-06-15T00:30:00.000Z', status: 'failed', error: 'Budget paused.' },
        ],
      }),
    ]);

    expect(failed).toMatchObject({
      key: 'automation-run:automation-1:failed',
      kind: 'automation-run',
      tone: 'warn',
      keys: ['Failed'],
      to: '/scheduled-tasks?automation=automation-1',
    });
    expect(missed).toMatchObject({ keys: ['Missed'], tone: 'warn' });
    expect(queued).toMatchObject({ keys: ['Queued'], tone: 'primary' });
  });

  it('merges execution objects by attention and recency', () => {
    const objects = buildExecutionObjects({
      tasks: [task({
        stageRuns: [{
          id: 'stage-running',
          taskId: 'task-1',
          stage: 'coding',
          status: 'running',
          session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-1' },
          prompt: 'Code it',
          startedAt: '2026-06-15T01:20:00.000Z',
        }],
      })],
      workflowRuns: [workflowRun({
        id: 'workflow-ask',
        asks: [{
          id: 'ask-1',
          stepIndex: 1,
          question: 'Proceed?',
          type: 'boolean',
          status: 'pending',
          askedAt: '2026-06-15T01:00:00.000Z',
        }],
      })],
      automations: [automation({
        runHistory: [{ id: 'auto-queued', ranAt: '2026-06-15T01:30:00.000Z', status: 'queued' }],
      })],
    });

    expect(objects.map(item => item.key)).toEqual([
      'workflow-run:workflow-ask',
      'automation-run:automation-1:auto-queued',
      'stage-run:task-1:stage-running',
    ]);
  });
});
