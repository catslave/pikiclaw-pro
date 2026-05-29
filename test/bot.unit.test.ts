import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent/index.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/agent/index.ts')>();
  return {
    ...actual,
    doStream: vi.fn(),
  };
});

import { doStream } from '../src/agent/index.ts';
import { ensureManagedSession } from '../src/agent/index.ts';
import { Bot } from '../src/bot/bot.ts';
import { applyUserConfig } from '../src/core/config/user-config.ts';
import { captureEnv, makeTmpDir, restoreEnv } from './support/env.ts';
import { makeStreamResult } from './support/stream-result.ts';

const envSnapshot = captureEnv(['PIKICLAW_CONFIG', 'PIKICLAW_WORKDIR', 'PIKICLAW_TASK_QUEUE_FILE', 'DEFAULT_AGENT']);

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  restoreEnv(envSnapshot);
  vi.clearAllMocks();
  const tmpConfig = makeTmpDir('bot-unit-config-');
  process.env.PIKICLAW_CONFIG = `${tmpConfig}/setting.json`;
  process.env.PIKICLAW_TASK_QUEUE_FILE = `${tmpConfig}/task-queue.json`;
  process.env.PIKICLAW_WORKDIR = makeTmpDir('bot-unit-workdir-');
  process.env.DEFAULT_AGENT = 'codex';
  applyUserConfig({ workdir: process.env.PIKICLAW_WORKDIR }, undefined, { notify: false });
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

describe('Bot.runStream', () => {
  it('manages codex cumulative totals across turns and workdir switches', async () => {
    // --- defaults to codex when DEFAULT_AGENT is unset ---
    delete process.env.DEFAULT_AGENT;

    const defaultBot = new Bot();

    expect(defaultBot.defaultAgent).toBe('codex');
    expect(defaultBot.chat(1).agent).toBe('codex');

    // --- passes prior Codex cumulative totals into resumed turns and stores updated totals ---
    process.env.DEFAULT_AGENT = 'codex';

    const doStreamMock = vi.mocked(doStream);
    doStreamMock
      .mockImplementationOnce(async opts => {
        expect(opts.codexPrevCumulative).toBeUndefined();
        return makeStreamResult('codex', {
          sessionId: 'sess-resume',
          inputTokens: 5000,
          cachedInputTokens: 4000,
          outputTokens: 300,
          codexCumulative: { input: 5000, output: 300, cached: 4000 },
        });
      })
      .mockImplementationOnce(async opts => {
        expect(opts.codexPrevCumulative).toEqual({ input: 5000, output: 300, cached: 4000 });
        return makeStreamResult('codex', {
          sessionId: 'sess-resume',
          message: 'Resumed turn',
          inputTokens: 3300,
          cachedInputTokens: 2500,
          outputTokens: 60,
          codexCumulative: { input: 8300, output: 360, cached: 6500 },
        });
      });

    const bot = new Bot();
    const cs = bot.chat(1);
    cs.agent = 'codex';

    await bot.runStream('start', cs, [], () => {});
    const result = await bot.runStream('continue', cs, [], () => {});

    expect(result.message).toBe('Resumed turn');
    expect(result.inputTokens).toBe(3300);
    expect(result.cachedInputTokens).toBe(2500);
    expect(result.outputTokens).toBe(60);
    expect(cs.codexCumulative).toEqual({ input: 8300, output: 360, cached: 6500 });

    // --- clears cached Codex cumulative totals when switching workdirs ---
    const bot2 = new Bot();
    const cs2 = bot2.chat(1);
    cs2.agent = 'codex';
    cs2.sessionId = 'sess-existing';
    cs2.codexCumulative = { input: 8300, output: 360, cached: 6500 };

    const nextWorkdir = makeTmpDir('bot-unit-next-');
    bot2.switchWorkdir(nextWorkdir);

    expect(cs2.sessionId).toBeNull();
    expect(cs2.codexCumulative).toBeUndefined();
  });

  it('uses the session workdir when continuing a session from another project', async () => {
    const doStreamMock = vi.mocked(doStream);
    const bot = new Bot();
    const sessionWorkdir = makeTmpDir('bot-unit-session-workdir-');
    const workspacePath = path.join(sessionWorkdir, '.pikiclaw', 'sessions', 'claude', 'session-1', 'workspace');
    const runtime: any = {
      key: 'claude:session-1',
      workdir: sessionWorkdir,
      agent: 'claude',
      sessionId: 'session-1',
      workspacePath,
      codexCumulative: undefined,
      modelId: null,
      runningTaskIds: new Set<string>(),
    };

    doStreamMock.mockImplementationOnce(async opts => {
      expect(opts.workdir).toBe(sessionWorkdir);
      return makeStreamResult('claude', {
        sessionId: 'session-1',
        workspacePath,
        elapsedS: 1,
        inputTokens: 1,
        outputTokens: 1,
      });
    });

    await bot.runStream('continue', runtime, [], () => {});
  });
});

