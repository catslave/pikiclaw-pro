import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import type { AgentAssistant, RichMessage } from '../../types';
import { Badge, Button, CountBadge, Spinner } from '../ui';

export type AssistantGeneratedObject = {
  type?: string;
  title?: string;
  summary?: string;
  id?: string;
  path?: string;
  status?: string;
  actions?: string[];
  validation?: string;
};

export type AssistantGeneratedOutput = {
  object: AssistantGeneratedObject | null;
  promptPatch: string | null;
  loading: boolean;
  error: string | null;
};

const OBJECT_TAG = 'PikiclawGeneratedObject';
const PROMPT_PATCH_TAG = 'PikiclawPromptPatch';

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

function preferredObjectType(assistant: AgentAssistant | null): string {
  const first = assistant?.objectTypes?.find(Boolean);
  if (first) return first;
  if (assistant?.surfaceId === 'mcp') return 'mcp-server';
  if (assistant?.surfaceId === 'skills') return 'skill';
  if (assistant?.surfaceId === 'dashboard') return 'task';
  return 'tool';
}

export function generatedObjectInstruction(assistant: AgentAssistant | null): string {
  const type = preferredObjectType(assistant);
  return [
    `When you have created or drafted the ${type}, output one final generated UI payload exactly once using this tag:`,
    `<${OBJECT_TAG}>`,
    JSON.stringify({
      type,
      title: 'Short object name',
      summary: 'What was created and how the user should use it.',
      id: 'optional stable id or name',
      path: 'optional file path or config path',
      status: 'created | drafted | needs-input | validation-needed',
      actions: ['open', 'test', 'edit'],
      validation: 'optional validation result or next check',
    }, null, 2),
    `</${OBJECT_TAG}>`,
    'Do not put secrets in this payload. Keep actions product-safe and limited to the assistant allowed actions.',
  ].join('\n');
}

export function promptPatchInstruction(): string {
  return [
    'If the user asks you to change your own prompt, first discuss the change. When the prompt update is ready, output the complete replacement prompt exactly once using this tag:',
    `<${PROMPT_PATCH_TAG}>`,
    'Full replacement prompt goes here.',
    `</${PROMPT_PATCH_TAG}>`,
    'The product will show this as a prompt diff and only apply it after the user confirms.',
  ].join('\n');
}

function taggedText(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i');
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function messageText(message: RichMessage): string {
  const blockText = message.blocks?.map(block => block.content).filter(Boolean).join('\n\n') || '';
  return [message.text, blockText].filter(Boolean).join('\n\n');
}

function cleanJsonPayload(text: string): string {
  return text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseGeneratedObject(text: string): AssistantGeneratedObject | null {
  const payload = taggedText(text, OBJECT_TAG);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(cleanJsonPayload(payload));
    if (!parsed || typeof parsed !== 'object') return null;
    const object = parsed as Record<string, unknown>;
    return {
      type: typeof object.type === 'string' ? object.type : undefined,
      title: typeof object.title === 'string' ? object.title : undefined,
      summary: typeof object.summary === 'string' ? object.summary : undefined,
      id: typeof object.id === 'string' ? object.id : undefined,
      path: typeof object.path === 'string' ? object.path : undefined,
      status: typeof object.status === 'string' ? object.status : undefined,
      actions: Array.isArray(object.actions) ? object.actions.filter((item): item is string => typeof item === 'string').slice(0, 6) : undefined,
      validation: typeof object.validation === 'string' ? object.validation : undefined,
    };
  } catch {
    return null;
  }
}

function extractPromptPatch(text: string): string | null {
  return taggedText(text, PROMPT_PATCH_TAG);
}

export function useAssistantGeneratedOutput({
  active,
  workdir,
  agent,
  sessionId,
}: {
  active: boolean;
  workdir: string;
  agent: string | null | undefined;
  sessionId: string | null | undefined;
}): AssistantGeneratedOutput {
  const [object, setObject] = useState<AssistantGeneratedObject | null>(null);
  const [promptPatch, setPromptPatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setObject(null);
    setPromptPatch(null);
    setError(null);
    if (!active || !workdir || !agent || !sessionId) return undefined;
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      setLoading(true);
      try {
        const result = await api.getSessionMessages(workdir, agent, sessionId, { lastNTurns: 10, rich: true }, { timeoutMs: 8_000 });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error || 'Unable to read assistant output');
          return;
        }
        const assistantTexts = (result.richMessages || [])
          .filter(message => message.role === 'assistant')
          .map(messageText)
          .reverse();
        const nextObject = assistantTexts.map(parseGeneratedObject).find(Boolean) || null;
        const nextPromptPatch = assistantTexts.map(extractPromptPatch).find(Boolean) || null;
        if (nextObject) setObject(nextObject);
        if (nextPromptPatch) setPromptPatch(nextPromptPatch);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to read assistant output');
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = window.setTimeout(poll, 3_000);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [active, agent, sessionId, workdir]);

  return { object, promptPatch, loading, error };
}

