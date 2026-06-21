import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface LogTraceRequest {
  rawArgs: string;
  sessionWorkspace: string;
}

export interface LogTraceResult {
  ok: boolean;
  prompt: string;
  artifactPath?: string;
  traceOutputDir?: string;
  error?: string;
}

interface ParsedLogTraceArgs {
  id: string;
  idField: string;
  env: string;
  last: string;
  size: string;
  mode: 'trace' | 'search' | 'stats';
  loaders: string[];
  symptom: string;
  query: string;
  index: string;
  groupBy: string;
  limit: string;
}

interface CommandSpec {
  cmd: string;
  args: string[];
  label: string;
}

const SHARE_LIBS_LOGTRACER = '/Users/michael.yang/Codes/RC/AIR/iva-share-tool-libs/packages/iva-logtracer';
const IVA_LOGTRACER_CONFIG_DIR = path.join(os.homedir(), '.config', 'iva-logtracer');
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_CAPTURE_CHARS = 80_000;
const DEFAULT_TRACE_SIZE = '10000';
const DEFAULT_LOG_SEARCH_SIZE = '200';
const DEFAULT_STATS_LIMIT = '20';
const DEFAULT_STATS_GROUP_BY = 'kubernetes.container.name';
const LOG_TRACE_SLASH_RE = /^\/(?:logtrace|logstrace)(?:\s|$)/;

export function isLogTraceSlash(prompt: string): boolean {
  return LOG_TRACE_SLASH_RE.test(prompt.trim());
}

