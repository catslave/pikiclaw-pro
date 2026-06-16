import { create } from 'zustand';
import { api } from './api';
import { hasPendingChannelValidation } from './channel-status';
import type { AgentStatusResponse, AppState, HostInfo, SessionInfo } from './types';
import type { Locale } from './i18n';

/* ── Toast ── */
export interface Toast {
  id: number;
  message: string;
  ok: boolean;
}

export type Theme = 'dark' | 'light';

export const CHAT_FONT_SCALE_MIN = 0.9;
export const CHAT_FONT_SCALE_MAX = 1.18;
export const CHAT_FONT_SCALE_STEP = 0.04;
export const CHAT_FONT_SCALE_DEFAULT = 1;

const CHAT_FONT_SCALE_KEY = 'pikiclaw-chat-font-scale';

/* ── sessionStorage cache for instant restore on refresh ── */

const CACHE_KEY = 'pikiclaw-store-cache';

interface CachedSlices {
  state: AppState | null;
  host: HostInfo | null;
  agentStatus: AgentStatusResponse | null;
}

function readCache(): CachedSlices {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw) as CachedSlices;
  } catch {}
  return { state: null, host: null, agentStatus: null };
}

function writeCache(slices: Partial<CachedSlices>) {
  try {
    const prev = readCache();
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...prev, ...slices }));
  } catch {}
}

/* ── Helpers ── */
let _toastId = 0;
let _lastReloadStateWarningAt = 0;

function warnReloadStateFailure(error: unknown) {
  const now = Date.now();
  if (now - _lastReloadStateWarningAt < 60_000) return;
  _lastReloadStateWarningAt = now;
  console.warn('loadState:', error);
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('pikiclaw-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'light';
}

function getInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem('pikiclaw-locale');
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch {}
  return 'zh-CN';
}

export function normalizeChatFontScale(value: number): number {
  if (!Number.isFinite(value)) return CHAT_FONT_SCALE_DEFAULT;
  const clamped = Math.min(CHAT_FONT_SCALE_MAX, Math.max(CHAT_FONT_SCALE_MIN, value));
  return Number(clamped.toFixed(2));
}

function getInitialChatFontScale(): number {
  try {
    const stored = localStorage.getItem(CHAT_FONT_SCALE_KEY);
    if (stored) return normalizeChatFontScale(Number(stored));
  } catch {}
  return CHAT_FONT_SCALE_DEFAULT;
}

function applyChatFontScale(scale: number) {
  document.documentElement.style.setProperty('--pk-chat-font-scale', String(normalizeChatFontScale(scale)));
}

/* ── Store shape ── */
interface StoreState {
  /* ── Data slices ── */
  state: AppState | null;
  host: HostInfo | null;
  agentStatus: AgentStatusResponse | null;
  toasts: Toast[];
  allSessions: Record<string, { sessions: SessionInfo[] }>;
  theme: Theme;
  locale: Locale;
  chatFontScale: number;

  /* ── Actions ── */
  toast: (msg: string, ok?: boolean) => void;
  setTheme: (t: Theme) => void;
  setLocale: (l: Locale) => void;
  setChatFontScale: (scale: number) => void;
  reload: () => Promise<AppState | null>;
  refreshAgentStatus: () => Promise<AgentStatusResponse | null>;
  setAgentStatus: (status: AgentStatusResponse) => void;
  reloadUntil: (
    predicate: (state: AppState) => boolean,
    opts?: { attempts?: number; intervalMs?: number },
  ) => Promise<AppState | null>;
  loadSessions: () => Promise<void>;
}

/* ── Apply theme to DOM once at module load ── */
const initialTheme = getInitialTheme();
const initialChatFontScale = getInitialChatFontScale();
document.documentElement.dataset.theme = initialTheme;
applyChatFontScale(initialChatFontScale);

/* ══════════════════════════════════════════════════════
   Zustand Store — selector-based, no Provider needed.
   Components subscribe only to the slices they read:
     const locale = useStore(s => s.locale);
   Actions are stable refs and never cause re-renders.
   ══════════════════════════════════════════════════════ */
const _cached = readCache();

