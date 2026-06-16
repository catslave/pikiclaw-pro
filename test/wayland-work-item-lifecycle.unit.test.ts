import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import { buildWorkItemLifecycle, summarizeWorkItemLifecycleCommand } from '../dashboard/src/pages/wayland/workItemLifecycle.ts';
import { summarizeWorkItemOperationalState } from '../dashboard/src/pages/wayland/workItemOperationalState.ts';
import { summarizeWorkItemRemoteBoundary } from '../dashboard/src/pages/wayland/workItemRemoteBoundary.ts';
import { summarizeWorkItemSourceHealth } from '../dashboard/src/pages/wayland/workItemSourceHealth.ts';

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    localKey: 'PCL-1',
    title: 'Review task lifecycle',
    description: 'Make detail state easier to scan.',
    kind: 'todo',
    status: 'backlog',
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  };
}

function lifecycle(item: ProTask, runs: Parameters<typeof summarizeWorkItemRemoteBoundary>[1] = []) {
  return buildWorkItemLifecycle({
    operational: summarizeWorkItemOperationalState(item, Date.parse('2026-06-15T02:00:00.000Z')),
    remoteBoundary: summarizeWorkItemRemoteBoundary(item, runs),
    sourceHealth: summarizeWorkItemSourceHealth(item, Date.parse('2026-06-15T02:00:00.000Z')),
  });
}

describe('Wayland Work Item lifecycle', () => {
  it('turns a thin Todo into a source-first lifecycle', () => {
    const steps = lifecycle(task({ kind: 'todo' }));

    expect(steps.map(step => step.key)).toEqual(['source', 'boundary', 'execution', 'output']);
    expect(steps[0]).toMatchObject({
      title: 'Source',
      label: 'Source thin',
      target: 'source',
      attention: true,
    });
    expect(steps[1]).toMatchObject({
      label: 'Local only',
      attention: false,
    });
  });

  it('promotes Jira write-back drafts and running execution as attention steps', () => {
    const item = task({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-123',
      jiraFields: { status: 'In Progress', updatedAt: '2026-06-15T01:30:00.000Z' },
      stageRuns: [{
        id: 'run-1',
        taskId: 'task-1',
        stage: 'refinement',
        status: 'running',
        prompt: 'Refine ticket',
        startedAt: '2026-06-15T01:40:00.000Z',
      }],
    });
    const steps = lifecycle(item, [{
      id: 'jira-run-1',
      taskId: 'task-1',
      jiraKey: 'IVAS-123',
      status: 'draft',
      fields: { summary: 'New summary' },
      diff: [{ field: 'summary', before: 'Old', after: 'New' }],
      createdAt: '2026-06-15T01:45:00.000Z',
      updatedAt: '2026-06-15T01:45:00.000Z',
      events: [],
    }]);

    expect(steps.find(step => step.key === 'boundary')).toMatchObject({
      label: 'Write-back draft',
      target: 'source',
      attention: true,
    });
    expect(steps.find(step => step.key === 'execution')).toMatchObject({
      label: 'Running',
      target: 'runs',
      attention: true,
    });
  });

  it('marks output as reviewable when deliverables exist', () => {
    const steps = lifecycle(task({
      outputs: [{
        id: 'out-1',
        taskId: 'task-1',
        kind: 'markdown',
        title: 'Audit result',
        summary: 'Validated the work item.',
        createdAt: '2026-06-15T01:50:00.000Z',
      }],
    }));

    expect(steps.find(step => step.key === 'output')).toMatchObject({
      label: '1 saved',
      tone: 'ok',
      target: 'deliverables',
    });
  });

  it('summarizes the first attention step for command center recovery', () => {
    const steps = lifecycle(task({
      kind: 'jira-ticket',
      jiraKey: 'IVAS-200',
      jiraFields: { updatedAt: '2026-06-01T00:00:00.000Z' },
      status: 'refinement',
    }));

    expect(summarizeWorkItemLifecycleCommand(steps)).toMatchObject({
      title: 'Source',
      label: 'Jira stale',
      target: 'source',
      attention: true,
    });
  });

  it('falls back to execution when no lifecycle step needs attention', () => {
    const steps = lifecycle(task({
      kind: 'manual',
      status: 'refinement',
      description: 'Local planning work.',
    }));

    expect(summarizeWorkItemLifecycleCommand(steps)).toMatchObject({
      title: 'Execution',
      target: 'activity',
      attention: false,
    });
  });
});
