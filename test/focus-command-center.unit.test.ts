import { describe, expect, it } from 'vitest';
import type { WorkspaceSessionInfo } from '../src/bot/session-hub.ts';
import type { ProTask } from '../src/pro/tasks.ts';
import { buildFocusCommandCenter } from '../src/dashboard/focus-command-center.ts';

function session(overrides: Partial<WorkspaceSessionInfo> = {}): WorkspaceSessionInfo {
  return {
    sessionId: 's1',
    agent: 'codex',
    workdir: '/repo/app',
    workspaceName: 'app',
    workspacePath: '/repo/app/.pikiclaw/sessions/codex/s1/workspace',
    threadId: null,
    model: null,
    thinkingEffort: null,
    createdAt: '2026-06-05T09:00:00',
    origin: null,
    title: 'Ordinary answer',
    titleSource: 'prompt',
    running: false,
    runState: 'completed',
    runDetail: null,
    runUpdatedAt: '2026-06-05T09:10:00',
    classification: { outcome: 'answer', summary: 'Answered a simple question.' },
    userStatus: 'done',
    userStatusUpdatedAt: '2026-06-05T09:12:00',
    userNote: null,
    pinned: false,
    archived: false,
    archivedAt: null,
    lastQuestion: 'What is X?',
    lastAnswer: 'X is Y.',
    lastMessageText: 'X is Y.',
    outputs: [],
    migratedFrom: null,
    migratedTo: null,
    linkedSessions: [],
    sideChatOf: null,
    sideChats: [],
    contextSources: [],
    numTurns: 2,
    ...overrides,
  } as WorkspaceSessionInfo;
}

function task(overrides: Partial<ProTask> = {}): ProTask {
  return {
    id: 'task1',
    localKey: 'T-1',
    title: 'Fix auth redirect',
    description: 'Redirect fails after login.',
    kind: 'jira-bug',
    status: 'coding',
    workdir: '/repo/app',
    defaultAgent: 'codex',
    jiraKey: 'APP-123',
    jiraUrl: 'https://jira.example.com/browse/APP-123',
    createdAt: '2026-06-05T08:00:00',
    updatedAt: '2026-06-06T09:00:00',
    stageRuns: [{
      id: 'run1',
      taskId: 'task1',
      stage: 'coding',
      status: 'running',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 's-task' },
      prompt: 'Fix it',
      startedAt: '2026-06-06T09:00:00',
      output: { summary: 'Investigating redirect middleware.' },
    }],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...overrides,
  } as ProTask;
}

describe('Focus command center projection', () => {
  it('keeps ordinary one-off answer chats out of sandboxes', () => {
    const command = buildFocusCommandCenter({
      sessions: [session()],
      tasks: [],
      workspaces: [{ name: 'app', path: '/repo/app', addedAt: '2026-06-01T00:00:00' }],
      knowledge: [],
      hiddenKnowledgeCount: 0,
      outputs: [],
      candidateCount: 0,
      git: [],
      now: new Date('2026-06-06T10:00:00'),
    });

    expect(command.sandboxes.active).toHaveLength(0);
    expect(command.sandboxes.paused).toHaveLength(0);
    expect(command.sandboxes.completed).toHaveLength(0);
  });

  it('promotes active tasks into sandboxes and standup recommendations', () => {
    const command = buildFocusCommandCenter({
      sessions: [],
      tasks: [task()],
      workspaces: [{ name: 'app', path: '/repo/app', addedAt: '2026-06-01T00:00:00' }],
      knowledge: [],
      hiddenKnowledgeCount: 0,
      outputs: [],
      candidateCount: 0,
      git: [{ workdir: '/repo/app', workspaceName: 'app', branch: 'feature/auth', changedFiles: 2, ok: true }],
      now: new Date('2026-06-06T10:00:00'),
    });

    expect(command.sandboxes.active[0]).toMatchObject({
      type: 'bug',
      taskId: 'task1',
      sessionId: 's-task',
      sourceRef: { type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's-task' },
    });
    expect(command.standup.recommendations[0].sandboxId).toBe('task:task1');
  });

  it('surfaces resolved Jira work as check-out sync proposals', () => {
    const command = buildFocusCommandCenter({
      sessions: [],
      tasks: [task({ status: 'resolved', stageRuns: [] })],
      workspaces: [{ name: 'app', path: '/repo/app', addedAt: '2026-06-01T00:00:00' }],
      knowledge: [],
      hiddenKnowledgeCount: 0,
      outputs: [],
      candidateCount: 0,
      git: [],
      now: new Date('2026-06-06T10:00:00'),
    });

    expect(command.checkout.syncProposals[0]).toMatchObject({
      id: 'task:task1',
      action: { kind: 'sync', taskId: 'task1', url: 'https://jira.example.com/browse/APP-123' },
    });
  });

  it('caps active sandboxes at three and builds canvas blocks', () => {
    const tasks = [task({ id: 't1' }), task({ id: 't2', jiraKey: 'APP-2' }), task({ id: 't3', jiraKey: 'APP-3' }), task({ id: 't4', jiraKey: 'APP-4' })];
    const command = buildFocusCommandCenter({
      sessions: [],
      tasks,
      workspaces: [{ name: 'app', path: '/repo/app', addedAt: '2026-06-01T00:00:00' }],
      knowledge: [],
      hiddenKnowledgeCount: 0,
      outputs: [],
      candidateCount: 0,
      git: [],
      now: new Date('2026-06-06T10:00:00'),
    });
    expect(command.sandboxes.active.length).toBeLessThanOrEqual(3);
    expect(command.canvas?.some(block => block.type === 'standup')).toBe(true);
    expect(command.canvas?.some(block => block.type === 'sandbox-grid')).toBe(true);
  });

  it('uses session digest for chat sandbox breakpoint', () => {
    const digestBySessionKey = new Map([['/repo/app::codex::s-active', 'Resume at auth_service.js:78']]);
    const command = buildFocusCommandCenter({
      sessions: [session({
        sessionId: 's-active',
        title: 'Auth refactor',
        running: true,
        runState: 'running',
        userStatus: 'active',
        classification: { outcome: 'partial', summary: 'Working on auth.' },
      })],
      tasks: [],
      workspaces: [{ name: 'app', path: '/repo/app', addedAt: '2026-06-01T00:00:00' }],
      knowledge: [],
      hiddenKnowledgeCount: 0,
      outputs: [],
      candidateCount: 0,
      git: [],
      digestBySessionKey,
      now: new Date('2026-06-06T10:00:00'),
    });
    expect(command.sandboxes.active[0]?.breakpoint).toBe('Resume at auth_service.js:78');
  });
});
