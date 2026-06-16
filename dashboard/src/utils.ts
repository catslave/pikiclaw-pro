import type { Agent } from './types';
import type { SessionInfo } from './types';

/**
 * Which ProviderKinds each agent driver can route BYOK Profiles through.
 * Mirrors the static `acceptedProviderKinds` declarations on the driver
 * classes in src/agent/drivers/*.ts and the runtime-time check in
 * src/model/injector.ts — those are the authority; this constant lets the
 * dashboard pre-filter the "我的模型" group without an extra API round-trip.
 *
 * Gemini is the strict one: the CLI doesn't accept a custom baseURL, so
 * only `google` (Google AI Studio keys) is a valid BYOK target.
 */
export const AGENT_ACCEPTED_PROVIDER_KINDS: Record<Agent, readonly string[]> = {
  claude: ['anthropic', 'openai-compatible'],
  codex: ['openai', 'openai-compatible'],
  copilot: [],
  cursor: [],
  agy: [],
  gemini: ['google'],
  hermes: ['anthropic', 'openai', 'openai-compatible', 'google'],
  openclaw: [],
};

export function fmtBytes(b: number): string {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + 'MB';
  if (b < 1099511627776) return (b / 1073741824).toFixed(1) + 'GB';
  return (b / 1099511627776).toFixed(1) + 'TB';
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h ' + (m % 60) + 'm' : Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

export function fmtTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return '<1m';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  return d + 'd';
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ImeKeyboardEventLike = {
  key: string;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

const IME_COMPOSITION_ENTER_GUARD_MS = 120;

export function isImeCompositionKeyEvent(
  event: ImeKeyboardEventLike,
  isComposing: boolean,
  compositionEndedAt = 0,
): boolean {
  if (
    isComposing
    || event.nativeEvent?.isComposing
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229
  ) {
    return true;
  }
  return event.key === 'Enter'
    && compositionEndedAt > 0
    && Date.now() - compositionEndedAt < IME_COMPOSITION_ENTER_GUARD_MS;
}

export interface AgentMeta {
  label: string;
  /** Shortened label for compact UI (sidebar cards, etc.) */
  shortLabel: string;
  color: string;
  bg: string;
  letter: string;
  glow: string;
  border: string;
  advantageKey: string;
}

const defaultMeta: AgentMeta = {
  label: '?',
  shortLabel: '?',
  color: '#94a3b8',
  bg: 'rgba(148,163,184,0.1)',
  letter: '?',
  glow: 'rgba(148,163,184,0.16)',
  border: 'rgba(148,163,184,0.18)',
  advantageKey: '',
};

export const agentMeta: Record<string, AgentMeta> = {
  claude: {
    label: 'Claude Code',
    shortLabel: 'Claude',
    color: '#b4c6ff',
    bg: 'rgba(180,198,255,0.12)',
    letter: 'C',
    glow: 'rgba(180,198,255,0.2)',
    border: 'rgba(180,198,255,0.2)',
    advantageKey: 'config.agentAdvantageClaude',
  },
  codex: {
    label: 'Codex',
    shortLabel: 'Codex',
    color: '#7dd3fc',
    bg: 'rgba(125,211,252,0.12)',
    letter: 'O',
    glow: 'rgba(125,211,252,0.2)',
    border: 'rgba(125,211,252,0.2)',
    advantageKey: 'config.agentAdvantageCodex',
  },
  copilot: {
    label: 'GitHub Copilot',
    shortLabel: 'Copilot',
    color: '#f0f6fc',
    bg: 'rgba(240,246,252,0.10)',
    letter: 'G',
    glow: 'rgba(240,246,252,0.18)',
    border: 'rgba(240,246,252,0.16)',
    advantageKey: 'config.agentAdvantageCopilot',
  },
  cursor: {
    label: 'Cursor Agent',
    shortLabel: 'Cursor',
    color: '#a7f3d0',
    bg: 'rgba(167,243,208,0.12)',
    letter: 'R',
    glow: 'rgba(167,243,208,0.18)',
    border: 'rgba(167,243,208,0.18)',
    advantageKey: 'config.agentAdvantageCursor',
  },
  agy: {
    label: 'Antigravity',
    shortLabel: 'agy',
    color: '#fda4af',
    bg: 'rgba(253,164,175,0.12)',
    letter: 'A',
    glow: 'rgba(253,164,175,0.2)',
    border: 'rgba(253,164,175,0.2)',
    advantageKey: 'config.agentAdvantageAgy',
  },
  gemini: {
    label: 'Gemini CLI',
    shortLabel: 'Gemini',
    color: '#c4b5fd',
    bg: 'rgba(196,181,253,0.12)',
    letter: 'G',
    glow: 'rgba(196,181,253,0.2)',
    border: 'rgba(196,181,253,0.2)',
    advantageKey: 'config.agentAdvantageGemini',
  },
  hermes: {
    label: 'Hermes',
    shortLabel: 'Hermes',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.12)',
    letter: 'H',
    glow: 'rgba(251,191,36,0.2)',
    border: 'rgba(251,191,36,0.2)',
    advantageKey: 'config.agentAdvantageHermes',
  },
  openclaw: {
    label: 'OpenClaw',
    shortLabel: 'OpenClaw',
    color: '#5eead4',
    bg: 'rgba(94,234,212,0.12)',
    letter: 'OC',
    glow: 'rgba(94,234,212,0.2)',
    border: 'rgba(94,234,212,0.2)',
    advantageKey: 'config.agentAdvantageOpenClaw',
  },
};

export function getAgentMeta(agent: string): AgentMeta {
  return agentMeta[agent] || { ...defaultMeta, label: agent, shortLabel: agent };
}

export const EFFORT_OPTIONS: Record<Agent, string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
  copilot: ['low', 'medium', 'high'],
  cursor: ['low', 'medium', 'high'],
  agy: ['low', 'medium', 'high'],
  gemini: ['low', 'high'],
  // The Hermes driver forwards the chosen value via ACP `session/set_mode`;
  // upstream may or may not act on it depending on the bound model, but we
  // surface the standard knob so users can change it from any picker.
  hermes: ['low', 'medium', 'high', 'xhigh'],
  openclaw: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'],
};

