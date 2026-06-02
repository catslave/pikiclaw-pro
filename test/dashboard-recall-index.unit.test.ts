import { describe, expect, it } from 'vitest';
import { buildRecallIndex } from '../dashboard/src/pages/sessions/recall-index.ts';
import type { ProOutput, SessionSideChatRef } from '../dashboard/src/types.ts';
import type { Turn } from '../dashboard/src/pages/sessions/utils.ts';

function message(role: 'user' | 'assistant', text: string) {
  return {
    role,
    text,
    blocks: [{ type: 'text' as const, content: text }],
  };
}

describe('buildRecallIndex', () => {
  it('indexes user questions, assistant answers, proposed plans, outputs, links, and side cards', () => {
    const turns: Turn[] = [
      {
        user: message('user', 'Can you analyze this workflow?'),
        assistant: message('assistant', 'Yes. The important finding is that the dashboard owns the interaction state.'),
      },
      {
        user: message('user', 'Please make a plan.'),
        assistant: message('assistant', '<proposed_plan>\n# Plan\nAdd a local recall rail.\n</proposed_plan>'),
      },
    ];
    const outputs: ProOutput[] = [
      {
        id: 'doc-1',
        kind: 'document',
        title: 'Architecture note',
        summary: 'A durable markdown output.',
        taskId: 'task-1',
        path: '/tmp/architecture.md',
        createdAt: '2026-05-31T00:00:00.000Z',
      },
      {
        id: 'link-1',
        kind: 'link',
        title: 'Reference link',
        taskId: 'task-1',
        url: 'https://example.com/ref',
        createdAt: '2026-05-31T00:00:00.000Z',
      },
    ];
    const sideChats: SessionSideChatRef[] = [{
      agent: 'codex',
      sessionId: 'side-1',
      title: 'Review doubt',
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:01:00.000Z',
    }];

    const index = buildRecallIndex({ turns, startTurn: 0, totalTurns: 2, outputs, sideChats });

    expect(index.outline.map(item => item.kind)).toEqual(['user', 'assistant', 'user', 'plan']);
    expect(index.outline.find(item => item.kind === 'plan')?.turnIndex).toBe(1);
    expect(index.important.map(item => item.kind)).toEqual(['file', 'link', 'side-chat']);
    expect(index.important.map(item => item.title)).toContain('Architecture note');
    expect(index.important.map(item => item.title)).toContain('Review doubt');
    expect(index.olderTurnsNotIndexed).toBe(false);
  });

  it('reports when older turns are outside the indexed window', () => {
    const turns: Turn[] = [{
      user: message('user', 'Latest request'),
      assistant: message('assistant', 'Here is the latest answer with enough detail to index.'),
    }];

    const index = buildRecallIndex({ turns, startTurn: 79, totalTurns: 80 });

    expect(index.olderTurnsNotIndexed).toBe(true);
    expect(index.outline[0]?.turnIndex).toBe(79);
  });
});
