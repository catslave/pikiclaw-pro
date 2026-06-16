import type { WorkItemSourceEvidence, WorkItemSourceEvidenceKind } from './workItemSourceEvidence';

export type WorkItemSourceEvidenceLaneKey = 'inbox' | 'remote' | 'context' | 'plan';
export type WorkItemSourceEvidenceLaneTone = 'primary' | 'ok' | 'warn' | 'idle';

export interface WorkItemSourceEvidenceRailLane {
  key: WorkItemSourceEvidenceLaneKey;
  label: string;
  detail: string;
  tone: WorkItemSourceEvidenceLaneTone;
  evidence: WorkItemSourceEvidence[];
}

export interface WorkItemSourceEvidenceRailSummary {
  title: string;
  detail: string;
  tone: WorkItemSourceEvidenceLaneTone;
  totalCount: number;
  lanes: WorkItemSourceEvidenceRailLane[];
}

const LANE_BY_KIND: Record<WorkItemSourceEvidenceKind, WorkItemSourceEvidenceLaneKey> = {
  daily: 'plan',
  image: 'inbox',
  'jira-comment': 'remote',
  'jira-link': 'remote',
  'jira-ticket': 'remote',
  'linked-chat': 'context',
  'linked-task': 'context',
  note: 'inbox',
  quote: 'inbox',
  session: 'context',
  workspace: 'context',
};

const LANE_ORDER: WorkItemSourceEvidenceLaneKey[] = ['inbox', 'remote', 'context', 'plan'];

function laneMeta(key: WorkItemSourceEvidenceLaneKey): Pick<WorkItemSourceEvidenceRailLane, 'label' | 'detail'> {
  if (key === 'inbox') return { label: 'Inbox evidence', detail: 'Todo images, quotes, notes, and captured context.' };
  if (key === 'remote') return { label: 'Remote evidence', detail: 'Jira ticket, comments, linked issues, and review links.' };
  if (key === 'context') return { label: 'Context evidence', detail: 'Sessions, linked chats, workspace paths, and related work.' };
  return { label: 'Plan evidence', detail: 'Daily plan and scheduling source.' };
}

function laneTone(key: WorkItemSourceEvidenceLaneKey, evidence: WorkItemSourceEvidence[]): WorkItemSourceEvidenceLaneTone {
  if (!evidence.length) return 'idle';
  if (key === 'remote') return 'primary';
  if (key === 'inbox') return evidence.some(item => item.kind === 'image') ? 'ok' : 'primary';
  if (key === 'context') return 'ok';
  return 'primary';
}

export function buildWorkItemSourceEvidenceRail(evidence: WorkItemSourceEvidence[]): WorkItemSourceEvidenceRailSummary {
  const lanes = LANE_ORDER.map(key => {
    const laneEvidence = evidence.filter(item => LANE_BY_KIND[item.kind] === key);
    return {
      key,
      ...laneMeta(key),
      tone: laneTone(key, laneEvidence),
      evidence: laneEvidence,
    };
  });
  const nonEmpty = lanes.filter(lane => lane.evidence.length > 0);
  const totalCount = evidence.length;
  if (!totalCount) {
    return {
      title: 'Source evidence missing',
      detail: 'Attach source material before launching more agent work.',
      tone: 'warn',
      totalCount,
      lanes,
    };
  }
  const hasRemote = lanes.some(lane => lane.key === 'remote' && lane.evidence.length > 0);
  const hasInbox = lanes.some(lane => lane.key === 'inbox' && lane.evidence.length > 0);
  const hasContext = lanes.some(lane => lane.key === 'context' && lane.evidence.length > 0);
  return {
    title: hasRemote && hasInbox && hasContext ? 'Source graph ready' : 'Source evidence ready',
    detail: nonEmpty.map(lane => `${lane.label} ${lane.evidence.length}`).join(' · '),
    tone: hasRemote || hasContext ? 'ok' : 'primary',
    totalCount,
    lanes,
  };
}
