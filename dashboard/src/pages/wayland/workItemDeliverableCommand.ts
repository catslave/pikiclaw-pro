import type { ProOutput, ProTask, StageRun } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';

export type WorkItemDeliverableCommandTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkItemDeliverableCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  priority?: number;
  lanes?: WorkItemCommandLane[];
  keys: string[];
  tone: WorkItemDeliverableCommandTone;
  keywords: string[];
}

export interface WorkItemDeliverableCommandOptions {
  limit?: number;
}

function stageRunTime(run: StageRun): number {
  const value = Date.parse(run.completedAt || run.startedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function taskDeliverableTime(task: ProTask): number {
  const directOutputTime = (task.outputs || []).reduce((latest, output) => {
    const value = Date.parse(output.createdAt || '');
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
  const stageOutputTime = (task.stageRuns || [])
    .filter(run => !!run.output)
    .reduce((latest, run) => Math.max(latest, stageRunTime(run)), 0);
  const taskTime = Date.parse(task.updatedAt || '');
  return Math.max(directOutputTime, stageOutputTime, Number.isFinite(taskTime) ? taskTime : 0);
}

function directOutputCount(task: ProTask): number {
  return task.outputs?.length || 0;
}

function outputTime(output: ProOutput): number {
  const value = Date.parse(output.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function commandOutputTarget(task: ProTask): ProOutput | null {
  const outputs = (task.outputs || [])
    .filter(output => !!(output.url || output.path))
    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || outputTime(b) - outputTime(a));
  return outputs[0] || null;
}

function stageOutputCount(task: ProTask): number {
  return (task.stageRuns || []).filter(run => !!run.output).length;
}

function reviewCount(task: ProTask): number {
  return (task.stageRuns || []).filter(run => run.status === 'failed' || run.status === 'waiting-user').length;
}

function outputKeywords(task: ProTask): string[] {
  const direct = (task.outputs || []).flatMap(output => [
    output.title,
    output.kind,
    output.summary || '',
    output.path || '',
    output.url || '',
  ]);
  const stage = (task.stageRuns || []).flatMap(run => [
    run.stage,
    run.status,
    run.output?.summary || '',
    run.output?.diffSummary || '',
    ...(run.output?.changedFiles || []),
    run.output?.branch || '',
    run.output?.testResultId || '',
  ]);
  return [...direct, ...stage].filter(Boolean);
}

function workItemDetailUrl(taskId: string, tab: string): string {
  return `/work-items?task=${encodeURIComponent(taskId)}&tab=${encodeURIComponent(tab)}`;
}

export function buildWorkItemDeliverableCommandItems(
  tasks: ProTask[],
  options: WorkItemDeliverableCommandOptions = {},
): WorkItemDeliverableCommandItem[] {
  const limit = options.limit ?? 12;

  return tasks
    .map(task => {
      const directOutputs = directOutputCount(task);
      const stageOutputs = stageOutputCount(task);
      const outputs = directOutputs + stageOutputs;
      const reviews = reviewCount(task);
      if (outputs === 0 && reviews === 0) return null;

      const sourceLabel = task.jiraKey || (task.kind === 'todo' ? 'Todo' : task.kind);
      const identity = [sourceLabel, task.workdir].filter(Boolean).join(' · ');
      const outputLabel = `${outputs} output${outputs === 1 ? '' : 's'}`;
      const reviewLabel = `${reviews} review${reviews === 1 ? '' : 's'}`;
      const isReview = reviews > 0;
      const hasStageOutput = stageOutputs > 0;
      const outputTarget = commandOutputTarget(task);

      return {
        key: `deliverable:${task.id}`,
        title: `${isReview ? 'Review deliverables' : 'Deliverables ready'}: ${task.title}`,
        detail: `${identity || task.status} · ${isReview ? `${reviewLabel} · ${outputLabel}` : `${outputLabel}${hasStageOutput ? ` · ${stageOutputs} stage result${stageOutputs === 1 ? '' : 's'}` : ''}`}`,
        to: workItemDetailUrl(task.id, isReview ? 'runs' : 'deliverables'),
        secondaryTo: outputTarget?.url || outputTarget?.path || undefined,
        secondaryLabel: outputTarget?.url ? 'Open output' : outputTarget?.path ? 'Open file' : undefined,
        priority: isReview ? 40 : outputTarget ? 32 : 16,
        lanes: [
          commandLane('Source', sourceLabel, 'source'),
          commandLane('Output', isReview ? 'Review' : outputTarget ? 'Openable' : 'Ready', isReview ? 'attention' : 'output'),
        ],
        keys: isReview ? ['Review', 'Runs'] : ['Ready', 'Output'],
        tone: isReview ? 'warn' as const : 'ok' as const,
        keywords: [
          'deliverable readiness',
          'work item output',
          'outputs',
          'final result',
          isReview ? 'review needed' : 'deliverables ready',
          task.id,
          task.title,
          task.kind,
          task.status,
          task.jiraKey || '',
          task.workdir || '',
          ...outputKeywords(task),
        ],
        sortTime: taskDeliverableTime(task),
        sortReview: reviews,
      };
    })
    .filter((item): item is WorkItemDeliverableCommandItem & { sortTime: number; sortReview: number } => !!item)
    .sort((a, b) => {
      if (a.sortReview !== b.sortReview) return b.sortReview - a.sortReview;
      return b.sortTime - a.sortTime;
    })
    .slice(0, limit)
    .map(({ sortTime: _sortTime, sortReview: _sortReview, ...item }) => item);
}
