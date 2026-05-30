import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { resolveAppStatusBadge } from '../app-status';
import { useStore } from '../store';
import { createT } from '../i18n';
import { Button, Dot, TabsList } from './ui';
import { cn } from '../utils';

const IconSun = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconMoon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const IconRestart = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>;
const IconAgents = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.8-3 2.8-4.5 5.5-4.5s4.7 1.5 5.5 4.5" /><circle cx="17" cy="10" r="2.3" /><path d="M14.8 15.2c2.9.2 4.8 1.4 5.7 3.8" /></svg>;
const IconExtensions = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6v4h2.5a2.5 2.5 0 0 1 0 5H15v3h3.5a2.5 2.5 0 0 1 0 5H9v-5H5.5a2.5 2.5 0 0 1 0-5H9V7H6.5a2.5 2.5 0 0 1 0-5H9z" /></svg>;
const IconSystem = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" /></svg>;

function PikiclawLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="drop-shadow-[0_2px_6px_rgba(245,158,11,0.30)]">
      <defs>
        <linearGradient id="pikiclaw-face" x1="8" y1="5" x2="23" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fde68a" />
          <stop offset="0.58" stopColor="#facc15" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="pikiclaw-bolt" x1="20" y1="4" x2="29" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff7ed" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M21.6 12.4 27.4 5l-2.6 7.2h3.7L21.7 23l1.8-7.4h-3.3z" fill="url(#pikiclaw-bolt)" stroke="#92400e" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M10.1 11.8 7.4 4.8l6.2 4.7z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M21.9 11.8 24.6 4.8l-6.2 4.7z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="16" cy="17" r="10.4" fill="url(#pikiclaw-face)" stroke="#92400e" strokeWidth="1.25" />
      <path d="M14.7 9.8 12.6 15h3.1l-1.1 4.4 4.8-6.4h-3.2l1.1-3.2z" fill="#fff7ed" opacity="0.74" />
      <circle cx="12.2" cy="16.4" r="1.35" fill="#422006" />
      <circle cx="19.8" cy="16.4" r="1.35" fill="#422006" />
      <circle cx="9.7" cy="19.6" r="1.65" fill="#fb7185" opacity="0.78" />
      <circle cx="22.3" cy="19.6" r="1.65" fill="#fb7185" opacity="0.78" />
      <path d="M13.4 21.1c1.4 1.2 3.8 1.2 5.2 0" fill="none" stroke="#422006" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

const TAB_ROUTES: Record<string, string> = {
  sessions: '/',
  dashboard: '/tasks',
  usage: '/usage',
  im: '/im',
  agents: '/agents',
  extensions: '/extensions',
  system: '/system',
};

export type RestartPhase = null | 'confirm' | 'restarting' | 'reconnecting';

