import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../../api';
import { BrowserPanelModal } from '../../components/BrowserPanelModal';
import { DirBrowser } from '../../components/DirBrowser';
import { Badge, Button, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { AgentAssistant, AgentRuntimeStatus, BrowserPanelSnapshot, JiraCycle, JiraSyncRun, JiraWorkflowConfig, ProSubtaskStatus, ProTask, ProTaskStage, ProTaskStatus, RichMessage, SessionInfo, StageRun, StageSessionRef, TaskSpace, VerificationResult, VerificationRun, WorkspaceEntry } from '../../types';
import { cn } from '../../utils';
import { SessionPanel, type SessionPanelChange } from '../sessions/SessionPanel';
import { createMdComponents, mdPlugins } from '../sessions/markdown';

const STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const VISIBLE_STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'done'];
const STAGES: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix'];
type JiraColumnKey = 'backlog' | 'refinement' | 'working' | 'done';

const ALL_TASKS_SPACE_ID = 'all';
const JIRA_TASK_SPACE_ID = 'jira';
const PERSONAL_TASK_SPACE_ID = 'personal';

const JIRA_COLUMNS: Array<{ key: JiraColumnKey; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'New or planned' },
  { key: 'refinement', label: 'Refinement', hint: 'Clarify scope and plan' },
  { key: 'working', label: 'Working', hint: 'Implementation in progress' },
  { key: 'done', label: 'Done', hint: 'Local work completed' },
];

const JIRA_COLUMN_BADGE: Record<JiraColumnKey, 'ok' | 'warn' | 'muted' | 'accent'> = {
  backlog: 'muted',
  refinement: 'warn',
  working: 'accent',
  done: 'ok',
};

type JiraColumnSortDirection = 'desc' | 'asc';
type JiraColumnSortMode = JiraColumnSortDirection | 'manual';
type JiraColumnSortModes = Record<JiraColumnKey, JiraColumnSortMode>;
type JiraColumnManualOrder = Partial<Record<JiraColumnKey, string[]>>;
type TaskMetaPatch = { workdir?: string | null; prUrl?: string | null };
type TaskDetailLayout = 'side' | 'modal';
const JIRA_COLUMN_ORDER_STORAGE_KEY = 'pikiclaw:jira-dashboard:column-order:v1';
const TASK_SPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'pikiclaw:tasks:space-sidebar-collapsed:v1';
const TASK_DETAIL_LAYOUT_STORAGE_KEY = 'pikiclaw:tasks:detail-layout:v1';
const DEFAULT_JIRA_COLUMN_SORT_MODES: JiraColumnSortModes = {
  backlog: 'desc',
  refinement: 'desc',
  working: 'desc',
  done: 'desc',
};

const STATUS_LABEL: Record<ProTaskStatus, string> = {
  backlog: 'Backlog',
  refinement: 'Refinement',
  coding: 'Working',
  resolved: 'Review',
  done: 'Done',
};

const STATUS_CHAT_STAGE: Record<ProTaskStatus, ProTaskStage> = {
  backlog: 'focus',
  refinement: 'refinement',
  coding: 'coding',
  resolved: 'verification',
  done: 'demo',
};

function displayTaskStatus(status: ProTaskStatus): ProTaskStatus {
  return status === 'resolved' ? 'done' : status;
}

const STAGE_LABEL: Record<ProTaskStage, string> = {
  focus: 'Focus',
  refinement: 'Clarify',
  coding: 'Execute',
  verification: 'Verify',
  demo: 'Demo',
  bugfix: 'Bugfix',
  knowledge: 'Knowledge',
};

const VERIFY_RESULTS: VerificationResult[] = ['passed', 'failed', 'blocked'];
const SUBTASK_STATUSES: ProSubtaskStatus[] = ['todo', 'running', 'review', 'done', 'blocked'];

function subtaskProgress(task: ProTask): { done: number; total: number } {
  const total = task.subTasks?.length || 0;
  const done = (task.subTasks || []).filter(item => item.status === 'done').length;
  return { done, total };
}

function taskChangedFiles(task: ProTask): string[] {
  const seen = new Set<string>();
  for (const run of task.stageRuns || []) {
    for (const file of run.output?.changedFiles || []) {
      const normalized = file.trim();
      if (normalized) seen.add(normalized);
    }
  }
  for (const output of task.outputs || []) {
    const normalized = output.path?.trim();
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '--';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '--';
  return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '--';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function taskSyncSortTime(task: ProTask): number {
  const raw = task.jiraFields?.updatedAt || jiraRemoteSyncField(task.description, 'Updated') || task.updatedAt;
  const time = Date.parse(raw || '');
  return Number.isFinite(time) ? time : 0;
}

function readStoredJiraColumnOrder(): { modes: JiraColumnSortModes; manualOrder: JiraColumnManualOrder } {
  if (typeof window === 'undefined') return { modes: DEFAULT_JIRA_COLUMN_SORT_MODES, manualOrder: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(JIRA_COLUMN_ORDER_STORAGE_KEY) || '{}') as {
      modes?: Partial<Record<JiraColumnKey, JiraColumnSortMode>>;
      manualOrder?: JiraColumnManualOrder;
    };
    return {
      modes: { ...DEFAULT_JIRA_COLUMN_SORT_MODES, ...(parsed.modes || {}) },
      manualOrder: parsed.manualOrder || {},
    };
  } catch {
    return { modes: DEFAULT_JIRA_COLUMN_SORT_MODES, manualOrder: {} };
  }
}

function writeStoredJiraColumnOrder(modes: JiraColumnSortModes, manualOrder: JiraColumnManualOrder) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(JIRA_COLUMN_ORDER_STORAGE_KEY, JSON.stringify({ modes, manualOrder }));
  } catch {}
}

function readStoredTaskSpaceSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TASK_SPACE_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredTaskSpaceSidebarCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TASK_SPACE_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {}
}

function readStoredTaskDetailLayout(): TaskDetailLayout {
  if (typeof window === 'undefined') return 'side';
  try {
    const value = window.localStorage.getItem(TASK_DETAIL_LAYOUT_STORAGE_KEY);
    return value === 'modal' ? 'modal' : 'side';
  } catch {
    return 'side';
  }
}

function writeStoredTaskDetailLayout(layout: TaskDetailLayout) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TASK_DETAIL_LAYOUT_STORAGE_KEY, layout);
  } catch {}
}

function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function secondsBetween(start: string | null | undefined, end: string | null | undefined): number {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 1000);
}

function formatDuration(value: number | null | undefined): string {
  const seconds = Math.max(0, Math.floor(Number(value || 0)));
  if (!seconds) return '--';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return dayHours ? `${days}d ${dayHours}h` : `${days}d`;
}

function taskUserFocusSeconds(task: ProTask): number {
  const now = new Date().toISOString();
  return (task.focusSessions || []).reduce((sum, session) => {
    return sum + (typeof session.durationSeconds === 'number'
      ? Math.max(0, session.durationSeconds)
      : secondsBetween(session.openedAt, session.closedAt || now));
  }, 0);
}

function taskAgentSeconds(task: ProTask): number {
  const now = new Date().toISOString();
  return task.stageRuns.reduce((sum, run) => sum + secondsBetween(run.startedAt, run.completedAt || now), 0);
}

function taskLifecycleSeconds(task: ProTask): number {
  const doneAt = task.status === 'done' || task.status === 'resolved' ? task.updatedAt : new Date().toISOString();
  return secondsBetween(task.createdAt, doneAt);
}

function taskStatusTone(status: ProTaskStatus): 'ok' | 'warn' | 'muted' | 'accent' {
  if (status === 'done') return 'ok';
  if (status === 'resolved') return 'accent';
  if (status === 'coding' || status === 'refinement') return 'warn';
  return 'muted';
}

function workspaceShortLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

function taskSpaceIcon(spaceId: string, kind?: TaskSpace['kind']): string {
  if (spaceId === ALL_TASKS_SPACE_ID) return 'A';
  if (kind === 'jira' || spaceId === JIRA_TASK_SPACE_ID) return 'J';
  if (kind === 'personal' || spaceId === PERSONAL_TASK_SPACE_ID) return 'P';
  return 'T';
}

function taskSpaceSummary(spaceId: string, count: number): string {
  if (spaceId === ALL_TASKS_SPACE_ID) return `${count} tasks across spaces`;
  if (spaceId === JIRA_TASK_SPACE_ID) return `${count} Jira-backed tasks`;
  if (spaceId === PERSONAL_TASK_SPACE_ID) return `${count} personal tasks`;
  return `${count} tasks`;
}

function defaultSpaceForCreate(selectedSpaceId: string): string {
  return selectedSpaceId && selectedSpaceId !== ALL_TASKS_SPACE_ID ? selectedSpaceId : PERSONAL_TASK_SPACE_ID;
}

function defaultKindForSpace(spaceId: string): ProTask['kind'] {
  return spaceId === JIRA_TASK_SPACE_ID ? 'jira-ticket' : 'manual';
}

function TaskPrField({ task, onMetaChange }: { task: ProTask; onMetaChange: (task: ProTask, patch: TaskMetaPatch) => void }) {
  const [draft, setDraft] = useState(task.prUrl || '');
  const skipCommitRef = useRef(false);

  useEffect(() => {
    setDraft(task.prUrl || '');
  }, [task.id, task.prUrl]);

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    const next = draft.trim();
    if ((task.prUrl || '') !== next) onMetaChange(task, { prUrl: next || null });
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            skipCommitRef.current = true;
            setDraft(task.prUrl || '');
            event.currentTarget.blur();
          }
        }}
        placeholder="MR / PR URL"
        className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-0 text-[12px] text-fg-3 outline-none transition placeholder:text-fg-5/60 hover:border-edge hover:bg-panel focus:border-primary/40 focus:px-2"
      />
      {task.prUrl && (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-6 shrink-0 items-center rounded-md border border-edge px-2 text-[11px] font-medium text-fg-4 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
        >
          Open
        </a>
      )}
    </div>
  );
}

function stageTone(stage: ProTaskStage): 'ok' | 'warn' | 'muted' | 'accent' {
  if (stage === 'coding') return 'warn';
  if (stage === 'verification' || stage === 'demo') return 'accent';
  if (stage === 'bugfix') return 'warn';
  return 'muted';
}

function syncRunTone(status: JiraSyncRun['status']): 'ok' | 'warn' | 'muted' | 'accent' {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'warn';
  if (status === 'syncing' || status === 'queued' || status === 'starting') return 'accent';
  return 'muted';
}

function syncRunActive(run: JiraSyncRun | null | undefined): boolean {
  return !!run && (run.status === 'starting' || run.status === 'queued' || run.status === 'syncing');
}

function syncRunStatusLabel(status: JiraSyncRun['status']): string {
  if (status === 'starting') return 'Starting';
  if (status === 'queued') return 'Queued';
  if (status === 'syncing') return 'Syncing';
  if (status === 'completed') return 'Completed';
  return 'Failed';
}

function syncChangeCounts(run: JiraSyncRun | null | undefined): { created: number; updated: number; unchanged: number } {
  const counts = { created: 0, updated: 0, unchanged: 0 };
  for (const change of run?.changes || []) {
    if (change.action === 'created' || change.action === 'updated' || change.action === 'unchanged') counts[change.action] += 1;
  }
  return counts;
}

function jiraSyncCompactLabel(run: JiraSyncRun | null | undefined): string {
  if (!run) return 'No sync yet';
  if (run.status === 'failed') return 'Sync failed';
  if (run.status === 'completed') return `Last sync ${formatTime(run.updatedAt)}`;
  if (run.status === 'queued') return 'Sync queued';
  if (run.status === 'starting') return 'Sync starting';
  return 'Syncing';
}

function jiraSyncRunMessage(run: JiraSyncRun): string {
  if (run.error) return run.error;
  const latestEvent = run.events?.[run.events.length - 1];
  if (latestEvent?.detail) return latestEvent.detail;
  if (latestEvent?.label) return latestEvent.label;
  if (run.analysisSummary) return run.analysisSummary;
  if (run.status === 'completed') return `${run.ticketCount ?? '--'} tickets, ${run.taskCount ?? '--'} tasks`;
  return syncRunStatusLabel(run.status);
}

function cleanTaskDescription(task: ProTask): string {
  const text = task.description?.trim() || '';
  const markerIndex = text.indexOf('[Jira remote sync]');
  return (markerIndex >= 0 ? text.slice(0, markerIndex) : text).trim();
}

function taskBriefSummary(task: ProTask): string {
  const text = cleanTaskDescription(task)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
}

function inferTaskTitle(description: string): string {
  const firstLine = description
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split('\n')
    .map(line => line.replace(/[>#*_`]/g, '').replace(/^\s*[-\u2022]\s*/, '').replace(/[ \t]+/g, ' ').trim())
    .find(Boolean) || 'Untitled task';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trim()}...` : firstLine;
}

function jiraRemoteSyncBlock(task: ProTask): string | null {
  const text = task.description?.trim() || '';
  const markerIndex = text.indexOf('[Jira remote sync]');
  if (markerIndex < 0) return null;
  return text.slice(markerIndex).replace('[Jira remote sync]', '').trim() || null;
}

function jiraRemoteSyncSummary(task: ProTask): string | null {
  const block = jiraRemoteSyncBlock(task);
  if (!block) return null;
  const changed = block.match(/Changed:\s*([\s\S]*?)(?:New\/changed marker:|$)/)?.[1]?.trim();
  const marker = block.match(/New\/changed marker:\s*([\s\S]*)/)?.[1]?.trim();
  return (changed || marker || block).replace(/\s+/g, ' ').replace(/\s+\.$/, '.');
}

function taskCardColor(status: ProTaskStatus): string {
  if (status === 'refinement') return 'bg-cyan-400/[0.045] hover:bg-cyan-400/[0.075]';
  if (status === 'coding') return 'bg-amber-400/[0.05] hover:bg-amber-400/[0.08]';
  if (status === 'resolved') return 'bg-sky-400/[0.045] hover:bg-sky-400/[0.075]';
  if (status === 'done') return 'bg-emerald-400/[0.045] hover:bg-emerald-400/[0.075]';
  return 'bg-panel/72 hover:bg-panel-h/70';
}

function ticketTypeInfo(task: ProTask): { label: string; glyph: string; className: string } {
  const raw = `${task.jiraFields?.issueType || task.kind || ''}`.toLowerCase();
  if (raw.includes('epic')) return { label: 'Epic', glyph: 'E', className: 'border-violet-500/35 bg-violet-500 text-white' };
  if (raw.includes('bug')) return { label: 'Bug', glyph: 'B', className: 'border-red-500/35 bg-red-500 text-white' };
  if (raw.includes('story')) return { label: 'Story', glyph: 'S', className: 'border-emerald-500/35 bg-emerald-500 text-white' };
  if (raw.includes('automation')) return { label: 'Automation', glyph: 'A', className: 'border-cyan-500/35 bg-cyan-500 text-white' };
  if (raw.includes('todo')) return { label: 'Todo', glyph: 'T', className: 'border-slate-500/35 bg-slate-500 text-white' };
  return { label: 'Task', glyph: 'T', className: 'border-blue-500/35 bg-blue-500 text-white' };
}

function TicketTypeIcon({ task, showLabel = false }: { task: ProTask; showLabel?: boolean }) {
  const info = ticketTypeInfo(task);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${info.label} ticket`}>
      <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none', info.className)}>
        {info.glyph}
      </span>
      {showLabel && <span className="truncate text-[12px] font-medium text-fg-4">{info.label}</span>}
    </span>
  );
}

function TaskCard({
  task,
  selected,
  busyStage,
  draggable,
  isDragging,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  task: ProTask;
  selected: boolean;
  busyStage: ProTaskStage | null;
  draggable?: boolean;
  isDragging?: boolean;
  onSelect: (task: ProTask) => void;
  onDragStart?: (task: ProTask, event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const latestRun = task.stageRuns[0];
  const progress = subtaskProgress(task);
  const cardDescription = cleanTaskDescription(task);
  const remoteStatus = task.jiraFields?.status || jiraRemoteSyncField(task.description, 'Status');
  const assignee = task.jiraFields?.assignee || jiraRemoteSyncField(task.description, 'Assignee') || task.defaultAgent || 'Unassigned';
  const priority = task.jiraFields?.priority || jiraRemoteSyncField(task.description, 'Priority');
  const outputCount = task.outputs?.length || 0;
  const changedFileCount = taskChangedFiles(task).length;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onClick={() => onSelect(task)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(task);
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart?.(task, event);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'jira-task-card group/task w-full rounded-lg border px-3 py-2.5 text-left shadow-[0_1px_0_rgba(255,255,255,0.035)] transition-[border-color,background,transform,opacity,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_8px_18px_rgba(0,0,0,0.12),0_1px_0_rgba(255,255,255,0.04)] active:translate-y-px',
        draggable && 'cursor-grab active:cursor-grabbing',
        taskCardColor(task.status),
        isDragging && 'scale-[0.98] opacity-35 shadow-none',
        selected ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)]' : 'border-edge/70',
      )}
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg-5">
          {task.jiraKey && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <TicketTypeIcon task={task} />
              <span className="font-mono text-fg-3">{task.jiraKey}</span>
            </span>
          )}
          {priority && <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">{priority}</span>}
          {remoteStatus && <span className="max-w-[120px] truncate rounded border border-edge/70 bg-panel-alt/70 px-1.5 py-0.5">{remoteStatus}</span>}
          {outputCount > 0 && <span className="rounded border border-primary/24 bg-primary/[0.08] px-1.5 py-0.5 text-primary">{outputCount} output</span>}
          {changedFileCount > 0 && <span className="rounded border border-[color:var(--th-ok)]/25 bg-[color-mix(in_oklab,var(--th-ok)_9%,transparent)] px-1.5 py-0.5 text-[color:var(--th-ok)]">{changedFileCount} files</span>}
        </div>
        <Badge variant={taskStatusTone(task.status)} className="shrink-0">{STATUS_LABEL[task.status]}</Badge>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-fg">{task.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-5">
            {task.sprint && <span>{task.sprint}</span>}
            <span>{formatTime(task.updatedAt)}</span>
          </div>
        </div>
      </div>
      {cardDescription && <div className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-fg-4">{cardDescription}</div>}
      {progress.total > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-edge bg-panel-alt px-2 py-1.5 text-[11px] text-fg-4">
          <span className="font-semibold text-fg-3">Subtasks</span>
          <span className="font-mono text-fg-3">{progress.done}/{progress.total}</span>
        </div>
      )}
      {latestRun && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-edge/65 bg-panel-alt/62 px-2 py-1.5 text-[11px] text-fg-4">
          {busyStage === latestRun.stage ? <Spinner className="h-3 w-3" /> : null}
          <span className="shrink-0 font-medium text-fg-3">{STAGE_LABEL[latestRun.stage]}</span>
          <span className="min-w-0 truncate">{latestRun.session.agent}:{latestRun.session.sessionId.slice(0, 8)}</span>
        </div>
      )}
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] text-fg-5">
        <span className="min-w-0 truncate">Assignee: {assignee}</span>
        {task.exclusiveMode && <Badge variant="warn">Exclusive</Badge>}
      </div>
    </div>
  );
}

function jiraColumnForTask(task: ProTask): JiraColumnKey {
  if (task.status === 'done' || task.status === 'resolved') return 'done';
  const latest = task.stageRuns[0];
  if (latest?.status === 'failed' || latest?.status === 'cancelled') return 'working';
  if (task.status === 'coding') return 'working';
  if (task.status === 'refinement') return 'refinement';
  return 'backlog';
}

function jiraStatusForColumn(column: JiraColumnKey): ProTaskStatus {
  if (column === 'refinement') return 'refinement';
  if (column === 'working') return 'coding';
  if (column === 'done') return 'done';
  return 'backlog';
}

function taskRemoteStatus(task: ProTask): string | null {
  return task.jiraFields?.status || jiraRemoteSyncField(task.description, 'Status') || null;
}

function isClosedRemoteTask(task: ProTask): boolean {
  if (!task.kind.startsWith('jira')) return false;
  const status = taskRemoteStatus(task)?.trim().toLowerCase();
  return !!status && /^(closed|close|cancelled|canceled)$/.test(status);
}

