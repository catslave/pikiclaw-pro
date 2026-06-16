import type { NotePage } from '../../types';
import {
  noteIntakeKindLabel,
  noteIntakePageLabel,
  selectNoteIntakePages,
} from './noteIntake';

export interface WorkItemNoteCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  keys: string[];
  tone: 'primary' | 'ok' | 'warn' | 'idle';
  keywords: string[];
}

export interface WorkItemNoteCommandOptions {
  todayDate: string;
  limit?: number;
}

function noteTone(page: NotePage, todayDate: string): WorkItemNoteCommandItem['tone'] {
  if (page.kind === 'daily' && page.date === todayDate) return 'primary';
  if (page.kind === 'inbox') return 'ok';
  return 'idle';
}

function noteKeys(page: NotePage, todayDate: string): string[] {
  if (page.kind === 'daily' && page.date === todayDate) return ['Today', 'Note'];
  if (page.kind === 'daily') return ['Daily', 'Note'];
  if (page.kind === 'inbox') return ['Inbox', 'Note'];
  return ['Note'];
}

function noteUrl(page: NotePage): string {
  const params = new URLSearchParams();
  params.set('source', 'manual');
  if (page.date) params.set('date', page.date);
  params.set('note', page.id);
  return `/work-items?${params.toString()}`;
}

export function buildWorkItemNoteCommandItems(
  pages: NotePage[],
  options: WorkItemNoteCommandOptions,
): WorkItemNoteCommandItem[] {
  const limit = options.limit ?? 12;
  return selectNoteIntakePages(pages, options.todayDate, limit).map(page => {
    const label = noteIntakePageLabel(page);
    const kind = noteIntakeKindLabel(page);
    return {
      key: `note:${page.id}`,
      title: `${kind}: ${label}`,
      detail: `${page.date || 'No date'} · Updated ${page.updatedAt}${page.parentId ? ` · parent ${page.parentId}` : ''}`,
      to: noteUrl(page),
      secondaryTo: `/notes/${encodeURIComponent(page.id)}`,
      secondaryLabel: 'Open note',
      keys: noteKeys(page, options.todayDate),
      tone: noteTone(page, options.todayDate),
      keywords: [
        'note intake',
        'notes intake',
        'promote note',
        'note to work item',
        'daily note',
        'inbox note',
        'work item intake',
        page.id,
        page.kind,
        page.title,
        page.date || '',
        page.parentId || '',
        label,
        kind,
      ].filter(Boolean),
    };
  });
}
