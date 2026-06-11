import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Spinner } from '../../components/ui';
import type { Locale } from '../../i18n';
import { useStore } from '../../store';
import type { AgentAssistant } from '../../types';
import { cn, getAgentMeta, shortenModel } from '../../utils';
import { Metric, SectionCard } from '../shared';

type Copy = {
  assistants: string;
  runtimeAgents: string;
  reload: string;
  loading: string;
  emptyAssistants: string;
  noAgents: string;
  enabled: string;
  disabled: string;
  builtIn: string;
  custom: string;
  preferredAgents: string;
  noPreferredAgents: string;
  installed: string;
  missing: string;
  default: string;
  model: string;
  provider: string;
  assistantsMetric: string;
  agentsMetric: string;
  bindingsMetric: string;
  manageAssistant: string;
};

function copyFor(locale: Locale): Copy {
  if (locale === 'zh-CN') {
    return {
      assistants: 'Assistant 员工',
      runtimeAgents: '运行时 Agent',
      reload: '刷新',
      loading: '加载中...',
      emptyAssistants: '还没有可显示的 Assistant。',
      noAgents: '暂无绑定 agent',
      enabled: '启用',
      disabled: '停用',
      builtIn: '内置',
      custom: '自定义',
      preferredAgents: '绑定 Agent',
      noPreferredAgents: '运行时默认',
      installed: '已安装',
      missing: '未安装',
      default: '默认',
      model: '模型',
      provider: '供应商',
      assistantsMetric: '员工',
      agentsMetric: '可用 Agent',
      bindingsMetric: '绑定',
      manageAssistant: '管理 Assistant',
    };
  }
  return {
    assistants: 'Assistant Employees',
    runtimeAgents: 'Runtime Agents',
    reload: 'Refresh',
    loading: 'Loading...',
    emptyAssistants: 'No assistants to show yet.',
    noAgents: 'No bound agents',
    enabled: 'Enabled',
    disabled: 'Disabled',
    builtIn: 'Built in',
    custom: 'Custom',
    preferredAgents: 'Bound agents',
    noPreferredAgents: 'Runtime default',
    installed: 'Installed',
    missing: 'Missing',
    default: 'Default',
    model: 'Model',
    provider: 'Provider',
    assistantsMetric: 'Employees',
    agentsMetric: 'Available agents',
    bindingsMetric: 'Bindings',
    manageAssistant: 'Manage Assistant',
  };
}

function assistantInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'A';
}

function AssistantCard({
  assistant,
  copy,
  onManage,
}: {
  assistant: AgentAssistant;
  copy: Copy;
  onManage?: (assistant: AgentAssistant) => void;
}) {
  const agents = assistant.preferredAgents || [];
  return (
    <SectionCard className="p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-edge bg-panel-alt text-[13px] font-semibold text-fg-2">
          {assistantInitials(assistant.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{assistant.name}</div>
            <Badge variant={assistant.enabled === false ? 'muted' : 'ok'}>{assistant.enabled === false ? copy.disabled : copy.enabled}</Badge>
            <Badge variant="muted">{assistant.builtIn ? copy.builtIn : copy.custom}</Badge>
          </div>
          <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-fg-4">
            {assistant.responsibility || assistant.prompt || assistant.defaultPrompt || assistant.kind || assistant.id}
          </div>
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-5">{copy.preferredAgents}</div>
            {agents.length ? (
              <div className="flex flex-wrap gap-1.5">
                {agents.map(agent => (
                  <span key={agent} className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-inset px-1.5 py-0.5 text-[11px] text-fg-4">
                    <BrandIcon brand={agent} size={14} className="rounded-[3px]" />
                    {getAgentMeta(agent).shortLabel}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-fg-5">{copy.noPreferredAgents}</div>
            )}
          </div>
          {onManage && (
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => onManage(assistant)}>
                {copy.manageAssistant}
              </Button>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function TeamTab({
  onEditAssistant,
}: {
  onEditAssistant?: (assistant: AgentAssistant) => void;
} = {}) {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const agentStatus = useStore(s => s.agentStatus);
  const copy = useMemo(() => copyFor(locale), [locale]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getProAssistants();
      if (!res.ok) throw new Error(res.error || 'Failed to load assistants');
      setAssistants(res.assistants || []);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to load assistants', false);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const visibleAssistants = useMemo(
    () => assistants.filter(assistant => assistant.kind !== 'page-owner'),
    [assistants],
  );
  const agents = agentStatus?.agents || [];
  const installedAgents = agents.filter(agent => agent.installed !== false && agent.agent !== 'openclaw');
  const bindingCount = visibleAssistants.reduce((sum, assistant) => sum + (assistant.preferredAgents?.length || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label={copy.assistantsMetric} value={String(visibleAssistants.length)} />
        <Metric label={copy.agentsMetric} value={String(installedAgents.length)} />
        <Metric label={copy.bindingsMetric} value={String(bindingCount)} />
      </div>

      <SectionCard>
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-fg">{copy.assistants}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading && <Spinner />}
            {copy.reload}
          </Button>
        </div>
        {loading ? (
          <div className="flex h-24 items-center justify-center gap-2 text-sm text-fg-4">
            <Spinner />
            {copy.loading}
          </div>
        ) : visibleAssistants.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {visibleAssistants.map(assistant => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                copy={copy}
                onManage={onEditAssistant}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-edge bg-panel-alt px-4 py-8 text-center text-sm text-fg-5">
            {copy.emptyAssistants}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <div className="mb-3 text-[14px] font-semibold text-fg">{copy.runtimeAgents}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {agents.filter(agent => agent.agent !== 'openclaw').map(agent => {
            const meta = getAgentMeta(agent.agent);
            const model = agent.selectedModel || agent.nativeSelectedModel || '';
            return (
              <div
                key={agent.agent}
                className={cn(
                  'rounded-lg border bg-panel-alt p-3',
                  agent.installed === false ? 'border-edge/60 opacity-70' : 'border-edge',
                )}
              >
                <div className="flex items-center gap-2">
                  <BrandIcon brand={agent.agent} size={18} className="rounded-[4px]" />
                  <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{agent.label || meta.label}</div>
                  {agentStatus?.defaultAgent === agent.agent && <Badge variant="accent">{copy.default}</Badge>}
                  <Badge variant={agent.installed === false ? 'muted' : 'ok'}>{agent.installed === false ? copy.missing : copy.installed}</Badge>
                </div>
                <div className="mt-3 space-y-1.5 text-[11px] text-fg-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-semibold text-fg-4">{copy.model}</span>
                    <span className="min-w-0 truncate">{model ? shortenModel(model) : '--'}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-semibold text-fg-4">{copy.provider}</span>
                    <span className="min-w-0 truncate">{agent.byokProviderName || agent.nativeConfig?.provider || 'native'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