describe('Bot steering handoff', () => {
  it('interrupts the running task and preserves its preview instead of using in-process steer', async () => {
    const bot = new Bot() as any;
    const runtime = bot.upsertSessionRuntime({
      agent: 'claude',
      sessionId: 'sess-steer',
      workdir: process.env.PIKICLAW_WORKDIR!,
      workspacePath: null,
      modelId: null,
    });

    const runningAbort = vi.fn();
    const runningSteer = vi.fn(async () => true);
    bot.beginTask({
      taskId: 'run-1',
      chatId: 1,
      agent: 'claude',
      sessionKey: runtime.key,
      prompt: 'first task',
      startedAt: Date.now() - 1000,
      sourceMessageId: 10,
    });
    bot.markTaskRunning('run-1', runningAbort);
    bot.activeTasks.get('run-1').steer = runningSteer;

    bot.beginTask({
      taskId: 'queued-1',
      chatId: 1,
      agent: 'claude',
      sessionKey: runtime.key,
      prompt: 'name only',
      startedAt: Date.now(),
      sourceMessageId: 11,
    });

    const result = await bot.steerTaskByActionId(bot.actionIdForTask('queued-1'));

    expect(result.steered).toBe(false);
    expect(result.interrupted).toBe(true);
    expect(runningSteer).not.toHaveBeenCalled();
    expect(runningAbort).toHaveBeenCalledTimes(1);
    expect(bot.activeTasks.get('run-1')?.freezePreviewOnAbort).toBe(true);
    expect(bot.activeTasks.get('queued-1')?.cancelled).toBe(false);
  });
});

