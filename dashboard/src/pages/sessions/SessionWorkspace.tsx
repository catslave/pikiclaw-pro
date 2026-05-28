import { Fragment, Suspense, lazy, startTransition, useDeferredValue, useState, useEffect, useCallback, useRef, memo, useMemo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { createT } from '../../i18n';
import { api } from '../../api';
import { resolveAppStatusBadge } from '../../app-status';
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
import type { AppState, SessionInfo, TodoItem, WorkspaceEntry, DirEntry, GitChange, OpenTarget } from '../../types';
import { InputComposer } from './InputComposer';
import { UserBubble, type SelectionActionRequest, type SelectionSideChatRequest } from './TurnView';
import { ThinkingDots } from './LivePreview';
import { WorkspaceExtensionsModal } from '../extensions/WorkspaceExtensionsModal';
import type { FileLinkTarget, OpenFileLinkHandler } from './markdown';
import type { SessionPanelChange } from './SessionPanel';
import type { RestartPhase } from '../../components/Sidebar';

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
const VISIBLE_WORKSPACE_REFRESH_MIN_INTERVAL_MS = 15_000;
const sKey = (agent: string, id: string) => `${agent}:${id}`;
const MENU_ITEM_BASE_CLASS = 'mx-1 flex h-8 w-[calc(100%-0.5rem)] items-center gap-2 rounded px-2 text-left text-[12px] font-medium text-fg-3 transition-[background,color] duration-150 focus-visible:outline-none';
const menuItemClass = (tone: 'default' | 'primary' | 'danger' = 'default') => cn(
  MENU_ITEM_BASE_CLASS,
  tone === 'danger'
    ? 'hover:bg-red-500/[0.10] hover:text-red-500 focus-visible:bg-red-500/[0.12] focus-visible:text-red-500'
    : tone === 'primary'
      ? 'hover:bg-primary/[0.09] hover:text-primary focus-visible:bg-primary/[0.11] focus-visible:text-primary'
      : 'hover:bg-primary/[0.07] hover:text-fg focus-visible:bg-primary/[0.09] focus-visible:text-fg',
);
const workspaceBaseName = (workspacePath: string) => {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
};

const IconSun = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconMoon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const IconRestart = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>;

function PikiclawLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="drop-shadow-[0_2px_6px_rgba(245,158,11,0.30)]">
      <defs>
        <linearGradient id="session-pikiclaw-face" x1="8" y1="5" x2="23" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fde68a" />
          <stop offset="0.58" stopColor="#facc15" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="session-pikiclaw-bolt" x1="20" y1="4" x2="29" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff7ed" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M21.6 12.4 27.4 5l-2.6 7.2h3.7L21.7 23l1.8-7.4h-3.3z" fill="url(#session-pikiclaw-bolt)" stroke="#92400e" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M10.1 11.8 7.4 4.8l6.2 4.7z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M21.9 11.8 24.6 4.8l-6.2 4.7z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="16" cy="17" r="10.4" fill="url(#session-pikiclaw-face)" stroke="#92400e" strokeWidth="1.25" />
      <path d="M14.7 9.8 12.6 15h3.1l-1.1 4.4 4.8-6.4h-3.2l1.1-3.2z" fill="#fff7ed" opacity="0.74" />
      <circle cx="12.2" cy="16.4" r="1.35" fill="#422006" />
      <circle cx="19.8" cy="16.4" r="1.35" fill="#422006" />
      <circle cx="9.7" cy="19.6" r="1.65" fill="#fb7185" opacity="0.78" />
      <circle cx="22.3" cy="19.6" r="1.65" fill="#fb7185" opacity="0.78" />
      <path d="M13.4 21.1c1.4 1.2 3.8 1.2 5.2 0" fill="none" stroke="#422006" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function TodoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m4 6 .8.8L6.5 5" />
      <path d="m4 12 .8.8 1.7-1.8" />
      <path d="m4 18 .8.8 1.7-1.8" />
    </svg>
  );
}

function sideChatDisplayTitle(fallbackIndex: number, sideChatLabel: string): string {
  return `${sideChatLabel} ${fallbackIndex + 1}`;
}

function buildSelectionSideChatPrompt({ quote, question }: SelectionSideChatRequest, locale: string): string {
  const normalizedQuote = quote.trim();
  const normalizedQuestion = question.trim();
  if (locale.startsWith('zh')) {
    return [
      '请基于下面引用的 chat output 回答我的问题。',
      '',
      '引用内容：',
      normalizedQuote.split('\n').map(line => `> ${line}`).join('\n'),
      '',
      '我的问题：',
      normalizedQuestion,
    ].join('\n');
  }
  return [
    'Please answer my question based on the quoted chat output below.',
    '',
    'Quoted output:',
    normalizedQuote.split('\n').map(line => `> ${line}`).join('\n'),
    '',
    'Question:',
    normalizedQuestion,
  ].join('\n');
}

function isAbsoluteLocalPath(filePath: string): boolean {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(filePath);
}

function normalizeLocalPathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isFileLinkInsideWorkspace(workdir: string, filePath: string): boolean {
  if (!isAbsoluteLocalPath(filePath)) return true;
  if (filePath.startsWith('~/')) return false;
  const root = normalizeLocalPathForCompare(workdir);
  const target = normalizeLocalPathForCompare(filePath);
  return target === root || target.startsWith(`${root}/`);
}

function ExitFocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="4 14 10 14 10 20" />
      <line x1="4" y1="20" x2="10" y2="14" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="20" y1="4" x2="14" y2="10" />
    </svg>
  );
}

function EnterFocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function SideChatCollapseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

type SessionWithDepth = SessionInfo & { __forkDepth: number };
type SessionSlot = { agent: string; sessionId: string; workdir: string; mountKey: string };
type OpenSideChatsMap = Record<string, SessionSlot[]>;
type ActiveSideChatsMap = Record<string, string>;
type SideChatPanelOpenMap = Record<string, boolean>;
type SideChatRef = NonNullable<SessionInfo['sideChats']>[number];
type SideChatRefsMap = Record<string, SideChatRef[]>;
type SideChatWidthsMap = Record<string, number>;
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

function sortPinnedSessions(sessions: SessionWithDepth[]): SessionWithDepth[] {
  const pinned = sessions.filter(session => session.pinned);
  const rest = sessions.filter(session => !session.pinned);
  return [...pinned, ...rest];
}

let _slotKeySeq = 0;
function nextMountKey() { return `mk-${Date.now().toString(36)}-${(++_slotKeySeq).toString(36)}`; }

const OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:open-sessions:v1';
const OPEN_SIDE_CHATS_STORAGE_KEY = 'pikiclaw:session-workspace:open-side-chats:v1';
const ACTIVE_SIDE_CHAT_STORAGE_KEY = 'pikiclaw:session-workspace:active-side-chat:v1';
const SIDE_CHAT_WIDTHS_STORAGE_KEY = 'pikiclaw:session-workspace:side-chat-widths:v1';
const ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:active-slot:v1';
const FOCUSED_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:focused-slot:v1';
const NEW_SESSION_STORAGE_KEY = 'pikiclaw:session-workspace:new-session-workdir:v1';
const WORKSPACE_EXPANDED_STORAGE_KEY = 'pikiclaw:session-workspace:workspace-expanded:v1';
const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'pikiclaw:session-workspace:workspace-sidebar-collapsed:v1';
const CHAT_LAYOUT_STORAGE_KEY = 'pikiclaw:session-workspace:chat-layout:v1';
const LEGACY_OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw-open-sessions';
const LEGACY_ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw-active-slot';
const SIDE_CHAT_DEFAULT_WIDTH = 440;
const SIDE_CHAT_MIN_WIDTH = 340;
const SIDE_CHAT_MAX_WIDTH = 760;
const SESSION_GRID_MAX_VISIBLE_ROWS = 2;
const SESSION_GRID_GAP_PX = 12;
const WORKSPACE_SETTINGS_MENU_WIDTH = 188;
const WORKSPACE_SETTINGS_MENU_HEIGHT = 312;

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

function sessionSlotStorageKey(slot: Pick<SessionSlot, 'workdir' | 'agent' | 'sessionId'>) {
  return `${slot.workdir}:${slot.agent}:${slot.sessionId}`;
}

function sideChatSlotKey(slot: Pick<SessionSlot, 'agent' | 'sessionId'>) {
  return `${slot.agent}:${slot.sessionId}`;
}

function sameSideChatIdentity(a: Pick<SessionSlot, 'agent' | 'sessionId'>, b: Pick<SessionSlot, 'agent' | 'sessionId'>) {
  return a.agent === b.agent && a.sessionId === b.sessionId;
}

