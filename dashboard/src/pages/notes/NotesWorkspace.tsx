import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BlockNoteSchema, defaultBlockSpecs, type PartialBlock } from '@blocknote/core';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { api } from '../../api';
import { useStore } from '../../store';
import type { NotePage, NoteSearchResult, NotePromotionTarget } from '../../types';
import { fmtRelative, cn } from '../../utils';
import { Button, Spinner } from '../../components/ui';

const EMPTY_BLOCKS = [{ type: 'paragraph', content: [] }];

const calloutBlockSpec = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {},
    content: 'inline',
  },
  {
    render: ({ contentRef }) => (
      <div className="notes-callout">
        <div className="notes-callout-icon">i</div>
        <div ref={contentRef} className="notes-callout-content" />
      </div>
    ),
  },
)();

const notesSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: calloutBlockSpec,
  },
});

function CalloutMenuIcon() {
  return (
    <span className="flex h-[18px] w-[18px] items-center justify-center rounded border border-border text-[11px] font-semibold text-fg-4">
      i
    </span>
  );
}

function localDateInputValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function pageLabel(page: NotePage): string {
  if (page.kind === 'inbox') return 'Inbox';
  if (page.kind === 'daily') return page.date ? `Daily ${page.date}` : page.title;
  return page.title || 'Untitled';
}

function collectBlockText(value: unknown, parts: string[] = []): string[] {
  if (typeof value === 'string') {
    parts.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectBlockText(item, parts);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' || key === 'props') continue;
      collectBlockText(item, parts);
    }
  }
  return parts;
}

function Icon({ name, className }: { name: 'note' | 'daily' | 'inbox' | 'search' | 'trash' | 'plus' | 'chevron' | 'check'; className?: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  if (name === 'daily') return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4" /><path d="M16 2v4" /><path d="M3 10h18" /></svg>;
  if (name === 'inbox') return <svg {...common}><path d="M4 4h16l-2 9h-4l-2 3-2-3H6z" /><path d="M5 18h14" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
  if (name === 'trash') return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m20 6-11 11-5-5" /></svg>;
  return <svg {...common}><path d="M6 3h9l3 3v15H6z" /><path d="M14 3v4h4" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>;
}

function NoteEditor({
  pageId,
  blocks,
  theme,
  onBlocksChange,
  onSelectionText,
  onUploadError,
}: {
  pageId: string;
  blocks: unknown[];
  theme: 'light' | 'dark';
  onBlocksChange: (blocks: unknown[]) => void;
  onSelectionText: (text: string) => void;
  onUploadError: (message: string) => void;
}) {
  const uploadFile = useCallback(async (file: File) => {
    try {
      const result = await api.uploadNoteAsset(pageId, file, { timeoutMs: 60_000 });
      if (!result.ok || !result.asset) throw new Error(result.error || 'Image upload failed');
      return result.asset.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      onUploadError(message);
      throw err;
    }
  }, [onUploadError, pageId]);

  const editor = useCreateBlockNote({
    schema: notesSchema,
    initialContent: (Array.isArray(blocks) && blocks.length ? blocks : EMPTY_BLOCKS) as PartialBlock[],
    uploadFile,
    domAttributes: {
      editor: { class: 'notes-block-editor' },
    },
  }, [pageId]);

  const slashMenuItems = useCallback(async (query: string) => filterSuggestionItems([
    ...getDefaultReactSlashMenuItems(editor),
    {
      title: 'Callout',
      subtext: 'Highlighted note',
      aliases: ['callout', 'note', 'info'],
      group: 'Basic blocks',
      icon: <CalloutMenuIcon />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' }),
    },
  ], query), [editor]);

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      className="notes-blocknote"
      slashMenu={false}
      onChange={() => onBlocksChange(editor.document as unknown[])}
      onSelectionChange={() => onSelectionText(editor.getSelectedText())}
    >
      <SuggestionMenuController triggerCharacter="/" getItems={slashMenuItems} />
    </BlockNoteView>
  );
}

