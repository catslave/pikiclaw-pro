import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../src/agent/types.ts';
import type { ProTaskWorkbench } from '../src/pro/tasks.ts';
import { enrichWorkbenchSideChats } from '../src/dashboard/workbench-side-chats.ts';

function session(input: Partial<SessionInfo> & Pick<SessionInfo, 'agent' | 'sessionId' | 'workdir'>): SessionInfo {
  return {
    sessionId: input.sessionId,
    agent: input.agent,
    workdir: input.workdir,
    workspacePath: `${input.workdir}/.pikiclaw/sessions/${input.agent}/${input.sessionId}/workspace`,
    threadId: `thread-${input.sessionId}`,
    createdAt: '2026-06-15T00:00:00.000Z',
    title: null,
    titleSource: null,
    running: false,
    runState: 'completed',
    runDetail: null,
    runUpdatedAt: '2026-06-15T00:00:00.000Z',
    runPid: null,
    autoResumeAttempts: 0,
    autoResumeLastAt: null,
    autoResumeLastError: null,
    classification: { outcome: 'conversation', confidence: 'low', signals: [] },
    pinned: false,
    archived: false,
    archivedAt: null,
    lastQuestion: null,
    lastAnswer: null,
    lastMessageText: null,
    outputs: [],
    linkedSessions: [],
    sideChatOf: null,
    sideChats: [],
    contextSources: [],
    projectContext: null,
    numTurns: null,
    handoverFrom: null,
    ...input,
  };
}

function workbench(): ProTaskWorkbench {
  return {
    task: {
      id: 'task-1',
      title: 'Recover side chats',
      kind: 'jira-ticket',
      status: 'coding',
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      stageRuns: [
        {
          id: 'run-1',
          taskId: 'task-1',
          stage: 'coding',
          status: 'running',
          session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'parent-1' },
          prompt: 'Implement side chats',
        },
        {
          id: 'run-2',
          taskId: 'task-1',
          stage: 'verification',
          status: 'completed',
          session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'parent-2' },
          prompt: 'Verify side chats',
        },
      ],
      outputs: [],
      verificationRuns: [],
      subTasks: [],
      events: [],
    },
    activeStageRun: null,
    outputs: [],
    sideChats: [],
    files: [],
    ticketSnapshot: { title: 'Recover side chats' },
  };
}

describe('workbench side chat enrichment', () => {
  it('projects visible parent side chat refs into openable workbench side chats', () => {
    const sessions = new Map<string, SessionInfo>();
    sessions.set('codex:parent-1', session({
      agent: 'codex',
      sessionId: 'parent-1',
      workdir: '/repo/pikiclaw',
      sideChats: [
        { agent: 'codex', sessionId: 'side-1', title: 'Clarify scope', createdAt: '2026-06-15T00:01:00.000Z', updatedAt: '2026-06-15T00:01:00.000Z' },
        { agent: 'codex', sessionId: 'side-hidden', title: 'Hidden', createdAt: '2026-06-15T00:02:00.000Z', updatedAt: '2026-06-15T00:02:00.000Z', hidden: true },
      ],
    }));
    sessions.set('codex:parent-2', session({
      agent: 'codex',
      sessionId: 'parent-2',
      workdir: '/repo/pikiclaw',
      sideChats: [
        { agent: 'codex', sessionId: 'side-1', title: 'Duplicate', createdAt: '2026-06-15T00:03:00.000Z', updatedAt: '2026-06-15T00:03:00.000Z' },
        { agent: 'codex', sessionId: 'side-2', title: null, createdAt: '2026-06-15T00:04:00.000Z', updatedAt: '2026-06-15T00:04:00.000Z' },
      ],
    }));
    sessions.set('codex:side-2', session({
      agent: 'codex',
      sessionId: 'side-2',
      workdir: '/repo/pikiclaw',
      title: 'Verify result',
    }));

    const enriched = enrichWorkbenchSideChats(workbench(), (_workdir, agent, sessionId) => (
      sessions.get(`${agent}:${sessionId}`) || null
    ));

    expect(enriched.sideChats).toEqual([
      {
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'side-1',
        title: 'Clarify scope',
        parentStageRunId: 'run-1',
      },
      {
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'side-2',
        title: 'Verify result',
        parentStageRunId: 'run-2',
      },
    ]);
  });
});
