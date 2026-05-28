import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { AgentRuntimeStatus } from '../types';
import { BrandIcon } from './BrandIcon';
import { Button, Modal, ModalHeader, Spinner } from './ui';

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

function installedAgentNames(agents: AgentRuntimeStatus[]): string[] {
  const names = agents.filter(agent => agent.installed).map(agent => agent.agent);
  return names.length ? names : agents.map(agent => agent.agent);
}

export interface FeatureAgentDialogConfig {
  kind: 'mcp' | 'skill' | 'jira-task';
  title: string;
  description: string;
  assistantName: string;
  assistantResponsibility: string;
  placeholder: string;
  initialPrompt?: string;
  submitLabel?: string;
}

export function FeatureAgentDialog({
  open,
  onClose,
  config,
  workdir,
}: {
  open: boolean;
  onClose: () => void;
  config: FeatureAgentDialogConfig;
  workdir?: string;
}) {
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = workdir || state?.runtimeWorkdir || agentStatus?.workdir || '';
  const agentOptions = useMemo(() => installedAgentNames(agentStatus?.agents || []), [agentStatus?.agents]);
  const defaultAgent = state?.bot?.defaultAgent || state?.config?.defaultAgent || agentStatus?.defaultAgent || agentOptions[0] || 'codex';
  const [agent, setAgent] = useState(defaultAgent);
  const [draft, setDraft] = useState(config.initialPrompt || '');
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAgent(defaultAgent);
    setDraft(config.initialPrompt || '');
    setBusy(false);
    setSessionKey(null);
  }, [config.initialPrompt, defaultAgent, open]);

  const fullPrompt = useMemo(() => {
    const scopeHint = config.kind === 'mcp'
      ? 'Target surface: Extensions > MCP. You can create or update MCP configuration, validate required URL/token/command/env fields, and tell the user exactly when a Pikiclaw restart is required.'
      : config.kind === 'skill'
        ? 'Target surface: Extensions > Skills. You can create or update a Codex/Pikiclaw skill with a clear SKILL.md, trigger rules, workflow, scripts or templates when needed, and validation steps.'
        : 'Target surface: Jira dashboard task creation. Guide the user from rough intent to a clear task with goal, boundary, acceptance points, workspace, owner mode, and execution mode.';
    return [
      `You are ${config.assistantName}.`,
      `Responsibility: ${config.assistantResponsibility}`,
      scopeHint,
      'Work as an assisted-creation agent. Start by asking concise clarifying questions only when required. Once enough information is available, perform the creation/configuration work directly when tools and files are available. If the result needs a restart, validation, or user-provided secret, say that explicitly.',
      `Workspace: ${runtimeWorkdir || 'unknown'}`,
      `User request:\n${draft.trim()}`,
    ].join('\n\n');
  }, [config.assistantName, config.assistantResponsibility, config.kind, draft, runtimeWorkdir]);

  const start = async () => {
    const request = draft.trim();
    if (!request || !runtimeWorkdir || busy) return;
    setBusy(true);
    setSessionKey(null);
    try {
      const result = await api.sendSessionMessage(runtimeWorkdir, agent, '', fullPrompt, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to start assistant');
      setSessionKey(result.sessionKey || null);
      toast(L(locale, '已启动创建助手', 'Creation assistant started'), true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to start assistant', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide panelStyle={{ maxWidth: 'min(680px, calc(100vw - 32px))' }}>
      <ModalHeader title={config.title} description={config.description} onClose={onClose} />
      <div className="space-y-4">
        <div className="rounded-lg border border-edge bg-panel-alt px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">
            {L(locale, '创建助手', 'Creation assistant')}
          </div>
          <div className="mt-1 text-[13px] font-medium text-fg">{config.assistantName}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{config.assistantResponsibility}</div>
        </div>

        <label className="block space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Agent</div>
          <select
            value={agent}
            onChange={event => setAgent(event.target.value)}
            className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
          >
            {(agentOptions.length ? agentOptions : [defaultAgent]).map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <textarea
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={config.placeholder}
          className="min-h-36 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />

        {sessionKey && (
          <div className="rounded-md border border-[color:var(--th-ok)]/25 bg-[color-mix(in_oklab,var(--th-ok)_10%,transparent)] px-3 py-2 text-[12px] text-fg-3">
            {L(locale, '助手会话已创建：', 'Assistant session created: ')}
            <span className="font-mono text-fg">{sessionKey}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-5">
            <BrandIcon agent={agent as any} size={14} />
            <span className="truncate">{runtimeWorkdir || L(locale, '未选择工作区', 'No workspace selected')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{L(locale, '关闭', 'Close')}</Button>
            <Button variant="primary" onClick={start} disabled={!draft.trim() || !runtimeWorkdir || busy}>
              {busy ? <Spinner /> : null}
              {config.submitLabel || L(locale, '启动助手', 'Start assistant')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
