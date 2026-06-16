import { describe, expect, it } from 'vitest';
import type { ProTask, WorkflowRunRecord } from '../dashboard/src/types.ts';
import { relatedWorkflowRunsForWorkItem, workItemWorkflowArtifactForRun } from '../dashboard/src/pages/wayland/workItemWorkflowArtifacts.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-alpha',
    localKey: 'P-7',
    title: 'Fix workflow artifact routing',
    kind: 'jira-ticket',
    status: 'coding',
    workdir: '/repo/pikiclaw',
    jiraKey: 'PK-123',
    jiraUrl: 'https://jira.example/browse/PK-123',
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:15:00.000Z',
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: 'workflow-run-alpha',
    workflowId: 'release-gate',
    workflowName: 'Release Gate',
    title: 'Release Gate',
    workdir: '/repo/pikiclaw',
    agent: 'codex',
    sessionKey: 'codex:session-alpha',
    sessionId: 'session-alpha',
    currentStep: 1,
    totalSteps: 2,
    status: 'running',
    steps: [
      { index: 1, title: 'Inspect ticket context', status: 'now' },
      { index: 2, title: 'Summarize decision', status: 'todo' },
    ],
    asks: [],
    createdAt: '2026-06-14T01:05:00.000Z',
    updatedAt: '2026-06-14T01:10:00.000Z',
    ...overrides,
  };
}

describe('Wayland Work Item workflow artifacts', () => {
  it('links workflow runs from the same stage chat first', () => {
    const item = task({
      stageRuns: [{
        id: 'stage-1',
        taskId: 'task-alpha',
        stage: 'coding',
        status: 'running',
        session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-alpha' },
        prompt: 'continue',
      }],
    });
    const artifact = workItemWorkflowArtifactForRun(item, run());

    expect(artifact).toMatchObject({
      match: 'stage-session',
      reason: 'Same stage chat',
      score: 120,
    });
  });

  it('matches Jira keys mentioned in workflow context', () => {
    const artifact = workItemWorkflowArtifactForRun(task(), run({
      note: 'Run release checks for PK-123 before moving the ticket forward.',
      sessionKey: 'codex:other-session',
      sessionId: 'other-session',
    }));

    expect(artifact).toMatchObject({
      match: 'jira-key',
      reason: 'Mentions PK-123',
    });
  });

  it('does not match by workspace alone', () => {
    const artifact = workItemWorkflowArtifactForRun(task(), run({
      note: 'General weekly project cleanup.',
      title: 'Weekly cleanup',
      workflowName: 'Weekly cleanup',
    }));

    expect(artifact).toBeNull();
  });

  it('sorts stronger and newer matches before weaker matches', () => {
    const runs = [
      run({
        id: 'title-match',
        title: 'Fix workflow artifact routing',
        workflowName: 'Implementation Review',
        updatedAt: '2026-06-14T01:50:00.000Z',
      }),
      run({
        id: 'jira-match',
        note: 'PK-123 workflow audit',
        sessionKey: 'codex:jira',
        sessionId: 'jira',
        updatedAt: '2026-06-14T01:20:00.000Z',
      }),
      run({
        id: 'task-id-match',
        note: 'task-alpha execution surface',
        sessionKey: 'codex:task-id',
        sessionId: 'task-id',
        updatedAt: '2026-06-14T01:10:00.000Z',
      }),
    ];

    expect(relatedWorkflowRunsForWorkItem(task(), runs).map(item => item.run.id)).toEqual([
      'task-id-match',
      'jira-match',
      'title-match',
    ]);
  });
});
