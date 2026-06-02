import { useEffect, useMemo, useState } from 'react';
import { loadSessionMessages } from '../../session-preload';
import type { ProOutput, SessionInfo } from '../../types';
import { cn } from '../../utils';
import { buildRecallIndex, type RecallIndexItem } from './recall-index';
import { normalizeTurnHistory } from './utils';

const RECALL_TURN_LIMIT = 80;

function RecallIcon({ kind, className }: { kind: RecallIndexItem['kind'] | 'toggle'; className?: string }) {
  if (kind === 'plan') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
        <path d="m3 6 .7.7L5.5 5" /><path d="m3 12 .7.7 1.8-1.9" /><path d="m3 18 .7.7 1.8-1.9" />
      </svg>
    );
  }
  if (kind === 'file' || kind === 'output') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
        <path d="M14 2v5h5" />
      </svg>
    );
  }
  if (kind === 'link') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
      </svg>
    );
  }
  if (kind === 'side-chat') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </svg>
    );
  }
  if (kind === 'assistant') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M9 13h.01" /><path d="M15 13h.01" />
      </svg>
    );
  }
  if (kind === 'toggle') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function itemTone(kind: RecallIndexItem['kind']): string {
  if (kind === 'plan') return 'text-sky-300';
  if (kind === 'file' || kind === 'output') return 'text-emerald-300';
  if (kind === 'link') return 'text-primary';
  if (kind === 'side-chat') return 'text-fg-3';
  if (kind === 'assistant') return 'text-violet-300';
  return 'text-fg-4';
}

