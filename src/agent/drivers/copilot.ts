/**
 * GitHub Copilot CLI driver.
 *
 * Uses Copilot CLI's documented non-interactive `copilot -p` path and stores
 * pikiclaw-owned transcripts for conversation continuity across turns.
 */

import { registerDriver, type AgentDriver } from '../driver.js';
import type {
  ModelListOpts,
  ModelListResult,
  SessionListResult,
  SessionMessagesOpts,
  SessionMessagesResult,
  SessionTailOpts,
  SessionTailResult,
  StreamOpts,
  StreamResult,
  UsageOpts,
  UsageResult,
} from '../types.js';
import {
  dedupeModelList,
  runSimpleCliStream,
  simpleCliSessionMessages,
  simpleCliSessions,
  simpleCliSessionTail,
  simpleUsage,
} from './simple-cli.js';
import { copilotAuthEnv } from '../copilot-auth.js';

function copilotModel(opts: StreamOpts): string | null {
  return (opts.copilotModel || opts.model || '').trim() || null;
}

function copilotArgs(opts: StreamOpts, prompt: string): string[] {
  const args = ['-p', prompt, '-s'];
  const model = copilotModel(opts);
  if (model) args.push('--model', model);
  if (!opts.copilotExtraArgs?.some(arg => arg === '--allow-all' || arg === '--yolo')) {
    args.push('--allow-all');
  }
  if (!opts.copilotExtraArgs?.some(arg => arg === '--no-ask-user')) {
    args.push('--no-ask-user');
  }
  if (opts.copilotExtraArgs?.length) args.push(...opts.copilotExtraArgs);
  return args;
}

const COPILOT_MODELS = [
  { id: 'gpt-5.3-codex', alias: null },
  { id: 'gpt-5.2', alias: null },
  { id: 'claude-sonnet-4.6', alias: null },
  { id: 'claude-haiku-4.5', alias: null },
];

export async function doCopilotStream(opts: StreamOpts): Promise<StreamResult> {
  return runSimpleCliStream(opts, {
    agent: 'copilot',
    label: 'GitHub Copilot',
    buildCommand: (runOpts, prompt) => ({
      cmd: 'copilot',
      args: copilotArgs(runOpts, prompt),
      model: copilotModel(runOpts),
      prompt,
      env: copilotAuthEnv(),
    }),
  });
}

class CopilotDriver implements AgentDriver {
  readonly id = 'copilot';
  readonly cmd = 'copilot';
  readonly thinkLabel = 'Thinking';
  readonly capabilities = {
    fork: false,
    modelSwitch: true,
    plan: {
      mode: 'portable',
      source: 'pikiclaw plan prompt',
      commands: ['/plan'],
      actions: ['start', 'clarify', 'approve', 'cancel', 'implement'],
      note: 'No verified Copilot native plan protocol yet.',
    },
    goal: {
      mode: 'portable',
      source: 'pikiclaw goal.json',
      statusSource: 'pikiclaw session metadata',
      commands: ['/goal'],
      actions: ['set', 'pause', 'resume', 'clear', 'status'],
    },
    humanInput: {
      mode: 'unsupported',
      note: 'Copilot is currently launched with --no-ask-user.',
    },
    approval: {
      mode: 'unsupported',
      note: 'Copilot is currently launched with --allow-all.',
    },
    artifacts: {
      mode: 'portable',
      source: 'pikiclaw transcript rendering',
      actions: ['render', 'recover'],
    },
    resume: {
      mode: 'portable',
      source: 'pikiclaw transcript replay',
      actions: ['resume', 'recover'],
    },
    forkCapability: {
      mode: 'unsupported',
      note: 'No verified Copilot native fork protocol.',
    },
    steer: {
      mode: 'unsupported',
      note: 'No verified Copilot in-place steering channel.',
    },
    mcp: {
      mode: 'portable',
      source: 'pikiclaw MCP bridge',
      actions: ['useMcp'],
    },
    imageGeneration: {
      mode: 'portable',
      source: 'MCP/tools',
      actions: ['generate', 'render'],
    },
  } satisfies import('../types.js').AgentDriverCapabilities;
  readonly acceptedProviderKinds = [] as const;

  async doStream(opts: StreamOpts): Promise<StreamResult> { return doCopilotStream(opts); }
  async getSessions(workdir: string, limit?: number): Promise<SessionListResult> { return simpleCliSessions('copilot', workdir, limit); }
  async getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> { return simpleCliSessionTail('copilot', opts); }
  async getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> { return simpleCliSessionMessages('copilot', opts); }
  async listModels(_opts: ModelListOpts): Promise<ModelListResult> { return dedupeModelList('copilot', COPILOT_MODELS); }
  getUsage(_opts: UsageOpts): UsageResult { return simpleUsage('copilot', 'GitHub Copilot CLI'); }
  shutdown() {}
}

registerDriver(new CopilotDriver());
