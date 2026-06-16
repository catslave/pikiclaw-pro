import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createAgentAssistant,
  createAutomationRule,
  createCustomWorkflowRecipe,
  createJiraSyncRun,
  createJiraRemoteUpdateRun,
  applyJiraSyncRunItems,
  cancelJiraRemoteUpdateRun,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getAssistantPrompt,
  ingestWorkflowRunMarkersFromMessages,
  reconcileWorkflowRunMarkersFromMessages,
  getJiraRemoteUpdateRun,
  getJiraSyncRun,
  listAgentAssistants,
  listCustomWorkflowRecipes,
  listJiraRemoteUpdateRuns,
  listAutomationRules,
  listWorkflowRuns,
  findAutomationRuleByRunRef,
  listKnowledgeEntries,
  markStalledWorkflowRunAutonomousWorkers,
  markAutomationMissedRun,
  markAutomationRun,
  answerWorkflowRunAsk,
  recordWorkflowRunAsk,
  recordWorkflowRun,
  recordWorkflowRunStepAutonomousDispatch,
  recordJiraSyncCandidates,
  resetAgentAssistantPrompt,
  stopJiraSyncRun,
  updateAgentAssistantPrompt,
  updateAutomationRule,
  updateCustomWorkflowRecipe,
  completeWorkflowRunStepAutonomous,
  findWorkflowRunByAutonomousRunRef,
  updateWorkflowRunAskDelivery,
  updateKnowledgeEntry,
  updateJiraRemoteUpdateRun,
  updateJiraSyncRun,
  deleteAutomationRule,
  deleteCustomWorkflowRecipe,
  deleteWorkflowRun,
} from '../src/pro/workflow.ts';
import { listProTasks } from '../src/pro/tasks.ts';
import { DAILY_ASSISTANT_ID } from '../src/pro/assistant-defaults.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;
let previousTaskFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-workflow-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  previousTaskFile = process.env.PIKICLAW_PRO_TASK_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
  process.env.PIKICLAW_PRO_TASK_FILE = path.join(tmpDir, 'tasks.json');
});

