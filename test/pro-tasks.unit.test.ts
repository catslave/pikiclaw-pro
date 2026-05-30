import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createProTask,
  createTaskSpace,
  archiveTaskSpace,
  addStageRun,
  createSubtask,
  finishVerificationRun,
  getProTask,
  listProTasks,
  listTaskSpaces,
  setExclusiveMode,
  startVerificationRun,
  syncJiraTask,
  updateJiraFields,
  updateProTaskExecution,
  updateProTaskStatus,
  updateStageRun,
  updateSubtask,
} from '../src/pro/tasks.ts';

let tmpDir: string;
let previousTaskFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-tasks-');
  previousTaskFile = process.env.PIKICLAW_PRO_TASK_FILE;
  process.env.PIKICLAW_PRO_TASK_FILE = path.join(tmpDir, 'tasks.json');
});

afterEach(() => {
  if (previousTaskFile == null) delete process.env.PIKICLAW_PRO_TASK_FILE;
  else process.env.PIKICLAW_PRO_TASK_FILE = previousTaskFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Pro task spaces', () => {
  it('creates custom task spaces and archives them without removing built-ins', () => {
    const space = createTaskSpace({
      name: 'Pikiclaw Roadmap',
      defaultWorkdir: '/repo/pikiclaw',
      defaultAgent: 'codex',
      defaultAssistantId: 'assistant_hermes_acp',
    });

    expect(listTaskSpaces().map(item => item.id)).toEqual(['jira', 'personal', space.id]);
    expect(listTaskSpaces()[2]).toMatchObject({
      name: 'Pikiclaw Roadmap',
      kind: 'custom',
      defaultAgent: 'codex',
      defaultAssistantId: 'assistant_hermes_acp',
    });

    archiveTaskSpace(space.id);
    expect(listTaskSpaces().map(item => item.id)).toEqual(['jira', 'personal']);
  });

  it('assigns legacy/default task kinds to Jira or Personal spaces', () => {
    const jira = syncJiraTask({ title: 'Fix production bug', jiraKey: 'PRO-1', issueType: 'Bug' });
    const manual = createProTask({ title: 'Write roadmap note', kind: 'manual' });

    expect(jira.spaceId).toBe('jira');
    expect(jira.origin).toMatchObject({ type: 'jira', key: 'PRO-1' });
    expect(manual.spaceId).toBe('personal');
    expect(manual.origin).toMatchObject({ type: 'manual' });
    expect(listProTasks({ spaceId: 'jira' }).map(task => task.id)).toEqual([jira.id]);
    expect(listProTasks({ spaceId: 'personal' }).map(task => task.id)).toEqual([manual.id]);
  });

  it('creates tasks in a selected custom space', () => {
    const space = createTaskSpace({ name: 'Writing' });
    const task = createProTask({ title: 'Draft launch post', spaceId: space.id });

    expect(task.kind).toBe('manual');
    expect(task.spaceId).toBe(space.id);
    expect(listProTasks({ spaceId: space.id })).toHaveLength(1);
  });

  it('updates task assistant ownership without assigning an agent as owner', () => {
    const task = createProTask({ title: 'Assign ticket', defaultAgent: 'codex' });

    const assigned = updateProTaskExecution(task.id, {
      ownerMode: 'assistant',
      assistantId: 'assistant_refinement',
      defaultAssistantId: 'assistant_refinement',
      agent: null,
    });
    expect(assigned.defaultAgent).toBe('codex');
    expect(assigned.defaultAssistantId).toBe('assistant_refinement');
    expect(assigned.execution).toMatchObject({
      ownerMode: 'assistant',
      assistantId: 'assistant_refinement',
    });
    expect(assigned.execution?.agent).toBeUndefined();

    const cleared = updateProTaskExecution(task.id, {
      ownerMode: 'status',
      assistantId: null,
      defaultAssistantId: null,
      agent: null,
    });
    expect(cleared.defaultAssistantId).toBeUndefined();
    expect(cleared.execution?.assistantId).toBeUndefined();
    expect(cleared.execution?.agent).toBeUndefined();
  });

  it('links stage runs to subtasks', () => {
    const task = createProTask({ title: 'Large task' });
    const updated = getProTask(task.id);
    expect(updated).toBeTruthy();
    updated!.subTasks.push({
      id: 'subtask_1',
      taskId: task.id,
      title: 'Implement child stream',
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageRunIds: [],
    });
    fs.writeFileSync(process.env.PIKICLAW_PRO_TASK_FILE!, JSON.stringify({ version: 1, tasks: [updated] }, null, 2));

    const withRun = addStageRun({
      taskId: task.id,
      subtaskId: 'subtask_1',
      stage: 'coding',
      prompt: 'Do the child stream.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-1' },
    });

    expect(withRun.stageRuns[0]).toMatchObject({ subtaskId: 'subtask_1' });
    expect(withRun.subTasks[0].stageRunIds).toEqual([withRun.stageRuns[0].id]);
    expect(withRun.subTasks[0].status).toBe('running');
  });
});