function objectLabel(type?: string): string {
  if (!type) return 'tool';
  if (type.includes('mcp')) return 'MCP';
  if (type.includes('skill')) return 'Skill';
  if (type.includes('task')) return 'Task';
  if (type.includes('assistant')) return 'Assistant';
  return type;
}

export function GeneratedObjectBlock({
  locale,
  assistant,
  object,
  loading,
  error,
  onOpenFocus,
  onRunAction,
  onOpenPrompt,
}: {
  locale: string;
  assistant: AgentAssistant | null;
  object: AssistantGeneratedObject | null;
  loading: boolean;
  error: string | null;
  onOpenFocus: () => void;
  onRunAction: (action: 'test' | 'validate' | 'use') => void;
  onOpenPrompt?: () => void;
}) {
  const fallbackType = preferredObjectType(assistant);
  const type = object?.type || fallbackType;
  const title = object?.title || L(locale, '等待 assistant 生成工具卡片', 'Waiting for generated tool card');
  const summary = object?.summary || L(
    locale,
    `assistant 创建完成后，会在这里渲染 ${objectLabel(type)} 预览和可执行操作。`,
    `When creation completes, the ${objectLabel(type)} preview and actions will render here.`,
  );
  const status = object?.status || (loading ? 'watching-session' : 'pending-output');
  const canUse = !!object;

  return (
    <div className="ml-auto max-w-[78%] rounded-lg border border-primary/25 bg-primary/[0.055] px-3 py-2.5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="accent">{L(locale, 'Generated UI', 'Generated UI')}</Badge>
        <Badge variant={canUse ? 'ok' : 'muted'}>{objectLabel(type)}</Badge>
        <CountBadge>{status}</CountBadge>
        {loading && <Spinner className="h-3 w-3 text-fg-5" />}
      </div>
      <div className="text-[13px] font-semibold text-fg">{title}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{summary}</div>
      {(object?.id || object?.path || object?.validation || error) && (
        <div className="mt-2 space-y-1 rounded-md border border-edge/55 bg-panel/65 px-2.5 py-2 text-[11px] text-fg-4">
          {object?.id && <div><span className="font-medium text-fg-3">ID</span> {object.id}</div>}
          {object?.path && <div className="break-all"><span className="font-medium text-fg-3">Path</span> {object.path}</div>}
          {object?.validation && <div><span className="font-medium text-fg-3">Validation</span> {object.validation}</div>}
          {error && <div className="text-[color:var(--th-warn)]">{error}</div>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onOpenFocus}>
          {L(locale, '打开窗口', 'Open window')}
        </Button>
        <Button size="sm" variant="secondary" disabled={!canUse} onClick={() => onRunAction('test')}>
          {L(locale, '测试', 'Test')}
        </Button>
        <Button size="sm" variant="secondary" disabled={!canUse} onClick={() => onRunAction('validate')}>
          {L(locale, '验证', 'Validate')}
        </Button>
        <Button size="sm" variant="outline" disabled={!canUse} onClick={() => onRunAction('use')}>
          {L(locale, '使用', 'Use')}
        </Button>
        {onOpenPrompt && (
          <Button size="sm" variant="ghost" onClick={onOpenPrompt}>Prompt</Button>
        )}
      </div>
    </div>
  );
}

export function PromptPatchBlock({
  locale,
  assistant,
  proposedPrompt,
  loading,
  applying,
  error,
  onApply,
}: {
  locale: string;
  assistant: AgentAssistant | null;
  proposedPrompt: string | null;
  loading: boolean;
  applying: boolean;
  error: string | null;
  onApply: (prompt: string) => void;
}) {
  const lineCount = useMemo(() => proposedPrompt ? proposedPrompt.split('\n').length : 0, [proposedPrompt]);
  return (
    <div className="ml-auto max-w-[78%] rounded-lg border border-[color:var(--th-warn)]/28 bg-[color-mix(in_oklab,var(--th-warn)_8%,transparent)] px-3 py-2.5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="warn">{L(locale, 'Prompt diff', 'Prompt diff')}</Badge>
        <Badge variant={proposedPrompt ? 'ok' : 'muted'}>{assistant?.name || 'Assistant'}</Badge>
        <CountBadge>{proposedPrompt ? `${lineCount} lines` : 'waiting'}</CountBadge>
        {loading && <Spinner className="h-3 w-3 text-fg-5" />}
      </div>
      <div className="text-[13px] font-semibold text-fg">
        {proposedPrompt ? L(locale, 'assistant 已生成 prompt 更新', 'Assistant proposed a prompt update') : L(locale, '等待 assistant 输出 prompt patch', 'Waiting for assistant prompt patch')}
      </div>
      <div className="mt-1 text-[12px] leading-relaxed text-fg-4">
        {L(locale, '只有点击 Apply 后才会写入这个内置 assistant 的 prompt。', 'The prompt is only updated after you click Apply.')}
      </div>
      {proposedPrompt && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-edge/65 bg-inset px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-3">
          {proposedPrompt}
        </pre>
      )}
      {error && <div className="mt-2 text-[11px] text-[color:var(--th-warn)]">{error}</div>}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="primary" disabled={!proposedPrompt || applying} onClick={() => proposedPrompt && onApply(proposedPrompt)}>
          {applying ? <Spinner /> : null}
          {L(locale, 'Apply', 'Apply')}
        </Button>
      </div>
    </div>
  );
}

export function GeneratedToolWindow({
  open,
  locale,
  assistant,
  object,
  onClose,
  onRunAction,
}: {
  open: boolean;
  locale: string;
  assistant: AgentAssistant | null;
  object: AssistantGeneratedObject | null;
  onClose: () => void;
  onRunAction: (action: 'test' | 'validate' | 'use') => void;
}) {
  const [position, setPosition] = useState({ x: 92, y: 92 });
  const [dragging, setDragging] = useState(false);
  const type = object?.type || preferredObjectType(assistant);
  const title = object?.title || assistant?.name || objectLabel(type);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const width = Math.min(window.innerWidth - 32, 520);
    setPosition({
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round(window.innerHeight * 0.16)),
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
    if (target?.closest('button, a')) return;
    const panel = event.currentTarget.closest('[data-generated-tool-window]') as HTMLElement | null;
    if (!panel) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const pointerId = event.pointerId;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
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
    <div className="fixed inset-0 z-[110] pointer-events-none">
      <div
        data-generated-tool-window
        className="glass-strong pointer-events-auto fixed overflow-hidden rounded-xl border border-edge-h shadow-[0_28px_88px_rgba(2,6,23,0.28),0_8px_24px_rgba(15,23,42,0.1)]"
        style={{
          left: position.x,
          top: position.y,
          width: 'min(520px, calc(100vw - 32px))',
          background: 'linear-gradient(180deg, color-mix(in oklab, var(--th-modal-bg) 91%, white 9%), color-mix(in oklab, var(--th-modal-bg) 98%, white 2%))',
        }}
      >
        <div
          onPointerDown={startDrag}
          className={`flex ${dragging ? 'cursor-grabbing' : 'cursor-grab'} items-start justify-between gap-3 border-b border-edge/65 px-4 py-3`}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="accent">{objectLabel(type)}</Badge>
              <Badge variant={object ? 'ok' : 'muted'}>{object?.status || 'preview'}</Badge>
            </div>
            <div className="mt-2 truncate text-[13px] font-semibold text-fg">{title}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="-mr-1 -mt-1 h-8 w-8 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <div className="text-[12px] leading-relaxed text-fg-4">
            {object?.summary || L(locale, '这个窗口会承载刚生成工具的测试、验证和使用入口。', 'This window holds the generated tool test, validation, and use actions.')}
          </div>
          {(object?.id || object?.path || object?.validation) && (
            <div className="space-y-1 rounded-md border border-edge/60 bg-inset px-2.5 py-2 text-[11px] text-fg-4">
              {object.id && <div><span className="font-medium text-fg-3">ID</span> {object.id}</div>}
              {object.path && <div className="break-all"><span className="font-medium text-fg-3">Path</span> {object.path}</div>}
              {object.validation && <div><span className="font-medium text-fg-3">Validation</span> {object.validation}</div>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={!object} onClick={() => onRunAction('test')}>{L(locale, '测试', 'Test')}</Button>
            <Button size="sm" variant="secondary" disabled={!object} onClick={() => onRunAction('validate')}>{L(locale, '验证', 'Validate')}</Button>
            <Button size="sm" variant="primary" disabled={!object} onClick={() => onRunAction('use')}>{L(locale, '使用', 'Use')}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
