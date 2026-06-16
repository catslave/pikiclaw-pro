import { describe, expect, it } from 'vitest';
import type { NotePage } from '../dashboard/src/types';
import {
  noteIntakePromotionText,
  noteIntakeTextFromBlocks,
  selectNoteIntakePages,
} from '../dashboard/src/pages/wayland/noteIntake';

function page(input: Partial<NotePage> & Pick<NotePage, 'id' | 'kind' | 'title' | 'updatedAt'>): NotePage {
  return {
    parentId: null,
    sortOrder: 0,
    createdAt: input.updatedAt,
    ...input,
  };
}

describe('wayland note intake', () => {
  it('prioritizes today daily and inbox notes before older pages', () => {
    const pages: NotePage[] = [
      page({ id: 'page', kind: 'page', title: 'Fresh page', updatedAt: '2026-06-14T09:10:00.000Z' }),
      page({ id: 'daily-old', kind: 'daily', title: 'Daily', date: '2026-06-13', updatedAt: '2026-06-13T09:10:00.000Z' }),
      page({ id: 'inbox', kind: 'inbox', title: 'Inbox', updatedAt: '2026-06-01T09:10:00.000Z' }),
      page({ id: 'daily-today', kind: 'daily', title: 'Daily', date: '2026-06-14', updatedAt: '2026-06-14T01:10:00.000Z' }),
    ];

    expect(selectNoteIntakePages(pages, '2026-06-14').map(item => item.id)).toEqual([
      'daily-today',
      'inbox',
      'daily-old',
      'page',
    ]);
  });

  it('supports an explicit larger candidate pool for Work Items intake', () => {
    const pages: NotePage[] = Array.from({ length: 12 }, (_, index) => page({
      id: `page-${index}`,
      kind: 'page',
      title: `Page ${index}`,
      updatedAt: `2026-06-${String(index + 1).padStart(2, '0')}T09:10:00.000Z`,
    }));

    expect(selectNoteIntakePages(pages, '2026-06-14')).toHaveLength(6);
    expect(selectNoteIntakePages(pages, '2026-06-14', 10)).toHaveLength(10);
  });

  it('ignores block ids and props while extracting note text', () => {
    const text = noteIntakeTextFromBlocks([
      { id: 'block-1', type: 'paragraph', content: [{ type: 'text', text: 'Ship the inbox bridge', props: { bold: true } }] },
      { id: 'block-2', children: [{ text: 'Keep Work Items chat-first' }] },
    ]);

    expect(text).toContain('Ship the inbox bridge');
    expect(text).toContain('Keep Work Items chat-first');
    expect(text).not.toContain('block-1');
    expect(text).not.toContain('bold');
  });

  it('falls back to a useful review prompt when a note has no body text', () => {
    const source = page({ id: 'inbox', kind: 'inbox', title: 'Inbox', updatedAt: '2026-06-14T09:10:00.000Z' });

    expect(noteIntakePromotionText(source, [])).toBe('Review note: Inbox\nUpdated: 2026-06-14T09:10:00.000Z');
  });
});
