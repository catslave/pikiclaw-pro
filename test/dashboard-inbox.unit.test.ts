import { describe, expect, it } from 'vitest';
import {
  dashboardColumnForSession,
  isUnreadCompletedSession,
  shouldIncludeInboxDashboardItem,
} from '../dashboard/src/utils.ts';
import type { SessionInfo } from '../dashboard/src/types.ts';

const recentCutoff = Date.now() - 60_000;

function baseSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    agent: 'claude',
    sessionId: 'sess-1',
    runState: 'completed',
    running: false,
    lastQuestion: 'hello',
    numTurns: 1,
    userStatus: null,
    ...overrides,
  } as SessionInfo;
}

describe('dashboard inbox helpers', () => {
  describe('dashboardColumnForSession', () => {
    it('maps running sessions to the running column', () => {
      expect(dashboardColumnForSession(
        baseSession({ running: true, runState: 'running' }),
        null,
        recentCutoff,
      )).toBe('running');
    });

    it('maps live queued/streaming snapshots to the running column', () => {
      expect(dashboardColumnForSession(
        baseSession(),
        { phase: 'queued' },
        recentCutoff,
      )).toBe('running');
      expect(dashboardColumnForSession(
        baseSession(),
        { phase: 'streaming' },
        recentCutoff,
      )).toBe('running');
    });

    it('maps unread completed sessions to review', () => {
      expect(dashboardColumnForSession(
        baseSession({ runUpdatedAt: new Date().toISOString() }),
        null,
        recentCutoff,
      )).toBe('review');
    });

    it('returns null for done or parked sessions', () => {
      expect(dashboardColumnForSession(
        baseSession({ userStatus: 'done' }),
        null,
        recentCutoff,
      )).toBeNull();
      expect(dashboardColumnForSession(
        baseSession({ userStatus: 'parked' }),
        null,
        recentCutoff,
      )).toBeNull();
    });
  });

  describe('isUnreadCompletedSession', () => {
    it('requires readable content', () => {
      expect(isUnreadCompletedSession(baseSession({
        lastQuestion: '',
        lastAnswer: '',
        lastMessageText: '',
        numTurns: 0,
      }))).toBe(false);
    });
  });

  describe('shouldIncludeInboxDashboardItem', () => {
    it('always includes non-running items', () => {
      expect(shouldIncludeInboxDashboardItem('review', { mode: 'workspace', openInWorkspace: true })).toBe(true);
    });

    it('includes running items on task dashboard even when open in workspace', () => {
      expect(shouldIncludeInboxDashboardItem('running', { mode: 'dashboard', openInWorkspace: true })).toBe(true);
    });

    it('hides open running chats on workspace but keeps background ones', () => {
      expect(shouldIncludeInboxDashboardItem('running', { mode: 'workspace', openInWorkspace: true })).toBe(false);
      expect(shouldIncludeInboxDashboardItem('running', { mode: 'workspace', openInWorkspace: false })).toBe(true);
    });

    it('includes running items on settings tabs', () => {
      expect(shouldIncludeInboxDashboardItem('running', { mode: 'settings', openInWorkspace: false })).toBe(true);
    });
  });
});