function dedupeSideChatSlots(slots: SessionSlot[]): SessionSlot[] {
  const seen = new Set<string>();
  const out: SessionSlot[] = [];
  for (const slot of slots) {
    const key = sideChatSlotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

function mergeSideChatRefs(...groups: Array<SideChatRef[] | null | undefined>): SideChatRef[] {
  const byKey = new Map<string, SideChatRef>();
  for (const refs of groups) {
    for (const ref of refs || []) {
      if (!ref?.agent || !ref.sessionId) continue;
      const key = `${ref.agent}:${ref.sessionId}`;
      const existing = byKey.get(key);
      byKey.set(key, existing ? { ...existing, ...ref } : ref);
    }
  }
  return Array.from(byKey.values());
}

function readStoredOpenSideChats(): OpenSideChatsMap {
  try {
    const raw = readBrowserStorage(OPEN_SIDE_CHATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: OpenSideChatsMap = {};
    for (const [parentKey, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const slots = value
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
      const deduped = dedupeSideChatSlots(slots);
      if (deduped.length) out[parentKey] = deduped;
    }
    return out;
  } catch {
    return {};
  }
}

function readStoredActiveSideChats(): ActiveSideChatsMap {
  try {
    const raw = readBrowserStorage(ACTIVE_SIDE_CHAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ActiveSideChatsMap = {};
    for (const [parentKey, sideKey] of Object.entries(parsed)) {
      if (typeof parentKey === 'string' && typeof sideKey === 'string' && sideKey) out[parentKey] = sideKey;
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeStoredSideChatWidth(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(SIDE_CHAT_MAX_WIDTH, Math.max(SIDE_CHAT_MIN_WIDTH, n)));
}

function sideChatViewportMaxWidth(): number {
  if (typeof window === 'undefined') return SIDE_CHAT_MAX_WIDTH;
  return Math.max(SIDE_CHAT_MIN_WIDTH, Math.min(SIDE_CHAT_MAX_WIDTH, Math.floor(window.innerWidth * 0.46)));
}

function clampSideChatWidthForViewport(value: number): number {
  return Math.round(Math.min(sideChatViewportMaxWidth(), Math.max(SIDE_CHAT_MIN_WIDTH, value)));
}

function readStoredSideChatWidths(): SideChatWidthsMap {
  try {
    const raw = readBrowserStorage(SIDE_CHAT_WIDTHS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SideChatWidthsMap = {};
    for (const [parentKey, width] of Object.entries(parsed)) {
      const normalized = normalizeStoredSideChatWidth(width);
      if (typeof parentKey === 'string' && normalized != null) out[parentKey] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

function readStoredActiveSlot(): number {
  const raw = readBrowserStorage(ACTIVE_SLOT_STORAGE_KEY, LEGACY_ACTIVE_SLOT_STORAGE_KEY);
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readStoredFocusedSlot(): number | null {
  const raw = readBrowserStorage(FOCUSED_SLOT_STORAGE_KEY);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function readWorkspaceExpandedMap(): Record<string, boolean> {
  try {
    const raw = readBrowserStorage(WORKSPACE_EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [workspacePath, expanded] of Object.entries(parsed)) {
      if (typeof workspacePath === 'string' && typeof expanded === 'boolean') out[workspacePath] = expanded;
    }
    return out;
  } catch {
    return {};
  }
}

function readStoredWorkspaceExpanded(workspacePath: string): boolean {
  const map = readWorkspaceExpandedMap();
  return map[workspacePath] !== false;
}

function writeStoredWorkspaceExpanded(workspacePath: string, expanded: boolean) {
  const map = readWorkspaceExpandedMap();
  map[workspacePath] = expanded;
  writeBrowserStorage(WORKSPACE_EXPANDED_STORAGE_KEY, JSON.stringify(map));
}

function readStoredNewSessionWorkdir(): string | null {
  const raw = readBrowserStorage(NEW_SESSION_STORAGE_KEY);
  const trimmed = String(raw || '').trim();
  return trimmed || null;
}

function readStoredWorkspaceSidebarCollapsed(): boolean {
  return readBrowserStorage(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

type StripBadgeVariant = 'ok' | 'warn' | 'err' | 'muted' | 'accent';
type SessionWorkspaceMode = 'workspace' | 'dashboard' | 'settings';
type ChatLayoutMode = 'layout' | 'column';
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

function readStoredChatLayout(): ChatLayoutMode {
  return readBrowserStorage(CHAT_LAYOUT_STORAGE_KEY) === 'column' ? 'column' : 'layout';
}

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

function parseSessionKeyValue(sessionKey: string | null | undefined): { agent: string; sessionId: string } | null {
  if (!sessionKey) return null;
  const index = sessionKey.indexOf(':');
  if (index <= 0 || index >= sessionKey.length - 1) return null;
  return { agent: sessionKey.slice(0, index), sessionId: sessionKey.slice(index + 1) };
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

function sessionAttentionVariant(session: SessionInfo): 'ok' | 'warn' | null {
  const displayState = sessionDisplayState(session);
  if (displayState === 'running') return 'ok';
  if (displayState === 'incomplete') return 'warn';
  if (isUnreadCompletedSession(session)) return 'ok';
  return null;
}

function isUnreadCompletedSession(session: SessionInfo): boolean {
  const hasReadableContent = !!(
    session.lastQuestion
    || session.lastAnswer
    || session.lastMessageText
    || (typeof session.numTurns === 'number' && session.numTurns > 0)
  );
  return sessionDisplayState(session) === 'completed'
    && hasReadableContent
    && session.userStatus !== 'done'
    && session.userStatus !== 'parked';
}

function shouldMarkSessionReadOnOpen(session: SessionInfo): boolean {
  return isUnreadCompletedSession(session);
}

function localReadSessionKey(agent: string, sessionId: string): string {
  return sKey(agent, sessionId);
}

function sessionOriginLabel(session: SessionInfo): string | null {
  const channel = session.origin?.channel?.trim();
  if (!channel || channel === 'dashboard') return null;
  const labels: Record<string, string> = {
    feishu: 'Feishu',
    weixin: 'WeChat',
    wechat: 'WeChat',
    telegram: 'Telegram',
    slack: 'Slack',
    discord: 'Discord',
    dingtalk: 'DingTalk',
    wecom: 'WeCom',
  };
  const label = labels[channel.toLowerCase()] || channel;
  const chatType = session.origin?.chatType?.trim();
  return chatType ? `${label} ${chatType}` : label;
}

function sessionOriginTitle(session: SessionInfo): string | undefined {
  const origin = session.origin;
  if (!origin?.channel || !origin.chatId) return undefined;
  const parts = [`${origin.channel}:${origin.chatId}`];
  if (origin.sourceMessageId) parts.push(`message:${origin.sourceMessageId}`);
  if (origin.userId) parts.push(`user:${origin.userId}`);
  return parts.join(' ');
}

function workspaceGroupAttention(sessions: SessionInfo[]): { variant: 'ok' | 'warn'; pulse: boolean } | null {
  let hasWarn = false;
  let hasOk = false;
  let hasRunning = false;
  for (const session of sessions) {
    const variant = sessionAttentionVariant(session);
    if (!variant) continue;
    if (variant === 'warn') hasWarn = true;
    else hasOk = true;
    if (sessionDisplayState(session) === 'running') hasRunning = true;
  }
  if (hasOk) return { variant: 'ok', pulse: hasRunning };
  if (hasWarn) return { variant: 'warn', pulse: false };
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

function WorkspaceSidebarHeader({
  onCollapse,
  collapseLabel,
  version,
}: {
  onCollapse: () => void;
  collapseLabel: string;
  version: string;
}) {
  return (
    <div className="shrink-0 border-b border-edge/25 bg-[var(--th-sidebar)]/80 px-3 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/35 bg-[linear-gradient(145deg,rgba(250,204,21,0.28),rgba(251,146,60,0.12))] shadow-[0_8px_22px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.35)]">
          <PikiclawLogo />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight text-gradient">Pikiclaw Pro</div>
        </div>
        <div className="shrink-0 font-mono text-[10px] text-fg-5/70">
          v{version}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-5 transition-[background,color,transform] duration-200 hover:-translate-x-1 hover:bg-panel-h hover:text-fg-2 active:scale-95"
          title={collapseLabel}
          aria-label={collapseLabel}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function WorkspaceSidebarRuntimeControls({
  appStatus,
  restartPhase,
  onRestartClick,
  restartLabel,
  confirmRestartLabel,
  restartingLabel,
  theme,
  onToggleTheme,
  themeToggleLabel,
  locale,
  onToggleLocale,
  settingsButtonRef,
  onOpenSettings,
  settingsLabel,
  settingsOpen,
}: {
  appStatus: ReturnType<typeof resolveAppStatusBadge>;
  restartPhase: RestartPhase;
  onRestartClick?: () => void;
  restartLabel: string;
  confirmRestartLabel: string;
  restartingLabel: string;
  theme: string;
  onToggleTheme: () => void;
  themeToggleLabel: string;
  locale: string;
  onToggleLocale: () => void;
  settingsButtonRef: { current: HTMLButtonElement | null };
  onOpenSettings: () => void;
  settingsLabel: string;
  settingsOpen: boolean;
}) {
  const restartBusy = restartPhase === 'restarting' || restartPhase === 'reconnecting';
  const restartConfirming = restartPhase === 'confirm';
  const restartTitle = restartBusy ? restartingLabel : restartConfirming ? confirmRestartLabel : restartLabel;
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-edge/45 bg-panel/55 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-fg-4">
        <Dot variant={appStatus.dotVariant} pulse={appStatus.dotPulse} />
        <span className="min-w-0 flex-1 truncate font-medium text-fg-3">{appStatus.badgeContent}</span>
      </div>
      <Button
        variant={restartConfirming ? 'secondary' : 'ghost'}
        size="icon"
        onClick={onRestartClick}
        disabled={!onRestartClick || restartBusy}
        title={restartTitle}
        aria-label={restartTitle}
        className={cn(
          'h-7 w-7 shrink-0',
          restartBusy && 'pointer-events-none opacity-70',
          restartConfirming && 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200',
        )}
      >
        <span
          className={restartBusy ? 'animate-spin' : ''}
          style={restartBusy ? { animationDuration: '1s' } : undefined}
          aria-hidden="true"
        >
          {IconRestart}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleTheme}
        title={themeToggleLabel}
        aria-label={themeToggleLabel}
        className="h-7 w-7 shrink-0"
      >
        {theme === 'dark' ? IconSun : IconMoon}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleLocale}
        title={locale === 'zh-CN' ? 'English' : '中文'}
        aria-label={locale === 'zh-CN' ? 'English' : '中文'}
        className="h-7 w-7 shrink-0 font-mono text-[11px] font-semibold tracking-wider"
      >
        {locale === 'zh-CN' ? 'EN' : '\u4e2d'}
      </Button>
      <button
        ref={settingsButtonRef}
        type="button"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          onOpenSettings();
        }}
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-fg-4 transition-colors hover:bg-panel hover:text-fg-2',
          settingsOpen && 'border-edge-h bg-panel-h text-fg-2',
        )}
        title={settingsLabel}
        aria-label={settingsLabel}
        aria-haspopup="menu"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M4 12h2" />
          <path d="M18 12h2" />
          <path d="M12 4v2" />
          <path d="M12 18v2" />
          <path d="m6.4 6.4 1.4 1.4" />
          <path d="m16.2 16.2 1.4 1.4" />
          <path d="m17.6 6.4-1.4 1.4" />
          <path d="m7.8 16.2-1.4 1.4" />
        </svg>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Main Three-Column Layout
   ══════════════════════════════════════════════════════ */
export const SessionWorkspace = memo(function SessionWorkspace({
  active = true,
  mode = 'workspace',
  settingsContent = null,
  dashboardJiraContent = null,
  version = '...',
  restartPhase = null,
  onRestartClick,
}: {
  active?: boolean;
  mode?: SessionWorkspaceMode;
  settingsContent?: ReactNode;
  dashboardJiraContent?: ReactNode;
  version?: string;
  restartPhase?: RestartPhase;
  onRestartClick?: () => void;
}) {
  // Granular selectors — keep high-churn store slices out of this workspace.
  // `appState` is used only for the compact workspace status strip.
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const appState = useStore(s => s.state);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? null);
  const toastSession = useStore(s => s.toast);
  const navigate = useNavigate();
  const t = useMemo(() => createT(locale), [locale]);
  const appStatus = resolveAppStatusBadge(appState, t);
  const themeToggleLabel = theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode');

  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [sessionsMap, setSessionsMap] = useState<Record<string, SessionInfo[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [sidebarLoading, setSidebarLoading] = useState(true);
  // Multi-session window state. mountKey stays stable across session promotion
  // (pending→native) so React keeps the panel mounted instead of remounting and
  // losing stream/input state.
  const [openSessions, setOpenSessionsRaw] = useState<SessionSlot[]>(readStoredOpenSessions);
  const [openSideChatsByParent, setOpenSideChatsByParentRaw] = useState<OpenSideChatsMap>(readStoredOpenSideChats);
  const [activeSideChatByParent, setActiveSideChatByParentRaw] = useState<ActiveSideChatsMap>(readStoredActiveSideChats);
  const [sideChatPanelOpenByParent, setSideChatPanelOpenByParent] = useState<SideChatPanelOpenMap>({});
  const [sideChatWidthsByParent, setSideChatWidthsByParentRaw] = useState<SideChatWidthsMap>(readStoredSideChatWidths);
  const [sideChatRefsByParent, setSideChatRefsByParent] = useState<SideChatRefsMap>({});
  const [sideChatInfoMap, setSideChatInfoMap] = useState<Record<string, SessionInfo>>({});
  const [activeSlotIndex, setActiveSlotIndexRaw] = useState(readStoredActiveSlot);
  const [spotlightSlotIndex, setSpotlightSlotIndex] = useState<number | null>(null);
  const [focusedSlotIndex, setFocusedSlotIndex] = useState<number | null>(readStoredFocusedSlot);
  const [liveSessionStates, setLiveSessionStates] = useState<Record<string, LiveSessionState>>({});
  const [locallyReadSessionKeys, setLocallyReadSessionKeys] = useState<Set<string>>(() => new Set());
  const spotlightSlotTimerRef = useRef<number | null>(null);
  const focusedOpenSessionsSnapshotRef = useRef<{ slots: SessionSlot[]; focusedIndex: number } | null>(null);
  const openSessionsRef = useRef(openSessions);
  openSessionsRef.current = openSessions;
  const openSideChatsByParentRef = useRef(openSideChatsByParent);
  openSideChatsByParentRef.current = openSideChatsByParent;
  const sideChatWidthsByParentRef = useRef(sideChatWidthsByParent);
  sideChatWidthsByParentRef.current = sideChatWidthsByParent;
  const sessionsMapRef = useRef(sessionsMap);
  sessionsMapRef.current = sessionsMap;
  const liveSessionStatesRef = useRef(liveSessionStates);
  liveSessionStatesRef.current = liveSessionStates;
  const visibleWorkspaceRefreshRef = useRef<Record<string, number>>({});

  // Persist wrappers — localStorage survives dashboard/app restarts; sessionStorage
  // mirrors it as a same-tab fallback and migrates old pre-localStorage state.
  const setOpenSessions = useCallback((updater: SessionSlot[] | ((prev: SessionSlot[]) => SessionSlot[])) => {
    setOpenSessionsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const setOpenSideChatsByParent = useCallback((updater: OpenSideChatsMap | ((prev: OpenSideChatsMap) => OpenSideChatsMap)) => {
    setOpenSideChatsByParentRaw(prev => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next: OpenSideChatsMap = {};
      for (const [parentKey, slots] of Object.entries(rawNext)) {
        const deduped = dedupeSideChatSlots(slots);
        if (deduped.length) next[parentKey] = deduped;
      }
      writeBrowserStorage(OPEN_SIDE_CHATS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const setActiveSideChatByParent = useCallback((updater: ActiveSideChatsMap | ((prev: ActiveSideChatsMap) => ActiveSideChatsMap)) => {
    setActiveSideChatByParentRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(ACTIVE_SIDE_CHAT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const setSideChatWidthsByParent = useCallback((updater: SideChatWidthsMap | ((prev: SideChatWidthsMap) => SideChatWidthsMap)) => {
    setSideChatWidthsByParentRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(SIDE_CHAT_WIDTHS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    let changed = false;
    const next: OpenSideChatsMap = {};
    for (const [parentKey, slots] of Object.entries(openSideChatsByParent)) {
      const deduped = dedupeSideChatSlots(slots);
      if (deduped.length !== slots.length) changed = true;
      if (deduped.length) next[parentKey] = deduped;
    }
    if (changed) setOpenSideChatsByParent(next);
  }, [openSideChatsByParent, setOpenSideChatsByParent]);

  const pulseActiveSlot = useCallback((index: number) => {
    setSpotlightSlotIndex(index);
    if (spotlightSlotTimerRef.current != null) window.clearTimeout(spotlightSlotTimerRef.current);
    spotlightSlotTimerRef.current = window.setTimeout(() => {
      setSpotlightSlotIndex(null);
      spotlightSlotTimerRef.current = null;
    }, 1100);
  }, []);
  const setActiveSlotIndex = useCallback((updater: number | ((prev: number) => number)) => {
    setActiveSlotIndexRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(ACTIVE_SLOT_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  useEffect(() => {
    pulseActiveSlot(activeSlotIndex);
  }, [activeSlotIndex, pulseActiveSlot]);
  useEffect(() => () => {
    if (spotlightSlotTimerRef.current != null) window.clearTimeout(spotlightSlotTimerRef.current);
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
  }, [setActiveSlotIndex, setOpenSessions]);

  const handleOpenFileLink = useCallback((slotIdx: number, workdir: string, target: FileLinkTarget) => {
    setActiveSlotIndex(slotIdx);
    if (!isFileLinkInsideWorkspace(workdir, target.path)) {
      void api.openInEditor(target.path).then(res => {
        if (!res.ok) toastSession(res.error || `Failed to open ${target.path}`, false);
      }).catch((error: any) => {
        toastSession(error?.message || String(error), false);
      });
      return;
    }
    setFilePanelRequest({
      workdir,
      path: target.path,
      line: target.line,
      nonce: ++filePanelRequestSeqRef.current,
    });
    setFileTreeOpen(true);
  }, [setActiveSlotIndex, toastSession]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showNewSession, setShowNewSessionRaw] = useState<string | null>(readStoredNewSessionWorkdir);
  const setShowNewSession = useCallback((updater: string | null | ((prev: string | null) => string | null)) => {
    setShowNewSessionRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(NEW_SESSION_STORAGE_KEY, next);
      return next;
    });
  }, []);
  const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsedRaw] = useState(readStoredWorkspaceSidebarCollapsed);
  const setWorkspaceSidebarCollapsed = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setWorkspaceSidebarCollapsedRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY, next ? 'true' : 'false');
      return next;
    });
  }, []);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const workspaceSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [workspaceSettingsAnchor, setWorkspaceSettingsAnchor] = useState<DOMRect | null>(null);
  const workspaceSettingsItems = useMemo(() => [
    { to: '/', label: t('tab.sessions') },
    { to: '/dashboard', label: t('tab.dashboard') },
    { to: '/usage', label: t('tab.usage') },
    { to: '/im', label: t('tab.im') },
    { to: '/agents', label: t('tab.agent') },
    { to: '/extensions', label: t('tab.extensions') },
    { to: '/system', label: t('tab.system') },
  ], [t]);

  const [draggingWorkspacePath, setDraggingWorkspacePath] = useState<string | null>(null);
  const [dragOverWorkspacePath, setDragOverWorkspacePath] = useState<string | null>(null);
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceRenameTarget | null>(null);
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('');
  const [renamingWorkspace, setRenamingWorkspace] = useState(false);
  const [search, setSearch] = useState('');
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>('all');
  const [chatLayout, setChatLayoutRaw] = useState<ChatLayoutMode>(readStoredChatLayout);
  const setChatLayout = useCallback((next: ChatLayoutMode) => {
    setChatLayoutRaw(next);
    writeBrowserStorage(CHAT_LAYOUT_STORAGE_KEY, next);
  }, []);
  const [dashboardFocusedSlot, setDashboardFocusedSlot] = useState<SessionSlot | null>(null);
  const [dashboardCreateTaskWorkdir, setDashboardCreateTaskWorkdir] = useState<string | null>(null);
  const [dashboardPendingPrompt, setDashboardPendingPrompt] = useState<string | null>(null);
  const [dashboardPendingImageUrls, setDashboardPendingImageUrls] = useState<string[]>([]);
  const [dashboardPendingCreatedAt, setDashboardPendingCreatedAt] = useState<string | null>(null);
  const [quickTodoOpen, setQuickTodoOpen] = useState(false);
  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoSaving, setQuickTodoSaving] = useState(false);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [todoLoading, setTodoLoading] = useState(false);
  const [todoCreating, setTodoCreating] = useState(false);
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

  useEffect(() => {
    if (!workspaceSettingsOpen) return;
    const close = () => setWorkspaceSettingsOpen(false);
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
  }, [workspaceSettingsOpen]);

  const openWorkspaceSettings = useCallback(() => {
    const rect = workspaceSettingsButtonRef.current?.getBoundingClientRect() || null;
    setWorkspaceSettingsAnchor(rect);
    setWorkspaceSettingsOpen(v => !v);
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
      const res = await loadWorkspaceSessions(wsPath, { force: opts.force, archiveMode: 'active' });
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

  useEffect(() => {
    if (!initializedRef.current || !workspaces.length) return;
    setSessionsMap({});
    for (const ws of workspaces) {
      void loadSessionsForWorkspace(ws.path, { force: true });
    }
  }, [loadSessionsForWorkspace, workspaces]);

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

  const warmSession = useCallback((session: Pick<SessionInfo, 'agent' | 'sessionId'>, workdir: string) => {
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
      const eventPhase = event.snapshot && typeof event.snapshot === 'object' ? (event.snapshot as { phase?: unknown }).phase : null;
      // Find workspace(s) that contain this session, or refresh all if unknown
      const targets = eventKey
        ? workspaces.filter(ws => (sessionsMapRef.current[ws.path] || []).some(s => sKey(s.agent || '', s.sessionId) === eventKey))
        : workspaces;
      if (eventKey && eventPhase && eventPhase !== 'done') {
        const openTarget = openSessionsRef.current.find(slot => sKey(slot.agent, slot.sessionId) === eventKey);
        if (targets.length || openTarget) return;
      }
      // If the session isn't in any known workspace yet (new session), refresh all
      const openTarget = eventKey ? openSessionsRef.current.find(slot => sKey(slot.agent, slot.sessionId) === eventKey) : null;
      const toRefresh = targets.length
        ? targets
        : openTarget
          ? workspaces.filter(ws => ws.path === openTarget.workdir)
          : workspaces;
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
    const hydrated = applyLiveSessionState(session, liveSessionStates[sKey(agent, session.sessionId)] || null);
    return locallyReadSessionKeys.has(localReadSessionKey(agent, session.sessionId))
      ? { ...hydrated, userStatus: 'done' as const }
      : hydrated;
  }, [liveSessionStates, locallyReadSessionKeys]);

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
      const now = Date.now();
      for (const ws of workspaces) {
        const last = visibleWorkspaceRefreshRef.current[ws.path] ?? 0;
        if (now - last < VISIBLE_WORKSPACE_REFRESH_MIN_INTERVAL_MS) continue;
        visibleWorkspaceRefreshRef.current[ws.path] = now;
        void loadSessionsForWorkspace(ws.path, { background: true });
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
      setSideChatRefsByParent(prev => Object.fromEntries(
        Object.entries(prev).filter(([parentKey]) => !parentKey.startsWith(`${wsPath}:`)),
      ));
      setActiveSideChatByParent(prev => Object.fromEntries(
        Object.entries(prev).filter(([parentKey]) => !parentKey.startsWith(`${wsPath}:`)),
      ));
      setOpenSideChatsByParent(prev => Object.fromEntries(
        Object.entries(prev)
          .filter(([parentKey]) => !parentKey.startsWith(`${wsPath}:`))
          .map(([parentKey, slots]) => [parentKey, slots.filter(slot => slot.workdir !== wsPath)]),
      ));
      setShowNewSession(prev => (prev === wsPath ? null : prev));
      setActiveSlotIndex(0);
      setConfirmRemove(null);
    } catch {}
    finally { setRemoving(false); }
  }, [confirmRemove, setOpenSideChatsByParent, setShowNewSession]);

  const handleRefreshWorkspace = useCallback((wsPath: string) => {
    void loadSessionsForWorkspace(wsPath, { force: true });
  }, [loadSessionsForWorkspace]);

  /* ── Delete single session ─────────────────────────────── */
  type SessionActionTarget = {
    workdir: string;
    agent: string;
    sessionId: string;
    title: string;
    pinned?: boolean;
    archived?: boolean;
    unread?: boolean;
  };
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<SessionActionTarget | null>(null);
  const [deleteSessionPurgeNative, setDeleteSessionPurgeNative] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [renameSessionTarget, setRenameSessionTarget] = useState<SessionActionTarget | null>(null);
  const [renameSessionTitle, setRenameSessionTitle] = useState('');
  const [renamingSession, setRenamingSession] = useState(false);
  const [headerRenameTarget, setHeaderRenameTarget] = useState<SessionActionTarget | null>(null);
  const [headerRenameTitle, setHeaderRenameTitle] = useState('');
  const [headerRenamingSession, setHeaderRenamingSession] = useState(false);
  const headerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const skipHeaderRenameBlurRef = useRef(false);

  /* ── Session row actions popover (anchored to kebab button) ─── */
  const [sessionMenu, setSessionMenu] = useState<{
    /** Bottom-right corner of the kebab — menu's right edge aligns to anchor.right. */
    anchor: { right: number; bottom: number };
    target: SessionActionTarget;
  } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{
    anchor: { right: number; bottom: number };
    slotIdx: number;
    target: SessionActionTarget;
  } | null>(null);

  const handleSessionMenuOpen = useCallback((anchor: DOMRect, session: SessionInfo, wsPath: string) => {
    setSlotMenu(null);
    setSessionMenu({
      anchor: { right: anchor.right, bottom: anchor.bottom },
      target: {
        workdir: wsPath,
        agent: session.agent || '',
        sessionId: session.sessionId,
        title: sessionListDisplayText(session).slice(0, 120) || session.sessionId.slice(0, 16),
        pinned: session.pinned === true,
        archived: session.archived === true,
        unread: shouldMarkSessionReadOnOpen(session),
      },
    });
  }, []);

  const handleSlotMenuOpen = useCallback((anchor: DOMRect, slotIdx: number, slot: SessionSlot, info: SessionInfo) => {
    setSessionMenu(null);
    if (slotMenu?.slotIdx === slotIdx) {
      setSlotMenu(null);
      return;
    }
    setActiveSlotIndex(slotIdx);
    setSlotMenu({
      anchor: { right: anchor.right, bottom: anchor.bottom },
      slotIdx,
      target: {
        workdir: slot.workdir,
        agent: slot.agent,
        sessionId: slot.sessionId,
        title: sessionListDisplayText(info).slice(0, 120) || slot.sessionId.slice(0, 16),
        pinned: info.pinned === true,
        archived: info.archived === true,
        unread: shouldMarkSessionReadOnOpen(info),
      },
    });
  }, [slotMenu?.slotIdx]);

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

  useEffect(() => {
    if (!slotMenu) return;
    const close = () => setSlotMenu(null);
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
  }, [slotMenu]);

  const openRenameSessionModal = useCallback((target: SessionActionTarget) => {
    setRenameSessionTitle(target.title);
    setRenameSessionTarget(target);
    setSessionMenu(null);
    setSlotMenu(null);
  }, []);

  const openHeaderRenameSession = useCallback((target: SessionActionTarget) => {
    skipHeaderRenameBlurRef.current = false;
    setHeaderRenameTitle(target.title);
    setHeaderRenameTarget(target);
    setSessionMenu(null);
    setSlotMenu(null);
  }, []);

  useEffect(() => {
    if (!headerRenameTarget) return;
    requestAnimationFrame(() => {
      headerRenameInputRef.current?.focus();
      headerRenameInputRef.current?.select();
    });
  }, [headerRenameTarget]);

  const openDeleteSessionModal = useCallback((target: SessionActionTarget) => {
    setDeleteSessionPurgeNative(false);
    setConfirmDeleteSession(target);
    setSessionMenu(null);
    setSlotMenu(null);
  }, []);

  const executePinSession = useCallback(async (target: SessionActionTarget, pinned: boolean) => {
    setSessionMenu(null);
    setSlotMenu(null);
    setSessionsMap(prev => {
      const list = prev[target.workdir];
      if (!list) return prev;
      return {
        ...prev,
        [target.workdir]: list.map(s => (
          s.agent === target.agent && s.sessionId === target.sessionId ? { ...s, pinned } : s
        )),
      };
    });
    try {
      const res = await api.updateSessionPinned(target.workdir, target.agent, target.sessionId, pinned);
      if (!res.ok || !res.updated) {
        toastSession(res.error || t('session.pinFailed'), false);
        void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
        return;
      }
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('session.pinFailed'), false);
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, t, toastSession]);

  const executeArchiveSession = useCallback(async (target: SessionActionTarget, archived: boolean) => {
    setSessionMenu(null);
    setSlotMenu(null);
    setSessionsMap(prev => {
      const list = prev[target.workdir];
      if (!list) return prev;
      return {
        ...prev,
        [target.workdir]: list.filter(s => !(s.agent === target.agent && s.sessionId === target.sessionId)),
      };
    });
    setOpenSessions(prev => prev.filter(s => !(s.workdir === target.workdir && s.agent === target.agent && s.sessionId === target.sessionId)));
    setOpenSideChatsByParent(prev => {
      const targetParentKey = `${target.workdir}:${target.agent}:${target.sessionId}`;
      const next: OpenSideChatsMap = {};
      for (const [parentKey, slots] of Object.entries(prev)) {
        if (parentKey === targetParentKey) continue;
        const filtered = slots.filter(s => !(s.workdir === target.workdir && s.agent === target.agent && s.sessionId === target.sessionId));
        if (filtered.length) next[parentKey] = filtered;
      }
      return next;
    });
    try {
      const res = await api.updateSessionArchived(target.workdir, target.agent, target.sessionId, archived);
      if (!res.ok || !res.updated) {
        toastSession(res.error || t('session.archiveFailed'), false);
      }
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('session.archiveFailed'), false);
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, setOpenSessions, setOpenSideChatsByParent, t, toastSession]);

  const executeMarkSessionRead = useCallback(async (target: SessionActionTarget) => {
    setSessionMenu(null);
    setSlotMenu(null);
    const readKey = localReadSessionKey(target.agent, target.sessionId);
    setLocallyReadSessionKeys(prev => {
      if (prev.has(readKey)) return prev;
      const next = new Set(prev);
      next.add(readKey);
      return next;
    });
    setSessionsMap(prev => {
      const list = prev[target.workdir];
      if (!list) return prev;
      return {
        ...prev,
        [target.workdir]: list.map(item => (
          item.agent === target.agent && item.sessionId === target.sessionId
            ? { ...item, userStatus: 'done' as const }
            : item.sideChats?.some(ref => ref.agent === target.agent && ref.sessionId === target.sessionId)
              ? {
                ...item,
                sideChats: item.sideChats.map(ref => (
                  ref.agent === target.agent && ref.sessionId === target.sessionId
                    ? { ...ref, userStatus: 'done' as const }
                    : ref
                )),
              }
            : item
        )),
      };
    });
    setSideChatInfoMap(prev => {
      let changed = false;
      const next: Record<string, SessionInfo> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (value.agent === target.agent && value.sessionId === target.sessionId) {
          next[key] = { ...value, userStatus: 'done' as const };
          changed = true;
        } else {
          next[key] = value;
        }
      }
      return changed ? next : prev;
    });
    try {
      const res = await api.updateSessionStatus(target.workdir, target.agent, target.sessionId, 'done');
      if (!res.ok || !res.updated) {
        if (!res.ok) toastSession(res.error || t('session.markReadFailed'), false);
        setLocallyReadSessionKeys(prev => {
          if (!prev.has(readKey)) return prev;
          const next = new Set(prev);
          next.delete(readKey);
          return next;
        });
        void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
        return;
      }
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('session.markReadFailed'), false);
      setLocallyReadSessionKeys(prev => {
        if (!prev.has(readKey)) return prev;
        const next = new Set(prev);
        next.delete(readKey);
        return next;
      });
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, t, toastSession]);

  const saveSessionTitle = useCallback(async (target: SessionActionTarget, rawTitle: string) => {
    const title = rawTitle.trim();
    const res = await api.updateSessionTitle(target.workdir, target.agent, target.sessionId, title || null);
    if (!res.ok || !res.updated) {
      toastSession(res.error || t('session.renameFailed'), false);
      return false;
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
    void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    return true;
  }, [loadSessionsForWorkspace, t, toastSession]);

  const executeRenameSession = useCallback(async () => {
    const target = renameSessionTarget;
    if (!target) return;
    setRenamingSession(true);
    try {
      const ok = await saveSessionTitle(target, renameSessionTitle);
      if (ok) setRenameSessionTarget(null);
    } catch (err: any) {
      toastSession(err?.message || t('session.renameFailed'), false);
    } finally {
      setRenamingSession(false);
    }
  }, [renameSessionTarget, renameSessionTitle, saveSessionTitle, t, toastSession]);

  const cancelHeaderRenameSession = useCallback(() => {
    skipHeaderRenameBlurRef.current = true;
    setHeaderRenameTarget(null);
    setHeaderRenameTitle('');
  }, []);

  const executeHeaderRenameSession = useCallback(async () => {
    const target = headerRenameTarget;
    if (!target || headerRenamingSession) return;
    setHeaderRenamingSession(true);
    try {
      const ok = await saveSessionTitle(target, headerRenameTitle);
      if (ok) {
        setHeaderRenameTarget(null);
        setHeaderRenameTitle('');
      }
    } catch (err: any) {
      toastSession(err?.message || t('session.renameFailed'), false);
    } finally {
      skipHeaderRenameBlurRef.current = false;
      setHeaderRenamingSession(false);
    }
  }, [headerRenameTarget, headerRenameTitle, headerRenamingSession, saveSessionTitle, t, toastSession]);

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
      setOpenSideChatsByParent(prev => {
        const targetParentKey = `${target.workdir}:${target.agent}:${target.sessionId}`;
        const next: OpenSideChatsMap = {};
        for (const [parentKey, slots] of Object.entries(prev)) {
          if (parentKey === targetParentKey) continue;
          const filtered = slots.filter(s => !(s.workdir === target.workdir && s.agent === target.agent && s.sessionId === target.sessionId));
          if (filtered.length) next[parentKey] = filtered;
        }
        return next;
      });
      setSideChatRefsByParent(prev => {
        const targetParentKey = `${target.workdir}:${target.agent}:${target.sessionId}`;
        const next: SideChatRefsMap = {};
        for (const [parentKey, refs] of Object.entries(prev)) {
          if (parentKey === targetParentKey) continue;
          const filtered = refs.filter(ref => !(ref.agent === target.agent && ref.sessionId === target.sessionId));
          if (filtered.length) next[parentKey] = filtered;
        }
        return next;
      });
      setActiveSideChatByParent(prev => {
        const targetParentKey = `${target.workdir}:${target.agent}:${target.sessionId}`;
        const targetSideKey = `${target.agent}:${target.sessionId}`;
        const next: ActiveSideChatsMap = {};
        for (const [parentKey, sideKey] of Object.entries(prev)) {
          if (parentKey === targetParentKey || sideKey === targetSideKey) continue;
          next[parentKey] = sideKey;
        }
        return next;
      });
      setConfirmDeleteSession(null);
    } catch (err: any) {
      toastSession(err?.message || t('session.deleteFailed'), false);
    } finally {
      setDeletingSession(false);
    }
  }, [confirmDeleteSession, deleteSessionPurgeNative, setOpenSideChatsByParent, t, toastSession]);

  /* ── New session — transition after InputComposer creates it ── */
  const [newSessionPendingPrompt, setNewSessionPendingPrompt] = useState<string | null>(null);
  const [newSessionPendingImageUrls, setNewSessionPendingImageUrls] = useState<string[]>([]);
  const [newSessionPendingCreatedAt, setNewSessionPendingCreatedAt] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    setTodoLoading(true);
    try {
      const res = await api.getProTodos();
      if (!res.ok) throw new Error(res.error || 'Failed to load todos');
      setTodoItems(res.items || []);
    } catch (err: any) {
      toastSession(err?.message || 'Failed to load todos', false);
    } finally {
      setTodoLoading(false);
    }
  }, [toastSession]);

  useEffect(() => {
    if (active) void refreshTodos();
  }, [active, refreshTodos]);

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
  }, [loadSessionsForWorkspace, setActiveSlotIndex, setOpenSessions, setShowNewSession, warmSession]);

  const handleMultiSessionCreated = useCallback((nextSessions: Array<{ agent: string; sessionId: string; workdir: string }>, prompt: string) => {
    const unique = nextSessions.filter((session, index, arr) => (
      session.agent
      && session.sessionId
      && arr.findIndex(item => item.agent === session.agent && item.sessionId === session.sessionId && item.workdir === session.workdir) === index
    ));
    if (!unique.length) return;
    const createdAt = new Date().toISOString();
    for (const next of unique) warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    setSessionsMap(prev => {
      const updated = { ...prev };
      for (const next of unique) {
        const existing = updated[next.workdir] || [];
        if (existing.some(s => s.sessionId === next.sessionId && s.agent === next.agent)) continue;
        const stub: SessionInfo = {
          sessionId: next.sessionId,
          agent: next.agent,
          runState: 'running',
          lastQuestion: prompt,
          createdAt,
          runUpdatedAt: createdAt,
        };
        updated[next.workdir] = [stub, ...existing];
      }
      return updated;
    });
    startTransition(() => {
      setNewSessionPendingPrompt(null);
      setNewSessionPendingImageUrls([]);
      setNewSessionPendingCreatedAt(null);
      setShowNewSession(null);
      setOpenSessions(prev => {
        const updated = [...prev];
        for (const next of unique) {
          if (updated.some(s => s.workdir === next.workdir && s.agent === next.agent && s.sessionId === next.sessionId)) continue;
          updated.push({ ...next, mountKey: nextMountKey() });
        }
        setActiveSlotIndex(Math.max(0, updated.length - 1));
        return updated;
      });
    });
    for (const workdir of Array.from(new Set(unique.map(item => item.workdir)))) {
      void loadSessionsForWorkspace(workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, setActiveSlotIndex, setOpenSessions, setShowNewSession, warmSession]);

  const handleNewSessionRequest = useCallback((wsPath: string) => {
    setShowNewSession(wsPath);
    setActiveSlotIndex(openSessionsRef.current.length);
  }, [setActiveSlotIndex, setShowNewSession]);

  const handleCreateTodoChat = useCallback(async (todoIds: string[]) => {
    const ids = Array.from(new Set(todoIds.filter(Boolean)));
    if (!ids.length || todoCreating) return;
    setTodoCreating(true);
    try {
      const res = await api.createProTodoChat({
        todoIds: ids,
        workdir: todoItems.find(item => ids.includes(item.id) && item.source?.workdir)?.source?.workdir || runtimeWorkdir,
      });
      if (!res.ok) throw new Error(res.error || 'Failed to create todo chat');
      if (res.items) setTodoItems(res.items.concat(todoItems.filter(item => !res.items?.some(updated => updated.id === item.id))));
      const session = parseSessionKeyValue(res.queued?.sessionKey);
      if (session) {
        const workdir = todoItems.find(item => ids.includes(item.id) && item.source?.workdir)?.source?.workdir || runtimeWorkdir;
        handleNewSessionCreated(
          { agent: session.agent, sessionId: session.sessionId, workdir },
          todoItems.find(item => ids.includes(item.id))?.title || undefined,
          undefined,
          new Date().toISOString(),
        );
      }
      toastSession(t('todo.chatCreated'));
      void refreshTodos();
    } catch (err: any) {
      toastSession(err?.message || 'Failed to create todo chat', false);
    } finally {
      setTodoCreating(false);
    }
  }, [handleNewSessionCreated, refreshTodos, runtimeWorkdir, t, toastSession, todoCreating, todoItems]);

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    if (!todoId) return;
    try {
      const res = await api.deleteProTodo(todoId);
      if (!res.ok) throw new Error(res.error || 'Failed to delete todo');
      setTodoItems(prev => prev.filter(item => item.id !== todoId));
      toastSession(t('todo.deleted'));
    } catch (err: any) {
      toastSession(err?.message || 'Failed to delete todo', false);
    }
  }, [t, toastSession]);

  const markSessionReadOnOpen = useCallback((session: SessionInfo, workdir: string) => {
    const agent = session.agent || '';
    if (!agent || !session.sessionId || !shouldMarkSessionReadOnOpen(session)) return;
    const readKey = localReadSessionKey(agent, session.sessionId);

    setLocallyReadSessionKeys(prev => {
      if (prev.has(readKey)) return prev;
      const next = new Set(prev);
      next.add(readKey);
      return next;
    });

    setSessionsMap(prev => {
      const list = prev[workdir];
      if (!list) return prev;
      return {
        ...prev,
        [workdir]: list.map(item => (
          item.agent === agent && item.sessionId === session.sessionId
            ? { ...item, userStatus: 'done' as const }
            : item.sideChats?.some(ref => ref.agent === agent && ref.sessionId === session.sessionId)
              ? {
                ...item,
                sideChats: item.sideChats.map(ref => (
                  ref.agent === agent && ref.sessionId === session.sessionId
                    ? { ...ref, userStatus: 'done' as const }
                    : ref
                )),
              }
            : item
        )),
      };
    });
    setSideChatInfoMap(prev => {
      let changed = false;
      const next: Record<string, SessionInfo> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (value.agent === agent && value.sessionId === session.sessionId) {
          next[key] = { ...value, userStatus: 'done' as const };
          changed = true;
        } else {
          next[key] = value;
        }
      }
      return changed ? next : prev;
    });

    void api.updateSessionStatus(workdir, agent, session.sessionId, 'done')
      .then(res => {
        if (!res.ok || !res.updated) {
          if (!res.ok) toastSession(res.error || t('session.updateStatusFailed'), false);
          setLocallyReadSessionKeys(prev => {
            if (!prev.has(readKey)) return prev;
            const next = new Set(prev);
            next.delete(readKey);
            return next;
          });
          void loadSessionsForWorkspace(workdir, { background: true, force: true });
        }
      })
      .catch((err: any) => {
        toastSession(err?.message || t('session.updateStatusFailed'), false);
        setLocallyReadSessionKeys(prev => {
          if (!prev.has(readKey)) return prev;
          const next = new Set(prev);
          next.delete(readKey);
          return next;
        });
        void loadSessionsForWorkspace(workdir, { background: true, force: true });
      });
  }, [loadSessionsForWorkspace, t, toastSession]);

  /* ── Select session — stable callback that takes wsPath ── */
  const handleSelectSession = useCallback((session: SessionInfo, workdir: string) => {
    warmSession(session, workdir);
    markSessionReadOnOpen(session, workdir);
    setShowNewSession(null);
    startTransition(() => {
      setSelectedSession({ agent: session.agent || '', sessionId: session.sessionId, workdir });
    });
  }, [markSessionReadOnOpen, setSelectedSession, setShowNewSession, warmSession]);

  const handlePanelSessionChange = useCallback((next: SessionPanelChange, fromSlotIdx?: number) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    startTransition(() => {
      if (fromSlotIdx != null) {
        if (next.openInNewSlot) {
          setShowNewSession(null);
          setOpenSessions(prev => {
            const existingIdx = prev.findIndex(s => s.workdir === next.workdir && s.agent === next.agent && s.sessionId === next.sessionId);
            if (existingIdx >= 0) {
              setActiveSlotIndex(existingIdx);
              return prev;
            }
            const updated = [...prev, { agent: next.agent, sessionId: next.sessionId, workdir: next.workdir, mountKey: nextMountKey() }];
            setActiveSlotIndex(updated.length - 1);
            return updated;
          });
          return;
        }
        const previousSlot = openSessionsRef.current[fromSlotIdx];
        // Session promotion: update sessionId but preserve mountKey so the
        // panel stays mounted and doesn't lose streaming state.
        setOpenSessions(prev => {
          if (fromSlotIdx >= prev.length) return prev;
          const updated = [...prev];
          updated[fromSlotIdx] = { ...prev[fromSlotIdx], agent: next.agent, sessionId: next.sessionId, workdir: next.workdir };
          return updated;
        });
        if (previousSlot) {
          const oldParentKey = sessionSlotStorageKey(previousSlot);
          const newParentKey = sessionSlotStorageKey({ ...previousSlot, agent: next.agent, sessionId: next.sessionId, workdir: next.workdir });
          if (oldParentKey !== newParentKey) {
            setOpenSideChatsByParent(prev => {
              const slots = prev[oldParentKey];
              if (!slots?.length) return prev;
              const updated = { ...prev };
              delete updated[oldParentKey];
              updated[newParentKey] = slots;
              return updated;
            });
            setActiveSideChatByParent(prev => {
              const activeKey = prev[oldParentKey];
              if (!activeKey) return prev;
              const updated = { ...prev };
              delete updated[oldParentKey];
              updated[newParentKey] = activeKey;
              return updated;
            });
            setSideChatWidthsByParent(prev => {
              const width = prev[oldParentKey];
              if (width == null) return prev;
              const updated = { ...prev };
              delete updated[oldParentKey];
              updated[newParentKey] = width;
              return updated;
            });
          }
        }
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
  }, [loadSessionsForWorkspace, setActiveSideChatByParent, setActiveSlotIndex, setOpenSessions, setOpenSideChatsByParent, setSelectedSession, setSideChatWidthsByParent, warmSession]);

  const mergeSessionIntoWorkspaceMap = useCallback((workdir: string, session: SessionInfo | null | undefined) => {
    if (!session?.sessionId || !session.agent) return;
    setSessionsMap(prev => {
      const existing = prev[workdir] || [];
      const idx = existing.findIndex(s => s.sessionId === session.sessionId && s.agent === session.agent);
      if (idx < 0) return prev;
      const updated = [...existing];
      updated[idx] = { ...existing[idx], ...session };
      return { ...prev, [workdir]: updated };
    });
  }, []);

  const shouldInlineSideChat = openSessions.length <= 1 && !showNewSession;

  const promoteSlotForSideChat = useCallback((slotIdx: number) => {
    setActiveSlotIndex(slotIdx);
    if (!shouldInlineSideChat) setFocusedSlotIndex(slotIdx);
  }, [setActiveSlotIndex, shouldInlineSideChat]);

  const createAndOpenSideChat = useCallback(async (
    slotIdx: number,
    slot: SessionSlot,
    info: SessionInfo,
    options: { promote?: boolean; openPanel?: boolean; activate?: boolean } = {},
  ) => {
    if (!slot.agent || !slot.sessionId) return;
    const shouldPromote = options.promote ?? true;
    const shouldOpenPanel = options.openPanel ?? true;
    const shouldActivate = options.activate ?? true;
    if (shouldPromote) promoteSlotForSideChat(slotIdx);
    const res = await api.createSideChat(slot.workdir, slot.agent, slot.sessionId, t('session.sideChat'));
    if (!res.ok || !res.session?.sessionId) throw new Error(res.error || t('session.sideChatFailed'));
    const sideSession = res.session;
    const sideSlot: SessionSlot = {
      agent: sideSession.agent || slot.agent,
      sessionId: sideSession.sessionId,
      workdir: slot.workdir,
      mountKey: nextMountKey(),
    };
    const parentKey = sessionSlotStorageKey(slot);
    const sideKey = sideChatSlotKey(sideSlot);
    const fallbackRef: SideChatRef = {
      agent: sideSlot.agent,
      sessionId: sideSlot.sessionId,
      title: sideSession.title || t('session.sideChat'),
      createdAt: sideSession.createdAt || new Date().toISOString(),
      updatedAt: sideSession.runUpdatedAt || sideSession.createdAt || new Date().toISOString(),
    };
    setSideChatInfoMap(prev => ({ ...prev, [sessionSlotStorageKey(sideSlot)]: sideSession }));
    setSideChatRefsByParent(prev => ({
      ...prev,
      [parentKey]: mergeSideChatRefs(prev[parentKey], res.parent?.sideChats, [fallbackRef]),
    }));
    mergeSessionIntoWorkspaceMap(slot.workdir, res.parent || info);
    setOpenSideChatsByParent(prev => {
      const existing = prev[parentKey] || [];
      if (existing.some(s => s.agent === sideSlot.agent && s.sessionId === sideSlot.sessionId)) return prev;
      return { ...prev, [parentKey]: dedupeSideChatSlots([...existing, sideSlot]) };
    });
    if (shouldOpenPanel) setSideChatPanelOpenByParent(prev => ({ ...prev, [parentKey]: true }));
    if (shouldActivate) setActiveSideChatByParent(prev => ({ ...prev, [parentKey]: sideKey }));
    warmSession(sideSession, slot.workdir);
    void loadSessionsForWorkspace(slot.workdir, { background: true, force: true });
    return { sideSlot, sideSession };
  }, [loadSessionsForWorkspace, mergeSessionIntoWorkspaceMap, promoteSlotForSideChat, setActiveSideChatByParent, setOpenSideChatsByParent, t, warmSession]);

  const handleOpenSideChat = useCallback(async (slotIdx: number, slot: SessionSlot, info: SessionInfo) => {
    try {
      await createAndOpenSideChat(slotIdx, slot, info);
    } catch (e: any) {
      toastSession(e?.message || t('session.sideChatFailed'));
    }
  }, [createAndOpenSideChat, t, toastSession]);

  const handleCreateSideChatFromSelection = useCallback(async (slotIdx: number, slot: SessionSlot, info: SessionInfo, request: SelectionSideChatRequest) => {
    if (!request.quote.trim() || !request.question.trim()) return;
    try {
      const created = await createAndOpenSideChat(slotIdx, slot, info, { promote: false, openPanel: false, activate: false });
      if (!created?.sideSlot.sessionId) throw new Error(t('session.sideChatFailed'));
      const prompt = buildSelectionSideChatPrompt(request, locale);
      const res = await api.sendSessionMessage(created.sideSlot.workdir, created.sideSlot.agent, created.sideSlot.sessionId, prompt);
      if (!res.ok) throw new Error(res.error || t('session.sideChatFailed'));
      setSideChatInfoMap(prev => {
        const key = sessionSlotStorageKey(created.sideSlot);
        const current = prev[key] || created.sideSession;
        return {
          ...prev,
          [key]: {
            ...current,
            running: true,
            runState: 'running',
            lastQuestion: prompt,
            runUpdatedAt: new Date().toISOString(),
            userStatus: null,
          },
        };
      });
      void loadSessionsForWorkspace(slot.workdir, { background: true, force: true });
    } catch (e: any) {
      toastSession(e?.message || t('session.sideChatFailed'));
      throw e;
    }
  }, [createAndOpenSideChat, loadSessionsForWorkspace, locale, t, toastSession]);

  const handleCreateTodoFromSelection = useCallback(async (slot: SessionSlot, request: SelectionActionRequest) => {
    if (!request.quote.trim() || !request.note.trim()) return;
    const result = await api.createProTodo({
      kind: 'todo',
      title: request.note,
      body: request.note,
      source: {
        type: 'chat-selection',
        workdir: slot.workdir,
        agent: slot.agent,
        sessionId: slot.sessionId,
        turnIndex: request.turnIndex,
        quote: request.quote,
      },
    });
    if (!result.ok) throw new Error(result.error || t('session.todoSaveFailed'));
    toastSession(t('session.todoSaved'));
    void refreshTodos();
  }, [refreshTodos, t, toastSession]);

  const handleCreateReviewCommentFromSelection = useCallback(async (slot: SessionSlot, request: SelectionActionRequest) => {
    if (!request.quote.trim() || !request.note.trim()) return;
    const result = await api.createProReviewComment({
      title: request.note,
      body: request.note,
      source: {
        type: 'review-comment',
        workdir: slot.workdir,
        agent: slot.agent,
        sessionId: slot.sessionId,
        turnIndex: request.turnIndex,
        quote: request.quote,
      },
    });
    if (!result.ok) throw new Error(result.error || t('session.commentSaveFailed'));
    toastSession(t('session.commentSaved'));
  }, [t, toastSession]);

  const handleSaveQuickTodo = useCallback(async () => {
    const body = quickTodoText.trim();
    if (!body || quickTodoSaving) return;
    setQuickTodoSaving(true);
    try {
      const result = await api.createProTodo({
        kind: 'todo',
        title: body,
        body,
        source: {
          type: 'quick-capture',
          workdir: runtimeWorkdir,
        },
      });
      if (!result.ok) throw new Error(result.error || t('session.todoSaveFailed'));
      setQuickTodoText('');
      setQuickTodoOpen(false);
      toastSession(t('session.todoSaved'));
      void refreshTodos();
    } catch (e: any) {
      toastSession(e?.message || t('session.todoSaveFailed'));
    } finally {
      setQuickTodoSaving(false);
    }
  }, [quickTodoSaving, quickTodoText, refreshTodos, runtimeWorkdir, t, toastSession]);

  const handleDeleteSideChat = useCallback(async (parentSlot: SessionSlot, sideSlot: SessionSlot) => {
    if (!sideSlot.agent || !sideSlot.sessionId) return;
    const parentKey = sessionSlotStorageKey(parentSlot);

    setOpenSideChatsByParent(prev => {
      const existing = prev[parentKey] || [];
      return { ...prev, [parentKey]: existing.filter(s => !(s.agent === sideSlot.agent && s.sessionId === sideSlot.sessionId)) };
    });
    setActiveSideChatByParent(prev => {
      if (prev[parentKey] !== sideChatSlotKey(sideSlot)) return prev;
      const remaining = (openSideChatsByParentRef.current[parentKey] || []).filter(s => !(s.agent === sideSlot.agent && s.sessionId === sideSlot.sessionId));
      const next = { ...prev };
      if (remaining.length) next[parentKey] = sideChatSlotKey(remaining[remaining.length - 1]);
      else delete next[parentKey];
      return next;
    });
    setSideChatRefsByParent(prev => {
      const existing = prev[parentKey] || [];
      return {
        ...prev,
        [parentKey]: existing.filter(ref => !(ref.agent === sideSlot.agent && ref.sessionId === sideSlot.sessionId)),
      };
    });
    setSideChatInfoMap(prev => {
      const next = { ...prev };
      delete next[sessionSlotStorageKey(sideSlot)];
      return next;
    });
    setSessionsMap(prev => {
      const sessions = prev[parentSlot.workdir] || [];
      if (!sessions.length) return prev;
      return {
        ...prev,
        [parentSlot.workdir]: sessions
          .filter(s => !(s.agent === sideSlot.agent && s.sessionId === sideSlot.sessionId))
          .map(s => (
            s.agent === parentSlot.agent && s.sessionId === parentSlot.sessionId
              ? { ...s, sideChats: (s.sideChats || []).filter(ref => !(ref.agent === sideSlot.agent && ref.sessionId === sideSlot.sessionId)) }
              : s
          )),
      };
    });

    try {
      const res = await api.deleteSideChat(
        sideSlot.workdir,
        parentSlot.agent,
        parentSlot.sessionId,
        sideSlot.agent,
        sideSlot.sessionId,
      );
      if (!res.ok) throw new Error(res.error || 'Failed to delete side chat');
    } catch {
      try {
        const fallback = await api.deleteSession(sideSlot.workdir, sideSlot.agent, sideSlot.sessionId, false);
        if (!fallback.ok) toastSession(fallback.error || 'Failed to delete side chat', false);
      } catch (fallbackErr) {
        toastSession(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr), false);
      }
    } finally {
      void loadSessionsForWorkspace(parentSlot.workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, setActiveSideChatByParent, setOpenSideChatsByParent, toastSession]);

  const handleSideChatResizeStart = useCallback((parentKey: string, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('[data-side-chat-panel]') as HTMLElement | null;
    const startWidth = panel?.getBoundingClientRect().width
      || sideChatWidthsByParentRef.current[parentKey]
      || SIDE_CHAT_DEFAULT_WIDTH;
    const startX = event.clientX;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampSideChatWidthForViewport(startWidth - (moveEvent.clientX - startX));
      setSideChatWidthsByParent(prev => (
        prev[parentKey] === nextWidth ? prev : { ...prev, [parentKey]: nextWidth }
      ));
    };
    const cleanup = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
  }, [setSideChatWidthsByParent]);

  const handleShowSideChats = useCallback((parentSlot: SessionSlot, refs: SideChatRef[], slotIdx?: number) => {
    if (!refs.length) return;
    if (slotIdx != null) promoteSlotForSideChat(slotIdx);
    const parentKey = sessionSlotStorageKey(parentSlot);
    const items = refs.map(ref => {
      const slot: SessionSlot = {
        agent: ref.agent || parentSlot.agent,
        sessionId: ref.sessionId,
        workdir: parentSlot.workdir,
        mountKey: nextMountKey(),
      };
      const session: SessionInfo = {
        sessionId: slot.sessionId,
        agent: slot.agent,
        title: ref.title || t('session.sideChat'),
        createdAt: ref.createdAt,
        runUpdatedAt: ref.updatedAt,
        runState: 'completed',
        userStatus: ref.userStatus ?? null,
      };
      return { ref, slot, session };
    });
    const slots = items.map(item => item.slot);
    setSideChatInfoMap(prev => {
      let next = prev;
      for (const item of items) {
        const key = sessionSlotStorageKey(item.slot);
        if (next[key]) continue;
        if (next === prev) next = { ...prev };
        next[key] = item.session;
      }
      return next;
    });
    items.forEach(item => warmSession(item.session, parentSlot.workdir));
    setSideChatRefsByParent(prev => ({
      ...prev,
      [parentKey]: mergeSideChatRefs(prev[parentKey], refs),
    }));
    setSideChatPanelOpenByParent(prev => ({ ...prev, [parentKey]: true }));
    setOpenSideChatsByParent(prev => {
      const existing = prev[parentKey] || [];
      const nextSlots = slots.map(slot => existing.find(item => sameSideChatIdentity(item, slot)) || slot);
      return { ...prev, [parentKey]: dedupeSideChatSlots(nextSlots) };
    });
    setActiveSideChatByParent(prev => {
      const previous = prev[parentKey];
      const nextActive = previous && slots.some(slot => sideChatSlotKey(slot) === previous)
        ? previous
        : sideChatSlotKey(slots[0]);
      return { ...prev, [parentKey]: nextActive };
    });
  }, [promoteSlotForSideChat, setActiveSideChatByParent, setOpenSideChatsByParent, t, warmSession]);

  const handleSideChatSessionChange = useCallback((parentSlot: SessionSlot, previousSideSlot: SessionSlot, next: { agent: string; sessionId: string; workdir: string }) => {
    const parentKey = sessionSlotStorageKey(parentSlot);
    const nextSlot: SessionSlot = {
      ...previousSideSlot,
      agent: next.agent,
      sessionId: next.sessionId,
      workdir: next.workdir,
    };
    setSideChatInfoMap(prev => {
      const oldKey = sessionSlotStorageKey(previousSideSlot);
      const nextKey = sessionSlotStorageKey(nextSlot);
      const old = prev[oldKey];
      const updated = { ...prev };
      if (oldKey !== nextKey) delete updated[oldKey];
      updated[nextKey] = { ...(old || { runState: 'running' as const }), agent: next.agent, sessionId: next.sessionId };
      return updated;
    });
    setOpenSideChatsByParent(prev => {
      const existing = prev[parentKey] || [];
      return {
        ...prev,
        [parentKey]: dedupeSideChatSlots(existing.map(s => (
          s.agent === previousSideSlot.agent && s.sessionId === previousSideSlot.sessionId
            ? nextSlot
            : s
        ))),
      };
    });
    setActiveSideChatByParent(prev => (
      prev[parentKey] === sideChatSlotKey(previousSideSlot)
        ? { ...prev, [parentKey]: sideChatSlotKey(nextSlot) }
        : prev
    ));
    setSideChatRefsByParent(prev => {
      const existing = prev[parentKey];
      if (!existing?.length) return prev;
      return {
        ...prev,
        [parentKey]: existing.map(ref => (
          ref.agent === previousSideSlot.agent && ref.sessionId === previousSideSlot.sessionId
            ? { ...ref, agent: next.agent, sessionId: next.sessionId, updatedAt: new Date().toISOString() }
            : ref
        )),
      };
    });
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, setActiveSideChatByParent, setOpenSideChatsByParent]);

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
      out[ws.path] = sortPinnedSessions(groupForkDescendants(filtered));
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

  const resolveSideSlotInfo = useCallback((parentInfo: SessionInfo, sideSlot: SessionSlot): SessionInfo => {
    const key = sessionSlotStorageKey(sideSlot);
    const fromMap = sideChatInfoMap[key];
    const fromWorkspace = (sessionsMap[sideSlot.workdir] || []).find(
      s => s.sessionId === sideSlot.sessionId && s.agent === sideSlot.agent,
    );
    const fromParentRef = (parentInfo.sideChats || []).find(
      ref => ref.sessionId === sideSlot.sessionId && ref.agent === sideSlot.agent,
    );
    const resolved = fromWorkspace ?? fromMap ?? (fromParentRef ? {
      sessionId: fromParentRef.sessionId,
      agent: fromParentRef.agent,
      title: fromParentRef.title || undefined,
      createdAt: fromParentRef.createdAt,
      runUpdatedAt: fromParentRef.updatedAt,
      runState: 'completed' as const,
      userStatus: fromParentRef.userStatus ?? null,
    } : {
      sessionId: sideSlot.sessionId,
      agent: sideSlot.agent,
      runState: 'completed' as const,
    });
    return hydrateSession(resolved);
  }, [hydrateSession, sessionsMap, sideChatInfoMap]);

  // All open session keys for sidebar highlight
  const openSessionKeys = useMemo(() => new Set(openSessions.map(s => sKey(s.agent, s.sessionId))), [openSessions]);
  const selectedKey = selectedSession ? sKey(selectedSession.agent, selectedSession.sessionId) : null;
  const selectedSlotWorkdir = selectedSession?.workdir
    ?? (showNewSession && activeSlotIndex >= openSessions.length ? showNewSession : null);
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
    setDashboardFocusedSlot(null);
    setDashboardCreateTaskWorkdir(workdir);
  }, [t, toastSession]);

  const handleDashboardCreateTask = useCallback(() => {
    const preferred = dashboardScope !== 'all'
      ? dashboardScope
      : runtimeWorkdir || workspaces[0]?.path || '';
    startDashboardTask(preferred);
  }, [dashboardScope, runtimeWorkdir, startDashboardTask, workspaces]);

  const handleOpenDashboardSession = useCallback((item: DashboardSessionItem) => {
    const agent = item.session.agent || '';
    if (!agent || !item.session.sessionId) return;
    warmSession(item.session, item.workdir);
    markSessionReadOnOpen(item.session, item.workdir);
    setDashboardFocusedSlot({
      agent,
      sessionId: item.session.sessionId,
      workdir: item.workdir,
      mountKey: nextMountKey(),
    });
  }, [markSessionReadOnOpen, warmSession]);

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
    if (!isFileLinkInsideWorkspace(workdir, target.path)) {
      void api.openInEditor(target.path).then(res => {
        if (!res.ok) toastSession(res.error || `Failed to open ${target.path}`, false);
      }).catch((error: any) => {
        toastSession(error?.message || String(error), false);
      });
      return;
    }
    setFilePanelRequest({
      workdir,
      path: target.path,
      line: target.line,
      nonce: ++filePanelRequestSeqRef.current,
    });
    setFileTreeOpen(true);
  }, [toastSession]);

  useEffect(() => {
    if (mode === 'dashboard') return;
    setDashboardFocusedSlot(null);
    setDashboardCreateTaskWorkdir(null);
  }, [mode]);

  useEffect(() => {
    const taskColumnVisible = mode === 'dashboard' || (mode === 'workspace' && chatLayout === 'column');
    if (!taskColumnVisible || (!dashboardFocusedSlot && !dashboardCreateTaskWorkdir)) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDashboardCreateTaskWorkdir(null);
      setDashboardFocusedSlot(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatLayout, dashboardCreateTaskWorkdir, dashboardFocusedSlot, mode]);
  const closeFocusMode = useCallback(() => {
    const snapshot = focusedOpenSessionsSnapshotRef.current;
    focusedOpenSessionsSnapshotRef.current = null;
    setFocusedSlotIndex(null);
    if (!snapshot) return;

    setOpenSessions(prev => {
      const currentByStorageKey = new Map(prev.map(slot => [sessionSlotStorageKey(slot), slot]));
      const currentByMountKey = new Map(prev.map(slot => [slot.mountKey, slot]));
      const usedCurrentSlots = new Set<SessionSlot>();
      let restoredMissingSlot = false;
      const orderedSlots: SessionSlot[] = [];

      snapshot.slots.forEach((snapshotSlot, snapshotIndex) => {
        const currentSlot = currentByStorageKey.get(sessionSlotStorageKey(snapshotSlot)) || currentByMountKey.get(snapshotSlot.mountKey);
        if (currentSlot) {
          orderedSlots.push(currentSlot);
          usedCurrentSlots.add(currentSlot);
          return;
        }
        if (snapshotIndex === snapshot.focusedIndex) return;
        orderedSlots.push({ ...snapshotSlot });
        restoredMissingSlot = true;
      });
      prev.forEach(slot => {
        if (!usedCurrentSlots.has(slot)) orderedSlots.push(slot);
      });

      return restoredMissingSlot ? orderedSlots : prev;
    });
  }, [setOpenSessions]);
  const enterFocusMode = useCallback((slotIdx: number) => {
    focusedOpenSessionsSnapshotRef.current = {
      slots: openSessionsRef.current.map(slot => ({ ...slot })),
      focusedIndex: slotIdx,
    };
    setActiveSlotIndex(slotIdx);
    setSlotMenu(null);
    setFocusedSlotIndex(slotIdx);
  }, [setActiveSlotIndex]);
  const handleSlotDoubleClick = useCallback((slotIdx: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (shouldIgnoreFocusModeTarget(event.target)) return;
    enterFocusMode(slotIdx);
  }, [enterFocusMode]);

  useEffect(() => {
    if (focusedSlotIndex == null) return;
    if (focusedSlotIndex >= openSessions.length) setFocusedSlotIndex(null);
  }, [focusedSlotIndex, openSessions.length]);

  useEffect(() => {
    writeBrowserStorage(FOCUSED_SLOT_STORAGE_KEY, focusedSlotIndex == null ? null : String(focusedSlotIndex));
  }, [focusedSlotIndex]);

  useEffect(() => {
    if (focusedSlotIndex == null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFocusMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeFocusMode, focusedSlotIndex]);
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
      const closing = prev[index];
      if (closing) {
        setOpenSideChatsByParent(sidePrev => {
          const next = { ...sidePrev };
          delete next[sessionSlotStorageKey(closing)];
          return next;
        });
      }
      const next = prev.filter((_, i) => i !== index);
      // Adjust activeSlotIndex
      if (next.length === 0) {
        setActiveSlotIndex(0);
      } else if (activeSlotRef.current >= next.length) {
        setActiveSlotIndex(next.length - 1);
      }
      return next;
    });
  }, [setActiveSlotIndex, setOpenSessions, setOpenSideChatsByParent]);

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

  const renderedOpenSessions = openSessions;
  const visibleSlotCount = Math.max(1, renderedOpenSessions.length + (showNewSession ? 1 : 0));
  const gridColumnCount = Math.min(3, visibleSlotCount);
  const gridRowCount = Math.ceil(visibleSlotCount / gridColumnCount);
  const gridNeedsVerticalScroll = gridRowCount > SESSION_GRID_MAX_VISIBLE_ROWS;
  const gridHeight = gridNeedsVerticalScroll
    ? `calc(${(gridRowCount / SESSION_GRID_MAX_VISIBLE_ROWS) * 100}% + ${Math.max(0, (gridRowCount / SESSION_GRID_MAX_VISIBLE_ROWS - 1) * SESSION_GRID_GAP_PX)}px)`
    : '100%';
  const dashboardFocusedInfo = dashboardFocusedSlot ? resolveSlotInfo(dashboardFocusedSlot) : null;
  const chatLayoutBar = (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-edge/70 bg-panel/80 px-3 py-2 shadow-sm">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg">{t('tab.sessions')}</div>
        <div className="mt-0.5 text-[11px] text-fg-5">{t('chat.layoutHint')}</div>
      </div>
      <div className="inline-flex max-w-full shrink-0 overflow-x-auto rounded-lg border border-edge bg-panel-alt p-0.5">
        {(['layout', 'column'] as const).map(view => (
          <button
            key={view}
            type="button"
            onClick={() => setChatLayout(view)}
            className={cn(
              'h-7 rounded-md px-3 text-[12px] font-semibold transition',
              chatLayout === view ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-4 hover:bg-panel hover:text-fg-2',
            )}
          >
            {view === 'layout' ? t('chat.layoutMode') : t('chat.columnMode')}
          </button>
        ))}
      </div>
    </div>
  );
  const workspaceColumnContent = (
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
  );

  useEffect(() => {
    if (focusedSlotIndex != null) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-session-slot-index="${activeSlotIndex}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeSlotIndex, focusedSlotIndex, openSessions.length, showNewSession]);

  return (
    <div className="relative h-full overflow-hidden p-3 flex gap-3 mx-auto">
      {/* ═══ Left Panel — Session Navigator ═══ */}
      <div
        className={cn(
          'relative h-full shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-out',
          workspaceSidebarCollapsed ? 'w-10' : 'w-[280px]',
          focusedSlotIndex != null && 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          onClick={() => {
            setWorkspaceSidebarCollapsed(false);
            navigate('/', { state: { forceWorkspace: true } });
          }}
          className={cn(
            'group absolute left-0 top-3 z-40 flex h-12 w-11 items-center justify-center overflow-hidden border border-l-0 border-edge/65 bg-panel/92 text-fg-5 shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition-[opacity,transform,border-color,background-color,color,width] duration-200 hover:w-[74px] hover:border-edge-h hover:bg-panel-h hover:text-fg-2',
            workspaceSidebarCollapsed ? 'translate-x-0 opacity-100 delay-150' : '-translate-x-2 opacity-0 pointer-events-none',
          )}
          style={{ borderTopRightRadius: 16, borderBottomRightRadius: 12, clipPath: 'polygon(0 0, 100% 7%, 88% 100%, 0 100%)' }}
          title={t('rail.workspace')}
          aria-label={t('rail.workspace')}
        >
          <span className="-translate-x-1 rotate-[-10deg] scale-90 transition-transform duration-200 group-hover:translate-x-0 group-hover:rotate-0 group-hover:scale-100" aria-hidden="true">
            <PikiclawLogo />
          </span>
          <span className="ml-1 hidden whitespace-nowrap text-[10px] font-semibold group-hover:inline">{t('rail.workspace')}</span>
        </button>
        <Link
          to="/dashboard?view=jira"
          className={cn(
            'group absolute left-0 top-[68px] z-40 flex h-10 w-9 items-center justify-center overflow-hidden border border-l-0 border-edge/60 bg-panel/92 text-fg-5 shadow-[0_6px_16px_rgba(15,23,42,0.10)] transition-[opacity,transform,border-color,background-color,color,width] duration-200 hover:w-[78px] hover:border-edge-h hover:bg-panel-h hover:text-fg-2',
            workspaceSidebarCollapsed ? 'translate-x-0 opacity-100 delay-200' : '-translate-x-2 opacity-0 pointer-events-none',
          )}
          style={{ borderTopRightRadius: 12, borderBottomRightRadius: 15, clipPath: 'polygon(0 4%, 100% 0, 90% 92%, 0 100%)' }}
          title={t('rail.dashboard')}
          aria-label={t('rail.dashboard')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover:scale-110" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span className="ml-2 hidden whitespace-nowrap text-[10px] font-semibold group-hover:inline">{t('rail.dashboard')}</span>
        </Link>
        <button
          type="button"
          onClick={() => setQuickTodoOpen(true)}
          className={cn(
            'group absolute left-0 top-[116px] z-40 flex h-9 w-8 items-center justify-center overflow-hidden border border-l-0 border-edge/60 bg-panel/92 text-fg-5 shadow-[0_6px_16px_rgba(15,23,42,0.10)] transition-[opacity,transform,border-color,background-color,color,width] duration-200 hover:w-[62px] hover:border-edge-h hover:bg-panel-h hover:text-fg-2',
            workspaceSidebarCollapsed ? 'translate-x-0 opacity-100 delay-[250ms]' : '-translate-x-2 opacity-0 pointer-events-none',
          )}
          style={{ borderTopRightRadius: 10, borderBottomRightRadius: 14, clipPath: 'polygon(0 0, 100% 8%, 100% 92%, 0 100%)' }}
          title={t('rail.todo')}
          aria-label={t('rail.todo')}
        >
          <TodoGlyph className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
          <span className="ml-2 hidden whitespace-nowrap text-[10px] font-semibold group-hover:inline">{t('rail.todo')}</span>
        </button>
      <div
        className={cn(
          'panel-isolated absolute inset-y-0 left-0 w-[280px] flex flex-col overflow-hidden rounded-xl border border-edge/70 bg-panel/90 backdrop-blur-sm transition-[transform,opacity] duration-300 ease-out',
          workspaceSidebarCollapsed ? '-translate-x-[292px] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100',
        )}
        style={{ boxShadow: 'var(--th-card-shadow)' }}
      >
        <WorkspaceSidebarHeader
          onCollapse={() => setWorkspaceSidebarCollapsed(true)}
          collapseLabel={t('hub.hideWorkspaceSidebar')}
          version={version}
        />

        {/* Search */}
        <div className="border-b border-edge/20 bg-panel/55 px-3 py-3">
          <div className="flex items-center gap-1.5">
            <div className="relative group min-w-0 flex-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-5/40 group-focus-within:text-fg-4 transition-colors">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('hub.search')}
                className="w-full rounded-lg border border-control-border bg-control pl-8 pr-7 py-1.5 text-[12px] text-fg shadow-sm outline-none placeholder:text-fg-5/35 transition-all duration-200 hover:border-control-border-h focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowAddDialog(v => !v)}
              title={t('hub.addWorkspace')}
              aria-label={t('hub.addWorkspace')}
              className="h-8 w-8 shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTodoModalOpen(true)}
              title={t('todo.workspaceTitle')}
              aria-label={t('todo.workspaceTitle')}
              className="relative h-8 w-8 shrink-0"
            >
              <TodoGlyph className="h-3.5 w-3.5" />
              {todoItems.some(item => item.status === 'open') && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_0_2px_var(--th-panel)]" />
              )}
            </Button>
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
              <Fragment key={ws.path}>
                <WorkspaceGroup
                  workspace={ws}
                  sessions={filteredByWs[ws.path] || []}
                  loading={!!loadingMap[ws.path] || !(ws.path in sessionsMap)}
                  isActive={ws.path === runtimeWorkdir}
                  selectedKey={selectedKey}
                  selectedWorkdir={selectedSlotWorkdir}
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
              </Fragment>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="relative shrink-0 border-t border-edge/20 px-3 py-2">
          {workspaceSettingsOpen && workspaceSettingsAnchor && createPortal((
            <div
              className="fixed z-[220] rounded-lg border border-edge bg-panel/98 py-1 shadow-[0_12px_32px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.10)] backdrop-blur-md"
              style={{
                width: WORKSPACE_SETTINGS_MENU_WIDTH,
                left: Math.min(
                  workspaceSettingsAnchor.right + 8,
                  window.innerWidth - WORKSPACE_SETTINGS_MENU_WIDTH - 8,
                ),
                top: Math.max(
                  8,
                  Math.min(
                    workspaceSettingsAnchor.bottom - WORKSPACE_SETTINGS_MENU_HEIGHT,
                    window.innerHeight - WORKSPACE_SETTINGS_MENU_HEIGHT - 8,
                  ),
                ),
              }}
              onMouseDown={e => e.stopPropagation()}
              role="menu"
            >
              {workspaceSettingsItems.map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setWorkspaceSettingsOpen(false)}
                  className={cn(menuItemClass(), 'py-2 text-fg-3')}
                  role="menuitem"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ), document.body)}
          {todoModalOpen && createPortal((
            <TodoCenterModal
              items={todoItems}
              loading={todoLoading}
              creating={todoCreating}
              onClose={() => setTodoModalOpen(false)}
              onCreateTodo={() => setQuickTodoOpen(true)}
              onCreateChat={(ids) => void handleCreateTodoChat(ids)}
              onDelete={(id) => void handleDeleteTodo(id)}
              onRefresh={() => void refreshTodos()}
              t={t}
            />
          ), document.body)}
          {quickTodoOpen && createPortal((
            <div
              className="fixed inset-0 z-[240] flex items-center justify-center bg-black/20 px-4 py-10 backdrop-blur-[2px]"
              onMouseDown={() => setQuickTodoOpen(false)}
            >
              <div
                className="w-full max-w-[420px] rounded-xl border border-edge-h bg-panel p-3 shadow-xl"
                onMouseDown={event => event.stopPropagation()}
              >
                <div className="mb-2 text-[13px] font-semibold text-fg">{t('todo.quickAdd')}</div>
                <textarea
                  autoFocus
                  value={quickTodoText}
                  onChange={event => setQuickTodoText(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleSaveQuickTodo();
                    }
                  }}
                  placeholder={t('todo.quickAddPlaceholder')}
                  className="min-h-24 w-full resize-y rounded-lg border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/60 focus:border-control-border-h focus:ring-2 focus:ring-[color:var(--th-selection-ring)]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setQuickTodoOpen(false)}>{t('common.cancel')}</Button>
                  <Button variant="primary" disabled={!quickTodoText.trim() || quickTodoSaving} onClick={handleSaveQuickTodo}>
                    {quickTodoSaving ? <Spinner /> : null}
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          ), document.body)}
          <WorkspaceSidebarRuntimeControls
            appStatus={appStatus}
            restartPhase={restartPhase}
            onRestartClick={onRestartClick}
            restartLabel={t('sidebar.restart')}
            confirmRestartLabel={t('modal.confirmRestart')}
            restartingLabel={t('modal.restarting')}
            theme={theme}
            onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            themeToggleLabel={themeToggleLabel}
            locale={locale}
            onToggleLocale={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
            settingsButtonRef={workspaceSettingsButtonRef}
            onOpenSettings={openWorkspaceSettings}
            settingsLabel={t('settings.menu')}
            settingsOpen={workspaceSettingsOpen}
          />
        </div>
      </div>
      </div>

      {/* ═══ Center Panel — Grid of session slots ═══ */}
      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col overflow-hidden gap-0',
        )}
      >
        {mode === 'dashboard' ? (
          <>
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-edge/70 bg-panel/80 px-3 py-2 shadow-sm">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-fg">{t('tab.dashboard')}</div>
                <div className="mt-0.5 text-[11px] text-fg-5">{t('tabDesc.jira')}</div>
              </div>
              <div className="inline-flex max-w-full shrink-0 overflow-x-auto rounded-lg border border-edge bg-panel-alt p-0.5">
                <button
                  type="button"
                  className="h-7 rounded-md bg-panel-h px-3 text-[12px] font-semibold text-fg shadow-sm"
                >
                  {t('dashboard.viewJira')}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge/70 bg-panel/80 p-3 shadow-[var(--th-card-shadow)]">
              {dashboardJiraContent}
            </div>
          </>
        ) : mode === 'settings' ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-edge/70 bg-panel/80 shadow-[var(--th-card-shadow)]">
            {settingsContent}
          </div>
        ) : chatLayout === 'column' ? (
          <>
            {chatLayoutBar}
            {workspaceColumnContent}
          </>
        ) : (
          <>
            {chatLayoutBar}
            {focusedSlotIndex != null && (
              <div
                className="fixed inset-0 z-[60] bg-[var(--th-focus-backdrop)]"
                aria-hidden="true"
                onClick={closeFocusMode}
              />
            )}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <div
                className="grid min-h-full gap-3"
                style={{
                  height: gridHeight,
                  gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${gridRowCount}, minmax(0, 1fr))`,
                }}
              >
              {(() => {
                const newSessionSlot = showNewSession ? renderedOpenSessions.length : -1;
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
                      workspaces={workspaces}
                      onSessionCreated={handleNewSessionCreated}
                      onMultiSessionCreated={handleMultiSessionCreated}
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
              const slot = renderedOpenSessions[slotIdx] ?? null;
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
              const isSpotlighted = isActive && spotlightSlotIndex === slotIdx;
              const isFocused = focusedSlotIndex === slotIdx;
              const slotState = sessionDisplayState(info);
              const hasUnreadCompletedState = shouldMarkSessionReadOnOpen(info);
              const slotTitle = info.title || info.lastQuestion?.slice(0, 120) || slot.sessionId.slice(0, 12);
              const workspaceDisplayName = workspaces.find(ws => ws.path === slot.workdir)?.name || workspaceBaseName(slot.workdir);
              const slotActionTarget: SessionActionTarget = {
                workdir: slot.workdir,
                agent: slot.agent,
                sessionId: slot.sessionId,
                title: sessionListDisplayText(info).slice(0, 120) || slot.sessionId.slice(0, 16),
                pinned: info.pinned === true,
                archived: info.archived === true,
              };
              const isHeaderRenaming = headerRenameTarget?.workdir === slot.workdir
                && headerRenameTarget.agent === slot.agent
                && headerRenameTarget.sessionId === slot.sessionId;
              const parentSlotKey = sessionSlotStorageKey(slot);
              const openSideSlots = dedupeSideChatSlots(openSideChatsByParent[parentSlotKey] || []);
              const sideChatRefs = mergeSideChatRefs(info.sideChats, sideChatRefsByParent[parentSlotKey]);
              const knownSideKeys = new Set(sideChatRefs.map(ref => `${ref.agent}:${ref.sessionId}`));
              const sideRefsKnown = Array.isArray(info.sideChats) || !!sideChatRefsByParent[parentSlotKey]?.length;
              const visibleOpenSideSlots = sideRefsKnown
                ? openSideSlots.filter(sideSlot => knownSideKeys.has(sideChatSlotKey(sideSlot)))
                : openSideSlots;
              const activeSideKey = activeSideChatByParent[parentSlotKey];
              const activeSideSlot = visibleOpenSideSlots.find(s => sideChatSlotKey(s) === activeSideKey) || visibleOpenSideSlots[0] || null;
              const sideChatPanelOpen = sideChatPanelOpenByParent[parentSlotKey] === true;
              const renderSidePanel = sideChatPanelOpen && (isFocused || shouldInlineSideChat);
              const sideChatRefSlots = sideChatRefs.map(ref => ({
                agent: ref.agent || slot.agent,
                sessionId: ref.sessionId,
                workdir: slot.workdir,
                mountKey: '',
              }));
              const sideChatKnownSlots = [...visibleOpenSideSlots, ...sideChatRefSlots];
              const sideChatKnownKeys = new Set<string>();
              const uniqueSideChatKnownSlots = sideChatKnownSlots.filter(sideSlot => {
                const key = sideChatSlotKey(sideSlot);
                if (sideChatKnownKeys.has(key)) return false;
                sideChatKnownKeys.add(key);
                return true;
              });
              const hasSideChats = uniqueSideChatKnownSlots.length > 0;
              const sideChatsHaveRunning = uniqueSideChatKnownSlots.some(sideSlot => sessionDisplayState(resolveSideSlotInfo(info, sideSlot)) === 'running');
              const sideChatsHaveUnread = uniqueSideChatKnownSlots.some(sideSlot => shouldMarkSessionReadOnOpen(resolveSideSlotInfo(info, sideSlot)));
              const sideChatToggleLabel = renderSidePanel
                ? t('session.hideSideChat')
                : hasSideChats
                  ? t('session.showSideChats')
                  : t('session.newSideChat');
              const sideChatWidth = sideChatWidthsByParent[parentSlotKey] || SIDE_CHAT_DEFAULT_WIDTH;
              const slotFrameClass = isFocused
                ? 'fixed inset-y-4 left-1/2 z-[70] w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border-edge-h/80 bg-[var(--th-modal-bg)] ring-[1px] ring-inset ring-white/[0.06] sm:w-[min(1080px,calc(100vw-48px))] md:inset-y-8 md:w-[min(1180px,calc(100vw-64px))]'
                : isActive
                ? 'border-[color:var(--th-selection-border)] bg-panel-h/60'
                : 'border-edge/70 hover:border-edge-h hover:bg-panel-h/35';
              const slotHeaderClass = isActive
                ? 'border-b-[color:var(--th-selection-border)] bg-[var(--th-selected-bg)]'
                : 'bg-panel/95';
              const slotShadow = isFocused
                ? 'var(--th-elevated-shadow)'
                : isActive
                ? 'var(--th-card-shadow), 0 0 0 1px var(--th-selection-ring)'
                : 'var(--th-card-shadow)';
              return (
                <div
                  key={slot.mountKey || sKey(slot.agent, slot.sessionId)}
                  data-session-slot
                  data-session-slot-index={slotIdx}
                  className={cn(
                    'min-w-0 overflow-hidden rounded-xl border bg-panel flex flex-col transition-[border-color,box-shadow,transform,opacity,background-color] duration-200',
                    isFocused ? 'fixed' : 'relative',
                    slotFrameClass,
                    !isFocused && 'hover:-translate-y-[1px]',
                    hasUnreadCompletedState && !isActive && !isFocused && 'border-ok/55 bg-ok/[0.035] ring-2 ring-ok/15',
                    draggingSlotIndex === slotIdx && 'opacity-75 scale-[0.985] ring-2 ring-[color:var(--th-selection-ring)]',
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-[var(--th-selected-bg)] ring-2 ring-[color:var(--th-selection-ring)]',
                  )}
                  style={{ boxShadow: slotShadow }}
                  onClick={() => {
                    if (window.getSelection()?.toString().trim()) return;
                    setActiveSlotIndex(slotIdx);
                    markSessionReadOnOpen(info, slot.workdir);
                  }}
                  onDoubleClick={e => handleSlotDoubleClick(slotIdx, e)}
                  onDragOver={e => handleSlotDragOver(slotIdx, e)}
                  onDrop={e => handleSlotDrop(slotIdx, e)}
                >
                  {isActive && !isFocused && (
                    <>
                      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-px rounded-l-xl bg-[var(--th-selection-accent)]" aria-hidden="true" />
                      <div
                        className={cn(
                          'pointer-events-none absolute inset-0 z-20 rounded-xl border border-[color:var(--th-selection-border)] bg-[var(--th-selection-soft)] transition-opacity duration-700',
                          isSpotlighted ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                    </>
                  )}
                  {/* Tab bar: [● workdir / title          created  updated  turns  📁  ×] */}
                  <div className={cn(
                    'group shrink-0 flex items-center gap-2 px-3 h-9 border-b border-edge/45 shadow-[0_1px_0_var(--th-inset-hl)]',
                    'cursor-grab active:cursor-grabbing',
                    slotHeaderClass,
                    hasUnreadCompletedState && !isFocused && 'border-b-ok/35 bg-ok/[0.055]',
                    isFocused && 'border-edge-h/70 bg-[var(--th-header)]',
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-[var(--th-selected-bg)]',
                  )}
                    draggable
                    onDragStart={e => handleSlotDragStart(slotIdx, e)}
                    onDragEnd={handleSlotDragEnd}
                    title={t('hub.dragSession')}
                  >
                    {/* Left: status · workdir / title */}
                    {slotState === 'running' ? (
                      <Dot variant="ok" pulse />
                    ) : slotState === 'incomplete' ? (
                      <Dot variant="warn" />
                    ) : hasUnreadCompletedState ? (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_var(--th-panel),0_0_8px_var(--th-ok-glow)] ring-1 ring-ok/25"
                      />
                    ) : null}
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold shadow-sm transition-colors',
                          isActive
                            ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selected-bg)] text-fg'
                            : 'border-edge/45 bg-control/70 text-fg-4',
                        )}
                        title={slot.workdir}
                      >
                        {workspaceDisplayName}
                      </span>
                      <span className="shrink-0 text-fg-6 text-[10px]">/</span>
                      {isHeaderRenaming ? (
                        <input
                          ref={headerRenameInputRef}
                          data-focus-ignore
                          value={headerRenameTitle}
                          disabled={headerRenamingSession}
                          onChange={e => setHeaderRenameTitle(e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                          onDoubleClick={e => e.stopPropagation()}
                          onBlur={() => {
                            if (skipHeaderRenameBlurRef.current) {
                              skipHeaderRenameBlurRef.current = false;
                              return;
                            }
                            void executeHeaderRenameSession();
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              skipHeaderRenameBlurRef.current = true;
                              void executeHeaderRenameSession();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelHeaderRenameSession();
                            }
                          }}
                          className="h-6 min-w-0 flex-1 rounded-md border border-control-border bg-panel px-1.5 text-[11px] font-semibold text-fg shadow-sm outline-none transition focus:border-control-border-h focus:ring-2 focus:ring-[color:var(--th-selection-ring)] disabled:opacity-60"
                          aria-label={t('session.rename')}
                        />
                      ) : (
                        <div
                          className={cn(
                            'min-w-0 flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold transition-colors',
                            isActive ? 'bg-[var(--th-selected-bg)] text-fg shadow-sm' : 'text-fg',
                          )}
                          title={slotTitle}
                        >
                          <span className="min-w-0 truncate">{slotTitle}</span>
                          {hasUnreadCompletedState && (
                            <span className="shrink-0 rounded border border-ok/25 bg-ok/[0.10] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-ok">
                              {t('session.statusCompleted')}
                            </span>
                          )}
                          <button
                            data-focus-ignore
                            type="button"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              setActiveSlotIndex(slotIdx);
                              openHeaderRenameSession(slotActionTarget);
                            }}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-5/60 opacity-0 transition-[opacity,background,color] hover:bg-panel-h hover:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)] group-hover:opacity-100"
                            title={t('session.rename')}
                            aria-label={t('session.rename')}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Right: compact meta + explicit action menu */}
                    <div className="shrink-0 flex items-center gap-2 text-[9px] text-fg-5/50 tabular-nums">
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
                        data-focus-ignore
                        type="button"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          setActiveSlotIndex(slotIdx);
                          if (renderSidePanel) {
                            setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: false }));
                            return;
                          }
                          if (sideChatRefs.length > 0) {
                            handleShowSideChats(slot, sideChatRefs, slotIdx);
                            return;
                          }
                          if (hasSideChats) {
                            visibleOpenSideSlots.forEach(sideSlot => {
                              warmSession(resolveSideSlotInfo(info, sideSlot), sideSlot.workdir);
                            });
                            setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: true }));
                            promoteSlotForSideChat(slotIdx);
                            return;
                          }
                          setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: true }));
                          promoteSlotForSideChat(slotIdx);
                        }}
                        className={cn(
                          'relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-5/70 transition-colors hover:bg-panel-h hover:text-fg',
                          renderSidePanel && 'bg-[var(--th-selected-bg)] text-fg',
                        )}
                        title={sideChatToggleLabel}
                        aria-label={sideChatToggleLabel}
                      >
                        <SideChatCollapseIcon className="h-3.5 w-3.5 shrink-0" />
                        {!renderSidePanel && (sideChatsHaveRunning || sideChatsHaveUnread) && (
                          <span
                            className={cn(
                              'absolute right-1 top-1 rounded-full',
                              sideChatsHaveRunning
                                ? 'h-2 w-2 animate-pulse bg-primary shadow-[0_0_8px_var(--th-selection-ring)]'
                                : 'h-2 w-2 bg-ok shadow-[0_0_8px_var(--th-ok-glow)]',
                            )}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                      {isFocused && (
                        <button
                          data-focus-ignore
                          type="button"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); closeFocusMode(); }}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-edge/45 bg-panel/60 text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
                          title={t('hub.exitFocusMode')}
                          aria-label={t('hub.exitFocusMode')}
                        >
                          <ExitFocusIcon className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      )}
                      {!isFocused && (
                        <>
                          <button
                            data-focus-ignore
                            type="button"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              enterFocusMode(slotIdx);
                            }}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-5/70 transition-colors hover:bg-panel-h hover:text-fg"
                            title={t('hub.enterFocusMode')}
                            aria-label={t('hub.enterFocusMode')}
                          >
                            <EnterFocusIcon className="h-3.5 w-3.5 shrink-0" />
                          </button>
                          <button
                            data-focus-ignore
                            type="button"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              handleSlotMenuOpen(e.currentTarget.getBoundingClientRect(), slotIdx, slot, info);
                            }}
                            className={cn(
                              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] font-semibold leading-none text-fg-5/70 transition-colors hover:bg-panel-h hover:text-fg-2',
                              slotMenu?.slotIdx === slotIdx && 'bg-panel-h text-fg-2',
                            )}
                            title={t('session.openActions')}
                            aria-label={t('session.openActions')}
                            aria-haspopup="menu"
                          >
                            ...
                          </button>
                          <button
                            data-focus-ignore
                            type="button"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              setSlotMenu(null);
                              handleCloseSlot(slotIdx);
                            }}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-5/70 transition-colors hover:bg-err/10 hover:text-err"
                            title={t('hub.closePanel')}
                            aria-label={t('hub.closePanel')}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                              <path d="M18 6 6 18" />
                              <path d="M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={cn('flex-1 min-h-0 flex flex-col overflow-hidden', isFocused && 'bg-[var(--th-modal-bg)]')}>
                    <div className={cn('flex-1 min-h-0 flex overflow-hidden', isFocused && 'bg-[var(--th-session-bg)]')}>
                      <div className={cn('min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden', isFocused && 'bg-[var(--th-session-bg)]')}>
                        <Suspense fallback={<div className="h-full" />}>
                          <SessionPanel
                            key={slot.mountKey}
                            session={info}
                            workdir={slot.workdir}
                            active={active && isActive}
                            onSessionChange={(next) => handlePanelSessionChange(next, slotIdx)}
                            onMultiSessionChange={handleMultiSessionCreated}
                            onOpenFileLink={(target) => handleOpenFileLink(slotIdx, slot.workdir, target)}
                            onCreateSideChatFromSelection={(request) => handleCreateSideChatFromSelection(slotIdx, slot, info, request)}
                            onCreateTodoFromSelection={(request) => handleCreateTodoFromSelection(slot, request)}
                            onCreateReviewCommentFromSelection={(request) => handleCreateReviewCommentFromSelection(slot, request)}
                            initialPendingPrompt={isActive ? newSessionPendingPrompt : null}
                            initialPendingImageUrls={isActive ? newSessionPendingImageUrls : undefined}
                            initialPendingCreatedAt={isActive ? newSessionPendingCreatedAt : null}
                            onPendingPromptConsumed={isActive ? () => { setNewSessionPendingPrompt(null); setNewSessionPendingImageUrls([]); setNewSessionPendingCreatedAt(null); } : undefined}
                          />
                        </Suspense>
                      </div>
                      {renderSidePanel && (
                        <div
                          data-side-chat-panel
                          className="relative min-h-0 shrink-0 border-l border-edge-h/80 bg-[var(--th-modal-bg)] shadow-[-16px_0_42px_rgba(2,6,23,0.22)] flex flex-col"
                          style={{
                            width: sideChatWidth,
                            minWidth: SIDE_CHAT_MIN_WIDTH,
                            maxWidth: `min(${SIDE_CHAT_MAX_WIDTH}px, 46vw)`,
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div
                            data-focus-ignore
                            role="separator"
                            aria-orientation="vertical"
                            title={t('session.resizeSideChat')}
                            aria-label={t('session.resizeSideChat')}
                            onPointerDown={e => handleSideChatResizeStart(parentSlotKey, e)}
                            className="group absolute left-0 top-0 z-20 h-full w-4 -translate-x-1/2 cursor-col-resize touch-none"
                          >
                            <div className="mx-auto h-full w-px bg-edge-h/60 transition-colors group-hover:w-[2px] group-hover:bg-fg-5/70" />
                          </div>
                          <div className="h-10 shrink-0 flex items-end gap-1 bg-panel-alt/70 px-2 pt-1">
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex w-full min-w-0 items-end gap-0.5">
                                {visibleOpenSideSlots.map((sideSlot, sideSlotIdx) => {
                                  const sideInfo = resolveSideSlotInfo(info, sideSlot);
                                  const sideTitle = sideChatDisplayTitle(sideSlotIdx, t('session.sideChat'));
                                  const sideKey = sideChatSlotKey(sideSlot);
                                  const tabActive = !!activeSideSlot && sideKey === sideChatSlotKey(activeSideSlot);
                                  const sideUnread = !tabActive && shouldMarkSessionReadOnOpen(sideInfo);
                                  const crowdedSideTabs = visibleOpenSideSlots.length > 2;
                                  return (
                                    <div
                                      key={sideSlot.mountKey || sessionSlotStorageKey(sideSlot)}
                                      className={cn(
                                        'relative flex h-8 min-w-0 items-center rounded-t-lg border px-0 transition-colors',
                                        crowdedSideTabs ? 'flex-1 basis-0' : 'w-[148px] shrink-0',
                                        tabActive
                                          ? 'z-10 border-edge-h border-b-0 bg-[var(--th-session-bg)] text-fg shadow-[0_-1px_0_var(--th-inset-hl)]'
                                          : 'border-edge/55 bg-panel/65 text-fg-3 hover:border-edge-h hover:bg-panel-h/70 hover:text-fg',
                                      )}
                                      title={sideTitle}
                                    >
                                      <button
                                        type="button"
                                        onClick={e => {
                                          e.stopPropagation();
                                          setActiveSideChatByParent(prev => ({ ...prev, [parentSlotKey]: sideKey }));
                                          markSessionReadOnOpen(sideInfo, sideSlot.workdir);
                                        }}
                                        className="min-w-0 flex-1 px-2 text-left text-[11px]"
                                      >
                                        <span className="flex min-w-0 items-center gap-1.5">
                                          {sideUnread && (
                                            <span
                                              aria-hidden="true"
                                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_6px_var(--th-ok-glow)]"
                                            />
                                          )}
                                          <span className="min-w-0 truncate">{sideTitle}</span>
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); void handleDeleteSideChat(slot, sideSlot); }}
                                        className={cn(
                                          'mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
                                          tabActive ? 'text-fg-4 hover:bg-panel-alt hover:text-fg' : 'text-fg-5 hover:bg-panel-h hover:text-fg',
                                        )}
                                        title={t('hub.closePanel')}
                                        aria-label={t('hub.closePanel')}
                                      >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                                          <path d="M18 6 6 18" />
                                          <path d="M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); void handleOpenSideChat(slotIdx, slot, info); }}
                              className="mb-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge/60 bg-panel/75 text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
                              title={t('session.newSideChat')}
                              aria-label={t('session.newSideChat')}
                            >
                              +
                            </button>
                          </div>
                          <div className="min-h-0 flex flex-1 flex-col overflow-hidden bg-[var(--th-session-bg)]">
                            {activeSideSlot ? (() => {
                              const sideInfo = resolveSideSlotInfo(info, activeSideSlot);
                              return (
                                <Suspense fallback={<div className="h-full" />}>
                                  <SessionPanel
                                    key={activeSideSlot.mountKey}
                                    session={sideInfo}
                                    workdir={activeSideSlot.workdir}
                                    active={active && isActive}
                                    onSessionChange={(next) => handleSideChatSessionChange(slot, activeSideSlot, next)}
                                    onOpenFileLink={(target) => handleOpenFileLink(slotIdx, activeSideSlot.workdir, target)}
                                    onCreateTodoFromSelection={(request) => handleCreateTodoFromSelection(activeSideSlot, request)}
                                    onCreateReviewCommentFromSelection={(request) => handleCreateReviewCommentFromSelection(activeSideSlot, request)}
                                  />
                                </Suspense>
                              );
                            })() : (
                              <div className="flex h-full items-center justify-center px-6 text-center">
                                <div className="max-w-[260px]">
                                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-edge/60 bg-panel/70 text-fg-5/70">
                                    <SideChatCollapseIcon className="h-5 w-5" />
                                  </div>
                                  <div className="text-[13px] font-semibold text-fg-3">{t('session.noSideChatYet')}</div>
                                  <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{t('session.noSideChatYetHint')}</div>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); void handleOpenSideChat(slotIdx, slot, info); }}
                                    className="mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-edge/70 bg-panel px-3 text-[12px] font-semibold text-fg-3 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
                });
              })()}
              </div>
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
          elevated={focusedSlotIndex != null}
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
              onClick={() => void executePinSession(sessionMenu.target, !sessionMenu.target.pinned)}
              className={menuItemClass('primary')}
            >
              {sessionMenu.target.pinned ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M14 2l8 8-2 2-1.5-1.5-4.7 4.7.2 4.8-1.5 1.5-4.2-4.2L3 22l-1-1 4.2-4.8L2 12l1.5-1.5 4.8.2 4.7-4.7L12 4z" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2l8 8-2 2-1.5-1.5-4.7 4.7.2 4.8-1.5 1.5-4.2-4.2L3 22l-1-1 4.2-4.8L2 12l1.5-1.5 4.8.2 4.7-4.7L12 4z" />
                </svg>
              )}
              {sessionMenu.target.pinned ? t('session.unpin') : t('session.pin')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openRenameSessionModal(sessionMenu.target)}
              className={menuItemClass()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z" />
              </svg>
              {t('session.rename')}
            </button>
            {sessionMenu.target.unread && (
              <button
                type="button"
                role="menuitem"
                onClick={() => void executeMarkSessionRead(sessionMenu.target)}
                className={menuItemClass('primary')}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {t('session.markRead')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => void executeArchiveSession(sessionMenu.target, !sessionMenu.target.archived)}
              className={menuItemClass('primary')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />
              </svg>
              {sessionMenu.target.archived ? t('session.restore') : t('session.archive')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openDeleteSessionModal(sessionMenu.target)}
              className={menuItemClass('danger')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
              </svg>
              {t('session.delete')}
            </button>
          </div>
        );
      })()}

      {/* Chat window actions popover — anchored under the header kebab */}
      {slotMenu && (() => {
        const MENU_WIDTH = 176;
        const left = Math.max(8, Math.min(slotMenu.anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
        const top = Math.min(slotMenu.anchor.bottom + 4, window.innerHeight - 180);
        const runSlotAction = (action: () => void) => {
          setSlotMenu(null);
          action();
        };
        const menuSlot = openSessions[slotMenu.slotIdx] || null;
        const menuInfo = menuSlot ? resolveSlotInfo(menuSlot) : null;
        return (
          <div
            className="fixed z-[60] min-w-[176px] rounded-md border border-edge bg-panel/95 backdrop-blur-md py-1"
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
              onClick={() => runSlotAction(() => handleNewSessionRequest(slotMenu.target.workdir))}
              className={menuItemClass('primary')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('hub.newSession')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!menuSlot || !menuInfo}
              onClick={() => runSlotAction(() => {
                if (menuSlot && menuInfo) void handleOpenSideChat(slotMenu.slotIdx, menuSlot, menuInfo);
              })}
              className={cn(menuItemClass('primary'), 'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-fg-2')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /><path d="M7 9h4" /><path d="M7 13h4" />
              </svg>
              {t('session.newSideChat')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runSlotAction(() => {
                setActiveSlotIndex(slotMenu.slotIdx);
                setFilePanelRequest(null);
                setFileTreeOpen(true);
              })}
              className={menuItemClass()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              {t('hub.files')}
            </button>
            <div role="separator" className="my-1 border-t border-edge/70" />
            <button
              type="button"
              role="menuitem"
              onClick={() => runSlotAction(() => { void executeArchiveSession(slotMenu.target, !slotMenu.target.archived); })}
              className={menuItemClass('primary')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />
              </svg>
              {slotMenu.target.archived ? t('session.restore') : t('session.archive')}
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
  workspaces,
  onSessionCreated,
  onMultiSessionCreated,
  onClose,
  t,
}: {
  workdir: string;
  workspaceName: string;
  workspaces: WorkspaceEntry[];
  onSessionCreated: (next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => void;
  onMultiSessionCreated: (next: Array<{ agent: string; sessionId: string; workdir: string }>, prompt: string) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [selectedWorkdir, setSelectedWorkdir] = useState(workdir);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>([]);
  const [pendingCreatedAt, setPendingCreatedAt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingImageUrlsRef = useRef<string[]>([]);
  const pendingCreatedAtRef = useRef<string | null>(null);
  const workspaceChoices = useMemo(() => {
    const byPath = new Map<string, WorkspaceEntry>();
    for (const ws of workspaces) byPath.set(ws.path, ws);
    if (selectedWorkdir && !byPath.has(selectedWorkdir)) {
      byPath.set(selectedWorkdir, { path: selectedWorkdir, name: workspaceName || workspaceBaseName(selectedWorkdir) });
    }
    return Array.from(byPath.values());
  }, [selectedWorkdir, workspaceName, workspaces]);
  const selectedWorkspace = workspaceChoices.find(ws => ws.path === selectedWorkdir);
  const selectedWorkspaceName = selectedWorkspace?.name || workspaceName || workspaceBaseName(selectedWorkdir);

  const stubSession = useMemo((): SessionInfo => ({
    sessionId: '',
    agent: '',
    runState: 'completed',
  }), []);

  useEffect(() => {
    setSelectedWorkdir(workdir);
  }, [workdir]);

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
        <label className={cn(
          'flex min-w-0 shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] text-fg-5/70 transition-colors',
          hasPending ? 'opacity-70' : 'hover:border-edge/60 hover:bg-panel-h/70 hover:text-fg-3',
        )}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <select
            value={selectedWorkdir}
            disabled={hasPending}
            onChange={e => setSelectedWorkdir(e.target.value)}
            className="max-w-[120px] min-w-0 appearance-none bg-transparent text-[10px] font-medium text-current outline-none disabled:cursor-not-allowed"
            title={`${selectedWorkspaceName} · ${selectedWorkdir}`}
            aria-label={t('modal.workdir')}
          >
            {workspaceChoices.map(ws => (
              <option key={ws.path} value={ws.path}>
                {ws.name || workspaceBaseName(ws.path)}
              </option>
            ))}
          </select>
          {!hasPending && (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </label>
        <Dot variant={hasPending ? 'ok' : 'idle'} pulse={hasPending} />
        {!hasPending && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-fg-5 hover:text-fg-2 transition-colors"
            title={t('hub.closePanel')}
            aria-label={t('hub.closePanel')}
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
        workdir={selectedWorkdir}
        onStreamQueued={noop}
        onSendStart={handleSendStart}
        onSessionChange={handleSessionCreated}
        onMultiSessionChange={onMultiSessionCreated}
        t={t}
        streamPhase={null}
      />
    </div>
  );
}

function DashboardCreateTaskModal({
  workdir,
  workspaceName,
  workspaces,
  onClose,
  onSessionCreated,
  t,
}: {
  workdir: string;
  workspaceName: string;
  workspaces: WorkspaceEntry[];
  onClose: () => void;
  onSessionCreated: (next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => void;
  t: (key: string) => string;
}) {
  const state = useStore(s => s.state);
  const toast = useStore(s => s.toast);
  const [selectedWorkdir, setSelectedWorkdir] = useState(workdir);
  const [agent, setAgent] = useState(state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex');
  const [taskText, setTaskText] = useState('');
  const [creating, setCreating] = useState(false);
  const workspaceChoices = useMemo(() => {
    const byPath = new Map<string, WorkspaceEntry>();
    for (const ws of workspaces) byPath.set(ws.path, ws);
    if (selectedWorkdir && !byPath.has(selectedWorkdir)) {
      byPath.set(selectedWorkdir, { path: selectedWorkdir, name: workspaceName || workspaceBaseName(selectedWorkdir) });
    }
    return Array.from(byPath.values());
  }, [selectedWorkdir, workspaceName, workspaces]);

  useEffect(() => setSelectedWorkdir(workdir), [workdir]);

  const generatedTitle = useMemo(() => {
    const firstLine = taskText.trim().split('\n').find(Boolean) || '';
    const normalized = firstLine.replace(/\s+/g, ' ');
    return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
  }, [taskText]);

  const createTask = useCallback(async () => {
    const body = taskText.trim();
    if (!body || creating) return;
    setCreating(true);
    const title = generatedTitle || 'New task';
    const createdAt = new Date().toISOString();
    const prompt = [
      `Task: ${title}`,
      '',
      body,
      '',
      'Please start by clarifying the goal, boundary, and acceptance points, then proceed with the task when ready.',
    ].join('\n');
    try {
      const result = await api.sendSessionMessage(selectedWorkdir, agent, '', prompt);
      if (!result.ok) throw new Error(result.error || 'Failed to create task');
      onSessionCreated(
        { agent, sessionId: result.sessionKey || result.taskId || '', workdir: selectedWorkdir },
        prompt,
        undefined,
        createdAt,
      );
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create task', false);
    } finally {
      setCreating(false);
    }
  }, [agent, creating, generatedTitle, onClose, onSessionCreated, selectedWorkdir, taskText, toast]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-[var(--th-overlay)] backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('dashboard.createTask')}
        className="fixed left-1/2 top-16 z-[70] flex w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-primary/50 bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.35)] ring-[4px] ring-primary/[0.10] sm:w-[min(620px,calc(100vw-48px))]"
      >
        <div className="border-b border-edge px-4 py-3">
          <div className="text-[15px] font-semibold text-fg">{t('dashboard.createTask')}</div>
          <div className="mt-1 text-[12px] text-fg-5">{t('dashboard.createTaskHint')}</div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <textarea
            autoFocus
            value={taskText}
            onChange={event => setTaskText(event.target.value)}
            placeholder={t('dashboard.createTaskPlaceholder')}
            className="min-h-32 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="rounded-md border border-edge bg-panel-alt px-3 py-2 text-[12px] text-fg-4">
            <span className="text-fg-5">{t('dashboard.generatedTitle')}: </span>
            <span className="font-medium text-fg-2">{generatedTitle || '--'}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">{t('dashboard.defaultWorkspace')}</div>
              <select
                value={selectedWorkdir}
                onChange={event => setSelectedWorkdir(event.target.value)}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
              >
                {workspaceChoices.map(ws => (
                  <option key={ws.path} value={ws.path}>{ws.name || workspaceBaseName(ws.path)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">{t('dashboard.defaultAgent')}</div>
              <select
                value={agent}
                onChange={event => setAgent(event.target.value)}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
              >
                {['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes'].map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={creating}>{t('modal.cancel')}</Button>
          <Button variant="primary" onClick={() => void createTask()} disabled={!taskText.trim() || creating}>
            {creating ? <Spinner /> : null}
            {t('dashboard.createTask')}
          </Button>
        </div>
      </div>
    </>
  );
}

function TodoCenterModal({
  items,
  loading,
  creating,
  onClose,
  onCreateTodo,
  onCreateChat,
  onDelete,
  onRefresh,
  t,
}: {
  items: TodoItem[];
  loading: boolean;
  creating: boolean;
  onClose: () => void;
  onCreateTodo: () => void;
  onCreateChat: (todoIds: string[]) => void;
  onDelete: (todoId: string) => void;
  onRefresh: () => void;
  t: (key: string) => string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menu, setMenu] = useState<null | { itemId: string; anchor: DOMRect }>(null);
  const activeItems = items.filter(item => item.status === 'open' || item.status === 'chat-created');
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>, itemId: string) => {
    event.stopPropagation();
    setMenu({ itemId, anchor: event.currentTarget.getBoundingClientRect() });
  }, []);
  const runMenuAction = useCallback((action: () => void) => {
    closeMenu();
    action();
  }, [closeMenu]);
  const toggleSelected = useCallback((todoId: string) => {
    setSelectedIds(prev => prev.includes(todoId) ? prev.filter(id => id !== todoId) : [...prev, todoId]);
  }, []);
  const selectedActiveIds = selectedIds.filter(id => activeItems.some(item => item.id === id));
  const startChatIds = selectedActiveIds.length ? selectedActiveIds : activeItems.slice(0, 1).map(item => item.id);

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/24 px-4 py-8 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="flex max-h-[min(720px,calc(100vh-64px))] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-edge-h bg-panel shadow-[0_24px_72px_rgba(15,23,42,0.24)]"
        onMouseDown={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('todo.workspaceTitle')}
      >
        <div className="shrink-0 border-b border-edge/45 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-edge bg-panel-alt text-fg-3">
              <TodoGlyph className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-[15px] font-semibold text-fg">{t('todo.workspaceTitle')}</div>
                <Badge variant="muted" className="h-5 px-1.5 text-[10px]">{activeItems.length}</Badge>
              </div>
              <div className="mt-0.5 text-[12px] text-fg-5">{t('todo.modalSubtitle')}</div>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-5 transition hover:bg-panel-h hover:text-fg" aria-label={t('common.close')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
              {loading ? <Spinner className="h-3 w-3" /> : null}
              {t('hub.refresh')}
            </Button>
            <Button variant="secondary" size="sm" onClick={onCreateTodo}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('todo.createTodo')}
            </Button>
            <Button variant="primary" size="sm" disabled={!startChatIds.length || creating} onClick={() => onCreateChat(startChatIds)}>
              {creating ? <Spinner className="h-3 w-3" /> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                </svg>
              )}
              {selectedActiveIds.length > 1 ? t('todo.startSelectedChat') : t('todo.createChat')}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {loading && !activeItems.length ? (
              <div className="flex h-32 items-center justify-center"><Spinner className="h-4 w-4 text-fg-5" /></div>
            ) : activeItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-edge/45 px-4 py-12 text-center text-[13px] text-fg-5">{t('todo.empty')}</div>
            ) : activeItems.map(item => (
              <div key={item.id} className={cn(
                'group rounded-lg border px-3 py-2.5 transition hover:border-edge/80 hover:bg-panel-alt',
                selectedIds.includes(item.id) ? 'border-primary/45 bg-primary/5' : 'border-edge/45 bg-panel-alt/55',
              )}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-edge"
                    aria-label={item.title}
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13px] font-medium text-fg-3 group-hover:text-fg">{item.title}</div>
                    {item.source?.quote && <div className="mt-1.5 line-clamp-3 rounded-md bg-inset px-2 py-1.5 text-[11px] leading-relaxed text-fg-5">{item.source.quote}</div>}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-fg-5">
                      <span>{item.kind}</span>
                      <span>{item.status}</span>
                      <span>{fmtRelative(item.createdAt || item.updatedAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={event => openMenu(event, item.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-5 opacity-70 transition hover:bg-panel-h hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
                    aria-label={t('session.openActions')}
                    aria-haspopup="menu"
                  >
                    ...
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {menu && (() => {
        const MENU_WIDTH = 156;
        const left = Math.max(8, Math.min(menu.anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
        const top = Math.min(menu.anchor.bottom + 4, window.innerHeight - 96);
        return createPortal((
          <div className="fixed z-[250] min-w-[156px] rounded-md border border-edge bg-panel/95 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.10)] backdrop-blur-md" style={{ left, top }} onMouseDown={event => event.stopPropagation()} role="menu">
            <button type="button" role="menuitem" disabled={creating} onClick={() => runMenuAction(() => onCreateChat([menu.itemId]))} className={cn(menuItemClass('primary'), 'disabled:cursor-not-allowed disabled:opacity-45')}>
              {creating ? <Spinner className="h-3 w-3" /> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                </svg>
              )}
              {t('todo.createChat')}
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(() => onDelete(menu.itemId))} className={menuItemClass('danger')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
              {t('todo.delete')}
            </button>
          </div>
        ), document.body);
      })()}
    </div>
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
        className="fixed inset-0 z-[60] bg-[var(--th-overlay)] backdrop-blur-[2px]"
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
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-edge/45 bg-panel/60 text-fg-4 transition-colors hover:border-primary/30 hover:bg-primary/[0.08] hover:text-primary"
            title={t('hub.exitFocusMode')}
            aria-label={t('hub.exitFocusMode')}
          >
            <ExitFocusIcon className="h-3.5 w-3.5 shrink-0" />
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
  selectedWorkdir,
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
  selectedWorkdir: string | null;
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
  const wsPath = workspace.path;
  const [expanded, setExpanded] = useState(() => readStoredWorkspaceExpanded(wsPath));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [actionsAnchor, setActionsAnchor] = useState<{ right: number; bottom: number; panelLeft: number; panelRight: number } | null>(null);

  // Reset pagination when sessions change
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [sessions.length]);
  useEffect(() => { setExpanded(readStoredWorkspaceExpanded(wsPath)); }, [wsPath]);
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
  const normalizedSelectedWorkdir = selectedWorkdir ? normalizeLocalPathForCompare(selectedWorkdir) : null;
  const groupContainsSelectedSession = (
    normalizedSelectedWorkdir === normalizeLocalPathForCompare(wsPath)
    || (!!selectedKey && sessions.some(session => sKey(session.agent || '', session.sessionId) === selectedKey))
  );
  const groupHeaderSelected = groupContainsSelectedSession;
  const groupAttention = !expanded ? workspaceGroupAttention(sessions) : null;

  const originalName = workspaceBaseName(wsPath);
  const displayName = workspace.name || originalName;
  const hasAlias = displayName !== originalName;
  const openActions = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const panelRect = event.currentTarget.closest('.panel-isolated')?.getBoundingClientRect();
    setActionsAnchor(prev => prev ? null : {
      right: rect.right,
      bottom: rect.bottom,
      panelLeft: panelRect?.left ?? 8,
      panelRight: panelRect?.right ?? window.innerWidth - 8,
    });
  };
  const runAction = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    event.stopPropagation();
    setActionsAnchor(null);
    action();
  };

  return (
    <div className="border-b border-edge-h/55 py-2 last:border-b-0">
      {/* Workspace header */}
      <div
        data-workspace-path={wsPath}
        draggable
        className={cn(
          'mx-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer transition-[background,border-color,box-shadow,opacity] duration-150',
          groupHeaderSelected
            ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selection-bg)] ring-1 ring-[color:var(--th-selection-ring)] shadow-[inset_3px_0_0_var(--th-selection-accent)] hover:bg-[var(--th-selection-bg-h)]'
            : isActive
              ? 'border-edge-h/70 bg-panel-h/75 hover:border-edge-h hover:bg-panel-h'
            : 'border-transparent bg-transparent hover:border-edge/70 hover:bg-panel-h/45',
          draggingPath === wsPath && 'opacity-60',
          dragOverPath === wsPath && draggingPath !== wsPath && 'bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)]',
        )}
        onClick={() => setExpanded(v => {
          const next = !v;
          writeStoredWorkspaceExpanded(wsPath, next);
          return next;
        })}
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
        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
          <span className={cn('shrink-0 whitespace-nowrap text-[12px] font-semibold', groupHeaderSelected ? 'text-fg' : 'text-fg-2')}>
            {displayName}
          </span>
          {hasAlias && (
            <span className="min-w-0 flex-1 truncate text-[10px] font-normal text-fg-5/45" title={wsPath}>
              {originalName}
            </span>
          )}
        </div>
        {groupAttention && <Dot variant={groupAttention.variant} pulse={groupAttention.pulse} />}
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
          aria-haspopup="menu"
        >
          ...
        </button>
        {actionsAnchor && (() => {
          const MENU_WIDTH = 168;
          const MENU_HEIGHT = 174;
          const panelInset = 8;
          const availableWidth = Math.max(132, actionsAnchor.panelRight - actionsAnchor.panelLeft - panelInset * 2);
          const menuWidth = Math.min(MENU_WIDTH, availableWidth);
          const left = Math.max(
            actionsAnchor.panelLeft + panelInset,
            Math.min(actionsAnchor.right - menuWidth, actionsAnchor.panelRight - menuWidth - panelInset),
          );
          const top = Math.max(panelInset, Math.min(actionsAnchor.bottom + 2, window.innerHeight - MENU_HEIGHT - panelInset));
          const menu = (
            <div
              data-workspace-action-menu
              className="fixed z-[220] overflow-hidden rounded-lg border border-edge/70 bg-panel py-1 shadow-[0_10px_24px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.08)]"
              style={{ left, top, width: menuWidth }}
              onMouseDown={e => e.stopPropagation()}
              role="menu"
            >
          <button
            onClick={e => runAction(e, () => onNewSession(wsPath))}
            className={menuItemClass('primary')}
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
            className={menuItemClass('primary')}
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
            className={menuItemClass('primary')}
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
            className={menuItemClass()}
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
              className={menuItemClass('danger')}
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
          return createPortal(menu, document.body);
        })()}
      </div>

      {/* Sessions */}
      {expanded && (
        <div className="mt-1 px-2 pb-1">
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
  const originLabel = sessionOriginLabel(session);
  const attentionVariant = sessionAttentionVariant(session);
  const showUnreadDot = !!attentionVariant && displayState !== 'running';
  const indentPx = forkDepth > 0 ? Math.min(forkDepth, 3) * 14 : 0;
  const baseLeftPx = 12;

  const kebabRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="relative group">
    <button
      data-session-card
      onClick={onClick}
      onMouseEnter={onWarm}
      onFocus={onWarm}
      onMouseLeave={onCancelWarm}
      onBlur={onCancelWarm}
      className={cn(
        'h-[86px] w-full overflow-hidden rounded-lg border pr-3 py-2 text-left transition-[background,border-color,box-shadow,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]',
        isSelected
          ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)] hover:bg-[var(--th-selection-bg-h)] shadow-sm'
          : isOpen
            ? 'border-[color:var(--th-selection-ring)] bg-[var(--th-selection-soft)] hover:border-[color:var(--th-selection-border)] hover:bg-[var(--th-selection-bg)] hover:ring-2 hover:ring-inset hover:ring-[color:var(--th-selection-ring)]'
            : 'border-edge/45 bg-panel/55 hover:border-edge-h hover:bg-panel-h/55',
        !isSelected && 'hover:translate-x-0.5',
        isSelected && 'shadow-[inset_4px_0_0_var(--th-selection-accent)]',
      )}
      style={{
        paddingLeft: baseLeftPx + indentPx,
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
        {session.pinned && (
          <span title={t('session.pinned')} className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-primary/85">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M14 2l8 8-2 2-1.5-1.5-4.7 4.7.2 4.8-1.5 1.5-4.2-4.2L3 22l-1-1 4.2-4.8L2 12l1.5-1.5 4.8.2 4.7-4.7L12 4z" />
            </svg>
          </span>
        )}
        {modelShort && (
          <span className="truncate max-w-[72px] font-mono text-fg-5/40 text-[9px]">{modelShort}</span>
        )}
        {originLabel && (
          <span
            title={sessionOriginTitle(session)}
            className="shrink-0 rounded border border-edge/50 bg-fg-5/[0.06] px-1 py-0.5 text-[8px] font-semibold uppercase leading-none text-fg-5/70"
          >
            {originLabel}
          </span>
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
      {/* Row 2: unread/attention dot + title */}
      <div className="mt-1 flex h-[34px] items-start gap-1.5 overflow-hidden">
        {showUnreadDot && (
          <span
            aria-hidden="true"
            className={cn(
              'mt-[5px] h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_2px_var(--th-panel)]',
              attentionVariant === 'ok'
                ? 'bg-ok'
                : attentionVariant === 'warn'
                  ? 'bg-warn'
                  : 'bg-primary',
            )}
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 break-words text-[12px] font-semibold leading-snug text-fg',
            showUnreadDot && 'font-bold',
          )}
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
              : 'bg-fg-5/10 text-fg-3',
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
        className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded border border-edge/40 bg-panel/95 text-fg-5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-panel-h hover:text-fg-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
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
  elevated = false,
}: {
  workdir: string;
  request?: FilePanelRequest | null;
  onClose: () => void;
  t: (key: string) => string;
  elevated?: boolean;
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
      className={cn(
        'fixed flex flex-col overflow-hidden rounded-xl border border-edge bg-panel/95 backdrop-blur-md',
        elevated ? 'z-[90]' : 'z-50',
      )}
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
