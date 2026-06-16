import type { ProTask } from '../../types';
import { workItemSourceNeedsRefresh } from './workItemSourceHealth';

export type WorkItemFilter = 'all' | 'active' | 'attention' | 'source' | 'review' | 'deliverables' | 'backlog' | 'done';

export type WorkItemSourceFilter = 'all' | 'inbox' | 'ticket' | 'manual' | 'automation';

export type WorkItemSourceIntakeCounts = Partial<Record<Exclude<WorkItemSourceFilter, 'all'>, number>>;

export interface WorkItemFilterCountSummary {
  tasks: number;
  intake: number;
  total: number;
}

export function normalizeWorkItemFilter(value: string | null | undefined): WorkItemFilter {
  return value === 'all'
    || value === 'active'
    || value === 'attention'
    || value === 'source'
    || value === 'review'
    || value === 'deliverables'
    || value === 'backlog'
    || value === 'done'
    ? value
    : 'active';
}

export function normalizeWorkItemSourceFilter(value: string | null | undefined): WorkItemSourceFilter {
  return value === 'inbox' || value === 'ticket' || value === 'manual' || value === 'automation' ? value : 'all';
}

export function normalizeWorkItemDateParam(value: string | null | undefined): string {
  const text = (value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function workItemSourceKind(task: ProTask): Exclude<WorkItemSourceFilter, 'all'> {
  if (task.jiraKey || task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic') return 'ticket';
  if (task.kind === 'todo') return 'inbox';
  if (task.kind === 'automation') return 'automation';
  return 'manual';
}

export function workItemSourceFilterMatches(task: ProTask, filter: WorkItemSourceFilter): boolean {
  return filter === 'all' || workItemSourceKind(task) === filter;
}

export function workItemNeedsAttention(task: ProTask): boolean {
  if (task.stageRuns.some(run => run.status === 'failed' || run.status === 'waiting-user')) return true;
  if (task.subTasks.some(item => item.status === 'blocked')) return true;
  if (task.status === 'done') return false;
  const due = task.jiraFields?.dueDate ? Date.parse(task.jiraFields.dueDate) : NaN;
  return Number.isFinite(due) && due < Date.now();
}

export function workItemOutputCount(task: ProTask): number {
  return (task.outputs?.length || 0) + task.stageRuns.filter(run => !!run.output).length;
}

export function workItemFilterMatches(task: ProTask, filter: WorkItemFilter): boolean {
  if (filter === 'active') return task.status !== 'done' && task.status !== 'resolved';
  if (filter === 'attention') return workItemNeedsAttention(task);
  if (filter === 'source') return workItemSourceNeedsRefresh(task);
  if (filter === 'review') return false;
  if (filter === 'deliverables') return workItemOutputCount(task) > 0;
  if (filter === 'backlog') return task.status === 'backlog';
  if (filter === 'done') return task.status === 'done' || task.status === 'resolved';
  return true;
}

export function workItemFilterShowsIntake(filter: WorkItemFilter): boolean {
  return filter === 'active' || filter === 'backlog' || filter === 'all';
}

export function workItemFilterCountSummary(tasks: ProTask[], filter: WorkItemFilter, intakeCount = 0): WorkItemFilterCountSummary {
  const taskCount = tasks.filter(task => workItemFilterMatches(task, filter)).length;
  const scopedIntake = workItemFilterShowsIntake(filter) ? intakeCount : 0;
  return {
    tasks: taskCount,
    intake: scopedIntake,
    total: taskCount + scopedIntake,
  };
}

export function workItemFilterCount(tasks: ProTask[], filter: WorkItemFilter, intakeCount = 0): number {
  return workItemFilterCountSummary(tasks, filter, intakeCount).total;
}

export function workItemSourceFilterCount(
  tasks: ProTask[],
  filter: WorkItemSourceFilter,
  intakeCounts: WorkItemSourceIntakeCounts = {},
): number {
  const taskCount = filter === 'all'
    ? tasks.length
    : tasks.filter(task => workItemSourceFilterMatches(task, filter)).length;
  if (filter === 'all') {
    return taskCount + Object.values(intakeCounts).reduce((total, count) => total + (count || 0), 0);
  }
  return taskCount + (intakeCounts[filter] || 0);
}
