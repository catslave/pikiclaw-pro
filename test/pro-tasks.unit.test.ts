import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  addStageRun,
  finishVerificationRun,
  listProTasks,
  setExclusiveMode,
  startVerificationRun,
  syncJiraTask,
  updateStageRun,
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
});
