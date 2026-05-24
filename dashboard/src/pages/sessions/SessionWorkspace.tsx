import { Suspense, lazy, startTransition, useDeferredValue, useState, useEffect, useCallback, useRef, memo, useMemo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../store';
import { createT } from '../../i18n';
import { api } from '../../api';
import { loadWorkspaceSessions, prefetchSessionMessages } from '../../session-preload';
import { useDashboardEvent, useDashboardReconnect } from '../../ws';
import {
  applyLiveSessionState,
  cn,
  fmtTime,
  fmtRelative,
  getAgentMeta,
  normalizeLiveSessionState,
  shortenModel,
  sessionDisplayState,
  sessionListContextText,
  sessionListDisplayText,
  type LiveSessionState,
} from '../../utils';
import { Badge, Dot, Spinner, Modal, ModalHeader, Button, IconPicker } from '../../components/ui';
import { BrandIcon } from '../../components/BrandIcon';
import { DirBrowser } from '../../components/DirBrowser';
import type { AppState, SessionInfo, WorkspaceEntry, DirEntry, GitChange, OpenTarget } from '../../types';
import { InputComposer } from './InputComposer';
import { UserBubble } from './TurnView';
import { ThinkingDots } from './LivePreview';
import { WorkspaceExtensionsModal } from '../extensions/WorkspaceExtensionsModal';
import type { FileLinkTarget, OpenFileLinkHandler } from './markdown';

// Kick off SessionPanel import the moment this module loads so the lazy boundary
// resolves before the user can compose & send a new message. The previous
// "preload on active" effect was reactive to mount and could lose the race.
let sessionPanelModulePromise: Promise<typeof import('./SessionPanel')> | null = import('./SessionPanel');

function preloadSessionPanel() {
  sessionPanelModulePromise ??= import('./SessionPanel');
  return sessionPanelModulePromise;
}

const SessionPanel = lazy(async () => ({ default: (await preloadSessionPanel()).SessionPanel }));

/* ── Constants ── */
const PAGE_SIZE = 5;
const AUTO_PREFETCH_DELAY_MS = 240;
const HOVER_PREFETCH_DELAY_MS = 120;
const SESSION_PREFETCH_TURNS = 12;
const LIVE_SESSION_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const STATUS_SUMMARY_RECENT_MS = 24 * 60 * 60 * 1000;
const sKey = (agent: string, id: string) => `${agent}:${id}`;
const workspaceBaseName = (workspacePath: string) => {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
};

type SessionWithDepth = SessionInfo & { __forkDepth: number };
type SessionSlot = { agent: string; sessionId: string; workdir: string; mountKey: string };
type WorkspaceRenameTarget = { path: string; name: string; originalName: string };
type FilePanelRequest = { workdir: string; path: string; line?: number; nonce: number };

/**
 * Reorder a flat session list so fork descendants render right after their
 * parent (with `__forkDepth` for indentation). Sessions without a `migratedFrom`
 * fork link stay in their natural sort order; orphan forks (parent missing
 * from the list) are demoted to top-level so they remain visible.
 */
function groupForkDescendants(sessions: SessionInfo[]): SessionWithDepth[] {
  const byKey = new Map<string, SessionInfo>();
  for (const s of sessions) byKey.set(sKey(s.agent || '', s.sessionId), s);

  // Build child map: parentKey -> children that fork off it. Order children
  // by their original index so the sidebar's most-recent-first ordering carries
  // through within a fork family.
  const childMap = new Map<string, SessionInfo[]>();
  const isForkChild = new Set<string>();
  for (const s of sessions) {
    const from = s.migratedFrom;
    if (!from || from.kind !== 'fork' || !from.sessionId) continue;
    const parentKey = sKey(from.agent || s.agent || '', from.sessionId);
    if (!byKey.has(parentKey)) continue; // orphan — fall through as top-level
    isForkChild.add(sKey(s.agent || '', s.sessionId));
    if (!childMap.has(parentKey)) childMap.set(parentKey, []);
    childMap.get(parentKey)!.push(s);
  }

  const out: SessionWithDepth[] = [];
  const seen = new Set<string>();
  const visit = (s: SessionInfo, depth: number) => {
    const key = sKey(s.agent || '', s.sessionId);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign({}, s, { __forkDepth: depth }));
    const kids = childMap.get(key);
    if (!kids) return;
    for (const k of kids) visit(k, depth + 1);
  };
  for (const s of sessions) {
    const key = sKey(s.agent || '', s.sessionId);
    if (isForkChild.has(key)) continue;
    visit(s, 0);
  }
  // Catch any orphan children whose parent fell out of the filtered list:
  // render them as top-level so they don't disappear.
  for (const s of sessions) {
    visit(s, 0);
  }
  return out;
}

let _slotKeySeq = 0;
function nextMountKey() { return `mk-${Date.now().toString(36)}-${(++_slotKeySeq).toString(36)}`; }

const OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:open-sessions:v1';
const ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:active-slot:v1';
const NEW_SESSION_STORAGE_KEY = 'pikiclaw:session-workspace:new-session-workdir:v1';
const LEGACY_OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw-open-sessions';
const LEGACY_ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw-active-slot';

function readBrowserStorage(key: string, legacyKey?: string): string | null {
  const keys = legacyKey ? [key, legacyKey] : [key];
  for (const storage of [localStorage, sessionStorage]) {
    for (const candidate of keys) {
      try {
        const value = storage.getItem(candidate);
        if (value != null) return value;
      } catch {}
    }
  }
  return null;
}

function writeBrowserStorage(key: string, value: string | null) {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      if (value == null || value === '') storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {}
  }
}

function readStoredOpenSessions(): SessionSlot[] {
  try {
    const raw = readBrowserStorage(OPEN_SESSIONS_STORAGE_KEY, LEGACY_OPEN_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s: any) => (
        s
        && typeof s.agent === 'string'
        && typeof s.sessionId === 'string'
        && typeof s.workdir === 'string'
      ))
      .map((s: any) => ({
        agent: s.agent,
        sessionId: s.sessionId,
        workdir: s.workdir,
        mountKey: typeof s.mountKey === 'string' && s.mountKey ? s.mountKey : nextMountKey(),
      }));
  } catch {
    return [];
  }
}

function readStoredActiveSlot(): number {
  const raw = readBrowserStorage(ACTIVE_SLOT_STORAGE_KEY, LEGACY_ACTIVE_SLOT_STORAGE_KEY);
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readStoredNewSessionWorkdir(): string | null {
  const raw = readBrowserStorage(NEW_SESSION_STORAGE_KEY);
  const trimmed = String(raw || '').trim();
  return trimmed || null;
}

type StripBadgeVariant = 'ok' | 'warn' | 'err' | 'muted' | 'accent';
type SessionWorkspaceMode = 'workspace' | 'dashboard';
type DashboardScope = 'all' | string;
type DashboardColumnKey = 'running' | 'pending' | 'review' | 'incomplete' | 'done';
type DashboardSessionItem = {
  key: string;
  session: SessionInfo;
  workdir: string;
  workspaceName: string;
  column: DashboardColumnKey;
  live: LiveSessionState | null;
};

type WorkspaceStatusSummary = {
  runningSessions: number;
  completedSessions: number;
  pendingReviewSessions: number;
  incompleteSessions: number;
  openWindows: number;
  totalSessions: number;
  workspaceCount: number;
  loadingWorkspaces: number;
  activeTasks: number;
  readyChannels: number;
  configuredChannels: number;
};

function isOpenTarget(value: string | null | undefined): value is OpenTarget {
  return value === 'vscode'
    || value === 'cursor'
    || value === 'windsurf'
    || value === 'finder'
    || value === 'default';
}

function inferOpenTarget(hostApp: string | null, platform: string | null): OpenTarget {
  const normalized = String(hostApp || '').toLowerCase();
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('windsurf')) return 'windsurf';
  if (normalized.includes('code')) return 'vscode';
  return platform === 'darwin' ? 'vscode' : 'default';
}

function targetLabelKey(target: OpenTarget) {
  switch (target) {
    case 'cursor': return 'hub.openTargetCursor';
    case 'windsurf': return 'hub.openTargetWindsurf';
    case 'finder': return 'hub.openTargetFinder';
    case 'default': return 'hub.openTargetDefault';
    case 'vscode':
    default:
      return 'hub.openTargetVsCode';
  }
}

