import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import { runtime, type DashboardEvent } from '../src/dashboard/runtime.ts';
import { listWorkflowRuns } from '../src/pro/workflow.ts';

let tmpDir: string;
let previousWorkflowFile: string | undefined;

function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('condition timed out'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-dashboard-runtime-workflow-');
  previousWorkflowFile = process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
});

afterEach(() => {
  if (previousWorkflowFile === undefined) delete process.env.PIKICLAW_PRO_WORKFLOW_FILE;
  else process.env.PIKICLAW_PRO_WORKFLOW_FILE = previousWorkflowFile;
});

describe('dashboard runtime workflow marker ingest', () => {
  it('persists workflow ask markers when a session finishes', async () => {
    let finish: ((event: any) => void) | null = null;
    const events: DashboardEvent[] = [];
    const onEvent = (event: DashboardEvent) => events.push(event);
    runtime.events.on('dashboard-event', onEvent);
    runtime.attachBot({
      onStreamSnapshot() {},
      onChannelMessage() {},
      onSessionFinished(cb: (event: any) => void) {
        finish = cb;
      },
      setDefaultAgent() {},
      setModelForAgent() {},
      setEffortForAgent() {},
    } as any);

    try {
      const text = [
        'Workflow progress: Runtime ingest | step 2/4 | status blocked',
        '<ask type="choice" options="memory,workflow">Which subsystem should continue?</ask>',
      ].join('\n');

      finish!({
        taskId: 'task-runtime-marker',
        chatId: 'dashboard',
        session: {
          key: 'codex:session-runtime-marker',
          workdir: '/repo/pikiclaw',
          agent: 'codex',
          sessionId: 'session-runtime-marker',
        },
        result: {
          ok: false,
          message: text,
          thinking: null,
          plan: null,
          sessionId: 'session-runtime-marker',
          workspacePath: null,
          model: null,
          thinkingEffort: 'medium',
          elapsedS: 1,
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          cacheCreationInputTokens: null,
          contextWindow: null,
          contextUsedTokens: null,
          contextPercent: null,
          codexCumulative: null,
          error: 'test skips focus extraction',
          stopReason: null,
          incomplete: false,
          activity: null,
          assistantBlocks: [{ type: 'text', content: text, phase: 'final_answer' }],
        },
      });

      await waitFor(() => listWorkflowRuns({ limit: 10 }).length === 1);
      const run = listWorkflowRuns({ limit: 10 })[0];
      expect(run).toMatchObject({
        workflowName: 'Runtime ingest',
        sessionKey: 'codex:session-runtime-marker',
        status: 'blocked',
        currentStep: 2,
        totalSteps: 4,
      });
      expect(run.asks).toHaveLength(1);
      expect(run.asks[0]).toMatchObject({
        question: 'Which subsystem should continue?',
        type: 'choice',
        options: ['memory', 'workflow'],
        status: 'pending',
      });
      expect(events.some(event => (
        event.type === 'sessions-changed'
        && event.key === 'codex:session-runtime-marker'
        && (event.snapshot as any)?.phase === 'workflow-markers-ingested'
      ))).toBe(true);
    } finally {
      runtime.events.off('dashboard-event', onEvent);
    }
  });
});
