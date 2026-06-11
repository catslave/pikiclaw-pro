import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StreamSnapshot } from '../../api';
import { useStore } from '../../store';
import type { AgentAssistant, AgentRuntimeStatus, AssistantHistoryItem, SessionMessage } from '../../types';
import { cn } from '../../utils';
import { Spinner } from '../ui';

const QUICK_ASSISTANT_IDS_KEY = 'pikiclaw:quick-assistants:v1';
const QUICK_ASSISTANT_RUNS_KEY = 'pikiclaw:quick-assistant-runs:v1';
const OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:open-sessions:v1';
const ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:active-slot:v1';
const OPEN_SESSION_REQUEST_EVENT = 'pikiclaw:session-workspace:open-session-request';
const MARK_SESSION_READ_EVENT = 'pikiclaw:session-workspace:mark-session-read';
const LOCAL_READ_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:local-read-sessions:v1';
const DEFAULT_QUICK_ASSISTANT_IDS = ['assistant_mr_review', 'assistant_log_analysis', 'assistant_bug_analysis'];
const QUICK_ASSISTANT_LIMIT = 5;
const PANEL_HEIGHT = 520;
const PANEL_MARGIN = 12;
const ASSISTANT_INPUT_CLOSE_DELAY_MS = 800;

type QuickRunStatus = 'queued' | 'running' | 'completed' | 'failed';

interface QuickAssistantRun {
  id: string;
  assistantId: string;
  assistantName: string;
  workdir: string;
  agent: string;
  sessionId: string;
  sessionKey: string;
  taskId?: string;
  prompt: string;
  title?: string | null;
  status: QuickRunStatus;
  outputPreview?: string | null;
  activityPreview?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  seenAt?: string | null;
  viewedAt?: string | null;
}

interface QuickAssistantDetailTarget {
  key: string;
  assistantId: string;
  assistantName: string;
  workdir: string;
  agent: string;
  sessionId: string;
  title: string;
  subtitle?: string | null;
  runId?: string | null;
}

interface QuickAssistantDetailState {
  loading: boolean;
  messages: SessionMessage[];
  error?: string | null;
}

type SessionSlot = {
  workdir: string;
  agent: string;
  sessionId: string;
  mountKey: string;
  archiveOnly?: boolean;
  assistantId?: string;
  assistantName?: string;
};

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

function readStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function readRuns(): QuickAssistantRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUICK_ASSISTANT_RUNS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item?.assistantId && item?.workdir && item?.agent && item?.sessionId)
      .slice(0, 80);
  } catch {
    return [];
  }
}

function writeRuns(value: QuickAssistantRun[]) {
  try { localStorage.setItem(QUICK_ASSISTANT_RUNS_KEY, JSON.stringify(value.slice(0, 80))); } catch {}
}

function readLocalReadSessionMarkers(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_READ_SESSIONS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function markLocalSessionRead(agent: string, sessionId: string, readAt = Date.now()) {
  if (!agent || !sessionId) return;
  try {
    localStorage.setItem(LOCAL_READ_SESSIONS_STORAGE_KEY, JSON.stringify({
      ...readLocalReadSessionMarkers(),
      [`${agent}:${sessionId}`]: readAt,
    }));
  } catch {}
}

function parseSessionKey(value: string | null | undefined): { agent: string; sessionId: string } | null {
  if (!value) return null;
  const index = value.indexOf(':');
  if (index <= 0 || index >= value.length - 1) return null;
  return { agent: value.slice(0, index), sessionId: value.slice(index + 1) };
}

function mountKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openSessionsFromStorage(): SessionSlot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_SESSIONS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed
        .filter(item => item?.workdir && item?.agent && item?.sessionId)
        .map(item => ({
          workdir: String(item.workdir),
          agent: String(item.agent),
          sessionId: String(item.sessionId),
          mountKey: typeof item.mountKey === 'string' && item.mountKey ? item.mountKey : mountKey(),
          archiveOnly: item.archiveOnly === true,
          assistantId: typeof item.assistantId === 'string' && item.assistantId ? item.assistantId : undefined,
          assistantName: typeof item.assistantName === 'string' && item.assistantName ? item.assistantName : undefined,
        }))
      : [];
  } catch {
    return [];
  }
}

function installedAgentNames(agents: AgentRuntimeStatus[]): string[] {
  const installed = agents.filter(agent => agent.installed).map(agent => agent.agent);
  return installed.length ? installed : agents.map(agent => agent.agent);
}

function preferredAgent(assistant: AgentAssistant, options: string[], fallback: string): string {
  return (assistant.preferredAgents || []).find(agent => options.includes(agent)) || fallback || options[0] || 'codex';
}

function assistantInitials(name: string): string {
  const words = name.replace(/\bAssistant\b/gi, '').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(word => word[0]?.toUpperCase()).join('');
  return initials || 'A';
}

function fmtRunTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function statusText(status: QuickRunStatus, locale: string): string {
  if (status === 'queued') return L(locale, '排队中', 'Queued');
  if (status === 'running') return L(locale, '运行中', 'Running');
  if (status === 'failed') return L(locale, '需要查看', 'Needs review');
  return L(locale, '已完成', 'Done');
}

function runViewed(run: QuickAssistantRun | null | undefined): boolean {
  return !!run?.viewedAt;
}

function runListStatusText(run: QuickAssistantRun, locale: string): string {
  return runViewed(run) ? L(locale, '已查看', 'Viewed') : statusText(run.status, locale);
}

function runListDotClass(run: QuickAssistantRun): string {
  if (run.status === 'queued' || run.status === 'running') return 'bg-primary animate-pulse';
  if (runViewed(run)) return 'bg-fg-6';
  return run.status === 'failed' ? 'bg-err' : 'bg-ok';
}

