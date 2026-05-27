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
  env: string;
  last: string;
  size: string;
  loaders: string[];
  symptom: string;
}

interface CommandSpec {
  cmd: string;
  args: string[];
  label: string;
}

const SHARE_LIBS_LOGTRACER = '/Users/michael.yang/Codes/RC/AIR/iva-share-tool-libs/packages/iva-logtracer';
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_CAPTURE_CHARS = 80_000;

export function isLogTraceSlash(prompt: string): boolean {
  return /^\/logtrace(?:\s|$)/.test(prompt.trim());
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
    env: 'lab',
    last: '24h',
    size: '10000',
    loaders: [],
    symptom: '',
  };

  for (const token of tokenize(rawArgs)) {
    const eq = token.indexOf('=');
    if (eq > 0) {
      const key = token.slice(0, eq).trim().toLowerCase();
      const value = token.slice(eq + 1).trim();
      if (!value) continue;
      if (['id', 'sessionid', 'session', 'conversationid', 'conversation'].includes(key)) parsed.id = value;
      else if (key === 'env') parsed.env = value;
      else if (key === 'last') parsed.last = value;
      else if (key === 'size') parsed.size = value;
      else if (['loader', 'loaders', 'component', 'components'].includes(key)) parsed.loaders.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      else if (['symptom', 'question', 'issue'].includes(key)) parsed.symptom = value;
      continue;
    }

    if (!parsed.id && !token.startsWith('-')) {
      parsed.id = token;
    }
  }

  return parsed;
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

function runCommand(spec: CommandSpec, extraArgs: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, [...spec.args, ...extraArgs], {
      cwd: process.cwd(),
      env: process.env,
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

export async function runLogTraceSkill(req: LogTraceRequest): Promise<LogTraceResult> {
  const args = parseLogTraceArgs(req.rawArgs);
  if (!args.id) {
    return {
      ok: false,
      error: 'logtrace id is required',
      prompt: 'The /logtrace command needs an id. Ask the user for a sessionId or conversationId, plus env and time range if needed.',
    };
  }

  const command = resolveLogTracerCommand();
  if (!command) {
    return {
      ok: false,
      error: 'iva-logtracer is not available',
      prompt: 'The controlled /logtrace workflow could not find iva-logtracer. Ask the user to install iva-logtracer or set PIKICLAW_IVA_LOGTRACER_BIN.',
    };
  }

  const traceArgs = [
    'trace',
    args.id,
    '--env',
    args.env,
    '--last',
    args.last,
    '--size',
    args.size,
    '--format',
    'json',
    '--save-json',
    '--explain-components',
  ];
  if (args.loaders.length) traceArgs.push('--loaders', ...args.loaders);

  const trace = await runCommand(command, traceArgs);
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
