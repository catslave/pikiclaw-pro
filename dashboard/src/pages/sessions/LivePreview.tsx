import { useState, useMemo } from 'react';
import { CollapsibleCard, CountBadge } from '../../components/ui';
import { hasPlan } from '../../components/PlanProgressCard';
import { type OpenFileLinkHandler } from './markdown';
import { stripOaiMemoryCitations } from './messageSanitizers';
import { lastNLines } from './utils';
import { shortenModel } from '../../utils';
import { GeneratedChatTextOutput } from './AssistantContent';
import { CompletedWorkDisclosure, WorkingActivityDetails, WorkingActivitySummary, WorkingCard, WorkingDiagnostics, WorkingPlanList, WorkingSubAgentList, WorkingThinkingBlock, formatActivityForDisplay, summarizeWorkingActivity } from './WorkingCard';
import type { StreamActivityEvents, StreamActivitySummary, StreamPlan, StreamPreviewMeta, StreamSubAgent } from '../../types';

export interface LiveStreamView {
  taskId?: string | null;
  prompt?: string | null;
  phase: 'streaming' | 'done';
  text: string;
  thinking: string;
  activity?: string;
  activitySummary?: StreamActivitySummary | null;
  activityEvents?: StreamActivityEvents | null;
  plan?: StreamPlan | null;
  subAgents?: StreamSubAgent[] | null;
  previewMeta?: StreamPreviewMeta | null;
  startedAt?: number | null;
  completedAt?: number | null;
  updatedAt?: number | null;
  error?: string | null;
  /** Number of image-generation calls in flight — drives the
   *  "Generating image…" chip while bytes have yet to land. */
  generatingImages?: number;
}

export function liveStreamHasBody(stream: LiveStreamView): boolean {
  return !!stream.text
    || !!stream.thinking
    || hasPlan(stream.plan)
    || !!(stream.subAgents && stream.subAgents.length);
}

/** True when the live preview will render any visible element (body or error tile). */
export function liveStreamShouldRender(stream: LiveStreamView): boolean {
  if (liveStreamHasBody(stream)) return true;
  // Streaming with no body yet — still render so the TurnDivider header and the
  // internal ThinkingDots fill the "waiting for the first token" window. Without
  // this branch, IM-initiated turns (no pendingPrompt to bridge) show nothing
  // between session-start and the first text chunk.
  if (stream.phase === 'streaming') return true;
  return stream.phase === 'done' && !!stream.error;
}

function cleanWorkingPreview(line: string): string {
  return formatActivityForDisplay(line)
    .replace(/^Codex connection:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+done$/i, '')
    .trim();
}