afterEach(() => {
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
  if (previousTaskFile == null) delete process.env.PIKICLAW_PRO_TASK_FILE;
  else process.env.PIKICLAW_PRO_TASK_FILE = previousTaskFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Pro workflow store', () => {
  it('exposes assistant-owned menu defaults and prompt management', () => {
    const assistants = listAgentAssistants();
    const ownerSurfaceIds = assistants
      .filter(item => item.kind === 'page-owner')
      .map(item => item.surfaceId)
      .sort();
    expect(ownerSurfaceIds).toEqual(['agents', 'dashboard', 'extensions', 'mcp', 'skills']);
    expect(ownerSurfaceIds).not.toContain('usage');
    expect(ownerSurfaceIds).not.toContain('system');
    expect(assistants).toContainEqual(expect.objectContaining({
      id: 'assistant_hermes_acp',
      name: 'Hermes ACP Assistant',
      preferredAgents: ['hermes'],
      labels: expect.arrayContaining(['builtin', 'task']),
    }));
    expect(assistants.find(item => item.id === 'assistant_dashboard_owner')?.labels).toEqual(expect.arrayContaining(['builtin', 'page-owner']));
    expect(assistants.find(item => item.id === 'assistant_refinement')?.labels).toEqual(expect.arrayContaining(['builtin', 'task']));
    expect(assistants.find(item => item.id === DAILY_ASSISTANT_ID)).toMatchObject({
      name: 'Daily Assistant',
      kind: 'task-stage',
      surfaceId: 'daily',
      preferredAgents: ['codex'],
      labels: expect.arrayContaining(['builtin', 'task', 'daily']),
    });
    const hermesAssistant = assistants.find(item => item.id === 'assistant_hermes_acp');
    expect(hermesAssistant?.responsibility).toContain('planning assistant');
    expect(hermesAssistant?.prompt).toContain('Goal & Plan');
    expect(hermesAssistant?.prompt).toContain('Do not modify repository files');

    const promptInfo = getAssistantPrompt('assistant_dashboard_owner');
    expect(promptInfo.prompt).toContain('backlog -> refinement -> working -> done');
    expect(promptInfo.customized).toBe(false);

    const updated = updateAgentAssistantPrompt('assistant_dashboard_owner', { prompt: 'custom dashboard prompt' });
    expect(updated.prompt).toBe('custom dashboard prompt');
    expect(getAssistantPrompt('assistant_dashboard_owner').customized).toBe(true);

    const reset = resetAgentAssistantPrompt('assistant_dashboard_owner');
    expect(reset.prompt).toBe(reset.defaultPrompt);
    expect(getAssistantPrompt('assistant_dashboard_owner').customized).toBe(false);
  });

  it('persists assistants, automations, and knowledge entries', () => {
    const assistant = createAgentAssistant({
      name: 'Bug refinery',
      responsibility: 'Analyze bugs and estimate user understanding time.',
      preferredAgents: ['codex', 'claude'],
      labels: ['task'],
    });
    expect(listAgentAssistants().find(item => item.id === assistant.id)?.labels).toEqual(['task']);

    const automation = createAutomationRule({
      name: 'Daily Jira sync',
      schedule: '09:00',
      prompt: 'Sync assigned tickets and summarize changes.',
      workdir: '/repo/app',
    });
    const ran = markAutomationRun(automation.id, 'codex:session-1');
    expect(ran.lastSessionKey).toBe('codex:session-1');
    expect(listAutomationRules()[0].lastRunAt).toBeTruthy();

    const entry = createKnowledgeEntry({
      title: 'Refinement point',
      body: 'Point means user understanding and validation effort.',
      tags: ['jira', 'estimate'],
    });
    expect(listKnowledgeEntries()[0]).toMatchObject({
      id: entry.id,
      kind: 'knowledge-card',
      status: 'published',
      createdBy: 'manual',
      confidence: 'medium',
      tags: ['jira', 'estimate'],
    });
  });

  it('updates and deletes automation rules', () => {
    const automation = createAutomationRule({
      name: 'Daily project review',
      schedule: 'daily@09:00',
      prompt: 'Summarize project status.',
      workdir: '/repo/app',
      agent: 'codex',
      enabled: true,
      includeProjectReferences: true,
      projectReferenceNames: ['rules.md', '../bad.md', 'memory.md', 'rules.md'],
    });
    expect(automation.includeProjectReferences).toBe(true);
    expect(automation.projectReferenceNames).toEqual(['rules.md', 'memory.md']);
    const paused = updateAutomationRule(automation.id, { enabled: false });
    expect(paused.enabled).toBe(false);
    expect(paused.schedule).toBe('daily@09:00');

    const updated = updateAutomationRule(automation.id, {
      name: 'Weekly project review',
      schedule: 'weekly@1@10:30',
      enabled: true,
      includeProjectReferences: false,
      projectReferenceNames: ['memory.md'],
    });
    expect(updated).toMatchObject({
      id: automation.id,
      name: 'Weekly project review',
      schedule: 'weekly@1@10:30',
      enabled: true,
      includeProjectReferences: false,
      projectReferenceNames: ['memory.md'],
      prompt: 'Summarize project status.',
      workdir: '/repo/app',
      agent: 'codex',
    });

    markAutomationRun(automation.id, 'codex:session-2', { taskId: 'task-session-2' });
    const removed = deleteAutomationRule(automation.id);
    expect(removed.runHistory?.[0]).toMatchObject({ taskId: 'task-session-2', sessionKey: 'codex:session-2', status: 'queued' });
    expect(listAutomationRules().find(item => item.id === automation.id)).toBeUndefined();
  });

  it('finds an automation by run task id or session key', () => {
    const automation = createAutomationRule({
      name: 'Completion-linked review',
      schedule: 'daily@09:00',
      prompt: 'Summarize project status.',
      workdir: '/repo/app',
      agent: 'codex',
    });
    markAutomationRun(automation.id, 'codex:pending_review', { taskId: 'task-review' });

    expect(findAutomationRuleByRunRef({ taskId: 'task-review' })?.id).toBe(automation.id);
    expect(findAutomationRuleByRunRef({ sessionKey: 'codex:pending_review' })?.id).toBe(automation.id);
    expect(findAutomationRuleByRunRef({ taskId: 'missing' })).toBeNull();
  });

  it('records automation run failure reasons', () => {
    const automation = createAutomationRule({
      name: 'Guarded daily review',
      schedule: 'daily@09:00',
      prompt: 'Summarize project status.',
      workdir: '/repo/app',
      agent: 'codex',
    });

    const failed = markAutomationRun(automation.id, undefined, {
      error: 'Codex token budget is over limit.',
      code: 'usage_budget_paused',
      budgetId: 'budget_codex',
      budgetName: 'Codex daily budget',
    });

    expect(failed.runHistory?.[0]).toMatchObject({
      status: 'failed',
      error: 'Codex token budget is over limit.',
      code: 'usage_budget_paused',
      budgetId: 'budget_codex',
      budgetName: 'Codex daily budget',
    });
  });

  it('records missed automation runs without duplicating the same scheduled slot', () => {
    const automation = createAutomationRule({
      name: 'Daily review while app was closed',
      schedule: 'daily@09:00',
      prompt: 'Summarize project status.',
      workdir: '/repo/app',
      agent: 'codex',
    });

    const missed = markAutomationMissedRun(automation.id, '2026-06-14T09:00:00.000Z', {
      error: 'Scheduled task missed its run window.',
    });
    const duplicate = markAutomationMissedRun(automation.id, '2026-06-14T09:00:00.000Z', {
      error: 'Duplicate missed window.',
    });

    expect(missed.lastRunAt).toBeUndefined();
    expect(duplicate.runHistory?.filter(item => item.status === 'missed')).toHaveLength(1);
    expect(duplicate.runHistory?.[0]).toMatchObject({
      status: 'missed',
      scheduledFor: '2026-06-14T09:00:00.000Z',
      error: 'Scheduled task missed its run window.',
    });
  });

  it('persists custom workflow recipes', () => {
    const recipe = createCustomWorkflowRecipe({
      name: 'Weekly Release Review',
      description: 'Collect release evidence and recommend whether the build is ready.',
      category: 'Release',
      tags: ['release', 'review'],
      outputs: ['verification summary', 'risk list'],
      steps: ['Confirm the target build', 'Run checks', 'Summarize evidence'],
      capabilities: ['Build scripts', 'Browser smoke'],
      promptHint: 'Stay evidence-backed and preserve unrelated WIP.',
      cadence: 'Before shipping',
      defaultEffort: 'high',
    });

    expect(recipe).toMatchObject({
      id: 'workflow_weekly-release-review',
      builtIn: false,
      category: 'Release',
      defaultEffort: 'high',
      outputs: ['verification summary', 'risk list'],
    });
    expect(listCustomWorkflowRecipes()[0]).toMatchObject({ id: recipe.id, name: 'Weekly Release Review' });

    const updated = updateCustomWorkflowRecipe(recipe.id, {
      name: 'Release Gate',
      steps: ['Inspect diff', 'Run targeted tests'],
      outputs: ['ship recommendation'],
      defaultEffort: 'low',
    });
    expect(updated).toMatchObject({
      id: recipe.id,
      name: 'Release Gate',
      description: 'Collect release evidence and recommend whether the build is ready.',
      steps: ['Inspect diff', 'Run targeted tests'],
      outputs: ['ship recommendation'],
      defaultEffort: 'low',
    });

    const removed = deleteCustomWorkflowRecipe(recipe.id);
    expect(removed.id).toBe(recipe.id);
    expect(listCustomWorkflowRecipes()).toEqual([]);
  });

  it('records resumable workflow runs keyed by chat session', () => {
    const recipe = createCustomWorkflowRecipe({
      name: 'Bug Triage',
      description: 'Analyze a bug report and prepare the next action.',
      steps: ['Read the report', 'Inspect evidence', 'Recommend action'],
      outputs: ['triage summary'],
    });

    const run = recordWorkflowRun({
      workflowId: recipe.id,
      workflowName: recipe.name,
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-1',
      sessionKey: 'codex:session-1',
      effort: 'high',
      steps: recipe.steps,
      status: 'running',
    });

    expect(run).toMatchObject({
      workflowId: recipe.id,
      workflowName: 'Bug Triage',
      sessionKey: 'codex:session-1',
      currentStep: 1,
      totalSteps: 3,
      status: 'running',
    });
    expect(run.steps.map(step => step.status)).toEqual(['now', 'todo', 'todo']);

    const blocked = recordWorkflowRun({
      sessionKey: 'codex:session-1',
      currentStep: 2,
      totalSteps: 3,
      status: 'blocked',
      lastMarker: 'Workflow progress: Step 2/3 - Inspect evidence - blocked',
    });
    expect(blocked.id).toBe(run.id);
    expect(blocked.steps.map(step => step.status)).toEqual(['done', 'blocked', 'todo']);
    expect(listWorkflowRuns({ activeOnly: true })).toHaveLength(1);

    const jumped = recordWorkflowRun({
      id: run.id,
      currentStep: 3,
      totalSteps: 3,
      status: 'running',
    });
    expect(jumped.sessionKey).toBe('codex:session-1');
    expect(jumped.sessionId).toBe('session-1');
    expect(jumped.steps.map(step => step.status)).toEqual(['done', 'done', 'now']);

    const done = recordWorkflowRun({
      sessionKey: 'codex:session-1',
      status: 'done',
    });
    expect(done.id).toBe(run.id);
    expect(done.currentStep).toBe(3);
    expect(done.steps.map(step => step.status)).toEqual(['done', 'done', 'done']);
    expect(done.completedAt).toBeTruthy();
    expect(listWorkflowRuns({ activeOnly: true })).toHaveLength(0);

    const removed = deleteWorkflowRun(run.id);
    expect(removed.id).toBe(run.id);
    expect(listWorkflowRuns()).toHaveLength(0);
  });

  it('tracks autonomous workflow step dispatch and completion by child task', () => {
    const run = recordWorkflowRun({
      workflowId: 'repo-audit',
      workflowName: 'Repository Audit',
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'parent-session',
      steps: ['Scope', 'Inspect', 'Write'],
      status: 'running',
    });

    const dispatched = recordWorkflowRunStepAutonomousDispatch(run.id, 2, {
      dispatchId: 'dispatch-1',
      childAgent: 'codex',
      childSessionId: 'child-session',
      childSessionKey: 'codex:child-session',
      taskId: 'task-child',
    });

    expect(dispatched.run).toMatchObject({
      id: run.id,
      currentStep: 2,
      status: 'running',
    });
    expect(dispatched.step).toMatchObject({
      index: 2,
      status: 'now',
      autonomousRun: {
        dispatchId: 'dispatch-1',
        state: 'running',
        childSessionKey: 'codex:child-session',
        taskId: 'task-child',
      },
    });
    expect(() => recordWorkflowRunStepAutonomousDispatch(run.id, 2, {
      dispatchId: 'dispatch-2',
      childSessionKey: 'codex:other-child',
    })).toThrow(/running autonomous worker/);
    expect(findWorkflowRunByAutonomousRunRef({ taskId: 'task-child' })?.run.id).toBe(run.id);
    expect(findWorkflowRunByAutonomousRunRef({ sessionKey: 'codex:child-session' })?.step.index).toBe(2);

    const completed = completeWorkflowRunStepAutonomous(run.id, 2, {
      state: 'done',
      taskId: 'task-child',
      childSessionKey: 'codex:child-session',
    });
    expect(completed.step).toMatchObject({
      index: 2,
      status: 'done',
      autonomousRun: {
        dispatchId: 'dispatch-1',
        state: 'done',
        childSessionKey: 'codex:child-session',
        taskId: 'task-child',
      },
    });
    expect(completed.step.autonomousRun?.completedAt).toBeTruthy();
    expect(completed.run.currentStep).toBe(3);
    expect(completed.run.status).toBe('running');

    const retried = recordWorkflowRunStepAutonomousDispatch(run.id, 3, {
      dispatchId: 'dispatch-3',
      childSessionKey: 'codex:child-3',
      taskId: 'task-child-3',
    });
    const failed = completeWorkflowRunStepAutonomous(retried.run.id, 3, {
      state: 'failed',
      taskId: 'task-child-3',
      childSessionKey: 'codex:child-3',
      error: 'worker crashed',
    });
    expect(failed.run.status).toBe('blocked');
    expect(failed.step).toMatchObject({
      index: 3,
      status: 'blocked',
      autonomousRun: {
        state: 'failed',
        error: 'worker crashed',
      },
    });
  });

  it('marks stalled autonomous workflow workers and allows retry', () => {
    const run = recordWorkflowRun({
      workflowId: 'repo-audit',
      workflowName: 'Repository Audit',
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'parent-session',
      steps: ['Scope', 'Inspect', 'Write'],
      status: 'running',
    });

    const staleStartedAt = '2026-06-13T08:00:00.000Z';
    recordWorkflowRunStepAutonomousDispatch(run.id, 2, {
      dispatchId: 'dispatch-stale',
      childSessionKey: 'codex:stale-child',
      taskId: 'task-stale',
      startedAt: staleStartedAt,
    });

    const freshRun = recordWorkflowRun({
      workflowId: 'fresh-audit',
      workflowName: 'Fresh Audit',
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'fresh-parent-session',
      steps: ['Scope', 'Inspect'],
      status: 'running',
    });
    const fresh = recordWorkflowRunStepAutonomousDispatch(freshRun.id, 1, {
      dispatchId: 'dispatch-fresh',
      childSessionKey: 'codex:fresh-child',
      taskId: 'task-fresh',
    });

    const result = markStalledWorkflowRunAutonomousWorkers({
      now: '2026-06-13T09:10:00.000Z',
      timeoutMs: 60 * 60 * 1000,
    });

    expect(result.scannedWorkers).toBe(2);
    expect(result.stalled).toHaveLength(1);
    expect(result.stalled[0].run.id).toBe(run.id);
    expect(result.stalled[0].run.status).toBe('blocked');
    expect(result.stalled[0].step).toMatchObject({
      index: 2,
      status: 'blocked',
      autonomousRun: {
        state: 'stalled',
        error: expect.stringContaining('70 minutes'),
      },
    });
    expect(findWorkflowRunByAutonomousRunRef({ taskId: 'task-fresh' })?.step.autonomousRun?.state).toBe('running');

    const retry = recordWorkflowRunStepAutonomousDispatch(run.id, 2, {
      childSessionKey: 'codex:retry-child',
      taskId: 'task-retry',
    });
    expect(retry.step.autonomousRun).toMatchObject({
      state: 'running',
      childSessionKey: 'codex:retry-child',
      taskId: 'task-retry',
    });
    expect(retry.step.autonomousRun?.dispatchId).not.toBe('dispatch-stale');
    expect(retry.step.autonomousRun?.startedAt).not.toBe(staleStartedAt);
    expect(fresh.step.autonomousRun?.state).toBe('running');
  });

  it('records and answers workflow asks on a resumable run', () => {
    const run = recordWorkflowRun({
      workflowId: 'repo-audit',
      workflowName: 'Repository Audit',
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-ask',
      steps: ['Scope', 'Inspect', 'Write'],
      status: 'running',
    });

    const asked = recordWorkflowRunAsk(run.id, {
      id: 'ask-risk',
      stepIndex: 2,
      question: 'Which risk should I prioritize?',
      type: 'choice',
      options: ['data loss', 'latency'],
      placeholder: 'Pick one',
    });

    expect(asked.run.status).toBe('blocked');
    expect(asked.run.currentStep).toBe(2);
    expect(asked.ask).toMatchObject({
      id: 'ask-risk',
      stepIndex: 2,
      question: 'Which risk should I prioritize?',
      type: 'choice',
      options: ['data loss', 'latency'],
      status: 'pending',
    });
    expect(asked.run.steps.map(step => step.status)).toEqual(['done', 'blocked', 'todo']);

    const answered = answerWorkflowRunAsk(run.id, asked.ask.id, { answer: 'latency' });
    expect(answered.ask).toMatchObject({
      id: 'ask-risk',
      answer: 'latency',
      status: 'answered',
      deliveryStatus: 'sending',
    });
    expect(answered.run.status).toBe('blocked');
    expect(answered.run.currentStep).toBe(2);
    expect(answered.run.asks).toHaveLength(1);
    expect(answered.run.asks[0].answeredAt).toBeTruthy();
    expect(listWorkflowRuns()[0].asks[0].answer).toBe('latency');

    const failed = updateWorkflowRunAskDelivery(run.id, asked.ask.id, { deliveryStatus: 'failed', error: 'network down' });
    expect(failed.ask).toMatchObject({
      id: 'ask-risk',
      deliveryStatus: 'failed',
      deliveryError: 'network down',
    });
    expect(failed.run.status).toBe('blocked');

    const delivered = updateWorkflowRunAskDelivery(run.id, asked.ask.id, { deliveryStatus: 'sent', taskId: 'task-123' });
    expect(delivered.ask).toMatchObject({
      id: 'ask-risk',
      deliveryStatus: 'sent',
      deliveryTaskId: 'task-123',
    });
    expect(delivered.ask.deliveredAt).toBeTruthy();
    expect(delivered.run.status).toBe('running');
  });

  it('ingests workflow ask markers from chat messages without reopening answered asks', () => {
    const assistantText = [
      'Workflow progress: Investigation | step 2/4 | status blocked | waiting for your choice',
      '',
      'The workflow needs a product decision.',
      '<ask type="choice" options="ask cards, persistence" placeholder="Pick one">Which gap next?</ask>',
    ].join('\n');

    const ingested = ingestWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-marker',
      messages: [
        { role: 'user', text: 'Continue the migration' },
        {
          role: 'assistant',
          text: assistantText,
          blocks: [{ type: 'text', content: assistantText, phase: 'final_answer' }],
        },
      ],
    });

    expect(ingested).toMatchObject({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-marker',
      sessionKey: 'codex:session-marker',
      currentStep: 2,
      totalSteps: 4,
      workflowName: 'Investigation',
      status: 'blocked',
    });
    expect(ingested?.asks).toHaveLength(1);
    expect(ingested?.asks[0]).toMatchObject({
      stepIndex: 2,
      question: 'Which gap next?',
      type: 'choice',
      options: ['ask cards', 'persistence'],
      status: 'pending',
    });

    const again = ingestWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-marker',
      messages: [{ role: 'assistant', text: assistantText }],
    });
    expect(again?.id).toBe(ingested?.id);
    expect(again?.asks).toHaveLength(1);

    const askId = ingested!.asks[0].id;
    const answered = answerWorkflowRunAsk(ingested!.id, askId, { answer: 'persistence' });
    expect(answered.run.status).toBe('blocked');

    const delivered = updateWorkflowRunAskDelivery(ingested!.id, askId, { deliveryStatus: 'sent', taskId: 'task-marker' });
    expect(delivered.run.status).toBe('running');

    const afterAnswerReload = ingestWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-marker',
      messages: [{ role: 'assistant', text: assistantText }],
    });
    expect(afterAnswerReload?.status).toBe('running');
    expect(afterAnswerReload?.asks).toHaveLength(1);
    expect(afterAnswerReload?.asks[0]).toMatchObject({
      id: askId,
      answer: 'persistence',
      status: 'answered',
    });
  });

  it('ingests escaped ask markers and ignores inline-code examples', () => {
    const assistantText = [
      'Workflow progress: Parser hardening | step 2/3 | status blocked',
      'Document this syntax as `<ask type="text">Do not persist me</ask>` before continuing.',
      '&lt;ask type=&quot;choice&quot; options=&quot;Memory, Workflows&quot; placeholder=&quot;Pick one&quot;&gt;Which surface should receive the next pass?&lt;/ask&gt;',
    ].join('\n');

    const ingested = ingestWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-escaped-marker',
      messages: [{ role: 'assistant', text: assistantText }],
    });

    expect(ingested).toMatchObject({
      workflowName: 'Parser hardening',
      currentStep: 2,
      totalSteps: 3,
      status: 'blocked',
    });
    expect(ingested?.asks).toHaveLength(1);
    expect(ingested?.asks[0]).toMatchObject({
      stepIndex: 2,
      question: 'Which surface should receive the next pass?',
      type: 'choice',
      options: ['Memory', 'Workflows'],
      placeholder: 'Pick one',
      status: 'pending',
    });
  });

  it('reconciles workflow markers from older transcript messages', () => {
    const markerText = [
      'Workflow progress: Migration audit | step 3/6 | status blocked | old decision needed',
      '<ask type="text" placeholder="Add the missing module">What should we migrate next?</ask>',
    ].join('\n');
    const transcript = [
      { role: 'user' as const, text: 'Start the migration' },
      { role: 'assistant' as const, text: markerText },
      { role: 'user' as const, text: 'Keep going' },
      { role: 'assistant' as const, text: 'Continuing without a visible marker in the latest window.' },
      { role: 'user' as const, text: 'Show current status' },
      { role: 'assistant' as const, text: 'No marker here either.' },
    ];

    const latestOnly = ingestWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-reconcile',
      messages: transcript.slice(-2),
    });
    expect(latestOnly).toBeNull();

    const reconciled = reconcileWorkflowRunMarkersFromMessages({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-reconcile',
      messages: transcript,
    });

    expect(reconciled).toMatchObject({
      scannedMessages: 6,
      scannedAssistantMessages: 3,
      markerMessages: 1,
      progressMarkers: 1,
      askMarkers: 1,
    });
    expect(reconciled.run).toMatchObject({
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 'session-reconcile',
      currentStep: 3,
      totalSteps: 6,
      workflowName: 'Migration audit',
      status: 'blocked',
    });
    expect(reconciled.run?.asks[0]).toMatchObject({
      question: 'What should we migrate next?',
      stepIndex: 3,
      status: 'pending',
    });
  });

  it('normalizes legacy and new knowledge entries and supports hide/update', () => {
    fs.writeFileSync(process.env.PIKICLAW_PRO_WORKFLOW_FILE!, JSON.stringify({
      version: 1,
      assistants: [],
      automations: [],
      knowledge: [
        {
          id: 'legacy_1',
          title: 'Legacy chat note',
          body: 'Old shape',
          source: { type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' },
          tags: ['legacy'],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'new_1',
          title: 'Digest',
          body: 'New shape',
          kind: 'session-digest',
          status: 'hidden',
          summary: 'Digest summary',
          sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's2' }],
          artifactRefs: [{ kind: 'document', outputId: 'out1', path: '/repo/app/out.md' }],
          confidence: 'high',
          createdBy: 'agent',
          tags: ['digest'],
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    }, null, 2));

    const legacy = listKnowledgeEntries({ status: 'published' }).find(entry => entry.id === 'legacy_1');
    expect(legacy).toMatchObject({
      kind: 'knowledge-card',
      status: 'published',
      createdBy: 'manual',
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
    });
    expect(listKnowledgeEntries({ status: 'hidden' })[0]).toMatchObject({ id: 'new_1', confidence: 'high' });

    const updated = updateKnowledgeEntry('legacy_1', { summary: 'Better summary', tags: ['focus'], status: 'hidden' });
    expect(updated).toMatchObject({ summary: 'Better summary', tags: ['focus'], status: 'hidden' });

    const hidden = deleteKnowledgeEntry('new_1');
    expect(hidden?.status).toBe('hidden');
  });

  it('persists Jira sync run status and analysis summary', () => {
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });
    const updated = updateJiraSyncRun(run.id, {
      status: 'completed',
      ticketCount: 2,
      taskCount: 2,
      issueKeys: ['PRO-1', 'PRO-2'],
      analysisSummary: 'Synced 2 tickets: one bug and one task.',
      changes: [
        { jiraKey: 'PRO-1', title: 'New task', action: 'created', summary: 'Jira issue PRO-1 synced.' },
        { jiraKey: 'PRO-2', title: 'Existing bug', action: 'updated', summary: 'Jira issue PRO-2 updated: priority.' },
      ],
      event: { label: 'Synced 2 Pikiclaw tasks', detail: 'created=1, updated=1' },
    });

    expect(updated.completedAt).toBeTruthy();
    expect(getJiraSyncRun(run.id)).toMatchObject({
      status: 'completed',
      ticketCount: 2,
      taskCount: 2,
      issueKeys: ['PRO-1', 'PRO-2'],
      analysisSummary: 'Synced 2 tickets: one bug and one task.',
      changes: [
        { jiraKey: 'PRO-1', title: 'New task', action: 'created', summary: 'Jira issue PRO-1 synced.' },
        { jiraKey: 'PRO-2', title: 'Existing bug', action: 'updated', summary: 'Jira issue PRO-2 updated: priority.' },
      ],
    });
  });

  it('records Jira sync candidates while excluding closed and cancelled tickets', () => {
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });

    const updated = recordJiraSyncCandidates(run.id, [
      {
        jiraKey: 'PRO-1',
        summary: 'Current sprint task',
        description: 'Implement active work.',
        issueType: 'Task',
        customfield_10652: {
          value: [
            'com.atlassian.greenhopper.service.sprint.Sprint@old[id=1,name=AIR2611(0518-0531),state=CLOSED]',
            'com.atlassian.greenhopper.service.sprint.Sprint@new[id=2,name=AIR2612(0601-0614),state=ACTIVE]',
          ],
        },
        assignee: 'Michael Yang',
        reporter: 'PM',
        status: 'Open',
        priority: 'Normal',
        labels: ['air'],
        updatedAt: '2026-06-01T01:00:00.000Z',
      },
      { jiraKey: 'PRO-2', summary: 'Closed task', status: 'Closed', assignee: 'Michael Yang' },
      { jiraKey: 'PRO-3', summary: 'Cancelled task', status: 'Cancelled', assignee: 'Michael Yang' },
    ]);

    expect(updated.ticketCount).toBe(1);
    expect(updated.items).toHaveLength(1);
    expect(updated.items?.[0]).toMatchObject({
      jiraKey: 'PRO-1',
      title: 'Current sprint task',
      jiraUrl: 'https://jira.ringcentral.com/browse/PRO-1',
      sprint: 'AIR2611(0518-0531), AIR2612(0601-0614)',
      selected: true,
      status: 'candidate',
    });
    expect(updated.analysisSummary).toContain('Excluded 2 closed/cancelled');
  });

  it('stops Jira sync runs and prevents later candidate writes', () => {
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });

    const stopped = stopJiraSyncRun(run.id, 'User stopped sync');
    expect(stopped.status).toBe('stopped');
    expect(stopped.error).toBe('User stopped sync');

    expect(() => recordJiraSyncCandidates(run.id, [
      { jiraKey: 'PRO-1', summary: 'Late issue', status: 'Open' },
    ])).toThrow('jira sync run stopped');
  });

  it('applies only selected Jira sync items to Pikiclaw tasks', () => {
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });
    const withItems = recordJiraSyncCandidates(run.id, [
      { jiraKey: 'PRO-1', summary: 'Selected task', status: 'Open', sprint: 'AIR2612(0601-0614)', fixVersions: [{ name: '2026.06' }], dueDate: '2026-06-15' },
      { jiraKey: 'PRO-2', summary: 'Unselected task', status: 'Open', sprint: 'AIR2612(0601-0614)' },
    ]);

    const applied = applyJiraSyncRunItems(run.id, [withItems.items![0].id]);

    expect(applied.taskCount).toBe(1);
    expect(applied.status).toBe('completed');
    expect(applied.items?.map(item => ({ key: item.jiraKey, status: item.status, selected: item.selected }))).toEqual([
      { key: 'PRO-1', status: 'applied', selected: true },
      { key: 'PRO-2', status: 'candidate', selected: false },
    ]);
    const tasks = listProTasks();
    expect(tasks.map(task => task.jiraKey)).toEqual(['PRO-1']);
    expect(tasks[0].jiraFields).toMatchObject({
      status: 'Open',
      fixVersions: ['2026.06'],
      dueDate: '2026-06-15',
    });
    expect(tasks[0].jiraUrl).toBe('https://jira.ringcentral.com/browse/PRO-1');
    expect(tasks[0].sprint).toBe('AIR2612(0601-0614)');
  });

  it('records Jira remote update drafts, failed runs, and cancellations', () => {
    const draft = createJiraRemoteUpdateRun({
      taskId: 'task_1',
      jiraKey: 'PRO-1',
      currentFields: {
        status: 'Open',
        fixVersions: ['2026.06'],
        sprint: 'Sprint 1',
        dueDate: '2026-06-10',
      },
      fields: {
        status: 'In Progress',
        fixVersions: ['2026.07'],
        sprint: '',
        dueDate: '',
      },
    });

    expect(draft.status).toBe('draft');
    expect(draft.diff.map(item => item.field)).toEqual(['status', 'fixVersions', 'sprint', 'dueDate']);
    expect(listJiraRemoteUpdateRuns('task_1')).toHaveLength(1);
    expect(() => createJiraRemoteUpdateRun({
      taskId: 'task_1',
      jiraKey: 'PRO-1',
      currentFields: { status: 'Open' },
      fields: { status: 'Open' },
    })).toThrow('no jira field changes');

    const failed = updateJiraRemoteUpdateRun(draft.id, {
      status: 'failed',
      error: 'MCP update failed',
      event: { label: 'Jira update failed', detail: 'MCP update failed' },
    });

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('MCP update failed');
    expect(failed.completedAt).toBeTruthy();
    expect(getJiraRemoteUpdateRun(draft.id)?.events.map(event => event.label)).toContain('Jira update failed');

    const cancelled = cancelJiraRemoteUpdateRun(draft.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.events.map(event => event.label)).toContain('Jira update cancelled');
  });
});
