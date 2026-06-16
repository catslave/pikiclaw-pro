import { describe, expect, it } from 'vitest';

import {
  agentCompletionNotificationEnabled,
  notificationEventEnabled,
  resolveNotificationPreferences,
} from '../dashboard/src/notification-preferences.ts';

describe('notification preferences', () => {
  it('defaults to agent completion and budget notifications while leaving channel/schedule quiet', () => {
    const prefs = resolveNotificationPreferences(undefined);

    expect(prefs.master).toBe(true);
    expect(prefs.agentFinished).toBe(true);
    expect(prefs.agentError).toBe(true);
    expect(prefs.budgetWarn).toBe(true);
    expect(prefs.scheduledTask).toBe(false);
    expect(prefs.channelMessage).toBe(false);
    expect(prefs.quietStart).toBe('22:00');
    expect(prefs.quietEnd).toBe('07:00');
  });

  it('uses master as the global notification gate', () => {
    expect(notificationEventEnabled({ master: false, agentFinished: true }, 'agentFinished')).toBe(false);
    expect(notificationEventEnabled({ master: false, agentError: true }, 'agentError')).toBe(false);
  });

  it('gates successful and failed agent completion events independently', () => {
    expect(agentCompletionNotificationEnabled({ agentFinished: false, agentError: true }, false)).toBe(false);
    expect(agentCompletionNotificationEnabled({ agentFinished: false, agentError: true }, true)).toBe(true);
    expect(agentCompletionNotificationEnabled({ agentFinished: true, agentError: false }, false)).toBe(true);
    expect(agentCompletionNotificationEnabled({ agentFinished: true, agentError: false }, true)).toBe(false);
  });
});
