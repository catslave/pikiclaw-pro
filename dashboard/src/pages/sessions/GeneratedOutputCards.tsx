import { cn } from '../../utils';
import { parseFileLinkTarget, type FileLinkTarget, type OpenFileLinkHandler } from './markdown';

type GeneratedCheckStatus = 'passed' | 'failed' | 'blocked' | 'neutral';

export interface GeneratedFileInsight {
  target: FileLinkTarget;
  label: string;
}

export interface GeneratedCheckInsight {
  command: string;
  status: GeneratedCheckStatus;
  detail: string;
}

export interface GeneratedActionInsight {
  label: string;
  done: boolean;
}

export interface GeneratedOutputInsights {
  files: GeneratedFileInsight[];
  checks: GeneratedCheckInsight[];
  actions: GeneratedActionInsight[];
}

const GENERATED_FILE_LIMIT = 6;
const GENERATED_CHECK_LIMIT = 4;
const GENERATED_ACTION_LIMIT = 5;

const COMMAND_PATTERN = /\b(npm|npx|pnpm|yarn|bun|git|node|python|python3|pytest|vitest|tsc|eslint|cargo|go|make|docker|kubectl|curl)\b[^`|;\n]*/i;
const LINE_COMMAND_PATTERN = /^(?:[-*]\s*)?(?:[$>]\s*)?(npm|npx|pnpm|yarn|bun|git|node|python|python3|pytest|vitest|tsc|eslint|cargo|go|make|docker|kubectl|curl)\b[^`|;\n]*/i;
const ROOT_FILE_PATTERN = /^[A-Za-z0-9._-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|markdown|css|scss|sass|html|py|go|rs|java|kt|swift|rb|php|sh|bash|zsh|yml|yaml|toml|xml|sql|graphql|proto|lock|env)(?::\d+)?$/i;

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^['"`(<]+/, '')
    .replace(/[,'"`)>.;]+$/, '');
}

function fileTargetFromCandidate(value: string): FileLinkTarget | null {
  const candidate = cleanCandidate(value);
  if (!candidate || /\s/.test(candidate) || /^https?:\/\//i.test(candidate)) return null;
  const parsed = parseFileLinkTarget(candidate);
  if (parsed) return parsed;
  if (!ROOT_FILE_PATTERN.test(candidate)) return null;
  const lineMatch = candidate.match(/^(.*):(\d+)$/);
  if (lineMatch) return { path: lineMatch[1], line: Number(lineMatch[2]) };
  return { path: candidate };
}

function fileLabel(target: FileLinkTarget): string {
  const parts = target.path.split(/[\\/]/).filter(Boolean);
  const body = parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : (parts.join('/') || target.path);
  return target.line ? `${body}:${target.line}` : body;
}

function collectFileInsights(text: string): GeneratedFileInsight[] {
  const out: GeneratedFileInsight[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const target = fileTargetFromCandidate(raw);
    if (!target) return;
    const key = `${target.path}:${target.line || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ target, label: fileLabel(target) });
  };

  const markdownLinkPattern = /\[[^\]]{0,240}\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(text))) {
    const href = match[1].trim().replace(/\s+["'][^"']*["']\s*$/, '');
    add(href);
    if (out.length >= GENERATED_FILE_LIMIT) return out;
  }

  const inlineCodePattern = /`([^`\n]{1,220})`/g;
  while ((match = inlineCodePattern.exec(text))) {
    add(match[1]);
    if (out.length >= GENERATED_FILE_LIMIT) return out;
  }

  return out;
}

function classifyCheckStatus(line: string): GeneratedCheckStatus {
  if (/(blocked|not run|not-run|skipped|无法|未运行|跳过|阻塞)/i.test(line)) return 'blocked';
  if (/(fail|failed|failure|error|失败|报错|未通过)/i.test(line)) return 'failed';
  if (/(pass|passed|success|successful|ok|✓|通过|成功)/i.test(line)) return 'passed';
  return 'neutral';
}

function cleanCommand(value: string): string {
  return value
    .trim()
    .replace(/^[$>]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 140);
}

function collectCheckInsights(text: string): GeneratedCheckInsight[] {
  const out: GeneratedCheckInsight[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const codeSpans = Array.from(line.matchAll(/`([^`\n]{1,180})`/g)).map(match => match[1]);
    const candidates = codeSpans.length ? codeSpans : [line];
    for (const candidate of candidates) {
      const commandMatch = codeSpans.length ? candidate.match(COMMAND_PATTERN) : candidate.match(LINE_COMMAND_PATTERN);
      if (!commandMatch) continue;
      const command = cleanCommand(commandMatch[0]);
      if (!command || seen.has(command)) continue;
      seen.add(command);
      out.push({
        command,
        status: classifyCheckStatus(line),
        detail: line.replace(/^[-*]\s*/, '').slice(0, 220),
      });
      if (out.length >= GENERATED_CHECK_LIMIT) return out;
    }
  }
  return out;
}

function collectActionInsights(text: string): GeneratedActionInsight[] {
  const out: GeneratedActionInsight[] = [];
  const taskPattern = /^\s*[-*]\s+\[([ xX])]\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = taskPattern.exec(text))) {
    const label = match[2].trim();
    if (!label) continue;
    out.push({ label: label.slice(0, 180), done: match[1].toLowerCase() === 'x' });
    if (out.length >= GENERATED_ACTION_LIMIT) break;
  }
  return out;
}

export function buildGeneratedOutputInsights(text: string | null | undefined): GeneratedOutputInsights {
  const value = String(text || '').trim();
  if (!value) return { files: [], checks: [], actions: [] };
  return {
    files: collectFileInsights(value),
    checks: collectCheckInsights(value),
    actions: collectActionInsights(value),
  };
}

function hasInsights(insights: GeneratedOutputInsights): boolean {
  return insights.files.length > 0 || insights.checks.length > 0 || insights.actions.length > 0;
}

function fallbackT(key: string): string {
  const labels: Record<string, string> = {
    'hub.generatedView': 'Review cards',
    'hub.generatedFiles': 'Files',
    'hub.generatedChecks': 'Checks',
    'hub.generatedActions': 'Next',
    'hub.checkPassed': 'Passed',
    'hub.checkFailed': 'Failed',
    'hub.checkBlocked': 'Blocked',
    'hub.checkNeutral': 'Check',
  };
  return labels[key] || key;
}

function CheckStatusDot({ status }: { status: GeneratedCheckStatus }) {
  return (
    <span
      className={cn(
        'mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full',
        status === 'passed' && 'bg-ok/75',
        status === 'failed' && 'bg-err/75',
        status === 'blocked' && 'bg-warn/80',
        status === 'neutral' && 'bg-fg-5/55',
      )}
    />
  );
}

function checkStatusLabel(status: GeneratedCheckStatus, t: (key: string) => string): string {
  if (status === 'passed') return t('hub.checkPassed');
  if (status === 'failed') return t('hub.checkFailed');
  if (status === 'blocked') return t('hub.checkBlocked');
  return t('hub.checkNeutral');
}

export function GeneratedOutputCards({
  text,
  t = fallbackT,
  onOpenFileLink,
  className,
  compact = false,
}: {
  text: string | null | undefined;
  t?: (key: string) => string;
  onOpenFileLink?: OpenFileLinkHandler;
  className?: string;
  compact?: boolean;
}) {
  const insights = buildGeneratedOutputInsights(text);
  if (!hasInsights(insights)) return null;
  const cardClass = cn(
    'min-w-0 rounded-md border border-edge/45 bg-panel/48 px-3 py-2',
    compact && 'px-2.5 py-2',
  );
  return (
    <div className={cn('not-prose grid min-w-0 gap-2 md:grid-cols-3', className)}>
      {insights.files.length > 0 && (
        <section className={cardClass}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-4">{t('hub.generatedFiles')}</div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {insights.files.map(file => (
              <button
                key={`${file.target.path}:${file.target.line || ''}`}
                type="button"
                onClick={() => onOpenFileLink?.(file.target)}
                disabled={!onOpenFileLink}
                className={cn(
                  'min-w-0 max-w-full rounded border border-edge/55 bg-inset/40 px-1.5 py-1 font-mono text-[10.5px] text-fg-3',
                  onOpenFileLink && 'transition-colors hover:border-primary/35 hover:bg-primary/[0.06] hover:text-fg',
                  !onOpenFileLink && 'cursor-default',
                )}
                title={file.target.line ? `${file.target.path}:${file.target.line}` : file.target.path}
              >
                <span className="block max-w-[180px] truncate">{file.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {insights.checks.length > 0 && (
        <section className={cardClass}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ok/70" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-4">{t('hub.generatedChecks')}</div>
          </div>
          <div className="space-y-1.5">
            {insights.checks.map(check => (
              <div key={check.command} className="flex min-w-0 gap-2">
                <CheckStatusDot status={check.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-[10px] font-semibold text-fg-5">{checkStatusLabel(check.status, t)}</span>
                    <span className="min-w-0 truncate font-mono text-[10.5px] text-fg-3" title={check.command}>{check.command}</span>
                  </div>
                  {check.detail !== check.command && (
                    <div className="mt-0.5 line-clamp-1 text-[10.5px] text-fg-5" title={check.detail}>{check.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {insights.actions.length > 0 && (
        <section className={cardClass}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-warn/75" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-4">{t('hub.generatedActions')}</div>
          </div>
          <div className="space-y-1.5">
            {insights.actions.map((action, index) => (
              <div key={`${action.label}:${index}`} className="flex min-w-0 items-start gap-2 text-[11px] leading-snug text-fg-3">
                <span className={cn(
                  'mt-[1px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[9px]',
                  action.done ? 'border-ok/35 bg-ok/[0.08] text-ok' : 'border-edge/60 bg-inset/40 text-transparent',
                )}>
                  {action.done ? '✓' : ''}
                </span>
                <span className={cn('min-w-0 break-words', action.done && 'text-fg-5 line-through')}>{action.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
