import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import { buildAutomationRunPrompt, collectAutomationContextSources } from '../src/pro/automation-context.ts';

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  tmpDir = null;
});

describe('automation context sources', () => {
  it('collects live project reference files for scheduled tasks', () => {
    tmpDir = makeTmpDir('pikiclaw-automation-context-');
    const referenceDir = path.join(tmpDir, '.pikiclaw', 'reference');
    fs.mkdirSync(referenceDir, { recursive: true });
    fs.writeFileSync(path.join(referenceDir, 'b.md'), 'beta');
    fs.writeFileSync(path.join(referenceDir, 'a.md'), 'alpha');
    fs.writeFileSync(path.join(tmpDir, 'outside.md'), 'outside');
    fs.mkdirSync(path.join(referenceDir, 'folder'));

    expect(collectAutomationContextSources({ workdir: tmpDir, includeProjectReferences: false })).toEqual([]);

    const sources = collectAutomationContextSources({ workdir: tmpDir, includeProjectReferences: true });
    expect(sources).toEqual([
      {
        kind: 'file',
        workdir: path.resolve(tmpDir),
        path: path.join(referenceDir, 'a.md'),
        title: 'a.md',
        source: 'project-reference',
      },
      {
        kind: 'file',
        workdir: path.resolve(tmpDir),
        path: path.join(referenceDir, 'b.md'),
        title: 'b.md',
        source: 'project-reference',
      },
    ]);
  });

  it('filters scheduled task project references by saved file names', () => {
    tmpDir = makeTmpDir('pikiclaw-automation-context-');
    const referenceDir = path.join(tmpDir, '.pikiclaw', 'reference');
    fs.mkdirSync(referenceDir, { recursive: true });
    fs.writeFileSync(path.join(referenceDir, 'a.md'), 'alpha');
    fs.writeFileSync(path.join(referenceDir, 'b.md'), 'beta');
    fs.writeFileSync(path.join(referenceDir, 'c.md'), 'gamma');

    const sources = collectAutomationContextSources({
      workdir: tmpDir,
      includeProjectReferences: true,
      projectReferenceNames: ['c.md', 'missing.md', 'a.md'],
    });

    expect(sources.map(source => source.title)).toEqual(['a.md', 'c.md']);
    expect(collectAutomationContextSources({
      workdir: tmpDir,
      includeProjectReferences: true,
      projectReferenceNames: [],
    })).toEqual([]);
  });

  it('wraps scheduled task prompts with execution context', () => {
    const prompt = buildAutomationRunPrompt({
      name: 'Daily review',
      schedule: 'daily@09:00',
      prompt: 'Summarize project status.',
    });

    expect(prompt).toContain('[Scheduled Task Context]');
    expect(prompt).toContain('Task: Daily review');
    expect(prompt).toContain('Schedule: daily@09:00');
    expect(prompt).toContain('not an ordinary user chat');
    expect(prompt).toContain('Summarize project status.');
  });

  it('does not double-wrap existing scheduled task context', () => {
    const original = '[Scheduled Task Context]\nTask: Existing\n[/Scheduled Task Context]\n\nDo work.';
    expect(buildAutomationRunPrompt({ name: 'Ignored', schedule: 'manual', prompt: original })).toBe(original);
  });
});