function statusForChatStage(stage: ProTaskStage): ProTaskStatus | null {
  const match = STATUSES.find(status => STATUS_CHAT_STAGE[status] === stage);
  return match || null;
}

function jiraStageForStatus(status: ProTaskStatus): ProTaskStage | null {
  if (status === 'refinement') return 'refinement';
  if (status === 'coding') return 'coding';
  return null;
}

function JiraCycleKickoffModal({
  open,
  busy,
  draft,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  draft: { name: string; startDate: string; endDate: string };
  onChange: (draft: { name: string; startDate: string; endDate: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title="Kick off cycle"
        description="Choose the date range for this Jira work cycle. Leave the name empty to use the date range."
        onClose={onClose}
      />
      <div className="space-y-3">
        <label className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Cycle name</div>
          <Input
            value={draft.name}
            onChange={event => onChange({ ...draft, name: event.target.value })}
            placeholder="Optional"
          />
        </label>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Start</div>
            <input
              type="date"
              value={draft.startDate}
              onChange={event => onChange({ ...draft, startDate: event.target.value })}
              className="h-9 w-full rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
            />
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">End</div>
            <input
              type="date"
              value={draft.endDate}
              min={draft.startDate || undefined}
              onChange={event => onChange({ ...draft, endDate: event.target.value })}
              className="h-9 w-full rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={busy || !draft.startDate || !draft.endDate} onClick={onSubmit}>
            {busy ? <Spinner /> : null}
            Kick off
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateJiraTaskModal({
  open,
  creating,
  title = 'Create task',
  workspaces,
  assistants,
  defaultWorkdir,
  defaultAgent,
  defaultAssistantId,
  onClose,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  title?: string;
  workspaces: WorkspaceEntry[];
  assistants: AgentAssistant[];
  defaultWorkdir: string;
  defaultAgent: string;
  defaultAssistantId?: string;
  onClose: () => void;
  onCreate: (draft: { title: string; description: string; workdir: string; defaultAgent: string; defaultAssistantId: string }) => void;
}) {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    workdir: defaultWorkdir,
    defaultAgent,
    defaultAssistantId: defaultAssistantId || '',
  });
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDraft({
      title: '',
      description: '',
      workdir: defaultWorkdir,
      defaultAgent,
      defaultAssistantId: defaultAssistantId || '',
    });
  }, [defaultAgent, defaultAssistantId, defaultWorkdir, open]);

  const assistantLabel = assistants.find(assistant => assistant.id === draft.defaultAssistantId)?.name || 'None';
  const workspaceLabel = workspaces.find(workspace => workspace.path === draft.workdir)?.name || workspaceShortLabel(draft.workdir) || 'Workspace';
  const canCreate = !!(draft.title.trim() || draft.description.trim()) && !creating;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title={title}
        description="Describe the task. Title is optional; Pikiclaw can create one from the description."
        onClose={onClose}
      />
      <div className="space-y-3">
        <Input
          autoFocus
          value={draft.title}
          onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))}
          placeholder="Title optional"
        />
        <textarea
          value={draft.description}
          onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))}
          placeholder="Describe what you want done, what success looks like, and any constraints..."
          className="min-h-40 w-full resize-y rounded-lg border border-control-border bg-control px-3.5 py-3 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
        <div className="rounded-lg border border-edge/60 bg-panel-alt/35 px-3">
          <div className="flex items-center justify-between border-b border-edge/45 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Task fields</div>
            <div className="max-w-[220px] truncate text-[11px] text-fg-5">{assistantLabel} · {workspaceLabel}</div>
          </div>
          <label className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg-2">Assign</div>
              <div className="text-[11px] text-fg-5">Optional owner for the first pass</div>
            </div>
            <select value={draft.defaultAssistantId} onChange={event => setDraft(prev => ({ ...prev, defaultAssistantId: event.target.value }))} className="h-8 w-[210px] max-w-[54%] rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">None</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 border-t border-edge/35 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg-2">Workspace</div>
              <div className="truncate text-[11px] text-fg-5">Files and context for this task</div>
            </div>
            <select value={draft.workdir} onChange={event => setDraft(prev => ({ ...prev, workdir: event.target.value }))} className="h-8 w-[210px] max-w-[54%] rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {workspaces.map(ws => <option key={ws.path} value={ws.path}>{ws.name || ws.path.split('/').pop() || ws.path}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
        <Button variant="primary" disabled={!canCreate} onClick={() => onCreate(draft)}>
          {creating ? <Spinner /> : null}
          Create
        </Button>
      </div>
    </Modal>
  );
}

