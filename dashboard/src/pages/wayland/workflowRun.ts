export type WorkflowRunPromptInput = {
  name: string;
  description: string;
  projectName: string;
  note?: string;
  outputs: string[];
  steps: string[];
  capabilities?: string[];
  guidance: string;
};

export type WorkflowRunRecordRecipeInput = {
  id?: string;
  name: string;
  steps: string[];
};

export type WorkflowRunRecordSessionInput = {
  workdir: string;
  agent: string;
  sessionId: string;
  model?: string;
  assistantId?: string;
  assistantName?: string;
};

export type WorkflowRunRecordBody = {
  workflowId?: string;
  workflowName: string;
  title: string;
  workdir: string;
  agent: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  assistantId?: string;
  assistantName?: string;
  sessionId: string;
  sessionKey: string;
  note?: string;
  currentStep: number;
  totalSteps: number;
  steps: string[];
  status: 'running';
};

function cleanOptional(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function cleanList(items: string[]): string[] {
  return items.map(item => item.trim()).filter(Boolean);
}

function renderBulletList(items: string[], empty: string): string[] {
  const clean = cleanList(items);
  return clean.length ? clean.map(item => `- ${item}`) : [`- ${empty}`];
}

function renderStepList(steps: string[]): string[] {
  const clean = cleanList(steps);
  return clean.length ? clean.map((item, index) => `${index + 1}. ${item}`) : ['1. Clarify the workflow target'];
}

export function buildWorkflowVisiblePrompt(input: WorkflowRunPromptInput): string {
  const note = input.note?.trim();
  return [
    `Run the "${input.name}" workflow for ${input.projectName || 'current project'}.`,
    '',
    `Objective: ${input.description}`,
    note ? `User note: ${note}` : '',
    '',
    'Expected outputs:',
    ...renderBulletList(input.outputs, 'A concise workflow result'),
    '',
    'Steps:',
    ...renderStepList(input.steps),
    '',
    `Operating guidance: ${input.guidance || input.description}`,
  ].filter(Boolean).join('\n');
}

export function buildWorkflowRunPrompt(input: WorkflowRunPromptInput): string {
  const steps = cleanList(input.steps);
  const outputs = cleanList(input.outputs);
  const capabilities = cleanList(input.capabilities || []);
  const visiblePrompt = buildWorkflowVisiblePrompt(input);
  const totalSteps = Math.max(steps.length, 1);

  return [
    '[Workflow Run Context]',
    `Workflow: ${input.name}`,
    `Project: ${input.projectName || 'current project'}`,
    `Total steps: ${totalSteps}`,
    capabilities.length ? `Capabilities: ${capabilities.join(', ')}` : '',
    '',
    'Run protocol:',
    `- Treat this as one continuous workflow run with ${totalSteps} ordered step${totalSteps === 1 ? '' : 's'}.`,
    '- Start each assistant response with: `Workflow progress: Step N/M - <step title> - <running|blocked|done>`.',
    '- Keep progress monotonic. Do not restart at step 1 when the conversation is resumed.',
    '- If you need the user, ask exactly one focused question under `Question for you:` and stop.',
    '- When all steps are done, finish with `Workflow complete` and include the requested outputs.',
    '- Mention files, commands, tools, or references only when you actually used them.',
    '',
    'Run state seed:',
    ...renderStepList(steps).map(step => `- [ ] ${step}`),
    '',
    'Completion contract:',
    ...renderBulletList(outputs, 'A concise workflow result'),
    '',
    '[Workflow Request]',
    visiblePrompt,
  ].filter(Boolean).join('\n');
}

export function buildWorkflowRunRecordInput(input: {
  recipe: WorkflowRunRecordRecipeInput;
  session: WorkflowRunRecordSessionInput;
  effort?: 'low' | 'medium' | 'high';
  note?: string;
}): WorkflowRunRecordBody {
  const steps = cleanList(input.recipe.steps);
  const totalSteps = Math.max(steps.length, 1);
  return {
    workflowId: cleanOptional(input.recipe.id),
    workflowName: input.recipe.name,
    title: input.recipe.name,
    workdir: input.session.workdir,
    agent: input.session.agent,
    model: cleanOptional(input.session.model),
    effort: input.effort,
    assistantId: cleanOptional(input.session.assistantId),
    assistantName: cleanOptional(input.session.assistantName),
    sessionId: input.session.sessionId,
    sessionKey: `${input.session.agent}:${input.session.sessionId}`,
    note: cleanOptional(input.note),
    currentStep: 1,
    totalSteps,
    steps,
    status: 'running',
  };
}
