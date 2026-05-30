import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectAgentBin } from '../src/agent/index.ts';
import { resolveAgentUpdateStrategy } from '../src/agent/auto-update.ts';

const tmpDir = path.join(os.tmpdir(), `pikiclaw-agent-update-test-${process.pid}`);
const binDir = path.join(tmpDir, 'bin');
const originalPath = process.env.PATH;

function writeExecutable(filePath: string, body = '#!/bin/sh\necho ok\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });
  process.env.PATH = `${binDir}:${originalPath || ''}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('agent update and detection stability', () => {
  it('keeps an installed agent visible through a transient binary miss', () => {
    const cmd = `flaky-agent-${process.pid}`;
    const binPath = path.join(binDir, cmd);
    writeExecutable(binPath);

    const first = detectAgentBin(cmd, `flaky-${process.pid}`, { refresh: true });
    expect(first.installed).toBe(true);
    expect(first.path).toBe(binPath);

    fs.rmSync(binPath);
    const second = detectAgentBin(cmd, `flaky-${process.pid}`, { refresh: true });
    expect(second.installed).toBe(true);
    expect(second.path).toBe(binPath);
  });

  it('recognizes npm-owned binaries from the binary path prefix', () => {
    const prefix = path.join(tmpDir, 'node-prefix');
    const packageDir = path.join(prefix, 'lib', 'node_modules', 'openclaw');
    const binPath = path.join(prefix, 'bin', 'openclaw');
    writeExecutable(path.join(packageDir, 'openclaw.mjs'));
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.symlinkSync('../lib/node_modules/openclaw/openclaw.mjs', binPath);

    expect(resolveAgentUpdateStrategy({ agent: 'openclaw', path: binPath }, null, null))
      .toEqual({ kind: 'npm', pkg: 'openclaw' });
  });

  it('updates a self-managed Copilot binary through copilot update instead of npm', () => {
    const prefix = path.join(tmpDir, 'node-prefix');
    const managedCopilot = path.join(tmpDir, 'gh-copilot', 'copilot');
    const binPath = path.join(prefix, 'bin', 'copilot');
    writeExecutable(managedCopilot);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.symlinkSync(managedCopilot, binPath);

    expect(resolveAgentUpdateStrategy({ agent: 'copilot', path: binPath }, null, null))
      .toEqual({ kind: 'self', cmd: binPath, args: ['update'] });
  });
});
