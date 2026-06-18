import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useStore } from './store';
import { createT } from './i18n';
import { Sidebar, type RestartPhase } from './components/Sidebar';
import { Spinner, Toasts } from './components/ui';
import { BrowserPanelModal } from './components/BrowserPanelModal';
import { api } from './api';
import { notificationEventEnabled } from './notification-preferences';
import { showBrowserNotification } from './browser-notifications';
import { getDashboardTabMeta, type DashboardTab } from './tabs';
import { cn } from './utils';
import { useDashboardEvent } from './ws';
import type { BrowserPanelSnapshot } from './types';
import { normalizeWorkItemDateParam } from './pages/wayland/workItemModel';

const SessionsTab = lazy(async () => ({ default: (await import('./pages/sessions')).SessionWorkspace }));
const AgentTab = lazy(() => import('./pages/agents/AgentTab'));
const UsageTab = lazy(async () => ({ default: (await import('./pages/usage/UsageTab')).UsageTab }));
const TasksTab = lazy(async () => ({ default: (await import('./pages/jira/JiraTab')).TasksTab }));
const NotesTab = lazy(async () => ({ default: (await import('./pages/notes')).NotesWorkspace }));
const IMAccessTab = lazy(async () => ({ default: (await import('./pages/im/IMAccessTab')).IMAccessTab }));
const ExtensionsTab = lazy(async () => ({ default: (await import('./pages/extensions/ExtensionsTab')).ExtensionsTab }));
const SystemTab = lazy(async () => ({ default: (await import('./pages/system/SystemTab')).SystemTab }));
const TelegramModal = lazy(async () => ({ default: (await import('./components/Modals')).TelegramModal }));
const FeishuModal = lazy(async () => ({ default: (await import('./components/Modals')).FeishuModal }));
const WeixinModal = lazy(async () => ({ default: (await import('./components/Modals')).WeixinModal }));
const SlackModal = lazy(async () => ({ default: (await import('./components/Modals')).SlackModal }));
const DiscordModal = lazy(async () => ({ default: (await import('./components/Modals')).DiscordModal }));
const DingtalkModal = lazy(async () => ({ default: (await import('./components/Modals')).DingtalkModal }));
const WeComModal = lazy(async () => ({ default: (await import('./components/Modals')).WeComModal }));
const WorkdirModal = lazy(async () => ({ default: (await import('./components/Modals')).WorkdirModal }));
const BrowserSetupModal = lazy(async () => ({ default: (await import('./components/Modals')).BrowserSetupModal }));
const WaylandShell = lazy(async () => ({ default: (await import('./pages/wayland/WaylandShell')).WaylandShell }));

type ModalState =
  | null
  | { type: 'weixin' }
  | { type: 'telegram' }
  | { type: 'feishu' }
  | { type: 'slack' }
  | { type: 'discord' }
  | { type: 'dingtalk' }
  | { type: 'wecom' }
  | { type: 'workdir' }
  | { type: 'browser-setup' };

type HoveredLinkState = {
  href: string;
  x: number;
  y: number;
};

type ChatPanelRedirectTarget = 'assistants' | 'memory' | 'team' | 'workflows';
type DashboardShellMode = 'wayland' | 'classic';

const DASHBOARD_SHELL_MODE_STORAGE_KEY = 'pikiclaw:dashboard-shell-mode';

function readDashboardShellMode(): DashboardShellMode {
  try {
    const stored = localStorage.getItem(DASHBOARD_SHELL_MODE_STORAGE_KEY);
    if (stored === 'wayland' || stored === 'classic') return stored;
  } catch {}
  return 'wayland';
}

function readStreamNotificationSnapshot(snapshot: unknown): {
  phase: string | null;
  incomplete: boolean;
  error: string | null;
} | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const value = snapshot as Record<string, unknown>;
  const phase = typeof value.phase === 'string' ? value.phase : null;
  const error = typeof value.error === 'string' && value.error.trim() ? value.error.trim() : null;
  return {
    phase,
    incomplete: Boolean(value.incomplete) || Boolean(error),
    error,
  };
}

