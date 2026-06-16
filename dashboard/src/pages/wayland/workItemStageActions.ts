import type { ProTask, ProTaskStage, StageSessionRef } from '../../types';

export type WorkItemStageActionTone = 'ok' | 'warn' | 'idle' | 'active' | 'running';

export interface WorkItemStageAction {
  stage: ProTaskStage;
  title: string;
  actionLabel: string;
  detail: string;
  tone: WorkItemStageActionTone;
  recommended: boolean;
  activeSession: StageSessionRef | null;
}

const STAGE_DEFS: Array<{ stage: ProTaskStage; title: string; detail: string }> = [
  { stage: 'focus', title: 'Focus', detail: 'Clarify goal, boundaries, and risks with the user.' },
  { stage: 'refinement', title: 'Refine', detail: 'Produce a goal, acceptance criteria, estimate, and implementation plan.' },
  { stage: 'coding', title: 'Code', detail: 'Start implementation or analyze the current branch/MR.' },
  { stage: 'verification', title: 'Verify', detail: 'Prepare test cases, environment checks, and verification evidence.' },
  { stage: 'bugfix', title: 'Bugfix', detail: 'Investigate likely root cause and propose or implement a focused fix.' },
];

function latestOpenRun(task: ProTask, stage: ProTaskStage) {
  return [...(task.stageRuns || [])]
    .filter(run => run.stage === stage && run.status !== 'completed' && run.status !== 'cancelled')
    .sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''))[0] || null;
}

function hasCompletedRun(task: ProTask, stage: ProTaskStage): boolean {
  return (task.stageRuns || []).some(run => run.stage === stage && run.status === 'completed');
}

export function recommendedWorkItemStage(task: ProTask): ProTaskStage {
  const activeRun = [...(task.stageRuns || [])]
    .filter(run => run.status !== 'completed' && run.status !== 'cancelled')
    .sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''))[0];
  if (activeRun) return activeRun.stage;
  if (task.status === 'coding') return task.kind === 'jira-bug' ? 'bugfix' : 'coding';
  if (task.status === 'resolved' || task.status === 'done') return 'verification';
  if (task.status === 'refinement') return 'refinement';
  return task.kind === 'jira-bug' ? 'bugfix' : 'refinement';
}

function actionTone(task: ProTask, stage: ProTaskStage, activeRun: ReturnType<typeof latestOpenRun>, recommended: boolean): WorkItemStageActionTone {
  if (activeRun?.status === 'failed' || activeRun?.status === 'waiting-user') return 'warn';
  if (activeRun?.status === 'running' || activeRun?.status === 'queued') return 'running';
  if (activeRun) return 'active';
  if (hasCompletedRun(task, stage)) return 'ok';
  return recommended ? 'active' : 'idle';
}

export function buildWorkItemStageActions(task: ProTask): WorkItemStageAction[] {
  const recommendedStage = recommendedWorkItemStage(task);
  return STAGE_DEFS
    .filter(def => def.stage !== 'bugfix' || task.kind === 'jira-bug' || recommendedStage === 'bugfix' || hasCompletedRun(task, 'bugfix') || latestOpenRun(task, 'bugfix'))
    .map(def => {
      const activeRun = latestOpenRun(task, def.stage);
      const recommended = def.stage === recommendedStage;
      return {
        stage: def.stage,
        title: def.title,
        actionLabel: activeRun ? 'Open' : recommended ? 'Start next' : 'Start',
        detail: activeRun ? `${def.title} is ${activeRun.status}.` : def.detail,
        tone: actionTone(task, def.stage, activeRun, recommended),
        recommended,
        activeSession: activeRun?.session || null,
      };
    });
}
