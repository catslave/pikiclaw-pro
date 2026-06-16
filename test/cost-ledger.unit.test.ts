import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCostLedgerSummary,
  listCostLedgerEvents,
  recordCostLedgerEvent,
} from '../src/pro/cost-ledger.js';
import type { UsageCostEstimator } from '../src/pro/usage-cost.js';
import { captureEnv, makeTmpDir, restoreEnv } from './support/env.js';

const envSnapshot = captureEnv(['PIKICLAW_PRO_COST_LEDGER_FILE']);

const estimator: UsageCostEstimator = {
  catalogReady: true,
  estimate: (_model, usage) => {
    const inputTokens = Math.max(0, Number(usage?.inputTokens || 0));
    const outputTokens = Math.max(0, Number(usage?.outputTokens || 0));
    const cachedInputTokens = Math.max(0, Number(usage?.cachedInputTokens || 0));
    const pricedTokens = inputTokens + outputTokens + cachedInputTokens;
    return {
      estimatedCostUsd: (inputTokens * 0.000001) + (outputTokens * 0.000003) + (cachedInputTokens * 0.0000002),
      pricedTokens,
      unpricedTokens: 0,
      costSource: pricedTokens ? 'estimated' : 'unknown',
    };
  },
};

beforeEach(() => {
  restoreEnv(envSnapshot);
  const dir = makeTmpDir('cost-ledger-unit-');
  process.env.PIKICLAW_PRO_COST_LEDGER_FILE = path.join(dir, 'cost-events.json');
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

describe('cost ledger', () => {
  it('records turn-level cost events and summarizes them by agent, model, channel, session, and day', async () => {
    const first = await recordCostLedgerEvent({
      agent: 'codex',
      workdir: '/repo/pikiclaw',
      sessionId: 'sess-1',
      threadId: 'thread-1',
      model: 'gpt-costed',
      channel: 'telegram',
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 500,
      cacheCreationInputTokens: 50,
      elapsedSeconds: 1.25,
      createdAt: '2026-06-13T01:00:00.000Z',
    }, { estimator });
    await recordCostLedgerEvent({
      agent: 'claude',
      workdir: '/repo/pikiclaw',
      sessionId: 'sess-2',
      model: 'claude-costed',
      status: 'failed',
      inputTokens: 300,
      outputTokens: 0,
      createdAt: '2026-06-13T02:00:00.000Z',
    }, { estimator });

    expect(first).toMatchObject({
      agent: 'codex',
      sessionId: 'sess-1',
      totalTokens: 1750,
      pricedTokens: 1700,
      unpricedTokens: 50,
      costSource: 'mixed',
    });

    const events = listCostLedgerEvents();
    expect(events.map(event => event.sessionId)).toEqual(['sess-2', 'sess-1']);

    const summary = buildCostLedgerSummary(events);
    expect(summary).toMatchObject({
      eventCount: 2,
      totalTokens: 2050,
      latestEventAt: '2026-06-13T02:00:00.000Z',
      costSource: 'mixed',
    });
    expect(summary.byAgent.map(bucket => bucket.key)).toEqual(['codex', 'claude']);
    expect(summary.byAgent.find(bucket => bucket.key === 'codex')).toMatchObject({
      eventCount: 1,
      turnCount: 1,
      totalTokens: 1750,
    });
    expect(summary.byAgent.find(bucket => bucket.key === 'claude')).toMatchObject({
      eventCount: 1,
      turnCount: 0,
      totalTokens: 300,
    });
    expect(summary.byModel.map(bucket => bucket.key)).toContain('gpt-costed');
    expect(summary.byChannel.find(bucket => bucket.key === 'telegram')).toMatchObject({
      eventCount: 1,
      totalTokens: 1750,
    });
    expect(summary.byChannel.find(bucket => bucket.key === '(dashboard/local)')).toMatchObject({
      eventCount: 1,
      totalTokens: 300,
    });
    expect(summary.bySession.find(bucket => bucket.key === 'sess-1')).toMatchObject({
      eventCount: 1,
      totalTokens: 1750,
    });
    expect(summary.byDay[0]).toMatchObject({ key: '2026-06-13', eventCount: 2 });
  });

  it('ignores malformed ledger rows while preserving valid rows', () => {
    fs.writeFileSync(process.env.PIKICLAW_PRO_COST_LEDGER_FILE!, JSON.stringify({
      version: 1,
      events: [
        { id: '', agent: 'codex', createdAt: '2026-06-13T00:00:00.000Z' },
        {
          id: 'cost_valid',
          agent: 'codex',
          workdir: '/repo/pikiclaw',
          sessionId: 'sess-valid',
          model: 'gpt-costed',
          status: 'ok',
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 15,
          estimatedCostUsd: 0.001,
          pricedTokens: 15,
          unpricedTokens: 0,
          costSource: 'estimated',
          elapsedSeconds: 0.5,
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    }));

    expect(listCostLedgerEvents()).toHaveLength(1);
    expect(buildCostLedgerSummary().eventCount).toBe(1);
  });
});
