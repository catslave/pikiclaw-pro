import { useMemo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { api } from '../../api';
import { Badge, Button, Input } from '../../components/ui';
import type { BrowserPanelSnapshot, ProOutput, ProTaskWorkbench } from '../../types';
import { cn, fmtRelative } from '../../utils';
import { GeneratedOutputCards } from './GeneratedOutputCards';

export type ContextShelfTab = 'outputs' | 'side-chats' | 'files' | 'browser' | 'status' | 'ticket';

type ContextShelfFile = ProTaskWorkbench['files'][number];

const TAB_LABEL: Record<ContextShelfTab, string> = {
  outputs: 'Output',
  'side-chats': 'Side Cards',
  files: 'File',
  browser: 'Browser',
  status: 'Overview',
  ticket: 'Ticket',
};

const OUTPUT_KIND_LABEL: Record<ProOutput['kind'], string> = {
  background: 'Background',
  final: 'Final',
  document: 'Doc',
  image: 'Image',
  file: 'File',
  diff: 'Diff',
  estimate: 'Estimate',
  'stage-summary': 'Stage',
  link: 'Link',
};

async function copyText(value: string) {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {}
}

function shortPath(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `.../${parts.slice(-3).join('/')}`;
}

function EmptyShelfState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-[260px]">
        <div className="text-[13px] font-semibold text-fg-2">{title}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{hint}</div>
      </div>
    </div>
  );
}