function TaskSpaceSidebar({
  spaces,
  selectedId,
  counts,
  collapsed,
  search,
  searchFocusTick,
  detailLayout,
  onSelect,
  onCreateSpace,
  onSearchChange,
  onDetailLayoutChange,
  onToggleCollapsed,
}: {
  spaces: TaskSpace[];
  selectedId: string;
  counts: Record<string, number>;
  collapsed: boolean;
  search: string;
  searchFocusTick: number;
  detailLayout: TaskDetailLayout;
  onSelect: (spaceId: string) => void;
  onCreateSpace: () => void;
  onSearchChange: (value: string) => void;
  onDetailLayoutChange: (layout: TaskDetailLayout) => void;
  onToggleCollapsed: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const items = [
    { id: ALL_TASKS_SPACE_ID, name: 'All Tasks', kind: 'custom' as const },
    ...spaces,
  ];

  useEffect(() => {
    if (collapsed || searchFocusTick <= 0) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, searchFocusTick]);

  if (collapsed) {
    return null;
  }
  const nextDetailLayout: TaskDetailLayout = detailLayout === 'side' ? 'modal' : 'side';
  const detailLayoutTitle = nextDetailLayout === 'side'
    ? 'Open cards in the right panel'
    : 'Open cards in a dialog';

  return (
    <aside className="panel-isolated hidden h-full w-[300px] max-w-[calc(100vw-16px)] shrink-0 overflow-hidden rounded-xl border border-edge/70 bg-panel/96 shadow-[var(--th-card-shadow)] backdrop-blur-md md:flex md:min-h-0 md:flex-col">
      <div className="shrink-0 border-b border-edge/40 px-3 py-3">
        <div className="grid grid-cols-[32px_minmax(0,1fr)_32px_32px] items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            title="Hide task spaces"
            aria-label="Hide task spaces"
            className="h-8 w-8 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Button>
          <div className="relative group min-w-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-5/40 transition-colors group-focus-within:text-fg-4" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              placeholder="Search tasks"
              className="w-full rounded-lg border border-control-border bg-control py-1.5 pl-8 pr-7 text-[12px] text-fg shadow-sm outline-none transition-all duration-200 placeholder:text-fg-5/35 hover:border-control-border-h focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_3px_var(--th-glow-a)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 rounded p-0.5 text-fg-5/30 transition-colors -translate-y-1/2 hover:text-fg-4"
                title="Clear search"
                aria-label="Clear search"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <Button
            variant={detailLayout === 'modal' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => onDetailLayoutChange(nextDetailLayout)}
            title={detailLayoutTitle}
            aria-label={detailLayoutTitle}
            className={cn(
              'h-8 w-8 shrink-0',
              detailLayout === 'modal' && 'border-primary/35 text-primary',
            )}
          >
            {nextDetailLayout === 'side' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M14 5v14" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2" />
                <path d="M8 9h8" />
              </svg>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCreateSpace}
            title="Create task space"
            aria-label="Create task space"
            className="h-8 w-8 shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.map(space => {
          const active = selectedId === space.id;
          const count = counts[space.id] || 0;
          return (
            <button
              key={space.id}
              type="button"
              onClick={() => onSelect(space.id)}
              className={cn(
                'mb-1 flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition last:mb-0',
                active
                  ? 'border-primary/38 bg-primary/[0.075] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]'
                  : 'border-transparent text-fg-4 hover:border-edge/60 hover:bg-panel-h hover:text-fg-2',
              )}
            >
              <span className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold',
                active ? 'border-primary/35 bg-primary text-white' : 'border-edge bg-panel-alt text-fg-4',
              )}>
                {taskSpaceIcon(space.id, space.kind)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">{space.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-fg-5">{taskSpaceSummary(space.id, count)}</span>
              </span>
              <span className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-4">{count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CreateTaskSpaceModal({
  open,
  busy,
  assistants,
  defaultWorkdir,
  defaultAgent,
  defaultAssistantId,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  assistants: AgentAssistant[];
  defaultWorkdir: string;
  defaultAgent: string;
  defaultAssistantId?: string;
  onClose: () => void;
  onCreate: (draft: { name: string; defaultWorkdir: string; defaultAgent: string; defaultAssistantId: string }) => void;
}) {
  const [draft, setDraft] = useState({ name: '', defaultWorkdir, defaultAgent, defaultAssistantId: defaultAssistantId || '' });

  useEffect(() => {
    if (!open) return;
    setDraft(prev => ({
      name: prev.name,
      defaultWorkdir: prev.defaultWorkdir || defaultWorkdir,
      defaultAgent: prev.defaultAgent || defaultAgent,
      defaultAssistantId: prev.defaultAssistantId || defaultAssistantId || '',
    }));
  }, [defaultAgent, defaultAssistantId, defaultWorkdir, open]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Create task space" description="Use a task space for your own task boards, project work, or writing queues." onClose={onClose} />
      <div className="space-y-3">
        <Input autoFocus value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Pikiclaw Roadmap" />
        <div className="grid gap-2 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Default workspace</div>
            <Input value={draft.defaultWorkdir} onChange={event => setDraft(prev => ({ ...prev, defaultWorkdir: event.target.value }))} placeholder="/path/to/workspace" />
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Default agent</div>
            <select value={draft.defaultAgent} onChange={event => setDraft(prev => ({ ...prev, defaultAgent: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes', 'openclaw'].map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Default assistant</div>
            <select value={draft.defaultAssistantId} onChange={event => setDraft(prev => ({ ...prev, defaultAssistantId: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">Runtime default</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={!draft.name.trim() || busy} onClick={() => onCreate(draft)}>
          {busy ? <Spinner /> : null}
          Create
        </Button>
      </div>
    </Modal>
  );
}

const DEFAULT_JIRA_ASSISTANT_CONFIG: JiraWorkflowConfig = {
  executionOwnerMode: 'status',
  executionMode: 'direct',
  refinementAssistantId: 'assistant_refinement',
  codingAssistantId: 'assistant_coding',
  ticketSyncAssistantId: 'assistant_ticket_sync',
  knowledgeAssistantId: 'assistant_knowledge',
  runKnowledgeOnRefinement: true,
  runKnowledgeOnCoding: true,
  statusWorkflows: {
    refinement: { assistantId: 'assistant_refinement', instruction: 'Analyze goal, scope, risks, dependencies, acceptance criteria, and estimate.' },
    coding: { assistantId: 'assistant_coding', instruction: 'Implement the task with minimal changes, then summarize files, tests, and remaining risk.' },
  },
};

function modelPoolText(models?: string[]): string {
  return (models || []).join(', ');
}

function parseModelPool(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 12);
}

function pickRandomModel(models?: string[]): string | null {
  const pool = (models || []).filter(Boolean);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resolveTaskExecution(task: ProTask, config: JiraWorkflowConfig) {
  return {
    ownerMode: task.execution?.ownerMode || config.executionOwnerMode || 'status',
    agent: task.execution?.agent || config.lifecycleAgent || '',
    assistantId: task.execution?.assistantId || config.lifecycleAssistantId || '',
    mode: task.execution?.mode || config.executionMode || 'direct',
  } as const;
}

function buildStatusWorkflowPrompt(task: ProTask, status: ProTaskStatus, instruction?: string, executionMode: 'direct' | 'interactive' = 'direct'): string | undefined {
  const body = instruction?.trim();
  if (!body) return undefined;
  const modeLine = executionMode === 'interactive'
    ? 'Execution mode: user-intervention. Ask the user only when blocked by missing input, risky choices, credentials, or unclear acceptance points; otherwise keep working.'
    : 'Execution mode: direct. Do not ask the user for routine input; make reasonable assumptions and complete the stage autonomously.';
  return [
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
    '',
    `Pikiclaw task status moved to ${STATUS_LABEL[status]}.`,
    modeLine,
    'Status workflow instruction:',
    body,
  ].filter(Boolean).join('\n');
}

function buildStatusChatPrompt(task: ProTask, status: ProTaskStatus, userPrompt?: string, instruction?: string, executionMode: 'direct' | 'interactive' = 'interactive'): string {
  const modeLine = executionMode === 'direct'
    ? 'Execution mode: direct. Answer proactively and continue with a useful next step when possible.'
    : 'Execution mode: interactive. Answer the user directly, then ask one concise follow-up only if it is needed.';
  return [
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
    '',
    `Open the ${STATUS_LABEL[status]} chat thread for this ticket.`,
    modeLine,
    instruction ? `Status instruction:\n${instruction}` : '',
    userPrompt?.trim()
      ? `User question:\n${userPrompt.trim()}`
      : 'Start with a concise understanding of the ticket and what you can help with in this status.',
  ].filter(Boolean).join('\n');
}

const ANALYZE_TICKET_PROMPT = [
  'Analyze this ticket before coding.',
  'Return a concise Goal & Plan artifact with: goal, scope, assumptions, likely files, risks, and verification steps.',
  'Do not start coding yet. End with a clear recommendation for the next step.',
].join(' ');

const REVISE_PLAN_PROMPT = [
  'Revise the Goal & Plan using the latest chat context.',
  'Keep it concise and actionable, and call out anything still unclear before coding.',
].join(' ');

const START_CODING_PROMPT = [
  'Start coding this ticket based on the agreed Goal & Plan.',
  'Keep changes minimal, inspect the relevant code paths first, and summarize the implementation and verification result when done.',
].join(' ');

function JiraAssistantConfigModal({
  open,
  saving,
  assistants,
  agents,
  config,
  onClose,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  assistants: AgentAssistant[];
  agents: AgentRuntimeStatus[];
  config: JiraWorkflowConfig;
  onClose: () => void;
  onSave: (config: JiraWorkflowConfig) => void;
}) {
  const [draft, setDraft] = useState<JiraWorkflowConfig>({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...config });

  useEffect(() => {
    if (!open) return;
    setDraft({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...config });
  }, [config, open]);

  const renderSelect = (label: string, field: keyof Pick<JiraWorkflowConfig, 'refinementAssistantId' | 'codingAssistantId' | 'ticketSyncAssistantId' | 'knowledgeAssistantId'>) => (
    <label className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">{label}</div>
      <select
        value={(draft[field] as string | undefined) || ''}
        onChange={event => setDraft(prev => ({ ...prev, [field]: event.target.value || undefined }))}
        className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
      >
        <option value="">Runtime default</option>
        {assistants.map(assistant => (
          <option key={assistant.id} value={assistant.id}>{assistant.name}</option>
        ))}
      </select>
    </label>
  );

  const renderStatusWorkflow = (status: ProTaskStatus) => {
    const workflow = draft.statusWorkflows?.[status] || {};
    const patch = (next: Partial<NonNullable<JiraWorkflowConfig['statusWorkflows']>[ProTaskStatus]>) => {
      setDraft(prev => ({
        ...prev,
        statusWorkflows: {
          ...(prev.statusWorkflows || {}),
          [status]: { ...(prev.statusWorkflows?.[status] || {}), ...next },
        },
      }));
    };
    return (
      <div key={status} className="rounded-md border border-edge bg-panel-alt px-3 py-2.5">
        <div className="mb-2 text-[12px] font-semibold text-fg">{STATUS_LABEL[status]}</div>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Assistant</div>
            <select
              value={workflow.assistantId || ''}
              onChange={event => patch({ assistantId: event.target.value || undefined })}
              className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
            >
              <option value="">No assistant / runtime default</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Model pool</div>
            <Input
              value={modelPoolText(workflow.modelPool)}
              onChange={event => patch({ modelPool: parseModelPool(event.target.value) })}
              placeholder="gpt-5.1, claude-sonnet-4.5"
            />
          </label>
        </div>
        <textarea
          value={workflow.instruction || ''}
          onChange={event => patch({ instruction: event.target.value })}
          placeholder={`What should the agent do when a task enters ${STATUS_LABEL[status]}?`}
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[12px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Jira assistants" onClose={onClose} />
      <div className="space-y-4">
        <div className="rounded-md border border-edge bg-panel-alt px-3 py-2.5">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Lifecycle owner</div>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Owner mode</div>
              <select
                value={draft.executionOwnerMode || 'status'}
                onChange={event => setDraft(prev => ({ ...prev, executionOwnerMode: event.target.value as JiraWorkflowConfig['executionOwnerMode'] }))}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
              >
                <option value="status">Per-status workflow</option>
                <option value="agent">Single agent owns lifecycle</option>
                <option value="assistant">Single assistant owns lifecycle</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Lifecycle agent</div>
              <select
                value={draft.lifecycleAgent || ''}
                onChange={event => setDraft(prev => ({ ...prev, lifecycleAgent: event.target.value || undefined }))}
                disabled={draft.executionOwnerMode !== 'agent'}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40 disabled:opacity-50"
              >
                <option value="">Runtime default</option>
                {agents.filter(agent => agent.installed).map(agent => <option key={agent.agent} value={agent.agent}>{agent.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Lifecycle assistant</div>
              <select
                value={draft.lifecycleAssistantId || ''}
                onChange={event => setDraft(prev => ({ ...prev, lifecycleAssistantId: event.target.value || undefined }))}
                disabled={draft.executionOwnerMode !== 'assistant'}
                className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40 disabled:opacity-50"
              >
                <option value="">Runtime default</option>
                {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 inline-flex rounded-lg border border-edge/60 bg-inset p-0.5">
            {(['direct', 'interactive'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setDraft(prev => ({ ...prev, executionMode: mode }))}
                className={cn(
                  'h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                  (draft.executionMode || 'direct') === mode ? 'bg-panel text-fg shadow-sm' : 'text-fg-5 hover:bg-panel-h hover:text-fg-3',
                )}
              >
                {mode === 'direct' ? 'Direct' : 'Needs input'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {renderSelect('Refinement', 'refinementAssistantId')}
          {renderSelect('Working', 'codingAssistantId')}
          {renderSelect('Daily sync', 'ticketSyncAssistantId')}
          {renderSelect('Knowledge', 'knowledgeAssistantId')}
        </div>
        <div className="space-y-2 rounded-md border border-edge bg-panel-alt px-3 py-2.5">
          <label className="flex items-center justify-between gap-3 text-[12px] text-fg-3">
            <span>Run Knowledge Assistant when task enters Refinement</span>
            <input
              type="checkbox"
              checked={draft.runKnowledgeOnRefinement !== false}
              onChange={event => setDraft(prev => ({ ...prev, runKnowledgeOnRefinement: event.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[12px] text-fg-3">
            <span>Run Knowledge Assistant when task enters Working</span>
            <input
              type="checkbox"
              checked={draft.runKnowledgeOnCoding !== false}
              onChange={event => setDraft(prev => ({ ...prev, runKnowledgeOnCoding: event.target.checked }))}
            />
          </label>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Status workflows</div>
          <div className="grid gap-3 md:grid-cols-2">
            {VISIBLE_STATUSES.map(renderStatusWorkflow)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(draft)} disabled={saving}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </Modal>
  );
}

function estimateTotal(run: StageRun): string | null {
  const estimate = run.output?.estimate;
  if (!estimate) return null;
  const total = estimate.totalMinutes
    ?? [estimate.codingMinutes, estimate.userUnderstandingMinutes, estimate.reviewMinutes, estimate.verificationMinutes]
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
  return total ? `${total}m` : null;
}

function estimateSummary(run: StageRun): string | null {
  const estimate = run.output?.estimate;
  if (!estimate) return null;
  const parts: string[] = [];
  if (typeof estimate.estimatePoint === 'number' && Number.isFinite(estimate.estimatePoint)) {
    parts.push(`${estimate.estimatePoint} pt`);
  }
  const total = estimateTotal(run);
  if (total) parts.push(total);
  if (estimate.confidence) parts.push(estimate.confidence);
  return parts.length ? parts.join(' · ') : null;
}

function latestAgentEstimate(task: ProTask): string | null {
  const runTime = (run: StageRun) => {
    const value = Date.parse(run.startedAt || run.completedAt || '');
    return Number.isFinite(value) ? value : 0;
  };
  const run = [...(task.stageRuns || [])]
    .filter(item => item.output?.estimate)
    .sort((a, b) => runTime(b) - runTime(a))[0];
  return run ? estimateSummary(run) : null;
}

function compactMessageText(message: RichMessage): string {
  const text = message.text || message.blocks?.filter(block => block.type === 'text').map(block => block.content).join('\n') || '';
  return text.trim();
}

function TaskDescriptionMarkdown({ task }: { task: ProTask }) {
  const mdComponents = useMemo(() => createMdComponents({ workdir: task.workdir }), [task.workdir]);
  const description = cleanTaskDescription(task);
  return (
    <div className="session-md max-w-[880px] text-[13px] leading-relaxed text-fg-3">
      <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
        {description || 'No description yet.'}
      </ReactMarkdown>
    </div>
  );
}

type TaskFlowStepStatus = 'done' | 'active' | 'waiting';

const TASK_FLOW_STEPS: Array<{ key: string; label: string; stage?: ProTaskStage; completedBy?: ProTaskStatus[] }> = [
  { key: 'refinement', label: 'Refinement', stage: 'refinement', completedBy: ['coding', 'resolved', 'done'] },
  { key: 'coding', label: 'Coding', stage: 'coding', completedBy: ['resolved', 'done'] },
  { key: 'self-test', label: 'Self test', stage: 'verification', completedBy: ['done'] },
  { key: 'deploy', label: 'Deploy', stage: 'demo', completedBy: ['done'] },
  { key: 'done', label: 'Done', completedBy: ['done'] },
];

function latestTaskStageRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])].sort((a, b) => {
    const bTime = Date.parse(b.startedAt || b.completedAt || '');
    const aTime = Date.parse(a.startedAt || a.completedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  })[0] || null;
}

function currentFlowStage(task: ProTask, busyStage?: ProTaskStage | null): ProTaskStage | 'done' {
  if (busyStage) return busyStage;
  const latestRun = latestTaskStageRun(task);
  if (latestRun && latestRun.status !== 'completed') return latestRun.stage;
  if (task.status === 'done') return 'done';
  if (task.status === 'coding') return 'coding';
  if (task.status === 'resolved') return 'verification';
  return 'refinement';
}

function taskFlowStatus(task: ProTask, step: (typeof TASK_FLOW_STEPS)[number], activeStage: ProTaskStage | 'done'): TaskFlowStepStatus {
  if (step.completedBy?.includes(task.status)) return 'done';
  if (step.stage && task.stageRuns?.some(run => run.stage === step.stage && run.status === 'completed')) return 'done';
  if (!step.stage && task.status === 'done') return 'done';
  if ((step.stage && activeStage === step.stage) || (!step.stage && activeStage === 'done')) return 'active';
  return 'waiting';
}

function TaskFlowMap({ task, busyStage, compact = false }: { task: ProTask; busyStage?: ProTaskStage | null; compact?: boolean }) {
  const activeStage = currentFlowStage(task, busyStage);
  const latestRun = latestTaskStageRun(task);
  const steps = TASK_FLOW_STEPS.map(step => ({ ...step, status: taskFlowStatus(task, step, activeStage) }));
  const completed = steps.filter(step => step.status === 'done').length;
  const activeStep = steps.find(step => step.status === 'active') || [...steps].reverse().find(step => step.status === 'done') || steps[0];
  const activeStatusText = latestRun
    ? `${STAGE_LABEL[latestRun.stage]} is ${latestRun.status}`
    : activeStep
      ? `${activeStep.label} is current`
      : 'The first agent message will shape this flow.';

  return (
    <div
      className={cn(
        'w-full rounded-lg border border-edge/65 bg-panel/82 px-3.5 shadow-sm',
        compact ? 'py-2.5' : 'py-3',
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-primary">Task progress</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-fg-5">
            <span className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
              activeStep?.status === 'done' && 'border-ok bg-ok text-white',
              activeStep?.status === 'active' && 'border-primary bg-primary text-primary-fg',
              (!activeStep || activeStep.status === 'waiting') && 'border-edge bg-panel text-fg-5',
            )}>
              {activeStep?.status === 'done' ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              ) : activeStep?.status === 'active' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              ) : null}
            </span>
            <span className="truncate">
              <span className="font-semibold text-fg-3">{activeStep?.label || 'Current'}</span>
              <span className="text-fg-5"> · {activeStatusText}</span>
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-fg-5">{completed}/{steps.length} Complete</span>
      </div>
      <div className={cn('h-1.5 overflow-hidden rounded-full bg-inset', compact ? 'mt-2' : 'mb-3 mt-3')}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(8, (completed / steps.length) * 100)}%` }} />
      </div>
      {!compact && (
        <div className="space-y-1.5">
          {steps.map(step => (
            <div
              key={step.key}
              className={cn(
                'flex min-h-8 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                step.status === 'done' && 'border-ok/20 bg-ok/10 text-ok',
                step.status === 'active' && 'border-primary/35 bg-primary/10 text-primary',
                step.status === 'waiting' && 'border-edge/55 bg-panel-alt/48 text-fg-5',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                  step.status === 'done' && 'border-ok bg-ok text-white',
                  step.status === 'active' && 'border-primary bg-primary text-primary-fg',
                  step.status === 'waiting' && 'border-edge bg-panel text-fg-5',
                )}
              >
                {step.status === 'done' ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                ) : step.status === 'active' ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                ) : null}
              </span>
              <span className="min-w-0 truncate">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskGeneratedBlocks({
  task,
  busyStage,
  compact = false,
  subtaskDraft,
  onOpenTicket,
  onOpenArtifacts,
  onSubtaskDraftChange,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartSubtask,
}: {
  task: ProTask;
  busyStage?: ProTaskStage | null;
  compact?: boolean;
  subtaskDraft: { title: string; description: string; assignedAgent: string; assistantId: string };
  onOpenTicket: () => void;
  onOpenArtifacts: () => void;
  onSubtaskDraftChange: (draft: { title: string; description: string; assignedAgent: string; assistantId: string }) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
  onStartSubtask: (task: ProTask, subtaskId: string) => void;
}) {
  const sortedRuns = useMemo(() => [...(task.stageRuns || [])].sort((a, b) => {
    const bTime = Date.parse(b.startedAt || b.completedAt || '');
    const aTime = Date.parse(a.startedAt || a.completedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  }), [task.stageRuns]);
  const latestRun = sortedRuns[0] || null;
  const latestFocus = sortedRuns.find(run => run.focus)?.focus;
  const openQuestions = latestFocus?.questions?.filter(question => question.status === 'open') || [];
  const answeredQuestions = latestFocus?.questions?.filter(question => question.status === 'answered') || [];
  const outputs = task.outputs || [];
  const reviewItems = [
    ...task.subTasks.filter(item => item.status === 'review' || item.status === 'blocked').map(item => ({
      id: item.id,
      title: item.title,
      status: item.status,
    })),
    ...task.verificationRuns.filter(run => run.result === 'failed' || run.result === 'blocked').map(run => ({
      id: run.id,
      title: run.notes || `${run.environment} verification`,
      status: run.result || 'blocked',
    })),
  ];
  const progress = subtaskProgress(task);
  const changedFiles = taskChangedFiles(task);
  const codingRuns = sortedRuns.filter(run => run.stage === 'coding');
  const latestCodingRun = codingRuns[0] || null;
  const workingActive = displayTaskStatus(task.status) === 'coding' || busyStage === 'coding' || latestCodingRun?.status === 'running' || latestCodingRun?.status === 'queued' || latestCodingRun?.status === 'waiting-user';
  const currentStep = latestRun
    ? `${STAGE_LABEL[latestRun.stage]} is ${latestRun.status}`
    : task.status === 'backlog'
      ? 'Ready to clarify'
      : `${STATUS_LABEL[task.status]} stage`;
  const nextStep = task.status === 'backlog'
    ? 'Clarify goal, scope, and acceptance criteria'
    : task.status === 'refinement'
      ? 'Confirm plan and move into execution'
      : task.status === 'coding'
        ? 'Track implementation output and tests'
        : task.status === 'resolved'
          ? 'Review outputs and verification'
          : 'Task is done';
  const planNodes = latestFocus?.mindMap?.filter(node => node.kind === 'plan' || node.kind === 'acceptance' || node.kind === 'risk') || [];

  return (
    <div className="mb-5 grid gap-3">
      <section className="rounded-xl border border-edge/65 bg-panel/72 px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-fg-2">Task status</div>
            <div className="mt-0.5 text-[11px] text-fg-5">{currentStep}</div>
          </div>
          <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
        </div>
        <div className={cn('grid gap-2', !compact && 'md:grid-cols-3')}>
          <TaskMetaItem label="Goal" value={task.title} />
          <TaskMetaItem label="Next" value={nextStep} />
          <TaskMetaItem label="Outputs" value={`${outputs.length} output${outputs.length === 1 ? '' : 's'}`} />
        </div>
      </section>

      {workingActive && (
        <section className="rounded-xl border border-primary/25 bg-primary/[0.045] px-4 py-3 shadow-sm">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">
                {busyStage === 'coding' || latestCodingRun?.status === 'running' ? <Spinner className="h-3.5 w-3.5" /> : null}
                <span>Working progress</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg-5">{latestCodingRun?.output?.summary || latestCodingRun?.status || 'Preparing coding work'}</div>
            </div>
            <Badge variant="accent">{changedFiles.length} changed files</Badge>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-inset">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: latestCodingRun?.status === 'completed' ? '100%' : changedFiles.length > 0 ? '68%' : '34%' }}
            />
          </div>
          <div className={cn('grid gap-2', !compact && 'md:grid-cols-4')}>
            <TaskMetaItem label="Files viewed" value={changedFiles.length ? `${changedFiles.length}+` : '--'} />
            <TaskMetaItem label="Searches" value="tracked in chat" />
            <TaskMetaItem label="Commands/tests" value={latestCodingRun?.output?.testResultId || 'tracked in chat'} />
            <TaskMetaItem label="Current step" value={latestCodingRun ? `${STAGE_LABEL[latestCodingRun.stage]} · ${latestCodingRun.status}` : 'Starting'} />
          </div>
        </section>
      )}

      <div className={cn('grid gap-3', !compact && 'xl:grid-cols-2')}>
        <section className="rounded-xl border border-edge/65 bg-panel/66 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-fg-2">Clarification</div>
            <button type="button" onClick={onOpenTicket} className="text-[11px] font-medium text-primary hover:underline">Ticket</button>
          </div>
          {openQuestions.length === 0 && answeredQuestions.length === 0 ? (
            <div className="text-[12px] leading-relaxed text-fg-5">No clarification questions yet. Start a Focus or Clarify chat to generate them.</div>
          ) : (
            <div className="space-y-2">
              {[...openQuestions, ...answeredQuestions].slice(0, 4).map(question => (
                <div key={question.id} className="rounded-lg border border-edge/55 bg-panel-alt/48 px-3 py-2">
                  <div className="text-[12px] font-medium text-fg-3">{question.question}</div>
                  <div className="mt-1 text-[11px] text-fg-5">{question.status === 'answered' ? question.answer || 'Answered' : 'Open'}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-edge/65 bg-panel/66 px-4 py-3">
          <div className="mb-2 text-[13px] font-semibold text-fg-2">Plan</div>
          {planNodes.length === 0 ? (
            <div className="text-[12px] leading-relaxed text-fg-5">Plan, risks, and acceptance criteria will appear after a Focus or Clarify stage.</div>
          ) : (
            <div className="space-y-2">
              {planNodes.slice(0, 5).map(node => (
                <div key={node.id} className="flex items-start gap-2 text-[12px] text-fg-3">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', node.kind === 'risk' ? 'bg-warn' : node.kind === 'acceptance' ? 'bg-ok' : 'bg-primary')} />
                  <span className="min-w-0">{node.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className={cn('grid gap-3', !compact && 'xl:grid-cols-3')}>
        <section className="rounded-xl border border-edge/65 bg-panel/66 px-4 py-3">
          <div className="mb-2 text-[13px] font-semibold text-fg-2">Execution timeline</div>
          {sortedRuns.length === 0 ? (
            <div className="text-[12px] text-fg-5">No stage run yet.</div>
          ) : (
            <div className="space-y-2">
              {sortedRuns.slice(0, 4).map(run => (
                <div key={run.id} className="flex items-center gap-2 text-[12px]">
                  <Badge variant={stageTone(run.stage)}>{STAGE_LABEL[run.stage]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-fg-3">{run.status}</span>
                  <span className="shrink-0 text-[10px] text-fg-5">{formatTime(run.completedAt || run.startedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-edge/65 bg-panel/66 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-semibold text-fg-2">Subtasks</div>
            <span className="font-mono text-[11px] text-fg-5">{progress.done}/{progress.total}</span>
          </div>
          <div className="mb-2 flex gap-1.5">
            <Input
              value={subtaskDraft.title}
              onChange={event => onSubtaskDraftChange({ ...subtaskDraft, title: event.target.value })}
              placeholder="Split a child task..."
              className="h-8 text-[12px]"
            />
            <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" disabled={!subtaskDraft.title.trim()} onClick={() => onCreateSubtask(task)}>
              Add
            </Button>
          </div>
          {task.subTasks.length === 0 ? (
            <div className="text-[12px] text-fg-5">No subtasks yet.</div>
          ) : (
            <div className="space-y-2">
              {task.subTasks.slice(0, 4).map(subtask => (
                <div key={subtask.id} className="flex items-center gap-2 text-[12px]">
                  <select
                    value={subtask.status}
                    onChange={event => onUpdateSubtaskStatus(task, subtask.id, event.target.value as ProSubtaskStatus)}
                    className="h-6 shrink-0 rounded border border-edge bg-panel-alt px-1.5 text-[10px] text-fg-3 outline-none focus:border-primary/40"
                  >
                    {SUBTASK_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <span className="min-w-0 flex-1 truncate text-fg-3">{subtask.title}</span>
                  {subtask.assignedAgent && <span className="shrink-0 text-[10px] text-fg-5">{subtask.assignedAgent}</span>}
                  <button
                    type="button"
                    disabled={busyStage === 'coding'}
                    onClick={() => onStartSubtask(task, subtask.id)}
                    className="inline-flex h-6 shrink-0 items-center rounded border border-edge bg-panel px-1.5 text-[10px] font-medium text-fg-4 transition hover:border-primary/35 hover:bg-primary/[0.07] hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                  >
                    Run
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-edge/65 bg-panel/66 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-fg-2">Outputs</div>
            <button type="button" onClick={onOpenArtifacts} className="text-[11px] font-medium text-primary hover:underline">Open</button>
          </div>
          {outputs.length === 0 && reviewItems.length === 0 ? (
            <div className="text-[12px] text-fg-5">Generated events appear in chat. Documents, diffs, links, and review items live in the right sidebar.</div>
          ) : (
            <div className="space-y-2">
              {outputs.slice(0, 3).map(output => (
                <div key={output.id} className="rounded-lg border border-edge/55 bg-panel-alt/48 px-3 py-2">
                  <div className="truncate text-[12px] font-medium text-fg-3">{output.title}</div>
                  {output.summary && <div className="mt-1 line-clamp-2 text-[11px] text-fg-5">{output.summary}</div>}
                </div>
              ))}
              {reviewItems.slice(0, 2).map(item => (
                <div key={item.id} className="rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2">
                  <div className="truncate text-[12px] font-medium text-fg-3">{item.title}</div>
                  <div className="mt-1 text-[11px] text-warn">{item.status}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TaskChatWindow({
  task,
  actions,
  busyStage,
  agents,
  defaultAgent,
  onStartStatusChat,
  onOpenTicket,
  onOpenArtifacts,
  artifactCount,
}: {
  task: ProTask;
  actions?: ReactNode;
  busyStage?: ProTaskStage | null;
  agents: AgentRuntimeStatus[];
  defaultAgent: string;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string) => Promise<void>;
  onOpenTicket: () => void;
  onOpenArtifacts: () => void;
  artifactCount: number;
}) {
  const currentDefaultAgent = taskAssignee(task, defaultAgent);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<RichMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(currentDefaultAgent);
  const [chatStatus, setChatStatus] = useState<ProTaskStatus>(displayTaskStatus(task.status));
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, StageSessionRef>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const agentOptions = useMemo(() => {
    const options = new Map<string, string>();
    const add = (value?: string | null, label?: string | null) => {
      const normalized = value?.trim();
      if (normalized && !options.has(normalized)) options.set(normalized, label?.trim() || normalized);
    };
    add(currentDefaultAgent);
    add(task.defaultAgent);
    add(task.execution?.agent);
    for (const agent of agents.filter(item => item.installed)) add(agent.agent, agent.label);
    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [agents, currentDefaultAgent, task.defaultAgent, task.execution?.agent]);
  useEffect(() => {
    setChatStatus(displayTaskStatus(task.status));
  }, [task.id, task.status]);

  useEffect(() => {
    setSessionOverrides({});
  }, [task.id]);

  const activeStatus = chatStatus;
  const runsByStatus = useMemo(() => {
    const grouped = new Map<ProTaskStatus, StageRun[]>();
    for (const status of STATUSES) grouped.set(status, []);
    for (const run of task.stageRuns || []) {
      const status = statusForChatStage(run.stage);
      if (status) grouped.get(status)?.push(run);
    }
    for (const runs of grouped.values()) {
      runs.sort((a, b) => {
        const bTime = Date.parse(b.startedAt || b.completedAt || '');
        const aTime = Date.parse(a.startedAt || a.completedAt || '');
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });
    }
    return grouped;
  }, [task.stageRuns]);
  const activeRuns = runsByStatus.get(activeStatus) || [];
  const run = activeRuns[0] || null;
  const runSession = run ? sessionOverrides[run.id] || run.session : null;
  const activeStage = STATUS_CHAT_STAGE[activeStatus];
  const agentDiffersFromRun = !!runSession && !!selectedAgent && runSession.agent !== selectedAgent;
  const missingSessionHistory = !!run && !!error && /session history file not found/i.test(error);
  const canSendToRun = !!run && !agentDiffersFromRun && !missingSessionHistory;
  const fields = task.jiraFields || {};
  const brief = taskBriefSummary(task);
  const summaryFallback = 'No ticket description yet. Ask the agent to inspect the task and create a plan.';
  const ticketSummary = brief || summaryFallback;
  const meaningfulMessages = messages.filter(message => !!compactMessageText(message));
  const lastMeaningfulMessage = meaningfulMessages[meaningfulMessages.length - 1] || null;
  const showOutputActions = !!lastMeaningfulMessage && lastMeaningfulMessage.role !== 'user';
  const mdComponents = useMemo(
    () => createMdComponents({ workdir: runSession?.workdir || task.workdir }),
    [runSession?.workdir, task.workdir],
  );

  useEffect(() => {
    setMessages([]);
    setError(null);
    setDraft('');
    setReloadKey(0);
    setSelectedAgent(currentDefaultAgent);
    setChatStatus(displayTaskStatus(task.status));
  }, [currentDefaultAgent, task.id, task.status]);

  useEffect(() => {
    if (!run) {
      setMessages([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const session = runSession || run.session;
    api.getSessionMessages(session.workdir, session.agent, session.sessionId, { lastNTurns: 16, rich: true })
      .then(result => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error || 'Failed to load chat');
          setMessages([]);
          return;
        }
        setMessages((result.richMessages || []).slice(-32));
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey, run?.id, runSession?.agent, runSession?.sessionId, runSession?.workdir]);

  const focusComposer = (seed?: string) => {
    if (seed) setDraft(current => current || seed);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const startChat = async (status: ProTaskStatus = activeStatus, prompt?: string) => {
    setError(null);
    setSending(true);
    setChatStatus(status);
    try {
      await onStartStatusChat(task, status, prompt, selectedAgent);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    const prompt = draft.trim();
    if (!prompt || sending) return;
    if (!canSendToRun || !run) {
      await startChat(activeStatus, prompt);
      return;
    }
    setError(null);
    setSending(true);
    try {
      const session = runSession || run.session;
      const result = await api.sendSessionMessage(session.workdir, session.agent, session.sessionId, prompt);
      if (!result.ok) throw new Error(result.error || 'Failed to send message');
      setDraft('');
      setReloadKey(value => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleRunSessionChange = useCallback((next: SessionPanelChange) => {
    if (!run) return;
    const nextSession: StageSessionRef = { workdir: next.workdir, agent: next.agent, sessionId: next.sessionId };
    setSessionOverrides(current => ({ ...current, [run.id]: nextSession }));
    if (
      nextSession.workdir !== run.session.workdir
      || nextSession.agent !== run.session.agent
      || nextSession.sessionId !== run.session.sessionId
    ) {
      void api.updateProTaskStageRun(task.id, run.id, { session: nextSession }).catch(() => {});
    }
  }, [run, task.id]);

  const taskHeader = (
    <div className="relative mx-auto max-w-[760px] overflow-hidden rounded-xl border border-edge/70 bg-panel/78 shadow-[0_14px_38px_rgba(15,23,42,0.12)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="relative px-3.5 py-3">
        <div className="line-clamp-2 text-[12px] leading-relaxed text-fg-4">
          {ticketSummary}
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-edge/45 pt-2 text-[11px] text-fg-5">
          <button type="button" onClick={onOpenArtifacts} className="rounded-md px-1.5 py-1 transition hover:bg-panel-h hover:text-fg-3">
            {artifactCount ? `${artifactCount} output${artifactCount === 1 ? '' : 's'}` : 'Outputs open in the sidebar'}
          </button>
        </div>
      </div>
    </div>
  );

  const panelSession = run && runSession ? ({
    sessionId: runSession.sessionId,
    agent: runSession.agent,
    workdir: runSession.workdir,
    runState: run.status === 'failed' || run.status === 'cancelled'
      ? 'incomplete'
      : run.status === 'completed'
        ? 'completed'
        : 'running',
    runStartedAt: run.startedAt,
    runUpdatedAt: run.completedAt || run.startedAt,
    title: task.title,
    lastQuestion: run.prompt,
  } satisfies SessionInfo) : null;

  if (run && runSession && panelSession) {
    const isPendingSession = runSession.sessionId.startsWith('pending_');
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--th-session-bg)]">
        <div className="shrink-0 px-5 pb-3 pt-3">
          {taskHeader}
        </div>
        <div className="min-h-0 flex-1">
          <SessionPanel
            key={run.id}
            session={panelSession}
            workdir={runSession.workdir}
            active
            transcriptHeader={(
              <>
                <div className="mb-4 flex min-w-0 items-center justify-center gap-2 text-[11px] text-fg-5">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                  <span className="max-w-full truncate rounded-md border border-edge/65 bg-panel-alt/70 px-2 py-1 font-mono">
                    {STAGE_LABEL[activeStage]} · {runSession.agent}:{runSession.sessionId}
                  </span>
                </div>
              </>
            )}
            initialPendingPrompt={isPendingSession ? run.prompt : null}
            initialPendingCreatedAt={isPendingSession ? run.startedAt || null : null}
            onSessionChange={handleRunSessionChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[var(--th-session-bg)]">
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-[130px]">
        <div className="mx-auto max-w-[860px] px-5 pb-5">
          <div className="sticky top-0 z-20 -mx-5 mb-5 px-5 pb-3 pt-3">
            <div className="absolute inset-x-0 top-0 h-[calc(100%+28px)] bg-gradient-to-b from-[var(--th-session-bg)] via-[var(--th-session-bg)]/92 to-transparent" />
            {taskHeader}
          </div>
          {run && (
            <div className="mb-4 flex min-w-0 items-center justify-center gap-2 text-[11px] text-fg-5">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              <span className="max-w-full truncate rounded-md border border-edge/65 bg-panel-alt/70 px-2 py-1 font-mono">
                {STAGE_LABEL[activeStage]} · {run.session.agent}:{run.session.sessionId}
              </span>
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-fg-5"><Spinner /> Loading chat...</div>
          ) : missingSessionHistory ? (
            <div className="flex min-h-[270px] items-center justify-center px-4 text-center">
              <div className="max-w-[520px] rounded-xl border border-edge/65 bg-panel/70 px-4 py-3 text-left shadow-sm">
                <div className="text-[13px] font-semibold text-fg-2">Previous chat unavailable</div>
                <div className="mt-1 text-[12px] leading-relaxed text-fg-5">
                  The previous agent session is missing locally. Send a message below to continue this task in a fresh chat.
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="text-[12px] text-err">{error}</div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center px-4 text-center">
              <div className="max-w-[420px] text-[12px] leading-relaxed text-fg-5">
                Send a message in the composer to start or continue this task.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => {
                const text = compactMessageText(message);
                if (!text) return null;
                const user = message.role === 'user';
                return (
                  <div key={`${message.role}-${message.createdAt || index}`} className={cn('flex', user ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[78%] rounded-md border px-3 py-2 text-[12px] leading-relaxed',
                      user
                        ? 'border-primary/25 bg-primary/[0.07] text-fg-2'
                        : 'border-edge bg-panel text-fg-3',
                    )}>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{user ? 'User' : 'Agent'}</div>
                      <div className="session-md text-[12px] leading-relaxed">
                        <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
                          {text}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}
              {showOutputActions && (
                <div className="flex justify-start">
                  <div className="max-w-[78%] rounded-lg border border-edge/60 bg-panel-alt/68 px-3 py-2 shadow-sm">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Next actions</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={sending || busyStage === STATUS_CHAT_STAGE.coding}
                        onClick={() => { void startChat('coding', START_CODING_PROMPT); }}
                        className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-fg transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-45"
                      >
                        {busyStage === STATUS_CHAT_STAGE.coding ? <Spinner className="mr-1 h-3 w-3" /> : null}
                        Start coding
                      </button>
                      <button
                        type="button"
                        disabled={sending || busyStage === STATUS_CHAT_STAGE.refinement}
                        onClick={() => { void startChat('refinement', REVISE_PLAN_PROMPT); }}
                        className="inline-flex h-7 items-center rounded-md border border-edge/70 bg-panel px-2.5 text-[11px] font-medium text-fg-3 transition hover:border-primary/35 hover:bg-primary/[0.07] hover:text-fg disabled:pointer-events-none disabled:opacity-45"
                      >
                        Revise plan
                      </button>
                      <button
                        type="button"
                        onClick={() => focusComposer('I have a follow-up question: ')}
                        className="inline-flex h-7 items-center rounded-md border border-edge/70 bg-panel px-2.5 text-[11px] font-medium text-fg-3 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
                      >
                        Ask follow-up
                      </button>
                      <button
                        type="button"
                        onClick={onOpenArtifacts}
                        className="inline-flex h-7 items-center rounded-md border border-edge/70 bg-panel px-2.5 text-[11px] font-medium text-fg-3 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
                      >
                        Open outputs
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 border-t border-edge/45 bg-[var(--th-session-bg)]/95 px-5 pb-4 pt-3 backdrop-blur-md">
        <div className="pointer-events-auto mx-auto w-full max-w-[860px]">
          <div className="relative rounded-lg border border-edge bg-inset/70 transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-control-border-h focus-within:bg-control focus-within:shadow-[0_0_0_3px_var(--th-glow-a)]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask the agent about this task..."
              className="block min-h-[62px] w-full resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-5/60"
            />
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-2.5 pb-2 pt-1">
              <label className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[11px] font-medium text-fg-5/70 transition-colors hover:bg-panel-h/50 hover:text-fg-4">
                <span>Agent</span>
                <select
                  value={selectedAgent}
                  onChange={event => setSelectedAgent(event.target.value)}
                  className="max-w-[150px] appearance-none bg-transparent text-[11px] font-medium text-fg-3 outline-none"
                >
                  {agentOptions.map(agent => <option key={agent.value} value={agent.value}>{agent.label}</option>)}
                </select>
              </label>
              <div className="min-w-0 flex-1" />
              {!run && !draft.trim() && (
                <span className="hidden text-[11px] text-fg-5 sm:inline">First message starts a task chat</span>
              )}
              <button
                type="button"
                disabled={sending || busyStage === activeStage || (!draft.trim() && canSendToRun)}
                onClick={() => {
                  if (draft.trim()) void sendMessage();
                  else void startChat(activeStatus);
                }}
                className={cn(
                  'inline-flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium leading-none transition-all duration-200',
                  sending || busyStage === activeStage || (!draft.trim() && canSendToRun)
                    ? 'bg-fg/6 text-fg-5/20'
                    : 'bg-primary text-primary-fg shadow-sm hover:brightness-110',
                )}
              >
                {sending ? <Spinner className="h-3.5 w-3.5" /> : null}
                <span className="whitespace-nowrap">{draft.trim() ? 'Send' : canSendToRun ? 'Send' : 'Start work'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskSectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
      <h4 className="text-[13px] font-semibold tracking-tight text-fg-2">{children}</h4>
      {action}
    </div>
  );
}

function TaskMetaItem({ label, value, mono = false, title }: { label: string; value?: string | null; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-5">{label}</div>
      <div
        title={title || value || undefined}
        className={cn('mt-0.5 truncate text-[12px] text-fg-3', mono && 'font-mono')}
      >
        {value || '--'}
      </div>
    </div>
  );
}

function taskAssignee(task: ProTask, fallbackAgent: string): string {
  return task.execution?.agent || task.defaultAgent || fallbackAgent || 'Unassigned';
}

function taskAssignedAssistant(task: ProTask, assistants: AgentAssistant[]): string {
  const assistantId = task.execution?.assistantId || task.defaultAssistantId;
  if (!assistantId) return 'None';
  return assistants.find(assistant => assistant.id === assistantId)?.name || assistantId;
}

function taskProjectName(task: ProTask): string {
  const labels = task.jiraFields?.labels || [];
  const projectLabel = labels.find(label => /ivar|nova|air|asm|iag|cac/i.test(label));
  if (projectLabel) return projectLabel;
  if (task.workdir) return task.workdir.split('/').filter(Boolean).pop() || task.workdir;
  return task.sprint || '--';
}

function linkedPullRequests(task: ProTask): string[] {
  const matches = [
    task.prUrl,
    ...(task.description?.match(/https?:\/\/\S*merge_requests\/\d+/g) || []),
  ].filter(Boolean) as string[];
  return Array.from(new Set(matches.map(url => url.replace(/[).,;]+$/, ''))));
}

function TaskPropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 text-[13px]">
      <div className="text-fg-5">{label}</div>
      <div className="min-w-0 text-fg-2">{children}</div>
    </div>
  );
}

function AgentAssignee({ name }: { name: string }) {
  const initial = (name.trim()[0] || 'A').toUpperCase();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-inset text-[11px] font-semibold text-fg-4">
        {initial}
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-panel bg-ok" />
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function TaskPropertiesPanel({
  task,
  defaultAgent,
  busyStatus,
  onStatusChange,
}: {
  task: ProTask;
  defaultAgent: string;
  busyStatus?: boolean;
  onStatusChange: (task: ProTask, status: ProTaskStatus) => void;
}) {
  const fields = task.jiraFields || {};
  const ticketType = ticketTypeInfo(task);
  const fallback = {
    status: jiraRemoteSyncField(task.description, 'Status'),
    assignee: jiraRemoteSyncField(task.description, 'Assignee'),
    dueDate: jiraRemoteSyncField(task.description, 'Due date'),
    priority: jiraRemoteSyncField(task.description, 'Priority'),
    updatedAt: jiraRemoteSyncField(task.description, 'Updated'),
  };
  const prs = linkedPullRequests(task);
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-fg">Properties <span className="text-fg-5">⌄</span></div>
        <div className="space-y-2.5">
          <TaskPropertyRow label="Status">
            <select
              value={displayTaskStatus(task.status)}
              disabled={busyStatus}
              onChange={event => onStatusChange(task, event.target.value as ProTaskStatus)}
              className="h-8 w-full rounded-md border border-transparent bg-transparent px-0 text-[13px] text-fg outline-none transition hover:border-edge hover:bg-panel focus:border-primary/40"
            >
              {VISIBLE_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </select>
          </TaskPropertyRow>
          <TaskPropertyRow label="Priority">
            <span className={cn('truncate', fields.priority || fallback.priority ? 'text-fg-2' : 'text-fg-5')}>
              {fields.priority || fallback.priority || '--'}
            </span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Assignee">
            <span className={cn('truncate', fields.assignee || fallback.assignee ? 'text-fg-2' : 'text-fg-5')}>
              {fields.assignee || fallback.assignee || '--'}
            </span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Agent">
            <AgentAssignee name={taskAssignee(task, defaultAgent)} />
          </TaskPropertyRow>
          <TaskPropertyRow label="Due date">
            <span className={fields.dueDate || fallback.dueDate ? 'text-primary' : 'text-fg-5'}>
              {formatDateOnly(fields.dueDate || fallback.dueDate)}
            </span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Project">
            <span className="truncate">{taskProjectName(task)}</span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Labels">
            {(fields.labels || []).length ? (
              <span className="flex min-w-0 flex-wrap gap-1">
                {(fields.labels || []).slice(0, 4).map(label => <Badge key={label} variant="muted">{label}</Badge>)}
              </span>
            ) : (
              <span className="text-fg-5">Add label</span>
            )}
          </TaskPropertyRow>
          <TaskPropertyRow label="Type">
            <TicketTypeIcon task={task} showLabel />
          </TaskPropertyRow>
          <TaskPropertyRow label="Estimate">
            <span className={latestAgentEstimate(task) ? 'text-fg-2' : 'text-fg-5'}>{latestAgentEstimate(task) || '--'}</span>
          </TaskPropertyRow>
        </div>
      </section>

      <section className="border-t border-edge pt-5">
        <div className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-fg-2">Pull requests <span className="text-fg-5">⌄</span></div>
        {prs.length ? (
          <div className="space-y-2">
            {prs.map(url => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate text-[12px] text-primary hover:underline">
                {url.split('/').slice(-3).join('/')}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-fg-5">No linked pull requests yet.</p>
        )}
      </section>

      <section className="border-t border-edge pt-5">
        <div className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-fg-2">Details <span className="text-fg-5">⌄</span></div>
        <div className="space-y-2.5">
          <TaskPropertyRow label="Created by">
            <AgentAssignee name={fields.reporter || jiraRemoteSyncField(task.description, 'Reporter') || 'Pikiclaw'} />
          </TaskPropertyRow>
          <TaskPropertyRow label="Created">
            <span className="text-fg-4">{formatDateOnly(task.createdAt)}</span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Updated">
            <span className="text-fg-4">{formatDateOnly(fields.updatedAt || fallback.updatedAt || task.updatedAt)}</span>
          </TaskPropertyRow>
        </div>
      </section>

      <section className="border-t border-edge pt-5">
        <div className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-fg-2">Execution <span className="text-fg-5">⌄</span></div>
        <div className="space-y-2.5">
          <TaskPropertyRow label="Runs">
            <span className="text-fg-4">{task.stageRuns.length}</span>
          </TaskPropertyRow>
          <TaskPropertyRow label="Agent time">
            <span className="text-fg-4">{formatDuration(taskAgentSeconds(task))}</span>
          </TaskPropertyRow>
        </div>
      </section>
    </div>
  );
}

function TaskStatusRail({ status }: { status: ProTaskStatus }) {
  const visibleStatus = displayTaskStatus(status);
  const activeIndex = Math.max(0, VISIBLE_STATUSES.indexOf(visibleStatus));
  return (
    <div className="rounded-md border border-edge bg-panel-alt px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-fg-2">Status</div>
        <Badge variant={taskStatusTone(visibleStatus)}>{STATUS_LABEL[visibleStatus]}</Badge>
      </div>
      <div className="space-y-0.5">
        {VISIBLE_STATUSES.map((item, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={item} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'mt-0.5 h-2.5 w-2.5 rounded-full border',
                    done ? 'border-ok bg-ok' : active ? 'border-primary bg-primary' : 'border-edge bg-inset',
                  )}
                />
                {index < VISIBLE_STATUSES.length - 1 && (
                  <span className={cn('mt-0.5 h-5 w-px', done ? 'bg-ok/55' : 'bg-edge')} />
                )}
              </div>
              <div className={cn('pb-2 text-[12px] font-medium', active ? 'text-fg' : done ? 'text-fg-4' : 'text-fg-5')}>
                {STATUS_LABEL[item]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function jiraRemoteSyncField(description: string | undefined, label: string): string | undefined {
  if (!description) return undefined;
  const markerIndex = description.indexOf('[Jira remote sync]');
  if (markerIndex < 0) return undefined;
  const remoteSyncText = description.slice(markerIndex);
  const match = remoteSyncText.match(new RegExp(`${label}:\\s*([^\\.\\n]+)`));
  return match?.[1]?.trim() || undefined;
}

function JiraMetadataPanel({ task }: { task: ProTask }) {
  const fields = task.jiraFields || {};
  const ticketType = ticketTypeInfo(task);
  const agentEstimate = latestAgentEstimate(task);
  const fallback = {
    status: jiraRemoteSyncField(task.description, 'Status'),
    assignee: jiraRemoteSyncField(task.description, 'Assignee'),
    reporter: jiraRemoteSyncField(task.description, 'Reporter'),
    dueDate: jiraRemoteSyncField(task.description, 'Due date'),
    priority: jiraRemoteSyncField(task.description, 'Priority'),
    updatedAt: jiraRemoteSyncField(task.description, 'Updated'),
  };
  const labels = fields.labels || [];
  return (
    <section className="rounded-md border border-edge bg-panel-alt px-3 py-3">
      <div className="mb-3 text-[13px] font-semibold text-fg-2">Jira metadata</div>
      <div className="space-y-3">
        <TaskMetaItem label="Key" value={task.jiraKey} mono />
        <TaskMetaItem label="Ticket type" value={fields.issueType || ticketType.label} />
        <TaskMetaItem label="Sprint" value={task.sprint} />
        <TaskMetaItem label="Status" value={fields.status || fallback.status} />
        <TaskMetaItem label="Assignee" value={fields.assignee || fallback.assignee} />
        <TaskMetaItem label="Reporter" value={fields.reporter || fallback.reporter} />
        <TaskMetaItem label="Due date" value={fields.dueDate || fallback.dueDate} />
        <TaskMetaItem label="Priority" value={fields.priority || fallback.priority} />
        <TaskMetaItem label="Agent estimate" value={agentEstimate} />
        <TaskMetaItem label="Updated" value={(fields.updatedAt || fallback.updatedAt) ? formatTime(fields.updatedAt || fallback.updatedAt) : null} />
        {labels.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] text-fg-5">Labels</div>
            <div className="flex flex-wrap gap-1">
              {labels.map(label => <Badge key={label} variant="muted">{label}</Badge>)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TaskDetail({
  task,
  actions,
  defaultAgent,
  agents,
  assistants,
  busy,
  reopening,
  workspaces,
  fallbackWorkdir,
  subtaskDraft,
  onMetaChange,
  onStartStatusChat,
  onSubtaskDraftChange,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartSubtask,
  onReopen,
}: {
  task: ProTask | null;
  actions?: ReactNode;
  defaultAgent: string;
  agents: AgentRuntimeStatus[];
  assistants: AgentAssistant[];
  busy?: { taskId: string; stage: ProTaskStage } | null;
  reopening?: boolean;
  workspaces: WorkspaceEntry[];
  fallbackWorkdir?: string;
  subtaskDraft: { title: string; description: string; assignedAgent: string; assistantId: string };
  onMetaChange: (task: ProTask, patch: TaskMetaPatch) => void;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string) => Promise<void>;
  onSubtaskDraftChange: (draft: { title: string; description: string; assignedAgent: string; assistantId: string }) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
  onStartSubtask: (task: ProTask, subtaskId: string) => void;
  onReopen?: (task: ProTask) => void;
}) {
  const locale = useStore(s => s.locale);
  const t = useMemo(() => createT(locale), [locale]);
  const [shelfTab, setShelfTab] = useState<'status' | 'outputs' | 'files' | 'browser' | 'ticket'>('status');
  const [contextOpen, setContextOpen] = useState(true);
  const [fileBrowserPath, setFileBrowserPath] = useState('');
  const sortedRuns = useMemo(() => [...(task?.stageRuns || [])].sort((a, b) => {
    const bTime = Date.parse(b.startedAt || b.completedAt || '');
    const aTime = Date.parse(a.startedAt || a.completedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  }), [task?.stageRuns]);
  const outputItems = useMemo(() => {
    if (!task) return [];
    const explicit = (task.outputs || []).map(output => ({
      id: output.id,
      kind: output.kind,
      title: output.title,
      summary: output.summary || output.path || output.url || '',
      time: output.createdAt,
      stage: output.stageRunId ? sortedRuns.find(run => run.id === output.stageRunId)?.stage : undefined,
    }));
    const fromRuns = sortedRuns
      .filter(run => run.output?.summary || run.output?.diffSummary || run.output?.branch || run.output?.estimate)
      .map(run => ({
        id: run.id,
        kind: 'stage' as const,
        title: run.stage === 'refinement'
          ? 'Goal & Plan'
          : run.stage === 'coding'
            ? 'Implementation notes'
            : run.stage === 'verification'
              ? 'Verification result'
              : `${STAGE_LABEL[run.stage]} summary`,
        summary: run.output?.summary || run.output?.diffSummary || run.output?.branch || estimateSummary(run) || '',
        time: run.completedAt || run.startedAt || '',
        stage: run.stage,
      }));
    return [...explicit, ...fromRuns].sort((a, b) => {
      const bTime = Date.parse(b.time || '');
      const aTime = Date.parse(a.time || '');
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [sortedRuns, task]);
  const fileItems = useMemo(() => {
    if (!task) return [];
    const seen = new Set<string>();
    const items: Array<{ path: string; stage?: ProTaskStage; source: string }> = [];
    for (const run of sortedRuns) {
      for (const path of run.output?.changedFiles || []) {
        if (seen.has(path)) continue;
        seen.add(path);
        items.push({ path, stage: run.stage, source: STAGE_LABEL[run.stage] });
      }
    }
    for (const output of task.outputs || []) {
      if (!output.path || seen.has(output.path)) continue;
      seen.add(output.path);
      items.push({ path: output.path, source: output.kind });
    }
    return items;
  }, [sortedRuns, task]);
  const latestRunWorkdir = sortedRuns.find(run => run.session?.workdir)?.session.workdir || '';
  const inferredWorkdir = latestRunWorkdir || task?.workdir || fallbackWorkdir || '';
  useEffect(() => {
    setContextOpen(true);
    setShelfTab('status');
    setFileBrowserPath(inferredWorkdir);
  }, [inferredWorkdir, task?.id]);
  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel px-6 text-center">
        <div className="text-[13px] font-semibold text-fg-3">Select a task</div>
        <div className="max-w-xs text-[12px] leading-relaxed text-fg-5">
          Open a card to review metadata, chat history, workflow actions, and verification context.
        </div>
      </div>
    );
  }
  const fields = task.jiraFields || {};
  const remoteStatus = fields.status || jiraRemoteSyncField(task.description, 'Status');
  const priority = fields.priority || jiraRemoteSyncField(task.description, 'Priority');
  const assignee = fields.assignee || jiraRemoteSyncField(task.description, 'Assignee');
  const updatedAt = fields.updatedAt || jiraRemoteSyncField(task.description, 'Updated') || task.updatedAt;
  const createdAt = task.createdAt || jiraRemoteSyncField(task.description, 'Created');
  const reporter = fields.reporter || jiraRemoteSyncField(task.description, 'Reporter');
  const ticketType = ticketTypeInfo(task);
  const labels = fields.labels || [];
  const assignedAssistant = taskAssignedAssistant(task, assistants);
  const workspaceOptions = new Map<string, string>();
  const addWorkspace = (path?: string | null, label?: string | null) => {
    const cleanPath = path?.trim();
    if (!cleanPath || workspaceOptions.has(cleanPath)) return;
    workspaceOptions.set(cleanPath, label?.trim() || workspaceShortLabel(cleanPath));
  };
  for (const workspace of workspaces) addWorkspace(workspace.path, workspace.name);
  addWorkspace(latestRunWorkdir, 'Latest task chat');
  addWorkspace(task.workdir);
  addWorkspace(fallbackWorkdir, 'Current workspace');
  const currentWorkdir = inferredWorkdir;
  const activeBusyStage = busy?.taskId === task.id ? busy.stage : null;
  const shelfTabs: Array<{ id: 'status' | 'outputs' | 'files' | 'browser' | 'ticket'; label: string; count?: number }> = [
    { id: 'status', label: 'Overview' },
    { id: 'outputs', label: 'Outputs', count: outputItems.length },
    { id: 'files', label: 'Files', count: fileItems.length },
    { id: 'browser', label: 'Browser' },
    { id: 'ticket', label: 'Ticket' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-[var(--th-session-bg)]">
      <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-edge/55 bg-panel/72 px-4 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <TicketTypeIcon task={task} />
          {task.jiraKey && <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">{task.jiraKey}</span>}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={task.title}>{task.title}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant={contextOpen ? 'secondary' : 'ghost'}
            size="icon"
            className={cn('h-8 w-8', contextOpen && 'border-primary/30 text-primary')}
            title={contextOpen ? 'Hide context' : 'Show context'}
            aria-label={contextOpen ? 'Hide context' : 'Show context'}
            onClick={() => setContextOpen(open => !open)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </Button>
          {actions}
        </div>
      </div>
      <div className={cn(
        'grid min-h-0 flex-1 overflow-hidden',
        contextOpen
          ? 'grid-rows-[minmax(0,1fr)_minmax(260px,38%)] min-[980px]:grid-cols-[minmax(0,1fr)_390px] min-[980px]:grid-rows-[minmax(0,1fr)]'
          : 'grid-cols-1',
      )}>
        <main className={cn('min-h-0 min-w-0 overflow-hidden', !contextOpen && 'flex justify-center')}>
          <div className={cn('h-full min-h-0 w-full', !contextOpen && 'max-w-[980px]')}>
            <TaskChatWindow
              task={task}
              actions={actions}
              agents={agents}
              defaultAgent={defaultAgent}
              busyStage={busy?.taskId === task.id ? busy.stage : null}
              onStartStatusChat={onStartStatusChat}
              onOpenTicket={() => setShelfTab('ticket')}
              onOpenArtifacts={() => setShelfTab('outputs')}
              artifactCount={outputItems.length}
            />
          </div>
        </main>

        {contextOpen && <aside className="relative min-h-0 min-w-0 overflow-hidden border-t border-edge/60 bg-panel/78 min-[980px]:border-l min-[980px]:border-t-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="mb-3 flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-edge/55 bg-inset/35 p-1">
                {shelfTabs.map(tab => {
                  const active = shelfTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setShelfTab(tab.id)}
                      className={cn(
                        'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors',
                        active ? 'bg-panel text-fg shadow-sm' : 'text-fg-5 hover:bg-panel-h/70 hover:text-fg-3',
                      )}
                    >
                      <span>{tab.label}</span>
                      {!!tab.count && <span className="font-mono text-[10px] text-primary">{Math.min(tab.count, 99)}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mb-4">
                <TaskFlowMap task={task} busyStage={activeBusyStage} />
              </div>
              {shelfTab === 'status' && (
                <div className="space-y-4">
                  <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                      <dt className="text-fg-5">Assign</dt>
                      <dd className="min-w-0 truncate text-fg-3">{assignedAssistant}</dd>
                      <dt className="text-fg-5">Created</dt>
                      <dd className="min-w-0 truncate text-fg-3">{formatTime(createdAt)}</dd>
                      <dt className="text-fg-5">Updated</dt>
                      <dd className="min-w-0 truncate text-fg-3">{formatTime(updatedAt)}</dd>
                      <dt className="text-fg-5">Remote status</dt>
                      <dd className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-fg-3">{remoteStatus || '--'}</span>
                        {isClosedRemoteTask(task) && onReopen && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            disabled={reopening}
                            onClick={() => onReopen(task)}
                          >
                            {reopening ? <Spinner /> : null}
                            Reopen
                          </Button>
                        )}
                      </dd>
                      <dt className="text-fg-5">Ticket owner</dt>
                      <dd className="min-w-0 truncate text-fg-3">{assignee || '--'}</dd>
                      <dt className="text-fg-5">Workspace</dt>
                      <dd className="min-w-0">
                        <select
                          value={task.workdir || ''}
                          onChange={event => onMetaChange(task, { workdir: event.target.value || null })}
                          className="h-7 w-full rounded-md border border-transparent bg-transparent px-0 text-[12px] text-fg-3 outline-none transition hover:border-edge hover:bg-panel focus:border-primary/40"
                          title={task.workdir || fallbackWorkdir || 'No workspace'}
                        >
                          <option value="">Current workspace</option>
                          {Array.from(workspaceOptions, ([path, label]) => (
                            <option key={path} value={path}>{label}</option>
                          ))}
                        </select>
                      </dd>
                      <dt className="text-fg-5">PR</dt>
                      <dd className="min-w-0"><TaskPrField task={task} onMetaChange={onMetaChange} /></dd>
                    </dl>
                  </section>
                </div>
              )}

              {shelfTab === 'files' && (
                <div className="space-y-3">
                  <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <div className="text-[12px] font-semibold text-fg-2">Task context center</div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-fg-5">
                      Use Files to inspect the workspace, referenced paths, and source context for this task.
                    </div>
                  </section>
                  <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Workspace</div>
                    <select
                      value={task.workdir || ''}
                      onChange={event => onMetaChange(task, { workdir: event.target.value || null })}
                      className="h-8 w-full rounded-md border border-edge bg-panel px-2 text-[12px] text-fg-3 outline-none transition hover:border-edge-h focus:border-primary/40"
                      title={currentWorkdir || 'No workspace'}
                    >
                      <option value="">Current workspace</option>
                      {Array.from(workspaceOptions, ([path, label]) => (
                        <option key={path} value={path}>{label}</option>
                      ))}
                    </select>
                  </section>
                  {currentWorkdir ? (
                    <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0 truncate font-mono text-[10px] text-fg-5" title={fileBrowserPath || currentWorkdir}>
                          {fileBrowserPath || currentWorkdir}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          disabled={!fileBrowserPath || fileBrowserPath === task.workdir}
                          onClick={() => onMetaChange(task, { workdir: fileBrowserPath || null })}
                        >
                          Use
                        </Button>
                      </div>
                      <DirBrowser
                        key={currentWorkdir}
                        initialPath={currentWorkdir}
                        compact
                        minHeight={180}
                        maxHeight={280}
                        t={t}
                        onSelect={(path) => setFileBrowserPath(path)}
                      />
                    </section>
                  ) : (
                    <div className="rounded-lg border border-dashed border-edge/70 px-3 py-8 text-center text-[12px] text-fg-5">
                      Select a workspace to browse files.
                    </div>
                  )}
                  {fileItems.length > 0 && (
                    <section className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Referenced</div>
                      {fileItems.slice(0, 6).map(file => (
                        <div key={file.path} className="rounded-lg border border-edge/65 bg-panel-alt/58 px-3 py-2">
                          <div className="truncate font-mono text-[11px] text-fg-3" title={file.path}>{file.path}</div>
                          <div className="mt-1 text-[10px] text-fg-5">{file.source}</div>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              )}

              {shelfTab === 'outputs' && (
                <div className="space-y-2">
                  <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <div className="text-[12px] font-semibold text-fg-2">Task result center</div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-fg-5">
                      Outputs collects plans, documents, diffs, links, final answers, and review-ready results.
                    </div>
                  </section>
                  {outputItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-edge/70 px-3 py-8 text-center text-[12px] text-fg-5">
                      Goal & Plan, implementation notes, diffs, links, and verification results will appear here.
                    </div>
                  ) : outputItems.map(output => (
                    <div key={output.id} className="rounded-lg border border-edge/65 bg-panel-alt/58 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        {output.stage && <Badge variant={stageTone(output.stage)}>{STAGE_LABEL[output.stage]}</Badge>}
                        <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{output.title}</div>
                      </div>
                      {output.summary && <div className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-fg-4">{output.summary}</div>}
                      {output.time && <div className="mt-2 text-[10px] text-fg-5">{formatTime(output.time)}</div>}
                    </div>
                  ))}
                </div>
              )}

              {shelfTab === 'browser' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-dashed border-edge/70 px-3 py-8 text-center text-[12px] leading-relaxed text-fg-5">
                    Browser previews opened by task runs will appear here.
                  </div>
                  {task.jiraUrl && (
                    <a
                      href={task.jiraUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-md border border-edge px-3 text-[12px] font-medium text-fg-3 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
                    >
                      Open ticket page
                    </a>
                  )}
                </div>
              )}

              {shelfTab === 'ticket' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <TicketTypeIcon task={task} showLabel />
                      {priority && <Badge variant="muted">{priority}</Badge>}
                    </div>
                    <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
                      <dt className="text-fg-5">Reporter</dt>
                      <dd className="truncate text-fg-3">{reporter || '--'}</dd>
                      <dt className="text-fg-5">Sprint</dt>
                      <dd className="truncate text-fg-3">{task.sprint || '--'}</dd>
                      <dt className="text-fg-5">Type</dt>
                      <dd className="truncate text-fg-3">{fields.issueType || ticketType.label}</dd>
                      {labels.length > 0 && (
                        <>
                          <dt className="text-fg-5">Labels</dt>
                          <dd className="truncate text-fg-3">{labels.slice(0, 5).join(', ')}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                  <div className="rounded-lg border border-edge/65 bg-panel/60 px-3 py-3">
                    <TaskDescriptionMarkdown task={task} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>}
      </div>
    </div>
  );
}

function TaskInlineWorkbench({
  task,
  defaultAgent,
  agents,
  assistants,
  busy,
  reopening,
  workspaces,
  fallbackWorkdir,
  subtaskDraft,
  onMetaChange,
  onStartStatusChat,
  onSubtaskDraftChange,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartSubtask,
  onReopen,
  onOpenFull,
}: {
  task: ProTask | null;
  defaultAgent: string;
  agents: AgentRuntimeStatus[];
  assistants: AgentAssistant[];
  busy?: { taskId: string; stage: ProTaskStage } | null;
  reopening?: boolean;
  workspaces: WorkspaceEntry[];
  fallbackWorkdir?: string;
  subtaskDraft: { title: string; description: string; assignedAgent: string; assistantId: string };
  onMetaChange: (task: ProTask, patch: TaskMetaPatch) => void;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string) => Promise<void>;
  onSubtaskDraftChange: (draft: { title: string; description: string; assignedAgent: string; assistantId: string }) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
  onStartSubtask: (task: ProTask, subtaskId: string) => void;
  onReopen?: (task: ProTask) => void;
  onOpenFull: () => void;
}) {
  if (!task) {
    return (
      <aside className="hidden min-h-0 border-l border-edge/55 bg-[var(--th-session-bg)] 2xl:flex 2xl:flex-col">
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div>
            <div className="text-[13px] font-semibold text-fg-3">Select a task</div>
            <div className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-fg-5">
              Pick a card to see status, generated outputs, and the attached task chat.
            </div>
          </div>
        </div>
      </aside>
    );
  }
  return (
    <aside className="hidden min-h-0 border-l border-edge/55 bg-[var(--th-session-bg)] 2xl:flex 2xl:flex-col">
      <TaskDetail
        task={task}
        defaultAgent={defaultAgent}
        agents={agents}
        assistants={assistants}
        busy={busy}
        reopening={reopening}
        workspaces={workspaces}
        fallbackWorkdir={fallbackWorkdir}
        subtaskDraft={subtaskDraft}
        onMetaChange={onMetaChange}
        onStartStatusChat={onStartStatusChat}
        onSubtaskDraftChange={onSubtaskDraftChange}
        onCreateSubtask={onCreateSubtask}
        onUpdateSubtaskStatus={onUpdateSubtaskStatus}
        onStartSubtask={onStartSubtask}
        onReopen={onReopen}
        actions={(
          <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onOpenFull}>
            Open
          </Button>
        )}
      />
    </aside>
  );
}

function JiraSyncMonitor({
  runs,
  selectedRun,
  detailsOpen,
  syncing,
  onSync,
  onSelectRun,
  onCloseDetails,
}: {
  runs: JiraSyncRun[];
  selectedRun: JiraSyncRun | null;
  detailsOpen: boolean;
  syncing: boolean;
  onSync: () => void;
  onSelectRun: (runId: string) => void;
  onCloseDetails: () => void;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-edge/60 pl-3">
        <span className="shrink-0 text-[12px] font-semibold text-fg-3">Jira sync</span>
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-edge bg-panel-alt text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg disabled:pointer-events-none disabled:opacity-55"
          title={syncing ? 'Syncing Jira' : 'Sync Jira'}
          aria-label={syncing ? 'Syncing Jira' : 'Sync Jira'}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={syncing ? 'animate-spin' : ''}
          >
            <path d="M21 12a9 9 0 0 1-15.3 6.4" />
            <path d="M3 12a9 9 0 0 1 15.3-6.4" />
            <path d="M18 2v4h4" />
            <path d="M6 22v-4H2" />
          </svg>
        </button>
        <span className={cn('min-w-0 truncate text-[12px]', selectedRun?.status === 'failed' ? 'text-warn' : 'text-fg-5')}>
          {jiraSyncCompactLabel(selectedRun)}
        </span>
      </div>
      <Modal
        open={detailsOpen}
        onClose={onCloseDetails}
        wide
        panelStyle={{ maxWidth: 'min(1180px, calc(100vw - 32px))' }}
      >
        <ModalHeader
          title="Jira sync history"
          description={`${runs.length} sync runs`}
          onClose={onCloseDetails}
        />
        <div className="grid min-h-[520px] gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden rounded-lg border border-edge/60 bg-panel">
            <div className="border-b border-edge/55 px-3 py-2 text-[12px] font-semibold text-fg-3">Sync runs</div>
            <div className="max-h-[480px] overflow-y-auto p-1.5">
              {runs.length === 0 ? (
                <div className="rounded-md border border-dashed border-edge/60 bg-inset/30 px-3 py-4 text-[12px] text-fg-5">No sync runs yet.</div>
              ) : runs.map(run => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onSelectRun(run.id)}
                  className={cn(
                    'mb-1 flex w-full min-w-0 flex-col rounded-md border px-2.5 py-2 text-left transition-colors last:mb-0',
                    selectedRun?.id === run.id
                      ? 'border-primary/45 bg-primary/[0.07]'
                      : 'border-transparent hover:border-edge/70 hover:bg-panel-h',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={syncRunTone(run.status)}>{syncRunStatusLabel(run.status)}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-5">{formatTime(run.startedAt)}</span>
                    {syncRunActive(run) && <Spinner />}
                  </span>
                  <span className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-fg-3">{jiraSyncRunMessage(run)}</span>
                </button>
              ))}
            </div>
          </div>
          {selectedRun ? (
            <JiraSyncDetailsContent run={selectedRun} />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-edge/60 bg-panel text-[13px] text-fg-5">
              Select a sync run to view details.
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function JiraSyncDetailsContent({ run }: { run: JiraSyncRun }) {
  const counts = syncChangeCounts(run);
  const hasChanges = (run.changes || []).length > 0;
  return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-lg border border-edge/60 bg-panel px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-fg-3">Progress</div>
              {syncRunActive(run) && <span className="inline-flex items-center gap-1 text-[11px] text-primary"><Spinner /> live</span>}
            </div>
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {(run.events || []).map((event, index) => (
                <div key={event.id || `${event.at}-${index}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-[12px]">
                  <div className="pt-0.5 font-mono text-[10px] text-fg-5">{formatTime(event.at)}</div>
                  <div className="min-w-0 border-l border-edge/70 pl-3">
                    <div className="font-medium text-fg-3">{event.label}</div>
                    {event.detail && <div className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-fg-5">{event.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-edge/60 bg-panel px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-fg-3">Ticket changes</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-5">
                <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">created {counts.created}</span>
                <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">updated {counts.updated}</span>
                <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">unchanged {counts.unchanged}</span>
              </div>
            </div>
            {hasChanges ? (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {(run.changes || []).map(change => (
                  <div key={`${change.jiraKey || change.taskId}-${change.action}-${change.updatedAt || change.title}`} className="rounded-md border border-edge/45 bg-panel-alt/45 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant={change.action === 'created' ? 'ok' : change.action === 'updated' ? 'accent' : 'muted'}>{change.action}</Badge>
                      {change.jiraKey && <span className="font-mono text-[11px] text-primary">{change.jiraKey}</span>}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-3">{change.title}</span>
                    </div>
                    {change.summary && <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-5">{change.summary}</div>}
                    <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-5">
                      {change.assignee && <span>assignee {change.assignee}</span>}
                      {change.priority && <span>priority {change.priority}</span>}
                      {change.dueDate && <span>due {formatDateOnly(change.dueDate)}</span>}
                      {change.sprint && <span>sprint {change.sprint}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-edge/60 bg-inset/30 px-3 py-4 text-[12px] leading-relaxed text-fg-5">
                {run.issueKeys?.length
                  ? `Tickets touched: ${run.issueKeys.join(', ')}`
                  : 'Detailed ticket changes will appear after the sync agent writes Jira issues into Pikiclaw.'}
              </div>
            )}
            {run.analysisSummary && (
              <div className="mt-3 whitespace-pre-line rounded-md border border-edge/45 bg-inset/30 px-3 py-2 text-[11px] leading-relaxed text-fg-5">
                {run.analysisSummary}
              </div>
            )}
            {run.error && <div className="mt-3 text-[12px] text-err">{run.error}</div>}
          </div>
        </div>
  );
}

function JiraDashboardSettingsMenu({
  canOpenSyncDetails,
  onOpenSyncDetails,
  onRefreshSync,
  onOpenWorkflowSettings,
}: {
  canOpenSyncDetails: boolean;
  onOpenSyncDetails: () => void;
  onRefreshSync: () => void;
  onOpenWorkflowSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const runAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <Button
        variant="outline"
        size="icon"
        aria-label="Jira dashboard settings"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </svg>
      </Button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 overflow-hidden rounded-lg border border-edge bg-panel py-1 text-[12px] shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
          <button
            type="button"
            disabled={!canOpenSyncDetails}
            className="flex w-full items-center px-3 py-2 text-left text-fg-3 transition hover:bg-panel-h disabled:pointer-events-none disabled:opacity-45"
            onClick={() => runAction(onOpenSyncDetails)}
          >
            Sync details
          </button>
          <button
            type="button"
            className="flex w-full items-center px-3 py-2 text-left text-fg-3 transition hover:bg-panel-h"
            onClick={() => runAction(onRefreshSync)}
          >
            Refresh sync
          </button>
          <div className="my-1 border-t border-edge/60" />
          <button
            type="button"
            className="flex w-full items-center px-3 py-2 text-left text-fg-3 transition hover:bg-panel-h"
            onClick={() => runAction(onOpenWorkflowSettings)}
          >
            Workflow settings
          </button>
        </div>
      )}
    </div>
  );
}

function JiraColumnSortIcon({ mode }: { mode: JiraColumnSortMode }) {
  const isAsc = mode === 'asc';
  const isDesc = mode === 'desc';

  if (mode === 'manual') {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge/60 bg-panel-alt text-fg-5 transition group-hover/column:border-edge-h group-hover/column:text-fg-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 6h8" />
          <path d="M8 12h8" />
          <path d="M8 18h8" />
        </svg>
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge/60 bg-panel-alt text-fg-5 transition group-hover/column:border-edge-h group-hover/column:text-fg-3">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m8 7 4-4 4 4" className={cn('stroke-current transition', isAsc ? 'text-primary' : 'text-fg-5/45')} />
        <path d="M12 3v18" className="stroke-current text-fg-5/55 transition" />
        <path d="m16 17-4 4-4-4" className={cn('stroke-current transition', isDesc ? 'text-primary' : 'text-fg-5/45')} />
      </svg>
    </span>
  );
}

function JiraCyclePanel({
  cycles,
  taskCounts,
  tasksByCycle,
  expandedIds,
  onToggleExpanded,
  onDeleteCycle,
}: {
  cycles: JiraCycle[];
  taskCounts: Record<string, number>;
  tasksByCycle: Record<string, ProTask[]>;
  expandedIds: Set<string>;
  onToggleExpanded: (cycleId: string) => void;
  onDeleteCycle: (cycle: JiraCycle) => void;
}) {
  const activeCycle = cycles.find(cycle => cycle.status === 'active') || null;
  const closedCycles = cycles.filter(cycle => cycle.status === 'closed');
  const visibleCycles = activeCycle ? [activeCycle, ...closedCycles] : closedCycles;

  return (
    <section className="shrink-0 rounded-xl border border-edge/55 bg-panel-alt/35">
      <div className="flex flex-col gap-2 border-b border-edge/30 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[12px] font-semibold text-fg-3">Cycles</span>
            {activeCycle ? (
              <Badge variant="ok">{taskCounts[activeCycle.id] ?? activeCycle.tasks.length} tickets</Badge>
            ) : (
              <Badge variant="muted">No active cycle</Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg-5">
            {activeCycle
              ? `${activeCycle.name} · ${formatDateOnly(activeCycle.startedAt)} - ${formatDateOnly(activeCycle.endsAt)}`
              : 'Kick off a work cycle, then close it to archive completed Jira tasks.'}
          </div>
        </div>
        {visibleCycles.length > 0 && <div className="shrink-0 text-[11px] text-fg-5">{visibleCycles.length} cycles</div>}
      </div>
      {visibleCycles.length > 0 && (
        <div className="max-h-[220px] overflow-y-auto p-2">
          <div className="space-y-1.5">
            {visibleCycles.map(cycle => {
              const expanded = cycle.status === 'active' || expandedIds.has(cycle.id);
              const assignedTasks = tasksByCycle[cycle.id] || [];
              return (
                <div key={cycle.id} className="rounded-lg border border-edge/45 bg-panel/55">
                  <div className="flex min-w-0 items-center">
                    <button
                      type="button"
                      onClick={() => onToggleExpanded(cycle.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-3">{cycle.name}</span>
                      <span className="shrink-0 text-[10px] text-fg-5">{formatDateOnly(cycle.startedAt)} - {formatDateOnly(cycle.endsAt)}</span>
                      <Badge variant={cycle.status === 'active' ? 'ok' : 'muted'}>{taskCounts[cycle.id] ?? cycle.tasks.length} tickets</Badge>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn('shrink-0 text-fg-5 transition-transform', expanded && 'rotate-180')}>
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteCycle(cycle);
                      }}
                      className="mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-err/[0.08] hover:text-err"
                      title="Delete cycle"
                      aria-label="Delete cycle"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                  {expanded && (
                    <div className="border-t border-edge/30 px-2.5 py-2">
                      {assignedTasks.length === 0 && cycle.tasks.length === 0 ? (
                        <div className="rounded-md border border-dashed border-edge/50 bg-inset/25 px-3 py-3 text-[11px] text-fg-5">
                          No tickets in this cycle yet.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {assignedTasks.length > 0 ? assignedTasks.map(task => (
                            <div key={`${cycle.id}:${task.id}`} className="flex min-w-0 items-center gap-2 rounded-md bg-inset/30 px-2 py-1.5">
                              {task.jiraKey && <span className="shrink-0 font-mono text-[11px] text-primary">{task.jiraKey}</span>}
                              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-3">{task.title}</span>
                              {task.jiraFields?.assignee && <span className="max-w-[140px] truncate text-[10px] text-fg-5">{task.jiraFields.assignee}</span>}
                              <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
                            </div>
                          )) : cycle.tasks.map(task => (
                            <div key={`${cycle.id}:${task.taskId}`} className="flex min-w-0 items-center gap-2 rounded-md bg-inset/30 px-2 py-1.5">
                              {task.jiraKey && <span className="shrink-0 font-mono text-[11px] text-primary">{task.jiraKey}</span>}
                              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-3">{task.title}</span>
                              {task.assignee && <span className="max-w-[140px] truncate text-[10px] text-fg-5">{task.assignee}</span>}
                              <span className="shrink-0 text-[10px] text-fg-5">{formatTime(task.completedAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function TasksTab() {
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [tasks, setTasks] = useState<ProTask[]>([]);
  const [taskSpaces, setTaskSpaces] = useState<TaskSpace[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(ALL_TASKS_SPACE_ID);
  const [spaceSidebarCollapsed, setSpaceSidebarCollapsed] = useState<boolean>(() => readStoredTaskSpaceSidebarCollapsed());
  const [spaceSearchFocusTick, setSpaceSearchFocusTick] = useState(0);
  const [taskDetailLayout, setTaskDetailLayout] = useState<TaskDetailLayout>(() => readStoredTaskDetailLayout());
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false);
  const [spaceCreateBusy, setSpaceCreateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [taskDeleteTarget, setTaskDeleteTarget] = useState<ProTask | null>(null);
  const [savingJiraFieldsTaskId, setSavingJiraFieldsTaskId] = useState<string | null>(null);
  const [reopeningTaskId, setReopeningTaskId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<JiraColumnKey | null>(null);
  const [jiraConfig, setJiraConfig] = useState<JiraWorkflowConfig>(DEFAULT_JIRA_ASSISTANT_CONFIG);
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [ticketQuery, setTicketQuery] = useState('');
  const [syncRuns, setSyncRuns] = useState<JiraSyncRun[]>([]);
  const [selectedSyncRunId, setSelectedSyncRunId] = useState<string | null>(null);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [cycles, setCycles] = useState<JiraCycle[]>([]);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [cycleKickoffOpen, setCycleKickoffOpen] = useState(false);
  const [cycleDeleteTarget, setCycleDeleteTarget] = useState<JiraCycle | null>(null);
  const [cycleDeleteBusy, setCycleDeleteBusy] = useState(false);
  const [cycleDraft, setCycleDraft] = useState(() => {
    const today = localDateInputValue();
    return { name: '', startDate: today, endDate: today };
  });
  const [expandedCycleIds, setExpandedCycleIds] = useState<Set<string>>(new Set());
  const [columnSortModes, setColumnSortModes] = useState<JiraColumnSortModes>(() => readStoredJiraColumnOrder().modes);
  const [columnManualOrder, setColumnManualOrder] = useState<JiraColumnManualOrder>(() => readStoredJiraColumnOrder().manualOrder);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [verifyDraft, setVerifyDraft] = useState({ environment: 'cnlab03', url: '', notes: '' });
  const [subtaskDraft, setSubtaskDraft] = useState({ title: '', description: '', assignedAgent: '', assistantId: '' });
  const [browserSnapshot, setBrowserSnapshot] = useState<BrowserPanelSnapshot | null>(null);
  const [browserUrlDraft, setBrowserUrlDraft] = useState('');
  const [browserTypeDraft, setBrowserTypeDraft] = useState('');
  const [browserBusy, setBrowserBusy] = useState(false);
  const activeFocusSessionRef = useRef<{ taskId: string; focusSessionId: string } | null>(null);
  const syncRunsLoadedRef = useRef(false);
  const terminalSyncRunIdsRef = useRef<Set<string>>(new Set());

  const taskSpaceCounts = useMemo(() => {
    const counts: Record<string, number> = { [ALL_TASKS_SPACE_ID]: tasks.length };
    for (const task of tasks) {
      const spaceId = task.spaceId || (task.kind.startsWith('jira') ? JIRA_TASK_SPACE_ID : PERSONAL_TASK_SPACE_ID);
      counts[spaceId] = (counts[spaceId] || 0) + 1;
    }
    return counts;
  }, [tasks]);
  const activeTaskSpace = useMemo(() => taskSpaces.find(space => space.id === selectedSpaceId) || null, [selectedSpaceId, taskSpaces]);
  const activeSpaceIsJira = selectedSpaceId === JIRA_TASK_SPACE_ID || activeTaskSpace?.kind === 'jira';
  const activeSpaceTasks = useMemo(() => {
    if (selectedSpaceId === ALL_TASKS_SPACE_ID) return tasks;
    return tasks.filter(task => (task.spaceId || (task.kind.startsWith('jira') ? JIRA_TASK_SPACE_ID : PERSONAL_TASK_SPACE_ID)) === selectedSpaceId);
  }, [selectedSpaceId, tasks]);
  const sprintOptions = useMemo(() => {
    return Array.from(new Set(activeSpaceTasks.map(task => task.sprint).filter((sprint): sprint is string => !!sprint))).sort();
  }, [activeSpaceTasks]);
  const visibleTasks = useMemo(() => {
    const normalizedQuery = ticketQuery.trim().toLowerCase();
    const sprintTasks = !activeSpaceIsJira || selectedSprint === 'all'
      ? activeSpaceTasks
      : activeSpaceTasks.filter(task => task.sprint === selectedSprint);
    if (!normalizedQuery) return sprintTasks;
    return sprintTasks.filter(task => [
      task.jiraKey,
      task.title,
      task.description,
      task.jiraFields?.status,
      task.jiraFields?.assignee,
      task.jiraFields?.reporter,
      task.sprint,
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery));
  }, [activeSpaceIsJira, activeSpaceTasks, selectedSprint, ticketQuery]);
  const boardTasks = useMemo(() => visibleTasks.filter(task => !isClosedRemoteTask(task)), [visibleTasks]);
  const closedTasks = useMemo(() => visibleTasks.filter(isClosedRemoteTask), [visibleTasks]);
  const byStatus = useMemo(() => {
    const grouped = new Map<JiraColumnKey, ProTask[]>();
    for (const column of JIRA_COLUMNS) grouped.set(column.key, []);
    for (const task of boardTasks) grouped.get(jiraColumnForTask(task))?.push(task);
    for (const column of JIRA_COLUMNS) {
      const tasksInColumn = grouped.get(column.key) || [];
      const mode = columnSortModes[column.key] || 'desc';
      if (mode === 'manual') {
        const manual = columnManualOrder[column.key] || [];
        const rank = new Map(manual.map((taskId, index) => [taskId, index]));
        tasksInColumn.sort((a, b) => {
          const ai = rank.get(a.id);
          const bi = rank.get(b.id);
          if (ai != null && bi != null) return ai - bi;
          if (ai != null) return -1;
          if (bi != null) return 1;
          return taskSyncSortTime(b) - taskSyncSortTime(a);
        });
      } else {
        tasksInColumn.sort((a, b) => mode === 'asc'
          ? taskSyncSortTime(a) - taskSyncSortTime(b)
          : taskSyncSortTime(b) - taskSyncSortTime(a));
      }
    }
    return grouped;
  }, [boardTasks, columnManualOrder, columnSortModes]);
  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedId) || null, [selectedId, tasks]);
  const draggingTask = useMemo(() => tasks.find(task => task.id === draggingTaskId) || null, [draggingTaskId, tasks]);
  const activeCycle = useMemo(() => cycles.find(cycle => cycle.status === 'active') || null, [cycles]);
  const cycleTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      if (!task.cycleId) continue;
      counts[task.cycleId] = (counts[task.cycleId] || 0) + 1;
    }
    return counts;
  }, [tasks]);
  const tasksByCycle = useMemo(() => {
    const grouped: Record<string, ProTask[]> = {};
    for (const task of tasks) {
      if (!task.cycleId) continue;
      (grouped[task.cycleId] ||= []).push(task);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => taskSyncSortTime(b) - taskSyncSortTime(a));
    }
    return grouped;
  }, [tasks]);
  const latestSyncRun = syncRuns[0] || null;
  const selectedSyncRun = useMemo(() => syncRuns.find(run => run.id === selectedSyncRunId) || latestSyncRun, [latestSyncRun, selectedSyncRunId, syncRuns]);

  const toggleTaskSpaceSidebar = useCallback(() => {
    setSpaceSidebarCollapsed(prev => {
      const next = !prev;
      writeStoredTaskSpaceSidebarCollapsed(next);
      return next;
    });
  }, []);

  const revealTaskSpaceSearch = useCallback(() => {
    setSpaceSidebarCollapsed(false);
    writeStoredTaskSpaceSidebarCollapsed(false);
    setSpaceSearchFocusTick(prev => prev + 1);
  }, []);

  const updateTaskDetailLayout = useCallback((layout: TaskDetailLayout) => {
    setTaskDetailLayout(layout);
    writeStoredTaskDetailLayout(layout);
    if (layout === 'modal' && selectedId) setDetailOpen(true);
    if (layout === 'side') setDetailOpen(false);
  }, [selectedId]);

  const loadSyncRuns = useCallback(async (options: { refreshTasksOnCompletion?: boolean } = {}) => {
    const result = await api.getJiraMcpSyncRuns();
    if (!result.ok) return;
    const runs = result.runs || [];
    const firstLoad = !syncRunsLoadedRef.current;
    const hasNewCompletedRun = runs.some(run => run.status === 'completed' && !terminalSyncRunIdsRef.current.has(run.id));
    syncRunsLoadedRef.current = true;
    for (const run of runs) {
      if (run.status === 'completed' || run.status === 'failed') terminalSyncRunIdsRef.current.add(run.id);
    }
    setSyncRuns(runs);
    setSelectedSyncRunId(current => current || runs[0]?.id || null);
    if (options.refreshTasksOnCompletion && !firstLoad && hasNewCompletedRun) {
      const tasksResult = await api.getProTasks();
      if (tasksResult.ok) setTasks(tasksResult.tasks || []);
    }
  }, []);

  useEffect(() => {
    if (selectedSprint !== 'all' && !sprintOptions.includes(selectedSprint)) setSelectedSprint('all');
  }, [selectedSprint, sprintOptions]);

  useEffect(() => {
    if (selectedId && visibleTasks.some(task => task.id === selectedId)) return;
    setSelectedId(visibleTasks[0]?.id || null);
  }, [selectedId, visibleTasks]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [result, spacesResult, assistantsResult, workspacesResult, jiraConfigResult, cyclesResult] = await Promise.all([
        api.getProTasks(),
        api.getTaskSpaces(),
        api.getProAssistants(),
        api.getWorkspaces(),
        api.getJiraWorkflowConfig(),
        api.getJiraCycles(),
      ]);
      if (!result.ok) throw new Error(result.error || 'Failed to load tasks');
      setTasks(result.tasks);
      if (spacesResult.ok) setTaskSpaces(spacesResult.spaces || []);
      if (assistantsResult.ok) setAssistants(assistantsResult.assistants || []);
      if (workspacesResult.ok) setWorkspaces(workspacesResult.workspaces || []);
      if (jiraConfigResult.ok) setJiraConfig({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...jiraConfigResult.config });
      if (cyclesResult.ok) setCycles(cyclesResult.cycles || []);
      setSelectedId(current => current || result.tasks[0]?.id || null);
      void loadSyncRuns().catch(() => {});
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load tasks', false);
    } finally {
      setLoading(false);
    }
  }, [loadSyncRuns, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const pollSyncRuns = () => {
      void loadSyncRuns({ refreshTasksOnCompletion: true }).catch(() => {});
    };
    const timer = window.setInterval(pollSyncRuns, 5_000);
    return () => window.clearInterval(timer);
  }, [loadSyncRuns]);

  const upsertTask = useCallback((task: ProTask) => {
    setTasks(prev => {
      const next = prev.filter(item => item.id !== task.id);
      next.unshift(task);
      return next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
    setSelectedId(task.id);
  }, []);

  const refreshCycles = useCallback(async () => {
    const result = await api.getJiraCycles();
    if (result.ok) setCycles(result.cycles || []);
  }, []);

  const kickOffCycle = useCallback(async () => {
    if (!cycleDraft.startDate || !cycleDraft.endDate) return;
    if (cycleDraft.endDate < cycleDraft.startDate) {
      toast('Cycle end date must be after start date', false);
      return;
    }
    setCycleBusy(true);
    try {
      const result = await api.kickOffJiraCycle({
        name: cycleDraft.name,
        startDate: cycleDraft.startDate,
        endDate: cycleDraft.endDate,
        taskIds: visibleTasks.map(task => task.id),
      });
      if (!result.ok || !result.cycle) throw new Error(result.error || 'Failed to kick off cycle');
      if (result.tasks?.length) {
        setTasks(prev => {
          const updates = new Map(result.tasks!.map(task => [task.id, task]));
          return prev.map(task => updates.get(task.id) || task);
        });
      }
      await refreshCycles();
      setExpandedCycleIds(prev => new Set(prev).add(result.cycle!.id));
      setCycleKickoffOpen(false);
      toast('Jira cycle started');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to kick off cycle', false);
    } finally {
      setCycleBusy(false);
    }
  }, [cycleDraft, refreshCycles, toast, visibleTasks]);

  const closeActiveCycle = useCallback(async () => {
    setCycleBusy(true);
    try {
      const result = await api.closeActiveJiraCycle();
      if (!result.ok) throw new Error(result.error || 'Failed to close cycle');
      await refreshCycles();
      if (result.cycle) setExpandedCycleIds(prev => new Set(prev).add(result.cycle!.id));
      toast(result.cycle ? `Cycle closed with ${result.cycle.tasks.length} done tasks` : 'No active cycle');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to close cycle', false);
    } finally {
      setCycleBusy(false);
    }
  }, [refreshCycles, toast]);

  const toggleCycleExpanded = useCallback((cycleId: string) => {
    setExpandedCycleIds(prev => {
      const next = new Set(prev);
      if (next.has(cycleId)) next.delete(cycleId);
      else next.add(cycleId);
      return next;
    });
  }, []);

  const deleteCycle = useCallback(async () => {
    const cycle = cycleDeleteTarget;
    if (!cycle) return;
    setCycleDeleteBusy(true);
    try {
      const result = await api.deleteJiraCycle(cycle.id);
      if (!result.ok) throw new Error(result.error || 'Failed to delete cycle');
      setCycles(prev => prev.filter(item => item.id !== cycle.id));
      setExpandedCycleIds(prev => {
        const next = new Set(prev);
        next.delete(cycle.id);
        return next;
      });
      setCycleDeleteTarget(null);
      toast('Cycle deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete cycle', false);
    } finally {
      setCycleDeleteBusy(false);
    }
  }, [cycleDeleteTarget, toast]);

  const toggleColumnSort = useCallback((column: JiraColumnKey) => {
    setColumnSortModes(prev => {
      const next: JiraColumnSortModes = { ...prev, [column]: prev[column] === 'asc' ? 'desc' : 'asc' };
      setColumnManualOrder(order => {
        const nextOrder = { ...order, [column]: undefined };
        writeStoredJiraColumnOrder(next, nextOrder);
        return nextOrder;
      });
      return next;
    });
  }, []);

  const reorderTaskWithinColumn = useCallback((taskId: string, targetTaskId: string, column: JiraColumnKey) => {
    if (taskId === targetTaskId) return;
    const tasksInColumn = byStatus.get(column) || [];
    const taskIds = tasksInColumn.map(task => task.id);
    const from = taskIds.indexOf(taskId);
    const to = taskIds.indexOf(targetTaskId);
    if (from < 0 || to < 0) return;
    const nextIds = taskIds.slice();
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved);
    const nextModes: JiraColumnSortModes = { ...columnSortModes, [column]: 'manual' };
    const nextOrder: JiraColumnManualOrder = { ...columnManualOrder, [column]: nextIds };
    setColumnSortModes(nextModes);
    setColumnManualOrder(nextOrder);
    writeStoredJiraColumnOrder(nextModes, nextOrder);
  }, [byStatus, columnManualOrder, columnSortModes]);

  const openTaskDetail = useCallback((task: ProTask) => {
    setSelectedId(task.id);
    setDetailMenuOpen(false);
    const sideDetailVisible = taskDetailLayout === 'side'
      && typeof window !== 'undefined'
      && window.matchMedia('(min-width: 1536px)').matches;
    setDetailOpen(!sideDetailVisible);
  }, [taskDetailLayout]);

  useEffect(() => {
    if (!detailOpen || !selectedId) {
      const activeSession = activeFocusSessionRef.current;
      activeFocusSessionRef.current = null;
      if (activeSession) {
        void api.finishProTaskFocusSession(activeSession.taskId, activeSession.focusSessionId).then(result => {
          if (result.ok && result.task) upsertTask(result.task);
        }).catch(() => {});
      }
      return undefined;
    }

    let cancelled = false;
    const previous = activeFocusSessionRef.current;
    if (previous && previous.taskId !== selectedId) {
      activeFocusSessionRef.current = null;
      void api.finishProTaskFocusSession(previous.taskId, previous.focusSessionId).then(result => {
        if (result.ok && result.task) upsertTask(result.task);
      }).catch(() => {});
    }

    if (!activeFocusSessionRef.current) {
      void api.startProTaskFocusSession(selectedId, 'jira-focus-mode').then(result => {
        if (cancelled) {
          if (result.focusSession?.id) void api.finishProTaskFocusSession(selectedId, result.focusSession.id).catch(() => {});
          return;
        }
        if (result.ok && result.task && result.focusSession?.id) {
          activeFocusSessionRef.current = { taskId: selectedId, focusSessionId: result.focusSession.id };
          upsertTask(result.task);
        }
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [detailOpen, selectedId, upsertTask]);

  const createTask = useCallback(async (taskDraft: { title: string; description: string; workdir: string; defaultAgent: string; defaultAssistantId: string }) => {
    const description = taskDraft.description.trim();
    const title = taskDraft.title.trim() || inferTaskTitle(description);
    if (!title && !description) return;
    setCreating(true);
    try {
      const spaceId = defaultSpaceForCreate(selectedSpaceId);
      const result = await api.createProTask({
        title,
        description,
        sprint: activeSpaceIsJira && selectedSprint !== 'all' ? selectedSprint : undefined,
        spaceId,
        kind: defaultKindForSpace(spaceId),
        workdir: taskDraft.workdir || state?.runtimeWorkdir,
        defaultAgent: taskDraft.defaultAgent || null,
        defaultAssistantId: taskDraft.defaultAssistantId || null,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to create task');
      upsertTask(result.task);
      setCreateOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create task', false);
    } finally {
      setCreating(false);
    }
  }, [activeSpaceIsJira, selectedSpaceId, selectedSprint, state?.runtimeWorkdir, toast, upsertTask]);

  const createTaskSpace = useCallback(async (draft: { name: string; defaultWorkdir: string; defaultAgent: string; defaultAssistantId: string }) => {
    const name = draft.name.trim();
    if (!name) return;
    setSpaceCreateBusy(true);
    try {
      const result = await api.createTaskSpace({
        name,
        defaultWorkdir: draft.defaultWorkdir || state?.runtimeWorkdir,
        defaultAgent: draft.defaultAgent || state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex',
        defaultAssistantId: draft.defaultAssistantId || undefined,
      });
      if (!result.ok || !result.space) throw new Error(result.error || 'Failed to create task space');
      setTaskSpaces(prev => [...prev.filter(space => space.id !== result.space!.id), result.space!]);
      setSelectedSpaceId(result.space.id);
      setSpaceCreateOpen(false);
      toast('Task space created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create task space', false);
    } finally {
      setSpaceCreateBusy(false);
    }
  }, [state?.bot?.defaultAgent, state?.config?.defaultAgent, state?.runtimeWorkdir, toast]);

  const runJiraSync = useCallback(async () => {
    setSyncBusy(true);
    try {
      const result = await api.runJiraMcpSync({ workdir: state?.runtimeWorkdir });
      if (!result.ok || !result.run) throw new Error(result.error || 'Failed to start Jira sync');
      setSyncRuns(prev => [result.run!, ...prev.filter(run => run.id !== result.run!.id)]);
      setSelectedSyncRunId(result.run.id);
      setSyncDetailsOpen(true);
      toast('Jira sync queued');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start Jira sync', false);
    } finally {
      setSyncBusy(false);
    }
  }, [state?.runtimeWorkdir, toast]);

  const analyzeTicket = useCallback(async () => {
    const query = ticketQuery.trim() || selectedTask?.jiraKey || selectedTask?.title || '';
    if (!query) return;
    setAnalyzeBusy(true);
    try {
      if (selectedTask) {
        setBusy({ taskId: selectedTask.id, stage: 'refinement' });
        const workflow = jiraConfig.statusWorkflows?.refinement || {};
        const execution = resolveTaskExecution(selectedTask, jiraConfig);
        const ownerMode = execution.ownerMode;
        const assistantId = ownerMode === 'assistant'
          ? execution.assistantId
          : ownerMode === 'agent'
            ? undefined
            : workflow.assistantId || selectedTask.defaultAssistantId || undefined;
        const agent = ownerMode === 'agent'
          ? execution.agent
          : selectedTask.defaultAgent || state?.bot?.defaultAgent || state?.config?.defaultAgent || undefined;
        const result = await api.startProTaskStage(selectedTask.id, 'refinement', {
          workdir: selectedTask.workdir || state?.runtimeWorkdir,
          assistantId,
          agent,
          prompt: buildStatusChatPrompt(selectedTask, 'refinement', ANALYZE_TICKET_PROMPT, workflow.instruction, execution.mode),
          model: pickRandomModel(workflow.modelPool),
          executionMode: execution.mode,
        });
        if (!result.ok || !result.task) throw new Error(result.error || 'Failed to start task analysis');
        upsertTask(result.task);
        const sideDetailVisible = taskDetailLayout === 'side'
          && typeof window !== 'undefined'
          && window.matchMedia('(min-width: 1536px)').matches;
        setDetailOpen(!sideDetailVisible);
        toast('Analyze queued on this task');
        return;
      }
      const result = await api.analyzeJiraTicket({ query, workdir: selectedTask?.workdir || state?.runtimeWorkdir });
      if (!result.ok) throw new Error(result.error || 'Failed to start ticket analysis');
      toast('Ticket analysis chat queued');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start ticket analysis', false);
    } finally {
      setBusy(current => current?.stage === 'refinement' ? null : current);
      setAnalyzeBusy(false);
    }
  }, [jiraConfig, selectedTask, state?.bot?.defaultAgent, state?.config?.defaultAgent, state?.runtimeWorkdir, taskDetailLayout, ticketQuery, toast, upsertTask]);

  const updateStatus = useCallback(async (task: ProTask, status: ProTaskStatus): Promise<ProTask | null> => {
    try {
      const result = await api.updateProTaskStatus(task.id, status);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task');
      upsertTask(result.task);
      if (status === 'done') void refreshCycles().catch(() => {});
      return result.task;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update task', false);
      return null;
    }
  }, [refreshCycles, toast, upsertTask]);

  const deleteTask = useCallback(async () => {
    const task = taskDeleteTarget;
    if (!task || deletingTaskId) return;
    setDeletingTaskId(task.id);
    try {
      const result = await api.deleteProTask(task.id);
      if (!result.ok) throw new Error(result.error || 'Failed to delete task');
      setTasks(prev => prev.filter(item => item.id !== task.id));
      setSelectedId(current => current === task.id ? null : current);
      setDetailMenuOpen(false);
      setDetailOpen(false);
      setTaskDeleteTarget(null);
      toast('Task deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete task', false);
    } finally {
      setDeletingTaskId(null);
    }
  }, [deletingTaskId, taskDeleteTarget, toast]);

  const updateTaskJiraFields = useCallback(async (
    task: ProTask,
    fields: { reporter?: string; assignee?: string; status?: string; dueDate?: string; priority?: string; labels?: string[] },
  ) => {
    setSavingJiraFieldsTaskId(task.id);
    try {
      const result = await api.updateProTaskJiraFields(task.id, fields);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update Jira fields');
      upsertTask(result.task);
      toast('Jira fields updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update Jira fields', false);
    } finally {
      setSavingJiraFieldsTaskId(null);
    }
  }, [toast, upsertTask]);

  const reopenClosedTask = useCallback(async (task: ProTask) => {
    if (reopeningTaskId) return;
    setReopeningTaskId(task.id);
    try {
      const fieldsResult = await api.updateProTaskJiraFields(task.id, {
        status: 'Reopened',
        updatedAt: new Date().toISOString(),
      });
      if (!fieldsResult.ok || !fieldsResult.task) throw new Error(fieldsResult.error || 'Failed to reopen ticket');
      let nextTask = fieldsResult.task;
      if (nextTask.status !== 'backlog') {
        const statusResult = await api.updateProTaskStatus(task.id, 'backlog');
        if (!statusResult.ok || !statusResult.task) throw new Error(statusResult.error || 'Failed to update task status');
        nextTask = statusResult.task;
      }
      upsertTask(nextTask);
      void refreshCycles().catch(() => {});
      toast('Ticket reopened locally');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reopen ticket', false);
    } finally {
      setReopeningTaskId(null);
    }
  }, [refreshCycles, reopeningTaskId, toast, upsertTask]);

  const updateTaskCycle = useCallback(async (task: ProTask, cycleId: string | null) => {
    try {
      const result = await api.updateProTaskCycle(task.id, cycleId);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update cycle');
      upsertTask(result.task);
      await refreshCycles();
      toast(cycleId ? 'Task cycle updated' : 'Task removed from cycle');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update cycle', false);
    }
  }, [refreshCycles, toast, upsertTask]);

  const updateTaskMeta = useCallback(async (task: ProTask, patch: TaskMetaPatch) => {
    try {
      const result = await api.updateProTaskMeta(task.id, patch);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task');
      upsertTask(result.task);
      toast('Task metadata updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update task', false);
    }
  }, [toast, upsertTask]);

  const startStage = useCallback(async (
    task: ProTask,
    stage: ProTaskStage,
    options: { assistantId?: string; agent?: string | null; prompt?: string; model?: string | null; executionMode?: 'direct' | 'interactive'; subtaskId?: string | null } = {},
  ): Promise<ProTask | null> => {
    setBusy({ taskId: task.id, stage });
    try {
      const result = await api.startProTaskStage(task.id, stage, {
        workdir: task.workdir || state?.runtimeWorkdir,
        assistantId: options.assistantId || undefined,
        agent: options.agent || undefined,
        prompt: options.prompt,
        model: options.model,
        executionMode: options.executionMode || undefined,
        subtaskId: options.subtaskId || undefined,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to start stage chat');
      upsertTask(result.task);
      toast(`${STAGE_LABEL[stage]} stage chat queued`);
      return result.task;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start stage chat', false);
      return null;
    } finally {
      setBusy(null);
    }
  }, [state?.runtimeWorkdir, toast, upsertTask]);

  const startStatusChat = useCallback(async (task: ProTask, status: ProTaskStatus, prompt?: string, agentOverride?: string) => {
    const stage = STATUS_CHAT_STAGE[status];
    const workflow = jiraConfig.statusWorkflows?.[status] || {};
    const execution = resolveTaskExecution(task, jiraConfig);
    const ownerMode = execution.ownerMode;
    const assistantId = ownerMode === 'assistant'
      ? execution.assistantId
      : ownerMode === 'agent'
        ? undefined
        : workflow.assistantId || task.defaultAssistantId || undefined;
    const configuredAgent = ownerMode === 'agent'
      ? execution.agent
      : task.defaultAgent || state?.bot?.defaultAgent || state?.config?.defaultAgent || undefined;
    const agent = agentOverride || configuredAgent;
    await startStage(task, stage, {
      assistantId,
      agent,
      prompt: buildStatusChatPrompt(task, status, prompt, workflow.instruction, execution.mode),
      model: pickRandomModel(workflow.modelPool),
      executionMode: execution.mode,
    });
  }, [jiraConfig, startStage, state?.bot?.defaultAgent, state?.config?.defaultAgent]);

  const saveJiraConfig = useCallback(async (nextConfig: JiraWorkflowConfig) => {
    setSavingConfig(true);
    try {
      const result = await api.updateJiraWorkflowConfig(nextConfig);
      if (!result.ok) throw new Error(result.error || 'Failed to save Jira assistants');
      setJiraConfig({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...result.config });
      setSettingsOpen(false);
      toast('Jira assistants saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save Jira assistants', false);
    } finally {
      setSavingConfig(false);
    }
  }, [toast]);

  const runConfiguredStageForStatus = useCallback(async (task: ProTask, status: ProTaskStatus) => {
    const stage = jiraStageForStatus(status);
    if (!stage) return task;
    const workflow = jiraConfig.statusWorkflows?.[status] || {};
    const execution = resolveTaskExecution(task, jiraConfig);
    const ownerMode = execution.ownerMode;
    const stageAssistantId = ownerMode === 'assistant'
      ? execution.assistantId
      : ownerMode === 'agent'
        ? undefined
        : workflow.assistantId || (stage === 'refinement' ? jiraConfig.refinementAssistantId : jiraConfig.codingAssistantId);
    const stageAgent = ownerMode === 'agent' ? execution.agent : undefined;
    const stagedTask = await startStage(task, stage, {
      assistantId: stageAssistantId,
      agent: stageAgent,
      prompt: buildStatusWorkflowPrompt(task, status, workflow.instruction, execution.mode),
      model: pickRandomModel(workflow.modelPool),
      executionMode: execution.mode,
    });
    const taskAfterStage = stagedTask || task;
    const shouldRunKnowledge = stage === 'refinement'
      ? jiraConfig.runKnowledgeOnRefinement !== false
      : jiraConfig.runKnowledgeOnCoding !== false;
    if (shouldRunKnowledge && jiraConfig.knowledgeAssistantId) {
      return await startStage(taskAfterStage, 'knowledge', { assistantId: jiraConfig.knowledgeAssistantId }) || taskAfterStage;
    }
    return taskAfterStage;
  }, [jiraConfig, startStage]);

  const moveTaskToStatus = useCallback(async (task: ProTask, status: ProTaskStatus) => {
    const updatedTask = task.status === status ? task : await updateStatus(task, status);
    if (!updatedTask) return;
    await runConfiguredStageForStatus(updatedTask, status);
  }, [runConfiguredStageForStatus, updateStatus]);

  const handleDropTask = useCallback(async (taskId: string, column: JiraColumnKey) => {
    setDragOverColumn(null);
    setDragOverTaskId(null);
    setDraggingTaskId(null);
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    await moveTaskToStatus(task, jiraStatusForColumn(column));
  }, [moveTaskToStatus, tasks]);

  const completeStage = useCallback(async (task: ProTask, run: StageRun) => {
    try {
      const result = await api.updateProTaskStageRun(task.id, run.id, {
        status: 'completed',
        summary: `${STAGE_LABEL[run.stage]} stage completed by user.`,
        estimate: run.output?.estimate || (run.stage === 'refinement' || run.stage === 'focus'
          ? { estimatePoint: run.stage === 'refinement' ? 2 : 1, codingMinutes: 30, userUnderstandingMinutes: 15, reviewMinutes: 10, verificationMinutes: 15, totalMinutes: 70, confidence: 'medium' }
          : undefined),
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update stage');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update stage', false);
    }
  }, [toast, upsertTask]);

  const toggleExclusiveMode = useCallback(async (task: ProTask, enabled: boolean) => {
    try {
      const result = await api.setProTaskExclusiveMode(task.id, enabled);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update exclusive mode');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update exclusive mode', false);
    }
  }, [toast, upsertTask]);

  const updateTaskExecution = useCallback(async (
    task: ProTask,
    patch: { ownerMode?: 'status' | 'agent' | 'assistant'; agent?: string | null; assistantId?: string | null; mode?: 'direct' | 'interactive' },
  ) => {
    try {
      const current = resolveTaskExecution(task, jiraConfig);
      const result = await api.updateProTaskExecution(task.id, {
        ownerMode: patch.ownerMode || current.ownerMode,
        agent: patch.agent !== undefined ? patch.agent : current.agent,
        assistantId: patch.assistantId !== undefined ? patch.assistantId : current.assistantId,
        mode: patch.mode || current.mode,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update execution settings');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update execution settings', false);
    }
  }, [jiraConfig, toast, upsertTask]);

  const createSubtask = useCallback(async (task: ProTask) => {
    const title = subtaskDraft.title.trim();
    if (!title) return;
    try {
      const result = await api.createProSubtask(task.id, {
        title,
        description: subtaskDraft.description,
        assignedAgent: subtaskDraft.assignedAgent || task.defaultAgent || null,
        assistantId: subtaskDraft.assistantId || task.defaultAssistantId || null,
        workdir: task.workdir || state?.runtimeWorkdir,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to create subtask');
      upsertTask(result.task);
      setSubtaskDraft({ title: '', description: '', assignedAgent: '', assistantId: '' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create subtask', false);
    }
  }, [state?.runtimeWorkdir, subtaskDraft, toast, upsertTask]);

  const updateSubtaskStatus = useCallback(async (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => {
    try {
      const result = await api.updateProSubtask(task.id, subtaskId, { status });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update subtask');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update subtask', false);
    }
  }, [toast, upsertTask]);

  const startSubtask = useCallback(async (task: ProTask, subtaskId: string) => {
    const subtask = task.subTasks.find(item => item.id === subtaskId);
    if (!subtask) return;
    const prompt = [
      `Parent task: ${task.title}`,
      task.description ? `Parent description:\n${task.description}` : '',
      '',
      `Subtask: ${subtask.title}`,
      subtask.description ? `Subtask description:\n${subtask.description}` : '',
      '',
      'Execute this subtask independently, then summarize output, changed files, tests, and remaining review notes for the parent task.',
    ].filter(Boolean).join('\n');
    await startStage(task, 'coding', {
      subtaskId,
      agent: subtask.assignedAgent || task.defaultAgent || null,
      assistantId: subtask.assistantId || task.defaultAssistantId || undefined,
      prompt,
      executionMode: task.execution?.mode || 'direct',
    });
  }, [startStage]);

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

  const startVerification = useCallback(async (task: ProTask) => {
    try {
      const result = await api.startVerificationRun(task.id, {
        environment: verifyDraft.environment || 'manual',
        url: verifyDraft.url,
        stageRunId: task.stageRuns.find(run => run.stage === 'verification' || run.stage === 'demo')?.id,
        pipeline: { provider: 'manual', status: 'unknown', branch: task.stageRuns.find(run => run.output?.branch)?.output?.branch },
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to start verification');
      upsertTask(result.task);
      const url = result.verificationRun?.browserSession?.url || verifyDraft.url;
      if (url) void openBrowserPanel(url);
      toast('Verification opened');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start verification', false);
    }
  }, [openBrowserPanel, toast, upsertTask, verifyDraft]);

  const finishVerification = useCallback(async (task: ProTask, run: VerificationRun, resultValue: VerificationResult) => {
    try {
      const result = await api.finishVerificationRun(task.id, run.id, resultValue, verifyDraft.notes);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to finish verification');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to finish verification', false);
    }
  }, [toast, upsertTask, verifyDraft.notes]);

  const activeSpaceName = selectedSpaceId === ALL_TASKS_SPACE_ID ? 'All Tasks' : activeTaskSpace?.name || 'Tasks';
  const taskSpaceSelectItems = [{ id: ALL_TASKS_SPACE_ID, name: 'All Tasks', kind: 'custom' as const }, ...taskSpaces];
  const activeSpaceCount = activeSpaceTasks.length;
  const visibleSpaceCount = visibleTasks.length;
  const activeSpaceSubtitle = selectedSpaceId === ALL_TASKS_SPACE_ID
    ? 'Across task spaces'
    : activeSpaceIsJira
      ? 'Jira task space'
      : activeTaskSpace?.kind === 'personal'
        ? 'Personal task space'
        : 'Custom task space';

  return (
    <div className="h-full min-h-[640px] overflow-hidden">
      {loading ? (
        <div className="flex h-full items-center justify-center rounded-xl border border-edge/70 bg-panel/78 text-sm text-fg-4 shadow-[var(--th-card-shadow)]">
          <Spinner /> {t('sessions.loading')}
        </div>
      ) : (
        <div className="flex h-full min-h-0 gap-3">
          <TaskSpaceSidebar
            spaces={taskSpaces}
            selectedId={selectedSpaceId}
            counts={taskSpaceCounts}
            collapsed={spaceSidebarCollapsed}
            search={ticketQuery}
            searchFocusTick={spaceSearchFocusTick}
            detailLayout={taskDetailLayout}
            onSelect={setSelectedSpaceId}
            onCreateSpace={() => setSpaceCreateOpen(true)}
            onSearchChange={setTicketQuery}
            onDetailLayoutChange={updateTaskDetailLayout}
            onToggleCollapsed={toggleTaskSpaceSidebar}
          />
          <div className="panel-isolated flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge/70 bg-panel/78 shadow-[var(--th-card-shadow)] backdrop-blur-md">
            <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-edge/45 bg-panel/45 px-3 py-2">
              {spaceSidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTaskSpaceSidebar}
                  title="Show task spaces"
                  aria-label="Show task spaces"
                  className="h-8 w-8 shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M9 4v16" />
                  </svg>
                </Button>
              )}
              <select
                value={selectedSpaceId}
                onChange={event => setSelectedSpaceId(event.target.value || ALL_TASKS_SPACE_ID)}
                className="h-8 min-w-[132px] rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50 md:hidden"
              >
                {taskSpaceSelectItems.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
              <div className="min-w-[150px] flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg" title={activeSpaceName}>{activeSpaceName}</span>
                  <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{visibleSpaceCount}</Badge>
                  {closedTasks.length > 0 && <span className="hidden text-[10.5px] text-fg-5 sm:inline">{closedTasks.length} closed</span>}
                </div>
                <div className="truncate text-[10.5px] text-fg-5">
                  {activeSpaceSubtitle}{activeSpaceCount !== visibleSpaceCount ? ` · ${activeSpaceCount} total` : ''}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={revealTaskSpaceSearch}
                title="Search tasks"
                aria-label="Search tasks"
                className={cn('h-8 w-8 shrink-0', !spaceSidebarCollapsed && 'md:hidden')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </Button>
              <Button variant="primary" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create task
              </Button>
              {activeSpaceIsJira && (
                <>
                  <div className="hidden h-5 w-px bg-edge/60 lg:block" />
                  <JiraSyncMonitor
                    runs={syncRuns}
                    selectedRun={selectedSyncRun}
                    detailsOpen={syncDetailsOpen}
                    syncing={syncBusy || syncRunActive(latestSyncRun)}
                    onSync={() => { void runJiraSync(); }}
                    onSelectRun={setSelectedSyncRunId}
                    onCloseDetails={() => setSyncDetailsOpen(false)}
                  />
                  <Button variant="outline" size="sm" disabled={analyzeBusy || !(ticketQuery.trim() || selectedTask)} onClick={() => { void analyzeTicket(); }}>
                    {analyzeBusy ? <Spinner /> : null}
                    Analyze ticket
                  </Button>
                  <select
                    value={selectedSprint}
                    onChange={event => setSelectedSprint(event.target.value || 'all')}
                    className="h-8 min-w-[150px] rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
                  >
                    <option value="all">All sprints</option>
                    {sprintOptions.map(sprint => (
                      <option key={sprint} value={sprint}>{sprint}</option>
                    ))}
                  </select>
                  {activeCycle && (
                    <span className="inline-flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md border border-edge bg-panel-alt px-2 text-[11px] text-fg-4">
                      <span className="truncate">{activeCycle.name}</span>
                      <Badge variant="ok">{activeCycle.tasks.length}</Badge>
                    </span>
                  )}
                  {activeCycle ? (
                    <Button variant="outline" size="sm" disabled={cycleBusy} onClick={() => { void closeActiveCycle(); }}>
                      {cycleBusy ? <Spinner /> : null}
                      Close cycle
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cycleBusy}
                      onClick={() => {
                        const today = localDateInputValue();
                        setCycleDraft({ name: '', startDate: today, endDate: today });
                        setCycleKickoffOpen(true);
                      }}
                    >
                      {cycleBusy ? <Spinner /> : null}
                      Kick off
                    </Button>
                  )}
                  <JiraDashboardSettingsMenu
                    canOpenSyncDetails={syncRuns.length > 0}
                    onOpenSyncDetails={() => setSyncDetailsOpen(true)}
                    onRefreshSync={() => { void loadSyncRuns({ refreshTasksOnCompletion: true }); }}
                    onOpenWorkflowSettings={() => setSettingsOpen(true)}
                  />
                </>
              )}
            </div>
            <div className={cn(
              'grid min-h-0 flex-1 grid-cols-1 overflow-hidden',
              taskDetailLayout === 'side' && '2xl:grid-cols-[minmax(0,1fr)_minmax(560px,42vw)]',
            )}>
              <div className="min-h-0 overflow-y-auto p-3">
                <div className="space-y-3">
          <div className="dashboard-board-grid grid min-h-[calc(100vh-220px)] gap-3">
            {JIRA_COLUMNS.map(column => (
              <section
                key={column.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverColumn(column.key);
                }}
                onDragLeave={() => setDragOverColumn(current => current === column.key ? null : current)}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData('text/plain');
                  if (taskId) void handleDropTask(taskId, column.key);
                }}
                className={cn(
                  'group/column min-h-[280px] rounded-xl border border-edge/50 bg-panel-alt/35 flex flex-col overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-[border-color,background,box-shadow] duration-200 hover:border-edge/75 hover:bg-panel-alt/45 md:min-h-0',
                  dragOverColumn === column.key ? 'border-primary/45 bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)]' : '',
                )}
              >
                <div className="shrink-0 border-b border-edge/25 bg-panel/30 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleColumnSort(column.key)}
                    className="flex w-full items-center gap-2 text-left"
                    title="Toggle time sort"
                  >
                    <Badge variant={JIRA_COLUMN_BADGE[column.key]} className="h-5 px-2 text-[10px] tabular-nums">{byStatus.get(column.key)?.length || 0}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12px] font-semibold text-fg-2">{column.label}</span>
                      </div>
                      <div className="truncate text-[10px] text-fg-5">{column.hint}</div>
                    </div>
                    <JiraColumnSortIcon mode={columnSortModes[column.key] || 'desc'} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                  {dragOverColumn === column.key && draggingTask && jiraColumnForTask(draggingTask) !== column.key && (
                    <div className="mb-2 flex h-[76px] items-center justify-center rounded-lg border border-dashed border-primary/45 bg-primary/[0.055] text-[11px] font-medium text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]">
                      Drop to move to {column.label}
                    </div>
                  )}
                  {(byStatus.get(column.key) || []).length === 0 ? (
                    column.key === 'backlog' ? (
                      <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className={cn(
                          'flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-inset/30 text-center transition hover:border-primary/45 hover:bg-primary/[0.04] hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
                          dragOverColumn === column.key
                            ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                            : 'border-edge/40 text-fg-5/70',
                        )}
                        title="Create task"
                        aria-label="Create task"
                      >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-edge/55 bg-panel/80 text-fg-4 shadow-sm transition group-hover/column:border-primary/35 group-hover/column:text-primary">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </span>
                        <span className="text-[12px] font-semibold text-fg-3">Create task</span>
                      </button>
                    ) : (
                      <div className={cn(
                        'flex h-24 items-center justify-center rounded-lg border border-dashed bg-inset/30 text-[11px]',
                        dragOverColumn === column.key
                          ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                          : 'border-edge/40 text-fg-5/60',
                      )}>No tasks</div>
                    )
                  ) : (
                    <div className="space-y-2">
                      {(byStatus.get(column.key) || []).map(task => (
                        <div
                          key={task.id}
                          onDragOver={(event) => {
                            if (!draggingTaskId || draggingTaskId === task.id) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverColumn(column.key);
                            setDragOverTaskId(task.id);
                          }}
                          onDragLeave={() => setDragOverTaskId(current => current === task.id ? null : current)}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const draggedTaskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
                            const draggedTask = tasks.find(item => item.id === draggedTaskId);
                            setDragOverTaskId(null);
                            setDragOverColumn(null);
                            setDraggingTaskId(null);
                            if (!draggedTaskId || !draggedTask) return;
                            if (jiraColumnForTask(draggedTask) === column.key) reorderTaskWithinColumn(draggedTaskId, task.id, column.key);
                            else void handleDropTask(draggedTaskId, column.key);
                          }}
                          className={cn(
                            'rounded-lg transition-[box-shadow,transform]',
                            dragOverTaskId === task.id && draggingTaskId !== task.id && 'shadow-[0_-3px_0_rgba(59,130,246,0.75)]',
                          )}
                        >
                          <TaskCard
                            task={task}
                            selected={selectedTask?.id === task.id}
                            busyStage={busy?.taskId === task.id ? busy.stage : null}
                            draggable
                            isDragging={draggingTaskId === task.id}
                            onSelect={openTaskDetail}
                            onDragStart={(next) => setDraggingTaskId(next.id)}
                            onDragEnd={() => {
                              setDraggingTaskId(null);
                              setDragOverColumn(null);
                              setDragOverTaskId(null);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
          {closedTasks.length > 0 && (
            <section className="rounded-xl border border-edge/50 bg-panel-alt/35 px-3 py-3">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-fg-2">Closed</div>
                  <div className="truncate text-[10px] text-fg-5">Remote status is closed</div>
                </div>
                <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{closedTasks.length}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {closedTasks.slice(0, 12).map(task => (
                  <div
                    key={task.id}
                    className={cn(
                      'min-w-0 rounded-lg border border-edge/55 bg-panel/62 px-3 py-2 text-left transition hover:border-edge-h hover:bg-panel-h',
                      selectedTask?.id === task.id && 'border-primary/35 bg-primary/[0.055]',
                    )}
                  >
                    <button type="button" onClick={() => openTaskDetail(task)} className="block w-full min-w-0 text-left">
                      <div className="mb-1 flex min-w-0 items-center gap-2">
                        {task.jiraKey && <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">{task.jiraKey}</span>}
                        <Badge variant="muted">{taskRemoteStatus(task) || 'Closed'}</Badge>
                      </div>
                      <div className="truncate text-[12px] font-semibold text-fg-2">{task.title}</div>
                    </button>
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 px-2 text-[10.5px]"
                        disabled={reopeningTaskId === task.id}
                        onClick={() => { void reopenClosedTask(task); }}
                      >
                        {reopeningTaskId === task.id ? <Spinner /> : null}
                        Reopen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {activeSpaceIsJira && (
            <JiraCyclePanel
              cycles={cycles}
              taskCounts={cycleTaskCounts}
              tasksByCycle={tasksByCycle}
              expandedIds={expandedCycleIds}
              onToggleExpanded={toggleCycleExpanded}
              onDeleteCycle={setCycleDeleteTarget}
            />
          )}
          </div>
              </div>
              {taskDetailLayout === 'side' && (
                <TaskInlineWorkbench
                  task={selectedTask}
                  defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
                  agents={agentStatus?.agents || []}
                  assistants={assistants}
                  busy={busy}
                  reopening={selectedTask ? reopeningTaskId === selectedTask.id : false}
                  workspaces={workspaces}
                  fallbackWorkdir={state?.runtimeWorkdir}
                  subtaskDraft={subtaskDraft}
                  onMetaChange={(task, patch) => { void updateTaskMeta(task, patch); }}
                  onStartStatusChat={startStatusChat}
                  onSubtaskDraftChange={setSubtaskDraft}
                  onCreateSubtask={(task) => { void createSubtask(task); }}
                  onUpdateSubtaskStatus={(task, subtaskId, status) => { void updateSubtaskStatus(task, subtaskId, status); }}
                  onStartSubtask={(task, subtaskId) => { void startSubtask(task, subtaskId); }}
                  onReopen={(task) => { void reopenClosedTask(task); }}
                  onOpenFull={() => setDetailOpen(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}
      <CreateJiraTaskModal
        open={createOpen}
        creating={creating}
        title="Create task"
        workspaces={workspaces.length ? workspaces : [{ path: state?.runtimeWorkdir || '', name: state?.runtimeWorkdir || 'Workspace' }]}
        assistants={assistants}
        defaultWorkdir={activeTaskSpace?.defaultWorkdir || state?.runtimeWorkdir || workspaces[0]?.path || ''}
        defaultAgent={activeTaskSpace?.defaultAgent || state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
        defaultAssistantId={activeTaskSpace?.defaultAssistantId}
        onClose={() => setCreateOpen(false)}
        onCreate={createTask}
      />
      <CreateTaskSpaceModal
        open={spaceCreateOpen}
        busy={spaceCreateBusy}
        assistants={assistants}
        defaultWorkdir={state?.runtimeWorkdir || workspaces[0]?.path || ''}
        defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
        onClose={() => setSpaceCreateOpen(false)}
        onCreate={createTaskSpace}
      />
      <JiraCycleKickoffModal
        open={cycleKickoffOpen}
        busy={cycleBusy}
        draft={cycleDraft}
        onChange={setCycleDraft}
        onClose={() => setCycleKickoffOpen(false)}
        onSubmit={() => { void kickOffCycle(); }}
      />
      <Modal open={!!cycleDeleteTarget} onClose={() => setCycleDeleteTarget(null)}>
        <ModalHeader title="Delete cycle" onClose={() => setCycleDeleteTarget(null)} />
        <div className="space-y-4">
          <div className="text-[13px] leading-relaxed text-fg-3">
            Delete <span className="font-semibold text-fg">{cycleDeleteTarget?.name}</span>? This removes the cycle archive only. Tasks stay in Pikiclaw.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={cycleDeleteBusy} onClick={() => setCycleDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={cycleDeleteBusy} onClick={() => { void deleteCycle(); }}>
              {cycleDeleteBusy ? <Spinner /> : null}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
      <JiraAssistantConfigModal
        open={settingsOpen}
        saving={savingConfig}
        assistants={assistants}
        agents={agentStatus?.agents || []}
        config={jiraConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={saveJiraConfig}
      />
      <Modal
        open={detailOpen && !!selectedTask}
        onClose={() => {
          setDetailMenuOpen(false);
          setDetailOpen(false);
        }}
        wide
        panelStyle={{ maxWidth: 'min(1180px, calc(100vw - 32px))' }}
      >
        <div className="h-[min(82vh,840px)]">
          <TaskDetail
            task={selectedTask}
            defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
            agents={agentStatus?.agents || []}
            assistants={assistants}
            busy={busy}
            reopening={selectedTask ? reopeningTaskId === selectedTask.id : false}
            workspaces={workspaces}
            fallbackWorkdir={state?.runtimeWorkdir}
            subtaskDraft={subtaskDraft}
            onMetaChange={(task, patch) => { void updateTaskMeta(task, patch); }}
            onStartStatusChat={startStatusChat}
            onSubtaskDraftChange={setSubtaskDraft}
            onCreateSubtask={(task) => { void createSubtask(task); }}
            onUpdateSubtaskStatus={(task, subtaskId, status) => { void updateSubtaskStatus(task, subtaskId, status); }}
            onStartSubtask={(task, subtaskId) => { void startSubtask(task, subtaskId); }}
            onReopen={(task) => { void reopenClosedTask(task); }}
            actions={selectedTask ? (
              <>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="!h-7 !w-7 text-[12px]"
                    aria-label="Task actions"
                    aria-expanded={detailMenuOpen}
                    onClick={() => setDetailMenuOpen(prev => !prev)}
                  >
                    ...
                  </Button>
                  {detailMenuOpen && selectedTask && (
                    <div
                      className="absolute right-0 top-[calc(100%+8px)] z-40 w-44 overflow-hidden rounded-xl border border-edge-h/70 bg-dropdown p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18),0_4px_12px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.03] backdrop-blur-md"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={deletingTaskId === selectedTask.id}
                        onClick={() => {
                          setDetailMenuOpen(false);
                          setTaskDeleteTarget(selectedTask);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-err transition-colors hover:bg-err/[0.10] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {deletingTaskId === selectedTask.id ? (
                          <Spinner />
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v5" />
                            <path d="M14 11v5" />
                          </svg>
                        )}
                        <span>Delete task</span>
                      </button>
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setDetailMenuOpen(false);
                    setDetailOpen(false);
                  }}
                  className="!h-7 !w-7 text-[12px]"
                  aria-label="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </Button>
              </>
            ) : null}
          />
        </div>
      </Modal>
      <Modal open={!!taskDeleteTarget} onClose={() => setTaskDeleteTarget(null)}>
        <ModalHeader title="Delete task" onClose={() => setTaskDeleteTarget(null)} />
        <div className="space-y-4">
          <div className="text-[13px] leading-relaxed text-fg-3">
            Delete <span className="font-semibold text-fg">{taskDeleteTarget?.jiraKey || taskDeleteTarget?.title}</span> from Pikiclaw? External tickets are not deleted.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={!!deletingTaskId} onClick={() => setTaskDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!!deletingTaskId} onClick={() => { void deleteTask(); }}>
              {deletingTaskId ? <Spinner /> : null}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
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
    </div>
  );
}

export const JiraTab = TasksTab;
