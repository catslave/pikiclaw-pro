import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../dashboard/src/types';
import { buildTodoIntakeCockpit } from '../dashboard/src/pages/wayland/todoIntakeCockpit';

const now = '2026-06-16T00:00:00.000Z';

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Investigate captured issue',
    status: input.status || 'open',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

describe('Wayland Todo intake cockpit', () => {
  it('ranks evidence-rich open todos before thin captures and omits closed items', () => {
    const summary = buildTodoIntakeCockpit({
      todos: [
        todo({ id: 'thin', title: 'Thin capture', updatedAt: '2026-06-16T10:00:00.000Z' }),
        todo({
          id: 'rich',
          title: 'Trace suspicious session',
          body: 'Inspect trace 4a00.',
          updatedAt: '2026-06-16T08:00:00.000Z',
          source: {
            type: 'chat-selection',
            workdir: '/repo/pikiclaw',
            agent: 'codex',
            sessionId: 'session-1',
            quote: 'The trace is missing a span.',
          },
          images: [{
            id: 'img-1',
            kind: 'image',
            name: 'trace.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,AA==',
          }],
        }),
        todo({ id: 'done', status: 'done', updatedAt: '2026-06-16T12:00:00.000Z' }),
      ],
    });

    expect(summary).toMatchObject({
      totalOpen: 2,
      richCount: 1,
      thinCount: 1,
      imageCount: 1,
      sourceSessionCount: 1,
    });
    expect(summary.items.map(item => item.id)).toEqual(['rich', 'thin']);
    expect(summary.items[0]).toMatchObject({
      tone: 'ok',
      meta: 'quote · source chat · 1 image · workspace · note',
      evidenceCount: 5,
    });
    expect(summary.items[1]).toMatchObject({
      tone: 'idle',
      meta: 'no preserved source',
      evidenceCount: 0,
    });
  });

  it('treats linked chat as high-value evidence', () => {
    const summary = buildTodoIntakeCockpit({
      todos: [
        todo({
          id: 'linked',
          title: 'Continue created chat',
          linkedChat: {
            workdir: '/repo/pikiclaw',
            agent: 'codex',
            sessionId: 'linked-session',
          },
        }),
      ],
    });

    expect(summary.linkedChatCount).toBe(1);
    expect(summary.items[0]).toMatchObject({
      tone: 'warn',
      meta: 'linked chat',
      detail: 'Evidence: linked chat',
    });
  });
});
