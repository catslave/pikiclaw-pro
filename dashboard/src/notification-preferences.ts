import type { NotificationPreferences } from './types';

export type ResolvedNotificationPreferences = Required<NotificationPreferences>;

export const DEFAULT_NOTIFICATION_PREFERENCES: ResolvedNotificationPreferences = {
  master: true,
  agentFinished: true,
  agentError: true,
  scheduledTask: false,
  channelMessage: false,
  budgetWarn: true,
  playSound: true,
  quietStart: '22:00',
  quietEnd: '07:00',
};

export type NotificationEventKey =
  | 'agentFinished'
  | 'agentError'
  | 'scheduledTask'
  | 'channelMessage'
  | 'budgetWarn';

export function normalizeNotificationTime(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

export function resolveNotificationPreferences(
  value: NotificationPreferences | null | undefined,
): ResolvedNotificationPreferences {
  return {
    master: value?.master !== false,
    agentFinished: value?.agentFinished !== false,
    agentError: value?.agentError !== false,
    scheduledTask: value?.scheduledTask === true,
    channelMessage: value?.channelMessage === true,
    budgetWarn: value?.budgetWarn !== false,
    playSound: value?.playSound !== false,
    quietStart: normalizeNotificationTime(value?.quietStart, DEFAULT_NOTIFICATION_PREFERENCES.quietStart),
    quietEnd: normalizeNotificationTime(value?.quietEnd, DEFAULT_NOTIFICATION_PREFERENCES.quietEnd),
  };
}

export function notificationEventEnabled(
  preferences: NotificationPreferences | ResolvedNotificationPreferences | null | undefined,
  key: NotificationEventKey,
): boolean {
  const resolved = resolveNotificationPreferences(preferences);
  return resolved.master && resolved[key];
}

export function agentCompletionNotificationEnabled(
  preferences: NotificationPreferences | ResolvedNotificationPreferences | null | undefined,
  incomplete: boolean,
): boolean {
  return notificationEventEnabled(preferences, incomplete ? 'agentError' : 'agentFinished');
}
