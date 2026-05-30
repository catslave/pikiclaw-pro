import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContextSourceBundle, normalizeSessionContextSources } from '../src/agent/index.ts';

describe('context sources', () => {
  it('normalizes to one session source plus multiple output sources', () => {
    const sources = normalizeSessionContextSources([
      { kind: 'session', workdir: '/tmp/a', agent: 'codex', sessionId: 's1' },
      { kind: 'session', workdir: '/tmp/b', agent: 'codex', sessionId: 's2' },
      { kind: 'output', workdir: '/tmp/a', agent: 'codex', sessionId: 's1', outputId: 'out-1', title: 'One' },
      { kind: 'output', workdir: '/tmp/a', agent: 'codex', sessionId: 's1', outputId: 'out-2', title: 'Two' },
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
});