/**
 * Shorten a model ID for compact display.
 *   claude-opus-4-7          → opus-4-7
 *   claude-sonnet-4-6        → sonnet-4-6
 *   claude-haiku-4-5-20251001 → haiku-4-5
 *   gemini-2.5-pro-preview   → 2.5-pro
 *   gpt-4o-mini              → 4o-mini
 *   o3                       → o3
 */
export function shortenModel(model: string): string {
  let s = model;
  // strip trailing date stamps like -20251001
  s = s.replace(/-\d{8,}$/, '');
  // strip trailing -preview / -latest
  s = s.replace(/-(preview|latest|exp)$/, '');
  // strip agent prefixes
  s = s.replace(/^(claude-|gemini-|gpt-)/, '');
  return s;
}

export type SessionDisplayState = 'running' | 'completed' | 'incomplete';
export function sessionDisplayState(session: Pick<SessionInfo, 'running' | 'runState'>): SessionDisplayState {
  if (session.running || session.runState === 'running') return 'running';
  return session.runState === 'incomplete' ? 'incomplete' : 'completed';
}

export interface LiveSessionState {
  key: string;
  resolvedKey: string;
  phase: 'queued' | 'streaming' | 'done';
  sessionId: string | null;
  startedAt: number | null;
  updatedAt: number;
  incomplete: boolean;
  error: string | null;
}

function parseSessionKey(sessionKey: string): { agent: string; sessionId: string } | null {
  const separator = sessionKey.indexOf(':');
  if (separator <= 0) return null;
  const agent = sessionKey.slice(0, separator).trim();
  const sessionId = sessionKey.slice(separator + 1).trim();
  if (!agent || !sessionId) return null;
  return { agent, sessionId };
}

export function normalizeLiveSessionState(sessionKey: string, snapshot: unknown): LiveSessionState | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const rawPhase = typeof (snapshot as any).phase === 'string' ? (snapshot as any).phase.trim() : '';
  if (rawPhase !== 'queued' && rawPhase !== 'streaming' && rawPhase !== 'done') return null;

  const parsedKey = parseSessionKey(sessionKey);
  if (!parsedKey) return null;

  const sessionId = typeof (snapshot as any).sessionId === 'string' && (snapshot as any).sessionId.trim()
    ? (snapshot as any).sessionId.trim()
    : null;
  const updatedAt = typeof (snapshot as any).updatedAt === 'number' && Number.isFinite((snapshot as any).updatedAt)
    ? (snapshot as any).updatedAt
    : Date.now();
  const startedAt = typeof (snapshot as any).startedAt === 'number' && Number.isFinite((snapshot as any).startedAt)
    ? (snapshot as any).startedAt
    : null;
  const error = typeof (snapshot as any).error === 'string' && (snapshot as any).error.trim()
    ? (snapshot as any).error.trim()
    : null;
  const resolvedKey = sessionId ? `${parsedKey.agent}:${sessionId}` : sessionKey;

  return {
    key: sessionKey,
    resolvedKey,
    phase: rawPhase,
    sessionId,
    startedAt,
    updatedAt,
    incomplete: !!(snapshot as any).incomplete || !!error,
    error,
  };
}

export function applyLiveSessionState(session: SessionInfo, liveState?: LiveSessionState | null): SessionInfo {
  if (!liveState) return session;

  const nextRunState: SessionDisplayState = liveState.phase === 'done'
    ? (liveState.incomplete ? 'incomplete' : 'completed')
    : 'running';

  return {
    ...session,
    running: nextRunState === 'running',
    runState: nextRunState,
    runStartedAt: liveState.startedAt ? new Date(liveState.startedAt).toISOString() : session.runStartedAt ?? null,
    runUpdatedAt: new Date(liveState.updatedAt).toISOString(),
    runDetail: nextRunState === 'running'
      ? null
      : (liveState.error || session.runDetail || null),
  };
}

