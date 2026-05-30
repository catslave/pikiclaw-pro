/**
 * OpenClaw Gateway driver.
 *
 * Uses `openclaw agent --json` as a Gateway-backed, non-interactive turn. The
 * OpenClaw Gateway owns its own agent/session/tool state; pikiclaw keeps a
 * lightweight transcript so dashboard and IM history stay consistent.
 */

import { registerDriver, type AgentDriver } from '../driver.js';
import { processEnvWithNodeAtLeast } from '../../core/platform.js';
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
  type SimpleCliCommand,
  type SimpleCliParsedOutput,
} from './simple-cli.js';

const DEFAULT_OPENCLAW_AGENT = 'codex';
const OPENCLAW_NODE_MIN_VERSION = '22.19.0';

const OPENCLAW_MODELS = [
  { id: 'openai/gpt-5.4', alias: 'OpenAI GPT-5.4' },
  { id: 'anthropic/claude-sonnet-4', alias: 'Claude Sonnet 4' },
  { id: 'google/gemini-3-pro-preview', alias: 'Gemini 3 Pro' },
];

function openclawModel(opts: StreamOpts): string | null {
  return (opts.openclawModel || opts.model || '').trim() || null;
}

function openclawEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const env = processEnvWithNodeAtLeast(OPENCLAW_NODE_MIN_VERSION);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function flagValue(args: string[], name: string): string | null {
  let value: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item === name && args[i + 1]) {
      value = args[i + 1];
      i++;
      continue;
    }
    if (item.startsWith(`${name}=`)) value = item.slice(name.length + 1);
  }
  return value?.trim() || null;
}

function stripFlagWithValue(args: string[], names: string[]): string[] {
  const blocked = new Set(names);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (blocked.has(item)) {
      i++;
      continue;
    }
    if (names.some(name => item.startsWith(`${name}=`))) continue;
    out.push(item);
  }
  return out;
}

function targetOpenClawAgent(extraArgs: string[]): string {
  return flagValue(extraArgs, '--agent')
    || String(process.env.OPENCLAW_AGENT_ID || '').trim()
    || DEFAULT_OPENCLAW_AGENT;
}

function openclawArgs(opts: StreamOpts, prompt: string, sessionId: string): string[] {
  const extraArgs = opts.openclawExtraArgs || [];
  const targetAgent = String(opts.openclawAgent || '').trim() || targetOpenClawAgent(extraArgs);
  const args = [
    'agent',
    '--agent', targetAgent,
    '--session-key', `agent:${targetAgent}:${sessionId}`,
    '--message', prompt,
    '--json',
    '--timeout', String(Math.max(1, Math.floor(opts.timeout || 600))),
  ];
  if (targetAgent !== 'cursor') {
    const model = openclawModel(opts);
    if (model) args.push('--model', model);
    const effort = String(opts.thinkingEffort || '').trim().toLowerCase();
    if (effort) args.push('--thinking', effort);
  }
  if (extraArgs.length) {
    args.push(...stripFlagWithValue(extraArgs, ['--agent', '--session-key', '--message', '--timeout']));
  }
  return args;
}

function parseJson(stdout: string): any {
  const text = stdout.trim();
  if (!text) throw new Error('OpenClaw returned empty JSON output.');
  try {
    return JSON.parse(text);
  } catch {
    const candidate = text.split(/\r?\n/).reverse().find(line => /^[\[{]/.test(line.trim()));
    if (candidate) {
      try { return JSON.parse(candidate); } catch { /* fall through */ }
    }
    throw new Error('OpenClaw returned invalid JSON output.');
  }
}

function textFromValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join('\n');
  if (typeof value !== 'object') return String(value);
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return textFromValue(value.content);
  if (typeof value.message === 'string') return value.message;
  if (value.message) return textFromValue(value.message);
  if (typeof value.reply === 'string') return value.reply;
  if (value.reply) return textFromValue(value.reply);
  if (typeof value.response === 'string') return value.response;
  if (value.response) return textFromValue(value.response);
  if (typeof value.answer === 'string') return value.answer;
  if (value.answer) return textFromValue(value.answer);
  if (typeof value.output === 'string') return value.output;
  if (value.output) return textFromValue(value.output);
  if (value.result) return textFromValue(value.result);
  if (Array.isArray(value.payloads)) return textFromValue(value.payloads.map((item: any) => item?.text ?? item));
  return '';
}

function parseOpenClawOutput(stdout: string, _stderr: string, command: SimpleCliCommand): SimpleCliParsedOutput {
  const parsed = parseJson(stdout);
  const message = textFromValue(parsed).trim();
  if (!message) {
    return {
      message: JSON.stringify(parsed, null, 2),
      model: parsed?.model || parsed?.meta?.model || command.model,
    };
  }
  return {
    message,
    model: parsed?.model || parsed?.meta?.model || command.model,
  };
}

export async function doOpenClawStream(opts: StreamOpts): Promise<StreamResult> {
  return runSimpleCliStream(opts, {
    agent: 'openclaw',
    label: 'OpenClaw',
    includeHistory: false,
    parseOutput: parseOpenClawOutput,
    buildCommand: (runOpts, prompt, sessionId) => ({
      cmd: 'openclaw',
      args: openclawArgs(runOpts, prompt, sessionId),
      model: openclawModel(runOpts),
      prompt,
      env: openclawEnv(),
    }),
  });
}

class OpenClawDriver implements AgentDriver {
  readonly id = 'openclaw';
  readonly cmd = 'openclaw';
  readonly thinkLabel = 'Thinking';
  readonly capabilities = {
    fork: false,
    modelSwitch: true,
    plan: {
      mode: 'portable',
      source: 'pikiclaw plan prompt',
      commands: ['/plan'],
      actions: ['start', 'clarify', 'approve', 'cancel', 'implement'],
      note: 'OpenClaw capability probing is pending; not marked native.',
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
      note: 'No verified OpenClaw ask-user event in the gateway JSON turn.',
    },
    approval: {
      mode: 'unsupported',
      note: 'No verified OpenClaw approval event in the gateway JSON turn.',
    },
    artifacts: {
      mode: 'portable',
      source: 'pikiclaw transcript rendering',
      actions: ['render', 'recover'],
    },
    resume: {
      mode: 'portable',
      source: 'OpenClaw session-key + pikiclaw transcript',
      actions: ['resume', 'recover'],
    },
    forkCapability: {
      mode: 'unsupported',
      note: 'No verified OpenClaw native fork protocol.',
    },
    steer: {
      mode: 'unsupported',
      note: 'No verified OpenClaw in-place steering channel.',
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

  async doStream(opts: StreamOpts): Promise<StreamResult> { return doOpenClawStream(opts); }
  async getSessions(workdir: string, limit?: number): Promise<SessionListResult> { return simpleCliSessions('openclaw', workdir, limit); }
  async getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> { return simpleCliSessionTail('openclaw', opts); }
  async getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> { return simpleCliSessionMessages('openclaw', opts); }
  async listModels(opts: ModelListOpts): Promise<ModelListResult> {
    const fallback = opts.currentModel ? [{ id: opts.currentModel, alias: null }, ...OPENCLAW_MODELS] : OPENCLAW_MODELS;
    return dedupeModelList('openclaw', fallback);
  }
  getUsage(_opts: UsageOpts): UsageResult { return simpleUsage('openclaw', 'OpenClaw Gateway'); }
  shutdown() {}
}

registerDriver(new OpenClawDriver());
