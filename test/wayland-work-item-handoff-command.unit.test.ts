import { describe, expect, it } from 'vitest';
import type { ProTask, StageRun } from '../dashboard/src/types';
import { buildWorkItemHandoffCommandItems } from '../dashboard/src/pages/wayland/workItemHandoffCommand';

const now = '2026-06-16T00:00:00.000Z';

function run(input: Partial<StageRun> = {}): StageRun {
  return {
    id: input.id || 'run-1',
    taskId: input.taskId || 'task-1',
    stage: input.stage || 'coding',
    status: input.status || 'running',
    assistantId: input.assistantId,
    selectedAgent: input.selectedAgent || 'codex',
    session: input.session || { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'sess-1' },
    prompt: input.prompt || 'Continue implementation.',
    startedAt: input.startedAt || now,
    completedAt: input.completedAt,
    output: input.output,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Continue enterprise parity',
    description: input.description || 'Align task handoff with enterprise agents.',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'coding',
    jiraKey: input.jiraKey,
    jiraUrl: input.jiraUrl,
    workdir: input.workdir || '/repo/pikiclaw',
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

describe('Wayland Work Item handoff command items', () => {
  it('launches blocked execution with a handoff capsule prompt draft', () => {
    const items = buildWorkItemHandoffCommandItems([
      task({
        id: 'blocked',
        title: 'Fix source drift',
        jiraKey: 'PCL-91',
        stageRuns: [
          run({ id: 'blocked-run', status: 'waiting-user', stage: 'coding' }),
        ],
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'handoff:blocked',
      title: 'Resume blocked handoff: Fix source drift',
      to: '/chat',
      tone: 'warn',
      keys: ['Handoff', 'Resume blocked'],
      lanes: [
        { label: 'Source', value: 'PCL-91', tone: 'source' },
        { label: 'Execution', value: 'coding waiting-user', tone: 'attention' },
      ],
    });
    expect(items[0].promptDraft.startsWith('Work Item action: Resume blocked handoff\n')).toBe(true);
    expect(items[0].promptDraft).toContain('Handoff capsule:\n# Work Item Handoff');
    expect(items[0].promptDraft).toContain('- Session: sess-1');
  });

  it('sorts blocked handoff before ordinary coding continuation', () => {
    const items = buildWorkItemHandoffCommandItems([
      task({
        id: 'coding',
        title: 'Ordinary coding',
        status: 'coding',
        updatedAt: '2026-06-17T00:00:00.000Z',
      }),
      task({
        id: 'blocked',
        title: 'Blocked execution',
        status: 'coding',
        updatedAt: '2026-06-15T00:00:00.000Z',
        stageRuns: [run({ id: 'failed', status: 'failed' })],
      }),
    ]);

    expect(items.map(item => item.key)).toEqual([
      'handoff:blocked',
      'handoff:coding',
    ]);
  });

  it('omits completed and plain backlog work', () => {
    const items = buildWorkItemHandoffCommandItems([
      task({ id: 'done', status: 'done' }),
      task({ id: 'backlog', status: 'backlog' }),
    ]);

    expect(items).toEqual([]);
  });

  it('marks decision audit risk on handoff launch commands', () => {
    const items = buildWorkItemHandoffCommandItems([
      task({
        id: 'audit',
        status: 'coding',
        events: [{
          id: 'deploy',
          taskId: 'audit',
          type: 'deployment-linked',
          actor: 'system',
          createdAt: now,
          summary: 'Deployment linked.',
        }],
      }),
    ]);

    expect(items[0].tone).toBe('warn');
    expect(items[0].detail).toContain('decision review');
    expect(items[0].lanes).toContainEqual({ label: 'Audit', value: 'Review', tone: 'attention' });
    expect(items[0].promptDraft).toContain('- Decision audit: 1 guarded change lack a user decision event.');
  });
});
