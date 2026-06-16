import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import type { TodoItem } from '../dashboard/src/types.ts';
import { TodoEvidenceSummary } from '../dashboard/src/work-items/TodoEvidenceSummary.tsx';

function todoWithImage(): TodoItem {
  return {
    id: 'todo-image',
    kind: 'todo',
    title: 'Inspect screenshot',
    body: 'Screenshot is the evidence.',
    status: 'open',
    createdAt: '2026-06-15T01:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
    images: [{
      id: 'img-1',
      kind: 'image',
      name: 'screen.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,abcd',
    }],
  };
}

function collectElements(node: ReactNode, type: string, output: any[] = []): any[] {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, type, output);
    return output;
  }
  const element = node as any;
  if (element.type === type) output.push(element);
  collectElements(element.props?.children, type, output);
  return output;
}

describe('TodoEvidenceSummary image actions', () => {
  it('keeps image thumbnails static unless a preview handler is provided', () => {
    const tree = TodoEvidenceSummary({
      item: todoWithImage(),
      copy: { linkedChat: 'Linked chat', sourceQuote: 'Quote', sourceSession: 'Session' },
    });

    expect(collectElements(tree, 'img')).toHaveLength(1);
    expect(collectElements(tree, 'button')).toHaveLength(0);
  });

  it('turns image thumbnails into preview buttons when requested', () => {
    let clicked = '';
    const tree = TodoEvidenceSummary({
      item: todoWithImage(),
      copy: { linkedChat: 'Linked chat', sourceQuote: 'Quote', sourceSession: 'Session' },
      onImageClick: image => { clicked = image.name; },
    });
    const buttons = collectElements(tree, 'button');

    expect(buttons).toHaveLength(1);
    buttons[0].props.onClick();
    expect(clicked).toBe('screen.png');
  });
});
