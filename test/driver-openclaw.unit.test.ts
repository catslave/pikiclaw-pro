import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doOpenClawStream, getSessionMessages, listAgents, type StreamOpts } from '../src/agent/index.ts';
import { getRecommendedClis } from '../src/agent/cli/index.ts';
import { runAgentHealthCheck, startOpenClawGatewayService } from '../src/dashboard/routes/agents.ts';

const tmpDir = path.join(os.tmpdir(), `pikiclaw-openclaw-test-${process.pid}`);
const fakeBin = path.join(tmpDir, 'bin');
const spawnLog = path.join(tmpDir, 'openclaw-args.json');
const originalPath = process.env.PATH;
const originalNvmDir = process.env.NVM_DIR;

function baseOpts(extra: Partial<StreamOpts> = {}): StreamOpts {
  return {
    agent: 'openclaw',
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

function writeOpenClawScript(body: string) {
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'openclaw'), `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
}

function writeFastAgentStubs() {
  for (const name of ['claude', 'codex', 'copilot', 'cursor-agent', 'gemini', 'hermes']) {
    fs.writeFileSync(path.join(fakeBin, name), `#!/bin/sh\necho "${name} 0.0.0"\n`, { mode: 0o755 });
  }
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  writeFastAgentStubs();
  process.env.PATH = `${fakeBin}:${originalPath || ''}`;
  process.env.NVM_DIR = path.join(tmpDir, '.nvm');
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalNvmDir === undefined) delete process.env.NVM_DIR;
  else process.env.NVM_DIR = originalNvmDir;
  delete process.env.OPENCLAW_AGENT_ID;
});

describe('OpenClaw integration', () => {
  it('registers the OpenClaw driver and CLI catalog item', () => {
    const agents = listAgents({ includeVersion: false }).agents.map(agent => agent.agent);
    expect(agents).toContain('openclaw');
    expect(getRecommendedClis().some(cli => cli.id === 'openclaw' && cli.binary === 'openclaw')).toBe(true);
  });

  it('runs OpenClaw via Gateway JSON with the pikiclaw session key', async () => {
    writeOpenClawScript(`
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('openclaw 2026.5.1');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args));
console.log(JSON.stringify({ message: { content: 'OpenClaw answer' }, model: 'openai/gpt-test' }));
`);

    const result = await doOpenClawStream(baseOpts({
      openclawModel: 'openai/gpt-test',
      openclawExtraArgs: ['--agent', 'ops', '--local'],
    }));

    expect(result.ok).toBe(true);
    expect(result.message).toBe('OpenClaw answer');
    expect(result.model).toBe('openai/gpt-test');
    const args = JSON.parse(fs.readFileSync(spawnLog, 'utf8'));
    expect(args).toContain('agent');
    expect(args).toContain('--json');
    expect(args).toContain('--local');
    expect(args).toEqual(expect.arrayContaining([
      '--agent', 'ops',
      '--session-key', `agent:ops:${result.sessionId}`,
      '--message', 'test prompt',
      '--model', 'openai/gpt-test',
      '--thinking', 'medium',
    ]));

    const messages = await getSessionMessages({
      agent: 'openclaw',
      workdir: tmpDir,
      sessionId: result.sessionId!,
      rich: true,
    });
    expect(messages.messages.map(message => message.text)).toContain('OpenClaw answer');
  });

  it('surfaces invalid OpenClaw JSON as a clear driver error', async () => {
    writeOpenClawScript(`
process.stdout.write('not json');
`);

    const result = await doOpenClawStream(baseOpts());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid JSON');
    expect(result.message).toContain('invalid JSON');
  });

  it('checks OpenClaw Gateway health distinctly from CLI installation', async () => {
    writeOpenClawScript(`
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('openclaw 2026.5.1');
  process.exit(0);
}
if (args[0] === 'gateway' && args[1] === 'status') {
  console.error('Gateway is not running');
  process.exit(2);
}
process.exit(0);
`);

    const result = await runAgentHealthCheck('openclaw', tmpDir);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Gateway is not running');
    expect(result.output).toContain('Gateway is not running');
  });

  it('starts the OpenClaw Gateway service from the agent card action', async () => {
    writeOpenClawScript(`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') {
  console.log('openclaw 2026.5.1');
  process.exit(0);
}
if (args[0] === 'gateway' && args[1] === 'start') {
  console.log('started');
  process.exit(0);
}
if (args[0] === 'gateway' && args[1] === 'status') {
  console.log('Gateway running');
  process.exit(0);
}
process.exit(0);
`);

    const result = await startOpenClawGatewayService(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('started');
    const calls = fs.readFileSync(spawnLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toContainEqual(['gateway', 'start']);
    expect(calls).toContainEqual(['gateway', 'status']);
  });
});
