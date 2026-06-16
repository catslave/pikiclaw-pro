import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refreshKnowledgeEntrySources } from '../src/pro/knowledge-source-freshness.ts';
import { createKnowledgeEntry } from '../src/pro/workflow.ts';
import { makeTmpDir } from './support/env.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-knowledge-source-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
});

afterEach(() => {
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('knowledge source freshness', () => {
  it('detects stale file sources and accepts the current source as the new baseline', () => {
    const workdir = path.join(tmpDir, 'repo');
    fs.mkdirSync(workdir, { recursive: true });
    const sourcePath = path.join(workdir, 'brief.md');
    fs.writeFileSync(sourcePath, 'Original source\n');

    const entry = createKnowledgeEntry({
      title: 'Brief',
      body: 'Original source',
      sourceRefs: [{ type: 'file', workdir, path: sourcePath, title: 'brief.md' }],
    });

    const baseline = refreshKnowledgeEntrySources(entry.id, {
      acceptCurrent: true,
      now: new Date('2026-06-14T01:00:00.000Z'),
    });
    expect(baseline.aggregate).toBe('fresh');
    expect(baseline.entry.sourceRefs[0]).toEqual(expect.objectContaining({
      sourceFreshness: 'fresh',
      sourceHash: expect.any(String),
      sourceCurrentHash: expect.any(String),
      sourceCheckedAt: '2026-06-14T01:00:00.000Z',
    }));

    fs.writeFileSync(sourcePath, 'Changed source\n');
    const stale = refreshKnowledgeEntrySources(entry.id, {
      now: new Date('2026-06-14T02:00:00.000Z'),
    });
    expect(stale.aggregate).toBe('stale');
    expect(stale.stale).toBe(1);
    expect(stale.entry.sourceRefs[0]).toEqual(expect.objectContaining({
      sourceFreshness: 'stale',
      sourceCheckedAt: '2026-06-14T02:00:00.000Z',
    }));
    expect(stale.entry.sourceRefs[0].sourceHash).not.toBe(stale.entry.sourceRefs[0].sourceCurrentHash);

    const repaired = refreshKnowledgeEntrySources(entry.id, {
      acceptCurrent: true,
      now: new Date('2026-06-14T03:00:00.000Z'),
    });
    expect(repaired.aggregate).toBe('fresh');
    expect(repaired.entry.sourceRefs[0]).toEqual(expect.objectContaining({
      sourceFreshness: 'fresh',
      sourceAcceptedAt: '2026-06-14T03:00:00.000Z',
    }));
    expect(repaired.entry.sourceRefs[0].sourceHash).toBe(repaired.entry.sourceRefs[0].sourceCurrentHash);
  });

  it('marks missing file sources without dropping the source trail', () => {
    const workdir = path.join(tmpDir, 'repo');
    fs.mkdirSync(workdir, { recursive: true });
    const sourcePath = path.join(workdir, 'missing.md');
    const entry = createKnowledgeEntry({
      title: 'Missing source',
      body: 'The cited source was removed.',
      sourceRefs: [{ type: 'file', workdir, path: sourcePath, title: 'missing.md' }],
    });

    const result = refreshKnowledgeEntrySources(entry.id, {
      now: new Date('2026-06-14T04:00:00.000Z'),
    });

    expect(result.aggregate).toBe('missing');
    expect(result.missing).toBe(1);
    expect(result.entry.sourceRefs[0]).toEqual(expect.objectContaining({
      path: sourcePath,
      sourceFreshness: 'missing',
      sourceCheckedAt: '2026-06-14T04:00:00.000Z',
      sourceError: expect.any(String),
    }));
  });
});
