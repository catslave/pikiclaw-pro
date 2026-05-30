import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { AgentAssistant, AgentRuntimeStatus } from '../types';
import { BrandIcon } from './BrandIcon';
import { Button, Modal, ModalHeader, Spinner } from './ui';
import { SessionPanel } from '../pages/sessions/SessionPanel';
import type { SessionInfo } from '../types';
import { GeneratedObjectBlock, GeneratedToolWindow, generatedObjectInstruction, useAssistantGeneratedOutput } from './assistant/AssistantGeneratedUi';

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

function installedAgentNames(agents: AgentRuntimeStatus[]): string[] {
  const names = agents.filter(agent => agent.installed).map(agent => agent.agent);
  return names.length ? names : agents.map(agent => agent.agent);
}

function parseSessionKeyValue(value: string | null | undefined): { agent: string; sessionId: string } | null {
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { agent: value.slice(0, idx), sessionId: value.slice(idx + 1) };
}

export interface FeatureAgentDialogConfig {
  kind: 'mcp' | 'skill' | 'jira-task' | 'agent';
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
  const [activeSession, setActiveSession] = useState<{ agent: string; sessionId: string } | null>(null);
  const [initialChatPrompt, setInitialChatPrompt] = useState<string | null>(null);
  const [sendingGeneratedAction, setSendingGeneratedAction] = useState(false);
  const [toolWindowOpen, setToolWindowOpen] = useState(false);