function RecallItemButton({
  item,
  onClick,
}: {
  item: RecallIndexItem;
  onClick: (item: RecallIndexItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="group/item flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-[background,color,transform] hover:bg-panel-h/70 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
      title={item.subtitle ? `${item.title}\n${item.subtitle}` : item.title}
    >
      <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-edge/45 bg-inset/60', itemTone(item.kind))}>
        <RecallIcon kind={item.kind} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-semibold leading-4 text-fg-2 group-hover/item:text-fg">{item.title}</span>
        {item.subtitle && <span className="mt-0.5 block truncate text-[10px] leading-3 text-fg-5">{item.subtitle}</span>}
      </span>
    </button>
  );
}

function RecallMarkerButton({
  item,
  onClick,
}: {
  item: RecallIndexItem;
  onClick: (item: RecallIndexItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="group/marker grid h-7 w-7 place-items-center rounded-md text-fg-5 transition-[background,color,transform] hover:-translate-y-px hover:bg-panel-h hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
      title={item.subtitle ? `${item.title}\n${item.subtitle}` : item.title}
      aria-label={item.title}
    >
      <span className={cn('grid h-5 w-5 place-items-center rounded border border-edge/45 bg-inset/75 transition-colors group-hover/marker:border-edge', itemTone(item.kind))}>
        <RecallIcon kind={item.kind} className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function RecallSection({
  title,
  count,
  items,
  empty,
  onItemClick,
}: {
  title: string;
  count: number;
  items: RecallIndexItem[];
  empty: string;
  onItemClick: (item: RecallIndexItem) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{title}</div>
        {count > 0 && <div className="rounded bg-inset px-1.5 py-0.5 font-mono text-[9px] text-fg-5">{count}</div>}
      </div>
      {items.length ? (
        <div className="space-y-0.5">
          {items.map(item => <RecallItemButton key={item.id} item={item} onClick={onItemClick} />)}
        </div>
      ) : (
        <div className="px-2 py-2 text-[11px] leading-relaxed text-fg-5">{empty}</div>
      )}
    </section>
  );
}

export function ChatRecallRail({
  session,
  workdir,
  collapsed,
  onCollapsedChange,
  onSelectTurn,
  onOpenOutput,
  onOpenSideChat,
}: {
  session: SessionInfo;
  workdir: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelectTurn: (turnIndex: number, totalTurns: number) => void;
  onOpenOutput: (output: ProOutput) => void;
  onOpenSideChat: (sideChatKey: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ turns: ReturnType<typeof normalizeTurnHistory>['turns']; startTurn: number; totalTurns: number } | null>(null);
  const outputs = session.outputs || [];
  const sideChats = (session.sideChats || []).filter(ref => !ref.hidden);

  useEffect(() => {
    let cancelled = false;
    const agent = session.agent || '';
    if (!agent || !session.sessionId || !workdir) {
      setHistory(null);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    void loadSessionMessages({
      workdir,
      agent,
      sessionId: session.sessionId,
      rich: false,
      turnOffset: 0,
      turnLimit: RECALL_TURN_LIMIT,
    }).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setHistory(null);
        setError(result.error || 'Unable to load recall index');
        return;
      }
      const normalized = normalizeTurnHistory(result);
      setHistory({
        turns: normalized.turns,
        startTurn: normalized.startTurn,
        totalTurns: normalized.totalTurns,
      });
    }).catch(err => {
      if (!cancelled) {
        setHistory(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [workdir, session.agent, session.sessionId, session.runUpdatedAt, session.numTurns]);

  const recall = useMemo(() => buildRecallIndex({
    turns: history?.turns || [],
    startTurn: history?.startTurn || 0,
    totalTurns: history?.totalTurns || session.numTurns || 0,
    outputs,
    sideChats,
  }), [history?.startTurn, history?.totalTurns, history?.turns, outputs, session.numTurns, sideChats]);

  const outputById = useMemo(() => new Map(outputs.map(output => [output.id, output])), [outputs]);
  const outlineMarkers = recall.outline.slice(0, 10);
  const importantMarkers = recall.important.slice(0, 5);

  const handleItemClick = (item: RecallIndexItem) => {
    if (item.group === 'outline' && typeof item.turnIndex === 'number') {
      onSelectTurn(item.turnIndex, history?.totalTurns || session.numTurns || item.turnIndex + 1);
      return;
    }
    if (item.outputId) {
      const output = outputById.get(item.outputId);
      if (output) onOpenOutput(output);
      return;
    }
    if (item.sideChatKey) onOpenSideChat(item.sideChatKey);
  };

  return (
    <aside
      className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden w-10 md:block"
      data-chat-recall-rail={collapsed ? 'collapsed' : 'open'}
      onMouseDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
    >
      <div className="pointer-events-auto absolute left-1.5 top-2 flex max-h-[calc(100%-1rem)] w-8 flex-col items-center overflow-hidden rounded-lg border border-edge/45 bg-panel/90 py-1.5 shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:bg-panel-h focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]',
            collapsed ? 'text-fg-5 hover:text-fg' : 'bg-[var(--th-selected-bg)] text-fg',
          )}
          title={collapsed ? 'Open recall index' : 'Close recall index'}
          aria-label={collapsed ? 'Open recall index' : 'Close recall index'}
          aria-expanded={!collapsed}
        >
          <RecallIcon kind="toggle" className="h-4 w-4" />
        </button>
        {(importantMarkers.length > 0 || outlineMarkers.length > 0) && <div className="my-1 h-px w-5 shrink-0 bg-edge/65" />}
        {importantMarkers.length > 0 && (
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            {importantMarkers.map(item => <RecallMarkerButton key={`marker-${item.id}`} item={item} onClick={handleItemClick} />)}
          </div>
        )}
        {importantMarkers.length > 0 && outlineMarkers.length > 0 && <div className="my-1 h-px w-5 shrink-0 bg-edge/45" />}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-hidden">
          {outlineMarkers.map(item => <RecallMarkerButton key={`marker-${item.id}`} item={item} onClick={handleItemClick} />)}
        </div>
        {(recall.outline.length > outlineMarkers.length || recall.important.length > importantMarkers.length) && (
          <div className="mt-1 rounded bg-inset px-1.5 py-0.5 font-mono text-[8px] text-fg-5" title="More items in recall index">
            +{(recall.outline.length - outlineMarkers.length) + (recall.important.length - importantMarkers.length)}
          </div>
        )}
      </div>

      {!collapsed && (
        <div
          className="pointer-events-auto absolute left-11 top-2 flex w-[276px] min-h-0 flex-col overflow-hidden rounded-lg border border-edge/70 bg-panel/95 shadow-2xl backdrop-blur-md"
          style={{ maxHeight: 'min(620px, calc(100% - 1rem))' }}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge/55 px-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-edge/45 bg-inset text-fg-4">
              <RecallIcon kind="toggle" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-fg-3">Recall Index</div>
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-5 transition hover:bg-panel-h hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
              title="Close recall index"
              aria-label="Close recall index"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
            {loading && !history ? (
              <div className="px-2 py-2 text-[11px] text-fg-5">Loading...</div>
            ) : error ? (
              <div className="px-2 py-2 text-[11px] leading-relaxed text-err">{error}</div>
            ) : (
              <div className="space-y-4">
                <RecallSection
                  title="Chat Outline"
                  count={recall.outline.length}
                  items={recall.outline}
                  empty="No turns yet."
                  onItemClick={handleItemClick}
                />
                <RecallSection
                  title="Important Items"
                  count={recall.important.length}
                  items={recall.important}
                  empty="No outputs yet."
                  onItemClick={handleItemClick}
                />
                {recall.olderTurnsNotIndexed && (
                  <div className="mx-2 rounded-md border border-edge/45 bg-inset/55 px-2 py-1.5 text-[10.5px] leading-relaxed text-fg-5">
                    Older turns are outside this index.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
