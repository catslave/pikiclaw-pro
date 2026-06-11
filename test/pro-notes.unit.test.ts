import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createNotePage,
  deleteNotePage,
  getNotePage,
  getOrCreateDailyNote,
  listNoteTree,
  readNoteDocument,
  reorderNotePages,
  resolveNoteAsset,
  saveNoteAsset,
  searchNotes,
  updateNotePage,
  writeNoteDocument,
} from '../src/pro/notes.ts';

let tmpDir: string;
let previousNotesDir: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-notes-');
  previousNotesDir = process.env.PIKICLAW_PRO_NOTES_DIR;
  process.env.PIKICLAW_PRO_NOTES_DIR = path.join(tmpDir, 'notes');
});

afterEach(() => {
  if (previousNotesDir == null) delete process.env.PIKICLAW_PRO_NOTES_DIR;
  else process.env.PIKICLAW_PRO_NOTES_DIR = previousNotesDir;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Pro notes store', () => {
  it('initializes the default inbox and creates nested pages', () => {
    const initial = listNoteTree();
    expect(initial.inboxId).toBe('inbox');
    expect(initial.pages.find(page => page.id === 'inbox')).toMatchObject({
      kind: 'inbox',
      title: 'Inbox',
    });

    const parent = createNotePage({ title: 'Ideas' });
    const child = createNotePage({ title: 'Product notes', parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
    expect(readNoteDocument(child.id)).toEqual([{ type: 'paragraph', content: [] }]);
  });

  it('reorders sibling pages within the same parent', () => {
    const first = createNotePage({ title: 'First' });
    const second = createNotePage({ title: 'Second' });
    const third = createNotePage({ title: 'Third' });

    reorderNotePages(null, [third.id, first.id, second.id]);

    const rootIds = listNoteTree()
      .pages
      .filter(page => !page.deletedAt && page.kind === 'page' && !page.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(page => page.id);
    expect(rootIds).toEqual([third.id, first.id, second.id]);
  });

  it('opens the same daily page for repeated calls on one date', () => {
    const first = getOrCreateDailyNote('2026-06-06');
    const second = getOrCreateDailyNote('2026-06-06');

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      kind: 'daily',
      date: '2026-06-06',
      title: 'Daily 2026-06-06',
    });
  });

  it('persists and searches BlockNote-style document blocks', () => {
    const page = createNotePage({ title: 'Notebook architecture' });
    writeNoteDocument(page.id, [
      {
        id: 'block-1',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Capture loose thoughts before they become tasks.' }],
      },
    ]);

    expect(readNoteDocument(page.id)).toHaveLength(1);
    const results = searchNotes('loose thoughts');

    expect(results.map(result => result.page.id)).toContain(page.id);
    expect(results[0].snippet).toContain('loose thoughts');
  });

  it('soft deletes, restores, and permanently deletes a page with document and assets', () => {
    const page = createNotePage({ title: 'Temporary note' });
    writeNoteDocument(page.id, [{ type: 'paragraph', content: [{ type: 'text', text: 'remove me' }] }]);
    const asset = saveNoteAsset(page.id, {
      name: 'screen.png',
      mimeType: 'image/png',
      bytes: Buffer.from('hello'),
    });
    const assetFile = resolveNoteAsset(page.id, asset.fileName).filePath;
    expect(fs.existsSync(assetFile)).toBe(true);

    deleteNotePage(page.id);
    expect(getNotePage(page.id)?.deletedAt).toBeTruthy();

    updateNotePage(page.id, { deletedAt: null });
    expect(getNotePage(page.id)?.deletedAt).toBeUndefined();

    deleteNotePage(page.id, true);
    expect(getNotePage(page.id)).toBeNull();
    expect(fs.existsSync(assetFile)).toBe(false);
  });

  it('validates image assets and sanitizes uploaded filenames', () => {
    const page = createNotePage({ title: 'Screenshots' });
    const asset = saveNoteAsset(page.id, {
      name: '../../bad name.png',
      mimeType: 'image/png',
      bytes: Buffer.from('image-bytes'),
    });

    expect(asset.fileName).not.toContain('..');
    expect(resolveNoteAsset(page.id, asset.fileName)).toMatchObject({ mimeType: 'image/png' });
    expect(() => resolveNoteAsset(page.id, '../outside.png')).toThrow(/invalid note asset path/);
    expect(() => saveNoteAsset(page.id, {
      name: 'plain.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('nope'),
    })).toThrow(/only image assets/);
  });
});
