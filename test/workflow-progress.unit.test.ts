import { describe, expect, it } from 'vitest';
import {
  buildWorkflowAskAnswerEnvelope,
  extractWorkflowAskMarkers,
  latestWorkflowProgressFromTexts,
  parseWorkflowProgress,
  stripWorkflowControlMarkers,
  stripWorkflowProgressMarkers,
} from '../dashboard/src/pages/sessions/workflowProgress.ts';

describe('workflow progress parser', () => {
  it('parses Pikiclaw workflow progress markers', () => {
    const text = [
      'Workflow progress: Step 2/4 - Run targeted tests - running',
      '',
      'Running the focused test suite now.',
    ].join('\n');

    expect(parseWorkflowProgress(text)).toEqual({
      currentStep: 2,
      totalSteps: 4,
      title: 'Run targeted tests',
      status: 'running',
    });
    expect(stripWorkflowProgressMarkers(text)).toBe('Running the focused test suite now.');
  });

  it('marks the last workflow marker as done when completion is reported', () => {
    const text = [
      'Workflow progress: Step 3/3 - Check browser UX - running',
      'Workflow complete',
      'Summary is ready.',
    ].join('\n');

    expect(parseWorkflowProgress(text)).toEqual({
      currentStep: 3,
      totalSteps: 3,
      title: 'Check browser UX',
      status: 'done',
    });
    expect(stripWorkflowProgressMarkers(text)).toBe('Summary is ready.');
  });

  it('parses Wayland-style pipe workflow progress markers', () => {
    const text = [
      'Workflow progress: Investigation | step 2/4 | status blocked | waiting for your choice',
      '',
      'The workflow found two viable paths.',
    ].join('\n');

    expect(parseWorkflowProgress(text)).toEqual({
      currentStep: 2,
      totalSteps: 4,
      title: 'Investigation',
      status: 'blocked',
    });
    expect(stripWorkflowProgressMarkers(text)).toBe('The workflow found two viable paths.');
  });

  it('ignores progress-shaped text inside fenced code blocks', () => {
    const text = [
      '```',
      'Workflow progress: Step 1/2 - Fake - blocked',
      '```',
      'Workflow progress: Step 1/2 - Real work - blocked',
    ].join('\n');

    expect(parseWorkflowProgress(text)).toEqual({
      currentStep: 1,
      totalSteps: 2,
      title: 'Real work',
      status: 'blocked',
    });
    expect(stripWorkflowProgressMarkers(text)).toContain('Workflow progress: Step 1/2 - Fake - blocked');
    expect(stripWorkflowProgressMarkers(text)).not.toContain('Real work - blocked');
  });

  it('uses the latest workflow marker across loaded turns and live text', () => {
    expect(latestWorkflowProgressFromTexts([
      'Workflow progress: Step 1/3 - Parse requirements - running',
      null,
      'Assistant note without progress.',
      'Workflow progress: Step 2/3 - Run targeted checks - blocked',
    ])).toEqual({
      currentStep: 2,
      totalSteps: 3,
      title: 'Run targeted checks',
      status: 'blocked',
    });
  });

  it('extracts and strips workflow ask markers outside code blocks', () => {
    const text = [
      'Workflow progress: Step 2/4 - Need a decision - blocked',
      '<ask type="choice" options="ask cards, autonomous step" placeholder="Pick one">Which gap next?</ask>',
      '',
      'I need this before continuing.',
    ].join('\n');

    expect(extractWorkflowAskMarkers(text)).toEqual([
      {
        question: 'Which gap next?',
        type: 'choice',
        options: ['ask cards', 'autonomous step'],
        placeholder: 'Pick one',
      },
    ]);
    expect(stripWorkflowControlMarkers(text)).toBe('I need this before continuing.');
  });

  it('preserves ask-shaped text inside fenced code blocks', () => {
    const text = [
      '```xml',
      '<ask type="text">Do not parse me</ask>',
      '```',
      '<ask type="boolean">Proceed?</ask>',
    ].join('\n');

    expect(extractWorkflowAskMarkers(text)).toEqual([
      {
        question: 'Proceed?',
        type: 'boolean',
        options: [],
      },
    ]);
    expect(stripWorkflowControlMarkers(text)).toContain('<ask type="text">Do not parse me</ask>');
    expect(stripWorkflowControlMarkers(text)).not.toContain('Proceed?');
  });

  it('preserves ask-shaped text inside inline code spans', () => {
    const text = [
      'Use `<ask type="text">Do not parse me</ask>` as the example syntax.',
      '<ask type="choice" options="memory, workflow">Proceed with which surface?</ask>',
    ].join('\n');

    expect(extractWorkflowAskMarkers(text)).toEqual([
      {
        question: 'Proceed with which surface?',
        type: 'choice',
        options: ['memory', 'workflow'],
      },
    ]);
    const stripped = stripWorkflowControlMarkers(text);
    expect(stripped).toContain('`<ask type="text">Do not parse me</ask>`');
    expect(stripped).not.toContain('Proceed with which surface?');
  });

  it('recovers escaped workflow ask markers outside code spans', () => {
    const text = [
      'The agent paused here:',
      '&lt;ask type=&quot;text&quot; placeholder=&quot;Short answer&quot;&gt;What should happen next?&lt;/ask&gt;',
      'But `&lt;ask type=&quot;text&quot;&gt;Example only&lt;/ask&gt;` remains documentation.',
    ].join('\n');

    expect(extractWorkflowAskMarkers(text)).toEqual([
      {
        question: 'What should happen next?',
        type: 'text',
        options: [],
        placeholder: 'Short answer',
      },
    ]);
    const stripped = stripWorkflowControlMarkers(text);
    expect(stripped).not.toContain('What should happen next?');
    expect(stripped).toContain('`&lt;ask type=&quot;text&quot;&gt;Example only&lt;/ask&gt;`');
  });

  it('builds Wayland-compatible workflow answer envelopes', () => {
    expect(buildWorkflowAskAnswerEnvelope({ id: 'ask-risk', stepIndex: 2 }, 'latency')).toBe([
      '[workflow_answer ask_id="ask-risk" step_n="2"]',
      '<answer>latency</answer>',
      '[/workflow_answer]',
    ].join('\n'));
  });
});
