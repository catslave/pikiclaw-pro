import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTmpDir } from './support/env.ts';

const {
  buildProUsageSummaryMock,
  getBotRefMock,
  runtimeMock,
} = vi.hoisted(() => {
  const buildProUsageSummaryMock = vi.fn();
  const getBotRefMock = vi.fn();
  return {
    buildProUsageSummaryMock,
    getBotRefMock,
    runtimeMock: {
      getBotRef: getBotRefMock,
      debug: vi.fn(),
    },
  };
});

vi.mock('../src/dashboard/runtime.ts', () => ({
  runtime: runtimeMock,
}));

vi.mock('../src/pro/usage-summary.ts', () => ({
  buildProUsageSummary: buildProUsageSummaryMock,
}));

let tmpDir: string;
let previousBudgetFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-session-budget-gate-');
  previousBudgetFile = process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = path.join(tmpDir, 'usage-budgets.json');
  buildProUsageSummaryMock.mockReset();
  getBotRefMock.mockReset();
});

afterEach(() => {
  if (previousBudgetFile == null) delete process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  else process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = previousBudgetFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

describe('session send usage budget gate', () => {
  it('blocks sends before queueing when a matching pause budget is over limit', async () => {
    const { upsertUsageBudget } = await import('../src/pro/usage-budget.ts');
    const budget = upsertUsageBudget({
      name: 'Codex weekly pause',
      scope: 'agent',
      scopeKey: 'codex',
      limitTokens: 100,
      period: 'week',
      action: 'pause',
    });
    buildProUsageSummaryMock.mockResolvedValue({
      budgets: [{
        ...budget,
        usedTokens: 140,
        usedPercent: 140,
        periodStart: '2026-06-08T00:00:00.000Z',
        periodEnd: '2026-06-13T00:00:00.000Z',
        state: 'over',
        matchedChats: 1,
      }],
    });

    const app = (await import('../src/dashboard/routes/sessions.ts')).default;
    const res = await app.request('/api/session-hub/session/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workdir: tmpDir,
        agent: 'codex',
        prompt: 'Should be blocked',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toMatchObject({
      ok: false,
      code: 'usage_budget_paused',
      budget: expect.objectContaining({ id: budget.id }),
    });
    expect(String(body.error)).toContain('Codex weekly pause');
    expect(getBotRefMock).not.toHaveBeenCalled();
  });

  it('does not scan usage budgets when no pause budget is enabled', async () => {
    const app = (await import('../src/dashboard/routes/sessions.ts')).default;
    const submitSessionTask = vi.fn(() => ({ ok: true, queued: true, taskId: 'task-ok', sessionKey: 'codex:pending_ok' }));
    getBotRefMock.mockReturnValue({ submitSessionTask });

    const res = await app.request('/api/session-hub/session/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workdir: tmpDir,
        agent: 'codex',
        prompt: 'Allowed',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, taskId: 'task-ok' });
    expect(buildProUsageSummaryMock).not.toHaveBeenCalled();
  });
});
