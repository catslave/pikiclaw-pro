import type { ProTask } from '../../types';
import type { WorkItemSourceHealthSummary } from './workItemSourceHealth';

export interface TodoSourceRepairDraftSeed {
  source: 'todo';
  title: string;
  description: string;
  status: 'backlog';
  workdir: string;
  repairTargetTaskId: string;
}

export function workItemNeedsTodoSourceRepair(task: ProTask, sourceHealth: WorkItemSourceHealthSummary): boolean {
  return task.kind === 'todo' && sourceHealth.refreshRank === 2;
}

export function buildTodoSourceRepairDraft(task: ProTask, fallbackWorkdir = ''): TodoSourceRepairDraftSeed {
  const identity = task.localKey || task.jiraKey || task.id;
  return {
    source: 'todo',
    title: `Evidence for ${identity}`,
    description: [
      `Repair source evidence for: ${task.title}`,
      `Original Work Item: ${identity}`,
      '',
      'Paste the missing chat quote, note, file path, screenshot context, or reproduction details here.',
    ].join('\n'),
    status: 'backlog',
    workdir: task.workdir || fallbackWorkdir,
    repairTargetTaskId: task.id,
  };
}
