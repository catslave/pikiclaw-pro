import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Dot, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { SessionInfo, WorkspaceEntry } from '../../types';
import {
  cn,
  fmtRelative,
  getAgentMeta,
  sessionDisplayState,
  sessionListContextText,
  sessionListDisplayText,
} from '../../utils';
import { SectionCard } from '../shared';

type ArchivedSessionRow = {
  key: string;
  workdir: string;
  workspaceName: string;
  session: SessionInfo;
};

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function rowTime(row: ArchivedSessionRow): number {
  const raw = row.session.archivedAt || row.session.runUpdatedAt || row.session.createdAt || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAbsoluteTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function makeRows(workspace: WorkspaceEntry, sessions: SessionInfo[]): ArchivedSessionRow[] {
  const workspaceName = workspace.name || basename(workspace.path);
  return sessions.map(session => ({
    key: `${workspace.path}:${session.agent || ''}:${session.sessionId}`,
    workdir: workspace.path,
    workspaceName,
    session,
  }));
}

export function ArchiveTab() {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [rows, setRows] = useState<ArchivedSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const loadArchivedSessions = useCallback(async () => {
    setLoading(true);
    try {
      const workspaceRes = await api.getWorkspaces();
      const workspaces = workspaceRes.ok ? workspaceRes.workspaces : [];
      const settled = await Promise.all(workspaces.map(async workspace => {
        try {
          const res = await api.getWorkspaceSessions(workspace.path, { archiveMode: 'archived' });
          return res.ok ? makeRows(workspace, res.sessions || []) : [];
        } catch {
          return [];
        }
      }));
      setRows(settled.flat().sort((a, b) => rowTime(b) - rowTime(a)));
    } catch {
      toast(t('archive.loadFailed'), false);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadArchivedSessions();
  }, [loadArchivedSessions]);

  const restoreRow = useCallback(async (row: ArchivedSessionRow) => {
    const agent = row.session.agent || '';
    if (!agent) return;
    setRestoringKey(row.key);
    try {
      const res = await api.updateSessionArchived(row.workdir, agent, row.session.sessionId, false);
      if (!res.ok) {
        toast(res.error || t('archive.restoreFailed'), false);
        return;
      }
      setRows(prev => prev.filter(item => item.key !== row.key));
      toast(t('archive.restored'));
    } catch {
      toast(t('archive.restoreFailed'), false);
    } finally {
      setRestoringKey(null);
    }
  }, [t, toast]);

  return (
    <div className="animate-in space-y-3">
      <SectionCard className="!p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="muted">{rows.length} {t('archive.count')}</Badge>
            {loading && (
              <span className="flex items-center gap-1.5 text-[12px] text-fg-5">
                <Spinner className="h-3 w-3" />
                {t('archive.loading')}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadArchivedSessions()} disabled={loading}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t('archive.refresh')}
          </Button>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden !p-0">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-fg-5">
            <Spinner />
            {t('archive.loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-[13px] font-medium text-fg-2">{t('archive.empty')}</div>
            <div className="mt-1 text-[12px] text-fg-5">{t('archive.emptyHint')}</div>
          </div>
        ) : (
          <div className="divide-y divide-edge/45">
            {rows.map(row => (
              <ArchivedSessionItem
                key={row.key}
                row={row}
                locale={locale}
                restoring={restoringKey === row.key}
                onRestore={() => void restoreRow(row)}
                t={t}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ArchivedSessionItem({
  row,
  locale,
  restoring,
  onRestore,
  t,
}: {
  row: ArchivedSessionRow;
  locale: string;
  restoring: boolean;
  onRestore: () => void;
  t: (key: string) => string;
}) {
  const session = row.session;
  const meta = getAgentMeta(session.agent || '');
  const title = sessionListDisplayText(session);
  const detail = sessionListContextText(session, title);
  const state = sessionDisplayState(session);
  const archivedAt = session.archivedAt || session.runUpdatedAt || session.createdAt || null;

  return (
    <div className="group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-panel-h/35 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-5">
          <BrandIcon brand={session.agent || ''} size={12} />
          <span className="shrink-0 font-medium" style={{ color: meta.color }}>{meta.shortLabel}</span>
          <span className="text-fg-6">/</span>
          <span className="min-w-0 truncate" title={row.workdir}>{row.workspaceName}</span>
          <span className="ml-auto hidden shrink-0 tabular-nums sm:inline">
            {t('archive.archivedAt')} {fmtRelative(archivedAt)}
          </span>
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <Dot
            variant={state === 'running' ? 'ok' : state === 'incomplete' ? 'err' : 'idle'}
            pulse={state === 'running'}
          />
          <div className="min-w-0">
            <div className="line-clamp-2 text-[13px] font-medium leading-snug text-fg-2" title={title}>
              {title}
            </div>
            {detail && (
              <div className="mt-1 line-clamp-1 text-[11px] leading-snug text-fg-5">
                {detail}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-fg-5 sm:hidden">
          <span>{t('archive.archivedAt')} {formatAbsoluteTime(archivedAt, locale)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
        <span className={cn('hidden text-[11px] text-fg-5 sm:inline', !archivedAt && 'opacity-0')}>
          {formatAbsoluteTime(archivedAt, locale)}
        </span>
        <Button variant="secondary" size="sm" onClick={onRestore} disabled={restoring || !session.agent}>
          {restoring && <Spinner className="h-3 w-3" />}
          {t('archive.restore')}
        </Button>
      </div>
    </div>
  );
}