describe('Pro task store', () => {
  it('upserts Jira tasks, records stage chat state, and links verification runs', () => {
    const created = syncJiraTask({
      title: 'Fix login redirect',
      description: 'Initial bug report',
      issueType: 'Bug',
      jiraKey: 'PRO-123',
      jiraUrl: 'https://jira.example/browse/PRO-123',
      sprint: 'Sprint 1',
      workdir: '/repo/app',
    });

    expect(created.kind).toBe('jira-bug');
    expect(created.status).toBe('backlog');
    expect(created.verificationRuns).toEqual([]);

    const synced = syncJiraTask({
      title: 'Fix login redirect',
      description: 'Updated bug report',
      issueType: 'Bug',
      jiraKey: 'PRO-123',
      sprint: 'Sprint 2',
      workdir: '/repo/app',
    });

    expect(synced.id).toBe(created.id);
    expect(synced.description).toBe('Updated bug report');
    expect(synced.sprint).toBe('Sprint 2');
    expect(synced.events[0].type).toBe('jira-updated');
    expect(listProTasks()).toHaveLength(1);

    const withFocus = addStageRun({
      taskId: synced.id,
      stage: 'focus',
      prompt: 'Clarify goal, boundary, and acceptance criteria.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-focus' },
      selectedAgentReason: 'Selected by test.',
    });
    const focusRun = withFocus.stageRuns[0];
    expect(focusRun.focus?.questions.map(question => question.topic)).toContain('acceptance');

    const completedFocus = updateStageRun(synced.id, focusRun.id, {
      status: 'completed',
      summary: 'Focus complete.',
      estimate: {
        estimatePoint: 2,
        codingMinutes: 40,
        userUnderstandingMinutes: 20,
        reviewMinutes: 10,
        verificationMinutes: 15,
        totalMinutes: 85,
        confidence: 'medium',
      },
    });
    expect(completedFocus.stageRuns[0].completedAt).toBeTruthy();
    expect(completedFocus.stageRuns[0].output?.estimate?.estimatePoint).toBe(2);
    expect(completedFocus.stageRuns[0].output?.estimate?.totalMinutes).toBe(85);

    const withSubtask = createSubtask(synced.id, {
      title: 'Update web app login guard',
      assignedAgent: 'codex',
      assistantId: 'assistant_coding',
      workdir: '/repo/app',
    });
    expect(withSubtask.subTasks).toHaveLength(1);
    expect(withSubtask.subTasks[0].status).toBe('todo');
    expect(withSubtask.events[0].type).toBe('subtask-created');

    const updatedSubtask = updateSubtask(synced.id, withSubtask.subTasks[0].id, {
      status: 'done',
      stageRunId: focusRun.id,
    });
    expect(updatedSubtask.subTasks[0].status).toBe('done');
    expect(updatedSubtask.subTasks[0].stageRunIds).toContain(focusRun.id);

    const coded = updateStageRun(synced.id, focusRun.id, {
      branch: 'feature/pro-123',
      diffSummary: 'Updated login redirect guard.',
      changedFiles: ['src/login.ts'],
      testResultId: 'vitest:passed',
    });
    expect(coded.stageRuns[0].output?.branch).toBe('feature/pro-123');
    expect(coded.stageRuns[0].output?.changedFiles).toEqual(['src/login.ts']);
    expect(coded.stageRuns[0].output?.testResultId).toBe('vitest:passed');

    expect(setExclusiveMode(synced.id, true).exclusiveMode).toBe(true);

    const verifying = startVerificationRun(synced.id, {
      environment: 'cnlab03',
      url: 'https://app.example/smoke',
      stageRunId: focusRun.id,
      pipeline: { provider: 'manual', status: 'unknown', branch: 'feature/pro-123' },
    });
    const verification = verifying.verificationRuns[0];
    expect(verification.browserSession?.profile).toBe('pikiclaw-managed');
    expect(verification.pipeline?.branch).toBe('feature/pro-123');
    expect(verifying.stageRuns[0].verificationRunId).toBe(verification.id);

    const finished = finishVerificationRun(synced.id, verification.id, 'passed', 'Smoke passed.');
    expect(finished.verificationRuns[0].result).toBe('passed');
    expect(finished.verificationRuns[0].notes).toBe('Smoke passed.');
  });

  it('can reopen a locally closed Jira task without a remote transition', () => {
    const closed = syncJiraTask({
      title: 'Closed production bug',
      issueType: 'Bug',
      jiraKey: 'PRO-456',
      ticketStatus: 'Closed',
      workdir: '/repo/app',
    });

    const done = updateProTaskStatus(closed.id, 'done');
    expect(done.status).toBe('done');
    expect(done.jiraFields?.status).toBe('Closed');

    const reopenedFields = updateJiraFields(done.id, { status: 'Reopened' });
    const reopened = updateProTaskStatus(reopenedFields.id, 'backlog');

    expect(reopened.status).toBe('backlog');
    expect(reopened.jiraFields?.status).toBe('Reopened');
    expect(reopened.events.some(event => event.summary.includes('Status changed from done to backlog'))).toBe(true);
  });
});