function detailStatusText(run: QuickAssistantRun | null | undefined, stream: StreamSnapshot | null, locale: string): string {
  if (stream?.phase === 'queued') {
    return stream.queuePosition
      ? L(locale, `排队中 · 前面还有 ${stream.queuePosition} 个`, `Queued · ${stream.queuePosition} ahead`)
      : L(locale, '排队中', 'Queued');
  }
  if (stream?.phase === 'streaming') return L(locale, '运行中', 'Running');
  if (stream?.phase === 'done') return runViewed(run) ? L(locale, '已查看', 'Viewed') : stream.error ? L(locale, '需要查看', 'Needs review') : L(locale, '已完成', 'Done');
  return run ? statusText(run.status, locale) : L(locale, '历史记录', 'History');
}

function detailDotClass(run: QuickAssistantRun | null | undefined, stream: StreamSnapshot | null): string {
  if (stream?.phase === 'streaming' || stream?.phase === 'queued') return 'bg-primary animate-pulse';
  if (runViewed(run)) return 'bg-fg-6';
  if (stream?.error || run?.status === 'failed') return 'bg-err';
  if (stream?.phase === 'done' || run?.status === 'completed') return 'bg-ok';
  return 'bg-fg-6';
}

function compactText(value: string | null | undefined, max = 1800): string {
  const text = (value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

function streamOutputPreview(snapshot: StreamSnapshot | null | undefined): string {
  const text = compactText(snapshot?.text || '', 260);
  if (text) return text;
  const thinking = compactText(snapshot?.thinking || '', 260);
  if (thinking) return thinking;
  return compactText(snapshot?.activitySummary?.current?.label || snapshot?.activity || '', 180);
}

function urlFromText(value: string): URL | null {
  const match = value.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  try {
    return new URL(match[0].replace(/[.,;，。；]+$/, ''));
  } catch {
    return null;
  }
}

function reviewUrlFromText(value: string | null | undefined): string {
  const url = urlFromText(value || '');
  if (!url) return '';
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.includes('merge_requests') || segments.includes('pull') ? url.toString() : '';
}

function titleFromReviewUrl(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const mergeIndex = segments.findIndex(item => item === 'merge_requests');
  if (mergeIndex > 0 && segments[mergeIndex + 1]) {
    const repoIndex = segments[mergeIndex - 1] === '-' ? mergeIndex - 2 : mergeIndex - 1;
    const repo = segments[repoIndex] || url.hostname.replace(/^www\./, '');
    return `${repo} !${segments[mergeIndex + 1]}`;
  }
  const pullIndex = segments.findIndex(item => item === 'pull');
  if (pullIndex > 0 && segments[pullIndex + 1]) {
    const repo = segments[pullIndex - 1];
    return `${repo} #${segments[pullIndex + 1]}`;
  }
  return null;
}

function readableRunTitle(value: string | null | undefined): string {
  const text = compactText(value || '', 160);
  if (!text) return 'Assistant run';
  const url = urlFromText(text);
  if (url) {
    const reviewTitle = titleFromReviewUrl(url);
    if (reviewTitle) return reviewTitle;
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
  }
  return text;
}

function quickRunTitle(run: QuickAssistantRun, overrides: Record<string, string>): string {
  return overrides[`run:${run.id}`] || run.title || readableRunTitle(run.prompt);
}

function historyTitle(assistant: AgentAssistant, item: AssistantHistoryItem, overrides: Record<string, string>): string {
  const key = `history:${item.workdir}:${item.agent}:${item.sessionId}`;
  return overrides[key] || readableRunTitle(item.title || item.lastQuestion || item.sourceLabel || assistant.name);
}

function assistantPlaceholder(assistant: AgentAssistant, locale: string): string {
  const id = assistant.id.toLowerCase();
  const name = assistant.name.toLowerCase();
  if (id.includes('mr') || name.includes('mr') || name.includes('review')) return L(locale, '粘贴 MR link 或 diff 线索', 'Paste an MR link or diff clue');
  if (id.includes('log') || name.includes('log')) return L(locale, '输入 trace / session / log id', 'Enter trace, session, or log id');
  if (id.includes('bug') || name.includes('bug')) return L(locale, '输入 bug ticket 或现象描述', 'Enter a bug ticket or symptom');
  return L(locale, '输入要交给它处理的内容', 'Type what this assistant should handle');
}

function floatingPanelHeight(): number {
  return Math.max(360, Math.min(PANEL_HEIGHT, window.innerHeight - PANEL_MARGIN * 2));
}

function floatingPanelTop(anchorTop: number): number {
  const height = floatingPanelHeight();
  return Math.max(PANEL_MARGIN, Math.min(window.innerHeight - height - PANEL_MARGIN, anchorTop - PANEL_MARGIN));
}

function AssistantGlyph({ assistant }: { assistant: AgentAssistant }) {
  const id = assistant.id.toLowerCase();
  const name = assistant.name.toLowerCase();
  if (id.includes('mr') || name.includes('review')) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 7h10" />
        <path d="M7 12h6" />
        <path d="m14 18 2 2 4-5" />
        <path d="M5 4h14a2 2 0 0 1 2 2v8.5" />
        <path d="M5 20h6" />
        <path d="M3 6v12a2 2 0 0 0 2 2" />
      </svg>
    );
  }
  if (id.includes('log') || name.includes('log')) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
        <path d="M17 11v7" />
        <path d="m14 15 3 3 3-3" />
      </svg>
    );
  }
  if (id.includes('bug') || name.includes('bug')) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v4" />
        <path d="M8 7h8" />
        <path d="M8 11h8" />
        <path d="M9 20h6" />
        <path d="M6 13H3" />
        <path d="M21 13h-3" />
        <path d="m5 7-2-2" />
        <path d="m19 7 2-2" />
        <rect x="6" y="7" width="12" height="13" rx="6" />
      </svg>
    );
  }
  return <span className="text-[10px] font-bold leading-none tracking-normal">{assistantInitials(assistant.name)}</span>;
}

