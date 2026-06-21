import type { ProTask } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';

export type WorkItemDecisionAuditCommandTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkItemDecisionAuditCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  priority?: number;
  lanes?: WorkItemCommandLane[];
  keys: string[];
  tone: WorkItemDecisionAuditCommandTone;
  keywords: string[];
}

export interface WorkItemDecisionAuditCommandOptions {
  limit?: number;
}

type WorkItemEvent = ProTask['events'][number];

export interface WorkItemDecisionAuditSummary {
  guardedEvents: WorkItemEvent[];
  userDecisionEvents: WorkItemEvent[];
  guardedChangeCount: number;
  latestGuardedEvent: WorkItemEvent | null;
  needsReview: boolean;
  detail: string;
}

function workItemDetailUrl(taskId: string): string {
  const params = new URLSearchParams();
  params.set('task', taskId);
  params.set('tab', 'timeline');
  return `/work-items?${params.toString()}`;
}

function isUserDecisionEvent(event: WorkItemEvent): boolean {
  if (event.actor !== 'user') return false;
  return event.type === 'jira-updated'
    || event.type === 'status-changed'
    || event.type === 'stage-output-confirmed'
    || event.type === 'exclusive-mode-changed'
    || event.type === 'task-reset'
    || event.type === 'verification-started'
    || event.type === 'verification-finished'
    || event.type === 'subtask-created'
    || event.type === 'subtask-updated'
    || event.type === 'background-updated'
    || event.type === 'user-focus-started'
    || event.type === 'user-focus-finished';
}

function isGuardedChangeEvent(event: WorkItemEvent): boolean {
  return event.type === 'jira-updated'
    || event.type === 'deployment-linked'
    || event.type === 'stage-output-confirmed'
    || event.type === 'exclusive-mode-changed'
    || event.type === 'task-reset';
}

function eventTime(event: WorkItemEvent): number {
  const value = Date.parse(event.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function latestEventTime(events: WorkItemEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, eventTime(event)), 0);
}

function sourceLabel(task: ProTask): string {
  return task.jiraKey || (task.kind === 'todo' ? 'Todo' : task.kind);
}

function guardedChangeLabel(count: number): string {
  return `${count} guarded change${count === 1 ? '' : 's'}`;
}

export function summarizeWorkItemDecisionAudit(task: ProTask): WorkItemDecisionAuditSummary {
  const events = task.events || [];
  const guardedEvents = events
    .filter(isGuardedChangeEvent)
    .sort((a, b) => eventTime(b) - eventTime(a));
  const userDecisionEvents = events
    .filter(isUserDecisionEvent)
    .sort((a, b) => eventTime(b) - eventTime(a));
  const guardedChangeCount = guardedEvents.length;
  const needsReview = guardedChangeCount > 0 && userDecisionEvents.length === 0;
  return {
    guardedEvents,
    userDecisionEvents,
    guardedChangeCount,
    latestGuardedEvent: guardedEvents[0] || null,
    needsReview,
    detail: needsReview
      ? `${guardedChangeLabel(guardedChangeCount)} lack a user decision event.`
      : userDecisionEvents.length
        ? 'Guarded changes have a user decision event.'
        : 'No guarded changes recorded.',
  };
}

export function buildWorkItemDecisionAuditCommandItems(
  tasks: ProTask[],
  options: WorkItemDecisionAuditCommandOptions = {},
): WorkItemDecisionAuditCommandItem[] {
  const limit = options.limit ?? 12;

  return tasks
    .map(task => {
      const audit = summarizeWorkItemDecisionAudit(task);
      if (!audit.needsReview) return null;
      const source = sourceLabel(task);
      return {
        key: `decision-audit:${task.id}`,
        title: `Review decision audit: ${task.title}`,
        detail: `${source} · ${audit.detail}`,
        to: workItemDetailUrl(task.id),
        priority: 44,
        lanes: [
          commandLane('Source', source, 'source'),
          commandLane('Audit', 'Decision missing', 'attention'),
        ],
        keys: ['Audit', 'Review'],
        tone: 'warn' as const,
        keywords: [
          'decision audit',
          'approval history',
          'permission history',
          'guarded change',
          'missing user decision',
          'timeline review',
          task.id,
          task.title,
          task.kind,
          task.status,
          task.jiraKey || '',
          task.jiraUrl || '',
          task.workdir || '',
          ...audit.guardedEvents.flatMap(event => [event.type, event.actor, event.summary]),
        ].filter(Boolean),
        sortTime: latestEventTime(audit.guardedEvents) || Date.parse(task.updatedAt || '') || 0,
        sortGuardedCount: audit.guardedChangeCount,
      };
    })
    .filter((item): item is WorkItemDecisionAuditCommandItem & { sortTime: number; sortGuardedCount: number } => !!item)
    .sort((a, b) => b.sortGuardedCount - a.sortGuardedCount || b.sortTime - a.sortTime || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ sortTime: _sortTime, sortGuardedCount: _sortGuardedCount, ...item }) => item);
}
