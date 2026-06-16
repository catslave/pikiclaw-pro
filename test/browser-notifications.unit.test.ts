import { describe, expect, it } from 'vitest';
import {
  isWithinQuietHours,
  shouldShowBrowserNotification,
  shouldSilenceBrowserNotification,
} from '../dashboard/src/browser-notifications.ts';

describe('browser notification preferences', () => {
  it('detects quiet hours across midnight', () => {
    expect(isWithinQuietHours(new Date('2026-06-13T23:15:00'), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date('2026-06-13T06:45:00'), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date('2026-06-13T12:00:00'), '22:00', '07:00')).toBe(false);
  });

  it('silences browser notifications during quiet hours or when sound is disabled', () => {
    const noon = new Date('2026-06-13T12:00:00');
    const late = new Date('2026-06-13T23:00:00');
    expect(shouldSilenceBrowserNotification({ playSound: true, quietStart: '22:00', quietEnd: '07:00' }, noon)).toBe(false);
    expect(shouldSilenceBrowserNotification({ playSound: true, quietStart: '22:00', quietEnd: '07:00' }, late)).toBe(true);
    expect(shouldSilenceBrowserNotification({ playSound: false, quietStart: '22:00', quietEnd: '07:00' }, noon)).toBe(true);
  });

  it('only shows browser notifications when enabled, granted, and backgrounded', () => {
    expect(shouldShowBrowserNotification({
      preferences: { master: true, scheduledTask: true },
      key: 'scheduledTask',
      permission: 'granted',
      visibilityState: 'hidden',
    })).toBe(true);
    expect(shouldShowBrowserNotification({
      preferences: { master: true, scheduledTask: true },
      key: 'scheduledTask',
      permission: 'granted',
      visibilityState: 'visible',
    })).toBe(false);
    expect(shouldShowBrowserNotification({
      preferences: { master: true, scheduledTask: true },
      key: 'scheduledTask',
      permission: 'denied',
      visibilityState: 'hidden',
    })).toBe(false);
    expect(shouldShowBrowserNotification({
      preferences: { master: false, scheduledTask: true },
      key: 'scheduledTask',
      permission: 'granted',
      visibilityState: 'hidden',
    })).toBe(false);
  });
});
