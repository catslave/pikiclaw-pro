import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useStore } from './store';
import { createT } from './i18n';
import { Sidebar, type RestartPhase } from './components/Sidebar';
import { Spinner, Toasts } from './components/ui';
import { BrowserPanelModal } from './components/BrowserPanelModal';
import { api } from './api';
import { getDashboardTabMeta, type DashboardTab } from './tabs';
import { cn } from './utils';
import type { BrowserPanelSnapshot } from './types';

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

function chatPanelRedirectState(panel: ChatPanelRedirectTarget) {
  return { openChatPanel: panel, openChatPanelNonce: Date.now() };
}

function locationToTab(pathname: string): DashboardTab {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return 'notes';
  const map: Record<string, DashboardTab> = {
    '/': 'sessions',
    '/chat': 'sessions',
    '/workspace': 'sessions',
    '/focus': 'sessions',
    '/chat-workspace': 'sessions',
    '/dashboard': 'dashboard',
    '/tasks': 'dashboard',
    '/daily': 'dashboard',
    '/notes': 'notes',
    '/knowledge': 'knowledge',
    '/memory': 'knowledge',
    '/workflows': 'workflows',
    '/jira': 'dashboard',
    '/usage': 'usage',
    '/archive': 'system',
    '/im': 'im',
    '/agents': 'agents',
    '/assistants': 'assistants',
    '/team': 'team',
    '/extensions': 'extensions',
    '/skills': 'extensions',
    '/permissions': 'system',
    '/system': 'system',
  };
  return map[pathname] || 'sessions';
}

function normalizeDashboardPath(pathname: string): string | null {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return pathname;
  if (pathname === '/') return '/chat';
  if (pathname === '/chat') return '/chat';
  if (pathname === '/workspace') return '/workspace';
  if (pathname === '/focus') return '/chat';
  if (pathname === '/chat-workspace') return '/chat';
  if (pathname === '/permissions') return '/system';
  if (pathname === '/archive') return '/system';
  if (pathname === '/dashboard') return '/tasks';
  if (pathname === '/jira') return '/tasks';
  if (pathname === '/skills') return '/extensions';
  if (['/chat', '/workspace', '/tasks', '/daily', '/notes', '/knowledge', '/memory', '/workflows', '/usage', '/im', '/agents', '/assistants', '/team', '/extensions', '/system'].includes(pathname)) return pathname;
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
  const sessionShellActive = normalizedDashboardPath !== null;
  const sessionWorkspaceMode = tab === 'dashboard'
    ? 'dashboard'
    : tab === 'sessions' && normalizedDashboardPath !== '/workspace'
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

  const t = useMemo(() => createT(locale), [locale]);
  const [modal, setModal] = useState<ModalState>(null);
  const closeModal = useCallback(() => setModal(null), []);

  const version = state?.version || '...';

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
    if (location.pathname === '/focus' || location.pathname === '/chat-workspace') {
      navigate('/chat', { replace: true, state: location.state });
      return;
    }
    if (location.pathname === '/jira' || location.pathname === '/dashboard') {
      navigate('/tasks', { replace: true });
      return;
    }
  }, [location.pathname, location.state, navigate]);

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
        <Route path="/usage" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <UsageTab />
          </PageWrapper>
        } />
        <Route path="/notes" element={<NotesTab />} />
        <Route path="/notes/:pageId" element={<NotesTab />} />
        <Route path="/knowledge" element={<Navigate to="/chat" replace state={chatPanelRedirectState('memory')} />} />
        <Route path="/memory" element={<Navigate to="/chat" replace state={chatPanelRedirectState('memory')} />} />
        <Route path="/jira" element={<Navigate to="/tasks" replace />} />
        <Route path="/dashboard" element={<Navigate to="/tasks" replace />} />
        <Route path="/archive" element={<Navigate to="/system?view=archive" replace />} />
        <Route path="/permissions" element={<Navigate to="/system" replace />} />
        <Route path="/extensions" element={
          <PageWrapper title={tabMeta.title} description={tabMeta.description}>
            <ExtensionsTab onOpenBrowserSetup={() => setModal({ type: 'browser-setup' })} />
          </PageWrapper>
        } />
        <Route path="/skills" element={<Navigate to="/extensions" replace />} />
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
        <Sidebar
          version={version}
          restartPhase={restartPhase}
          onRestartClick={onRestartClick}
          immersive={workspaceImmersive}
        />
        <main className="min-h-0 flex-1 overflow-hidden">
          {sessionsTabReady && (
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
