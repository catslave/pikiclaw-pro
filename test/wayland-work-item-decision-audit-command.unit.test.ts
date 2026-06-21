import { describe, expect, it } from 'vitest';
import type { ProTask, ProTaskEvent } from '../dashboard/src/types';
import { buildWorkItemDecisionAuditCommandItems, summarizeWorkItemDecisionAudit } from '../dashboard/src/pages/wayland/workItemDecisionAuditCommand';

const now = '2026-06-16T00:00:00.000Z';

function event(input: Partial<ProTaskEvent> & Pick<ProTaskEvent, 'id' | 'type' | 'actor' | 'summary'>): ProTaskEvent {
  return {
    taskId: 'task-1',
    createdAt: now,
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Review remote change',
    kind: input.kind || 'jira-ticket',
    status: input.status || 'coding',
    createdAt: now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

describe('Wayland Work Item decision audit command items', () => {
  it('surfaces guarded changes that lack a user decision event', () => {
    const items = buildWorkItemDecisionAuditCommandItems([
      task({
        id: 'task-audit',
        title: 'Review deployment link',
        jiraKey: 'PCL-77',
        events: [
          event({ id: 'deploy', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.' }),
        ],
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'decision-audit:task-audit',
      title: 'Review decision audit: Review deployment link',
      detail: 'PCL-77 · 1 guarded change lack a user decision event.',
      to: '/work-items?task=task-audit&tab=timeline',
      tone: 'warn',
      priority: 44,
      keys: ['Audit', 'Review'],
      lanes: [
        { label: 'Source', value: 'PCL-77', tone: 'source' },
        { label: 'Audit', value: 'Decision missing', tone: 'attention' },
      ],
    });
    expect(items[0].keywords.join(' ')).toContain('permission history');
    expect(items[0].keywords.join(' ')).toContain('deployment-linked');
  });

  it('omits guarded changes that already have a user decision event', () => {
    const items = buildWorkItemDecisionAuditCommandItems([
      task({
        id: 'task-approved',
        events: [
          event({ id: 'draft', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.' }),
          event({ id: 'decision', type: 'status-changed', actor: 'user', summary: 'Status changed from coding to resolved.' }),
        ],
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('summarizes guarded events for the timeline audit panel', () => {
    const summary = summarizeWorkItemDecisionAudit(task({
      events: [
        event({ id: 'older', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.', createdAt: '2026-06-15T00:00:00.000Z' }),
        event({ id: 'newer', type: 'task-reset', actor: 'assistant', summary: 'Task reset after failed run.', createdAt: '2026-06-17T00:00:00.000Z' }),
        event({ id: 'plain', type: 'comment', actor: 'system', summary: 'Plain note.', createdAt: '2026-06-18T00:00:00.000Z' }),
      ],
    }));

    expect(summary.needsReview).toBe(true);
    expect(summary.guardedChangeCount).toBe(2);
    expect(summary.latestGuardedEvent?.id).toBe('newer');
    expect(summary.guardedEvents.map(item => item.id)).toEqual(['newer', 'older']);
    expect(summary.detail).toBe('2 guarded changes lack a user decision event.');
  });

  it('sorts higher-risk audit items before older single guarded changes', () => {
    const items = buildWorkItemDecisionAuditCommandItems([
      task({
        id: 'single',
        title: 'Single guarded change',
        updatedAt: '2026-06-17T00:00:00.000Z',
        events: [
          event({ id: 'one', type: 'task-reset', actor: 'system', summary: 'Task reset remotely.', createdAt: '2026-06-17T00:00:00.000Z' }),
        ],
      }),
      task({
        id: 'multiple',
        title: 'Multiple guarded changes',
        updatedAt: '2026-06-15T00:00:00.000Z',
        events: [
          event({ id: 'deploy', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.', createdAt: '2026-06-15T00:00:00.000Z' }),
          event({ id: 'mode', type: 'exclusive-mode-changed', actor: 'system', summary: 'Exclusive mode changed.', createdAt: '2026-06-15T00:00:00.000Z' }),
        ],
      }),
    ]);

    expect(items.map(item => item.key)).toEqual([
      'decision-audit:multiple',
      'decision-audit:single',
    ]);
  });

  it('omits tasks that have no guarded changes', () => {
    expect(buildWorkItemDecisionAuditCommandItems([
      task({
        id: 'plain',
        events: [event({ id: 'comment', type: 'comment', actor: 'system', summary: 'A system note.' })],
      }),
    ])).toEqual([]);
  });
});
