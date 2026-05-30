import { Fragment, Suspense, lazy, startTransition, useDeferredValue, useState, useEffect, useLayoutEffect, useCallback, useRef, memo, useMemo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
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
import type { AppState, SessionInfo, TodoItem, WorkspaceEntry, DirEntry, GitChange, OpenTarget, ProTask, ProTaskKind, ProTaskStage, ProTaskStatus, ProTaskWorkbench, StageRun } from '../../types';
import { InputComposer } from './InputComposer';
import { UserBubble, type SelectionActionRequest, type SelectionSideChatRequest } from './TurnView';
import { ThinkingDots } from './LivePreview';
import { WorkspaceExtensionsModal } from '../extensions/WorkspaceExtensionsModal';
import type { FileLinkTarget } from './markdown';
import type { SessionPanelChange } from './SessionPanel';
import { ContextShelf, type ContextShelfTab } from './ContextShelf';

// Kick off SessionPanel import the moment this module loads so the lazy boundary
// resolves before the user can compose & send a new message. The previous
// "preload on active" effect was reactive to mount and could lose the race.
let sessionPanelModulePromise: Promise<typeof import('./SessionPanel')> | null = import('./SessionPanel');

function preloadSessionPanel() {
  sessionPanelModulePromise ??= import('./SessionPanel');
  return sessionPanelModulePromise;
}

const SessionPanel = lazy(async () => ({ default: (await preloadSessionPanel()).SessionPanel }));

function isSessionComposerFocused() {
  if (typeof document === 'undefined') return false;
  return !!document.activeElement?.closest('[data-session-composer]');
}

/* ── Constants ── */
const PAGE_SIZE = 15;
const AUTO_PREFETCH_DELAY_MS = 240;
const HOVER_PREFETCH_DELAY_MS = 120;
const SESSION_PREFETCH_TURNS = 12;
const LIVE_SESSION_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const STATUS_SUMMARY_RECENT_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WORKSPACE_REFRESH_MIN_INTERVAL_MS = 15_000;
const sKey = (agent: string, id: string) => `${agent}:${id}`;
const isPikiclawMetaPath = (value: string) => value === '.pikiclaw' || value.startsWith('.pikiclaw/');
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

function fmtSidebarSessionTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
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

function ThreeUpLayoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2.5" y="5" width="5.4" height="14" rx="1.5" />
      <rect x="9.3" y="5" width="5.4" height="14" rx="1.5" />
      <rect x="16.1" y="5" width="5.4" height="14" rx="1.5" />
    </svg>
  );
}

function SingleLayoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function EnterFocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

function ExitFocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 3v4a2 2 0 0 1-2 2H3" />
      <path d="M15 3v4a2 2 0 0 0 2 2h4" />
      <path d="M9 21v-4a2 2 0 0 0-2-2H3" />
      <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
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
type SessionSlot = { agent: string; sessionId: string; workdir: string; mountKey: string; archiveOnly?: boolean };
type FocusFloatingSession = {
  id: string;
  workdir: string;
  agent: string;
  sessionId?: string;
  mountKey: string;
  hidden?: boolean;
  x?: number;
  y?: number;
  pendingPrompt?: string | null;
  pendingImageUrls?: string[];
  pendingCreatedAt?: string | null;
};
type FocusFloatingDrag = {
  itemId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
type SlotPointerDrag = {
  from: number;
  over: number;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  agent: string;
  state: string;
  visible: boolean;
};
type SlotDragLayoutItem = {
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
type MultiRowHeightDrag = {
  pointerId: number;
  startY: number;
  startHeight: number;
};
type ContextCardMode = 'floating' | 'docked';
type ContextCardPlacement = {
  mode: ContextCardMode;
  x: number;
  y: number;
  width: number;
  height: number;
};
type ContextCardDrag = {
  parentKey: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
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
const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'pikiclaw:session-workspace:workspace-sidebar-collapsed:v2';
const CHAT_LAYOUT_STORAGE_KEY = 'pikiclaw:session-workspace:chat-layout:v1';
const MULTI_ROW_HEIGHT_STORAGE_KEY = 'pikiclaw:session-workspace:multi-row-height:v1';
const CONTEXT_SHELF_TAB_STORAGE_KEY = 'pikiclaw:session-workspace:context-shelf-tabs:v1';
const LOCAL_READ_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:local-read-sessions:v1';
const LEGACY_OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw-open-sessions';
const LEGACY_ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw-active-slot';
const SIDE_CHAT_DEFAULT_WIDTH = 440;
const SIDE_CHAT_MIN_WIDTH = 340;
const SIDE_CHAT_MAX_WIDTH = 760;
const FOCUS_FLOATING_DEFAULT_WIDTH = 430;
const FOCUS_FLOATING_DEFAULT_HEIGHT = 620;
const FOCUS_FLOATING_MARGIN = 24;
const FOCUS_FLOATING_CASCADE_OFFSET = 28;
const CONTEXT_CARD_DEFAULT_WIDTH = 420;
const CONTEXT_CARD_DEFAULT_HEIGHT = 620;
const CONTEXT_CARD_MIN_MARGIN = 12;
const CONTEXT_CARD_DOCK_SNAP_PX = 112;
const SESSION_GRID_MAX_VISIBLE_ROWS = 2;
const SESSION_GRID_GAP_PX = 16;
const MULTI_ROW_HEIGHT_MIN_PX = 320;
const MULTI_ROW_HEIGHT_MAX_PX = 900;

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

function clampMultiRowHeightForViewport(value: number): number {
  const viewportMax = typeof window === 'undefined'
    ? MULTI_ROW_HEIGHT_MAX_PX
    : Math.max(MULTI_ROW_HEIGHT_MIN_PX, Math.min(MULTI_ROW_HEIGHT_MAX_PX, window.innerHeight - 32));
  return Math.round(Math.min(viewportMax, Math.max(MULTI_ROW_HEIGHT_MIN_PX, value)));
}

function readStoredMultiRowHeight(): number | null {
  const raw = readBrowserStorage(MULTI_ROW_HEIGHT_STORAGE_KEY);
  if (raw == null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return clampMultiRowHeightForViewport(parsed);
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
        archiveOnly: s.archiveOnly === true,
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

function defaultContextCardPlacement(): ContextCardPlacement {
  if (typeof window === 'undefined') {
    return {
      mode: 'floating',
      x: 960,
      y: 76,
      width: CONTEXT_CARD_DEFAULT_WIDTH,
      height: CONTEXT_CARD_DEFAULT_HEIGHT,
    };
  }
  const width = Math.min(CONTEXT_CARD_DEFAULT_WIDTH, Math.max(340, window.innerWidth - 48));
  const height = Math.min(CONTEXT_CARD_DEFAULT_HEIGHT, Math.max(420, window.innerHeight - 96));
  return {
    mode: 'floating',
    x: Math.max(CONTEXT_CARD_MIN_MARGIN, window.innerWidth - width - 28),
    y: Math.max(CONTEXT_CARD_MIN_MARGIN, Math.min(76, window.innerHeight - height - CONTEXT_CARD_MIN_MARGIN)),
    width,
    height,
  };
}

function clampContextCardPlacement(placement: ContextCardPlacement): ContextCardPlacement {
  if (typeof window === 'undefined' || placement.mode === 'docked') return placement;
  const width = Math.min(Math.max(placement.width, 340), Math.max(340, window.innerWidth - CONTEXT_CARD_MIN_MARGIN * 2));
  const height = Math.min(Math.max(placement.height, 420), Math.max(420, window.innerHeight - CONTEXT_CARD_MIN_MARGIN * 2));
  return {
    ...placement,
    width,
    height,
    x: Math.max(CONTEXT_CARD_MIN_MARGIN, Math.min(placement.x, window.innerWidth - width - CONTEXT_CARD_MIN_MARGIN)),
    y: Math.max(CONTEXT_CARD_MIN_MARGIN, Math.min(placement.y, window.innerHeight - height - CONTEXT_CARD_MIN_MARGIN)),
  };
}

type FocusFloatingBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function focusFloatingBounds(): FocusFloatingBounds {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
  }
  const host = document.querySelector<HTMLElement>('[data-focus-session-host="true"]');
  const rect = host?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function focusFloatingSize(bounds = focusFloatingBounds()) {
  if (typeof window === 'undefined') {
    return { width: FOCUS_FLOATING_DEFAULT_WIDTH, height: FOCUS_FLOATING_DEFAULT_HEIGHT };
  }
  return {
    width: Math.min(FOCUS_FLOATING_DEFAULT_WIDTH, Math.max(280, bounds.width - FOCUS_FLOATING_MARGIN * 2)),
    height: Math.min(FOCUS_FLOATING_DEFAULT_HEIGHT, Math.max(360, bounds.height - FOCUS_FLOATING_MARGIN * 2)),
  };
}

function defaultFocusFloatingPosition(index = 0): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 960, y: 260 };
  const bounds = focusFloatingBounds();
  const size = focusFloatingSize(bounds);
  const offset = (index % 6) * FOCUS_FLOATING_CASCADE_OFFSET;
  const baseX = bounds.right - size.width - FOCUS_FLOATING_MARGIN - offset;
  const baseY = bounds.top
    + Math.max(
      58,
      Math.min(
        bounds.height - size.height - FOCUS_FLOATING_MARGIN,
        Math.round(bounds.height * 0.28),
      ),
    )
    + offset;
  return clampFocusFloatingPosition(baseX, baseY, size.width, size.height, bounds);
}

function clampFocusFloatingPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds = focusFloatingBounds(),
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const minX = bounds.left + FOCUS_FLOATING_MARGIN;
  const minY = bounds.top + FOCUS_FLOATING_MARGIN;
  const maxX = Math.max(minX, bounds.right - width - FOCUS_FLOATING_MARGIN);
  const maxY = Math.max(minY, bounds.bottom - height - FOCUS_FLOATING_MARGIN);
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  };
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

function isContextShelfTab(value: unknown): value is ContextShelfTab {
  return value === 'outputs' || value === 'side-chats' || value === 'files' || value === 'browser' || value === 'status' || value === 'ticket';
}

function readStoredContextShelfTabs(): Record<string, ContextShelfTab> {
  try {
    const raw = readBrowserStorage(CONTEXT_SHELF_TAB_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ContextShelfTab> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && isContextShelfTab(value)) out[key] = value;
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
  const raw = readBrowserStorage(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY);
  return raw === 'true';
}

type StripBadgeVariant = 'ok' | 'warn' | 'err' | 'muted' | 'accent';
type SessionWorkspaceMode = 'workspace' | 'dashboard' | 'settings';

type OpenAgentTestChatState = {
  forceWorkspace?: boolean;
  newSessionAgent?: string;
  newSessionPrompt?: string;
  newSessionAutoSend?: boolean;
  newSessionNonce?: number;
};
type ChatLayoutMode = 'single' | 'multi-2' | 'multi-3';
type DashboardColumnKey = 'running' | 'review' | 'incomplete' | 'done';
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
  const raw = readBrowserStorage(CHAT_LAYOUT_STORAGE_KEY);
  if (raw === 'single') return raw;
  if (raw === 'multi' || raw === 'multi-2' || raw === 'multi-3') return 'multi-3';
  return 'single';
}

function isMultiChatLayout(layout: ChatLayoutMode): layout is 'multi-2' | 'multi-3' {
  return layout === 'multi-2' || layout === 'multi-3';
}

function chatLayoutColumnCount(layout: ChatLayoutMode, visibleSlotCount: number): number {
  if (!isMultiChatLayout(layout)) return 1;
  return Math.max(1, Math.min(3, visibleSlotCount));
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

type LocalReadSessionMarkers = Record<string, number>;

function readStoredLocalReadSessionMarkers(): LocalReadSessionMarkers {
  try {
    const raw = readBrowserStorage(LOCAL_READ_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: LocalReadSessionMarkers = {};
    for (const [key, value] of Object.entries(parsed)) {
      const ts = typeof value === 'number' ? value : Number(value);
      if (key && Number.isFinite(ts) && ts > 0) out[key] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredLocalReadSessionMarkers(markers: LocalReadSessionMarkers) {
  const entries = Object.entries(markers).filter(([, value]) => Number.isFinite(value) && value > 0);
  writeBrowserStorage(
    LOCAL_READ_SESSIONS_STORAGE_KEY,
    entries.length ? JSON.stringify(Object.fromEntries(entries)) : null,
  );
}

function isLocallyReadSession(session: SessionInfo, markers: LocalReadSessionMarkers): boolean {
  const agent = session.agent || '';
  if (!agent || !session.sessionId) return false;
  const readAt = markers[localReadSessionKey(agent, session.sessionId)] || 0;
  if (!readAt) return false;
  const changedAt = statusTimestampMs(session) || 0;
  return readAt >= changedAt;
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

function dashboardColumnForSession(
  session: SessionInfo,
  live: LiveSessionState | null,
  recentCutoff: number,
): DashboardColumnKey | null {
  if (live?.phase === 'queued' || live?.phase === 'streaming') return null;

  const displayState = sessionDisplayState(session);
  if (displayState === 'running') return null;
  if (session.userStatus === 'done') return null;
  if (session.userStatus === 'parked') return null;
  if (displayState === 'incomplete') return 'review';

  const recentlyFinished = (statusTimestampMs(session) ?? 0) >= recentCutoff;
  if (session.userStatus === 'review') return 'review';
  if (recentlyFinished && isUnreadCompletedSession(session)) return 'review';
  return null;
}

type SessionAttentionKind = 'running' | 'unread' | 'warn';

function sessionAttentionVariant(session: SessionInfo): SessionAttentionKind | null {
  const displayState = sessionDisplayState(session);
  if (session.userStatus === 'done' || session.userStatus === 'parked') return null;
  if (displayState === 'running') return 'running';
  if (displayState === 'incomplete') return 'warn';
  if (isUnreadCompletedSession(session)) return 'unread';
  return null;
}

function SessionAttentionDot({
  kind,
  compact = false,
  className,
}: {
  kind: SessionAttentionKind;
  compact?: boolean;
  className?: string;
}) {
  if (kind === 'running') {
    return (
      <span
        aria-hidden="true"
        className={cn('relative inline-grid shrink-0 place-items-center rounded-full', compact ? 'h-2 w-2' : 'h-2.5 w-2.5', className)}
      >
        <span className="absolute inset-0 rounded-full bg-primary/25 animate-ping" />
        <span className={cn('relative rounded-full bg-primary shadow-[0_0_8px_var(--th-selection-ring)]', compact ? 'h-1.5 w-1.5' : 'h-2 w-2')} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-full',
        compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
        kind === 'warn'
          ? 'bg-warn shadow-[0_0_8px_var(--th-warn-glow)]'
          : 'bg-ok shadow-[0_0_8px_var(--th-ok-glow)]',
        className,
      )}
    />
  );
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

function workspaceGroupAttention(sessions: SessionInfo[]): SessionAttentionKind | null {
  let hasRunning = false;
  let hasWarn = false;
  let hasUnread = false;
  for (const session of sessions) {
    const variant = sessionAttentionVariant(session);
    if (!variant) continue;
    if (variant === 'running') hasRunning = true;
    else if (variant === 'warn') hasWarn = true;
    else hasUnread = true;
  }
  if (hasRunning) return 'running';
  if (hasWarn) return 'warn';
  if (hasUnread) return 'unread';
  return null;
}

function shouldIgnoreFocusModeTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"],[data-focus-ignore]');
}

function measureSessionSlotRects(): Map<number, DOMRect> {
  const rects = new Map<number, DOMRect>();
  if (typeof document === 'undefined') return rects;
  document.querySelectorAll<HTMLElement>('[data-session-slot-index]').forEach(slotEl => {
    const raw = slotEl.dataset.sessionSlotIndex;
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isInteger(index)) return;
    rects.set(index, slotEl.getBoundingClientRect());
  });
  return rects;
}

function readSessionSlotLayoutItems(): SlotDragLayoutItem[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[data-session-slot-index]'))
    .map(slotEl => {
      const raw = slotEl.dataset.sessionSlotIndex;
      const index = raw == null ? Number.NaN : Number(raw);
      const rect = slotEl.getBoundingClientRect();
      return {
        index,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter(item => (
      Number.isInteger(item.index)
      && item.width > 0
      && item.height > 0
    ));
}

function slotInsertionIndexFromLayout(
  clientX: number,
  clientY: number,
  draggingIndex: number,
  fallback: number,
  layoutItems: SlotDragLayoutItem[],
): number {
  const items = layoutItems
    .filter(item => item.index !== draggingIndex)
    .sort((a, b) => {
      const rowTolerance = Math.min(a.height, b.height) * 0.35;
      if (Math.abs(a.top - b.top) > rowTolerance) return a.top - b.top;
      return a.left - b.left;
    });

  if (!items.length) return fallback;

  const rows: Array<{
    start: number;
    top: number;
    bottom: number;
    centerY: number;
    items: typeof items;
  }> = [];

  for (const item of items) {
    const centerY = item.top + item.height / 2;
    const last = rows[rows.length - 1];
    if (!last || Math.abs(centerY - last.centerY) > Math.max(24, item.height * 0.42)) {
      rows.push({
        start: rows.length ? rows[rows.length - 1].start + rows[rows.length - 1].items.length : 0,
        top: item.top,
        bottom: item.bottom,
        centerY,
        items: [item],
      });
    } else {
      last.items.push(item);
      last.top = Math.min(last.top, item.top);
      last.bottom = Math.max(last.bottom, item.bottom);
      last.centerY = (last.centerY * (last.items.length - 1) + centerY) / last.items.length;
    }
  }

  const containingRow = rows.find(row => clientY >= row.top - 16 && clientY <= row.bottom + 16);
  const row = containingRow || rows.reduce((best, current) => (
    Math.abs(clientY - current.centerY) < Math.abs(clientY - best.centerY) ? current : best
  ), rows[0]);

  const beforeIndex = row.items.findIndex(item => {
    const targetThreshold = item.index > draggingIndex
      ? item.left + item.width * 0.45
      : item.left + item.width * 0.55;
    return clientX < targetThreshold;
  });
  return beforeIndex >= 0 ? row.start + beforeIndex : row.start + row.items.length;
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

const TASK_STAGE_ORDER: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix', 'knowledge'];
const TASK_STAGE_LABEL: Record<ProTaskStage, string> = {
  focus: 'Focus',
  refinement: 'Refine',
  coding: 'Code',
  verification: 'Verify',
  demo: 'Demo',
  bugfix: 'Bugfix',
  knowledge: 'Knowledge',
};
const CONTEXT_QUICK_LABEL: Record<ContextShelfTab, string> = {
  outputs: 'Outputs',
  'side-chats': 'Side',
  files: 'Files',
  browser: 'Browser',
  status: 'State',
  ticket: 'Ticket',
};
const FOCUS_CONTEXT_SHELF_TABS = new Set<ContextShelfTab>(['side-chats', 'files', 'browser']);
const FOCUS_CONTEXT_SHELF_TAB_ORDER: ContextShelfTab[] = ['files', 'browser', 'side-chats'];
const FOCUS_CONTEXT_TAB_LABELS: Partial<Record<ContextShelfTab, string>> = {
  'side-chats': 'Side Card',
};

function stageRunTime(run: StageRun): number {
  const parsed = Date.parse(run.completedAt || run.startedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionMatchesStageRun(slot: Pick<SessionSlot, 'workdir' | 'agent' | 'sessionId'>, run: StageRun): boolean {
  return slot.workdir === run.session.workdir
    && slot.agent === run.session.agent
    && slot.sessionId === run.session.sessionId;
}

function TaskBriefCard({
  task,
  activeStageRun,
  busyStage,
  onClose,
  onStartStage,
  onOpenStageRun,
}: {
  task: ProTask;
  activeStageRun: StageRun | null;
  busyStage: ProTaskStage | null;
  onClose: () => void;
  onStartStage: (stage: ProTaskStage) => void;
  onOpenStageRun: (run: StageRun) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fields = task.jiraFields || {};
  const latestRuns = useMemo(() => {
    const map = new Map<ProTaskStage, StageRun>();
    for (const run of [...(task.stageRuns || [])].sort((a, b) => stageRunTime(b) - stageRunTime(a))) {
      if (!map.has(run.stage)) map.set(run.stage, run);
    }
    return map;
  }, [task.stageRuns]);
  const nextStage = TASK_STAGE_ORDER.find(stage => !latestRuns.has(stage)) || activeStageRun?.stage || 'focus';
  const runButtonLabel = busyStage
    ? TASK_STAGE_LABEL[busyStage]
    : activeStageRun
      ? `Run ${TASK_STAGE_LABEL[nextStage]}`
      : `Start ${TASK_STAGE_LABEL[nextStage]}`;
  return (
    <div className="rounded-lg border border-edge/65 bg-panel/72 px-3 py-2.5 shadow-[0_8px_22px_rgba(2,6,23,0.10),inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge/55 bg-panel-alt/70 text-fg-4 transition hover:border-edge-h hover:bg-panel-h hover:text-fg active:translate-y-px"
          aria-label={expanded ? 'Collapse task brief' : 'Expand task brief'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('transition-transform', expanded && 'rotate-90')}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {task.jiraKey && <Badge variant="accent">{task.jiraKey}</Badge>}
            <Badge variant={task.status === 'done' ? 'ok' : task.status === 'resolved' ? 'accent' : task.status === 'backlog' ? 'muted' : 'warn'}>
              {task.status}
            </Badge>
            {activeStageRun && <Badge variant={activeStageRun.status === 'completed' ? 'ok' : activeStageRun.status === 'failed' ? 'warn' : 'muted'}>{TASK_STAGE_LABEL[activeStageRun.stage]}</Badge>}
          </div>
          <div className="truncate text-[13px] font-semibold tracking-tight text-fg" title={task.title}>{task.title}</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-5">
            <span className="truncate">Workspace {task.workdir ? workspaceBaseName(task.workdir) : 'Current'}</span>
            <span>Next {TASK_STAGE_LABEL[nextStage]}</span>
            {fields.assignee && <span className="truncate">Owner {fields.assignee}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="primary"
            disabled={!!busyStage}
            onClick={() => onStartStage(nextStage)}
            className="h-7 px-2.5"
          >
            {busyStage ? <Spinner className="h-3 w-3" /> : null}
            {runButtonLabel}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClose} title="Back to board" aria-label="Back to board">
            Board
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-edge/45 pt-3">
          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            {[
              ['Jira', task.jiraKey || '--'],
              ['Remote status', fields.status || '--'],
              ['Priority', fields.priority || '--'],
              ['Reporter', fields.reporter || '--'],
              ['Assignee', fields.assignee || '--'],
              ['Sprint', task.sprint || '--'],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 gap-2">
                <span className="w-24 shrink-0 text-fg-5">{label}</span>
                <span className="min-w-0 truncate text-fg-3">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TASK_STAGE_ORDER.map(stage => {
              const run = latestRuns.get(stage);
              const active = activeStageRun?.id === run?.id;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => run ? onOpenStageRun(run) : onStartStage(stage)}
                  disabled={!!busyStage && !run}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-[border-color,background,color,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45',
                    active
                      ? 'border-primary/40 bg-primary/[0.10] text-primary'
                      : run
                        ? 'border-edge/65 bg-panel-alt text-fg-3 hover:border-edge-h hover:bg-panel-h hover:text-fg'
                        : 'border-dashed border-edge/50 bg-transparent text-fg-5 hover:border-edge-h hover:text-fg-3',
                  )}
                >
                  {TASK_STAGE_LABEL[stage]}
                  {run && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-55" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 line-clamp-4 whitespace-pre-wrap text-[11.5px] leading-relaxed text-fg-4">
            {task.description || 'No ticket description yet.'}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskFocusEmptyWorkbench({
  task,
  loading,
  busyStage,
  onStartStage,
  onClose,
}: {
  task: ProTask | null;
  loading: boolean;
  busyStage: ProTaskStage | null;
  onStartStage: (stage: ProTaskStage) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[var(--th-session-bg)] px-4 py-8">
      <div className="w-full max-w-[760px]">
        {loading ? (
          <div className="flex items-center justify-center py-24"><Spinner className="h-5 w-5 text-fg-4" /></div>
        ) : task ? (
          <TaskBriefCard
            task={task}
            activeStageRun={null}
            busyStage={busyStage}
            onClose={onClose}
            onStartStage={onStartStage}
            onOpenStageRun={() => {}}
          />
        ) : (
          <div className="rounded-xl border border-edge/60 bg-panel/80 px-5 py-8 text-center">
            <div className="text-[13px] font-semibold text-fg-3">Task not found</div>
            <Button className="mt-4" size="sm" variant="outline" onClick={onClose}>Back to board</Button>
          </div>
        )}
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
  settingsContent = null,
  dashboardJiraContent = null,
}: {
  active?: boolean;
  mode?: SessionWorkspaceMode;
  settingsContent?: ReactNode;
  dashboardJiraContent?: ReactNode;
}) {
  // Granular selectors — keep high-churn store slices out of this workspace.
  // `appState` is used only for the compact workspace status strip.
  const locale = useStore(s => s.locale);
  const appState = useStore(s => s.state);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? null);
  const toastSession = useStore(s => s.toast);
  const navigate = useNavigate();
  const location = useLocation();
  const t = useMemo(() => createT(locale), [locale]);
  const appStatus = resolveAppStatusBadge(appState, t);
  const [workspaceSidebarToggleHost, setWorkspaceSidebarToggleHost] = useState<HTMLElement | null>(null);
  const [globalInboxHost, setGlobalInboxHost] = useState<HTMLElement | null>(null);

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
  const [contextShelfTabByParent, setContextShelfTabByParentRaw] = useState<Record<string, ContextShelfTab>>(readStoredContextShelfTabs);
  const [contextCardPlacementByParent, setContextCardPlacementByParent] = useState<Record<string, ContextCardPlacement>>({});
  const [draggingContextCardKey, setDraggingContextCardKey] = useState<string | null>(null);
  const [sideChatRefsByParent, setSideChatRefsByParent] = useState<SideChatRefsMap>({});
  const [sideChatInfoMap, setSideChatInfoMap] = useState<Record<string, SessionInfo>>({});
  const [activeSlotIndex, setActiveSlotIndexRaw] = useState(readStoredActiveSlot);
  const [spotlightSlotIndex, setSpotlightSlotIndex] = useState<number | null>(null);
  const [focusedSlotIndex, setFocusedSlotIndex] = useState<number | null>(readStoredFocusedSlot);
  const [focusFloatingSessions, setFocusFloatingSessions] = useState<FocusFloatingSession[]>([]);
  const [focusFloatingDraggingId, setFocusFloatingDraggingId] = useState<string | null>(null);
  const [liveSessionStates, setLiveSessionStates] = useState<Record<string, LiveSessionState>>({});
  const [locallyReadSessionMarkers, setLocallyReadSessionMarkersRaw] = useState<LocalReadSessionMarkers>(readStoredLocalReadSessionMarkers);
  const setLocallyReadSessionMarkers = useCallback((
    updater: LocalReadSessionMarkers | ((prev: LocalReadSessionMarkers) => LocalReadSessionMarkers),
  ) => {
    setLocallyReadSessionMarkersRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeStoredLocalReadSessionMarkers(next);
      return next;
    });
  }, []);
  const spotlightSlotTimerRef = useRef<number | null>(null);
  const focusedOpenSessionsSnapshotRef = useRef<{ slots: SessionSlot[]; focusedIndex: number } | null>(null);
  const openSessionsRef = useRef(openSessions);
  openSessionsRef.current = openSessions;
  const openSideChatsByParentRef = useRef(openSideChatsByParent);
  openSideChatsByParentRef.current = openSideChatsByParent;
  const sideChatWidthsByParentRef = useRef(sideChatWidthsByParent);
  sideChatWidthsByParentRef.current = sideChatWidthsByParent;
  const contextCardDragRef = useRef<ContextCardDrag | null>(null);
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
  const setContextShelfTabByParent = useCallback((updater: Record<string, ContextShelfTab> | ((prev: Record<string, ContextShelfTab>) => Record<string, ContextShelfTab>)) => {
    setContextShelfTabByParentRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(CONTEXT_SHELF_TAB_STORAGE_KEY, JSON.stringify(next));
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
  const [filePanelWorkdir, setFilePanelWorkdir] = useState<string | null>(null);
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
    setFilePanelWorkdir(workdir);
    setFileTreeOpen(true);
  }, [setActiveSlotIndex, toastSession]);

  const handleOpenOverlayFileLink = useCallback((workdir: string, target: FileLinkTarget) => {
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
    setFilePanelWorkdir(workdir);
    setFileTreeOpen(true);
  }, [toastSession]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showNewSession, setShowNewSessionRaw] = useState<string | null>(readStoredNewSessionWorkdir);
  const [newSessionTemplateAgent, setNewSessionTemplateAgent] = useState('');
  const [newSessionInitialDraftPrompt, setNewSessionInitialDraftPrompt] = useState<string | null>(null);
  const [newSessionInitialAutoSend, setNewSessionInitialAutoSend] = useState(false);
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
  const [isNarrowWorkbench, setIsNarrowWorkbench] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(max-width: 760px)');
    const sync = () => setIsNarrowWorkbench(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const syncHosts = () => {
      setWorkspaceSidebarToggleHost(document.getElementById('workspace-sidebar-toggle-host'));
      setGlobalInboxHost(document.getElementById('global-inbox-host'));
    };
    syncHosts();
    const frame = window.requestAnimationFrame(syncHosts);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const [draggingWorkspacePath, setDraggingWorkspacePath] = useState<string | null>(null);
  const [dragOverWorkspacePath, setDragOverWorkspacePath] = useState<string | null>(null);
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceRenameTarget | null>(null);
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('');
  const [renamingWorkspace, setRenamingWorkspace] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [chatLayout, setChatLayoutRaw] = useState<ChatLayoutMode>(readStoredChatLayout);
  const setChatLayout = useCallback((updater: ChatLayoutMode | ((prev: ChatLayoutMode) => ChatLayoutMode)) => {
    setChatLayoutRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeBrowserStorage(CHAT_LAYOUT_STORAGE_KEY, next);
      return next;
    });
    setFocusedSlotIndex(null);
  }, []);
  const [multiRowHeightPx, setMultiRowHeightPxRaw] = useState<number | null>(readStoredMultiRowHeight);
  const setMultiRowHeightPx = useCallback((updater: number | null | ((prev: number | null) => number | null)) => {
    setMultiRowHeightPxRaw(prev => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next = rawNext == null ? null : clampMultiRowHeightForViewport(rawNext);
      writeBrowserStorage(MULTI_ROW_HEIGHT_STORAGE_KEY, next == null ? null : String(next));
      return next;
    });
  }, []);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxFocusedSlot, setInboxFocusedSlot] = useState<SessionSlot | null>(null);
  const [checkedInboxItemKeys, setCheckedInboxItemKeys] = useState<Set<string>>(() => new Set());
  const [inboxAttentionPulse, setInboxAttentionPulse] = useState(false);
  const previousInboxAlertCountRef = useRef(-1);
  const openInboxFromTrigger = useCallback(() => {
    setInboxOpen(true);
  }, []);
  const closeInbox = useCallback(() => {
    setInboxOpen(false);
    setInboxFocusedSlot(null);
  }, []);
  const [quickTodoOpen, setQuickTodoOpen] = useState(false);
  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoSaving, setQuickTodoSaving] = useState(false);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [todoLoading, setTodoLoading] = useState(false);
  const [todoCreating, setTodoCreating] = useState(false);
  const taskFocusId = useMemo(() => {
    if (mode !== 'workspace') return null;
    return new URLSearchParams(location.search).get('task');
  }, [location.search, mode]);
  const [taskWorkbench, setTaskWorkbench] = useState<ProTaskWorkbench | null>(null);
  const [taskWorkbenchLoading, setTaskWorkbenchLoading] = useState(false);
  const [taskStageBusy, setTaskStageBusy] = useState<ProTaskStage | null>(null);
  const activeTaskFocusSessionRef = useRef<{ taskId: string; focusSessionId: string } | null>(null);

  useEffect(() => {
    const navState = location.state as { forceWorkspace?: boolean } | null;
    if (mode === 'workspace' && navState?.forceWorkspace) {
      setWorkspaceSidebarCollapsed(false);
    }
  }, [location.state, mode, setWorkspaceSidebarCollapsed]);

  useEffect(() => {
    if (!taskFocusId) return;
    setFocusedSlotIndex(null);
    setSideChatPanelOpenByParent({});
  }, [setSideChatPanelOpenByParent, taskFocusId]);

  const deferredSearch = useDeferredValue(search);
  const initializedRef = useRef(false);
  const inflightLoadsRef = useRef<Record<string, boolean>>({});
  const autoPrefetchedSessionsRef = useRef<Set<string>>(new Set());
  const hoverPrefetchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handledAgentTestChatRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!active || !initializedRef.current || !workspaces.length) return;
    const navState = location.state as OpenAgentTestChatState | null;
    const agent = typeof navState?.newSessionAgent === 'string' ? navState.newSessionAgent.trim() : '';
    if (!agent) return;
    const key = `${agent}:${navState?.newSessionNonce || ''}:${navState?.newSessionPrompt || ''}`;
    if (handledAgentTestChatRef.current === key) return;
    const workdir = runtimeWorkdir || workspaces[0]?.path || '';
    if (!workdir) return;
    handledAgentTestChatRef.current = key;
    setNewSessionTemplateAgent(agent);
    setNewSessionInitialDraftPrompt(String(navState?.newSessionPrompt || 'Reply with exactly OK. Do not use tools.').trim() || 'Reply with exactly OK. Do not use tools.');
    setNewSessionInitialAutoSend(navState?.newSessionAutoSend === true);
    setShowNewSession(workdir);
    setActiveSlotIndex(openSessionsRef.current.length);
    navigate(location.pathname || '/', { replace: true, state: { forceWorkspace: true } });
  }, [active, location.pathname, location.state, navigate, runtimeWorkdir, setActiveSlotIndex, setShowNewSession, workspaces]);

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
    return isLocallyReadSession(hydrated, locallyReadSessionMarkers)
      ? { ...hydrated, userStatus: 'done' as const }
      : hydrated;
  }, [liveSessionStates, locallyReadSessionMarkers]);

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
  const [deletingSession, setDeletingSession] = useState(false);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [renameSessionTarget, setRenameSessionTarget] = useState<SessionActionTarget | null>(null);
  const [renameSessionTitle, setRenameSessionTitle] = useState('');
  const [renamingSession, setRenamingSession] = useState(false);
  const [headerRenameTarget, setHeaderRenameTarget] = useState<SessionActionTarget | null>(null);
  const [headerRenameTitle, setHeaderRenameTitle] = useState('');
  const [headerRenamingSession, setHeaderRenamingSession] = useState(false);
  const headerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const skipHeaderRenameBlurRef = useRef(false);
  const [createTaskTarget, setCreateTaskTarget] = useState<SessionActionTarget | null>(null);
  const [createTaskTitle, setCreateTaskTitle] = useState('');
  const [createTaskDescription, setCreateTaskDescription] = useState('');
  const [createTaskKind, setCreateTaskKind] = useState<Extract<ProTaskKind, 'jira-ticket' | 'jira-bug'>>('jira-ticket');
  const [createTaskStatus, setCreateTaskStatus] = useState<ProTaskStatus>('backlog');
  const [creatingTask, setCreatingTask] = useState(false);

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
    setDeleteConfirmKey(null);
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
    setDeleteConfirmKey(null);
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

  const openCreateTaskModal = useCallback((target: SessionActionTarget) => {
    setSlotMenu(null);
    setDeleteConfirmKey(null);
    setCreateTaskTarget(target);
    setCreateTaskTitle(target.title || 'Untitled chat task');
    setCreateTaskDescription([
      `Source chat: ${target.agent}:${target.sessionId}`,
      `Workspace: ${target.workdir}`,
      '',
      target.title ? `Context: ${target.title}` : '',
    ].filter(Boolean).join('\n'));
    setCreateTaskKind('jira-ticket');
    setCreateTaskStatus('backlog');
  }, []);

  const submitCreateTaskFromChat = useCallback(async () => {
    if (!createTaskTarget || creatingTask) return;
    const title = createTaskTitle.trim();
    if (!title) {
      toastSession(t('dashboard.createTaskTitleRequired'), false);
      return;
    }
    setCreatingTask(true);
    try {
      const result = await api.createProTask({
        title,
        description: createTaskDescription.trim(),
        kind: createTaskKind,
        status: createTaskStatus,
        workdir: createTaskTarget.workdir,
        defaultAgent: createTaskTarget.agent || null,
      });
      if (!result.ok || !result.task) throw new Error(result.error || t('dashboard.createTaskFailed'));
      setCreateTaskTarget(null);
      toastSession(t('dashboard.createTaskCreated'));
    } catch (err: any) {
      toastSession(err?.message || t('dashboard.createTaskFailed'), false);
    } finally {
      setCreatingTask(false);
    }
  }, [createTaskDescription, createTaskKind, createTaskStatus, createTaskTarget, createTaskTitle, creatingTask, t, toastSession]);

  // Close popover on outside click, scroll, resize, or Escape.
  useEffect(() => {
    if (!sessionMenu) return;
    const close = () => {
      setSessionMenu(null);
      setDeleteConfirmKey(null);
    };
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
    const close = () => {
      setSlotMenu(null);
      setDeleteConfirmKey(null);
    };
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
    setDeleteConfirmKey(null);
  }, []);

  const openHeaderRenameSession = useCallback((target: SessionActionTarget) => {
    skipHeaderRenameBlurRef.current = false;
    setHeaderRenameTitle(target.title);
    setHeaderRenameTarget(target);
    setSessionMenu(null);
    setSlotMenu(null);
    setDeleteConfirmKey(null);
  }, []);

  useEffect(() => {
    if (!headerRenameTarget) return;
    requestAnimationFrame(() => {
      headerRenameInputRef.current?.focus();
      headerRenameInputRef.current?.select();
    });
  }, [headerRenameTarget]);

  const executePinSession = useCallback(async (target: SessionActionTarget, pinned: boolean) => {
    setSessionMenu(null);
    setSlotMenu(null);
    setDeleteConfirmKey(null);
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
    const readAt = Date.now();
    setLocallyReadSessionMarkers(prev => ({ ...prev, [readKey]: readAt }));
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
        setLocallyReadSessionMarkers(prev => {
          if (!prev[readKey]) return prev;
          const next = { ...prev };
          delete next[readKey];
          return next;
        });
        void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
        return;
      }
      void loadSessionsForWorkspace(target.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('session.markReadFailed'), false);
      setLocallyReadSessionMarkers(prev => {
        if (!prev[readKey]) return prev;
        const next = { ...prev };
        delete next[readKey];
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

  const executeDeleteSession = useCallback(async (target: SessionActionTarget) => {
    if (deletingSession) return;
    setDeletingSession(true);
    try {
      const res = await api.deleteSession(target.workdir, target.agent, target.sessionId, false);
      if (!res.ok) {
        const msg = res.error?.includes('still running') ? t('session.deleteRunningError') : (res.error || t('session.deleteFailed'));
        toastSession(msg, false);
        setDeleteConfirmKey(null);
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
      setSessionMenu(null);
      setSlotMenu(null);
      setDeleteConfirmKey(null);
    } catch (err: any) {
      toastSession(err?.message || t('session.deleteFailed'), false);
      setDeleteConfirmKey(null);
    } finally {
      setDeletingSession(false);
    }
  }, [deletingSession, setOpenSideChatsByParent, t, toastSession]);

  const renderDeleteSessionMenuItem = useCallback((target: SessionActionTarget) => {
    const deleteKey = sessionSlotStorageKey(target);
    const deleteArmed = deleteConfirmKey === deleteKey;
    return (
      <div
        className="relative mx-1 h-8 w-[calc(100%-0.5rem)] overflow-hidden rounded"
        onMouseLeave={() => {
          if (deleteArmed && !deletingSession) setDeleteConfirmKey(null);
        }}
      >
        <button
          type="button"
          role="menuitem"
          disabled={deletingSession && deleteArmed}
          onClick={() => {
            if (!deleteArmed) setDeleteConfirmKey(deleteKey);
          }}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12px] font-medium text-fg-3 transition-[background,color] duration-150 focus-visible:outline-none',
            'hover:bg-red-500/[0.10] hover:text-red-500 focus-visible:bg-red-500/[0.12] focus-visible:text-red-500',
            deletingSession && deleteArmed && 'cursor-wait opacity-80',
          )}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
          </svg>
          <span className="min-w-0 truncate">{t('session.delete')}</span>
        </button>
        <button
          type="button"
          disabled={!deleteArmed || deletingSession}
          onClick={event => {
            event.stopPropagation();
            if (!deleteArmed) return;
            void executeDeleteSession(target);
          }}
          className={cn(
            'absolute inset-0 inline-flex items-center justify-center rounded bg-red-500 px-2 text-[12px] font-semibold text-white shadow-sm transition-[transform,opacity] duration-200 ease-out hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/35',
            deleteArmed ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0',
            deletingSession && deleteArmed && 'cursor-wait opacity-80',
          )}
          aria-label={t('session.confirmDelete')}
        >
          {deletingSession && deleteArmed ? t('session.deleting') : t('session.confirmDelete')}
        </button>
      </div>
    );
  }, [deleteConfirmKey, deletingSession, executeDeleteSession, t]);

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
      setNewSessionInitialDraftPrompt(null);
      setNewSessionInitialAutoSend(false);
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

  const openStageRunSession = useCallback((run: StageRun) => {
    const slot: SessionSlot = {
      workdir: run.session.workdir,
      agent: run.session.agent,
      sessionId: run.session.sessionId,
      mountKey: nextMountKey(),
    };
    warmSession({ agent: slot.agent, sessionId: slot.sessionId }, slot.workdir);
    setShowNewSession(null);
    setOpenSessions(prev => {
      const existingIdx = prev.findIndex(s => s.workdir === slot.workdir && s.agent === slot.agent && s.sessionId === slot.sessionId);
      if (existingIdx >= 0) {
        setActiveSlotIndex(existingIdx);
        return prev;
      }
      const next = [...prev, slot];
      setActiveSlotIndex(next.length - 1);
      return next;
    });
    void loadSessionsForWorkspace(slot.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, setActiveSlotIndex, setOpenSessions, setShowNewSession, warmSession]);

  const refreshTaskWorkbench = useCallback(async (taskId: string, opts: { openActiveRun?: boolean } = {}) => {
    setTaskWorkbenchLoading(true);
    try {
      const res = await api.getProTaskWorkbench(taskId);
      if (!res.ok || !res.workbench) throw new Error(res.error || 'Failed to load task workbench');
      setTaskWorkbench(res.workbench);
      if (opts.openActiveRun && res.workbench.activeStageRun) openStageRunSession(res.workbench.activeStageRun);
      return res.workbench;
    } catch (err: any) {
      toastSession(err?.message || 'Failed to load task workbench', false);
      setTaskWorkbench(null);
      return null;
    } finally {
      setTaskWorkbenchLoading(false);
    }
  }, [openStageRunSession, toastSession]);

  useEffect(() => {
    if (!taskFocusId) {
      setTaskWorkbench(null);
      setTaskWorkbenchLoading(false);
      setTaskStageBusy(null);
      return;
    }
    let cancelled = false;
    setTaskWorkbenchLoading(true);
    void api.getProTaskWorkbench(taskFocusId).then(res => {
      if (cancelled) return;
      if (!res.ok || !res.workbench) throw new Error(res.error || 'Failed to load task workbench');
      setTaskWorkbench(res.workbench);
      if (res.workbench.activeStageRun) openStageRunSession(res.workbench.activeStageRun);
    }).catch((err: any) => {
      if (!cancelled) {
        toastSession(err?.message || 'Failed to load task workbench', false);
        setTaskWorkbench(null);
      }
    }).finally(() => {
      if (!cancelled) setTaskWorkbenchLoading(false);
    });
    return () => { cancelled = true; };
  }, [openStageRunSession, taskFocusId, toastSession]);

  useEffect(() => {
    const activeFocus = activeTaskFocusSessionRef.current;
    if (!taskFocusId) {
      activeTaskFocusSessionRef.current = null;
      if (activeFocus) {
        void api.finishProTaskFocusSession(activeFocus.taskId, activeFocus.focusSessionId).catch(() => {});
      }
      return;
    }
    if (activeFocus?.taskId === taskFocusId) return;
    if (activeFocus) {
      void api.finishProTaskFocusSession(activeFocus.taskId, activeFocus.focusSessionId).catch(() => {});
      activeTaskFocusSessionRef.current = null;
    }
    let cancelled = false;
    void api.startProTaskFocusSession(taskFocusId, 'task-focus-workbench').then(result => {
      if (cancelled || !result.ok || !result.focusSession) return;
      activeTaskFocusSessionRef.current = { taskId: taskFocusId, focusSessionId: result.focusSession.id };
      if (result.task) setTaskWorkbench(prev => prev && prev.task.id === result.task!.id ? { ...prev, task: result.task! } : prev);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [taskFocusId]);

  const closeTaskFocusWorkbench = useCallback(() => {
    navigate('/tasks', { replace: false });
  }, [navigate]);

  const startTaskStage = useCallback(async (stage: ProTaskStage) => {
    const task = taskWorkbench?.task;
    if (!task || taskStageBusy) return;
    setTaskStageBusy(stage);
    try {
      const result = await api.startProTaskStage(task.id, stage, {
        workdir: task.workdir || runtimeWorkdir,
        agent: task.execution?.agent || task.defaultAgent || null,
        assistantId: task.execution?.assistantId || task.defaultAssistantId || null,
        executionMode: task.execution?.mode || 'direct',
      });
      if (!result.ok) throw new Error(result.error || 'Failed to start task stage');
      const updated = await refreshTaskWorkbench(task.id, { openActiveRun: true });
      const run = updated?.activeStageRun || result.task?.stageRuns?.[0] || null;
      if (run) openStageRunSession(run);
      toastSession(`${TASK_STAGE_LABEL[stage]} stage started`);
    } catch (err: any) {
      toastSession(err?.message || 'Failed to start task stage', false);
    } finally {
      setTaskStageBusy(null);
    }
  }, [openStageRunSession, refreshTaskWorkbench, runtimeWorkdir, taskStageBusy, taskWorkbench?.task, toastSession]);

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

  const registerFocusFloatingSession = useCallback((
    next: { agent: string; sessionId: string; workdir: string },
    pendingPrompt?: string,
    pendingImageUrls?: string[],
    pendingCreatedAt?: string | null,
  ) => {
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
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
    return {
      ...next,
      pendingPrompt: pendingPrompt || null,
      pendingImageUrls: pendingImageUrls && pendingImageUrls.length ? pendingImageUrls : [],
      pendingCreatedAt: createdAt,
    };
  }, [loadSessionsForWorkspace, warmSession]);

  const handleFocusFloatingSessionCreated = useCallback((
    itemId: string,
    next: { agent: string; sessionId: string; workdir: string },
    pendingPrompt?: string,
    pendingImageUrls?: string[],
    pendingCreatedAt?: string | null,
  ) => {
    const registered = registerFocusFloatingSession(next, pendingPrompt, pendingImageUrls, pendingCreatedAt);
    setFocusFloatingSessions(prev => prev.map(item => (
      item.id === itemId
        ? {
          ...item,
          workdir: registered.workdir,
          agent: registered.agent,
          sessionId: registered.sessionId,
          hidden: false,
          x: item.x,
          y: item.y,
          pendingPrompt: registered.pendingPrompt,
          pendingImageUrls: registered.pendingImageUrls,
          pendingCreatedAt: registered.pendingCreatedAt,
        }
        : item
    )));
  }, [registerFocusFloatingSession]);

	  const handleFocusFloatingMultiSessionCreated = useCallback((itemId: string, nextSessions: Array<{ agent: string; sessionId: string; workdir: string }>, prompt: string) => {
	    const unique = nextSessions.filter((session, index, arr) => (
	      session.agent
	      && session.sessionId
	      && arr.findIndex(item => item.agent === session.agent && item.sessionId === session.sessionId && item.workdir === session.workdir) === index
	    ));
	    if (!unique.length) return;
	    const createdAt = new Date().toISOString();
	    const existingVisibleCount = focusFloatingSessions.filter(item => item.id !== itemId && !item.hidden).length;
	    const registered = unique.map((session, index) => {
	      const detail = registerFocusFloatingSession(session, prompt, [], createdAt);
	      const previousPlacement = focusFloatingSessions.find(item => item.id === itemId);
	      const fallbackPlacement = defaultFocusFloatingPosition(existingVisibleCount + index);
      return {
        id: index === 0 ? itemId : `focus-float-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        workdir: detail.workdir,
        agent: detail.agent,
        sessionId: detail.sessionId,
        mountKey: nextMountKey(),
        hidden: false,
        x: index === 0 ? previousPlacement?.x : fallbackPlacement.x,
        y: index === 0 ? previousPlacement?.y : fallbackPlacement.y,
        pendingPrompt: detail.pendingPrompt,
        pendingImageUrls: detail.pendingImageUrls,
        pendingCreatedAt: detail.pendingCreatedAt,
      } satisfies FocusFloatingSession;
    });
    setFocusFloatingSessions(prev => {
      const rest = prev.filter(item => item.id !== itemId);
      return [...rest, ...registered];
    });
  }, [focusFloatingSessions, registerFocusFloatingSession]);

  const openFloatingSessionDraft = useCallback((workdirOverride?: string, agentOverride?: string) => {
    const baseSlot = focusedSlotIndex != null
      ? openSessionsRef.current[focusedSlotIndex]
      : openSessionsRef.current[activeSlotRef.current];
    const workdir = workdirOverride || baseSlot?.workdir || selectedSession?.workdir || runtimeWorkdir || workspaces[0]?.path || '';
    if (!workdir) return;
    const item: FocusFloatingSession = {
      id: `focus-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      workdir,
      agent: agentOverride ?? baseSlot?.agent ?? '',
      mountKey: nextMountKey(),
      hidden: false,
    };
    setFocusFloatingSessions(prev => {
      const placement = defaultFocusFloatingPosition(prev.filter(current => !current.hidden).length);
      return [...prev, { ...item, ...placement }];
    });
  }, [focusedSlotIndex, runtimeWorkdir, selectedSession?.workdir, workspaces]);

  const handleFocusFloatingSessionRequest = useCallback(() => {
    openFloatingSessionDraft();
  }, [openFloatingSessionDraft]);

  const closeFocusFloatingSession = useCallback((itemId: string) => {
    setFocusFloatingSessions(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const hideFocusFloatingSession = useCallback((itemId: string) => {
    setFocusFloatingSessions(prev => prev.map(item => item.id === itemId ? { ...item, hidden: true } : item));
  }, []);

  const restoreFocusFloatingSessions = useCallback(() => {
    setFocusFloatingSessions(prev => {
      let restoredIndex = prev.filter(item => !item.hidden).length;
      return prev.map(item => {
        if (!item.hidden) return item;
        const placement = defaultFocusFloatingPosition(restoredIndex);
        restoredIndex += 1;
        return { ...item, hidden: false, ...placement };
      });
    });
  }, []);

  const handleFocusFloatingDragStart = useCallback((itemId: string, event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, select, input, textarea, a, [data-focus-floating-no-drag]')) return;
    const panel = event.currentTarget.closest('[data-focus-floating-session]') as HTMLElement | null;
    if (!panel) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = panel.getBoundingClientRect();
    const drag: FocusFloatingDrag = {
      itemId,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setFocusFloatingDraggingId(itemId);
    setFocusFloatingSessions(prev => prev.map(item => item.id === itemId ? { ...item, x: rect.left, y: rect.top } : item));

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();
      const next = clampFocusFloatingPosition(moveEvent.clientX - drag.offsetX, moveEvent.clientY - drag.offsetY, drag.width, drag.height);
      setFocusFloatingSessions(prev => prev.map(item => item.id === drag.itemId ? { ...item, ...next } : item));
    };
    const done = (doneEvent: PointerEvent) => {
      if (doneEvent.pointerId !== drag.pointerId) return;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setFocusFloatingDraggingId(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }, []);

  const handleNewSessionRequest = useCallback((wsPath: string) => {
    const shouldFloatDraft = chatLayout === 'single' && !taskFocusId && !isNarrowWorkbench && openSessionsRef.current.length > 0;
    const templateAgent = openSessionsRef.current[activeSlotRef.current]?.agent || '';
    if (shouldFloatDraft) {
      setNewSessionInitialDraftPrompt(null);
      setNewSessionInitialAutoSend(false);
      setShowNewSession(null);
      openFloatingSessionDraft(wsPath, templateAgent);
      return;
    }
    setNewSessionTemplateAgent(templateAgent);
    setShowNewSession(wsPath);
    if (!shouldFloatDraft) setActiveSlotIndex(openSessionsRef.current.length);
  }, [chatLayout, isNarrowWorkbench, openFloatingSessionDraft, setActiveSlotIndex, setShowNewSession, taskFocusId]);

  const resolveNewSessionTemplate = useCallback(() => {
    const slots = openSessionsRef.current;
    const previousSlot = slots[slots.length - 1] || slots[activeSlotRef.current] || null;
    const workdir = previousSlot?.workdir
      || selectedSession?.workdir
      || runtimeWorkdir
      || workspaces[0]?.path
      || '';
    return {
      workdir,
      agent: previousSlot?.agent || '',
    };
  }, [runtimeWorkdir, selectedSession?.workdir, workspaces]);

  const handleNewSessionPlaceholderClick = useCallback(() => {
    const template = resolveNewSessionTemplate();
    if (!template.workdir) return;
    setNewSessionTemplateAgent(template.agent);
    setShowNewSession(template.workdir);
    setActiveSlotIndex(openSessionsRef.current.length);
  }, [resolveNewSessionTemplate, setActiveSlotIndex, setShowNewSession]);

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
      setTodoItems(prev => prev.filter(item => !ids.includes(item.id)));
      setTodoModalOpen(false);
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
    const readAt = Date.now();
    setLocallyReadSessionMarkers(prev => ({ ...prev, [readKey]: readAt }));

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
          setLocallyReadSessionMarkers(prev => {
            if (!prev[readKey]) return prev;
            const next = { ...prev };
            delete next[readKey];
            return next;
          });
          void loadSessionsForWorkspace(workdir, { background: true, force: true });
        }
      })
      .catch((err: any) => {
        toastSession(err?.message || t('session.updateStatusFailed'), false);
        setLocallyReadSessionMarkers(prev => {
          if (!prev[readKey]) return prev;
          const next = { ...prev };
          delete next[readKey];
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
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setWorkspaceSidebarCollapsed(true);
    }
    startTransition(() => {
      setSelectedSession({ agent: session.agent || '', sessionId: session.sessionId, workdir });
    });
  }, [markSessionReadOnOpen, setSelectedSession, setShowNewSession, setWorkspaceSidebarCollapsed, warmSession]);

  const handlePanelSessionChange = useCallback((next: SessionPanelChange, fromSlotIdx?: number) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    startTransition(() => {
      if (fromSlotIdx != null) {
        if (next.openInNewSlot) {
          setShowNewSession(null);
          setOpenSessions(prev => {
            const existingIdx = prev.findIndex(s => s.workdir === next.workdir && s.agent === next.agent && s.sessionId === next.sessionId);
            if (existingIdx >= 0) {
              if (activeSlotRef.current === fromSlotIdx || !isSessionComposerFocused()) setActiveSlotIndex(existingIdx);
              return prev;
            }
            const updated = [...prev, { agent: next.agent, sessionId: next.sessionId, workdir: next.workdir, mountKey: nextMountKey() }];
            if (activeSlotRef.current === fromSlotIdx || !isSessionComposerFocused()) setActiveSlotIndex(updated.length - 1);
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

  const shouldInlineSideChat = (!!taskFocusId || !isMultiChatLayout(chatLayout) || openSessions.length <= 1) && !showNewSession;

  const enterFocusMode = useCallback((slotIdx: number) => {
    focusedOpenSessionsSnapshotRef.current = {
      slots: openSessionsRef.current.map(slot => ({ ...slot })),
      focusedIndex: slotIdx,
    };
    setActiveSlotIndex(slotIdx);
    setSlotMenu(null);
    setFocusedSlotIndex(slotIdx);
  }, [setActiveSlotIndex]);

  const promoteSlotForSideChat = useCallback((slotIdx: number) => {
    setActiveSlotIndex(slotIdx);
    if (!shouldInlineSideChat) enterFocusMode(slotIdx);
  }, [enterFocusMode, setActiveSlotIndex, shouldInlineSideChat]);

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
    if (shouldOpenPanel) {
      setContextShelfTabByParent(prev => ({ ...prev, [parentKey]: 'side-chats' }));
      setSideChatPanelOpenByParent(prev => ({ ...prev, [parentKey]: true }));
    }
    if (shouldActivate) setActiveSideChatByParent(prev => ({ ...prev, [parentKey]: sideKey }));
    warmSession(sideSession, slot.workdir);
    void loadSessionsForWorkspace(slot.workdir, { background: true, force: true });
    return { sideSlot, sideSession };
  }, [loadSessionsForWorkspace, mergeSessionIntoWorkspaceMap, promoteSlotForSideChat, setActiveSideChatByParent, setContextShelfTabByParent, setOpenSideChatsByParent, t, warmSession]);

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
      const created = await createAndOpenSideChat(slotIdx, slot, info, { promote: true, openPanel: true, activate: true });
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

  const setContextCardDockMode = useCallback((parentKey: string, mode: ContextCardMode) => {
    setContextCardPlacementByParent(prev => {
      const current = prev[parentKey] || defaultContextCardPlacement();
      const next = mode === 'docked'
        ? { ...current, mode: 'docked' as const }
        : clampContextCardPlacement({
          ...current,
          mode: 'floating' as const,
          x: typeof window === 'undefined' ? current.x : Math.max(CONTEXT_CARD_MIN_MARGIN, window.innerWidth - current.width - 28),
          y: typeof window === 'undefined' ? current.y : Math.max(CONTEXT_CARD_MIN_MARGIN, Math.min(current.y, window.innerHeight - current.height - CONTEXT_CARD_MIN_MARGIN)),
        });
      return { ...prev, [parentKey]: next };
    });
  }, []);

  const handleContextCardDragStart = useCallback((parentKey: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const card = event.currentTarget.closest('[data-context-card]') as HTMLElement | null;
    const rect = card?.getBoundingClientRect();
    const current = contextCardPlacementByParent[parentKey] || defaultContextCardPlacement();
    const width = rect?.width || current.width;
    const height = rect?.height || current.height;
    const floatingX = rect?.left ?? current.x;
    const floatingY = rect?.top ?? current.y;
    contextCardDragRef.current = {
      parentKey,
      pointerId: event.pointerId,
      offsetX: event.clientX - floatingX,
      offsetY: event.clientY - floatingY,
      width,
      height,
    };
    setContextCardPlacementByParent(prev => ({
      ...prev,
      [parentKey]: clampContextCardPlacement({
        mode: 'floating',
        x: floatingX,
        y: floatingY,
        width,
        height,
      }),
    }));
    setDraggingContextCardKey(parentKey);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [contextCardPlacementByParent]);

  useEffect(() => {
    if (!draggingContextCardKey) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const cleanup = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      contextCardDragRef.current = null;
      setDraggingContextCardKey(null);
    };
    const onMove = (event: PointerEvent) => {
      const drag = contextCardDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      setContextCardPlacementByParent(prev => ({
        ...prev,
        [drag.parentKey]: clampContextCardPlacement({
          mode: 'floating',
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY,
          width: drag.width,
          height: drag.height,
        }),
      }));
    };
    const onDone = (event: PointerEvent) => {
      const drag = contextCardDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const shouldDock = typeof window !== 'undefined' && event.clientX >= window.innerWidth - CONTEXT_CARD_DOCK_SNAP_PX;
      if (shouldDock) {
        setContextCardPlacementByParent(prev => ({
          ...prev,
          [drag.parentKey]: {
            ...(prev[drag.parentKey] || defaultContextCardPlacement()),
            mode: 'docked',
            width: drag.width,
            height: drag.height,
          },
        }));
      }
      cleanup();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
      cleanup();
    };
  }, [draggingContextCardKey]);

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
    setContextShelfTabByParent(prev => ({ ...prev, [parentKey]: 'side-chats' }));
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
  }, [promoteSlotForSideChat, setActiveSideChatByParent, setContextShelfTabByParent, setOpenSideChatsByParent, t, warmSession]);

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
  const dashboardItems = useMemo<DashboardSessionItem[]>(() => {
    const recentCutoff = Date.now() - STATUS_SUMMARY_RECENT_MS;
    const items: DashboardSessionItem[] = [];
    const seen = new Set<string>();

    for (const ws of workspaces) {
      for (const rawSession of sessionsMap[ws.path] || []) {
        const session = hydrateSession(rawSession);
        if (!session.agent || !session.sessionId) continue;
        const key = sKey(session.agent, session.sessionId);
        const live = liveSessionStates[key] || null;
	        const canonical = live?.resolvedKey && live.resolvedKey !== key ? live.resolvedKey : key;
	        const mapKey = `${ws.path}:${canonical}`;
	        if (seen.has(mapKey)) continue;
        if (checkedInboxItemKeys.has(mapKey)) continue;
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
  }, [checkedInboxItemKeys, hydrateSession, liveSessionStates, sessionsMap, workspaces]);

	  const inboxAlertCount = dashboardItems.length;

  useEffect(() => {
    const previous = previousInboxAlertCountRef.current;
    previousInboxAlertCountRef.current = inboxAlertCount;
    if (inboxOpen || inboxAlertCount <= 0 || (previous >= 0 && inboxAlertCount <= previous)) {
      if (inboxAlertCount === 0) setInboxAttentionPulse(false);
      return undefined;
    }
    setInboxAttentionPulse(true);
    const timer = window.setTimeout(() => setInboxAttentionPulse(false), 4200);
    return () => window.clearTimeout(timer);
  }, [inboxAlertCount, inboxOpen]);

  const revealWorkspaceSidebar = useCallback(() => {
    setWorkspaceSidebarCollapsed(false);
    navigate('/', { state: { forceWorkspace: true } });
  }, [navigate, setWorkspaceSidebarCollapsed]);

  const workspaceSidebarToggleAction = active && mode === 'workspace' && workspaceSidebarCollapsed && workspaceSidebarToggleHost
    ? createPortal((
      <button
        type="button"
        onClick={revealWorkspaceSidebar}
        title={t('rail.workspace')}
        aria-label={t('rail.workspace')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge/60 bg-panel-alt/80 text-fg-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,background,color,transform] hover:-translate-y-px hover:border-edge-h hover:bg-panel-h hover:text-fg-2 active:scale-95"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
    ), workspaceSidebarToggleHost)
    : null;

  const toggleChatLayout = useCallback(() => {
    focusedOpenSessionsSnapshotRef.current = null;
    setFocusedSlotIndex(null);
    setSlotMenu(null);
    setChatLayout(prev => (isMultiChatLayout(prev) ? 'single' : 'multi-3'));
  }, [setChatLayout]);

  const workspaceLayoutToggleLabel = isMultiChatLayout(chatLayout)
    ? t('hub.switchToSingleLayout')
    : t('hub.switchToMultiLayout');

  const globalInboxAction = active && globalInboxHost
    ? createPortal((
      <>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTodoModalOpen(true)}
          title={t('todo.workspaceTitle')}
          aria-label={t('todo.workspaceTitle')}
          className="relative !h-8 !w-8"
        >
          <TodoGlyph className="h-3.5 w-3.5" />
          {todoItems.some(item => item.status === 'open') && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_0_2px_var(--th-panel)]" />
          )}
        </Button>
        <Button
          variant={inboxAlertCount > 0 ? 'secondary' : 'ghost'}
          size="icon"
          onClick={openInboxFromTrigger}
          title={t('rail.inbox')}
          aria-label={t('rail.inbox')}
          className={cn(
            'relative !h-8 !w-8 !px-0',
            inboxAlertCount > 0 && 'border-primary/45 text-primary',
            inboxAttentionPulse && 'animate-pulse ring-2 ring-primary/30',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
          </svg>
          {inboxAlertCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full border border-panel bg-primary px-1 text-center font-mono text-[9px] font-semibold leading-4 text-primary-fg tabular-nums">
              {Math.min(inboxAlertCount, 99)}
            </span>
          )}
        </Button>
      </>
    ), globalInboxHost)
    : null;

  const markDashboardItemChecked = useCallback(async (item: DashboardSessionItem) => {
    const agent = item.session.agent || '';
    if (!agent || !item.session.sessionId) return;
    const readKey = localReadSessionKey(agent, item.session.sessionId);
    const readAt = Date.now();
    setCheckedInboxItemKeys(prev => {
      if (prev.has(item.key)) return prev;
      const next = new Set(prev);
      next.add(item.key);
      return next;
    });
    setLocallyReadSessionMarkers(prev => ({ ...prev, [readKey]: readAt }));
    setSessionsMap(prev => ({
      ...prev,
      [item.workdir]: (prev[item.workdir] || []).map(session => (
        session.agent === agent && session.sessionId === item.session.sessionId
          ? { ...session, userStatus: 'done' as const }
          : session
      )),
    }));
    try {
      const res = await api.updateSessionStatus(item.workdir, agent, item.session.sessionId, 'done');
      if (!res.ok) {
        toastSession(res.error || t('dashboard.markDoneFailed'), false);
        setCheckedInboxItemKeys(prev => {
          if (!prev.has(item.key)) return prev;
          const next = new Set(prev);
          next.delete(item.key);
          return next;
        });
        setLocallyReadSessionMarkers(prev => {
          if (!prev[readKey]) return prev;
          const next = { ...prev };
          delete next[readKey];
          return next;
        });
        void loadSessionsForWorkspace(item.workdir, { background: true, force: true });
        return;
      }
      void loadSessionsForWorkspace(item.workdir, { background: true, force: true });
    } catch (err: any) {
      toastSession(err?.message || t('dashboard.markDoneFailed'), false);
      setCheckedInboxItemKeys(prev => {
        if (!prev.has(item.key)) return prev;
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
      setLocallyReadSessionMarkers(prev => {
        if (!prev[readKey]) return prev;
        const next = { ...prev };
        delete next[readKey];
        return next;
      });
      void loadSessionsForWorkspace(item.workdir, { background: true, force: true });
    }
  }, [loadSessionsForWorkspace, setLocallyReadSessionMarkers, t, toastSession]);

  const handleMarkWorkspaceInboxRead = useCallback(async (workdir: string) => {
    const targets = dashboardItems.filter(item => item.workdir === workdir && item.session.agent && item.session.sessionId);
    if (!targets.length) return;
    const targetKeys = new Set(targets.map(item => item.key));
    const readAt = Date.now();
    const readKeys = new Set(targets.map(item => localReadSessionKey(item.session.agent || '', item.session.sessionId)));

    setCheckedInboxItemKeys(prev => {
      const next = new Set(prev);
      for (const key of targetKeys) next.add(key);
      return next;
    });
    setLocallyReadSessionMarkers(prev => {
      const next = { ...prev };
      for (const key of readKeys) next[key] = readAt;
      return next;
    });
    setSessionsMap(prev => ({
      ...prev,
      [workdir]: (prev[workdir] || []).map(session => (
        targets.some(item => item.session.agent === session.agent && item.session.sessionId === session.sessionId)
          ? { ...session, userStatus: 'done' as const }
          : session
      )),
    }));

    const results = await Promise.all(targets.map(item => (
      api.updateSessionStatus(item.workdir, item.session.agent || '', item.session.sessionId, 'done')
        .catch((err: any) => ({ ok: false, updated: false, error: err?.message || String(err) }))
    )));
    if (results.some(result => !result.ok)) {
      toastSession(t('session.markReadFailed'), false);
    }
    void loadSessionsForWorkspace(workdir, { background: true, force: true });
  }, [dashboardItems, loadSessionsForWorkspace, t, toastSession]);

  const handleOpenInboxSession = useCallback((item: DashboardSessionItem) => {
	    const agent = item.session.agent || '';
	    if (!agent || !item.session.sessionId) return;
	    warmSession(item.session, item.workdir);
	    markSessionReadOnOpen(item.session, item.workdir);
	    void markDashboardItemChecked(item);
	    const slot: SessionSlot = {
	      agent,
	      sessionId: item.session.sessionId,
	      workdir: item.workdir,
	      mountKey: nextMountKey(),
	    };
	    setInboxFocusedSlot(slot);
	  }, [markDashboardItemChecked, markSessionReadOnOpen, warmSession]);

  const handleInboxPanelSessionChange = useCallback((next: SessionPanelChange) => {
    warmSession({ agent: next.agent, sessionId: next.sessionId, runState: 'running' }, next.workdir);
    setInboxFocusedSlot(prev => {
      if (!prev || next.openInNewSlot) {
        return { agent: next.agent, sessionId: next.sessionId, workdir: next.workdir, mountKey: nextMountKey() };
      }
      return { ...prev, agent: next.agent, sessionId: next.sessionId, workdir: next.workdir };
    });
    void loadSessionsForWorkspace(next.workdir, { background: true, force: true });
  }, [loadSessionsForWorkspace, warmSession]);

	  const closeFocusMode = useCallback(() => {
	    const snapshot = focusedOpenSessionsSnapshotRef.current;
	    focusedOpenSessionsSnapshotRef.current = null;
	    setFocusedSlotIndex(null);
	    setFocusFloatingSessions([]);
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

  const handleSlotDoubleClick = useCallback((slotIdx: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (shouldIgnoreFocusModeTarget(event.target)) return;
    if (isMultiChatLayout(chatLayout)) enterFocusMode(slotIdx);
  }, [chatLayout, enterFocusMode]);

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
  const [slotPointerDrag, setSlotPointerDrag] = useState<SlotPointerDrag | null>(null);
  const slotPointerDragRef = useRef<SlotPointerDrag | null>(null);
  const slotFlipRectsRef = useRef<Map<number, DOMRect> | null>(null);
  const slotDragLayoutRef = useRef<SlotDragLayoutItem[]>([]);
  const [multiRowHeightDrag, setMultiRowHeightDrag] = useState<MultiRowHeightDrag | null>(null);
  const multiRowHeightDragRef = useRef<MultiRowHeightDrag | null>(null);

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

  const moveSessionSlot = useCallback((from: number, index: number) => {
    setOpenSessions(prev => {
      if (from < 0 || from >= prev.length) return prev;
      const to = Math.max(0, Math.min(index, prev.length - 1));
      if (from === to) return prev;
      const next = [...prev];
      const source = next[from];
      next.splice(from, 1);
      next.splice(to, 0, source);
      const active = activeSlotRef.current;
      if (active === from) {
        setActiveSlotIndex(to);
      } else if (from < active && active <= to) {
        setActiveSlotIndex(active - 1);
      } else if (to <= active && active < from) {
        setActiveSlotIndex(active + 1);
      }
      return next;
    });
  }, [setActiveSlotIndex, setOpenSessions]);

  const beginSlotPointerDrag = useCallback((
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
    preview: Pick<SlotPointerDrag, 'title' | 'agent' | 'state'>,
  ) => {
    if (event.button !== 0) return;
    if (shouldIgnoreFocusModeTarget(event.target)) return;
    const slotEl = event.currentTarget.closest('[data-session-slot]') as HTMLElement | null;
    if (!slotEl) return;
    const rect = slotEl.getBoundingClientRect();
    slotDragLayoutRef.current = readSessionSlotLayoutItems();
    const next: SlotPointerDrag = {
      from: index,
      over: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      title: preview.title,
      agent: preview.agent,
      state: preview.state,
      visible: false,
    };
    slotPointerDragRef.current = next;
    setSlotPointerDrag(next);
    setActiveSlotIndex(index);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [setActiveSlotIndex]);

  const beginMultiRowHeightResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const slotEl = event.currentTarget.closest('[data-session-slot]') as HTMLElement | null;
    if (!slotEl) return;
    const rect = slotEl.getBoundingClientRect();
    const next: MultiRowHeightDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: rect.height,
    };
    multiRowHeightDragRef.current = next;
    setMultiRowHeightDrag(next);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const finishSlotPointerDrag = useCallback((commit: boolean) => {
    const current = slotPointerDragRef.current;
    slotPointerDragRef.current = null;
    slotDragLayoutRef.current = [];
    setSlotPointerDrag(null);
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
    if (!commit || !current?.visible || current.from === current.over) return;
    moveSessionSlot(current.from, current.over);
  }, [moveSessionSlot]);

  useEffect(() => {
    const activePointerId = slotPointerDrag?.pointerId;
    if (activePointerId == null) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      const current = slotPointerDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      const visible = current.visible || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5;
      const dragCenterX = event.clientX - current.offsetX + current.width / 2;
      const dragCenterY = event.clientY - current.offsetY + current.height / 2;
      const over = visible
        ? slotInsertionIndexFromLayout(dragCenterX, dragCenterY, current.from, current.over, slotDragLayoutRef.current)
        : current.over;
      if (visible && (!current.visible || over !== current.over)) {
        slotFlipRectsRef.current = measureSessionSlotRects();
      }
      const next: SlotPointerDrag = {
        ...current,
        over,
        x: event.clientX,
        y: event.clientY,
        visible,
      };
      slotPointerDragRef.current = next;
      setSlotPointerDrag(next);
      if (visible) {
        setDraggingSlotIndex(current.from);
        setDragOverSlotIndex(over);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const current = slotPointerDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishSlotPointerDrag(true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      const current = slotPointerDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishSlotPointerDrag(false);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [finishSlotPointerDrag, slotPointerDrag?.pointerId]);

  useEffect(() => {
    const activePointerId = multiRowHeightDrag?.pointerId;
    if (activePointerId == null) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      const current = multiRowHeightDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      setMultiRowHeightPx(current.startHeight + event.clientY - current.startY);
    };
    const finish = (event: PointerEvent) => {
      const current = multiRowHeightDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      multiRowHeightDragRef.current = null;
      setMultiRowHeightDrag(null);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [multiRowHeightDrag?.pointerId, setMultiRowHeightPx]);

  useEffect(() => {
    if (!slotPointerDrag?.visible || typeof document === 'undefined') return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [slotPointerDrag?.pointerId, slotPointerDrag?.visible]);

  useEffect(() => {
    if (!multiRowHeightDrag || typeof document === 'undefined') return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [multiRowHeightDrag]);

  const effectiveChatLayout: ChatLayoutMode = taskFocusId ? 'single' : chatLayout;
  const multiWidgetGrid = isMultiChatLayout(effectiveChatLayout) && !isNarrowWorkbench;
  const renderedSlotEntries = useMemo(() => {
    if (effectiveChatLayout === 'single') {
      const activeSlot = openSessions[activeSlotIndex] || null;
      return activeSlot ? [{ slot: activeSlot, slotIdx: activeSlotIndex }] : [];
    }
    return openSessions.map((slot, slotIdx) => ({ slot, slotIdx }));
  }, [activeSlotIndex, effectiveChatLayout, openSessions]);
  const slotVisualOrder = useMemo(() => {
    const orderedIndexes = renderedSlotEntries.map(entry => entry.slotIdx);
    if (multiWidgetGrid && slotPointerDrag?.visible && orderedIndexes.includes(slotPointerDrag.from)) {
      const next = orderedIndexes.filter(index => index !== slotPointerDrag.from);
      const insertionIndex = Math.max(0, Math.min(slotPointerDrag.over, next.length));
      next.splice(insertionIndex, 0, slotPointerDrag.from);
      return new Map(next.map((slotIdx, order) => [slotIdx, order]));
    }
    return new Map(orderedIndexes.map((slotIdx, order) => [slotIdx, order]));
  }, [multiWidgetGrid, renderedSlotEntries, slotPointerDrag?.from, slotPointerDrag?.over, slotPointerDrag?.visible]);
  const floatingNewSessionVisible = effectiveChatLayout === 'single'
    && !!showNewSession
    && !isNarrowWorkbench
    && !taskFocusId
    && openSessions.length > 0
    && activeSlotIndex < openSessions.length;
  const singleNewSessionVisible = effectiveChatLayout === 'single'
    && !!showNewSession
    && !floatingNewSessionVisible
    && activeSlotIndex >= openSessions.length;
  const showMultiNewSessionPlaceholder = isMultiChatLayout(effectiveChatLayout)
    && !showNewSession
    && !taskFocusId
    && renderedSlotEntries.length !== 1;
  const draftNewSessionSlotCount = showNewSession && !floatingNewSessionVisible ? 1 : 0;
  const tailNewSessionSlotCount = showMultiNewSessionPlaceholder ? 1 : 0;
  const layoutSlotCount = Math.max(1, singleNewSessionVisible ? 1 : renderedSlotEntries.length + draftNewSessionSlotCount);
  const visibleSlotCount = Math.max(1, singleNewSessionVisible ? 1 : renderedSlotEntries.length + draftNewSessionSlotCount + tailNewSessionSlotCount);
  const multiSingleChatPresentation = multiWidgetGrid
    && renderedSlotEntries.length === 1
    && draftNewSessionSlotCount === 0
    && layoutSlotCount === 1;
  const multiGridColumnCount = multiWidgetGrid
    ? chatLayoutColumnCount(effectiveChatLayout, layoutSlotCount)
    : 1;
  const gridColumnCount = effectiveChatLayout === 'single' || isNarrowWorkbench ? 1 : multiGridColumnCount;
  const gridRowCount = Math.ceil(layoutSlotCount / gridColumnCount);
  const gridNeedsVerticalScroll = gridRowCount > SESSION_GRID_MAX_VISIBLE_ROWS;
  const gridHeight = gridNeedsVerticalScroll
    ? `calc(${(gridRowCount / SESSION_GRID_MAX_VISIBLE_ROWS) * 100}% + ${Math.max(0, (gridRowCount / SESSION_GRID_MAX_VISIBLE_ROWS - 1) * SESSION_GRID_GAP_PX)}px)`
    : '100%';
  const floatingSessionLayerVisible = focusedSlotIndex != null
    || (effectiveChatLayout === 'single' && !taskFocusId && !isNarrowWorkbench && renderedSlotEntries.length > 0);
  const hiddenFocusFloatingSessionCount = focusFloatingSessions.filter(item => item.hidden).length;
  useEffect(() => {
    if (focusedSlotIndex != null) return;
    if (isSessionComposerFocused()) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-session-slot-index="${activeSlotIndex}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeSlotIndex, focusedSlotIndex, openSessions.length, showNewSession]);

  useLayoutEffect(() => {
    const previousRects = slotFlipRectsRef.current;
    if (!previousRects) return;
    slotFlipRectsRef.current = null;
    if (typeof document === 'undefined') return;
    const draggedIndex = slotPointerDrag?.visible ? slotPointerDrag.from : null;
    document.querySelectorAll<HTMLElement>('[data-session-slot-index]').forEach(slotEl => {
      const raw = slotEl.dataset.sessionSlotIndex;
      if (raw == null) return;
      const index = Number(raw);
      if (!Number.isInteger(index) || index === draggedIndex) return;
      const before = previousRects.get(index);
      if (!before) return;
      const after = slotEl.getBoundingClientRect();
      const deltaX = before.left - after.left;
      const deltaY = before.top - after.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      slotEl.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    });
  }, [slotPointerDrag?.from, slotPointerDrag?.over, slotPointerDrag?.visible, slotVisualOrder]);

  const workspaceSidebarVisible = mode === 'workspace' && !workspaceSidebarCollapsed && !isNarrowWorkbench;
  const multiWideWorkbench = mode === 'workspace'
    && multiWidgetGrid
    && !workspaceSidebarVisible
    && focusedSlotIndex == null;
  const multiItemGapPx = multiWideWorkbench ? SESSION_GRID_GAP_PX : 12;
  const multiItemFlexBasis = multiWidgetGrid
    ? `calc((100% - ${(multiGridColumnCount - 1) * multiItemGapPx}px) / ${multiGridColumnCount})`
    : undefined;
  const multiItemTall = multiWideWorkbench || (multiWidgetGrid && multiGridColumnCount <= 2 && gridRowCount <= 1);
  const canResizeMultiRows = multiWidgetGrid && !multiSingleChatPresentation && layoutSlotCount > 1;
  const compactMultiItemHeight = multiRowHeightPx == null
    ? 'min(640px, calc(100dvh - 120px))'
    : `${clampMultiRowHeightForViewport(multiRowHeightPx)}px`;
  const multiItemHeight = multiRowHeightPx != null
    ? compactMultiItemHeight
    : (multiItemTall ? 'calc(100dvh - 32px)' : compactMultiItemHeight);
  const appRailVisible = mode === 'workspace' || mode === 'dashboard' || mode === 'settings';
  const workspaceCenterClass = mode === 'workspace'
    ? workspaceSidebarVisible
      ? 'py-2 pr-2 md:py-3 md:pr-3'
      : multiWideWorkbench
        ? 'p-4'
      : 'px-2 pb-2 pt-2 md:px-3 md:pb-3 md:pt-3'
    : mode === 'dashboard'
      ? 'p-2 md:p-3'
    : '';
  const workspaceSingleChatCentered = mode === 'workspace'
    && !workspaceSidebarVisible
    && (effectiveChatLayout === 'single' || multiSingleChatPresentation)
    && focusedSlotIndex == null;

  return (
    <div className={cn(
      'relative h-full overflow-hidden flex flex-col mx-auto',
      appRailVisible ? 'gap-0 p-0 pl-14' : 'gap-3 p-2 md:p-4',
    )}>
      {workspaceSidebarToggleAction}
      {globalInboxAction}
      <div className="relative min-h-0 flex flex-1 gap-0">
      {mode === 'workspace' && (
      <>
      {/* ═══ Left Panel — Session Navigator ═══ */}
      <div
        className={cn(
          'h-full shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-out',
          workspaceSidebarVisible
            ? 'relative z-30 w-[312px] p-2 opacity-100 md:w-[324px] md:p-3'
            : 'w-0 opacity-0 pointer-events-none',
        )}
      >
      <div
        className={cn(
          'panel-isolated flex h-full w-[300px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-edge/70 bg-panel/96 backdrop-blur-md transition-[transform,opacity] duration-300 ease-out',
          workspaceSidebarVisible ? 'translate-x-0 opacity-100' : '-translate-x-[312px] opacity-0 pointer-events-none',
        )}
        style={{ boxShadow: 'var(--th-card-shadow)' }}
      >
        {/* Search */}
        <div className="border-b border-edge/20 bg-panel/45 px-3 py-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setWorkspaceSidebarCollapsed(true)}
              title={t('hub.hideWorkspaceSidebar')}
              aria-label={t('hub.hideWorkspaceSidebar')}
              className="h-8 w-8 shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Button>
            <div className="relative group min-w-0 flex-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-5/40 group-focus-within:text-fg-4 transition-colors">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
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
            {!taskFocusId && (
              <Button
                variant={isMultiChatLayout(chatLayout) ? 'secondary' : 'ghost'}
                size="icon"
                onClick={toggleChatLayout}
                title={workspaceLayoutToggleLabel}
                aria-label={workspaceLayoutToggleLabel}
                className={cn(
                  'h-8 w-8 shrink-0',
                  isMultiChatLayout(chatLayout) && 'border-primary/35 text-primary',
                )}
              >
                {isMultiChatLayout(chatLayout)
                  ? <SingleLayoutIcon className="h-3.5 w-3.5 shrink-0" />
                  : <ThreeUpLayoutIcon className="h-3.5 w-3.5 shrink-0" />}
              </Button>
            )}
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
	                  onMarkAllRead={handleMarkWorkspaceInboxRead}
                    inboxUnreadCount={dashboardItems.filter(item => item.workdir === ws.path).length}
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
          <div className="flex items-center gap-2 rounded-lg border border-edge/45 bg-panel/55 px-2 py-1.5 text-[11px] text-fg-4">
            <Dot variant={appStatus.dotVariant} pulse={appStatus.dotPulse} />
            <span className="min-w-0 flex-1 truncate font-medium text-fg-3">{appStatus.badgeContent}</span>
          </div>
        </div>
      </div>
      </div>
      </>
      )}

      {/* ═══ Center Panel — Grid of session slots ═══ */}
      <div
        className={cn(
          'relative flex-1 min-w-0 flex flex-col overflow-hidden gap-0',
          workspaceCenterClass,
        )}
      >
        {mode === 'dashboard' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            {dashboardJiraContent}
          </div>
        ) : mode === 'settings' ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-[18px] border border-edge/70 bg-panel/78 shadow-[var(--th-card-shadow)] backdrop-blur-md">
            {settingsContent}
          </div>
        ) : taskFocusId && (!taskWorkbench?.activeStageRun) ? (
          <TaskFocusEmptyWorkbench
            task={taskWorkbench?.task || null}
            loading={taskWorkbenchLoading}
            busyStage={taskStageBusy}
            onStartStage={(stage) => { void startTaskStage(stage); }}
            onClose={closeTaskFocusWorkbench}
          />
        ) : (
          <>
            {focusedSlotIndex != null && (
              <div
                className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
                aria-hidden="true"
                onClick={closeFocusMode}
              />
            )}
            {slotPointerDrag?.visible && typeof document !== 'undefined' && createPortal((
              <div
                data-slot-drag-preview
                className="pointer-events-none fixed left-0 top-0 z-[90] overflow-hidden rounded-[18px] border border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] opacity-95 ring-1 ring-[color:var(--th-chat-window-ring)] backdrop-blur-sm will-change-transform"
                style={{
                  width: slotPointerDrag.width,
                  height: slotPointerDrag.height,
                  transform: `translate3d(${slotPointerDrag.x - slotPointerDrag.offsetX}px, ${slotPointerDrag.y - slotPointerDrag.offsetY}px, 0)`,
                  boxShadow: 'var(--th-chat-window-shadow-focus)',
                }}
              >
                <div className="flex h-11 items-center gap-2 border-b border-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg-active)] px-3">
                  <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge/55 bg-inset shadow-sm">
                    <BrandIcon brand={slotPointerDrag.agent || ''} size={16} />
                    {slotPointerDrag.state === 'running' && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-panel bg-ok" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg">{slotPointerDrag.title}</span>
                </div>
                <div className="space-y-3 px-4 py-5">
                  <div className="h-9 w-2/3 rounded-xl bg-panel-alt/80" />
                  <div className="ml-auto h-10 w-3/5 rounded-xl bg-primary/[0.10]" />
                  <div className="h-20 w-4/5 rounded-xl bg-panel-alt/70" />
                  <div className="ml-auto h-9 w-1/2 rounded-xl bg-primary/[0.09]" />
                </div>
              </div>
            ), document.body)}
            <div className={cn(
              'flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]',
              multiWidgetGrid ? 'pr-3 md:pr-4' : 'pr-1',
            )}>
              <div
                className={cn(
                  multiWidgetGrid ? 'flex flex-wrap' : 'grid',
                  multiWidgetGrid
                    ? cn('min-h-full content-start items-stretch', multiWideWorkbench ? 'gap-4 py-0' : 'gap-3 py-1')
                    : 'min-h-full gap-4',
                  workspaceSingleChatCentered && 'mx-auto w-full max-w-[1120px]',
                )}
                style={{
                  height: multiWidgetGrid ? 'auto' : gridHeight,
                  width: multiWidgetGrid ? '100%' : undefined,
                  gridTemplateColumns: multiWidgetGrid
                    ? undefined
                    : `repeat(${gridColumnCount}, minmax(0, 1fr))`,
                  gridTemplateRows: multiWidgetGrid
                    ? undefined
                    : `repeat(${gridRowCount}, minmax(0, 1fr))`,
                  gridAutoRows: multiWidgetGrid
                    ? multiItemTall
                      ? multiItemHeight
                      : 'minmax(420px, min(640px, calc(100dvh - 120px)))'
                    : undefined,
                }}
              >
              {(() => {
                const newSessionSlot = (showNewSession || showMultiNewSessionPlaceholder) ? renderedSlotEntries.length : -1;
                const resolvedPlaceholderTemplate = showMultiNewSessionPlaceholder ? resolveNewSessionTemplate() : null;
                const placeholderTemplate = resolvedPlaceholderTemplate?.workdir ? resolvedPlaceholderTemplate : null;
                return Array.from({ length: visibleSlotCount }, (_, displaySlotIdx) => {
              if (showNewSession && (singleNewSessionVisible || displaySlotIdx === newSessionSlot)) {
                return (
                  <div
                    key={`new-${showNewSession}`}
                    className={cn(
                      'min-w-0 overflow-hidden flex flex-col',
                      multiWidgetGrid
                        ? 'rounded-[18px] border border-dashed border-edge/60 bg-transparent'
                        : 'rounded-xl border border-edge bg-panel',
                    )}
                    style={{
                      order: newSessionSlot,
                      boxShadow: multiWidgetGrid ? 'none' : 'var(--th-card-shadow)',
                      ...(multiWidgetGrid
                        ? {
                          flex: `0 0 ${multiItemFlexBasis || '100%'}`,
                          height: multiItemHeight,
                        }
                        : null),
                    }}
                  >
                    <NewSessionView
                      key={showNewSession}
                      workdir={showNewSession}
                      workspaceName={workspaces.find(ws => ws.path === showNewSession)?.name || showNewSession.split('/').pop() || ''}
                      workspaces={workspaces}
                      initialAgent={newSessionTemplateAgent}
                      initialDraftPrompt={newSessionInitialDraftPrompt}
                      initialAutoSend={newSessionInitialAutoSend}
                      onSessionCreated={handleNewSessionCreated}
                      onMultiSessionCreated={handleMultiSessionCreated}
                      onClose={() => {
                        setNewSessionInitialDraftPrompt(null);
                        setNewSessionInitialAutoSend(false);
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
              if (placeholderTemplate && displaySlotIdx === newSessionSlot) {
                const placeholderWorkspaceName = workspaces.find(ws => ws.path === placeholderTemplate.workdir)?.name
                  || workspaceBaseName(placeholderTemplate.workdir);
                const placeholderAgentLabel = placeholderTemplate.agent ? getAgentMeta(placeholderTemplate.agent).label : '';
                return (
                  <MultiNewSessionPlaceholder
                    key="multi-new-session-placeholder"
                    workdir={placeholderTemplate.workdir}
                    workspaceName={placeholderWorkspaceName}
                    agent={placeholderTemplate.agent}
                    agentLabel={placeholderAgentLabel}
                    order={newSessionSlot}
                    height={multiItemHeight}
                    flexBasis={multiItemFlexBasis}
                    onClick={handleNewSessionPlaceholderClick}
                    t={t}
                  />
                );
              }
              const entry = renderedSlotEntries[displaySlotIdx] ?? null;
              const slot = entry?.slot ?? null;
              const slotIdx = entry?.slotIdx ?? displaySlotIdx;
              if (!slot) {
                // Empty slot placeholder
                return (
                  <div
                    key={`empty-${slotIdx}`}
                    className={cn(
                      'min-w-0 overflow-hidden rounded-xl border border-dashed bg-panel/30 flex items-center justify-center transition-colors',
                      dragOverSlotIndex === slotIdx ? 'border-primary/50 bg-primary/[0.06]' : 'border-edge/40',
                    )}
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
	              const taskWorkbenchForSlot = taskWorkbench && taskWorkbench.task.stageRuns?.some(run => sessionMatchesStageRun(slot, run))
	                ? taskWorkbench
	                : null;
	              const taskActiveStageRun = taskWorkbenchForSlot?.activeStageRun || null;
	              const slotTaskBrief = taskWorkbenchForSlot
	                ? (
	                  <TaskBriefCard
	                    task={taskWorkbenchForSlot.task}
	                    activeStageRun={taskActiveStageRun}
	                    busyStage={taskStageBusy}
	                    onClose={closeTaskFocusWorkbench}
	                    onStartStage={(stage) => { void startTaskStage(stage); }}
	                    onOpenStageRun={openStageRunSession}
	                  />
	                )
	                : null;
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
	              const contextSurfaceOpen = sideChatPanelOpen && (isFocused || shouldInlineSideChat);
		              const contextShelfTabs: ContextShelfTab[] = taskWorkbenchForSlot
		                ? ['outputs', 'side-chats', 'files', 'browser', 'status', 'ticket']
		                : ['outputs', 'side-chats', 'files', 'browser', 'status'];
		              const activeContextShelfTab = contextShelfTabByParent[parentSlotKey] || (taskWorkbenchForSlot ? 'outputs' : 'side-chats');
		              const visibleContextShelfTabs = isFocused
		                ? FOCUS_CONTEXT_SHELF_TAB_ORDER.filter(tab => contextShelfTabs.includes(tab))
		                : contextShelfTabs;
		              const effectiveContextShelfTab = visibleContextShelfTabs.includes(activeContextShelfTab)
		                ? activeContextShelfTab
		                : visibleContextShelfTabs[0] || activeContextShelfTab;
		              const contextCardPlacement = contextCardPlacementByParent[parentSlotKey] || defaultContextCardPlacement();
	              const renderContextCard = contextSurfaceOpen
	                && shouldInlineSideChat
	                && effectiveChatLayout === 'single'
	                && !isFocused
	                && activeContextShelfTab === 'side-chats'
	                && contextCardPlacement.mode !== 'docked';
	              const taskOutputCount = taskWorkbenchForSlot?.outputs.length || 0;
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
              const sideChatToggleLabel = contextSurfaceOpen
                ? t('session.hideSideChat')
                : hasSideChats
                  ? t('session.showSideChats')
                  : t('session.newSideChat');
              const sideChatWidth = sideChatWidthsByParent[parentSlotKey] || SIDE_CHAT_DEFAULT_WIDTH;
              const contextFileCount = taskWorkbenchForSlot?.files.length || 0;
              const quickContextTabs: ContextShelfTab[] = taskWorkbenchForSlot
                ? ['outputs', 'side-chats', 'files', 'browser', 'ticket']
                : ['side-chats', 'files', 'browser', 'status'];
	              const contextCountForTab = (tab: ContextShelfTab) => {
	                if (tab === 'outputs') return taskOutputCount;
	                if (tab === 'side-chats') return uniqueSideChatKnownSlots.length;
	                if (tab === 'files') return contextFileCount;
	                if (tab === 'browser') return 0;
	                if (tab === 'ticket') return taskWorkbenchForSlot ? 1 : 0;
	                return slotState === 'running' || slotState === 'incomplete' || hasUnreadCompletedState ? 1 : 0;
	              };
	              const focusSideCardTabButtons = isFocused && visibleOpenSideSlots.length > 0
	                ? (
	                  <>
	                    {visibleOpenSideSlots.map((sideSlot, sideSlotIdx) => {
	                      const sideInfo = resolveSideSlotInfo(info, sideSlot);
	                      const sideTitle = sideChatDisplayTitle(sideSlotIdx, t('session.sideChat'));
	                      const sideKey = sideChatSlotKey(sideSlot);
                      const tabActive = effectiveContextShelfTab === 'side-chats'
                        && !!activeSideSlot
                        && sideKey === sideChatSlotKey(activeSideSlot);
                      const sideUnread = !tabActive && shouldMarkSessionReadOnOpen(sideInfo);
                      const sideDisplayState = sessionDisplayState(sideInfo);
                      const sideAttention: SessionAttentionKind | null = sideDisplayState === 'running'
                        ? 'running'
                        : sideDisplayState === 'incomplete'
                          ? 'warn'
                          : sideUnread
                            ? 'unread'
                            : null;
                      return (
	                        <button
	                          key={sideSlot.mountKey || sessionSlotStorageKey(sideSlot)}
	                          type="button"
	                          data-focus-side-card-tab
	                          onClick={() => {
	                            setContextShelfTabByParent(prev => ({ ...prev, [parentSlotKey]: 'side-chats' }));
	                            setActiveSideChatByParent(prev => ({ ...prev, [parentSlotKey]: sideKey }));
	                            markSessionReadOnOpen(sideInfo, sideSlot.workdir);
	                          }}
	                          className={cn(
	                            'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-[background,color,transform] active:translate-y-px',
	                            tabActive ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-5 hover:bg-panel-h/70 hover:text-fg-3',
	                          )}
	                          title={sideTitle}
	                          aria-label={sideTitle}
	                        >
                          {sideAttention && <SessionAttentionDot kind={sideAttention} compact />}
                          <span>{sideTitle}</span>
                        </button>
	                      );
	                    })}
	                  </>
	                )
	                : undefined;
	              const openContextShelf = (tab: ContextShelfTab) => {
                setActiveSlotIndex(slotIdx);
                setContextShelfTabByParent(prev => ({ ...prev, [parentSlotKey]: tab }));
                if (tab === 'side-chats') {
                  if (sideChatRefs.length > 0) {
                    handleShowSideChats(slot, sideChatRefs, slotIdx);
                    return;
                  }
                  if (hasSideChats) {
                    visibleOpenSideSlots.forEach(sideSlot => {
                      warmSession(resolveSideSlotInfo(info, sideSlot), sideSlot.workdir);
                    });
                  }
                  setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: true }));
                  promoteSlotForSideChat(slotIdx);
                  return;
                }
                setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: true }));
                promoteSlotForSideChat(slotIdx);
              };
              const visualOrder = slotVisualOrder.get(slotIdx) ?? displaySlotIdx;
              const isMultiWidget = isMultiChatLayout(effectiveChatLayout) && !isFocused && !multiSingleChatPresentation;
              const isSingleFullscreen = (effectiveChatLayout === 'single' || multiSingleChatPresentation) && !isFocused;
              const useFocusToolbar = isFocused || isSingleFullscreen;
              const useFloatingSessionToolbar = isFocused
                || (effectiveChatLayout === 'single' && !taskFocusId && !isNarrowWorkbench && isSingleFullscreen);
              const slotFrameClass = isFocused
                ? 'z-[70] border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] ring-1 ring-[color:var(--th-chat-window-ring)]'
                : isMultiWidget
                ? cn(
                  'border-[color:var(--th-chat-window-border)] bg-[var(--th-chat-window-bg)] ring-1 ring-[color:var(--th-chat-window-ring)] hover:border-[color:var(--th-chat-window-border-active)]',
                  isActive && 'border-[color:var(--th-chat-window-border-active)]',
                  slotState === 'running' && 'border-ok/34',
                )
                : multiSingleChatPresentation
                ? 'border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] ring-1 ring-[color:var(--th-chat-window-ring)]'
                : isSingleFullscreen
                ? 'border-transparent bg-[var(--th-chat-window-bg)]'
                : isActive
                ? 'border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] ring-1 ring-[color:var(--th-chat-window-ring)]'
                  : slotState === 'running'
                    ? 'border-[color:var(--th-chat-window-border-running)] bg-[var(--th-chat-window-bg)] hover:border-[color:var(--th-chat-window-border-active)]'
                    : 'border-[color:var(--th-chat-window-border)] bg-[var(--th-chat-window-bg)] hover:border-[color:var(--th-chat-window-border-active)]';
              const slotHeaderClass = isFocused
                ? 'border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg-active)] backdrop-blur-sm'
                : isMultiWidget
                ? cn('border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg)]', isActive && 'bg-[var(--th-chat-header-bg-active)]')
                : multiSingleChatPresentation
                ? 'border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg-active)] backdrop-blur-sm'
                : isSingleFullscreen
                ? 'border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg)]'
                : isActive
                ? 'border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg-active)]'
                : 'border-b-[color:var(--th-chat-header-border)] bg-[var(--th-chat-header-bg)]';
              const slotShadow = isFocused
                ? 'var(--th-chat-window-shadow-focus)'
                : isMultiWidget
                ? isActive
                  ? 'var(--th-chat-window-shadow), 0 0 0 1px var(--th-chat-window-ring)'
                  : 'var(--th-chat-window-shadow)'
                : multiSingleChatPresentation
                ? 'var(--th-chat-window-shadow), 0 0 0 1px var(--th-chat-window-ring)'
                : isSingleFullscreen
                ? 'none'
                : isActive
                ? 'var(--th-chat-window-shadow), 0 0 0 1px var(--th-chat-window-ring)'
                : 'var(--th-chat-window-shadow)';
              return (
                <div
                  key={slot.mountKey || sKey(slot.agent, slot.sessionId)}
                  data-session-slot
                  data-session-slot-index={slotIdx}
                  data-focus-session-host={useFloatingSessionToolbar ? 'true' : undefined}
                  className={cn(
                    'group/session-slot min-h-0 min-w-0 overflow-hidden border flex flex-col transition-[border-color,box-shadow,opacity,background-color,transform] duration-200',
                    isFocused ? 'rounded-[20px]' : multiSingleChatPresentation ? 'rounded-[18px]' : isSingleFullscreen ? 'rounded-none' : isMultiWidget ? 'rounded-[18px]' : 'rounded-xl',
                    isFocused ? 'fixed' : 'relative',
                    isMultiWidget && 'hover:-translate-y-0.5',
                    slotFrameClass,
                    hasUnreadCompletedState && !isActive && !isFocused && !isSingleFullscreen && 'border-ok/35 ring-1 ring-ok/10',
                    draggingSlotIndex === slotIdx && 'pointer-events-none opacity-20 scale-[0.985] ring-2 ring-[color:var(--th-selection-ring)]',
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-[var(--th-selected-bg)] ring-2 ring-[color:var(--th-selection-ring)]',
                  )}
                  style={{
                    order: visualOrder,
                    boxShadow: slotShadow,
	                    ...(isFocused
	                      ? isNarrowWorkbench
	                        ? { top: 8, bottom: 8, left: 8, right: 8 }
	                        : { top: 28, bottom: 28, left: '50%', right: 'auto', width: 'min(1512px, calc(100vw - 56px))', transform: 'translateX(-50%)' }
	                      : null),
                    ...(multiWidgetGrid && !isFocused
                      ? {
                        flex: `0 0 ${multiItemFlexBasis || '100%'}`,
                        height: multiItemHeight,
                      }
                      : null),
                  }}
                  onClick={() => {
                    if (window.getSelection()?.toString().trim()) return;
                    setActiveSlotIndex(slotIdx);
                    markSessionReadOnOpen(info, slot.workdir);
                  }}
                  onDoubleClick={e => handleSlotDoubleClick(slotIdx, e)}
                >
                  {isActive && !isFocused && !isSingleFullscreen && (
                    <>
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
                    'group shrink-0 flex items-center gap-2 border-b shadow-[0_1px_0_var(--th-inset-hl)]',
                    isMultiWidget ? 'h-11 px-3' : 'h-9 px-3',
                    isMultiWidget ? 'cursor-grab select-none touch-none active:cursor-grabbing' : 'cursor-default',
                    slotHeaderClass,
                    hasUnreadCompletedState && !isFocused && 'border-b-ok/25',
                    dragOverSlotIndex === slotIdx && draggingSlotIndex !== slotIdx && 'bg-[var(--th-selected-bg)]',
                  )}
                    onPointerDown={isMultiWidget ? (e) => beginSlotPointerDrag(slotIdx, e, {
                      title: slotTitle,
                      agent: slot.agent,
                      state: slotState,
                    }) : undefined}
                    title={isMultiWidget ? t('hub.dragSession') : undefined}
                  >
                    {/* Left: status · workdir / title */}
                    {!isMultiWidget && (slotState === 'running' ? (
                      <SessionAttentionDot kind="running" compact />
                    ) : slotState === 'incomplete' ? (
                      <SessionAttentionDot kind="warn" compact />
                    ) : hasUnreadCompletedState ? (
                      <SessionAttentionDot kind="unread" />
                    ) : null)}
                    {isMultiWidget && (
                      <span
                        aria-hidden="true"
                        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge/55 bg-inset shadow-sm"
                      >
                        <BrandIcon brand={slot.agent || ''} size={16} />
                        {(slotState === 'running' || slotState === 'incomplete' || hasUnreadCompletedState) && (
                          <SessionAttentionDot
                            kind={slotState === 'running' ? 'running' : slotState === 'incomplete' ? 'warn' : 'unread'}
                            compact
                            className="absolute -right-0.5 -top-0.5 border-2 border-panel"
                          />
                        )}
                      </span>
                    )}
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold shadow-sm transition-colors',
                          isMultiWidget && 'hidden',
                          isActive
                            ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selected-bg)] text-fg'
                            : 'border-edge/45 bg-control/70 text-fg-4',
                        )}
                        title={slot.workdir}
                      >
                        {workspaceDisplayName}
                      </span>
                      <span className={cn('shrink-0 text-fg-6 text-[10px]', isMultiWidget && 'hidden')}>/</span>
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
                            'min-w-0 flex items-center gap-1 rounded-md font-semibold transition-colors',
                            isMultiWidget ? 'px-0 py-0 text-[12px]' : 'px-1 py-0.5 text-[11px]',
                            isActive && !isMultiWidget ? 'bg-[var(--th-selected-bg)] text-fg shadow-sm' : 'text-fg',
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
	                          className={cn(
	                            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-5/60 opacity-0 transition-[opacity,background,color] hover:bg-panel-h hover:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)] group-hover:opacity-100',
	                            isMultiWidget && 'hidden',
	                            isFocused && 'hidden',
	                          )}
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
                    <div className="shrink-0 flex items-center gap-1.5 text-[9px] text-fg-5/50 tabular-nums">
		                      {!isFocused && !isMultiWidget && !useFocusToolbar && (isActive || effectiveChatLayout === 'single') && (
		                        <div data-focus-ignore className="hidden min-w-0 items-center gap-0.5 rounded-md border border-edge/45 bg-control/60 p-0.5 lg:flex">
                          {quickContextTabs.map(tab => {
                            const count = contextCountForTab(tab);
                            const tabActive = contextSurfaceOpen && activeContextShelfTab === tab;
                            return (
                              <button
                                key={tab}
                                type="button"
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => {
                                  e.stopPropagation();
                                  if (tab === 'side-chats') {
                                    setContextCardDockMode(parentSlotKey, 'floating');
                                    if (!hasSideChats) {
                                      void handleOpenSideChat(slotIdx, slot, info);
                                      return;
                                    }
                                  }
                                  openContextShelf(tab);
                                }}
                                className={cn(
                                  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold transition-[background,color,transform] active:translate-y-px',
                                  tabActive ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-5 hover:bg-panel-h/70 hover:text-fg-2',
                                )}
                                title={CONTEXT_QUICK_LABEL[tab]}
                                aria-label={CONTEXT_QUICK_LABEL[tab]}
                              >
                                <span>{CONTEXT_QUICK_LABEL[tab]}</span>
                                {count > 0 && (
                                  <span className={cn(
                                    'min-w-[14px] rounded px-1 text-center font-mono text-[9px] leading-4',
                                    tabActive ? 'bg-inset text-fg-3' : 'bg-panel text-fg-5',
                                  )}>
                                    {Math.min(count, 99)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
		                      {!isFocused && !isMultiWidget && !useFocusToolbar && <span title={t('hub.created')}>{fmtTime(info.createdAt)}</span>}
		                      {!isFocused && !isMultiWidget && !useFocusToolbar && info.runUpdatedAt && <span title={t('hub.updated')}>{fmtRelative(info.runUpdatedAt)}</span>}
			                      {!isFocused && !isMultiWidget && !useFocusToolbar && !!info.numTurns && (
		                        <span className="flex items-center gap-0.5">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
	                          {info.numTurns}
	                        </span>
	                      )}
		                      {useFocusToolbar && (
		                        <button
		                          data-focus-ignore
		                          data-focus-new-session
		                          type="button"
		                          onMouseDown={e => e.stopPropagation()}
		                          onClick={e => {
		                            e.stopPropagation();
		                            if (useFloatingSessionToolbar) {
		                              handleFocusFloatingSessionRequest();
		                              return;
		                            }
		                            handleNewSessionRequest(slot.workdir);
		                          }}
		                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-edge/45 bg-control/60 text-[15px] font-semibold leading-none text-fg-4 transition-colors hover:bg-panel-h hover:text-fg"
	                          title={t('hub.newSession')}
	                          aria-label={t('hub.newSession')}
	                        >
	                          +
	                        </button>
	                      )}
	                      {useFloatingSessionToolbar && hiddenFocusFloatingSessionCount > 0 && (
	                        <button
	                          data-focus-ignore
	                          data-focus-floating-tray
	                          type="button"
	                          onMouseDown={e => e.stopPropagation()}
	                          onClick={e => {
	                            e.stopPropagation();
	                            restoreFocusFloatingSessions();
	                          }}
	                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-edge/45 bg-control/60 px-1.5 text-[10px] font-semibold text-fg-4 transition-colors hover:bg-panel-h hover:text-fg"
	                          title="Restore hidden sessions"
	                          aria-label="Restore hidden sessions"
	                        >
	                          <span className="grid h-3.5 w-3.5 place-items-center">
	                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
	                              <rect x="4" y="5" width="16" height="14" rx="2" />
	                              <path d="M8 9h8" />
	                            </svg>
	                          </span>
	                          {hiddenFocusFloatingSessionCount}
	                        </button>
	                      )}
		                      {!isMultiWidget && (
		                        <button
	                          data-focus-ignore
	                          data-context-sidebar-toggle
	                          type="button"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => {
                            e.stopPropagation();
                            if (contextSurfaceOpen) {
                              setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: false }));
                              return;
                            }
	                            const nextTab = isFocused
	                              ? FOCUS_CONTEXT_SHELF_TABS.has(activeContextShelfTab)
	                                ? activeContextShelfTab
	                                : 'side-chats'
	                              : taskWorkbenchForSlot && taskOutputCount > 0
	                                ? 'outputs'
	                                : activeContextShelfTab;
	                            openContextShelf(nextTab);
	                          }}
		                          className={cn(
		                            'relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-5/70 transition-colors hover:bg-panel-h hover:text-fg',
		                            !useFocusToolbar && (isActive || effectiveChatLayout === 'single') && 'lg:hidden',
		                            useFocusToolbar && 'border border-edge/45 bg-control/60 text-fg-4',
		                            contextSurfaceOpen && 'bg-[var(--th-selected-bg)] text-fg',
		                          )}
                          title={sideChatToggleLabel}
                          aria-label={sideChatToggleLabel}
                        >
                          <SideChatCollapseIcon className="h-3.5 w-3.5 shrink-0" />
                          {!contextSurfaceOpen && taskOutputCount > 0 && (
                            <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full border border-panel bg-primary px-0.5 text-center text-[8px] font-semibold leading-[13px] text-primary-fg">
                              {Math.min(taskOutputCount, 9)}
                            </span>
                          )}
                          {!contextSurfaceOpen && (sideChatsHaveRunning || sideChatsHaveUnread) && (
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
                      )}
	                      {isFocused ? (
	                        <button
	                          data-focus-ignore
	                          data-focus-exit
	                          type="button"
	                          onPointerDown={e => e.stopPropagation()}
	                          onMouseDown={e => e.stopPropagation()}
	                          onClick={e => {
	                            e.stopPropagation();
	                            closeFocusMode();
	                          }}
	                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-edge/45 bg-control/60 text-fg-4 transition-colors hover:bg-panel-h hover:text-fg"
	                          title={t('hub.exitFocusMode')}
	                          aria-label={t('hub.exitFocusMode')}
	                        >
	                          <ExitFocusIcon className="h-3.5 w-3.5 shrink-0" />
	                        </button>
		                      ) : isMultiWidget ? (
		                        <button
	                          data-focus-ignore
                          type="button"
                          onPointerDown={e => e.stopPropagation()}
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
                      ) : null}
	                      {!isFocused && (
	                        <>
	                          {!multiSingleChatPresentation && (
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
	                                useFocusToolbar && 'border border-edge/45 bg-control/60 text-fg-4 hover:text-fg',
	                                slotMenu?.slotIdx === slotIdx && 'bg-panel-h text-fg-2',
	                              )}
	                              title={t('session.openActions')}
	                              aria-label={t('session.openActions')}
	                              aria-haspopup="menu"
	                            >
	                              ...
	                            </button>
	                          )}
	                          <button
	                            data-focus-ignore
	                            type="button"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              setSlotMenu(null);
                              handleCloseSlot(slotIdx);
                            }}
	                            className={cn(
	                              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
	                              useFocusToolbar
	                                ? 'border border-edge/45 bg-control/60 text-fg-4 hover:bg-panel-h hover:text-fg'
	                                : 'text-fg-5/70 hover:bg-err/10 hover:text-err',
	                            )}
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
                  <div className={cn('flex-1 min-h-0 flex flex-col overflow-hidden', isFocused && 'bg-[var(--th-chat-window-bg)]')}>
                    <div className={cn('flex-1 min-h-0 flex overflow-hidden', isFocused && 'bg-[var(--th-chat-window-bg)]')}>
                      <div className={cn('min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden', isFocused && 'bg-[var(--th-chat-window-bg)]')}>
                        <Suspense fallback={<div className="h-full" />}>
                          <SessionPanel
                            key={slot.mountKey}
	                            session={info}
	                            workdir={slot.workdir}
	                            active={active && isActive && !inboxOpen}
	                            readOnly={slot.archiveOnly === true}
	                            compact={isMultiWidget}
	                            transcriptHeader={slotTaskBrief}
	                            onSessionChange={slot.archiveOnly ? undefined : (next) => handlePanelSessionChange(next, slotIdx)}
                            onMultiSessionChange={slot.archiveOnly ? undefined : handleMultiSessionCreated}
                            onOpenFileLink={(target) => handleOpenFileLink(slotIdx, slot.workdir, target)}
                            onCreateSideChatFromSelection={slot.archiveOnly ? undefined : (request) => handleCreateSideChatFromSelection(slotIdx, slot, info, request)}
                            onCreateTodoFromSelection={slot.archiveOnly ? undefined : (request) => handleCreateTodoFromSelection(slot, request)}
                            onCreateReviewCommentFromSelection={slot.archiveOnly ? undefined : (request) => handleCreateReviewCommentFromSelection(slot, request)}
                            initialPendingPrompt={!slot.archiveOnly && isActive ? newSessionPendingPrompt : null}
                            initialPendingImageUrls={!slot.archiveOnly && isActive ? newSessionPendingImageUrls : undefined}
                            initialPendingCreatedAt={!slot.archiveOnly && isActive ? newSessionPendingCreatedAt : null}
                            onPendingPromptConsumed={!slot.archiveOnly && isActive ? () => { setNewSessionPendingPrompt(null); setNewSessionPendingImageUrls([]); setNewSessionPendingCreatedAt(null); } : undefined}
                          />
                        </Suspense>
                      </div>
		                      {contextSurfaceOpen && (
		                        <ContextShelf
		                          tabs={visibleContextShelfTabs}
		                          activeTab={effectiveContextShelfTab}
		                          onTabChange={(tab) => setContextShelfTabByParent(prev => ({ ...prev, [parentSlotKey]: tab }))}
		                          onClose={() => setSideChatPanelOpenByParent(prev => ({ ...prev, [parentSlotKey]: false }))}
		                          onResizeStart={(e) => handleSideChatResizeStart(parentSlotKey, e)}
		                          width={sideChatWidth}
		                          surface={renderContextCard ? 'card' : 'inline'}
		                          cardTitle={effectiveContextShelfTab === 'side-chats'
		                            ? activeSideSlot
		                              ? sideChatDisplayTitle(Math.max(0, visibleOpenSideSlots.findIndex(sideSlot => sameSideChatIdentity(sideSlot, activeSideSlot))), t('session.sideChat'))
		                              : 'Side Card'
		                            : CONTEXT_QUICK_LABEL[effectiveContextShelfTab]}
		                          cardPlacement={contextCardPlacement}
		                          cardDragging={draggingContextCardKey === parentSlotKey}
		                          onCardDragStart={(e) => handleContextCardDragStart(parentSlotKey, e)}
		                          onCardDock={() => setContextCardDockMode(parentSlotKey, 'docked')}
		                          onCardFloat={() => setContextCardDockMode(parentSlotKey, 'floating')}
			                          minimalHeader={isFocused}
			                          tabLabels={isFocused ? FOCUS_CONTEXT_TAB_LABELS : undefined}
				                          hiddenTabs={isFocused && visibleOpenSideSlots.length > 0 ? { 'side-chats': true } : undefined}
				                          afterTabButtons={focusSideCardTabButtons}
				                          onCreateSideCard={isFocused ? () => { void handleOpenSideChat(slotIdx, slot, info); } : undefined}
			                          createSideCardLabel={t('session.newSideChat')}
			                          filesContent={<WorkspaceFilesShelfPane workdir={slot.workdir} request={filePanelRequest?.workdir === slot.workdir ? filePanelRequest : null} t={t} />}
			                          outputs={taskWorkbenchForSlot?.outputs || []}
		                          files={taskWorkbenchForSlot?.files || []}
	                          ticket={taskWorkbenchForSlot?.ticketSnapshot || null}
	                          onOpenPath={(path, workdir) => handleOpenFileLink(slotIdx, workdir || slot.workdir, { path })}
	                          statusContent={(
	                            <div className="space-y-3">
	                              <div className="rounded-lg border border-edge/55 bg-panel/70 px-3 py-3">
	                                <div className="text-[12px] font-semibold text-fg">Chat status</div>
	                                <dl className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
	                                  <dt className="text-fg-5">Session</dt>
	                                  <dd className="min-w-0 truncate font-mono text-fg-3">{slot.agent}:{slot.sessionId}</dd>
	                                  <dt className="text-fg-5">State</dt>
	                                  <dd className="min-w-0 text-fg-3">{slotState}</dd>
	                                  <dt className="text-fg-5">Updated</dt>
	                                  <dd className="min-w-0 text-fg-3">{info.runUpdatedAt ? fmtRelative(info.runUpdatedAt) : '--'}</dd>
	                                </dl>
	                              </div>
	                              {taskWorkbenchForSlot && (
	                                <div className="rounded-lg border border-edge/55 bg-panel/70 px-3 py-3">
	                                  <div className="text-[12px] font-semibold text-fg">Task status</div>
	                                  <dl className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
	                                    <dt className="text-fg-5">Task</dt>
	                                    <dd className="min-w-0 truncate text-fg-3">{taskWorkbenchForSlot.task.jiraKey || taskWorkbenchForSlot.task.title}</dd>
	                                    <dt className="text-fg-5">Board</dt>
	                                    <dd className="min-w-0 text-fg-3">{taskWorkbenchForSlot.task.status}</dd>
	                                    <dt className="text-fg-5">Stage</dt>
	                                    <dd className="min-w-0 text-fg-3">{taskActiveStageRun ? `${taskActiveStageRun.stage} · ${taskActiveStageRun.status}` : '--'}</dd>
	                                  </dl>
	                                </div>
	                              )}
	                            </div>
	                          )}
	                          sideCardContent={(
	                            <div className="h-full min-h-0 overflow-hidden bg-[var(--th-session-bg)]">
	                              {activeSideSlot ? (() => {
	                                const sideInfo = resolveSideSlotInfo(info, activeSideSlot);
	                                return (
	                                  <Suspense fallback={<div className="h-full" />}>
	                                    <SessionPanel
	                                      key={activeSideSlot.mountKey}
	                                      session={sideInfo}
	                                      workdir={activeSideSlot.workdir}
	                                      active={active && isActive && !inboxOpen}
	                                      onSessionChange={(next) => handleSideChatSessionChange(slot, activeSideSlot, next)}
	                                      onOpenFileLink={(target) => handleOpenFileLink(slotIdx, activeSideSlot.workdir, target)}
	                                      onCreateTodoFromSelection={(request) => handleCreateTodoFromSelection(activeSideSlot, request)}
	                                      onCreateReviewCommentFromSelection={(request) => handleCreateReviewCommentFromSelection(activeSideSlot, request)}
	                                    />
	                                  </Suspense>
		                                );
		                              })() : (
		                                <div className="flex h-full items-center justify-center px-6 text-center">
		                                  {isFocused ? (
		                                    <button
		                                      type="button"
		                                      data-side-card-empty-create
		                                      onClick={e => { e.stopPropagation(); void handleOpenSideChat(slotIdx, slot, info); }}
		                                      className="grid h-12 w-12 place-items-center rounded-2xl border border-edge/70 bg-panel/75 text-2xl font-semibold leading-none text-fg-4 shadow-sm transition-[border-color,background,color,transform] hover:-translate-y-0.5 hover:border-edge-h hover:bg-panel-h hover:text-fg active:translate-y-0"
		                                      title={t('session.newSideChat')}
		                                      aria-label={t('session.newSideChat')}
		                                    >
		                                      +
		                                    </button>
		                                  ) : (
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
		                                  )}
		                                </div>
		                              )}
	                            </div>
	                          )}
		                          sideChatContent={(
		                            <div className="flex h-full min-h-0 flex-col">
			                              {!isFocused && (
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
		                                {!isFocused && (
		                                  <button
		                                    type="button"
		                                    onClick={e => { e.stopPropagation(); void handleOpenSideChat(slotIdx, slot, info); }}
		                                    className="mb-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge/60 bg-panel/75 text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
		                                    title={t('session.newSideChat')}
		                                    aria-label={t('session.newSideChat')}
		                                  >
		                                    +
		                                  </button>
		                                )}
		                                </div>
		                              )}
		                              <div className="min-h-0 flex flex-1 flex-col overflow-hidden bg-[var(--th-session-bg)]">
	                                {activeSideSlot ? (() => {
	                                  const sideInfo = resolveSideSlotInfo(info, activeSideSlot);
	                                  return (
	                                    <Suspense fallback={<div className="h-full" />}>
	                                      <SessionPanel
	                                        key={activeSideSlot.mountKey}
	                                        session={sideInfo}
	                                        workdir={activeSideSlot.workdir}
	                                        active={active && isActive && !inboxOpen}
	                                        onSessionChange={(next) => handleSideChatSessionChange(slot, activeSideSlot, next)}
	                                        onOpenFileLink={(target) => handleOpenFileLink(slotIdx, activeSideSlot.workdir, target)}
	                                        onCreateTodoFromSelection={(request) => handleCreateTodoFromSelection(activeSideSlot, request)}
	                                        onCreateReviewCommentFromSelection={(request) => handleCreateReviewCommentFromSelection(activeSideSlot, request)}
	                                      />
	                                    </Suspense>
	                                  );
		                                })() : (
		                                  <div className="flex h-full items-center justify-center px-6 text-center">
		                                    {isFocused ? (
		                                      <button
		                                        type="button"
		                                        data-side-card-empty-create
		                                        onClick={e => { e.stopPropagation(); void handleOpenSideChat(slotIdx, slot, info); }}
		                                        className="grid h-12 w-12 place-items-center rounded-2xl border border-edge/70 bg-panel/75 text-2xl font-semibold leading-none text-fg-4 shadow-sm transition-[border-color,background,color,transform] hover:-translate-y-0.5 hover:border-edge-h hover:bg-panel-h hover:text-fg active:translate-y-0"
		                                        title={t('session.newSideChat')}
		                                        aria-label={t('session.newSideChat')}
		                                      >
		                                        +
		                                      </button>
		                                    ) : (
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
		                                    )}
		                                  </div>
		                                )}
	                              </div>
	                            </div>
	                          )}
	                        />
                      )}
                    </div>
                  </div>
                  {canResizeMultiRows && (
                    <button
                      data-focus-ignore
                      type="button"
                      onPointerDown={beginMultiRowHeightResize}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      className={cn(
                        'absolute bottom-1 left-1/2 z-30 h-2.5 w-16 -translate-x-1/2 cursor-row-resize rounded-full border border-edge/35 bg-fg-5/16 opacity-55 transition-[opacity,background,border-color] hover:border-primary/30 hover:bg-primary/35 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)] group-hover/session-slot:opacity-100',
                        multiRowHeightDrag && 'border-primary/20 bg-primary/30 opacity-100',
                      )}
                      title={t('hub.resizeWindowHeight')}
                      aria-label={t('hub.resizeWindowHeight')}
                    />
                  )}
                </div>
              );
                });
	              })()}
	              </div>
		              {floatingSessionLayerVisible && focusFloatingSessions.map((item) => {
		                const visibleFloatingItems = focusFloatingSessions.filter(floatingItem => !floatingItem.hidden);
		                const visibleIndex = Math.max(0, visibleFloatingItems.findIndex(floatingItem => floatingItem.id === item.id));
		                const floatingBounds = focusFloatingBounds();
		                const floatingSize = focusFloatingSize(floatingBounds);
		                const rawFloatingPosition = item.x != null && item.y != null
		                  ? { x: item.x, y: item.y }
		                  : defaultFocusFloatingPosition(visibleIndex);
		                const floatingPosition = clampFocusFloatingPosition(
		                  rawFloatingPosition.x,
		                  rawFloatingPosition.y,
		                  floatingSize.width,
		                  floatingSize.height,
		                  floatingBounds,
		                );
	                const floatingSlot: SessionSlot | null = item.sessionId
	                  ? {
	                    workdir: item.workdir,
	                    agent: item.agent,
	                    sessionId: item.sessionId,
	                    mountKey: item.mountKey,
	                  }
	                  : null;
	                const floatingInfo = floatingSlot ? resolveSlotInfo(floatingSlot) : null;
	                const floatingTitle = floatingInfo
	                  ? floatingInfo.title || floatingInfo.lastQuestion?.slice(0, 120) || floatingInfo.sessionId.slice(0, 12)
	                  : t('hub.newSession');
	                return (
	                  <div
	                    key={item.id}
	                    data-focus-floating-session
	                    className={cn(
	                      'fixed z-[84] flex h-[min(620px,calc(100dvh-86px))] w-[min(430px,calc(100vw-92px))] overflow-hidden rounded-[18px] border border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] shadow-[0_24px_72px_rgba(2,6,23,0.22)] ring-1 ring-[color:var(--th-chat-window-ring)] transition-shadow',
	                      focusFloatingDraggingId === item.id && 'shadow-[0_32px_90px_rgba(2,6,23,0.30)] ring-primary/30',
	                      item.hidden && 'hidden',
	                    )}
		                    style={{
		                      left: floatingPosition.x,
		                      top: floatingPosition.y,
		                      width: floatingSize.width,
		                      height: floatingSize.height,
		                      zIndex: 84 + visibleIndex,
		                    }}
	                    onClick={event => event.stopPropagation()}
	                  >
	                    {floatingSlot && floatingInfo ? (
	                      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
	                        <div
	                          onPointerDown={event => handleFocusFloatingDragStart(item.id, event)}
	                          className={cn(
	                            'flex h-10 shrink-0 touch-none select-none items-center gap-2 border-b border-edge/50 bg-panel/55 px-3 backdrop-blur-md',
	                            focusFloatingDraggingId === item.id ? 'cursor-grabbing' : 'cursor-grab',
	                          )}
	                        >
	                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge/55 bg-inset shadow-sm">
	                            <BrandIcon brand={floatingSlot.agent || ''} size={16} />
	                          </span>
	                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2" title={floatingTitle}>
	                            {floatingTitle}
	                          </span>
	                          <button
	                            type="button"
	                            onClick={event => {
	                              event.stopPropagation();
	                              hideFocusFloatingSession(item.id);
	                            }}
	                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg"
	                            title="Hide"
	                            aria-label="Hide"
	                          >
	                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
	                              <path d="M5 12h14" />
	                            </svg>
	                          </button>
	                          <button
	                            type="button"
	                            onClick={event => {
	                              event.stopPropagation();
	                              closeFocusFloatingSession(item.id);
	                            }}
	                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-err/10 hover:text-err"
	                            title={t('hub.closePanel')}
	                            aria-label={t('hub.closePanel')}
	                          >
	                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
	                              <path d="M18 6 6 18" />
	                              <path d="M6 6l12 12" />
	                            </svg>
	                          </button>
	                        </div>
	                        <div className="min-h-0 flex-1 overflow-hidden">
	                          <Suspense fallback={<div className="h-full" />}>
	                            <SessionPanel
	                              key={floatingSlot.mountKey}
	                              session={floatingInfo}
	                              workdir={floatingSlot.workdir}
	                              active={active && !item.hidden && !inboxOpen}
	                              onSessionChange={(next) => {
	                                mergeSessionIntoWorkspaceMap(floatingSlot.workdir, next);
	                                setFocusFloatingSessions(prev => prev.map(current => (
	                                  current.id === item.id
	                                    ? {
	                                      ...current,
	                                      agent: next.agent || current.agent,
	                                      sessionId: next.sessionId || current.sessionId,
	                                    }
	                                    : current
	                                )));
	                              }}
	                              onOpenFileLink={(target) => handleOpenOverlayFileLink(floatingSlot.workdir, target)}
	                              onCreateTodoFromSelection={(request) => handleCreateTodoFromSelection(floatingSlot, request)}
	                              onCreateReviewCommentFromSelection={(request) => handleCreateReviewCommentFromSelection(floatingSlot, request)}
	                              initialPendingPrompt={item.pendingPrompt || null}
	                              initialPendingImageUrls={item.pendingImageUrls}
	                              initialPendingCreatedAt={item.pendingCreatedAt || null}
	                              onPendingPromptConsumed={() => {
	                                setFocusFloatingSessions(prev => prev.map(current => (
	                                  current.id === item.id
	                                    ? { ...current, pendingPrompt: null, pendingImageUrls: [], pendingCreatedAt: null }
	                                    : current
	                                )));
	                              }}
	                            />
	                          </Suspense>
	                        </div>
	                      </div>
	                    ) : (
	                      <NewSessionView
	                        key={item.mountKey}
	                        workdir={item.workdir}
	                        workspaceName={workspaces.find(ws => ws.path === item.workdir)?.name || item.workdir.split('/').pop() || ''}
	                        workspaces={workspaces}
	                        initialAgent={item.agent}
	                        onSessionCreated={(next, pendingPrompt, pendingImageUrls, pendingCreatedAt) => handleFocusFloatingSessionCreated(item.id, next, pendingPrompt, pendingImageUrls, pendingCreatedAt)}
	                        onMultiSessionCreated={(nextSessions, prompt) => handleFocusFloatingMultiSessionCreated(item.id, nextSessions, prompt)}
	                        onClose={() => closeFocusFloatingSession(item.id)}
	                        onHide={() => hideFocusFloatingSession(item.id)}
	                        onHeaderPointerDown={event => handleFocusFloatingDragStart(item.id, event)}
	                        dragging={focusFloatingDraggingId === item.id}
	                        t={t}
	                      />
	                    )}
	                  </div>
	                );
	              })}
	              {floatingNewSessionVisible && showNewSession && (
	                <div
                  className="fixed bottom-5 right-6 z-[84] flex h-[min(620px,calc(100dvh-72px))] w-[min(430px,calc(100vw-92px))] overflow-hidden rounded-[18px] border border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] shadow-[0_24px_72px_rgba(2,6,23,0.22)] ring-1 ring-[color:var(--th-chat-window-ring)]"
                  onClick={event => event.stopPropagation()}
                >
                  <NewSessionView
                    key={`floating-new-${showNewSession}`}
                    workdir={showNewSession}
                    workspaceName={workspaces.find(ws => ws.path === showNewSession)?.name || showNewSession.split('/').pop() || ''}
                    workspaces={workspaces}
                    initialAgent={newSessionTemplateAgent}
                    initialDraftPrompt={newSessionInitialDraftPrompt}
                    initialAutoSend={newSessionInitialAutoSend}
                    onSessionCreated={handleNewSessionCreated}
                    onMultiSessionCreated={handleMultiSessionCreated}
                    onClose={() => {
                      setNewSessionInitialDraftPrompt(null);
                      setNewSessionInitialAutoSend(false);
                      setShowNewSession(null);
                    }}
                    t={t}
                  />
                </div>
              )}
            </div>
          </>
        )}
	      </div>
      </div>

	      {inboxOpen && (
		        <InboxDrawer
		          items={dashboardItems}
		          loading={sidebarLoading || workspaceStatusSummary.loadingWorkspaces > 0}
              focusedSlot={inboxFocusedSlot}
              focusedSession={inboxFocusedSlot ? resolveSlotInfo(inboxFocusedSlot) : null}
		          onClose={closeInbox}
		          onOpenFocus={handleOpenInboxSession}
              onSessionChange={handleInboxPanelSessionChange}
              onOpenFileLink={handleOpenOverlayFileLink}
              onCreateSideChatFromSelection={(request) => {
                if (!inboxFocusedSlot) return;
                const info = resolveSlotInfo(inboxFocusedSlot);
                return handleCreateSideChatFromSelection(activeSlotRef.current, inboxFocusedSlot, info, request);
              }}
              onCreateTodoFromSelection={(request) => {
                if (!inboxFocusedSlot) return;
                return handleCreateTodoFromSelection(inboxFocusedSlot, request);
              }}
              onCreateReviewCommentFromSelection={(request) => {
                if (!inboxFocusedSlot) return;
                return handleCreateReviewCommentFromSelection(inboxFocusedSlot, request);
              }}
              onCloseFocus={() => setInboxFocusedSlot(null)}
		          t={t}
		        />
	      )}
	
	      {/* ═══ Floating File Tree ═══ */}
	      {fileTreeOpen && (filePanelWorkdir || filePanelRequest?.workdir) && (
	        <FloatingFileTree
            key={filePanelWorkdir || filePanelRequest!.workdir}
	          workdir={filePanelWorkdir || filePanelRequest!.workdir}
	          request={filePanelRequest}
	          onClose={() => {
              setFileTreeOpen(false);
              setFilePanelWorkdir(null);
              setFilePanelRequest(null);
            }}
	          t={t}
	          elevated={focusedSlotIndex != null || inboxOpen}
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
        const MENU_WIDTH = 176;
        // Right-align to the kebab; clamp to viewport with 8px margins.
        const left = Math.max(8, Math.min(sessionMenu.anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
        const top = Math.min(sessionMenu.anchor.bottom + 4, window.innerHeight - 60);
        const canResetMultiRowHeight = isMultiChatLayout(effectiveChatLayout) && !taskFocusId && multiRowHeightPx != null;
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
            {canResetMultiRowHeight && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSessionMenu(null);
                  setMultiRowHeightPx(null);
                }}
                className={menuItemClass()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v6h6" />
                </svg>
                {t('hub.resetWindowHeight')}
              </button>
            )}
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
            {renderDeleteSessionMenuItem(sessionMenu.target)}
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
        const isMultiSlotMenu = isMultiChatLayout(effectiveChatLayout) && !taskFocusId && !multiSingleChatPresentation;
        const hideDuplicateSlotMenuActions = !isMultiSlotMenu && (effectiveChatLayout === 'single' || multiSingleChatPresentation);
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
            {!isMultiSlotMenu && !hideDuplicateSlotMenuActions && (
              <>
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
              </>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => runSlotAction(() => openCreateTaskModal(slotMenu.target))}
              className={menuItemClass('primary')}
            >
              <TodoGlyph className="h-3 w-3 shrink-0" />
              {t('dashboard.createTask')}
            </button>
            {!isMultiSlotMenu && !hideDuplicateSlotMenuActions && (
              <button
                type="button"
                role="menuitem"
                onClick={() => runSlotAction(() => {
                  setActiveSlotIndex(slotMenu.slotIdx);
                  setFilePanelRequest(null);
                  setFilePanelWorkdir(slotMenu.target.workdir);
                  setFileTreeOpen(true);
                })}
                className={menuItemClass()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                {t('hub.files')}
              </button>
            )}
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
            {renderDeleteSessionMenuItem(slotMenu.target)}
          </div>
        );
      })()}

      {/* Create local task from chat */}
      <Modal open={!!createTaskTarget} onClose={() => !creatingTask && setCreateTaskTarget(null)}>
        <ModalHeader title={t('dashboard.createTask')} onClose={() => !creatingTask && setCreateTaskTarget(null)} />
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-5">{t('dashboard.createTaskTitle')}</span>
            <input
              value={createTaskTitle}
              onChange={e => setCreateTaskTitle(e.target.value)}
              autoFocus
              disabled={creatingTask}
              className="w-full rounded-md border border-edge bg-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-5/40 focus:border-primary/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-5">{t('dashboard.createTaskType')}</span>
              <select
                value={createTaskKind}
                onChange={e => setCreateTaskKind(e.target.value as Extract<ProTaskKind, 'jira-ticket' | 'jira-bug'>)}
                disabled={creatingTask}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2 text-[13px] text-fg outline-none focus:border-primary/40"
              >
                <option value="jira-ticket">{t('dashboard.createTaskTypeTask')}</option>
                <option value="jira-bug">{t('dashboard.createTaskTypeBug')}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-5">{t('dashboard.createTaskStatus')}</span>
              <select
                value={createTaskStatus}
                onChange={e => setCreateTaskStatus(e.target.value as ProTaskStatus)}
                disabled={creatingTask}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2 text-[13px] text-fg outline-none focus:border-primary/40"
              >
                <option value="backlog">{t('dashboard.taskStatus.backlog')}</option>
                <option value="refinement">{t('dashboard.taskStatus.refinement')}</option>
                <option value="coding">{t('dashboard.taskStatus.coding')}</option>
                <option value="resolved">{t('dashboard.taskStatus.resolved')}</option>
                <option value="done">{t('dashboard.taskStatus.done')}</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-5">{t('dashboard.createTaskDescription')}</span>
            <textarea
              value={createTaskDescription}
              onChange={e => setCreateTaskDescription(e.target.value)}
              disabled={creatingTask}
              rows={7}
              className="w-full resize-none rounded-md border border-edge bg-inset px-3 py-2 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-5/40 focus:border-primary/40"
            />
          </label>
          {createTaskTarget && (
            <div className="truncate text-[11px] text-fg-5">
              {createTaskTarget.agent}:{createTaskTarget.sessionId}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateTaskTarget(null)} disabled={creatingTask}>{t('modal.cancel')}</Button>
          <Button variant="primary" onClick={() => void submitCreateTaskFromChat()} disabled={creatingTask || !createTaskTitle.trim()}>
            {creatingTask ? t('dashboard.creatingTask') : t('dashboard.createTask')}
          </Button>
        </div>
      </Modal>

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
   New Session Placeholder — tail card in multi-window layout
   ══════════════════════════════════════════════════════ */
function MultiNewSessionPlaceholder({
  workdir,
  workspaceName,
  agent,
  agentLabel,
  order,
  height,
  flexBasis,
  onClick,
  t,
}: {
  workdir: string;
  workspaceName: string;
  agent: string;
  agentLabel: string;
  order: number;
  height: string;
  flexBasis?: string;
  onClick: () => void;
  t: (key: string) => string;
}) {
  const inheritedLabel = agentLabel ? `${workspaceName} · ${agentLabel}` : workspaceName;
  return (
    <button
      type="button"
      data-new-session-placeholder
      onClick={onClick}
      className={cn(
        'group flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px] border border-dashed border-edge/60 bg-transparent text-left transition-[border-color,transform,background-color] duration-200',
        'hover:-translate-y-0.5 hover:border-[color:var(--th-chat-window-border-active)] hover:bg-panel/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]',
      )}
      style={{
        order,
        flex: flexBasis ? `0 0 ${flexBasis}` : undefined,
        boxShadow: 'none',
        height,
      }}
      title={`${t('hub.newSession')} · ${inheritedLabel}`}
      aria-label={`${t('hub.newSession')} · ${inheritedLabel}`}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-dashed border-edge/40 bg-transparent px-3 text-fg-4">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-edge/65 bg-panel/30 text-fg-5 transition-colors group-hover:border-[color:var(--th-selection-border)] group-hover:text-primary">
          {agent ? <BrandIcon brand={agent} size={16} /> : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-3">
          {t('hub.newSessionPlaceholder')}
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-[260px] text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-edge/65 bg-panel/35 text-primary transition-transform duration-200 group-hover:scale-105 group-hover:bg-panel/55">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </span>
          <div className="text-[13px] font-semibold text-fg">{t('hub.newSession')}</div>
          <div className="mt-1 text-[11px] leading-snug text-fg-5">
            {t('hub.newSessionInherits')
              .replace('{workspace}', workspaceName)
              .replace('{agent}', agentLabel ? ` · ${agentLabel}` : '')}
          </div>
          <div className="mt-3 truncate rounded-md border border-dashed border-edge/45 bg-transparent px-2 py-1 font-mono text-[10px] text-fg-5" title={workdir}>
            {workspaceBaseName(workdir)}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   New Session View — empty chat + InputComposer
   Looks identical to a regular session: header, empty
   message area, and the standard input bar at the bottom.
   ══════════════════════════════════════════════════════ */
export function NewSessionView({
  workdir,
  workspaceName,
  workspaces,
  initialAgent = '',
  initialDraftPrompt = null,
  initialAutoSend = false,
  onSessionCreated,
  onMultiSessionCreated,
  onClose,
  onHide,
  onHeaderPointerDown,
  dragging = false,
  t,
}: {
  workdir: string;
  workspaceName: string;
  workspaces: WorkspaceEntry[];
  initialAgent?: string;
  initialDraftPrompt?: string | null;
  initialAutoSend?: boolean;
  onSessionCreated: (next: { agent: string; sessionId: string; workdir: string }, pendingPrompt?: string, pendingImageUrls?: string[], pendingCreatedAt?: string | null) => void;
  onMultiSessionCreated: (next: Array<{ agent: string; sessionId: string; workdir: string }>, prompt: string) => void;
  onClose: () => void;
  onHide?: () => void;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  dragging?: boolean;
  t: (key: string) => string;
}) {
  const [selectedWorkdir, setSelectedWorkdir] = useState(workdir);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>([]);
  const [pendingCreatedAt, setPendingCreatedAt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingImageUrlsRef = useRef<string[]>([]);
  const pendingCreatedAtRef = useRef<string | null>(null);
  const autoSendKeyRef = useRef('');
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
    agent: initialAgent,
    runState: 'completed',
  }), [initialAgent]);

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

  useEffect(() => {
    const prompt = String(initialDraftPrompt || '').trim();
    if (!initialAutoSend || !prompt || !initialAgent || !selectedWorkdir) return;
    const key = `${selectedWorkdir}:${initialAgent}:${prompt}`;
    if (autoSendKeyRef.current === key) return;
    autoSendKeyRef.current = key;
    handleSendStart(prompt);
    api.sendSessionMessage(selectedWorkdir, initialAgent, '', prompt)
      .then(res => {
        if (!res.ok) throw new Error(res.error || 'Failed to start test chat');
        const nextSession = parseSessionKeyValue(res.sessionKey);
        if (!nextSession) throw new Error('Test chat started but no session id was returned');
        handleSessionCreated({ ...nextSession, workdir: selectedWorkdir });
      })
      .catch(() => {
        setPendingPrompt(null);
        setPendingCreatedAt(null);
        pendingRef.current = null;
        pendingCreatedAtRef.current = null;
      });
  }, [handleSendStart, handleSessionCreated, initialAgent, initialAutoSend, initialDraftPrompt, selectedWorkdir]);

  const hasPending = !!pendingPrompt || pendingImageUrls.length > 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          'z-10 flex h-10 shrink-0 touch-none select-none items-center gap-2 border-b border-edge/50 bg-panel/40 px-4 backdrop-blur-md',
          onHeaderPointerDown && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
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
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg"
            title="Hide"
            aria-label="Hide"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
        )}
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
          <div className="flex h-full w-full items-center justify-center px-8">
            <div className="mx-auto w-full max-w-[300px] space-y-1.5 text-center">
              <div className="mx-auto w-full break-words text-center text-[13px] leading-relaxed text-fg-5">{t('hub.newSessionHint')}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <InputComposer
        session={stubSession}
        workdir={selectedWorkdir}
        initialDraftPrompt={initialDraftPrompt}
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
  const activeItems = items.filter(item => item.status === 'open');
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

function InboxDrawer({
  items,
  loading,
  focusedSlot,
  focusedSession,
  onClose,
  onOpenFocus,
  onSessionChange,
  onOpenFileLink,
  onCreateSideChatFromSelection,
  onCreateTodoFromSelection,
  onCreateReviewCommentFromSelection,
  onCloseFocus,
  t,
}: {
  items: DashboardSessionItem[];
  loading: boolean;
  focusedSlot: SessionSlot | null;
  focusedSession: SessionInfo | null;
  onClose: () => void;
  onOpenFocus: (item: DashboardSessionItem) => void;
  onSessionChange: (next: SessionPanelChange) => void;
  onOpenFileLink: (target: FileLinkTarget) => void;
  onCreateSideChatFromSelection?: (request: SelectionSideChatRequest) => void | Promise<void>;
  onCreateTodoFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onCreateReviewCommentFromSelection?: (request: SelectionActionRequest) => void | Promise<void>;
  onCloseFocus: () => void;
  t: (key: string) => string;
}) {
  const groups = useMemo(() => {
    const grouped: Record<DashboardColumnKey, DashboardSessionItem[]> = {
      running: [],
      review: [],
      incomplete: [],
      done: [],
    };
    for (const item of items) grouped[item.column].push(item);
    return grouped;
  }, [items]);
	  const orderedColumns: Array<{ key: DashboardColumnKey; hintKey: string }> = [
	    { key: 'review', hintKey: 'inbox.unreadHint' },
  ];
  const alertCount = items.length;
  const visibleItemCount = items.length;
  const focusedTitle = focusedSession
    ? sessionListDisplayText(focusedSession).slice(0, 180) || focusedSession.sessionId.slice(0, 16)
    : '';
  const focusedMeta = focusedSession ? getAgentMeta(focusedSession.agent || '') : null;
  const focusedDisplayState = focusedSession ? sessionDisplayState(focusedSession) : 'completed';

  return createPortal((
    <div className="fixed inset-0 z-[210]">
      <div className="absolute inset-0 bg-black/24 backdrop-blur-[2px]" aria-hidden="true" />
      {focusedSlot && focusedSession && (
        <div
          className="pointer-events-auto absolute bottom-6 right-[492px] top-6 hidden w-[min(780px,calc(100vw-548px))] min-w-[620px] overflow-hidden rounded-2xl border border-edge-h/90 bg-[var(--th-modal-bg)] shadow-[0_28px_90px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.08)_inset] ring-1 ring-primary/[0.08] backdrop-blur-xl lg:flex lg:flex-col"
          onMouseDown={event => event.stopPropagation()}
          role="dialog"
          aria-modal="false"
          aria-label={focusedTitle}
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge/45 bg-panel/82 px-3 backdrop-blur-md">
            <Dot
              variant={focusedDisplayState === 'running' ? 'active' : focusedDisplayState === 'incomplete' ? 'err' : 'idle'}
              pulse={focusedDisplayState === 'running'}
            />
            {focusedMeta && (
              <BrandIcon brand={focusedSession.agent || ''} size={14} />
            )}
            <span className="shrink-0 text-[11px] font-semibold" style={{ color: focusedMeta?.color }}>
              {focusedMeta?.shortLabel || focusedSession.agent}
            </span>
            <span className="h-3 w-px shrink-0 bg-edge/70" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2" title={focusedTitle}>
              {focusedTitle}
            </span>
            <span className="hidden shrink-0 rounded-md border border-edge/50 bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-5 md:inline">
              {focusedSession.sessionId.slice(0, 8)}
            </span>
            <button
              type="button"
              onClick={onCloseFocus}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge/45 bg-panel/70 text-fg-5 transition-colors hover:border-primary/30 hover:bg-primary/[0.08] hover:text-primary"
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-[var(--th-session-bg)]">
            <Suspense fallback={<div className="h-full flex-1 bg-[var(--th-session-bg)]" />}>
              <SessionPanel
                key={focusedSlot.mountKey}
                session={focusedSession}
                workdir={focusedSlot.workdir}
                active={true}
                onSessionChange={onSessionChange}
                onOpenFileLink={onOpenFileLink}
                onCreateSideChatFromSelection={onCreateSideChatFromSelection}
                onCreateTodoFromSelection={onCreateTodoFromSelection}
                onCreateReviewCommentFromSelection={onCreateReviewCommentFromSelection}
              />
            </Suspense>
          </div>
        </div>
      )}
      <aside
        className="pointer-events-auto absolute inset-y-0 right-0 flex h-full w-[min(460px,calc(100vw-18px))] flex-col overflow-hidden border-l border-edge-h bg-panel/96 shadow-[-24px_0_72px_rgba(0,0,0,0.28)] backdrop-blur-md"
        onMouseDown={event => event.stopPropagation()}
        role="dialog"
        aria-modal="false"
        aria-label={t('inbox.title')}
      >
        <div className="shrink-0 border-b border-edge/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent)] px-4 py-3">
          <div className="flex items-start gap-3">
            <div className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[12px] font-bold tabular-nums',
              alertCount > 0 ? 'border-primary/45 bg-primary/[0.12] text-primary' : 'border-edge bg-panel-alt text-fg-4',
            )}>
              {alertCount}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold tracking-tight text-fg">{t('inbox.title')}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-fg-5">{t('inbox.subtitle')}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-5 transition-colors hover:bg-panel-h hover:text-fg"
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && items.length === 0 ? (
            <div className="flex h-32 items-center justify-center"><Spinner className="h-4 w-4 text-fg-5" /></div>
          ) : visibleItemCount === 0 ? (
            <div className="rounded-xl border border-dashed border-edge/45 px-4 py-12 text-center text-[13px] text-fg-5">{t('inbox.empty')}</div>
          ) : (
            <div className="space-y-3">
              {orderedColumns.map(column => {
                const columnItems = groups[column.key];
                if (!columnItems.length) return null;
                return (
                  <section key={column.key} className="rounded-xl border border-edge/50 bg-panel-alt/30 p-2.5">
	                    <div className="mb-2 px-0.5">
	                      <div className="truncate text-[10px] text-fg-5">{t(column.hintKey)}</div>
	                    </div>
                    <div className="space-y-2">
                      {columnItems.map(item => (
	                        <DashboardTaskCard
	                          key={item.key}
		                          item={item}
	                            selected={!!focusedSlot && focusedSlot.workdir === item.workdir && focusedSlot.agent === item.session.agent && focusedSlot.sessionId === item.session.sessionId}
		                          onOpen={() => onOpenFocus(item)}
		                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  ), document.body);
}

function DashboardTaskCard({
  item,
  selected,
  onOpen,
}: {
  item: DashboardSessionItem;
  selected?: boolean;
  onOpen: () => void;
}) {
  const meta = getAgentMeta(item.session.agent || '');
  const title = sessionListDisplayText(item.session).slice(0, 180) || item.session.sessionId.slice(0, 16);
  const detail = sessionListContextText(item.session, title).slice(0, 160);
  const displayState = sessionDisplayState(item.session);
  const time = fmtRelative(item.session.runUpdatedAt || item.session.createdAt);

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.035)] transition-[border-color,background,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-panel-h/55',
      selected ? 'border-primary/60 bg-primary/[0.09] ring-1 ring-primary/25' : 'border-edge/50 bg-panel/78',
    )}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 text-[10px] text-fg-5">
          <BrandIcon brand={item.session.agent || ''} size={11} />
          <span className="font-medium" style={{ color: meta.color }}>{meta.shortLabel}</span>
          <span className="min-w-0 truncate">{item.workspaceName}</span>
          <span className="ml-auto shrink-0 tabular-nums">{time}</span>
        </div>
	        <div className="mt-1.5 flex items-start gap-2">
          {!selected && <Dot variant={displayState === 'running' ? 'active' : displayState === 'incomplete' ? 'err' : 'idle'} pulse={displayState === 'running'} />}
	          <div className="min-w-0 flex-1">
	            <div className="line-clamp-2 text-[12px] font-medium leading-snug text-fg-2" title={title}>{title}</div>
	            {detail && <div className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-fg-5">{detail}</div>}
	          </div>
	        </div>
	      </button>
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
  onMarkAllRead,
  inboxUnreadCount,
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
  onMarkAllRead: (wsPath: string) => void;
  inboxUnreadCount: number;
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
    <div className="border-b border-edge/25 py-2 last:border-b-0">
      {/* Workspace header */}
      <div
        data-workspace-path={wsPath}
        draggable
        className={cn(
          'group/workspace mx-2 flex h-8 items-center gap-1.5 rounded-md px-2 cursor-pointer transition-[background,border-color,opacity] duration-150',
          groupHeaderSelected
            ? 'bg-panel-h/72 text-fg'
            : isActive
              ? 'bg-panel-alt/42 text-fg-2 hover:bg-panel-h/58'
            : 'bg-transparent text-fg-3 hover:bg-panel-h/45',
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
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn('shrink-0 text-fg-5/70 transition-transform duration-150', expanded && 'rotate-90')}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
          <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold">
            {displayName}
          </span>
          {hasAlias && (
            <span className="min-w-0 flex-1 truncate text-[10px] font-normal text-fg-5/45" title={wsPath}>
              {originalName}
            </span>
          )}
        </div>
        {groupAttention && <SessionAttentionDot kind={groupAttention} compact />}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onNewSession(wsPath);
          }}
          onMouseDown={e => e.stopPropagation()}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-5/75 transition-[background,color,opacity] hover:bg-panel-h hover:text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]"
          title={t('hub.newSessionHere')}
          aria-label={t('hub.newSessionHere')}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={openActions}
          onMouseDown={e => e.stopPropagation()}
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px] font-semibold leading-none text-fg-5 opacity-0 transition-[background,color,opacity] hover:bg-panel-h hover:text-fg-2 hover:opacity-100 group-hover/workspace:opacity-100 focus-visible:opacity-100',
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
	          const MENU_HEIGHT = 206;
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
	          <button
	            onClick={e => runAction(e, () => onMarkAllRead(wsPath))}
	            className={cn(menuItemClass(), !inboxUnreadCount && 'pointer-events-none opacity-45')}
	            title={t('inbox.markAllRead')}
	            aria-label={t('inbox.markAllRead')}
	            aria-disabled={!inboxUnreadCount}
	            role="menuitem"
	          >
	            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
	              <path d="M20 6 9 17l-5-5" />
	              <path d="m22 10-9 9-2-2" />
	            </svg>
	            <span className="min-w-0 flex-1 truncate">{t('inbox.markAllRead')}</span>
	            {inboxUnreadCount > 0 && (
	              <span className="rounded-md border border-current/15 bg-panel-alt px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-fg-5">
	                {inboxUnreadCount}
	              </span>
	            )}
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
        <div className="mt-0.5 space-y-[1px] px-2 pb-1">
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
                  className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-[10.5px] text-fg-5 transition-colors hover:bg-panel-h/45 hover:text-fg-3"
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
   Session Card — compact chat index row
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
  const displayState = sessionDisplayState(session);
  const displayText = sessionListDisplayText(session).slice(0, 500) || session.sessionId.slice(0, 16);
  const lastActivityIso = session.runUpdatedAt || session.createdAt || undefined;
  const lastActivityLabel = fmtSidebarSessionTime(lastActivityIso);
  const attentionVariant = sessionAttentionVariant(session);
  const showStateDot = !!attentionVariant;
  const indentPx = forkDepth > 0 ? Math.min(forkDepth, 3) * 14 : 0;
  const baseLeftPx = 14;
  const rowStateClass = isSelected
    ? 'bg-primary/[0.075] text-fg ring-1 ring-inset ring-primary/12 hover:bg-primary/[0.09]'
    : isOpen
      ? 'bg-primary/[0.045] text-fg-2 ring-1 ring-inset ring-primary/8 hover:bg-primary/[0.065]'
      : displayState === 'running'
        ? 'bg-transparent text-fg-3 hover:bg-primary/[0.035]'
        : displayState === 'incomplete'
          ? 'bg-transparent text-fg-3 hover:bg-warn/[0.035]'
          : 'bg-transparent text-fg-3 hover:bg-panel-h/52';

  const kebabRef = useRef<HTMLButtonElement | null>(null);

  return (
	    <div className="relative group/session">
	    <span
	      aria-hidden="true"
	      className={cn(
	        'pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full opacity-0 transition-opacity duration-150',
        isSelected || isOpen
          ? 'bg-primary'
          : displayState === 'running'
            ? 'bg-primary'
	            : displayState === 'incomplete'
	              ? 'bg-warn'
	              : 'bg-primary',
	        (isSelected || isOpen) && 'opacity-100',
	        !isSelected && !isOpen && 'group-hover/session:opacity-60',
	      )}
    />
    <button
      data-session-card
      aria-pressed={isSelected}
      onClick={onClick}
      onMouseEnter={onWarm}
      onFocus={onWarm}
	      onMouseLeave={onCancelWarm}
	      onBlur={onCancelWarm}
	      className={cn(
	        'h-8 w-full overflow-hidden rounded-md border border-transparent py-0 pr-1.5 text-left transition-[background,box-shadow,transform] duration-150',
	        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]',
	        rowStateClass,
	        !isSelected && 'hover:translate-x-0.5',
	      )}
      style={{
        paddingLeft: baseLeftPx + indentPx,
      }}
    >
		      <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_46px] items-center gap-2 overflow-hidden">
	        <span className="flex min-w-0 items-center gap-1.5">
	          {forkDepth > 0 && (
	            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-fg-5/55" aria-label="Fork">
	              <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
	              <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
	            </svg>
	          )}
	          {session.pinned && (
	            <span title={t('session.pinned')} className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-primary/80">
	              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	                <path d="M14 2l8 8-2 2-1.5-1.5-4.7 4.7.2 4.8-1.5 1.5-4.2-4.2L3 22l-1-1 4.2-4.8L2 12l1.5-1.5 4.8.2 4.7-4.7L12 4z" />
	              </svg>
            </span>
	          )}
		          <span
		            className={cn(
		              'min-w-0 flex-1 truncate text-[11.5px] font-medium leading-none',
		              (isSelected || isOpen || showStateDot) && 'font-semibold text-fg',
		            )}
	            title={displayText}
	          >
	            {displayText}
	          </span>
	        </span>
		        <span className="flex shrink-0 items-center justify-end gap-1.5 text-[10px] font-medium leading-none text-fg-5/70 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">
	          <span className="max-w-[40px] truncate text-right tabular-nums" title={lastActivityIso ? new Date(lastActivityIso).toLocaleString() : undefined}>
	            {lastActivityLabel}
          </span>
          {showStateDot ? (
            <SessionAttentionDot kind={attentionVariant} />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 rounded-full border border-edge/55 opacity-0 transition-opacity',
                (isSelected || isOpen) && 'opacity-70',
              )}
            />
          )}
        </span>
      </div>
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
        className="absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-edge/35 bg-panel/95 text-fg-5 opacity-0 shadow-sm transition-opacity group-hover/session:opacity-100 focus-visible:opacity-100 hover:bg-panel-h hover:text-fg-2"
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

const WorkspaceFilesShelfPane = memo(function WorkspaceFilesShelfPane({
  workdir,
  request,
  t,
}: {
  workdir: string;
  request?: FilePanelRequest | null;
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
    setChanges([]);
    try {
      const res = await api.gitChanges(workdir);
      setChanges(res.ok ? res.changes.filter(change => !isPikiclawMetaPath(change.file)) : []);
      setChangesIsGit(res.ok ? res.isGit : false);
    } catch {
      setChanges([]);
      setChangesIsGit(false);
    } finally {
      setChangesLoading(false);
    }
  }, [workdir]);

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
    void loadChanges();
    setPreview(null);
    setPanelMode('changes');
  }, [loadChanges]);

  useEffect(() => {
    if (!request || request.workdir !== workdir) return;
    setPanelMode('files');
    void handlePreviewPath(request.path, 'file', request.line);
  }, [handlePreviewPath, request, workdir]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--th-session-bg)]">
      <div className="shrink-0 border-b border-edge/45 bg-panel/65 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconPicker
            value={openTarget}
            options={(platform === 'darwin' ? ['vscode', 'finder'] : ['vscode']).map(v => ({
              value: v,
              label: t(targetLabelKey(v as OpenTarget)),
            }))}
            onChange={value => { if (isOpenTarget(value)) setOpenTarget(value); }}
            renderIcon={v => <OpenTargetIcon target={v as OpenTarget} size={14} />}
          />
          <Button size="sm" variant="ghost" onClick={() => handleOpenPath(workdir)} className="min-w-0 flex-1 text-[11px]">
            {t('hub.openProject')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void loadChanges()} disabled={changesLoading} className="shrink-0 text-[11px]">
            {changesLoading ? <Spinner className="h-3 w-3" /> : null}
            {t('hub.refresh')}
          </Button>
        </div>
        <div className="mt-2 flex items-center rounded-md border border-edge/30 bg-inset/35 p-0.5">
          {(['changes', 'files'] as FilePanelMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setPanelMode(mode)}
              className={cn(
                'h-7 flex-1 rounded px-2 text-[11px] font-medium transition-colors',
                panelMode === mode ? 'bg-panel-h text-fg shadow-sm' : 'text-fg-5 hover:text-fg-3',
              )}
            >
              {mode === 'changes' ? t('hub.changes') : t('hub.files')}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(150px,0.48fr)_minmax(220px,0.52fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-edge/45 px-1 py-1.5">
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
        <div className="min-h-0 overflow-hidden">
          <CodePreviewPane
            preview={preview}
            onOpenPath={handleOpenPath}
            t={t}
          />
        </div>
      </div>
    </div>
  );
});

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
    setChanges([]);
    try {
      const res = await api.gitChanges(workdir);
      setChanges(res.ok ? res.changes.filter(change => !isPikiclawMetaPath(change.file)) : []);
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
      <div className="flex h-full flex-1 min-w-0 items-center justify-center text-[12px] text-fg-5">
        {t('hub.selectFile')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
