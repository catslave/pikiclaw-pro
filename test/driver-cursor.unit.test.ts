import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doCursorStream } from '../src/agent/drivers/cursor.ts';
import type { StreamOpts } from '../src/agent/index.ts';

const tmpDir = path.join(os.tmpdir(), `pikiclaw-cursor-test-${process.pid}`);
const fakeBin = path.join(tmpDir, 'bin');
const spawnLog = path.join(tmpDir, 'cursor-args.json');
const originalPath = process.env.PATH;

function baseOpts(extra: Partial<StreamOpts> = {}): StreamOpts {
  return {
    agent: 'cursor',
    prompt: 'test prompt',
    workdir: tmpDir,
    timeout: 10,
    sessionId: null,
    model: null,
    thinkingEffort: 'medium',
    onText: () => {},
    ...extra,
  };
}

function writeCursorScript() {
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'cursor-agent'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args));
console.log(JSON.stringify({ type: 'system', model: 'Auto' }));
console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Cursor ' }] } }));
console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'Cursor answer' }));
`, { mode: 0o755 });
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  writeCursorScript();
  process.env.PATH = `${fakeBin}:${originalPath || ''}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Cursor driver', () => {
  it('does not pass --model auto to cursor-agent', async () => {
    const result = await doCursorStream(baseOpts({ cursorModel: 'auto' }));

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Cursor answer');
    const args = JSON.parse(fs.readFileSync(spawnLog, 'utf8'));
    expect(args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--stream-partial-output']));
    expect(args).not.toContain('--model');
    expect(args).not.toContain('auto');
  });

  it('passes explicit Cursor models through', async () => {
    const result = await doCursorStream(baseOpts({ cursorModel: 'gpt-5.2' }));

    expect(result.ok).toBe(true);
    const args = JSON.parse(fs.readFileSync(spawnLog, 'utf8'));
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-5.2']));
  });
});
