import type { ProTask } from '../../types';
import { workItemNeedsAttention, workItemOutputCount, workItemSourceKind, type WorkItemSourceFilter } from './workItemModel';
import { workItemSourceNeedsRefresh } from './workItemSourceHealth';

export type WorkObjectCockpitTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkObjectCockpitLane {
  key: Exclude<WorkItemSourceFilter, 'all'>;
  label: string;
  count: number;
  detail: string;
  tone: WorkObjectCockpitTone;
}

export interface WorkObjectCockpitSummary {
  title: string;
  detail: string;
  tone: WorkObjectCockpitTone;
  lanes: WorkObjectCockpitLane[];
  chips: string[];
}

export function buildWorkObjectCockpitSummary(input: {
  tasks: ProTask[];
  inboxIntakeCount?: number;
  dailyIntakeCount?: number;
  noteIntakeCount?: number;
  jiraReviewCount?: number;
}): WorkObjectCockpitSummary {
  const inboxIntakeCount = input.inboxIntakeCount || 0;
  const dailyIntakeCount = input.dailyIntakeCount || 0;
  const noteIntakeCount = input.noteIntakeCount || 0;
  const jiraReviewCount = input.jiraReviewCount || 0;
  const activeTasks = input.tasks.filter(task => task.status !== 'done' && task.status !== 'resolved');
  const sourceRefreshCount = activeTasks.filter(workItemSourceNeedsRefresh).length;
  const attentionCount = activeTasks.filter(workItemNeedsAttention).length;
  const outputCount = activeTasks.reduce((total, task) => total + workItemOutputCount(task), 0);
  const laneTaskCount = (kind: Exclude<WorkItemSourceFilter, 'all'>) => (
    activeTasks.filter(task => workItemSourceKind(task) === kind).length
  );
  const ticketTaskCount = laneTaskCount('ticket');
  const inboxTaskCount = laneTaskCount('inbox');
  const manualTaskCount = laneTaskCount('manual');
  const automationTaskCount = laneTaskCount('automation');
  const noteTotal = manualTaskCount + dailyIntakeCount + noteIntakeCount;
  const inboxTotal = inboxTaskCount + inboxIntakeCount;

  const lanes: WorkObjectCockpitLane[] = [
    {
      key: 'inbox',
      label: 'Inbox / Todo',
      count: inboxTotal,
      detail: `${inboxTaskCount} tasks · ${inboxIntakeCount} intake`,
      tone: inboxIntakeCount > 0 ? 'ok' : inboxTaskCount > 0 ? 'primary' : 'idle',
    },
    {
      key: 'ticket',
      label: 'Jira',
      count: ticketTaskCount,
      detail: `${ticketTaskCount} tickets · ${jiraReviewCount} review`,
      tone: jiraReviewCount > 0 ? 'warn' : ticketTaskCount > 0 ? 'primary' : 'idle',
    },
    {
      key: 'manual',
      label: 'Notes / Daily',
      count: noteTotal,
      detail: `${manualTaskCount} tasks · ${dailyIntakeCount + noteIntakeCount} intake`,
      tone: dailyIntakeCount + noteIntakeCount > 0 ? 'ok' : manualTaskCount > 0 ? 'primary' : 'idle',
    },
    {
      key: 'automation',
      label: 'Automation',
      count: automationTaskCount,
      detail: `${automationTaskCount} linked runs`,
      tone: automationTaskCount > 0 ? 'primary' : 'idle',
    },
  ];

  if (jiraReviewCount > 0) {
    return {
      title: 'Review Jira writes',
      detail: 'Remote changes are staged locally first; review the Jira boundary before applying.',
      tone: 'warn',
      lanes,
      chips: [`${jiraReviewCount} Jira review`, `${sourceRefreshCount} source refresh`, `${outputCount} outputs`],
    };
  }
  if (sourceRefreshCount > 0) {
    return {
      title: 'Repair source first',
      detail: 'Some Work Items need stronger source evidence before launching more agent work.',
      tone: 'warn',
      lanes,
      chips: [`${sourceRefreshCount} source refresh`, `${attentionCount} needs`, `${outputCount} outputs`],
    };
  }
  if (attentionCount > 0) {
    return {
      title: 'Clear blocked work',
      detail: 'Failed stages, waiting-user runs, and overdue work are ranked ahead of fresh intake.',
      tone: 'warn',
      lanes,
      chips: [`${attentionCount} needs attention`, `${inboxTotal} inbox`, `${noteTotal} notes`],
    };
  }
  if (inboxIntakeCount + dailyIntakeCount + noteIntakeCount > 0) {
    return {
      title: 'Promote intake',
      detail: 'Todo captures, daily plans, and notes are ready to become execution-ready Work Items.',
      tone: 'ok',
      lanes,
      chips: [`${inboxIntakeCount} todo intake`, `${dailyIntakeCount} daily`, `${noteIntakeCount} notes`],
    };
  }
  return {
    title: 'Work queue ready',
    detail: 'Todo, Jira, notes, and automation are unified as one operational work surface.',
    tone: activeTasks.length > 0 ? 'primary' : 'idle',
    lanes,
    chips: [`${activeTasks.length} active`, `${outputCount} outputs`, `${automationTaskCount} automation`],
  };
}
