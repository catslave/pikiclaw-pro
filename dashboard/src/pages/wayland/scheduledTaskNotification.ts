import type { BrowserNotificationRequest } from '../../browser-notifications';
import type { DashboardEvent } from '../../ws';

export function scheduledTaskNotificationRequest(event: DashboardEvent): BrowserNotificationRequest | null {
  if (event.type !== 'scheduled-task') return null;
  const name = event.name || 'Scheduled task';
  const status = event.status || 'queued';
  const bodyParts = [
    event.schedule ? `Schedule: ${event.schedule}` : '',
    event.error || '',
    event.sessionKey ? `Session: ${event.sessionKey}` : '',
  ].filter(Boolean);

  if (status === 'missed') {
    return {
      title: `Missed scheduled task: ${name}`,
      body: bodyParts.join('\n') || 'Pikiclaw missed the scheduled run window.',
      tag: `scheduled-task:${event.automationId || event.key || name}:missed`,
      requireInteraction: true,
    };
  }

  if (status === 'failed') {
    return {
      title: `Scheduled task needs review: ${name}`,
      body: bodyParts.join('\n') || 'The scheduled task did not complete cleanly.',
      tag: `scheduled-task:${event.automationId || event.key || name}:failed`,
      requireInteraction: true,
    };
  }

  if (status === 'completed') {
    return {
      title: `Scheduled task complete: ${name}`,
      body: bodyParts.join('\n') || 'The scheduled task finished.',
      tag: `scheduled-task:${event.automationId || event.key || name}:completed`,
    };
  }

  return {
    title: `Scheduled task queued: ${name}`,
    body: bodyParts.join('\n') || 'Pikiclaw queued a scheduled task run.',
    tag: `scheduled-task:${event.automationId || event.key || name}:queued`,
  };
}
