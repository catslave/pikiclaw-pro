import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readSessionOutputs,
  resolveOutputPathAlias,
  saveSessionOutput,
} from '../src/agent/session-outputs';

const roots: string[] = [];

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-outputs-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('session output registry', () => {
  it('saves markdown content into the session workspace and indexes it', () => {
    const root = tmpRoot();
    const workspacePath = path.join(root, '.pikiclaw', 'sessions', 'codex', 's1', 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });

    const output = saveSessionOutput({
      workspacePath,
      workdir: root,
      agent: 'codex',
      sessionId: 's1',
      input: {
        id: 'plan-test',
        kind: 'document',
        title: 'Plan',
        summary: 'A small plan.',
        content: '## Plan\n\nDo the thing.',
      },
    });

    expect(output.id).toBe('plan-test');
    expect(output.path).toContain(`${path.sep}outputs${path.sep}`);
    expect(fs.readFileSync(output.path!, 'utf-8')).toContain('## Plan');

    const outputs = readSessionOutputs(workspacePath, { workdir: root, agent: 'codex', sessionId: 's1' });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: 'plan-test',
      title: 'Plan',
      taskId: 'session:s1',
      session: { workdir: root, agent: 'codex', sessionId: 's1' },
    });
  });

  it('registers an existing Obsidian-style path without copying it', () => {
    const root = tmpRoot();
    const workspacePath = path.join(root, '.pikiclaw', 'sessions', 'codex', 's1', 'workspace');
    const notePath = path.join(root, 'Obsidian Vault', 'repo', 'Personal', 'pikiclaw', 'report.md');
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(notePath, '# Report\n');

    const output = saveSessionOutput({
      workspacePath,
      workdir: root,
      agent: 'codex',
      sessionId: 's1',
      input: {
        title: 'Report',
        kind: 'document',
        path: notePath,
        summary: 'Saved in Obsidian.',
      },
    });

    expect(output.path).toBe(notePath);
    expect(readSessionOutputs(workspacePath)[0].summary).toBe('Saved in Obsidian.');
  });

  it('resolves workspace and workdir aliases', () => {
    const root = tmpRoot();
    const workspacePath = path.join(root, '.pikiclaw', 'sessions', 'codex', 's1', 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });

    expect(resolveOutputPathAlias('@workspace/report.md', workspacePath, root)).toBe(path.join(workspacePath, 'report.md'));
    expect(resolveOutputPathAlias('@workdir/report.md', workspacePath, root)).toBe(path.join(root, 'report.md'));
  });
});
