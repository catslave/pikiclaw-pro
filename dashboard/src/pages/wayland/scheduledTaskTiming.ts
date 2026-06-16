export type ScheduledTaskScheduleKind = 'manual' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface ScheduledTaskScheduleParts {
  schedule: ScheduledTaskScheduleKind;
  time: string;
  weekday: string;
  day: string;
}

export interface ScheduledTaskNextRunOptions {
  now?: Date;
  lastRunAt?: string | null;
  createdAt?: string | null;
  enabled?: boolean | null;
}

export const SCHEDULE_WEEKDAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};

function normalizeTime(value: string | undefined): string {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '09:00';
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDay(value: string | undefined): string {
  const day = Math.max(1, Math.min(31, Number(value) || 1));
  return String(day);
}

function parseWeekday(value: string | undefined): string {
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? String(day) : '1';
}

export function parseScheduledTaskSchedule(value: string | null | undefined): ScheduledTaskScheduleParts {
  const raw = String(value || 'manual').trim();
  const [kind = 'manual', first = '', second = ''] = raw.split('@');
  if (kind === 'daily') {
    return { schedule: 'daily', time: normalizeTime(first), weekday: '1', day: '1' };
  }
  if (kind === 'weekly' || kind === 'biweekly') {
    return { schedule: kind, time: normalizeTime(second), weekday: parseWeekday(first), day: '1' };
  }
  if (kind === 'monthly') {
    return { schedule: 'monthly', time: normalizeTime(second), weekday: '1', day: parseDay(first) };
  }
  return { schedule: 'manual', time: '09:00', weekday: '1', day: '1' };
}

export function scheduledTaskScheduleLabel(value: string | null | undefined): string {
  const parsed = parseScheduledTaskSchedule(value);
  if (parsed.schedule === 'daily') return `Daily at ${parsed.time}`;
  if (parsed.schedule === 'weekly') return `Weekly on ${SCHEDULE_WEEKDAY_LABELS[parsed.weekday] || parsed.weekday} at ${parsed.time}`;
  if (parsed.schedule === 'biweekly') return `Biweekly on ${SCHEDULE_WEEKDAY_LABELS[parsed.weekday] || parsed.weekday} at ${parsed.time}`;
  if (parsed.schedule === 'monthly') return `Monthly on day ${parsed.day} at ${parsed.time}`;
  return 'Manual run';
}

function dateAtTime(base: Date, time: string): Date {
  const [hour = '9', minute = '0'] = time.split(':');
  const next = new Date(base);
  next.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function monthlyCandidate(now: Date, day: number, time: string, offset = 0): Date {
  const year = now.getFullYear();
  const month = now.getMonth() + offset;
  const candidate = new Date(year, month, 1);
  const clampedDay = Math.min(day, daysInMonth(candidate.getFullYear(), candidate.getMonth()));
  candidate.setDate(clampedDay);
  return dateAtTime(candidate, time);
}

export function scheduledTaskNextRunAt(
  schedule: string | null | undefined,
  options: ScheduledTaskNextRunOptions = {},
): Date | null {
  if (options.enabled === false) return null;
  const parsed = parseScheduledTaskSchedule(schedule);
  if (parsed.schedule === 'manual') return null;

  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return null;

  if (parsed.schedule === 'daily') {
    const candidate = dateAtTime(now, parsed.time);
    return candidate.getTime() > now.getTime() ? candidate : addDays(candidate, 1);
  }

  if (parsed.schedule === 'weekly') {
    const targetWeekday = Number(parsed.weekday);
    const candidate = dateAtTime(now, parsed.time);
    let delta = (targetWeekday - now.getDay() + 7) % 7;
    if (delta === 0 && candidate.getTime() <= now.getTime()) delta = 7;
    return addDays(candidate, delta);
  }

  if (parsed.schedule === 'biweekly') {
    const anchorRaw = options.lastRunAt || options.createdAt;
    const anchor = anchorRaw ? new Date(anchorRaw) : null;
    if (anchor && !Number.isNaN(anchor.getTime())) {
      let candidate = dateAtTime(anchor, parsed.time);
      while (candidate.getTime() <= now.getTime()) {
        candidate = addDays(candidate, 14);
      }
      return candidate;
    }
    const targetWeekday = Number(parsed.weekday);
    const candidate = dateAtTime(now, parsed.time);
    let delta = (targetWeekday - now.getDay() + 7) % 7;
    if (delta === 0 && candidate.getTime() <= now.getTime()) delta = 14;
    return addDays(candidate, delta);
  }

  const day = Number(parsed.day) || 1;
  const candidate = monthlyCandidate(now, day, parsed.time, 0);
  return candidate.getTime() > now.getTime() ? candidate : monthlyCandidate(now, day, parsed.time, 1);
}

export function scheduledTaskNextRunLabel(
  schedule: string | null | undefined,
  options: ScheduledTaskNextRunOptions = {},
): string {
  const next = scheduledTaskNextRunAt(schedule, options);
  if (!next) return options.enabled === false ? 'Paused' : 'Manual only';
  return next.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
