import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createAgentAssistant,
  createAutomationRule,
  createKnowledgeEntry,
  listAgentAssistants,
  listAutomationRules,
  listKnowledgeEntries,
  markAutomationRun,
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
  it('persists assistants, automations, and knowledge entries', () => {
    const assistant = createAgentAssistant({
      name: 'Bug refinery',
      responsibility: 'Analyze bugs and estimate user understanding time.',
      preferredAgents: ['codex', 'claude'],
    });
    expect(listAgentAssistants()[0].id).toBe(assistant.id);

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
});
