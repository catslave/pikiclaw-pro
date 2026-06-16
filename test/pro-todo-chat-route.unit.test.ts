import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTmpDir } from './support/env.ts';

const {
  queueDashboardSessionTaskMock,
  runtimeMock,
} = vi.hoisted(() => ({
  queueDashboardSessionTaskMock: vi.fn(),
  runtimeMock: {
    getRequestWorkdir: vi.fn(() => '/tmp/pikiclaw'),
    getRuntimeDefaultAgent: vi.fn(() => 'codex'),
    debug: vi.fn(),
    emitDashboardEvent: vi.fn(),
  },
}));

vi.mock('../src/dashboard/runtime.ts', () => ({
  runtime: runtimeMock,
}));

vi.mock('../src/dashboard/session-control.ts', () => ({
  queueDashboardSessionTask: queueDashboardSessionTaskMock,
}));

let tmpDir: string;
let previousTodoFile: string | undefined;
let previousSchedulerFlag: boolean | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-todo-chat-route-');
  previousTodoFile = process.env.PIKICLAW_PRO_TODO_FILE;
  previousSchedulerFlag = globalThis.__pikiclawProAutomationSchedulerStarted;
  process.env.PIKICLAW_PRO_TODO_FILE = path.join(tmpDir, 'todos.json');
  globalThis.__pikiclawProAutomationSchedulerStarted = true;
  queueDashboardSessionTaskMock.mockReset();
  runtimeMock.getRequestWorkdir.mockReturnValue('/tmp/pikiclaw');
});

afterEach(() => {
  if (previousTodoFile == null) delete process.env.PIKICLAW_PRO_TODO_FILE;
  else process.env.PIKICLAW_PRO_TODO_FILE = previousTodoFile;
  globalThis.__pikiclawProAutomationSchedulerStarted = previousSchedulerFlag;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

describe('Pro todo chat route', () => {
  it('keeps the todo as durable source evidence after starting a chat', async () => {
    const { createTodoItem, listTodoItems } = await import('../src/pro/todos.ts');
    const todo = createTodoItem({
      title: 'Trace follow-up',
      body: 'Check the session id evidence.',
      source: {
        type: 'chat-selection',
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'source-session',
        turnIndex: 4,
        quote: 'The source trace should stay attached.',
      },
    });
    queueDashboardSessionTaskMock.mockResolvedValue({
      ok: true,
      queued: true,
      taskId: 'task-chat',
      sessionKey: 'codex:pending_chat',
    });

    const app = (await import('../src/dashboard/routes/pro.ts')).default;
    const res = await app.request('/api/pro/todos/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todoIds: [todo.id] }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      items: [
        expect.objectContaining({
          id: todo.id,
          status: 'chat-created',
          linkedChat: {
            workdir: '/repo/pikiclaw',
            agent: 'codex',
            sessionId: 'pending_chat',
          },
        }),
      ],
    });
    expect(listTodoItems()).toEqual([
      expect.objectContaining({
        id: todo.id,
        status: 'chat-created',
        linkedChat: expect.objectContaining({ sessionId: 'pending_chat' }),
      }),
    ]);
    expect(queueDashboardSessionTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/repo/pikiclaw',
      prompt: expect.stringContaining('The source trace should stay attached.'),
    }));
  });
});
