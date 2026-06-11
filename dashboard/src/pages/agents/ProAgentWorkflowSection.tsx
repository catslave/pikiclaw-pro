import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { BrandIcon } from '../../components/BrandIcon';
import { AssistantPromptDialog, AssistantRunDialog } from '../../components/assistant/OwnerAssistantStrip';
import { Badge, Button, CountBadge, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import type { Locale } from '../../i18n';
import { useStore } from '../../store';
import { cn } from '../../utils';
import type { AgentAssistant, AssistantHistoryItem, AutomationRule } from '../../types';

function fmt(value: string | undefined) {
  if (!value) return '--';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
}

function Empty({ title, label, action }: { title: string; label?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-panel-alt px-4 py-7 text-center">
      <div className="text-sm font-semibold text-fg-2">{title}</div>
      {label && <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-fg-5">{label}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const FALLBACK_AGENTS = ['codex', 'claude', 'copilot', 'cursor', 'agy', 'gemini', 'hermes'];
const OPEN_SESSIONS_STORAGE_KEY = 'pikiclaw:session-workspace:open-sessions:v1';
const ACTIVE_SLOT_STORAGE_KEY = 'pikiclaw:session-workspace:active-slot:v1';
const ASSISTANT_HISTORY_LIMIT = 'all';
const SCHEDULE_PRESETS = [
  { value: 'one-time', labelKey: 'scheduleOneTime' },
  { value: 'daily', labelKey: 'scheduleDaily' },
  { value: 'weekly', labelKey: 'scheduleWeekly' },
  { value: 'biweekly', labelKey: 'scheduleBiweekly' },
  { value: 'monthly', labelKey: 'scheduleMonthly' },
  { value: 'custom', labelKey: 'scheduleCustom' },
] as const;
const defaultAssistantDraft = { name: '', responsibility: '', preferredAgents: [] as string[] };
const defaultJobDraft = { prompt: '', scheduleType: 'one-time', customSchedule: '', assistantId: '' };
type AssistantAgentOption = { value: string; label: string; installed: boolean };
type SchedulePresetLabelKey = typeof SCHEDULE_PRESETS[number]['labelKey'];

type ProCopy = {
  assistantsTitle: string;
  assistantsDescription: string;
  createAssistant: string;
  assistantCount: (count: number) => string;
  assistantReadyCount: (count: number) => string;
  noAssistantsTitle: string;
  noAssistantsDescription: string;
  noResponsibility: string;
  runtimeDefault: string;
  history: string;
  configure: string;
  noHistoryTitle: string;
  noHistoryDescription: string;
  historyTitle: (name: string) => string;
  historyDescription: string;
  sourceTask: string;
  sourceJira: string;
  sourceJob: string;
  turns: (count: number) => string;
  editAssistant: string;
  createAssistantTitle: string;
  assistantNamePlaceholder: string;
  assistantResponsibilityPlaceholder: string;
  agentsLabel: string;
  delete: string;
  cancel: string;
  save: string;
  automationTitle: string;
  automationDescription: string;
  createJob: string;
  jobCount: (count: number) => string;
  runCount: (count: number) => string;
  jobsTitle: string;
  historyPanelTitle: string;
  noJobsTitle: string;
  noJobsDescription: string;
  noRunsTitle: string;
  noRunsDescription: string;
  lastRun: (value: string) => string;
  run: string;
  queued: string;
  failed: string;
  agentLabel: string;
  assistantLabel: string;
  createJobTitle: string;
  jobPromptPlaceholder: string;
  selectAssistant: string;
  customSchedulePlaceholder: string;
  openChat: string;
  activeJobsLabel: string;
  recurringJobsLabel: string;
  latestRunLabel: string;
  assistantTargetsLabel: string;
  neverRun: string;
  openRunChat: string;
} & Record<SchedulePresetLabelKey, string>;

function getCopy(locale: Locale): ProCopy {
  if (locale === 'zh-CN') {
    return {
      assistantsTitle: 'Pro 助手',
      assistantsDescription: '把 refinement、coding、ticket sync 和 knowledge 拆成明确角色，减少每次启动任务时的上下文噪音。',
      createAssistant: '创建助手',
      assistantCount: count => `${count} 个助手`,
      assistantReadyCount: count => `${count} 个已绑定智能体`,
      noAssistantsTitle: '还没有 Pro 助手',
      noAssistantsDescription: '先创建一个角色助手，后续任务和自动化就能复用这份边界。',
      noResponsibility: '尚未配置职责。',
      runtimeDefault: '运行时默认',
      history: '历史',
      configure: '配置',
      noHistoryTitle: '还没有历史会话',
      noHistoryDescription: '通过该助手触发任务后，这里会沉淀可回看的聊天记录。',
      historyTitle: name => `${name} 历史`,
      historyDescription: '这个助手创建过的归档聊天。',
      sourceTask: '任务',
      sourceJira: 'Jira',
      sourceJob: '作业',
      turns: count => `${count} 轮`,
      editAssistant: '编辑助手',
      createAssistantTitle: '创建助手',
      assistantNamePlaceholder: '助手名称',
      assistantResponsibilityPlaceholder: '职责、边界、输出要求，以及什么时候该使用它',
      agentsLabel: '可用智能体',
      delete: '删除',
      cancel: '取消',
      save: '保存',
      automationTitle: '自动化',
      automationDescription: '让助手按固定节奏跑任务，作业配置和执行记录分开展示。',
      createJob: '创建作业',
      jobCount: count => `${count} 个作业`,
      runCount: count => `${count} 次执行`,
      jobsTitle: '作业',
      historyPanelTitle: '执行历史',
      noJobsTitle: '还没有自动化作业',
      noJobsDescription: '选择一个助手，写下要定期完成的工作，就能把重复任务收进 Pro 工作流。',
      noRunsTitle: '还没有执行记录',
      noRunsDescription: '作业被手动运行或按计划触发后，结果会出现在这里。',
      lastRun: value => `上次运行 ${value}`,
      run: '运行',
      queued: '已排队',
      failed: '失败',
      agentLabel: '智能体',
      assistantLabel: '助手',
      createJobTitle: '创建自动化作业',
      jobPromptPlaceholder: '这个助手应该做什么？',
      selectAssistant: '选择助手',
      customSchedulePlaceholder: '自定义计划，例如 every weekday at 9am',
      openChat: '回到 Chat',
      activeJobsLabel: '启用作业',
      recurringJobsLabel: '周期计划',
      latestRunLabel: '最近执行',
      assistantTargetsLabel: '助手绑定',
      neverRun: '尚未执行',
      openRunChat: '打开 chat',
      scheduleOneTime: '一次性',
      scheduleDaily: '每天',
      scheduleWeekly: '每周',
      scheduleBiweekly: '每两周',
      scheduleMonthly: '每月',
      scheduleCustom: '自定义',
    };
  }
  return {
    assistantsTitle: 'Pro Assistants',
    assistantsDescription: 'Keep refinement, coding, ticket sync, and knowledge extraction in role-specific lanes with less setup noise.',
    createAssistant: 'Create assistant',
    assistantCount: count => `${count} assistant${count === 1 ? '' : 's'}`,
    assistantReadyCount: count => `${count} with agents`,
    noAssistantsTitle: 'No Pro assistants yet',
    noAssistantsDescription: 'Create a role assistant once, then reuse its boundaries across tasks and automations.',
    noResponsibility: 'No responsibility configured.',
    runtimeDefault: 'runtime default',
    history: 'History',
    configure: 'Configure',
    noHistoryTitle: 'No chat history yet',
    noHistoryDescription: 'Chats launched by this assistant will appear here for quick review.',
    historyTitle: name => `${name} history`,
    historyDescription: 'Archived chats created by this assistant.',
    sourceTask: 'Task',
    sourceJira: 'Jira',
    sourceJob: 'Job',
    turns: count => `${count} turn${count === 1 ? '' : 's'}`,
    editAssistant: 'Edit assistant',
    createAssistantTitle: 'Create assistant',
    assistantNamePlaceholder: 'Assistant name',
    assistantResponsibilityPlaceholder: 'Responsibility, boundaries, expected output, and when it should be used',
    agentsLabel: 'Agents',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save',
    automationTitle: 'Automation',
    automationDescription: 'Let assistants run work on a schedule while keeping job setup and execution history separate.',
    createJob: 'Create job',
    jobCount: count => `${count} job${count === 1 ? '' : 's'}`,
    runCount: count => `${count} run${count === 1 ? '' : 's'}`,
    jobsTitle: 'Jobs',
    historyPanelTitle: 'Execution history',
    noJobsTitle: 'No automation jobs yet',
    noJobsDescription: 'Choose an assistant, describe the recurring work, and bring repeatable tasks into the Pro workflow.',
    noRunsTitle: 'No execution history yet',
    noRunsDescription: 'Manual and scheduled runs will land here after the first job starts.',
    lastRun: value => `Last run ${value}`,
    run: 'Run',
    queued: 'Queued',
    failed: 'Failed',
    agentLabel: 'agent',
    assistantLabel: 'assistant',
    createJobTitle: 'Create automation job',
    jobPromptPlaceholder: 'What should the assistant do?',
    selectAssistant: 'Select assistant',
    customSchedulePlaceholder: 'Custom schedule, e.g. every weekday at 9am',
    openChat: 'Open Chat',
    activeJobsLabel: 'Active jobs',
    recurringJobsLabel: 'Recurring schedules',
    latestRunLabel: 'Latest run',
    assistantTargetsLabel: 'Assistant targets',
    neverRun: 'Never run',
    openRunChat: 'Open chat',
    scheduleOneTime: 'One time',
    scheduleDaily: 'Daily',
    scheduleWeekly: 'Weekly',
    scheduleBiweekly: 'Biweekly',
    scheduleMonthly: 'Monthly',
    scheduleCustom: 'Custom',
  };
}

function PixelAvatar({ seed, label }: { seed?: string; label: string }) {
  const source = seed || label;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const cells = Array.from({ length: 25 }, (_, index) => {
    const x = index % 5;
    const y = Math.floor(index / 5);
    const mirrorX = x > 2 ? 4 - x : x;
    const bit = (hash >> ((mirrorX + y * 3) % 24)) & 1;
    return bit || (x === 2 && y === 2);
  });
  return (
    <div
      className="grid h-10 w-10 shrink-0 grid-cols-5 gap-[2px] rounded-lg border border-edge bg-panel-alt p-1 shadow-inner"
      style={{ backgroundColor: `hsl(${hue} 62% 92% / 0.55)` }}
      aria-label={`${label} avatar`}
    >
      {cells.map((on, index) => (
        <span
          key={index}
          className="rounded-[1px]"
          style={{ backgroundColor: on ? `hsl(${hue} 68% 45%)` : `hsl(${hue} 34% 82% / 0.4)` }}
        />
      ))}
    </div>
  );
}

function scheduleLabel(draft: typeof defaultJobDraft) {
  return draft.scheduleType === 'custom' ? draft.customSchedule.trim() : draft.scheduleType;
}

function scheduleDisplay(value: string, copy: ProCopy) {
  switch (value) {
    case 'one-time': return copy.scheduleOneTime;
    case 'daily': return copy.scheduleDaily;
    case 'weekly': return copy.scheduleWeekly;
    case 'biweekly': return copy.scheduleBiweekly;
    case 'monthly': return copy.scheduleMonthly;
    default: return value || 'manual';
  }
}

function isRecurringSchedule(value: string | undefined) {
  return !!value && value !== 'one-time' && value !== 'manual';
}

function parseSessionKey(sessionKey: string | undefined): { agent: string; sessionId: string } | null {
  if (!sessionKey) return null;
  const index = sessionKey.indexOf(':');
  if (index <= 0 || index >= sessionKey.length - 1) return null;
  return { agent: sessionKey.slice(0, index), sessionId: sessionKey.slice(index + 1) };
}

function AgentChip({ agent, label }: { agent: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">
      <BrandIcon brand={agent} size={14} className="rounded-[3px]" />
      <span>{label || agent}</span>
    </span>
  );
}

function sessionTitle(item: AssistantHistoryItem) {
  return item.title || item.lastQuestion || item.lastMessageText || item.sessionId.slice(0, 12);
}

function sourceLabel(item: AssistantHistoryItem, copy: ProCopy) {
  if (item.source === 'stage-run') return copy.sourceTask;
  if (item.source === 'jira-sync') return copy.sourceJira;
  return copy.sourceJob;
}

function openSessionsFromStorage(): Array<{ agent: string; sessionId: string; workdir: string; mountKey: string; archiveOnly?: boolean }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_SESSIONS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item.agent === 'string' && typeof item.sessionId === 'string' && typeof item.workdir === 'string')
      : [];
  } catch {
    return [];
  }
}

function mountKey() {
  return `mk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function SectionHeading({
  title,
  description,
  meta,
  action,
}: {
  title: string;
  description: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight text-fg">{title}</h3>
          {meta}
        </div>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg-4">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function AssistantHistoryList({
  items,
  onOpen,
  copy,
}: {
  items: AssistantHistoryItem[];
  onOpen: (item: AssistantHistoryItem) => void;
  copy: ProCopy;
}) {
  if (!items.length) {
    return (
      <Empty title={copy.noHistoryTitle} label={copy.noHistoryDescription} />
    );
  }
  return (
    <div className="grid gap-2">
      {items.map(item => (
        <button
          key={`${item.workdir}:${item.agent}:${item.sessionId}`}
          type="button"
          onClick={() => onOpen(item)}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-edge bg-panel px-3 py-2.5 text-left shadow-sm transition hover:border-edge-h hover:bg-panel-h"
          title={sessionTitle(item)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-fg">{sessionTitle(item)}</span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg-5">
              <span>{sourceLabel(item, copy)}</span>
              <span className="h-0.5 w-0.5 rounded-full bg-fg-6" />
              <span className="truncate">{item.agent}</span>
              {item.numTurns != null ? (
                <>
                  <span className="h-0.5 w-0.5 rounded-full bg-fg-6" />
                  <span>{copy.turns(item.numTurns)}</span>
                </>
              ) : null}
              {item.runUpdatedAt || item.updatedAt || item.createdAt ? (
                <>
                  <span className="h-0.5 w-0.5 rounded-full bg-fg-6" />
                  <span>{fmt(item.runUpdatedAt || item.updatedAt || item.createdAt || undefined)}</span>
                </>
              ) : null}
            </span>
            {item.sourceLabel && (
              <span className="mt-1 block truncate text-[11px] text-fg-5">{item.sourceLabel}</span>
            )}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full',
              item.runState === 'running' ? 'bg-ok' : item.runState === 'incomplete' ? 'bg-warn' : 'bg-fg-6',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function ProAssistantsSection({ embedded = false, onChange }: { embedded?: boolean; onChange?: () => void } = {}) {
  const navigate = useNavigate();
  const toast = useStore(s => s.toast);
  const locale = useStore(s => s.locale);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const agentStatus = useStore(s => s.agentStatus);
  const refreshAgentStatus = useStore(s => s.refreshAgentStatus);
  const copy = useMemo(() => getCopy(locale), [locale]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [historyByAssistant, setHistoryByAssistant] = useState<Record<string, AssistantHistoryItem[]>>({});
  const [historyAssistant, setHistoryAssistant] = useState<AgentAssistant | null>(null);
  const [promptAssistant, setPromptAssistant] = useState<AgentAssistant | null>(null);
  const [promptRunAssistant, setPromptRunAssistant] = useState<AgentAssistant | null>(null);
  const [testAssistant, setTestAssistant] = useState<AgentAssistant | null>(null);
  const [focusAssistant, setFocusAssistant] = useState<AgentAssistant | null>(null);
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [editing, setEditing] = useState<AgentAssistant | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(defaultAssistantDraft);
  const [busy, setBusy] = useState(false);

  const allAgentOptions = useMemo<AssistantAgentOption[]>(() => {
    const agents = agentStatus?.agents?.length ? agentStatus.agents : [];
    const source = agents.length ? agents : FALLBACK_AGENTS.map(agent => ({ agent, label: agent, installed: true }));
    return source.map(agent => ({ value: agent.agent, label: agent.label || agent.agent, installed: agent.installed !== false }));
  }, [agentStatus]);
  const agentOptions = useMemo(
    () => allAgentOptions.filter(agent => agent.installed),
    [allAgentOptions],
  );
  const agentLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of allAgentOptions) map.set(agent.value, agent.label);
    return map;
  }, [allAgentOptions]);
  const agentInstalledByValue = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const agent of allAgentOptions) map.set(agent.value, agent.installed);
    return map;
  }, [allAgentOptions]);
  const filterInstalledAgents = useCallback(
    (agents: string[]) => agents.filter(agent => agentInstalledByValue.get(agent) !== false),
    [agentInstalledByValue],
  );

  const refresh = useCallback(async () => {
    const [assistantRes, historyRes] = await Promise.all([
      api.getProAssistants(),
      api.getProAssistantHistory(ASSISTANT_HISTORY_LIMIT),
    ]);
    if (assistantRes.ok) setAssistants(assistantRes.assistants || []);
    if (historyRes.ok) setHistoryByAssistant(historyRes.history || {});
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!agentStatus) void refreshAgentStatus();
  }, [agentStatus, refreshAgentStatus]);

  const ownerAssistant = useMemo(
    () => assistants.find(item => item.kind === 'page-owner' && item.surfaceId === 'agents') || null,
    [assistants],
  );

  const openCreate = useCallback(() => {
    if (ownerAssistant) {
      setCreateRunOpen(true);
      return;
    }
    setEditing(null);
    setDraft(defaultAssistantDraft);
    setModalOpen(true);
  }, [ownerAssistant]);

  const openEdit = useCallback((assistant: AgentAssistant) => {
    setEditing(assistant);
    setDraft({
      name: assistant.name,
      responsibility: assistant.responsibility,
      preferredAgents: filterInstalledAgents(assistant.preferredAgents),
    });
    setModalOpen(true);
  }, [filterInstalledAgents]);

  const closeModal = useCallback(() => {
    if (busy) return;
    setModalOpen(false);
    setEditing(null);
    setDraft(defaultAssistantDraft);
  }, [busy]);

  const saveAssistant = useCallback(async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    try {
      const payload = {
        name: draft.name,
        responsibility: draft.responsibility,
        preferredAgents: filterInstalledAgents(draft.preferredAgents),
      };
      const res = editing
        ? await api.updateProAssistant(editing.id, payload)
        : await api.createProAssistant(payload);
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to save assistant');
      setAssistants(prev => {
        const next = prev.filter(item => item.id !== res.assistant!.id);
        return [res.assistant!, ...next];
      });
      onChange?.();
      void refresh();
      setModalOpen(false);
      setEditing(null);
      setDraft(defaultAssistantDraft);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save assistant', false);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, editing, filterInstalledAgents, onChange, refresh, toast]);

  const deleteAssistant = useCallback(async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const res = await api.deleteProAssistant(editing.id);
      if (!res.ok) throw new Error(res.error || 'Failed to delete assistant');
      setAssistants(prev => prev.filter(item => item.id !== editing.id));
      onChange?.();
      void refresh();
      setModalOpen(false);
      setEditing(null);
      setDraft(defaultAssistantDraft);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete assistant', false);
    } finally {
      setBusy(false);
    }
  }, [busy, editing, onChange, refresh, toast]);

  const toggleDraftAgent = useCallback((agent: string) => {
    setDraft(prev => {
      const exists = prev.preferredAgents.includes(agent);
      return {
        ...prev,
        preferredAgents: exists
          ? prev.preferredAgents.filter(item => item !== agent)
          : [...prev.preferredAgents, agent],
      };
    });
  }, []);

  const openHistorySession = useCallback((item: AssistantHistoryItem) => {
    const existing = openSessionsFromStorage();
    const exactIndex = existing.findIndex(slot => (
      slot.workdir === item.workdir
      && slot.agent === item.agent
      && slot.sessionId === item.sessionId
    ));
    const next = exactIndex >= 0
      ? existing.map((slot, index) => index === exactIndex ? { ...slot, archiveOnly: true } : slot)
      : [{
          workdir: item.workdir,
          agent: item.agent,
          sessionId: item.sessionId,
          mountKey: mountKey(),
          archiveOnly: true,
        }, ...existing];
    try {
      localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(exactIndex >= 0 ? exactIndex : 0));
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
    navigate('/chat');
  }, [navigate]);

  const openHistory = useCallback((assistant: AgentAssistant) => {
    setHistoryAssistant(assistant);
  }, []);

  const selectedHistory = historyAssistant ? historyByAssistant[historyAssistant.id] || [] : [];
  const visibleAssistants = useMemo(
    () => assistants.filter(item => item.kind !== 'page-owner'),
    [assistants],
  );
  const assistantsWithAgents = useMemo(
    () => visibleAssistants.filter(item => filterInstalledAgents(item.preferredAgents).length > 0).length,
    [filterInstalledAgents, visibleAssistants],
  );

  return (
    <section className={cn('space-y-3', embedded ? '' : 'border-t border-edge pt-4')}>
      <SectionHeading
        title={copy.assistantsTitle}
        description={copy.assistantsDescription}
        meta={(
          <span className="flex flex-wrap items-center gap-1.5">
            <CountBadge>{copy.assistantCount(visibleAssistants.length)}</CountBadge>
            <CountBadge>{copy.assistantReadyCount(assistantsWithAgents)}</CountBadge>
          </span>
        )}
        action={<Button variant="primary" size="sm" onClick={openCreate}>{copy.createAssistant}</Button>}
      />

      {!visibleAssistants.length ? (
        <Empty
          title={copy.noAssistantsTitle}
          label={copy.noAssistantsDescription}
          action={<Button variant="primary" size="sm" onClick={openCreate}>{copy.createAssistant}</Button>}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleAssistants.map(item => (
            <div
              key={item.id}
              className="group rounded-lg border border-edge bg-panel p-3 text-left shadow-sm transition-[border-color,background,transform,box-shadow] hover:-translate-y-px hover:border-edge-h hover:bg-panel-h"
            >
              <button type="button" onClick={() => setFocusAssistant(item)} className="flex w-full min-w-0 items-start gap-3 text-left">
                <PixelAvatar seed={item.avatarSeed || item.id} label={item.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg">{item.name}</span>
                  <span className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-fg-4">
                    {item.responsibility || copy.noResponsibility}
                  </span>
                </span>
              </button>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-2">
                <div className="flex min-w-0 flex-wrap gap-1">
                  {filterInstalledAgents(item.preferredAgents).length
                    ? filterInstalledAgents(item.preferredAgents).slice(0, 4).map(agent => (
                        <AgentChip key={agent} agent={agent} label={agentLabelByValue.get(agent)} />
                      ))
                    : <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">{copy.runtimeDefault}</span>}
                  {filterInstalledAgents(item.preferredAgents).length > 4 && (
                    <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">
                      +{filterInstalledAgents(item.preferredAgents).length - 4}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.builtIn && <Badge variant="ok">{locale === 'zh-CN' ? '内置' : 'Built-in'}</Badge>}
                  {item.kind && <Badge variant="muted">{item.kind}</Badge>}
                  <Button variant="secondary" size="sm" onClick={() => setTestAssistant(item)}>
                    {locale === 'zh-CN' ? '测试' : 'Test'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setPromptAssistant(item)}>
                    Prompt
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openHistory(item)}>
                    {copy.history}
                    <span className="ml-1 rounded border border-edge bg-inset px-1 py-0.5 text-[10px] text-fg-5">
                      {(historyByAssistant[item.id] || []).length}
                    </span>
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(item)}>{copy.configure}</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!historyAssistant} onClose={() => setHistoryAssistant(null)} wide>
        <ModalHeader
          title={historyAssistant ? copy.historyTitle(historyAssistant.name) : copy.history}
          description={copy.historyDescription}
          onClose={() => setHistoryAssistant(null)}
        />
        <div className="max-h-[min(68vh,720px)] overflow-y-auto pr-1">
          <AssistantHistoryList
            items={selectedHistory}
            copy={copy}
            onOpen={(item) => {
              openHistorySession(item);
              setHistoryAssistant(null);
            }}
          />
        </div>
      </Modal>

      <AssistantPromptDialog
        open={!!promptAssistant}
        assistant={promptAssistant}
        onClose={() => setPromptAssistant(null)}
        onChatEdit={(assistant) => {
          setPromptAssistant(null);
          setPromptRunAssistant(assistant);
        }}
        onSaved={(assistant) => {
          setAssistants(prev => prev.map(item => item.id === assistant.id ? assistant : item));
          onChange?.();
          void refresh();
        }}
      />

      <AssistantRunDialog
        open={!!focusAssistant}
        assistant={focusAssistant}
        mode="chat"
        floating
        title={focusAssistant ? `${focusAssistant.name} · Focus` : undefined}
        initialPrompt="Open this assistant as a focused tool window. Ask me what I want to do next, then help me use or test this assistant in the current product context."
        workdir={runtimeWorkdir}
        onOpenPrompt={(assistant) => setPromptAssistant(assistant)}
        onAssistantSaved={(assistant) => {
          setAssistants(prev => prev.map(item => item.id === assistant.id ? assistant : item));
          onChange?.();
          void refresh();
        }}
        onClose={() => setFocusAssistant(null)}
      />

      <AssistantRunDialog
        open={!!testAssistant}
        assistant={testAssistant}
        mode="test"
        title={testAssistant ? `${testAssistant.name} · Test` : undefined}
        initialPrompt="Test this assistant with a realistic short conversation. Check prompt clarity, page ownership, allowed actions, generated UI expectations, and what should be improved."
        workdir={runtimeWorkdir}
        onOpenPrompt={(assistant) => setPromptAssistant(assistant)}
        onAssistantSaved={(assistant) => {
          setAssistants(prev => prev.map(item => item.id === assistant.id ? assistant : item));
          onChange?.();
          void refresh();
        }}
        onClose={() => setTestAssistant(null)}
      />

      <AssistantRunDialog
        open={!!promptRunAssistant}
        assistant={promptRunAssistant}
        mode="prompt"
        floating
        title={promptRunAssistant ? `${promptRunAssistant.name} · Prompt chat edit` : undefined}
        initialPrompt="Help me improve your own prompt through chat. Ask clarifying questions if needed, then output the full replacement prompt using the PikiclawPromptPatch block when ready."
        workdir={runtimeWorkdir}
        onAssistantSaved={(assistant) => {
          setAssistants(prev => prev.map(item => item.id === assistant.id ? assistant : item));
          onChange?.();
          void refresh();
        }}
        onClose={() => setPromptRunAssistant(null)}
      />

      <AssistantRunDialog
        open={createRunOpen}
        assistant={ownerAssistant}
        mode="create"
        title={ownerAssistant ? `${ownerAssistant.name} · Create assistant` : undefined}
        initialPrompt="Help me create a new agent, assistant, or model/profile setup. Start by asking what role I need, what page or object it owns, what actions it can take, how it should be tested, and what prompt it should use."
        workdir={runtimeWorkdir}
        onOpenPrompt={(assistant) => setPromptAssistant(assistant)}
        onAssistantSaved={(assistant) => {
          setAssistants(prev => prev.map(item => item.id === assistant.id ? assistant : item));
          onChange?.();
          void refresh();
        }}
        onClose={() => {
          setCreateRunOpen(false);
          onChange?.();
          void refresh();
        }}
      />

      <Modal open={modalOpen} onClose={closeModal}>
        <ModalHeader title={editing ? copy.editAssistant : copy.createAssistantTitle} onClose={closeModal} />
        <div className="space-y-3">
          <Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder={copy.assistantNamePlaceholder} />
          <textarea
            value={draft.responsibility}
            onChange={event => setDraft(prev => ({ ...prev, responsibility: event.target.value }))}
            placeholder={copy.assistantResponsibilityPlaceholder}
            className="min-h-40 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="rounded-md border border-edge bg-panel-alt p-2">
            <div className="mb-2 text-[12px] font-medium text-fg-4">{copy.agentsLabel}</div>
            <div className="flex flex-wrap gap-2">
              {agentOptions.map(agent => (
                <label key={agent.value} className="inline-flex cursor-pointer items-center gap-2 rounded border border-edge bg-control px-2 py-1 text-[12px] text-fg-3 transition hover:bg-control-h">
                  <input
                    type="checkbox"
                    checked={draft.preferredAgents.includes(agent.value)}
                    onChange={() => toggleDraftAgent(agent.value)}
                    className="h-3.5 w-3.5"
                  />
                  <BrandIcon brand={agent.value} size={16} className="rounded-[4px]" />
                  <span>{agent.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing && (
            <Button variant="secondary" onClick={() => void deleteAssistant()} disabled={busy} className="text-red-500 hover:border-red-500/40 hover:bg-red-500/10">
              {copy.delete}
            </Button>
          )}
          <div className="min-w-0 flex-1" />
          <Button variant="ghost" onClick={closeModal} disabled={busy}>{copy.cancel}</Button>
          <Button variant="primary" disabled={!draft.name.trim() || busy} onClick={() => void saveAssistant()}>
            {busy ? <Spinner /> : null}
            {copy.save}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function ProAutomationSection({ standalone = false }: { standalone?: boolean } = {}) {
  const navigate = useNavigate();
  const toast = useStore(s => s.toast);
  const locale = useStore(s => s.locale);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const copy = useMemo(() => getCopy(locale), [locale]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [jobs, setJobs] = useState<AutomationRule[]>([]);
  const [draft, setDraft] = useState(defaultJobDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [assistantRes, automationRes] = await Promise.all([api.getProAssistants(), api.getProAutomations()]);
    if (assistantRes.ok) setAssistants(assistantRes.assistants || []);
    if (automationRes.ok) setJobs(automationRes.automations || []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const history = useMemo(() => jobs.flatMap(job => (job.runHistory || []).map(run => ({ ...run, job })))
    .sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt)), [jobs]);

  const stats = useMemo(() => {
    const assistantTargets = new Set(jobs.map(job => job.assistantId).filter(Boolean));
    return [
      { label: copy.activeJobsLabel, value: String(jobs.filter(job => job.enabled).length), detail: copy.jobCount(jobs.length) },
      { label: copy.recurringJobsLabel, value: String(jobs.filter(job => isRecurringSchedule(job.schedule)).length), detail: copy.runCount(history.length) },
      { label: copy.latestRunLabel, value: history[0] ? fmt(history[0].ranAt) : copy.neverRun, detail: history[0]?.job.name || copy.neverRun },
      { label: copy.assistantTargetsLabel, value: String(assistantTargets.size), detail: copy.assistantReadyCount(assistants.length) },
    ];
  }, [assistants.length, copy, history, jobs]);

  const createJob = useCallback(async () => {
    const schedule = scheduleLabel(draft);
    if (!draft.prompt.trim() || !draft.assistantId || !schedule || busy) return;
    setBusy('create');
    try {
      const res = await api.createProAutomation({
        name: '',
        schedule,
        prompt: draft.prompt,
        workdir: runtimeWorkdir,
        assistantId: draft.assistantId,
      });
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to create job');
      setJobs(prev => [res.automation!, ...prev]);
      setDraft({ ...defaultJobDraft, assistantId: assistants[0]?.id || '' });
      setCreateOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create job', false);
    } finally {
      setBusy(null);
    }
  }, [assistants, busy, draft, runtimeWorkdir, toast]);

  const runJob = useCallback(async (job: AutomationRule) => {
    setBusy(job.id);
    try {
      const res = await api.runProAutomation(job.id);
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to run job');
      setJobs(prev => prev.map(item => item.id === job.id ? res.automation! : item));
      toast(copy.queued);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to run job', false);
    } finally {
      setBusy(null);
    }
  }, [copy.queued, toast]);

  const openRunChat = useCallback((job: AutomationRule, sessionKey: string | undefined) => {
    const parsed = parseSessionKey(sessionKey);
    const workdir = job.workdir || runtimeWorkdir;
    if (!parsed || !workdir) return;
    const existing = openSessionsFromStorage();
    const exactIndex = existing.findIndex(slot => (
      slot.workdir === workdir
      && slot.agent === parsed.agent
      && slot.sessionId === parsed.sessionId
    ));
    const next = exactIndex >= 0
      ? existing.map((slot, index) => index === exactIndex ? { ...slot, archiveOnly: false } : slot)
      : [{ workdir, agent: parsed.agent, sessionId: parsed.sessionId, mountKey: mountKey(), archiveOnly: false }, ...existing];
    try {
      localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(exactIndex >= 0 ? exactIndex : 0));
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
    navigate('/chat', {
      state: {
        openSessionWorkdir: workdir,
        openSessionAgent: parsed.agent,
        openSessionId: parsed.sessionId,
        openSessionNonce: Date.now(),
      },
    });
  }, [navigate, runtimeWorkdir]);

  return (
    <section className={cn('space-y-4', standalone ? '' : 'border-t border-edge pt-4')}>
      {standalone && (
        <div className="grid gap-3 md:grid-cols-4">
          {stats.map(item => (
            <div key={item.label} className="rounded-lg border border-edge bg-panel px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase text-fg-5">{item.label}</div>
              <div className="mt-2 truncate text-[20px] font-semibold tracking-tight text-fg">{item.value}</div>
              <div className="mt-1 truncate text-[11px] text-fg-5">{item.detail}</div>
            </div>
          ))}
        </div>
      )}
      <SectionHeading
        title={copy.automationTitle}
        description={copy.automationDescription}
        meta={(
          <span className="flex flex-wrap items-center gap-1.5">
            <CountBadge>{copy.jobCount(jobs.length)}</CountBadge>
            <CountBadge>{copy.runCount(history.length)}</CountBadge>
          </span>
        )}
        action={(
          <div className="flex flex-wrap justify-end gap-2">
            {standalone && (
              <Button variant="secondary" size="sm" onClick={() => navigate('/chat')}>
                {copy.openChat}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setDraft({ ...defaultJobDraft, assistantId: assistants[0]?.id || '' });
                setCreateOpen(true);
              }}
            >
              {copy.createJob}
            </Button>
          </div>
        )}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-fg-3">{copy.jobsTitle}</div>
            <CountBadge>{jobs.length}</CountBadge>
          </div>
          {!jobs.length ? (
            <Empty
              title={copy.noJobsTitle}
              label={copy.noJobsDescription}
              action={(
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDraft({ ...defaultJobDraft, assistantId: assistants[0]?.id || '' });
                    setCreateOpen(true);
                  }}
                >
                  {copy.createJob}
                </Button>
              )}
            />
          ) : jobs.map(job => (
            <div key={job.id} className="rounded-lg border border-edge bg-panel p-3 shadow-sm transition hover:border-edge-h hover:bg-panel-h">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-fg">{job.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-5">
                    <Badge variant="muted">{scheduleDisplay(job.schedule, copy)}</Badge>
                    <span>{copy.lastRun(fmt(job.lastRunAt))}</span>
                  </div>
                  <div className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-4">{job.prompt}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-fg-5">
                    {job.agent && <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">{copy.agentLabel}: {job.agent}</span>}
                    {job.assistantId && <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">{copy.assistantLabel}: {assistants.find(a => a.id === job.assistantId)?.name || job.assistantId}</span>}
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void runJob(job)}>
                  {busy === job.id ? <Spinner /> : null}
                  {copy.run}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-fg-3">{copy.historyPanelTitle}</div>
            <CountBadge>{history.length}</CountBadge>
          </div>
          {!history.length ? (
            <Empty title={copy.noRunsTitle} label={copy.noRunsDescription} />
          ) : (
            <div className="space-y-2">
              {history.map(run => (
                <div key={`${run.job.id}:${run.id}`} className="rounded-md border border-edge bg-panel px-3 py-2 transition hover:border-edge-h hover:bg-panel-h">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-[13px] font-medium text-fg">{run.job.name}</div>
                    <Badge variant={run.status === 'failed' ? 'err' : 'accent'}>
                      {run.status === 'failed' ? copy.failed : copy.queued}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-fg-5">{fmt(run.ranAt)}</div>
                  {run.sessionKey && (
                    <div className="mt-2 flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-4">{run.sessionKey}</div>
                      <Button size="sm" variant="ghost" onClick={() => openRunChat(run.job, run.sessionKey)} className="h-7 px-2">
                        {copy.openRunChat}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader title={copy.createJobTitle} onClose={() => setCreateOpen(false)} />
        <div className="space-y-3">
          <textarea
            value={draft.prompt}
            onChange={event => setDraft(prev => ({ ...prev, prompt: event.target.value }))}
            placeholder={copy.jobPromptPlaceholder}
            className="min-h-32 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <select value={draft.assistantId} onChange={event => setDraft(prev => ({ ...prev, assistantId: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">{copy.selectAssistant}</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
            <select value={draft.scheduleType} onChange={event => setDraft(prev => ({ ...prev, scheduleType: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {SCHEDULE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{copy[preset.labelKey]}</option>)}
            </select>
          </div>
          {draft.scheduleType === 'custom' && (
            <Input value={draft.customSchedule} onChange={event => setDraft(prev => ({ ...prev, customSchedule: event.target.value }))} placeholder={copy.customSchedulePlaceholder} />
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy === 'create'}>{copy.cancel}</Button>
          <Button variant="primary" disabled={!draft.prompt.trim() || !draft.assistantId || !scheduleLabel(draft) || busy === 'create'} onClick={() => void createJob()}>
            {busy === 'create' ? <Spinner /> : null}
            {copy.createJob}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