/* ── Live streaming preview ── */
export function LivePreview({
  stream,
  streamActive = false,
  t,
  onOpenFileLink,
  workdir,
  onStopAll,
}: {
  stream: LiveStreamView;
  /** True while the session still owns an in-flight task. Keeps the live card on
   *  "Working" during the done→history handoff instead of flickering to
   *  "Worked for" when the backend briefly replays terminal snapshots. */
  streamActive?: boolean;
  t: (k: string) => string;
  onOpenFileLink?: OpenFileLinkHandler;
  workdir?: string;
  onStopAll?: () => void | Promise<void>;
}) {
  const [stoppingAll, setStoppingAll] = useState(false);
  const handleStop = async () => {
    if (stoppingAll || !onStopAll) return;
    setStoppingAll(true);
    try { await onStopAll(); }
    finally { setStoppingAll(false); }
  };
  const showPlan = hasPlan(stream.plan);
  const visibleText = stripOaiMemoryCitations(stream.text || '');
  const sanitizedStream = visibleText === stream.text ? stream : { ...stream, text: visibleText };
  const hasAnyBody = liveStreamHasBody(sanitizedStream);
  // Stream finished with no body — surface the error inline so the user sees
  // *why* the assistant turn is empty instead of a silent phantom.
  const renderEmptyFailure = stream.phase === 'done' && !hasAnyBody;

  const activityLines = useMemo(() =>
    (stream.activity || '').split('\n').filter(Boolean),
    [stream.activity],
  );
  const lastActivity = activityLines[activityLines.length - 1] || '';
  const subAgents = stream.subAgents ?? null;
  const currentPlanStep = showPlan
    ? (stream.plan.steps.find(step => step.status === 'inProgress') || [...stream.plan.steps].reverse().find(step => step.status === 'completed') || stream.plan.steps[0])?.step
    : '';
  const thinkingPreview = stream.thinking ? lastNLines(stream.thinking, 1) : '';
  const diagnosticLines = stream.previewMeta?.diagnostics?.map(line => cleanWorkingPreview(String(line || ''))).filter(Boolean) || [];
  const diagnosticPreview = diagnosticLines[diagnosticLines.length - 1] || cleanWorkingPreview(stream.previewMeta?.lastEvent || '');
  const activitySummary = summarizeWorkingActivity(activityLines, t, stream.activitySummary ?? null);
  const structuredCurrentLabel = stream.activitySummary?.current?.label?.trim() || '';
  const workingPreview = structuredCurrentLabel
    || activitySummary[0]
    || currentPlanStep
    || thinkingPreview
    || cleanWorkingPreview(lastActivity)
    || diagnosticPreview
    || '';
  const structuredStepCount = stream.activitySummary
    ? stream.activitySummary.files + stream.activitySummary.searches + stream.activitySummary.commands + stream.activitySummary.tools
    : 0;
  const workingStepCount = structuredStepCount
    || activityLines.length
    || (showPlan ? stream.plan.steps.length : 0)
    || (subAgents?.length ?? 0)
    || (stream.thinking ? 1 : 0);
  const terminalError = !!String(stream.error || '').trim();
  const hasDiagnostics = !!stream.previewMeta?.diagnostics?.some(line => String(line || '').trim());
  const showLiveWorking = streamActive || stream.phase === 'streaming';
  const showWorking = showLiveWorking
    || !!stream.thinking
    || showPlan
    || !!(subAgents && subAgents.length)
    || !!stream.previewMeta?.diagnostics?.length
    || activityLines.length > 0
    || structuredStepCount > 0;

  return (
    <div data-assistant-selectable className="space-y-3">
      {showWorking && (
        showLiveWorking && !terminalError ? (
          <WorkingCard
            phase="streaming"
            t={t}
            resetKey={stream.taskId || null}
            defaultOpen
            startedAt={stream.startedAt ?? null}
            completedAt={stream.completedAt ?? null}
            updatedAt={stream.updatedAt ?? null}
            previewMeta={stream.previewMeta ?? null}
            previewText={workingPreview}
            stepCount={workingStepCount}
            error={stream.error ?? null}
            actions={onStopAll ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stoppingAll}
                title={t('hub.stopHint')}
                aria-label={t('hub.stop')}
                className="inline-flex h-[26px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-err/35 bg-err/[0.08] px-2 text-[10.5px] font-semibold leading-none text-err/90 shadow-sm transition-colors hover:border-err/55 hover:bg-err/[0.14] hover:text-err disabled:pointer-events-none disabled:opacity-45"
              >
                {stoppingAll
                  ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-err/30 border-t-err" />
                  : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>}
                <span>{t('hub.stop')}</span>
              </button>
            ) : null}
          >
            <div className="space-y-3 px-3.5 py-3">
              <WorkingPlanList plan={stream.plan} t={t} />
              <WorkingSubAgentList subAgents={subAgents} t={t} />
              <WorkingThinkingBlock text={stream.thinking || ''} t={t} />
              <WorkingActivitySummary lines={activityLines} activitySummary={stream.activitySummary ?? null} activityEvents={stream.activityEvents ?? null} t={t} />
              <WorkingActivityDetails lines={activityLines} activityEvents={stream.activityEvents ?? null} t={t} />
              <WorkingDiagnostics diagnostics={stream.previewMeta?.diagnostics} t={t} />
              {!showPlan && !subAgents?.length && activityLines.length === 0 && !stream.thinking && !visibleText && !hasDiagnostics && (
                <div className="text-[12px] text-fg-5">{t('hub.workingIdle')}</div>
              )}
            </div>
          </WorkingCard>
        ) : (
          <CompletedWorkDisclosure
            t={t}
            startedAt={stream.startedAt ?? null}
            completedAt={stream.completedAt ?? null}
            updatedAt={stream.updatedAt ?? null}
            error={stream.error ?? null}
          >
            <div className="space-y-3 px-3.5 py-3">
              <WorkingPlanList plan={stream.plan} t={t} />
              <WorkingSubAgentList subAgents={subAgents} t={t} />
              <WorkingThinkingBlock text={stream.thinking || ''} t={t} />
              <WorkingActivitySummary lines={activityLines} activitySummary={stream.activitySummary ?? null} activityEvents={stream.activityEvents ?? null} t={t} />
              <WorkingActivityDetails lines={activityLines} activityEvents={stream.activityEvents ?? null} t={t} />
              <WorkingDiagnostics diagnostics={stream.previewMeta?.diagnostics} t={t} />
            </div>
          </CompletedWorkDisclosure>
        )
      )}

      {/* Response text with thinking dots */}
      {visibleText && (
        stream.phase === 'streaming' ? (
          <div className="session-md text-[13.5px] leading-[1.75] text-fg-2">
            <div className="whitespace-pre-wrap break-words">{visibleText}</div>
            <ThinkingDots className="ml-1 inline-flex align-text-bottom text-fg-4" />
          </div>
        ) : (
          <GeneratedChatTextOutput
            text={visibleText}
            t={t}
            onOpenFileLink={onOpenFileLink}
            workdir={workdir}
          />
        )
      )}

      {/* Loading dots — shown whenever the stream is live but no text body is
          rendered yet. Inline dots (above) only appear once stream.text exists,
          so this fills the gap when activity / thinking / plan are shown alone
          or when no content has arrived at all. */}
      {!visibleText && stream.phase === 'streaming' && !showWorking && (
        <div className="py-1">
          <ThinkingDots className="text-fg-5" />
        </div>
      )}

      {/* Image generation in flight — surfaced as a distinct chip so the user
          knows why the turn is taking longer than a typical text reply
          (image_gen wall time is 60-90s). Disappears when the assistant block
          arrives with the actual image. */}
      {stream.phase === 'streaming' && (stream.generatingImages ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-[12px] text-fg-4">
          <span className="relative inline-flex items-center justify-center w-3 h-3">
            <span className="absolute inline-flex w-3 h-3 rounded-full bg-cyan-400/40 animate-ping" />
            <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
          </span>
          <span>
            {stream.generatingImages === 1
              ? 'Generating image…'
              : `Generating ${stream.generatingImages} images…`}
          </span>
        </div>
      )}

      {/* Stream finished with no body — surface the error inline so the user
          sees *why* the assistant turn is empty instead of a silent phantom. */}
      {renderEmptyFailure && stream.error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12.5px] leading-[1.7] text-fg-3">
          <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-rose-400/70 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wide text-rose-300/80">{t('hub.streamFailed') || 'Stream ended without a reply'}</div>
            <div className="mt-0.5 break-words">{stream.error}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Animated ··· indicator for streaming / thinking states */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={`thinking-dots inline-flex items-center gap-[3px] ${className || ''}`}>
      <span /><span /><span />
    </span>
  );
}

