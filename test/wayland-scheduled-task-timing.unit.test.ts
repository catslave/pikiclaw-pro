import { describe, expect, it } from 'vitest';
import {
  parseScheduledTaskSchedule,
  scheduledTaskNextRunAt,
  scheduledTaskNextRunLabel,
  scheduledTaskScheduleLabel,
} from '../dashboard/src/pages/wayland/scheduledTaskTiming.ts';

function localParts(date: Date | null | undefined) {
  if (!date) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

describe('Wayland scheduled task timing model', () => {
  it('normalizes Pikiclaw schedule strings into user-facing labels', () => {
    expect(parseScheduledTaskSchedule('weekly@2@8:05')).toEqual({
      schedule: 'weekly',
      time: '08:05',
      weekday: '2',
      day: '1',
    });
    expect(scheduledTaskScheduleLabel('monthly@31@18:30')).toBe('Monthly on day 31 at 18:30');
    expect(scheduledTaskScheduleLabel('manual')).toBe('Manual run');
  });

  it('computes the next daily run after the selected time has passed', () => {
    const next = scheduledTaskNextRunAt('daily@09:00', {
      now: new Date('2026-06-14T10:00:00'),
      enabled: true,
    });
    expect(localParts(next)).toEqual({ year: 2026, month: 6, day: 15, hour: 9, minute: 0 });
  });

  it('computes weekly and monthly next runs without drifting past the schedule', () => {
    expect(localParts(scheduledTaskNextRunAt('weekly@1@09:30', {
      now: new Date('2026-06-14T10:00:00'),
      enabled: true,
    }))).toEqual({ year: 2026, month: 6, day: 15, hour: 9, minute: 30 });

    expect(localParts(scheduledTaskNextRunAt('monthly@31@09:00', {
      now: new Date('2026-06-30T10:00:00'),
      enabled: true,
    }))).toEqual({ year: 2026, month: 7, day: 31, hour: 9, minute: 0 });
  });

  it('anchors biweekly schedules from the last run when available', () => {
    const next = scheduledTaskNextRunAt('biweekly@1@09:00', {
      now: new Date('2026-06-14T10:00:00'),
      lastRunAt: '2026-06-08T09:00:00.000Z',
      enabled: true,
    });
    expect(localParts(next)).toEqual({ year: 2026, month: 6, day: 22, hour: 9, minute: 0 });
  });

  it('reports paused and manual tasks without inventing a next run', () => {
    expect(scheduledTaskNextRunAt('daily@09:00', {
      now: new Date('2026-06-14T10:00:00'),
      enabled: false,
    })).toBeNull();
    expect(scheduledTaskNextRunLabel('manual', { enabled: true })).toBe('Manual only');
    expect(scheduledTaskNextRunLabel('daily@09:00', { enabled: false })).toBe('Paused');
  });
});
