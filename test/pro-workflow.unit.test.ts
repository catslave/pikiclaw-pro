import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createAgentAssistant,
  createAutomationRule,
  createJiraSyncRun,
  createKnowledgeEntry,
  getAssistantPrompt,
  getJiraSyncRun,
  listAgentAssistants,
  listAutomationRules,
  listKnowledgeEntries,
  markAutomationRun,
  resetAgentAssistantPrompt,
  updateAgentAssistantPrompt,
  updateJiraSyncRun,
} from '../src/pro/workflow.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-workflow-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
});

afterEach(() => {
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
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
    }));

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
    });
    expect(listAgentAssistants().some(item => item.id === assistant.id)).toBe(true);

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
    expect(listKnowledgeEntries()[0]).toMatchObject({ id: entry.id, tags: ['jira', 'estimate'] });
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
});
