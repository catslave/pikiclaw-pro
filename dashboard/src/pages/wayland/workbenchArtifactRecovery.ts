import type { ProOutput, ProStageRunStatus, ProTask, ProTaskWorkbench, StageRun } from '../../types';

export type WorkbenchArtifactRecoveryTone = 'ok' | 'warn' | 'running' | 'idle';
export type WorkbenchArtifactRecoveryKind = 'active-session' | 'side-chat' | 'output-ready' | 'stage-output' | 'changed-files';
export type WorkbenchArtifactRecoveryTarget = 'workbench' | 'runs' | 'deliverables';

export interface WorkbenchArtifactRecoveryItem {
  id: string;
  kind: WorkbenchArtifactRecoveryKind;
  title: string;
  label: string;
  detail: string;
  meta: string;
  tone: WorkbenchArtifactRecoveryTone;
  updatedAt: string;
  target: WorkbenchArtifactRecoveryTarget;
  taskId: string;
  outputId?: string;
  stageRunId?: string;
  sessionId?: string;
  changedFiles?: string[];
}

export interface BuildWorkbenchArtifactRecoveryInput {
  tasks: ProTask[];
  workbenches?: Record<string, ProTaskWorkbench | null | undefined>;
  limit?: number;
}

function time(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskKey(task: ProTask): string {
  return task.jiraKey || task.localKey || task.id.slice(0, 8);
}

function stageUpdatedAt(run: StageRun, task: ProTask): string {
  return run.completedAt || run.startedAt || task.updatedAt || task.createdAt;
}

function outputUpdatedAt(output: ProOutput, task: ProTask): string {
  return output.createdAt || task.updatedAt || task.createdAt;
}

function sideChatUpdatedAt(workbench: ProTaskWorkbench, stageRunId: string | undefined, task: ProTask): string {
  const parentRun = stageRunId
    ? workbench.task.stageRuns.find(run => run.id === stageRunId)
    : null;
  return parentRun ? stageUpdatedAt(parentRun, task) : task.updatedAt || task.createdAt;
}

function artifactRank(tone: WorkbenchArtifactRecoveryTone): number {
  if (tone === 'warn') return 0;
  if (tone === 'running') return 1;
  if (tone === 'ok') return 2;
  return 3;
}

function activeSessionTone(status: ProStageRunStatus): WorkbenchArtifactRecoveryTone {
  if (status === 'waiting-user' || status === 'failed') return 'warn';
  if (status === 'running' || status === 'queued') return 'running';
  if (status === 'completed') return 'ok';
  return 'idle';
}

function stageStatusLabel(status: ProStageRunStatus): string {
  if (status === 'waiting-user') return 'Waiting input';
  if (status === 'running') return 'Active session';
  if (status === 'queued') return 'Queued session';
  if (status === 'failed') return 'Stage failed';
  if (status === 'completed') return 'Stage complete';
  if (status === 'cancelled') return 'Stage cancelled';
  return status;
}

function outputLabel(output: ProOutput): string {
  if (output.pinned) return 'Pinned output';
  if (output.kind === 'final') return 'Final output';
  if (output.kind === 'document') return 'Document';
  if (output.kind === 'diff') return 'Diff';
  if (output.kind === 'image') return 'Image';
  if (output.kind === 'file') return 'File';
  return 'Output ready';
}

function compactDetail(value: string | undefined, fallback: string): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export function buildWorkbenchArtifactRecoveryItems(input: BuildWorkbenchArtifactRecoveryInput): WorkbenchArtifactRecoveryItem[] {
  const tasks = input.tasks || [];
  const limit = Math.max(1, input.limit || 6);
  const items: WorkbenchArtifactRecoveryItem[] = [];

  for (const task of tasks) {
    const workbench = input.workbenches?.[task.id] || null;
    for (const sideChat of workbench?.sideChats || []) {
      items.push({
        id: `side-chat:${task.id}:${sideChat.sessionId}`,
        kind: 'side-chat',
        title: task.title,
        label: 'Side chat',
        detail: compactDetail(sideChat.title || sideChat.sessionId, 'Open the side chat branch to recover the reasoning thread.'),
        meta: `${taskKey(task)} · ${sideChat.agent} · ${sideChat.sessionId.slice(0, 12)}`,
        tone: 'running',
        updatedAt: sideChatUpdatedAt(workbench, sideChat.parentStageRunId, task),
        target: 'workbench',
        taskId: task.id,
        stageRunId: sideChat.parentStageRunId,
        sessionId: sideChat.sessionId,
      });
    }

    for (const run of task.stageRuns || []) {
      if (run.status === 'running' || run.status === 'queued' || run.status === 'waiting-user' || run.status === 'failed') {
        const owner = run.assistantId || run.selectedAgent || task.defaultAssistantId || task.defaultAgent || 'agent';
        items.push({
          id: `active-session:${task.id}:${run.id}`,
          kind: 'active-session',
          title: task.title,
          label: stageStatusLabel(run.status),
          detail: compactDetail(run.output?.summary || run.displayPrompt || run.prompt, 'Open the workbench to inspect the current agent session.'),
          meta: `${taskKey(task)} · ${run.stage} · ${owner}`,
          tone: activeSessionTone(run.status),
          updatedAt: stageUpdatedAt(run, task),
          target: 'workbench',
          taskId: task.id,
          stageRunId: run.id,
        });
      }

      if (run.output?.summary || run.output?.diffSummary || run.output?.branch || run.output?.testResultId || (run.output?.knowledgeRefs || []).length) {
        items.push({
          id: `stage-output:${task.id}:${run.id}`,
          kind: 'stage-output',
          title: task.title,
          label: run.status === 'failed' ? 'Failed output' : 'Stage output',
          detail: compactDetail(run.output.summary || run.output.diffSummary || run.output.branch || run.output.testResultId, 'Stage generated a structured output that is ready for review.'),
          meta: `${taskKey(task)} · ${run.stage} · ${run.status}`,
          tone: run.status === 'failed' || run.status === 'waiting-user' ? 'warn' : run.status === 'running' || run.status === 'queued' ? 'running' : 'ok',
          updatedAt: stageUpdatedAt(run, task),
          target: 'runs',
          taskId: task.id,
          stageRunId: run.id,
        });
      }

      const changedFiles = (run.output?.changedFiles || []).filter(Boolean);
      if (changedFiles.length) {
        items.push({
          id: `changed-files:${task.id}:${run.id}`,
          kind: 'changed-files',
          title: task.title,
          label: 'Changed files',
          detail: changedFiles.slice(0, 3).join(', ') + (changedFiles.length > 3 ? ` +${changedFiles.length - 3}` : ''),
          meta: `${taskKey(task)} · ${run.stage} · ${changedFiles.length} files`,
          tone: run.status === 'failed' || run.status === 'waiting-user' ? 'warn' : 'ok',
          updatedAt: stageUpdatedAt(run, task),
          target: 'workbench',
          taskId: task.id,
          stageRunId: run.id,
          changedFiles,
        });
      }
    }

    for (const output of task.outputs || []) {
      items.push({
        id: `output-ready:${task.id}:${output.id}`,
        kind: 'output-ready',
        title: task.title,
        label: outputLabel(output),
        detail: compactDetail(output.summary || output.title || output.path || output.url, 'Open deliverables to inspect this Work Item output.'),
        meta: `${taskKey(task)} · ${output.kind}${output.pinned ? ' · pinned' : ''}`,
        tone: 'ok',
        updatedAt: outputUpdatedAt(output, task),
        target: 'deliverables',
        taskId: task.id,
        outputId: output.id,
        stageRunId: output.stageRunId,
      });
    }
  }

  const seen = new Set<string>();
  return items
    .sort((a, b) => artifactRank(a.tone) - artifactRank(b.tone) || time(b.updatedAt) - time(a.updatedAt))
    .filter(item => {
      const key = `${item.kind}:${item.taskId}:${item.stageRunId || item.outputId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
