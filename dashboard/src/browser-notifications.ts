import type { NotificationPreferences } from './types';
import {
  notificationEventEnabled,
  resolveNotificationPreferences,
  type NotificationEventKey,
} from './notification-preferences';

export type BrowserNotificationPermission = 'unsupported' | NotificationPermission;

export interface BrowserNotificationRequest {
  title: string;
  body?: string;
  tag?: string;
  requireInteraction?: boolean;
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(':').map(part => Number.parseInt(part, 10));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return Math.min(23, Math.max(0, hour)) * 60 + Math.min(59, Math.max(0, minute));
}

export function isWithinQuietHours(now: Date, start: string, end: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const startMinutes = minutesFromTime(start);
  const endMinutes = minutesFromTime(end);
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return current >= startMinutes && current < endMinutes;
  return current >= startMinutes || current < endMinutes;
}

export function shouldSilenceBrowserNotification(
  preferences: NotificationPreferences | null | undefined,
  now = new Date(),
): boolean {
  const resolved = resolveNotificationPreferences(preferences);
  return !resolved.playSound || isWithinQuietHours(now, resolved.quietStart, resolved.quietEnd);
}

export function shouldShowBrowserNotification(options: {
  preferences: NotificationPreferences | null | undefined;
  key: NotificationEventKey;
  permission: BrowserNotificationPermission;
  visibilityState?: DocumentVisibilityState | string;
}): boolean {
  if (!notificationEventEnabled(options.preferences, options.key)) return false;
  if (options.permission !== 'granted') return false;
  return options.visibilityState !== 'visible';
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (window.Notification.permission !== 'default') return window.Notification.permission;
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export function showBrowserNotification(
  preferences: NotificationPreferences | null | undefined,
  key: NotificationEventKey,
  request: BrowserNotificationRequest,
  now = new Date(),
): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (!shouldShowBrowserNotification({
    preferences,
    key,
    permission: window.Notification.permission,
    visibilityState: document.visibilityState,
  })) {
    return false;
  }
  try {
    const notification = new window.Notification(request.title, {
      body: request.body,
      tag: request.tag,
      icon: '/favicon.svg',
      silent: shouldSilenceBrowserNotification(preferences, now),
      requireInteraction: request.requireInteraction,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