describe('Bot emitStream queue tracking', () => {
  it('does not expose a zero-position queued event as a visible queue', () => {
    const bot = new Bot() as any;
    const sessionKey = 'codex:sess-startup-handshake';

    bot.emitStream(sessionKey, { type: 'queued', taskId: 'run-1', position: 0 });

    expect(bot.getStreamSnapshot(sessionKey)).toBeNull();
  });

  it('accumulates multiple queued task ids while a task is streaming', () => {
    const bot = new Bot() as any;
    const sessionKey = 'claude:sess-multi-queue';

    bot.emitStream(sessionKey, { type: 'start', taskId: 'run-1', agent: 'claude', sessionId: 'sess-multi-queue' });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-1', position: 1 });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-2', position: 2 });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-3', position: 3 });

    let snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.taskId).toBe('run-1');
    expect(snap?.queuedTaskIds).toEqual(['q-1', 'q-2', 'q-3']);

    // Cancelling a queued task removes it from the list, keeps the active task.
    bot.emitStream(sessionKey, { type: 'cancelled', taskId: 'q-2' });
    snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.taskId).toBe('run-1');
    expect(snap?.queuedTaskIds).toEqual(['q-1', 'q-3']);

    // Active task finishing keeps the remaining queued list.
    bot.emitStream(sessionKey, { type: 'done', taskId: 'run-1', sessionId: 'sess-multi-queue' });
    snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.phase).toBe('done');
    expect(snap?.queuedTaskIds).toEqual(['q-1', 'q-3']);

    // Next task starting drops itself from the queued list.
    bot.emitStream(sessionKey, { type: 'start', taskId: 'q-1', agent: 'claude', sessionId: 'sess-multi-queue' });
    snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.phase).toBe('streaming');
    expect(snap?.taskId).toBe('q-1');
    expect(snap?.queuedTaskIds).toEqual(['q-3']);

    // Last queued task starting clears the queued list entirely.
    bot.emitStream(sessionKey, { type: 'done', taskId: 'q-1', sessionId: 'sess-multi-queue' });
    bot.emitStream(sessionKey, { type: 'start', taskId: 'q-3', agent: 'claude', sessionId: 'sess-multi-queue' });
    snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.taskId).toBe('q-3');
    expect(snap?.queuedTaskIds).toBeUndefined();
  });

  it('reorders queued task ids and prompt previews for a session', () => {
    const bot = new Bot() as any;
    const sessionKey = 'codex:sess-reorder-queue';

    for (const [idx, taskId] of ['q-1', 'q-2', 'q-3'].entries()) {
      bot.beginTask({
        taskId,
        chatId: 'dashboard',
        agent: 'codex',
        sessionKey,
        prompt: `prompt ${idx + 1}`,
        attachments: [],
        startedAt: idx + 1,
        sourceMessageId: taskId,
      });
    }

    bot.emitStream(sessionKey, { type: 'start', taskId: 'run-1', agent: 'codex', sessionId: 'sess-reorder-queue' });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-1', position: 1 });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-2', position: 2 });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-3', position: 3 });

    expect(bot.reorderSessionQueuedTasks(sessionKey, ['q-3', 'q-1', 'q-2'])).toEqual({
      reordered: true,
      queuedTaskIds: ['q-3', 'q-1', 'q-2'],
    });

    const snap = bot.getStreamSnapshot(sessionKey);
    expect(snap?.queuedTaskIds).toEqual(['q-3', 'q-1', 'q-2']);
    expect(snap?.queuedTasks).toEqual([
      { taskId: 'q-3', prompt: 'prompt 3' },
      { taskId: 'q-1', prompt: 'prompt 1' },
      { taskId: 'q-2', prompt: 'prompt 2' },
    ]);
  });

  it('exposes the active task prompt after a queued task starts streaming', () => {
    const bot = new Bot() as any;
    const sessionKey = 'codex:sess-queued-active-prompt';

    for (const [taskId, prompt] of [['run-1', 'first prompt'], ['q-1', 'queued prompt']] as const) {
      bot.beginTask({
        taskId,
        chatId: 'dashboard',
        agent: 'codex',
        sessionKey,
        prompt,
        attachments: [],
        startedAt: Date.now(),
        sourceMessageId: taskId,
      });
    }

    bot.emitStream(sessionKey, { type: 'start', taskId: 'run-1', agent: 'codex', sessionId: 'sess-queued-active-prompt' });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-1', position: 1 });
    expect(bot.getStreamSnapshot(sessionKey)).toMatchObject({
      taskId: 'run-1',
      prompt: 'first prompt',
      queuedTasks: [{ taskId: 'q-1', prompt: 'queued prompt' }],
    });

    bot.emitStream(sessionKey, { type: 'done', taskId: 'run-1', sessionId: 'sess-queued-active-prompt' });
    bot.finishTask('run-1');
    bot.emitStream(sessionKey, { type: 'start', taskId: 'q-1', agent: 'codex', sessionId: 'sess-queued-active-prompt' });
    expect(bot.getStreamSnapshot(sessionKey)).toMatchObject({
      phase: 'streaming',
      taskId: 'q-1',
      prompt: 'queued prompt',
    });
  });

  it('cancelling the active task drops the whole snapshot', () => {
    const bot = new Bot() as any;
    const sessionKey = 'claude:sess-active-cancel';

    bot.emitStream(sessionKey, { type: 'start', taskId: 'run-1', agent: 'claude', sessionId: 'sess-active-cancel' });
    bot.emitStream(sessionKey, { type: 'queued', taskId: 'q-1', position: 1 });
    bot.emitStream(sessionKey, { type: 'cancelled', taskId: 'run-1' });

    expect(bot.getStreamSnapshot(sessionKey)).toBeNull();
  });

  it('throttles stream text debug logs for tiny deltas', () => {
    const bot = new Bot() as any;
    const sessionKey = 'codex:sess-debug-throttle';
    const debugSpy = vi.spyOn(bot, 'debug').mockImplementation(() => {});

    bot.emitStreamStart('run-1', {
      key: sessionKey,
      agent: 'codex',
      sessionId: 'sess-debug-throttle',
      workdir: process.env.PIKICLAW_WORKDIR!,
      modelId: null,
      thinkingEffort: null,
    });
    debugSpy.mockClear();

    bot.emitStreamText('run-1', sessionKey, 'a', '');
    bot.emitStreamText('run-1', sessionKey, 'ab', '');
    bot.emitStreamText('run-1', sessionKey, 'abc', '');
    expect(debugSpy).toHaveBeenCalledTimes(1);

    bot.emitStreamText('run-1', sessionKey, 'x'.repeat(1100), '');
    expect(debugSpy).toHaveBeenCalledTimes(2);

    bot.emitStreamDone('run-1', sessionKey, { sessionId: 'sess-debug-throttle', incomplete: false });
    expect(bot.streamTextDebugState.size).toBe(0);
  });
});

