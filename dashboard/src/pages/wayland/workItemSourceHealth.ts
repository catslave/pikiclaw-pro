import type { ProTask } from '../../types';
import { workItemSourceEvidence } from './workItemSourceEvidence';

export type WorkItemSourceHealthTone = 'ok' | 'warn' | 'active' | 'idle';

export interface WorkItemSourceHealthSummary {
  label: string;
  detail: string;
  tone: WorkItemSourceHealthTone;
  evidenceCount: number;
  stale: boolean;
  refreshRank: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const JIRA_STALE_DAYS = 7;

type SourceKind = 'automation' | 'inbox' | 'manual' | 'ticket';

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function evidenceKinds(task: ProTask): Set<string> {
  return new Set(workItemSourceEvidence(task).map(item => item.kind));
}

function sourceKind(task: ProTask): SourceKind {
  if (task.jiraKey || task.kind === 'jira-ticket' || task.kind === 'jira-bug' || task.kind === 'jira-epic') return 'ticket';
  if (task.kind === 'todo') return 'inbox';
  if (task.kind === 'automation') return 'automation';
  return 'manual';
}

export function summarizeWorkItemSourceHealth(
  task: ProTask,
  nowInput: Date | number = new Date(),
): WorkItemSourceHealthSummary {
  const now = typeof nowInput === 'number' ? nowInput : nowInput.getTime();
  const resolvedSourceKind = sourceKind(task);
  const evidence = workItemSourceEvidence(task);
  const kinds = evidenceKinds(task);

  if (resolvedSourceKind === 'ticket') {
    const updatedAt = parseTime(task.jiraFields?.updatedAt);
    const stale = updatedAt != null && now - updatedAt > JIRA_STALE_DAYS * DAY_MS;
    if (!task.jiraFields?.updatedAt && !task.jiraFields?.raw) {
      return {
        label: 'Sync Jira',
        detail: 'No remote Jira snapshot yet.',
        tone: 'warn',
        evidenceCount: evidence.length,
        stale: false,
        refreshRank: 0,
      };
    }
    if (stale) {
      return {
        label: 'Jira stale',
        detail: `Remote snapshot is older than ${JIRA_STALE_DAYS} days.`,
        tone: 'warn',
        evidenceCount: evidence.length,
        stale: true,
        refreshRank: 1,
      };
    }
    return {
      label: task.prUrl || kinds.has('jira-link') ? 'Jira linked' : 'Jira synced',
      detail: task.jiraFields?.status ? `${task.jiraFields.status}${task.jiraFields.assignee ? ` · ${task.jiraFields.assignee}` : ''}` : 'Remote Jira metadata is available.',
      tone: 'ok',
      evidenceCount: evidence.length,
      stale: false,
      refreshRank: 99,
    };
  }

  if (resolvedSourceKind === 'inbox') {
    const richSignals = ['image', 'quote', 'session', 'linked-chat', 'workspace'].filter(kind => kinds.has(kind)).length;
    if (richSignals >= 2) {
      return {
        label: 'Inbox rich',
        detail: `${richSignals} source signals attached.`,
        tone: 'ok',
        evidenceCount: evidence.length,
        stale: false,
        refreshRank: 99,
      };
    }
    if (evidence.length > 0) {
      return {
        label: 'Inbox captured',
        detail: 'Todo source is preserved.',
        tone: 'active',
        evidenceCount: evidence.length,
        stale: false,
        refreshRank: 99,
      };
    }
    return {
      label: 'Source thin',
      detail: 'No todo evidence was preserved.',
      tone: 'warn',
      evidenceCount: 0,
      stale: false,
      refreshRank: 2,
    };
  }

  if (resolvedSourceKind === 'automation') {
    return {
      label: 'Automation',
      detail: evidence.length ? 'Automation source evidence is attached.' : 'Automation-created work item.',
      tone: 'active',
      evidenceCount: evidence.length,
      stale: false,
      refreshRank: 99,
    };
  }

  if (evidence.length > 0) {
    return {
      label: 'Evidence ready',
      detail: `${evidence.length} local source signal${evidence.length === 1 ? '' : 's'} attached.`,
      tone: 'active',
      evidenceCount: evidence.length,
      stale: false,
      refreshRank: 99,
    };
  }

  return {
    label: 'Manual',
    detail: 'No external source linked.',
    tone: 'idle',
    evidenceCount: 0,
    stale: false,
    refreshRank: 99,
  };
}

export function workItemSourceNeedsRefresh(task: ProTask, nowInput: Date | number = new Date()): boolean {
  const summary = summarizeWorkItemSourceHealth(task, nowInput);
  return summary.tone === 'warn';
}

export function compareWorkItemsBySourceRefresh(a: ProTask, b: ProTask, nowInput: Date | number = new Date()): number {
  const left = summarizeWorkItemSourceHealth(a, nowInput);
  const right = summarizeWorkItemSourceHealth(b, nowInput);
  if (left.refreshRank !== right.refreshRank) return left.refreshRank - right.refreshRank;
  if (left.stale || right.stale) {
    const leftRemote = parseTime(a.jiraFields?.updatedAt) ?? Number.POSITIVE_INFINITY;
    const rightRemote = parseTime(b.jiraFields?.updatedAt) ?? Number.POSITIVE_INFINITY;
    if (leftRemote !== rightRemote) return leftRemote - rightRemote;
  }
  return (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0);
}
