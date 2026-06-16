import type { ProOutput, ProTask, ProTaskWorkbench, StageRun } from '../../types';
import type { WorkItemWorkflowArtifact } from './workItemWorkflowArtifacts';

export type WorkItemAssetLaneKey = 'work' | 'runs' | 'outputs' | 'files';
export type WorkItemAssetLaneTone = 'primary' | 'ok' | 'warn' | 'err' | 'idle' | 'running';

export interface WorkItemAssetLane {
  key: WorkItemAssetLaneKey;
  label: string;
  detail: string;
  count: number;
  tone: WorkItemAssetLaneTone;
  targetTab: 'workbench' | 'runs' | 'deliverables';
}

export interface WorkItemAssetCockpitSummary {
  title: string;
  detail: string;
  totalCount: number;
  tone: WorkItemAssetLaneTone;
  lanes: WorkItemAssetLane[];
}

function stageRunTone(stageRuns: StageRun[]): WorkItemAssetLaneTone {
  if (stageRuns.some(run => run.status === 'failed')) return 'err';
  if (stageRuns.some(run => run.status === 'waiting-user')) return 'warn';
  if (stageRuns.some(run => run.status === 'running' || run.status === 'queued')) return 'running';
  if (stageRuns.some(run => run.status === 'completed')) return 'ok';
  return 'idle';
}

function outputTone(outputs: ProOutput[]): WorkItemAssetLaneTone {
  if (!outputs.length) return 'idle';
  if (outputs.some(output => output.pinned || output.kind === 'final' || output.kind === 'document' || output.kind === 'diff')) return 'ok';
  return 'primary';
}

function summaryLabel(lane: WorkItemAssetLane): string {
  if (lane.key === 'work') return 'Work sessions';
  return lane.label;
}

export function buildWorkItemAssetCockpit(input: {
  task: ProTask;
  workbench?: ProTaskWorkbench | null;
  workflowArtifacts?: WorkItemWorkflowArtifact[];
  workbenchLoading?: boolean;
}): WorkItemAssetCockpitSummary {
  const { task, workbench = null, workflowArtifacts = [], workbenchLoading = false } = input;
  const stageRuns = task.stageRuns || [];
  const outputs = workbench?.outputs?.length ? workbench.outputs : task.outputs || [];
  const sideChatCount = workbench?.sideChats.length || 0;
  const fileCount = workbench?.files.length || 0;
  const activeStageSessionCount = stageRuns.filter(run => run.session?.sessionId).length;
  const workCount = activeStageSessionCount + sideChatCount + (workbenchLoading ? 1 : 0);
  const runCount = stageRuns.length + workflowArtifacts.length;
  const outputCount = outputs.length;
  const totalCount = workCount + runCount + outputCount + fileCount;

  const lanes: WorkItemAssetLane[] = [
    {
      key: 'work',
      label: 'Work',
      detail: sideChatCount
        ? `${activeStageSessionCount} stage · ${sideChatCount} side`
        : workbenchLoading
          ? 'Restoring sessions'
          : `${activeStageSessionCount} stage sessions`,
      count: workCount,
      tone: workbenchLoading ? 'running' : workCount ? 'primary' : 'idle',
      targetTab: 'workbench',
    },
    {
      key: 'runs',
      label: 'Runs',
      detail: workflowArtifacts.length
        ? `${stageRuns.length} stage · ${workflowArtifacts.length} workflow`
        : `${stageRuns.length} stage runs`,
      count: runCount,
      tone: stageRunTone(stageRuns),
      targetTab: 'runs',
    },
    {
      key: 'outputs',
      label: 'Outputs',
      detail: outputCount ? 'Saved deliverables and review material' : 'No saved deliverables',
      count: outputCount,
      tone: outputTone(outputs),
      targetTab: 'deliverables',
    },
    {
      key: 'files',
      label: 'Files',
      detail: fileCount ? 'Referenced files from runs and outputs' : 'No referenced files',
      count: fileCount,
      tone: fileCount ? 'ok' : 'idle',
      targetTab: 'workbench',
    },
  ];

  if (!totalCount) {
    return {
      title: 'No work assets yet',
      detail: 'Start a stage or attach output to build the workbench.',
      totalCount,
      tone: 'idle',
      lanes,
    };
  }

  const attentionLane = lanes.find(lane => lane.tone === 'err' || lane.tone === 'warn');
  const activeLaneCount = lanes.filter(lane => lane.count > 0).length;
  return {
    title: attentionLane ? 'Work assets need review' : 'Work assets ready',
    detail: lanes.filter(lane => lane.count > 0).map(lane => `${summaryLabel(lane)} ${lane.count}`).join(' · '),
    totalCount,
    tone: attentionLane?.tone || (lanes.some(lane => lane.tone === 'running') ? 'running' : activeLaneCount >= 3 ? 'ok' : 'primary'),
    lanes,
  };
}
