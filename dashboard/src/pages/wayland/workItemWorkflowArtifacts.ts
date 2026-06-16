import type { ProTask, StageRun, WorkflowRunRecord } from '../../types';

export type WorkItemWorkflowArtifactMatch =
  | 'stage-session'
  | 'task-id'
  | 'jira-key'
  | 'local-key'
  | 'title';

export type WorkItemWorkflowArtifact = {
  run: WorkflowRunRecord;
  match: WorkItemWorkflowArtifactMatch;
  reason: string;
  score: number;
};

function compact(value: string | undefined): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalize(value: string | undefined): string {
  return compact(value).toLowerCase();
}

function workflowRunText(run: WorkflowRunRecord): string {
  return [
    run.id,
    run.workflowId,
    run.workflowName,
    run.title,
    run.workdir,
    run.agent,
    run.model,
    run.assistantName,
    run.sessionKey,
    run.sessionId,
    run.note,
    run.lastMarker,
    ...run.steps.map(step => step.title),
    ...run.asks.map(ask => ask.question),
  ].filter(Boolean).join(' ');
}

function stageRunSessionKeys(stageRuns: StageRun[]): Set<string> {
  const keys = new Set<string>();
  stageRuns.forEach(run => {
    if (run.session?.agent && run.session?.sessionId) {
      keys.add(`${run.session.agent}:${run.session.sessionId}`.toLowerCase());
    }
  });
  return keys;
}

function workflowRunSessionKeys(run: WorkflowRunRecord): string[] {
  const keys = new Set<string>();
  if (run.sessionKey) keys.add(run.sessionKey.toLowerCase());
  if (run.agent && run.sessionId) keys.add(`${run.agent}:${run.sessionId}`.toLowerCase());
  return Array.from(keys);
}

function includesToken(haystack: string, token: string | undefined): boolean {
  const clean = normalize(token);
  return clean.length >= 4 && haystack.includes(clean);
}

function titleMatches(haystack: string, taskTitle: string): boolean {
  const title = normalize(taskTitle);
  if (title.length < 10) return false;
  if (haystack.includes(title)) return true;
  const titleWords = title.split(/\W+/).filter(word => word.length >= 4);
  if (titleWords.length < 3) return false;
  const hits = titleWords.filter(word => haystack.includes(word)).length;
  return hits >= Math.min(4, titleWords.length);
}

export function workItemWorkflowArtifactForRun(task: ProTask, run: WorkflowRunRecord): WorkItemWorkflowArtifact | null {
  const text = normalize(workflowRunText(run));
  const taskSessionKeys = stageRunSessionKeys(task.stageRuns);
  const sameStageSession = workflowRunSessionKeys(run).some(key => taskSessionKeys.has(key));
  const sameWorkdir = Boolean(task.workdir && run.workdir && task.workdir === run.workdir);

  if (sameStageSession) {
    return {
      run,
      match: 'stage-session',
      reason: 'Same stage chat',
      score: 120,
    };
  }

  if (includesToken(text, task.id)) {
    return {
      run,
      match: 'task-id',
      reason: 'Mentions task id',
      score: 110 + (sameWorkdir ? 5 : 0),
    };
  }

  if (includesToken(text, task.jiraKey)) {
    return {
      run,
      match: 'jira-key',
      reason: `Mentions ${task.jiraKey}`,
      score: 100 + (sameWorkdir ? 5 : 0),
    };
  }

  if (includesToken(text, task.localKey)) {
    return {
      run,
      match: 'local-key',
      reason: `Mentions ${task.localKey}`,
      score: 90 + (sameWorkdir ? 5 : 0),
    };
  }

  if (sameWorkdir && titleMatches(text, task.title)) {
    return {
      run,
      match: 'title',
      reason: 'Matches title in project',
      score: 70,
    };
  }

  return null;
}

export function relatedWorkflowRunsForWorkItem(
  task: ProTask,
  runs: WorkflowRunRecord[],
  options: { limit?: number } = {},
): WorkItemWorkflowArtifact[] {
  const limit = Math.max(1, Math.min(20, options.limit || 6));
  return runs
    .map(run => workItemWorkflowArtifactForRun(task, run))
    .filter((item): item is WorkItemWorkflowArtifact => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.run.updatedAt) - Date.parse(a.run.updatedAt);
    })
    .slice(0, limit);
}
