import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

const {
  getBotRefMock,
  runtimeMock,
} = vi.hoisted(() => {
  const getBotRefMock = vi.fn();
  return {
    getBotRefMock,
    runtimeMock: {
      getBotRef: getBotRefMock,
      debug: vi.fn(),
    },
  };
});

vi.mock('../src/dashboard/runtime.ts', () => ({
  runtime: runtimeMock,
}));

describe('session-control', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  });

  it('queues dashboard tasks through the public bot API', async () => {
    const submitSessionTask = vi.fn(() => ({ ok: true, queued: true, taskId: 'task-1', sessionKey: 'codex:sess-1' }));
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir: '/tmp/pikiclaw',
      agent: 'codex',
      sessionId: 'sess-1',
      prompt: 'check',
      attachments: ['/tmp/a.png'],
    });

    expect(submitSessionTask).toHaveBeenCalledWith({
      workdir: '/tmp/pikiclaw',
      agent: 'codex',
      sessionId: 'sess-1',
      prompt: 'check',
      attachments: ['/tmp/a.png'],
    });
    expect(result).toEqual({ ok: true, queued: true, taskId: 'task-1', sessionKey: 'codex:sess-1' });
  });

  it('passes context sources when creating a fresh dashboard session', async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-context-send-'));
    const sourceWorkdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-context-source-'));
    const submitSessionTask = vi.fn(() => ({ ok: true, queued: true, taskId: 'task-context', sessionKey: 'codex:pending_context' }));
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const contextSources = [{
      kind: 'session' as const,
      workdir: sourceWorkdir,
      agent: 'codex' as const,
      sessionId: 'source-session',
      title: 'Source session',
      mode: 'compact' as const,
    }];
    const normalizedSources = [{
      ...contextSources[0],
      lastNTurns: null,
      turnStart: null,
      turnEnd: null,
    }];

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir,
      agent: 'codex',
      sessionId: '',
      prompt: 'summarize with context',
      attachments: [],
      contextSources,
    });

    expect(submitSessionTask).toHaveBeenCalledTimes(1);
    const call = submitSessionTask.mock.calls[0][0];
    expect(call.sessionId).toMatch(/^pending_/);
    expect(call.contextSources).toEqual(normalizedSources);
    expect(result).toEqual({ ok: true, queued: true, taskId: 'task-context', sessionKey: 'codex:pending_context' });

    const { findPikiclawSession } = await import('../src/agent/index.ts');
    expect(findPikiclawSession(workdir, 'codex', call.sessionId)?.contextSources).toEqual(normalizedSources);
  });

  it('rejects context sources for existing dashboard sessions', async () => {
    const submitSessionTask = vi.fn();
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir: '/tmp/pikiclaw',
      agent: 'codex',
      sessionId: 'sess-existing',
      prompt: 'continue',
      attachments: [],
      contextSources: [{
        kind: 'session' as const,
        workdir: '/tmp/pikiclaw',
        agent: 'codex' as const,
        sessionId: 'source-session',
        mode: 'compact' as const,
      }],
    });

    expect(submitSessionTask).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect((result as any).error).toContain('contextSources can only be used');
  });

  it('routes /plan through the capability-aware controller before skill resolution', async () => {
    const submitSessionTask = vi.fn(() => ({ ok: true, queued: true, taskId: 'task-plan', sessionKey: 'codex:pending_plan' }));
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir: '/tmp/pikiclaw',
      agent: 'codex',
      sessionId: 'pending_plan',
      prompt: '/plan add native goal UI',
      attachments: [],
    });

    expect(submitSessionTask).toHaveBeenCalledTimes(1);
    const call = submitSessionTask.mock.calls[0][0];
    expect(call.prompt).toContain('<proposed_plan>');
    expect(call.prompt).toContain('add native goal UI');
    expect(call.prompt).not.toContain('Read the skill definition');
    expect(call.displayPrompt).toBe('/plan add native goal UI');
    expect(result).toEqual({ ok: true, queued: true, taskId: 'task-plan', sessionKey: 'codex:pending_plan' });
  });

  it('keeps page reading requests on the selected agent while OpenClaw is disabled', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-route-'));
    const submitSessionTask = vi.fn(() => ({ ok: true, queued: true, taskId: 'task-web', sessionKey: 'codex:pending_web' }));
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir: tmp,
      agent: 'codex',
      sessionId: '',
      prompt: '打开 https://example.com 帮我总结重点',
      attachments: [],
    });

    expect(submitSessionTask).toHaveBeenCalledTimes(1);
    const call = submitSessionTask.mock.calls[0][0];
    expect(call.agent).toBe('codex');
    expect(call.displayPrompt).toBeUndefined();
    expect(call.prompt).toBe('打开 https://example.com 帮我总结重点');
    expect(call.capabilityRoute).toBeUndefined();
    expect(result).toEqual({ ok: true, queued: true, taskId: 'task-web', sessionKey: 'codex:pending_web' });
  });

  it('does not pretend unsupported native plan support exists', async () => {
    const submitSessionTask = vi.fn();
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const { queueDashboardSessionTask } = await import('../src/dashboard/session-control.ts');
    const result = await queueDashboardSessionTask({
      workdir: '/tmp/pikiclaw',
      agent: 'hermes',
      sessionId: 'sess-1',
      prompt: '/plan inspect',
      attachments: [],
    });

    expect(submitSessionTask).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect((result as any).error).toContain('does not advertise /plan support');
  });

  it('surfaces stream state, cancel, and steer through public bot methods', async () => {
    const cancelTask = vi.fn(() => ({ cancelled: true, interrupted: false, task: {} }));
    const steerTask = vi.fn(async () => ({ steered: true, interrupted: true, task: {} }));
    const reorderSessionQueuedTasks = vi.fn(() => ({ reordered: true, queuedTaskIds: ['task-2', 'task-1'] }));
    getBotRefMock.mockReturnValue({
      getStreamSnapshot: vi.fn(() => ({ phase: 'queued', taskId: 'task-1', updatedAt: 1 })),
      cancelTask,
      steerTask,
      reorderSessionQueuedTasks,
    });

    const {
      cancelSessionTask,
      getSessionStreamState,
      reorderSessionQueuedTasks: reorderControl,
      steerSessionTask,
    } = await import('../src/dashboard/session-control.ts');

    expect(getSessionStreamState('codex', 'sess-1')).toEqual({
      ok: true,
      state: { phase: 'queued', taskId: 'task-1', updatedAt: 1 },
    });
    expect(cancelSessionTask('task-1')).toEqual({ ok: true, recalled: true });
    expect(await steerSessionTask('task-1')).toEqual({ ok: true, steered: true });
    expect(reorderControl('codex', 'sess-1', ['task-2', 'task-1'])).toEqual({
      ok: true,
      reordered: true,
      queuedTaskIds: ['task-2', 'task-1'],
    });
    expect(reorderSessionQueuedTasks).toHaveBeenCalledWith('codex:sess-1', ['task-2', 'task-1']);
  });
});
