import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSessionMessages, listAgents, type StreamOpts } from '../src/agent/index.ts';
import { getRecommendedClis } from '../src/agent/cli/index.ts';
import { runAgentHealthCheck, startOpenClawGatewayService } from '../src/dashboard/routes/agents.ts';

const doOpenClawStream: any = async (_opts?: StreamOpts) => {
  throw new Error('OpenClaw is temporarily disabled.');
};

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
  for (const name of ['agy', 'claude', 'codex', 'copilot', 'cursor-agent', 'gemini', 'hermes']) {
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

describe.skip('OpenClaw integration (temporarily disabled)', () => {
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

  it('defaults OpenClaw turns to the Codex ACP agent', async () => {
    writeOpenClawScript(`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args));
console.log(JSON.stringify({ message: 'Codex ACP answer' }));
`);

    const result = await doOpenClawStream(baseOpts());

    expect(result.ok).toBe(true);
    const args = JSON.parse(fs.readFileSync(spawnLog, 'utf8'));
    expect(args).toEqual(expect.arrayContaining([
      '--agent', 'codex',
      '--session-key', `agent:codex:${result.sessionId}`,
    ]));
  });

  it('can target the OpenClaw Cursor ACP agent for routed capability turns', async () => {
    writeOpenClawScript(`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args));
console.log(JSON.stringify({ message: 'Cursor ACP answer' }));
`);

    const result = await doOpenClawStream(baseOpts({
      openclawAgent: 'cursor',
      openclawModel: 'openai/gpt-test',
      thinkingEffort: 'high',
    }));

    expect(result.ok).toBe(true);
    const args = JSON.parse(fs.readFileSync(spawnLog, 'utf8'));
    expect(args).toEqual(expect.arrayContaining([
      '--agent', 'cursor',
      '--session-key', `agent:cursor:${result.sessionId}`,
    ]));
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--thinking');
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
    const configPath = path.join(tmpDir, 'openclaw.json');
    fs.writeFileSync(configPath, JSON.stringify({
      agents: {
        list: [{ id: 'main', workspace: path.join(tmpDir, 'openclaw-workspace') }],
      },
    }));
    writeOpenClawScript(`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') {
  console.log('openclaw 2026.5.1');
  process.exit(0);
}
if (args[0] === 'setup') {
  console.log('setup complete');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === 'file') {
  console.log(${JSON.stringify(configPath)});
  process.exit(0);
}
if (args[0] === 'config' && args[1] === 'patch') {
  let stdin = '';
  process.stdin.on('data', chunk => { stdin += String(chunk); });
  process.stdin.on('end', () => {
    fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({ patch: JSON.parse(stdin) }) + '\\n');
    process.exit(0);
  });
  return;
}
if (args[0] === 'config' && args[1] === 'validate') {
  console.log('valid');
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

    const result = await startOpenClawGatewayService(tmpDir, {
      codexModel: 'gpt-5.5',
      codexReasoningEffort: 'high',
      cursorModel: 'cursor-auto',
      cursorReasoningEffort: 'medium',
      computerUseEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('started');
    const calls = fs.readFileSync(spawnLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toContainEqual(['setup']);
    expect(calls).toContainEqual(['config', 'file']);
    expect(calls).toContainEqual(['config', 'patch', '--stdin', '--replace-path', 'agents.list']);
    expect(calls).toContainEqual(['config', 'validate']);
    expect(calls).toContainEqual(['gateway', 'start']);
    expect(calls).toContainEqual(['gateway', 'status']);
    const patchCall = calls.find(call => !Array.isArray(call) && call.patch)?.patch;
    expect(patchCall.acp.enabled).toBe(true);
    expect(patchCall.acp.backend).toBe('acpx');
    expect(patchCall.acp.allowedAgents).toEqual(expect.arrayContaining(['codex', 'cursor']));
    expect(patchCall.plugins.entries.acpx.enabled).toBe(true);
    expect(patchCall.plugins.entries.acpx.config.cwd).toBe(tmpDir);
    expect(patchCall.plugins.entries.acpx.config.probeAgent).toBe('codex');
    expect(patchCall.plugins.entries.acpx.config.agents.cursor).toEqual({
      command: path.join(fakeBin, 'cursor-agent'),
      args: ['acp'],
    });
    if (process.platform === 'darwin') {
      expect(patchCall.mcp.servers['computer-use']).toEqual({
        command: 'npx',
        args: ['-y', '-p', '@steipete/peekaboo', 'peekaboo-mcp'],
      });
    }
    expect(patchCall.agents.list).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main' }),
      expect.objectContaining({
        id: 'codex',
        model: 'gpt-5.5',
        thinkingDefault: 'high',
        runtime: expect.objectContaining({
          type: 'acp',
          acp: expect.objectContaining({ agent: 'codex', backend: 'acpx', cwd: tmpDir }),
        }),
      }),
      expect.objectContaining({
        id: 'cursor',
        runtime: expect.objectContaining({
          type: 'acp',
          acp: expect.objectContaining({ agent: 'cursor', backend: 'acpx', cwd: tmpDir }),
        }),
      }),
    ]));
    const cursorPatch = patchCall.agents.list.find((agent: any) => agent.id === 'cursor');
    expect(cursorPatch).not.toHaveProperty('model');
    expect(cursorPatch).not.toHaveProperty('thinkingDefault');
  });
});
