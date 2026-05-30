import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import { createTodoItem, deleteTodoItem, listTodoItems, updateTodoItem } from '../src/pro/todos.ts';

let tmpDir: string;
let previousTodoFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-todos-');
  previousTodoFile = process.env.PIKICLAW_PRO_TODO_FILE;
  process.env.PIKICLAW_PRO_TODO_FILE = path.join(tmpDir, 'todos.json');
});

afterEach(() => {
  if (previousTodoFile == null) delete process.env.PIKICLAW_PRO_TODO_FILE;
  else process.env.PIKICLAW_PRO_TODO_FILE = previousTodoFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Pro todo store', () => {
  it('persists quick todos and chat-selection review comments with source references', () => {
    const todo = createTodoItem({
      body: 'Check whether automation should run before refinement.',
      source: { type: 'quick-capture', workdir: '/repo/app' },
    });
    expect(todo.kind).toBe('todo');
    expect(todo.status).toBe('open');
    expect(todo.source?.type).toBe('quick-capture');

    const comment = createTodoItem({
      kind: 'review-comment',
      title: 'Need better error boundary',
      body: 'Please revisit this output before coding.',
      source: {
        type: 'review-comment',
        workdir: '/repo/app',
        agent: 'codex',
        sessionId: 'session-1',
        turnIndex: 3,
        quote: 'Current implementation swallows the error.',
      },
    });

    expect(comment.kind).toBe('review-comment');
    expect(comment.source?.quote).toContain('swallows');
    expect(listTodoItems().map(item => item.id)).toEqual([comment.id, todo.id]);
  });

  it('deletes todo items', () => {
    const todo = createTodoItem({ body: 'Remove this captured follow-up.' });
    expect(listTodoItems()).toHaveLength(1);

    const deleted = deleteTodoItem(todo.id);

    expect(deleted.id).toBe(todo.id);
    expect(listTodoItems()).toHaveLength(0);
  });

  it('persists image attachments and updates todo content', () => {
    const todo = createTodoItem({
      body: 'Check this screenshot.',
      images: [{
        id: 'image-1',
        kind: 'image',
        name: 'screen.png',
        mimeType: 'image/png',
        size: 12,
        dataUrl: 'data:image/png;base64,aGVsbG8=',
      }],
    });

    expect(todo.images?.[0]?.name).toBe('screen.png');

    const updated = updateTodoItem(todo.id, {
      title: 'Updated screenshot note',
      body: 'Use the new screenshot.',
      images: [{
        id: 'image-2',
        kind: 'image',
        name: 'new-screen.png',
        mimeType: 'image/png',
        size: 16,
        dataUrl: 'data:image/png;base64,d29ybGQ=',
      }],
    });

    expect(updated.title).toBe('Updated screenshot note');
    expect(updated.body).toBe('Use the new screenshot.');
    expect(updated.images).toHaveLength(1);
    expect(updated.images?.[0]?.name).toBe('new-screen.png');
    expect(listTodoItems()[0].id).toBe(todo.id);
  });
});