export const useStore = create<StoreState>()((set, get) => ({
  /* ── Initial data (hydrated from sessionStorage) ── */
  state: _cached.state,
  host: _cached.host,
  agentStatus: _cached.agentStatus,
  toasts: [],
  allSessions: {},
  theme: initialTheme,
  locale: getInitialLocale(),
  chatFontScale: initialChatFontScale,

  /* ── Toast ── */
  toast: (message, ok = true) => {
    const id = ++_toastId;
    set((prev) => ({ toasts: [...prev.toasts, { id, message, ok }] }));
    setTimeout(() => {
      set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },

  /* ── Theme ── */
  setTheme: (t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('pikiclaw-theme', t); } catch {}
    set({ theme: t });
  },

  /* ── Locale ── */
  setLocale: (l) => {
    try { localStorage.setItem('pikiclaw-locale', l); } catch {}
    set({ locale: l });
  },

  /* ── Chat readability ── */
  setChatFontScale: (scale) => {
    const next = normalizeChatFontScale(scale);
    applyChatFontScale(next);
    try { localStorage.setItem(CHAT_FONT_SCALE_KEY, String(next)); } catch {}
    set({ chatFontScale: next });
  },

  /* ── Reload app state + host + agent status ── */
  reload: async () => {
    const commitSlice = (slice: Partial<CachedSlices>) => {
      set(slice);
      writeCache(slice);
    };

    const hostPromise = api.getHost()
      .then((host) => { if (host) commitSlice({ host }); })
      .catch(() => null);

    let latestState: AppState | null = null;
    try {
      latestState = await api.getState({ timeoutMs: 30_000 });
      if (latestState) commitSlice({ state: latestState });
    } catch (e) {
      warnReloadStateFailure(e);
    }

    void hostPromise;
    return latestState;
  },

  refreshAgentStatus: async () => {
    try {
      const agents = await api.getAgentStatus();
      set({ agentStatus: agents });
      writeCache({ agentStatus: agents });
      return agents;
    } catch { return null; }
  },

  setAgentStatus: (status) => {
    set({ agentStatus: status });
    writeCache({ agentStatus: status });
  },

  /* ── Reload with polling until predicate ── */
  reloadUntil: async (predicate, opts) => {
    const attempts = opts?.attempts ?? 8;
    const intervalMs = opts?.intervalMs ?? 250;
    let latest: AppState | null = null;
    for (let i = 0; i < attempts; i++) {
      latest = await get().reload();
      if (latest && predicate(latest)) return latest;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return latest;
  },

  /* ── Load sessions (legacy, for non-hub tabs) ── */
  loadSessions: async () => {
    try {
      const [s, h, ses] = await Promise.all([
        api.getState({ timeoutMs: 30_000 }),
        api.getHost(),
        api.getSessions(),
      ]);
      set({
        state: s,
        host: h,
        allSessions: ses as Record<string, { sessions: SessionInfo[] }>,
      });
      writeCache({ state: s, host: h });
    } catch (e) {
      console.warn('loadSessions:', e);
    }
  },
}));

/* ── Kick off initial load after the first route can request its own chunk. ── */
const startInitialReload = () => { void useStore.getState().reload(); };
if (typeof window !== 'undefined') window.setTimeout(startInitialReload, 1200);
else startInitialReload();

/* ══════════════════════════════════════════════════════
   Channel validation polling — runs as a store subscription.
   Fires when channels have pending validation.
   Updates only the `state` slice.
   ══════════════════════════════════════════════════════ */
let _channelPollTimer: ReturnType<typeof setTimeout> | null = null;

useStore.subscribe((cur, prev) => {
  // Only react to state changes (channel validation results)
  if (cur.state === prev.state) return;

  // Clear any pending timer
  if (_channelPollTimer) { clearTimeout(_channelPollTimer); _channelPollTimer = null; }

  // Skip if no channels need validation
  if (!hasPendingChannelValidation(cur.state?.setupState?.channels || null)) return;

  _channelPollTimer = setTimeout(() => {
    _channelPollTimer = null;
    void useStore.getState().reload();
  }, 1500);
});
