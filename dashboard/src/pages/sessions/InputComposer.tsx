import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { AGENT_ACCEPTED_PROVIDER_KINDS, cn, EFFORT_OPTIONS, getAgentMeta, shortenModel } from '../../utils';
import { api } from '../../api';
import { useStore } from '../../store';
import { Spinner } from '../../components/ui';
import { BrandIcon } from '../../components/BrandIcon';
import {
  isImageFile,
  makeComposerAttachment,
  revokeComposerAttachments,
  verifyComposerAttachmentFile,
  formatFileSize,
  copyImageFile,
  parseSessionKey,
  type ComposerAttachment,
} from './utils';
import type { SessionInfo, AgentRuntimeStatus, SkillInfo, StreamPreviewMeta } from '../../types';

type CascadeStep = 'closed' | 'agent' | 'model' | 'effort';

type BuiltinComposerCommand = {
  command: string;
  insert: string;
  labelKey: string;
  descriptionKey: string;
  aliases?: string[];
};

type ComposerCommandOption =
  | ({ kind: 'builtin' } & BuiltinComposerCommand)
  | { kind: 'skill'; command: string; skill: SkillInfo };

export type PendingReviewComment = {
  id: string;
  quote: string;
  note: string;
  turnIndex?: number;
};

type ComposerMode = 'single' | 'multi';

const BUILTIN_COMPOSER_COMMANDS: BuiltinComposerCommand[] = [
  {
    command: 'goal',
    insert: '/goal ',
    labelKey: 'hub.commandGoal',
    descriptionKey: 'hub.commandGoalDesc',
    aliases: ['objective', 'persistent goal', '目标'],
  },
  {
    command: 'goal pause',
    insert: '/goal pause',
    labelKey: 'hub.commandGoalPause',
    descriptionKey: 'hub.commandGoalPauseDesc',
    aliases: ['pause goal', '暂停'],
  },
  {
    command: 'goal resume',
    insert: '/goal resume',
    labelKey: 'hub.commandGoalResume',
    descriptionKey: 'hub.commandGoalResumeDesc',
    aliases: ['resume goal', '恢复'],
  },
  {
    command: 'goal clear',
    insert: '/goal clear',
    labelKey: 'hub.commandGoalClear',
    descriptionKey: 'hub.commandGoalClearDesc',
    aliases: ['clear goal', 'cancel goal', '清除'],
  },
  {
    command: 'plan',
    insert: '/plan ',
    labelKey: 'hub.commandPlan',
    descriptionKey: 'hub.commandPlanDesc',
    aliases: ['planning', 'todo', '计划'],
  },
  {
    command: 'logtrace',
    insert: '/logtrace env=lab id= last=24h ',
    labelKey: 'hub.commandLogTrace',
    descriptionKey: 'hub.commandLogTraceDesc',
    aliases: ['logs', 'trace', 'kibana', '日志', '排查'],
  },
];

function formatPendingReviewComments(comments: PendingReviewComment[]): string {
  if (!comments.length) return '';
  const lines = ['Review comments to address:'];
  comments.forEach((comment, index) => {
    lines.push(`${index + 1}. ${comment.note}`);
    if (typeof comment.turnIndex === 'number') lines.push(`   Turn: ${comment.turnIndex + 1}`);
    lines.push('   Quote:');
    for (const line of comment.quote.split('\n')) lines.push(`   > ${line}`);
  });
  return lines.join('\n');
}

/* ── Draft persistence across session switches ── */
const draftStore = new Map<string, { text: string; files: File[] }>();
const activeComposerFocus = { key: '', restoreUntil: 0 };
const MAX_PERSISTED_DRAFT_IMAGE_BYTES = 5 * 1024 * 1024;
type PersistedDraftAttachment = {
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
};
function draftKey(workdir: string, agent: string, sessionId: string) {
  return `${workdir || 'unknown'}:${agent || 'new'}:${sessionId || 'new'}`;
}
function draftStorageKey(key: string) { return `pikiclaw-draft:${key}`; }
function draftFilesStorageKey(key: string) { return `pikiclaw-draft-files:${key}`; }
function readDraftText(key: string): string | null {
  const storageKey = draftStorageKey(key);
  try {
    const persisted = localStorage.getItem(storageKey);
    if (persisted != null) return persisted;
  } catch {}
  try { return sessionStorage.getItem(storageKey); } catch { return null; }
}
function writeDraftText(key: string, text: string) {
  const storageKey = draftStorageKey(key);
  try {
    if (text) localStorage.setItem(storageKey, text);
    else localStorage.removeItem(storageKey);
  } catch {}
  try {
    if (text) sessionStorage.setItem(storageKey, text);
    else sessionStorage.removeItem(storageKey);
  } catch {}
}

function formatContextChip(meta: StreamPreviewMeta | null | undefined): { percent: number; title: string; tone: 'empty' | 'normal' | 'warn' } {
  if (!meta) return { percent: 0, title: 'Context unavailable', tone: 'empty' };
  const pct = typeof meta.contextPercent === 'number' && Number.isFinite(meta.contextPercent)
    ? Math.max(0, Math.min(100, meta.contextPercent))
    : null;
  if (pct == null) return { percent: 0, title: 'Context unavailable', tone: 'empty' };
  return {
    percent: pct,
    title: `${pct.toFixed(1)}%`,
    tone: pct != null && pct >= 70 ? 'warn' : 'normal',
  };
}

function ContextUsageChip({ chip }: { chip: ReturnType<typeof formatContextChip> }) {
  const ringColor = chip.tone === 'warn'
    ? 'rgba(180, 83, 9, 0.58)'
    : chip.tone === 'empty'
      ? 'rgba(148, 163, 184, 0.18)'
      : 'rgba(100, 116, 139, 0.42)';
  const trackColor = chip.tone === 'empty' ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.16)';
  return (
    <span
      className={cn(
        'group relative inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center text-[10px] font-mono leading-none',
      )}
      aria-label={chip.title}
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-400/10"
        style={{ background: `conic-gradient(${ringColor} ${chip.percent}%, ${trackColor} 0)` }}
      />
      <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 hidden w-max max-w-[180px] whitespace-normal rounded-md border border-edge/80 bg-dropdown px-2 py-1 text-[10px] font-medium leading-snug text-fg shadow-lg group-hover:block">
        {chip.title}
      </span>
    </span>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function writeDraftFiles(key: string, files: File[]) {
  const storageKey = draftFilesStorageKey(key);
  const persistable = files.filter(file => isImageFile(file) && file.size <= MAX_PERSISTED_DRAFT_IMAGE_BYTES);
  if (!persistable.length) {
    try { localStorage.removeItem(storageKey); } catch {}
    try { sessionStorage.removeItem(storageKey); } catch {}
    return;
  }
  try {
    const payload: PersistedDraftAttachment[] = [];
    for (const file of persistable) {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) continue;
      payload.push({
        name: file.name || 'pasted-image.png',
        type: file.type || 'image/png',
        lastModified: file.lastModified || Date.now(),
        dataUrl,
      });
    }
    const serialized = JSON.stringify(payload);
    if (payload.length) localStorage.setItem(storageKey, serialized);
    else localStorage.removeItem(storageKey);
    try {
      if (payload.length) sessionStorage.setItem(storageKey, serialized);
      else sessionStorage.removeItem(storageKey);
    } catch {}
  } catch {
    try { sessionStorage.removeItem(storageKey); } catch {}
  }
}

function dataUrlToFile(entry: PersistedDraftAttachment): File | null {
  try {
    const match = entry.dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
    if (!match) return null;
    const mime = entry.type || match[1] || 'image/png';
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], entry.name || 'pasted-image.png', {
      type: mime,
      lastModified: entry.lastModified || Date.now(),
    });
  } catch {
    return null;
  }
}

function readDraftFiles(key: string): File[] {
  const storageKey = draftFilesStorageKey(key);
  let raw: string | null = null;
  try { raw = localStorage.getItem(storageKey); } catch {}
  if (raw == null) {
    try { raw = sessionStorage.getItem(storageKey); } catch {}
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(entry => dataUrlToFile(entry as PersistedDraftAttachment))
      .filter((file): file is File => !!file);
  } catch {
    return [];
  }
}

function clearDraftFiles(key: string) {
  const storageKey = draftFilesStorageKey(key);
  try { localStorage.removeItem(storageKey); } catch {}
  try { sessionStorage.removeItem(storageKey); } catch {}
}

/**
 * Pick a BrandIcon id for a configured Provider based on its base URL / kind.
 * Mirrors the logic used in AgentTab / ModelsTab so the same provider shows
 * the same logo everywhere.
 */
