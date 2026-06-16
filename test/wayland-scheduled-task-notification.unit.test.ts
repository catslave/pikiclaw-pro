import { describe, expect, it } from 'vitest';
import { scheduledTaskNotificationRequest } from '../dashboard/src/pages/wayland/scheduledTaskNotification.ts';
import type { DashboardEvent } from '../dashboard/src/ws.ts';

function event(overrides: Partial<DashboardEvent>): DashboardEvent {
  return {
    type: 'scheduled-task',
    automationId: 'automation-digest',
    name: 'Morning digest',
    schedule: 'daily@09:00',
    ...overrides,
  };
}

describe('Wayland scheduled task browser notifications', () => {
  it('builds a low-friction queued notification', () => {
    const request = scheduledTaskNotificationRequest(event({ status: 'queued', sessionKey: 'codex:pending' }));

    expect(request).toMatchObject({
      title: 'Scheduled task queued: Morning digest',
      body: 'Schedule: daily@09:00\nSession: codex:pending',
      tag: 'scheduled-task:automation-digest:queued',
    });
    expect(request?.requireInteraction).toBeUndefined();
  });

  it('marks failed and missed notifications as attention-worthy', () => {
    expect(scheduledTaskNotificationRequest(event({
      status: 'failed',
      error: 'Usage budget paused this run.',
    }))).toMatchObject({
      title: 'Scheduled task needs review: Morning digest',
      body: 'Schedule: daily@09:00\nUsage budget paused this run.',
      tag: 'scheduled-task:automation-digest:failed',
      requireInteraction: true,
    });

    expect(scheduledTaskNotificationRequest(event({
      status: 'missed',
      error: 'Pikiclaw was not available.',
    }))).toMatchObject({
      title: 'Missed scheduled task: Morning digest',
      body: 'Schedule: daily@09:00\nPikiclaw was not available.',
      tag: 'scheduled-task:automation-digest:missed',
      requireInteraction: true,
    });
  });

  it('builds completion notifications from the same scheduled task preference lane', () => {
    expect(scheduledTaskNotificationRequest(event({ status: 'completed' }))).toMatchObject({
      title: 'Scheduled task complete: Morning digest',
      tag: 'scheduled-task:automation-digest:completed',
    });
  });

  it('ignores non scheduled-task events', () => {
    expect(scheduledTaskNotificationRequest({ type: 'sessions-changed', key: 'codex:1' })).toBeNull();
  });
});
