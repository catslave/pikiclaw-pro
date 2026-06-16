import type { NotePage } from '../../types';

export function noteIntakePageLabel(page: NotePage): string {
  if (page.kind === 'daily') return page.date ? `Daily ${page.date}` : page.title || 'Daily note';
  return page.title || 'Untitled note';
}

export function noteIntakeKindLabel(page: NotePage): string {
  if (page.kind === 'inbox') return 'Inbox note';
  if (page.kind === 'daily') return 'Daily note';
  return 'Note page';
}

function collectNoteText(value: unknown, parts: string[] = []): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) parts.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) collectNoteText(item, parts);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' || key === 'props') continue;
      collectNoteText(item, parts);
    }
  }
  return parts;
}

export function noteIntakeTextFromBlocks(blocks: unknown[], max = 16_000): string {
  const text = collectNoteText(blocks).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function noteIntakePromotionText(page: NotePage, blocks: unknown[]): string {
  const body = noteIntakeTextFromBlocks(blocks);
  if (body) return body;
  return `Review note: ${noteIntakePageLabel(page)}\nUpdated: ${page.updatedAt}`;
}

function noteIntakeRank(page: NotePage, todayDate: string): number {
  if (page.kind === 'daily' && page.date === todayDate) return 40;
  if (page.kind === 'inbox') return 32;
  if (page.kind === 'daily') return 20;
  return 10;
}

export function selectNoteIntakePages(pages: NotePage[], todayDate: string, limit = 6): NotePage[] {
  return pages
    .filter(page => !page.deletedAt)
    .sort((a, b) => (
      noteIntakeRank(b, todayDate) - noteIntakeRank(a, todayDate)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      || noteIntakePageLabel(a).localeCompare(noteIntakePageLabel(b))
    ))
    .slice(0, limit);
}
