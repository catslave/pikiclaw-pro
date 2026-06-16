import type { WorkItemOperationalSummary, WorkItemOperationalTone } from './workItemOperationalState';
import type { WorkItemRemoteBoundarySummary, WorkItemRemoteBoundaryTone } from './workItemRemoteBoundary';
import type { WorkItemSourceHealthSummary, WorkItemSourceHealthTone } from './workItemSourceHealth';

export type WorkItemLifecycleStepKey = 'source' | 'boundary' | 'execution' | 'output';
export type WorkItemLifecycleTarget = 'activity' | 'source' | 'runs' | 'deliverables';
export type WorkItemLifecycleTone =
  | WorkItemOperationalTone
  | WorkItemRemoteBoundaryTone
  | WorkItemSourceHealthTone
  | 'default';

export interface WorkItemLifecycleStep {
  key: WorkItemLifecycleStepKey;
  title: string;
  label: string;
  detail: string;
  tone: WorkItemLifecycleTone;
  target: WorkItemLifecycleTarget;
  attention: boolean;
}

export interface WorkItemLifecycleCommandSummary {
  title: string;
  label: string;
  detail: string;
  target: WorkItemLifecycleTarget;
  tone: WorkItemLifecycleTone;
  attention: boolean;
}

export function buildWorkItemLifecycle(input: {
  operational: WorkItemOperationalSummary;
  remoteBoundary: WorkItemRemoteBoundarySummary;
  sourceHealth: WorkItemSourceHealthSummary;
}): WorkItemLifecycleStep[] {
  const { operational, remoteBoundary, sourceHealth } = input;
  const hasOutput = operational.outputCount > 0;
  const executionAttention = operational.stateTone === 'err'
    || operational.stateTone === 'warn'
    || operational.stateTone === 'running';

  return [
    {
      key: 'source',
      title: 'Source',
      label: sourceHealth.label,
      detail: sourceHealth.detail,
      tone: sourceHealth.tone,
      target: 'source',
      attention: sourceHealth.tone === 'warn' || sourceHealth.stale,
    },
    {
      key: 'boundary',
      title: 'Boundary',
      label: remoteBoundary.label,
      detail: remoteBoundary.detail,
      tone: remoteBoundary.tone,
      target: 'source',
      attention: remoteBoundary.tone === 'err'
        || remoteBoundary.tone === 'warn'
        || remoteBoundary.tone === 'running'
        || remoteBoundary.pendingRunCount > 0,
    },
    {
      key: 'execution',
      title: 'Execution',
      label: operational.stateLabel,
      detail: operational.openRunCount
        ? `${operational.openRunCount} open · ${operational.nextActionDetail}`
        : operational.nextActionDetail,
      tone: operational.stateTone,
      target: operational.openRunCount || operational.latestStageLabel !== 'No stage yet' ? 'runs' : 'activity',
      attention: executionAttention || operational.riskCount > 0,
    },
    {
      key: 'output',
      title: 'Output',
      label: hasOutput ? `${operational.outputCount} saved` : 'No output',
      detail: hasOutput ? 'Deliverables or stage outputs are available for review.' : 'No deliverables saved yet.',
      tone: hasOutput ? 'ok' : 'idle',
      target: 'deliverables',
      attention: false,
    },
  ];
}

export function summarizeWorkItemLifecycleCommand(steps: WorkItemLifecycleStep[]): WorkItemLifecycleCommandSummary {
  const primary = steps.find(step => step.attention)
    || steps.find(step => step.key === 'execution')
    || steps[0];

  if (!primary) {
    return {
      title: 'Lifecycle',
      label: 'No state',
      detail: 'No lifecycle signals are available.',
      target: 'activity',
      tone: 'default',
      attention: false,
    };
  }

  return {
    title: primary.title,
    label: primary.label,
    detail: primary.detail,
    target: primary.target,
    tone: primary.tone,
    attention: primary.attention,
  };
}
