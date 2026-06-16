import type { ProTask, ProTaskStage, StageRun, VerificationRun } from '../../types';
import { workItemSourceKind } from './workItemModel';

export type WorkItemOperationalTone = 'ok' | 'warn' | 'err' | 'active' | 'running' | 'idle';

export type WorkItemOperationalSummary = {
  sourceLabel: string;
  stateLabel: string;
  stateTone: WorkItemOperationalTone;
  nextActionLabel: string;
  nextActionDetail: string;
  latestStageLabel: string;
  openRunCount: number;
  outputCount: number;
  blockedSubtaskCount: number;
  subtaskLabel: string;
  ownerLabel: string;
  scheduleLabel: string;
  verificationLabel: string;
  guardrailLabel: string;
  riskCount: number;
  overdue: boolean;
  updatedLabel: string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function shortAge(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE_MS) return '<1m';
  if (safe < HOUR_MS) return `${Math.round(safe / MINUTE_MS)}m`;
  if (safe < DAY_MS) return `${Math.round(safe / HOUR_MS)}h`;
  return `${Math.round(safe / DAY_MS)}d`;
}

function latestStageRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])].sort((a, b) => {
    const left = parseTime(a.completedAt || a.startedAt) ?? 0;
    const right = parseTime(b.completedAt || b.startedAt) ?? 0;
    return right - left;
  })[0] || null;
}

function outputCount(task: ProTask): number {
  const direct = task.outputs?.length || 0;
  const stageOutputs = (task.stageRuns || []).filter(run => !!run.output).length;
  return direct + stageOutputs;
}

