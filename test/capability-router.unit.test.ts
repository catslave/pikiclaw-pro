import { describe, expect, it } from 'vitest';

import { resolveCapabilityRoute } from '../src/agent/capability-router.ts';

describe('capability router', () => {
  it('leaves URL requests on the selected agent while OpenClaw routing is disabled', () => {
    const route = resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '打开 https://example.com 帮我总结重点',
    });

    expect(route).toBeNull();
  });

  it('leaves URL requests on the selected agent when OpenClaw is not available', () => {
    expect(resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '打开 https://example.com 帮我总结重点',
      openclawAvailable: false,
    })).toBeNull();
  });

  it('routes Cursor perspective requests to the native Cursor agent', () => {
    const route = resolveCapabilityRoute({
      selectedAgent: 'claude',
      prompt: '用 Cursor 视角帮我检查这个改动',
    });

    expect(route?.capability).toBe('cursor_perspective');
    expect(route?.agent).toBe('cursor');
    expect(route?.openclawAgent).toBe('cursor');
  });

  it('leaves slash commands and explicit OpenClaw sessions alone', () => {
    expect(resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '/plan 打开 https://example.com',
    })).toBeNull();
    expect(resolveCapabilityRoute({
      selectedAgent: 'openclaw',
      prompt: '打开 https://example.com',
    })).toBeNull();
  });

  it('supports explicit auto cross-check lanes', () => {
    expect(resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '[Pikiclaw Auto Cross-check: Codex]\n交叉检查这个实现',
    })).toBeNull();

    const cursor = resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '[Pikiclaw Auto Cross-check: Cursor]\n交叉检查这个实现',
    });
    expect(cursor?.agent).toBe('cursor');
    expect(cursor?.openclawAgent).toBe('cursor');
  });

  it('does not reroute the final auto synthesis prompt', () => {
    expect(resolveCapabilityRoute({
      selectedAgent: 'codex',
      prompt: '[Pikiclaw Auto Synthesis]\n综合交叉检查结果',
    })).toBeNull();
  });

  it('does not reroute internal parallel lane prompts', () => {
    expect(resolveCapabilityRoute({
      selectedAgent: 'cursor',
      prompt: [
        'Multi-agent run: cross-mps5542',
        'You are the cursor agent in a parallel run with: codex, cursor.',
        'Work independently in your own session.',
        '',
        '帮我基于现有的工程分析一下，这个方案是否可实现',
      ].join('\n'),
    })).toBeNull();
  });
});