export function Sidebar({
  version,
  restartPhase,
  onRestartClick,
  immersive = false,
}: {
  version: string;
  restartPhase: RestartPhase;
  onRestartClick: () => void;
  immersive?: boolean;
}) {
  const state = useStore(s => s.state);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const t = useMemo(() => createT(locale), [locale]);
  const location = useLocation();
  const primaryNavItems = useMemo(() => [
    { key: 'sessions', to: TAB_ROUTES.sessions, label: t('nav.workspace'), exact: true, state: { forceWorkspace: true } },
    { key: 'dashboard', to: TAB_ROUTES.dashboard, label: t('nav.dashboard'), state: undefined },
  ], [t]);
  const configNavItems = useMemo(() => [
    { key: 'agents', to: TAB_ROUTES.agents, label: t('nav.agent'), state: undefined },
    { key: 'extensions', to: TAB_ROUTES.extensions, label: t('nav.extensions'), state: undefined },
    { key: 'system', to: TAB_ROUTES.system, label: t('nav.system'), state: undefined },
  ], [t]);
  const immersiveConfigNavItems = useMemo(() => [
    { key: 'agents', to: TAB_ROUTES.agents, label: t('nav.agent'), icon: IconAgents },
    { key: 'extensions', to: TAB_ROUTES.extensions, label: t('nav.extensions'), icon: IconExtensions },
    { key: 'system', to: TAB_ROUTES.system, label: t('nav.system'), icon: IconSystem },
  ], [t]);
  const appStatus = resolveAppStatusBadge(state, t);

  const busy = restartPhase === 'restarting' || restartPhase === 'reconnecting';
  const confirming = restartPhase === 'confirm';
  const themeToggleLabel = theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode');
  const languageToggleLabel = locale === 'zh-CN' ? 'Switch to English' : '切换到中文';

  if (immersive) {
    return (
      <header className="pointer-events-none fixed inset-y-0 left-0 z-50 w-14">
        <div className="pointer-events-auto flex h-full w-14 flex-col items-center border-r border-edge/65 bg-panel/82 py-2 shadow-[8px_0_24px_rgba(2,6,23,0.08)] backdrop-blur-md">
          <div className="relative h-10 w-10">
            <NavLink
              to="/"
              state={{ forceWorkspace: true }}
              title={t('nav.workspace')}
              aria-label={t('nav.workspace')}
              end
              className={({ isActive }) => cn(
                'absolute inset-1 inline-flex items-center justify-center rounded-xl text-fg-5 transition-colors hover:bg-panel-h hover:text-fg',
                isActive && 'bg-panel-h text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
              )}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </NavLink>
            <div id="workspace-sidebar-toggle-host" className="absolute inset-1 flex shrink-0 items-center justify-center empty:hidden" />
          </div>
          <NavLink
            to="/tasks"
            title={t('nav.dashboard')}
            aria-label={t('nav.dashboard')}
            className={({ isActive }) => cn(
              'mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-fg-5 transition-colors hover:bg-panel-h hover:text-fg',
              isActive && 'bg-panel-h text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
            )}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </NavLink>
          <div className="mt-3 h-px w-6 bg-edge/70" />
          <nav className="mt-3 flex shrink-0 flex-col items-center gap-1" aria-label="Settings navigation">
            {immersiveConfigNavItems.map(item => (
              <NavLink
                key={item.key}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) => {
                  const active = item.key === 'system' ? location.pathname === '/system' : isActive;
                  return cn(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-fg-5 transition-colors hover:bg-panel-h hover:text-fg',
                    active && 'bg-panel-h text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
                  );
                }}
              >
                {item.icon}
              </NavLink>
            ))}
          </nav>
          <div className="mt-3 h-px w-6 bg-edge/70" />
          <div className="mt-auto flex min-h-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center" title={appStatus.badgeContent} aria-label={appStatus.badgeContent}>
              <Dot variant={appStatus.dotVariant} pulse={appStatus.dotPulse} />
            </div>
            <Button
              variant={confirming ? 'secondary' : 'ghost'}
              size="icon"
              onClick={onRestartClick}
              disabled={busy}
              title={busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
              className={cn(
                '!h-8 !w-8',
                busy ? 'pointer-events-none opacity-70' : '',
                confirming ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100' : '',
              )}
            >
              <span className={busy ? 'animate-spin' : ''} style={busy ? { animationDuration: '1s' } : undefined} aria-hidden="true">
                {IconRestart}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={themeToggleLabel}
              aria-label={themeToggleLabel}
              className="!h-8 !w-8"
            >
              {theme === 'dark' ? IconSun : IconMoon}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
              title={languageToggleLabel}
              aria-label={languageToggleLabel}
              className="!h-8 !w-8 font-mono !text-[11px] font-semibold tracking-wider"
            >
              {locale === 'zh-CN' ? 'EN' : '\u4e2d'}
            </Button>
            <div id="global-inbox-host" className="mt-1 flex shrink-0 flex-col items-center gap-1 empty:hidden" />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-edge bg-[var(--th-sidebar)] backdrop-blur-[20px] [backdrop-filter:blur(20px)_saturate(1.2)]">
      <div className="mx-auto flex min-h-14 max-w-none flex-wrap items-center gap-2.5 px-3 py-2 md:flex-nowrap md:px-4">
        {/* Logo */}
        <div className="mr-1.5 flex items-center gap-2.5 shrink-0">
          <div id="workspace-sidebar-toggle-host" className="flex shrink-0 items-center empty:hidden" />
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/35 bg-[linear-gradient(145deg,rgba(250,204,21,0.28),rgba(251,146,60,0.12))] shadow-[0_8px_22px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.35)]">
            <PikiclawLogo />
          </div>
          <div className="leading-none">
            <div className="text-[14px] font-semibold tracking-tight text-gradient">Pikiclaw Pro</div>
          </div>
          <span className="rounded-md border border-edge bg-panel px-1.5 py-0.5 text-[10px] font-mono text-fg-4">
            v{version}
          </span>
        </div>

        {/* Tab navigation */}
        <nav className="order-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto md:order-none md:w-auto md:flex-1">
          <TabsList className="min-w-max bg-inset/65 p-0.5">
            {primaryNavItems.map(item => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.exact}
                state={item.state}
                className={({ isActive }) => cn(
                  'inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors duration-200',
                  'focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
                  isActive ? 'bg-panel-h text-fg shadow-[0_1px_0_rgba(255,255,255,0.03)]' : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2',
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </TabsList>
          <TabsList className="min-w-max bg-panel/50 p-0.5">
            {configNavItems.map(item => (
              <NavLink
                key={item.key}
                to={item.to}
                state={item.state}
                className={({ isActive }) => {
                  const active = item.key === 'system'
                    ? location.pathname === '/system'
                    : isActive;
                  return cn(
                    'inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-[13px] font-semibold transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
                    active ? 'bg-panel-h text-fg shadow-[0_1px_0_rgba(255,255,255,0.03)]' : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2',
                  );
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </TabsList>
        </nav>

        {/* Spacer */}
        <div className="flex-1 min-w-0 md:hidden" />

        {/* Right-side actions */}
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <div id="global-inbox-host" className="flex shrink-0 items-center empty:hidden" />
          <div className="hidden items-center gap-1.5 rounded-full border border-edge bg-panel-alt px-2.5 py-1 text-[11px] text-fg-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex">
            <Dot variant={appStatus.dotVariant} pulse={appStatus.dotPulse} />
            <span className="font-medium">{appStatus.badgeContent}</span>
          </div>
          <Button
            variant={confirming ? 'secondary' : 'outline'}
            size="icon"
            onClick={onRestartClick}
            disabled={busy}
            title={busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
            className={cn(
              busy ? 'pointer-events-none opacity-70' : '',
              confirming ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100' : '',
            )}
          >
            <span
              className={busy ? 'animate-spin' : ''}
              style={busy ? { animationDuration: '1s' } : undefined}
              aria-hidden="true"
            >
              {IconRestart}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={themeToggleLabel}
            aria-label={themeToggleLabel}
          >
            {theme === 'dark' ? IconSun : IconMoon}
            <span>{themeToggleLabel}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
            title={languageToggleLabel}
            aria-label={languageToggleLabel}
            className="font-mono font-semibold tracking-wider"
          >
            {locale === 'zh-CN' ? 'EN' : '\u4e2d'}
          </Button>
        </div>
      </div>
    </header>
  );
}
