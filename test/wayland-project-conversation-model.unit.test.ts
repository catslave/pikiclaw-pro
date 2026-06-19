import { describe, expect, it } from 'vitest';
import type { ProTask, WorkspaceEntry } from '../dashboard/src/types';
import { buildProjectConversationModel } from '../dashboard/src/pages/wayland/projectConversationModel';

const now = '2026-06-19T08:00:00.000Z';

function workspace(input: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path: '/repo/pikiclaw',
    name: 'Pikiclaw',
    rules: '',
    instructions: '',
    memory: '',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task-1',
    title: 'Design project conversations',
    kind: 'manual',
    status: 'coding',
    workdir: '/repo/pikiclaw',
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

describe('project conversation model', () => {
  it('keeps project context, live conversations, and work items as separate signals', () => {
    const model = buildProjectConversationModel({
      workspace: workspace({
        rules: 'Keep chats inline.',
        instructions: 'Use project context at launch.',
      }),
      conversations: [
        {
          workdir: '/repo/pikiclaw',
          session: {
            runState: 'running',
            projectContext: { source: '/repo/pikiclaw', hash: 'abc', appliedAt: now },
            sideChats: [{ workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'side-1' }],
          },
        },
        { workdir: '/repo/other', session: { runState: 'running' } },
      ],
      tasks: [
        task({
          outputs: [{ id: 'out-1', kind: 'final', taskId: 'task-1', createdAt: now }],
        }),
        task({
          id: 'task-2',
          status: 'backlog',
          stageRuns: [{ id: 'run-2', taskId: 'task-2', stage: 'coding', status: 'waiting-user' }],
        }),
        task({ id: 'task-other', workdir: '/repo/other' }),
      ],
    });

    expect(model).toMatchObject({
      contextCount: 2,
      contextAppliedCount: 1,
      conversationCount: 1,
      runningConversationCount: 1,
      sideChatCount: 1,
      activeWorkItemCount: 2,
      attentionWorkItemCount: 1,
      deliverableCount: 1,
    });
    expect(model.steps.map(step => [step.key, step.tone])).toEqual([
      ['project', 'ready'],
      ['conversation', 'active'],
      ['work-item', 'warn'],
    ]);
  });

  it('marks an unseeded project as needing context before new conversations', () => {
    const model = buildProjectConversationModel({
      workspace: workspace(),
      conversations: [],
      tasks: [],
    });

    expect(model.steps).toEqual([
      expect.objectContaining({ key: 'project', value: '0/3', tone: 'warn' }),
      expect.objectContaining({ key: 'conversation', value: '0', tone: 'idle' }),
      expect.objectContaining({ key: 'work-item', value: '0', tone: 'idle' }),
    ]);
  });
});