  const assistantMeta = useMemo<AgentAssistant>(() => {
    const surfaceId = config.kind === 'mcp'
      ? 'mcp'
      : config.kind === 'skill'
        ? 'skills'
        : config.kind === 'agent'
          ? 'agents'
          : 'dashboard';
    const objectTypes = config.kind === 'mcp'
      ? ['mcp-server', 'mcp-auth']
      : config.kind === 'skill'
        ? ['skill', 'skill-prompt']
        : config.kind === 'agent'
          ? ['agent', 'assistant', 'model', 'profile']
          : ['task', 'jira-task'];
    return {
      id: `feature-${config.kind}-creator`,
      name: config.assistantName,
      kind: 'creation',
      surfaceId,
      objectTypes,
      responsibility: config.assistantResponsibility,
      prompt: config.assistantResponsibility,
      defaultPrompt: config.assistantResponsibility,
      preferredAgents: [defaultAgent],
      allowedActions: config.kind === 'mcp'
        ? ['chat', 'create-mcp', 'configure-auth', 'test-tools']
        : config.kind === 'skill'
          ? ['chat', 'create-skill', 'edit-skill', 'test-skill']
          : config.kind === 'agent'
            ? ['chat', 'create-agent', 'create-assistant', 'configure-model', 'test-agent']
            : ['chat', 'create-task'],
      builtIn: true,
      enabled: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }, [config.assistantName, config.assistantResponsibility, config.kind, defaultAgent]);

  useEffect(() => {
    if (!open) return;
    setAgent(defaultAgent);
    setDraft(config.initialPrompt || '');
    setBusy(false);
    setSessionKey(null);
    setActiveSession(null);
    setInitialChatPrompt(null);
    setSendingGeneratedAction(false);
    setToolWindowOpen(false);
  }, [config.initialPrompt, defaultAgent, open]);

  const fullPrompt = useMemo(() => {
    const scopeHint = config.kind === 'mcp'
      ? 'Target surface: Extensions > MCP. You can create or update MCP configuration, validate required URL/token/command/env fields, and tell the user exactly when a Pikiclaw restart is required.'
      : config.kind === 'skill'
        ? 'Target surface: Extensions > Skills. You can create or update a Codex/Pikiclaw skill with a clear SKILL.md, trigger rules, workflow, scripts or templates when needed, and validation steps.'
        : config.kind === 'agent'
          ? 'Target surface: Agents. You can help create or configure an agent/assistant entry, choose runtime driver boundaries, define model/profile binding, test steps, prompt scope, and whether the result belongs in Available Agents or Agent Assistants.'
          : 'Target surface: Jira dashboard task creation. Guide the user from rough intent to a clear task with goal, boundary, acceptance points, workspace, owner mode, and execution mode.';
    const creationMode = config.kind === 'agent'
      ? [
          'Work as a confirmation-first agent creation assistant.',
          'Do not execute install commands, shell scripts, package managers, network installers, or file/config edits until the user explicitly confirms a proposed plan.',
          'If the user provides an install URL or command, summarize what it would do, identify the target driver/config files, list the validation/test path, and ask for confirmation before running anything.',
          'Only output a generated UI payload after the agent/assistant/config was actually created or after the user explicitly asks for a draft card.',
        ].join(' ')
      : 'Work as an assisted-creation agent. Start by asking concise clarifying questions only when required. Once enough information is available, perform the creation/configuration work directly when tools and files are available. If the result needs a restart, validation, or user-provided secret, say that explicitly.';
    return [
      `You are ${config.assistantName}.`,
      `Responsibility: ${config.assistantResponsibility}`,
      scopeHint,
      creationMode,
      generatedObjectInstruction(assistantMeta),
      `Workspace: ${runtimeWorkdir || 'unknown'}`,
      `User request:\n${draft.trim()}`,
    ].join('\n\n');
  }, [assistantMeta, config.assistantName, config.assistantResponsibility, config.kind, draft, runtimeWorkdir]);

  const start = async () => {
    const request = draft.trim();
    if (!request || !runtimeWorkdir || busy) return;
    setBusy(true);
    setSessionKey(null);
    try {
      const result = await api.sendSessionMessage(runtimeWorkdir, agent, '', fullPrompt, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to start assistant');
      const nextSession = parseSessionKeyValue(result.sessionKey);
      setSessionKey(result.sessionKey || null);
      setActiveSession(nextSession);
      setInitialChatPrompt(request);
      toast(L(locale, '已启动创建助手', 'Creation assistant started'), true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to start assistant', false);
    } finally {
      setBusy(false);
    }
  };

  const sessionForPanel = useMemo<SessionInfo | null>(() => activeSession ? ({
    agent: activeSession.agent,
    sessionId: activeSession.sessionId,
    workdir: runtimeWorkdir,
    workspacePath: runtimeWorkdir,
    threadId: null,
    createdAt: new Date().toISOString(),
    title: draft.trim() || config.title,
    titleSource: 'prompt',
    running: true,
    runState: 'running',
    runDetail: null,
    runUpdatedAt: new Date().toISOString(),
    runPid: null,
    classification: null,
    userStatus: null,
    userNote: null,
    pinned: false,
    archived: false,
    archivedAt: null,
    lastQuestion: draft.trim() || null,
    lastAnswer: null,
    lastMessageText: draft.trim() || null,
    migratedFrom: null,
    migratedTo: null,
    linkedSessions: [],
    sideChatOf: null,
    sideChats: [],
    numTurns: null,
    origin: { channel: 'dashboard', chatId: 'dashboard' },
  }) : null, [activeSession, config.title, draft, runtimeWorkdir]);

  const generated = useAssistantGeneratedOutput({
    active: !!sessionForPanel,
    workdir: runtimeWorkdir,
    agent: activeSession?.agent,
    sessionId: activeSession?.sessionId,
  });

  const sendGeneratedAction = useCallback(async (action: 'test' | 'validate' | 'use') => {
    if (!activeSession || sendingGeneratedAction) return;
    const objectType = generated.object?.type || assistantMeta.objectTypes?.[0] || 'object';
    const prompt = action === 'test'
      ? `Test the generated ${objectType} and report whether it is ready to use.`
      : action === 'validate'
        ? `Validate the generated ${objectType} using the safest available checks. Summarize any missing setup.`
        : `Use the generated ${objectType} in this session and show me the next practical step.`;
    setSendingGeneratedAction(true);
    try {
      const result = await api.sendSessionMessage(runtimeWorkdir, activeSession.agent, activeSession.sessionId, prompt, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to run generated action');
      toast(L(locale, '已发送工具操作', 'Generated action sent'), true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to run generated action', false);
    } finally {
      setSendingGeneratedAction(false);
    }
  }, [activeSession, assistantMeta.objectTypes, generated.object?.type, locale, runtimeWorkdir, sendingGeneratedAction, toast]);

  const transcriptFooter = sessionForPanel && generated.object ? (
    <GeneratedObjectBlock
      locale={locale}
      assistant={assistantMeta}
      object={generated.object}
      loading={generated.loading || sendingGeneratedAction}
      error={generated.error}
      onOpenFocus={() => setToolWindowOpen(true)}
      onRunAction={sendGeneratedAction}
    />
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      panelStyle={{
        maxWidth: sessionForPanel ? 'min(980px, calc(100vw - 32px))' : 'min(680px, calc(100vw - 32px))',
        maxHeight: 'min(92vh, 860px)',
      }}
    >
      <ModalHeader title={config.title} description={config.description} onClose={onClose} />
      <div className="space-y-4">
        <div className="rounded-lg border border-edge bg-panel-alt px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">
            {L(locale, '创建助手', 'Creation assistant')}
          </div>
          <div className="mt-1 text-[13px] font-medium text-fg">{config.assistantName}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{config.assistantResponsibility}</div>
        </div>

        {!sessionForPanel && (
          <>
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
          </>
        )}

        {sessionKey && (
          <div className="rounded-md border border-[color:var(--th-ok)]/25 bg-[color-mix(in_oklab,var(--th-ok)_10%,transparent)] px-3 py-2 text-[12px] text-fg-3">
            {L(locale, '助手会话已创建：', 'Assistant session created: ')}
            <span className="font-mono text-fg">{sessionKey}</span>
          </div>
        )}

        {sessionForPanel && (
          <div className="h-[min(58vh,560px)] min-h-[420px] overflow-hidden rounded-lg border border-edge bg-[var(--th-session-bg)]">
            <SessionPanel
              session={sessionForPanel}
              workdir={runtimeWorkdir}
              active
              transcriptFooter={transcriptFooter}
              initialPendingPrompt={initialChatPrompt}
              initialPendingCreatedAt={new Date().toISOString()}
              onPendingPromptConsumed={() => setInitialChatPrompt(null)}
              onSessionChange={(next) => {
                setActiveSession({ agent: next.agent, sessionId: next.sessionId });
                setSessionKey(`${next.agent}:${next.sessionId}`);
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-5">
            <BrandIcon agent={(activeSession?.agent || agent) as any} size={14} />
            <span className="truncate">{runtimeWorkdir || L(locale, '未选择工作区', 'No workspace selected')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{L(locale, '关闭', 'Close')}</Button>
            {!sessionForPanel && (
              <Button variant="primary" onClick={start} disabled={!draft.trim() || !runtimeWorkdir || busy}>
                {busy ? <Spinner /> : null}
                {config.submitLabel || L(locale, '启动助手', 'Start assistant')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <GeneratedToolWindow
        open={toolWindowOpen}
        locale={locale}
        assistant={assistantMeta}
        object={generated.object}
        onClose={() => setToolWindowOpen(false)}
        onRunAction={sendGeneratedAction}
      />
    </Modal>
  );
}