function statusTimestampMs(session: SessionInfo): number | null {
  const raw = session.runUpdatedAt || session.createdAt || '';
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionRunningStartMs(session: SessionInfo): number | null {
  const raw = session.runStartedAt || session.runUpdatedAt || session.createdAt || '';
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function useElapsedNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

const DASHBOARD_COLUMNS: Array<{ key: DashboardColumnKey; titleKey: string; hintKey: string; variant: StripBadgeVariant }> = [
  { key: 'running', titleKey: 'dashboard.running', hintKey: 'dashboard.runningHint', variant: 'ok' },
  { key: 'pending', titleKey: 'dashboard.pending', hintKey: 'dashboard.pendingHint', variant: 'accent' },
  { key: 'review', titleKey: 'dashboard.review', hintKey: 'dashboard.reviewHint', variant: 'warn' },
  { key: 'incomplete', titleKey: 'dashboard.incomplete', hintKey: 'dashboard.incompleteHint', variant: 'err' },
  { key: 'done', titleKey: 'dashboard.done', hintKey: 'dashboard.doneHint', variant: 'muted' },
];

function dashboardColumnForSession(
  session: SessionInfo,
  live: LiveSessionState | null,
  recentCutoff: number,
): DashboardColumnKey | null {
  if (live?.phase === 'queued') return 'pending';
  if (live?.phase === 'streaming') return 'running';

  const displayState = sessionDisplayState(session);
  if (displayState === 'running') return 'running';
  if (displayState === 'incomplete') return 'incomplete';

  const recentlyFinished = (statusTimestampMs(session) ?? 0) >= recentCutoff;
  if (session.userStatus === 'done') return recentlyFinished ? 'done' : null;
  if (session.userStatus === 'parked') return null;
  if (session.userStatus === 'review' || recentlyFinished) return 'review';
  return null;
}

function shouldIgnoreFocusModeTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  return !!el?.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"],[data-focus-ignore]');
}

function StatusMetric({
  label,
  value,
  variant = 'muted',
}: {
  label: string;
  value: number;
  variant?: StripBadgeVariant;
}) {
  return (
    <Badge variant={variant} className="h-6 gap-1.5 px-2.5">
      <span className="text-[11px]">{label}</span>
      <span className="font-mono text-[11px] tabular-nums">{value}</span>
    </Badge>
  );
}

function WorkspaceStatusStrip({
  state,
  locale,
  summary,
}: {
  state: AppState | null;
  locale: string;
  summary: WorkspaceStatusSummary;
}) {
  const isZh = locale === 'zh-CN';
  const botOnline = !!state?.bot?.connected;
  const hasRunning = summary.activeTasks > 0 || summary.runningSessions > 0;
  const hasAttention = summary.pendingReviewSessions > 0 || summary.incompleteSessions > 0;
  const statusTone = !state
    ? 'idle'
    : hasRunning
      ? 'ok'
      : hasAttention
        ? 'warn'
        : 'idle';
  const statusLabel = !state
    ? (isZh ? '加载中' : 'Loading')
    : hasRunning
      ? (isZh ? '运行中' : 'Running')
      : hasAttention
        ? (isZh ? '待查看' : 'Needs review')
        : botOnline
          ? (isZh ? '空闲' : 'Idle')
          : (isZh ? '离线' : 'Offline');
  const secondary = [
    `${isZh ? '工作区' : 'Workspaces'} ${summary.workspaceCount}`,
    `${isZh ? '会话' : 'Sessions'} ${summary.totalSessions}`,
    `${isZh ? '接入' : 'Channels'} ${summary.readyChannels}/${summary.configuredChannels}`,
    summary.loadingWorkspaces > 0 ? `${isZh ? '加载中' : 'Loading'} ${summary.loadingWorkspaces}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mb-3 shrink-0 overflow-hidden rounded-xl border border-edge bg-panel/70 px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[150px] items-center gap-2">
          <Dot variant={statusTone} pulse={hasRunning} />
          <span className="text-[12px] font-semibold text-fg">{isZh ? '工作台状态' : 'Workspace'}</span>
          <Badge variant={statusTone === 'ok' ? 'ok' : statusTone === 'warn' ? 'warn' : 'muted'}>
            {statusLabel}
          </Badge>
        </div>
        <StatusMetric label={isZh ? '任务' : 'Tasks'} value={summary.activeTasks} variant={summary.activeTasks > 0 ? 'ok' : 'muted'} />
        <StatusMetric label={isZh ? '运行中' : 'Running'} value={summary.runningSessions} variant={summary.runningSessions > 0 ? 'ok' : 'muted'} />
        <StatusMetric label={isZh ? '待查看' : 'To review'} value={summary.pendingReviewSessions} variant={summary.pendingReviewSessions > 0 ? 'warn' : 'muted'} />
        <StatusMetric label={isZh ? '需处理' : 'Incomplete'} value={summary.incompleteSessions} variant={summary.incompleteSessions > 0 ? 'warn' : 'muted'} />
        <StatusMetric label={isZh ? '近24h完成' : 'Done 24h'} value={summary.completedSessions} variant={summary.completedSessions > 0 ? 'accent' : 'muted'} />
        <StatusMetric label={isZh ? '窗口' : 'Windows'} value={summary.openWindows} variant={summary.openWindows > 0 ? 'accent' : 'muted'} />
        <div className="ml-auto min-w-[180px] truncate text-right text-[11px] text-fg-4" title={secondary}>
          {secondary}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Main Three-Column Layout
   ══════════════════════════════════════════════════════ */
export const SessionWorkspace = memo(function SessionWorkspace({
  active = true,
  mode = 'workspace',
}: {
  active?: boolean;
  mode?: SessionWorkspaceMode;
}) {
  // Granular selectors — keep high-churn store slices out of this workspace.
  // `appState` is used only for the compact workspace status strip.
  const locale = useStore(s => s.locale);
  const appState = useStore(s => s.state);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? null);
  const toastSession = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [sessionsMap, setSessionsMap] = useState<Record<string, SessionInfo[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [sidebarLoading, setSidebarLoading] = useState(true);
  // Multi-session window state. mountKey stays stable across session promotion
  // (pending→native) so React keeps the panel mounted instead of remounting and
  // losing stream/input state.
  const [openSessions, setOpenSessionsRaw] = useState<SessionSlot[]>(readStoredOpenSessions);
  const [activeSlotIndex, setActiveSlotIndexRaw] = useState(readStoredActiveSlot);
  const [liveSessionStates, setLiveSessionStates] = useState<Record<string, LiveSessionState>>({});
  const openSessionsRef = useRef(openSessions);
  openSessionsRef.current = openSessions;
  const sessionsMapRef = useRef(sessionsMap);
  sessionsMapRef.current = sessionsMap;
  const liveSessionStatesRef = useRef(liveSessionStates);
  liveSessionStatesRef.current = liveSessionStates;

  // Persist wrappers — localStorage survives dashboard/app restarts; sessionStorage
  // mirrors it as a same-tab fallback and migrates old pre-localStorage state.
  const setOpenSessions = useCallback((updater: SessionSlot[] | ((prev: SessionSlot[]) => SessionSlot[])) => {
    setOpenSessionsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const setActiveSlotIndex = useCallback((updater: number | ((prev: number) => number)) => {
    setActiveSlotIndexRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(ACTIVE_SLOT_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Floating file-tree panel — at most one open at a time
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [filePanelRequest, setFilePanelRequest] = useState<FilePanelRequest | null>(null);
  const filePanelRequestSeqRef = useRef(0);

  // Refs so setSelectedSession stays stable and all callers see current values
  const activeSlotRef = useRef(activeSlotIndex);
  activeSlotRef.current = activeSlotIndex;

  // Compat shim: selectedSession points to the active slot
  const selectedSession = openSessions[activeSlotIndex] ?? null;
  const setSelectedSession = useCallback((next: SessionSlot | null) => {
    if (!next) {
      setOpenSessions([]);
      setActiveSlotIndex(0);
      return;
    }
    const withKey = next.mountKey ? next : { ...next, mountKey: nextMountKey() };
    setOpenSessions(prev => {
      const existingIdx = prev.findIndex(s => s.agent === withKey.agent && s.sessionId === withKey.sessionId);
      if (existingIdx >= 0) {
        // Already open — just activate
        setActiveSlotIndex(existingIdx);
        return prev;
      }
      const newList = [...prev, withKey];
      setActiveSlotIndex(newList.length - 1);
      return newList;
    });
  }, []);

  const handleOpenFileLink = useCallback((slotIdx: number, workdir: string, target: FileLinkTarget) => {
    setActiveSlotIndex(slotIdx);
    setFilePanelRequest({
      workdir,
      path: target.path,
      line: target.line,
      nonce: ++filePanelRequestSeqRef.current,
    });
    setFileTreeOpen(true);
  }, [setActiveSlotIndex]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showNewSession, setShowNewSessionRaw] = useState<string | null>(readStoredNewSessionWorkdir);
  const setShowNewSession = useCallback((updater: string | null | ((prev: string | null) => string | null)) => {
    setShowNewSessionRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(NEW_SESSION_STORAGE_KEY, next);
      return next;
    });
  }, []);
  const [draggingWorkspacePath, setDraggingWorkspacePath] = useState<string | null>(null);
  const [dragOverWorkspacePath, setDragOverWorkspacePath] = useState<string | null>(null);
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceRenameTarget | null>(null);
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('');
  const [renamingWorkspace, setRenamingWorkspace] = useState(false);
  const [search, setSearch] = useState('');
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>('all');
  const [dashboardFocusedSlot, setDashboardFocusedSlot] = useState<SessionSlot | null>(null);
  const [dashboardCreateTaskWorkdir, setDashboardCreateTaskWorkdir] = useState<string | null>(null);
  const [dashboardPendingPrompt, setDashboardPendingPrompt] = useState<string | null>(null);
  const [dashboardPendingImageUrls, setDashboardPendingImageUrls] = useState<string[]>([]);
  const [dashboardPendingCreatedAt, setDashboardPendingCreatedAt] = useState<string | null>(null);
  const [createTaskPickerOpen, setCreateTaskPickerOpen] = useState(false);
  const [createTaskWorkdir, setCreateTaskWorkdir] = useState('');
  const deferredSearch = useDeferredValue(search);
  const initializedRef = useRef(false);
  const inflightLoadsRef = useRef<Record<string, boolean>>({});
  const autoPrefetchedSessionsRef = useRef<Set<string>>(new Set());
  const hoverPrefetchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (showNewSession) return;
    setActiveSlotIndex(prev => {
      const maxIndex = Math.max(0, openSessions.length - 1);
      return prev > maxIndex ? maxIndex : prev;
    });
  }, [openSessions.length, showNewSession, setActiveSlotIndex]);

  useEffect(() => () => {
    for (const timer of Object.values(hoverPrefetchTimersRef.current)) {
      clearTimeout(timer);
    }
  }, []);

  /* ── Load workspaces (API already includes runtimeWorkdir) ── */
  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await api.getWorkspaces();
      const list = res.ok ? res.workspaces : [];
      if (list.length) {
        // Preserve previous reference when content is unchanged so the
        // `workspaces` dep of downstream effects doesn't fire on benign
        // refetches (StrictMode double-mount, focus refresh, etc.).
        setWorkspaces(prev => (
          prev.length === list.length
          && prev.every((p, i) => p.path === list[i].path && p.name === list[i].name)
            ? prev
            : list
        ));
      }
      initializedRef.current = true;
    } catch {
      initializedRef.current = true;
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  /* ── Load sessions for a workspace ── */
  const loadSessionsForWorkspace = useCallback(async (
    wsPath: string,
    opts: { background?: boolean; force?: boolean } = {},
  ) => {
    if (inflightLoadsRef.current[wsPath]) return;
    inflightLoadsRef.current[wsPath] = true;
    if (!opts.background) {
      setLoadingMap(prev => ({ ...prev, [wsPath]: true }));
    }
    try {
      const res = await loadWorkspaceSessions(wsPath, { force: opts.force });
      startTransition(() => {
        setSessionsMap(prev => {
          const incoming = res.sessions || [];
          const existing = prev[wsPath] || [];
          // Preserve optimistic stubs not yet present in API response
          const incomingIds = new Set(incoming.map(s => sKey(s.agent || '', s.sessionId)));
          const stubs = existing.filter(s => {
            if (s.runState !== 'running') return false;
            const key = sKey(s.agent || '', s.sessionId);
            if (incomingIds.has(key)) return false;
            const live = liveSessionStatesRef.current[key];
            return !(live?.resolvedKey && live.resolvedKey !== key);
          });
          return { ...prev, [wsPath]: stubs.length ? [...stubs, ...incoming] : incoming };
        });
      });
    } catch {
      if (!opts.background) {
        startTransition(() => {
          setSessionsMap(prev => ({ ...prev, [wsPath]: [] }));
        });
      }
    } finally {
      inflightLoadsRef.current[wsPath] = false;
      if (!opts.background) {
        setLoadingMap(prev => ({ ...prev, [wsPath]: false }));
      }
    }
  }, []);

  // Re-fetch workspace list + sessions when the active workdir changes (e.g. user switches directory)
  const runtimeWorkdirRef = useRef(runtimeWorkdir);
  useEffect(() => {
    if (runtimeWorkdir === runtimeWorkdirRef.current) return;
    runtimeWorkdirRef.current = runtimeWorkdir;
    if (!runtimeWorkdir || !initializedRef.current) return;
    loadWorkspaces().then(() => {
      void loadSessionsForWorkspace(runtimeWorkdir, { force: true });
    });
  }, [runtimeWorkdir, loadWorkspaces, loadSessionsForWorkspace]);

  const warmSession = useCallback((session: SessionInfo, workdir: string) => {
    const agent = session.agent || '';
    if (!agent || !session.sessionId) return;
    void preloadSessionPanel();
    prefetchSessionMessages({
      workdir,
      agent,
      sessionId: session.sessionId,
      rich: true,
      turnOffset: 0,
      turnLimit: SESSION_PREFETCH_TURNS,
    });
  }, []);

  const scheduleSessionWarmup = useCallback((session: SessionInfo, workdir: string, delayMs = HOVER_PREFETCH_DELAY_MS) => {
    const key = `${workdir}:${sKey(session.agent || '', session.sessionId)}`;
    const existing = hoverPrefetchTimersRef.current[key];
    if (existing) clearTimeout(existing);
    hoverPrefetchTimersRef.current[key] = setTimeout(() => {
      delete hoverPrefetchTimersRef.current[key];
      warmSession(session, workdir);
    }, delayMs);
  }, [warmSession]);

  const cancelScheduledWarmup = useCallback((session: SessionInfo, workdir: string) => {
    const key = `${workdir}:${sKey(session.agent || '', session.sessionId)}`;
    const existing = hoverPrefetchTimersRef.current[key];
    if (!existing) return;
    clearTimeout(existing);
    delete hoverPrefetchTimersRef.current[key];
  }, []);

  useEffect(() => {
    if (active) void preloadSessionPanel();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    workspaces.forEach((ws, index) => {
      if (sessionsMap[ws.path] || loadingMap[ws.path]) return;
      const timer = setTimeout(() => {
        void loadSessionsForWorkspace(ws.path);
      }, index * 90);
      timers.push(timer);
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [active, loadSessionsForWorkspace, loadingMap, sessionsMap, workspaces]);

  // SSE-driven: refresh session list when server signals a change (targeted by session key).
  // Debounce per-workspace to avoid redundant API calls on rapid phase transitions
  // (e.g. null → queued → streaming within 100ms).
  const sessionsChangedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useDashboardEvent(
    active && initializedRef.current && workspaces.length > 0 ? 'sessions-changed' : null,
    useCallback((event) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const eventKey = event.key;
      // Find workspace(s) that contain this session, or refresh all if unknown
      const targets = eventKey
        ? workspaces.filter(ws => (sessionsMapRef.current[ws.path] || []).some(s => sKey(s.agent || '', s.sessionId) === eventKey))
        : workspaces;
      // If the session isn't in any known workspace yet (new session), refresh all
      const toRefresh = targets.length ? targets : workspaces;
      const timers = sessionsChangedTimers.current;
      for (const ws of toRefresh) {
        if (timers.has(ws.path)) clearTimeout(timers.get(ws.path)!);
        timers.set(ws.path, setTimeout(() => {
          timers.delete(ws.path);
          void loadSessionsForWorkspace(ws.path, { background: true, force: true });
        }, 300));
      }
    }, [workspaces, loadSessionsForWorkspace]),
  );

  const hydrateSession = useCallback((session: SessionInfo): SessionInfo => {
    const agent = session.agent || '';
    if (!agent || !session.sessionId) return session;
    return applyLiveSessionState(session, liveSessionStates[sKey(agent, session.sessionId)] || null);
  }, [liveSessionStates]);

  useDashboardEvent(
    'stream-update',
    useCallback((event) => {
      const key = event.key;
      if (!key) return;
      setLiveSessionStates(prev => {
        const next: Record<string, LiveSessionState> = {};
        const cutoff = Date.now() - LIVE_SESSION_STATE_MAX_AGE_MS;
        for (const [entryKey, entry] of Object.entries(prev)) {
          if (entry.updatedAt >= cutoff) next[entryKey] = entry;
        }

        const live = normalizeLiveSessionState(key, event.snapshot ?? null);
        if (!live) {
          // Stream ended (null snapshot).  Don't delete the entry — keep it as
          // phase 'done' so the sidebar doesn't flash back to the stale
          // sessionsMap 'running' state before the sessions-changed API
          // refresh completes.  The 15-min TTL handles eventual cleanup.
          const prev = next[key];
          if (prev && prev.phase !== 'done') {
            next[key] = { ...prev, phase: 'done', updatedAt: Date.now() };
          }
          return next;
        }

        next[key] = live;
        if (live.resolvedKey !== key) {
          next[live.resolvedKey] = { ...live, key: live.resolvedKey };
        }
        return next;
      });
    }, []),
  );

  // Refresh all workspaces after WS reconnect (covers missed events)
  useDashboardReconnect(useCallback(() => {
    if (!active || !initializedRef.current || workspaces.length === 0) return;
    for (const ws of workspaces) {
      void loadSessionsForWorkspace(ws.path, { background: true, force: true });
    }
  }, [active, workspaces, loadSessionsForWorkspace]));

  useEffect(() => {
    if (!active || !initializedRef.current || workspaces.length === 0) return;

    const refreshVisibleWorkspaces = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      for (const ws of workspaces) {
        void loadSessionsForWorkspace(ws.path, { background: true, force: true });
      }
    };

    refreshVisibleWorkspaces();

    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refreshVisibleWorkspaces();
    };

    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    return () => {
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, [active, loadSessionsForWorkspace, workspaces]);

  useEffect(() => {
    if (!active) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    workspaces.forEach((ws, index) => {
      const candidate = (sessionsMap[ws.path] || [])[0];
      if (!candidate) return;
      const key = `${ws.path}:${sKey(candidate.agent || '', candidate.sessionId)}`;
      if (autoPrefetchedSessionsRef.current.has(key)) return;
      const timer = setTimeout(() => {
        autoPrefetchedSessionsRef.current.add(key);
        warmSession(candidate, ws.path);
      }, AUTO_PREFETCH_DELAY_MS + index * 120);
      timers.push(timer);
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [active, sessionsMap, warmSession, workspaces]);

  /* ── Add / remove workspace — stable callbacks ── */
  const handleAddWorkspace = useCallback(async (wsPath: string) => {
    try {
      const res = await api.addWorkspace(wsPath);
      if (res.ok) { setShowAddDialog(false); await loadWorkspaces(); loadSessionsForWorkspace(wsPath); }
    } catch {}
  }, [loadWorkspaces, loadSessionsForWorkspace]);

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [extensionsWorkdir, setExtensionsWorkdir] = useState<string | null>(null);

  const handleRemoveWorkspace = useCallback((wsPath: string) => {
    setConfirmRemove(wsPath);
  }, []);

  const openRenameWorkspaceModal = useCallback((workspace: WorkspaceEntry) => {
    const originalName = workspaceBaseName(workspace.path);
    setRenameWorkspaceTarget({ path: workspace.path, name: workspace.name || originalName, originalName });
    setRenameWorkspaceName(workspace.name || originalName);
  }, []);

  const executeRenameWorkspace = useCallback(async () => {
    const target = renameWorkspaceTarget;
    if (!target) return;
    const nextName = renameWorkspaceName.trim() || target.originalName;
    setRenamingWorkspace(true);
    try {
      const res = await api.updateWorkspace(target.path, { name: nextName });
      if (!res.ok || !res.workspace) {
        toastSession(res.error || t('hub.renameWorkspaceFailed'), false);
        return;
      }
      setWorkspaces(prev => prev.map(ws => (
        ws.path === target.path ? { ...ws, name: res.workspace?.name || nextName } : ws
      )));
      setRenameWorkspaceTarget(null);
      void loadWorkspaces();
    } catch (err: any) {
      toastSession(err?.message || t('hub.renameWorkspaceFailed'), false);
    } finally {
      setRenamingWorkspace(false);
    }
  }, [loadWorkspaces, renameWorkspaceName, renameWorkspaceTarget, t, toastSession]);

  const handleWorkspaceDragStart = useCallback((wsPath: string, event: ReactDragEvent<HTMLElement>) => {
    setDraggingWorkspacePath(wsPath);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/pikiclaw-workspace-path', wsPath);
    event.dataTransfer.setData('text/plain', wsPath);
  }, []);

  const handleWorkspaceDragOver = useCallback((wsPath: string, event: ReactDragEvent<HTMLElement>) => {
    if (!draggingWorkspacePath || draggingWorkspacePath === wsPath) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverWorkspacePath(wsPath);
  }, [draggingWorkspacePath]);

  const handleWorkspaceDragLeave = useCallback((wsPath: string) => {
    setDragOverWorkspacePath(prev => (prev === wsPath ? null : prev));
  }, []);

  const handleWorkspaceDragEnd = useCallback(() => {
    setDraggingWorkspacePath(null);
    setDragOverWorkspacePath(null);
  }, []);

  const handleWorkspaceDrop = useCallback((targetPath: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourcePath = draggingWorkspacePath
      || event.dataTransfer.getData('text/pikiclaw-workspace-path')
      || event.dataTransfer.getData('text/plain');
    handleWorkspaceDragEnd();
    if (!sourcePath || sourcePath === targetPath) return;

    const sourceIdx = workspaces.findIndex(ws => ws.path === sourcePath);
    const targetIdx = workspaces.findIndex(ws => ws.path === targetPath);
    if (sourceIdx < 0 || targetIdx < 0) return;

    const next = [...workspaces];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    setWorkspaces(next);

    void api.reorderWorkspaces(next.map(ws => ws.path)).then(res => {
      if (!res.ok) {
        toastSession(res.error || t('hub.reorderWorkspaceFailed'), false);
        void loadWorkspaces();
      }
    }).catch((err: any) => {
      toastSession(err?.message || t('hub.reorderWorkspaceFailed'), false);
      void loadWorkspaces();
    });
  }, [draggingWorkspacePath, handleWorkspaceDragEnd, loadWorkspaces, t, toastSession, workspaces]);

  const executeRemoveWorkspace = useCallback(async () => {
    const wsPath = confirmRemove;
    if (!wsPath) return;
    setRemoving(true);
    try {
      await api.removeWorkspace(wsPath);
      setWorkspaces(prev => prev.filter(w => w.path !== wsPath));
      setSessionsMap(prev => { const n = { ...prev }; delete n[wsPath]; return n; });
      setOpenSessions(prev => prev.filter(s => s.workdir !== wsPath));
      setShowNewSession(prev => (prev === wsPath ? null : prev));
      setActiveSlotIndex(0);
      setConfirmRemove(null);
    } catch {}
    finally { setRemoving(false); }
  }, [confirmRemove, setShowNewSession]);

  const handleRefreshWorkspace = useCallback((wsPath: string) => {
    void loadSessionsForWorkspace(wsPath, { force: true });
  }, [loadSessionsForWorkspace]);

  /* ── Delete single session ─────────────────────────────── */
  type SessionActionTarget = {
    workdir: string;
    agent: string;
    sessionId: string;
    title: string;
  };
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<SessionActionTarget | null>(null);
  const [deleteSessionPurgeNative, setDeleteSessionPurgeNative] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [renameSessionTarget, setRenameSessionTarget] = useState<SessionActionTarget | null>(null);
  const [renameSessionTitle, setRenameSessionTitle] = useState('');
  const [renamingSession, setRenamingSession] = useState(false);

  /* ── Session row actions popover (anchored to kebab button) ─── */
  const [sessionMenu, setSessionMenu] = useState<{
    /** Bottom-right corner of the kebab — menu's right edge aligns to anchor.right. */
    anchor: { right: number; bottom: number };
    target: SessionActionTarget;
  } | null>(null);

  const handleSessionMenuOpen = useCallback((anchor: DOMRect, session: SessionInfo, wsPath: string) => {
    setSessionMenu({
      anchor: { right: anchor.right, bottom: anchor.bottom },
      target: {
        workdir: wsPath,
        agent: session.agent || '',
        sessionId: session.sessionId,
        title: sessionListDisplayText(session).slice(0, 120) || session.sessionId.slice(0, 16),
      },
    });
  }, []);

  // Close popover on outside click, scroll, resize, or Escape.
  useEffect(() => {
    if (!sessionMenu) return;
    const close = () => setSessionMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [sessionMenu]);

  const openRenameSessionModal = useCallback((target: SessionActionTarget) => {
    setRenameSessionTitle(target.title);
    setRenameSessionTarget(target);
    setSessionMenu(null);
  }, []);

  const openDeleteSessionModal = useCallback((target: SessionActionTarget) => {
    setDeleteSessionPurgeNative(false);
    setConfirmDeleteSession(target);
    setSessionMenu(null);
  }, []);

  const executeRenameSession = useCallback(async () => {
    const target = renameSessionTarget;
    if (!target) return;
    setRenamingSession(true);
    try {
      const title = renameSessionTitle.trim();
      const res = await api.updateSessionTitle(target.workdir, target.agent, target.sessionId, title || null);
      if (!res.ok || !res.updated) {
        toastSession(res.error || t('session.renameFailed'), false);
        return;
      }
      setSessionsMap(prev => {
        const list = prev[target.workdir];
        if (!list) return prev;
        return {
          ...prev,
          [target.workdir]: list.map(s => (
            s.agent === target.agent && s.sessionId === target.sessionId ? { ...s, title: title || undefined } : s
          )),
        };
      });
      setRenameSessionTarget(null);
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('session.renameFailed'), false);
    } finally {
      setRenamingSession(false);
    }
  }, [loadSessionsForWorkspace, renameSessionTarget, renameSessionTitle, t, toastSession]);

  const executeDeleteSession = useCallback(async () => {
    const target = confirmDeleteSession;
    if (!target) return;
    setDeletingSession(true);
    try {
      const res = await api.deleteSession(target.workdir, target.agent, target.sessionId, deleteSessionPurgeNative);
      if (!res.ok) {
        const msg = res.error?.includes('still running') ? t('session.deleteRunningError') : (res.error || t('session.deleteFailed'));
        toastSession(msg, false);
        return;
      }
      // Drop from the workspace's session list and any open slots.
      setSessionsMap(prev => {
        const list = prev[target.workdir];
        if (!list) return prev;
        const filtered = list.filter(s => !(s.agent === target.agent && s.sessionId === target.sessionId));
        if (filtered.length === list.length) return prev;
        return { ...prev, [target.workdir]: filtered };
      });
      setOpenSessions(prev => prev.filter(s => !(s.workdir === target.workdir && s.agent === target.agent && s.sessionId === target.sessionId)));
      setConfirmDeleteSession(null);
    } catch (err: any) {
      toastSession(err?.message || t('session.deleteFailed'), false);
    } finally {
      setDeletingSession(false);
    }
  }, [confirmDeleteSession, deleteSessionPurgeNative, t, toastSession]);

  /* ── New session — transition after InputComposer creates it ── */
  const [newSessionPendingPrompt, setNewSessionPendingPrompt] = useState<string | null>(null);
  const [newSessionPendingImageUrls, setNewSessionPendingImageUrls] = useState<string[]>([]);
  const [newSessionPendingCreatedAt, setNewSessionPendingCreatedAt] = useState<string | null>(null);

  const handleNewSessionCreated = useCallback((next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    const createdAt = pendingCreatedAt || new Date().toISOString();
    setSessionsMap(prev => {
      const existing = prev[next.workdir] || [];
      const alreadyPresent = existing.some(s => s.sessionId === next.sessionId && s.agent === next.agent);
      if (alreadyPresent) return prev;
      const stub: SessionInfo = {
        sessionId: next.sessionId,
        agent: next.agent,
        runState: 'running',
        lastQuestion: pendingPrompt,
        createdAt,
        runUpdatedAt: createdAt,
      };
      return { ...prev, [next.workdir]: [stub, ...existing] };
    });
    const slot: SessionSlot = { ...next, mountKey: nextMountKey() };
    // CRITICAL: setNewSessionPending* MUST be inside startTransition so they commit
    // atomically with the slot/active changes. If set outside, the "pending" render still
    // shows the OLD active panel which would consume the prompt before the new panel mounts.
    startTransition(() => {
      setNewSessionPendingPrompt(pendingPrompt || null);
      setNewSessionPendingImageUrls(pendingImageUrls && pendingImageUrls.length ? pendingImageUrls : []);
      setNewSessionPendingCreatedAt(createdAt);
      setShowNewSession(null);
      setOpenSessions(prev => {
        const existingIdx = prev.findIndex(s => s.workdir === slot.workdir && s.agent === slot.agent && s.sessionId === slot.sessionId);
        if (existingIdx >= 0) {
          setActiveSlotIndex(existingIdx);
          return prev;
        }
        const updated = [...prev, slot];
        setActiveSlotIndex(updated.length - 1);
        return updated;
      });
    });
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, warmSession]);

  const handleNewSessionRequest = useCallback((wsPath: string) => {
    setShowNewSession(wsPath);
    setActiveSlotIndex(openSessionsRef.current.length);
  }, []);

  /* ── Select session — stable callback that takes wsPath ── */
  const handleSelectSession = useCallback((session: SessionInfo, workdir: string) => {
    warmSession(session, workdir);
    setShowNewSession(null);
    startTransition(() => {
      setSelectedSession({ agent: session.agent || '', sessionId: session.sessionId, workdir });
    });
  }, [warmSession]);

  const handlePanelSessionChange = useCallback((next: { agent: string; sessionId: string; workdir: string }, fromSlotIdx?: number) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    startTransition(() => {
      if (fromSlotIdx != null) {
        // Session promotion: update sessionId but preserve mountKey so the
        // panel stays mounted and doesn't lose streaming state.
        setOpenSessions(prev => {
          if (fromSlotIdx >= prev.length) return prev;
          const updated = [...prev];
          updated[fromSlotIdx] = { ...prev[fromSlotIdx], agent: next.agent, sessionId: next.sessionId, workdir: next.workdir };
          return updated;
        });
        // Background panels can promote pending sessions or receive stream
        // completion updates while the user is typing in another slot. Keep
        // the current active slot stable so those background updates do not
        // steal focus from the active composer.
        if (activeSlotRef.current === fromSlotIdx) setActiveSlotIndex(fromSlotIdx);
      } else {
        setSelectedSession({ ...next, mountKey: nextMountKey() });
      }
    });
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, warmSession]);

  /* ── Filter sessions — memoized per workspace to avoid new-array-on-every-render ── */
  const filterFn = useCallback((sessions: SessionInfo[]): SessionInfo[] => {
    let result = sessions;
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      result = result.filter(s =>
        (s.lastMessageText || '').toLowerCase().includes(q)
        || (s.lastQuestion || '').toLowerCase().includes(q)
        || (s.lastAnswer || '').toLowerCase().includes(q)
        || (s.title || '').toLowerCase().includes(q)
        || (s.agent || '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [deferredSearch]);

  const filteredByWs = useMemo(() => {
    const out: Record<string, SessionInfo[]> = {};
    for (const ws of workspaces) {
      const all = (sessionsMap[ws.path] || []).map(hydrateSession);
      // Collapse pending stubs onto their resolved (native) entry: when a new
      // session is created, the optimistic stub holds a `pending_xxx` ID while
      // the API returns the real native ID after promotion. liveSessionStates
      // links them via resolvedKey; without this dedup, both render until the
      // next API refresh.
      const byCanonical = new Map<string, SessionInfo>();
      for (const s of all) {
        const key = sKey(s.agent || '', s.sessionId);
        const live = liveSessionStates[key];
        const canonical = live?.resolvedKey && live.resolvedKey !== key ? live.resolvedKey : key;
        const prev = byCanonical.get(canonical);
        if (!prev) {
          byCanonical.set(canonical, s);
          continue;
        }
        // Prefer the entry whose own key matches canonical (the real session over a pending stub).
        const prevKey = sKey(prev.agent || '', prev.sessionId);
        if (prevKey !== canonical && key === canonical) byCanonical.set(canonical, s);
      }
      const filtered = filterFn([...byCanonical.values()]);
      // Group fork descendants under their parents: render parent first, then
      // its fork children (recursively) right after, with `forkDepth` for the
      // sidebar to render an indent. This relies on `migratedFrom.kind === 'fork'`
      // — sessions without that link stay in their natural sort order.
      out[ws.path] = groupForkDescendants(filtered);
    }
    return out;
  }, [workspaces, sessionsMap, liveSessionStates, filterFn, hydrateSession]);

  /* ── Derived: resolve SessionInfo for each open slot ── */
  const resolveSlotInfo = useCallback((slot: SessionSlot): SessionInfo => {
    const resolved = (sessionsMap[slot.workdir] || []).find(
      s => s.sessionId === slot.sessionId && s.agent === slot.agent,
    ) ?? {
      sessionId: slot.sessionId,
      agent: slot.agent,
      runState: 'running' as const,
    };
    return hydrateSession(resolved);
  }, [hydrateSession, sessionsMap]);

  // All open session keys for sidebar highlight
  const openSessionKeys = useMemo(() => new Set(openSessions.map(s => sKey(s.agent, s.sessionId))), [openSessions]);
  const selectedKey = selectedSession ? sKey(selectedSession.agent, selectedSession.sessionId) : null;
  const [focusedSlotIndex, setFocusedSlotIndex] = useState<number | null>(null);
  const workspaceStatusSummary = useMemo<WorkspaceStatusSummary>(() => {
    const sessionsByKey = new Map<string, { session: SessionInfo; workdir: string }>();
    for (const ws of workspaces) {
      for (const rawSession of sessionsMap[ws.path] || []) {
        const session = hydrateSession(rawSession);
        const key = sKey(session.agent || '', session.sessionId);
        if (!session.agent || !session.sessionId) continue;
        const live = liveSessionStates[key];
        const canonical = live?.resolvedKey && live.resolvedKey !== key ? live.resolvedKey : key;
        const mapKey = `${ws.path}:${canonical}`;
        const prev = sessionsByKey.get(mapKey);
        if (!prev) {
          sessionsByKey.set(mapKey, { session, workdir: ws.path });
          continue;
        }

        const prevKey = sKey(prev.session.agent || '', prev.session.sessionId);
        if (prevKey !== canonical && key === canonical) {
          sessionsByKey.set(mapKey, { session, workdir: ws.path });
        }
      }
    }

    const openExactKeys = new Set(openSessions.map(slot => `${slot.workdir}:${slot.agent}:${slot.sessionId}`));
    const recentCutoff = Date.now() - STATUS_SUMMARY_RECENT_MS;
    let runningSessions = 0;
    let completedSessions = 0;
    let incompleteSessions = 0;
    let pendingReviewSessions = 0;
    for (const { session, workdir } of sessionsByKey.values()) {
      const displayState = sessionDisplayState(session);
      if (displayState === 'running') runningSessions += 1;
      else if (displayState === 'incomplete') incompleteSessions += 1;
      else if ((statusTimestampMs(session) ?? 0) >= recentCutoff) completedSessions += 1;

      const openKey = `${workdir}:${session.agent || ''}:${session.sessionId || ''}`;
      const userHandled = session.userStatus === 'done' || session.userStatus === 'parked';
      const recentlyFinished = (statusTimestampMs(session) ?? 0) >= recentCutoff;
      if (displayState !== 'running' && recentlyFinished && !openExactKeys.has(openKey) && !userHandled) {
        pendingReviewSessions += 1;
      }
    }

    const channels = appState?.setupState?.channels || [];
    const configuredChannels = channels.filter(channel => channel.configured || channel.ready).length;
    const readyChannels = channels.filter(channel => channel.ready).length;

    return {
      runningSessions,
      completedSessions,
      pendingReviewSessions,
      incompleteSessions,
      openWindows: openSessions.length + (showNewSession ? 1 : 0),
      totalSessions: sessionsByKey.size,
      workspaceCount: workspaces.length,
      loadingWorkspaces: workspaces.filter(ws => loadingMap[ws.path] || !(ws.path in sessionsMap)).length,
      activeTasks: appState?.bot?.activeTasks ?? 0,
      readyChannels,
      configuredChannels,
    };
  }, [appState, hydrateSession, liveSessionStates, loadingMap, openSessions, sessionsMap, showNewSession, workspaces]);
  useEffect(() => {
    if (dashboardScope !== 'all' && !workspaces.some(ws => ws.path === dashboardScope)) {
      setDashboardScope('all');
    }
    const preferred = dashboardScope !== 'all'
      ? dashboardScope
      : runtimeWorkdir || workspaces[0]?.path || '';
    setCreateTaskWorkdir(prev => (
      prev && workspaces.some(ws => ws.path === prev) ? prev : preferred
    ));
  }, [dashboardScope, runtimeWorkdir, workspaces]);

  const dashboardItems = useMemo<DashboardSessionItem[]>(() => {
    const scopedWorkspaces = dashboardScope === 'all'
      ? workspaces
      : workspaces.filter(ws => ws.path === dashboardScope);
    const recentCutoff = Date.now() - STATUS_SUMMARY_RECENT_MS;
    const items: DashboardSessionItem[] = [];
    const seen = new Set<string>();

    for (const ws of scopedWorkspaces) {
      for (const rawSession of sessionsMap[ws.path] || []) {
        const session = hydrateSession(rawSession);
        if (!session.agent || !session.sessionId) continue;
        const key = sKey(session.agent, session.sessionId);
        const live = liveSessionStates[key] || null;
        const canonical = live?.resolvedKey && live.resolvedKey !== key ? live.resolvedKey : key;
        const mapKey = `${ws.path}:${canonical}`;
        if (seen.has(mapKey)) continue;
        seen.add(mapKey);

        const column = dashboardColumnForSession(session, live, recentCutoff);
        if (!column) continue;
        items.push({
          key: mapKey,
          session,
          workdir: ws.path,
          workspaceName: ws.name || workspaceBaseName(ws.path),
          column,
          live,
        });
      }
    }

    return items.sort((a, b) => (statusTimestampMs(b.session) || 0) - (statusTimestampMs(a.session) || 0));
  }, [dashboardScope, hydrateSession, liveSessionStates, sessionsMap, workspaces]);

  const dashboardCounts = useMemo(() => {
    const counts: Record<DashboardColumnKey, number> = {
      running: 0,
      pending: 0,
      review: 0,
      incomplete: 0,
      done: 0,
    };
    for (const item of dashboardItems) counts[item.column] += 1;
    return counts;
  }, [dashboardItems]);

  const startDashboardTask = useCallback((workdir: string) => {
    if (!workdir) {
      toastSession(t('dashboard.chooseWorkspace'), false);
      return;
    }
    setCreateTaskPickerOpen(false);
    setDashboardFocusedSlot(null);
    setDashboardCreateTaskWorkdir(workdir);
  }, [t, toastSession]);

  const handleDashboardCreateTask = useCallback(() => {
    if (dashboardScope !== 'all') {
      startDashboardTask(dashboardScope);
      return;
    }
    setCreateTaskPickerOpen(true);
  }, [dashboardScope, startDashboardTask]);

  const handleOpenDashboardSession = useCallback((item: DashboardSessionItem) => {
    const agent = item.session.agent || '';
    if (!agent || !item.session.sessionId) return;
    warmSession(item.session, item.workdir);
    setDashboardFocusedSlot({
      agent,
      sessionId: item.session.sessionId,
      workdir: item.workdir,
      mountKey: nextMountKey(),
    });
  }, [warmSession]);

  const handleMarkDashboardDone = useCallback(async (item: DashboardSessionItem) => {
    const agent = item.session.agent || '';
    if (!agent || !item.session.sessionId) return;
    try {
      const res = await api.updateSessionStatus(item.workdir, agent, item.session.sessionId, 'done');
      if (!res.ok) {
        toastSession(res.error || t('dashboard.markDoneFailed'), false);
        return;
      }
      setSessionsMap(prev => ({
        ...prev,
        [item.workdir]: (prev[item.workdir] || []).map(session => (
          session.agent === agent && session.sessionId === item.session.sessionId
            ? { ...session, userStatus: 'done' }
            : session
        )),
      }));
      void loadSessionsForWorkspace(item.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('dashboard.markDoneFailed'), false);
    }
  }, [loadSessionsForWorkspace, t, toastSession]);

  const closeDashboardFocus = useCallback(() => setDashboardFocusedSlot(null), []);

  const handleDashboardFocusedSessionChange = useCallback((next: { agent: string; sessionId: string; workdir: string }) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    setDashboardFocusedSlot(prev => ({
      agent: next.agent,
      sessionId: next.sessionId,
      workdir: next.workdir,
      mountKey: prev?.mountKey || nextMountKey(),
    }));
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, warmSession]);

  const handleDashboardNewSessionCreated = useCallback((next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    const createdAt = pendingCreatedAt || new Date().toISOString();
    setSessionsMap(prev => {
      const existing = prev[next.workdir] || [];
      const alreadyPresent = existing.some(s => s.sessionId === next.sessionId && s.agent === next.agent);
      if (alreadyPresent) return prev;
      const stub: SessionInfo = {
        sessionId: next.sessionId,
        agent: next.agent,
        runState: 'running',
        lastQuestion: pendingPrompt,
        createdAt,
        runUpdatedAt: createdAt,
      };
      return { ...prev, [next.workdir]: [stub, ...existing] };
    });
    startTransition(() => {
      setDashboardCreateTaskWorkdir(null);
      setDashboardPendingPrompt(pendingPrompt || null);
      setDashboardPendingImageUrls(pendingImageUrls && pendingImageUrls.length ? pendingImageUrls : []);
      setDashboardPendingCreatedAt(createdAt);
      setDashboardFocusedSlot({
        agent: next.agent,
        sessionId: next.sessionId,
        workdir: next.workdir,
        mountKey: nextMountKey(),
      });
    });
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, warmSession]);

  const handleDashboardFocusFileLink = useCallback((workdir: string, target: FileLinkTarget) => {
    setFilePanelRequest({
      workdir,
      path: target.path,
      line: target.line,
      nonce: ++filePanelRequestSeqRef.current,
    });
    setFileTreeOpen(true);
  }, []);

  useEffect(() => {
    if (mode === 'dashboard') return;
    setDashboardFocusedSlot(null);
    setDashboardCreateTaskWorkdir(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'dashboard' || (!dashboardFocusedSlot && !dashboardCreateTaskWorkdir)) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDashboardCreateTaskWorkdir(null);
      setDashboardFocusedSlot(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dashboardCreateTaskWorkdir, dashboardFocusedSlot, mode]);
  const closeFocusMode = useCallback(() => setFocusedSlotIndex(null), []);
  const handleSlotDoubleClick = useCallback((slotIdx: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (shouldIgnoreFocusModeTarget(event.target)) return;
    setActiveSlotIndex(slotIdx);
    setFocusedSlotIndex(slotIdx);
  }, [setActiveSlotIndex]);

  useEffect(() => {
    if (focusedSlotIndex == null) return;
    if (focusedSlotIndex >= openSessions.length) setFocusedSlotIndex(null);
  }, [focusedSlotIndex, openSessions.length]);

  useEffect(() => {
    if (focusedSlotIndex == null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedSlotIndex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedSlotIndex]);
  const [draggingSlotIndex, setDraggingSlotIndex] = useState<number | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);

  /* ── Close a session slot ── */
  const handleCloseSlot = useCallback((index: number) => {
    setFocusedSlotIndex(prev => {
      if (prev == null) return prev;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
    setOpenSessions(prev => {
      const next = prev.filter((_, i) => i !== index);
      // Adjust activeSlotIndex
      if (next.length === 0) {
        setActiveSlotIndex(0);
      } else if (activeSlotRef.current >= next.length) {
        setActiveSlotIndex(next.length - 1);
      }
      return next;
    });
  }, []);

  const handleSlotDragStart = useCallback((index: number, event: ReactDragEvent<HTMLDivElement>) => {
    setDraggingSlotIndex(index);
    setDragOverSlotIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/pikiclaw-slot-index', String(index));
    const slotEl = event.currentTarget.closest('[data-session-slot]') as HTMLElement | null;
    if (slotEl) {
      const rect = slotEl.getBoundingClientRect();
      event.dataTransfer.setDragImage(slotEl, event.clientX - rect.left, event.clientY - rect.top);
    }
  }, []);

  const handleSlotDragOver = useCallback((index: number, event: ReactDragEvent<HTMLDivElement>) => {
    if (draggingSlotIndex == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverSlotIndex(index);
  }, [draggingSlotIndex]);

  const handleSlotDrop = useCallback((index: number, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/pikiclaw-slot-index');
    const from = Number(raw);
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
    if (!Number.isInteger(from) || from === index) return;
    setOpenSessions(prev => {
      if (from < 0 || from >= prev.length) return prev;
      const to = index < prev.length ? index : prev.length - 1;
      if (to < 0 || from === to) return prev;
      const next = [...prev];
      const source = next[from];
      next[from] = next[to];
      next[to] = source;
      const active = activeSlotRef.current;
      if (active === from) setActiveSlotIndex(to);
      else if (active === to) setActiveSlotIndex(from);
      return next;
    });
  }, []);

  const handleSlotDragEnd = useCallback(() => {
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
  }, []);

  const visibleSlotCount = Math.max(1, openSessions.length + (showNewSession ? 1 : 0));
  const gridColumnCount = Math.min(3, visibleSlotCount);
  const gridRowCount = Math.ceil(visibleSlotCount / gridColumnCount);
  const dashboardFocusedInfo = dashboardFocusedSlot ? resolveSlotInfo(dashboardFocusedSlot) : null;

  return (
    <div className="h-full overflow-hidden p-4 flex gap-3 mx-auto">
      {/* ═══ Left Panel — Session Navigator ═══ */}
      <div className="panel-isolated w-[252px] shrink-0 flex flex-col overflow-hidden rounded-xl border border-edge bg-panel backdrop-blur-sm" style={{ boxShadow: 'var(--th-card-shadow)' }}>
        {/* Search */}
        <div className="px-3 py-3">
          <div className="relative group">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-5/40 group-focus-within:text-fg-4 transition-colors">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('hub.search')}
              className="w-full rounded-lg border border-edge/40 bg-inset/50 pl-8 pr-7 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-5/30 focus:border-primary/30 focus:bg-inset focus:shadow-[0_0_0_3px_rgba(99,102,241,0.06)] transition-all duration-200"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-fg-5/30 hover:text-fg-4 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Workspace list */}
        <div className="flex-1 overflow-y-auto">
          {sidebarLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-4 w-4 text-fg-5" />
            </div>
          ) : workspaces.length === 0 && !showAddDialog ? (
            <div className="py-12 text-center text-[13px] text-fg-5">{t('hub.noWorkspaces')}</div>
          ) : (
            workspaces.map(ws => (
              <WorkspaceGroup
                key={ws.path}
                workspace={ws}
                sessions={filteredByWs[ws.path] || []}
                loading={!!loadingMap[ws.path] || !(ws.path in sessionsMap)}
                isActive={ws.path === runtimeWorkdir}
                selectedKey={selectedKey}
                openSessionKeys={openSessionKeys}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSessionRequest}
                onRefresh={handleRefreshWorkspace}
                onRemove={handleRemoveWorkspace}
                onRename={openRenameWorkspaceModal}
                onExtensions={setExtensionsWorkdir}
                onWarmSession={scheduleSessionWarmup}
                onCancelWarmSession={cancelScheduledWarmup}
                onSessionMenuOpen={handleSessionMenuOpen}
                draggingPath={draggingWorkspacePath}
                dragOverPath={dragOverWorkspacePath}
                onWorkspaceDragStart={handleWorkspaceDragStart}
                onWorkspaceDragOver={handleWorkspaceDragOver}
                onWorkspaceDragLeave={handleWorkspaceDragLeave}
                onWorkspaceDrop={handleWorkspaceDrop}
                onWorkspaceDragEnd={handleWorkspaceDragEnd}
                t={t}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-edge/20 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddDialog(v => !v)}
            className="w-full"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('hub.addWorkspace')}
          </Button>
        </div>
      </div>

      {/* ═══ Center Panel — Grid of session slots ═══ */}
      <div
        className="flex-1 min-w-0 flex flex-col overflow-hidden gap-0"
      >
        {mode === 'dashboard' ? (
          <>
            <WorkspaceTaskDashboard
              workspaces={workspaces}
              scope={dashboardScope}
              onScopeChange={setDashboardScope}
              items={dashboardItems}
              counts={dashboardCounts}
              loading={sidebarLoading || workspaceStatusSummary.loadingWorkspaces > 0}
              onCreateTask={handleDashboardCreateTask}
              onOpenSession={handleOpenDashboardSession}
              onMarkDone={handleMarkDashboardDone}
              t={t}
            />
            {dashboardCreateTaskWorkdir && (
              <DashboardCreateTaskModal
                workdir={dashboardCreateTaskWorkdir}
                workspaceName={workspaces.find(ws => ws.path === dashboardCreateTaskWorkdir)?.name || workspaceBaseName(dashboardCreateTaskWorkdir)}
                onClose={() => setDashboardCreateTaskWorkdir(null)}
                onSessionCreated={handleDashboardNewSessionCreated}
                t={t}
              />
            )}
            {dashboardFocusedSlot && dashboardFocusedInfo && (
              <DashboardSessionFocusModal
                slot={dashboardFocusedSlot}
                session={dashboardFocusedInfo}
                workspaceName={workspaces.find(ws => ws.path === dashboardFocusedSlot.workdir)?.name || workspaceBaseName(dashboardFocusedSlot.workdir)}
                active={active}
                onClose={closeDashboardFocus}
                onSessionChange={handleDashboardFocusedSessionChange}
                onOpenFileLink={(target) => handleDashboardFocusFileLink(dashboardFocusedSlot.workdir, target)}
                initialPendingPrompt={dashboardPendingPrompt}
                initialPendingImageUrls={dashboardPendingImageUrls}
                initialPendingCreatedAt={dashboardPendingCreatedAt}
                onPendingPromptConsumed={() => {
                  setDashboardPendingPrompt(null);
                  setDashboardPendingImageUrls([]);
                  setDashboardPendingCreatedAt(null);
                }}
                t={t}
              />
            )}
          </>
        ) : (
          <>
            {focusedSlotIndex != null && (
              <div
                className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
                aria-hidden="true"
                onClick={closeFocusMode}
              />
            )}
            <div
              className="flex-1 min-h-0 grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridRowCount}, minmax(0, 1fr))`,
              }}
            >
              {(() => {
                const newSessionSlot = showNewSession ? openSessions.length : -1;
                return Array.from({ length: visibleSlotCount }, (_, slotIdx) => {
              if (showNewSession && slotIdx === newSessionSlot) {
                return (
                  <div
                    key={`new-${showNewSession}`}
                    className="min-w-0 overflow-hidden rounded-xl border border-edge bg-panel flex flex-col"
                    style={{ boxShadow: 'var(--th-card-shadow)' }}
                    onDragOver={e => handleSlotDragOver(slotIdx, e)}
                    onDrop={e => handleSlotDrop(slotIdx, e)}
                  >
                    <NewSessionView
                      key={showNewSession}
                      workdir={showNewSession}
                      workspaceName={workspaces.find(ws => ws.path === showNewSession)?.name || showNewSession.split('/').pop() || ''}
                      onSessionCreated={handleNewSessionCreated}
                      onClose={() => {
                        setShowNewSession(null);
                        setActiveSlotIndex(prev => (
                          prev >= openSessionsRef.current.length
                            ? Math.max(0, openSessionsRef.current.length - 1)
                            : prev
                        ));
                      }}
                      t={t}
                    />
                  </div>
                );
              }
              const slot = openSessions[slotIdx] ?? null;
              if (!slot) {
                // Empty slot placeholder
                return (
                  <div
                    key={`empty-${slotIdx}`}
                    className={cn(
                      'min-w-0 overflow-hidden rounded-xl border border-dashed bg-panel/30 flex items-center justify-center transition-colors',
                      dragOverSlotIndex === slotIdx ? 'border-primary/50 bg-primary/[0.06]' : 'border-edge/40',
                    )}
                    onDragOver={e => handleSlotDragOver(slotIdx, e)}
                    onDrop={e => handleSlotDrop(slotIdx, e)}
                  >
                    <div className="text-center px-4">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mx-auto text-fg-5/20 mb-2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      <div className="text-[12px] text-fg-5/40">{t('hub.emptySlot')}</div>
                    </div>
                  </div>
                );
              }
              const info = resolveSlotInfo(slot);
              const isActive = slotIdx === activeSlotIndex;
              const isFocused = focusedSlotIndex === slotIdx;
              const slotState = sessionDisplayState(info);
              const slotTitle = info.title || info.lastQuestion?.slice(0, 120) || slot.sessionId.slice(0, 12);
              const slotFrameClass = isFocused
                ? 'fixed inset-y-4 left-1/2 z-[70] w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border-primary/60 ring-[4px] ring-primary/[0.10] sm:w-[min(1080px,calc(100vw-48px))] md:inset-y-8 md:w-[min(1180px,calc(100vw-64px))]'
                : isActive
                ? slotState === 'running'
                  ? 'border-ok/60 ring-[3px] ring-ok/[0.12]'
                  : slotState === 'incomplete'
                    ? 'border-warn/65 ring-[3px] ring-warn/[0.12]'
                    : 'border-primary/55 ring-[3px] ring-primary/[0.10]'
                : slotState === 'running'
                  ? 'border-ok/35 hover:border-ok/60 hover:ring-[2px] hover:ring-ok/[0.08]'
                  : slotState === 'incomplete'
                    ? 'border-warn/40 hover:border-warn/65 hover:ring-[2px] hover:ring-warn/[0.08]'
                    : 'border-edge hover:border-primary/35 hover:ring-[2px] hover:ring-primary/[0.05]';
              const slotHeaderClass = isActive
                ? slotState === 'running'
                  ? 'bg-ok/[0.10]'
                  : slotState === 'incomplete'
                    ? 'bg-warn/[0.10]'
                    : 'bg-panel-h/85'
                : slotState === 'running'
                  ? 'bg-ok/[0.055]'
                  : slotState === 'incomplete'
                    ? 'bg-warn/[0.06]'
                    : 'bg-panel-h/65';
              const slotShadow = isFocused
                ? '0 24px 80px rgba(0,0,0,0.35), var(--th-card-shadow)'
                : isActive
                ? slotState === 'running'
                  ? 'var(--th-card-shadow), 0 0 0 1px rgba(34,197,94,0.12)'
                  : slotState === 'incomplete'
                    ? 'var(--th-card-shadow), 0 0 0 1px rgba(245,158,11,0.14)'
                    : 'var(--th-card-shadow), 0 0 0 1px rgba(14,165,233,0.10)'
                : 'var(--th-card-shadow)';
              return (
                <div
                  key={slot.mountKey || sKey(slot.agent, slot.sessionId)}
                  data-session-slot
                  className={cn(
                    'min-w-0 overflow-hidden rounded-xl border bg-panel flex flex-col transition-[border-color,box-shadow,transform,opacity,background-color] duration-200',
                    slotFrameClass,
                    !isFocused && 'hover:-translate-y-[1px] hover:bg-panel-alt/20',
                    draggingSlotIndex === slotIdx && 'opacity-60 scale-[0.985]',
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-primary/[0.08]',
                  )}
                  style={{ boxShadow: slotShadow }}
                  onClick={() => setActiveSlotIndex(slotIdx)}
                  onDoubleClick={e => handleSlotDoubleClick(slotIdx, e)}
                  onDragOver={e => handleSlotDragOver(slotIdx, e)}
                  onDrop={e => handleSlotDrop(slotIdx, e)}
                >
                  {/* Tab bar: [● workdir / title          created  updated  turns  📁  ×] */}
                  <div className={cn(
                    'group shrink-0 flex items-center gap-2 px-3 h-9 border-b border-edge/60 shadow-[0_1px_0_rgba(255,255,255,0.05)] cursor-grab active:cursor-grabbing',
                    slotHeaderClass,
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-primary/[0.08]',
                  )}
                    draggable
                    onDragStart={e => handleSlotDragStart(slotIdx, e)}
                    onDragEnd={handleSlotDragEnd}
                    title={t('hub.dragSession')}
                  >
                    {/* Left: status · workdir / title */}
                    <Dot variant={slotState === 'running' ? 'ok' : slotState === 'incomplete' ? 'warn' : 'idle'} pulse={slotState === 'running'} />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="shrink-0 rounded-md border border-edge/45 bg-panel/70 px-1.5 py-0.5 text-[10px] font-semibold text-fg-4 shadow-sm">{slot.workdir.split('/').pop() || slot.workdir}</span>
                      <span className="shrink-0 text-fg-5/70 text-[10px]">/</span>
                      <span className="min-w-0 truncate rounded-md bg-panel/70 px-1.5 py-0.5 text-[11px] font-semibold text-fg shadow-sm" title={slotTitle}>
                        {slotTitle}
                      </span>
                    </div>
                    {isFocused && (
                      <button
                        data-focus-ignore
                        type="button"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); closeFocusMode(); }}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-4 hover:bg-panel-h hover:text-fg transition-colors"
                        title={t('hub.exitFocusMode')}
                        aria-label={t('hub.exitFocusMode')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="shrink-0">
                          <path d="M8 3H3v5" /><path d="M21 8V3h-5" /><path d="M3 16v5h5" /><path d="M16 21h5v-5" />
                          <path d="M3 3l7 7" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /><path d="M21 21l-7-7" />
                        </svg>
                        <span className="whitespace-nowrap">{t('hub.exitFocusMode')}</span>
                      </button>
                    )}
                    {/* Right: meta + actions — reveal on hover so the title owns the bar by default */}
                    <div className="shrink-0 flex max-w-0 items-center gap-2 overflow-hidden pl-0 text-[9px] text-fg-5/50 tabular-nums opacity-0 transition-[max-width,opacity,padding] duration-150 group-hover:max-w-[520px] group-hover:pl-3 group-hover:opacity-100 group-focus-within:max-w-[520px] group-focus-within:pl-3 group-focus-within:opacity-100">
                      <span title={t('hub.created')}>{fmtTime(info.createdAt)}</span>
                      {info.runUpdatedAt && <span title={t('hub.updated')}>{fmtRelative(info.runUpdatedAt)}</span>}
                      {!!info.numTurns && (
                        <span className="flex items-center gap-0.5">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                          {info.numTurns}
                        </span>
                      )}
                      <button
                        type="button"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          openRenameSessionModal({
                            workdir: slot.workdir,
                            agent: slot.agent,
                            sessionId: slot.sessionId,
                            title: sessionListDisplayText(info).slice(0, 120) || slot.sessionId.slice(0, 16),
                          });
                        }}
                        className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-5/60 hover:text-fg-2 hover:bg-panel-h transition-colors"
                        title={t('session.rename')}
                        aria-label={t('session.rename')}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                        <span className="whitespace-nowrap">{t('session.rename')}</span>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleNewSessionRequest(slot.workdir); }}
                        className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-5/50 hover:text-primary hover:bg-panel-h transition-colors"
                        title={t('hub.newSessionHere')}
                        aria-label={t('hub.newSessionHere')}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span className="whitespace-nowrap">{t('hub.newSession')}</span>
                      </button>
                      <button
                        data-filetree-toggle
                        onClick={e => { e.stopPropagation(); setFileTreeOpen(v => !v); }}
                        className={cn(
                          'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none transition-colors',
                          fileTreeOpen ? 'text-fg-3 bg-panel-h' : 'text-fg-5/40 hover:text-fg-3 hover:bg-panel-h',
                        )}
                        title={t('hub.files')}
                        aria-label={t('hub.files')}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                        <span className="whitespace-nowrap">{t('hub.files')}</span>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleCloseSlot(slotIdx); }}
                        className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-5/40 hover:text-fg-2 hover:bg-panel-h transition-colors"
                        title={t('hub.closePanel')}
                        aria-label={t('hub.closePanel')}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        <span className="whitespace-nowrap">{t('hub.closePanel')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0">
                    <Suspense fallback={<div className="h-full" />}>
                      <SessionPanel
                        key={slot.mountKey}
                        session={info}
                        workdir={slot.workdir}
                        active={active && isActive}
                        onSessionChange={(next) => handlePanelSessionChange(next, slotIdx)}
                        onOpenFileLink={(target) => handleOpenFileLink(slotIdx, slot.workdir, target)}
                        initialPendingPrompt={isActive ? newSessionPendingPrompt : null}
                        initialPendingImageUrls={isActive ? newSessionPendingImageUrls : undefined}
                        initialPendingCreatedAt={isActive ? newSessionPendingCreatedAt : null}
                        onPendingPromptConsumed={isActive ? () => { setNewSessionPendingPrompt(null); setNewSessionPendingImageUrls([]); setNewSessionPendingCreatedAt(null); } : undefined}
                      />
                    </Suspense>
                  </div>
                </div>
              );
                });
              })()}
            </div>
          </>
        )}
      </div>

      {/* ═══ Floating File Tree ═══ */}
      {fileTreeOpen && (filePanelRequest?.workdir || selectedSession?.workdir) && (
        <FloatingFileTree
          workdir={filePanelRequest?.workdir || selectedSession!.workdir}
          request={filePanelRequest}
          onClose={() => setFileTreeOpen(false)}
          t={t}
        />
      )}

      {/* Add workspace modal */}
      <AddWorkspaceModal
        open={showAddDialog}
        initialPath={runtimeWorkdir || undefined}
        onAdd={handleAddWorkspace}
        onClose={() => setShowAddDialog(false)}
        t={t}
      />

      {/* Dashboard create task workspace picker */}
      <Modal open={createTaskPickerOpen} onClose={() => setCreateTaskPickerOpen(false)}>
        <ModalHeader title={t('dashboard.createTask')} onClose={() => setCreateTaskPickerOpen(false)} />
        <div className="text-[13px] text-fg-3 leading-relaxed">
          {t('dashboard.chooseWorkspaceHint')}
        </div>
        <select
          value={createTaskWorkdir}
          onChange={e => setCreateTaskWorkdir(e.target.value)}
          className="mt-3 w-full rounded-md border border-edge bg-inset px-3 py-2 text-[13px] text-fg outline-none focus:border-primary/40"
        >
          {workspaces.map(ws => (
            <option key={ws.path} value={ws.path}>
              {ws.name || workspaceBaseName(ws.path)}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateTaskPickerOpen(false)}>
            {t('modal.cancel')}
          </Button>
          <Button variant="primary" onClick={() => startDashboardTask(createTaskWorkdir)} disabled={!createTaskWorkdir}>
            {t('dashboard.createTask')}
          </Button>
        </div>
      </Modal>

      {/* Confirm remove workspace modal */}
      <Modal open={!!confirmRemove} onClose={() => !removing && setConfirmRemove(null)}>
        <ModalHeader title={t('hub.removeWorkspace')} onClose={() => !removing && setConfirmRemove(null)} />
        <div className="text-[13px] text-fg-3 leading-relaxed">
          {t('modal.confirmRemoveWorkspace')}
        </div>
        <div className="mt-1 text-[12px] text-fg-5">
          {t('modal.confirmRemoveWorkspaceHint')}
        </div>
        {confirmRemove && (
          <div className="mt-3 rounded-md bg-inset/50 border border-edge/30 px-3 py-2 font-mono text-[11px] text-fg-4 break-all">
            {confirmRemove}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setConfirmRemove(null)} disabled={removing}>{t('modal.cancel')}</Button>
          <Button variant="primary" onClick={executeRemoveWorkspace} disabled={removing}
            className="!bg-red-500/90 !border-red-500/50 hover:!bg-red-500 !text-white"
          >
            {removing ? t('modal.removing') : t('modal.remove')}
          </Button>
        </div>
      </Modal>

      {/* Rename workspace modal */}
      <Modal open={!!renameWorkspaceTarget} onClose={() => !renamingWorkspace && setRenameWorkspaceTarget(null)}>
        <ModalHeader title={t('hub.renameWorkspaceTitle')} onClose={() => !renamingWorkspace && setRenameWorkspaceTarget(null)} />
        <div className="text-[13px] text-fg-3 leading-relaxed">
          {t('hub.renameWorkspaceHint')}
        </div>
        <input
          value={renameWorkspaceName}
          onChange={e => setRenameWorkspaceName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void executeRenameWorkspace();
            if (e.key === 'Escape' && !renamingWorkspace) setRenameWorkspaceTarget(null);
          }}
          autoFocus
          placeholder={t('hub.renameWorkspacePlaceholder')}
          className="mt-3 w-full rounded-md border border-edge bg-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-5/40 focus:border-primary/40"
          disabled={renamingWorkspace}
        />
        {renameWorkspaceTarget && (
          <div className="mt-2 text-[11px] text-fg-5 break-all">
            <span className="text-fg-5/70">{renameWorkspaceTarget.originalName}</span>
            <span className="mx-1.5 text-fg-5/40">·</span>
            <span className="font-mono">{renameWorkspaceTarget.path}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setRenameWorkspaceTarget(null)} disabled={renamingWorkspace}>
            {t('modal.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void executeRenameWorkspace()} disabled={renamingWorkspace}>
            {renamingWorkspace ? t('hub.renamingWorkspace') : t('modal.save')}
          </Button>
        </div>
      </Modal>

      {/* Session row actions popover — anchored under the kebab button */}
      {sessionMenu && (() => {
        const MENU_WIDTH = 160;
        // Right-align to the kebab; clamp to viewport with 8px margins.
        const left = Math.max(8, Math.min(sessionMenu.anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
        const top = Math.min(sessionMenu.anchor.bottom + 4, window.innerHeight - 60);
        return (
          <div
            className="fixed z-[60] min-w-[160px] rounded-md border border-edge bg-panel/95 backdrop-blur-md py-1"
            style={{
              left,
              top,
              boxShadow: '0 8px 24px rgba(0,0,0,0.20), 0 2px 6px rgba(0,0,0,0.10)',
            }}
            onMouseDown={e => e.stopPropagation()}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openRenameSessionModal(sessionMenu.target)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 hover:bg-panel-h/60 hover:text-fg transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z" />
              </svg>
              {t('session.rename')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openDeleteSessionModal(sessionMenu.target)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 hover:bg-panel-h/60 hover:text-red-400 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
              </svg>
              {t('session.delete')}
            </button>
          </div>
        );
      })()}

      {/* Rename session modal */}
      <Modal
        open={!!renameSessionTarget}
        onClose={() => !renamingSession && setRenameSessionTarget(null)}
      >
        <ModalHeader
          title={t('session.renameTitle')}
          onClose={() => !renamingSession && setRenameSessionTarget(null)}
        />
        <div className="text-[13px] text-fg-3 leading-relaxed">
          {t('session.renameHint')}
        </div>
        <input
          value={renameSessionTitle}
          onChange={e => setRenameSessionTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void executeRenameSession();
            if (e.key === 'Escape' && !renamingSession) setRenameSessionTarget(null);
          }}
          autoFocus
          placeholder={t('session.renamePlaceholder')}
          className="mt-3 w-full rounded-md border border-edge bg-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-5/40 focus:border-primary/40"
          disabled={renamingSession}
        />
        {renameSessionTarget && (
          <div className="mt-2 text-[11px] text-fg-5 break-all">
            <span className="font-mono">{renameSessionTarget.agent}</span>
            <span className="mx-1.5 text-fg-5/50">·</span>
            <span className="font-mono">{renameSessionTarget.sessionId}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setRenameSessionTarget(null)} disabled={renamingSession}>
            {t('modal.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void executeRenameSession()} disabled={renamingSession}>
            {renamingSession ? t('session.renaming') : t('modal.save')}
          </Button>
        </div>
      </Modal>

      {/* Confirm delete session modal — choose between pikiclaw-only and purge-native */}
      <Modal
        open={!!confirmDeleteSession}
        onClose={() => !deletingSession && setConfirmDeleteSession(null)}
      >
        <ModalHeader
          title={t('session.deleteTitle')}
          onClose={() => !deletingSession && setConfirmDeleteSession(null)}
        />
        <div className="text-[13px] text-fg-3 leading-relaxed">
          {t('session.deleteHint')}
        </div>
        {confirmDeleteSession && (
          <div className="mt-3 rounded-md bg-inset/50 border border-edge/30 px-3 py-2 text-[11px] text-fg-4 break-all">
            <span className="font-mono text-fg-5">{confirmDeleteSession.agent}</span>
            <span className="mx-1.5 text-fg-5/50">·</span>
            <span>{confirmDeleteSession.title}</span>
          </div>
        )}
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="delete-session-scope"
              checked={!deleteSessionPurgeNative}
              onChange={() => setDeleteSessionPurgeNative(false)}
              disabled={deletingSession}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-[12px] text-fg-2">{t('session.deletePikiclawOnly')}</div>
              <div className="text-[11px] text-fg-5 leading-snug mt-0.5">{t('session.deletePikiclawOnlyHint')}</div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="delete-session-scope"
              checked={deleteSessionPurgeNative}
              onChange={() => setDeleteSessionPurgeNative(true)}
              disabled={deletingSession}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-[12px] text-fg-2">{t('session.deletePurgeNative')}</div>
              <div className="text-[11px] text-fg-5 leading-snug mt-0.5">{t('session.deletePurgeNativeHint')}</div>
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setConfirmDeleteSession(null)} disabled={deletingSession}>
            {t('modal.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={executeDeleteSession}
            disabled={deletingSession}
            className="!bg-red-500/90 !border-red-500/50 hover:!bg-red-500 !text-white"
          >
            {deletingSession ? t('session.deleting') : t('modal.remove')}
          </Button>
        </div>
      </Modal>

      {/* Workspace extensions modal */}
      <WorkspaceExtensionsModal
        open={!!extensionsWorkdir}
        onClose={() => setExtensionsWorkdir(null)}
        workdir={extensionsWorkdir || ''}
      />
    </div>
  );
});

/* ══════════════════════════════════════════════════════
   Add Workspace Modal — DirBrowser in a modal dialog
   ══════════════════════════════════════════════════════ */
function AddWorkspaceModal({
  open,
  initialPath,
  onAdd,
  onClose,
  t,
}: {
  open: boolean;
  initialPath?: string;
  onAdd: (path: string) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [selectedPath, setSelectedPath] = useState('');
  const handleSelect = useCallback((path: string) => setSelectedPath(path), []);

  useEffect(() => {
    if (open) setSelectedPath('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title={t('hub.addWorkspace')} onClose={onClose} />
      <DirBrowser
        initialPath={initialPath}
        maxHeight={360}
        minHeight={200}
        onSelect={handleSelect}
        t={t}
      />
      <div className="flex gap-2 mt-4">
        <Button
          disabled={!selectedPath}
          onClick={() => selectedPath && onAdd(selectedPath)}
          className="flex-1"
        >
          {t('hub.add')}
        </Button>
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('hub.cancel')}
        </Button>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   New Session View — empty chat + InputComposer
   Looks identical to a regular session: header, empty
   message area, and the standard input bar at the bottom.
   ══════════════════════════════════════════════════════ */
function NewSessionView({
  workdir,
  workspaceName,
  onSessionCreated,
  onClose,
  t,
}: {
  workdir: string;
  workspaceName: string;
  onSessionCreated: (next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>([]);
  const [pendingCreatedAt, setPendingCreatedAt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingImageUrlsRef = useRef<string[]>([]);
  const pendingCreatedAtRef = useRef<string | null>(null);

  const stubSession = useMemo((): SessionInfo => ({
    sessionId: '',
    agent: '',
    runState: 'completed',
  }), []);

  const noop = useCallback(() => {}, []);

  const handleSendStart = useCallback((prompt: string, imageUrls?: string[]) => {
    const createdAt = new Date().toISOString();
    setPendingPrompt(prompt || null);
    setPendingCreatedAt(createdAt);
    pendingRef.current = prompt || null;
    pendingCreatedAtRef.current = createdAt;
    const urls = imageUrls || [];
    setPendingImageUrls(urls);
    pendingImageUrlsRef.current = urls;
  }, []);

  const handleSessionCreated = useCallback((next: { agent: string; sessionId: string; workdir: string }) => {
    const urls = pendingImageUrlsRef.current;
    // Hand ownership of the blob URLs to the parent; SessionPanel will revoke them
    // after the first turn completes. Clear our local refs so our unmount doesn't touch them.
    pendingImageUrlsRef.current = [];
    onSessionCreated(next, pendingRef.current || undefined, urls.length ? urls : undefined, pendingCreatedAtRef.current);
  }, [onSessionCreated]);

  const hasPending = !!pendingPrompt || pendingImageUrls.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 h-10 border-b border-edge/50 bg-panel/40 backdrop-blur-md z-10">
        <span className="flex-1 min-w-0 text-[13px] font-medium text-fg truncate">{t('hub.newSession')}</span>
        <span className="flex items-center gap-1 text-[10px] text-fg-5/60 shrink-0">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span className="max-w-[80px] truncate">{workspaceName}</span>
        </span>
        <Dot variant={hasPending ? 'ok' : 'idle'} pulse={hasPending} />
        {!hasPending && (
          <button
            onClick={onClose}
            className="p-1 rounded text-fg-5 hover:text-fg-2 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Message area ── */}
      <div className="flex-1 overflow-y-auto">
        {hasPending ? (
          <div className="max-w-[900px] mx-auto px-6 py-6 space-y-0">
            <UserBubble text={pendingPrompt || ''} blocks={pendingImageUrls.map(u => ({ type: 'image' as const, content: u }))} createdAt={pendingCreatedAt} t={t} />
            <div className="mt-3 mb-4 animate-in">
              <ThinkingDots className="text-fg-5" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-1.5">
              <div className="text-[13px] text-fg-5">{t('hub.newSessionHint')}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <InputComposer
        session={stubSession}
        workdir={workdir}
        onStreamQueued={noop}
        onSendStart={handleSendStart}
        onSessionChange={handleSessionCreated}
        t={t}
        streamPhase={null}
      />
    </div>
  );
}

function DashboardCreateTaskModal({
  workdir,
  workspaceName,
  onClose,
  onSessionCreated,
  t,
}: {
  workdir: string;
  workspaceName: string;
  onClose: () => void;
  onSessionCreated: (next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('dashboard.createTask')}
        className="fixed inset-y-4 left-1/2 z-[70] flex w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-primary/50 bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.35)] ring-[4px] ring-primary/[0.10] sm:w-[min(900px,calc(100vw-48px))] md:inset-y-8"
      >
        <NewSessionView
          workdir={workdir}
          workspaceName={workspaceName}
          onSessionCreated={onSessionCreated}
          onClose={onClose}
          t={t}
        />
      </div>
    </>
  );
}

function WorkspaceTaskDashboard({
  workspaces,
  scope,
  onScopeChange,
  items,
  counts,
  loading,
  onCreateTask,
  onOpenSession,
  onMarkDone,
  t,
}: {
  workspaces: WorkspaceEntry[];
  scope: DashboardScope;
  onScopeChange: (scope: DashboardScope) => void;
  items: DashboardSessionItem[];
  counts: Record<DashboardColumnKey, number>;
  loading: boolean;
  onCreateTask: () => void;
  onOpenSession: (item: DashboardSessionItem) => void;
  onMarkDone: (item: DashboardSessionItem) => void;
  t: (key: string) => string;
}) {
  const byColumn = useMemo(() => {
    const grouped: Record<DashboardColumnKey, DashboardSessionItem[]> = {
      running: [],
      pending: [],
      review: [],
      incomplete: [],
      done: [],
    };
    for (const item of items) grouped[item.column].push(item);
    return grouped;
  }, [items]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-edge bg-panel" style={{ boxShadow: 'var(--th-card-shadow)' }}>
      <div className="shrink-0 border-b border-edge/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg">{t('dashboard.title')}</div>
            <div className="mt-0.5 text-[11px] text-fg-5">{t('dashboard.subtitle')}</div>
          </div>
          <select
            value={scope}
            onChange={e => onScopeChange(e.target.value || 'all')}
            className="h-8 min-w-[150px] rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
          >
            <option value="all">{t('dashboard.allWorkspaces')}</option>
            {workspaces.map(ws => (
              <option key={ws.path} value={ws.path}>
                {ws.name || workspaceBaseName(ws.path)}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={onCreateTask} disabled={!workspaces.length}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('dashboard.createTask')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {DASHBOARD_COLUMNS.map(column => (
            <div key={column.key} className="min-h-0 rounded-lg border border-edge/50 bg-panel-alt/35 flex flex-col overflow-hidden">
              <div className="shrink-0 border-b border-edge/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={column.variant} className="h-5 px-2 text-[10px]">
                    {counts[column.key]}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-fg-2">{t(column.titleKey)}</div>
                    <div className="truncate text-[10px] text-fg-5">{t(column.hintKey)}</div>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loading && items.length === 0 ? (
                  <div className="flex h-24 items-center justify-center">
                    <Spinner className="h-3.5 w-3.5 text-fg-5" />
                  </div>
                ) : byColumn[column.key].length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-edge/40 text-[11px] text-fg-5/60">
                    {t('dashboard.emptyColumn')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {byColumn[column.key].map(item => (
                      <DashboardTaskCard
                        key={item.key}
                        item={item}
                        onOpen={() => onOpenSession(item)}
                        onMarkDone={() => onMarkDone(item)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardSessionFocusModal({
  slot,
  session,
  workspaceName,
  active,
  onClose,
  onSessionChange,
  onOpenFileLink,
  initialPendingPrompt,
  initialPendingImageUrls,
  initialPendingCreatedAt,
  onPendingPromptConsumed,
  t,
}: {
  slot: SessionSlot;
  session: SessionInfo;
  workspaceName: string;
  active: boolean;
  onClose: () => void;
  onSessionChange: (next: { agent: string; sessionId: string; workdir: string }) => void;
  onOpenFileLink: OpenFileLinkHandler;
  initialPendingPrompt?: string | null;
  initialPendingImageUrls?: string[];
  initialPendingCreatedAt?: string | null;
  onPendingPromptConsumed?: () => void;
  t: (key: string) => string;
}) {
  const displayState = sessionDisplayState(session);
  const title = sessionListDisplayText(session).slice(0, 180) || slot.sessionId.slice(0, 16);
  const stateVariant = displayState === 'running' ? 'ok' : displayState === 'incomplete' ? 'warn' : 'idle';

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-4 left-1/2 z-[70] flex w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-primary/50 bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.35)] ring-[4px] ring-primary/[0.10] sm:w-[min(1080px,calc(100vw-48px))] md:inset-y-8 md:w-[min(1180px,calc(100vw-64px))]"
      >
        <div className="shrink-0 flex items-center gap-2 border-b border-edge/35 bg-panel/80 px-3 h-9 backdrop-blur-sm">
          <Dot variant={stateVariant} pulse={displayState === 'running'} />
          <span className="shrink-0 text-[10px] font-medium text-fg-5">{workspaceName}</span>
          <span className="shrink-0 text-fg-6 text-[10px]">/</span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-2" title={title}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-4 hover:bg-panel-h hover:text-fg transition-colors"
            title={t('hub.exitFocusMode')}
            aria-label={t('hub.exitFocusMode')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="shrink-0">
              <path d="M8 3H3v5" /><path d="M21 8V3h-5" /><path d="M3 16v5h5" /><path d="M16 21h5v-5" />
              <path d="M3 3l7 7" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /><path d="M21 21l-7-7" />
            </svg>
            <span className="whitespace-nowrap">{t('hub.exitFocusMode')}</span>
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="h-full" />}>
            <SessionPanel
              key={slot.mountKey}
              session={session}
              workdir={slot.workdir}
              active={active}
              onSessionChange={onSessionChange}
              onOpenFileLink={onOpenFileLink}
              initialPendingPrompt={initialPendingPrompt}
              initialPendingImageUrls={initialPendingImageUrls}
              initialPendingCreatedAt={initialPendingCreatedAt}
              onPendingPromptConsumed={onPendingPromptConsumed}
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}

function DashboardTaskCard({
  item,
  onOpen,
  onMarkDone,
  t,
}: {
  item: DashboardSessionItem;
  onOpen: () => void;
  onMarkDone: () => void;
  t: (key: string) => string;
}) {
  const meta = getAgentMeta(item.session.agent || '');
  const title = sessionListDisplayText(item.session).slice(0, 180) || item.session.sessionId.slice(0, 16);
  const detail = sessionListContextText(item.session, title).slice(0, 160);
  const displayState = sessionDisplayState(item.session);
  const statusTone: StripBadgeVariant = item.column === 'running'
    ? 'ok'
    : item.column === 'incomplete'
      ? 'err'
      : item.column === 'review'
        ? 'warn'
        : item.column === 'pending'
          ? 'accent'
          : 'muted';
  const time = fmtRelative(item.session.runUpdatedAt || item.session.createdAt);

  return (
    <div className="rounded-md border border-edge/50 bg-panel px-3 py-2 transition-colors hover:border-primary/25 hover:bg-panel-h/45">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 text-[10px] text-fg-5">
          <BrandIcon brand={item.session.agent || ''} size={11} />
          <span className="font-medium" style={{ color: meta.color }}>{meta.shortLabel}</span>
          <span className="min-w-0 truncate">{item.workspaceName}</span>
          <span className="ml-auto shrink-0 tabular-nums">{time}</span>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5">
          <Dot variant={displayState === 'running' ? 'ok' : displayState === 'incomplete' ? 'err' : 'idle'} pulse={displayState === 'running'} />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[12px] leading-snug text-fg-2" title={title}>{title}</div>
            {detail && <div className="mt-1 truncate text-[10px] text-fg-5">{detail}</div>}
          </div>
        </div>
      </button>
      <div className="mt-2 flex items-center gap-1.5">
        <Badge variant={statusTone} className="h-5 px-1.5 text-[10px]">{t(`dashboard.${item.column}`)}</Badge>
        {item.live?.phase === 'queued' && (
          <span className="text-[10px] text-fg-5">{t('dashboard.queued')}</span>
        )}
        <div className="flex-1" />
        {item.column === 'review' && (
          <button
            type="button"
            onClick={onMarkDone}
            className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[10px] text-fg-3 transition-colors hover:border-ok/40 hover:bg-ok/10 hover:text-ok"
          >
            {t('dashboard.markDone')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Workspace Group — collapsible, paginated (5 per page)
   Callbacks now take wsPath as a parameter so parent can
   pass stable function refs instead of inline closures.
   ══════════════════════════════════════════════════════ */
const WorkspaceGroup = memo(function WorkspaceGroup({
  workspace,
  sessions,
  loading,
  isActive,
  selectedKey,
  openSessionKeys,
  onSelectSession,
  onNewSession,
  onRefresh,
  onRemove,
  onRename,
  onExtensions,
  onWarmSession,
  onCancelWarmSession,
  onSessionMenuOpen,
  draggingPath,
  dragOverPath,
  onWorkspaceDragStart,
  onWorkspaceDragOver,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  onWorkspaceDragEnd,
  t,
}: {
  workspace: WorkspaceEntry;
  sessions: SessionInfo[];
  loading: boolean;
  isActive?: boolean;
  selectedKey: string | null;
  openSessionKeys?: Set<string>;
  onSelectSession: (s: SessionInfo, wsPath: string) => void;
  onNewSession: (wsPath: string) => void;
  onRefresh: (wsPath: string) => void;
  onRemove: (wsPath: string) => void;
  onRename: (workspace: WorkspaceEntry) => void;
  onExtensions: (wsPath: string) => void;
  onWarmSession: (s: SessionInfo, wsPath: string) => void;
  onCancelWarmSession: (s: SessionInfo, wsPath: string) => void;
  onSessionMenuOpen: (anchor: DOMRect, s: SessionInfo, wsPath: string) => void;
  draggingPath: string | null;
  dragOverPath: string | null;
  onWorkspaceDragStart: (wsPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onWorkspaceDragOver: (wsPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (wsPath: string) => void;
  onWorkspaceDrop: (wsPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onWorkspaceDragEnd: () => void;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [actionsAnchor, setActionsAnchor] = useState<{ right: number; bottom: number } | null>(null);

  // Reset pagination when sessions change
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [sessions.length]);
  useEffect(() => {
    if (!actionsAnchor) return;
    const close = () => setActionsAnchor(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [actionsAnchor]);

  const visible = sessions.slice(0, visibleCount);
  const remaining = sessions.length - visibleCount;

  const wsPath = workspace.path;
  const originalName = workspaceBaseName(wsPath);
  const displayName = workspace.name || originalName;
  const hasAlias = displayName !== originalName;
  const openActions = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setActionsAnchor(prev => prev ? null : { right: rect.right, bottom: rect.bottom });
  };
  const runAction = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    event.stopPropagation();
    setActionsAnchor(null);
    action();
  };

  return (
    <div className="border-b border-edge/30">
      {/* Workspace header */}
      <div
        data-workspace-path={wsPath}
        draggable
        className={cn(
          'flex items-center gap-2 border-y border-edge/35 bg-selected px-3 py-2 cursor-pointer hover:bg-selected-h transition-colors',
          draggingPath === wsPath && 'opacity-60',
          dragOverPath === wsPath && draggingPath !== wsPath && 'bg-primary/[0.08] ring-1 ring-inset ring-primary/30',
        )}
        onClick={() => setExpanded(v => !v)}
        onDragStart={e => onWorkspaceDragStart(wsPath, e)}
        onDragOver={e => onWorkspaceDragOver(wsPath, e)}
        onDragLeave={() => onWorkspaceDragLeave(wsPath)}
        onDrop={e => onWorkspaceDrop(wsPath, e)}
        onDragEnd={onWorkspaceDragEnd}
      >
        <svg width="9" height="13" viewBox="0 0 12 18" fill="currentColor" className="shrink-0 text-fg-6/50">
          <circle cx="3" cy="4" r="1.2" /><circle cx="9" cy="4" r="1.2" />
          <circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
          <circle cx="3" cy="14" r="1.2" /><circle cx="9" cy="14" r="1.2" />
        </svg>
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn('shrink-0 text-fg-5 transition-transform duration-150', expanded && 'rotate-90')}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className={cn('min-w-0 truncate text-[12px] font-semibold', isActive ? 'text-primary' : 'text-fg-3')}>
            {displayName}
          </span>
          {hasAlias && (
            <span className="shrink min-w-[42px] max-w-[92px] truncate text-[10px] font-normal text-fg-5/45" title={wsPath}>
              {originalName}
            </span>
          )}
        </div>
        {isActive && <Dot variant="ok" />}
        <button
          type="button"
          onClick={openActions}
          onMouseDown={e => e.stopPropagation()}
          className={cn(
            'ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] font-semibold leading-none text-fg-5 transition-colors hover:bg-panel-h hover:text-fg-2',
            actionsAnchor && 'bg-panel-h text-fg-2',
          )}
          title={t('session.openActions')}
          aria-label={t('session.openActions')}
        >
          ...
        </button>
        {actionsAnchor && (() => {
          const MENU_WIDTH = 168;
          const left = Math.max(8, Math.min(actionsAnchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
          const top = Math.min(actionsAnchor.bottom + 4, window.innerHeight - 180);
          return (
            <div
              className="fixed z-[70] min-w-[168px] rounded-md border border-edge bg-panel/95 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.20),0_2px_6px_rgba(0,0,0,0.10)] backdrop-blur-md"
              style={{ left, top }}
              onMouseDown={e => e.stopPropagation()}
              role="menu"
            >
          <button
            onClick={e => runAction(e, () => onNewSession(wsPath))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-panel-h/60 hover:text-primary"
            title={t('hub.newSession')}
            aria-label={t('hub.newSession')}
            role="menuitem"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('hub.newSession')}
          </button>
          <button
            onClick={e => runAction(e, () => onRename(workspace))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-panel-h/60 hover:text-primary"
            title={t('hub.renameWorkspace')}
            aria-label={t('hub.renameWorkspace')}
            role="menuitem"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z" />
            </svg>
            {t('session.rename')}
          </button>
          <button
            onClick={e => runAction(e, () => onExtensions(wsPath))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-panel-h/60 hover:text-primary"
            title={t('hub.extensions')}
            aria-label={t('hub.extensions')}
            role="menuitem"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a6 6 0 0 1-12 0V8z" />
            </svg>
            {t('hub.extensions')}
          </button>
          <button
            onClick={e => runAction(e, () => onRefresh(wsPath))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-panel-h/60 hover:text-fg"
            title={t('hub.refresh')}
            aria-label={t('hub.refresh')}
            role="menuitem"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t('hub.refresh')}
          </button>
          {!isActive && (
            <button
              onClick={e => runAction(e, () => onRemove(wsPath))}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-panel-h/60 hover:text-red-400"
              title={t('hub.removeWorkspace')}
              aria-label={t('hub.removeWorkspace')}
              role="menuitem"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {t('modal.remove')}
            </button>
          )}
            </div>
          );
        })()}
      </div>

      {/* Sessions */}
      {expanded && (
        <div className="pb-1">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-3 w-3 text-fg-5" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-3 text-center text-[11px] text-fg-5">{t('sessions.noSessions')}</div>
          ) : (
            <>
              {visible.map(session => {
                const sk = sKey(session.agent || '', session.sessionId);
                const depth = (session as SessionInfo & { __forkDepth?: number }).__forkDepth || 0;
                return (
                  <SessionCard
                    key={sk}
                    session={session}
                    isSelected={selectedKey === sk}
                    isOpen={openSessionKeys?.has(sk) ?? false}
                    forkDepth={depth}
                    onClick={() => onSelectSession(session, wsPath)}
                    onWarm={() => onWarmSession(session, wsPath)}
                    onCancelWarm={() => onCancelWarmSession(session, wsPath)}
                    onShowMenu={anchor => onSessionMenuOpen(anchor, session, wsPath)}
                    menuLabel={t('session.openActions')}
                    t={t}
                  />
                );
              })}
              {remaining > 0 && (
                <button
                  onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                  className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] text-fg-5 hover:text-fg-3 hover:bg-panel-h/50 transition-colors"
                >
                  <span>+ {t('hub.nMore').replace('{n}', String(remaining))}</span>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

/* ══════════════════════════════════════════════════════
   Session Card — 3 lines: agent+time, question, status dot
   ══════════════════════════════════════════════════════ */
const SessionCard = memo(function SessionCard({
  session,
  isSelected,
  isOpen,
  forkDepth = 0,
  onClick,
  onWarm,
  onCancelWarm,
  onShowMenu,
  menuLabel,
  t,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isOpen?: boolean;
  /** 0 = top-level. >0 = fork descendant; rendered with indent + connector. */
  forkDepth?: number;
  onClick: () => void;
  onWarm: () => void;
  onCancelWarm: () => void;
  /** Called when the user clicks the kebab — receives its bounding rect so the
   * parent can anchor a popover menu to it (no mouse coordinates needed). */
  onShowMenu: (anchor: DOMRect) => void;
  menuLabel: string;
  t: (key: string) => string;
}) {
  const meta = getAgentMeta(session.agent || '');
  const displayState = sessionDisplayState(session);
  const now = useElapsedNow(displayState === 'running');
  const runningStartedAt = displayState === 'running' ? sessionRunningStartMs(session) : null;
  const runningElapsed = runningStartedAt ? formatElapsedDuration(now - runningStartedAt) : null;
  const statusLabel = displayState === 'running'
    ? `${t('session.statusRunning')}${runningElapsed ? ` ${runningElapsed}` : ''}`
    : displayState === 'incomplete'
      ? t('session.statusIncomplete')
      : t('session.statusCompleted');
  const displayText = sessionListDisplayText(session).slice(0, 500) || session.sessionId.slice(0, 16);
  const contextText = sessionListContextText(session, displayText).slice(0, 500);
  const modelShort = session.model ? shortenModel(session.model) : null;
  const indentPx = forkDepth > 0 ? Math.min(forkDepth, 3) * 14 : 0;
  const baseLeftPx = isOpen ? 10 : 12;

  const kebabRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="relative group px-1">
    <button
      data-session-card
      onClick={onClick}
      onMouseEnter={onWarm}
      onFocus={onWarm}
      onMouseLeave={onCancelWarm}
      onBlur={onCancelWarm}
      className={cn(
        'h-[86px] w-full overflow-hidden rounded-md border pr-3 py-2 text-left transition-[background,border-color,box-shadow,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45',
        isSelected
          ? 'border-primary/50 bg-primary/[0.14] ring-1 ring-inset ring-primary/45 hover:bg-primary/[0.18]'
          : displayState === 'running'
            ? 'border-ok/20 bg-ok/[0.10] hover:border-ok/40 hover:bg-ok/[0.14] hover:ring-1 hover:ring-inset hover:ring-ok/25'
          : displayState === 'incomplete'
            ? 'border-warn/20 bg-warn/[0.08] hover:border-warn/40 hover:bg-warn/[0.12] hover:ring-1 hover:ring-inset hover:ring-warn/25'
          : isOpen
            ? 'border-edge/50 bg-panel-h/30 hover:border-primary/30 hover:bg-panel-h/65 hover:ring-1 hover:ring-inset hover:ring-primary/20'
            : 'border-transparent hover:border-primary/30 hover:bg-panel-h/65 hover:ring-1 hover:ring-inset hover:ring-primary/20',
        !isSelected && 'hover:translate-x-0.5',
        isSelected && 'shadow-[inset_3px_0_0_var(--th-primary)]',
        !isSelected && displayState === 'running' && 'shadow-[inset_3px_0_0_var(--th-ok)]',
        !isSelected && displayState === 'incomplete' && 'shadow-[inset_3px_0_0_var(--th-warn)]',
      )}
      style={{
        paddingLeft: baseLeftPx + indentPx,
        ...(isOpen ? { borderLeft: `2px solid ${isSelected ? meta.color : `${meta.color}30`}` } : {}),
      }}
    >
      {/* Row 1: agent + model + turns + time */}
      <div className="flex h-4 items-center gap-1.5 text-[10px] text-fg-5">
        {forkDepth > 0 && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-fg-5/60 shrink-0" aria-label="Fork">
            <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
            <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
          </svg>
        )}
        <BrandIcon brand={session.agent || ''} size={10} />
        <span className="font-medium shrink-0" style={{ color: meta.color }}>{meta.shortLabel}</span>
        {modelShort && (
          <span className="truncate max-w-[72px] font-mono text-fg-5/40 text-[9px]">{modelShort}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          {!!session.numTurns && (
            <span className="flex items-center gap-0.5 text-fg-5/50 tabular-nums">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              {session.numTurns}
            </span>
          )}
          <span className="tabular-nums">{fmtRelative(session.runUpdatedAt || session.createdAt)}</span>
        </div>
      </div>
      {/* Row 2: status dot + title */}
      <div className="mt-1 flex h-[34px] items-start gap-1.5 overflow-hidden">
        <Dot
          variant={displayState === 'running' ? 'ok' : displayState === 'incomplete' ? 'warn' : 'idle'}
          pulse={displayState === 'running'}
        />
        <span
          className="min-w-0 flex-1 break-words text-[12px] leading-snug text-fg-2"
          title={displayText}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {displayText}
        </span>
        <span className={cn(
          'mt-0.5 shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none',
          displayState === 'running'
            ? 'bg-ok/15 text-ok'
            : displayState === 'incomplete'
              ? 'bg-warn/15 text-warn'
              : 'bg-primary/10 text-primary',
        )}>
          {statusLabel}
        </span>
      </div>
      {contextText && (
        <div className="mt-0.5 h-[14px] pl-[11px]">
          <span className="block truncate text-[10px] leading-snug text-fg-5">{contextText}</span>
        </div>
      )}
    </button>
      {/* Kebab — hidden by default, fades in on row hover/focus. Anchors the
          actions popover via getBoundingClientRect, so it never spawns at the
          mouse pointer. */}
      <button
        ref={kebabRef}
        type="button"
        aria-label={menuLabel}
        aria-haspopup="menu"
        onMouseDown={e => { e.stopPropagation(); }}
        onClick={e => {
          e.stopPropagation();
          e.preventDefault();
          if (kebabRef.current) onShowMenu(kebabRef.current.getBoundingClientRect());
        }}
        title={menuLabel}
        className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded border border-edge/40 bg-panel/95 px-1.5 py-0.5 text-[10px] leading-none text-fg-5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-panel-h hover:text-fg-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
        <span className="whitespace-nowrap">{menuLabel}</span>
      </button>
    </div>
  );
});

/* ══════════════════════════════════════════════════════
   Floating File Tree — toggled from session tab bar
   ══════════════════════════════════════════════════════ */
type FilePanelMode = 'changes' | 'files';
type PreviewMode = 'file' | 'diff';
type PreviewState = {
  path: string;
  mode: PreviewMode;
  loading: boolean;
  line?: number;
  relativePath?: string;
  content?: string;
  error?: string;
  truncated?: boolean;
  size?: number;
};

const FloatingFileTree = memo(function FloatingFileTree({
  workdir,
  request,
  onClose,
  t,
}: {
  workdir: string;
  request?: FilePanelRequest | null;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const hostApp = useStore(s => s.state?.hostApp ?? null);
  const platform = useStore(s => s.state?.platform ?? null);
  const toast = useStore(s => s.toast);
  const [openTarget, setOpenTarget] = useState<OpenTarget>(() => inferOpenTarget(hostApp, platform));
  const [panelMode, setPanelMode] = useState<FilePanelMode>('changes');
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesIsGit, setChangesIsGit] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [treePaneWidth, setTreePaneWidth] = useState(320);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previewSeqRef = useRef(0);

  const handleOpenPath = useCallback(async (targetPath: string) => {
    try {
      const res = await api.openInEditor(targetPath, openTarget);
      if (!res.ok) throw new Error(res.error || `Failed to open ${targetPath}`);
    } catch (error: any) {
      toast(error?.message || String(error), false);
    }
  }, [openTarget, toast]);

  const loadChanges = useCallback(async () => {
    setChangesLoading(true);
    try {
      const res = await api.gitChanges(workdir);
      setChanges(res.ok ? res.changes : []);
      setChangesIsGit(res.ok ? res.isGit : false);
    } catch {
      setChanges([]);
      setChangesIsGit(false);
    } finally {
      setChangesLoading(false);
    }
  }, [workdir]);

  useEffect(() => {
    void loadChanges();
    setPreview(null);
  }, [loadChanges]);

  const handlePreviewPath = useCallback(async (targetPath: string, mode: PreviewMode = 'file', line?: number) => {
    const seq = ++previewSeqRef.current;
    setPreview({ path: targetPath, mode, loading: true, line });
    try {
      const res = mode === 'diff'
        ? await api.gitDiffContent(workdir, targetPath)
        : await api.fileContent(workdir, targetPath);
      if (seq !== previewSeqRef.current) return;
      if (!res.ok) {
        setPreview({
          path: res.path || targetPath,
          mode,
          loading: false,
          relativePath: res.relativePath,
          error: res.error || t('hub.previewUnavailable'),
          size: res.size,
          line,
        });
        return;
      }
      setPreview({
        path: res.path || targetPath,
        mode,
        loading: false,
        relativePath: res.relativePath,
        content: res.content || '',
        truncated: mode === 'diff' ? res.truncated : false,
        size: mode === 'file' ? res.size : undefined,
        line,
      });
    } catch (error: any) {
      if (seq !== previewSeqRef.current) return;
      setPreview({
        path: targetPath,
        mode,
        loading: false,
        error: error?.message || String(error),
        line,
      });
    }
  }, [t, workdir]);

  useEffect(() => {
    if (!request || request.workdir !== workdir) return;
    setPanelMode('files');
    void handlePreviewPath(request.path, 'file', request.line);
  }, [handlePreviewPath, request, workdir]);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();

    const rect = panel.getBoundingClientRect();
    const minWidth = 240;
    const maxWidth = Math.max(minWidth, Math.min(560, rect.width - 360));
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const updateWidth = (clientX: number) => {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, clientX - rect.left));
      setTreePaneWidth(nextWidth);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    updateWidth(event.clientX);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed z-50 flex flex-col rounded-xl border border-edge bg-panel/95 backdrop-blur-md overflow-hidden"
      style={{
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
        right: 16,
        top: 80,
        width: 'min(880px, calc(100vw - 32px))',
        height: 'calc(100vh - 100px)',
      }}
    >
      {/* Title bar */}
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/30">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-fg-5">
          <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="flex-1 text-[10px] font-semibold text-fg-4 uppercase tracking-wider">{t('hub.files')}</span>
        <button
          onClick={onClose}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] leading-none text-fg-5/50 hover:bg-panel-h hover:text-fg-2 transition-colors"
          title={t('hub.closePanel')}
          aria-label={t('hub.closePanel')}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span className="whitespace-nowrap">{t('hub.closePanel')}</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="shrink-0 flex flex-col min-h-0" style={{ width: treePaneWidth }}>
          <div className="shrink-0 px-2.5 py-1.5 border-b border-edge/20 flex items-center gap-2">
            <IconPicker
              value={openTarget}
              options={(platform === 'darwin' ? ['vscode', 'finder'] : ['vscode']).map(v => ({
                value: v,
                label: t(targetLabelKey(v as OpenTarget)),
              }))}
              onChange={value => { if (isOpenTarget(value)) setOpenTarget(value); }}
              renderIcon={v => <OpenTargetIcon target={v as OpenTarget} size={14} />}
            />
            <Button size="sm" variant="ghost" onClick={() => handleOpenPath(workdir)} className="flex-1 min-w-0 text-[11px]">
              {t('hub.openProject')}
            </Button>
          </div>

          <div className="shrink-0 px-2.5 py-1.5 border-b border-edge/20">
            <div className="flex items-center rounded-md bg-inset/30 border border-edge/20 p-0.5">
              {(['changes', 'files'] as FilePanelMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPanelMode(mode)}
                  className={cn(
                    'flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
                    panelMode === mode ? 'bg-panel-h text-fg-2' : 'text-fg-5 hover:text-fg-3',
                  )}
                >
                  {mode === 'changes' ? t('hub.changes') : t('hub.files')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1.5">
            {panelMode === 'changes' ? (
              <ChangeList
                changes={changes}
                loading={changesLoading}
                isGit={changesIsGit}
                onPreview={handlePreviewPath}
                onOpenPath={handleOpenPath}
                onRefresh={loadChanges}
                t={t}
              />
            ) : (
              <FileTree
                basePath={workdir}
                openTarget={openTarget}
                selectedPath={preview?.path || null}
                onOpenPath={handleOpenPath}
                onPreviewPath={handlePreviewPath}
                t={t}
              />
            )}
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
          className="group relative w-2 shrink-0 cursor-col-resize border-x border-edge/20 bg-panel-alt/20 transition-colors hover:bg-primary/10"
          title={t('hub.resizePanel')}
        >
          <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-edge transition-colors group-hover:bg-fg-5" />
        </div>

        <CodePreviewPane
          preview={preview}
          onOpenPath={handleOpenPath}
          t={t}
        />
      </div>
    </div>
  );
});

type ChangeStatus = GitChange['status'];
type ChangeTreeNode = ChangeTreeDirNode | ChangeTreeFileNode;
type ChangeTreeDirNode = {
  kind: 'dir';
  name: string;
  key: string;
  count: number;
  statuses: ChangeStatus[];
  children: ChangeTreeNode[];
};
type ChangeTreeFileNode = {
  kind: 'file';
  name: string;
  key: string;
  change: GitChange;
};
type MutableChangeDir = {
  name: string;
  key: string;
  count: number;
  statusSet: Set<ChangeStatus>;
  dirs: Map<string, MutableChangeDir>;
  files: ChangeTreeFileNode[];
};

function changeStatusLabel(status: ChangeStatus, t: (key: string) => string): string {
  if (status === 'added') return t('hub.added');
  if (status === 'deleted') return t('hub.deleted');
  return t('hub.modified');
}

function changeStatusShort(status: ChangeStatus): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

function changeStatusClass(status: ChangeStatus): string {
  if (status === 'added') return 'border-ok/40 bg-ok/10 text-ok';
  if (status === 'deleted') return 'border-err/40 bg-err/10 text-err';
  return 'border-warn/30 bg-warn/10 text-warn';
}

function changeStatusBorderClass(status: ChangeStatus): string {
  if (status === 'added') return 'border-l-ok/70';
  if (status === 'deleted') return 'border-l-err/70';
  return 'border-l-warn/70';
}

function changeStatusDotClass(status: ChangeStatus): string {
  if (status === 'added') return 'bg-ok';
  if (status === 'deleted') return 'bg-err';
  return 'bg-warn';
}

function sortedChangeStatuses(statuses: Iterable<ChangeStatus>): ChangeStatus[] {
  const rank: Record<ChangeStatus, number> = { deleted: 0, added: 1, modified: 2 };
  return Array.from(statuses).sort((a, b) => rank[a] - rank[b]);
}

function primaryChangeStatus(statuses: ChangeStatus[]): ChangeStatus {
  return statuses[0] || 'modified';
}

function normalizeChangeFile(change: GitChange): string {
  return (change.file || change.path).replace(/\\/g, '/').replace(/^\/+/, '');
}

function changeBasename(file: string): string {
  const parts = file.split('/').filter(Boolean);
  return parts[parts.length - 1] || file;
}

function buildChangeTree(changes: GitChange[]): ChangeTreeNode[] {
  const root: MutableChangeDir = {
    name: '',
    key: '',
    count: 0,
    statusSet: new Set(),
    dirs: new Map(),
    files: [],
  };

  for (const change of changes) {
    const file = normalizeChangeFile(change);
    const parts = file.split('/').filter(Boolean);
    const fileName = parts.pop() || changeBasename(file);
    let cursor = root;

    cursor.count += 1;
    cursor.statusSet.add(change.status);

    let key = '';
    for (const part of parts) {
      key = key ? `${key}/${part}` : part;
      let child = cursor.dirs.get(part);
      if (!child) {
        child = {
          name: part,
          key,
          count: 0,
          statusSet: new Set(),
          dirs: new Map(),
          files: [],
        };
        cursor.dirs.set(part, child);
      }
      child.count += 1;
      child.statusSet.add(change.status);
      cursor = child;
    }

    cursor.files.push({
      kind: 'file',
      name: fileName,
      key: file || change.path,
      change,
    });
  }

  const toNodes = (dir: MutableChangeDir): ChangeTreeNode[] => {
    const dirs = Array.from(dir.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(child => ({
        kind: 'dir' as const,
        name: child.name,
        key: child.key,
        count: child.count,
        statuses: sortedChangeStatuses(child.statusSet),
        children: toNodes(child),
      }));
    const files = dir.files.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  };

  return toNodes(root);
}

function ChangeList({
  changes,
  loading,
  isGit,
  onPreview,
  onOpenPath,
  onRefresh,
  t,
}: {
  changes: GitChange[];
  loading: boolean;
  isGit: boolean;
  onPreview: (path: string, mode?: PreviewMode) => void;
  onOpenPath: (path: string) => void;
  onRefresh: () => void;
  t: (key: string) => string;
}) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setCollapsedDirs(new Set());
  }, [changes]);

  const toggleDir = useCallback((key: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (loading) return <div className="flex justify-center py-3"><Spinner className="h-3 w-3 text-fg-4" /></div>;
  if (!isGit) return <div className="py-3 text-center text-[11px] text-fg-4">{t('hub.notGitRepo')}</div>;
  if (changes.length === 0) {
    return (
      <div className="px-2 py-3 text-center">
        <div className="text-[11px] text-fg-4">{t('hub.noChanges')}</div>
        <button onClick={onRefresh} className="mt-2 text-[11px] text-fg-3 hover:text-fg">{t('hub.refresh')}</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] text-fg-4">
        <span>{changes.length} {t('hub.changes')}</span>
        <button onClick={onRefresh} className="rounded px-1 py-0.5 text-fg-3 hover:bg-panel-h hover:text-fg">
          {t('hub.refresh')}
        </button>
      </div>
      <div className="space-y-px">
        <ChangeTreeLevel
          nodes={tree}
          depth={0}
          collapsedDirs={collapsedDirs}
          onToggleDir={toggleDir}
          onPreview={onPreview}
          onOpenPath={onOpenPath}
          t={t}
        />
      </div>
    </div>
  );
}

function ChangeTreeLevel({
  nodes,
  depth,
  collapsedDirs,
  onToggleDir,
  onPreview,
  onOpenPath,
  t,
}: {
  nodes: ChangeTreeNode[];
  depth: number;
  collapsedDirs: Set<string>;
  onToggleDir: (key: string) => void;
  onPreview: (path: string, mode?: PreviewMode) => void;
  onOpenPath: (path: string) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      {nodes.map(node => node.kind === 'dir' ? (
        <ChangeDirRow
          key={node.key}
          node={node}
          depth={depth}
          collapsedDirs={collapsedDirs}
          onToggleDir={onToggleDir}
          onPreview={onPreview}
          onOpenPath={onOpenPath}
          t={t}
        />
      ) : (
        <ChangeFileRow
          key={node.key}
          node={node}
          depth={depth}
          onPreview={onPreview}
          onOpenPath={onOpenPath}
          t={t}
        />
      ))}
    </>
  );
}

function ChangeDirRow({
  node,
  depth,
  collapsedDirs,
  onToggleDir,
  onPreview,
  onOpenPath,
  t,
}: {
  node: ChangeTreeDirNode;
  depth: number;
  collapsedDirs: Set<string>;
  onToggleDir: (key: string) => void;
  onPreview: (path: string, mode?: PreviewMode) => void;
  onOpenPath: (path: string) => void;
  t: (key: string) => string;
}) {
  const collapsed = collapsedDirs.has(node.key);
  const primary = primaryChangeStatus(node.statuses);
  const indent = depth * 14;

  return (
    <>
      <button
        onClick={() => onToggleDir(node.key)}
        className={cn(
          'group flex w-full items-center gap-1.5 rounded border-l-2 py-1.5 pr-2 text-left text-[11px] transition-colors',
          'text-fg-3 hover:bg-panel-h/60 hover:text-fg',
          !collapsed && 'bg-panel-h/20',
          changeStatusBorderClass(primary),
        )}
        style={{ paddingLeft: 8 + indent }}
        title={node.key}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn('shrink-0 text-fg-4 transition-transform duration-150', !collapsed && 'rotate-90')}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="shrink-0 text-fg-3">
          <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="currentColor" opacity="0.28" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="min-w-0 flex-1 truncate font-medium text-fg-2">{node.name}</span>
        <span className="shrink-0 rounded bg-panel-alt px-1 py-px text-[10px] tabular-nums text-fg-3">{node.count}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {node.statuses.map(status => (
            <span key={status} className={cn('h-1.5 w-1.5 rounded-full', changeStatusDotClass(status))} title={changeStatusLabel(status, t)} />
          ))}
        </span>
      </button>
      {!collapsed && (
        <ChangeTreeLevel
          nodes={node.children}
          depth={depth + 1}
          collapsedDirs={collapsedDirs}
          onToggleDir={onToggleDir}
          onPreview={onPreview}
          onOpenPath={onOpenPath}
          t={t}
        />
      )}
    </>
  );
}

function ChangeFileRow({
  node,
  depth,
  onPreview,
  onOpenPath,
  t,
}: {
  node: ChangeTreeFileNode;
  depth: number;
  onPreview: (path: string, mode?: PreviewMode) => void;
  onOpenPath: (path: string) => void;
  t: (key: string) => string;
}) {
  const { change } = node;
  const file = normalizeChangeFile(change);
  const indent = depth * 14;

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded border-l-2 py-1.5 pr-2 text-[11px] text-fg-3 transition-colors',
        'hover:bg-panel-h/50',
        changeStatusBorderClass(change.status),
      )}
      style={{ paddingLeft: 22 + indent }}
    >
      <button
        onClick={() => onPreview(change.path, 'file')}
        className="min-w-0 flex-1 text-left"
        title={file}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('shrink-0 rounded border px-1 py-px text-[9px] font-semibold leading-none', changeStatusClass(change.status))}>
            {changeStatusShort(change.status)}
          </span>
          <span className="truncate font-medium text-fg-2">{node.name}</span>
        </div>
      </button>
      <button
        onClick={() => onPreview(change.path, 'diff')}
        className="shrink-0 rounded border border-edge/70 bg-panel-alt px-1.5 py-0.5 text-[10px] font-medium text-fg-3 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
        title={t('hub.openDiff')}
      >
        {t('hub.diff')}
      </button>
      <button
        onClick={() => onOpenPath(change.path)}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-4 transition hover:bg-panel-h hover:text-fg"
        title={t('hub.open')}
        aria-label={t('hub.open')}
      >
        <OpenTargetIcon target="default" size={12} />
        <span className="whitespace-nowrap">{t('hub.open')}</span>
      </button>
    </div>
  );
}

type CodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'shell'
  | 'yaml'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'plain';
type CodeToken = { text: string; className?: string };

const CODE_KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'default', 'defer', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'final', 'finally', 'for', 'from', 'func', 'function', 'go', 'if',
  'implements', 'import', 'in', 'interface', 'let', 'match', 'new', 'nil', 'null',
  'package', 'private', 'protected', 'public', 'return', 'self', 'static',
  'struct', 'super', 'switch', 'this', 'throw', 'throws', 'trait', 'true', 'try',
  'type', 'var', 'void', 'while', 'yield',
]);

const LANGUAGE_BY_EXTENSION: Record<string, CodeLanguage> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
};

function inferCodeLanguage(filePath: string | undefined): CodeLanguage {
  const cleanPath = String(filePath || '').split('?')[0].toLowerCase();
  const name = cleanPath.split('/').pop() || '';
  if (name === 'dockerfile') return 'shell';
  if (name.endsWith('rc') || name.endsWith('ignore')) return 'shell';
  const ext = name.includes('.') ? name.split('.').pop() || '' : '';
  return LANGUAGE_BY_EXTENSION[ext] || 'plain';
}

function displayCodeLanguage(language: CodeLanguage): string {
  if (language === 'typescript') return 'TS';
  if (language === 'javascript') return 'JS';
  if (language === 'markdown') return 'MD';
  if (language === 'plain') return 'TEXT';
  return language.toUpperCase();
}

function findCommentIndex(line: string, language: CodeLanguage): number {
  const candidates: number[] = [];
  if (['typescript', 'javascript', 'java', 'go', 'rust'].includes(language)) {
    candidates.push(line.indexOf('//'));
  }
  if (['css', 'typescript', 'javascript', 'java', 'go', 'rust'].includes(language)) {
    candidates.push(line.indexOf('/*'));
  }
  if (language === 'html' || language === 'markdown') {
    candidates.push(line.indexOf('<!--'));
  }
  if (['shell', 'yaml', 'python', 'plain'].includes(language)) {
    candidates.push(line.indexOf('#'));
  }
  return candidates.filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
}

function codeTokenClass(token: string, after: string, language: CodeLanguage): string | undefined {
  if (!token.trim()) return undefined;
  const next = after.match(/^\s*(.)/)?.[1];
  if (/^(['"`])/.test(token)) {
    return next === ':' || language === 'json'
      ? 'text-[var(--th-code-property)]'
      : 'text-[var(--th-code-string)]';
  }
  if (/^\d/.test(token)) return 'text-[var(--th-code-number)]';
  if (CODE_KEYWORDS.has(token)) return 'font-semibold text-[var(--th-code-keyword)]';
  if (/^[A-Z][\w$]*$/.test(token)) return 'text-[var(--th-code-type)]';
  if (/^[{}()[\].,:;<>/=+\-*%!?|&]+$/.test(token)) return 'text-[var(--th-code-symbol)]';
  return undefined;
}

function tokenizeCodeInline(text: string, language: CodeLanguage): CodeToken[] {
  const tokens: CodeToken[] = [];
  const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$-]*|[{}()[\].,:;<>/=+\-*%!?|&]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) tokens.push({ text: text.slice(lastIndex, match.index) });
    const token = match[0];
    const after = text.slice(match.index + token.length);
    tokens.push({ text: token, className: codeTokenClass(token, after, language) });
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens;
}

function tokenizeCodeLine(line: string, language: CodeLanguage): CodeToken[] {
  if (!line) return [{ text: ' ' }];
  const commentIndex = findCommentIndex(line, language);
  if (commentIndex < 0) return tokenizeCodeInline(line, language);
  return [
    ...tokenizeCodeInline(line.slice(0, commentIndex), language),
    { text: line.slice(commentIndex), className: 'italic text-[var(--th-code-comment)]' },
  ];
}

function renderCodeText(text: string, language: CodeLanguage, extraClassName?: string) {
  return tokenizeCodeLine(text, language).map((token, index) => (
    <span key={index} className={cn(token.className, extraClassName)}>
      {token.text}
    </span>
  ));
}

type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'context';
type DiffSegment = { text: string; changed?: boolean };
type DiffRenderRow = {
  line: string;
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  segments?: DiffSegment[];
};

function isAdditionDiffLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++');
}

function isDeletionDiffLine(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('---');
}

function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (isAdditionDiffLine(line)) return 'add';
  if (isDeletionDiffLine(line)) return 'del';
  return 'context';
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string, prefixLength: number): number {
  const max = Math.min(a.length, b.length) - prefixLength;
  let index = 0;
  while (index < max && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
  return index;
}

function splitDiffSegments(text: string, prefixLength: number, suffixLength: number): DiffSegment[] {
  const middleEnd = text.length - suffixLength;
  return [
    { text: text.slice(0, prefixLength) },
    { text: text.slice(prefixLength, middleEnd), changed: true },
    { text: text.slice(middleEnd) },
  ].filter(segment => segment.text.length > 0);
}

function pairedDiffSegments(before: string, after: string): { before: DiffSegment[]; after: DiffSegment[] } {
  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, prefix);
  return {
    before: splitDiffSegments(before, prefix, suffix),
    after: splitDiffSegments(after, prefix, suffix),
  };
}

function parseDiffHunkStart(line: string): { oldLine: number; newLine: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function buildDiffRows(content: string): DiffRenderRow[] {
  const lines = content.split('\n');
  const rows: DiffRenderRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const kind = diffLineKind(line);

    if (kind === 'hunk') {
      const hunk = parseDiffHunkStart(line);
      if (hunk) {
        oldLine = hunk.oldLine;
        newLine = hunk.newLine;
      }
      rows.push({ line, kind });
      continue;
    }

    if (isDeletionDiffLine(line) && nextLine && isAdditionDiffLine(nextLine)) {
      const pair = pairedDiffSegments(line.slice(1), nextLine.slice(1));
      rows.push({ line, kind: 'del', oldLine, segments: pair.before });
      rows.push({ line: nextLine, kind: 'add', newLine, segments: pair.after });
      oldLine += 1;
      newLine += 1;
      index += 1;
      continue;
    }

    const row: DiffRenderRow = { line, kind };
    if (kind === 'del') {
      row.oldLine = oldLine;
      oldLine += 1;
    } else if (kind === 'add') {
      row.newLine = newLine;
      newLine += 1;
    } else if (kind === 'context' && oldLine > 0 && newLine > 0) {
      row.oldLine = oldLine;
      row.newLine = newLine;
      oldLine += 1;
      newLine += 1;
    }
    if (kind === 'add' || kind === 'del') {
      row.segments = [{ text: line.slice(1), changed: true }].filter(segment => segment.text.length > 0);
    }
    rows.push({
      ...row,
    });
  }

  return rows;
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-fg-4 bg-panel-h/40';
  if (line.startsWith('@@')) return 'text-primary bg-primary/10';
  if (isAdditionDiffLine(line)) return 'text-fg-2 bg-ok/10';
  if (isDeletionDiffLine(line)) return 'text-fg-2 bg-err/10';
  return 'text-fg-3';
}

function diffMarkerClass(kind: DiffLineKind): string {
  if (kind === 'add') return 'text-ok';
  if (kind === 'del') return 'text-err';
  return 'text-fg-4';
}

function diffChangedSegmentClass(kind: DiffLineKind): string {
  if (kind === 'add') return 'bg-ok/25 text-fg';
  if (kind === 'del') return 'bg-err/25 text-fg';
  return 'bg-primary/10 text-fg';
}

function CodeLineRow({
  line,
  lineNumber,
  language,
  highlight,
}: {
  line: string;
  lineNumber: number;
  language: CodeLanguage;
  highlight?: boolean;
}) {
  return (
    <div
      data-line-number={lineNumber}
      className={cn(
        'flex min-w-max px-3 text-fg-3 hover:bg-panel-h/25',
        highlight && 'bg-primary/15 text-fg',
      )}
    >
      <span className={cn('mr-3 w-10 shrink-0 select-none text-right text-fg-5', highlight && 'font-semibold text-primary')}>{lineNumber}</span>
      <span className="whitespace-pre">{renderCodeText(line, language)}</span>
    </div>
  );
}

function DiffLineRow({
  row,
  language,
}: {
  row: DiffRenderRow;
  language: CodeLanguage;
}) {
  const bodyLine = row.kind === 'add' || row.kind === 'del'
    ? row.line.slice(1)
    : row.kind === 'context' && row.line.startsWith(' ')
      ? row.line.slice(1)
      : row.line;
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : row.kind === 'context' ? ' ' : ' ';
  const tokenLanguage = row.kind === 'meta' || row.kind === 'hunk' ? 'plain' : language;

  return (
    <div className={cn('flex min-w-max px-3', diffLineClass(row.line))}>
      <span className={cn('mr-1 w-9 shrink-0 select-none text-right tabular-nums', row.kind === 'del' ? 'text-err' : 'text-fg-5')}>
        {row.oldLine ?? ''}
      </span>
      <span className={cn('mr-3 w-9 shrink-0 select-none text-right tabular-nums', row.kind === 'add' ? 'text-ok' : 'text-fg-5')}>
        {row.newLine ?? ''}
      </span>
      <span className={cn('mr-1 w-3 shrink-0 select-none text-center font-semibold', diffMarkerClass(row.kind))}>
        {marker}
      </span>
      <span className="whitespace-pre">
        {row.segments ? row.segments.map((segment, segmentIndex) => (
          <span key={segmentIndex} className={cn('whitespace-pre rounded-[2px]', segment.changed && diffChangedSegmentClass(row.kind))}>
            {renderCodeText(segment.text, language)}
          </span>
        )) : renderCodeText(bodyLine || ' ', tokenLanguage)}
      </span>
    </div>
  );
}

function CodePreviewPane({
  preview,
  onOpenPath,
  t,
}: {
  preview: PreviewState | null;
  onOpenPath: (path: string) => void;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const title = preview?.relativePath || (preview?.path ? preview.path.split('/').pop() : '') || t('hub.preview');
  const targetLine = preview?.mode === 'file' && preview.line && preview.line > 0 ? preview.line : null;
  const previewLanguage = useMemo(
    () => inferCodeLanguage(preview?.relativePath || preview?.path),
    [preview?.path, preview?.relativePath],
  );
  const diffRows = useMemo(
    () => preview?.mode === 'diff' && preview.content ? buildDiffRows(preview.content) : [],
    [preview?.content, preview?.mode],
  );
  const codeLines = useMemo(
    () => preview?.mode === 'file' ? (preview.content || '').split('\n') : [],
    [preview?.content, preview?.mode],
  );

  useEffect(() => {
    setCopied(false);
  }, [preview?.path, preview?.mode]);

  useEffect(() => {
    if (!targetLine || preview?.loading || preview?.error) return;
    const handle = window.requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-line-number="${targetLine}"]`);
      row?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [preview?.error, preview?.loading, preview?.path, targetLine]);

  if (!preview) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center text-[12px] text-fg-5">
        {t('hub.selectFile')}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 border-b border-edge/20 px-3 py-2">
        <span className="shrink-0 rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[10px] font-medium text-fg-4">
          {preview.mode === 'diff' ? t('hub.diff') : t('hub.preview')}
        </span>
        <span className="shrink-0 rounded border border-edge/70 bg-inset px-1.5 py-0.5 text-[10px] font-medium text-fg-4">
          {displayCodeLanguage(previewLanguage)}
        </span>
        <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3" title={preview.path}>
          {title}{targetLine ? `:${targetLine}` : ''}
        </div>
        {preview.truncated && <span className="shrink-0 text-[10px] text-warn">{t('hub.truncated')}</span>}
        <button
          onClick={() => onOpenPath(preview.path)}
          className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-5 hover:bg-panel-h hover:text-fg-2"
        >
          {t('hub.open')}
        </button>
        {!!preview.content && (
          <button
            onClick={() => navigator.clipboard.writeText(preview.content || '').then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {})}
            className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-5 hover:bg-panel-h hover:text-fg-2"
          >
            {copied ? t('hub.copied') : t('hub.copy')}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-inset/30">
        {preview.loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-4 w-4 text-fg-5" />
          </div>
        ) : preview.error ? (
          <div className="p-4 text-[12px] text-err">{preview.error}</div>
        ) : preview.mode === 'diff' ? (
          preview.content ? (
            <pre className="min-w-full py-2 text-[11px] leading-[18px] font-mono">
              {diffRows.map((row, index) => <DiffLineRow key={index} row={row} language={previewLanguage} />)}
            </pre>
          ) : (
            <div className="p-4 text-[12px] text-fg-5">{t('hub.noChanges')}</div>
          )
        ) : (
          <pre className="min-w-full py-2 font-mono text-[11px] leading-[18px]">
            {codeLines.map((line, index) => (
              <CodeLineRow key={index} line={line} lineNumber={index + 1} language={previewLanguage} highlight={targetLine === index + 1} />
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function OpenTargetIcon({ target, size = 16 }: { target: OpenTarget; size?: number; subtle?: boolean }) {
  if (target === 'default') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
        <path d="M9 2h5v5" />
        <path d="M14 2L7 9" />
      </svg>
    );
  }
  return <BrandIcon brand={target} size={size} />;
}

function normalizeComparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathsEqual(a: string, b: string): boolean {
  return !!a && !!b && normalizeComparablePath(a) === normalizeComparablePath(b);
}

/* ── Lazy-loading File Tree ── */
interface TreeNode {
  entry: DirEntry;
  expanded: boolean;
  children: TreeNode[] | null;
  loading: boolean;
}

function FileTree({
  basePath,
  includeHidden = false,
  openTarget,
  selectedPath,
  onOpenPath,
  onPreviewPath,
  t,
}: {
  basePath: string;
  includeHidden?: boolean;
  openTarget: OpenTarget;
  selectedPath?: string | null;
  onOpenPath: (path: string) => void;
  onPreviewPath: (path: string, mode?: PreviewMode) => void;
  t: (key: string) => string;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRootLoading(true);
    api.lsDir(basePath, true, includeHidden)
      .then(res => {
        if (!cancelled && res.ok) {
          setNodes(res.dirs.slice(0, 50).map(e => ({ entry: e, expanded: false, children: null, loading: false })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRootLoading(false); });
    return () => { cancelled = true; };
  }, [basePath, includeHidden]);

  const toggleDir = useCallback((targetPath: string) => {
    const toggle = (list: TreeNode[]): TreeNode[] =>
      list.map(n => {
        if (n.entry.path === targetPath) {
          if (n.expanded) return { ...n, expanded: false };
          if (n.children === null) {
            api.lsDir(targetPath, true, includeHidden)
              .then(res => {
                if (res.ok) {
                  setNodes(prev => updateNode(prev, targetPath, {
                    children: res.dirs.slice(0, 50).map(e => ({ entry: e, expanded: false, children: null, loading: false })),
                    loading: false,
                  }));
                }
              })
              .catch(() => {
                setNodes(prev => updateNode(prev, targetPath, { children: [], loading: false }));
              });
            return { ...n, loading: true, expanded: true };
          }
          return { ...n, expanded: true };
        }
        if (n.children) return { ...n, children: toggle(n.children) };
        return n;
      });
    setNodes(prev => toggle(prev));
  }, [includeHidden]);

  if (rootLoading) return <div className="flex justify-center py-3"><Spinner className="h-3 w-3 text-fg-5" /></div>;
  if (nodes.length === 0) return <div className="py-3 text-center text-[11px] text-fg-5">—</div>;
  return <div className="space-y-px"><TreeLevel nodes={nodes} depth={0} selectedPath={selectedPath} onToggle={toggleDir} openTarget={openTarget} onOpenPath={onOpenPath} onPreviewPath={onPreviewPath} t={t} /></div>;
}

function TreeLevel({ nodes, depth, selectedPath, onToggle, openTarget, onOpenPath, onPreviewPath, t }: {
  nodes: TreeNode[];
  depth: number;
  selectedPath?: string | null;
  onToggle: (path: string) => void;
  openTarget: OpenTarget;
  onOpenPath: (path: string) => void;
  onPreviewPath: (path: string, mode?: PreviewMode) => void;
  t: (key: string) => string;
}) {
  return <>{nodes.map(node => <TreeItem key={node.entry.path} node={node} depth={depth} selectedPath={selectedPath} onToggle={onToggle} openTarget={openTarget} onOpenPath={onOpenPath} onPreviewPath={onPreviewPath} t={t} />)}</>;
}

function TreeItem({ node, depth, selectedPath, onToggle, openTarget, onOpenPath, onPreviewPath, t }: {
  node: TreeNode;
  depth: number;
  selectedPath?: string | null;
  onToggle: (path: string) => void;
  openTarget: OpenTarget;
  onOpenPath: (path: string) => void;
  onPreviewPath: (path: string, mode?: PreviewMode) => void;
  t: (key: string) => string;
}) {
  const { entry, expanded, children, loading } = node;
  const indent = depth * 14;
  const [hovered, setHovered] = useState(false);
  const openTargetLabel = t(targetLabelKey(openTarget));
  const openTitle = t('hub.openWithTarget').replace('{target}', openTargetLabel);
  const selected = !entry.isDir && pathsEqual(entry.path, selectedPath || '');

  return (
    <>
      <div
        onClick={entry.isDir ? () => onToggle(entry.path) : () => onPreviewPath(entry.path, 'file')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'flex items-center gap-1.5 py-1 rounded text-[11px] text-fg-3 transition-colors',
          'hover:bg-panel-h/50 cursor-pointer',
          selected && 'bg-primary/10 text-fg-2 ring-1 ring-inset ring-primary/25',
        )}
        style={{ paddingLeft: 8 + indent, paddingRight: 8 }}
      >
        {entry.isDir ? (
          loading ? <Spinner className="h-2 w-2 text-fg-5 shrink-0" /> : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={cn('shrink-0 text-fg-5/40 transition-transform duration-150', expanded && 'rotate-90')}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          )
        ) : <span className="w-2 shrink-0" />}

        {entry.isDir ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 text-blue-400/70">
            <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-fg-5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
        )}

        <span className="truncate flex-1">{entry.name}</span>

        {hovered && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); onOpenPath(entry.path); }}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-fg-5 hover:text-blue-400 transition-colors"
              title={openTitle}
            >
              <OpenTargetIcon target={openTarget} subtle />
            </button>
            {!entry.isDir && <CopyPathButton filePath={entry.path} t={t} />}
          </div>
        )}
      </div>
      {entry.isDir && expanded && children && children.length > 0 && (
        <TreeLevel nodes={children} depth={depth + 1} selectedPath={selectedPath} onToggle={onToggle} openTarget={openTarget} onOpenPath={onOpenPath} onPreviewPath={onPreviewPath} t={t} />
      )}
    </>
  );
}

function CopyPathButton({ filePath, t }: { filePath: string; t: (key: string) => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(filePath).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className={cn('p-0.5 rounded transition-colors', copied ? 'text-ok' : 'text-fg-5 hover:text-fg-3')}
      title={t('hub.copied')}
    >
      {copied
        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      }
    </button>
  );
}

/* ── Helper: update a node deep in the tree by path ── */
function updateNode(nodes: TreeNode[], targetPath: string, patch: Partial<TreeNode>): TreeNode[] {
  return nodes.map(n => {
    if (n.entry.path === targetPath) return { ...n, ...patch };
    if (n.children) return { ...n, children: updateNode(n.children, targetPath, patch) };
    return n;
  });
}