describe('Bot resetConversationForChat', () => {
  it('clears the chat selection without interrupting running or queued tasks on the previous session', () => {
    const bot = new Bot() as any;
    const runtime = bot.upsertSessionRuntime({
      agent: 'claude',
      sessionId: 'sess-prev',
      workdir: process.env.PIKICLAW_WORKDIR!,
      workspacePath: null,
      modelId: null,
    });
    bot.applySessionSelection(bot.chat(1), runtime);

    const runningAbort = vi.fn();
    bot.beginTask({
      taskId: 'run-prev',
      chatId: 1,
      agent: 'claude',
      sessionKey: runtime.key,
      prompt: 'long task',
      startedAt: Date.now() - 1000,
      sourceMessageId: 100,
    });
    bot.markTaskRunning('run-prev', runningAbort);

    bot.beginTask({
      taskId: 'queued-prev',
      chatId: 1,
      agent: 'claude',
      sessionKey: runtime.key,
      prompt: 'queued task',
      startedAt: Date.now(),
      sourceMessageId: 101,
    });

    bot.resetConversationForChat(1);

    expect(runningAbort).not.toHaveBeenCalled();
    expect(bot.activeTasks.get('run-prev')?.status).toBe('running');
    expect(bot.activeTasks.get('queued-prev')?.cancelled).toBeFalsy();
    expect(bot.chat(1).activeSessionKey).toBeNull();
    expect(bot.chat(1).sessionId).toBeNull();
  });

  it('clears chat selection when previous session is idle', () => {
    const bot = new Bot() as any;
    const runtime = bot.upsertSessionRuntime({
      agent: 'claude',
      sessionId: 'sess-idle',
      workdir: process.env.PIKICLAW_WORKDIR!,
      workspacePath: null,
      modelId: null,
    });
    bot.applySessionSelection(bot.chat(1), runtime);

    bot.resetConversationForChat(1);

    expect(bot.chat(1).activeSessionKey).toBeNull();
  });
});

describe('Bot switchModelForChat', () => {
  it('applies the new model to the active session inline without dropping it', () => {
    const bot = new Bot() as any;
    const runtime = bot.upsertSessionRuntime({
      agent: 'claude',
      sessionId: 'sess-active',
      workdir: process.env.PIKICLAW_WORKDIR!,
      workspacePath: null,
      modelId: 'old-model',
    });
    bot.applySessionSelection(bot.chat(1), runtime);
    bot.setModelForAgent('claude', 'old-model');

    bot.switchModelForChat(1, 'new-model');

    // Active selection preserved — user can keep talking to the same session
    expect(bot.chat(1).activeSessionKey).toBe(runtime.key);
    expect(bot.chat(1).sessionId).toBe('sess-active');
    // Session + chat now both report the new model so the next runStream
    // will pick it up regardless of which fallback layer wins
    expect(bot.chat(1).modelId).toBe('new-model');
    expect(runtime.modelId).toBe('new-model');
    // Global agent default is updated too (so a brand-new session inherits)
    expect(bot.modelForAgent('claude')).toBe('new-model');
  });

  it('updates global default even when no session is active', () => {
    const bot = new Bot() as any;
    bot.chat(1).agent = 'claude';
    bot.setModelForAgent('claude', 'old-model');

    bot.switchModelForChat(1, 'new-model');

    expect(bot.modelForAgent('claude')).toBe('new-model');
    expect(bot.chat(1).modelId).toBe('new-model');
    expect(bot.chat(1).activeSessionKey).toBeNull();
  });
});

