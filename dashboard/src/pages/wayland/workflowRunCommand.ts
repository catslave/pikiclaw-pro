import type { WorkflowRunRecord } from '../../types';
import { buildChatHomeWorkflowRunSummaries } from './workflowRunChatHome';

export type WorkflowRunCommandTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkflowRunCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  keys: string[];
  tone: WorkflowRunCommandTone;
  keywords: string[];
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function compact(value: string | null | undefined, max = 118): string {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function commandToneFor(run: WorkflowRunRecord, stateTone: string, nextActionTone: string): WorkflowRunCommandTone {
  if (stateTone === 'warn' || nextActionTone === 'warn' || run.status === 'blocked') return 'warn';
  if (run.status === 'running' || nextActionTone === 'primary') return 'primary';
  if (run.status === 'done') return 'ok';
  return 'idle';
}

export function buildWorkflowRunCommandItems(input: {
  runs: WorkflowRunRecord[];
  limit?: number;
  now?: Date | number;
}): WorkflowRunCommandItem[] {
  return buildChatHomeWorkflowRunSummaries({
    runs: input.runs,
    limit: input.limit ?? 12,
    now: input.now,
  }).map(summary => {
    const { run, operational, nextAction } = summary;
    const currentStep = run.steps.find(step => step.index === run.currentStep)
      || run.steps.find(step => step.status === 'now')
      || run.steps[0];
    const titlePrefix = nextAction.kind === 'answer-ask'
      ? 'Workflow ask'
      : nextAction.kind === 'resume-blocked-step'
        ? 'Workflow review'
        : run.status === 'running'
          ? 'Workflow running'
          : 'Workflow';
    const title = `${titlePrefix}: ${run.title || run.workflowName}`;
    const detail = [
      nextAction.label,
      compact(nextAction.detail),
      summary.progressLabel,
      summary.projectLabel,
      operational.etaLabel,
    ].filter(Boolean).join(' · ');
    return {
      key: `active-workflow:${run.id}`,
      title,
      detail,
      to: `/workflows?run=${encode(run.id)}`,
      keys: [
        operational.stateLabel,
        nextAction.kind === 'answer-ask' ? 'Answer' : nextAction.kind === 'resume-blocked-step' ? 'Review' : 'Open',
      ],
      tone: commandToneFor(run, operational.stateTone, nextAction.tone),
      keywords: [
        'active workflow',
        'workflow run',
        'workflow session',
        'running workflow',
        'blocked workflow',
        'workflow ask',
        'pending ask',
        'waiting input',
        run.id,
        run.workflowId || '',
        run.workflowName,
        run.title,
        run.status,
        run.workdir || '',
        run.agent || '',
        run.assistantName || '',
        currentStep?.title || '',
        nextAction.label,
        nextAction.detail,
        operational.stateLabel,
        operational.etaLabel,
      ],
    };
  });
}
