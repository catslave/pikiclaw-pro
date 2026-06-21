import { describe, expect, it } from 'vitest';
import type { AgentRuntimeStatus } from '../dashboard/src/types';
import { summarizeAgentParity } from '../dashboard/src/pages/wayland/agentParity';
import { getDriverCapabilities } from '../src/agent/index.ts';

function agent(agentName: string, installed = true): AgentRuntimeStatus {
  return {
    agent: agentName as AgentRuntimeStatus['agent'],
    label: agentName,
    installed,
    selectedModel: null,
    selectedEffort: null,
    isDefault: false,
    models: [],
    usage: null,
    capabilities: getDriverCapabilities(agentName) as AgentRuntimeStatus['capabilities'],
  };
}

describe('wayland agent parity', () => {
  it('surfaces native and portable goal differences for first-party agents', () => {
    const rows = summarizeAgentParity([agent('codex'), agent('claude'), agent('gemini')]);
    const goal = rows.find(row => row.key === 'goal');

    expect(goal?.cells.codex.mode).toBe('native');
    expect(goal?.cells.claude.mode).toBe('native');
    expect(goal?.cells.claude.summary).toContain('pause/resume');
    expect(goal?.cells.gemini.mode).toBe('portable');
    expect(goal?.gap).toContain('Gemini uses Pikiclaw portable goal state');
  });

  it('keeps fork gaps explicit instead of hiding native driver limits', () => {
    const rows = summarizeAgentParity([agent('codex'), agent('claude'), agent('gemini')]);
    const fork = rows.find(row => row.key === 'forkCapability');

    expect(fork?.cells.codex.mode).toBe('unsupported');
    expect(fork?.cells.codex.summary).toContain('app-server contract');
    expect(fork?.cells.claude.mode).toBe('native');
    expect(fork?.cells.gemini.mode).toBe('unsupported');
    expect(fork?.gap).toContain('portable branch handoff');
    expect(fork?.nextAction).toContain('worktree queue');
  });

  it('marks unavailable focus agents as install gaps', () => {
    const rows = summarizeAgentParity([agent('codex'), agent('claude'), agent('gemini', false)]);
    const plan = rows.find(row => row.key === 'plan');

    expect(plan?.cells.gemini.mode).toBe('missing');
    expect(plan?.cells.gemini.modeLabel).toBe('Needs install');
    expect(plan?.chips).toContain('1 gaps');
  });
});
