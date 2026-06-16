import type { WorkflowRunRecord } from '../../types';
import { workflowRunSessionNextAction, type WorkflowRunSessionNextAction } from './workflowRunSession';
import { summarizeWorkflowRunOperationalState, type WorkflowRunOperationalSummary } from './workflowRunStatus';

export interface ChatHomeWorkflowRunSummary {
  run: WorkflowRunRecord;
  operational: WorkflowRunOperationalSummary;
  nextAction: WorkflowRunSessionNextAction;
  progressLabel: string;
  projectLabel: string;
}

function runPriority(summary: ChatHomeWorkflowRunSummary): number {
  if (summary.nextAction.tone === 'warn') return 0;
  if (summary.run.status === 'blocked') return 1;
  if (summary.operational.workerRunningCount > 0) return 2;
  return 3;
}

function baseName(value: string | null | undefined): string {
  const clean = (value || '').trim().replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).pop() || clean || 'No project';
}

export function buildChatHomeWorkflowRunSummaries(input: {
  runs: WorkflowRunRecord[];
  projectPath?: string;
  limit?: number;
  now?: Date | number;
}): ChatHomeWorkflowRunSummary[] {
  const { runs, projectPath = '', limit = 3, now = new Date() } = input;
  return runs
    .filter(run => run.status !== 'done')
    .filter(run => !projectPath || run.workdir === projectPath)
    .map(run => {
      const operational = summarizeWorkflowRunOperationalState(run, now);
      return {
        run,
        operational,
        nextAction: workflowRunSessionNextAction(run),
        progressLabel: `${operational.doneSteps}/${run.totalSteps} steps`,
        projectLabel: baseName(run.workdir),
      };
    })
    .sort((left, right) => {
      const priority = runPriority(left) - runPriority(right);
      if (priority !== 0) return priority;
      return Date.parse(right.run.updatedAt) - Date.parse(left.run.updatedAt);
    })
    .slice(0, Math.max(0, limit));
}
