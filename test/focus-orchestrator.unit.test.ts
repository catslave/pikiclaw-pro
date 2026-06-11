import { describe, expect, it } from 'vitest';
import {
  buildRulesOrchestratorPlan,
  mergeOrchestratorPlan,
  parseOrchestratorJson,
} from '../src/dashboard/focus-orchestrator.ts';
import type { FocusSensorSnapshot } from '../src/dashboard/focus-sensors/index.ts';

const snapshot: FocusSensorSnapshot = {
  capturedAt: '2026-06-06T12:00:00.000Z',
  localDay: '2026-06-06',
  git: [],
  session: { running: 0, blocked: 1, review: 0, incomplete: 0, attentionTotal: 1 },
  jira: { todayIncoming: [{ taskId: 't1', title: 'Incoming' }], resolvedPendingSync: [], ok: true },
  sandboxes: [],
};

describe('focus orchestrator', () => {
  it('builds rules plan with blocked priority headline', () => {
    const plan = buildRulesOrchestratorPlan({ snapshot, recommendations: [] });
    expect(plan.headline).toContain('阻塞');
    expect(plan.source).toBe('rules');
  });

  it('parses orchestrator JSON output', () => {
    const parsed = parseOrchestratorJson(JSON.stringify({
      headline: '今天先看沙盒。',
      recommendations: [{ id: '1', title: 'Task', priority: 'high', sandboxId: 'task:1' }],
    }));
    expect(parsed?.headline).toBe('今天先看沙盒。');
    expect(parsed?.recommendations).toHaveLength(1);
  });

  it('merges parsed plan over fallback', () => {
    const fallback = buildRulesOrchestratorPlan({ snapshot, recommendations: [] });
    const merged = mergeOrchestratorPlan(fallback, {
      headline: 'Merged headline',
      recommendations: [{ id: 'x', title: 'X', priority: 'high' }],
    }, 'agent');
    expect(merged.headline).toBe('Merged headline');
    expect(merged.source).toBe('agent');
  });
});
