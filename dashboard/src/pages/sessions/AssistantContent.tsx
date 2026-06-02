import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react';
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
import type { RichMessage, MessageBlock } from '../../types';

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
}: {
  message: RichMessage;
  t: (k: string) => string;
  startedAt?: string | null;
  completedAt?: string | null;
  runError?: string | null;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
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
      {renderedOutputBlocks.length > 0 && <OutputBlock blocks={renderedOutputBlocks} t={t} onOpenFileLink={onOpenFileLink} workdir={workdir} />}
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

export function OutputBlock({ blocks, t, onOpenFileLink, workdir }: { blocks: MessageBlock[]; t: (k: string) => string; onOpenFileLink?: OpenFileLinkHandler; workdir?: string }) {
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

export function GeneratedChatTextOutput({
  text,
  t,
  onOpenFileLink,
  workdir,
  cardsClassName,
  markdownClassName = 'session-md text-[13.5px] leading-[1.75] text-fg-2',
}: {
  text: string;
  t: (k: string) => string;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
  cardsClassName?: string;
  markdownClassName?: string;
}) {
  const proposedPlan = splitProposedPlan(text);
  const insightText = proposedPlan ? [proposedPlan.before, proposedPlan.after].filter(Boolean).join('\n\n') : text;
  const markdownTargets = useMemo(() => collectMarkdownPreviewTargets(text), [text]);
  const mdComponents = useMemo(() => createMdComponents({ onOpenFileLink, workdir }), [onOpenFileLink, workdir]);
  if (!text.trim()) return null;
  return (
    <>
      {insightText.trim() && (
        <GeneratedOutputCards
          text={insightText}
          t={t}
          onOpenFileLink={onOpenFileLink}
          className={cardsClassName || 'mb-3'}
        />
      )}
      {text.trim() && !proposedPlan && (
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {text}
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
