import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createAgentAssistant,
  createAutomationRule,
  createJiraSyncRun,
  createJiraRemoteUpdateRun,
  applyJiraSyncRunItems,
  cancelJiraRemoteUpdateRun,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getAssistantPrompt,
  getJiraRemoteUpdateRun,
  getJiraSyncRun,
  listAgentAssistants,
  listJiraRemoteUpdateRuns,
  listAutomationRules,
  listKnowledgeEntries,
  markAutomationRun,
  recordJiraSyncCandidates,
  resetAgentAssistantPrompt,
  stopJiraSyncRun,
  updateAgentAssistantPrompt,
  updateKnowledgeEntry,
  updateJiraRemoteUpdateRun,
  updateJiraSyncRun,
} from '../src/pro/workflow.ts';
import { listProTasks } from '../src/pro/tasks.ts';

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
