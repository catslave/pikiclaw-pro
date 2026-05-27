import { useEffect, useState, type ReactNode } from 'react';
import { cn, shortenModel } from '../../utils';
import { ChevronIcon, CollapsibleCard } from '../../components/ui';
import { hasPlan } from '../../components/PlanProgressCard';
import type { StreamPlan, StreamPreviewMeta, StreamSubAgent } from '../../types';

function replaceVars(template: string, vars: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return output;
}

function toMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remSeconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, '0')}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function tokenSummary(meta: StreamPreviewMeta | null | undefined): { label: string; title: string } | null {
  if (!meta) return null;
  const input = meta.inputTokens ?? 0;
  const output = meta.outputTokens ?? 0;
  const cached = meta.cachedInputTokens ?? 0;
  const total = input + output;
  if (total <= 0 && cached <= 0) return null;
  const parts: string[] = [];
  if (meta.inputTokens != null) parts.push(`input ${meta.inputTokens.toLocaleString()}`);
  if (meta.outputTokens != null) parts.push(`output ${meta.outputTokens.toLocaleString()}`);
  if (meta.cachedInputTokens != null) parts.push(`cached ${meta.cachedInputTokens.toLocaleString()}`);
  return {
    label: `${formatTokens(total || cached)} tok`,
    title: parts.join(' · '),
  };
}

function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="shrink-0 whitespace-nowrap rounded-md border border-edge/80 bg-inset px-1.5 py-0.5 text-[10px] leading-none font-mono text-fg-5/75">
      {children}
    </span>
  );
}

function normalizeActivityLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function cleanActivityDetail(line: string): string {
  return normalizeActivityLine(line)
    .replace(/\.\.\.$/, '')
    .replace(/\s+done$/i, '')
    .trim();
}

function stripLeadingLabel(line: string, labels: string[]): string {
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return line.replace(new RegExp(`^(?:${escaped})\\s*:?\\s*`, 'i'), '').trim();
}

function pushUnique(target: string[], value: string, max = 120): void {
  const normalized = cleanActivityDetail(value);
  if (!normalized || /^(result|ok|done)$/i.test(normalized)) return;
  const clipped = normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  if (!target.includes(clipped)) target.push(clipped);
}

interface ActivityDetailGroup {
  label: string;
  items: string[];
}

interface ActivityDetailBuckets {
  files: string[];
  searches: string[];
  commands: string[];
  tools: string[];
}

function collectActivityDetails(lines: string[]): ActivityDetailBuckets {
  const files: string[] = [];
  const searches: string[] = [];
  const commands: string[] = [];
  const tools: string[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const line = cleanActivityDetail(raw);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    if (/^Executed\s+\d+\s+command/i.test(line) || /^Result:/i.test(line)) continue;

    if (/^(Bash|Shell|Command)\b/i.test(line)) {
      pushUnique(commands, stripLeadingLabel(line, ['Bash', 'Shell', 'Command']), 140);
      continue;
    }

    if (/^(Search|Grep|Glob|Find|WebSearch|Search web|Open web page)\b/i.test(line)) {
      pushUnique(searches, stripLeadingLabel(line, ['Search web', 'Open web page', 'WebSearch', 'Search', 'Grep', 'Glob', 'Find']), 120);
      continue;
    }

    if (/^(Read|Open|Edit|Write|List|Updated|Inspect image)\b/i.test(line)) {
      pushUnique(files, line, 120);
      continue;
    }

    if (/\b[A-Za-z0-9_.-]+\.(tsx?|jsx?|css|json|md|py|go|java|kt|rs|yaml|yml)\b/.test(line)) {
      pushUnique(files, line, 120);
      continue;
    }

    if (/^Use\s+/i.test(line)) {
      pushUnique(tools, line.replace(/^Use\s+/i, ''), 120);
      continue;
    }

    if (!/^(Waiting for|Human input|Applied steer input)$/i.test(line)) {
      pushUnique(tools, line, 120);
    }
  }

  return { files, searches, commands, tools };
}

function summarizeActivityDetails(lines: string[], t: (key: string) => string): ActivityDetailGroup[] {
  const { files, searches, commands, tools } = collectActivityDetails(lines);

  const makeGroup = (label: string, items: string[]): ActivityDetailGroup | null => {
    if (!items.length) return null;
    const visible = items.slice(0, 6);
    const hidden = items.length - visible.length;
    return {
      label,
      items: hidden > 0 ? [...visible, replaceVars(t('hub.activityMore'), { n: String(hidden) })] : visible,
    };
  };

  return [
    makeGroup(t('hub.activityFiles'), files),
    makeGroup(t('hub.activitySearchesDetail'), searches),
    makeGroup(t('hub.activityCommands'), commands),
    makeGroup(t('hub.activityOtherTools'), tools),
  ].filter((group): group is ActivityDetailGroup => !!group);
}

