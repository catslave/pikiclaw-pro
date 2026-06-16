import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import { summarizeWorkItemOperationalState } from '../dashboard/src/pages/wayland/workItemOperationalState.ts';

function workItem(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    localKey: 'W-1',
    title: 'Review dashboard shell',
    description: 'Make the Work Item surface easier to resume.',
    kind: 'todo',
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

describe('Wayland Work Item operational state', () => {
  it('summarizes todo capture as a ready inbox work object', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem(),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      sourceLabel: 'Inbox',
      stateLabel: 'Ready',
      stateTone: 'idle',
      nextActionLabel: 'Refine',
      nextActionDetail: 'Start refinement',
      latestStageLabel: 'No stage yet',
      updatedLabel: '10m ago',
    });
  });

  it('surfaces waiting Jira stage runs as an answer-needed object', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem({
        kind: 'jira-ticket',
        jiraKey: 'IVAS-1234',
        status: 'refinement',
        stageRuns: [
          {
            id: 'run-1',
            taskId: 'task-1',
            stage: 'refinement',
            status: 'waiting-user',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 's1' },
            prompt: 'Clarify ticket scope',
            startedAt: '2026-06-14T01:05:00.000Z',
          },
        ],
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      sourceLabel: 'Ticket IVAS-1234',
      stateLabel: 'Needs answer',
      stateTone: 'warn',
      nextActionLabel: 'Answer',
      nextActionDetail: 'refinement is waiting-user',
      latestStageLabel: 'refinement · waiting-user',
      openRunCount: 1,
    });
  });

  it('marks active tasks with past Jira due dates as overdue', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem({
        kind: 'jira-bug',
        jiraKey: 'IVAS-2000',
        jiraFields: { dueDate: '2026-06-13' },
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary.stateLabel).toBe('Overdue');
    expect(summary.stateTone).toBe('warn');
    expect(summary.overdue).toBe(true);
    expect(summary.scheduleLabel).toBe('Overdue 06/13');
    expect(summary.guardrailLabel).toBe('Overdue 06/13');
    expect(summary.riskCount).toBe(1);
  });

  it('keeps completed work reviewable without attention noise', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem({
        status: 'done',
        stageRuns: [
          {
            id: 'run-1',
            taskId: 'task-1',
            stage: 'verification',
            status: 'completed',
            session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 's1' },
            prompt: 'Verify result',
            startedAt: '2026-06-14T01:05:00.000Z',
            completedAt: '2026-06-14T01:12:00.000Z',
            output: { summary: 'Looks good.' },
          },
        ],
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      stateLabel: 'Done',
      stateTone: 'ok',
      nextActionLabel: 'Review',
      nextActionDetail: 'Review completed context',
      outputCount: 1,
    });
  });

  it('promotes failed verification above normal ready state', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem({
        status: 'resolved',
        verificationRuns: [
          {
            id: 'verify-1',
            taskId: 'task-1',
            environment: 'local',
            result: 'failed',
            notes: 'Tests failed.',
            startedAt: '2026-06-14T01:05:00.000Z',
            completedAt: '2026-06-14T01:12:00.000Z',
          },
        ],
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      stateLabel: 'Verify failed',
      stateTone: 'err',
      verificationLabel: 'Verification failed',
      guardrailLabel: 'Verification failed',
      riskCount: 1,
    });
  });

  it('summarizes ownership, schedule, and blocked subtasks as execution guardrails', () => {
    const summary = summarizeWorkItemOperationalState(
      workItem({
        plannedDate: '2026-06-15',
        execution: { agent: 'codex', mode: 'interactive' },
        subTasks: [
          {
            id: 'sub-1',
            taskId: 'task-1',
            title: 'Reproduce issue',
            status: 'blocked',
            createdAt: '2026-06-14T01:00:00.000Z',
            updatedAt: '2026-06-14T01:00:00.000Z',
            stageRunIds: [],
          },
          {
            id: 'sub-2',
            taskId: 'task-1',
            title: 'Patch UI',
            status: 'todo',
            createdAt: '2026-06-14T01:00:00.000Z',
            updatedAt: '2026-06-14T01:00:00.000Z',
            stageRunIds: [],
          },
        ],
      }),
      new Date('2026-06-14T01:20:00.000Z'),
    );

    expect(summary).toMatchObject({
      stateLabel: 'Blocked',
      stateTone: 'warn',
      ownerLabel: 'Agent codex',
      scheduleLabel: 'Planned 06/15',
      subtaskLabel: '1 blocked',
      guardrailLabel: '1 blocked',
      riskCount: 1,
    });
  });
});