function PageTreeNode({
  page,
  pages,
  activePageId,
  depth = 0,
  collapsed,
  draggingId,
  onToggle,
  onOpen,
  onCreateChild,
  onDragStart,
  onDropOn,
}: {
  page: NotePage;
  pages: NotePage[];
  activePageId: string | null;
  depth?: number;
  collapsed: Set<string>;
  draggingId: string | null;
  onToggle: (pageId: string) => void;
  onOpen: (pageId: string) => void;
  onCreateChild: (pageId: string) => void;
  onDragStart: (pageId: string) => void;
  onDropOn: (targetId: string) => void;
}) {
  const children = pages
    .filter(candidate => candidate.parentId === page.id && !candidate.deletedAt && candidate.kind === 'page')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const isCollapsed = collapsed.has(page.id);
  const active = activePageId === page.id;
  return (
    <div>
      <div
        draggable={page.kind === 'page'}
        onDragStart={() => onDragStart(page.id)}
        onDragOver={event => {
          if (draggingId && draggingId !== page.id) event.preventDefault();
        }}
        onDrop={event => {
          event.preventDefault();
          onDropOn(page.id);
        }}
        className={cn(
          'group flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] transition-colors',
          active ? 'bg-panel-h text-fg' : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2',
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          className={cn('flex h-5 w-5 items-center justify-center rounded text-fg-5 hover:bg-panel', !children.length && 'invisible')}
          onClick={() => onToggle(page.id)}
          aria-label={isCollapsed ? 'Expand page' : 'Collapse page'}
        >
          <Icon name="chevron" className={cn('h-3 w-3 transition-transform', !isCollapsed && 'rotate-90')} />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpen(page.id)}>
          <Icon name="note" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{pageLabel(page)}</span>
        </button>
        <button
          type="button"
          className="hidden h-6 w-6 items-center justify-center rounded text-fg-5 hover:bg-panel hover:text-fg group-hover:flex"
          onClick={() => onCreateChild(page.id)}
          title="New child page"
          aria-label="New child page"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
      </div>
      {!isCollapsed && children.map(child => (
        <PageTreeNode
          key={child.id}
          page={child}
          pages={pages}
          activePageId={activePageId}
          depth={depth + 1}
          collapsed={collapsed}
          draggingId={draggingId}
          onToggle={onToggle}
          onOpen={onOpen}
          onCreateChild={onCreateChild}
          onDragStart={onDragStart}
          onDropOn={onDropOn}
        />
      ))}
    </div>
  );
}

export function NotesWorkspace() {
  const { pageId: routePageId } = useParams();
  const navigate = useNavigate();
  const theme = useStore(s => s.theme);
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir || '');

  const [pages, setPages] = useState<NotePage[]>([]);
  const [todayDate, setTodayDate] = useState(localDateInputValue());
  const [selectedPageId, setSelectedPageId] = useState<string | null>(routePageId || null);
  const [blocks, setBlocks] = useState<unknown[] | null>(null);
  const [dirtyBlocks, setDirtyBlocks] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [selectionText, setSelectionText] = useState('');
  const [dateDraft, setDateDraft] = useState(localDateInputValue());
  const saveTimerRef = useRef<number | null>(null);

  const selectedPage = useMemo(() => pages.find(page => page.id === selectedPageId) || null, [pages, selectedPageId]);
  const activePages = useMemo(() => pages.filter(page => !page.deletedAt), [pages]);
  const trashPages = useMemo(() => pages.filter(page => page.deletedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [pages]);
  const rootPages = useMemo(() => activePages
    .filter(page => page.kind === 'page' && !page.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)), [activePages]);
  const inbox = activePages.find(page => page.kind === 'inbox') || null;
  const dailyPages = useMemo(() => activePages
    .filter(page => page.kind === 'daily')
    .sort((a, b) => String(b.date || b.updatedAt).localeCompare(String(a.date || a.updatedAt)))
    .slice(0, 14), [activePages]);

  const refreshTree = useCallback(async () => {
    const tree = await api.getNotesTree();
    if (!tree.ok) throw new Error(tree.error || 'Failed to load notes');
    setPages(tree.pages || []);
    setTodayDate(tree.todayDate || localDateInputValue());
    setDateDraft(tree.todayDate || localDateInputValue());
    return tree.pages || [];
  }, []);

  const openPage = useCallback((nextPageId: string, replace = false) => {
    setSelectedPageId(nextPageId);
    setBlocks(null);
    setDirtyBlocks(null);
    setSelectionText('');
    navigate(`/notes/${encodeURIComponent(nextPageId)}`, { replace });
  }, [navigate]);

  const openDaily = useCallback(async (date?: string, replace = false) => {
    const result = await api.openDailyNote(date);
    if (!result.ok || !result.page) throw new Error(result.error || 'Failed to open daily note');
    await refreshTree();
    openPage(result.page.id, replace);
    return result.page;
  }, [openPage, refreshTree]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const treePages = await refreshTree();
        if (cancelled) return;
        if (routePageId) {
          setSelectedPageId(routePageId);
          if (!treePages.some(page => page.id === routePageId)) {
            toast('Note page not found', false);
            await openDaily(undefined, true);
          }
        } else {
          await openDaily(undefined, true);
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load notes', false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openDaily, refreshTree, routePageId, toast]);

  useEffect(() => {
    if (!selectedPageId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getNoteDocument(selectedPageId);
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error || 'Failed to load note document');
        setBlocks(result.blocks?.length ? result.blocks : EMPTY_BLOCKS);
        setDirtyBlocks(null);
        setSaving('idle');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load note document', false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPageId, toast]);

  useEffect(() => {
    if (!selectedPageId || !dirtyBlocks) return undefined;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setSaving('saving');
    saveTimerRef.current = window.setTimeout(() => {
      void api.saveNoteDocument(selectedPageId, dirtyBlocks)
        .then(result => {
          if (!result.ok) throw new Error(result.error || 'Failed to save note');
          setSaving('saved');
          void refreshTree().catch(() => {});
        })
        .catch(err => {
          setSaving('error');
          toast(err instanceof Error ? err.message : 'Failed to save note', false);
        });
    }, 700);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [dirtyBlocks, refreshTree, selectedPageId, toast]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void api.searchNotes(query)
        .then(result => {
          if (result.ok) setResults(result.results || []);
        })
        .catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const createPage = useCallback(async (parentId?: string | null) => {
    try {
      const result = await api.createNotePage({ title: 'Untitled', parentId: parentId || null });
      if (!result.ok || !result.page) throw new Error(result.error || 'Failed to create note page');
      await refreshTree();
      if (parentId) setCollapsed(prev => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      openPage(result.page.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create note page', false);
    }
  }, [openPage, refreshTree, toast]);

  const renamePage = useCallback(async (title: string) => {
    if (!selectedPageId || !selectedPage) return;
    const nextTitle = title.trim() || pageLabel(selectedPage);
    setPages(prev => prev.map(page => page.id === selectedPageId ? { ...page, title: nextTitle } : page));
    try {
      const result = await api.updateNotePage(selectedPageId, { title: nextTitle });
      if (!result.ok || !result.page) throw new Error(result.error || 'Failed to rename note');
      setPages(prev => prev.map(page => page.id === selectedPageId ? result.page! : page));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to rename note', false);
      void refreshTree().catch(() => {});
    }
  }, [refreshTree, selectedPage, selectedPageId, toast]);

  const deleteSelected = useCallback(async () => {
    if (!selectedPageId || !selectedPage || selectedPage.kind === 'inbox') return;
    try {
      const result = await api.deleteNotePage(selectedPageId);
      if (!result.ok) throw new Error(result.error || 'Failed to delete note');
      await refreshTree();
      await openDaily(undefined, true);
      toast('Note moved to trash');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete note', false);
    }
  }, [openDaily, refreshTree, selectedPage, selectedPageId, toast]);

  const restorePage = useCallback(async (pageId: string) => {
    try {
      const result = await api.updateNotePage(pageId, { deletedAt: null });
      if (!result.ok) throw new Error(result.error || 'Failed to restore note');
      await refreshTree();
      toast('Note restored');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to restore note', false);
    }
  }, [refreshTree, toast]);

  const deleteForever = useCallback(async (pageId: string) => {
    try {
      const result = await api.deleteNotePage(pageId, true);
      if (!result.ok) throw new Error(result.error || 'Failed to delete note');
      await refreshTree();
      toast('Note deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete note', false);
    }
  }, [refreshTree, toast]);

  const dropOnPage = useCallback(async (targetId: string) => {
    const dragId = draggingId;
    setDraggingId(null);
    if (!dragId || dragId === targetId) return;
    const dragged = pages.find(page => page.id === dragId);
    const target = pages.find(page => page.id === targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId || dragged.kind !== 'page' || target.kind !== 'page') return;
    const siblings = pages
      .filter(page => page.kind === 'page' && !page.deletedAt && (page.parentId || null) === (target.parentId || null))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const nextIds = siblings.map(page => page.id).filter(id => id !== dragId);
    const targetIndex = nextIds.indexOf(targetId);
    nextIds.splice(targetIndex < 0 ? nextIds.length : targetIndex, 0, dragId);
    setPages(prev => prev.map(page => {
      const index = nextIds.indexOf(page.id);
      return index >= 0 ? { ...page, sortOrder: index } : page;
    }));
    try {
      await api.reorderNotePages({ parentId: dragged.parentId || null, pageIds: nextIds });
      await refreshTree();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reorder notes', false);
      void refreshTree().catch(() => {});
    }
  }, [draggingId, pages, refreshTree, toast]);

  const promoteSelection = useCallback(async (target: NotePromotionTarget) => {
    if (!selectedPageId || !selectionText.trim()) return;
    try {
      const result = await api.promoteNoteSelection({
        pageId: selectedPageId,
        target,
        text: selectionText.trim(),
        date: selectedPage?.date || todayDate,
        workdir: runtimeWorkdir,
      });
      if (!result.ok) throw new Error(result.error || 'Failed to promote note selection');
      toast(target === 'todo' ? 'Todo created' : target === 'daily' ? 'Daily item created' : 'Task created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to promote note selection', false);
    }
  }, [runtimeWorkdir, selectedPage?.date, selectedPageId, selectionText, todayDate, toast]);

  const breadcrumb = useMemo(() => {
    if (!selectedPage) return [];
    const chain: NotePage[] = [];
    let current: NotePage | undefined = selectedPage;
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      chain.unshift(current);
      guard.add(current.id);
      current = current.parentId ? pages.find(page => page.id === current?.parentId) : undefined;
    }
    return chain;
  }, [pages, selectedPage]);

  const currentText = useMemo(() => collectBlockText(blocks || []).join(' ').trim(), [blocks]);

  return (
    <div className="notes-workspace flex h-full min-h-0 bg-[var(--th-session-bg)] text-fg">
      <aside className="flex w-[278px] shrink-0 flex-col border-r border-edge bg-panel/62">
        <div className="border-b border-edge px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[14px] font-semibold tracking-tight text-fg">Notes</div>
            <Button variant="ghost" size="icon" className="!h-7 !w-7" onClick={() => void createPage(null)} title="New page" aria-label="New page">
              <Icon name="plus" className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-5" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search notes"
              className="h-8 w-full rounded-md border border-control-border bg-control pl-8 pr-2 text-[12px] text-fg outline-none placeholder:text-fg-5 focus:border-control-border-h focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {query.trim() ? (
            <div className="space-y-1">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-5">Search</div>
              {results.length ? results.map(result => (
                <button
                  key={result.page.id}
                  type="button"
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-panel-alt"
                  onClick={() => {
                    setQuery('');
                    openPage(result.page.id);
                  }}
                >
                  <div className="truncate text-[12px] font-semibold text-fg-2">{pageLabel(result.page)}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-5">{result.snippet}</div>
                </button>
              )) : <div className="px-2 py-4 text-[12px] text-fg-5">No results</div>}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <button
                  type="button"
                  className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium', selectedPage?.kind === 'daily' && selectedPage.date === todayDate ? 'bg-panel-h text-fg' : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2')}
                  onClick={() => void openDaily(todayDate)}
                >
                  <Icon name="daily" className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">Today</span>
                  <span className="text-[10px] text-fg-5">{todayDate.slice(5)}</span>
                </button>
                {inbox && (
                  <button
                    type="button"
                    className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium', selectedPageId === inbox.id ? 'bg-panel-h text-fg' : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2')}
                    onClick={() => openPage(inbox.id)}
                  >
                    <Icon name="inbox" className="h-3.5 w-3.5" />
                    <span className="flex-1 truncate">Inbox</span>
                  </button>
                )}
              </div>

              <div className="mt-3 rounded-md border border-edge/70 bg-inset/40 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-5">
                  <Icon name="daily" className="h-3.5 w-3.5" />
                  Daily
                </div>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={dateDraft}
                    onChange={event => setDateDraft(event.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border border-control-border bg-control px-2 text-[11px] text-fg outline-none"
                  />
                  <Button variant="secondary" size="sm" className="h-7 px-2" onClick={() => void openDaily(dateDraft)}>Open</Button>
                </div>
                <div className="mt-2 space-y-0.5">
                  {dailyPages.map(page => (
                    <button
                      key={page.id}
                      type="button"
                      className={cn('flex h-7 w-full items-center justify-between gap-2 rounded px-1.5 text-left text-[11px]', selectedPageId === page.id ? 'bg-panel-h text-fg' : 'text-fg-5 hover:bg-panel-alt hover:text-fg-2')}
                      onClick={() => openPage(page.id)}
                    >
                      <span className="truncate">{page.date}</span>
                      {page.date === todayDate && <span className="text-[10px] text-primary">today</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between px-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-5">Pages</div>
                  <button type="button" className="rounded p-1 text-fg-5 hover:bg-panel hover:text-fg" onClick={() => void createPage(null)} aria-label="New page">
                    <Icon name="plus" className="h-3.5 w-3.5" />
                  </button>
                </div>
                {rootPages.length ? rootPages.map(page => (
                  <PageTreeNode
                    key={page.id}
                    page={page}
                    pages={pages}
                    activePageId={selectedPageId}
                    collapsed={collapsed}
                    draggingId={draggingId}
                    onToggle={pageId => setCollapsed(prev => {
                      const next = new Set(prev);
                      if (next.has(pageId)) next.delete(pageId);
                      else next.add(pageId);
                      return next;
                    })}
                    onOpen={openPage}
                    onCreateChild={pageId => void createPage(pageId)}
                    onDragStart={setDraggingId}
                    onDropOn={dropOnPage}
                  />
                )) : <div className="rounded-md border border-dashed border-edge/60 px-3 py-6 text-center text-[12px] text-fg-5">No pages yet</div>}
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-fg-5">
                  <Icon name="trash" className="h-3.5 w-3.5" />
                  Trash
                </div>
                {trashPages.length ? (
                  <div className="space-y-1">
                    {trashPages.map(page => (
                      <div key={page.id} className="rounded-md border border-edge/55 bg-inset/35 px-2 py-1.5">
                        <div className="truncate text-[12px] font-medium text-fg-3">{pageLabel(page)}</div>
                        <div className="mt-1 flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void restorePage(page.id)}>Restore</Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-err hover:text-err" onClick={() => void deleteForever(page.id)}>Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="px-2 text-[12px] text-fg-5">Empty</div>}
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {loading || !selectedPage || !blocks ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-4">
            <Spinner />
            <span className="ml-2">Loading notes...</span>
          </div>
        ) : (
          <>
            <header className="flex min-h-14 items-center gap-3 border-b border-edge bg-panel/36 px-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-fg-5">
                  {breadcrumb.map((page, index) => (
                    <span key={page.id} className="flex min-w-0 items-center gap-1.5">
                      {index > 0 && <span>/</span>}
                      <button type="button" className="truncate hover:text-fg-2" onClick={() => openPage(page.id)}>{pageLabel(page)}</button>
                    </span>
                  ))}
                </div>
                <input
                  value={selectedPage.title}
                  onChange={event => {
                    const title = event.target.value;
                    setPages(prev => prev.map(page => page.id === selectedPage.id ? { ...page, title } : page));
                  }}
                  onBlur={event => void renamePage(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className="mt-0.5 w-full bg-transparent text-[18px] font-semibold tracking-tight text-fg outline-none placeholder:text-fg-5"
                  placeholder="Untitled"
                  disabled={selectedPage.kind === 'inbox'}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className={cn('mr-1 text-[11px]', saving === 'error' ? 'text-err' : saving === 'saving' ? 'text-fg-5' : 'text-fg-6')}>
                  {saving === 'saving' ? 'Saving...' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : fmtRelative(selectedPage.updatedAt)}
                </span>
                {selectionText.trim() && (
                  <div className="flex items-center gap-1 rounded-md border border-edge bg-inset/55 p-0.5">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void promoteSelection('todo')}>Todo</Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void promoteSelection('daily')}>Daily</Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void promoteSelection('task')}>Task</Button>
                  </div>
                )}
                <Button variant="ghost" size="sm" disabled={selectedPage.kind === 'inbox'} onClick={() => void createPage(selectedPage.id)}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Child
                </Button>
                <Button variant="ghost" size="sm" disabled={selectedPage.kind === 'inbox'} onClick={() => void deleteSelected()}>
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto min-h-full w-full max-w-[920px] px-8 py-8">
                {selectedPage.kind === 'daily' && (
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-edge bg-inset/60 px-2 py-1 text-[11px] font-medium text-fg-4">
                    <Icon name="daily" className="h-3.5 w-3.5" />
                    {selectedPage.date || todayDate}
                  </div>
                )}
                {!currentText && selectedPage.kind === 'daily' && (
                  <div className="mb-4 rounded-md border border-dashed border-edge/70 bg-inset/40 px-3 py-2 text-[12px] text-fg-5">
                    Capture thoughts here. Checkbox blocks stay as notes until you promote selected text.
                  </div>
                )}
                <NoteEditor
                  key={selectedPage.id}
                  pageId={selectedPage.id}
                  blocks={blocks}
                  theme={theme}
                  onBlocksChange={nextBlocks => {
                    setBlocks(nextBlocks);
                    setDirtyBlocks(nextBlocks);
                  }}
                  onSelectionText={setSelectionText}
                  onUploadError={message => toast(message, false)}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default NotesWorkspace;
