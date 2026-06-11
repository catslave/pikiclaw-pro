import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useStore } from '../../store';
import type { AgentAssistant, AgentHealthResult, AgentRuntimeStatus, AssistantHistoryItem, SessionInfo } from '../../types';
import { cn } from '../../utils';
import { BrandIcon } from '../BrandIcon';
import { Badge, Button, CountBadge, Modal, ModalHeader, Spinner } from '../ui';
import { SessionPanel } from '../../pages/sessions/SessionPanel';
import {
  GeneratedObjectBlock,
  GeneratedToolWindow,
  PromptPatchBlock,
  generatedObjectInstruction,
  promptPatchInstruction,
  useAssistantGeneratedOutput,
} from './AssistantGeneratedUi';

const OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:open-sessions:v1';
const ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:active-slot:v1';

type AssistantRunMode = 'chat' | 'create' | 'test' | 'prompt';
type AssistantTestStatus = 'idle' | 'running' | 'ok' | 'failed';

interface AssistantTestState {
  healthStatus: AssistantTestStatus;
  chatStatus: 'pending' | 'running' | 'ok' | 'failed';
  healthResult?: AgentHealthResult | null;
  chatSession?: { agent: string; sessionId: string } | null;
  chatSessionKey?: string | null;
  error?: string | null;
}

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

function mountKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openSessionsFromStorage(): Array<{ workdir: string; agent: string; sessionId: string; mountKey: string; archiveOnly?: boolean }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_SESSIONS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item?.workdir && item?.agent && item?.sessionId) : [];
  } catch {
    return [];
  }
}

function assistantPrompt(assistant: AgentAssistant): string {
  return assistant.prompt || assistant.defaultPrompt || assistant.responsibility || '';
}

function preferredAgent(assistant: AgentAssistant, options: string[], fallback: string): string {
  const preferred = (assistant.preferredAgents || []).find(agent => options.includes(agent));
  return preferred || fallback || options[0] || 'codex';
}

function actionPromptForMode(mode: AssistantRunMode, assistant: AgentAssistant, initialPrompt?: string): string {
  const base = initialPrompt?.trim();
  if (base) return base;
  if (mode === 'create') return 'Help me create the right object for this page. Start by asking what I want to create and what constraints matter.';
  if (mode === 'test') return 'Fast local test: validate assistant wiring and the selected runtime agent. Do not start a model conversation.';
  if (mode === 'prompt') return 'Review your current prompt with me. When we agree on the change, output the complete replacement prompt as a prompt patch.';
  return `Help me work on the ${assistant.surfaceId || 'current'} page.`;
}

