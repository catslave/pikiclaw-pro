import { useState, memo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { cn, fmtTime, getAgentMeta } from '../../utils';
import { BrandIcon } from '../../components/BrandIcon';
import { createMdComponents, mdPlugins, type OpenFileLinkHandler } from './markdown';
import { stripOaiMemoryCitations } from './messageSanitizers';
import { isContinuationSummary } from './utils';
import { AssistantMsg, hasRenderableAssistant } from './AssistantContent';
import type { MessageBlock, RichMessage, StreamPreviewMeta } from '../../types';
import type { Turn } from './utils';

export type SelectionSideChatRequest = { quote: string; question: string };

export const TurnView = memo(function TurnView({ turn, turnIndex, agent, meta, model, effort, providerName, previewMeta, liveAssistant, t, onResend, onEdit, onFork, onOpenFileLink, onCreateSideChatFromSelection, workdir, retryProminent }: {
  turn: Turn; turnIndex?: number; agent: string; meta: ReturnType<typeof getAgentMeta>; model?: string | null; effort?: string | null; t: (k: string) => string;
  /** BYOK provider name shown on the assistant turn header — set when the
   *  agent is currently bound to a Profile. Saved turns lack this in their
   *  usage payload, so we accept it from the caller as a session-level prop. */
  providerName?: string | null;
  previewMeta?: StreamPreviewMeta | null;
  liveAssistant?: ReactNode;
  onResend?: (text: string) => void;
  onEdit?: (text: string) => void;
  /** When defined, the user-bubble shows a fork action that opens a fork composer scoped to this turn. */
  onFork?: (atTurn: number) => void;
  onOpenFileLink?: OpenFileLinkHandler;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  workdir?: string;
  retryProminent?: boolean;
}) {
  // Detect system continuation messages stored as user role (context compression summaries,
  // interruption markers). These should not render as user bubbles regardless of whether
  // the turn also contains an assistant response.
  const isSystemMsg = turn.user && isContinuationSummary(turn.user.text);
  const handleFork = onFork && typeof turnIndex === 'number' ? () => onFork(turnIndex) : undefined;
  // Skip the assistant header entirely when there's nothing to put under it —
  // a phantom header reads as "Claude said something invisible" to users.
  const showAssistant = !!turn.assistant && hasRenderableAssistant(turn.assistant);
  const showLiveAssistant = !!liveAssistant;
  const mdComponents = createMdComponents({ onOpenFileLink, workdir });

  return (
    <div className="session-turn">
      {turn.user && !isSystemMsg && (
        <UserBubble text={turn.user.text} blocks={turn.user.blocks} createdAt={turn.user.createdAt} t={t} onResend={onResend} onEdit={onEdit} onFork={handleFork} retryProminent={retryProminent} />
      )}
      {isSystemMsg && turn.user && !turn.assistant && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[rgba(255,255,255,0.02)] border border-edge/20 text-[12.5px] leading-[1.7] text-fg-4">
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {turn.user.text}
          </ReactMarkdown>
        </div>
      )}
      {(showAssistant || showLiveAssistant) && (
        <>
          <TurnDivider agent={agent} meta={meta} model={model} effort={effort} providerName={providerName} previewMeta={previewMeta ?? turn.assistant?.usage ?? null} />
          {showLiveAssistant
            ? <div className="mb-6">{liveAssistant}</div>
            : <AssistantMessageFrame message={turn.assistant!} t={t} startedAt={turn.user?.createdAt ?? null} onFork={handleFork} onOpenFileLink={onOpenFileLink} onCreateSideChatFromSelection={onCreateSideChatFromSelection} workdir={workdir} />}
        </>
      )}
    </div>
  );
});

/** Lightbox for full-screen image preview */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

/** Threshold above which a user bubble's text starts collapsed behind a toggle.
 *  Picked to comfortably fit a paragraph or short snippet inline while folding
 *  large pastes (logs, code, the cross-agent `<handover>` seed). */
