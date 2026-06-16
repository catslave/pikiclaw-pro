import type { ProTask } from '../../types';
import type { WorkItemSourceEvidence } from './workItemSourceEvidence';

export interface WorkItemSourceEvidenceDisplay {
  label: string;
  value: string;
  detail?: string;
}

function compactTaskLabel(task: ProTask): string {
  return [task.localKey || task.jiraKey, task.title].filter(Boolean).join(' - ') || task.id;
}

export function resolveWorkItemSourceEvidenceDisplay(
  evidence: WorkItemSourceEvidence,
  linkedTask?: ProTask | null,
): WorkItemSourceEvidenceDisplay {
  if (evidence.kind !== 'linked-task') {
    return {
      label: evidence.label,
      value: evidence.value,
      detail: evidence.detail,
    };
  }
  if (!linkedTask) {
    return {
      label: evidence.label,
      value: evidence.value,
      detail: 'Linked Work Item is not loaded in the current task index.',
    };
  }
  return {
    label: evidence.label,
    value: compactTaskLabel(linkedTask),
    detail: [linkedTask.status, linkedTask.stage, linkedTask.workdir].filter(Boolean).join(' - '),
  };
}
