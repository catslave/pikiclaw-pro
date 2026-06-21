import type { AgentCapabilityMatrix } from '../../types';

export type ForkCapabilityMode = 'native' | 'portable';
export type ForkCapabilityTone = 'ok' | 'active';

export interface ForkCapabilitySummary {
  mode: ForkCapabilityMode;
  label: string;
  tone: ForkCapabilityTone;
  detail: string;
  title: string;
}

export function summarizeForkCapability(capabilities?: AgentCapabilityMatrix | null): ForkCapabilitySummary {
  const descriptor = capabilities?.forkCapability;
  if (capabilities?.fork || descriptor?.mode === 'native') {
    const source = descriptor?.source || descriptor?.statusSource || 'Agent-native fork protocol.';
    const detail = `Native branch session. ${source}`;
    return {
      mode: 'native',
      label: 'Native branch',
      tone: 'ok',
      detail,
      title: detail,
    };
  }

  const note = descriptor?.note || descriptor?.source || 'No verified native fork protocol.';
  const detail = `Pikiclaw portable branch handoff. ${note}`;
  return {
    mode: 'portable',
    label: 'Portable branch',
    tone: 'active',
    detail,
    title: `${detail} A child session keeps fork lineage and receives handoff context from the parent.`,
  };
}