function activityFileHighlights(lines: string[], t: (key: string) => string): string[] {
  const files = collectActivityDetails(lines).files;
  if (!files.length) return [];
  const visible = files.slice(-4);
  const hidden = files.length - visible.length;
  return hidden > 0 ? [...visible, replaceVars(t('hub.activityMore'), { n: String(hidden) })] : visible;
}

function activityCommandHighlights(lines: string[], t: (key: string) => string): string[] {
  const commands = collectActivityDetails(lines).commands;
  if (!commands.length) return [];
  const visible = commands.slice(-3);
  const hidden = commands.length - visible.length;
  return hidden > 0 ? [...visible, replaceVars(t('hub.activityMore'), { n: String(hidden) })] : visible;
}

function workingActivityLabels(lines: string[], t: (key: string) => string): string[] {
  const seen = new Set<string>();
  let files = 0;
  let searches = 0;
  let commands = 0;
  let tools = 0;

  for (const raw of lines) {
    const line = normalizeActivityLine(raw);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    const executed = line.match(/Executed\s+(\d+)\s+command/i);
    if (executed) {
      commands = Math.max(commands, Number(executed[1]) || 0);
      continue;
    }
    if (/^(Bash|Shell|Command)\b/i.test(line) || /\b\/bin\/(zsh|bash|sh)\b/.test(line)) {
      commands += 1;
      continue;
    }
    if (/^(Read|Open|Edit|Write|File|Diff)\b/i.test(line) || /\b[A-Za-z0-9_.-]+\.(tsx?|jsx?|css|json|md|py|go|java|kt|rs|yaml|yml)\b/.test(line)) {
      files += 1;
      continue;
    }
    if (/^(Grep|Glob|Search|WebSearch|Find)\b/i.test(line) || /\b(rg|grep|find)\b/.test(line)) {
      searches += 1;
      continue;
    }
    if (!/^(result|ok|done)$/i.test(line)) tools += 1;
  }

  const labels: string[] = [];
  if (files > 0 && searches > 0) {
    labels.push(replaceVars(t('hub.activityExploredFilesSearches'), { files: String(files), searches: String(searches) }));
  } else {
    if (files > 0) labels.push(replaceVars(t('hub.activityExploredFiles'), { files: String(files) }));
    if (searches > 0) labels.push(replaceVars(t('hub.activitySearches'), { searches: String(searches) }));
  }
  if (commands > 0) labels.push(replaceVars(t('hub.activityRanCommands'), { n: String(commands) }));
  if (tools > 0) labels.push(replaceVars(t('hub.activityUsedTools'), { n: String(tools) }));
  return labels;
}

export function summarizeWorkingActivity(lines: string[], t: (key: string) => string): string[] {
  return workingActivityLabels(lines, t);
}