/**
 * Discrete card for a sub-agent (Claude Task tool). Shows its own model, kind
 * (e.g. "Explore"), description, and tool stream — visually separated from the
 * parent agent's activity so the two contexts don't blur into one.
 */
export function SubAgentCard({ sub, t }: { sub: StreamSubAgent; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const status = sub.status;
  const dotColor = status === 'failed' ? 'bg-rose-400/60'
    : status === 'done' ? 'bg-emerald-400/55'
      : 'bg-amber-400/60';
  const pulse = status === 'running';
  const tools = sub.tools;
  const uniqueToolNames = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const tool of tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      list.push(tool.name);
    }
    return list;
  }, [tools]);
  const headerLabel = sub.kind ? `${t('hub.subAgent') || 'Sub-agent'} · ${sub.kind}` : (t('hub.subAgent') || 'Sub-agent');
  const modelLabel = sub.model ? shortenModel(sub.model) : null;
  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: dotColor, pulse }}
      label={headerLabel}
      preview={
        <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-fg-4">
          {sub.description && <span className="truncate">{sub.description}</span>}
          {modelLabel && <span className="text-[10px] font-mono text-fg-5/55 shrink-0">{modelLabel}</span>}
          {!sub.description && uniqueToolNames.length > 0 && (
            <span className="font-mono text-fg-5/60 truncate">{uniqueToolNames.join(' · ')}</span>
          )}
        </span>
      }
      badge={tools.length > 0 ? <CountBadge>{tools.length}</CountBadge> : undefined}
    >
      <div className="px-3.5 py-2.5 space-y-1 max-h-[260px] overflow-y-auto">
        {sub.description && (
          <div className="mb-1.5 text-[12px] text-fg-3 leading-[1.55]">{sub.description}</div>
        )}
        {tools.length === 0 ? (
          <div className="text-[11px] font-mono text-fg-5/50">— {t('hub.subAgentWaiting') || 'waiting for first tool…'}</div>
        ) : (
          tools.map(tool => (
            <div key={tool.id} className="flex items-center gap-1.5 py-[2px]">
              <span className="w-1 h-1 rounded-full shrink-0 bg-fg-5/30" />
              <span className="text-[11px] font-mono text-fg-5/65 truncate">{tool.summary}</span>
            </div>
          ))
        )}
      </div>
    </CollapsibleCard>
  );
}
