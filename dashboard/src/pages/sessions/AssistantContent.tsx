import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../utils';
import { api } from '../../api';
import { CollapsibleCard, CountBadge } from '../../components/ui';
import { hasPlan } from '../../components/PlanProgressCard';
import { createMdComponents, mdPlugins, parseFileLinkTarget, type FileLinkTarget, type OpenFileLinkHandler } from './markdown';
import { stripOaiMemoryCitations } from './messageSanitizers';
import { lastNLines, summarizeToolResult, summarizeToolUse } from './utils';
import { ImageLightbox } from './TurnView';
import { CompletedWorkDisclosure, WorkingActivityDetails, WorkingActivitySummary, WorkingDiagnostics, WorkingNarrativeBlock, WorkingPlanList, WorkingSubAgentList, WorkingThinkingBlock } from './WorkingCard';
import { GeneratedOutputCards, buildGeneratedOutputInsights } from './GeneratedOutputCards';
import { WorkflowProgressRail } from './WorkflowProgressRail';
import { extractWorkflowAskMarkers, parseWorkflowProgress, stripWorkflowControlMarkers, type WorkflowAskMarker } from './workflowProgress';
import { extractScheduleProposalMarkers, scheduleProposalSignature, stripScheduleProposalMarkers, type ScheduleProposalMarker } from './scheduleProposal';
import type { AutomationRule, RichMessage, MessageBlock, WorkflowRunAsk, WorkflowRunRecord } from '../../types';

export type WorkflowAskAnswerHandler = (ask: WorkflowAskMarker, answer: string, skipped?: boolean) => void | Promise<void>;
export type ScheduleProposalActionHandler = (proposal: ScheduleProposalMarker) => Promise<AutomationRule | null | undefined>;

function normalizePreviewPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isAbsolutePreviewPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value.replace(/\\/g, '/'));
}

