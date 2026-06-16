import type { ProOutput, ProTask, ProTaskWorkbench, StageRun } from '../../types';

export type WorkItemDeliverableReadinessTone = 'ok' | 'warn' | 'err' | 'running' | 'idle';

export interface WorkItemDeliverableReadiness {
  label: string;
  detail: string;
  tone: WorkItemDeliverableReadinessTone;
  outputCount: number;
  fileCount: number;
  reviewCount: number;
}

function stageNeedsReview(run: StageRun): boolean {
  return run.status === 'failed' || run.status === 'waiting-user';
}

export function summarizeWorkItemDeliverableReadiness(input: {
  task: ProTask;
  workbench?: ProTaskWorkbench | null;
  outputs?: ProOutput[];
}): WorkItemDeliverableReadiness {
  const { task, workbench = null } = input;
  const outputs = input.outputs || workbench?.outputs || task.outputs || [];
  const fileCount = workbench?.files.length || 0;
  const reviewCount = task.stageRuns.filter(stageNeedsReview).length;
  const runningCount = task.stageRuns.filter(run => run.status === 'running' || run.status === 'queued').length;

  if (reviewCount > 0) {
    return {
      label: 'Review needed',
      detail: `${reviewCount} stage run${reviewCount === 1 ? '' : 's'} need attention before closing.`,
      tone: task.stageRuns.some(run => run.status === 'failed') ? 'err' : 'warn',
      outputCount: outputs.length,
      fileCount,
      reviewCount,
    };
  }

  if (outputs.length > 0 || fileCount > 0) {
    return {
      label: 'Deliverables ready',
      detail: `${outputs.length} output${outputs.length === 1 ? '' : 's'} · ${fileCount} file${fileCount === 1 ? '' : 's'} linked to this Work Item.`,
      tone: 'ok',
      outputCount: outputs.length,
      fileCount,
      reviewCount,
    };
  }

  if (runningCount > 0) {
    return {
      label: 'In progress',
      detail: `${runningCount} stage run${runningCount === 1 ? '' : 's'} still producing work assets.`,
      tone: 'running',
      outputCount: outputs.length,
      fileCount,
      reviewCount,
    };
  }

  return {
    label: 'No deliverables',
    detail: 'No saved outputs or referenced files yet.',
    tone: 'idle',
    outputCount: 0,
    fileCount: 0,
    reviewCount: 0,
  };
}
