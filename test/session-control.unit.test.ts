import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getBotRefMock,
  runtimeMock,
} = vi.hoisted(() => {
  const getBotRefMock = vi.fn();
  return {
    getBotRefMock,
    runtimeMock: {
      getBotRef: getBotRefMock,
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
    expect(result).toEqual({ ok: true, queued: true, taskId: 'task-plan', sessionKey: 'codex:pending_plan' });
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