export function sessionDisplayDetail(session: Pick<SessionInfo, 'runDetail'>): string | null {
  const detail = String(session.runDetail || '').trim();
  return detail || null;
}

const SESSION_PREVIEW_IGNORED_USER_PATTERNS = [
  /^\[Request interrupted by user(?: for tool use)?\]$/i,
];

const SESSION_PREVIEW_IMAGE_PLACEHOLDER_RE = /\[Image:[^\]]+\]/gi;
const SESSION_PREVIEW_FILE_PLACEHOLDER_RE = /\[Attached file:[^\]]+\]/gi;
// Claude TUI prepends `@/abs/path/image.png` mentions to the prompt (see
// src/agent/drivers/claude-tui.ts). The backend's `sanitizeSessionUserPreviewText`
// already strips these from `lastQuestion`; the client-side strip is defensive
// for stale cached snapshots that pre-date the backend fix. Keep in lock-step
// with src/agent/utils.ts:CLAUDE_AT_MENTION_IMAGE_RE.
const CLAUDE_AT_MENTION_IMAGE_RE = /(^|\s)@(\/[^\s@\n]+\.(?:png|jpe?g|gif|webp|svg))(?=\s|$)/gi;

function cleanSessionPreviewText(text?: string | null): string {
  return String(text || '')
    .replace(SESSION_PREVIEW_IMAGE_PLACEHOLDER_RE, ' ')
    .replace(SESSION_PREVIEW_FILE_PLACEHOLDER_RE, ' ')
    .replace(CLAUDE_AT_MENTION_IMAGE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMeaningfulLine(text?: string | null): string {
  for (const line of String(text || '').split('\n')) {
    const cleaned = cleanSessionPreviewText(line)
      .replace(/^[#>*\-\s`]+/, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return '';
}

export function sanitizeSessionQuestionPreview(text?: string | null): string {
  const cleaned = cleanSessionPreviewText(text);
  if (!cleaned) return '';
  if (SESSION_PREVIEW_IGNORED_USER_PATTERNS.some(pattern => pattern.test(cleaned))) return '';
  return cleaned;
}

/**
 * MUST stay in lock-step with `src/agent/utils.ts:sessionListDisplayTitle`
 * (the canonical backend implementation). Same priority order, same
 * filtering — dashboard and IM channels show identical titles for a session.
 *
 * Order:
 *   1. `title`        — set ONCE from the original prompt; stable.
 *   2. `lastQuestion` — fallback only (Claude's Task tool can overwrite this
 *                       with sub-agent prompts; never use it as the primary).
 *   3. `sessionId`    — last-resort identifier.
 */
export function sessionListDisplayText(session: Pick<SessionInfo, 'lastQuestion' | 'title' | 'sessionId'>): string {
  return cleanSessionPreviewText(session.title) || sanitizeSessionQuestionPreview(session.lastQuestion) || session.sessionId;
}

export function sessionListContextText(
  session: Pick<SessionInfo, 'title' | 'lastAnswer' | 'classification' | 'runDetail' | 'sessionId'>,
  primary: string,
): string {
  const title = cleanSessionPreviewText(session.title);
  if (title && title !== primary) return title;

  const summary = firstMeaningfulLine(session.classification?.summary);
  if (summary && summary !== primary) return summary;

  const answer = firstMeaningfulLine(session.lastAnswer);
  if (answer && answer !== primary) return answer;

  const detail = cleanSessionPreviewText(session.runDetail);
  if (detail && !/interrupted by user/i.test(detail) && detail !== primary) return detail;

  return '';
}

export type DashboardInboxColumnKey = 'running' | 'review' | 'incomplete' | 'done';
export type SessionWorkspaceMode = 'workspace' | 'chat-workspace' | 'dashboard' | 'settings';

function sessionStatusTimestampMs(session: Pick<SessionInfo, 'runUpdatedAt' | 'createdAt'>): number | null {
  const raw = session.runUpdatedAt || session.createdAt || '';
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isUnreadCompletedSession(session: SessionInfo): boolean {
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

export function dashboardColumnForSession(
  session: SessionInfo,
  live: Pick<LiveSessionState, 'phase'> | null,
  recentCutoff: number,
): DashboardInboxColumnKey | null {
  if (session.userStatus === 'done' || session.userStatus === 'parked') return null;

  const displayState = sessionDisplayState(session);
  const liveActive = live?.phase === 'queued' || live?.phase === 'streaming';
  if (displayState === 'running' || liveActive) return 'running';
  if (displayState === 'incomplete') return 'review';

  const recentlyFinished = (sessionStatusTimestampMs(session) ?? 0) >= recentCutoff;
  if (session.userStatus === 'review') return 'review';
  if (recentlyFinished && isUnreadCompletedSession(session)) return 'review';
  return null;
}

export function shouldIncludeInboxDashboardItem(
  column: DashboardInboxColumnKey,
  opts: { mode: SessionWorkspaceMode; openInWorkspace: boolean },
): boolean {
  if (column !== 'running') return true;
  if (opts.mode === 'dashboard' || opts.mode === 'settings') return true;
  return !opts.openInWorkspace;
}