function chatPanelRedirectState(panel: ChatPanelRedirectTarget) {
  return { openChatPanel: panel, openChatPanelNonce: Date.now() };
}

function chatProjectPickerRedirectState(previousState?: unknown) {
  const previous = previousState && typeof previousState === 'object'
    ? previousState as Record<string, unknown>
    : {};
  return { ...previous, openChatProjectPicker: true, openChatProjectPickerNonce: Date.now() };
}

function locationToTab(pathname: string): DashboardTab {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return 'notes';
  const map: Record<string, DashboardTab> = {
    '/': 'sessions',
    '/chat': 'sessions',
    '/conversations': 'sessions',
    '/search': 'sessions',
    '/project': 'sessions',
    '/projects': 'sessions',
    '/sessions': 'sessions',
    '/workspace': 'sessions',
    '/focus': 'sessions',
    '/chat-workspace': 'sessions',
    '/workbench': 'dashboard',
    '/dashboard': 'dashboard',
    '/tasks': 'dashboard',
    '/work-items': 'dashboard',
    '/task-diagnostics': 'dashboard',
    '/daily': 'dashboard',
    '/notes': 'notes',
    '/knowledge': 'knowledge',
    '/memory': 'knowledge',
    '/mission-control': 'dashboard',
    '/workflows': 'workflows',
    '/scheduled-tasks': 'workflows',
    '/jira': 'dashboard',
    '/usage': 'usage',
    '/archive': 'system',
    '/im': 'im',
    '/channels': 'im',
    '/agents': 'agents',
    '/assistants': 'assistants',
    '/team': 'team',
    '/extensions': 'extensions',
    '/skills': 'extensions',
    '/permissions': 'system',
    '/settings': 'system',
    '/system': 'system',
  };
  return map[pathname] || 'sessions';
}

function isWaylandShellPath(pathname: string): boolean {
  if (pathname === '/project' || pathname.startsWith('/project/')) return true;
  if (pathname === '/conversations/session') return true;
  return [
    '/',
    '/chat',
    '/conversations',
    '/search',
    '/projects',
    '/work-items',
    '/assistants',
    '/workflows',
    '/scheduled-tasks',
    '/team',
    '/memory',
    '/knowledge',
    '/workbench',
    '/dashboard',
    '/mission-control',
    '/channels',
    '/im',
    '/extensions',
    '/skills',
    '/settings',
    '/system',
  ].includes(pathname);
}

function dailyWorkItemsRedirect(search: string): string {
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  next.set('source', 'manual');
  const date = normalizeWorkItemDateParam(params.get('date'));
  if (date) next.set('date', date);
  return `/work-items?${next.toString()}`;
}

function normalizeDashboardPath(pathname: string): string | null {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return pathname;
  if (pathname === '/') return '/chat';
  if (pathname === '/chat') return '/chat';
  if (pathname === '/conversations/session') return pathname;
  if (pathname === '/sessions') return '/chat';
  if (pathname === '/workspace') return '/chat-workspace';
  if (pathname === '/focus') return '/chat-workspace';
  if (pathname === '/chat-workspace') return '/chat-workspace';
  if (pathname === '/permissions') return '/system';
  if (pathname === '/archive') return '/system';
  if (pathname === '/workbench') return '/workbench';
  if (pathname === '/dashboard') return '/workbench';
  if (pathname === '/jira') return '/task-diagnostics';
  if (pathname === '/tasks') return '/work-items';
  if (pathname === '/skills') return '/extensions';
  if (pathname === '/project' || pathname.startsWith('/project/')) return pathname;
  if (pathname === '/daily') return '/work-items';
  if (['/chat', '/conversations', '/search', '/projects', '/workbench', '/dashboard', '/task-diagnostics', '/notes', '/knowledge', '/memory', '/mission-control', '/work-items', '/workflows', '/scheduled-tasks', '/usage', '/im', '/channels', '/agents', '/assistants', '/team', '/extensions', '/settings', '/system'].includes(pathname)) return pathname;
  return null;
}

