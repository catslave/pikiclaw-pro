import type { JiraRemoteUpdateRun, ProTask } from '../../types';
import { summarizeWorkItemRemoteBoundary } from './workItemRemoteBoundary';

const REVIEW_STATUS_RANK: Record<string, number> = {
  failed: 0,
  draft: 1,
  applying: 2,
};

export type WorkItemJiraReviewRunMap = Record<string, JiraRemoteUpdateRun[]>;

const REVIEW_BOUNDARY_RANK: Record<string, number> = {
  failed: 0,
  'write-back-draft': 1,
  applying: 2,
  'sync-needed': 3,
};

export function jiraRemoteUpdateNeedsReview(run: JiraRemoteUpdateRun): boolean {
  return run.status === 'draft' || run.status === 'failed' || run.status === 'applying';
}

export function groupJiraReviewRunsByTask(runs: JiraRemoteUpdateRun[]): WorkItemJiraReviewRunMap {
  const grouped: WorkItemJiraReviewRunMap = {};
  for (const run of runs) {
    if (!jiraRemoteUpdateNeedsReview(run)) continue;
    grouped[run.taskId] = [...(grouped[run.taskId] || []), run];
  }
  for (const taskId of Object.keys(grouped)) {
    grouped[taskId] = grouped[taskId].sort(compareJiraReviewRuns);
  }
  return grouped;
}

export function workItemJiraReviewRuns(task: ProTask, runsByTask: WorkItemJiraReviewRunMap): JiraRemoteUpdateRun[] {
  return task.jiraKey ? (runsByTask[task.id] || []).filter(jiraRemoteUpdateNeedsReview).sort(compareJiraReviewRuns) : [];
}

export function workItemHasJiraReview(task: ProTask, runsByTask: WorkItemJiraReviewRunMap): boolean {
  if (!task.jiraKey) return false;
  return workItemRemoteBoundaryNeedsReview(task, runsByTask);
}

export function compareWorkItemsByJiraReview(a: ProTask, b: ProTask, runsByTask: WorkItemJiraReviewRunMap): number {
  const leftBoundary = summarizeWorkItemRemoteBoundary(a, runsByTask[a.id] || []);
  const rightBoundary = summarizeWorkItemRemoteBoundary(b, runsByTask[b.id] || []);
  const left = leftBoundary.primaryRun;
  const right = rightBoundary.primaryRun;
  const leftRank = REVIEW_BOUNDARY_RANK[leftBoundary.state] ?? 99;
  const rightRank = REVIEW_BOUNDARY_RANK[rightBoundary.state] ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftUpdated = Date.parse(leftBoundary.updatedAt || left?.updatedAt || a.updatedAt);
  const rightUpdated = Date.parse(rightBoundary.updatedAt || right?.updatedAt || b.updatedAt);
  return (Number.isFinite(rightUpdated) ? rightUpdated : 0) - (Number.isFinite(leftUpdated) ? leftUpdated : 0);
}

export function workItemRemoteBoundaryNeedsReview(task: ProTask, runsByTask: WorkItemJiraReviewRunMap): boolean {
  const summary = summarizeWorkItemRemoteBoundary(task, runsByTask[task.id] || []);
  return summary.state === 'failed'
    || summary.state === 'applying'
    || summary.state === 'write-back-draft'
    || summary.state === 'sync-needed';
}

function compareJiraReviewRuns(a: JiraRemoteUpdateRun, b: JiraRemoteUpdateRun): number {
  const leftRank = REVIEW_STATUS_RANK[a.status] ?? 99;
  const rightRank = REVIEW_STATUS_RANK[b.status] ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