export function WorkingCard({
  phase,
  t,
  resetKey,
  defaultOpen,
  preview,
  previewText,
  startedAt,
  completedAt,
  updatedAt,
  previewMeta,
  stepCount,
  statusLabel,
  children,
  className,
}: {
  phase: 'streaming' | 'done';
  t: (key: string) => string;
  resetKey?: string | null;
  defaultOpen?: boolean;
  preview?: ReactNode;
  previewText?: string | null;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  updatedAt?: number | null;
  previewMeta?: StreamPreviewMeta | null;
  stepCount?: number;
  statusLabel?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  const initialOpen = defaultOpen ?? false;
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    setOpen(defaultOpen ?? false);
  }, [defaultOpen, phase, resetKey]);

  const startMs = toMs(startedAt);
  const doneMs = toMs(completedAt) ?? updatedAt ?? null;
  const now = useNow(phase === 'streaming' && startMs != null);
  const elapsedLabel = startMs != null
    ? formatDuration(Math.max(0, (phase === 'streaming' ? now : (doneMs ?? now)) - startMs))
    : null;
  const tokens = tokenSummary(previewMeta);
  const idleMs = phase === 'streaming' && updatedAt
    ? Math.max(0, now - updatedAt)
    : null;
  const idleLabel = idleMs != null && idleMs >= 15_000
    ? replaceVars(t('hub.workingIdleFor'), { time: formatDuration(idleMs) })
    : null;
  const countLabel = stepCount && stepCount > 0
    ? replaceVars(t('hub.workingStepCount'), { n: String(stepCount) })
    : null;
  const hasBadges = !!(elapsedLabel || idleLabel || tokens || countLabel);
  const fallbackPreview = previewText?.trim() || t('hub.workingIdle');
  const phaseLabel = statusLabel?.trim() && statusLabel.trim() !== t('hub.working')
    ? statusLabel.trim()
    : null;
  const previewNode = preview ?? (
    <span className="flex min-w-0 items-center gap-2 text-[12px] text-fg-4">
      {phaseLabel && (
        <span className="shrink-0 rounded-md border border-edge/70 bg-inset px-1.5 py-0.5 text-[10px] leading-none font-mono text-fg-5/80">
          {phaseLabel}
        </span>
      )}
      <span className="min-w-0 truncate">{fallbackPreview}</span>
    </span>
  );
  const dot = phase === 'streaming'
    ? { color: 'bg-emerald-400/70', pulse: true }
    : { color: 'bg-fg-5/35' };

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={dot}
      label={t('hub.working')}
      preview={previewNode}
      badge={hasBadges ? (
        <span className="flex shrink-0 items-center gap-1 overflow-hidden">
          {elapsedLabel && <Badge title={t('hub.workingElapsed')}>{elapsedLabel}</Badge>}
          {idleLabel && <Badge title={t('hub.workingNoRecentUpdate')}>{idleLabel}</Badge>}
          {tokens && <Badge title={tokens.title}>{tokens.label}</Badge>}
          {countLabel && <Badge>{countLabel}</Badge>}
        </span>
      ) : undefined}
      className={className}
    >
      {children || (
        <div className="px-3.5 py-3 text-[12px] text-fg-5">
          {t('hub.workingIdle')}
        </div>
      )}
    </CollapsibleCard>
  );
}