function PageWrapper({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] px-5 py-3">
        <div className="mb-3 border-b border-edge pb-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
            {description && <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">{description}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-fg-4">
        <Spinner />
        Loading...
      </div>
    </div>
  );
}

function DashboardShellModeButton({
  mode,
  locale,
  offsetForClassicHeader,
  onClick,
}: {
  mode: DashboardShellMode;
  locale: string;
  offsetForClassicHeader: boolean;
  onClick: () => void;
}) {
  const switchingToClassic = mode === 'wayland';
  const label = locale === 'zh-CN'
    ? (switchingToClassic ? '原始模式' : '新模式')
    : (switchingToClassic ? 'Classic' : 'New mode');
  const title = locale === 'zh-CN'
    ? (switchingToClassic ? '切换到原来的模式' : '切换到新模式')
    : (switchingToClassic ? 'Switch to classic mode' : 'Switch to new mode');
  const eyebrow = locale === 'zh-CN' ? '模式' : 'Mode';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'group fixed right-0 z-[86] h-[58px] w-[72px] overflow-hidden text-left text-fg-3 transition-[width,transform,filter] duration-300 ease-out hover:w-[176px] hover:-translate-x-1 hover:text-fg focus-visible:w-[176px] focus-visible:-translate-x-1 focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)] active:translate-y-px',
        offsetForClassicHeader ? 'top-[68px]' : 'top-0',
      )}
      style={{
        clipPath: 'polygon(24px 0, 100% 0, 100% 100%, 0 100%)',
      }}
    >
      <span className="absolute inset-0 bg-[var(--th-surface)]" />
      <span className="absolute inset-0 border-b border-l border-edge/75 bg-panel shadow-[0_18px_42px_rgba(2,6,23,0.18)] backdrop-blur-xl transition-colors duration-300 group-hover:border-primary/35 group-hover:bg-panel-h" />
      <span className="absolute left-0 top-0 h-full w-8 bg-gradient-to-br from-transparent via-white/10 to-transparent opacity-70 transition-transform duration-300 group-hover:translate-x-2" />
      <span className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-white/10 opacity-60" />
      <span className="relative z-10 flex h-full items-center justify-end gap-2 pl-8 pr-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/[0.08] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] transition-transform duration-300 group-hover:-translate-x-1 group-hover:scale-105 group-hover:rotate-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {switchingToClassic ? (
              <>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M8 5v14" />
                <path d="M6 9h.01" />
                <path d="M6 12h.01" />
                <path d="M6 15h.01" />
              </>
            ) : (
              <>
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M8 9h8" />
                <path d="M8 13h5" />
                <path d="M15 15l2 2 3-4" />
              </>
            )}
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 translate-x-4 flex-col leading-none opacity-0 transition-[opacity,transform] duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
          <span className="text-[9px] font-semibold text-fg-5">{eyebrow}</span>
          <span className="mt-1 truncate text-[12px] font-semibold text-fg">{label}</span>
        </span>
      </span>
    </button>
  );
}