const LONG_USER_TEXT_CHAR_THRESHOLD = 1500;
const LONG_USER_TEXT_LINE_THRESHOLD = 16;
/** Lines kept visible above the "show all" toggle when collapsed. */
const COLLAPSED_PREVIEW_LINES = 8;

function previewFromText(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= COLLAPSED_PREVIEW_LINES) return text;
  return lines.slice(0, COLLAPSED_PREVIEW_LINES).join('\n');
}

/** User message bubble with actions */
export function UserBubble({ text, blocks, createdAt, t, onResend, onEdit, onFork, retryProminent }: {
  text: string;
  blocks?: MessageBlock[];
  createdAt?: string | null;
  t: (k: string) => string;
  onResend?: (text: string) => void;
  onEdit?: (text: string) => void;
  /** When provided, hover action bar shows a fork button that branches off this turn. */
  onFork?: () => void;
  retryProminent?: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const totalLines = text ? text.split('\n').length : 0;
  const isLong = !!text && (text.length > LONG_USER_TEXT_CHAR_THRESHOLD || totalLines > LONG_USER_TEXT_LINE_THRESHOLD);
  const [expanded, setExpanded] = useState(false);
  const displayText = !text ? '' : (isLong && !expanded ? previewFromText(text) : text);
  const hasActions = !!(createdAt || text || onResend || onEdit || onFork);
  const imageBlocks = dedupeImageBlocks(blocks?.filter(b => b.type === 'image') || []);

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const expandLabel = t('hub.expand')
    .replace('{chars}', text ? text.length.toLocaleString() : '0')
    .replace('{lines}', String(totalLines));

  return (
    <div
      className="flex flex-col items-end mb-5 group/bubble"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="min-w-0 max-w-[72%] rounded-md border border-fg-6 bg-panel px-4 py-3 text-[13.5px] leading-[1.72] text-fg shadow-sm">
        {text && (
          <div className="whitespace-pre-wrap break-words">
            {displayText}
            {isLong && !expanded && <span className="text-fg-5/60">…</span>}
          </div>
        )}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-2 text-[11.5px] text-fg-4 hover:text-fg-2 underline decoration-fg-5/40 underline-offset-2 transition-colors"
          >
            {expanded ? t('hub.collapse') : expandLabel}
          </button>
        )}
        {imageBlocks.length > 0 && (
          <div className={cn('flex min-w-0 max-w-full flex-wrap gap-2', text && 'mt-2')}>
            {imageBlocks.map((img, i) => (
              <img
                key={i}
                src={img.content}
                className="h-auto w-full max-w-[min(280px,100%)] max-h-[200px] rounded border border-fg-6/50 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
                onClick={() => setLightboxSrc(img.content)}
              />
            ))}
          </div>
        )}
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      {/* Action bar — appears below the bubble on hover */}
      {hasActions && (
        <HoverMessageActions
          align="right"
          visible={showActions || !!retryProminent}
          createdAt={createdAt}
          canCopy={!!text}
          copied={copied}
          t={t}
          onCopy={handleCopy}
          onResend={onResend ? () => onResend(text) : undefined}
          resendLabel={retryProminent ? t('hub.retry') : undefined}
          resendEmphasis={retryProminent}
          onEdit={onEdit ? () => onEdit(text) : undefined}
          onFork={onFork}
        />
      )}
    </div>
  );
}

function dedupeImageBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const seen = new Set<string>();
  const out: MessageBlock[] = [];
  for (const block of blocks) {
    const key = block.imagePath || block.content;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(block);
  }
  return out;
}

