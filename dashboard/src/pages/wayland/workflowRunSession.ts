import type { WorkflowRunAsk, WorkflowRunRecord, WorkflowRunStep } from '../../types';

export type WorkflowRunSessionActionKind =
  | 'answer-ask'
  | 'resume-blocked-step'
  | 'resume-current-step'
  | 'open-chat'
  | 'review-run'
  | 'unavailable';

export type WorkflowRunSessionActionTone = 'primary' | 'warn' | 'ok' | 'muted';

export type WorkflowRunSessionNextAction = {
  kind: WorkflowRunSessionActionKind;
  label: string;
  detail: string;
  tone: WorkflowRunSessionActionTone;
  stepIndex?: number;
  askId?: string;
};

function workflowRunHasChatHandoff(run: WorkflowRunRecord): boolean {
  return Boolean(run.workdir && (run.sessionId || run.sessionKey));
}

function currentWorkflowRunStep(run: WorkflowRunRecord): WorkflowRunStep | null {
  return run.steps.find(step => step.index === run.currentStep) || run.steps[0] || null;
}

function oldestPendingAsk(asks: WorkflowRunAsk[]): WorkflowRunAsk | null {
  const pending = asks.filter(ask => ask.status === 'pending');
  pending.sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  return pending[0] || null;
}

function shortQuestion(question: string): string {
  const clean = question.trim().replace(/\s+/g, ' ');
  if (clean.length <= 96) return clean;
  return `${clean.slice(0, 93)}...`;
}

export function workflowRunSessionNextAction(run: WorkflowRunRecord): WorkflowRunSessionNextAction {
  const pendingAsk = oldestPendingAsk(run.asks || []);
  if (pendingAsk) {
    return {
      kind: 'answer-ask',
      label: 'Answer ask',
      detail: `Step ${pendingAsk.stepIndex}: ${shortQuestion(pendingAsk.question)}`,
      tone: 'warn',
      stepIndex: pendingAsk.stepIndex,
      askId: pendingAsk.id,
    };
  }

  if (run.status === 'done') {
    return {
      kind: 'review-run',
      label: 'Review run',
      detail: run.completedAt ? `Completed ${run.completedAt}` : `${run.totalSteps} steps complete`,
      tone: 'ok',
    };
  }

  const currentStep = currentWorkflowRunStep(run);
  if (!currentStep) {
    return {
      kind: workflowRunHasChatHandoff(run) ? 'open-chat' : 'unavailable',
      label: workflowRunHasChatHandoff(run) ? 'Open chat' : 'No session',
      detail: workflowRunHasChatHandoff(run) ? 'Continue from the linked chat.' : 'This run has no linked project or session.',
      tone: 'muted',
    };
  }

  if (run.status === 'blocked' || currentStep.status === 'blocked') {
    return {
      kind: 'resume-blocked-step',
      label: 'Resume blocked step',
      detail: `Step ${currentStep.index}/${run.totalSteps}: ${currentStep.title}`,
      tone: 'warn',
      stepIndex: currentStep.index,
    };
  }

  if (workflowRunHasChatHandoff(run)) {
    return {
      kind: 'resume-current-step',
      label: 'Resume current step',
      detail: `Step ${currentStep.index}/${run.totalSteps}: ${currentStep.title}`,
      tone: 'primary',
      stepIndex: currentStep.index,
    };
  }

  return {
    kind: 'unavailable',
    label: 'Session missing',
    detail: 'Attach this run to a project chat before resuming.',
    tone: 'muted',
    stepIndex: currentStep.index,
  };
}