function shortDate(value?: string | null): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}`;
  const time = parseTime(value);
  if (time == null) return value;
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function sourceLabel(task: ProTask): string {
  if (task.jiraKey) return `Ticket ${task.jiraKey}`;
  if (task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic') return 'Ticket';
  if (task.kind === 'todo') return 'Inbox';
  if (task.kind === 'automation') return 'Automation';
  return 'Manual';
}

function ownerLabel(task: ProTask): string {
  if (task.execution?.assistantId) return `Assistant ${task.execution.assistantId}`;
  if (task.execution?.agent) return `Agent ${task.execution.agent}`;
  if (task.defaultAssistantId) return `Assistant ${task.defaultAssistantId}`;
  if (task.defaultAgent) return `Agent ${task.defaultAgent}`;
  if (task.jiraFields?.assignee) return task.jiraFields.assignee;
  return 'Unassigned';
}

function latestVerificationRun(task: ProTask): VerificationRun | null {
  return [...(task.verificationRuns || [])].sort((a, b) => {
    const left = parseTime(a.completedAt || a.startedAt) ?? 0;
    const right = parseTime(b.completedAt || b.startedAt) ?? 0;
    return right - left;
  })[0] || null;
}

function verificationLabel(task: ProTask, latest: VerificationRun | null): string {
  if (latest?.result) {
    if (latest.result === 'passed') return 'Verification passed';
    if (latest.result === 'failed') return 'Verification failed';
    if (latest.result === 'blocked') return 'Verification blocked';
    return 'Verification not run';
  }
  if (task.status === 'resolved' || task.status === 'done') return 'Verification not run';
  return 'No verification';
}

function recommendedStage(task: ProTask): ProTaskStage {
  const openRun = (task.stageRuns || []).find(run => run.status !== 'completed' && run.status !== 'cancelled');
  if (openRun) return openRun.stage;
  if (task.status === 'coding') return task.kind === 'jira-bug' ? 'bugfix' : 'coding';
  if (task.status === 'resolved' || task.status === 'done') return 'verification';
  if (task.status === 'refinement') return 'refinement';
  return task.kind === 'jira-bug' ? 'bugfix' : 'refinement';
}

function nextAction(task: ProTask, latest: StageRun | null): Pick<WorkItemOperationalSummary, 'nextActionLabel' | 'nextActionDetail'> {
  if (latest && latest.status !== 'completed' && latest.status !== 'cancelled') {
    return {
      nextActionLabel: latest.status === 'waiting-user' ? 'Answer' : latest.status === 'failed' ? 'Review' : 'Continue',
      nextActionDetail: `${latest.stage} is ${latest.status}`,
    };
  }
  if (task.status === 'done') {
    return { nextActionLabel: 'Review', nextActionDetail: 'Review completed context' };
  }
  if (task.status === 'resolved') {
    return { nextActionLabel: 'Verify', nextActionDetail: 'Check output before closing' };
  }
  const stage = recommendedStage(task);
  return {
    nextActionLabel: stage === 'coding' || stage === 'bugfix' ? 'Code' : 'Refine',
    nextActionDetail: `Start ${stage}`,
  };
}

export function summarizeWorkItemOperationalState(
  task: ProTask,
  nowInput: Date | number = new Date(),
): WorkItemOperationalSummary {
  const now = typeof nowInput === 'number' ? nowInput : nowInput.getTime();
  const latest = latestStageRun(task);
  const openRunCount = (task.stageRuns || []).filter(run => run.status !== 'completed' && run.status !== 'cancelled').length;
  const blockedSubtaskCount = (task.subTasks || []).filter(item => item.status === 'blocked').length;
  const totalSubtaskCount = (task.subTasks || []).length;
  const doneSubtaskCount = (task.subTasks || []).filter(item => item.status === 'done').length;
  const due = parseTime(task.jiraFields?.dueDate);
  const overdue = task.status !== 'done' && task.status !== 'resolved' && due != null && due < now;
  const outputs = outputCount(task);
  const updated = parseTime(task.updatedAt) ?? now;
  const latestVerification = latestVerificationRun(task);
  const verification = verificationLabel(task, latestVerification);
  const verificationFailed = latestVerification?.result === 'failed';
  const verificationBlocked = latestVerification?.result === 'blocked';
  const schedule = overdue
    ? `Overdue ${shortDate(task.jiraFields?.dueDate)}`
    : task.jiraFields?.dueDate
      ? `Due ${shortDate(task.jiraFields.dueDate)}`
      : task.plannedDate
        ? `Planned ${shortDate(task.plannedDate)}`
        : 'Unscheduled';
  const subtaskLabel = totalSubtaskCount > 0
    ? blockedSubtaskCount > 0
      ? `${blockedSubtaskCount} blocked`
      : `${doneSubtaskCount}/${totalSubtaskCount} subtasks`
    : 'No subtasks';

  let stateLabel = 'Ready';
  let stateTone: WorkItemOperationalTone = 'idle';
  if (verificationFailed) {
    stateLabel = 'Verify failed';
    stateTone = 'err';
  } else if ((task.stageRuns || []).some(run => run.status === 'failed')) {
    stateLabel = 'Failed run';
    stateTone = 'err';
  } else if (verificationBlocked) {
    stateLabel = 'Verify blocked';
    stateTone = 'warn';
  } else if ((task.stageRuns || []).some(run => run.status === 'waiting-user')) {
    stateLabel = 'Needs answer';
    stateTone = 'warn';
  } else if (blockedSubtaskCount > 0 || overdue) {
    stateLabel = overdue ? 'Overdue' : 'Blocked';
    stateTone = 'warn';
  } else if ((task.stageRuns || []).some(run => run.status === 'running' || run.status === 'queued')) {
    stateLabel = 'Running';
    stateTone = 'running';
  } else if (task.status === 'done') {
    stateLabel = 'Done';
    stateTone = 'ok';
  } else if (task.status === 'resolved') {
    stateLabel = 'Verify';
    stateTone = 'active';
  } else if (task.status === 'coding' || task.status === 'refinement') {
    stateLabel = task.status === 'coding' ? 'Coding' : 'Refining';
    stateTone = 'active';
  }

  const action = nextAction(task, latest);
  const guardrailLabel = verificationFailed || verificationBlocked
    ? verification
    : blockedSubtaskCount > 0
      ? subtaskLabel
      : overdue
        ? schedule
        : verification !== 'No verification'
          ? verification
          : schedule;
  const riskCount = [
    verificationFailed,
    verificationBlocked,
    (task.stageRuns || []).some(run => run.status === 'failed'),
    (task.stageRuns || []).some(run => run.status === 'waiting-user'),
    blockedSubtaskCount > 0,
    overdue,
  ].filter(Boolean).length;

  return {
    sourceLabel: sourceLabel(task),
    stateLabel,
    stateTone,
    nextActionLabel: action.nextActionLabel,
    nextActionDetail: action.nextActionDetail,
    latestStageLabel: latest ? `${latest.stage} · ${latest.status}` : 'No stage yet',
    openRunCount,
    outputCount: outputs,
    blockedSubtaskCount,
    subtaskLabel,
    ownerLabel: ownerLabel(task),
    scheduleLabel: schedule,
    verificationLabel: verification,
    guardrailLabel,
    riskCount,
    overdue,
    updatedLabel: `${shortAge(now - updated)} ago`,
  };
}