describe('Bot thread-aware agent switching', () => {
  it('resumes the existing session for the target agent inside the same thread', () => {
    const workdir = process.env.PIKICLAW_WORKDIR!;
    ensureManagedSession({
      agent: 'codex',
      workdir,
      sessionId: 'sess-codex',
      title: 'codex side',
      threadId: 'thread-shared',
    });
    ensureManagedSession({
      agent: 'claude',
      workdir,
      sessionId: 'sess-claude',
      title: 'claude side',
      threadId: 'thread-shared',
    });

    const bot = new Bot();
    bot.adoptExistingSessionForChat(1, {
      agent: 'codex',
      sessionId: 'sess-codex',
      workdir,
      workspacePath: null,
      model: 'gpt-5.4',
      title: 'codex side',
      threadId: 'thread-shared',
    });

    const switched = bot.switchAgentForChat(1, 'claude');
    const selected = bot.selectedSession(1);

    expect(switched).toBe(true);
    expect(selected).toMatchObject({
      agent: 'claude',
      sessionId: 'sess-claude',
      threadId: 'thread-shared',
    });
    expect(bot.chat(1).activeThreadId).toBe('thread-shared');

    bot.switchAgentForChat(1, 'codex');
    expect(bot.selectedSession(1)).toMatchObject({
      agent: 'codex',
      sessionId: 'sess-codex',
      threadId: 'thread-shared',
    });
  });
});