function AssistantMessageFrame({
  message,
  t,
  startedAt,
  onFork,
  onOpenFileLink,
  onCreateSideChatFromSelection,
  workdir,
}: {
  message: RichMessage;
  t: (k: string) => string;
  startedAt?: string | null;
  onFork?: () => void;
  onOpenFileLink?: OpenFileLinkHandler;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  workdir?: string;
}) {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<{
    quote: string;
    rect: { left: number; top: number; width: number; height: number };
    highlightRects: Array<{ left: number; top: number; width: number; height: number }>;
    asking: boolean;
    question: string;
    creating: boolean;
  } | null>(null);
  const copyText = stripOaiMemoryCitations(message.text || message.blocks.map(block => block.content).filter(Boolean).join('\n\n'));

  const handleCopy = () => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  useEffect(() => {
    if (!selectionDraft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionDraft(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-selection-side-chat-popover]')) return;
      if (frameRef.current?.contains(target)) return;
      setSelectionDraft(null);
    };
    const clearSelectionDraft = () => {
      window.getSelection()?.removeAllRanges();
      setSelectionDraft(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', clearSelectionDraft, true);
    window.addEventListener('resize', clearSelectionDraft);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', clearSelectionDraft, true);
      window.removeEventListener('resize', clearSelectionDraft);
    };
  }, [selectionDraft]);

  const handleSelectionEnd = () => {
    if (!onCreateSideChatFromSelection || !frameRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const rawQuote = selection.toString().replace(/\s+\n/g, '\n').trim();
    if (!rawQuote) return;
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const element = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as Element
      : ancestor.parentElement;
    if (!element || !frameRef.current.contains(element)) return;
    if (!element.closest('.session-md')) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const highlightRects = Array.from(range.getClientRects())
      .filter(item => item.width > 0 && item.height > 0)
      .slice(0, 24)
      .map(item => ({ left: item.left, top: item.top, width: item.width, height: item.height }));
    setSelectionDraft({
      quote: rawQuote.slice(0, 8000),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      highlightRects,
      asking: false,
      question: '',
      creating: false,
    });
  };

  const handleSelectionStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectionDraft) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.session-md')) return;
    window.getSelection()?.removeAllRanges();
    setSelectionDraft(null);
  };

  const submitSelectionSideChat = async () => {
    if (!selectionDraft || !onCreateSideChatFromSelection || selectionDraft.creating) return;
    const question = selectionDraft.question.trim();
    if (!question) return;
    setSelectionDraft(current => current ? { ...current, creating: true } : current);
    try {
      await onCreateSideChatFromSelection({ quote: selectionDraft.quote, question });
      window.getSelection()?.removeAllRanges();
      setSelectionDraft(null);
    } catch {
      setSelectionDraft(current => current ? { ...current, creating: false } : current);
    }
  };

  return (
    <div
      ref={frameRef}
      className="mb-6 group/assistant"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onMouseDown={handleSelectionStart}
      onMouseUp={handleSelectionEnd}
      onKeyUp={handleSelectionEnd}
    >
      <AssistantMsg message={message} t={t} startedAt={startedAt ?? null} completedAt={message.createdAt ?? null} onOpenFileLink={onOpenFileLink} workdir={workdir} />
      <HoverMessageActions
        align="left"
        visible={showActions}
        createdAt={message.createdAt}
        canCopy={!!copyText}
        copied={copied}
        t={t}
        onCopy={handleCopy}
        onFork={onFork}
      />
      {selectionDraft && onCreateSideChatFromSelection && createPortal(
        <>
          {selectionDraft.highlightRects.map((rect, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="pointer-events-none fixed z-[9998] rounded-[3px] bg-primary/15 ring-1 ring-primary/20"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          ))}
          <div
            data-selection-side-chat-popover
            className="fixed z-[10000]"
            style={{
              left: Math.min(
                window.innerWidth - (selectionDraft.asking ? 360 : 112),
                Math.max(12, selectionDraft.rect.left - (selectionDraft.asking ? 348 : 40)),
              ),
              top: Math.min(window.innerHeight - (selectionDraft.asking ? 96 : 36), Math.max(12, selectionDraft.rect.top - 6)),
            }}
            onClick={event => event.stopPropagation()}
          >
            {!selectionDraft.asking ? (
              <button
                type="button"
                title={t('session.sideChat')}
                aria-label={t('session.sideChat')}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setSelectionDraft(current => current ? { ...current, asking: true } : current)}
                className="group/selection-side-chat inline-flex h-8 max-w-8 items-center justify-start gap-1.5 overflow-hidden rounded-full border border-edge-h bg-panel px-[9px] text-fg-3 shadow-lg transition-all hover:max-w-[112px] hover:bg-panel-h hover:px-3 hover:text-fg focus-visible:max-w-[112px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
              >
                <span className="shrink-0 text-[18px] leading-none">+</span>
                <span className="whitespace-nowrap text-[11px] font-semibold opacity-0 transition-opacity group-hover/selection-side-chat:opacity-100 group-focus-visible/selection-side-chat:opacity-100">
                  {t('session.sideChat')}
                </span>
              </button>
            ) : (
              <div className="w-[340px] rounded-xl border border-edge-h bg-panel p-2 shadow-xl">
                <div className="mb-2 max-h-[42px] overflow-hidden rounded-lg bg-panel-alt px-2 py-1.5 text-[11px] leading-relaxed text-fg-5">
                  {selectionDraft.quote}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={selectionDraft.question}
                    onChange={event => setSelectionDraft(current => current ? { ...current, question: event.target.value } : current)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitSelectionSideChat();
                      }
                    }}
                    placeholder={t('session.sideChatSelectionPlaceholder')}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-control-border bg-control px-2 text-[12px] text-fg outline-none transition placeholder:text-fg-5/60 focus:border-control-border-h focus:ring-2 focus:ring-[color:var(--th-selection-ring)]"
                  />
                  <button
                    type="button"
                    disabled={!selectionDraft.question.trim() || selectionDraft.creating}
                    onClick={() => void submitSelectionSideChat()}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-edge-h bg-panel-h px-3 text-[12px] font-semibold text-fg transition hover:bg-control disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectionDraft.creating ? t('session.creatingSideChat') : t('session.createSideChat')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function HoverMessageActions({ align, visible, createdAt, canCopy, copied, t, onCopy, onResend, resendLabel, resendEmphasis, onEdit, onFork }: {
  align: 'left' | 'right';
  visible: boolean;
  createdAt?: string | null;
  canCopy: boolean;
  copied: boolean;
  t: (k: string) => string;
  onCopy: () => void;
  onResend?: () => void;
  resendLabel?: string;
  resendEmphasis?: boolean;
  onEdit?: () => void;
  onFork?: () => void;
}) {
  if (!createdAt && !canCopy && !onResend && !onEdit && !onFork) return null;
  return (
    <div className={cn(
      'flex items-center gap-1 mt-1.5 transition-all duration-200',
      align === 'right' ? 'mr-1 justify-end' : 'ml-1 justify-start',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none',
    )}>
      {createdAt && (
        <span className="px-1.5 text-[10.5px] tabular-nums text-fg-5/70" title={formatFullMessageTime(createdAt)}>
          {formatCompactMessageTime(createdAt)}
        </span>
      )}
      {canCopy && (
        <BubbleAction label={copied ? t('hub.copied') : t('hub.copy')} onClick={onCopy}>
          {copied
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          }
        </BubbleAction>
      )}
      {onResend && (
        <BubbleAction label={resendLabel || t('hub.rerun')} onClick={onResend} tone={resendEmphasis ? 'warn' : 'default'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </BubbleAction>
      )}
      {onEdit && (
        <BubbleAction label={t('hub.edit')} onClick={onEdit}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </BubbleAction>
      )}
      {onFork && (
        <BubbleAction label={t('hub.fork')} onClick={onFork}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
            <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
          </svg>
        </BubbleAction>
      )}
    </div>
  );
}

function formatCompactMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return fmtTime(iso);
}

function formatFullMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function BubbleAction({ label, onClick, children, tone = 'default' }: { label: string; onClick: () => void; children: ReactNode; tone?: 'default' | 'warn' }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'group/action inline-flex h-7 max-w-7 items-center justify-center overflow-hidden rounded border bg-panel px-[7px] text-[11px] leading-none shadow-sm transition-all duration-150',
        'hover:max-w-[132px] hover:justify-start hover:gap-1.5 hover:px-2 focus-visible:max-w-[132px] focus-visible:justify-start focus-visible:gap-1.5 focus-visible:px-2',
        tone === 'warn'
          ? 'border-warn/35 text-warn hover:border-warn/60 hover:bg-warn/10'
          : 'border-fg-6 text-fg-4 hover:text-fg-2 hover:border-edge-h hover:bg-panel-h',
      )}
    >
      <span className="shrink-0">{children}</span>
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/action:max-w-[104px] group-hover/action:opacity-100 group-focus-visible/action:max-w-[104px] group-focus-visible/action:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

export function TurnDivider({ agent, meta, model, effort, providerName: providerNameProp, previewMeta }: {
  agent: string;
  meta: ReturnType<typeof getAgentMeta>;
  model?: string | null;
  effort?: string | null;
  /** Session-level BYOK provider fallback used when previewMeta lacks one
   *  (saved messages don't carry usage / providerName). */
  providerName?: string | null;
  /** Live token / context-window stats — when present, rendered as a trailing chip. */
  previewMeta?: StreamPreviewMeta | null;
}) {
  const ctxPct = typeof previewMeta?.contextPercent === 'number' && Number.isFinite(previewMeta.contextPercent)
    ? Math.max(0, Math.min(100, previewMeta.contextPercent))
    : null;
  // Use the per-call context occupancy (input + cache_read + cache_creation
  // for the latest LLM call) — NOT the cumulative inputTokens/cachedInputTokens,
  // which double-count the same cached prefix on every tool roundtrip.
  const ctxTokens = previewMeta?.contextUsedTokens ?? 0;
  const showCtx = ctxPct != null || ctxTokens > 0;
  // Prefer live preview's providerName (most accurate per-turn); fall back to
  // the session-level prop for saved turns whose `usage` lacks the field.
  const providerName = previewMeta?.providerName ?? providerNameProp ?? null;
  return (
    <div className="flex items-center gap-1.5 mt-1 mb-3">
      <BrandIcon brand={agent} size={13} />
      <span style={{ color: meta.color }} className="text-[12px] font-semibold opacity-70">{meta.label}</span>
      {(model || effort) && (
        <span className="text-[10px] font-mono text-fg-5/50">
          {model || ''}{model && effort ? ' · ' : ''}{effort || ''}
        </span>
      )}
      {providerName && (
        <span
          className="text-[10px] font-mono text-fg-5/70 px-1.5 py-px rounded bg-fg-5/8"
          title={`This turn is routed through ${providerName} (BYOK), not the agent CLI's native auth.`}
        >
          via {providerName}
        </span>
      )}
      {showCtx && (
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-fg-5/55" title={formatContextTitle(previewMeta)}>
          {ctxPct != null && <ContextDot pct={ctxPct} />}
          <span>{ctxPct != null ? `${ctxPct.toFixed(1)}%` : ''}</span>
          {ctxTokens > 0 && <span className="text-fg-5/40">· {formatTokens(ctxTokens)}</span>}
        </span>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${n} tok`;
}

function formatContextTitle(meta: StreamPreviewMeta | null | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.contextPercent === 'number' && Number.isFinite(meta.contextPercent)) {
    parts.push(`Context: ${Math.max(0, Math.min(100, meta.contextPercent)).toFixed(1)}%`);
  }
  if (typeof meta.contextUsedTokens === 'number' && Number.isFinite(meta.contextUsedTokens)) {
    parts.push(`Tokens: ${meta.contextUsedTokens.toLocaleString()}`);
  }
  return parts.join('  ·  ');
}

function ContextDot({ pct }: { pct: number }) {
  const color = pct >= 85 ? 'bg-rose-400/70' : pct >= 60 ? 'bg-amber-400/70' : 'bg-emerald-400/70';
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}
