import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContextSourceBundle, normalizeSessionContextSources } from '../src/agent/index.ts';

describe('context sources', () => {
  it('normalizes to one session source plus multiple output and file sources', () => {
    const sources = normalizeSessionContextSources([
      { kind: 'session', workdir: '/tmp/a', agent: 'codex', sessionId: 's1' },
      { kind: 'session', workdir: '/tmp/b', agent: 'codex', sessionId: 's2' },
      { kind: 'output', workdir: '/tmp/a', agent: 'codex', sessionId: 's1', outputId: 'out-1', title: 'One' },
      { kind: 'output', workdir: '/tmp/a', agent: 'codex', sessionId: 's1', outputId: 'out-2', title: 'Two' },
      { kind: 'file', workdir: '/tmp/a', path: '/tmp/a/.pikiclaw/reference/spec.md', title: 'Spec', source: 'project-reference', size: 42 },
    ]);

    expect(sources).toEqual([
      {
        kind: 'session',
        workdir: '/tmp/a',
        agent: 'codex',
        sessionId: 's1',
        title: null,
        mode: 'compact',
        lastNTurns: null,
        turnStart: null,
        turnEnd: null,
      },
      {
        kind: 'output',
        workdir: '/tmp/a',
        agent: 'codex',
        sessionId: 's1',
        outputId: 'out-1',
        title: 'One',
        summary: null,
        path: null,
        url: null,
        turnIndex: null,
      },
      {
        kind: 'output',
        workdir: '/tmp/a',
        agent: 'codex',
        sessionId: 's1',
        outputId: 'out-2',
        title: 'Two',
        summary: null,
        path: null,
        url: null,
        turnIndex: null,
      },
      {
        kind: 'file',
        workdir: '/tmp/a',
        path: '/tmp/a/.pikiclaw/reference/spec.md',
        title: 'Spec',
        source: 'project-reference',
        size: 42,
      },
    ]);
  });

  it('builds a source bundle with output metadata and bounded inline text', async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-context-bundle-'));
    fs.writeFileSync(path.join(workdir, 'notes.txt'), 'important output body');

    const bundle = await buildContextSourceBundle({
      targetAgent: 'codex',
      sources: [{
        kind: 'output',
        workdir,
        agent: 'codex',
        sessionId: 'source-session',
        outputId: 'out-1',
        title: 'Output One',
        summary: 'Short summary',
        path: 'notes.txt',
      }],
    });

    expect(bundle).toContain('<pikiclaw_context type="source-bundle">');
    expect(bundle).toContain('<source kind="output" output_id="out-1"');
    expect(bundle).toContain('Title: Output One');
    expect(bundle).toContain('Summary:');
    expect(bundle).toContain('Path: notes.txt');
    expect(bundle).toContain('Inline content:');
    expect(bundle).toContain('important output body');
  });

  it('inlines project reference files and skips files outside the reference pool', async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-file-context-'));
    const referenceDir = path.join(workdir, '.pikiclaw', 'reference');
    fs.mkdirSync(referenceDir, { recursive: true });
    const referencePath = path.join(referenceDir, 'brief.md');
    const outsidePath = path.join(workdir, 'secret.md');
    fs.writeFileSync(referencePath, 'reference material for this project');
    fs.writeFileSync(outsidePath, 'outside material should not be inlined');

    const bundle = await buildContextSourceBundle({
      targetAgent: 'codex',
      sources: [
        { kind: 'file', workdir, path: referencePath, title: 'Project Brief', source: 'project-reference' },
        { kind: 'file', workdir, path: outsidePath, title: 'Secret', source: 'project-reference' },
      ],
    });

    expect(bundle).toContain('<source kind="file" source="project-reference"');
    expect(bundle).toContain('Title: Project Brief');
    expect(bundle).toContain('reference material for this project');
    expect(bundle).toContain('Skipped: file is outside the project reference pool.');
    expect(bundle).not.toContain('outside material should not be inlined');
  });
});
