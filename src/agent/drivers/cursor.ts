/**
 * Cursor Agent CLI driver.
 *
 * Uses `cursor-agent --print` in headless mode and stores pikiclaw-owned
 * transcripts for conversation continuity across IM/dashboard turns.
 */

import { execFileSync } from 'node:child_process';
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
  type SimpleCliCommand,
  type SimpleCliParsedOutput,
  simpleCliSessionMessages,
  simpleCliSessions,
  simpleCliSessionTail,
  simpleUsage,
} from './simple-cli.js';

function cursorModel(opts: StreamOpts): string | null {
  const model = (opts.cursorModel || opts.model || '').trim();
  if (!model || model.toLowerCase() === 'auto') return null;
  return model;
}

function cursorArgs(opts: StreamOpts, prompt: string): string[] {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--stream-partial-output',
    '--trust',
    '--workspace', opts.workdir,
  ];
  const model = cursorModel(opts);
  if (model) args.push('--model', model);
  if (!opts.cursorExtraArgs?.some(arg => arg === '--force' || arg === '--yolo')) {
    args.push('--force');
  }
  if (opts.cursorExtraArgs?.length) args.push(...opts.cursorExtraArgs);
  args.push(prompt);
  return args;
}

function cursorTextFromMessage(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => part?.type === 'text' && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('');
}

function appendCursorText(current: string, next: string): string {
  if (!next) return current;
  if (!current) return next;
  if (next === current || current.includes(next)) return current;
  if (next.startsWith(current)) return next;
  return `${current}${next}`;
}

function parseCursorStream(stdout: string): { text: string; model: string | null } {
  let text = '';
  let result = '';
  let model: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: any = null;
    try { event = JSON.parse(trimmed); } catch { continue; }
    if (event?.type === 'system' && typeof event.model === 'string' && event.model.trim()) {
      model = event.model.trim();
    }
    if (event?.type === 'assistant') {
      text = appendCursorText(text, cursorTextFromMessage(event.message));
    }
    if (event?.type === 'result' && typeof event.result === 'string') {
      result = event.result;
    }
  }
  return { text: (result || text).trim(), model };
}

function renderCursorStdout(stdout: string, _stderr: string, _command: SimpleCliCommand): string {
  return parseCursorStream(stdout).text;
}

function parseCursorOutput(stdout: string, stderr: string, command: SimpleCliCommand): SimpleCliParsedOutput {
  const parsed = parseCursorStream(stdout);
  if (!parsed.text) {
    const fallback = stdout.trim();
    if (fallback) return { message: fallback, model: parsed.model || command.model };
    throw new Error(stderr.trim() || 'Cursor Agent returned no textual response.');
  }
  return { message: parsed.text, model: parsed.model || command.model };
}

function listCursorModels(): ModelListResult {
  const fallback = [
    { id: 'auto', alias: 'Auto' },
    { id: 'gpt-5.3-codex', alias: 'Codex 5.3' },
    { id: 'composer-2.5-fast', alias: 'Composer 2.5 Fast' },
    { id: 'gpt-5.2', alias: 'GPT-5.2' },
  ];
  try {
    const raw = execFileSync('cursor-agent', ['--list-models'], { encoding: 'utf8', timeout: 5_000 });
    const parsed = raw
      .split(/\r?\n/)
      .map(line => line.trim().replace(/^[-*]\s+/, ''))
      .filter(Boolean)
      .filter(line => !/^available models/i.test(line))
      .filter(line => !/^tip:/i.test(line))
      .map(line => {
        const sep = line.indexOf(' - ');
        if (sep < 0) return { id: line, alias: null };
        const id = line.slice(0, sep).trim();
        const alias = line.slice(sep + 3).trim() || null;
        return { id, alias };
      })
      .filter(model => model.id);
    return dedupeModelList('cursor', parsed.length ? parsed : fallback);
  } catch {
    return dedupeModelList('cursor', fallback);
  }
}

export async function doCursorStream(opts: StreamOpts): Promise<StreamResult> {
  return runSimpleCliStream(opts, {
    agent: 'cursor',
    label: 'Cursor Agent',
    buildCommand: (runOpts, prompt) => ({
      cmd: 'cursor-agent',
      args: cursorArgs(runOpts, prompt),
      model: cursorModel(runOpts),
      prompt,
    }),
    renderStdout: renderCursorStdout,
    parseOutput: parseCursorOutput,
  });
}

class CursorDriver implements AgentDriver {
  readonly id = 'cursor';
  readonly cmd = 'cursor-agent';
  readonly thinkLabel = 'Thinking';
  readonly capabilities = {
    fork: false,
    modelSwitch: true,
    plan: {
      mode: 'portable',
      source: 'pikiclaw plan prompt',
      commands: ['/plan'],
      actions: ['start', 'clarify', 'approve', 'cancel', 'implement'],
      note: 'No verified Cursor native plan protocol yet.',
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
      note: 'No verified Cursor ask-user event in --print mode.',
    },
    approval: {
      mode: 'unsupported',
      note: 'Cursor is currently launched in trusted/force mode.',
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
      note: 'No verified Cursor native fork protocol.',
    },
    steer: {
      mode: 'unsupported',
      note: 'No verified Cursor in-place steering channel.',
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

  async doStream(opts: StreamOpts): Promise<StreamResult> { return doCursorStream(opts); }
  async getSessions(workdir: string, limit?: number): Promise<SessionListResult> { return simpleCliSessions('cursor', workdir, limit); }
  async getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult> { return simpleCliSessionTail('cursor', opts); }
  async getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> { return simpleCliSessionMessages('cursor', opts); }
  async listModels(_opts: ModelListOpts): Promise<ModelListResult> { return listCursorModels(); }
  getUsage(_opts: UsageOpts): UsageResult { return simpleUsage('cursor', 'Cursor Agent'); }
  shutdown() {}
}

registerDriver(new CursorDriver());
