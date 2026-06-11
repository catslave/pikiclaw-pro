import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import type { SessionInfo } from '../src/agent/types.ts';
import { proTools } from '../src/agent/mcp/tools/pro.ts';
import {
  createExtractionDeduper,
  getSessionValueSignals,
  hasKnowledgeForSession,
  isAutoSinkEligible,
  isKnowledgeCandidate,
} from '../src/pro/focus.ts';
import { createKnowledgeEntry, listKnowledgeEntries } from '../src/pro/workflow.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-focus-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
});

afterEach(() => {
  if (previousWorkflowFile == null) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 's1',
    agent: 'codex',
    workdir: '/repo/app',
    workspacePath: '/repo/app/.pikiclaw/sessions/codex/s1/workspace',
    threadId: null,
    model: null,
    thinkingEffort: null,
    createdAt: '2026-06-05T09:00:00',
    origin: null,
    title: 'Ordinary answer',
    titleSource: 'prompt',
    running: false,
    runState: 'completed',
    runDetail: null,
    runUpdatedAt: '2026-06-05T09:10:00',
    classification: { outcome: 'answer', summary: 'Answered a simple question.' },
    userStatus: 'done',
    userStatusUpdatedAt: '2026-06-05T09:12:00',
    userNote: null,
    pinned: false,
    archived: false,
    archivedAt: null,
    lastQuestion: 'What is X?',
    lastAnswer: 'X is Y.',
    lastMessageText: 'X is Y.',
    outputs: [],
    migratedFrom: null,
    migratedTo: null,
    linkedSessions: [],
    sideChatOf: null,
    sideChats: [],
    contextSources: [],
    numTurns: 2,
    ...overrides,
  } as SessionInfo;
}

describe('Focus knowledge rules', () => {
  it('does not treat ordinary answer chats as knowledge candidates', () => {
    const ordinary = session();
    expect(getSessionValueSignals(ordinary)).toEqual([]);
    expect(isKnowledgeCandidate(ordinary)).toBe(false);
  });

  it('detects value signals for outputs, plans, and implementation work', () => {
    const valuable = session({
      classification: { outcome: 'implementation', summary: 'Implemented a feature.' },
      outputs: [{
        id: 'out1',
        kind: 'document',
        title: 'Implementation note',
        summary: 'Useful output.',
        createdAt: '2026-06-05T09:20:00',
      }],
      lastPlan: { steps: [{ id: 'step1', text: 'Implement', status: 'completed' }] } as any,
    });

    expect(getSessionValueSignals(valuable).map(item => item.key)).toEqual(expect.arrayContaining(['outputs', 'plan', 'implementation']));
    expect(isKnowledgeCandidate(valuable)).toBe(true);
  });

  it('auto-sinks only seen completed non-valuable chats after the next local day', () => {
    const now = new Date('2026-06-06T12:00:00');
    expect(isAutoSinkEligible(session({ userStatusUpdatedAt: '2026-06-05T23:59:00' }), now)).toBe(true);
    expect(isAutoSinkEligible(session({ userStatusUpdatedAt: '2026-06-06T00:01:00' }), now)).toBe(false);
    expect(isAutoSinkEligible(session({ runState: 'incomplete' }), now)).toBe(false);
    expect(isAutoSinkEligible(session({ pinned: true }), now)).toBe(false);
    expect(isAutoSinkEligible(session({ outputs: [{ id: 'out1', kind: 'file', title: 'Patch', createdAt: '2026-06-05T10:00:00' }] }), now)).toBe(false);
  });

  it('matches existing knowledge cards to source sessions', () => {
    const source = session();
    const entry = createKnowledgeEntry({
      title: 'Source card',
      body: 'Reusable note.',
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
      artifactRefs: [{ kind: 'document', outputId: 'out1', path: '/repo/app/out.md' }],
      createdBy: 'agent',
    });

    expect(entry.sourceRefs).toHaveLength(1);
    expect(hasKnowledgeForSession(listKnowledgeEntries(), source)).toBe(true);
  });

  it('deduplicates extraction queue keys until forgotten', () => {
    const deduper = createExtractionDeduper();
    expect(deduper.shouldQueue('chat-key')).toBe(true);
    deduper.markQueued('chat-key');
    expect(deduper.shouldQueue('chat-key')).toBe(false);
    deduper.forget('chat-key');
    expect(deduper.shouldQueue('chat-key')).toBe(true);
  });

  it('pikiclaw_pro_save_knowledge persists source and artifact refs', async () => {
    const result = await proTools.handle('pikiclaw_pro_save_knowledge', {
      title: 'Extracted card',
      body: 'Grounded reusable content.',
      summary: 'Short summary.',
      tags: ['focus'],
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
      artifactRefs: [{ kind: 'document', outputId: 'out1', path: '/repo/app/out.md' }],
      confidence: 'high',
    }, {
      workspace: '/repo/app',
      workdir: '/repo/app',
      agent: 'codex',
      sessionId: 's1',
      stagedFiles: [],
      callbackUrl: '',
    });

    expect(result.isError).not.toBe(true);
    const entry = listKnowledgeEntries()[0];
    expect(entry).toMatchObject({
      title: 'Extracted card',
      createdBy: 'agent',
      confidence: 'high',
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
      artifactRefs: [{ kind: 'document', outputId: 'out1', path: '/repo/app/out.md' }],
    });
  });
});