export function stripLogTraceSlash(prompt: string): string {
  return prompt.trim().replace(LOG_TRACE_SLASH_RE, '').trimStart();
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(["'])/g, '$1'));
  }
  return tokens;
}

export function parseLogTraceArgs(rawArgs: string): ParsedLogTraceArgs {
  const parsed: ParsedLogTraceArgs = {
    id: '',
    idField: 'conversationId',
    env: 'lab',
    last: '24h',
    size: '',
    mode: 'trace',
    loaders: [],
    symptom: '',
    query: '',
    index: '',
    groupBy: DEFAULT_STATS_GROUP_BY,
    limit: DEFAULT_STATS_LIMIT,
  };
  let explicitMode = false;
  let explicitIdField = false;
  let statsHint = false;

  for (const token of tokenize(rawArgs)) {
    const eq = token.indexOf('=');
    if (eq > 0) {
      const key = token.slice(0, eq).trim().toLowerCase();
      const value = unquoteTokenValue(token.slice(eq + 1).trim());
      if (!value) continue;
      if (key === 'id') {
        parsed.id = value;
        if (!explicitIdField) parsed.idField = 'conversationId';
      }
      else if (['conversationid', 'converstaionid', 'conversation'].includes(key)) {
        parsed.id = value;
        parsed.idField = 'conversationId';
        explicitIdField = true;
      }
      else if (['traceid', 'trace_id', 'trace'].includes(key)) {
        parsed.id = value;
        parsed.idField = 'trace_id';
        explicitIdField = true;
      }
      else if (['sessionid', 'session'].includes(key)) {
        parsed.id = value;
        parsed.idField = 'sessionId';
        explicitIdField = true;
      }
      else if (['requestid', 'request_id', 'request', 'taskid', 'task_id', 'task', 'turnid', 'turn_id', 'turn'].includes(key)) {
        parsed.id = value;
        parsed.idField = normalizeLogField(key);
        explicitIdField = true;
      }
      else if (key === 'env') parsed.env = value;
      else if (key === 'last') parsed.last = value;
      else if (key === 'size') parsed.size = value;
      else if (['mode', 'action', 'type'].includes(key)) {
        parsed.mode = normalizeMode(value);
        explicitMode = true;
      }
      else if (['field', 'idfield', 'id_field', 'filterfield'].includes(key)) {
        parsed.idField = normalizeLogField(value);
        explicitIdField = true;
      }
      else if (['query', 'q', 'kql', 'lucene', 'filter', 'condition', 'where'].includes(key)) parsed.query = value;
      else if (key === 'index') parsed.index = value;
      else if (['by', 'groupby', 'group_by', 'group'].includes(key)) {
        parsed.groupBy = value;
        statsHint = true;
      }
      else if (key === 'limit') {
        parsed.limit = value;
        statsHint = true;
      }
      else if (['loader', 'loaders', 'component', 'components'].includes(key)) parsed.loaders.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      else if (['symptom', 'question', 'issue'].includes(key)) parsed.symptom = value;
      continue;
    }

    const mode = normalizeMode(token);
    if (mode !== 'trace' || ['trace', 'search', 'stats', 'stat', 'count', 'agg', 'aggregate'].includes(token.toLowerCase())) {
      parsed.mode = mode;
      explicitMode = true;
      continue;
    }

    if (!parsed.id && !token.startsWith('-')) {
      parsed.id = token;
    }
  }

  if (!explicitMode) {
    if (statsHint) parsed.mode = 'stats';
    else if (isLogSearchField(parsed.idField)) {
      parsed.mode = statsHint ? 'stats' : 'search';
    }
    else if (parsed.query || parsed.index) parsed.mode = 'search';
  }

  return parsed;
}

function unquoteTokenValue(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1).replace(/\\(["'])/g, '$1');
    }
  }
  return value;
}

function normalizeMode(value: string): ParsedLogTraceArgs['mode'] {
  const mode = value.trim().toLowerCase();
  if (['search', 'query', 'find', 'grep', 'logs', 'log'].includes(mode)) return 'search';
  if (['stats', 'stat', 'count', 'agg', 'aggregate', 'classify', 'classification'].includes(mode)) return 'stats';
  return 'trace';
}

function normalizeLogField(value: string): string {
  const field = value.trim();
  const compact = field.toLowerCase().replace(/[-_\s]/g, '');
  if (compact === 'conversationid' || compact === 'conversation') return 'conversationId';
  if (compact === 'sessionid' || compact === 'session') return 'sessionId';
  if (compact === 'traceid' || compact === 'trace') return 'trace_id';
  if (compact === 'requestid' || compact === 'request') return 'requestId';
  if (compact === 'taskid' || compact === 'task') return 'taskId';
  if (compact === 'turnid' || compact === 'turn') return 'turnId';
  return field;
}

function isLogSearchField(field: string): boolean {
  return field !== 'conversationId' && field !== 'sessionId';
}

function summarizeTraceFailure(trace: { code: number | null; stderr: string; timedOut: boolean }): string | undefined {
  if (trace.timedOut) return 'iva-logtracer timed out';
  const stderr = trace.stderr.trim();
  if (!stderr) return undefined;
  const explicitError = stderr.match(/(?:❌\s*)?Error:\s*(.+)/);
  const message = explicitError?.[1]?.trim() || stderr.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  if (!message) return undefined;
  if (message.includes("unknown url type: '/login'")) {
    return `${message}. Check the selected iva-logtracer env file; KIBANA_ES_URL is likely missing or invalid.`;
  }
  return message;
}

function hasExecutableOnPath(bin: string): boolean {
  const paths = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of paths) {
    for (const suffix of suffixes) {
      try {
        fs.accessSync(path.join(dir, `${bin}${suffix}`), fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

function splitCommandLine(value: string): string[] {
  return tokenize(value).filter(Boolean);
}

function resolveLogTracerCommand(): CommandSpec | null {
  const configured = process.env.PIKICLAW_IVA_LOGTRACER_BIN?.trim();
  if (configured) {
    const parts = splitCommandLine(configured);
    if (parts.length) return { cmd: parts[0], args: parts.slice(1), label: configured };
  }
  if (hasExecutableOnPath('iva-logtracer')) {
    return { cmd: 'iva-logtracer', args: [], label: 'iva-logtracer' };
  }
  if (hasExecutableOnPath('uv') && fs.existsSync(path.join(SHARE_LIBS_LOGTRACER, 'pyproject.toml'))) {
    return {
      cmd: 'uv',
      args: ['run', '--project', SHARE_LIBS_LOGTRACER, 'iva-logtracer'],
      label: `uv run --project ${SHARE_LIBS_LOGTRACER} iva-logtracer`,
    };
  }
  return null;
}

function resolveKibanaQueryCommand(): CommandSpec | null {
  const configured = process.env.PIKICLAW_KIBANA_QUERY_BIN?.trim();
  if (configured) {
    const parts = splitCommandLine(configured);
    if (parts.length) return { cmd: parts[0], args: parts.slice(1), label: configured };
  }
  if (hasExecutableOnPath('kibana-query')) {
    return { cmd: 'kibana-query', args: [], label: 'kibana-query' };
  }
  return null;
}

function runCommand(
  spec: CommandSpec,
  extraArgs: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, [...spec.args, ...extraArgs], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000).unref();
    }, timeoutMs);
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf-8');
      return next.length > MAX_CAPTURE_CHARS ? next.slice(next.length - MAX_CAPTURE_CHARS) : next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || err.message, timedOut });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function findOutputDir(stdout: string): string | null {
  const match = stdout.match(/Output directory:\s*(.+)$/mi);
  return match ? match[1].trim() : null;
}

function readTextIfSmall(filePath: string, maxChars: number): string {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
  } catch {
    return '';
  }
}

function safeFileSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'logtrace';
}

export function resolveIvaLogTracerEnvFile(env: string): string | null {
  const configured = process.env.PIKICLAW_IVA_LOGTRACER_ENV_FILE?.trim()
    || process.env.IVA_LOGTRACER_ENV_FILE?.trim()
    || '';
  if (configured && fs.existsSync(configured)) return configured;

  const cleanEnv = env.trim();
  const candidates = [
    cleanEnv ? path.join(IVA_LOGTRACER_CONFIG_DIR, `.env.${cleanEnv}`) : '',
    path.join(IVA_LOGTRACER_CONFIG_DIR, '.env'),
  ].filter(Boolean);
  return candidates.find(filePath => fs.existsSync(filePath)) || null;
}

export function buildKibanaEnvArgs(env: string): string[] {
  const cleanEnv = env.trim() || 'lab';
  const envFile = resolveIvaLogTracerEnvFile(cleanEnv);
  return [
    '--env',
    cleanEnv,
    ...(envFile ? ['--env-file', envFile] : []),
  ];
}

function logTraceCommandEnv(env: string): NodeJS.ProcessEnv {
  const envFile = resolveIvaLogTracerEnvFile(env);
  return envFile ? { IVA_LOGTRACER_ENV_FILE: envFile } : {};
}

