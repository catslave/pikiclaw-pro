import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { resolveAppStatusBadge } from '../app-status';
import { useStore } from '../store';
import { createT } from '../i18n';
import { Button, Dot, TabsList } from './ui';
import { cn } from '../utils';

const IconSun = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconMoon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;

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
  dashboard: '/dashboard',
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
}: {
  version: string;
  restartPhase: RestartPhase;
  onRestartClick: () => void;
}) {
  const state = useStore(s => s.state);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const t = useMemo(() => createT(locale), [locale]);
  const location = useLocation();
  const navItems = useMemo(() => [
    { key: 'sessions', to: TAB_ROUTES.sessions, label: t('tab.sessions'), exact: true, primary: true },
    { key: 'dashboard', to: TAB_ROUTES.dashboard, label: t('tab.dashboard'), primary: true },
    { key: 'usage', to: TAB_ROUTES.usage, label: t('tab.usage'), primary: true },
    { key: 'im', to: TAB_ROUTES.im, label: t('tab.im') },
    { key: 'agents', to: TAB_ROUTES.agents, label: t('tab.agent') },
    { key: 'extensions', to: TAB_ROUTES.extensions, label: t('tab.extensions') },
    { key: 'system', to: TAB_ROUTES.system, label: t('tab.system') },
  ], [t]);
  const appStatus = resolveAppStatusBadge(state, t);

  const busy = restartPhase === 'restarting' || restartPhase === 'reconnecting';
  const confirming = restartPhase === 'confirm';
  const themeToggleLabel = theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode');

  return (
    <header className="sticky top-0 z-40 bg-[var(--th-sidebar)] border-b border-edge backdrop-blur-[20px] [backdrop-filter:blur(20px)_saturate(1.2)]">
      <div className="mx-auto flex min-h-14 max-w-none flex-wrap items-center gap-2.5 px-4 py-2 md:flex-nowrap">
        {/* Logo */}
        <div className="mr-1.5 flex items-center gap-2.5 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/35 bg-[linear-gradient(145deg,rgba(250,204,21,0.28),rgba(251,146,60,0.12))] shadow-[0_8px_22px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.35)]">
            <PikiclawLogo />
          </div>
          <div className="leading-none">
            <div className="text-[14px] font-semibold tracking-tight text-gradient">Pikiclaw</div>
          </div>
          <span className="rounded-md border border-edge bg-panel px-1.5 py-0.5 text-[10px] font-mono text-fg-4">
            v{version}
          </span>
        </div>

        {/* Tab navigation */}
        <nav className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
          <TabsList className="w-full min-w-0 overflow-x-auto md:w-full md:justify-start">
            {navItems.map(item => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.exact}
                className={({ isActive }) => {
                  const active = item.key === 'system'
                    ? location.pathname === '/system'
                    : isActive;
                  return cn(
                    'inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
                    item.primary ? 'text-sm' : 'text-[13px]',
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
          <div className="hidden items-center gap-1.5 rounded-full border border-edge bg-panel-alt px-2.5 py-1 text-[11px] text-fg-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex">
            <Dot variant={appStatus.dotVariant} pulse={appStatus.dotPulse} />
            <span className="font-medium">{appStatus.badgeContent}</span>
          </div>
          <Button
            variant={confirming ? 'secondary' : 'outline'}
            size="sm"
            onClick={onRestartClick}
            disabled={busy}
            title={busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
            className={cn(
              busy ? 'pointer-events-none opacity-70' : '',
              confirming ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100' : '',
            )}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={busy ? 'animate-spin' : ''}
              style={busy ? { animationDuration: '1s' } : undefined}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span className="hidden md:inline">
              {busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
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
            className="font-mono font-semibold tracking-wider"
          >
            {locale === 'zh-CN' ? 'EN' : '\u4e2d'}
          </Button>
        </div>
      </div>
    </header>
  );
}
