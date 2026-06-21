import { describe, expect, it } from 'vitest';
import type { ProTask, ProTaskEvent, StageRun } from '../dashboard/src/types';
import { buildWorkItemAgentLaunchPrompt, buildWorkItemHandoffCapsule } from '../dashboard/src/pages/wayland/workItemHandoffCapsule';

const now = '2026-06-16T00:00:00.000Z';

function event(input: Partial<ProTaskEvent> & Pick<ProTaskEvent, 'id' | 'type' | 'actor' | 'summary'>): ProTaskEvent {
  return {
    taskId: 'task-1',
    createdAt: now,
    ...input,
  };
}

function run(input: Partial<StageRun> = {}): StageRun {
  return {
    id: input.id || 'run-1',
    taskId: 'task-1',
    stage: input.stage || 'coding',
    status: input.status || 'completed',
    assistantId: input.assistantId,
    selectedAgent: input.selectedAgent || 'codex',
    session: input.session || { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'sess-1' },
    prompt: input.prompt || 'Implement the scoped change.',
    startedAt: input.startedAt || '2026-06-15T00:00:00.000Z',
    completedAt: input.completedAt || '2026-06-15T01:00:00.000Z',
    output: input.output || {
      summary: 'Implemented dashboard handoff.',
      changedFiles: ['dashboard/src/pages/wayland/WaylandShell.tsx'],
    },
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Align enterprise handoff',
    description: input.description || 'Create a durable handoff artifact for selected work.',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'coding',
    workdir: input.workdir || '/repo/pikiclaw',
    jiraKey: Object.prototype.hasOwnProperty.call(input, 'jiraKey') ? input.jiraKey : 'PCL-88',
    jiraUrl: Object.prototype.hasOwnProperty.call(input, 'jiraUrl') ? input.jiraUrl : 'https://jira.example/PCL-88',
    prUrl: input.prUrl,
    createdAt: now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

describe('Wayland Work Item handoff capsule', () => {
  it('builds a copyable handoff across source, run, output, and timeline', () => {
    const capsule = buildWorkItemHandoffCapsule(task({
      stageRuns: [run()],
      outputs: [{
        id: 'out-1',
        taskId: 'task-1',
        kind: 'final',
        title: 'Implementation summary',
        summary: 'Dashboard hook and tests.',
        createdAt: '2026-06-16T01:00:00.000Z',
        path: '/repo/pikiclaw/output.md',
      }],
      events: [
        event({ id: 'status', type: 'status-changed', actor: 'user', summary: 'Moved to coding.' }),
      ],
    }));

    expect(capsule.summary).toBe('PCL-88 · Coding · Code: Start coding');
    expect(capsule.sourceCount).toBeGreaterThan(0);
    expect(capsule.runCount).toBe(1);
    expect(capsule.outputCount).toBe(2);
    expect(capsule.eventCount).toBe(1);
    expect(capsule.latestRunLabel).toBe('coding · completed');
    expect(capsule.markdown).toContain('# Work Item Handoff');
    expect(capsule.markdown).toContain('- Jira: PCL-88 https://jira.example/PCL-88');
    expect(capsule.markdown).toContain('- Session: sess-1');
    expect(capsule.markdown).toContain('- Implementation summary: Dashboard hook and tests. - /repo/pikiclaw/output.md');
    expect(capsule.markdown).toContain('user status-changed - Moved to coding.');
  });

  it('marks missing user decisions for guarded changes', () => {
    const capsule = buildWorkItemHandoffCapsule(task({
      events: [
        event({ id: 'deploy', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.' }),
      ],
    }));

    expect(capsule.needsDecisionReview).toBe(true);
    expect(capsule.markdown).toContain('- Decision audit: 1 guarded change lack a user decision event.');
  });

  it('stays useful when no execution run exists yet', () => {
    const capsule = buildWorkItemHandoffCapsule(task({
      kind: 'todo',
      jiraKey: undefined,
      jiraUrl: undefined,
      status: 'backlog',
      stageRuns: [],
      outputs: [],
    }));

    expect(capsule.latestRunLabel).toBe('No stage run yet');
    expect(capsule.markdown).toContain('- No stage run yet.');
    expect(capsule.markdown).toContain('- Source: Todo');
  });

  it('builds an agent launch prompt that preserves the Chat Home work item parser prefix', () => {
    const prompt = buildWorkItemAgentLaunchPrompt(task({
      stageRuns: [run()],
      outputs: [{
        id: 'out-1',
        taskId: 'task-1',
        kind: 'final',
        title: 'Handoff summary',
        summary: 'Ready for review.',
        createdAt: '2026-06-16T01:00:00.000Z',
      }],
    }), {
      actionLabel: 'Code',
      actionInstruction: 'Help me implement this Work Item.',
    });

    expect(prompt.startsWith('Work Item action: Code\n')).toBe(true);
    expect(prompt).toContain('Handoff capsule:\n# Work Item Handoff');
    expect(prompt).toContain('Recent deliverables:\n- Handoff summary: Ready for review.');
    expect(prompt.endsWith('Help me implement this Work Item.')).toBe(true);
    expect(prompt.indexOf('Handoff capsule:')).toBeLessThan(prompt.indexOf('Recent deliverables:'));
  });
});
