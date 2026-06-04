/**
 * Google Antigravity CLI (`agy`) driver.
 *
 * Uses `agy -p` headless print mode with pikiclaw-owned transcripts for
 * multi-turn continuity (the CLI's `--conversation` resume is not wired yet).
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

export function agyArgs(opts: StreamOpts, prompt: string): string[] {
  const args = ['-p', prompt];
  if (!opts.agyExtraArgs?.some(arg => arg === '--dangerously-skip-permissions')) {
    args.push('--dangerously-skip-permissions');
  }
  if (!opts.agyExtraArgs?.some(arg => arg.startsWith('--add-dir'))) {
    args.push('--add-dir', opts.workdir);
  }
  if (opts.agySandbox && !opts.agyExtraArgs?.some(arg => arg === '--sandbox')) {
    args.push('--sandbox');
  }
  if (opts.agyExtraArgs?.length) args.push(...opts.agyExtraArgs);
  return args;
}

const AGY_MODELS = [
  { id: 'gemini-3.1-pro-preview', alias: 'Gemini 3.1 Pro' },
  { id: 'gemini-2.5-pro', alias: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', alias: 'Gemini 2.5 Flash' },
];

export async function doAgyStream(opts: StreamOpts): Promise<StreamResult> {
  return runSimpleCliStream(opts, {
    agent: 'agy',
    label: 'Antigravity',
    buildCommand: (runOpts, prompt) => ({
      cmd: 'agy',
      args: agyArgs(runOpts, prompt),
      model: null,
      prompt,
    }),
  });
}

class AgyDriver implements AgentDriver {
  readonly id = 'agy';
  readonly cmd = 'agy';
  readonly thinkLabel = 'Thinking';
  readonly capabilities = {
    fork: false,
    modelSwitch: false,
    plan: {
      mode: 'portable',
      source: 'pikiclaw plan prompt',
      commands: ['/plan'],
      actions: ['start', 'clarify', 'approve', 'cancel', 'implement'],
      note: 'Antigravity workflows are IDE slash commands; planning uses pikiclaw prompts.',
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
      note: 'agy print mode runs with --dangerously-skip-permissions.',
    },
    approval: {
      mode: 'unsupported',
      note: 'agy print mode auto-approves tool permissions.',
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
      note: 'No verified agy native fork protocol.',
    },
    steer: {
      mode: 'unsupported',
      note: 'No verified agy in-place steering channel.',
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

  async doStream(opts: StreamOpts): Promise<StreamResult> { return doAgyStream(opts); }
  async getSessions(workdir: string, limit?: number): Promise<SessionListResult> { return simpleCliSessions('agy', workdir, limit); }
  async getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> { return simpleCliSessionTail('agy', opts); }
  async getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> { return simpleCliSessionMessages('agy', opts); }
  async listModels(_opts: ModelListOpts): Promise<ModelListResult> { return dedupeModelList('agy', AGY_MODELS); }
  getUsage(_opts: UsageOpts): UsageResult { return simpleUsage('agy', 'Antigravity CLI'); }
  shutdown() {}
}

registerDriver(new AgyDriver());
