import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agyArgs, doAgyStream } from '../src/agent/drivers/agy.js';
import type { StreamOpts } from '../src/agent/types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function baseOpts(extra: Partial<StreamOpts> = {}): StreamOpts {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-agy-'));
  tmpDirs.push(workdir);
  return {
    agent: 'agy',
    workdir,
    prompt: 'hello',
    timeout: 30,
    onText: () => {},
    ...extra,
  };
}

describe('agy driver', () => {
  it('builds headless print args with permissions and workspace dir', () => {
    const workdir = '/tmp/project';
    const args = agyArgs({ workdir, agySandbox: true } as StreamOpts, 'do thing');
    expect(args).toEqual([
      '-p', 'do thing',
      '--dangerously-skip-permissions',
      '--add-dir', workdir,
      '--sandbox',
    ]);
  });

  it('does not duplicate flags already present in agyExtraArgs', () => {
    const args = agyArgs({
      workdir: '/tmp/project',
      agyExtraArgs: ['--dangerously-skip-permissions', '--add-dir', '/other', '--sandbox'],
    } as StreamOpts, 'x');
    expect(args).toEqual(['-p', 'x', '--dangerously-skip-permissions', '--add-dir', '/other', '--sandbox']);
  });

  it('runs agy print mode and stores transcript output', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-agy-run-'));
    tmpDirs.push(tmpDir);
    const fakeBin = path.join(tmpDir, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const script = `#!/usr/bin/env node
const prompt = process.argv[process.argv.indexOf('-p') + 1] || '';
process.stdout.write('agy says: ' + prompt.trim());
process.exit(0);
`;
    fs.writeFileSync(path.join(fakeBin, 'agy'), script, { mode: 0o755 });

    const workdir = fs.mkdtempSync(path.join(tmpDir, 'repo-'));
    const result = await doAgyStream(baseOpts({
      workdir,
      prompt: 'ping',
      extraEnv: { PATH: `${fakeBin}:${process.env.PATH || ''}` },
    }));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('agy says:');
    const transcriptDir = path.join(workdir, '.pikiclaw', 'simple-cli-transcripts', 'agy');
    expect(fs.existsSync(transcriptDir)).toBe(true);
  });
});
