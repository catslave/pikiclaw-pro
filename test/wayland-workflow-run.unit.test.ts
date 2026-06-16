import { describe, expect, it } from 'vitest';
import {
  buildWorkflowRunPrompt,
  buildWorkflowRunRecordInput,
  buildWorkflowVisiblePrompt,
} from '../dashboard/src/pages/wayland/workflowRun.ts';

const workflowInput = {
  name: 'Release Gate',
  description: 'Review release evidence and decide whether the build is ready.',
  projectName: 'Pikiclaw',
  note: 'Focus on dashboard changes.',
  outputs: ['Verification summary', 'Risk list', 'Ship recommendation'],
  steps: ['Inspect diff', 'Run targeted tests', 'Check browser UX'],
  capabilities: ['Tests', 'Browser smoke'],
  guidance: 'Stay evidence-backed and preserve unrelated WIP.',
};

describe('Wayland workflow run prompt', () => {
  it('keeps the visible prompt concise and free of run protocol internals', () => {
    const prompt = buildWorkflowVisiblePrompt(workflowInput);

    expect(prompt).toContain('Run the "Release Gate" workflow for Pikiclaw.');
    expect(prompt).toContain('User note: Focus on dashboard changes.');
    expect(prompt).toContain('1. Inspect diff');
    expect(prompt).not.toContain('[Workflow Run Context]');
    expect(prompt).not.toContain('Workflow progress: Step N/M');
  });

  it('wraps workflow launch with chat-first run-state instructions', () => {
    const prompt = buildWorkflowRunPrompt(workflowInput);

    expect(prompt).toContain('[Workflow Run Context]');
    expect(prompt).toContain('Total steps: 3');
    expect(prompt).toContain('Capabilities: Tests, Browser smoke');
    expect(prompt).toContain('Start each assistant response with: `Workflow progress: Step N/M');
    expect(prompt).toContain('Do not restart at step 1 when the conversation is resumed.');
    expect(prompt).toContain('Question for you:');
    expect(prompt).toContain('Workflow complete');
    expect(prompt).toContain('- [ ] 1. Inspect diff');
    expect(prompt).toContain('[Workflow Request]');
  });

  it('builds the durable workflow run record used by chat and library launches', () => {
    const record = buildWorkflowRunRecordInput({
      recipe: {
        id: 'release-gate',
        name: workflowInput.name,
        steps: workflowInput.steps,
      },
      session: {
        workdir: '/repo/pikiclaw',
        agent: 'codex',
        sessionId: 'session-123',
        model: 'gpt-5',
        assistantId: 'assistant-release',
        assistantName: 'Release Assistant',
      },
      effort: 'high',
      note: '  Focus on dashboard changes.  ',
    });

    expect(record).toMatchObject({
      workflowId: 'release-gate',
      workflowName: 'Release Gate',
      title: 'Release Gate',
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      model: 'gpt-5',
      effort: 'high',
      assistantId: 'assistant-release',
      assistantName: 'Release Assistant',
      sessionId: 'session-123',
      sessionKey: 'codex:session-123',
      note: 'Focus on dashboard changes.',
      currentStep: 1,
      totalSteps: 3,
      steps: workflowInput.steps,
      status: 'running',
    });
  });
});
