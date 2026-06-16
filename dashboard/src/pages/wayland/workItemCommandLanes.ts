export type WorkItemCommandLaneTone = 'source' | 'execution' | 'output' | 'attention' | 'idle';

export interface WorkItemCommandLane {
  label: string;
  value: string;
  tone: WorkItemCommandLaneTone;
}

export const commandLane = (
  label: string,
  value: string,
  tone: WorkItemCommandLaneTone,
): WorkItemCommandLane => ({
  label,
  value,
  tone,
});
