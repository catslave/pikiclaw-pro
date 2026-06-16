import type { AutomationRule, ProTask, StageRun, WorkflowRunRecord } from '../../types';

export type ExecutionObjectKind = 'stage-run' | 'workflow-run' | 'automation-run';
export type ExecutionObjectTone = 'primary' | 'ok' | 'warn' | 'idle';

export type ExecutionObject = {
  key: string;
  kind: ExecutionObjectKind;
  title: string;
  detail: string;
  to: string;
  tone: ExecutionObjectTone;
  keys: string[];
  keywords: string[];
  updatedAt: string;
};

type AutomationRunHistoryItem = NonNullable<AutomationRule['runHistory']>[number];

function encode(value: string): string {
  return encodeURIComponent(value);
}

function parseTime(value?: string | null): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function compact(value: string | undefined, max = 120): string {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function uniqueByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function taskSourceLabel(task: ProTask): string {
  if (task.jiraKey) return `Ticket ${task.jiraKey}`;
  if (task.kind === 'todo') return task.localKey ? `Inbox ${task.localKey}` : 'Inbox';
  if (task.kind === 'automation') return 'Automation';
  if (task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic') return 'Ticket';
  return 'Work Item';
}

function stageRunRank(status: StageRun['status']): number {
  if (status === 'failed') return 0;
  if (status === 'waiting-user') return 1;
  if (status === 'running') return 2;
  if (status === 'queued') return 3;
  if (status === 'completed') return 6;
  return 8;
}

function stageRunTone(status: StageRun['status']): ExecutionObjectTone {
  if (status === 'failed' || status === 'waiting-user') return 'warn';
  if (status === 'running' || status === 'queued') return 'primary';
  if (status === 'completed') return 'ok';
  return 'idle';
}

function stageRunKeyLabel(status: StageRun['status']): string {
  if (status === 'failed') return 'Failed';
  if (status === 'waiting-user') return 'Answer';
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  if (status === 'completed') return 'Done';
  return 'Run';
}

export function buildStageRunExecutionObjects(tasks: ProTask[], limit = 16): ExecutionObject[] {
  return uniqueByKey(uniqueBy(tasks
    .flatMap(task => (task.stageRuns || []).map(run => ({ task, run })))
    .filter(({ run }) => run.status !== 'cancelled')
    .sort((a, b) => {
      const rankDiff = stageRunRank(a.run.status) - stageRunRank(b.run.status);
      if (rankDiff) return rankDiff;
      return parseTime(b.run.completedAt || b.run.startedAt || b.task.updatedAt) - parseTime(a.run.completedAt || a.run.startedAt || a.task.updatedAt);
    }),
    ({ task, run }) => `${task.id}:${run.stage}:${run.status}`,
  )
    .slice(0, Math.max(0, limit))
    .map(({ task, run }) => {
      const updatedAt = run.completedAt || run.startedAt || task.updatedAt;
      const detail = [
        taskSourceLabel(task),
        run.stage,
        run.status,
        run.assistantId || run.selectedAgent || task.execution?.assistantId || task.execution?.agent || task.defaultAssistantId || task.defaultAgent || '',
      ].filter(Boolean).join(' · ');
      return {
        key: `stage-run:${task.id}:${run.id}`,
        kind: 'stage-run',
        title: `${run.stage} ${run.status}: ${task.title}`,
        detail,
        to: `/work-items?task=${encode(task.id)}&tab=runs&stageRun=${encode(run.id)}`,
        tone: stageRunTone(run.status),
        keys: [stageRunKeyLabel(run.status)],
        keywords: [
          'stage run',
          'execution',
          run.id,
          run.stage,
          run.status,
          task.id,
          task.title,
          task.jiraKey || '',
          task.workdir || '',
          run.output?.summary || '',
          run.output?.diffSummary || '',
        ],
        updatedAt,
      };
    }));
}

function workflowRunRank(run: WorkflowRunRecord): number {
  const pendingAsk = (run.asks || []).some(ask => ask.status === 'pending');
  const blocked = run.status === 'blocked' || run.steps.some(step => step.status === 'blocked' || step.autonomousRun?.state === 'failed' || step.autonomousRun?.state === 'stalled');
  if (pendingAsk) return 0;
  if (blocked) return 1;
  if (run.status === 'running') return 2;
  if (run.status === 'done') return 6;
  return 8;
}

function workflowRunTone(run: WorkflowRunRecord): ExecutionObjectTone {
  const rank = workflowRunRank(run);
  if (rank <= 1) return 'warn';
  if (run.status === 'running') return 'primary';
  if (run.status === 'done') return 'ok';
  return 'idle';
}

function workflowRunKeyLabel(run: WorkflowRunRecord): string {
  if ((run.asks || []).some(ask => ask.status === 'pending')) return 'Answer';
  if (workflowRunRank(run) === 1) return 'Review';
  if (run.status === 'running') return 'Running';
  if (run.status === 'done') return 'Done';
  return 'Workflow';
}

export function buildWorkflowRunExecutionObjects(runs: WorkflowRunRecord[], limit = 16): ExecutionObject[] {
  return uniqueByKey([...runs]
    .sort((a, b) => {
      const rankDiff = workflowRunRank(a) - workflowRunRank(b);
      if (rankDiff) return rankDiff;
      return parseTime(b.updatedAt || b.completedAt || b.createdAt) - parseTime(a.updatedAt || a.completedAt || a.createdAt);
    })
    .slice(0, Math.max(0, limit))
    .map(run => {
      const currentStep = run.steps.find(step => step.index === run.currentStep)
        || run.steps.find(step => step.status === 'now')
        || run.steps[0];
      const pendingAsk = (run.asks || []).find(ask => ask.status === 'pending');
      const detail = pendingAsk
        ? `Waiting for answer: ${compact(pendingAsk.question, 96)}`
        : currentStep
          ? `Step ${run.currentStep}/${run.totalSteps}: ${compact(currentStep.title, 96)}`
          : `${run.workflowName} · ${run.status}`;
      return {
        key: `workflow-run:${run.id}`,
        kind: 'workflow-run',
        title: run.title || run.workflowName,
        detail,
        to: `/workflows?run=${encode(run.id)}`,
        tone: workflowRunTone(run),
        keys: [workflowRunKeyLabel(run)],
        keywords: [
          'workflow run',
          'execution',
          run.id,
          run.workflowId || '',
          run.workflowName,
          run.title,
          run.status,
          run.workdir || '',
          run.agent || '',
          run.assistantName || '',
          currentStep?.title || '',
          pendingAsk?.question || '',
        ],
        updatedAt: run.updatedAt || run.completedAt || run.createdAt,
      };
    }));
}

function automationRunRank(run: AutomationRunHistoryItem): number {
  if (run.status === 'failed') return 0;
  if (run.status === 'missed') return 1;
  if (run.status === 'queued') return 2;
  return 8;
}

function automationRunTone(run: AutomationRunHistoryItem): ExecutionObjectTone {
  if (run.status === 'failed' || run.status === 'missed') return 'warn';
  if (run.status === 'queued') return 'primary';
  return 'idle';
}

function automationRunKeyLabel(run: AutomationRunHistoryItem): string {
  if (run.status === 'failed') return 'Failed';
  if (run.status === 'missed') return 'Missed';
  if (run.status === 'queued') return 'Queued';
  return 'Run';
}

export function buildAutomationRunExecutionObjects(automations: AutomationRule[], limit = 16): ExecutionObject[] {
  return uniqueByKey(automations
    .flatMap(job => (job.runHistory || []).map(run => ({ job, run })))
    .sort((a, b) => {
      const rankDiff = automationRunRank(a.run) - automationRunRank(b.run);
      if (rankDiff) return rankDiff;
      return parseTime(b.run.ranAt) - parseTime(a.run.ranAt);
    })
    .slice(0, Math.max(0, limit))
    .map(({ job, run }) => {
      const detail = run.error
        ? compact(run.error)
        : run.taskId
          ? `Task ${run.taskId}`
          : run.sessionKey
            ? `Session ${run.sessionKey}`
            : job.prompt || job.schedule;
      return {
        key: `automation-run:${job.id}:${run.id}`,
        kind: 'automation-run',
        title: `${job.name} run`,
        detail,
        to: `/scheduled-tasks?automation=${encode(job.id)}`,
        tone: automationRunTone(run),
        keys: [automationRunKeyLabel(run)],
        keywords: [
          'automation run',
          'scheduled task run',
          'execution',
          job.id,
          job.name,
          job.schedule,
          job.workdir || '',
          job.agent || '',
          job.assistantId || '',
          run.id,
          run.status,
          run.taskId || '',
          run.sessionKey || '',
          run.error || '',
          run.budgetName || '',
        ],
        updatedAt: run.ranAt,
      };
    }));
}

export function buildExecutionObjects(input: {
  tasks: ProTask[];
  workflowRuns: WorkflowRunRecord[];
  automations: AutomationRule[];
  limitPerKind?: number;
}): ExecutionObject[] {
  const limit = input.limitPerKind ?? 16;
  return [
    ...buildStageRunExecutionObjects(input.tasks, limit),
    ...buildWorkflowRunExecutionObjects(input.workflowRuns, limit),
    ...buildAutomationRunExecutionObjects(input.automations, limit),
  ].sort((a, b) => {
    const toneRank = (tone: ExecutionObjectTone) => tone === 'warn' ? 0 : tone === 'primary' ? 1 : tone === 'ok' ? 2 : 3;
    const rankDiff = toneRank(a.tone) - toneRank(b.tone);
    if (rankDiff) return rankDiff;
    return parseTime(b.updatedAt) - parseTime(a.updatedAt);
  });
}
