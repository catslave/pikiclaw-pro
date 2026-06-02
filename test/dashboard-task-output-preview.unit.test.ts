import { describe, expect, it } from 'vitest';
import { isMarkdownOutputPath, outputMarkdownPath } from '../dashboard/src/pages/jira/task-output-preview.ts';

describe('task output markdown preview helpers', () => {
  it('detects markdown output paths', () => {
    expect(isMarkdownOutputPath('notes.md')).toBe(true);
    expect(isMarkdownOutputPath('docs/plan.markdown')).toBe(true);
    expect(isMarkdownOutputPath('src/App.tsx')).toBe(false);
  });

  it('prefers explicit output path over summary references', () => {
    expect(outputMarkdownPath({
      path: 'artifacts/plan.md',
      summary: 'See `other.md` for details.',
    })).toBe('artifacts/plan.md');
  });

  it('extracts markdown path from summary when output path is missing', () => {
    expect(outputMarkdownPath({
      summary: 'Saved [goal.md](goal.md) for review.',
    })).toBe('goal.md');
  });
});
