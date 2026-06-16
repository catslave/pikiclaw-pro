import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../dashboard/src/types.ts';
import { isTodoWorkItemIntakeCandidate, todoSourceSessionLabel, todoToWorkItemDescription } from '../dashboard/src/work-items/todoWorkItemEvidence.ts';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    kind: 'todo',
    title: 'Investigate trace',
    body: 'Check why the trace is missing session id.',
    status: 'open',
    createdAt: '2026-06-14T01:00:00.000Z',
    updatedAt: '2026-06-14T01:05:00.000Z',
    ...overrides,
  };
}

describe('Wayland Todo to Work Item evidence', () => {
  it('formats source session labels with turn index', () => {
    const item = todo({
      source: {
        type: 'chat-selection',
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'session-1',
        turnIndex: 7,
      },
    });

    expect(todoSourceSessionLabel(item)).toBe('codex:session-1 turn 7');
  });

  it('preserves todo note, quote, images, source workspace, and linked chat as evidence', () => {
    const description = todoToWorkItemDescription(todo({
      source: {
        type: 'chat-selection',
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'session-1',
        turnIndex: 7,
        quote: 'The trace appears to have a blank session field.',
      },
      images: [
        {
          id: 'img-1',
          kind: 'image',
          name: 'trace.png',
          mimeType: 'image/png',
          size: 2048,
          dataUrl: 'data:image/png;base64,abcd',
        },
      ],
      linkedChat: {
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'session-2',
      },
    }));

    expect(description).toContain('Inbox note:');
    expect(description).toContain('Check why the trace is missing session id.');
    expect(description).toContain('Quoted source:');
    expect(description).toContain('The trace appears to have a blank session field.');
    expect(description).toContain('Images:');
    expect(description).toContain('- trace.png (2 KB)');
    expect(description).toContain('Source session: codex:session-1 turn 7');
    expect(description).toContain('Source workspace: /repo/pikiclaw');
    expect(description).toContain('Linked chat: codex:session-2');
  });

  it('only treats open todos as Work Item intake candidates', () => {
    expect(isTodoWorkItemIntakeCandidate(todo({ status: 'open' }))).toBe(true);
    expect(isTodoWorkItemIntakeCandidate(todo({ status: 'chat-created' }))).toBe(false);
    expect(isTodoWorkItemIntakeCandidate(todo({ status: 'done' }))).toBe(false);
    expect(isTodoWorkItemIntakeCandidate(todo({ status: 'archived' }))).toBe(false);
  });
});