function HoverLinkCopyButton({ t, toast }: { t: (key: string) => string; toast: (message: string, ok?: boolean) => void }) {
  const [hovered, setHovered] = useState<HoveredLinkState | null>(null);
  const [copiedHref, setCopiedHref] = useState<string | null>(null);
  const activeLinkRef = useRef<Element | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      activeLinkRef.current = null;
      setHovered(null);
      setCopiedHref(null);
      hideTimerRef.current = null;
    }, 140);
  }, [clearHideTimer]);

  const positionForLink = useCallback((link: Element, href: string) => {
    const rect = link.getBoundingClientRect();
    const buttonSize = 22;
    const gap = 6;
    const canSitRight = rect.right + gap + buttonSize <= window.innerWidth - 8;
    const x = canSitRight
      ? rect.right + gap
      : Math.min(window.innerWidth - buttonSize - 8, Math.max(8, rect.left));
    const y = canSitRight
      ? rect.top + (rect.height - buttonSize) / 2
      : rect.top - buttonSize - 4;
    setHovered({ href, x, y });
  }, []);

  useEffect(() => {
    const readCopyTarget = (element: Element | null): { link: Element; href: string } | null => {
      const link = element?.closest('[data-chat-output-copy="true"]');
      if (!link) return null;
      const href = link instanceof HTMLAnchorElement
        ? link.getAttribute('href') || ''
        : link.getAttribute('data-copy-path') || '';
      if (!href || href.startsWith('javascript:')) return null;
      return { link, href };
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const copyTarget = readCopyTarget(target);
      if (!copyTarget) return;
      clearHideTimer();
      if (activeLinkRef.current !== copyTarget.link) setCopiedHref(null);
      activeLinkRef.current = copyTarget.link;
      positionForLink(copyTarget.link, copyTarget.href);
    };

    const onMouseMove = (event: MouseEvent) => {
      const active = activeLinkRef.current;
      if (!active) return;
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !active.contains(target)) return;
      const href = active instanceof HTMLAnchorElement
        ? active.getAttribute('href') || ''
        : active.getAttribute('data-copy-path') || '';
      if (href) positionForLink(active, href);
    };

    const onMouseOut = (event: MouseEvent) => {
      const active = activeLinkRef.current;
      if (!active) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target && !active.contains(target)) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && (active.contains(next) || buttonRef.current?.contains(next))) return;
      scheduleHide();
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    window.addEventListener('scroll', scheduleHide, true);
    window.addEventListener('resize', scheduleHide);
    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('scroll', scheduleHide, true);
      window.removeEventListener('resize', scheduleHide);
      clearHideTimer();
    };
  }, [clearHideTimer, positionForLink, scheduleHide]);

  const copyLink = useCallback(() => {
    if (!hovered?.href) return;
    void navigator.clipboard.writeText(hovered.href)
      .then(() => setCopiedHref(hovered.href))
      .catch(() => toast('Copy failed', false));
  }, [hovered?.href, toast]);

  if (!hovered) return null;
  const copied = copiedHref === hovered.href;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={cn(
        'fixed z-[9500] inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border shadow-[0_6px_18px_rgba(2,6,23,0.18)] ring-1 ring-white/[0.04] backdrop-blur transition-[border-color,background,color,transform] hover:-translate-y-px',
        copied
          ? 'border-ok/45 bg-ok/[0.12] text-ok'
          : 'border-edge/70 bg-panel/95 text-fg-5 hover:border-primary/45 hover:bg-panel-h hover:text-primary',
      )}
      style={{ left: hovered.x, top: hovered.y }}
      aria-label={copied ? t('hub.copied') : t('ext.copyPath')}
      title={copied ? t('hub.copied') : t('ext.copyPath')}
      onMouseEnter={clearHideTimer}
      onMouseLeave={scheduleHide}
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        copyLink();
      }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function App() {
  // Granular selectors -- each subscription triggers re-render only when its slice changes.
  // Actions (toast, reload) are stable refs and never cause re-renders.
  const state = useStore(s => s.state);
  const toasts = useStore(s => s.toasts);
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const reload = useStore(s => s.reload);

  const location = useLocation();
  const navigate = useNavigate();
  const tab = locationToTab(location.pathname);
  const normalizedDashboardPath = normalizeDashboardPath(location.pathname);
  const waylandShellPath = isWaylandShellPath(location.pathname);
  const [dashboardShellMode, setDashboardShellModeState] = useState<DashboardShellMode>(readDashboardShellMode);
  const waylandShellActive = dashboardShellMode === 'wayland' && waylandShellPath;
  const sessionShellActive = !waylandShellActive && normalizedDashboardPath !== null;
  const sessionWorkspaceMode = tab === 'dashboard'
    ? 'dashboard'
    : location.pathname === '/chat-workspace'
      ? 'chat-workspace'
    : tab === 'sessions'
      ? 'workspace'
      : 'settings';
  const workspaceImmersive = sessionShellActive;
  const [sessionsTabReady, setSessionsTabReady] = useState(sessionShellActive);
  const [browserSnapshot, setBrowserSnapshot] = useState<BrowserPanelSnapshot | null>(null);
  const [browserUrlDraft, setBrowserUrlDraft] = useState('');
  const [browserTypeDraft, setBrowserTypeDraft] = useState('');
  const [browserBusy, setBrowserBusy] = useState(false);
  const streamNotificationPhasesRef = useRef<Record<string, string | null>>({});

  const t = useMemo(() => createT(locale), [locale]);
  const [modal, setModal] = useState<ModalState>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const setDashboardShellMode = useCallback((mode: DashboardShellMode) => {
    setDashboardShellModeState(mode);
    try { localStorage.setItem(DASHBOARD_SHELL_MODE_STORAGE_KEY, mode); } catch {}
  }, []);
  const toggleDashboardShellMode = useCallback(() => {
    const nextMode: DashboardShellMode = dashboardShellMode === 'wayland' ? 'classic' : 'wayland';
    setDashboardShellMode(nextMode);
    toast(
      locale === 'zh-CN'
        ? (nextMode === 'classic' ? '已切换到原始模式' : '已切换到新模式')
        : (nextMode === 'classic' ? 'Switched to classic mode' : 'Switched to new mode'),
    );
  }, [dashboardShellMode, locale, setDashboardShellMode, toast]);

  const version = state?.version || '...';

  useDashboardEvent('scheduled-task', useCallback((event) => {
    if (!notificationEventEnabled(state?.config?.notifications, 'scheduledTask')) return;
    if (event.status === 'queued') return;
    const fallbackName = locale === 'zh-CN' ? '计划任务' : 'Scheduled task';
    const name = typeof event.name === 'string' && event.name.trim() ? event.name.trim() : fallbackName;
    if (event.status === 'failed') {
      const message = locale === 'zh-CN'
        ? `计划任务失败：${name}`
        : `Scheduled task failed: ${name}`;
      toast(message, false);
      showBrowserNotification(state?.config?.notifications, 'scheduledTask', {
        title: locale === 'zh-CN' ? 'Pikiclaw 计划任务失败' : 'Pikiclaw scheduled task failed',
        body: message,
        tag: `scheduled-task:${event.automationId || name}:failed`,
        requireInteraction: true,
      });
      return;
    }
    const message = locale === 'zh-CN'
      ? `计划任务已完成：${name}`
      : `Scheduled task completed: ${name}`;
    toast(message);
    showBrowserNotification(state?.config?.notifications, 'scheduledTask', {
      title: locale === 'zh-CN' ? 'Pikiclaw 计划任务完成' : 'Pikiclaw scheduled task completed',
      body: message,
      tag: `scheduled-task:${event.automationId || name}:completed`,
    });
  }, [locale, state?.config?.notifications, toast]));

  useDashboardEvent('channel-message', useCallback((event) => {
    if (!notificationEventEnabled(state?.config?.notifications, 'channelMessage')) return;
    const rawChannel = typeof event.channel === 'string' && event.channel.trim() ? event.channel.trim() : 'IM';
    const channel = rawChannel.slice(0, 1).toUpperCase() + rawChannel.slice(1);
    const message = locale === 'zh-CN'
      ? `${channel} 有新消息`
      : `New ${channel} message`;
    toast(message);
    showBrowserNotification(state?.config?.notifications, 'channelMessage', {
      title: locale === 'zh-CN' ? 'Pikiclaw 新渠道消息' : 'Pikiclaw channel message',
      body: message,
      tag: `channel-message:${event.channel || 'im'}:${event.chatId || event.taskId || 'latest'}`,
    });
  }, [locale, state?.config?.notifications, toast]));

  useDashboardEvent('stream-update', useCallback((event) => {
    const key = event.key || '';
    if (!key) return;
    const current = readStreamNotificationSnapshot(event.snapshot ?? null);
    const previousPhase = streamNotificationPhasesRef.current[key] ?? null;
    if (current?.phase === 'done' && previousPhase !== 'done') {
      const notificationKey = current.incomplete ? 'agentError' : 'agentFinished';
      const title = current.incomplete
        ? (locale === 'zh-CN' ? 'Pikiclaw 任务需要注意' : 'Pikiclaw agent needs attention')
        : (locale === 'zh-CN' ? 'Pikiclaw 任务完成' : 'Pikiclaw agent finished');
      const body = current.incomplete
        ? (current.error || key)
        : key;
      showBrowserNotification(state?.config?.notifications, notificationKey, {
        title,
        body,
        tag: `stream:${key}:${current.incomplete ? 'error' : 'done'}`,
        requireInteraction: current.incomplete,
      });
    }
    streamNotificationPhasesRef.current[key] = current?.phase ?? null;
  }, [locale, state?.config?.notifications]));

  const openBrowserPanel = useCallback(async (url: string) => {
    const targetUrl = url.trim();
    if (!targetUrl) return;
    setBrowserBusy(true);
    try {
      const result = await api.openBrowserPanelSession(targetUrl);
      if (!result.ok || !result.snapshot) throw new Error(result.error || 'Failed to open browser');
      setBrowserSnapshot(result.snapshot);
      setBrowserUrlDraft(result.snapshot.url || targetUrl);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to open browser', false);
    } finally {
      setBrowserBusy(false);
    }
  }, [toast]);

  const runBrowserAction = useCallback(async (
    action: { action: 'navigate'; url: string } | { action: 'reload' } | { action: 'click'; xRatio: number; yRatio: number } | { action: 'type'; text: string },
  ) => {
    if (!browserSnapshot) return;
    setBrowserBusy(true);
    try {
      const result = await api.browserPanelAction(browserSnapshot.id, action);
      if (!result.ok || !result.snapshot) throw new Error(result.error || 'Browser action failed');
      setBrowserSnapshot(result.snapshot);
      setBrowserUrlDraft(result.snapshot.url);
      if (action.action === 'type') setBrowserTypeDraft('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Browser action failed', false);
    } finally {
      setBrowserBusy(false);
    }
  }, [browserSnapshot, toast]);

  const closeBrowserPanel = useCallback(() => {
    const id = browserSnapshot?.id;
    setBrowserSnapshot(null);
    setBrowserTypeDraft('');
    if (id) void api.closeBrowserPanelSession(id).catch(() => {});
  }, [browserSnapshot?.id]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.dataset.externalBrowser === 'true') return;
      const href = anchor.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      void openBrowserPanel(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [openBrowserPanel]);

  useEffect(() => {
    if (sessionShellActive) setSessionsTabReady(true);
  }, [sessionShellActive]);

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/chat', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/sessions') {
      navigate('/chat', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/workspace') {
      navigate('/chat-workspace', { replace: true, state: chatProjectPickerRedirectState(location.state) });
      return;
    }
    if (location.pathname === '/focus' || location.pathname === '/chat-workspace') {
      if (location.pathname === '/focus') navigate('/chat-workspace', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/tasks') {
      navigate('/work-items', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/daily') {
      navigate(dailyWorkItemsRedirect(location.search), { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/dashboard') {
      navigate('/workbench', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/jira') {
      navigate('/task-diagnostics', { replace: true });
      return;
    }
  }, [location.pathname, location.search, location.state, navigate]);

  // Restart: phase-based overlay
  const [restartPhase, setRestartPhase] = useState<RestartPhase>(null);

  const onRestartClick = useCallback(() => {
    if (restartPhase === 'restarting' || restartPhase === 'reconnecting') return;
    if ((state?.bot?.activeTasks || 0) > 0) {
      toast(t('modal.restartBlockedByTasks'), false);
      setRestartPhase(null);
      return;
    }
    if (restartPhase === 'confirm') {
      // Confirmed — fire restart
      setRestartPhase('restarting');
      (async () => {
        try {
          const result = await api.restart();
          if (!result.ok) {
            toast(result.activeTasks ? t('modal.restartBlockedByTasks') : (result.error || t('modal.restartFailed')), false);
            setRestartPhase(null);
            return;
          }
          setRestartPhase('reconnecting');
          let recovered = false;
          for (let i = 0; i < 90; i++) {
            await new Promise(r => setTimeout(r, 800));
            try {
              const health = await api.health({ timeoutMs: 3000 });
              if (health.ok) { recovered = true; break; }
            } catch {}
          }
          if (recovered) {
            try { await reload(); } catch {}
            toast(t('modal.restartSuccess'));
          } else {
            toast(t('modal.restartFailed'), false);
          }
        } catch {
          toast(t('modal.restartFailed'), false);
        }
        setRestartPhase(null);
      })();
    } else {
      setRestartPhase('confirm');
      setTimeout(() => setRestartPhase(p => (p === 'confirm' ? null : p)), 3000);
    }
  }, [restartPhase, state?.bot?.activeTasks, toast, t, reload]);

  const tabMeta = getDashboardTabMeta(tab, t);
  const settingsContent: ReactNode = tab === 'sessions' || tab === 'dashboard'
    ? null
    : (
      <Routes>
        <Route path="/im" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <IMAccessTab
              onOpenWeixin={() => setModal({ type: 'weixin' })}
              onOpenTelegram={() => setModal({ type: 'telegram' })}
              onOpenFeishu={() => setModal({ type: 'feishu' })}
              onOpenSlack={() => setModal({ type: 'slack' })}
              onOpenDiscord={() => setModal({ type: 'discord' })}
              onOpenDingtalk={() => setModal({ type: 'dingtalk' })}
              onOpenWeCom={() => setModal({ type: 'wecom' })}
            />
          </PageWrapper>
        } />
        <Route path="/agents" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <AgentTab />
          </PageWrapper>
        } />
        <Route path="/assistants" element={<Navigate to="/chat" replace state={chatPanelRedirectState('assistants')} />} />
        <Route path="/team" element={<Navigate to="/chat" replace state={chatPanelRedirectState('team')} />} />
        <Route path="/workflows" element={<Navigate to="/chat" replace state={chatPanelRedirectState('workflows')} />} />
        <Route path="/scheduled-tasks" element={<Navigate to="/chat" replace state={chatPanelRedirectState('workflows')} />} />
        <Route path="/usage" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <UsageTab />
          </PageWrapper>
        } />
        <Route path="/notes" element={<NotesTab />} />
        <Route path="/notes/:pageId" element={<NotesTab />} />
        <Route path="/knowledge" element={<Navigate to="/chat" replace state={chatPanelRedirectState('memory')} />} />
        <Route path="/memory" element={<Navigate to="/chat" replace state={chatPanelRedirectState('memory')} />} />
        <Route path="/jira" element={<Navigate to="/task-diagnostics" replace />} />
        <Route path="/dashboard" element={<Navigate to="/task-diagnostics" replace />} />
        <Route path="/channels" element={<Navigate to="/im" replace />} />
        <Route path="/archive" element={<Navigate to="/system?view=archive" replace />} />
        <Route path="/permissions" element={<Navigate to="/system" replace />} />
        <Route path="/extensions" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <ExtensionsTab onOpenBrowserSetup={() => setModal({ type: 'browser-setup' })} />
          </PageWrapper>
        } />
        <Route path="/skills" element={<Navigate to="/extensions" replace />} />
        <Route path="/settings" element={<Navigate to="/system" replace />} />
        <Route path="/system" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <SystemTab onOpenWorkdir={() => setModal({ type: 'workdir' })} />
          </PageWrapper>
        } />
      </Routes>
    );

  return (
    <div className="noise-overlay">
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ contain: 'strict' }}>
        <div className="app-ambient absolute inset-0" />
        <div className="grid-bg absolute inset-0 opacity-45" />
      </div>

      <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden">
        {!waylandShellActive && (
          <Sidebar
            version={version}
            restartPhase={restartPhase}
            onRestartClick={onRestartClick}
            immersive={workspaceImmersive}
          />
        )}
        <main className="min-h-0 flex-1 overflow-hidden">
          {waylandShellActive ? (
            <Suspense fallback={<RouteFallback />}>
              <WaylandShell
                version={version}
                restartPhase={restartPhase}
                onRestartClick={onRestartClick}
                onOpenWeixin={() => setModal({ type: 'weixin' })}
                onOpenTelegram={() => setModal({ type: 'telegram' })}
                onOpenFeishu={() => setModal({ type: 'feishu' })}
                onOpenSlack={() => setModal({ type: 'slack' })}
                onOpenDiscord={() => setModal({ type: 'discord' })}
                onOpenDingtalk={() => setModal({ type: 'dingtalk' })}
                onOpenWeCom={() => setModal({ type: 'wecom' })}
                onOpenBrowserSetup={() => setModal({ type: 'browser-setup' })}
                onOpenWorkdir={() => setModal({ type: 'workdir' })}
              />
            </Suspense>
          ) : sessionsTabReady && (
            <Suspense fallback={<RouteFallback />}>
              <div
                className={cn('h-full', !sessionShellActive && 'hidden')}
                aria-hidden={!sessionShellActive}
              >
                <SessionsTab
                  active={sessionShellActive}
                  mode={sessionWorkspaceMode}
                  settingsContent={settingsContent}
                  dashboardJiraContent={<TasksTab />}
                />
              </div>
            </Suspense>
          )}

        </main>
      </div>

      {waylandShellPath && normalizedDashboardPath !== null && (
        <DashboardShellModeButton
          mode={dashboardShellMode}
          locale={locale}
          offsetForClassicHeader={!waylandShellActive}
          onClick={toggleDashboardShellMode}
        />
      )}

      {modal && (
        <Suspense fallback={null}>
          {modal.type === 'weixin' && <WeixinModal open onClose={closeModal} />}
          {modal.type === 'telegram' && <TelegramModal open onClose={closeModal} />}
          {modal.type === 'feishu' && <FeishuModal open onClose={closeModal} />}
          {modal.type === 'slack' && <SlackModal open onClose={closeModal} />}
          {modal.type === 'discord' && <DiscordModal open onClose={closeModal} />}
          {modal.type === 'dingtalk' && <DingtalkModal open onClose={closeModal} />}
          {modal.type === 'wecom' && <WeComModal open onClose={closeModal} />}
          {modal.type === 'browser-setup' && <BrowserSetupModal open onClose={closeModal} onSaved={() => reload()} />}
          {modal.type === 'workdir' && <WorkdirModal open onClose={closeModal} />}
        </Suspense>
      )}
      <Toasts items={toasts} />
      <HoverLinkCopyButton t={t} toast={toast} />
      <BrowserPanelModal
        snapshot={browserSnapshot}
        busy={browserBusy}
        urlDraft={browserUrlDraft}
        typeDraft={browserTypeDraft}
        onUrlDraft={setBrowserUrlDraft}
        onTypeDraft={setBrowserTypeDraft}
        onNavigate={() => { void runBrowserAction({ action: 'navigate', url: browserUrlDraft }); }}
        onReload={() => { void runBrowserAction({ action: 'reload' }); }}
        onClickImage={(xRatio, yRatio) => { void runBrowserAction({ action: 'click', xRatio, yRatio }); }}
        onTypeText={() => { void runBrowserAction({ action: 'type', text: browserTypeDraft }); }}
        onClose={closeBrowserPanel}
      />

      {/* Full-page restart overlay */}
      {(restartPhase === 'restarting' || restartPhase === 'reconnecting') && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--th-surface)]/80 backdrop-blur-sm animate-in">
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-10 w-10">
              <svg
                width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                className="animate-spin text-fg-2" style={{ animationDuration: '1.2s' }}
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </div>
            <span className="text-sm font-medium text-fg-3">
              {restartPhase === 'restarting' ? t('modal.restarting') : t('modal.reconnecting')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