function boundedIntString(value: string, fallback: string, max: number): string {
  const parsed = Number.parseInt(value || fallback, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return String(Math.min(parsed, max));
}

function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildKibanaQuery(args: ParsedLogTraceArgs): string {
  const filters: string[] = [];
  if (args.id) filters.push(`${args.idField}:"${escapeQueryValue(args.id)}"`);
  if (args.query) filters.push(filters.length ? `(${args.query})` : args.query);
  return filters.join(' AND ');
}

function buildTraceCommandArgs(args: ParsedLogTraceArgs, legacy = false): string[] {
  const traceArgs = [
    ...(legacy ? [] : ['trace']),
    args.id,
    '--env',
    args.env,
    '--last',
    args.last,
    '--size',
    boundedIntString(args.size, DEFAULT_TRACE_SIZE, 50_000),
    '--format',
    'json',
    '--save-json',
    '--explain-components',
  ];
  if (args.loaders.length) traceArgs.push('--loaders', ...args.loaders);
  return traceArgs;
}

function shouldRetryLegacyTrace(trace: { code: number | null; stdout: string; stderr: string; timedOut: boolean }): boolean {
  if (trace.timedOut || trace.code === 0) return false;
  const output = `${trace.stderr}\n${trace.stdout}`;
  return /usage:\s*iva-logtracer\s+\[-h\]/.test(output) && !/usage:\s*iva-logtracer\s+trace\s+\[-h\]/.test(output);
}

function buildAnalysisPrompt(args: ParsedLogTraceArgs, opts: {
  commandLabel: string;
  traceArgs: string[];
  traceCode: number | null;
  traceTimedOut: boolean;
  traceStdout: string;
  traceStderr: string;
  reportStdout: string;
  reportStderr: string;
  traceOutputDir: string | null;
  artifactPath: string;
}): string {
  const summaryPath = opts.traceOutputDir ? path.join(opts.traceOutputDir, 'summary.json') : '';
  const combinePath = opts.traceOutputDir ? path.join(opts.traceOutputDir, 'combine.log') : '';
  const summary = summaryPath ? readTextIfSmall(summaryPath, 16_000) : '';
  const combine = combinePath ? readTextIfSmall(combinePath, 32_000) : '';

  return [
    'Analyze this controlled log trace result from Pikiclaw.',
    '',
    'Required response shape:',
    '1. Start with an overall log summary: environment, target id, time range, components/files observed, and whether the trace is complete enough.',
    '2. Analyze whether the logs show abnormalities. Call out errors, timeouts, missing component coverage, failed tool calls, silence/latency symptoms, or suspicious gaps.',
    '3. If abnormalities exist, explain likely cause, evidence, confidence, and suggested next checks. If not, say no confirmed abnormality was found and list residual uncertainty.',
    '4. Keep full IDs visible. Do not invent evidence beyond the command output and files below.',
    '',
    'Trace request:',
    JSON.stringify({ id: args.id, env: args.env, last: args.last, size: args.size, loaders: args.loaders, symptom: args.symptom || null }, null, 2),
    '',
    `Command runner: ${opts.commandLabel}`,
    `Command args: ${opts.traceArgs.join(' ')}`,
    `Exit code: ${opts.traceCode ?? 'unknown'}${opts.traceTimedOut ? ' (timed out)' : ''}`,
    `Trace output directory: ${opts.traceOutputDir || 'not found in stdout'}`,
    `Pikiclaw artifact: ${opts.artifactPath}`,
    '',
    'Trace stdout:',
    '```text',
    opts.traceStdout || '(empty)',
    '```',
    '',
    'Trace stderr:',
    '```text',
    opts.traceStderr || '(empty)',
    '```',
    '',
    'Diagnostic report output:',
    '```markdown',
    opts.reportStdout || '(not generated)',
    '```',
    '',
    opts.reportStderr ? ['Diagnostic report stderr:', '```text', opts.reportStderr, '```'].join('\n') : '',
    summary ? ['summary.json:', '```json', summary, '```'].join('\n') : '',
    combine ? ['combine.log excerpt:', '```text', combine, '```'].join('\n') : '',
  ].filter(Boolean).join('\n');
}

async function runTraceMode(req: LogTraceRequest, args: ParsedLogTraceArgs): Promise<LogTraceResult> {
  const command = resolveLogTracerCommand();
  if (!command) {
    return {
      ok: false,
      error: 'iva-logtracer is not available',
      prompt: 'The controlled /logtrace workflow could not find iva-logtracer. Ask the user to install iva-logtracer or set PIKICLAW_IVA_LOGTRACER_BIN.',
    };
  }

  let traceArgs = buildTraceCommandArgs(args);
  const commandEnv = logTraceCommandEnv(args.env);
  let trace = await runCommand(command, traceArgs, DEFAULT_TIMEOUT_MS, commandEnv);
  if (shouldRetryLegacyTrace(trace)) {
    traceArgs = buildTraceCommandArgs(args, true);
    trace = await runCommand(command, traceArgs, DEFAULT_TIMEOUT_MS, commandEnv);
  }
  const outputDir = findOutputDir(trace.stdout);

  let reportStdout = '';
  let reportStderr = '';
  if (outputDir && fs.existsSync(outputDir)) {
    const reportArgs = ['report', outputDir, '--format', 'markdown', '--lang', 'zh'];
    if (args.symptom) reportArgs.push('--reported-symptom', args.symptom);
    const report = await runCommand(command, reportArgs, 120_000);
    reportStdout = report.stdout;
    reportStderr = report.stderr;
  }

  const artifactDir = path.join(req.sessionWorkspace || os.tmpdir(), 'platform-skills');
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${safeFileSlug(args.id)}-logtrace.md`);
  const prompt = buildAnalysisPrompt(args, {
    commandLabel: command.label,
    traceArgs,
    traceCode: trace.code,
    traceTimedOut: trace.timedOut,
    traceStdout: trace.stdout,
    traceStderr: trace.stderr,
    reportStdout,
    reportStderr,
    traceOutputDir: outputDir,
    artifactPath,
  });
  fs.writeFileSync(artifactPath, prompt, 'utf-8');

  const failureSummary = summarizeTraceFailure(trace);
  return {
    ok: trace.code === 0 && !trace.timedOut,
    prompt,
    artifactPath,
    traceOutputDir: outputDir || undefined,
    error: trace.code === 0 && !trace.timedOut
      ? undefined
      : `iva-logtracer exited with ${trace.code ?? 'unknown'}${trace.timedOut ? ' after timeout' : ''}${failureSummary ? `: ${failureSummary}` : ''}`,
  };
}

function buildKibanaPrompt(args: ParsedLogTraceArgs, opts: {
  commandLabel: string;
  commandArgs: string[];
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  artifactPath: string;
  query: string;
}): string {
  const requiredShape = args.mode === 'stats'
    ? [
        'Required response shape:',
        '1. Start with the statistics scope: environment, query, time range, index, grouping field, and whether the result is complete enough.',
        '2. Summarize the top buckets or categories with counts/percentages when visible.',
        '3. Classify notable error clusters, noisy components, repeated messages, or missing categories. Distinguish raw bucket evidence from inference.',
        '4. Suggest one or two tighter follow-up searches if the aggregation is too coarse.',
      ]
    : [
        'Required response shape:',
        '1. Start with the log lookup scope: environment, query, time range, index, sample size, and whether the result is complete enough.',
        '2. Summarize the matching logs by time, service/component, severity, and repeated messages.',
        '3. Analyze abnormalities such as errors, exceptions, timeouts, retries, missing events, or suspicious gaps.',
        '4. If no confirmed abnormality is visible, say so and list residual uncertainty.',
      ];

  return [
    `Analyze this controlled ${args.mode === 'stats' ? 'Kibana log statistics' : 'Kibana log search'} result from Pikiclaw.`,
    '',
    ...requiredShape,
    '5. Keep full IDs visible. Do not invent evidence beyond the command output below.',
    '',
    'Log request:',
    JSON.stringify({
      mode: args.mode,
      env: args.env,
      id: args.id || null,
      idField: args.id ? args.idField : null,
      query: opts.query,
      last: args.last,
      size: args.size || null,
      index: args.index || null,
      groupBy: args.mode === 'stats' ? args.groupBy : null,
      limit: args.mode === 'stats' ? args.limit : null,
    }, null, 2),
    '',
    `Command runner: ${opts.commandLabel}`,
    `Command args: ${opts.commandArgs.join(' ')}`,
    `Exit code: ${opts.code ?? 'unknown'}${opts.timedOut ? ' (timed out)' : ''}`,
    `Pikiclaw artifact: ${opts.artifactPath}`,
    '',
    'Command stdout:',
    '```text',
    opts.stdout || '(empty)',
    '```',
    '',
    'Command stderr:',
    '```text',
    opts.stderr || '(empty)',
    '```',
  ].join('\n');
}