function joinPreviewPath(root: string, child: string): string {
  if (!root) return child;
  return `${root.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

function displayRelativePreviewPath(filePath: string, relativePath: string, workdir: string): string {
  const candidate = relativePath || filePath;
  if (!candidate) return '';
  if (!isAbsolutePreviewPath(candidate)) return candidate;
  const normalized = normalizePreviewPath(candidate);
  const normalizedWorkdir = normalizePreviewPath(workdir);
  if (normalizedWorkdir && (normalized === normalizedWorkdir || normalized.startsWith(`${normalizedWorkdir}/`))) {
    return normalized.slice(normalizedWorkdir.length).replace(/^\/+/, '') || normalized.split('/').pop() || normalized;
  }
  const obsidianMarker = '/Documents/Obsidian Vault/';
  const obsidianIndex = normalized.indexOf(obsidianMarker);
  if (obsidianIndex >= 0) return normalized.slice(obsidianIndex + obsidianMarker.length);
  return normalized.replace(/^\/+/, '');
}

function absolutePreviewPath(filePath: string, resolvedPath: string, workdir: string): string {
  if (resolvedPath && isAbsolutePreviewPath(resolvedPath)) return resolvedPath;
  if (filePath && isAbsolutePreviewPath(filePath)) return filePath;
  return joinPreviewPath(workdir, resolvedPath || filePath);
}

/* ═══════════════════════════════════════════════════════════════
   Assistant message — separated activity, thinking, output
   ═══════════════════════════════════════════════════════════════ */
export function AssistantMsg({
  message,
  t,
  startedAt,
  completedAt,
  runError,
  onOpenFileLink,
  workdir,
  workflowRun,
  workflowAskBusyId,
  onWorkflowAskAnswer,
  scheduleProposalBusyKey,
  onScheduleProposalCreate,
}: {
  message: RichMessage;
  t: (k: string) => string;
  startedAt?: string | null;
  completedAt?: string | null;
  runError?: string | null;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
  workflowRun?: WorkflowRunRecord | null;
  workflowAskBusyId?: string | null;
  onWorkflowAskAnswer?: WorkflowAskAnswerHandler;
  scheduleProposalBusyKey?: string | null;
  onScheduleProposalCreate?: ScheduleProposalActionHandler;
}) {
  const { activityBlocks, thinkingBlocks, narrativeBlocks, planBlocks, subAgentBlocks, outputBlocks, noticeBlocks } = categorizeAssistantBlocks(message.blocks);
  const latestPlan = [...planBlocks].reverse().find(block => hasPlan(block.plan));
  const narrativeText = narrativeBlocks.map(b => b.content).filter(Boolean).join('\n\n').trim();
  const hasProcessBlocks = activityBlocks.length > 0
    || thinkingBlocks.length > 0
    || planBlocks.some(block => hasPlan(block.plan))
    || subAgentBlocks.length > 0;
  const fallbackNarrativeToOutput = outputBlocks.length === 0 && narrativeBlocks.length > 0 && !hasProcessBlocks;
  const renderedOutputBlocks = outputBlocks.length > 0
    ? outputBlocks
    : fallbackNarrativeToOutput
      ? narrativeBlocks
      : [];
  const workingNarrativeText = fallbackNarrativeToOutput ? '' : narrativeText;
  const thinkingText = thinkingBlocks.map(b => b.content).filter(Boolean).join('\n\n').trim();
  const subAgents = subAgentBlocks.map(block => block.subAgent).filter(Boolean) as NonNullable<MessageBlock['subAgent']>[];
  const activitySummarySource = activityBlocks
    .filter(block => block.type === 'tool_use')
    .map(block => summarizeToolUse(block));
  const activityDetailLines = activityBlocks.map(block => (
    block.type === 'tool_use' ? summarizeToolUse(block) : summarizeToolResult(block)
  ));
  const hasWorking = activityBlocks.length > 0 || subAgents.length > 0 || !!latestPlan?.plan || !!thinkingText || !!workingNarrativeText;
  const hasContent = activityBlocks.length > 0 || subAgentBlocks.length > 0 || !!latestPlan?.plan || thinkingBlocks.length > 0 || narrativeBlocks.length > 0 || outputBlocks.length > 0 || noticeBlocks.length > 0;
  const effectiveRunError = runError
    || (hasWorking && renderedOutputBlocks.length === 0 ? t('hub.noOutputRecordedDetail') : null);
  if (!hasContent) return null;
  return (
    <div data-assistant-selectable className="space-y-3">
      {hasWorking && (
        <CompletedWorkDisclosure
          t={t}
          defaultOpen={!!effectiveRunError}
          startedAt={startedAt ?? null}
          completedAt={completedAt ?? message.createdAt ?? null}
          error={effectiveRunError}
        >
          <div className="space-y-3 px-3.5 py-3">
            <WorkingNarrativeBlock text={workingNarrativeText} t={t} />
            <WorkingPlanList plan={latestPlan?.plan} t={t} />
            <WorkingSubAgentList subAgents={subAgents} t={t} />
            <WorkingThinkingBlock text={thinkingText} t={t} />
            <WorkingActivitySummary lines={activitySummarySource} t={t} />
            <WorkingActivityDetails lines={activityDetailLines} t={t} />
            <WorkingDiagnostics diagnostics={message.usage?.diagnostics} t={t} />
          </div>
        </CompletedWorkDisclosure>
      )}
      {renderedOutputBlocks.length > 0 && <OutputBlock blocks={renderedOutputBlocks} t={t} onOpenFileLink={onOpenFileLink} workdir={workdir} workflowRun={workflowRun} workflowAskBusyId={workflowAskBusyId} onWorkflowAskAnswer={onWorkflowAskAnswer} scheduleProposalBusyKey={scheduleProposalBusyKey} onScheduleProposalCreate={onScheduleProposalCreate} />}
      {noticeBlocks.length > 0 && <SystemNoticeSection blocks={noticeBlocks} t={t} />}
    </div>
  );
}

export function hasRenderableAssistant(message: RichMessage): boolean {
  const { activityBlocks, thinkingBlocks, narrativeBlocks, planBlocks, subAgentBlocks, outputBlocks, noticeBlocks } = categorizeAssistantBlocks(message.blocks);
  return outputBlocks.length > 0
    || activityBlocks.length > 0
    || subAgentBlocks.length > 0
    || thinkingBlocks.length > 0
    || narrativeBlocks.length > 0
    || planBlocks.some(b => hasPlan(b.plan))
    || noticeBlocks.length > 0;
}

export function categorizeAssistantBlocks(blocks: MessageBlock[]): {
  activityBlocks: MessageBlock[];
  thinkingBlocks: MessageBlock[];
  narrativeBlocks: MessageBlock[];
  planBlocks: MessageBlock[];
  subAgentBlocks: MessageBlock[];
  outputBlocks: MessageBlock[];
  noticeBlocks: MessageBlock[];
} {
  const normalized = blocks
    .map(block => {
      if (!block.content.includes('<oai-mem-citation>')) return block;
      return { ...block, content: stripOaiMemoryCitations(block.content) };
    })
    .filter(block =>
      block.type === 'plan'
      || block.type === 'tool_use'
      || block.type === 'tool_result'
      || block.type === 'image'
      || block.type === 'sub_agent'
      || !!block.content.trim(),
    );
  return {
    activityBlocks: normalized.filter(b => b.type === 'tool_use' || b.type === 'tool_result'),
    thinkingBlocks: normalized.filter(b => b.type === 'thinking'),
    narrativeBlocks: normalized.filter(b => b.type === 'text' && b.phase === 'commentary'),
    planBlocks: normalized.filter(b => b.type === 'plan' && hasPlan(b.plan)),
    subAgentBlocks: normalized.filter(b => b.type === 'sub_agent'),
    outputBlocks: normalized.filter(b => (b.type === 'text' && b.phase !== 'commentary') || b.type === 'image'),
    noticeBlocks: normalized.filter(b => b.type === 'system_notice'),
  };
}

/* ═══════════════════════════════════════════════════════════════
   System notice — agent-runtime feedback (Claude CLI <synthetic>)
   ═══════════════════════════════════════════════════════════════ */
export function SystemNoticeSection({ blocks, t }: { blocks: MessageBlock[]; t: (k: string) => string }) {
  const text = blocks.map(b => b.content).filter(Boolean).join('\n\n').trim();
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12.5px] leading-[1.7] text-fg-3">
      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-amber-400/70 shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] font-mono uppercase tracking-wide text-amber-300/80">{t('hub.systemNotice') || 'Agent notice'}</div>
        <div className="mt-0.5 break-words whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Activity section — collapsible tool call summary (cyan accent)
   ═══════════════════════════════════════════════════════════════ */
export function ActivitySection({ blocks, t }: { blocks: MessageBlock[]; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const useBlocks = blocks.filter(b => b.type === 'tool_use');
  const totalOps = useBlocks.length;
  const lastUse = useBlocks[useBlocks.length - 1];
  const preview = lastUse ? summarizeToolUse(lastUse) : '';

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: 'bg-cyan-400/60' }}
      label={t('hub.activity')}
      preview={<span className="text-[11.5px] font-mono text-fg-4 truncate">{preview}</span>}
      badge={totalOps > 0 ? <CountBadge>{totalOps}</CountBadge> : undefined}
    >
      <div className="px-3.5 py-2.5 space-y-0.5">
        {blocks.map((block, i) => <ActivityLine key={i} block={block} />)}
      </div>
    </CollapsibleCard>
  );
}

export function ActivityLine({ block }: { block: MessageBlock }) {
  const [open, setOpen] = useState(false);
  const isUse = block.type === 'tool_use';
  const summary = isUse ? summarizeToolUse(block) : summarizeToolResult(block);
  return (
    <div>
      <button onClick={() => block.content && setOpen(v => !v)} className={cn('flex items-center gap-2 py-[3px] w-full text-left group rounded-sm transition-colors', block.content && 'hover:bg-panel-h/30')}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', isUse ? 'bg-fg-5/40' : 'bg-ok/40')} />
        <span className="text-[11px] font-mono text-fg-5/60 group-hover:text-fg-3 transition-colors truncate">
          {summary}
        </span>
      </button>
      {open && block.content && (
        <pre className="ml-3 mt-1 mb-2 p-3 rounded-md bg-inset border border-edge text-[11px] leading-[1.6] text-fg-4 font-mono whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto">
          {block.content.length > 3000 ? block.content.slice(0, 3000) + '\n\u2026' : block.content}
        </pre>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Thinking section — collapsible, last 3 lines preview
   ═══════════════════════════════════════════════════════════════ */
export function ThinkingSection({ blocks, t }: { blocks: MessageBlock[]; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const text = blocks.map(b => b.content).filter(Boolean).join('\n\n').trim();
  if (!text) return null;

  const preview = lastNLines(text, 3);

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: 'bg-violet-400/50' }}
      label={t('hub.thinking')}
      collapsedContent={
        preview ? (
          <div className="px-3.5 pb-2.5 -mt-0.5 text-[12px] text-fg-4 leading-[1.65] whitespace-pre-wrap break-words line-clamp-3">
            {preview}
          </div>
        ) : undefined
      }
    >
      <ThinkingExpandedContent scrollRef={scrollRef} text={text} />
    </CollapsibleCard>
  );
}

/** Expanded thinking content — scrolls to bottom on mount. */
export function ThinkingExpandedContent({ scrollRef, text }: { scrollRef: React.RefObject<HTMLDivElement | null>; text: string }) {
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  return (
    <div ref={scrollRef} className="px-3.5 py-3 text-[12px] text-fg-4 leading-[1.7] whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
      {text}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Output — markdown
   ═══════════════════════════════════════════════════════════════ */

/**
 * Single image card with a click-to-reveal "Prompt" disclosure. The full
 * caption (Codex `revised_prompt`, MCP image description, …) can be long —
 * showing a truncated preview crowds the chat layout and hides detail. The
 * disclosure keeps the layout calm by default and surfaces the complete
 * prompt only when the user explicitly asks for it.
 */
function ImageFigure({
  block,
  onLightbox,
  t,
}: {
  block: MessageBlock;
  onLightbox: (src: string) => void;
  t: (k: string) => string;
}) {
  const caption = block.imageCaption?.trim() || '';
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <figure className="flex w-full max-w-[400px] min-w-0 flex-col gap-1.5">
      <img
        src={block.content}
        alt={caption || ''}
        className="h-auto max-h-[300px] w-full max-w-full rounded-md border border-fg-6/50 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
        onClick={() => onLightbox(block.content)}
      />
      {caption && (
        <>
          <button
            type="button"
            onClick={() => setShowPrompt(v => !v)}
            aria-expanded={showPrompt}
            className={cn(
              'self-start inline-flex items-center gap-1 px-2 py-[3px] rounded-md',
              'text-[11px] font-medium tracking-wide',
              'border border-fg-6/40 bg-fg-6/[0.06] text-fg-3',
              'hover:bg-fg-6/[0.12] hover:text-fg-2 hover:border-fg-6/60',
              'transition-colors',
            )}
            title={showPrompt ? t('hub.imagePromptHide') : t('hub.imagePromptShow')}
          >
            <span aria-hidden className="text-[9px] leading-none">{showPrompt ? '▾' : '▸'}</span>
            <span>{t('hub.imagePrompt')}</span>
          </button>
          {showPrompt && (
            <div className="w-full max-w-full rounded-md border border-fg-6/30 bg-fg-6/[0.05] px-3 py-2 max-h-[260px] overflow-y-auto">
              <div className="text-[11.5px] leading-[1.65] text-fg-3 whitespace-pre-wrap break-words">
                {caption}
              </div>
            </div>
          )}
        </>
      )}
    </figure>
  );
}

export function ensureRichMessageBlocks(message: RichMessage): RichMessage {
  if (message.blocks?.some(block => block.type !== 'text' || block.content.trim())) return message;
  const text = message.text?.trim();
  if (!text) return message;
  return { ...message, blocks: [{ type: 'text', content: text }] };
}

export function OutputBlock({
  blocks,
  t,
  onOpenFileLink,
  workdir,
  workflowRun,
  workflowAskBusyId,
  onWorkflowAskAnswer,
  scheduleProposalBusyKey,
  onScheduleProposalCreate,
}: {
  blocks: MessageBlock[];
  t: (k: string) => string;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
  workflowRun?: WorkflowRunRecord | null;
  workflowAskBusyId?: string | null;
  onWorkflowAskAnswer?: WorkflowAskAnswerHandler;
  scheduleProposalBusyKey?: string | null;
  onScheduleProposalCreate?: ScheduleProposalActionHandler;
}) {
  const textBlocks = blocks.filter(b => b.type === 'text');
  const imageBlocks = blocks.filter(b => b.type === 'image');
  const text = textBlocks.map(b => b.content).filter(Boolean).join('\n\n');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  if (!text.trim() && imageBlocks.length === 0) return null;
  return (
    <>
      {text.trim() && (
        <GeneratedChatTextOutput
          text={text}
          t={t}
          onOpenFileLink={onOpenFileLink}
          workdir={workdir}
          workflowRun={workflowRun}
          workflowAskBusyId={workflowAskBusyId}
          onWorkflowAskAnswer={onWorkflowAskAnswer}
          scheduleProposalBusyKey={scheduleProposalBusyKey}
          onScheduleProposalCreate={onScheduleProposalCreate}
        />
      )}
      {imageBlocks.length > 0 && (
        <div className="flex min-w-0 max-w-full flex-wrap gap-3 mt-2">
          {imageBlocks.map((img, i) => (
            <ImageFigure key={i} block={img} onLightbox={setLightboxSrc} t={t} />
          ))}
        </div>
      )}
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}

function workflowAskTypeLabel(type: WorkflowAskMarker['type']): string {
  if (type === 'number') return 'Number';
  if (type === 'choice') return 'Choice';
  if (type === 'boolean') return 'Yes / No';
  if (type === 'rating') return 'Rating';
  return 'Text';
}

function findWorkflowAskForMarker(run: WorkflowRunRecord | null | undefined, ask: WorkflowAskMarker): WorkflowRunAsk | null {
  const matches = (run?.asks || []).filter(item => item.question === ask.question && item.type === ask.type);
  if (!matches.length) return null;
  return matches.find(item => item.status === 'pending') || matches[0];
}

function WorkflowAskCue({
  ask,
  resolvedAsk,
  busy,
  onAnswer,
}: {
  ask: WorkflowAskMarker;
  resolvedAsk?: WorkflowRunAsk | null;
  busy?: boolean;
  onAnswer?: WorkflowAskAnswerHandler;
}) {
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState('');
  const [rating, setRating] = useState(0);
  const choices = ask.type === 'choice'
    ? ask.options
    : ask.type === 'boolean'
      ? ['Yes', 'No']
      : ask.type === 'rating'
        ? Array.from({ length: Math.max(1, Math.min(10, ask.max || 5)) }, (_, index) => String(index + 1))
        : [];
  const isClosed = resolvedAsk?.status === 'answered' || resolvedAsk?.status === 'skipped';
  const answerText = resolvedAsk?.answer || (resolvedAsk?.status === 'skipped' ? 'skip' : '');
  const deliveryStatus = resolvedAsk?.deliveryStatus;
  const deliveryFailed = isClosed && deliveryStatus === 'failed';
  const deliverySending = isClosed && deliveryStatus === 'sending';
  const deliveryLabel = resolvedAsk?.status === 'pending'
    ? 'Waiting'
    : deliveryFailed
      ? 'Send failed'
      : deliverySending
        ? 'Sending'
        : deliveryStatus === 'sent'
          ? 'Sent'
          : resolvedAsk?.status === 'skipped'
            ? 'Skipped'
            : resolvedAsk?.status === 'answered'
              ? 'Answered'
              : '';
  const canAnswer = !!onAnswer && !!resolvedAsk && resolvedAsk.status === 'pending' && !busy;
  const canRetryDelivery = !!onAnswer && !!resolvedAsk && deliveryFailed && !!answerText.trim() && !busy;
  const selectedAnswer = ask.type === 'choice'
    ? choice
    : ask.type === 'rating'
      ? rating > 0 ? String(rating) : ''
      : value.trim();
  const canSubmit = ask.type === 'boolean' ? false : canAnswer && !!selectedAnswer.trim();
  const submit = (answer: string, skipped = false) => {
    const trimmed = answer.trim();
    if (!trimmed && !skipped) return;
    void onAnswer?.(ask, trimmed || 'skip', skipped);
  };

  return (
    <div className="rounded-xl border border-primary/24 bg-primary/[0.045] px-3.5 py-3 shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]" data-testid="workflow-ask-cue" data-state={resolvedAsk?.status || 'detected'}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_var(--th-primary)]" />
        <span className="rounded-md border border-primary/35 bg-primary/[0.10] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
          Workflow ask
        </span>
        <span className="rounded-md border border-edge bg-inset px-1.5 py-0.5 text-[10px] text-fg-5">
          {workflowAskTypeLabel(ask.type)}
        </span>
        {resolvedAsk?.status && (
          <span className="rounded-md border border-edge bg-inset px-1.5 py-0.5 text-[10px] text-fg-5">
            {deliveryLabel}
          </span>
        )}
      </div>
      <div className="mt-2 break-words text-[13px] font-semibold leading-snug text-fg">{ask.question}</div>
      {isClosed ? (
        <div
          className={cn(
            'mt-2 rounded-lg border px-2.5 py-2 text-[12px]',
            deliveryFailed
              ? 'border-err/30 bg-err/[0.08] text-err'
              : deliverySending
                ? 'border-primary/25 bg-primary/[0.08] text-primary'
                : 'border-ok/25 bg-ok/[0.08] text-ok',
          )}
        >
          <div className="font-semibold">{answerText || (resolvedAsk?.status === 'skipped' ? 'Skipped' : 'Answered')}</div>
          {deliveryFailed && (
            <div className="mt-1 text-[11px] leading-relaxed text-err/85">
              {resolvedAsk?.deliveryError || 'Agent did not receive this answer.'}
            </div>
          )}
          {deliverySending && (
            <div className="mt-1 text-[11px] leading-relaxed text-primary/85">Sending to agent...</div>
          )}
          {canRetryDelivery && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAnswer?.(ask, answerText, resolvedAsk?.status === 'skipped')}
              className="mt-2 min-h-8 rounded-lg border border-err/35 bg-err/[0.10] px-3 py-1.5 text-[11px] font-semibold text-err transition-[opacity,transform] hover:-translate-y-px hover:bg-err/[0.14] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              {busy ? 'Retrying...' : 'Retry send'}
            </button>
          )}
        </div>
      ) : (
        <>
          {ask.type === 'text' || ask.type === 'number' ? (
            <input
              value={value}
              onChange={event => setValue(event.target.value)}
              type={ask.type === 'number' ? 'number' : 'text'}
              placeholder={ask.placeholder || 'Answer...'}
              disabled={!canAnswer}
              className="mt-2 h-9 w-full rounded-lg border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none transition-[border-color,box-shadow,background] placeholder:text-fg-5 focus:border-primary/50 focus:shadow-[0_0_0_3px_var(--th-glow-a)] disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="workflow-ask-input"
            />
          ) : null}
          {choices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {choices.map(option => {
                const selected = ask.type === 'rating' ? String(rating) === option : choice === option;
                const answerNow = ask.type === 'boolean';
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={!canAnswer}
                    onClick={() => {
                      if (ask.type === 'rating') setRating(Number(option));
                      else if (answerNow) submit(option);
                      else setChoice(option);
                    }}
                    className={cn(
                      'min-h-7 rounded-md border px-2 py-1 text-[11px] font-semibold transition-[border-color,background,color,transform]',
                      selected
                        ? 'border-primary/55 bg-primary/[0.14] text-primary shadow-[0_0_0_1px_var(--th-glow-a)]'
                        : 'border-edge bg-inset text-fg-4 hover:border-primary/35 hover:text-fg',
                      !canAnswer && 'cursor-not-allowed opacity-65',
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
          {onAnswer && !resolvedAsk && (
            <div className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.07] px-2.5 py-2 text-[11px] text-warn">
              Syncing workflow run...
            </div>
          )}
          {onAnswer && resolvedAsk?.status === 'pending' && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              {ask.type !== 'boolean' && (
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => submit(selectedAnswer)}
                  className="min-h-8 rounded-lg border border-primary/35 bg-primary/80 px-3 py-1.5 text-[11px] font-semibold text-black shadow-[0_8px_24px_var(--th-glow-a)] transition-[opacity,transform] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                >
                  {busy ? 'Sending...' : 'Send answer'}
                </button>
              )}
              <button
                type="button"
                disabled={!canAnswer}
                onClick={() => submit('skip', true)}
                className="min-h-8 rounded-lg border border-transparent px-2.5 py-1.5 text-[11px] font-semibold text-fg-5 transition-colors hover:border-edge hover:bg-inset hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
              >
                Skip
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SCHEDULE_PROPOSAL_STORAGE_PREFIX = 'pikiclaw:schedule-proposal:';
const SCHEDULE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ScheduleProposalLocalState = {
  status: 'created' | 'dismissed';
  automationId?: string;
  name?: string;
};

function scheduleProposalStorageKey(signature: string): string {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = ((hash << 5) - hash + signature.charCodeAt(index)) | 0;
  }
  return `${SCHEDULE_PROPOSAL_STORAGE_PREFIX}${Math.abs(hash).toString(36)}:${signature.length}`;
}

function readScheduleProposalState(signature: string): ScheduleProposalLocalState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(scheduleProposalStorageKey(signature));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.status !== 'created' && parsed.status !== 'dismissed') return null;
    return parsed as ScheduleProposalLocalState;
  } catch {
    return null;
  }
}

function writeScheduleProposalState(signature: string, state: ScheduleProposalLocalState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scheduleProposalStorageKey(signature), JSON.stringify(state));
  } catch {
    // Local state is an enhancement; the scheduled task creation itself is already persisted.
  }
}

function scheduleProposalIsValid(value: string): boolean {
  const schedule = value.trim();
  return schedule === 'manual'
    || /^daily@\d{2}:\d{2}$/.test(schedule)
    || /^weekly@[0-6]@\d{2}:\d{2}$/.test(schedule)
    || /^biweekly@[0-6]@\d{2}:\d{2}$/.test(schedule)
    || /^monthly@(?:[1-9]|[12]\d|3[01])@\d{2}:\d{2}$/.test(schedule);
}

function scheduleProposalLabel(value: string): string {
  const schedule = value.trim();
  if (schedule === 'manual') return 'Manual';
  const daily = schedule.match(/^daily@(\d{2}:\d{2})$/);
  if (daily) return `Daily ${daily[1]}`;
  const weekly = schedule.match(/^weekly@([0-6])@(\d{2}:\d{2})$/);
  if (weekly) return `Weekly ${SCHEDULE_WEEKDAYS[Number(weekly[1])] || 'day'} ${weekly[2]}`;
  const biweekly = schedule.match(/^biweekly@([0-6])@(\d{2}:\d{2})$/);
  if (biweekly) return `Biweekly ${SCHEDULE_WEEKDAYS[Number(biweekly[1])] || 'day'} ${biweekly[2]}`;
  const monthly = schedule.match(/^monthly@(\d{1,2})@(\d{2}:\d{2})$/);
  if (monthly) return `Monthly day ${monthly[1]} ${monthly[2]}`;
  return 'Invalid schedule';
}

function ScheduleProposalCue({
  proposal,
  busy,
  onCreate,
}: {
  proposal: ScheduleProposalMarker;
  busy?: boolean;
  onCreate?: ScheduleProposalActionHandler;
}) {
  const signature = useMemo(() => scheduleProposalSignature(proposal), [proposal]);
  const [draft, setDraft] = useState<ScheduleProposalMarker>(proposal);
  const [editing, setEditing] = useState(false);
  const [localState, setLocalState] = useState<ScheduleProposalLocalState | null>(() => readScheduleProposalState(signature));
  const [error, setError] = useState<string | null>(null);
  const scheduleValid = scheduleProposalIsValid(draft.schedule);
  const canCreate = !!onCreate && !!draft.prompt.trim() && scheduleValid && !busy;
  const referenceNamesText = draft.projectReferenceNames.join(', ');

  useEffect(() => {
    setDraft(proposal);
    setLocalState(readScheduleProposalState(signature));
    setError(null);
    setEditing(false);
  }, [proposal, signature]);

  if (localState?.status === 'dismissed') return null;

  const persistState = (next: ScheduleProposalLocalState) => {
    writeScheduleProposalState(signature, next);
    setLocalState(next);
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setError(null);
    try {
      const created = await onCreate(draft);
      if (created) {
        persistState({ status: 'created', automationId: created.id, name: created.name });
        setEditing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || 'Failed to create scheduled task.'));
    }
  };

  return (
    <div
      className="rounded-xl border border-primary/24 bg-primary/[0.045] px-3.5 py-3 shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]"
      data-testid="schedule-proposal-cue"
      data-state={localState?.status || 'pending'}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full shadow-[0_0_14px_var(--th-primary)]', localState?.status === 'created' ? 'bg-ok' : 'bg-primary')} />
        <span className="rounded-md border border-primary/35 bg-primary/[0.10] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
          Schedule proposal
        </span>
        <span className={cn(
          'rounded-md border px-1.5 py-0.5 text-[10px]',
          scheduleValid ? 'border-edge bg-inset text-fg-5' : 'border-warn/35 bg-warn/[0.08] text-warn',
        )}>
          {scheduleProposalLabel(draft.schedule)}
        </span>
        {draft.includeProjectReferences && (
          <span className="rounded-md border border-ok/25 bg-ok/[0.08] px-1.5 py-0.5 text-[10px] text-ok">
            Project refs
          </span>
        )}
        {localState?.status === 'created' && (
          <span className="rounded-md border border-ok/25 bg-ok/[0.08] px-1.5 py-0.5 text-[10px] text-ok">
            Created
          </span>
        )}
      </div>

      {localState?.status === 'created' ? (
        <div className="mt-2 rounded-lg border border-ok/25 bg-ok/[0.08] px-2.5 py-2 text-[12px] text-ok">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{localState.name || draft.name || 'Scheduled task created'}</div>
              {localState.automationId && <div className="mt-1 truncate font-mono text-[10.5px] text-ok/75">{localState.automationId}</div>}
            </div>
            <Link
              to={localState.automationId ? `/scheduled-tasks?automation=${encodeURIComponent(localState.automationId)}` : '/scheduled-tasks'}
              className="inline-flex min-h-7 shrink-0 items-center rounded-md border border-ok/30 bg-ok/[0.10] px-2 text-[11px] font-semibold text-ok transition-colors hover:border-ok/50 hover:bg-ok/[0.14]"
            >
              Open Scheduled Tasks
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 min-w-0">
            <div className="break-words text-[13px] font-semibold leading-snug text-fg">
              {draft.name.trim() || 'Create a scheduled follow-up'}
            </div>
            <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-fg-4">
              {draft.prompt}
            </div>
          </div>

          {editing && (
            <div className="mt-3 grid gap-2 rounded-lg border border-edge/45 bg-inset/55 p-2.5">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Name</span>
                <input
                  value={draft.name}
                  onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))}
                  className="h-8 rounded-lg border border-edge bg-control px-2 text-[12px] text-fg outline-none transition placeholder:text-fg-5 focus:border-primary/50 focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
                  placeholder="Scheduled follow-up"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Schedule</span>
                <input
                  value={draft.schedule}
                  onChange={event => setDraft(prev => ({ ...prev, schedule: event.target.value.trim() }))}
                  className={cn(
                    'h-8 rounded-lg border bg-control px-2 font-mono text-[12px] text-fg outline-none transition placeholder:text-fg-5 focus:shadow-[0_0_0_3px_var(--th-glow-a)]',
                    scheduleValid ? 'border-edge focus:border-primary/50' : 'border-warn/45 focus:border-warn/70',
                  )}
                  placeholder="daily@09:00"
                />
                <span className="text-[10.5px] text-fg-5">manual, daily@09:00, weekly@1@09:00, monthly@1@09:00</span>
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Instruction</span>
                <textarea
                  value={draft.prompt}
                  onChange={event => setDraft(prev => ({ ...prev, prompt: event.target.value }))}
                  rows={3}
                  className="min-h-[78px] resize-y rounded-lg border border-edge bg-control px-2 py-1.5 text-[12px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5 focus:border-primary/50 focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
                  placeholder="What should the agent do on this schedule?"
                />
              </label>
              <label className="flex min-w-0 items-start gap-2 rounded-lg border border-edge/45 bg-panel/50 px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={event => setDraft(prev => ({ ...prev, enabled: event.target.checked }))}
                  className="mt-0.5"
                />
                <span className="min-w-0 text-[11.5px] leading-relaxed text-fg-4">
                  <span className="block font-semibold text-fg-3">Enabled after creation</span>
                  The task can also be paused later from Scheduled Tasks.
                </span>
              </label>
              <label className="flex min-w-0 items-start gap-2 rounded-lg border border-edge/45 bg-panel/50 px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={draft.includeProjectReferences}
                  onChange={event => setDraft(prev => ({ ...prev, includeProjectReferences: event.target.checked }))}
                  className="mt-0.5"
                />
                <span className="min-w-0 text-[11.5px] leading-relaxed text-fg-4">
                  <span className="block font-semibold text-fg-3">Include project references</span>
                  {referenceNamesText || 'Use the project reference picker later for exact files.'}
                </span>
              </label>
              {draft.includeProjectReferences && (
                <label className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Reference names</span>
                  <input
                    value={referenceNamesText}
                    onChange={event => setDraft(prev => ({
                      ...prev,
                      projectReferenceNames: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20),
                    }))}
                    className="h-8 rounded-lg border border-edge bg-control px-2 text-[12px] text-fg outline-none transition placeholder:text-fg-5 focus:border-primary/50 focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
                    placeholder="decision-log.md, context.md"
                  />
                </label>
              )}
            </div>
          )}

          {error && (
            <div className="mt-2 rounded-lg border border-err/30 bg-err/[0.08] px-2.5 py-2 text-[11.5px] leading-relaxed text-err">
              {error}
            </div>
          )}

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => void handleCreate()}
              className="min-h-8 rounded-lg border border-primary/35 bg-primary/80 px-3 py-1.5 text-[11px] font-semibold text-black shadow-[0_8px_24px_var(--th-glow-a)] transition-[opacity,transform] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
              data-testid="schedule-proposal-create"
            >
              {busy ? 'Creating...' : 'Create schedule'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(value => !value)}
              className="min-h-8 rounded-lg border border-edge bg-inset px-2.5 py-1.5 text-[11px] font-semibold text-fg-4 transition-colors hover:border-primary/35 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
            >
              {editing ? 'Done editing' : 'Edit'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => persistState({ status: 'dismissed' })}
              className="min-h-8 rounded-lg border border-transparent px-2.5 py-1.5 text-[11px] font-semibold text-fg-5 transition-colors hover:border-edge hover:bg-inset hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function GeneratedChatTextOutput({
  text,
  t,
  onOpenFileLink,
  workdir,
  cardsClassName,
  markdownClassName = 'session-md text-[13.5px] leading-[1.75] text-fg-2',
  workflowRun,
  workflowAskBusyId,
  onWorkflowAskAnswer,
  scheduleProposalBusyKey,
  onScheduleProposalCreate,
  suppressWorkflowProgressRail = false,
}: {
  text: string;
  t: (k: string) => string;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
  cardsClassName?: string;
  markdownClassName?: string;
  workflowRun?: WorkflowRunRecord | null;
  workflowAskBusyId?: string | null;
  onWorkflowAskAnswer?: WorkflowAskAnswerHandler;
  scheduleProposalBusyKey?: string | null;
  onScheduleProposalCreate?: ScheduleProposalActionHandler;
  suppressWorkflowProgressRail?: boolean;
}) {
  const workflowProgress = useMemo(() => parseWorkflowProgress(text), [text]);
  const workflowAsks = useMemo(() => extractWorkflowAskMarkers(text), [text]);
  const scheduleProposals = useMemo(() => extractScheduleProposalMarkers(text), [text]);
  const displayText = useMemo(
    () => {
      const withoutWorkflow = workflowProgress || workflowAsks.length ? stripWorkflowControlMarkers(text) : text;
      return scheduleProposals.length ? stripScheduleProposalMarkers(withoutWorkflow) : withoutWorkflow;
    },
    [text, workflowAsks.length, workflowProgress, scheduleProposals.length],
  );
  const proposedPlan = splitProposedPlan(displayText);
  const insightText = proposedPlan ? [proposedPlan.before, proposedPlan.after].filter(Boolean).join('\n\n') : displayText;
  const markdownTargets = useMemo(() => collectMarkdownPreviewTargets(displayText), [displayText]);
  const mdComponents = useMemo(() => createMdComponents({ onOpenFileLink, workdir }), [onOpenFileLink, workdir]);
  if (!text.trim()) return null;
  return (
    <>
      {workflowProgress && !suppressWorkflowProgressRail && (
        <WorkflowProgressRail progress={workflowProgress} />
      )}
      {workflowAsks.length > 0 && (
        <div className="mb-3 space-y-2">
          {workflowAsks.map((ask, index) => (
            <WorkflowAskCue
              key={`${ask.type}-${index}-${ask.question}`}
              ask={ask}
              resolvedAsk={findWorkflowAskForMarker(workflowRun, ask)}
              busy={!!workflowAskBusyId && workflowAskBusyId === findWorkflowAskForMarker(workflowRun, ask)?.id}
              onAnswer={onWorkflowAskAnswer}
            />
          ))}
        </div>
      )}
      {scheduleProposals.length > 0 && (
        <div className="mb-3 space-y-2">
          {scheduleProposals.map((proposal, index) => (
            <ScheduleProposalCue
              key={`${scheduleProposalSignature(proposal)}:${index}`}
              proposal={proposal}
              busy={scheduleProposalBusyKey === scheduleProposalSignature(proposal)}
              onCreate={onScheduleProposalCreate}
            />
          ))}
        </div>
      )}
      {insightText.trim() && (
        <GeneratedOutputCards
          text={insightText}
          t={t}
          onOpenFileLink={onOpenFileLink}
          className={cardsClassName || 'mb-3'}
        />
      )}
      {displayText.trim() && !proposedPlan && (
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {displayText}
          </ReactMarkdown>
        </div>
      )}
      {proposedPlan && (
        <div className="space-y-3">
          {proposedPlan.before.trim() && (
            <div className={markdownClassName}>
              <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
                {proposedPlan.before}
              </ReactMarkdown>
            </div>
          )}
          <ProposedPlanCard plan={proposedPlan.plan} mdComponents={mdComponents} />
          {proposedPlan.after.trim() && (
            <div className={markdownClassName}>
              <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
                {proposedPlan.after}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
      {workdir && markdownTargets.length > 0 && (
        <div className="mt-3 space-y-2">
          {markdownTargets.map(target => (
            <MarkdownFilePreviewCard
              key={`${target.path}:${target.line || ''}`}
              target={target}
              workdir={workdir}
              onOpenFileLink={onOpenFileLink}
              t={t}
            />
          ))}
        </div>
      )}
    </>
  );
}

const MARKDOWN_LINK_PREVIEW_LIMIT = 2;
const MARKDOWN_RENDER_MAX_CHARS = 80_000;

function isMarkdownPath(filePath: string): boolean {
  const clean = filePath.split('#')[0].split('?')[0].toLowerCase();
  return clean.endsWith('.md') || clean.endsWith('.markdown');
}

function dedupeMarkdownTargets(targets: FileLinkTarget[]): FileLinkTarget[] {
  const seen = new Set<string>();
  const out: FileLinkTarget[] = [];
  for (const target of targets) {
    if (!isMarkdownPath(target.path)) continue;
    const key = `${target.path}:${target.line || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
    if (out.length >= MARKDOWN_LINK_PREVIEW_LIMIT) break;
  }
  return out;
}

