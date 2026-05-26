import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Dot, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { Agent, AgentRuntimeStatus, AgentStatusResponse, AppState, UsageResult, UsageWindowInfo } from '../../types';
import { formatUsageSummary, usageBadgeText, usageTone } from '../../usage';
import { cn, getAgentMeta } from '../../utils';

const AGENT_ORDER: Agent[] = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'hermes'];

type Tone = 'ok' | 'warn' | 'err' | 'muted';

interface UsageWindowRow {
  agent: AgentRuntimeStatus;
  window: UsageWindowInfo;
  usedPercent: number | null;
  remainingPercent: number | null;
  tone: Tone;
}

function formatTokens(value: number | null | undefined): string {
  const n = Math.max(0, Number(value || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '--' : `${Math.round(value)}%`;
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function formatDateTime(value: string | null | undefined): string {
  const time = parseTime(value);
  if (!time) return '--';
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeReset(value: string | null | undefined, t: (key: string) => string): string {
  const time = parseTime(value);
  if (!time) return t('usage.unknown');
  const deltaMs = time - Date.now();
  if (deltaMs <= 0) return t('usage.now');
  const minutes = Math.ceil(deltaMs / 60_000);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function windowTone(usage: UsageResult | null, window: UsageWindowInfo): Tone {
  if (!usage?.ok) return 'err';
  const status = (window.status || usage.status || '').toLowerCase();
  if (status.includes('limit') || status.includes('exhaust') || status.includes('error')) return 'err';
  if (status.includes('warn') || status.includes('low') || status.includes('tight')) return 'warn';
  const used = window.usedPercent;
  if (used != null && used >= 95) return 'err';
  if (used != null && used >= 80) return 'warn';
  return 'ok';
}

function toneBadgeVariant(tone: Tone): 'ok' | 'warn' | 'err' | 'muted' {
  if (tone === 'ok') return 'ok';
  if (tone === 'warn') return 'warn';
  if (tone === 'err') return 'err';
  return 'muted';
}

function usageStatusLabel(usage: UsageResult | null, t: (key: string) => string): string {
  if (!usage?.ok) return t('usage.unavailable');
  const label = usageBadgeText(usage);
  if (label === 'unavailable') return t('usage.unavailable');
  if (label === 'ok') return 'OK';
  return label;
}

function normalizeUsageWindow(agent: AgentRuntimeStatus, window: UsageWindowInfo): UsageWindowRow {
  const usedPercent = window.usedPercent ?? (window.remainingPercent != null ? 100 - window.remainingPercent : null);
  const remainingPercent = window.remainingPercent ?? (usedPercent != null ? 100 - usedPercent : null);
  return {
    agent,
    window,
    usedPercent,
    remainingPercent,
    tone: windowTone(agent.usage, window),
  };
}

function ProgressBar({ value, tone }: { value: number | null; tone: Tone }) {
  return (
    <div className="h-2 overflow-hidden rounded-sm bg-inset">
      <div
        className={cn(
          'h-full rounded-sm transition-[width] duration-300',
          tone === 'ok' && 'bg-[var(--th-ok)]',
          tone === 'warn' && 'bg-[var(--th-warn)]',
          tone === 'err' && 'bg-[var(--th-err)]',
          tone === 'muted' && 'bg-fg-5',
        )}
        style={{ width: `${clampPercent(value)}%` }}
      />
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-edge bg-panel-alt px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-fg">{value}</div>
      {hint && <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{hint}</div>}
    </div>
  );
}

function AgentUsageCard({ agent, t }: { agent: AgentRuntimeStatus; t: (key: string) => string }) {
  const meta = getAgentMeta(agent.agent);
  const usage = agent.usage;
  const tone = usageTone(usage);
  const windows = (usage?.windows || []).map(window => normalizeUsageWindow(agent, window));
  const summary = formatUsageSummary(usage, t);

  return (
    <div className="rounded-md border border-edge bg-panel px-3.5 py-3 shadow-[0_1px_0_rgba(255,255,255,0.02),0_4px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-edge bg-panel-alt">
          <BrandIcon brand={agent.agent} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold text-fg">{meta.label}</span>
            <Badge variant={agent.installed ? toneBadgeVariant(tone) : 'muted'}>
              {agent.installed ? usageStatusLabel(usage, t) : t('usage.notInstalled')}
            </Badge>
            {agent.selectedModel && (
              <span className="truncate text-[11px] font-mono text-fg-5">{agent.selectedModel}</span>
            )}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{summary}</div>
          <div className="mt-1 text-[11px] text-fg-5">
            {usage?.source ? `${t('usage.source')}: ${usage.source}` : t('usage.sourceUnavailable')}
            {usage?.capturedAt ? ` · ${formatDateTime(usage.capturedAt)}` : ''}
          </div>
        </div>
      </div>

      {windows.length > 0 ? (
        <div className="mt-3 space-y-2">
          {windows.map(row => (
            <div key={`${agent.agent}-${row.window.label}`} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_96px] sm:items-center">
              <div className="min-w-0 text-[12px] font-medium text-fg-3">{row.window.label || t('usage.window')}</div>
              <ProgressBar value={row.usedPercent} tone={row.tone} />
              <div className="text-left text-[11px] text-fg-5 sm:text-right">
                {formatPercent(row.usedPercent)} · {formatRelativeReset(row.window.resetAt, t)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-edge bg-panel-alt px-3 py-2 text-[12px] text-fg-5">
          {usage?.error || t('usage.noWindowData')}
        </div>
      )}
    </div>
  );
}

export function UsageTab() {
  const locale = useStore(s => s.locale);
  const storeState = useStore(s => s.state);
  const storeAgentStatus = useStore(s => s.agentStatus);
  const reload = useStore(s => s.reload);
  const refreshAgentStatus = useStore(s => s.refreshAgentStatus);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [state, setState] = useState<AppState | null>(storeState);
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(storeAgentStatus);
  const [loading, setLoading] = useState(!storeState || !storeAgentStatus);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (storeState) setState(storeState); }, [storeState]);
  useEffect(() => { if (storeAgentStatus) setAgentStatus(storeAgentStatus); }, [storeAgentStatus]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextState, nextAgents] = await Promise.all([
        reload(),
        refreshAgentStatus(),
      ]);
      const current = useStore.getState();
      setState(nextState || current.state);
      setAgentStatus(nextAgents || current.agentStatus);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('usage.loadFailed');
      setError(message);
      toast(message, false);
    } finally {
      setLoading(false);
    }
  }, [refreshAgentStatus, reload, t, toast]);

  useEffect(() => {
    if (!storeState || !storeAgentStatus) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agents = useMemo(() => {
    const source = agentStatus?.agents || [];
    const byAgent = new Map(source.map(agent => [agent.agent, agent] as const));
    return AGENT_ORDER.map(agent => byAgent.get(agent)).filter(Boolean) as AgentRuntimeStatus[];
  }, [agentStatus]);

  const windows = useMemo(() => (
    agents.flatMap(agent => (agent.usage?.windows || []).map(window => normalizeUsageWindow(agent, window)))
      .sort((a, b) => {
        const aReset = parseTime(a.window.resetAt) ?? Number.MAX_SAFE_INTEGER;
        const bReset = parseTime(b.window.resetAt) ?? Number.MAX_SAFE_INTEGER;
        const toneWeight = (row: UsageWindowRow) => row.tone === 'err' ? 0 : row.tone === 'warn' ? 1 : 2;
        return toneWeight(a) - toneWeight(b) || aReset - bReset;
      })
  ), [agents]);

  const runtimeStats = state?.bot?.stats || null;
  const inputTokens = runtimeStats?.totalInputTokens || 0;
  const outputTokens = runtimeStats?.totalOutputTokens || 0;
  const cachedTokens = runtimeStats?.totalCachedTokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const installedAgents = agents.filter(agent => agent.installed);
  const okAgents = installedAgents.filter(agent => usageTone(agent.usage) === 'ok').length;
  const warnAgents = installedAgents.filter(agent => usageTone(agent.usage) === 'warn').length;
  const unavailableAgents = installedAgents.length - okAgents - warnAgents;
  const nearestReset = windows.find(row => parseTime(row.window.resetAt) != null)?.window.resetAt || null;

  return (
    <div className="animate-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel-alt px-3 py-1.5">
            <Dot variant={state?.bot?.connected ? 'ok' : 'idle'} pulse={state?.bot?.connected} />
            {state?.bot?.connected ? t('usage.runtimeConnected') : t('usage.runtimeOffline')}
          </span>
          {agentStatus?.workdir && (
            <span className="max-w-[520px] truncate rounded-full border border-edge bg-panel-alt px-3 py-1.5 font-mono text-[11px]">
              {agentStatus.workdir}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading && <Spinner className="h-3 w-3" />}
          {t('usage.refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('usage.totalTokens')}
          value={formatTokens(totalTokens)}
          hint={`${formatTokens(inputTokens)} ${t('usage.inputTokens')} / ${formatTokens(outputTokens)} ${t('usage.outputTokens')}`}
        />
        <MetricCard
          label={t('usage.totalTurns')}
          value={formatTokens(runtimeStats?.totalTurns || 0)}
          hint={state?.bot ? t('usage.currentProcess') : t('usage.runtimeOffline')}
        />
        <MetricCard
          label={t('usage.cacheRead')}
          value={formatTokens(cachedTokens)}
          hint={cachedTokens ? t('usage.cacheHint') : t('usage.cacheEmpty')}
        />
        <MetricCard
          label={t('usage.agentWindows')}
          value={`${okAgents}/${installedAgents.length}`}
          hint={warnAgents || unavailableAgents
            ? `${warnAgents} ${t('usage.warning')} · ${unavailableAgents} ${t('usage.unavailable')}`
            : nearestReset
              ? `${t('usage.nextReset')}: ${formatRelativeReset(nearestReset, t)}`
              : t('usage.noResetData')}
        />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-fg-2">{t('usage.agentBreakdown')}</h3>
          <span className="text-[11px] text-fg-5">{t('usage.windowCount')}: {windows.length}</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {agents.map(agent => (
            <AgentUsageCard key={agent.agent} agent={agent} t={t} />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-edge bg-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-fg-2">{t('usage.windowDetails')}</h3>
          {loading && <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-5"><Spinner className="h-3 w-3" />{t('status.loading')}</span>}
        </div>
        {windows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-edge text-left text-[11px] uppercase tracking-[0.14em] text-fg-5">
                  <th className="py-2 pr-3 font-semibold">{t('usage.agent')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('usage.window')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('usage.used')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('usage.remaining')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('usage.resetAt')}</th>
                  <th className="py-2 pr-3 font-semibold">{t('usage.status')}</th>
                </tr>
              </thead>
              <tbody>
                {windows.map(row => (
                  <tr key={`${row.agent.agent}-${row.window.label}-${row.window.resetAt || 'none'}`} className="border-b border-edge/70 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <BrandIcon brand={row.agent.agent} size={14} />
                        <span className="font-medium text-fg-2">{getAgentMeta(row.agent.agent).label}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-fg-4">{row.window.label || '--'}</td>
                    <td className="py-2.5 pr-3 font-mono text-fg-3">{formatPercent(row.usedPercent)}</td>
                    <td className="py-2.5 pr-3 font-mono text-fg-3">{formatPercent(row.remainingPercent)}</td>
                    <td className="py-2.5 pr-3 text-fg-4">
                      {formatDateTime(row.window.resetAt)}
                      <span className="ml-2 text-fg-6">{formatRelativeReset(row.window.resetAt, t)}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={toneBadgeVariant(row.tone)}>{row.window.status || row.agent.usage?.status || usageStatusLabel(row.agent.usage, t)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-edge bg-panel-alt px-3 py-8 text-center text-sm text-fg-5">
            {loading ? t('status.loading') : t('usage.noWindowData')}
          </div>
        )}
      </section>
    </div>
  );
}
