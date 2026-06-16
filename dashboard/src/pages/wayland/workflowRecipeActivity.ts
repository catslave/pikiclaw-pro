import type { AutomationRule, WorkflowRunRecord, WorkflowTemplate } from '../../types';

export interface WorkflowRecipeActivitySummary {
  scheduledJobs: AutomationRule[];
  recentRuns: WorkflowRunRecord[];
  activeRuns: WorkflowRunRecord[];
  latestRun: WorkflowRunRecord | null;
  needsAttention: boolean;
}

function normalizeKey(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

export function workflowRecipeMatchesRun(recipe: WorkflowTemplate, run: WorkflowRunRecord): boolean {
  const recipeId = normalizeKey(recipe.id);
  const recipeName = normalizeKey(recipe.name);
  return Boolean(
    (recipeId && normalizeKey(run.workflowId) === recipeId)
    || (recipeName && normalizeKey(run.workflowName) === recipeName),
  );
}

export function workflowRecipeMatchesAutomation(recipe: WorkflowTemplate, automation: AutomationRule): boolean {
  const recipeName = normalizeKey(recipe.name);
  if (!recipeName) return false;
  return normalizeKey(automation.name) === recipeName;
}

export function summarizeWorkflowRecipeActivity(
  recipe: WorkflowTemplate,
  runs: WorkflowRunRecord[],
  automations: AutomationRule[],
): WorkflowRecipeActivitySummary {
  const recentRuns = runs
    .filter(run => workflowRecipeMatchesRun(recipe, run))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  const scheduledJobs = automations
    .filter(job => workflowRecipeMatchesAutomation(recipe, job))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  const activeRuns = recentRuns.filter(run => run.status !== 'done');
  const latestRun = recentRuns[0] || null;
  const needsAttention = activeRuns.some(run => (
    run.status === 'blocked'
    || (run.asks || []).some(ask => ask.status === 'pending')
    || (run.steps || []).some(step => step.autonomousRun?.state === 'failed' || step.autonomousRun?.state === 'stalled')
  )) || scheduledJobs.some(job => {
    const latest = [...(job.runHistory || [])].sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt))[0];
    return latest?.status === 'failed' || latest?.status === 'missed';
  });
  return { scheduledJobs, recentRuns, activeRuns, latestRun, needsAttention };
}
