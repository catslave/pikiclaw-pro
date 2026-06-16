import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  buildUsageBudgetStatuses,
  deleteUsageBudget,
  evaluateUsageBudgetGate,
  hasEnabledPauseUsageBudget,
  listUsageBudgetAlerts,
  listUsageBudgets,
  periodStart,
  recordUsageBudgetWarnAlertsForEvent,
  upsertUsageBudget,
} from '../src/pro/usage-budget.ts';
import type { CostLedgerEvent } from '../src/pro/cost-ledger.ts';

let tmpDir: string;
let previousBudgetFile: string | undefined;
let previousBudgetAlertFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-usage-budget-');
  previousBudgetFile = process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  previousBudgetAlertFile = process.env.PIKICLAW_PRO_USAGE_BUDGET_ALERT_FILE;
  process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = path.join(tmpDir, 'usage-budgets.json');
  process.env.PIKICLAW_PRO_USAGE_BUDGET_ALERT_FILE = path.join(tmpDir, 'usage-budget-alerts.json');
});

afterEach(() => {
  if (previousBudgetFile == null) delete process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  else process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = previousBudgetFile;
  if (previousBudgetAlertFile == null) delete process.env.PIKICLAW_PRO_USAGE_BUDGET_ALERT_FILE;
  else process.env.PIKICLAW_PRO_USAGE_BUDGET_ALERT_FILE = previousBudgetAlertFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function costEvent(overrides: Partial<CostLedgerEvent>): CostLedgerEvent {
  return {
    id: 'cost-test',
    agent: 'codex',
    workdir: '/repo/pikiclaw',
    sessionId: 'sess-test',
    model: 'gpt-costed',
    status: 'ok',
    inputTokens: 1000,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 1000,
    elapsedSeconds: 1,
    estimatedCostUsd: 0,
    pricedTokens: 1000,
    unpricedTokens: 0,
    costSource: 'estimated',
    createdAt: '2026-06-13T04:00:00.000Z',
    ...overrides,
  };
}

describe('usage budgets', () => {
  it('computes calendar period starts', () => {
    const at = new Date(2026, 5, 13, 15, 30, 0);
    const localKey = (value: Date) => [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
    expect(localKey(periodStart('day', at))).toBe('2026-06-13');
    expect(localKey(periodStart('week', at))).toBe('2026-06-08');
    expect(localKey(periodStart('month', at))).toBe('2026-06-01');
  });

  it('persists budgets and computes global period pressure', () => {
    const budget = upsertUsageBudget({
      name: 'Daily guard',
      scope: 'global',
      limitTokens: 1_000,
      period: 'day',
      action: 'warn',
    });

    expect(listUsageBudgets()[0]).toMatchObject({ id: budget.id, name: 'Daily guard', limitTokens: 1_000 });

    const statuses = buildUsageBudgetStatuses({
      totals: { totalTokens: 1_700 },
      byDay: [
        { day: '2026-06-13', totalTokens: 850 },
        { day: '2026-06-12', totalTokens: 900 },
      ],
      byAgent: [],
      topChats: [],
    }, new Date(2026, 5, 13, 12, 0, 0));

    expect(statuses[0]).toMatchObject({
      id: budget.id,
      usedTokens: 850,
      state: 'warn',
    });
    expect(statuses[0].usedPercent).toBe(85);
  });

  it('supports agent budgets and deletion', () => {
    const budget = upsertUsageBudget({
      scope: 'agent',
      scopeKey: 'codex',
      limitTokens: 500,
      period: 'week',
      action: 'pause',
    });

    const statuses = buildUsageBudgetStatuses({
      totals: { totalTokens: 0 },
      byDay: [],
      byAgent: [{ agent: 'codex', totalTokens: 900 }],
      topChats: [
        { agent: 'codex', totalTokens: 260, createdAt: '2026-06-12T10:00:00.000Z', updatedAt: '2026-06-12T11:00:00.000Z' },
        { agent: 'codex', totalTokens: 320, createdAt: '2026-06-09T10:00:00.000Z', updatedAt: '2026-06-09T11:00:00.000Z' },
        { agent: 'gemini', totalTokens: 900, createdAt: '2026-06-12T10:00:00.000Z', updatedAt: '2026-06-12T11:00:00.000Z' },
      ],
    }, new Date(2026, 5, 13, 12, 0, 0));

    expect(statuses[0]).toMatchObject({
      id: budget.id,
      scope: 'agent',
      scopeKey: 'codex',
      usedTokens: 580,
      matchedChats: 2,
      state: 'over',
    });
    expect(hasEnabledPauseUsageBudget()).toBe(true);
    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex' })).toMatchObject({
      allowed: false,
      budget: expect.objectContaining({ id: budget.id }),
    });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'gemini' })).toEqual({ allowed: true });

    expect(deleteUsageBudget(budget.id)).toBe(true);
    expect(listUsageBudgets()).toEqual([]);
  });

  it('blocks all agents for an over-limit global pause budget', () => {
    const budget = upsertUsageBudget({
      name: 'Global pause',
      scope: 'global',
      limitTokens: 10,
      period: 'day',
      action: 'pause',
    });

    const statuses = buildUsageBudgetStatuses({
      totals: { totalTokens: 0 },
      byDay: [{ day: '2026-06-13', totalTokens: 12 }],
      byAgent: [],
      topChats: [],
    }, new Date(2026, 5, 13, 12, 0, 0));

    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex' })).toMatchObject({
      allowed: false,
      budget: expect.objectContaining({ id: budget.id }),
      message: expect.stringContaining('Global pause'),
    });
  });

  it('supports ledger-backed USD pause budgets', () => {
    const budget = upsertUsageBudget({
      name: 'Codex spend pause',
      scope: 'agent',
      scopeKey: 'codex',
      unit: 'usd',
      limitUsd: 0.01,
      period: 'day',
      action: 'pause',
    });

    const statuses = buildUsageBudgetStatuses({
      totals: { totalTokens: 0 },
      byDay: [],
      byAgent: [],
      topChats: [],
    }, new Date(2026, 5, 13, 12, 0, 0), {
      costLedgerEvents: [
        {
          id: 'cost-1',
          agent: 'codex',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-1',
          model: 'gpt-costed',
          status: 'ok',
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1500,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.012,
          pricedTokens: 1500,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-13T04:00:00.000Z',
        },
        {
          id: 'cost-old',
          agent: 'codex',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-old',
          model: 'gpt-costed',
          status: 'ok',
          inputTokens: 1000,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1000,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.5,
          pricedTokens: 1000,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-12T04:00:00.000Z',
        },
        {
          id: 'cost-gemini',
          agent: 'gemini',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-2',
          model: 'gemini-costed',
          status: 'ok',
          inputTokens: 1000,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1000,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.5,
          pricedTokens: 1000,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-13T04:00:00.000Z',
        },
      ],
    });

    expect(statuses[0]).toMatchObject({
      id: budget.id,
      unit: 'usd',
      limitUsd: 0.01,
      usedUsd: 0.012,
      usedTokens: 0,
      matchedEvents: 1,
      state: 'over',
    });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex' })).toMatchObject({
      allowed: false,
      budget: expect.objectContaining({ id: budget.id }),
      message: expect.stringContaining('$0.01/$0.01'),
    });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'gemini' })).toEqual({ allowed: true });
  });

  it('supports model-scoped ledger-backed USD pause budgets', () => {
    const budget = upsertUsageBudget({
      name: 'GPT spend pause',
      scope: 'model',
      scopeKey: 'gpt-costed',
      unit: 'usd',
      limitUsd: 0.01,
      period: 'day',
      action: 'pause',
    });

    const statuses = buildUsageBudgetStatuses({
      totals: { totalTokens: 0 },
      byDay: [],
      byAgent: [],
      topChats: [],
    }, new Date(2026, 5, 13, 12, 0, 0), {
      costLedgerEvents: [
        {
          id: 'cost-gpt-codex',
          agent: 'codex',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-1',
          model: 'gpt-costed',
          status: 'ok',
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1500,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.007,
          pricedTokens: 1500,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-13T04:00:00.000Z',
        },
        {
          id: 'cost-gpt-gemini',
          agent: 'gemini',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-2',
          model: 'gpt-costed',
          status: 'ok',
          inputTokens: 800,
          outputTokens: 200,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1000,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.005,
          pricedTokens: 1000,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-13T05:00:00.000Z',
        },
        {
          id: 'cost-other-model',
          agent: 'codex',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-3',
          model: 'gemini-costed',
          status: 'ok',
          inputTokens: 1000,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 1000,
          elapsedSeconds: 1,
          estimatedCostUsd: 0.5,
          pricedTokens: 1000,
          unpricedTokens: 0,
          costSource: 'estimated',
          createdAt: '2026-06-13T04:00:00.000Z',
        },
      ],
    });

    expect(statuses[0]).toMatchObject({
      id: budget.id,
      scope: 'model',
      scopeKey: 'gpt-costed',
      usedUsd: 0.012,
      matchedEvents: 2,
      state: 'over',
    });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex', model: 'gpt-costed' })).toMatchObject({
      allowed: false,
      budget: expect.objectContaining({ id: budget.id }),
      message: expect.stringContaining('for gpt-costed'),
    });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex', model: 'gemini-costed' })).toEqual({ allowed: true });
    expect(evaluateUsageBudgetGate(statuses, { agent: 'codex' })).toEqual({ allowed: true });
  });

  it('records one post-turn warn alert when a ledger event crosses a model spend budget', () => {
    const budget = upsertUsageBudget({
      name: 'GPT spend warning',
      scope: 'model',
      scopeKey: 'gpt-costed',
      unit: 'usd',
      limitUsd: 0.01,
      period: 'day',
      action: 'warn',
    });
    const previous = costEvent({
      id: 'cost-before',
      model: 'gpt-costed',
      estimatedCostUsd: 0.006,
      createdAt: '2026-06-13T04:00:00.000Z',
    });
    const crossing = costEvent({
      id: 'cost-crossing',
      model: 'gpt-costed',
      estimatedCostUsd: 0.005,
      createdAt: '2026-06-13T05:00:00.000Z',
    });
    const otherModel = costEvent({
      id: 'cost-other-model',
      model: 'gemini-costed',
      estimatedCostUsd: 0.5,
      createdAt: '2026-06-13T05:30:00.000Z',
    });

    expect(recordUsageBudgetWarnAlertsForEvent(otherModel, [previous, otherModel])).toEqual([]);

    const alerts = recordUsageBudgetWarnAlertsForEvent(crossing, [previous, crossing, otherModel]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      budgetId: budget.id,
      budgetName: 'GPT spend warning',
      scope: 'model',
      scopeKey: 'gpt-costed',
      unit: 'usd',
      limitUsd: 0.01,
      usedUsd: 0.011,
      eventId: 'cost-crossing',
      agent: 'codex',
      model: 'gpt-costed',
    });
    expect(recordUsageBudgetWarnAlertsForEvent(crossing, [previous, crossing, otherModel])).toEqual([]);
    expect(listUsageBudgetAlerts()).toHaveLength(1);
  });
});
