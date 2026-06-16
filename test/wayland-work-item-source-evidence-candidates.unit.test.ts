import { describe, expect, it } from 'vitest';
import type { NotePage, ProTask, SessionInfo, TodoItem } from '../dashboard/src/types';
import { buildWorkItemSourceEvidenceCandidates } from '../dashboard/src/pages/wayland/workItemSourceEvidenceCandidates';

describe('Wayland work item source evidence candidates', () => {
  it('builds focused candidates from workspace, todo source, stage sessions, and notes', () => {
    const task = {
      id: 'task_1',
      title: 'Trace source evidence',
      workdir: '/repo/pikiclaw',
      stageRuns: [
        {
          id: 'run_1',
          stage: 'coding',
          status: 'completed',
          session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-stage' },
        },
      ],
    } as ProTask;
    const sourceTodo = {
      id: 'todo_1',
      title: 'Original todo',
      source: {
        type: 'chat-selection',
        agent: 'codex',
        sessionId: 'session-todo',
        turnIndex: 4,
        quote: 'The source evidence is missing.',
      },
      linkedChat: {
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'session-linked',
      },
    } as TodoItem;
    const notes = [
      { id: 'note_1', kind: 'daily', title: 'Daily source note', date: '2026-06-15' },
    ] as NotePage[];
    const recentSessions = [
      { agent: 'codex', sessionId: 'session-recent', title: 'Recent investigation', workdir: '/repo/pikiclaw' },
    ] as SessionInfo[];

    expect(buildWorkItemSourceEvidenceCandidates({ task, sourceTodo, recentSessions, notes }).map(item => [item.kind, item.label, item.value])).toEqual([
      ['workspace', 'pikiclaw', '/repo/pikiclaw'],
      ['quote', 'Todo quote', 'The source evidence is missing.'],
      ['session', 'codex:session-todo', 'codex:session-todo turn 4'],
      ['linked-chat', 'codex:session-linked', 'codex:session-linked'],
      ['session', 'coding · codex', 'codex:session-stage'],
      ['session', 'Recent investigation', 'codex:session-recent'],
      ['inbox-note', 'Daily source note', 'Daily source note'],
    ]);
  });

  it('deduplicates repeated candidates and respects the limit', () => {
    const task = {
      id: 'task_1',
      title: 'Trace source evidence',
      workdir: '/repo/pikiclaw',
      stageRuns: [
        {
          id: 'run_1',
          stage: 'coding',
          status: 'completed',
          session: { workdir: '/repo/pikiclaw', agent: 'codex', sessionId: 'session-1' },
        },
      ],
    } as ProTask;
    const sourceTodo = {
      id: 'todo_1',
      title: 'Original todo',
      source: {
        type: 'chat-selection',
        agent: 'codex',
        sessionId: 'session-1',
      },
    } as TodoItem;

    const recentSessions = [
      { agent: 'codex', sessionId: 'session-1', title: 'Duplicate session' },
    ] as SessionInfo[];

    expect(buildWorkItemSourceEvidenceCandidates({ task, sourceTodo, recentSessions, limit: 2 }).map(item => item.value)).toEqual([
      '/repo/pikiclaw',
      'codex:session-1',
    ]);
  });

  it('falls back to compact session labels for noisy generated titles', () => {
    const task = {
      id: 'task_1',
      title: 'Trace source evidence',
      stageRuns: [],
    } as unknown as ProTask;
    const recentSessions = [
      {
        agent: 'codex',
        sessionId: 'session-noisy-title',
        title: '# Files mentioned by the user: ## codex-clipboard-long-name.png',
      },
    ] as SessionInfo[];

    expect(buildWorkItemSourceEvidenceCandidates({ task, recentSessions })).toMatchObject([
      {
        kind: 'session',
        label: 'codex:session-noi...',
        value: 'codex:session-noisy-title',
      },
    ]);
  });
});
