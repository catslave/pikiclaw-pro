import { describe, expect, it } from 'vitest';
import type { ProTask } from '../src/pro/tasks.ts';
import type { SessionInfo } from '../src/agent/types.ts';
import {
  collectJiraSensor,
  collectSessionSensor,
  sensorDigestSummary,
} from '../src/dashboard/focus-sensors/index.ts';
import type { FocusSensorSnapshot } from '../src/dashboard/focus-sensors/index.ts';

describe('focus sensors', () => {
  it('counts attention sessions', () => {
    const snapshot = collectSessionSensor([
      { archived: false, running: true, runState: 'running' } as SessionInfo,
      { archived: false, running: false, runState: 'completed', classification: { outcome: 'blocked' } } as SessionInfo,
      { archived: true, running: false, runState: 'completed' } as SessionInfo,
    ]);
    expect(snapshot.running).toBe(1);
    expect(snapshot.blocked).toBe(1);
    expect(snapshot.attentionTotal).toBe(2);
  });

  it('collects jira incoming and resolved sync items', () => {
    const now = new Date('2026-06-06T12:00:00.000Z');
    const tasks: ProTask[] = [
      {
        id: 't1',
        title: 'Bug',
        status: 'coding',
        updatedAt: '2026-06-06T11:00:00.000Z',
        plannedDate: '2026-06-06',
      } as ProTask,
      {
        id: 't2',
        title: 'Done bug',
        status: 'resolved',
        jiraKey: 'APP-2',
        updatedAt: '2026-06-05T11:00:00.000Z',
      } as ProTask,
    ];
    const jira = collectJiraSensor(tasks, now);
    expect(jira.todayIncoming).toHaveLength(1);
    expect(jira.resolvedPendingSync).toHaveLength(1);
    expect(jira.ok).toBe(true);
  });

  it('summarizes sensor delta', () => {
    const current: FocusSensorSnapshot = {
      capturedAt: '2026-06-06T12:00:00.000Z',
      localDay: '2026-06-06',
      git: [{ workdir: '/repo', workspaceName: 'repo', changedFiles: 2, ok: true }],
      session: { running: 1, blocked: 0, review: 0, incomplete: 0, attentionTotal: 1 },
      jira: { todayIncoming: [], resolvedPendingSync: [], ok: true },
      sandboxes: [],
    };
    const previous: FocusSensorSnapshot = {
      ...current,
      session: { running: 0, blocked: 0, review: 0, incomplete: 0, attentionTotal: 0 },
    };
    const summary = sensorDigestSummary(current, previous);
    expect(summary).toContain('Attention delta: 1');
  });
});
