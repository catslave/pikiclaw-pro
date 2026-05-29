/**
 * Shared helpers for headless CLI agents that expose a plain prompt/response
 * command but do not have a stable session transcript format pikiclaw can read.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { terminateProcessTree } from '../../core/process-control.js';
import { AGENT_STREAM_HARD_KILL_GRACE_MS } from '../../core/constants.js';
import { processEnvWithUserBins, resolveExecutablePath } from '../../core/platform.js';
import type {
  Agent,
  ManagedSessionRecord,
  MessageBlock,
  ModelInfo,
  SessionInfo,
  SessionListResult,
  SessionMessagesOpts,
  SessionMessagesResult,
  SessionTailOpts,
  SessionTailResult,
  StreamOpts,
  StreamResult,
  TailMessage,
  RichMessage,
} from '../types.js';
import {
  agentError,
  agentLog,
  agentWarn,
  applyTurnWindow,
  emptyUsage,
  findPikiclawSession,
  listPikiclawSessions,
  normalizeErrorMessage,
  Q,
} from '../index.js';

interface SimpleTranscriptTurn {
  user: string;
  assistant: string;
  model: string | null;
  createdAt: string;
}

interface SimpleTranscript {
  version: 1;
  agent: Agent;
  sessionId: string;
  workdir: string;
  createdAt: string;
  updatedAt: string;
  turns: SimpleTranscriptTurn[];
}

export interface SimpleCliCommand {
  cmd: string;
  args: string[];
  model: string | null;
  prompt: string;
  env?: Record<string, string>;
}

export interface SimpleCliParsedOutput {
  message: string;
  model?: string | null;
  thinking?: string | null;
}

export interface SimpleCliRunOptions {
  agent: Agent;
  label: string;
  buildCommand: (opts: StreamOpts, prompt: string, sessionId: string) => SimpleCliCommand;
  includeHistory?: boolean;
  parseOutput?: (stdout: string, stderr: string, command: SimpleCliCommand) => SimpleCliParsedOutput;
}

const TRANSCRIPT_DIR = path.join('.pikiclaw', 'simple-cli-transcripts');
const MAX_HISTORY_TURNS = 16;
const MAX_HISTORY_CHARS = 40_000;

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function transcriptPath(workdir: string, agent: Agent, sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^\w.-]+/g, '_');
  return path.join(path.resolve(workdir), TRANSCRIPT_DIR, agent, `${safeSessionId}.json`);
}

function readTranscript(workdir: string, agent: Agent, sessionId: string): SimpleTranscript | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(transcriptPath(workdir, agent, sessionId), 'utf8'));
    if (!parsed || parsed.agent !== agent || parsed.sessionId !== sessionId || !Array.isArray(parsed.turns)) return null;
    return parsed as SimpleTranscript;
  } catch {
    return null;
  }
}

function writeTranscript(transcript: SimpleTranscript) {
  const filePath = transcriptPath(transcript.workdir, transcript.agent, transcript.sessionId);
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(transcript, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n');
}

function attachmentsPrompt(attachments: string[] | undefined): string {
  const files = attachments?.filter(Boolean) || [];
  if (!files.length) return '';
  return [
    '[Attached files]',
    ...files.map(file => `- ${file}`),
  ].join('\n');
}

function buildPromptWithHistory(opts: StreamOpts, transcript: SimpleTranscript | null): string {
  const sections: string[] = [];
  const systemPrompt = String(opts.cursorSystemPrompt || opts.copilotSystemPrompt || '').trim();
  if (systemPrompt) sections.push(`[System instructions]\n${systemPrompt}`);

  const priorTurns = (transcript?.turns || []).slice(-MAX_HISTORY_TURNS);
  if (priorTurns.length) {
    const rendered = priorTurns
      .map(turn => `User:\n${turn.user.trim()}\n\nAssistant:\n${turn.assistant.trim()}`)
      .join('\n\n---\n\n');
    const history = rendered.length > MAX_HISTORY_CHARS
      ? rendered.slice(Math.max(0, rendered.length - MAX_HISTORY_CHARS))
      : rendered;
    sections.push(`[Conversation so far]\n${history}`);
  }

  const attachmentText = attachmentsPrompt(opts.attachments);
  if (attachmentText) sections.push(attachmentText);
  sections.push(`[Current request]\n${opts.prompt}`);
  return sections.join('\n\n');
}

function recordToSessionInfo(record: ManagedSessionRecord): SessionInfo {
  return {
    sessionId: record.sessionId,
    agent: record.agent,
    workdir: record.workdir,
    workspacePath: record.workspacePath,
    threadId: record.threadId,
    model: record.model,
    thinkingEffort: record.thinkingEffort,
    createdAt: record.createdAt,
    origin: record.origin ?? null,
    title: record.title,
    titleSource: record.titleSource ?? null,
    running: record.runState === 'running',
    runState: record.runState,
    runDetail: record.runDetail,
    runUpdatedAt: record.runUpdatedAt,
    runPid: record.runPid,
    classification: record.classification,
    userStatus: record.userStatus,
    userNote: record.userNote,
    pinned: record.pinned === true,
    archived: record.archived === true,
    archivedAt: record.archivedAt ?? null,
    lastQuestion: record.lastQuestion,
    lastAnswer: record.lastAnswer,
    lastMessageText: record.lastMessageText,
    migratedFrom: record.migratedFrom,
    migratedTo: record.migratedTo,
    linkedSessions: record.linkedSessions,
    sideChatOf: record.sideChatOf ?? null,
    sideChats: record.sideChats ?? [],
    numTurns: record.numTurns ?? null,
    handoverFrom: record.handoverFrom ?? null,
  };
}

function messagesFromRecord(workdir: string, agent: Agent, sessionId: string): { plain: TailMessage[]; rich: RichMessage[] } {
  const record = findPikiclawSession(workdir, agent, sessionId);
  const plain: TailMessage[] = [];
  const rich: RichMessage[] = [];
  if (!record) return { plain, rich };
  const createdAt = record.updatedAt || record.createdAt || null;
  if (record.lastQuestion) {
    plain.push({ role: 'user', text: record.lastQuestion });
    rich.push({ role: 'user', text: record.lastQuestion, blocks: [{ type: 'text', content: record.lastQuestion }], createdAt });
  }
  if (record.lastAnswer || record.lastThinking) {
    const blocks: MessageBlock[] = [];
    if (record.lastThinking) blocks.push({ type: 'thinking', content: record.lastThinking });
    if (record.lastAnswer) blocks.push({ type: 'text', content: record.lastAnswer });
    plain.push({ role: 'assistant', text: record.lastAnswer || '' });
    rich.push({ role: 'assistant', text: record.lastAnswer || '', blocks, createdAt });
  }
  return { plain, rich };
}

function messagesFromTranscript(transcript: SimpleTranscript): { plain: TailMessage[]; rich: RichMessage[] } {
  const plain: TailMessage[] = [];
  const rich: RichMessage[] = [];
  for (const turn of transcript.turns) {
    plain.push({ role: 'user', text: turn.user });
    rich.push({ role: 'user', text: turn.user, blocks: [{ type: 'text', content: turn.user }], createdAt: turn.createdAt });
    plain.push({ role: 'assistant', text: turn.assistant });
    rich.push({ role: 'assistant', text: turn.assistant, blocks: [{ type: 'text', content: turn.assistant }], createdAt: turn.createdAt });
  }
  return { plain, rich };
}

export function simpleCliSessions(agent: Agent, workdir: string, limit?: number): SessionListResult {
  return {
    ok: true,
    sessions: listPikiclawSessions(workdir, agent, limit).map(recordToSessionInfo),
    error: null,
  };
}

export function simpleCliSessionMessages(agent: Agent, opts: SessionMessagesOpts): SessionMessagesResult {
  const transcript = readTranscript(opts.workdir, agent, opts.sessionId);
  const { plain, rich } = transcript
    ? messagesFromTranscript(transcript)
    : messagesFromRecord(opts.workdir, agent, opts.sessionId);
  return applyTurnWindow(plain, opts, opts.rich !== false ? rich : undefined);
}

export function simpleCliSessionTail(agent: Agent, opts: SessionTailOpts): SessionTailResult {
  const result = simpleCliSessionMessages(agent, {
    sessionId: opts.sessionId,
    workdir: opts.workdir,
    lastNTurns: opts.limit,
    rich: false,
  });
  return { ok: result.ok, messages: result.messages, error: result.error };
}

export async function runSimpleCliStream(opts: StreamOpts, runOptions: SimpleCliRunOptions): Promise<StreamResult> {
  const start = Date.now();
  const sessionId = opts.sessionId || randomUUID();
  if (!opts.sessionId) {
    try { opts.onSessionId?.(sessionId); } catch {}
  }

  const priorTranscript = readTranscript(opts.workdir, runOptions.agent, sessionId);
  const prompt = runOptions.includeHistory === false
    ? opts.prompt
    : buildPromptWithHistory(opts, priorTranscript);
  const command = runOptions.buildCommand(opts, prompt, sessionId);
  const shellLine = [command.cmd, ...command.args].map(Q).join(' ');
  agentLog(`[${runOptions.agent}] full command: cd ${Q(opts.workdir)} && ${shellLine}`);

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let interrupted = false;
  let finished = false;
  const spawnEnv = processEnvWithUserBins({ ...process.env, ...(opts.extraEnv || {}), ...(command.env || {}) });
  const resolvedCmd = resolveExecutablePath(command.cmd, spawnEnv) || command.cmd;
  const child = spawn(resolvedCmd, command.args, {
    cwd: opts.workdir,
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  const emit = () => {
    try { opts.onText(stripAnsi(stdout).trimStart(), '', `${runOptions.label} running...`); } catch {}
  };
  const abortStream = () => {
    if (interrupted || child.killed) return;
    interrupted = true;
    agentWarn(`[${runOptions.agent}] user interrupt, killing process tree pid=${child.pid}`);
    terminateProcessTree(child, { signal: 'SIGTERM', forceSignal: 'SIGKILL', forceAfterMs: 5000 });
  };

  if (opts.abortSignal?.aborted) abortStream();
  opts.abortSignal?.addEventListener('abort', abortStream, { once: true });

  child.stdout?.on('data', chunk => {
    stdout += String(chunk);
    emit();
  });
  child.stderr?.on('data', chunk => {
    const text = String(chunk);
    stderr += text;
    agentLog(`[${runOptions.agent}:stderr] ${text.trim().slice(0, 200)}`);
  });

  const hardTimer = setTimeout(() => {
    timedOut = true;
    agentWarn(`[${runOptions.agent}] hard deadline reached (${opts.timeout}s), killing process tree pid=${child.pid}`);
    terminateProcessTree(child, { signal: 'SIGTERM', forceSignal: 'SIGKILL', forceAfterMs: AGENT_STREAM_HARD_KILL_GRACE_MS });
  }, opts.timeout * 1000 + AGENT_STREAM_HARD_KILL_GRACE_MS);

  const [procOk, code] = await new Promise<[boolean, number | null]>(resolve => {
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      resolve([code === 0, code]);
    });
    child.on('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      agentError(`[${runOptions.agent}] ${error.message}`);
      stderr += error.message;
      resolve([false, -1]);
    });
  });
  opts.abortSignal?.removeEventListener('abort', abortStream);

  const rawText = stripAnsi(stdout).trim();
  let parsed: SimpleCliParsedOutput | null = null;
  let parseError: string | null = null;
  if (procOk && !timedOut && !interrupted && runOptions.parseOutput) {
    try {
      parsed = runOptions.parseOutput(rawText, stderr, command);
    } catch (e: any) {
      parseError = e?.message || String(e);
    }
  }
  const text = parsed?.message?.trim() || rawText;
  const error = interrupted
    ? 'Interrupted by user.'
    : timedOut
      ? `Timed out after ${opts.timeout}s before the agent reported completion.`
      : parseError
        ? parseError
      : !procOk
        ? (normalizeErrorMessage(stderr) || normalizeErrorMessage(stdout) || `Failed (exit=${code}).`)
        : null;
  const ok = procOk && !timedOut && !interrupted && !parseError;
  const message = parseError
    ? (error || parseError)
    : text || (ok ? '(no textual response)' : (error || `Failed (exit=${code}).`));

  if (ok) {
    const now = new Date().toISOString();
    const transcript = priorTranscript || {
      version: 1,
      agent: runOptions.agent,
      sessionId,
      workdir: path.resolve(opts.workdir),
      createdAt: now,
      updatedAt: now,
      turns: [],
    } satisfies SimpleTranscript;
    transcript.updatedAt = now;
    transcript.turns.push({
      user: opts.prompt,
      assistant: message,
      model: parsed?.model ?? command.model,
      createdAt: now,
    });
    try { writeTranscript(transcript); } catch (e: any) {
      agentWarn(`[${runOptions.agent}] failed to write transcript: ${e?.message || e}`);
    }
  }

  return {
    ok,
    message,
    thinking: parsed?.thinking || null,
    plan: null,
    sessionId,
    workspacePath: null,
    model: parsed?.model ?? command.model,
    thinkingEffort: opts.thinkingEffort,
    elapsedS: (Date.now() - start) / 1000,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    contextWindow: null,
    contextUsedTokens: null,
    contextPercent: null,
    codexCumulative: null,
    error,
    stopReason: interrupted ? 'interrupted' : timedOut ? 'timeout' : ok ? 'end_turn' : null,
    incomplete: !ok,
    activity: null,
  };
}

export function simpleUsage(agent: Agent, label: string) {
  return emptyUsage(agent, `${label} does not expose usage data to pikiclaw yet.`);
}

export function dedupeModelList(agent: Agent, models: ModelInfo[]): { agent: Agent; models: ModelInfo[]; sources: string[]; note: string | null } {
  const seen = new Set<string>();
  const deduped = models.filter(model => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { agent, models: deduped, sources: [], note: null };
}