function brandIdForProvider(p: { kind: string; baseURL: string }): string {
  const host = (() => { try { return new URL(p.baseURL).host.toLowerCase(); } catch { return ''; } })();
  if (host.includes('openrouter')) return 'openrouter';
  if (host.includes('anthropic')) return 'anthropic';
  if (host.includes('deepseek')) return 'deepseek';
  if (host.includes('googleapis') || host.includes('vertex')) return 'google';
  if (host.includes('openai.com')) return 'openai';
  if (host.includes('dashscope') || host.includes('qwen') || host.includes('aliyun')) return 'qwen';
  if (host.includes('volces') || host.includes('volcengine') || host.includes('doubao')) return 'doubao';
  if (host.includes('bigmodel') || host.includes('zhipu') || host.includes('z.ai')) return 'glm';
  if (host.includes('minimax')) return 'minimax';
  if (p.kind === 'anthropic') return 'anthropic';
  if (p.kind === 'google') return 'google';
  if (p.kind === 'openai') return 'openai';
  return 'custom';
}

export const InputComposer = memo(function InputComposer({ session, workdir, onStreamQueued, onSendStart, onSendTaskAssigned, onSendFailed, onSessionChange, onMultiSessionChange, t, streamPhase, streamTaskId, queuedTaskIds, queuedTasks, pendingQueuedSends, pendingReviewComments = [], onRemovePendingReviewComment, onClearPendingReviewComments, contextMeta, onRecall, onSteer, onReorderQueued, editDraft, editAtTurn, onEditDraftConsumed, onEditSendStart }: {
  session: SessionInfo;
  workdir: string;
  onStreamQueued: () => void;
  onSendStart: (prompt: string, imageUrls?: string[]) => void;
  onSendTaskAssigned?: (taskId: string) => void;
  onSendFailed?: () => void;
  onSessionChange?: (next: { agent: string; sessionId: string; workdir: string }) => void;
  onMultiSessionChange?: (next: Array<{ agent: string; sessionId: string; workdir: string }>, prompt: string) => void;
  t: (k: string) => string;
  streamPhase: string | null;
  streamTaskId?: string | null;
  queuedTaskIds?: string[];
  queuedTasks?: Array<{ taskId: string; prompt: string }>;
  pendingReviewComments?: PendingReviewComment[];
  onRemovePendingReviewComment?: (id: string) => void;
  onClearPendingReviewComments?: () => void;
  contextMeta?: StreamPreviewMeta | null;
  /** Optimistic fallback for queued sends — used by each queued row while the
   *  server snapshot's `queuedTasks` hasn't yet caught up. `imageUrls` are
   *  blob previews surfaced as inline thumbnails so the user can recognize
   *  the queued message at a glance (server-side queued state has no image
   *  data, so older rows after a refresh fall back to text only). */
  pendingQueuedSends?: Array<{ taskId: string | null; prompt: string; imageUrls?: string[] }>;
  onRecall?: (taskId: string) => void;
  onSteer?: (taskId: string) => void;
  onReorderQueued?: (taskIds: string[]) => void | Promise<void>;
  editDraft?: string | null;
  editAtTurn?: number | null;
  onEditDraftConsumed?: () => void;
  onEditSendStart?: (prompt: string, atTurn: number) => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingAttachmentCount, setUploadingAttachmentCount] = useState(0);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  // Per-task in-flight tracking. A global boolean would freeze every row's
  // button when one recall completes but other tasks remain queued/streaming
  // (the "did the target resolve?" check can't distinguish which row's
  // operation finished). Tracking the target taskId lets us clear the flag
  // when that specific task disappears and disable only that row's button.
  const [recallingIds, setRecallingIds] = useState<Set<string>>(() => new Set());
  const [steeringIds, setSteeringIds] = useState<Set<string>>(() => new Set());
  // Stash last-sent content so recall can restore it to the input field
  const lastSentRef = useRef<{ prompt: string; files: File[] }>({ prompt: '', files: [] });
  const storeAgents = useStore(s => s.agentStatus?.agents ?? null);
  const [agents, setAgents] = useState<AgentRuntimeStatus[]>(storeAgents || []);
  const contextChip = useMemo(() => formatContextChip(contextMeta), [contextMeta]);
  // User's applied cascade choice for this session. Empty = fall back to runtime
  // default. These are intentionally per-session and never written back to the
  // global runtime prefs — picking a model in the composer must NOT change other
  // sessions' defaults. Reset on session change (see session-key effect below).
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [composerMode, setComposerMode] = useState<ComposerMode>('single');
  const [multiAgentIds, setMultiAgentIds] = useState<string[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [queuedPreviewUrl, setQueuedPreviewUrl] = useState<string | null>(null);
  const [expandedQueuedTaskIds, setExpandedQueuedTaskIds] = useState<Set<string>>(() => new Set());
  const [draggingQueuedTaskId, setDraggingQueuedTaskId] = useState<string | null>(null);
  const [dragOverQueuedTaskId, setDragOverQueuedTaskId] = useState<string | null>(null);
  const [reorderingQueued, setReorderingQueued] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingEffort, setPendingEffort] = useState<string | null>(null);
  // Tracks the staged Profile id while the user steps through the cascade.
  // `null` (after the user touches the model step) means "switching to native";
  // `undefined` means "user hasn't picked yet — leave the existing binding
  // untouched on apply." This three-state semantics matters because applying
  // the cascade should be a no-op for the agent's Profile binding when the
  // user only changed the effort.
  const [pendingProfileSelection, setPendingProfileSelection] = useState<string | null | undefined>(undefined);
  const [cascadeStep, setCascadeStep] = useState<CascadeStep>('closed');
  const [cascadePos, setCascadePos] = useState<{ left: number; bottom: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputValueRef = useRef('');
  const composingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const refreshAgentStatus = useStore(s => s.refreshAgentStatus);
  // Model layer — Providers + Profiles + current bindings. Fetched lazily on
  // cascade open so the dropdown can list "我的模型" (Profile shortcuts) next
  // to the agent's native model catalogue. Kept local to InputComposer since
  // this is the only session-scoped consumer; the dashboard agents page has
  // its own `useModelLayer` hook with the same shape.
  const [profiles, setProfiles] = useState<Array<{
    id: string; name: string; providerId: string; modelId: string; effort?: string | null;
  }>>([]);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; kind: string; baseURL: string }>>([]);
  const [activeProfiles, setActiveProfiles] = useState<Record<string, string | null>>({});

  const refreshModelLayer = useCallback(async () => {
    try {
      const [pRes, profRes, bRes] = await Promise.all([
        fetch('/api/models/providers').then(r => r.json()),
        fetch('/api/models/profiles').then(r => r.json()),
        fetch('/api/models/agents').then(r => r.json()),
      ]);
      if (pRes?.ok) setProviders(pRes.providers || []);
      if (profRes?.ok) setProfiles(profRes.profiles || []);
      if (bRes?.ok) {
        const map: Record<string, string | null> = {};
        for (const b of bRes.bindings || []) map[b.agent] = b.activeProfileId;
        setActiveProfiles(map);
      }
    } catch { /* network blip — leave previous snapshot in place */ }
  }, []);

  useEffect(() => { if (storeAgents?.length) setAgents(storeAgents); }, [storeAgents]);
  useEffect(() => {
    if (!agents.length) return;
    const installed = agents.filter(a => a.installed).map(a => a.agent);
    setMultiAgentIds(prev => {
      const filtered = prev.filter(agent => installed.includes(agent));
      if (filtered.length) return filtered;
      const fallback = selectedAgent || session.agent || agents.find(a => a.isDefault)?.agent || installed[0] || '';
      return fallback ? [fallback] : [];
    });
  }, [agents, selectedAgent, session.agent]);
  useEffect(() => { attachmentsRef.current = composerAttachments; }, [composerAttachments]);

  // Restore draft on mount, save on unmount
  const dk = draftKey(workdir, session.agent || '', session.sessionId);
  const dkRef = useRef(dk);
  dkRef.current = dk;
  const persistDraft = useCallback((text: string, files?: File[]) => {
    inputValueRef.current = text;
    const snapshotFiles = files ?? attachmentsRef.current.map(a => a.file);
    if (text || snapshotFiles.length) draftStore.set(dkRef.current, { text, files: snapshotFiles });
    else draftStore.delete(dkRef.current);
    writeDraftText(dkRef.current, text);
    void writeDraftFiles(dkRef.current, snapshotFiles);
  }, []);

  useEffect(() => {
    const saved = draftStore.get(dk);
    const storedText = readDraftText(dk);
    const storedFiles = readDraftFiles(dk);
    if (saved) {
      draftStore.delete(dk);
      const nextText = saved.text || storedText || '';
      const nextFiles = saved.files.length ? saved.files : storedFiles;
      inputValueRef.current = nextText;
      setInput(nextText);
      setComposerAttachments(nextFiles.length ? nextFiles.map(file => makeComposerAttachment(file, 'ready')) : []);
    } else {
      const nextText = storedText || '';
      inputValueRef.current = nextText;
      setInput(nextText);
      setComposerAttachments(storedFiles.length ? storedFiles.map(file => makeComposerAttachment(file, 'ready')) : []);
    }
    return () => {
      const text = inputValueRef.current;
      const files = attachmentsRef.current.map(a => a.file);
      // Save draft — revoke preview URLs but keep File objects
      for (const a of attachmentsRef.current) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      if (text || files.length) draftStore.set(dkRef.current, { text, files });
      else draftStore.delete(dkRef.current);
      writeDraftText(dkRef.current, text);
      void writeDraftFiles(dkRef.current, files);
    };
  }, [dk]);

  // Reset applied cascade choice + transient pending state when session changes.
  useEffect(() => {
    setSelectedAgent('');
    setSelectedModel('');
    setSelectedEffort('');
    setPendingAgent(null);
    setPendingModel(null);
    setPendingEffort(null);
    setCascadeStep('closed');
  }, [session.agent, session.sessionId]);

  // Consume editDraft — populate the input when user clicks "Edit" on a message
  useEffect(() => {
    if (editDraft != null) {
      setInput(editDraft);
      persistDraft(editDraft);
      onEditDraftConsumed?.();
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.setSelectionRange(editDraft.length, editDraft.length); }
      });
    }
  }, [editDraft, onEditDraftConsumed, persistDraft]);

  // Fetch available skills when workdir changes
  useEffect(() => {
    if (!workdir) return;
    let cancelled = false;
    api.getSkills(workdir).then(res => {
      if (!cancelled && res.ok) setSkills(res.skills);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [workdir]);

  // Compute slash command suggestions. Built-ins are dashboard/runtime commands;
  // skills come from the active workspace plus the user's global skill dir.
  const commandQuery = skillMenuOpen ? (() => {
    const match = input.match(/^\/([^\n]*)$/);
    return match ? match[1].trimStart().toLowerCase() : null;
  })() : null;
  const commandOptions = useMemo<ComposerCommandOption[]>(() => {
    if (commandQuery === null) return [];
    const matches = (values: Array<string | null | undefined>) => {
      if (!commandQuery) return true;
      return values.filter(Boolean).join(' ').toLowerCase().includes(commandQuery);
    };
    const builtins: ComposerCommandOption[] = BUILTIN_COMPOSER_COMMANDS
      .filter(cmd => matches([cmd.command, cmd.insert, ...(cmd.aliases || [])]))
      .map(cmd => ({ kind: 'builtin', ...cmd }));
    const skillOptions: ComposerCommandOption[] = skills
      .filter(skill => matches([skill.name, skill.label, skill.description]))
      .map(skill => ({ kind: 'skill', command: skill.name, skill }));
    return [...builtins, ...skillOptions].slice(0, 12);
  }, [commandQuery, skills]);

  // Reset selected index when filtered list changes
  useEffect(() => { setSkillMenuIndex(0); }, [skillMenuOpen, input]);

  // Scroll skill menu to keep selected item visible
  useEffect(() => {
    if (!skillMenuOpen || !skillMenuRef.current) return;
    const item = skillMenuRef.current.querySelector(`[data-command-idx="${skillMenuIndex}"]`);
    if (item) (item as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [skillMenuIndex, skillMenuOpen]);

  // Close skill menu on outside click
  useEffect(() => {
    if (!skillMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (skillMenuRef.current?.contains(e.target as Node)) return;
      if (inputRef.current?.contains(e.target as Node)) return;
      setSkillMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [skillMenuOpen]);

  // Close cascade on outside click — check both trigger and portal
  useEffect(() => {
    if (cascadeStep === 'closed') return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the trigger button
      if (triggerRef.current?.contains(target)) return;
      // Don't close if clicking inside the portal dropdown
      const portal = document.getElementById('cascade-portal');
      if (portal?.contains(target)) return;
      setCascadeStep('closed'); setPendingAgent(null); setPendingModel(null); setPendingEffort(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cascadeStep]);

  // Position the cascade portal above the trigger button
  useLayoutEffect(() => {
    if (cascadeStep === 'closed' || !triggerRef.current) { setCascadePos(null); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    setCascadePos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
  }, [cascadeStep]);

  const firstQueuedFromSnapshot = queuedTaskIds && queuedTaskIds.length ? queuedTaskIds[0] : null;
  // Clear local taskId once the real snapshot has the info
  useEffect(() => {
    if (localTaskId) {
      if (firstQueuedFromSnapshot) setLocalTaskId(null);
      else if (streamPhase !== null && streamPhase !== 'queued') setLocalTaskId(null);
    }
  }, [streamPhase, localTaskId, firstQueuedFromSnapshot]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  useEffect(() => {
    if (activeComposerFocus.key !== dk || Date.now() > activeComposerFocus.restoreUntil) return;
    const restore = () => {
      const el = inputRef.current;
      if (!el) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      el.focus({ preventScroll: true });
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    };
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [dk, input]);

  const rememberComposerFocus = useCallback(() => {
    activeComposerFocus.key = dkRef.current;
    activeComposerFocus.restoreUntil = Date.now() + 3000;
  }, []);

  const handleInputBlur = useCallback(() => {
    const keyAtBlur = dkRef.current;
    window.setTimeout(() => {
      if (activeComposerFocus.key !== keyAtBlur || Date.now() > activeComposerFocus.restoreUntil) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  }, []);

  const addComposerAttachments = useCallback((files: ArrayLike<File> | null | undefined) => {
    const nextFiles = Array.from(files || []).filter(file => file instanceof File);
    if (!nextFiles.length) return;
    const staged = nextFiles.map(file => makeComposerAttachment(file, 'adding'));
    setComposerAttachments(prev => [...prev, ...staged]);
    persistDraft(inputRef.current?.value || input, [...attachmentsRef.current.map(a => a.file), ...nextFiles]);

    void Promise.all(staged.map(async item => {
      try {
        await verifyComposerAttachmentFile(item.file);
        return { id: item.id, status: 'ready' as const };
      } catch (err: any) {
        return {
          id: item.id,
          status: 'failed' as const,
          error: err?.message || 'Read failed',
        };
      }
    })).then(results => {
      const byId = new Map(results.map(result => [result.id, result]));
      setComposerAttachments(prev => prev.map(item => {
        const result = byId.get(item.id);
        return result ? { ...item, status: result.status, error: result.error } : item;
      }));
    });
  }, [input, persistDraft]);

  const clearComposerAttachments = useCallback(() => {
    setPreviewImageId(null);
    setComposerAttachments(prev => {
      revokeComposerAttachments(prev);
      return [];
    });
  }, []);

  const removeComposerAttachment = useCallback((id: string) => {
    setComposerAttachments(prev => {
      const target = prev.find(item => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter(item => item.id !== id);
      persistDraft(inputValueRef.current, next.map(item => item.file));
      return next;
    });
    setPreviewImageId(current => current === id ? null : current);
  }, [persistDraft]);

  const buildMultiAgentPrompt = useCallback((prompt: string, agent: string, groupAgents: string[], runId: string) => {
    const peers = groupAgents.join(', ');
    return [
      `Multi-agent run: ${runId}`,
      `You are the ${agent} agent in a parallel run with: ${peers}.`,
      'Work independently in your own session. Make your output easy to synthesize later: include assumptions, key findings, risks, and recommended next steps. If the user later asks for synthesis, reference peer outputs by agent/session when available.',
      '',
      prompt,
    ].join('\n');
  }, []);

  const handleSend = useCallback(() => {
    const body = input.trim();
    const commentBlock = formatPendingReviewComments(pendingReviewComments);
    const prompt = [commentBlock, body].filter(Boolean).join('\n\n');
    if (composerAttachments.some(item => item.status !== 'ready')) return;
    const attachments = composerAttachments.map(item => item.file);
    if ((!prompt && attachments.length === 0) || sending) return;
    const targetAgent = selectedAgent
      || session.agent
      || agents.find(a => a.isDefault)?.agent
      || '';
    if (!targetAgent) return;
    const installedAgentIds = agents.filter(a => a.installed).map(a => a.agent);
    const targetMultiAgents = Array.from(new Set(
      multiAgentIds.filter(agent => installedAgentIds.includes(agent)),
    ));
    if (composerMode === 'multi' && !targetMultiAgents.length) return;
    const targetStatus = agents.find(a => a.agent === targetAgent) || null;
    // Per-session pick wins over the global runtime default. selectedModel/Effort
    // is set by applyCascade and only applies to this session's React state.
    const targetModel = (selectedModel || targetStatus?.selectedModel || '').trim() || null;
    const targetEffort = targetAgent === 'gemini'
      ? null
      : ((selectedEffort || targetStatus?.selectedEffort || '').trim() || null);
    if (composerMode === 'multi') {
      setSending(true);
      lastSentRef.current = { prompt, files: attachments };
      inputValueRef.current = '';
      setInput('');
      onClearPendingReviewComments?.();
      draftStore.delete(dkRef.current);
      writeDraftText(dkRef.current, '');
      clearDraftFiles(dkRef.current);
      clearComposerAttachments();
      setUploadingAttachmentCount(attachments.length);
      const previousAgent = session.agent || null;
      const previousSessionId = session.sessionId || null;
      const startedSessions: Array<{ agent: string; sessionId: string; workdir: string }> = [];
      const runId = `multi-${Date.now().toString(36)}`;
      Promise.allSettled(targetMultiAgents.map(async agent => {
        const status = agents.find(a => a.agent === agent) || null;
        const model = (status?.selectedModel || '').trim() || null;
        const effort = agent === 'gemini' ? null : ((status?.selectedEffort || '').trim() || null);
        const res = await api.sendSessionMessage(workdir, agent, '', buildMultiAgentPrompt(prompt || 'Please inspect the attached file(s).', agent, targetMultiAgents, runId), {
          attachments,
          model,
          effort,
          previousAgent: previousAgent && previousAgent !== agent ? previousAgent : null,
          previousSessionId: previousAgent && previousAgent !== agent ? previousSessionId : null,
        });
        if (!res.ok) throw new Error(res.error || `Failed to start ${agent}`);
        const nextSession = typeof res.sessionKey === 'string' ? parseSessionKey(res.sessionKey) : null;
        if (nextSession) startedSessions.push({ ...nextSession, workdir });
        return res;
      }))
        .then(results => {
          if (startedSessions.length) onMultiSessionChange?.(startedSessions, prompt);
          if (results.some(result => result.status === 'rejected') || !startedSessions.length) onSendFailed?.();
        })
        .finally(() => {
          setUploadingAttachmentCount(0);
          setSending(false);
        });
      return;
    }

    const isAgentSwitch = targetAgent !== session.agent;
    const targetSessionId = isAgentSwitch ? '' : session.sessionId;
    // When switching agent, pass the live session of the outgoing agent so the
    // backend can compact it and seed the new session's first turn — see
    // `compactForHandover` in src/agent/handover.ts. We deliberately don't send
    // these when the session id is unchanged: same-agent continuation goes via
    // the agent's own --resume.
    const previousAgent = isAgentSwitch && session.agent ? session.agent : null;
    const previousSessionId = isAgentSwitch && session.sessionId ? session.sessionId : null;
    setSending(true);
    // Stash content for potential recall restoration
    lastSentRef.current = { prompt, files: attachments };
    inputValueRef.current = '';
    setInput('');
    onClearPendingReviewComments?.();
    draftStore.delete(dkRef.current);
    writeDraftText(dkRef.current, '');
    clearDraftFiles(dkRef.current);
    // Create fresh preview URLs before clearing (clearing revokes the originals)
    const previewUrls = attachments.length
      ? attachments.filter(isImageFile).map(f => URL.createObjectURL(f))
      : undefined;
    clearComposerAttachments();
    setUploadingAttachmentCount(attachments.length);
    if (typeof editAtTurn === 'number') onEditSendStart?.(prompt, editAtTurn);
    onSendStart(prompt, previewUrls);
    onStreamQueued(); // Start polling immediately — don't wait for API response
    api.sendSessionMessage(workdir, targetAgent, targetSessionId, prompt, {
      attachments,
      model: targetModel,
      effort: targetEffort,
      previousAgent,
      previousSessionId,
    })
      .then(res => {
        if (!res.ok) {
          onSendFailed?.();
          return;
        }
        if (res.taskId) {
          setLocalTaskId(res.taskId);
          onSendTaskAssigned?.(res.taskId);
        }
        const nextSession = typeof res.sessionKey === 'string' ? parseSessionKey(res.sessionKey) : null;
        const switchedSession = !!nextSession
          && (nextSession.agent !== session.agent || nextSession.sessionId !== session.sessionId);
        if (switchedSession && nextSession) {
          onSessionChange?.({ ...nextSession, workdir });
        }
      })
      .catch(() => { onSendFailed?.(); })
      .finally(() => {
        setUploadingAttachmentCount(0);
        setSending(false);
      });
  }, [
    agents,
    clearComposerAttachments,
    composerAttachments,
    input,
    pendingReviewComments,
    onClearPendingReviewComments,
    onSendStart,
    onSendTaskAssigned,
    onSendFailed,
    onEditSendStart,
    onSessionChange,
    onMultiSessionChange,
    onStreamQueued,
    buildMultiAgentPrompt,
    selectedAgent,
    selectedEffort,
    selectedModel,
    composerMode,
    multiAgentIds,
    sending,
    session.agent,
    session.sessionId,
    workdir,
    editAtTurn,
  ]);

  // Task bar state — derived from snapshot + optimistic local state.
  // `effectiveQueuedIds` aggregates every queued task we know about so each one
  // gets its own row (instead of collapsing many queued tasks into one banner).
  const effectiveQueuedIds: string[] = (() => {
    const ids: string[] = [];
    if (queuedTaskIds && queuedTaskIds.length) ids.push(...queuedTaskIds);
    // When the snapshot itself is in `queued` phase the visible task is the
    // queued one — surface it as a queued row.
    if (streamPhase === 'queued' && streamTaskId && !ids.includes(streamTaskId)) {
      ids.unshift(streamTaskId);
    }
    // Optimistic local id for messages we just sent before the backend has
    // emitted the queued event yet.
    if (localTaskId && !ids.includes(localTaskId)) {
      const optimisticAllowed = streamPhase === 'queued' || (!streamPhase);
      if (optimisticAllowed) ids.push(localTaskId);
    }
    return ids;
  })();
  const effectiveQueuedKey = effectiveQueuedIds.join('\0');
  const effectiveQueuedId = effectiveQueuedIds[effectiveQueuedIds.length - 1] || null;
  const hasQueuedTask = effectiveQueuedIds.length > 0;
  const showTaskBar = hasQueuedTask;

  const toggleQueuedExpanded = useCallback((taskId: string) => {
    setExpandedQueuedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const reorderQueuedTask = useCallback(async (dragTaskId: string | null, targetTaskId: string) => {
    if (!dragTaskId || dragTaskId === targetTaskId || !onReorderQueued || reorderingQueued) return;
    const ids = effectiveQueuedKey ? effectiveQueuedKey.split('\0') : [];
    const from = ids.indexOf(dragTaskId);
    const to = ids.indexOf(targetTaskId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setReorderingQueued(true);
    setDragOverQueuedTaskId(null);
    try {
      await onReorderQueued(next);
    } finally {
      setReorderingQueued(false);
      setDraggingQueuedTaskId(null);
      setDragOverQueuedTaskId(null);
    }
  }, [effectiveQueuedKey, onReorderQueued, reorderingQueued]);

  const handleQueuedDragStart = useCallback((taskId: string, e: DragEvent<HTMLElement>) => {
    if (reorderingQueued || !onReorderQueued || effectiveQueuedIds.length < 2) {
      e.preventDefault();
      return;
    }
    setDraggingQueuedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }, [effectiveQueuedIds.length, onReorderQueued, reorderingQueued]);

  const handleQueuedDragEnd = useCallback(() => {
    setDraggingQueuedTaskId(null);
    setDragOverQueuedTaskId(null);
  }, []);

  useEffect(() => {
    setExpandedQueuedTaskIds(prev => {
      if (!prev.size) return prev;
      const liveIds = new Set(effectiveQueuedIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [effectiveQueuedKey]);

  // Clear per-task pending flags as their target tasks resolve.
  // A target is "resolved" once it's no longer in the queued list and is no
  // longer the active stream — i.e. the recall/steer landed on the server.
  useEffect(() => {
    const isLive = (id: string) => effectiveQueuedIds.includes(id) || id === streamTaskId;
    setRecallingIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (isLive(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
    setSteeringIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (isLive(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [effectiveQueuedKey, streamTaskId]);
  // Clear stashed files once queued task starts streaming (no longer recallable)
  useEffect(() => {
    if (!hasQueuedTask && lastSentRef.current.files.length) {
      lastSentRef.current = { prompt: '', files: [] };
    }
  }, [hasQueuedTask]);

  const handleRecallQueued = useCallback((taskId: string) => {
    if (recallingIds.has(taskId)) return;
    setRecallingIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
    // Only the most-recent queued task corresponds to the input the user just
    // sent; restoring stash for an older queued task would dump someone else's
    // prompt into the composer.
    if (taskId === effectiveQueuedId) {
      const stash = lastSentRef.current;
      if (stash.prompt) setInput(stash.prompt);
      if (stash.files.length) setComposerAttachments(stash.files.map(file => makeComposerAttachment(file, 'ready')));
      persistDraft(stash.prompt, stash.files);
      lastSentRef.current = { prompt: '', files: [] };
    }
    onRecall?.(taskId);
    if (taskId === localTaskId) setLocalTaskId(null);
  }, [recallingIds, effectiveQueuedId, localTaskId, onRecall, persistDraft]);

  const handleSteerQueued = useCallback((taskId: string) => {
    if (steeringIds.has(taskId)) return;
    setSteeringIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
    onSteer?.(taskId);
    if (taskId === localTaskId) setLocalTaskId(null);
  }, [steeringIds, localTaskId, onSteer]);

  const selectCommandOption = useCallback((option: ComposerCommandOption) => {
    const next = option.kind === 'builtin'
      ? option.insert
      : `/${option.skill.name} `;
    setInput(next);
    persistDraft(next);
    setSkillMenuOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, [persistDraft]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    persistDraft(value);
    // Open command menu while the entire composer is a single slash command.
    const isSlashCmd = /^\/[^\n]*$/.test(value);
    setSkillMenuOpen(isSlashCmd);
  }, [persistDraft]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (skillMenuOpen && commandOptions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSkillMenuIndex(i => (i + 1) % commandOptions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSkillMenuIndex(i => (i - 1 + commandOptions.length) % commandOptions.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !composingRef.current)) {
        e.preventDefault();
        const option = commandOptions[Math.min(skillMenuIndex, commandOptions.length - 1)];
        if (option) selectCommandOption(option);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSkillMenuOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); handleSend(); }
  };

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    e.preventDefault();
    addComposerAttachments(files);
  }, [addComposerAttachments]);

  const effectiveAgent = selectedAgent
    || session.agent
    || agents.find(a => a.isDefault)?.agent
    || agents.find(a => a.installed)?.agent
    || agents[0]?.agent
    || '';
  const currentAgent = agents.find(a => a.agent === effectiveAgent) || null;
  const cascadeAgentId = pendingAgent || effectiveAgent;
  const cascadeAgent = agents.find(a => a.agent === cascadeAgentId) || currentAgent;
  // Unified model list — native catalogue + "我的模型" Profiles the agent can
  // route through. Each row carries kind + profileId so the click handler
  // knows whether to clear the active Profile binding (native) or set it
  // (profile). The previous shape mixed native vs byok in one untyped
  // ModelInfo array which couldn't express the distinction.
  type CascadeModelRow = {
    id: string;
    /** What renders in the row. For Profiles this is the user-set name. */
    label: string;
    /** Discriminates the click handler. Native rows clear the Profile binding. */
    kind: 'native' | 'profile';
    /** Profile id when kind='profile'; the model id to send is `id`. */
    profileId?: string;
    /** Secondary line — provider name for Profile rows, alias for native. */
    description?: string;
  };
  const models = useMemo<CascadeModelRow[]>(() => {
    if (!cascadeAgent) return [];
    const out: CascadeModelRow[] = [];
    // Native section — the agent CLI's own model list. byokModels is no longer
    // used here because Profiles are now first-class entries below.
    for (const m of cascadeAgent.models || []) {
      out.push({
        id: m.id,
        label: m.id,
        kind: 'native',
        description: m.alias && m.alias.toLowerCase() !== m.id.toLowerCase() ? m.alias : undefined,
      });
    }
    // 我的模型 section — Profiles compatible with this agent's BYOK kinds.
    const acceptedKinds = new Set(AGENT_ACCEPTED_PROVIDER_KINDS[cascadeAgentId] || []);
    for (const p of profiles) {
      const provider = providers.find(x => x.id === p.providerId);
      if (!provider || !acceptedKinds.has(provider.kind)) continue;
      const showModelId = p.name.trim().toLowerCase() !== p.modelId.trim().toLowerCase();
      out.push({
        id: p.modelId,
        label: p.name,
        kind: 'profile',
        profileId: p.id,
        description: showModelId ? `${provider.name} · ${p.modelId}` : provider.name,
      });
    }
    return out;
  }, [cascadeAgent, cascadeAgentId, profiles, providers]);
  // First Profile row index for inserting the "我的模型" group header.
  const firstProfileIdx = useMemo(() => models.findIndex(m => m.kind === 'profile'), [models]);
  // Index of the currently-active Profile in the unified list (or -1).
  const activeProfileIdForAgent = activeProfiles[cascadeAgentId] || null;
  // Per-session cascade choice wins over the global runtime default. Falling
  // back to currentAgent fields means an unset session shows the user's global
  // default; once they pick from the cascade, that pick scopes to this session.
  const currentModel = selectedModel || currentAgent?.selectedModel || '';
  const currentEffort = effectiveAgent === 'gemini'
    ? ''
    : (selectedEffort || currentAgent?.selectedEffort || '');
  const effortLevels = EFFORT_OPTIONS[cascadeAgentId as keyof typeof EFFORT_OPTIONS] || [];
  const previewAttachment = previewImageId
    ? composerAttachments.find(item => item.id === previewImageId && item.previewUrl) || null
    : null;
  const activePreview: LightboxSource | null = previewAttachment
    ? {
        key: previewAttachment.id,
        url: previewAttachment.previewUrl!,
        name: previewAttachment.file.name,
        size: previewAttachment.file.size,
        file: previewAttachment.file,
        onRemove: () => removeComposerAttachment(previewAttachment.id),
      }
    : queuedPreviewUrl
      ? { key: queuedPreviewUrl, url: queuedPreviewUrl }
      : null;
  const hasPendingAttachments = composerAttachments.some(item => item.status === 'adding');
  const hasFailedAttachments = composerAttachments.some(item => item.status === 'failed');
  const installedMultiAgents = multiAgentIds.filter(agent => agents.some(a => a.installed && a.agent === agent));
  const canSend = (!!input.trim() || pendingReviewComments.length > 0 || composerAttachments.length > 0)
    && !sending
    && (composerMode === 'multi' ? installedMultiAgents.length > 0 : !!effectiveAgent)
    && !hasPendingAttachments
    && !hasFailedAttachments;

  const resetCascade = () => {
    setPendingAgent(null);
    setPendingModel(null);
    setPendingEffort(null);
    setPendingProfileSelection(undefined);
  };

  const applyCascade = useCallback(async (agent: string, model: string, effort: string | null) => {
    const nextEffort = agent === 'gemini' ? '' : (effort || '');
    // Profile binding is intentionally global (one binding per agent across
    // all sessions). When the user picks a Profile row in this cascade we
    // POST it through; native picks clear the binding. Per-session model and
    // effort overrides still flow only into local state and never touch
    // /api/runtime-agent, so other sessions keep their own pick.
    if (pendingProfileSelection !== undefined) {
      try {
        await fetch(`/api/models/agents/${agent}/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: pendingProfileSelection }),
        });
        void refreshModelLayer();
        void refreshAgentStatus();
      } catch { /* fall through — the per-session model id still applies */ }
    }
    setSelectedAgent(agent);
    setSelectedModel(model);
    setSelectedEffort(nextEffort);
    resetCascade();
    setCascadeStep('closed');
  }, [pendingProfileSelection, refreshModelLayer, refreshAgentStatus]);

  const toggleCascade = () => {
    if (cascadeStep === 'closed') {
      resetCascade();
      refreshAgentStatus();
      void refreshModelLayer();
      setCascadeStep('agent');
    } else { resetCascade(); setCascadeStep('closed'); }
  };

  // Build summary label for the cascade trigger
  const displayAgent = pendingAgent || effectiveAgent;
  const displayMeta = getAgentMeta(displayAgent);
  const displayModel = pendingModel ?? currentModel;
  const displayEffort = pendingEffort ?? currentEffort;
  const shortModel = displayModel ? shortenModel(displayModel) : '';

  // BYOK binding for the agent currently shown in the chip. When present we
  // splice in a provider chip (logo + user-set name) between the agent label
  // and the model id so the chip surfaces both pieces of identity.
  const displayProfile = (() => {
    const id = activeProfiles[displayAgent];
    return id ? profiles.find(p => p.id === id) ?? null : null;
  })();
  const displayProvider = displayProfile
    ? providers.find(p => p.id === displayProfile.providerId) ?? null
    : null;
  const displayProviderBrand = displayProvider ? brandIdForProvider(displayProvider) : null;
  // When a Profile is bound, prefer the user-set Profile name over the raw
  // model id. Matches the cascade row label. Fall back to the shortened model
  // id when there's no Profile (native auth) or when the user named the
  // Profile identical to its modelId.
  const displayModelLabel = displayProfile
    && displayProfile.name.trim().toLowerCase() !== displayProfile.modelId.trim().toLowerCase()
    ? displayProfile.name
    : shortModel;

  // Plain-text fallback used as the button tooltip when the user hovers.
  const cascadeLabel = [
    displayMeta.shortLabel,
    displayProvider ? displayProvider.name : null,
    displayModelLabel || null,
    displayEffort ? displayEffort.charAt(0).toUpperCase() + displayEffort.slice(1) : null,
  ].filter(Boolean).join(' / ');

  return (
    <div className="composer-shell shrink-0" ref={composerRef}>
      {/* Floating centered input area */}
      <div className="w-full max-w-[860px] mx-auto px-4 pb-4 pt-2 sm:px-3">
        {/* Task control bar — queued follow-ups only. Active streams use the inline stop button near Send. */}
        {showTaskBar && (
          <div className="mb-2 space-y-1.5">
            {/* One row per queued task — each carries its own steer/recall. */}
            {effectiveQueuedIds.length > 0 && (
              <div className="max-h-[min(32vh,260px)] space-y-1.5 overflow-y-auto overscroll-contain pr-1 -mr-1">
                {effectiveQueuedIds.map((taskId, idx) => {
                  const isLatest = idx === effectiveQueuedIds.length - 1;
                  const positionLabel = effectiveQueuedIds.length > 1 ? `${t('hub.queued')} #${idx + 1}` : t('hub.queued');
                  // Per-task prompt + images come from pendingQueuedSends (client-
                  // only blob URLs) with the server snapshot as the text fallback.
                  // Server queue state doesn't carry image data, so an older
                  // queued row that survives a refresh just shows the text.
                  const optimistic = pendingQueuedSends?.find(p => p.taskId === taskId)
                    || (isLatest ? pendingQueuedSends?.find(p => !p.taskId) : undefined);
                  const taskPrompt = queuedTasks?.find(qt => qt.taskId === taskId)?.prompt
                    || optimistic?.prompt
                    || null;
                  const taskImages = optimistic?.imageUrls?.length ? optimistic.imageUrls : [];
                  const isExpanded = expandedQueuedTaskIds.has(taskId);
                  return (
                    <div
                      key={taskId}
                      onDragOver={e => {
                        if (!draggingQueuedTaskId || draggingQueuedTaskId === taskId || reorderingQueued) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverQueuedTaskId !== taskId) setDragOverQueuedTaskId(taskId);
                      }}
                      onDragLeave={e => {
                        const nextTarget = e.relatedTarget;
                        if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return;
                        if (dragOverQueuedTaskId === taskId) setDragOverQueuedTaskId(null);
                      }}
                      onDrop={e => {
                        if (!draggingQueuedTaskId || reorderingQueued) return;
                        e.preventDefault();
                        const draggedTaskId = e.dataTransfer.getData('text/plain') || draggingQueuedTaskId;
                        void reorderQueuedTask(draggedTaskId, taskId);
                      }}
                      className={cn(
                        'flex gap-2.5 rounded-lg border border-warn/30 bg-panel/60 px-3.5 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md transition-[background-color,border-color,box-shadow,opacity]',
                        isExpanded ? 'items-start' : 'items-center',
                        draggingQueuedTaskId === taskId && 'opacity-55',
                        dragOverQueuedTaskId === taskId && draggingQueuedTaskId !== taskId && 'border-warn/70 bg-panel/75 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.22),0_8px_24px_rgba(15,23,42,0.08)]'
                      )}
                    >
                      {effectiveQueuedIds.length > 1 && (
                        <button
                          type="button"
                          draggable={!reorderingQueued}
                          onDragStart={e => handleQueuedDragStart(taskId, e)}
                          onDragEnd={handleQueuedDragEnd}
                          title={t('hub.reorderQueuedHint')}
                          aria-label={t('hub.reorderQueuedHint')}
                          className={cn(
                            'mt-0.5 grid h-4 w-3 shrink-0 place-items-center rounded text-warn/60 transition-colors hover:bg-warn/10 hover:text-warn active:cursor-grabbing',
                            isExpanded ? 'mt-1.5' : '',
                            reorderingQueued ? 'cursor-wait opacity-40' : 'cursor-grab'
                          )}
                        >
                          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
                            <circle cx="3" cy="2" r="1" />
                            <circle cx="7" cy="2" r="1" />
                            <circle cx="3" cy="6" r="1" />
                            <circle cx="7" cy="6" r="1" />
                            <circle cx="3" cy="10" r="1" />
                            <circle cx="7" cy="10" r="1" />
                          </svg>
                        </button>
                      )}
                      <span className={cn('h-1.5 w-1.5 rounded-full bg-warn animate-pulse shrink-0', isExpanded && 'mt-2')} />
                      <div className="flex-1 min-w-0">
                        <div className={cn('flex min-w-0 gap-2', isExpanded ? 'items-start flex-wrap' : 'items-center')}>
                          <button
                            type="button"
                            onClick={() => toggleQueuedExpanded(taskId)}
                            title={taskPrompt || positionLabel}
                            className={cn(
                              'inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 -ml-1 text-left transition-colors hover:bg-warn/10',
                              isExpanded ? 'shrink-0' : 'flex-1'
                            )}
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={cn('shrink-0 transition-transform', isExpanded && 'rotate-90')}
                            >
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                            <span className="shrink-0 text-[12px] font-medium text-warn">{positionLabel}</span>
                            {!isExpanded && taskPrompt && (
                              <span className="min-w-0 truncate text-[11px] text-fg-5/60">{taskPrompt}</span>
                            )}
                          </button>
                          {taskImages.length > 0 && (
                            <div className="flex items-center gap-1 shrink-0">
                              {taskImages.slice(0, 3).map((url, i) => (
                                <button
                                  key={`${url}-${i}`}
                                  type="button"
                                  onClick={() => setQueuedPreviewUrl(url)}
                                  title={t('hub.previewImage')}
                                  className="block h-5 w-5 shrink-0 overflow-hidden rounded border border-warn/30 transition-opacity hover:opacity-80"
                                >
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                              {taskImages.length > 3 && (
                                <span className="text-[10px] text-fg-5/60">+{taskImages.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {isExpanded && taskPrompt && (
                          <div
                            title={taskPrompt}
                            className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-warn/[0.035] px-2 py-1.5 text-left text-[11px] text-fg-5/70"
                          >
                            {taskPrompt}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleSteerQueued(taskId)}
                          disabled={steeringIds.has(taskId)}
                          title={t('hub.steerHint')}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-fg-4 hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          {steeringIds.has(taskId)
                            ? <Spinner className="h-2.5 w-2.5" />
                            : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>}
                          {t('hub.steer')}
                        </button>
                        <button
                          onClick={() => handleRecallQueued(taskId)}
                          disabled={recallingIds.has(taskId)}
                          title={t('hub.recallHint')}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-fg-4 hover:text-err hover:bg-err/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          {recallingIds.has(taskId)
                            ? <Spinner className="h-2.5 w-2.5" />
                            : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>}
                          {t('hub.recall')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="relative rounded-xl border border-control-border bg-control shadow-[var(--th-composer-shadow)] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-control-border-h focus-within:shadow-[var(--th-composer-shadow-focus)]">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => {
              addComposerAttachments(e.target.files);
              e.target.value = '';
            }}
          />

          {composerAttachments.length > 0 && (
            <div className="px-3 pt-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-fg-5">
                <span className="uppercase tracking-wider">{t('hub.attachments')}</span>
                <span className="rounded-full border border-edge/35 bg-panel-alt/45 px-1.5 py-0.5">
                  {composerAttachments.length}
                </span>
                <span className={cn(
                  'rounded-full px-1.5 py-0.5',
                  hasFailedAttachments
                    ? 'bg-err/10 text-err'
                    : hasPendingAttachments
                      ? 'bg-warn/10 text-warn'
                      : 'bg-ok/10 text-ok',
                )}>
                  {hasFailedAttachments
                    ? t('hub.attachmentFailed')
                    : hasPendingAttachments
                      ? t('hub.attachmentAdding')
                      : t('hub.attachmentReady')}
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {composerAttachments.map(item => {
                  const isImage = !!item.previewUrl;
                  const fileExt = attachmentExtension(item.file);
                  return (
                  <div key={item.id} className="relative shrink-0">
                    {isImage ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImageId(item.id)}
                        title={t('hub.previewImage')}
                        className="group relative h-[72px] w-[72px] overflow-hidden rounded-lg border border-edge/30 bg-panel-alt/30"
                      >
                        <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                        <AttachmentTileChrome item={item} t={t} />
                      </button>
                    ) : (
                      <div
                        title={item.file.name}
                        className="relative flex h-[72px] w-[72px] flex-col items-center justify-center overflow-hidden rounded-lg border border-edge/30 bg-panel-alt/45 px-2 text-center"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="mb-1 text-fg-5/75">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        <div className="max-w-full truncate text-[9px] font-semibold uppercase tracking-wide text-fg-4">{fileExt}</div>
                        <AttachmentTileChrome item={item} t={t} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeComposerAttachment(item.id);
                      }}
                      title={t('hub.removeAttachment')}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white/75 transition-colors hover:bg-black/80 hover:text-white"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6 6 18" />
                        <path d="M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex min-w-0 items-center gap-2 px-3 pt-2">
            <div className="inline-flex shrink-0 rounded-lg border border-edge/60 bg-panel-alt/50 p-0.5">
              {(['single', 'multi'] as ComposerMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setComposerMode(mode);
                    if (mode === 'multi') setCascadeStep('closed');
                  }}
                  className={cn(
                    'h-6 rounded-md px-2 text-[10px] font-medium transition-colors',
                    composerMode === mode
                      ? 'bg-panel text-fg shadow-sm'
                      : 'text-fg-5 hover:bg-panel-h/70 hover:text-fg-3',
                  )}
                >
                  {mode === 'single' ? t('hub.modeSingle') : t('hub.modeMulti')}
                </button>
              ))}
            </div>
            {composerMode === 'multi' && (
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {agents.filter(a => a.installed).map(agent => {
                  const selected = multiAgentIds.includes(agent.agent);
                  const meta = getAgentMeta(agent.agent);
                  return (
                    <button
                      key={agent.agent}
                      type="button"
                      onClick={() => {
                        setMultiAgentIds(prev => {
                          if (prev.includes(agent.agent)) {
                            const next = prev.filter(id => id !== agent.agent);
                            return next.length ? next : prev;
                          }
                          return [...prev, agent.agent];
                        });
                      }}
                      title={meta.label}
                      className={cn(
                        'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors',
                        selected
                          ? 'border-primary/35 bg-primary/10 text-fg'
                          : 'border-edge/45 bg-transparent text-fg-5 hover:border-edge-h hover:bg-panel-h/60 hover:text-fg-3',
                      )}
                    >
                      <BrandIcon brand={agent.agent} size={12} />
                      <span>{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Slash command autocomplete */}
          {skillMenuOpen && commandOptions.length > 0 && (
            <div
              ref={skillMenuRef}
              className="mx-2.5 mt-2 max-h-[190px] overflow-y-auto rounded-lg border border-edge/35 bg-panel-alt/85 p-1 shadow-sm animate-in"
              role="listbox"
              aria-label={t('hub.commands')}
            >
              <div className="flex h-7 items-center justify-between px-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-5">{t('hub.commands')}</span>
                <span className="text-[10px] text-fg-5/55">{t('hub.commandMenuHint')}</span>
              </div>
              <div className="space-y-0.5">
                {commandOptions.map((option, idx) => {
                  const isBuiltin = option.kind === 'builtin';
                  const title = isBuiltin
                    ? t(option.labelKey)
                    : (option.skill.label || option.skill.name);
                  const description = isBuiltin
                    ? t(option.descriptionKey)
                    : option.skill.description;
                  return (
                    <button
                      key={`${option.kind}:${option.command}`}
                      data-command-idx={idx}
                      role="option"
                      aria-selected={idx === skillMenuIndex}
                      onMouseDown={e => { e.preventDefault(); selectCommandOption(option); }}
                      onMouseEnter={() => setSkillMenuIndex(idx)}
                      className={cn(
                        'grid min-h-[38px] w-full grid-cols-[minmax(105px,0.8fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
                        idx === skillMenuIndex
                          ? 'bg-blue-400/10 text-fg ring-1 ring-blue-400/20'
                          : 'text-fg-4 hover:bg-panel-h/60',
                      )}
                    >
                      <span className="min-w-0 truncate font-mono text-[12px] font-semibold">/{option.command}</span>
                      <span className="rounded border border-edge/25 bg-control px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fg-5">
                        {isBuiltin ? t('hub.commandBuiltIn') : t('hub.commandSkill')}
                      </span>
                      <span className="min-w-0">
                        {title && <span className="block truncate text-[11.5px] font-medium text-fg-3">{title}</span>}
                        {description && (
                          <span className="block truncate text-[10.5px] text-fg-5/70">{description}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {pendingReviewComments.length > 0 && (
            <div className="mx-2.5 mt-2 rounded-lg border border-edge bg-panel-alt/70 px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-fg-4">
                <span>{t('session.pendingComments').replace('{count}', String(pendingReviewComments.length))}</span>
                <button
                  type="button"
                  onClick={onClearPendingReviewComments}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-5 transition hover:bg-panel-h hover:text-fg-2"
                >
                  {t('session.clearComments')}
                </button>
              </div>
              <div className="flex max-h-[74px] flex-col gap-1 overflow-y-auto">
                {pendingReviewComments.map((comment, index) => (
                  <div key={comment.id} className="group/comment flex min-w-0 items-start gap-2 rounded-md bg-control/60 px-2 py-1">
                    <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      #{index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-fg-3">{comment.note}</div>
                      <div className="truncate text-[10px] text-fg-5">{comment.quote}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemovePendingReviewComment?.(comment.id)}
                      className="shrink-0 rounded px-1 text-[13px] leading-5 text-fg-5 opacity-70 transition hover:bg-panel-h hover:text-fg group-hover/comment:opacity-100"
                      aria-label={t('session.removeComment')}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={rememberComposerFocus}
            onBlur={handleInputBlur}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            placeholder={t('hub.inputPlaceholder')}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13.5px] text-fg outline-none placeholder:text-fg-5/45 leading-[1.6]"
            style={{ maxHeight: 200, overflow: input.split('\n').length > 6 ? 'auto' : 'hidden' }}
          />

          {/* Bottom bar: cascade selector + send */}
          <div className="composer-bottom-bar flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5 pb-2 pt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t('hub.addAttachments')}
              aria-label={t('hub.addAttachments')}
              className="composer-attach-button inline-flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] leading-none text-fg-5/50 transition-colors hover:bg-panel-h/60 hover:text-fg-3"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" className="shrink-0">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              <span className="composer-attach-label truncate whitespace-nowrap">{t('hub.addAttachments')}</span>
            </button>

            {/* Cascade config trigger */}
            {composerMode === 'single' ? (
              <button
                ref={triggerRef}
                onClick={toggleCascade}
                disabled={!agents.length}
                title={agents.length ? cascadeLabel : undefined}
                className={cn(
                  'composer-cascade-trigger flex min-w-0 items-center gap-1.5 h-[28px] px-2.5 rounded-lg text-[11px] font-medium transition-all duration-200 select-none',
                  cascadeStep !== 'closed'
                    ? 'bg-panel-h border border-edge-h text-fg-3'
                    : 'text-fg-5/60 hover:text-fg-4 hover:bg-panel-h/50 border border-transparent',
                )}
              >
                {agents.length
                  ? <BrandIcon brand={displayAgent} size={12} />
                  : <Spinner className="h-3 w-3" />}
                {agents.length ? (
                  <span className="composer-cascade-label flex items-center gap-1 max-w-[460px] min-w-0 truncate">
                    <span className="shrink-0">{displayMeta.shortLabel}</span>
                    {displayProvider && (
                      <>
                        <span className="text-fg-5/40 shrink-0">/</span>
                        <BrandIcon brand={displayProviderBrand || 'custom'} size={12} />
                        <span className="shrink-0 truncate max-w-[140px]">{displayProvider.name}</span>
                      </>
                    )}
                    {displayModelLabel && (
                      <>
                        <span className="text-fg-5/40 shrink-0">/</span>
                        <span className="truncate" title={displayModel || undefined}>{displayModelLabel}</span>
                      </>
                    )}
                    {displayEffort && (
                      <>
                        <span className="text-fg-5/40 shrink-0">/</span>
                        <span className="shrink-0">{displayEffort.charAt(0).toUpperCase() + displayEffort.slice(1)}</span>
                      </>
                    )}
                  </span>
                ) : (
                  <span className="max-w-[420px] truncate">{t('hub.selectAgent')}</span>
                )}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={cn('text-fg-5/30 transition-transform duration-200', cascadeStep !== 'closed' && 'rotate-180')}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            ) : (
              <div className="composer-cascade-trigger flex min-w-0 items-center gap-1.5 h-[28px] px-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] text-[11px] font-medium text-fg-4">
                <span className="shrink-0">{t('hub.multiAgents')}</span>
                <span className="truncate text-fg-5">{installedMultiAgents.length}</span>
              </div>
            )}

            {/* Cascade dropdown — rendered via portal to escape overflow:hidden */}
            {cascadeStep !== 'closed' && cascadePos && createPortal(
              <div
                id="cascade-portal"
                className="fixed z-[200] w-[300px] rounded-xl border border-edge-h/70 bg-dropdown shadow-lg overflow-hidden animate-in"
                style={{ left: cascadePos.left, bottom: cascadePos.bottom }}
              >
                {/* Step header */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-edge/20">
                  {cascadeStep !== 'agent' && (
                    <button
                      onClick={() => {
                        if (cascadeStep === 'effort') {
                          // For agents that don't support model switching the
                          // model step was skipped on the way in, so back from
                          // effort goes straight to agent.
                          const supportsModelSwitch = cascadeAgent?.capabilities?.modelSwitch !== false;
                          setCascadeStep(supportsModelSwitch ? 'model' : 'agent');
                        } else {
                          setCascadeStep('agent');
                        }
                      }}
                      className="p-0.5 rounded text-fg-5/50 hover:text-fg-3 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  )}
                  <span className="text-[10px] font-semibold text-fg-5 uppercase tracking-wider">
                    {cascadeStep === 'agent' ? t('hub.selectAgent') : cascadeStep === 'model' ? t('hub.selectModel') : t('hub.selectEffort')}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    {(() => {
                      const supportsModelSwitch = cascadeAgent?.capabilities?.modelSwitch !== false;
                      const steps = supportsModelSwitch
                        ? (['agent', 'model', 'effort'] as const)
                        : (['agent', 'effort'] as const);
                      const activeIdx = steps.indexOf(cascadeStep as any);
                      return steps.map((step, idx) => (
                        <span key={step} className={cn(
                          'w-1.5 h-1.5 rounded-full transition-colors',
                          cascadeStep === step ? 'bg-primary' : idx < activeIdx ? 'bg-primary/40' : 'bg-fg-5/15',
                        )} />
                      ));
                    })()}
                  </div>
                </div>

                {/* Step content */}
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {cascadeStep === 'agent' && agents.filter(a => a.installed).map(a => {
                    const am = getAgentMeta(a.agent);
                    return (
                      <CascadeItem key={a.agent} selected={a.agent === (pendingAgent || effectiveAgent)} onClick={() => {
                        setPendingAgent(a.agent);
                        setPendingModel(a.selectedModel || '');
                        setPendingEffort(a.selectedEffort || '');
                        // Agents that lock the model at profile-binding time skip the
                        // model step. We jump straight to effort (or close if the
                        // agent has no effort knob either).
                        const supportsModelSwitch = a.capabilities?.modelSwitch !== false;
                        if (!supportsModelSwitch) {
                          const efforts = EFFORT_OPTIONS[a.agent as keyof typeof EFFORT_OPTIONS] || [];
                          if (efforts.length) setCascadeStep('effort');
                          else { void applyCascade(a.agent, a.selectedModel || '', null); }
                          return;
                        }
                        setCascadeStep('model');
                      }}>
                        <BrandIcon brand={a.agent} size={14} />
                        <span>{am.label}</span>
                      </CascadeItem>
                    );
                  })}
                  {cascadeStep === 'model' && (
                    <>
                      {models.map((m, idx) => {
                        // Group header: insert a small label row before the first
                        // native row and before the first Profile row so the user
                        // can see at a glance which catalogue they're picking from.
                        const showNativeHeader = idx === 0 && m.kind === 'native';
                        const showProfileHeader = idx === firstProfileIdx && m.kind === 'profile';
                        // "Current" highlighting:
                        //  - Profile rows light up when the row's profileId is the
                        //    one the agent is currently bound to (or staged this turn).
                        //  - Native rows light up when no Profile is bound (or the
                        //    user just staged "switch to native") AND the model id
                        //    matches.
                        const stagedProfile = pendingProfileSelection !== undefined
                          ? pendingProfileSelection
                          : activeProfileIdForAgent;
                        const isSelected = m.kind === 'profile'
                          ? !!m.profileId && m.profileId === stagedProfile
                          : !stagedProfile && m.id === (pendingModel ?? currentModel);
                        return (
                          <div key={`${m.kind}:${m.profileId || m.id}`}>
                            {showNativeHeader && (
                              <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-5">{t('hub.modelGroupNative')}</div>
                            )}
                            {showProfileHeader && (
                              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-fg-5">{t('hub.modelGroupProfiles')}</div>
                            )}
                            <CascadeItem selected={isSelected} onClick={() => {
                              const finalAgent = pendingAgent || effectiveAgent;
                              setPendingModel(m.id);
                              setPendingProfileSelection(m.profileId ?? null);
                              if (EFFORT_OPTIONS[finalAgent as keyof typeof EFFORT_OPTIONS]?.length) {
                                setCascadeStep('effort');
                                return;
                              }
                              void applyCascade(finalAgent, m.id, null);
                            }}>
                              <div className="min-w-0 flex-1">
                                <div className={cn('truncate text-[11.5px]', m.kind === 'native' && 'font-mono text-[11px]')} title={m.id}>
                                  {m.label}
                                </div>
                                {m.description && (
                                  <div className="truncate text-[10px] text-fg-5/80">{m.description}</div>
                                )}
                              </div>
                            </CascadeItem>
                          </div>
                        );
                      })}
                      {models.length === 0 && <div className="px-3 py-3 text-[11px] text-fg-5 text-center">{t('config.noModel')}</div>}
                    </>
                  )}
                  {cascadeStep === 'effort' && effortLevels.map(e => (
                    <CascadeItem key={e} selected={e === (pendingEffort || currentEffort)} onClick={() => {
                      setPendingEffort(e);
                      const finalAgent = pendingAgent || effectiveAgent;
                      const finalModel = pendingModel ?? currentModel;
                      void applyCascade(finalAgent, finalModel, e);
                    }}>
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </CascadeItem>
                  ))}
                </div>
              </div>,
              document.body,
            )}

            <div className="min-w-0 flex-1" />

            <ContextUsageChip chip={contextChip} />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              title={canSend ? t('hub.sendHint') : t('hub.send')}
              aria-label={sending ? (uploadingAttachmentCount > 0 ? t('hub.uploadingAttachments') : t('hub.sending')) : t('hub.send')}
              className={cn(
                'composer-send-button inline-flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium leading-none transition-all duration-200',
                canSend
                  ? 'bg-primary text-primary-fg hover:brightness-110 shadow-sm'
                  : 'bg-fg/6 text-fg-5/20',
              )}
            >
              {sending
                ? <Spinner className="h-3.5 w-3.5" />
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
              }
              <span className="composer-send-label whitespace-nowrap">
                {sending ? (uploadingAttachmentCount > 0 ? t('hub.uploadingAttachments') : t('hub.sending')) : t('hub.send')}
              </span>
            </button>
          </div>
        </div>
      </div>

      <ComposerImageLightbox
        source={activePreview}
        onClose={() => { setPreviewImageId(null); setQueuedPreviewUrl(null); }}
        t={t}
      />
    </div>
  );
});

function attachmentExtension(file: File): string {
  const name = file.name || '';
  const ext = name.includes('.') ? name.split('.').pop()?.trim() : '';
  if (ext) return ext.slice(0, 5);
  const subtype = file.type.includes('/') ? file.type.split('/').pop()?.trim() : '';
  return (subtype || 'file').slice(0, 5);
}

function AttachmentTileChrome({ item, t }: {
  item: ComposerAttachment;
  t: (k: string) => string;
}) {
  const failed = item.status === 'failed';
  const adding = item.status === 'adding';
  return (
    <>
      <div className="pointer-events-none absolute left-1 top-1">
        <span className={cn(
          'inline-flex h-4 items-center gap-1 rounded-full px-1.5 text-[8px] font-semibold leading-none shadow-sm backdrop-blur',
          failed
            ? 'bg-err/90 text-white'
            : adding
              ? 'bg-warn/90 text-white'
              : 'bg-black/58 text-white/90',
        )}>
          {adding && <Spinner className="h-2 w-2" />}
          {!adding && (
            <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-white/90' : 'bg-ok')} />
          )}
          {failed ? t('hub.attachmentFailed') : adding ? t('hub.attachmentAdding') : t('hub.attachmentReady')}
        </span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-1.5 pb-1 pt-3 text-left">
        <div className="truncate text-[8px] font-medium text-white/90 leading-tight">{item.file.name}</div>
        <div className="truncate text-[7px] text-white/62 leading-tight">{formatFileSize(item.file.size)}</div>
      </div>
    </>
  );
}

type LightboxSource = {
  key: string;
  url: string;
  name?: string;
  size?: number;
  file?: File;
  onRemove?: () => void;
};

function ComposerImageLightbox({ source, onClose, t }: {
  source: LightboxSource | null;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [source?.key]);

  useEffect(() => {
    if (!source) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [source, onClose]);

  if (!source) return null;

  const file = source.file;
  const onRemove = source.onRemove;

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[1024px]" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-[11px] text-white/72">
          {source.name && <span className="truncate font-medium text-white/90">{source.name}</span>}
          {typeof source.size === 'number' && <span>{formatFileSize(source.size)}</span>}
          <div className="ml-auto flex items-center gap-2">
            {file && (
              <button
                type="button"
                onClick={async () => {
                  if (!await copyImageFile(file)) return;
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                className="rounded-lg border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/88 transition-colors hover:bg-white/14"
              >
                {copied ? t('hub.copied') : t('hub.copyImage')}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="rounded-lg border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/88 transition-colors hover:bg-white/14"
              >
                {t('hub.removeAttachment')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/10 text-white/88 transition-colors hover:bg-white/14"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
          <img src={source.url} alt={source.name || ''} className="max-h-[80vh] w-full object-contain" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════════════
   Cascade item
   ═══════════════════════════════════════════════════════════════ */
export function CascadeItem({ selected, onClick, children }: {
  selected?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-2 text-[12px] text-left transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:bg-selected-h focus-visible:shadow-[inset_3px_0_0_var(--th-selection-accent)]',
        selected
          ? 'bg-selected font-medium text-fg shadow-[inset_3px_0_0_var(--th-selection-accent)] hover:bg-selected-h'
          : 'text-fg-2 hover:bg-selected hover:text-fg hover:shadow-[inset_3px_0_0_var(--th-selection-border)]',
      )}
    >
      {children}
      {selected && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ml-auto text-ok">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {!selected && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-fg-5/20">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      )}
    </button>
  );
}
