import type { ProTask, StageRun } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';
import { summarizeWorkItemDecisionAudit } from './workItemDecisionAuditCommand';
import { buildWorkItemAgentLaunchPrompt } from './workItemHandoffCapsule';
import { workItemNeedsAttention, workItemOutputCount } from './workItemModel';

export type WorkItemHandoffCommandTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkItemHandoffCommandItem {
  key: string;
  taskId: string;
  title: string;
  detail: string;
  to: string;
  promptDraft: string;
  priority?: number;
  lanes?: WorkItemCommandLane[];
  keys: string[];
  tone: WorkItemHandoffCommandTone;
  keywords: string[];
}

export interface WorkItemHandoffCommandOptions {
  limit?: number;
}

type HandoffAction = {
  label: string;
  instruction: string;
  lane: WorkItemCommandLane;
  tone: WorkItemHandoffCommandTone;
  priority: number;
};

function eventTime(value?: string | null): number {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function latestRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])].sort((a, b) => {
    const left = eventTime(a.completedAt || a.startedAt);
    const right = eventTime(b.completedAt || b.startedAt);
    return right - left;
  })[0] || null;
}

function openRun(task: ProTask): StageRun | null {
  return (task.stageRuns || []).find(run => run.status !== 'completed' && run.status !== 'cancelled') || null;
}

function sourceLabel(task: ProTask): string {
  if (task.jiraKey) return task.jiraKey;
  if (task.kind === 'todo') return 'Todo';
  if (task.kind === 'automation') return 'Automation';
  return 'Manual';
}

function handoffAction(task: ProTask): HandoffAction | null {
  const activeRun = openRun(task);
  if (activeRun) {
    const needsReview = activeRun.status === 'failed' || activeRun.status === 'waiting-user';
    return {
      label: needsReview ? 'Resume blocked handoff' : 'Continue handoff',
      instruction: 'Continue the active or interrupted Work Item flow. Use the handoff capsule as the source of truth, reconstruct current state, then take the next useful step without losing source, run, output, or decision history.',
      lane: commandLane('Execution', `${activeRun.stage} ${activeRun.status}`, needsReview ? 'attention' : 'execution'),
      tone: needsReview ? 'warn' : 'primary',
      priority: needsReview ? 43 : 38,
    };
  }
  if (task.status === 'coding') {
    return {
      label: 'Continue with handoff',
      instruction: 'Continue implementation from the handoff capsule. Inspect the relevant project context first, keep changes focused, and stop for review before committing or updating remote Jira.',
      lane: commandLane('Execution', 'Coding', 'execution'),
      tone: workItemNeedsAttention(task) ? 'warn' : 'primary',
      priority: workItemNeedsAttention(task) ? 41 : 35,
    };
  }
  if (task.status === 'resolved') {
    return {
      label: 'Review with handoff',
      instruction: 'Review this Work Item from the handoff capsule. Check correctness, missing validation, follow-up risk, and whether the deliverables are ready to close. Do not modify files unless explicitly asked.',
      lane: commandLane('Output', workItemOutputCount(task) ? `${workItemOutputCount(task)} ready` : 'Review', workItemOutputCount(task) ? 'output' : 'idle'),
      tone: 'ok',
      priority: workItemOutputCount(task) ? 34 : 24,
    };
  }
  if (task.status === 'refinement') {
    return {
      label: 'Clarify with handoff',
      instruction: 'Clarify this Work Item from the handoff capsule. Produce a concise goal, assumptions, open questions, acceptance criteria, risks, and recommended next step.',
      lane: commandLane('Execution', 'Refine', 'execution'),
      tone: 'primary',
      priority: 28,
    };
  }
  return null;
}

function rankHandoff(a: ProTask, b: ProTask): number {
  const leftAction = handoffAction(a);
  const rightAction = handoffAction(b);
  return (rightAction?.priority || 0) - (leftAction?.priority || 0)
    || Number(summarizeWorkItemDecisionAudit(b).needsReview) - Number(summarizeWorkItemDecisionAudit(a).needsReview)
    || Number(workItemNeedsAttention(b)) - Number(workItemNeedsAttention(a))
    || workItemOutputCount(b) - workItemOutputCount(a)
    || eventTime(b.updatedAt) - eventTime(a.updatedAt)
    || a.title.localeCompare(b.title);
}

function shortActionLabel(label: string): string {
  return label
    .replace(/\s+with\s+handoff$/i, '')
    .replace(/\s+handoff$/i, '')
    .trim() || 'Continue';
}

export function buildWorkItemHandoffCommandItems(
  tasks: ProTask[],
  options: WorkItemHandoffCommandOptions = {},
): WorkItemHandoffCommandItem[] {
  const limit = options.limit ?? 12;
  return tasks
    .filter(task => task.status !== 'done')
    .sort(rankHandoff)
    .map(task => {
      const action = handoffAction(task);
      if (!action) return null;
      const decisionAudit = summarizeWorkItemDecisionAudit(task);
      const source = sourceLabel(task);
      const run = latestRun(task);
      const outputCount = workItemOutputCount(task);
      return {
        key: `handoff:${task.id}`,
        taskId: task.id,
        title: `${action.label}: ${task.title}`,
        detail: [
          source,
          run ? `${run.stage} ${run.status}` : task.status,
          outputCount ? `${outputCount} output${outputCount === 1 ? '' : 's'}` : '',
          decisionAudit.needsReview ? 'decision review' : '',
        ].filter(Boolean).join(' · '),
        to: '/chat',
        promptDraft: buildWorkItemAgentLaunchPrompt(task, {
          actionLabel: action.label,
          actionInstruction: action.instruction,
        }),
        priority: action.priority,
        lanes: [
          commandLane('Source', source, 'source'),
          action.lane,
          decisionAudit.needsReview ? commandLane('Audit', 'Review', 'attention') : null,
        ].filter((lane): lane is WorkItemCommandLane => !!lane),
        keys: ['Handoff', shortActionLabel(action.label)],
        tone: decisionAudit.needsReview ? 'warn' : action.tone,
        keywords: [
          'handoff',
          'agent handoff',
          'continue work',
          'resume task',
          'work item launch',
          task.id,
          task.title,
          task.kind,
          task.status,
          task.jiraKey || '',
          task.jiraUrl || '',
          task.workdir || '',
          run?.stage || '',
          run?.status || '',
          action.label,
          decisionAudit.needsReview ? 'decision audit' : '',
        ].filter(Boolean),
      };
    })
    .filter((item): item is WorkItemHandoffCommandItem => !!item)
    .slice(0, limit);
}
