import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types';
import { buildWorkItemStatusGrammar } from '../dashboard/src/pages/wayland/workItemStatusGrammar';
import type { WorkItemOperationalSummary } from '../dashboard/src/pages/wayland/workItemOperationalState';
import type { WorkItemRemoteBoundarySummary } from '../dashboard/src/pages/wayland/workItemRemoteBoundary';
import type { WorkItemSourceHealthSummary } from '../dashboard/src/pages/wayland/workItemSourceHealth';

const task = (overrides: Partial<ProTask> = {}): ProTask => ({
  id: 'task-1',
  title: 'Ship a focused work item cockpit',
  kind: 'jira-ticket',
  status: 'refinement',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T01:00:00.000Z',
  stageRuns: [],
  verificationRuns: [],
  subTasks: [],
  ...overrides,
});

const operational = (overrides: Partial<WorkItemOperationalSummary> = {}): WorkItemOperationalSummary => ({
  stateLabel: 'Overdue',
  stateTone: 'warn',
  sourceLabel: 'Ticket IVAS-1',
  ownerLabel: 'Assistant',
  nextActionLabel: 'Continue',
  nextActionDetail: 'Continue refinement.',
  latestStageLabel: 'refinement',
  openRunCount: 0,
  outputCount: 0,
  blockedSubtaskCount: 0,
  subtaskLabel: 'No blocked subtasks',
  riskCount: 1,
  scheduleLabel: 'No schedule',
  verificationLabel: 'No verification',
  guardrailLabel: 'No guardrail',
  overdue: false,
  updatedLabel: 'Updated now',
  ...overrides,
});

const sourceHealth = (overrides: Partial<WorkItemSourceHealthSummary> = {}): WorkItemSourceHealthSummary => ({
  label: 'Jira stale',
  detail: 'Remote snapshot is older than 7 days.',
  tone: 'warn',
  evidenceCount: 1,
  stale: true,
  refreshRank: 2,
  ...overrides,
});

const remoteBoundary = (overrides: Partial<WorkItemRemoteBoundarySummary> = {}): WorkItemRemoteBoundarySummary => ({
  state: 'synced',
  label: 'Remote synced',
  detail: 'Jira snapshot is available.',
  tone: 'ok',
  remoteKey: 'IVAS-1',
  pendingRunCount: 0,
  runCount: 1,
  updatedAt: '2026-06-15T00:00:00.000Z',
  primaryRun: null,
  ...overrides,
});

describe('Wayland Work Item status grammar', () => {
  it('keeps one primary state and limits secondary risk chips', () => {
    const grammar = buildWorkItemStatusGrammar({
      task: task({ stageRuns: [{ id: 'run-1', stage: 'coding', status: 'running', startedAt: '2026-06-15T01:00:00.000Z' }] }),
      operational: operational(),
      sourceHealth: sourceHealth(),
      remoteBoundary: remoteBoundary({
        state: 'write-back-draft',
        label: 'Write-back draft',
        detail: 'A Jira update draft is waiting for review.',
        tone: 'warn',
        pendingRunCount: 1,
      }),
      reviewCount: 2,
      attention: true,
    });

    expect(grammar.primary).toMatchObject({ label: 'Overdue', tone: 'warn' });
    expect(grammar.secondary.map(item => item.key)).toEqual(['remote', 'review']);
    expect(grammar.hiddenCount).toBe(2);
    expect(grammar.allSignals.map(item => item.key)).toEqual(['remote', 'review', 'source', 'running']);
  });

  it('does not repeat generic attention when a concrete signal already explains the risk', () => {
    const grammar = buildWorkItemStatusGrammar({
      task: task(),
      operational: operational(),
      sourceHealth: sourceHealth(),
      remoteBoundary: remoteBoundary({ state: 'failed', label: 'Remote failed', tone: 'err' }),
      attention: true,
    });

    expect(grammar.allSignals.map(item => item.key)).toEqual(['remote', 'source']);
    expect(grammar.hiddenCount).toBe(0);
  });

  it('uses generic attention only when there is no concrete secondary signal', () => {
    const grammar = buildWorkItemStatusGrammar({
      task: task(),
      operational: operational(),
      sourceHealth: sourceHealth({ stale: false, tone: 'ok', label: 'Source current' }),
      remoteBoundary: remoteBoundary(),
      attention: true,
    });

    expect(grammar.allSignals.map(item => item.key)).toEqual(['attention']);
  });

  it('shows source health as the risk when it is the only failing signal', () => {
    const grammar = buildWorkItemStatusGrammar({
      task: task(),
      operational: operational({ stateLabel: 'Ready', stateTone: 'active', riskCount: 0 }),
      sourceHealth: sourceHealth({ label: 'Missing source', tone: 'warn', stale: false }),
      remoteBoundary: remoteBoundary(),
    });

    expect(grammar.primary).toMatchObject({ label: 'Ready', tone: 'active' });
    expect(grammar.secondary).toEqual([
      expect.objectContaining({ key: 'source', label: 'Missing source', tone: 'warn' }),
    ]);
  });
});
