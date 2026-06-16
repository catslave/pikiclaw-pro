import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTmpDir } from './support/env.ts';

const {
  buildProUsageSummaryMock,
  queueDashboardSessionTaskMock,
  runtimeMock,
} = vi.hoisted(() => {
  const buildProUsageSummaryMock = vi.fn();
  const queueDashboardSessionTaskMock = vi.fn();
  return {
    buildProUsageSummaryMock,
    queueDashboardSessionTaskMock,
    runtimeMock: {
      getRequestWorkdir: vi.fn(() => '/tmp/pikiclaw'),
      getRuntimeDefaultAgent: vi.fn(() => 'codex'),
      debug: vi.fn(),
      emitDashboardEvent: vi.fn(),
    },
  };
});

vi.mock('../src/dashboard/runtime.ts', () => ({
  runtime: runtimeMock,
}));

vi.mock('../src/dashboard/session-control.ts', () => ({
  queueDashboardSessionTask: queueDashboardSessionTaskMock,
}));

vi.mock('../src/pro/usage-summary.ts', () => ({
  buildProUsageSummary: buildProUsageSummaryMock,
}));

let tmpDir: string;
let previousBudgetFile: string | undefined;
let previousWorkflowFile: string | undefined;
let previousSchedulerFlag: boolean | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-automation-budget-gate-');
  previousBudgetFile = process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  previousSchedulerFlag = globalThis.__pikiclawProAutomationSchedulerStarted;
  process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = path.join(tmpDir, 'usage-budgets.json');
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
  globalThis.__pikiclawProAutomationSchedulerStarted = true;
  buildProUsageSummaryMock.mockReset();
  queueDashboardSessionTaskMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  if (previousBudgetFile == null) delete process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE;
  else process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE = previousBudgetFile;
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
  globalThis.__pikiclawProAutomationSchedulerStarted = previousSchedulerFlag;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

describe('automation usage budget gate', () => {
  it('blocks manual scheduled-task runs before queueing when pause budget is over limit', async () => {
    const { createAutomationRule, listAutomationRules } = await import('../src/pro/workflow.ts');
    const { upsertUsageBudget } = await import('../src/pro/usage-budget.ts');
    const automation = createAutomationRule({
      name: 'Budgeted daily review',
      schedule: 'manual',
      prompt: 'Review the project.',
      workdir: tmpDir,
      agent: 'codex',
    });
    const budget = upsertUsageBudget({
      name: 'Codex pause',
      scope: 'agent',
      scopeKey: 'codex',
      limitTokens: 100,
      period: 'day',
      action: 'pause',
    });
    buildProUsageSummaryMock.mockResolvedValue({
      budgets: [{
        ...budget,
        usedTokens: 120,
        usedPercent: 120,
        periodStart: '2026-06-13T00:00:00.000Z',
        periodEnd: '2026-06-13T12:00:00.000Z',
        state: 'over',
        matchedChats: 1,
      }],
    });

    const app = (await import('../src/dashboard/routes/pro.ts')).default;
    const res = await app.request(`/api/pro/automations/${automation.id}/run`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toMatchObject({
      ok: false,
      code: 'usage_budget_paused',
      budget: expect.objectContaining({ id: budget.id }),
    });
    expect(queueDashboardSessionTaskMock).not.toHaveBeenCalled();
    expect(listAutomationRules().find(item => item.id === automation.id)?.runHistory?.[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Codex pause'),
      code: 'usage_budget_paused',
      budgetId: budget.id,
      budgetName: budget.name,
    });
  });

  it('does not scan usage summary when no pause budget is enabled', async () => {
    const { createAutomationRule } = await import('../src/pro/workflow.ts');
    const automation = createAutomationRule({
      name: 'Allowed daily review',
      schedule: 'manual',
      prompt: 'Review the project.',
      workdir: tmpDir,
      agent: 'codex',
    });
    queueDashboardSessionTaskMock.mockResolvedValue({ ok: true, queued: true, taskId: 'task-automation', sessionKey: 'codex:pending_auto' });

    const app = (await import('../src/dashboard/routes/pro.ts')).default;
    const res = await app.request(`/api/pro/automations/${automation.id}/run`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, queued: expect.objectContaining({ taskId: 'task-automation' }) });
    expect(buildProUsageSummaryMock).not.toHaveBeenCalled();
    expect(queueDashboardSessionTaskMock).toHaveBeenCalledTimes(1);
    expect(runtimeMock.emitDashboardEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'scheduled-task' }));
  });

  it('broadcasts a scheduled-task dashboard event for background scheduler runs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T09:00:00.000Z'));
    globalThis.__pikiclawProAutomationSchedulerStarted = undefined;
    const { createAutomationRule } = await import('../src/pro/workflow.ts');
    const now = new Date();
    const schedule = `daily@${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    createAutomationRule({
      name: 'Morning digest',
      schedule,
      prompt: 'Summarize the project.',
      workdir: tmpDir,
      agent: 'codex',
      enabled: true,
    });
    queueDashboardSessionTaskMock.mockResolvedValue({ ok: true, queued: true, taskId: 'task-scheduled', sessionKey: 'codex:pending_scheduled' });

    await import('../src/dashboard/routes/pro.ts');
    await vi.advanceTimersByTimeAsync(5000);

    expect(queueDashboardSessionTaskMock).toHaveBeenCalledTimes(1);
    expect(runtimeMock.emitDashboardEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'scheduled-task',
      key: expect.any(String),
      name: 'Morning digest',
      schedule,
      status: 'queued',
      sessionKey: 'codex:pending_scheduled',
    }));
  });

  it('records missed scheduled-task windows without queueing stale work', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00.000Z'));
    globalThis.__pikiclawProAutomationSchedulerStarted = undefined;
    const { createAutomationRule, listAutomationRules } = await import('../src/pro/workflow.ts');
    const automation = createAutomationRule({
      name: 'Missed morning digest',
      schedule: 'daily@09:00',
      prompt: 'Summarize the project.',
      workdir: tmpDir,
      agent: 'codex',
      enabled: true,
    });

    await import('../src/dashboard/routes/pro.ts');
    await vi.advanceTimersByTimeAsync(5000);

    expect(queueDashboardSessionTaskMock).not.toHaveBeenCalled();
    const updated = listAutomationRules().find(item => item.id === automation.id);
    const expectedScheduledFor = new Date(2026, 5, 14, 9, 0, 0, 0).toISOString();
    expect(updated?.lastRunAt).toBeUndefined();
    expect(updated?.runHistory?.[0]).toMatchObject({
      status: 'missed',
      scheduledFor: expectedScheduledFor,
    });
    expect(runtimeMock.emitDashboardEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'scheduled-task',
      key: automation.id,
      name: 'Missed morning digest',
      schedule: 'daily@09:00',
      status: 'missed',
      scheduledFor: expectedScheduledFor,
    }));
  });
});