function DraggableAssistantSurface({
  open,
  title,
  description,
  onClose,
  panelStyle,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  panelStyle?: CSSProperties;
  children: ReactNode;
}) {
  const [position, setPosition] = useState({ x: 64, y: 64 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const width = Math.min(window.innerWidth - 32, 1040);
    setPosition({
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round(window.innerHeight * 0.08)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, select, input, textarea, a')) return;
    const panel = event.currentTarget.closest('[data-assistant-floating-panel]') as HTMLElement | null;
    if (!panel) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setDragging(true);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      setPosition({
        x: Math.min(Math.max(12, moveEvent.clientX - offsetX), Math.max(12, window.innerWidth - rect.width - 12)),
        y: Math.min(Math.max(12, moveEvent.clientY - offsetY), Math.max(12, window.innerHeight - rect.height - 12)),
      });
    };
    const done = (doneEvent: PointerEvent) => {
      if (doneEvent.pointerId !== pointerId) return;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }, []);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-100 pointer-events-none">
      <div
        data-assistant-floating-panel
        className={cn(
          'glass-strong pointer-events-auto fixed overflow-hidden rounded-xl border border-edge-h shadow-[0_30px_90px_rgba(2,6,23,0.25),0_8px_24px_rgba(15,23,42,0.08)]',
          dragging && 'shadow-[0_36px_110px_rgba(2,6,23,0.32),0_10px_28px_rgba(15,23,42,0.12)]',
        )}
        style={{
          left: position.x,
          top: position.y,
          width: 'min(1040px, calc(100vw - 32px))',
          maxHeight: 'min(88vh, 860px)',
          background: 'linear-gradient(180deg, color-mix(in oklab, var(--th-modal-bg) 90%, white 10%), color-mix(in oklab, var(--th-modal-bg) 97%, white 3%))',
          ...panelStyle,
        }}
      >
        <div
          onPointerDown={startDrag}
          className={cn(
            'flex cursor-grab items-start justify-between gap-4 border-b border-edge/65 px-4 py-3',
            dragging && 'cursor-grabbing',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight text-fg">{title}</div>
            {description && <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-fg-4">{description}</div>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="-mr-1 -mt-1 h-8 w-8 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
        <div className="max-h-[calc(min(88vh,860px)-58px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function AssistantRunDialog({
  open,
  assistant,
  mode,
  title,
  description,
  initialPrompt,
  workdir,
  floating,
  onOpenPrompt,
  onAssistantSaved,
  onClose,
}: {
  open: boolean;
  assistant: AgentAssistant | null;
  mode: AssistantRunMode;
  title?: string;
  description?: string;
  initialPrompt?: string;
  workdir?: string;
  floating?: boolean;
  onOpenPrompt?: (assistant: AgentAssistant) => void;
  onAssistantSaved?: (assistant: AgentAssistant) => void;
  onClose: () => void;
}) {
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = workdir || state?.runtimeWorkdir || state?.config?.workdir || agentStatus?.workdir || '';
  const agentOptions = useMemo(() => installedAgentNames(agentStatus?.agents || []), [agentStatus?.agents]);
  const fallbackAgent = state?.bot?.defaultAgent || state?.config?.defaultAgent || agentStatus?.defaultAgent || agentOptions[0] || 'codex';
  const defaultAgent = assistant ? preferredAgent(assistant, agentOptions, fallbackAgent) : fallbackAgent;
  const [agent, setAgent] = useState(defaultAgent);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<{ agent: string; sessionId: string } | null>(null);
  const [initialChatPrompt, setInitialChatPrompt] = useState<string | null>(null);
  const [localFloating, setLocalFloating] = useState(false);
  const [toolWindowOpen, setToolWindowOpen] = useState(false);
  const [applyingPrompt, setApplyingPrompt] = useState(false);
  const [sendingGeneratedAction, setSendingGeneratedAction] = useState(false);
  const [assistantTest, setAssistantTest] = useState<AssistantTestState>({ healthStatus: 'idle', chatStatus: 'pending' });

  useEffect(() => {
    if (!open || !assistant) return;
    setAgent(defaultAgent);
    setDraft(actionPromptForMode(mode, assistant, initialPrompt));
    setBusy(false);
    setSessionKey(null);
    setActiveSession(null);
    setInitialChatPrompt(null);
    setLocalFloating(!!floating);
    setToolWindowOpen(false);
    setApplyingPrompt(false);
    setSendingGeneratedAction(false);
    setAssistantTest({ healthStatus: 'idle', chatStatus: 'pending' });
  }, [assistant, defaultAgent, floating, initialPrompt, mode, open]);

  const runAssistantTest = useCallback(async (targetAgent = agent) => {
    if (!assistant || !targetAgent || busy) return;
    setAgent(targetAgent);
    setBusy(true);
    setAssistantTest({ healthStatus: 'running', chatStatus: 'pending', healthResult: null, chatSession: null, chatSessionKey: null, error: null });
    try {
      const result = await api.checkAgentHealth(targetAgent, { timeoutMs: 12_000 });
      setAssistantTest(current => ({
        ...current,
        healthStatus: result.ok ? 'ok' : 'failed',
        chatStatus: result.ok ? 'running' : 'pending',
        healthResult: result,
        error: result.ok ? null : result.detail,
      }));
      if (!result.ok) return;
      const chat = await api.sendSessionMessage(
        runtimeWorkdir,
        targetAgent,
        '',
        'Reply with exactly OK. Do not use tools.',
        { timeoutMs: 45_000 },
      );
      if (!chat.ok) throw new Error(chat.error || 'Chat check failed');
      const session = parseSessionKeyValue(chat.sessionKey);
      setAssistantTest(current => ({
        ...current,
        chatStatus: session ? 'running' : 'failed',
        chatSession: session,
        chatSessionKey: chat.sessionKey || null,
        error: session ? current.error : 'Chat check did not return a session.',
      }));
    } catch (error) {
      setAssistantTest(current => ({
        ...current,
        healthStatus: current.healthStatus === 'running' ? 'failed' : current.healthStatus,
        chatStatus: current.healthStatus === 'ok' ? 'failed' : current.chatStatus,
        error: error instanceof Error ? error.message : 'Assistant test failed',
      }));
    } finally {
      setBusy(false);
    }
  }, [agent, assistant, busy, runtimeWorkdir]);

  useEffect(() => {
    if (!open || !assistant || mode !== 'test' || assistantTest.healthStatus !== 'idle') return;
    void runAssistantTest(defaultAgent);
  }, [assistant, assistantTest.healthStatus, defaultAgent, mode, open, runAssistantTest]);

  const fullPrompt = useMemo(() => {
    if (!assistant) return '';
    return [
      `You are ${assistant.name}.`,
      `Surface: ${assistant.surfaceId || 'unknown'}`,
      `Mode: ${mode}`,
      `Responsibility: ${assistant.responsibility}`,
      `Prompt:\n${assistantPrompt(assistant)}`,
      `Allowed actions: ${(assistant.allowedActions || []).join(', ') || 'chat'}`,
      'Use only product-supported generated UI concepts when describing progress: action choice, progress checklist, object preview, validation result, prompt diff, and task file summary. Ask concise clarifying questions when needed, then perform the work directly when local tools and context allow it.',
      mode === 'create' ? generatedObjectInstruction(assistant) : '',
      mode === 'prompt' ? promptPatchInstruction() : '',
      `Workspace: ${runtimeWorkdir || 'unknown'}`,
      `User request:\n${draft.trim()}`,
    ].filter(Boolean).join('\n\n');
  }, [assistant, draft, mode, runtimeWorkdir]);

  const start = async () => {
    if (!assistant || !draft.trim() || !runtimeWorkdir || busy) return;
    setBusy(true);
    setSessionKey(null);
    try {
      const result = await api.sendSessionMessage(runtimeWorkdir, agent, '', fullPrompt, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to start assistant');
      const nextSession = parseSessionKeyValue(result.sessionKey);
      setSessionKey(result.sessionKey || null);
      setActiveSession(nextSession);
      setInitialChatPrompt(draft.trim());
      toast(L(locale, 'Assistant 已启动', 'Assistant started'), true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to start assistant', false);
    } finally {
      setBusy(false);
    }
  };

  const sessionForPanel = useMemo<SessionInfo | null>(() => activeSession && assistant ? ({
    agent: activeSession.agent,
    sessionId: activeSession.sessionId,
    workdir: runtimeWorkdir,
    workspacePath: runtimeWorkdir,
    threadId: null,
    createdAt: new Date().toISOString(),
    title: draft.trim() || assistant.name,
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
    origin: { channel: 'dashboard', chatId: `owner-assistant:${assistant.id}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  }) : null, [activeSession, assistant, draft, runtimeWorkdir]);

  const generated = useAssistantGeneratedOutput({
    active: !!sessionForPanel,
    workdir: runtimeWorkdir,
    agent: activeSession?.agent,
    sessionId: activeSession?.sessionId,
  });

  const sendGeneratedAction = useCallback(async (action: 'test' | 'validate' | 'use') => {
    if (!activeSession || !assistant || sendingGeneratedAction) return;
    const objectType = generated.object?.type || assistant.objectTypes?.[0] || 'object';
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
  }, [activeSession, assistant, generated.object?.type, locale, runtimeWorkdir, sendingGeneratedAction, toast]);

  const applyPromptPatch = useCallback(async (nextPrompt: string) => {
    if (!assistant || applyingPrompt) return;
    setApplyingPrompt(true);
    try {
      const result = await api.updateProAssistantPrompt(assistant.id, { prompt: nextPrompt });
      if (!result.ok || !result.assistant) throw new Error(result.error || 'Failed to apply prompt update');
      onAssistantSaved?.(result.assistant);
      toast(L(locale, 'Prompt 已按对话更新', 'Prompt updated from chat'), true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to apply prompt update', false);
    } finally {
      setApplyingPrompt(false);
    }
  }, [applyingPrompt, assistant, locale, onAssistantSaved, toast]);

  const transcriptFooter = sessionForPanel && assistant ? (
    <div className="space-y-3">
      {generated.object && (
        <GeneratedObjectBlock
          locale={locale}
          assistant={assistant}
          object={generated.object}
          loading={generated.loading || sendingGeneratedAction}
          error={generated.error}
          onOpenFocus={() => setToolWindowOpen(true)}
          onRunAction={sendGeneratedAction}
          onOpenPrompt={onOpenPrompt ? () => onOpenPrompt(assistant) : undefined}
        />
      )}
      {(mode === 'prompt' || generated.promptPatch) && (
        <PromptPatchBlock
          locale={locale}
          assistant={assistant}
          proposedPrompt={generated.promptPatch}
          loading={generated.loading}
          applying={applyingPrompt}
          error={generated.error}
          onApply={applyPromptPatch}
        />
      )}
    </div>
  ) : null;

  const panelStyle = {
    maxWidth: sessionForPanel ? 'min(1040px, calc(100vw - 32px))' : mode === 'test' ? 'min(560px, calc(100vw - 32px))' : 'min(700px, calc(100vw - 32px))',
    maxHeight: 'min(92vh, 860px)',
  } satisfies CSSProperties;

  const testStatusText = assistantTest.chatStatus === 'running'
    ? L(locale, 'Chat check 中', 'Chat check running')
    : assistantTest.healthStatus === 'running'
    ? L(locale, '检测中', 'Checking')
    : assistantTest.healthStatus === 'ok'
      ? L(locale, '可用', 'Available')
      : assistantTest.healthStatus === 'failed' || assistantTest.chatStatus === 'failed'
        ? L(locale, '不可用', 'Unavailable')
        : L(locale, '待检测', 'Ready');

  const content = assistant ? (
    <div className="space-y-4">
      <div className="rounded-lg border border-edge/70 bg-panel-alt/68 px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="accent">{assistant.surfaceId || 'surface'}</Badge>
          <Badge variant="muted">{assistant.kind || 'assistant'}</Badge>
          {assistant.builtIn && <Badge variant="ok">{L(locale, '内置', 'Built-in')}</Badge>}
          {localFloating && <Badge variant="warn">{L(locale, 'Focus mode', 'Focus mode')}</Badge>}
        </div>
        <div className="mt-2 text-[12px] leading-relaxed text-fg-4">{assistant.responsibility}</div>
      </div>

      {mode === 'test' && !sessionForPanel ? (
        <div className="rounded-lg border border-edge bg-panel shadow-sm">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-edge px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <BrandIcon brand={agent as any} size={16} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-fg-2">{testStatusText}</div>
                <div className="truncate text-[11px] text-fg-5">
                  {L(locale, '先 health check，再发送真实模型消息', 'Health check first, then a real model message')}
                </div>
              </div>
            </div>
            {(assistantTest.healthStatus === 'running' || assistantTest.chatStatus === 'running') && <Spinner className="h-4 w-4" />}
          </div>
          <div className="space-y-2.5 px-3 py-3">
            {[
              {
                label: L(locale, 'Assistant 配置', 'Assistant config'),
                detail: `${assistant.kind || 'assistant'} · ${(assistant.allowedActions || []).join(', ') || 'chat'}`,
                state: 'ok',
              },
              {
                label: L(locale, '选择运行时', 'Runtime selected'),
                detail: `${agent}${assistant.preferredAgents?.length ? ` · preferred: ${assistant.preferredAgents.join(', ')}` : ''}`,
                state: 'ok',
              },
              {
                label: L(locale, 'CLI / 认证检测', 'CLI / auth check'),
                detail: assistantTest.healthStatus === 'running'
                  ? L(locale, '正在检查本地安装、认证和基础配置', 'Checking local install, auth, and basic config')
                  : assistantTest.healthResult?.detail || assistantTest.error || L(locale, '尚未运行', 'Not run yet'),
                state: assistantTest.healthStatus,
              },
              {
                label: L(locale, '真实 Chat 检测', 'Real chat check'),
                detail: assistantTest.chatStatus === 'pending'
                  ? L(locale, '等待 health check 通过后发送真实消息。', 'Waiting for health check before sending a real message.')
                  : assistantTest.chatStatus === 'running'
                    ? L(locale, '已发送：Reply with exactly OK。下方显示真实会话和过程。', 'Sent: Reply with exactly OK. The live session is shown below.')
                    : assistantTest.error || '',
                state: assistantTest.chatStatus,
              },
            ].map(step => (
              <div key={step.label} className="flex min-w-0 items-start gap-2 rounded-md border border-edge/65 bg-panel-alt px-2.5 py-2">
                <span className={cn(
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  step.state === 'running' ? 'animate-pulse bg-emerald-400/70' : step.state === 'failed' ? 'bg-rose-400/80' : 'bg-emerald-400/80',
                )} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-fg-2">{step.label}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">{step.detail}</div>
                </div>
              </div>
            ))}
            {assistantTest.healthResult?.output && (
              <pre className="max-h-44 overflow-auto rounded-md border border-edge/70 bg-inset px-2.5 py-2 text-[11px] leading-relaxed text-fg-4">
                {assistantTest.healthResult.output}
              </pre>
            )}
            {assistantTest.chatSession && (
              <div className="h-[min(42vh,430px)] min-h-[300px] overflow-hidden rounded-lg border border-edge bg-[var(--th-session-bg)]">
                <SessionPanel
                  session={{
                    agent: assistantTest.chatSession.agent,
                    sessionId: assistantTest.chatSession.sessionId,
                    workdir: runtimeWorkdir,
                    workspacePath: runtimeWorkdir,
                    runState: 'running',
                  } as SessionInfo}
                  workdir={runtimeWorkdir}
                  active
                />
              </div>
            )}
          </div>
        </div>
      ) : !sessionForPanel && (
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
            className="min-h-36 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
        </>
      )}

      {sessionKey && (
        <div className="rounded-md border border-[color:var(--th-ok)]/25 bg-[color-mix(in_oklab,var(--th-ok)_10%,transparent)] px-3 py-2 text-[12px] text-fg-3">
          {L(locale, 'Assistant session: ', 'Assistant session: ')}
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
          {sessionForPanel && !localFloating && (
            <Button variant="secondary" onClick={() => setLocalFloating(true)}>
              {L(locale, 'Focus mode', 'Focus mode')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy && mode !== 'test'}>{L(locale, '关闭', 'Close')}</Button>
          {!sessionForPanel && mode === 'test' ? (
            <Button variant="primary" onClick={() => void runAssistantTest()} disabled={busy}>
              {busy ? <Spinner /> : null}
              {assistantTest.healthStatus === 'idle' ? L(locale, '检测', 'Check') : L(locale, '重新检测', 'Retry')}
            </Button>
          ) : !sessionForPanel && (
            <Button variant="primary" onClick={start} disabled={!draft.trim() || !runtimeWorkdir || busy}>
              {busy ? <Spinner /> : null}
              {L(locale, '启动', 'Start')}
            </Button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const toolWindow = assistant ? (
    <GeneratedToolWindow
      open={toolWindowOpen}
      locale={locale}
      assistant={assistant}
      object={generated.object}
      onClose={() => setToolWindowOpen(false)}
      onRunAction={sendGeneratedAction}
    />
  ) : null;

  if (localFloating) {
    return (
      <DraggableAssistantSurface
        open={open && !!assistant}
        title={title || assistant?.name || 'Assistant'}
        description={description || assistant?.responsibility}
        onClose={onClose}
        panelStyle={panelStyle}
      >
        {content}
        {toolWindow}
      </DraggableAssistantSurface>
    );
  }

  return (
    <Modal
      open={open && !!assistant}
      onClose={onClose}
      wide
      panelStyle={panelStyle}
    >
      <ModalHeader
        title={title || assistant?.name || 'Assistant'}
        description={description || assistant?.responsibility}
        onClose={onClose}
      />
      {content}
      {toolWindow}
    </Modal>
  );
}

export function AssistantPromptDialog({
  open,
  assistant,
  onClose,
  onSaved,
  onChatEdit,
}: {
  open: boolean;
  assistant: AgentAssistant | null;
  onClose: () => void;
  onSaved: (assistant: AgentAssistant) => void;
  onChatEdit?: (assistant: AgentAssistant) => void;
}) {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open || !assistant) return undefined;
    setLoading(true);
    setPrompt('');
    setDefaultPrompt('');
    void api.getProAssistantPrompt(assistant.id)
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setPrompt(res.prompt || '');
          setDefaultPrompt(res.defaultPrompt || '');
          setCustomized(!!res.customized);
        } else {
          toast(res.error || 'Failed to load prompt', false);
        }
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Failed to load prompt', false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assistant, open, toast]);

  const changed = prompt.trim() !== defaultPrompt.trim();
  const lineDelta = prompt.split('\n').length - defaultPrompt.split('\n').length;

  const save = async () => {
    if (!assistant || saving) return;
    setSaving(true);
    try {
      const res = await api.updateProAssistantPrompt(assistant.id, { prompt });
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to save prompt');
      setCustomized(!!res.customized);
      onSaved(res.assistant);
      toast(L(locale, 'Prompt 已更新', 'Prompt updated'), true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save prompt', false);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!assistant || saving) return;
    setSaving(true);
    try {
      const res = await api.resetProAssistantPrompt(assistant.id);
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to reset prompt');
      setPrompt(res.prompt || '');
      setDefaultPrompt(res.defaultPrompt || '');
      setCustomized(false);
      onSaved(res.assistant);
      toast(L(locale, 'Prompt 已重置', 'Prompt reset'), true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset prompt', false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open && !!assistant} onClose={onClose} wide panelStyle={{ maxWidth: 'min(840px, calc(100vw - 32px))' }}>
      <ModalHeader
        title={assistant ? `${assistant.name} prompt` : 'Assistant prompt'}
        description={assistant?.responsibility}
        onClose={onClose}
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {assistant?.surfaceId && <Badge variant="accent">{assistant.surfaceId}</Badge>}
          {customized ? <Badge variant="warn">{L(locale, '已自定义', 'Customized')}</Badge> : <Badge variant="ok">{L(locale, '默认', 'Default')}</Badge>}
          <CountBadge>{lineDelta === 0 ? 'no line delta' : `${lineDelta > 0 ? '+' : ''}${lineDelta} lines`}</CountBadge>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-fg-5"><Spinner /> Loading prompt...</div>
        ) : (
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            className="min-h-[360px] w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 font-mono text-[12px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
        )}
        <div className="rounded-md border border-edge/65 bg-panel-alt/58 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Prompt diff</div>
          <div className="mt-1 text-[12px] text-fg-4">
            {changed
              ? L(locale, '当前草稿与默认 prompt 不同。保存后会作为该 assistant 的新工作脑。', 'Draft differs from the default prompt. Saving makes it this assistant working prompt.')
              : L(locale, '当前内容与默认 prompt 一致。', 'Current content matches the default prompt.')}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{L(locale, '关闭', 'Close')}</Button>
          {assistant && onChatEdit && (
            <Button variant="secondary" onClick={() => onChatEdit(assistant)} disabled={saving || loading}>
              {L(locale, '对话修改', 'Chat edit')}
            </Button>
          )}
          <Button variant="secondary" onClick={reset} disabled={saving || loading || !customized}>{saving ? <Spinner /> : null}{L(locale, '重置', 'Reset')}</Button>
          <Button variant="primary" onClick={save} disabled={saving || loading || !prompt.trim()}>{saving ? <Spinner /> : null}{L(locale, '保存', 'Save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AssistantHistoryDialog({
  open,
  assistant,
  onClose,
}: {
  open: boolean;
  assistant: AgentAssistant | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const [items, setItems] = useState<AssistantHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open || !assistant) return undefined;
    setLoading(true);
    void api.getProAssistantHistory('all')
      .then(res => {
        if (cancelled) return;
        if (res.ok) setItems(res.history?.[assistant.id] || []);
        else toast(res.error || 'Failed to load history', false);
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Failed to load history', false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assistant, open, toast]);

  const openHistorySession = useCallback((item: AssistantHistoryItem) => {
    const existing = openSessionsFromStorage();
    const exactIndex = existing.findIndex(slot => slot.workdir === item.workdir && slot.agent === item.agent && slot.sessionId === item.sessionId);
    const next = exactIndex >= 0
      ? existing.map((slot, index) => index === exactIndex ? { ...slot, archiveOnly: true } : slot)
      : [{ workdir: item.workdir, agent: item.agent, sessionId: item.sessionId, mountKey: mountKey(), archiveOnly: true }, ...existing];
    try {
      localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(exactIndex >= 0 ? exactIndex : 0));
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    onClose();
    navigate('/chat');
  }, [navigate, onClose]);

  return (
    <Modal open={open && !!assistant} onClose={onClose} wide>
      <ModalHeader
        title={assistant ? `${assistant.name} history` : 'Assistant history'}
        description={L(locale, '这个 assistant 过去创建或参与过的真实 session。', 'Real sessions previously created or joined by this assistant.')}
        onClose={onClose}
      />
      <div className="max-h-[min(68vh,720px)] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-fg-5"><Spinner /> Loading history...</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-edge bg-panel-alt px-4 py-8 text-center text-[12px] text-fg-5">
            {L(locale, '还没有历史运行。', 'No history yet.')}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <button
                key={`${item.source}:${item.workdir}:${item.agent}:${item.sessionId}`}
                type="button"
                onClick={() => openHistorySession(item)}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-2 text-left transition hover:border-edge-h hover:bg-panel-h"
              >
                <BrandIcon agent={item.agent as any} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg-2">{item.title || item.lastQuestion || item.sessionId}</span>
                  <span className="mt-1 block truncate text-[11px] text-fg-5">{item.sourceLabel || item.source} · {item.agent}:{item.sessionId}</span>
                </span>
                <Badge variant={item.runState === 'running' ? 'ok' : item.runState === 'incomplete' ? 'warn' : 'muted'}>{item.runState || 'session'}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function OwnerAssistantStrip({
  assistantId,
  surfaceId,
  title,
  description,
  createLabel,
  createPrompt,
  testPrompt,
  workdir,
  className,
}: {
  assistantId?: string;
  surfaceId?: string;
  title?: string;
  description?: string;
  createLabel?: string;
  createPrompt?: string;
  testPrompt?: string;
  workdir?: string;
  className?: string;
}) {
  const locale = useStore(s => s.locale);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [loading, setLoading] = useState(false);
  const [runMode, setRunMode] = useState<AssistantRunMode | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadAssistants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getProAssistants();
      if (res.ok) setAssistants(res.assistants || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAssistants(); }, [loadAssistants]);

  const assistant = useMemo(() => {
    if (assistantId) return assistants.find(item => item.id === assistantId) || null;
    if (surfaceId) return assistants.find(item => item.kind === 'page-owner' && item.surfaceId === surfaceId) || null;
    return null;
  }, [assistantId, assistants, surfaceId]);

  const handleSaved = useCallback((next: AgentAssistant) => {
    setAssistants(prev => prev.map(item => item.id === next.id ? next : item));
  }, []);

  if (!assistant && !loading) return null;

  return (
    <section
      className={cn(
        'rounded-xl border border-edge/65 bg-panel/72 px-3 py-3 shadow-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge bg-inset text-[12px] font-semibold text-fg-3">
              AI
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-fg-2">{title || assistant?.name || 'Assistant'}</span>
                {assistant?.surfaceId && <Badge variant="accent">{assistant.surfaceId}</Badge>}
                {assistant?.builtIn && <Badge variant="ok">{L(locale, '内置', 'Built-in')}</Badge>}
              </div>
              <div className="mt-0.5 line-clamp-1 text-[11px] text-fg-5">{description || assistant?.responsibility || 'Loading assistant...'}</div>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {loading && <Spinner className="h-3.5 w-3.5" />}
          <Button size="sm" variant="primary" disabled={!assistant} onClick={() => setRunMode('chat')}>{L(locale, 'Chat', 'Chat')}</Button>
          {createPrompt && (
            <Button size="sm" variant="secondary" disabled={!assistant} onClick={() => setRunMode('create')}>
              {createLabel || L(locale, 'Create', 'Create')}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={!assistant} onClick={() => setRunMode('test')}>{L(locale, 'Test', 'Test')}</Button>
          <Button size="sm" variant="outline" disabled={!assistant} onClick={() => setPromptOpen(true)}>{L(locale, 'Prompt', 'Prompt')}</Button>
          <Button size="sm" variant="outline" disabled={!assistant} onClick={() => setHistoryOpen(true)}>{L(locale, 'History', 'History')}</Button>
        </div>
      </div>

      <AssistantRunDialog
        open={!!runMode}
        assistant={assistant}
        mode={runMode || 'chat'}
        title={assistant ? `${assistant.name} · ${runMode || 'chat'}` : undefined}
        initialPrompt={runMode === 'create' ? createPrompt : runMode === 'test' ? testPrompt : runMode === 'prompt' ? actionPromptForMode('prompt', assistant!, undefined) : undefined}
        workdir={workdir}
        onClose={() => setRunMode(null)}
      />
      <AssistantPromptDialog
        open={promptOpen}
        assistant={assistant}
        onClose={() => setPromptOpen(false)}
        onSaved={handleSaved}
      />
      <AssistantHistoryDialog
        open={historyOpen}
        assistant={assistant}
        onClose={() => setHistoryOpen(false)}
      />
    </section>
  );
}