export function WorkingSection({
  label,
  children,
  defaultOpen = true,
}: {
  label?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = label && !defaultOpen;

  if (collapsible) {
    return (
      <section className="space-y-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-5/75 hover:text-fg-4 transition-colors"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <ChevronIcon open={open} className="h-3 w-3" />
          <span>{label}</span>
        </button>
        {open && children}
      </section>
    );
  }

  return (
    <section className="space-y-1.5">
      {label && <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-5/75">{label}</div>}
      {children}
    </section>
  );
}

function StepIcon({ status }: { status: StreamPlan['steps'][number]['status'] }) {
  if (status === 'completed') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-ok">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'inProgress') return <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-fg-5/25" />;
}

export function WorkingPlanList({ plan, t }: { plan?: StreamPlan | null; t: (key: string) => string }) {
  if (!hasPlan(plan)) return null;
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  const title = replaceVars(t('hub.planProgress'), {
    done: String(completed),
    total: String(plan.steps.length),
  });
  return (
    <WorkingSection label={title}>
      {plan.explanation && <div className="text-[12px] leading-[1.55] text-fg-4">{plan.explanation}</div>}
      <div className="space-y-1">
        {plan.steps.map((step, index) => (
          <div key={`${index}:${step.step}`} className="flex items-center gap-2 py-[2px]">
            <span className="flex w-[10px] shrink-0 items-center justify-center">
              <StepIcon status={step.status} />
            </span>
            <span className={cn(
              'text-[12px] leading-[1.5]',
              step.status === 'completed'
                ? 'text-fg-5 line-through decoration-fg-5/40'
                : step.status === 'inProgress'
                  ? 'text-fg-3'
                  : 'text-fg-4',
            )}>
              {step.step}
            </span>
          </div>
        ))}
      </div>
    </WorkingSection>
  );
}

export function WorkingThinkingBlock({ text, t }: { text: string; t: (key: string) => string }) {
  if (!text.trim()) return null;
  return (
    <WorkingSection label={t('hub.thinking')}>
      <div className="max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-inset px-3 py-2 text-[12px] leading-[1.7] text-fg-4">
        {text}
      </div>
    </WorkingSection>
  );
}

export function WorkingNarrativeBlock({ text, t }: { text: string; t: (key: string) => string }) {
  const cleaned = text.trim();
  if (!cleaned) return null;
  return (
    <WorkingSection label={t('hub.process')}>
      <div className="space-y-3 text-[13px] leading-[1.75] text-fg-3">
        {cleaned.split(/\n{2,}/).map((part, index) => (
          <p key={index} className="whitespace-pre-wrap break-words">
            {part.trim()}
          </p>
        ))}
      </div>
    </WorkingSection>
  );
}

export function WorkingActivitySummary({ lines, t }: { lines: string[]; t: (key: string) => string }) {
  const labels = workingActivityLabels(lines, t);
  const files = activityFileHighlights(lines, t);
  const commands = activityCommandHighlights(lines, t);
  if (!labels.length && !files.length && !commands.length) return null;
  return (
    <WorkingSection label={t('hub.activitySummary')}>
      <div className="space-y-2">
        {labels.length > 0 && (
          <div className="space-y-1">
            {labels.map((label, index) => (
              <div key={`${index}:${label}`} className="flex items-center gap-2 py-[2px] text-[12px] leading-[1.5] text-fg-5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-5/30" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-1 rounded-md bg-inset/70 px-2.5 py-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-fg-5/70">{t('hub.activityFileLog')}</div>
            {files.map((line, index) => (
              <div key={`${index}:${line}`} className="flex gap-2 text-[11px] leading-[1.55] text-fg-5">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-fg-5/35" />
                <span className="min-w-0 break-words">{line}</span>
              </div>
            ))}
          </div>
        )}
        {commands.length > 0 && (
          <div className="space-y-1 rounded-md bg-inset/70 px-2.5 py-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-fg-5/70">{t('hub.activityCommandLog')}</div>
            {commands.map((line, index) => (
              <div key={`${index}:${line}`} className="flex gap-2 text-[11px] leading-[1.55] text-fg-5">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-fg-5/35" />
                <span className="min-w-0 break-words">{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkingSection>
  );
}

export function WorkingActivityDetails({ lines, t }: { lines: string[]; t: (key: string) => string }) {
  const groups = summarizeActivityDetails(lines, t);
  if (!groups.length) return null;
  return (
    <WorkingSection label={t('hub.activityDetails')} defaultOpen={false}>
      <div className="space-y-3 rounded-md bg-inset px-3 py-2">
        {groups.map(group => (
          <div key={group.label} className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-fg-5/70">{group.label}</div>
            {group.items.map((line, index) => (
              <div key={`${group.label}:${index}:${line}`} className="flex gap-2 text-[11px] leading-[1.55] text-fg-5">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-fg-5/35" />
                <span className="min-w-0 break-words">{line}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </WorkingSection>
  );
}

export function WorkingDiagnostics({ diagnostics, t }: { diagnostics?: string[] | null; t: (key: string) => string }) {
  const items = (diagnostics || []).map(normalizeActivityLine).filter(Boolean).slice(-6);
  if (!items.length) return null;
  return (
    <WorkingSection label={t('hub.diagnostics')} defaultOpen={false}>
      <div className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
        {items.map((line, index) => (
          <div key={`${index}:${line}`} className="flex gap-2 text-[11px] leading-[1.55] text-amber-200/85">
            <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-amber-300/65" />
            <span className="min-w-0 break-words">{line}</span>
          </div>
        ))}
      </div>
    </WorkingSection>
  );
}

export function WorkingSubAgentList({ subAgents, t }: { subAgents?: StreamSubAgent[] | null; t: (key: string) => string }) {
  if (!subAgents?.length) return null;
  return (
    <WorkingSection label={t('hub.subAgent')}>
      <div className="space-y-1">
        {subAgents.map(sub => {
          const dot = sub.status === 'failed' ? 'bg-rose-400/70'
            : sub.status === 'done' ? 'bg-emerald-400/70'
              : 'bg-amber-400/70';
          const model = sub.model ? shortenModel(sub.model) : null;
          const title = sub.kind ? `${sub.kind}${sub.description ? ` · ${sub.description}` : ''}` : (sub.description || t('hub.subAgent'));
          return (
            <div key={sub.id} className="flex min-w-0 items-center gap-2 py-[2px]">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot, sub.status === 'running' && 'animate-pulse')} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-4">{title}</span>
              {model && <span className="shrink-0 text-[10px] font-mono text-fg-5/55">{model}</span>}
              {sub.tools.length > 0 && <span className="shrink-0 text-[10px] font-mono text-fg-5/55">{sub.tools.length}</span>}
            </div>
          );
        })}
      </div>
    </WorkingSection>
  );
}
