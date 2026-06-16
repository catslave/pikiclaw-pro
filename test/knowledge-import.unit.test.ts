import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importProjectReferencesAsKnowledge } from '../src/pro/knowledge-import.ts';
import { listKnowledgeEntries } from '../src/pro/workflow.ts';
import { makeTmpDir } from './support/env.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-knowledge-import-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
});

afterEach(() => {
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Project reference knowledge import', () => {
  it('imports readable project reference files as sourced memory entries', () => {
    const workdir = path.join(tmpDir, 'repo');
    const referenceDir = path.join(workdir, '.pikiclaw', 'reference');
    fs.mkdirSync(path.join(referenceDir, 'folder'), { recursive: true });
    fs.writeFileSync(path.join(referenceDir, 'architecture.md'), '# Architecture\n\nStable project facts.');
    fs.writeFileSync(path.join(referenceDir, 'brief.txt'), 'Brief line\nMore context.');

    const result = importProjectReferencesAsKnowledge({ workdir, status: 'published' });

    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toEqual([
      expect.objectContaining({ path: path.join(referenceDir, 'folder'), reason: 'not a file' }),
    ]);
    expect(listKnowledgeEntries({ workspace: workdir })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'brief',
        status: 'published',
        createdBy: 'auto',
        tags: expect.arrayContaining(['project-reference', 'imported', 'wiki']),
        sourceRefs: [expect.objectContaining({
          type: 'file',
          path: path.join(referenceDir, 'brief.txt'),
          sourceFreshness: 'fresh',
          sourceHash: expect.any(String),
          sourceCheckedAt: expect.any(String),
        })],
      }),
      expect.objectContaining({
        title: 'architecture',
        summary: 'Architecture',
        sourceRefs: [expect.objectContaining({ type: 'file', path: path.join(referenceDir, 'architecture.md') })],
      }),
    ]));

    const second = importProjectReferencesAsKnowledge({ workdir });
    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(referenceDir, 'architecture.md'), reason: 'already imported' }),
      expect.objectContaining({ path: path.join(referenceDir, 'brief.txt'), reason: 'already imported' }),
    ]));
  });
});
