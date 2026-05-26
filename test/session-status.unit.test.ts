import { describe, expect, it } from 'vitest';
import { getSessionStatusForBot } from '../src/bot/session-status.ts';

describe('session status helpers', () => {
  it('does not trust this process pid without a live runtime task', () => {
    const bot = {
      sessionStates: new Map(),
      chats: new Map(),
    };

    const status = getSessionStatusForBot(bot as any, {
      agent: 'codex',
      sessionId: 'sess-stale',
      running: true,
      runState: 'running',
      runPid: process.pid,
      runUpdatedAt: new Date().toISOString(),
    });

    expect(status.isRunning).toBe(false);
    expect(status.isStale).toBe(true);
  });

  it('keeps a session running when runtime task ids are still present', () => {
    const bot = {
      sessionStates: new Map([
        ['codex:sess-live', { runningTaskIds: new Set(['task-1']) }],
      ]),
      chats: new Map(),
    };

    const status = getSessionStatusForBot(bot as any, {
      agent: 'codex',
      sessionId: 'sess-live',
      running: true,
      runState: 'running',
      runPid: process.pid,
      runUpdatedAt: new Date().toISOString(),
    });

    expect(status.isRunning).toBe(true);
    expect(status.isStale).toBe(false);
  });
});
