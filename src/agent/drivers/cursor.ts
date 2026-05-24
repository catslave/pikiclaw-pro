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
  simpleCliSessionMessages,
  simpleCliSessions,
  simpleCliSessionTail,
  simpleUsage,
} from './simple-cli.js';

function cursorModel(opts: StreamOpts): string | null {
  return (opts.cursorModel || opts.model || '').trim() || null;
}

function cursorArgs(opts: StreamOpts, prompt: string): string[] {
  const args = ['--print', '--output-format', 'text', '--trust', '--workspace', opts.workdir];
  const model = cursorModel(opts);
  if (model) args.push('--model', model);
  if (!opts.cursorExtraArgs?.some(arg => arg === '--force' || arg === '--yolo')) {
    args.push('--force');
  }
  if (opts.cursorExtraArgs?.length) args.push(...opts.cursorExtraArgs);
  args.push(prompt);
  return args;
}

function listCursorModels(): ModelListResult {
  const fallback = [
    { id: 'gpt-5', alias: null },
    { id: 'sonnet-4', alias: null },
    { id: 'sonnet-4-thinking', alias: null },
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
  });
}

class CursorDriver implements AgentDriver {
  readonly id = 'cursor';
  readonly cmd = 'cursor-agent';
  readonly thinkLabel = 'Thinking';
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