export function FrequentAssistantDock({ className }: { className?: string }) {
  const navigate = useNavigate();
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const runtimeWorkdir = state?.bot?.workdir || state?.runtimeWorkdir || state?.config?.workdir || agentStatus?.workdir || '';
  const fallbackAgent = state?.bot?.defaultAgent || state?.config?.defaultAgent || agentStatus?.defaultAgent || 'codex';
  const agentOptions = useMemo(() => installedAgentNames(agentStatus?.agents || []), [agentStatus?.agents]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [history, setHistory] = useState<Record<string, AssistantHistoryItem[]>>({});
  const [quickIds, setQuickIds] = useState<string[]>(() => readStringArray(QUICK_ASSISTANT_IDS_KEY));
  const [runs, setRuns] = useState<QuickAssistantRun[]>(() => readRuns());
  const [hoverAssistantId, setHoverAssistantId] = useState<string | null>(null);
  const [panelAssistantId, setPanelAssistantId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(220);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<QuickAssistantDetailTarget | null>(null);
  const [detailState, setDetailState] = useState<QuickAssistantDetailState>({ loading: false, messages: [] });
  const [detailOptimisticMessages, setDetailOptimisticMessages] = useState<SessionMessage[]>([]);
  const [detailStream, setDetailStream] = useState<StreamSnapshot | null>(null);
  const [detailDraft, setDetailDraft] = useState('');
  const [detailSending, setDetailSending] = useState(false);
  const [reviewTitleOverrides, setReviewTitleOverrides] = useState<Record<string, string>>({});
  const hoverCloseTimerRef = useRef<number | null>(null);
  const composingAssistantIdRef = useRef<string | null>(null);
  const detailComposingRef = useRef(false);

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current === null) return;
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }, []);

  const showAssistantInput = useCallback((assistantId: string) => {
    clearHoverCloseTimer();
    if (panelAssistantId || pickerOpen) return;
    setHoverAssistantId(assistantId);
  }, [clearHoverCloseTimer, panelAssistantId, pickerOpen]);

  const hideAssistantInput = useCallback(() => {
    clearHoverCloseTimer();
    setHoverAssistantId(null);
  }, [clearHoverCloseTimer]);

  const scheduleAssistantInputClose = useCallback((assistantId: string) => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        const inputHost = activeElement.closest('[data-quick-assistant-input]');
        if (inputHost?.getAttribute('data-quick-assistant-input') === assistantId) {
          hoverCloseTimerRef.current = null;
          return;
        }
      }
      setHoverAssistantId(current => current === assistantId ? null : current);
      hoverCloseTimerRef.current = null;
    }, ASSISTANT_INPUT_CLOSE_DELAY_MS);
  }, [clearHoverCloseTimer]);

  useEffect(() => () => clearHoverCloseTimer(), [clearHoverCloseTimer]);

  const loadAssistants = useCallback(() => {
    void Promise.all([
      api.getProAssistants(),
      api.getProAssistantHistory(8).catch(() => null),
    ]).then(([assistantResult, historyResult]) => {
      if (assistantResult.ok) setAssistants((assistantResult.assistants || []).filter(item => item.enabled !== false));
      if (historyResult?.ok) setHistory(historyResult.history || {});
    }).catch(error => {
      toast(error instanceof Error ? error.message : 'Failed to load assistants', false);
    });
  }, [toast]);

  useEffect(() => { loadAssistants(); }, [loadAssistants]);

  useEffect(() => {
    writeStringArray(QUICK_ASSISTANT_IDS_KEY, quickIds);
  }, [quickIds]);

  useEffect(() => {
    writeRuns(runs);
  }, [runs]);

  const assistantById = useMemo(() => new Map(assistants.map(assistant => [assistant.id, assistant])), [assistants]);
  const resolvedQuickIds = quickIds.length ? quickIds : DEFAULT_QUICK_ASSISTANT_IDS;
  const quickAssistants = useMemo(() => {
    const picked = resolvedQuickIds.map(id => assistantById.get(id)).filter((item): item is AgentAssistant => !!item);
    if (picked.length) return picked.slice(0, QUICK_ASSISTANT_LIMIT);
    return assistants
      .filter(assistant => assistant.labels?.includes('quick-assistant') || assistant.kind !== 'page-owner')
      .slice(0, 3);
  }, [assistantById, assistants, resolvedQuickIds]);

  const runsByAssistant = useMemo(() => {
    const map = new Map<string, QuickAssistantRun[]>();
    for (const run of runs) {
      const list = map.get(run.assistantId) || [];
      list.push(run);
      map.set(run.assistantId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
    }
    return map;
  }, [runs]);

  const markAssistantSessionViewed = useCallback((session: { workdir: string; agent: string; sessionId: string }, runId?: string | null) => {
    if (!session.workdir || !session.agent || !session.sessionId) return;
    const readAt = Date.now();
    const viewedAt = new Date(readAt).toISOString();
    markLocalSessionRead(session.agent, session.sessionId, readAt);
    window.dispatchEvent(new CustomEvent(MARK_SESSION_READ_EVENT, {
      detail: { workdir: session.workdir, agent: session.agent, sessionId: session.sessionId, readAt },
    }));
    setRuns(prev => prev.map(run => {
      const matchesRun = runId
        ? run.id === runId
        : run.workdir === session.workdir && run.agent === session.agent && run.sessionId === session.sessionId;
      return matchesRun && (run.status === 'completed' || run.status === 'failed') && !run.seenAt
        ? { ...run, seenAt: viewedAt, viewedAt }
        : matchesRun && (run.status === 'completed' || run.status === 'failed') && !run.viewedAt
          ? { ...run, viewedAt }
          : run;
    }));
    void api.updateSessionStatus(session.workdir, session.agent, session.sessionId, 'done').catch(() => {});
  }, []);

  const openSession = useCallback((session: { workdir: string; agent: string; sessionId: string; assistantId?: string; assistantName?: string }, opts: { markRead?: boolean; runId?: string | null } = {}) => {
    if (!session.workdir || !session.agent || !session.sessionId) return;
    if (opts.markRead) markAssistantSessionViewed(session, opts.runId);
    const existing = openSessionsFromStorage();
    const exactIndex = existing.findIndex(slot => slot.workdir === session.workdir && slot.agent === session.agent && slot.sessionId === session.sessionId);
    const next = exactIndex >= 0
      ? existing.map((slot, index) => index === exactIndex ? {
        ...slot,
        archiveOnly: false,
        assistantId: session.assistantId || slot.assistantId,
        assistantName: session.assistantName || slot.assistantName,
      } : slot)
      : [{
        workdir: session.workdir,
        agent: session.agent,
        sessionId: session.sessionId,
        mountKey: mountKey(),
        assistantId: session.assistantId,
        assistantName: session.assistantName,
      }, ...existing];
    try {
      localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(exactIndex >= 0 ? exactIndex : 0));
    } catch {}
    window.dispatchEvent(new CustomEvent(OPEN_SESSION_REQUEST_EVENT, {
      detail: {
        workdir: session.workdir,
        agent: session.agent,
        sessionId: session.sessionId,
        archiveOnly: false,
        assistantId: session.assistantId,
        assistantName: session.assistantName,
      },
    }));
    setPanelAssistantId(null);
    setPickerOpen(false);
    setDetailTarget(null);
    navigate('/chat', {
      state: {
        openSessionWorkdir: session.workdir,
        openSessionAgent: session.agent,
        openSessionId: session.sessionId,
        openSessionNonce: Date.now(),
      },
    });
  }, [markAssistantSessionViewed, navigate]);

  const markNoticeSeen = useCallback((assistantId: string, runId?: string | null) => {
    const now = new Date().toISOString();
    setRuns(prev => prev.map(run => {
      const matchesRun = runId ? run.id === runId : run.assistantId === assistantId;
      const hasNotice = run.status === 'completed' || run.status === 'failed';
      return matchesRun && hasNotice && !run.seenAt ? { ...run, seenAt: now } : run;
    }));
  }, []);

  const openAssistantPanel = useCallback((assistantId: string, event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    hideAssistantInput();
    setDetailTarget(null);
    setPanelTop(floatingPanelTop(rect.top));
    setPickerOpen(false);
    setPanelAssistantId(prev => prev === assistantId ? null : assistantId);
    markNoticeSeen(assistantId);
  }, [hideAssistantInput, markNoticeSeen]);

  const openPicker = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    hideAssistantInput();
    setDetailTarget(null);
    setPanelTop(floatingPanelTop(rect.top));
    setPanelAssistantId(null);
    setPickerOpen(prev => !prev);
  }, [hideAssistantInput]);

  const openRunDetail = useCallback((run: QuickAssistantRun) => {
    markNoticeSeen(run.assistantId, run.id);
    if (run.status === 'completed' || run.status === 'failed') {
      markAssistantSessionViewed(run, run.id);
    }
    setDetailDraft('');
    setDetailOptimisticMessages([]);
    setDetailState({ loading: true, messages: [] });
    setDetailStream(null);
    setDetailTarget({
      key: `run:${run.id}`,
      assistantId: run.assistantId,
      assistantName: run.assistantName,
      workdir: run.workdir,
      agent: run.agent,
      sessionId: run.sessionId,
      title: quickRunTitle(run, reviewTitleOverrides),
      subtitle: `${statusText(run.status, locale)} · ${run.agent}`,
      runId: run.id,
    });
  }, [locale, markAssistantSessionViewed, markNoticeSeen, reviewTitleOverrides]);

  const openHistoryDetail = useCallback((assistant: AgentAssistant, item: AssistantHistoryItem) => {
    setDetailDraft('');
    setDetailOptimisticMessages([]);
    setDetailState({ loading: true, messages: [] });
    setDetailStream(null);
    setDetailTarget({
      key: `history:${item.workdir}:${item.agent}:${item.sessionId}`,
      assistantId: assistant.id,
      assistantName: assistant.name,
      workdir: item.workdir,
      agent: item.agent,
      sessionId: item.sessionId,
      title: historyTitle(assistant, item, reviewTitleOverrides),
      subtitle: `${item.sourceLabel || item.source} · ${item.agent}`,
      runId: null,
    });
  }, [reviewTitleOverrides]);

  const runAssistant = useCallback(async (assistant: AgentAssistant) => {
    const prompt = (drafts[assistant.id] || '').trim();
    if (!prompt || sendingId || !runtimeWorkdir) return;
    const agent = preferredAgent(assistant, agentOptions, fallbackAgent);
    setSendingId(assistant.id);
    try {
      const result = await api.runProAssistant(assistant.id, { prompt, workdir: runtimeWorkdir, agent }, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to start assistant');
      const parsed = result.session || parseSessionKey(result.queued?.sessionKey || '');
      if (!parsed) throw new Error('Assistant session was not created');
      const now = new Date().toISOString();
      const sessionKey = `${parsed.agent}:${parsed.sessionId}`;
      const run: QuickAssistantRun = {
        id: result.queued?.taskId || `${assistant.id}-${Date.now().toString(36)}`,
        assistantId: assistant.id,
        assistantName: assistant.name,
        workdir: result.session?.workdir || runtimeWorkdir,
        agent: parsed.agent,
        sessionId: parsed.sessionId,
        sessionKey,
        taskId: result.queued?.taskId,
        prompt,
        title: readableRunTitle(prompt),
        status: 'queued',
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        seenAt: null,
      };
      setRuns(prev => [run, ...prev.filter(item => item.id !== run.id)].slice(0, 80));
      setDrafts(prev => ({ ...prev, [assistant.id]: '' }));
      toast(L(locale, 'Assistant 已开始工作', 'Assistant started'), true);
      void api.getProAssistantHistory(8).then(res => { if (res.ok) setHistory(res.history || {}); }).catch(() => {});
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to start assistant', false);
    } finally {
      setSendingId(null);
    }
  }, [agentOptions, drafts, fallbackAgent, locale, runtimeWorkdir, sendingId, toast]);

  useEffect(() => {
    const active = runs.filter(run => run.status === 'queued' || run.status === 'running');
    if (!active.length) return undefined;
    let cancelled = false;
    const tick = async () => {
      const updates: QuickAssistantRun[] = [];
      for (const run of active) {
        try {
          const res = await api.getSessionStreamState(run.agent, run.sessionId, { timeoutMs: 5_000 });
          const snapshot = res.state as (StreamSnapshot & { incomplete?: boolean }) | null;
          if (!snapshot?.phase) continue;
          const nextSessionId = typeof snapshot.sessionId === 'string' && snapshot.sessionId.trim() ? snapshot.sessionId.trim() : run.sessionId;
          const incomplete = !!snapshot.incomplete || !!snapshot.error;
          const outputPreview = streamOutputPreview(snapshot);
          const activityPreview = compactText(snapshot.activitySummary?.current?.label || snapshot.activity || '', 180);
          updates.push({
            ...run,
            sessionId: nextSessionId,
            sessionKey: `${run.agent}:${nextSessionId}`,
            status: snapshot.phase === 'done' ? (incomplete ? 'failed' : 'completed') : snapshot.phase === 'streaming' ? 'running' : 'queued',
            outputPreview: outputPreview || run.outputPreview || null,
            activityPreview: activityPreview || run.activityPreview || null,
            error: typeof snapshot.error === 'string' ? snapshot.error : run.error,
            updatedAt: new Date().toISOString(),
            completedAt: snapshot.phase === 'done' ? new Date().toISOString() : run.completedAt,
          });
        } catch {
          // Keep the last known status; the normal session panel can still open it.
        }
      }
      if (cancelled || !updates.length) return;
      setRuns(prev => prev.map(run => updates.find(update => update.id === run.id) || run));
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runs]);

  useEffect(() => {
    if (!detailTarget) {
      setDetailState({ loading: false, messages: [] });
      setDetailOptimisticMessages([]);
      setDetailStream(null);
      return undefined;
    }

    let cancelled = false;
    const refreshDetail = async () => {
      setDetailState(current => ({ ...current, loading: true, error: null }));
      const [messagesResult, streamResult] = await Promise.allSettled([
        api.getSessionMessages(detailTarget.workdir, detailTarget.agent, detailTarget.sessionId, { lastNTurns: 6, rich: false }, { timeoutMs: 6_000 }),
        api.getSessionStreamState(detailTarget.agent, detailTarget.sessionId, { timeoutMs: 5_000 }),
      ]);
      if (cancelled) return;
      if (streamResult.status === 'fulfilled' && streamResult.value.ok) {
        setDetailStream(streamResult.value.state || null);
      }
      if (messagesResult.status === 'fulfilled') {
        const result = messagesResult.value;
        setDetailState({
          loading: false,
          messages: result.ok ? (result.messages || []) : [],
          error: result.ok ? null : result.error || 'Failed to load messages',
        });
      } else {
        setDetailState(current => ({
          loading: false,
          messages: current.messages,
          error: messagesResult.reason instanceof Error ? messagesResult.reason.message : 'Failed to load messages',
        }));
      }
    };

    void refreshDetail();
    const timer = window.setInterval(() => { void refreshDetail(); }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detailTarget]);

  const toggleQuickAssistant = useCallback((assistantId: string) => {
    setQuickIds(prev => {
      if (prev.includes(assistantId)) return prev.filter(id => id !== assistantId);
      return [assistantId, ...prev].slice(0, QUICK_ASSISTANT_LIMIT);
    });
  }, []);

  const panelAssistant = panelAssistantId ? assistantById.get(panelAssistantId) || null : null;
  const panelRuns = panelAssistant ? (runsByAssistant.get(panelAssistant.id) || []) : [];
  const panelHistory = panelAssistant ? (history[panelAssistant.id] || []) : [];
  const localSessionKeys = new Set(panelRuns.map(run => `${run.workdir}:${run.agent}:${run.sessionId}`));
  const filteredHistory = panelHistory.filter(item => !localSessionKeys.has(`${item.workdir}:${item.agent}:${item.sessionId}`));
  const detailRun = detailTarget?.runId ? runs.find(run => run.id === detailTarget.runId) || null : null;
  const detailSession = detailTarget ? {
    workdir: detailRun?.workdir || detailTarget.workdir,
    agent: detailRun?.agent || detailTarget.agent,
    sessionId: detailStream?.sessionId || detailRun?.sessionId || detailTarget.sessionId,
    assistantId: detailRun?.assistantId || detailTarget.assistantId,
    assistantName: detailRun?.assistantName || detailTarget.assistantName,
  } : null;
	  const detailStatusMeta = useMemo(() => {
	    if (!detailTarget) return '';
	    if (!detailRun) return detailTarget.subtitle || '';
	    const label = runViewed(detailRun) ? L(locale, '已查看', 'Viewed') : statusText(detailRun.status, locale);
	    return `${label} · ${detailRun.agent}`;
	  }, [detailRun, detailTarget, locale]);
  const detailMessages = useMemo(() => {
    if (!detailOptimisticMessages.length) return detailState.messages;
    const merged = [...detailState.messages];
    for (const message of detailOptimisticMessages) {
      if (!merged.some(existing => existing.role === message.role && existing.text === message.text)) {
        merged.push(message);
      }
    }
    return merged;
  }, [detailOptimisticMessages, detailState.messages]);
  const detailLatestAssistantText = useMemo(() => {
    for (let index = detailMessages.length - 1; index >= 0; index -= 1) {
      const message = detailMessages[index];
      if (message.role === 'assistant' && message.text.trim()) return message.text;
    }
    return '';
  }, [detailMessages]);
  const detailLiveText = compactText(detailStream?.text || detailStream?.thinking || '');
  const detailOutputText = compactText(detailLiveText || detailLatestAssistantText);
  const detailCanSend = !!detailSession?.workdir && !!detailSession?.agent && !!detailSession?.sessionId && !!detailDraft.trim() && !detailSending;

  useEffect(() => {
    if (!panelAssistant || pickerOpen) return undefined;
    const candidates: Array<{ key: string; url: string }> = [];
    for (const run of panelRuns) {
      const key = `run:${run.id}`;
      const url = reviewUrlFromText(run.prompt);
      if (url && !reviewTitleOverrides[key]) candidates.push({ key, url });
    }
    for (const item of filteredHistory) {
      const key = `history:${item.workdir}:${item.agent}:${item.sessionId}`;
      const url = reviewUrlFromText(item.title || item.lastQuestion || '');
      if (url && !reviewTitleOverrides[key]) candidates.push({ key, url });
    }
    if (!candidates.length) return undefined;
    let cancelled = false;
    const unique = Array.from(new Map(candidates.map(item => [item.key, item])).values()).slice(0, 8);
    void Promise.all(unique.map(async item => {
      try {
        const res = await api.getReviewLinkMeta(item.url, { timeoutMs: 8_000 });
        const title = res.ok ? res.meta?.displayTitle?.trim() : '';
        if (!cancelled && title) {
          setReviewTitleOverrides(prev => prev[item.key] ? prev : { ...prev, [item.key]: title });
        }
      } catch {
        // Keep the local fallback title.
      }
    }));
    return () => {
      cancelled = true;
    };
  }, [filteredHistory, panelAssistant, panelRuns, pickerOpen, reviewTitleOverrides]);

  useEffect(() => {
    if (!detailTarget?.runId || !detailRun) return;
    const hasNotice = detailRun.status === 'completed' || detailRun.status === 'failed';
    if (hasNotice && !detailRun.seenAt) markNoticeSeen(detailRun.assistantId, detailRun.id);
  }, [detailRun, detailTarget?.runId, markNoticeSeen]);

  const sendDetailMessage = useCallback(async () => {
    if (!detailSession || detailSending) return;
    const prompt = detailDraft.trim();
    if (!prompt) return;

    setDetailSending(true);
    setDetailDraft('');
    setDetailState(current => ({
      ...current,
      error: null,
    }));
    setDetailOptimisticMessages(current => [...current, { role: 'user', text: prompt }]);
    try {
      const result = await api.sendSessionMessage(detailSession.workdir, detailSession.agent, detailSession.sessionId, prompt, { timeoutMs: 30_000 });
      if (!result.ok) throw new Error(result.error || 'Failed to send message');
      const parsed = parseSessionKey(result.sessionKey || '');
      const nextSessionId = parsed?.sessionId || detailSession.sessionId;
      const now = new Date().toISOString();
      setDetailTarget(current => current ? { ...current, sessionId: nextSessionId } : current);
      setDetailStream({
        phase: 'queued',
        taskId: result.taskId || `detail-${Date.now().toString(36)}`,
        prompt,
        sessionId: nextSessionId,
        updatedAt: Date.now(),
      });
      if (detailTarget?.runId) {
        setRuns(prev => prev.map(run => run.id === detailTarget.runId ? {
          ...run,
          sessionId: nextSessionId,
          sessionKey: `${detailSession.agent}:${nextSessionId}`,
          taskId: result.taskId || run.taskId,
	          status: 'queued',
	          updatedAt: now,
	          completedAt: null,
	          seenAt: null,
	          viewedAt: null,
	          error: null,
	        } : run));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      setDetailDraft(prompt);
      setDetailOptimisticMessages(current => current.filter(item => !(item.role === 'user' && item.text === prompt)));
      setDetailState(current => ({ ...current, error: message }));
      toast(message, false);
    } finally {
      setDetailSending(false);
    }
  }, [detailDraft, detailSending, detailSession, detailTarget?.runId, toast]);

  return (
    <div className={cn('relative flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-visible py-2', className)}>
      <div className="flex w-full flex-col items-center gap-1">
        {quickAssistants.map(assistant => {
          const assistantRuns = runsByAssistant.get(assistant.id) || [];
          const activeCount = assistantRuns.filter(run => run.status === 'queued' || run.status === 'running').length;
          const hasCompletedNotice = assistantRuns.some(run => run.status === 'completed' && !run.seenAt);
          const hasFailure = assistantRuns.some(run => run.status === 'failed' && !run.seenAt);
          const draft = drafts[assistant.id] || '';
          const sending = sendingId === assistant.id;
          const canSend = !!draft.trim() && !!runtimeWorkdir && !sendingId;
          return (
            <div
              key={assistant.id}
              className="group/assistant relative"
              onMouseEnter={() => showAssistantInput(assistant.id)}
              onMouseLeave={() => scheduleAssistantInputClose(assistant.id)}
            >
              <button
                type="button"
                title={assistant.name}
                aria-label={assistant.name}
                onClick={event => openAssistantPanel(assistant.id, event)}
                className={cn(
                  'relative z-[121] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-fg-5 transition-[background,border-color,color,box-shadow,transform]',
                  'hover:-translate-y-px hover:border-primary/35 hover:bg-panel-h hover:text-fg focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
                  panelAssistantId === assistant.id
                    ? 'border-primary/45 bg-primary/[0.10] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'border-transparent bg-transparent',
                )}
              >
                {hasCompletedNotice && <span className="pointer-events-none absolute -inset-1 rounded-[14px] border border-ok/70 opacity-75 animate-ping" />}
                {hasFailure && <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-err shadow-[0_0_0_2px_var(--th-sidebar)]" />}
                <AssistantGlyph assistant={assistant} />
                {activeCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-fg shadow-sm">
                    {activeCount}
                  </span>
                )}
              </button>
              {hoverAssistantId === assistant.id && !panelAssistantId && !pickerOpen && (
                <>
                  <span className="absolute left-full top-1/2 z-[110] h-[172px] w-[304px] -translate-y-1/2" aria-hidden="true" />
                  <form
                    data-quick-assistant-input={assistant.id}
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      void runAssistant(assistant);
                    }}
                    className="absolute left-full top-1/2 z-[122] ml-2 w-[292px] -translate-y-1/2 translate-x-0 rounded-lg border border-edge/80 bg-panel/98 p-2 shadow-[0_18px_52px_rgba(2,6,23,0.24)] ring-1 ring-white/[0.04] backdrop-blur transition-all duration-200"
                    onMouseEnter={() => showAssistantInput(assistant.id)}
                    onMouseLeave={() => scheduleAssistantInputClose(assistant.id)}
                    onFocus={() => showAssistantInput(assistant.id)}
                    onBlur={event => {
                      const nextFocus = event.relatedTarget;
                      if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                        scheduleAssistantInputClose(assistant.id);
                      }
                    }}
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
                      <div className="truncate text-[12px] font-semibold text-fg-2">{assistant.name}</div>
                      <div className="shrink-0 text-[10px] text-fg-5">{preferredAgent(assistant, agentOptions, fallbackAgent)}</div>
                    </div>
                    <textarea
                      value={draft}
                      onChange={event => setDrafts(prev => ({ ...prev, [assistant.id]: event.target.value }))}
                      onCompositionStart={() => {
                        composingAssistantIdRef.current = assistant.id;
                      }}
                      onCompositionEnd={() => {
                        window.setTimeout(() => {
                          if (composingAssistantIdRef.current === assistant.id) composingAssistantIdRef.current = null;
                        }, 0);
                      }}
                      onBlur={() => {
                        if (composingAssistantIdRef.current === assistant.id) composingAssistantIdRef.current = null;
                      }}
                      onKeyDown={event => {
                        const nativeEvent = event.nativeEvent;
                        const isComposing = nativeEvent.isComposing || composingAssistantIdRef.current === assistant.id || event.keyCode === 229;
                        if (isComposing) return;
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          if (canSend) void runAssistant(assistant);
                        }
                      }}
                      placeholder={assistantPlaceholder(assistant, locale)}
                      disabled={sending || !runtimeWorkdir}
                      rows={2}
                      className="min-h-[58px] w-full resize-none rounded-md border border-control-border bg-control px-2.5 py-2 text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-5 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_3px_var(--th-glow-a)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="truncate text-[10px] text-fg-5">{runtimeWorkdir ? runtimeWorkdir.split(/[\\/]/).pop() : L(locale, '未选择工作区', 'No workspace')}</div>
                      <button
                        type="submit"
                        disabled={!canSend}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary text-primary-fg transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
                        aria-label={L(locale, '发送', 'Send')}
                        title={L(locale, '发送', 'Send')}
                      >
                        {sending ? <Spinner className="h-3.5 w-3.5" /> : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m22 2-7 20-4-9-9-4Z" />
                            <path d="M22 2 11 13" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={openPicker}
          title={L(locale, '添加常用 Assistant', 'Add quick assistant')}
          aria-label={L(locale, '添加常用 Assistant', 'Add quick assistant')}
          className={cn(
            'mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-fg-5 transition-colors hover:border-primary/35 hover:bg-panel-h hover:text-fg focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
            pickerOpen ? 'border-primary/45 bg-primary/[0.10] text-primary' : 'border-transparent bg-transparent',
          )}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {(panelAssistant || pickerOpen) && (
        <div
          className={cn(
            'fixed left-[62px] z-[130] overflow-hidden rounded-lg border border-edge/80 bg-panel/98 shadow-[0_22px_70px_rgba(2,6,23,0.28)] ring-1 ring-white/[0.04] backdrop-blur',
            detailTarget ? 'w-[min(430px,calc(100vw-86px))]' : 'w-[340px]',
          )}
          style={{ top: panelTop, height: floatingPanelHeight() }}
        >
          {pickerOpen ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-edge/70 px-3 py-2">
                <div className="text-[13px] font-semibold text-fg">{L(locale, '常用 Assistant', 'Quick assistants')}</div>
                <div className="mt-0.5 text-[11px] text-fg-5">{quickAssistants.length}/{QUICK_ASSISTANT_LIMIT}</div>
              </div>
              <div className="min-h-0 overflow-y-auto p-1.5">
                {assistants.map(assistant => {
                  const selected = resolvedQuickIds.includes(assistant.id);
                  return (
                    <button
                      key={assistant.id}
                      type="button"
                      onClick={() => toggleQuickAssistant(assistant.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-panel-h"
                    >
                      <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', selected ? 'border-primary/35 bg-primary/[0.10] text-primary' : 'border-edge/70 bg-inset text-fg-5')}>
                        <AssistantGlyph assistant={assistant} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-fg-2">{assistant.name}</span>
                        <span className="block truncate text-[10px] text-fg-5">{assistant.responsibility}</span>
                      </span>
                      <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]', selected ? 'border-primary/30 text-primary' : 'border-edge/70 text-fg-5')}>
                        {selected ? L(locale, '已添加', 'Added') : L(locale, '添加', 'Add')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : panelAssistant ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-start gap-3 border-b border-edge/70 px-3 py-2.5">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/[0.09] text-primary">
                  <AssistantGlyph assistant={panelAssistant} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {detailTarget && (
                      <button
                        type="button"
                        onClick={() => setDetailTarget(null)}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-5 hover:bg-panel-h hover:text-fg"
                        aria-label={L(locale, '返回列表', 'Back to list')}
                        title={L(locale, '返回列表', 'Back to list')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m15 18-6-6 6-6" />
                        </svg>
                      </button>
                    )}
                    <div className="truncate text-[13px] font-semibold text-fg">{detailTarget ? L(locale, '任务详情', 'Run detail') : panelAssistant.name}</div>
                  </div>
                  <div className={cn('text-[11px] leading-relaxed text-fg-5', detailTarget ? 'line-clamp-2 break-words' : 'line-clamp-2')}>
                    {detailTarget ? detailTarget.title : panelAssistant.responsibility}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDetailTarget(null);
                    setPanelAssistantId(null);
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 hover:bg-panel-h hover:text-fg"
                  aria-label={L(locale, '关闭', 'Close')}
                  title={L(locale, '关闭', 'Close')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              {detailTarget ? (
                <div className="min-h-0 overflow-y-auto p-3">
                  <div className="rounded-md border border-edge/60 bg-inset/30 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', detailDotClass(detailRun, detailStream))} />
                        <span className="truncate text-[12px] font-semibold text-fg-2">{detailStatusText(detailRun, detailStream, locale)}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-fg-5">{detailSession?.agent}</span>
                    </div>
                    {detailStream?.activitySummary?.current?.label && (
                      <div className="mt-1 truncate text-[10px] text-fg-5">{detailStream.activitySummary.current.label}</div>
                    )}
                    {detailStatusMeta && <div className="mt-1 truncate text-[10px] text-fg-5">{detailStatusMeta}</div>}
                  </div>

                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-5">{L(locale, '输入', 'Input')}</div>
                    <div className="max-h-[88px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge/45 bg-panel-alt/40 px-2.5 py-2 text-[12px] leading-relaxed text-fg-3">
                      {detailTarget.title}
                    </div>
                  </div>

                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-5">{L(locale, '进度 / 输出', 'Progress / Output')}</span>
                      {detailState.loading && <Spinner className="h-3 w-3 text-fg-5" />}
                    </div>
                    {detailState.error ? (
                      <div className="rounded-md border border-err/30 bg-err/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-err">{detailState.error}</div>
                    ) : detailOutputText ? (
                      <div className="whitespace-pre-wrap break-words rounded-md border border-edge/45 bg-panel-alt/45 px-3 py-2.5 text-[12.5px] leading-[1.7] text-fg-3">
                        {detailOutputText}
                      </div>
                    ) : (
                      <div className="rounded-md border border-edge/50 bg-panel-alt/50 px-2.5 py-6 text-center text-[11px] text-fg-5">
                        {detailStream?.phase === 'queued' ? L(locale, '任务还在排队，开始后会显示进度', 'Queued; progress will appear when it starts') : L(locale, '还没有可显示的输出', 'No output yet')}
                      </div>
                    )}
                  </div>

                  {detailMessages.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-5">{L(locale, '最近消息', 'Recent messages')}</div>
                      {detailMessages.slice(-4).map((message, index) => (
                        <div key={`${message.role}-${index}`} className={cn(
                          'rounded-md border px-3 py-2.5',
                          message.role === 'user' ? 'border-primary/20 bg-primary/[0.045]' : 'border-edge/35 bg-panel-alt/35',
                        )}>
                          <div className="mb-1 text-[10px] font-semibold text-fg-5">{message.role === 'user' ? L(locale, '你', 'You') : detailTarget.assistantName}</div>
                          <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.7] text-fg-3">{compactText(message.text, 1600)}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    className="sticky bottom-0 -mx-3 mt-3 border-t border-edge/70 bg-panel/98 px-3 py-2.5 backdrop-blur"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      void sendDetailMessage();
                    }}
                  >
                    <textarea
                      value={detailDraft}
                      onChange={event => setDetailDraft(event.target.value)}
                      onCompositionStart={() => {
                        detailComposingRef.current = true;
                      }}
                      onCompositionEnd={() => {
                        window.setTimeout(() => {
                          detailComposingRef.current = false;
                        }, 0);
                      }}
                      onBlur={() => {
                        detailComposingRef.current = false;
                      }}
                      onKeyDown={event => {
                        const nativeEvent = event.nativeEvent;
                        const isComposing = nativeEvent.isComposing || detailComposingRef.current || event.keyCode === 229;
                        if (isComposing) return;
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          if (detailCanSend) void sendDetailMessage();
                        }
                      }}
                      disabled={!detailSession?.sessionId || detailSending}
                      rows={2}
                      placeholder={L(locale, '继续追问这个 Assistant...', 'Continue chatting with this assistant...')}
                      className="min-h-[58px] w-full resize-none rounded-md border border-control-border bg-control px-2.5 py-2 text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-5 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_3px_var(--th-glow-a)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={!detailSession?.sessionId}
                        onClick={() => detailSession && openSession(detailSession, {
                          markRead: !!detailRun && (detailRun.status === 'completed' || detailRun.status === 'failed'),
                          runId: detailRun?.id || null,
                        })}
                        className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-edge/70 bg-panel-alt px-2 text-[11px] font-semibold text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                      >
                        {L(locale, '打开完整 Chat', 'Open full chat')}
                      </button>
                      <button
                        type="submit"
                        disabled={!detailCanSend}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary text-primary-fg transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
                        aria-label={L(locale, '发送', 'Send')}
                        title={L(locale, '发送', 'Send')}
                      >
                        {detailSending ? <Spinner className="h-3.5 w-3.5" /> : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m22 2-7 20-4-9-9-4Z" />
                            <path d="M22 2 11 13" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto p-1.5">
                {!panelRuns.length && !filteredHistory.length && (
                  <div className="px-3 py-8 text-center text-[12px] text-fg-5">{L(locale, '还没有运行记录', 'No runs yet')}</div>
                )}
	                {panelRuns.map(run => {
	                  const preview = run.outputPreview || run.activityPreview || '';
	                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => openRunDetail(run)}
                      className="mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-panel-h"
                    >
	                      <span className={cn(
	                        'mt-1 h-2 w-2 shrink-0 rounded-full',
	                        runListDotClass(run),
	                      )} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-semibold text-fg-2">{quickRunTitle(run, reviewTitleOverrides)}</span>
                          <span className="shrink-0 text-[10px] text-fg-5">{fmtRunTime(run.completedAt || run.updatedAt)}</span>
                        </span>
	                        <span className="mt-0.5 block truncate text-[10px] text-fg-5">
	                          {runListStatusText(run, locale)} · {run.agent}
	                        </span>
                        {preview && <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-fg-4">{preview}</span>}
                        {run.error && <span className="mt-1 block line-clamp-2 text-[10px] text-err">{run.error}</span>}
                      </span>
                    </button>
                  );
                })}
                {filteredHistory.map(item => {
                  const preview = compactText(item.lastMessageText || '', 260);
                  return (
                    <button
                      key={`${item.workdir}:${item.agent}:${item.sessionId}`}
                      type="button"
                      onClick={() => openHistoryDetail(panelAssistant, item)}
                      className="mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-panel-h"
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-fg-6" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-semibold text-fg-2">{historyTitle(panelAssistant, item, reviewTitleOverrides)}</span>
                          <span className="shrink-0 text-[10px] text-fg-5">{fmtRunTime(item.runUpdatedAt || item.updatedAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-fg-5">{item.sourceLabel || item.source} · {item.agent}</span>
                        {preview && <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-fg-4">{preview}</span>}
                      </span>
                    </button>
                  );
                })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
