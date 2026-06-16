import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../dashboard/src/types';
import { buildWorkItemInboxCommandItems } from '../dashboard/src/pages/wayland/workItemInboxCommand';

const now = '2026-06-16T00:00:00.000Z';

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Capture source evidence',
    status: input.status || 'open',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

describe('Wayland Work Item inbox command items', () => {
  it('builds a concrete command for an open inbox capture with evidence', () => {
    const items = buildWorkItemInboxCommandItems([
      todo({
        id: 'todo-rich',
        title: 'Trace suspicious session',
        body: 'Need to inspect trace 4a00.',
        source: {
          type: 'chat-selection',
          workdir: '/repo/pikiclaw',
          agent: 'codex',
          sessionId: 'session-1',
          quote: 'The trace has a missing span.',
        },
        images: [{
          id: 'img-1',
          kind: 'image',
          name: 'trace.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AA==',
        }],
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'inbox:todo-rich',
      title: 'Inbox capture: Trace suspicious session',
      to: '/work-items?source=inbox&todo=todo-rich',
      secondaryLabel: 'Open source chat',
      priority: 28,
      lanes: [
        { label: 'Source', value: 'Chat', tone: 'source' },
        { label: 'Execution', value: 'Promote', tone: 'execution' },
      ],
      tone: 'ok',
      keys: ['Promote', 'Evidence'],
    });
    expect(items[0].secondaryTo).toContain('/conversations/session?');
    expect(items[0].secondaryTo).toContain('workdir=%2Frepo%2Fpikiclaw');
    expect(items[0].secondaryTo).toContain('agent=codex');
    expect(items[0].secondaryTo).toContain('session=session-1');
    expect(items[0].detail).toContain('Chat capture');
    expect(items[0].detail).toContain('quote');
    expect(items[0].detail).toContain('1 image');
    expect(items[0].keywords.join(' ')).toContain('trace.png');
    expect(items[0].keywords.join(' ')).toContain('session-1');
  });

  it('orders newest open captures first and omits closed ones', () => {
    const items = buildWorkItemInboxCommandItems([
      todo({ id: 'old', title: 'Old open', updatedAt: '2026-06-14T00:00:00.000Z' }),
      todo({ id: 'closed', title: 'Closed', status: 'done', updatedAt: '2026-06-17T00:00:00.000Z' }),
      todo({ id: 'new', title: 'New open', updatedAt: '2026-06-15T00:00:00.000Z' }),
    ]);

    expect(items.map(item => item.key)).toEqual(['inbox:new', 'inbox:old']);
  });

  it('uses an idle tone for thin captures that still need source detail', () => {
    const items = buildWorkItemInboxCommandItems([todo({ id: 'thin', title: 'Thin note' })]);

    expect(items[0]).toMatchObject({
      tone: 'idle',
      keys: ['Promote', 'Inbox'],
      priority: 0,
    });
    expect(items[0].secondaryTo).toBeUndefined();
    expect(items[0].secondaryLabel).toBeUndefined();
    expect(items[0].detail).toContain('needs source detail');
  });

  it('prefers linked chat over the original source session', () => {
    const items = buildWorkItemInboxCommandItems([
      todo({
        id: 'linked',
        title: 'Continue from created chat',
        source: {
          type: 'chat-selection',
          workdir: '/repo/source',
          agent: 'codex',
          sessionId: 'source-session',
          quote: 'Original selection',
        },
        linkedChat: {
          workdir: '/repo/linked',
          agent: 'claude',
          sessionId: 'linked-session',
        },
      }),
    ]);

    expect(items[0]).toMatchObject({
      secondaryLabel: 'Open linked chat',
      priority: 28,
    });
    expect(items[0].secondaryTo).toContain('workdir=%2Frepo%2Flinked');
    expect(items[0].secondaryTo).toContain('agent=claude');
    expect(items[0].secondaryTo).toContain('session=linked-session');
    expect(items[0].secondaryTo).not.toContain('source-session');
  });
});