describe('Bot external session control', () => {
  it('keeps queued dashboard tasks on disk until they start running', async () => {
    const doStreamMock = vi.mocked(doStream);
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>(resolve => { firstStarted = resolve; });
    const firstReleasePromise = new Promise<void>(resolve => { releaseFirst = resolve; });

    doStreamMock
      .mockImplementationOnce(async () => {
        firstStarted();
        await firstReleasePromise;
        return makeStreamResult('codex', { sessionId: 'sess-queue', message: 'first done' });
      })
      .mockImplementationOnce(async () => makeStreamResult('codex', {
        sessionId: 'sess-queue',
        message: 'second done',
      }));

    const bot = new Bot();
    bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-queue',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'first',
    });
    await firstStartedPromise;

    const second = bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-queue',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'second',
    });

    let persisted = JSON.parse(fs.readFileSync(process.env.PIKICLAW_TASK_QUEUE_FILE!, 'utf8'));
    expect(persisted.tasks.map((task: any) => task.taskId)).toEqual([second.taskId]);
    expect(persisted.tasks[0]).toMatchObject({
      prompt: 'second',
      sessionId: 'sess-queue',
      workdir: process.env.PIKICLAW_WORKDIR!,
    });

    releaseFirst();
    await waitFor(() => bot.activeTasks.size === 0);

    persisted = JSON.parse(fs.readFileSync(process.env.PIKICLAW_TASK_QUEUE_FILE!, 'utf8'));
    expect(persisted.tasks).toEqual([]);
  });

  it('runs reordered queued dashboard tasks in priority order', async () => {
    const doStreamMock = vi.mocked(doStream);
    const prompts: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>(resolve => { firstStarted = resolve; });
    const firstReleasePromise = new Promise<void>(resolve => { releaseFirst = resolve; });

    doStreamMock.mockImplementation(async opts => {
      prompts.push(opts.prompt);
      if (opts.prompt === 'first') {
        firstStarted();
        await firstReleasePromise;
      }
      return makeStreamResult('codex', {
        sessionId: 'sess-priority',
        message: `${opts.prompt} done`,
      });
    });

    const bot = new Bot();
    bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-priority',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'first',
    });
    await firstStartedPromise;

    const second = bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-priority',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'second',
    });
    const third = bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-priority',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'third',
    });

    expect(bot.reorderSessionQueuedTasks('codex:sess-priority', [third.taskId, second.taskId])).toMatchObject({
      reordered: true,
      queuedTaskIds: [third.taskId, second.taskId],
    });
    expect(JSON.parse(fs.readFileSync(process.env.PIKICLAW_TASK_QUEUE_FILE!, 'utf8')).tasks.map((task: any) => task.taskId))
      .toEqual([third.taskId, second.taskId]);

    releaseFirst();
    await waitFor(() => prompts.length === 3 && bot.activeTasks.size === 0);

    expect(prompts).toEqual(['first', 'third', 'second']);
  });

  it('restores persisted queued tasks in queue order', async () => {
    const queueFile = process.env.PIKICLAW_TASK_QUEUE_FILE!;
    const workdir = process.env.PIKICLAW_WORKDIR!;
    fs.writeFileSync(queueFile, JSON.stringify({
      version: 1,
      tasks: [
        {
          version: 1,
          taskId: 'restore-2',
          createdAt: 2000,
          chatId: 'dashboard',
          sourceMessageId: 'restore-2',
          workdir,
          agent: 'codex',
          sessionId: 'sess-restore',
          prompt: 'second restored',
          attachments: [],
        },
        {
          version: 1,
          taskId: 'restore-1',
          createdAt: 1000,
          chatId: 'dashboard',
          sourceMessageId: 'restore-1',
          workdir,
          agent: 'codex',
          sessionId: 'sess-restore',
          prompt: 'first restored',
          attachments: [],
        },
      ],
    }));

    const prompts: string[] = [];
    vi.mocked(doStream).mockImplementation(async opts => {
      prompts.push(opts.prompt);
      return makeStreamResult('codex', {
        sessionId: 'sess-restore',
        message: `${opts.prompt} done`,
      });
    });

    const bot = new Bot();
    expect(bot.restorePersistedQueuedTasks()).toBe(2);
    await waitFor(() => prompts.length === 2);

    expect(prompts).toEqual(['first restored', 'second restored']);
    expect(bot.activeTasks.size).toBe(0);
    expect(JSON.parse(fs.readFileSync(queueFile, 'utf8')).tasks).toEqual([]);
  });

  it('marks recent crash-orphaned running sessions incomplete without injecting a recovery prompt', async () => {
    const workdir = process.env.PIKICLAW_WORKDIR!;
    ensureManagedSession({
      agent: 'codex',
      sessionId: 'sess-orphan',
      workdir,
      title: 'original task',
    });
    const indexPath = path.join(workdir, '.pikiclaw', 'sessions', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const orphanRunUpdatedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    index.sessions[0] = {
      ...index.sessions[0],
      runState: 'running',
      runDetail: null,
      runPid: null,
      runUpdatedAt: orphanRunUpdatedAt,
      autoResumeAttempts: 0,
      userStatus: 'active',
    };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

    const bot = new Bot();
    await new Promise(resolve => setImmediate(resolve));

    const updated = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(updated.sessions[0]).toMatchObject({
      sessionId: 'sess-orphan',
      autoResumeAttempts: 0,
      runState: 'incomplete',
      runDetail: 'Process exited before reporting completion.',
      runUpdatedAt: orphanRunUpdatedAt,
    });
    expect(vi.mocked(doStream)).not.toHaveBeenCalled();
    expect(bot.activeTasks.size).toBe(0);
  });

  it('does not auto-resume orphaned sessions that were already attempted', async () => {
    const workdir = process.env.PIKICLAW_WORKDIR!;
    ensureManagedSession({
      agent: 'codex',
      sessionId: 'sess-attempted',
      workdir,
      title: 'already tried',
    });
    const indexPath = path.join(workdir, '.pikiclaw', 'sessions', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    index.sessions[0] = {
      ...index.sessions[0],
      runState: 'running',
      runDetail: null,
      runPid: null,
      runUpdatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      autoResumeAttempts: 1,
      userStatus: 'active',
    };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

    const bot = new Bot();
    await new Promise(resolve => setImmediate(resolve));

    expect(vi.mocked(doStream)).not.toHaveBeenCalled();
    const updated = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(updated.sessions[0]).toMatchObject({
      sessionId: 'sess-attempted',
      autoResumeAttempts: 1,
      runState: 'incomplete',
      runDetail: 'Process exited before reporting completion.',
    });
    expect(bot.activeTasks.size).toBe(0);
  });

  it('submits dashboard session tasks through the public API and publishes stream state', async () => {
    const doStreamMock = vi.mocked(doStream);
    doStreamMock.mockImplementationOnce(async opts => {
      opts.onText('partial reply', 'thinking...');
      return makeStreamResult('codex', {
        sessionId: 'sess-dashboard',
        message: 'done',
        elapsedS: 1,
      });
    });

    const bot = new Bot();
    const submitted = bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'sess-dashboard',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'continue',
    });

    expect(submitted.ok).toBe(true);
    expect(submitted.sessionKey).toBe('codex:sess-dashboard');
    await new Promise(resolve => setImmediate(resolve));

    expect(bot.getStreamSnapshot('codex:sess-dashboard')).toMatchObject({
      phase: 'done',
      taskId: submitted.taskId,
      sessionId: 'sess-dashboard',
      text: 'partial reply',
      thinking: 'thinking...',
    });
  });

  it('drops stale live stream snapshots when the backing task is gone', () => {
    const bot = new Bot();
    bot.emitStream('codex:sess-stale', {
      type: 'start',
      taskId: 'missing-task',
      agent: 'codex',
      sessionId: 'sess-stale',
      model: null,
      effort: null,
    });
    const snap = (bot as any).streamSnapshots.get('codex:sess-stale');
    snap.updatedAt = Date.now() - 31_000;

    expect(bot.getStreamSnapshot('codex:sess-stale')).toBeNull();
  });

  it('migrates dashboard stream state and runtime tracking when codex promotes a pending session id', async () => {
    const doStreamMock = vi.mocked(doStream);
    doStreamMock.mockImplementationOnce(async opts => {
      opts.onSessionId?.('sess-promoted');
      opts.onText('partial reply', 'thinking...');
      return makeStreamResult('codex', {
        sessionId: 'sess-promoted',
        message: 'done',
        elapsedS: 1,
      });
    });

    const bot = new Bot();
    const submitted = bot.submitSessionTask({
      agent: 'codex',
      sessionId: 'pending_dashboard',
      workdir: process.env.PIKICLAW_WORKDIR!,
      prompt: 'continue',
    });

    expect(submitted.ok).toBe(true);
    const deadline = Date.now() + 1000;
    let promotedSnapshot = bot.getStreamSnapshot('codex:sess-promoted');
    while (!promotedSnapshot && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
      promotedSnapshot = bot.getStreamSnapshot('codex:sess-promoted');
    }

    expect(promotedSnapshot).toMatchObject({
      phase: 'done',
      taskId: submitted.taskId,
      sessionId: 'sess-promoted',
      text: 'partial reply',
      thinking: 'thinking...',
    });
    // After promotion, the old key transparently redirects to the promoted snapshot
    expect(bot.getStreamSnapshot('codex:pending_dashboard')).toMatchObject({
      sessionId: 'sess-promoted',
    });

    const runtime = bot.sessionStates.get('codex:sess-promoted');
    expect(runtime?.runningTaskIds.size ?? 0).toBe(0);
    expect(bot.activeTasks.size).toBe(0);
    expect(bot.sessionStates.has('codex:pending_dashboard')).toBe(false);
  });
});

describe('Bot gitignore management', () => {
  it('keeps .pikiclaw/skills tracked while ignoring managed runtime state', () => {
    const workdir = makeTmpDir('bot-unit-gitignore-');
    fs.writeFileSync(path.join(workdir, '.gitignore'), '.env\n.pikiclaw/\n');
    process.env.PIKICLAW_WORKDIR = workdir;

    new Bot();

    expect(fs.readFileSync(path.join(workdir, '.gitignore'), 'utf8')).toBe([
      '.env',
      '.pikiclaw/*',
      '!.pikiclaw/skills/',
      '!.pikiclaw/skills/**',
      '',
    ].join('\n'));
  });
});
