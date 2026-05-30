import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionPlan,
  createSessionPlanView,
  extractProposedPlan,
  readSessionPlan,
  sessionPlanPath,
  writeSessionPlan,
} from '../src/agent/plan.ts';
import { makeTmpDir } from './support/env.ts';

const AGENT = 'codex';
const SID = 'session_plan_001';

let workdir: string;

beforeEach(() => {
  workdir = makeTmpDir('pikiclaw-plan-');
});

afterEach(() => {
  try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
});

describe('session plan view', () => {
  it('stores plan.json under the session root', () => {
    const plan = createSessionPlanView({
      agent: AGENT,
      source: 'turn/plan/updated',
      mode: 'native',
      content: '1. Inspect\n2. Patch',
      steps: [{ step: 'Inspect', status: 'completed' }],
    });
    const written = writeSessionPlan(workdir, AGENT, SID, plan);
    expect(fs.existsSync(sessionPlanPath(workdir, AGENT, SID))).toBe(true);
    expect(written.updatedAt).not.toBe('');
    expect(readSessionPlan(workdir, AGENT, SID)?.content).toContain('Inspect');

    clearSessionPlan(workdir, AGENT, SID);
    expect(readSessionPlan(workdir, AGENT, SID)).toBeNull();
  });

  it('extracts proposed plan artifacts from assistant text', () => {
    const text = [
      'Before',
      '<proposed_plan>',
      '## Summary',
      '- Do the work',
      '</proposed_plan>',
      'After',
    ].join('\n');
    expect(extractProposedPlan(text)).toContain('## Summary');
    expect(extractProposedPlan('no artifact')).toBeNull();
  });
});
