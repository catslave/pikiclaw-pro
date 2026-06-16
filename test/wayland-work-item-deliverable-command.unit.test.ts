import { describe, expect, it } from 'vitest';
import type { ProTask, StageRun } from '../dashboard/src/types';
import { buildWorkItemDeliverableCommandItems } from '../dashboard/src/pages/wayland/workItemDeliverableCommand';

const now = '2026-06-16T00:00:00.000Z';

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-1',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Continue',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    title: input.title || 'Ship command center output routing',
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

describe('Wayland Work Item deliverable command items', () => {
  it('builds a ready command for direct and stage outputs', () => {
    const items = buildWorkItemDeliverableCommandItems([
      task({
        id: 'task-ready',
        jiraKey: 'PK-42',
        workdir: '/repo/pikiclaw',
        outputs: [{
          id: 'out-1',
          taskId: 'task-ready',
          kind: 'final',
          title: 'Migration report',
          summary: 'Ready to share',
          createdAt: now,
          path: '/repo/pikiclaw/report.md',
        }],
        stageRuns: [
          stageRun({
            id: 'verify',
            taskId: 'task-ready',
            stage: 'verification',
            status: 'completed',
            completedAt: now,
            output: { summary: 'Verified', changedFiles: ['dashboard/src/pages/wayland/WaylandShell.tsx'] },
          }),
        ],
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'deliverable:task-ready',
      title: 'Deliverables ready: Ship command center output routing',
      to: '/work-items?task=task-ready&tab=deliverables',
      tone: 'ok',
      keys: ['Ready', 'Output'],
      secondaryTo: '/repo/pikiclaw/report.md',
      secondaryLabel: 'Open file',
      priority: 32,
      lanes: [
        { label: 'Source', value: 'PK-42', tone: 'source' },
        { label: 'Output', value: 'Openable', tone: 'output' },
      ],
    });
    expect(items[0].detail).toContain('PK-42');
    expect(items[0].detail).toContain('2 outputs');
    expect(items[0].keywords.join(' ')).toContain('report.md');
    expect(items[0].keywords.join(' ')).toContain('WaylandShell.tsx');
  });

  it('prioritizes review commands and sends them to runs', () => {
    const items = buildWorkItemDeliverableCommandItems([
      task({
        id: 'task-ready',
        title: 'Ready lower priority',
        outputs: [{ id: 'out-1', taskId: 'task-ready', kind: 'final', title: 'Done', createdAt: now }],
      }),
      task({
        id: 'task-review',
        title: 'Fix failed verification',
        jiraKey: 'PK-99',
        stageRuns: [
          stageRun({ id: 'verify', taskId: 'task-review', stage: 'verification', status: 'failed', completedAt: now }),
        ],
        outputs: [{ id: 'out-2', taskId: 'task-review', kind: 'diff', title: 'Diff', createdAt: now }],
      }),
    ]);

    expect(items[0]).toMatchObject({
      key: 'deliverable:task-review',
      title: 'Review deliverables: Fix failed verification',
      to: '/work-items?task=task-review&tab=runs',
      tone: 'warn',
      keys: ['Review', 'Runs'],
    });
    expect(items[0].detail).toContain('PK-99');
    expect(items[0].detail).toContain('1 review');
  });

  it('exposes the pinned direct output as a safe secondary action', () => {
    const items = buildWorkItemDeliverableCommandItems([
      task({
        id: 'task-links',
        title: 'Publish evidence',
        outputs: [
          {
            id: 'out-old',
            taskId: 'task-links',
            kind: 'document',
            title: 'Older file',
            createdAt: '2026-06-15T00:00:00.000Z',
            path: '/repo/pikiclaw/old.md',
          },
          {
            id: 'out-pinned',
            taskId: 'task-links',
            kind: 'link',
            title: 'Final report',
            createdAt: '2026-06-14T00:00:00.000Z',
            url: 'https://example.test/report',
            pinned: true,
          },
        ],
      }),
    ]);

    expect(items[0]).toMatchObject({
      key: 'deliverable:task-links',
      secondaryTo: 'https://example.test/report',
      secondaryLabel: 'Open output',
    });
  });

  it('omits the secondary action when only stage summaries are available', () => {
    const items = buildWorkItemDeliverableCommandItems([
      task({
        id: 'task-stage-only',
        title: 'Review stage summary',
        stageRuns: [
          stageRun({
            id: 'verify',
            taskId: 'task-stage-only',
            stage: 'verification',
            status: 'completed',
            completedAt: now,
            output: { summary: 'Verified by tests' },
          }),
        ],
      }),
    ]);

    expect(items[0].secondaryTo).toBeUndefined();
    expect(items[0].secondaryLabel).toBeUndefined();
  });

  it('omits tasks without outputs or review-needed runs', () => {
    expect(buildWorkItemDeliverableCommandItems([
      task({ id: 'empty', stageRuns: [stageRun({ id: 'code', stage: 'coding', status: 'running' })] }),
    ])).toEqual([]);
  });
});