async function runKibanaMode(req: LogTraceRequest, args: ParsedLogTraceArgs): Promise<LogTraceResult> {
  const query = buildKibanaQuery(args);
  if (!query) {
    return {
      ok: false,
      error: 'log query is required',
      prompt: 'The /logtrace search/stats command needs a conversationId, sessionId, id, or query/filter condition. Ask the user for the missing log condition.',
    };
  }

  const command = resolveKibanaQueryCommand();
  if (!command) {
    return {
      ok: false,
      error: 'kibana-query is not available',
      prompt: 'The controlled /logtrace search/stats workflow could not find kibana-query. Ask the user to install kibana-query or set PIKICLAW_KIBANA_QUERY_BIN.',
    };
  }

  const commonArgs = [...buildKibanaEnvArgs(args.env), '--last', args.last, '--format', 'json'];
  if (args.index) commonArgs.push('--index', args.index);
  const commandArgs = args.mode === 'stats'
    ? [
        'agg',
        '--preset',
        'top_terms',
        '--field',
        args.groupBy || DEFAULT_STATS_GROUP_BY,
        '--limit',
        boundedIntString(args.limit, DEFAULT_STATS_LIMIT, 100),
        '--query',
        query,
        ...commonArgs,
      ]
    : [
        'search',
        query,
        ...commonArgs,
        '--size',
        boundedIntString(args.size, DEFAULT_LOG_SEARCH_SIZE, 10_000),
      ];

  const result = await runCommand(command, commandArgs);
  const artifactDir = path.join(req.sessionWorkspace || os.tmpdir(), 'platform-skills');
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${safeFileSlug(args.id || args.query || args.mode)}-logtrace-${args.mode}.md`);
  const prompt = buildKibanaPrompt(args, {
    commandLabel: command.label,
    commandArgs,
    code: result.code,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    artifactPath,
    query,
  });
  fs.writeFileSync(artifactPath, prompt, 'utf-8');

  const stderr = result.stderr.trim();
  return {
    ok: result.code === 0 && !result.timedOut,
    prompt,
    artifactPath,
    error: result.code === 0 && !result.timedOut
      ? undefined
      : `kibana-query exited with ${result.code ?? 'unknown'}${result.timedOut ? ' after timeout' : ''}${stderr ? `: ${stderr.split(/\r?\n/).find(Boolean)}` : ''}`,
  };
}

export async function runLogTraceSkill(req: LogTraceRequest): Promise<LogTraceResult> {
  const args = parseLogTraceArgs(req.rawArgs);
  if (args.mode === 'trace' && !args.id) {
    return {
      ok: false,
      error: 'logtrace id is required',
      prompt: 'The /logtrace command needs an id. Ask the user for a sessionId or conversationId, plus env and time range if needed.',
    };
  }
  if (args.mode === 'trace') return runTraceMode(req, args);
  return runKibanaMode(req, args);
}
