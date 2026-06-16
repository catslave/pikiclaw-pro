import { describe, expect, it } from 'vitest';
import type { NotePage } from '../dashboard/src/types';
import { buildWorkItemNoteCommandItems } from '../dashboard/src/pages/wayland/workItemNoteCommand';

const now = '2026-06-16T00:00:00.000Z';

function note(input: Partial<NotePage> = {}): NotePage {
  return {
    id: input.id || 'note-1',
    kind: input.kind || 'page',
    title: input.title || 'Review loose note',
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

describe('Wayland Work Item note command items', () => {
  it('builds a deep-linked command for today daily note', () => {
    const items = buildWorkItemNoteCommandItems([
      note({ id: 'daily-today', kind: 'daily', title: 'Daily note', date: '2026-06-16' }),
    ], { todayDate: '2026-06-16' });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'note:daily-today',
      title: 'Daily note: Daily 2026-06-16',
      to: '/work-items?source=manual&date=2026-06-16&note=daily-today',
      secondaryTo: '/notes/daily-today',
      secondaryLabel: 'Open note',
      keys: ['Today', 'Note'],
      tone: 'primary',
    });
  });

  it('builds a command for inbox notes and includes parent metadata', () => {
    const items = buildWorkItemNoteCommandItems([
      note({ id: 'inbox-note', kind: 'inbox', title: 'Capture launch idea', parentId: 'inbox' }),
    ], { todayDate: '2026-06-16' });

    expect(items[0]).toMatchObject({
      key: 'note:inbox-note',
      title: 'Inbox note: Capture launch idea',
      to: '/work-items?source=manual&note=inbox-note',
      keys: ['Inbox', 'Note'],
      tone: 'ok',
    });
    expect(items[0].detail).toContain('parent inbox');
  });

  it('uses note intake ranking and omits deleted pages', () => {
    const items = buildWorkItemNoteCommandItems([
      note({ id: 'plain', kind: 'page', title: 'Plain note', updatedAt: '2026-06-16T01:00:00.000Z' }),
      note({ id: 'deleted', kind: 'inbox', title: 'Deleted note', deletedAt: now }),
      note({ id: 'old-daily', kind: 'daily', date: '2026-06-15', updatedAt: '2026-06-15T01:00:00.000Z' }),
      note({ id: 'today', kind: 'daily', date: '2026-06-16', updatedAt: '2026-06-14T01:00:00.000Z' }),
    ], { todayDate: '2026-06-16' });

    expect(items.map(item => item.key)).toEqual([
      'note:today',
      'note:old-daily',
      'note:plain',
    ]);
  });
});
