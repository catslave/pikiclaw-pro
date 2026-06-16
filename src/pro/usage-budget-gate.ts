import { buildProUsageSummary } from './usage-summary.js';
import {
  evaluateUsageBudgetGate,
  hasEnabledPauseUsageBudget,
  type UsageBudgetGateContext,
  type UsageBudgetGateResult,
} from './usage-budget.js';

export async function evaluateCurrentUsageBudgetGate(
  ctx: UsageBudgetGateContext,
  rawLimit: unknown = 160,
): Promise<UsageBudgetGateResult> {
  if (!hasEnabledPauseUsageBudget()) return { allowed: true };
  const summary = await buildProUsageSummary(rawLimit, { cache: false });
  return evaluateUsageBudgetGate(summary.budgets || [], ctx);
}