function extractMarkdownFileTargets(text: string): FileLinkTarget[] {
  const candidates: string[] = [];
  const markdownLinkPattern = /\[[^\]]{0,240}\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(text))) {
    const href = match[1].trim().replace(/\s+["'][^"']*["']\s*$/, '');
    if (href) candidates.push(href);
  }

  const autolinkPattern = /<((?:file:\/\/|\/|~\/)[^>\n]+\.m(?:d|arkdown)(?::\d+)?(?:#L?\d+)?)>/gi;
  while ((match = autolinkPattern.exec(text))) {
    if (match[1]) candidates.push(match[1]);
  }

  return dedupeMarkdownTargets(
    candidates
      .map(candidate => parseFileLinkTarget(candidate))
      .filter((target): target is FileLinkTarget => !!target),
  );
}

function collectMarkdownPreviewTargets(text: string): FileLinkTarget[] {
  const out = [...extractMarkdownFileTargets(text)];
  const seen = new Set(out.map(target => `${target.path}:${target.line || ''}`));
  for (const file of buildGeneratedOutputInsights(text).files) {
    if (!isMarkdownPath(file.target.path)) continue;
    const key = `${file.target.path}:${file.target.line || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file.target);
    if (out.length >= MARKDOWN_LINK_PREVIEW_LIMIT) break;
  }
  return out;
}

export function MarkdownFilePreviewCard({
  target,
  workdir,
  onOpenFileLink,
  t,
}: {
  target: FileLinkTarget;
  workdir: string;
  onOpenFileLink?: OpenFileLinkHandler;
  t: (k: string) => string;
}) {
  const [view, setView] = useState<'render' | 'source'>('render');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [relativePath, setRelativePath] = useState('');
  const [absolutePath, setAbsolutePath] = useState(() => absolutePreviewPath(target.path, target.path, workdir));
  const [copiedPath, setCopiedPath] = useState(false);
  const mdComponents = useMemo(() => createMdComponents({ onOpenFileLink, workdir }), [onOpenFileLink, workdir]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent('');
    setRelativePath('');
    setAbsolutePath(absolutePreviewPath(target.path, target.path, workdir));
    setCopiedPath(false);
    void api.fileContent(workdir, target.path)
      .then(result => {
        if (cancelled) return;
        const nextAbsolutePath = absolutePreviewPath(target.path, result.path || target.path, workdir);
        setAbsolutePath(nextAbsolutePath);
        if (!result.ok) {
          setError(result.error || t('hub.previewUnavailable'));
          setRelativePath(result.relativePath || target.path);
          return;
        }
        setContent(result.content || '');
        setRelativePath(result.relativePath || result.path || target.path);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [target.path, t, workdir]);

  const displayContent = content.length > MARKDOWN_RENDER_MAX_CHARS
    ? content.slice(0, MARKDOWN_RENDER_MAX_CHARS)
    : content;
  const truncated = content.length > MARKDOWN_RENDER_MAX_CHARS;
  const displayPath = displayRelativePreviewPath(target.path, relativePath, workdir);
  const handleCopyPath = () => {
    void navigator.clipboard.writeText(absolutePath).then(() => {
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="overflow-hidden rounded-md border border-edge/50 bg-panel/56">
      <div className="flex min-w-0 items-center gap-2 border-b border-edge/45 bg-panel/72 px-3 py-2">
        <span className="shrink-0 rounded border border-primary/25 bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {t('hub.preview')}
        </span>
        <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-4" title={absolutePath}>
          {displayPath}
        </div>
        {truncated && <span className="shrink-0 text-[10px] text-warn">{t('hub.truncated')}</span>}
        <div className="shrink-0 rounded-md border border-edge/45 bg-inset/50 p-0.5">
          {(['render', 'source'] as const).map(nextView => (
            <button
              key={nextView}
              type="button"
              onClick={() => setView(nextView)}
              className={cn(
                'h-6 rounded px-2 text-[10.5px] font-semibold transition-colors',
                view === nextView ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-5 hover:text-fg-3',
              )}
            >
              {nextView === 'render' ? t('hub.render') : t('hub.raw')}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCopyPath}
          className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-5 transition-colors hover:bg-panel-h hover:text-fg-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copiedPath ? t('hub.copied') : t('hub.copy')}
        </button>
        {onOpenFileLink && (
          <button
            type="button"
            onClick={() => onOpenFileLink(target)}
            className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-5 transition-colors hover:bg-panel-h hover:text-fg-2"
          >
            {t('hub.open')}
          </button>
        )}
      </div>
      <div className="max-h-[420px] overflow-auto bg-inset/20 px-3 py-3">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-fg-5">{t('sessions.loading')}</div>
        ) : error ? (
          <div className="text-[12px] text-err">{error}</div>
        ) : view === 'render' ? (
          <div className="session-md text-[13px] leading-[1.72] text-fg-2">
            <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
              {displayContent}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.65] text-fg-3">{displayContent}</pre>
        )}
      </div>
    </div>
  );
}

function splitProposedPlan(text: string): { before: string; plan: string; after: string } | null {
  const match = text.match(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/i);
  if (!match || match.index == null) return null;
  const before = text.slice(0, match.index).trim();
  const plan = match[1].trim();
  const after = text.slice(match.index + match[0].length).trim();
  if (!plan) return null;
  return { before, plan, after };
}

export function textHasProposedPlan(text: string | null | undefined): boolean {
  return !!text && /<proposed_plan>[\s\S]*?<\/proposed_plan>/i.test(text);
}

export function messageHasProposedPlan(message: RichMessage | null | undefined): boolean {
  if (!message) return false;
  if (textHasProposedPlan(message.text)) return true;
  return message.blocks.some(block => block.type === 'text' && textHasProposedPlan(block.content));
}

export function insertComposerCommand(text: string) {
  window.dispatchEvent(new CustomEvent('pikiclaw:composer-insert', { detail: { text } }));
}

function ProposedPlanCard({
  plan,
  mdComponents,
}: {
  plan: string;
  mdComponents: ReturnType<typeof createMdComponents>;
}) {
  return (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/[0.055]">
      <div className="border-b border-sky-500/15 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Proposed plan</div>
          <div className="mt-0.5 text-[11px] text-fg-5">Rendered from agent planning output</div>
        </div>
      </div>
      <div className="session-md px-3 py-3 text-[13px] leading-[1.7] text-fg-2">
        <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
          {plan}
        </ReactMarkdown>
      </div>
    </div>
  );
}
