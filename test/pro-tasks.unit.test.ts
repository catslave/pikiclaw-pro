import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  ANALYZE_TASK_SPACE_ID,
  confirmStageRunOutput,
  createProTask,
  createTaskSpace,
  archiveTaskSpace,
  addStageRun,
  findAnalyzeTaskByJiraKey,
  upsertAnalyzeTicketTask,
  createSubtask,
  finishVerificationRun,
  getProTask,
  listProTasks,
  listTaskSpaces,
  resetProTask,
  setExclusiveMode,
  startVerificationRun,
  syncJiraTask,
  updateJiraFields,
  updateProTaskExecution,
  updateTaskBackground,
  updateProTaskMeta,
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

    expect(listTaskSpaces().map(item => item.id)).toEqual(['jira', 'personal', ANALYZE_TASK_SPACE_ID, space.id]);
    expect(listTaskSpaces()[3]).toMatchObject({
      name: 'Pikiclaw Roadmap',
      kind: 'custom',
      defaultAgent: 'codex',
      defaultAssistantId: 'assistant_hermes_acp',
    });

    archiveTaskSpace(space.id);
    expect(listTaskSpaces().map(item => item.id)).toEqual(['jira', 'personal', ANALYZE_TASK_SPACE_ID]);
  });

  it('stores ticket analyze sessions in the dedicated analyze space', () => {
    const created = upsertAnalyzeTicketTask({
      title: 'IVAG-1177 handoff bug',
      jiraKey: 'IVAG-1177',
      jiraUrl: 'https://jira.ringcentral.com/browse/IVAG-1177',
      kind: 'jira-bug',
      workdir: '/repo/iva-ng',
    });
    expect(created.spaceId).toBe(ANALYZE_TASK_SPACE_ID);
    expect(created.origin).toMatchObject({ type: 'jira-analyze', key: 'IVAG-1177' });
    expect(created.status).toBe('refinement');

    const synced = syncJiraTask({ title: 'IVAG-1177 synced ticket', jiraKey: 'IVAG-1177', issueType: 'Bug' });
    expect(synced.spaceId).toBe('jira');
    expect(findAnalyzeTaskByJiraKey('IVAG-1177')?.id).toBe(created.id);

    const refreshed = upsertAnalyzeTicketTask({
      title: 'IVAG-1177 refreshed analysis',
      jiraKey: 'IVAG-1177',
      workdir: '/repo/iva-ng',
    });
    expect(refreshed.id).toBe(created.id);
    expect(refreshed.title).toBe('IVAG-1177 refreshed analysis');
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

  it('assigns global MY local keys to non-Jira tasks without consuming keys for Jira sync', () => {
    const first = createProTask({ title: 'Write roadmap note', kind: 'manual' });
    const jira = syncJiraTask({ title: 'Fix production bug', jiraKey: 'PRO-1', issueType: 'Bug' });
    const second = createProTask({ title: 'Review launch checklist', kind: 'manual' });

    expect(first.localKey).toBe('MY-0001');
    expect(jira.localKey).toBeUndefined();
    expect(second.localKey).toBe('MY-0002');
  });

  it('backfills MY local keys for existing non-Jira tasks when loading old task files', () => {
    const filePath = process.env.PIKICLAW_PRO_TASK_FILE!;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task_manual_old',
          title: 'Old manual task',
          kind: 'manual',
          status: 'backlog',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          stageRuns: [],
          verificationRuns: [],
          subTasks: [],
          events: [],
        },
        {
          id: 'task_jira_old',
          title: 'Old Jira task',
          kind: 'jira-ticket',
          status: 'backlog',
          jiraKey: 'PRO-9',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          stageRuns: [],
          verificationRuns: [],
          subTasks: [],
          events: [],
        },
      ],
    }));

    expect(listProTasks().map(task => ({ title: task.title, localKey: task.localKey }))).toEqual([
      { title: 'Old manual task', localKey: 'MY-0001' },
      { title: 'Old Jira task', localKey: undefined },
    ]);
    expect(createProTask({ title: 'New manual task' }).localKey).toBe('MY-0002');
  });

  it('creates tasks in a selected custom space', () => {
    const space = createTaskSpace({ name: 'Writing' });
    const task = createProTask({ title: 'Draft launch post', spaceId: space.id });

    expect(task.kind).toBe('manual');
    expect(task.spaceId).toBe(space.id);
    expect(listProTasks({ spaceId: space.id })).toHaveLength(1);
  });

  it('stores planned dates and filters tasks by day without changing space ownership', () => {
    const custom = createTaskSpace({ name: 'Ops' });
    const todayPersonal = createProTask({ title: 'Write standup note', plannedDate: '2026-06-01' });
    const todayCustom = createProTask({ title: 'Review deploy checklist', spaceId: custom.id, plannedDate: '2026-06-01' });
    const tomorrow = createProTask({ title: 'Prepare retro', plannedDate: '2026-06-02' });
    const unscheduled = createProTask({ title: 'Someday follow-up' });

    expect(todayPersonal.plannedDate).toBe('2026-06-01');
    expect(todayCustom.spaceId).toBe(custom.id);
    expect(listProTasks({ plannedDate: '2026-06-01' }).map(task => task.id)).toEqual([todayCustom.id, todayPersonal.id]);
    expect(listProTasks({ plannedDate: '2026-06-02' }).map(task => task.id)).toEqual([tomorrow.id]);
    expect(listProTasks({ spaceId: custom.id, plannedDate: '2026-06-01' }).map(task => task.id)).toEqual([todayCustom.id]);
    expect(listProTasks({ plannedDate: '2026-06-03' })).toEqual([]);
    expect(getProTask(unscheduled.id)?.plannedDate).toBeUndefined();
  });

  it('updates and clears planned dates through task metadata changes', () => {
    const task = createProTask({ title: 'Plan today', plannedDate: '2026-06-01' });

    const moved = updateProTaskMeta(task.id, { plannedDate: '2026-06-03' });
    expect(moved.plannedDate).toBe('2026-06-03');
    expect(listProTasks({ plannedDate: '2026-06-03' }).map(item => item.id)).toEqual([task.id]);

    const cleared = updateProTaskMeta(task.id, { plannedDate: null });
    expect(cleared.plannedDate).toBeUndefined();
    expect(listProTasks({ plannedDate: '2026-06-03' })).toEqual([]);
    expect(getProTask(task.id)?.plannedDate).toBeUndefined();
  });

  it('links a daily task to an existing Jira task through task metadata', () => {
    const jira = syncJiraTask({ title: 'Fix linked bug', jiraKey: 'PRO-77', issueType: 'Bug' });
    const daily = createProTask({ title: 'Investigate the bug today', plannedDate: '2026-06-01' });

    const linked = updateProTaskMeta(daily.id, { linkedTaskId: jira.id });
    expect(linked.linkedTaskId).toBe(jira.id);

    const unlinked = updateProTaskMeta(daily.id, { linkedTaskId: null });
    expect(unlinked.linkedTaskId).toBeUndefined();
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

  it('persists task runtime model and effort overrides', () => {
    const task = createProTask({ title: 'Pick runtime', defaultAgent: 'codex' });

    const updated = updateProTaskExecution(task.id, {
      ownerMode: 'agent',
      agent: 'cursor',
      model: 'claude-sonnet-4',
      effort: 'medium',
    });

    expect(updated.execution).toMatchObject({
      ownerMode: 'agent',
      agent: 'cursor',
      model: 'claude-sonnet-4',
      effort: 'medium',
    });
    expect(getProTask(task.id)?.execution).toMatchObject({
      agent: 'cursor',
      model: 'claude-sonnet-4',
      effort: 'medium',
    });
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

  it('keeps a short display prompt for button-triggered stage runs', () => {
    const task = createProTask({ title: 'Analyze ticket' });
    const withRun = addStageRun({
      taskId: task.id,
      stage: 'refinement',
      prompt: 'Raw ticket context and full background instructions.',
      displayPrompt: 'Start background',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-1' },
    });

    expect(withRun.stageRuns[0].prompt).toContain('Raw ticket context');
    expect(withRun.stageRuns[0].displayPrompt).toBe('Start background');
  });
});

describe('Pro task store', () => {
  it('upserts Jira tasks, records stage chat state, and links verification runs', () => {
    const created = syncJiraTask({
      title: 'Fix login redirect',
      description: 'Initial bug report\nReference MR: https://gitlab.example/group/app/-/merge_requests/105/diffs',
      issueType: 'Bug',
      jiraKey: 'PRO-123',
      jiraUrl: 'https://jira.example/browse/PRO-123',
      sprint: 'Sprint 1',
      workdir: '/repo/app',
    });

    expect(created.kind).toBe('jira-bug');
    expect(created.status).toBe('backlog');
    expect(created.jiraUrl).toBe('https://jira.example/browse/PRO-123');
    expect(created.prUrl).toBe('https://gitlab.example/group/app/-/merge_requests/105');
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
    expect(synced.jiraUrl).toBe('https://jira.example/browse/PRO-123');
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

  it('stores synced Jira status, fixVersions, sprint, and due date with local clear support', () => {
    const task = syncJiraTask({
      title: 'Ship release train ticket',
      issueType: 'Task',
      jiraKey: 'PRO-789',
      ticketStatus: 'In Progress',
      sprint: 'Sprint 8',
      dueDate: '2026-06-15',
      fixVersions: [{ name: '2026.06' }, 'Hotfix'],
      workdir: '/repo/app',
    });

    expect(task.jiraFields).toMatchObject({
      status: 'In Progress',
      dueDate: '2026-06-15',
      fixVersions: ['2026.06', 'Hotfix'],
    });
    expect(task.sprint).toBe('Sprint 8');
    expect(task.jiraUrl).toBe('https://jira.ringcentral.com/browse/PRO-789');
    expect(task.origin).toMatchObject({ type: 'jira', key: 'PRO-789', url: 'https://jira.ringcentral.com/browse/PRO-789' });

    const updated = syncJiraTask({
      title: 'Ship release train ticket',
      jiraKey: 'PRO-789',
      ticketStatus: 'Review',
      sprint: 'Sprint 9',
      dueDate: '2026-06-20',
      rawFields: { fixVersions: [{ name: '2026.07' }] },
    });

    expect(updated.jiraFields).toMatchObject({
      status: 'Review',
      dueDate: '2026-06-20',
      fixVersions: ['2026.07'],
    });
    expect(updated.sprint).toBe('Sprint 9');

    const cleared = updateJiraFields(updated.id, {
      sprint: '',
      dueDate: '',
      fixVersions: [],
    });
    expect(cleared.sprint).toBeUndefined();
    expect(cleared.jiraFields?.dueDate).toBeUndefined();
    expect(cleared.jiraFields?.fixVersions).toEqual([]);
    expect(cleared.jiraFields?.status).toBe('Review');
  });

  it('writes completed Jira stage summaries to the configured Obsidian-style output directory', () => {
    const previousOutputDir = process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR;
    const outputDir = path.join(tmpDir, 'obsidian', 'repo', 'pikiclaw', 'jira');
    process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR = outputDir;
    try {
      const task = syncJiraTask({
        title: 'Document stage output',
        issueType: 'Task',
        jiraKey: 'PRO-321',
        workdir: '/repo/app',
      });
      const withRun = addStageRun({
        taskId: task.id,
        stage: 'refinement',
        prompt: 'Clarify the task.',
        session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-stage-summary' },
      });
      const run = withRun.stageRuns[0];
      const completed = updateStageRun(task.id, run.id, {
        status: 'completed',
        summary: 'Clarified acceptance criteria and risk.',
      });
      expect(completed.outputs?.some(output => output.stageRunId === run.id)).toBe(false);

      const confirmed = confirmStageRunOutput(task.id, run.id);
      const output = confirmed.outputs?.[0];
      expect(output).toMatchObject({
        kind: 'stage-summary',
        title: 'Clarification document',
        summary: 'Clarified acceptance criteria and risk.',
      });
      expect(output?.path).toContain(path.join('PRO-321'));
      expect(path.basename(output!.path!)).toContain('refinement');
      expect(fs.existsSync(output!.path!)).toBe(true);
      expect(fs.readFileSync(output!.path!, 'utf8')).toContain('Clarified acceptance criteria and risk.');
    } finally {
      if (previousOutputDir == null) delete process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR;
      else process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR = previousOutputDir;
    }
  });

  it('labels explicit Jira background analysis as a ticket background report', () => {
    const task = syncJiraTask({
      title: 'Document background output',
      issueType: 'Task',
      jiraKey: 'PRO-322',
      workdir: '/repo/app',
    });
    const withRun = addStageRun({
      taskId: task.id,
      stage: 'refinement',
      prompt: '[pikiclaw-ticket-background] Analyze this ticket and create the durable Background document.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-background-summary' },
    });
    const run = withRun.stageRuns[0];
    const completed = updateStageRun(task.id, run.id, {
      status: 'completed',
      summary: 'Readable background analysis for the ticket.',
    });
    expect(completed.outputs?.some(output => output.stageRunId === run.id)).toBe(false);

    const confirmed = confirmStageRunOutput(task.id, run.id);
    expect(confirmed.outputs?.[0]).toMatchObject({
      kind: 'background',
      title: 'Ticket background report',
      summary: 'Readable background analysis for the ticket.',
    });
    expect(confirmed.events[0]).toMatchObject({ type: 'background-updated' });
  });

  it('creates and updates a persistent ticket background output for Jira tasks', () => {
    const previousOutputDir = process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR;
    const outputDir = path.join(tmpDir, 'obsidian', 'repo', 'pikiclaw', 'jira');
    process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR = outputDir;
    try {
      const task = syncJiraTask({
        title: 'Restore inference continuity',
        description: 'Carry the Nova conversation id across the NCA gRPC boundary.',
        issueType: 'Task',
        jiraKey: 'IVAS-7185',
        workdir: '/repo/app',
      });

      const background = task.outputs?.find(output => output.kind === 'background');
      expect(background).toMatchObject({
        title: 'Ticket background',
        pinned: true,
      });
      expect(background?.summary).toContain('我的理解');
      expect(background?.summary).toContain('Carry the Nova conversation id');
      expect(background?.path).toBe(path.join(outputDir, 'IVAS-7185', 'background.md'));
      expect(fs.existsSync(background!.path!)).toBe(true);

      const updated = updateTaskBackground(task.id, {
        summary: '# Revised Background\n\n这个 ticket 要我恢复 AIR session rebuild 后的推理连续性。',
      });
      const updatedBackground = updated.outputs?.find(output => output.kind === 'background');
      expect(updatedBackground?.summary).toContain('恢复 AIR session rebuild');
      expect(fs.readFileSync(updatedBackground!.path!, 'utf8')).toContain('恢复 AIR session rebuild');
      expect(updated.events[0]).toMatchObject({ type: 'background-updated' });
    } finally {
      if (previousOutputDir == null) delete process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR;
      else process.env.PIKICLAW_PRO_STAGE_OUTPUT_DIR = previousOutputDir;
    }
  });

  it('resets task progress while keeping ticket metadata', () => {
    const task = syncJiraTask({
      title: 'Resettable ticket',
      description: 'Original Jira description.',
      issueType: 'Task',
      jiraKey: 'PRO-555',
      jiraUrl: 'https://jira.example/browse/PRO-555',
      ticketStatus: 'Closed',
      workdir: '/repo/app',
      prUrl: 'https://gitlab.example/mr/1',
    });
    const withRun = addStageRun({
      taskId: task.id,
      stage: 'coding',
      prompt: 'Implement it.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-reset' },
    });
    updateStageRun(task.id, withRun.stageRuns[0].id, {
      status: 'completed',
      summary: 'Implemented.',
      changedFiles: ['src/app.ts'],
    });
    createSubtask(task.id, { title: 'Child work' });
    const verifying = startVerificationRun(task.id, { environment: 'lab', url: 'https://lab.example' });
    finishVerificationRun(task.id, verifying.verificationRuns[0].id, 'passed');
    updateProTaskStatus(task.id, 'resolved');

    const reset = resetProTask(task.id);

    expect(reset).toMatchObject({
      id: task.id,
      title: 'Resettable ticket',
      description: 'Original Jira description.',
      status: 'backlog',
      jiraKey: 'PRO-555',
      jiraUrl: 'https://jira.example/browse/PRO-555',
      workdir: '/repo/app',
    });
    expect(reset.prUrl).toBeUndefined();
    expect(reset.jiraFields?.status).toBe('Reopened');
    expect(reset.stageRuns).toEqual([]);
    expect(reset.outputs).toEqual([]);
    expect(reset.subTasks).toEqual([]);
    expect(reset.verificationRuns).toEqual([]);
    expect(reset.focusSessions).toEqual([]);
    expect(reset.events[0]).toMatchObject({
      type: 'task-reset',
      summary: 'Task status and generated progress were reset.',
    });
    expect(reset.events.some(event => event.type === 'background-updated')).toBe(false);

    const listed = listProTasks().find(item => item.id === task.id);
    expect(listed?.outputs?.find(output => output.kind === 'background')).toBeUndefined();
    expect(listed?.events.some(event => event.type === 'background-updated' && event.actor !== 'system')).toBe(false);
  });

  it('marks a linked Jira task done when a daily task is completed', () => {
    const jira = syncJiraTask({
      title: 'Ship the linked fix',
      issueType: 'Task',
      jiraKey: 'PRO-901',
      ticketStatus: 'In Progress',
      workdir: '/repo/app',
    });
    const daily = createProTask({
      title: 'Finish today work item',
      plannedDate: '2026-06-01',
      linkedTaskId: jira.id,
    });

    const done = updateProTaskStatus(daily.id, 'done');
    const linked = getProTask(jira.id);

    expect(done.status).toBe('done');
    expect(linked?.status).toBe('done');
    expect(linked?.jiraFields?.status).toBe('Done');
    expect(linked?.events.some(event => event.summary.includes('linked Daily task'))).toBe(true);
  });

  it('creates Daily-specific outputs for clarify, working, and review stages', () => {
    const daily = createProTask({
      title: 'Tighten the Daily flow',
      plannedDate: '2026-06-01',
      workdir: '/repo/app',
    });

    const refinement = addStageRun({
      taskId: daily.id,
      stage: 'refinement',
      prompt: 'Clarify the goal.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-refinement' },
    });
    const refinementRun = refinement.stageRuns[0];
    const afterRefinement = updateStageRun(daily.id, refinementRun.id, {
      status: 'completed',
      summary: 'Clarified the objective and linked acceptance criteria.',
    });

    expect(afterRefinement.outputs).toEqual([]);
    const confirmedRefinement = confirmStageRunOutput(daily.id, refinementRun.id);
    expect(confirmedRefinement.outputs?.[0]).toMatchObject({
      title: 'Goal',
      summary: 'Clarified the objective and linked acceptance criteria.',
    });

    const coding = addStageRun({
      taskId: daily.id,
      stage: 'coding',
      prompt: 'Do the work.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-coding' },
    });
    const codingRun = coding.stageRuns[0];
    const afterCoding = updateStageRun(daily.id, codingRun.id, {
      status: 'completed',
      summary: 'Implemented the changes and captured the result.',
    });

    expect(afterCoding.outputs).toHaveLength(1);
    const confirmedCoding = confirmStageRunOutput(daily.id, codingRun.id);
    expect(confirmedCoding.outputs?.[0]).toMatchObject({
      title: 'Working output',
      summary: 'Implemented the changes and captured the result.',
    });

    const review = addStageRun({
      taskId: daily.id,
      stage: 'verification',
      prompt: 'Review the result.',
      session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session-review' },
    });
    const reviewRun = review.stageRuns[0];
    const afterReview = updateStageRun(daily.id, reviewRun.id, {
      status: 'completed',
      summary: 'Reviewed the implementation against the goal.',
    });

    expect(afterReview.outputs).toHaveLength(2);
    const confirmedReview = confirmStageRunOutput(daily.id, reviewRun.id);
    expect(confirmedReview.outputs?.[0]).toMatchObject({
      title: 'Review result',
      summary: 'Reviewed the implementation against the goal.',
    });
  });
});
