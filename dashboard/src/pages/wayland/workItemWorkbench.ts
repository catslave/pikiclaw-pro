import type { ProStageRunStatus, ProTaskWorkbench, StageSessionRef } from '../../types';

export type WorkItemWorkbenchTone = 'ok' | 'warn' | 'err' | 'idle' | 'active' | 'running';

export interface WorkItemWorkbenchSummary {
  activeStageLabel: string;
  activeStageTone: WorkItemWorkbenchTone;
  activeSession: StageSessionRef | null;
  sideChatCount: number;
  fileCount: number;
  outputCount: number;
  ticketStatus: string;
  ticketOwner: string;
  signalCount: number;
  chips: string[];
}

function stageStatusTone(status: ProStageRunStatus | undefined): WorkItemWorkbenchTone {
  if (status === 'failed') return 'err';
  if (status === 'waiting-user') return 'warn';
  if (status === 'running' || status === 'queued') return 'running';
  if (status === 'completed') return 'ok';
  if (status === 'cancelled') return 'idle';
  return 'idle';
}

function uniqueSessionKey(session: StageSessionRef): string {
  return [session.workdir, session.agent, session.sessionId].join('\u0000');
}

export function workItemWorkbenchSessionCount(workbench: ProTaskWorkbench): number {
  const keys = new Set<string>();
  for (const run of workbench.task.stageRuns || []) {
    if (run.session?.sessionId) keys.add(uniqueSessionKey(run.session));
  }
  for (const sideChat of workbench.sideChats || []) {
    if (sideChat.sessionId) keys.add(uniqueSessionKey(sideChat));
  }
  return keys.size;
}

export function summarizeWorkItemWorkbench(workbench: ProTaskWorkbench): WorkItemWorkbenchSummary {
  const activeStage = workbench.activeStageRun;
  const ticket = workbench.ticketSnapshot;
  const sessionCount = workItemWorkbenchSessionCount(workbench);
  const sideChatCount = workbench.sideChats.length;
  const fileCount = workbench.files.length;
  const outputCount = workbench.outputs.length;
  const signalCount = (activeStage ? 1 : 0) + sideChatCount + fileCount + outputCount + (ticket.jiraKey ? 1 : 0);

  return {
    activeStageLabel: activeStage ? `${activeStage.stage} · ${activeStage.status}` : 'No active stage',
    activeStageTone: stageStatusTone(activeStage?.status),
    activeSession: activeStage?.session || null,
    sideChatCount,
    fileCount,
    outputCount,
    ticketStatus: ticket.status || workbench.task.status,
    ticketOwner: ticket.assignee || ticket.reporter || 'Unassigned',
    signalCount,
    chips: [
      `${sessionCount} sessions`,
      `${sideChatCount} side chats`,
      `${fileCount} files`,
      `${outputCount} outputs`,
    ],
  };
}
