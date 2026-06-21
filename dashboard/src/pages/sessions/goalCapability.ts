import type { AgentCapabilityDescriptor } from '../../types';

export type GoalCapabilityTone = 'ok' | 'active' | 'warn' | 'idle';

export interface GoalCapabilitySummary {
  mode: 'native' | 'portable' | 'unsupported';
  label: string;
  tone: GoalCapabilityTone;
  detail: string;
  controlHint: string | null;
  title: string;
}

function normalizeSource(capability?: AgentCapabilityDescriptor | null): string {
  return capability?.note || capability?.source || capability?.statusSource || 'No verified goal contract.';
}

export function summarizeGoalCapability(capability?: AgentCapabilityDescriptor | null): GoalCapabilitySummary {
  const mode = capability?.mode || 'unsupported';
  const actions = new Set(capability?.actions || []);
  const source = normalizeSource(capability);
  const missingLifecycle = !actions.has('pause') || !actions.has('resume');
  const controlHint = missingLifecycle && mode !== 'unsupported'
    ? 'Pause/resume unavailable'
    : !actions.has('clear') && mode !== 'unsupported'
      ? 'Clear unavailable'
      : null;

  if (mode === 'native') {
    const detail = `Agent-owned goal state. ${source}`;
    return {
      mode,
      label: 'Native goal',
      tone: 'ok',
      detail,
      controlHint,
      title: controlHint ? `${detail} ${controlHint}.` : detail,
    };
  }
  if (mode === 'portable') {
    const detail = `Pikiclaw-owned portable goal state. ${source}`;
    return {
      mode,
      label: 'Portable goal',
      tone: 'active',
      detail,
      controlHint,
      title: controlHint ? `${detail} ${controlHint}.` : detail,
    };
  }
  const detail = source;
  return {
    mode,
    label: 'Goal unsupported',
    tone: 'warn',
    detail,
    controlHint: null,
    title: detail,
  };
}