function OutputPreview({
  outputs,
  onOpenPath,
  onCreateSessionFromOutput,
}: {
  outputs: ProOutput[];
  onOpenPath?: (path: string, workdir?: string) => void;
  onCreateSessionFromOutput?: (output: ProOutput) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (!outputs.length) return null;
    return outputs.find(output => output.id === selectedId) || outputs[0];
  }, [outputs, selectedId]);
  if (!outputs.length) {
    return <EmptyShelfState title="No outputs yet" hint="Task results, documents, diffs, links, and review-ready deliverables will appear here." />;
  }
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-y-auto px-3 py-3">
        <div className="mb-3 rounded-lg border border-edge/45 bg-panel/45 px-3 py-2">
          <div className="text-[12px] font-semibold text-fg-2">Task result center</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">Review generated documents, diffs, links, and final answers here.</div>
        </div>
        <div className="space-y-2">
          {outputs.map(output => {
            const active = selected?.id === output.id;
            const updatedAt = output.createdAt ? fmtRelative(output.createdAt) : '';
            return (
              <button
                key={output.id}
                type="button"
                onClick={() => setSelectedId(output.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-[border-color,background,transform] duration-150 active:translate-y-px',
                  active ? 'border-primary/32 bg-primary/[0.075]' : 'border-edge/55 bg-panel/45 hover:border-edge-h hover:bg-panel-h/55',
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={output.kind === 'diff' ? 'warn' : output.kind === 'estimate' ? 'accent' : 'muted'}>
                    {OUTPUT_KIND_LABEL[output.kind]}
                  </Badge>
                  {updatedAt && <span className="shrink-0 text-[10px] font-medium text-fg-5">{updatedAt}</span>}
                </div>
                <div className="mt-1 truncate text-[12px] font-semibold text-fg" title={output.title}>
                  {output.title}
                </div>
                {output.summary && (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-4">
                    {output.summary}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {selected && (
        <div className="min-h-[190px] border-t border-edge/55 bg-inset/20 px-3 py-3">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg">{selected.title}</div>
            {onCreateSessionFromOutput && (
              <Button size="sm" variant="outline" onClick={() => onCreateSessionFromOutput(selected)}>
                Open in chat
              </Button>
            )}
            {selected.path && onOpenPath && (
              <Button size="sm" variant="outline" onClick={() => onOpenPath(selected.path!, selected.session?.workdir)}>
                Open
              </Button>
            )}
            {(selected.path || selected.url) && (
              <Button size="sm" variant="ghost" onClick={() => void copyText(selected.path || selected.url || '')}>
                Copy
              </Button>
            )}
          </div>
          {(selected.path || selected.url) && (
            <div className="mb-2 rounded-md border border-edge/45 bg-panel/65 px-2 py-1.5 font-mono text-[10px] text-fg-5">
              {selected.path || selected.url}
            </div>
          )}
          {selected.summary && (
            <GeneratedOutputCards
              text={selected.summary}
              compact
              onOpenFileLink={onOpenPath ? target => onOpenPath(target.path, selected.session?.workdir) : undefined}
              className="mb-2"
            />
          )}
          <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge/40 bg-panel/50 px-3 py-2 text-[11.5px] leading-relaxed text-fg-3">
            {selected.summary || 'No preview text.'}
          </pre>
        </div>
      )}
    </div>
  );
}

function FilesTab({
  files,
  onOpenPath,
}: {
  files: ContextShelfFile[];
  onOpenPath?: (path: string, workdir?: string) => void;
}) {
  if (!files.length) {
    return <EmptyShelfState title="No files yet" hint="Workspace paths, referenced files, and task context will appear here." />;
  }
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mb-3 rounded-lg border border-edge/45 bg-panel/45 px-3 py-2">
        <div className="text-[12px] font-semibold text-fg-2">Task context center</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">Browse workspace files, referenced paths, and source context for this task.</div>
      </div>
      <div className="space-y-2">
        {files.map((file, index) => (
          <div key={`${file.workdir || ''}:${file.path}:${index}`} className="rounded-lg border border-edge/55 bg-panel/50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] text-fg-3" title={file.path}>{shortPath(file.path)}</div>
                {file.label && <div className="mt-0.5 truncate text-[10px] text-fg-5">{file.label}</div>}
              </div>
              {onOpenPath && (
                <Button size="sm" variant="outline" onClick={() => onOpenPath(file.path, file.workdir)}>
                  Open
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void copyText(file.path)}>
                Copy
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketTab({ ticket }: { ticket?: ProTaskWorkbench['ticketSnapshot'] | null }) {
  if (!ticket) {
    return <EmptyShelfState title="No ticket context" hint="Task focus adds the original Jira or manual task snapshot here." />;
  }
  const meta = [
    ['Jira', ticket.jiraKey],
    ['Type', ticket.issueType],
    ['Status', ticket.status],
    ['Priority', ticket.priority],
    ['Assignee', ticket.assignee],
    ['Reporter', ticket.reporter],
    ['Sprint', ticket.sprint],
    ['Updated', ticket.updatedAt ? fmtRelative(ticket.updatedAt) : undefined],
  ].filter(([, value]) => value);
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="rounded-lg border border-edge/55 bg-panel/55 px-3 py-3">
        <div className="text-[13px] font-semibold leading-snug text-fg">{ticket.title}</div>
        {ticket.jiraUrl && (
          <a className="mt-2 inline-flex text-[11px] font-semibold text-primary hover:underline" href={ticket.jiraUrl} target="_blank" rel="noreferrer">
            Open Jira
          </a>
        )}
        <dl className="mt-3 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
          {meta.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-5">{label}</dt>
              <dd className="min-w-0 truncate text-fg-3">{value}</dd>
            </div>
          ))}
        </dl>
        {!!ticket.labels?.length && (
          <div className="mt-3 flex flex-wrap gap-1">
            {ticket.labels.map(label => <Badge key={label} variant="muted">{label}</Badge>)}
          </div>
        )}
      </div>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-edge/55 bg-inset/20 px-3 py-3 text-[11.5px] leading-relaxed text-fg-3">
        {ticket.description || 'No ticket description.'}
      </pre>
    </div>
  );
}

function BrowserTab() {
  const [snapshot, setSnapshot] = useState<BrowserPanelSnapshot | null>(null);
  const [urlDraft, setUrlDraft] = useState('https://');
  const [typeDraft, setTypeDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<BrowserPanelSnapshot | null | undefined>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ensureUrl = () => {
    const raw = urlDraft.trim();
    if (!raw || raw === 'https://') return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  };

  const openOrNavigate = () => run(async () => {
    const url = ensureUrl();
    if (!url) return null;
    if (!snapshot?.id) {
      const res = await api.openBrowserPanelSession(url);
      if (!res.ok || !res.snapshot) throw new Error(res.error || 'Failed to open browser');
      return res.snapshot;
    }
    const res = await api.browserPanelAction(snapshot.id, { action: 'navigate', url });
    if (!res.ok || !res.snapshot) throw new Error(res.error || 'Failed to navigate');
    return res.snapshot;
  });

  const reload = () => run(async () => {
    if (!snapshot?.id) return null;
    const res = await api.browserPanelAction(snapshot.id, { action: 'reload' });
    if (!res.ok || !res.snapshot) throw new Error(res.error || 'Failed to refresh');
    return res.snapshot;
  });

  const typeIntoFocusedField = () => run(async () => {
    if (!snapshot?.id || !typeDraft) return null;
    const res = await api.browserPanelAction(snapshot.id, { action: 'type', text: typeDraft });
    if (!res.ok || !res.snapshot) throw new Error(res.error || 'Failed to type');
    setTypeDraft('');
    return res.snapshot;
  });

  const clickImage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!snapshot?.id || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    void run(async () => {
      const res = await api.browserPanelAction(snapshot.id, { action: 'click', xRatio, yRatio });
      if (!res.ok || !res.snapshot) throw new Error(res.error || 'Failed to click');
      return res.snapshot;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
      <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input
          value={urlDraft}
          onChange={event => setUrlDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void openOrNavigate();
            }
          }}
          placeholder="https://..."
        />
        <Button variant="secondary" disabled={busy || !ensureUrl()} onClick={openOrNavigate}>Open</Button>
        <Button variant="ghost" disabled={busy || !snapshot?.id} onClick={reload}>Refresh</Button>
      </div>
      <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={typeDraft}
          onChange={event => setTypeDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void typeIntoFocusedField();
            }
          }}
          placeholder="Type into focused field"
        />
        <Button variant="secondary" disabled={busy || !snapshot?.id || !typeDraft} onClick={typeIntoFocusedField}>Type</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge/55 bg-inset/20">
        {snapshot ? (
          <button type="button" disabled={busy} onClick={clickImage} className="block h-full w-full overflow-auto text-left disabled:cursor-wait">
            <img src={snapshot.image} alt={snapshot.title || snapshot.url} className="block w-full select-none" draggable={false} />
          </button>
        ) : (
          <EmptyShelfState title="No browser session" hint="Open a URL to use the managed browser beside this chat." />
        )}
      </div>
      <div className="shrink-0 truncate text-[10px] text-fg-5">
        {error ? <span className="text-err">{error}</span> : snapshot ? `${busy ? 'Working' : 'Ready'} · ${snapshot.title || snapshot.url}` : 'Managed browser'}
      </div>
    </div>
  );
}

export function ContextShelf({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  onResizeStart,
  onToggleMaxWidth,
  isMaxWidth = false,
  sideChatContent,
  sideCardContent,
  filesContent,
  outputs,
  files,
  ticket,
  statusContent,
  onOpenPath,
  onCreateSessionFromOutput,
  width,
  surface = 'inline',
  cardTitle,
  cardPlacement,
  cardDragging = false,
  onCardDragStart,
  onCardDock,
  onCardFloat,
  tabLabels,
  hiddenTabs,
  afterTabButtons,
  minimalHeader = false,
  onCreateSideCard,
  createSideCardLabel = 'New side card',
}: {
  tabs: ContextShelfTab[];
  activeTab: ContextShelfTab;
  onTabChange: (tab: ContextShelfTab) => void;
  onClose: () => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleMaxWidth?: () => void;
  isMaxWidth?: boolean;
  sideChatContent: ReactNode;
  sideCardContent?: ReactNode;
  filesContent?: ReactNode;
  outputs: ProOutput[];
  files: ContextShelfFile[];
  ticket?: ProTaskWorkbench['ticketSnapshot'] | null;
  statusContent?: ReactNode;
  onOpenPath?: (path: string, workdir?: string) => void;
  onCreateSessionFromOutput?: (output: ProOutput) => void;
  width?: number;
  surface?: 'inline' | 'card';
  cardTitle?: string;
  cardPlacement?: {
    mode: 'floating' | 'docked';
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cardDragging?: boolean;
  onCardDragStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCardDock?: () => void;
  onCardFloat?: () => void;
  tabLabels?: Partial<Record<ContextShelfTab, string>>;
  hiddenTabs?: Partial<Record<ContextShelfTab, boolean>>;
  afterTabButtons?: ReactNode;
  minimalHeader?: boolean;
  onCreateSideCard?: () => void;
  createSideCardLabel?: string;
}) {
  const visibleTab = tabs.includes(activeTab) ? activeTab : tabs[0];
  const getTabLabel = (tab: ContextShelfTab) => tabLabels?.[tab] || TAB_LABEL[tab];
  const activeTitle = getTabLabel(visibleTab);
  const cardSurface = surface === 'card';
  const sideCardSurface = cardSurface && visibleTab === 'side-chats';
  const docked = cardSurface && cardPlacement?.mode === 'docked';
  const [resizeActive, setResizeActive] = useState(false);
  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setResizeActive(true);
    const cleanup = () => {
      setResizeActive(false);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
    onResizeStart?.(event);
  };
  const cardStyle = cardSurface
    ? docked
      ? {
        top: 54,
        right: 12,
        bottom: 12,
        width: `min(${cardPlacement?.width || 420}px, calc(100vw - 74px))`,
      }
      : {
        left: 0,
        top: 0,
        width: cardPlacement?.width || 420,
        height: cardPlacement?.height || 620,
        transform: `translate3d(${cardPlacement?.x || 0}px, ${cardPlacement?.y || 64}px, 0)`,
      }
    : undefined;
  return (
    <div
      data-side-chat-panel
      data-context-card={cardSurface ? 'true' : undefined}
      className={cn(
        'min-h-0 flex flex-col bg-panel/96 backdrop-blur-md',
        cardSurface
          ? cn(
            'fixed z-[86] overflow-hidden border border-edge/70 text-fg shadow-[0_24px_72px_rgba(2,6,23,0.22)]',
            docked ? 'rounded-xl' : 'rounded-[16px]',
            cardDragging && 'shadow-[0_28px_86px_rgba(2,6,23,0.30)] ring-1 ring-primary/25',
          )
          : 'relative shrink-0 border-l border-edge/80 shadow-[-10px_0_32px_rgba(2,6,23,0.18)] max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:top-16 max-md:z-[80] max-md:w-auto max-md:rounded-xl max-md:border',
      )}
      style={cardSurface ? cardStyle : {
        width,
        minWidth: 420,
        maxWidth: 'min(760px, 46vw)',
      }}
      onClick={event => event.stopPropagation()}
    >
      {!cardSurface && onResizeStart && (
        <div
          data-focus-ignore
          role="separator"
          aria-orientation="vertical"
          title="Resize shelf"
          aria-label="Resize shelf"
          onPointerDown={handleResizePointerDown}
          className={cn(
            'group absolute left-0 top-0 z-20 h-full w-5 -translate-x-1/2 cursor-col-resize touch-none max-md:hidden',
            resizeActive && 'cursor-col-resize',
          )}
        >
          <div className={cn(
            'absolute inset-y-2 left-0 w-1/2 rounded-l-md bg-primary/[0.10] opacity-0 transition-opacity duration-150',
            'group-hover:opacity-100',
            resizeActive && 'opacity-100',
          )} />
          <div className={cn(
            'absolute inset-y-2 right-0 w-1/2 rounded-r-md bg-panel-h/90 opacity-0 transition-opacity duration-150',
            'group-hover:opacity-100',
            resizeActive && 'opacity-100',
          )} />
          <div className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge-h/70 transition-[background,width,box-shadow] duration-150',
            'group-hover:w-[2px] group-hover:bg-primary/75 group-hover:shadow-[0_0_0_3px_rgba(59,130,246,0.10)]',
            resizeActive && 'w-[2px] bg-primary shadow-[0_0_0_4px_rgba(59,130,246,0.14)]',
          )} />
          <div className={cn(
            'absolute left-1/2 top-1/2 h-9 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-edge/60 bg-panel opacity-0 shadow-sm transition-opacity duration-150',
            'group-hover:opacity-100',
            resizeActive && 'opacity-100',
          )}>
            <div className="mx-auto mt-2 h-5 w-px bg-fg-5/70" />
          </div>
        </div>
      )}
      {cardSurface && (
        <div
          data-focus-ignore
          onPointerDown={onCardDragStart}
          className={cn(
            'flex h-10 shrink-0 touch-none select-none items-center gap-2 border-b border-edge/60 bg-panel/90 px-3 shadow-[0_1px_0_var(--th-inset-hl)]',
            cardDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          title="Drag context card"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-edge/55 bg-inset text-primary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </span>
          <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{cardTitle || activeTitle}</div>
          <button
            data-focus-ignore
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              docked ? onCardFloat?.() : onCardDock?.();
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg"
            title={docked ? 'Float card' : sideCardSurface ? 'Dock to Side Chats' : 'Dock right'}
            aria-label={docked ? 'Float card' : sideCardSurface ? 'Dock to Side Chats' : 'Dock right'}
          >
            {docked ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2.2" />
                <path d="M9 9h6v6" />
                <path d="M15 9 8 16" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2.2" />
                <path d="M14 4v16" />
              </svg>
            )}
          </button>
          <button
            data-focus-ignore
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onClose();
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg"
            title="Close"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {!sideCardSurface && <div className="shrink-0 border-b border-edge/60 bg-panel/88 px-2 pt-2">
        {!cardSurface && !minimalHeader && (
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate px-1 text-[12px] font-semibold text-fg-2">{activeTitle}</div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition hover:bg-panel-h hover:text-fg active:translate-y-px"
              aria-label="Close context shelf"
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1 pb-1">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {tabs.filter(tab => !hiddenTabs?.[tab]).map(tab => {
              const label = getTabLabel(tab);
              return (
                <button
                  key={tab}
                  type="button"
                  data-context-shelf-tab={tab}
                  onClick={() => onTabChange(tab)}
                  className={cn(
                    'h-7 shrink-0 rounded-md px-2 text-[11px] font-semibold transition-[background,color,transform] active:translate-y-px',
                    visibleTab === tab ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-5 hover:bg-panel-h/70 hover:text-fg-3',
                  )}
                  title={label}
                  aria-label={label}
                >
                  {label}
                  {tab === 'outputs' && outputs.length > 0 && <span className="ml-1 text-[10px] text-primary">{outputs.length}</span>}
                  {tab === 'files' && files.length > 0 && <span className="ml-1 text-[10px] text-primary">{files.length}</span>}
                </button>
              );
            })}
            {afterTabButtons}
          </div>
          {!cardSurface && onToggleMaxWidth && (
            <button
              type="button"
              data-context-shelf-toggle-width
              onClick={event => {
                event.stopPropagation();
                onToggleMaxWidth();
              }}
              className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg active:translate-y-px',
                isMaxWidth && 'bg-panel-h text-fg-3',
              )}
              title={isMaxWidth ? 'Restore default width' : 'Expand shelf width'}
              aria-label={isMaxWidth ? 'Restore default width' : 'Expand shelf width'}
              aria-pressed={isMaxWidth}
            >
              {isMaxWidth ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3v5H3" />
                  <path d="M3 8 9 2" />
                  <path d="M16 21v-5h5" />
                  <path d="m21 16-6 6" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 9V3h6" />
                  <path d="M3 3l7 7" />
                  <path d="M21 15v6h-6" />
                  <path d="m14 14 7 7" />
                </svg>
              )}
            </button>
          )}
          {onCreateSideCard && (
            <button
              type="button"
              data-context-shelf-create-side-card
              onClick={event => {
                event.stopPropagation();
                onCreateSideCard();
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge/60 bg-panel/75 text-[15px] font-semibold leading-none text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg active:translate-y-px"
              title={createSideCardLabel}
              aria-label={createSideCardLabel}
            >
              +
            </button>
          )}
          {minimalHeader && (
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                onClose();
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition hover:bg-panel-h hover:text-fg active:translate-y-px"
              aria-label="Close context shelf"
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>}
      <div className="min-h-0 flex-1 bg-[var(--th-session-bg)]">
        {sideCardSurface ? (sideCardContent || sideChatContent) : null}
        {!sideCardSurface && visibleTab === 'outputs' && (
          <OutputPreview
            outputs={outputs}
            onOpenPath={onOpenPath}
            onCreateSessionFromOutput={onCreateSessionFromOutput}
          />
        )}
        {!sideCardSurface && visibleTab === 'side-chats' && sideChatContent}
        {!sideCardSurface && visibleTab === 'browser' && <BrowserTab />}
        {visibleTab === 'files' && (filesContent || <FilesTab files={files} onOpenPath={onOpenPath} />)}
        {visibleTab === 'status' && (
          <div className="h-full overflow-y-auto px-3 py-3">
            {statusContent || <EmptyShelfState title="No status context" hint="Task and session state changes will collect here." />}
          </div>
        )}
        {visibleTab === 'ticket' && <TicketTab ticket={ticket} />}
      </div>
    </div>
  );
}
