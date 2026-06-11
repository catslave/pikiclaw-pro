import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Button, Spinner, Badge } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { KnowledgeTreeNode } from '../../types';
import { cn } from '../../utils';

function collectNodes(nodes: KnowledgeTreeNode[]): KnowledgeTreeNode[] {
  const out: KnowledgeTreeNode[] = [];
  const walk = (items: KnowledgeTreeNode[]) => {
    for (const item of items) {
      out.push(item);
      walk(item.children || []);
    }
  };
  walk(nodes);
  return out;
}

function findNode(nodes: KnowledgeTreeNode[], id: string | null): KnowledgeTreeNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children || [], id);
    if (child) return child;
  }
  return null;
}

function fmtDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function NodeIcon({ kind, status }: { kind: KnowledgeTreeNode['kind']; status: KnowledgeTreeNode['status'] }) {
  if (status !== 'ready') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
  if (kind === 'repo') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h12v18H6z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5z" />
    </svg>
  );
}

function KnowledgeTreeRow({
  node,
  selectedId,
  expanded,
  level = 0,
  onToggle,
  onSelect,
}: {
  node: KnowledgeTreeNode;
  selectedId: string | null;
  expanded: Set<string>;
  level?: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = !!node.children?.length;
  const isExpanded = expanded.has(node.id);
  const selected = node.id === selectedId;
  return (
    <div>
      <div
        className={cn(
          'group flex h-8 items-center gap-1 rounded-md pr-1 text-[12px] transition-colors',
          selected ? 'bg-primary/[0.10] text-fg ring-1 ring-inset ring-primary/20' : 'text-fg-3 hover:bg-panel-h/55 hover:text-fg',
        )}
        style={{ paddingLeft: 8 + level * 14 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-5 transition-colors hover:bg-panel-h hover:text-fg-3',
            !hasChildren && 'pointer-events-none opacity-25',
          )}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={cn('transition-transform', isExpanded && 'rotate-90')} aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={node.path || node.title}
        >
          <span className={cn('shrink-0', node.status === 'ready' ? 'text-fg-5' : 'text-warn')}>
            <NodeIcon kind={node.kind} status={node.status} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{node.title}</span>
          {node.workspacePaths.length > 0 && (
            <span className="shrink-0 rounded border border-primary/20 bg-primary/[0.08] px-1 text-[9px] font-semibold text-primary">
              W
            </span>
          )}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {node.children.map(child => (
            <KnowledgeTreeRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              level={level + 1}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeTab() {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);
  const location = useLocation();
  const navigate = useNavigate();
  const selectedIdFromUrl = useMemo(() => new URLSearchParams(location.search).get('node'), [location.search]);
  const [tree, setTree] = useState<KnowledgeTreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(selectedIdFromUrl);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getKnowledgeTree();
      if (!result.ok) throw new Error(result.error || t('knowledge.loadFailed'));
      setTree(result.tree || []);
      const allNodes = collectNodes(result.tree || []);
      setExpanded(new Set((result.tree || []).map(node => node.id)));
      const nextSelected = findNode(result.tree || [], selectedIdFromUrl)?.id || allNodes[0]?.id || null;
      setSelectedId(nextSelected);
      if (nextSelected && nextSelected !== selectedIdFromUrl) {
        navigate(`/knowledge?node=${encodeURIComponent(nextSelected)}`, { replace: true });
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t('knowledge.loadFailed'), false);
    } finally {
      setLoading(false);
    }
  }, [navigate, selectedIdFromUrl, t, toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedIdFromUrl) return;
    if (findNode(tree, selectedIdFromUrl)) setSelectedId(selectedIdFromUrl);
  }, [selectedIdFromUrl, tree]);

  const selected = useMemo(() => findNode(tree, selectedId), [tree, selectedId]);
  const allNodes = useMemo(() => collectNodes(tree), [tree]);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    navigate(`/knowledge?node=${encodeURIComponent(id)}`);
  }, [navigate]);

  const toggleNode = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reanalyze = useCallback(async () => {
    if (!selected) return;
    setReanalyzing(true);
    try {
      const result = await api.reanalyzeKnowledgeNode(selected.id);
      if (!result.ok || !result.node) throw new Error(result.error || t('knowledge.reanalyzeFailed'));
      if (result.tree) setTree(result.tree);
      setSelectedId(result.node.id);
      toast(t('knowledge.reanalyzed'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('knowledge.reanalyzeFailed'), false);
    } finally {
      setReanalyzing(false);
    }
  }, [selected, t, toast]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-panel/20">
      <aside className="hidden h-full w-[300px] shrink-0 flex-col border-r border-edge/60 bg-panel/80 backdrop-blur md:flex">
        <div className="border-b border-edge/45 px-4 py-3">
          <div className="text-[13px] font-semibold text-fg">{t('knowledge.title')}</div>
          <div className="mt-0.5 text-[11px] text-fg-5">
            {t('knowledge.nodeCount').replace('{n}', String(allNodes.length))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Spinner className="h-4 w-4 text-fg-5" />
            </div>
          ) : tree.length ? (
            <div className="space-y-0.5">
              {tree.map(node => (
                <KnowledgeTreeRow
                  key={node.id}
                  node={node}
                  selectedId={selectedId}
                  expanded={expanded}
                  onToggle={toggleNode}
                  onSelect={selectNode}
                />
              ))}
            </div>
          ) : (
            <div className="px-3 py-10 text-center text-[12px] leading-relaxed text-fg-5">
              {t('knowledge.empty')}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-fg-4">
              <Spinner />
              {t('knowledge.loading')}
            </div>
          </div>
        ) : selected ? (
          <div className="mx-auto max-w-[1040px] px-5 py-5">
            <div className="mb-4 flex flex-col gap-3 border-b border-edge/55 pb-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={selected.kind === 'repo' ? 'accent' : 'muted'}>{selected.kind === 'repo' ? 'Repo' : 'Folder'}</Badge>
                  {selected.status !== 'ready' && <Badge variant="warn">{selected.status}</Badge>}
                  {selected.analyzedAt && <span className="text-[11px] text-fg-5">{t('knowledge.analyzedAt').replace('{time}', fmtDate(selected.analyzedAt))}</span>}
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-fg">{selected.title}</h2>
                {selected.path && <div className="mt-1 truncate font-mono text-[11px] text-fg-5" title={selected.path}>{selected.path}</div>}
              </div>
              <Button variant="outline" size="sm" onClick={() => void reanalyze()} disabled={reanalyzing || !selected.path}>
                {reanalyzing && <Spinner className="h-3 w-3" />}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
                <span>{t('knowledge.reanalyze')}</span>
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-edge/60 bg-panel/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{t('knowledge.files')}</div>
                <div className="mt-1 text-lg font-semibold text-fg">{selected.stats?.fileCount ?? 0}</div>
              </div>
              <div className="rounded-md border border-edge/60 bg-panel/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{t('knowledge.folders')}</div>
                <div className="mt-1 text-lg font-semibold text-fg">{selected.stats?.directoryCount ?? selected.children.length}</div>
              </div>
              <div className="rounded-md border border-edge/60 bg-panel/70 p-3 md:col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{t('knowledge.stack')}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[...(selected.stats?.primaryLanguages || []), ...(selected.stats?.frameworks || [])].slice(0, 10).map(item => (
                    <span key={item} className="rounded border border-edge/65 bg-panel-alt px-1.5 py-0.5 text-[10px] font-medium text-fg-3">{item}</span>
                  ))}
                  {!selected.stats?.primaryLanguages?.length && !selected.stats?.frameworks?.length && (
                    <span className="text-[12px] text-fg-5">{t('knowledge.noStack')}</span>
                  )}
                </div>
              </div>
            </div>

            <section className="mt-5">
              <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.overview')}</h3>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-3">{selected.summary}</p>
            </section>

            <section className="mt-5">
              <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.design')}</h3>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-3">{selected.design}</p>
            </section>

            {selected.boundary && (
              <section className="mt-5">
                <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.boundary')}</h3>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-3">{selected.boundary}</p>
              </section>
            )}

            {selected.implementation && (
              <section className="mt-5">
                <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.implementation')}</h3>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-3">{selected.implementation}</p>
              </section>
            )}

            <section className="mt-5">
              <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.highlights')}</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {selected.highlights.map(item => (
                  <div key={item} className="rounded-md border border-edge/55 bg-panel/60 px-3 py-2 text-[12px] leading-relaxed text-fg-3">
                    {item}
                  </div>
                ))}
              </div>
            </section>

            {selected.workspacePaths.length > 0 && (
              <section className="mt-5">
                <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.linkedWorkspaces')}</h3>
                <div className="mt-2 space-y-1">
                  {selected.workspacePaths.map(workspacePath => (
                    <div key={workspacePath} className="truncate rounded-md border border-edge/55 bg-panel/50 px-3 py-2 font-mono text-[11px] text-fg-4" title={workspacePath}>
                      {workspacePath}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {selected.children.length > 0 && (
              <section className="mt-5 pb-8">
                <h3 className="text-[13px] font-semibold text-fg">{t('knowledge.childFolders')}</h3>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {selected.children.map(child => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => selectNode(child.id)}
                      className="rounded-md border border-edge/55 bg-panel/58 px-3 py-2 text-left transition-colors hover:border-primary/35 hover:bg-panel-h/65"
                    >
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-fg-5"><NodeIcon kind={child.kind} status={child.status} /></span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{child.title}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-5">{child.summary}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-fg-5">
            {t('knowledge.empty')}
          </div>
        )}
      </main>
    </div>
  );
}

export default KnowledgeTab;
