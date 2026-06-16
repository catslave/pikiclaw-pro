import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { BrowserPanelModal } from '../../components/BrowserPanelModal';
import { DirBrowser } from '../../components/DirBrowser';
import { useAssistantGeneratedOutput } from '../../components/assistant/AssistantGeneratedUi';
import { Badge, Button, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { AgentAssistant, AgentRuntimeStatus, BrowserPanelSnapshot, DailyItem, JiraCycle, JiraRemoteUpdateFields, JiraRemoteUpdateRun, JiraSyncRun, JiraWorkflowConfig, ProOutput, ProSubtaskStatus, ProTask, ProTaskStage, ProTaskStatus, RichMessage, SessionInfo, StageRun, StageSessionRef, TaskSpace, TodoItem, VerificationResult, VerificationRun, WorkspaceEntry } from '../../types';
import { cn } from '../../utils';
import { AssistantMsg, ensureRichMessageBlocks, MarkdownFilePreviewCard } from '../sessions/AssistantContent';
import { GeneratedOutputCards } from '../sessions/GeneratedOutputCards';
import { SessionPanel, type SessionPanelChange } from '../sessions/SessionPanel';
import { createMdComponents, mdPlugins, type FileLinkTarget, type OpenFileLinkHandler } from '../sessions/markdown';
import { UserBubble, type SelectionActionRequest, type SelectionSideChatRequest } from '../sessions/TurnView';
import { buildJiraFilterOptions, jiraTaskFixVersions, jiraTaskMatchesFilters } from './task-filters';

const STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const VISIBLE_STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const STAGES: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix'];
type JiraColumnKey = 'backlog' | 'refinement' | 'working' | 'review' | 'done';

const DAILY_VIEW_ID = 'daily';
const ALL_TASKS_SPACE_ID = 'all';
const JIRA_TASK_SPACE_ID = 'jira';
const PERSONAL_TASK_SPACE_ID = 'personal';
const ANALYZE_TASK_SPACE_ID = 'ticket-analyze';

const JIRA_COLUMNS: Array<{ key: JiraColumnKey; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'New or planned' },
  { key: 'refinement', label: 'Refinement', hint: 'Clarify scope and plan' },
  { key: 'working', label: 'Working', hint: 'Implementation in progress' },
  { key: 'review', label: 'Review', hint: 'Awaiting user review' },
  { key: 'done', label: 'Done', hint: 'Local work completed' },
];

const JIRA_COLUMN_BADGE: Record<JiraColumnKey, 'ok' | 'warn' | 'muted' | 'accent'> = {
  backlog: 'muted',
  refinement: 'warn',
  working: 'accent',
  review: 'accent',
  done: 'ok',
};

type JiraColumnSortDirection = 'desc' | 'asc';
type JiraColumnSortMode = JiraColumnSortDirection | 'manual';
type JiraColumnSortModes = Record<JiraColumnKey, JiraColumnSortMode>;
type JiraColumnManualOrder = Partial<Record<JiraColumnKey, string[]>>;
type TaskMetaPatch = { workdir?: string | null; prUrl?: string | null; linkedTaskId?: string | null };
type TaskDetailLayout = 'side' | 'modal';
type TaskSelectionSessionHandler<T extends SelectionActionRequest = SelectionActionRequest> = (session: StageSessionRef, request: T) => void | Promise<void>;
const JIRA_COLUMN_ORDER_STORAGE_KEY = 'pikiclaw:jira-dashboard:column-order:v1';
const TASK_SPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'pikiclaw:tasks:space-sidebar-collapsed:v1';
const TASK_DETAIL_LAYOUT_STORAGE_KEY = 'pikiclaw:tasks:detail-layout:v1';
const TASK_SELECTED_SPACE_STORAGE_KEY = 'pikiclaw:tasks:selected-space:v1';
const JIRA_ACTIVE_SPRINT_STORAGE_KEY = 'pikiclaw:jira-dashboard:active-sprint:v1';
const SHOW_JIRA_CYCLE_FEATURE = false;
const STALE_STAGE_RUN_MS = 30 * 60_000;
const DEFAULT_JIRA_COLUMN_SORT_MODES: JiraColumnSortModes = {
  backlog: 'asc',
  refinement: 'desc',
  working: 'desc',
  review: 'desc',
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
  return status;
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

function formatMonthDay(value: string | null | undefined): string {
  if (!value) return '--';
  const [year, month, day] = value.split('-').map(part => Number(part));
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

function formatHourMinute(value: string | null | undefined): string {
  if (!value) return '--';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '--';
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function normalizeDailyDateParam(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function orderTodoItems(items: TodoItem[]): TodoItem[] {
  const rank = (item: TodoItem) => item.status === 'open' ? 0 : item.status === 'done' ? 1 : item.status === 'chat-created' ? 2 : 3;
  return [...items].sort((a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function TodoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="3" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

function taskSyncSortTime(task: ProTask): number {
  const raw = task.jiraFields?.updatedAt || jiraRemoteSyncField(task.description, 'Updated') || task.updatedAt;
  const time = Date.parse(raw || '');
  return Number.isFinite(time) ? time : 0;
}

function taskDueSortTime(task: ProTask): number | null {
  const raw = task.jiraFields?.dueDate || jiraRemoteSyncField(task.description, 'Due date');
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : null;
}

function backlogTaskSortTime(task: ProTask): number {
  const createdAt = Date.parse(task.createdAt || '');
  return taskDueSortTime(task) ?? (Number.isFinite(createdAt) ? createdAt : 0);
}

function compareBacklogTasks(a: ProTask, b: ProTask, direction: JiraColumnSortDirection): number {
  const ad = taskDueSortTime(a);
  const bd = taskDueSortTime(b);
  if (ad != null && bd == null) return -1;
  if (ad == null && bd != null) return 1;
  const diff = backlogTaskSortTime(a) - backlogTaskSortTime(b);
  if (diff !== 0) return direction === 'asc' ? diff : -diff;
  return taskSyncSortTime(b) - taskSyncSortTime(a);
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

function readStoredTaskSelectedSpace(): string {
  if (typeof window === 'undefined') return JIRA_TASK_SPACE_ID;
  try {
    const value = window.localStorage.getItem(TASK_SELECTED_SPACE_STORAGE_KEY)?.trim();
    return value && value !== DAILY_VIEW_ID ? value : JIRA_TASK_SPACE_ID;
  } catch {
    return JIRA_TASK_SPACE_ID;
  }
}

function writeStoredTaskSelectedSpace(spaceId: string) {
  if (typeof window === 'undefined' || !spaceId || spaceId === DAILY_VIEW_ID) return;
  try {
    window.localStorage.setItem(TASK_SELECTED_SPACE_STORAGE_KEY, spaceId);
  } catch {}
}

function readStoredJiraActiveSprint(): string {
  if (typeof window === 'undefined') return 'all';
  try {
    return window.localStorage.getItem(JIRA_ACTIVE_SPRINT_STORAGE_KEY)?.trim() || 'all';
  } catch {
    return 'all';
  }
}

function writeStoredJiraActiveSprint(sprint: string) {
  if (typeof window === 'undefined') return;
  try {
    if (!sprint || sprint === 'all') window.localStorage.removeItem(JIRA_ACTIVE_SPRINT_STORAGE_KEY);
    else window.localStorage.setItem(JIRA_ACTIVE_SPRINT_STORAGE_KEY, sprint);
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

function remoteStatusTone(status: string | null | undefined): 'ok' | 'warn' | 'muted' | 'accent' {
  const normalized = (status || '').trim().toLowerCase();
  if (!normalized) return 'muted';
  if (/^(closed|done|resolved|cancelled|canceled)$/.test(normalized)) return 'ok';
  if (/^(in progress|doing|working|coding)$/.test(normalized)) return 'accent';
  if (/^(blocked|waiting|review|in review|to do|open)$/.test(normalized)) return 'warn';
  return 'muted';
}

function compactFixVersionLabel(task: ProTask): string | null {
  const versions = jiraTaskFixVersions(task);
  if (!versions.length) return null;
  return versions.length === 1 ? versions[0] : `${versions[0]} +${versions.length - 1}`;
}

type JiraRemoteUpdateDraft = {
  status: string;
  sprint: string;
  dueDate: string;
  fixVersionsText: string;
};

function jiraDateInputValue(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
}

function normalizedListKey(values: string[]): string {
  return values.map(item => item.trim()).filter(Boolean).join('\u0000');
}

function splitRemoteUpdateList(value: string): string[] {
  return value.split(/[,，;；\n]+/).map(item => item.trim()).filter(Boolean).slice(0, 20);
}

function remoteUpdateDraftFromTask(task: ProTask): JiraRemoteUpdateDraft {
  return {
    status: taskRemoteStatus(task) || '',
    sprint: task.sprint || '',
    dueDate: jiraDateInputValue(task.jiraFields?.dueDate || jiraRemoteSyncField(task.description, 'Due date')),
    fixVersionsText: jiraTaskFixVersions(task).join(', '),
  };
}

function remoteUpdateFieldsFromDraft(task: ProTask, draft: JiraRemoteUpdateDraft): JiraRemoteUpdateFields {
  const fields: JiraRemoteUpdateFields = {};
  const current = remoteUpdateDraftFromTask(task);
  const status = draft.status.trim();
  if (status && status !== current.status) fields.status = status;
  if (draft.sprint.trim() !== current.sprint) fields.sprint = draft.sprint.trim();
  if (draft.dueDate.trim() !== current.dueDate) fields.dueDate = draft.dueDate.trim();
  const nextVersions = splitRemoteUpdateList(draft.fixVersionsText);
  const currentVersions = splitRemoteUpdateList(current.fixVersionsText);
  if (normalizedListKey(nextVersions) !== normalizedListKey(currentVersions)) fields.fixVersions = nextVersions;
  return fields;
}

function jiraRemoteUpdateStatusTone(status: JiraRemoteUpdateRun['status']): 'ok' | 'warn' | 'muted' | 'accent' {
  if (status === 'applied') return 'ok';
  if (status === 'failed') return 'warn';
  if (status === 'applying') return 'accent';
  return 'muted';
}

function jiraRemoteFieldLabel(field: JiraRemoteUpdateRun['diff'][number]['field']): string {
  if (field === 'fixVersions') return 'fixVersion';
  if (field === 'dueDate') return 'due date';
  return field;
}

function jiraRemoteValueLabel(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(clear)';
  return value || '(clear)';
}

function workspaceShortLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

function taskSpaceIcon(spaceId: string, kind?: TaskSpace['kind']): string {
  if (spaceId === DAILY_VIEW_ID) return 'D';
  if (spaceId === ALL_TASKS_SPACE_ID) return 'A';
  if (kind === 'jira' || spaceId === JIRA_TASK_SPACE_ID) return 'J';
  if (spaceId === ANALYZE_TASK_SPACE_ID) return 'T';
  if (kind === 'personal' || spaceId === PERSONAL_TASK_SPACE_ID) return 'P';
  return 'T';
}

function taskSpaceSummary(spaceId: string, count: number): string {
  if (spaceId === DAILY_VIEW_ID) return `${count} work items planned today`;
  if (spaceId === ALL_TASKS_SPACE_ID) return `${count} work items across spaces`;
  if (spaceId === JIRA_TASK_SPACE_ID) return `${count} Jira-backed work items`;
  if (spaceId === ANALYZE_TASK_SPACE_ID) return `${count} ticket analyze sessions`;
  if (spaceId === PERSONAL_TASK_SPACE_ID) return `${count} personal work items`;
  return `${count} work items`;
}

function defaultSpaceForCreate(selectedSpaceId: string): string {
  return selectedSpaceId && selectedSpaceId !== ALL_TASKS_SPACE_ID && selectedSpaceId !== DAILY_VIEW_ID ? selectedSpaceId : PERSONAL_TASK_SPACE_ID;
}

function defaultKindForSpace(spaceId: string): ProTask['kind'] {
  return spaceId === JIRA_TASK_SPACE_ID ? 'jira-ticket' : 'manual';
}

function taskDisplayKey(task: Pick<ProTask, 'jiraKey' | 'localKey'> | null | undefined): string {
  return task?.jiraKey || task?.localKey || '';
}

function jiraBrowseUrlForKey(value?: string | null): string {
  const key = value?.trim();
  return key ? `https://jira.ringcentral.com/browse/${encodeURIComponent(key)}` : '';
}

function jiraTaskUrl(task: Pick<ProTask, 'jiraKey' | 'jiraUrl'> | null | undefined): string {
  return task?.jiraUrl?.trim() || jiraBrowseUrlForKey(task?.jiraKey);
}

function assistantHasLabel(assistant: AgentAssistant, label: string): boolean {
  return (assistant.labels || []).some(item => item.toLowerCase() === label);
}

function isTaskAssistant(assistant: AgentAssistant): boolean {
  if (assistant.enabled === false) return false;
  if ((assistant.labels || []).length) return assistantHasLabel(assistant, 'task');
  return assistant.kind === 'task-stage' || (assistant.objectTypes || []).some(type => /(^|-)task$|jira-task/.test(type));
}

function taskAssistantOptions(assistants: AgentAssistant[], currentAssistantId?: string | null): AgentAssistant[] {
  const current = currentAssistantId?.trim();
  const options = assistants.filter(isTaskAssistant);
  if (current && !options.some(assistant => assistant.id === current)) {
    const selected = assistants.find(assistant => assistant.id === current);
    if (selected) options.unshift(selected);
  }
  return options;
}

type TaskMrLink = {
  url: string;
  label: string;
  source: 'saved' | 'ticket';
};

function normalizeMrUrl(url: string): string {
  return url
    .trim()
    .replace(/[)\].,;]+$/g, '')
    .replace(/\/(diffs?|commits?|pipelines?)$/i, '');
}

function mrLabelFromUrl(url: string, fallbackIndex: number): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const mrIndex = parts.findIndex(part => part === 'merge_requests' || part === 'pull' || part === 'pulls');
    if (mrIndex >= 0 && parts[mrIndex + 1]) {
      const repo = parts[mrIndex - 1] || parts[mrIndex - 2] || parsed.hostname;
      const marker = parts[mrIndex] === 'merge_requests' ? '!' : '#';
      return `${repo} ${marker}${parts[mrIndex + 1]}`;
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return `MR ${fallbackIndex}`;
  }
}

function taskMrLinks(task: ProTask): TaskMrLink[] {
  const links = new Map<string, TaskMrLink>();
  const add = (url: string, source: TaskMrLink['source']) => {
    const normalized = normalizeMrUrl(url);
    if (!/^https?:\/\//i.test(normalized) || links.has(normalized)) return;
    links.set(normalized, {
      url: normalized,
      label: mrLabelFromUrl(normalized, links.size + 1),
      source,
    });
  };
  if (task.prUrl) add(task.prUrl, 'saved');
  const rawText = [
    task.description || '',
    task.jiraFields?.raw ? JSON.stringify(task.jiraFields.raw) : '',
  ].join('\n');
  const urlPattern = /https?:\/\/[^\s<>"']+(?:\/-\/merge_requests\/\d+|\/merge_requests\/\d+|\/pull\/\d+|\/pulls\/\d+)[^\s<>"']*/gi;
  for (const match of rawText.matchAll(urlPattern)) add(match[0], 'ticket');
  return Array.from(links.values());
}

function TaskPrField({ task, onMetaChange }: { task: ProTask; onMetaChange: (task: ProTask, patch: TaskMetaPatch) => void }) {
  const [draft, setDraft] = useState(task.prUrl || '');
  const skipCommitRef = useRef(false);
  const mrLinks = taskMrLinks(task);
  const savedLink = mrLinks.find(link => link.source === 'saved');
  const ticketLinks = mrLinks.filter(link => link.source === 'ticket');

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
    <div className="min-w-0 space-y-1.5">
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
          placeholder={ticketLinks.length ? 'Add another MR / PR URL' : 'MR / PR URL'}
          className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-0 text-[12px] text-fg-3 outline-none transition placeholder:text-fg-5/60 hover:border-edge hover:bg-panel focus:border-primary/40 focus:px-2"
        />
        {savedLink && (
          <a
            href={savedLink.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-edge px-2 text-[11px] font-medium text-fg-4 transition hover:border-edge-h hover:bg-panel-h hover:text-fg"
          >
            Open
          </a>
        )}
      </div>
      {ticketLinks.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {ticketLinks.slice(0, 4).map(link => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              className="inline-flex h-6 max-w-full min-w-0 items-center rounded-md border border-primary/20 bg-primary/[0.06] px-2 text-[11px] font-medium text-primary transition hover:border-primary/35 hover:bg-primary/[0.1]"
            >
              <span className="truncate">{link.label}</span>
            </a>
          ))}
          {ticketLinks.length > 4 && (
            <span className="inline-flex h-6 items-center rounded-md border border-edge/60 bg-panel-alt px-2 text-[11px] text-fg-5">
              +{ticketLinks.length - 4}
            </span>
          )}
        </div>
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
  if (status === 'stopped') return 'muted';
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
  if (status === 'stopped') return 'Stopped';
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
  if (run.status === 'stopped') return 'Sync stopped';
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

function jiraProjectKeyFromIssueKey(value: string | undefined): string {
  const match = value?.match(/^([A-Z][A-Z0-9]+)-\d+$/i);
  return match?.[1] ? match[1].toUpperCase() : '';
}

function cleanTaskDescription(task: ProTask): string {
  const text = task.description?.trim() || '';
  const markerIndex = text.indexOf('[Jira remote sync]');
  return (markerIndex >= 0 ? text.slice(0, markerIndex) : text)
    .replace(/^\s*Description:\s*/i, '')
    .trim();
}

function plannedDateLabel(plannedDate: string | undefined, selectedDate: string): string {
  if (!plannedDate) return 'Unscheduled';
  if (plannedDate === selectedDate) return 'Today';
  return formatDateOnly(`${plannedDate}T00:00:00`);
}

function linkedTaskContextLines(task: ProTask | null | undefined): string[] {
  if (!task) return [];
  return [
    'Linked task context:',
    `- Title: ${task.title}`,
    task.jiraKey ? `- Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `- Description: ${taskBriefSummary(task) || task.description}` : '',
    `- Status: ${STATUS_LABEL[task.status]}`,
  ].filter(Boolean);
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
  if (raw.includes('todo')) return { label: 'Inbox', glyph: 'I', className: 'border-slate-500/35 bg-slate-500 text-white' };
  return { label: 'Work Item', glyph: 'W', className: 'border-blue-500/35 bg-blue-500 text-white' };
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

function AssistantInlinePicker({
  value,
  options,
  onChange,
  compact = false,
  showChevron = false,
}: {
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (assistantId: string) => void;
  compact?: boolean;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.id === value);
  const label = selected?.name || 'None';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={cn(
          'group/assignee inline-flex min-w-0 items-center rounded-md text-left text-fg-3 transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--th-selection-ring)]',
          compact ? 'max-w-full px-1 py-0.5 text-[12px]' : 'px-1.5 py-1 text-[12px]',
        )}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{label}</span>
        {showChevron && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('ml-1 shrink-0 text-fg-5 transition-transform group-hover/assignee:text-fg-3', open && 'rotate-180')}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-[80] w-[min(240px,calc(100vw-48px))] overflow-hidden rounded-xl border border-edge-h/70 bg-dropdown p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18),0_4px_12px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.03] backdrop-blur-md"
        >
          {[{ id: '', name: 'None' }, ...options].map(option => {
            const active = option.id === value;
            return (
              <button
                key={option.id || 'none'}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] transition-colors',
                  active ? 'bg-primary/[0.10] font-semibold text-primary' : 'text-fg-3 hover:bg-panel-h hover:text-fg',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-fg-5/35')} />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {active && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  selected,
  assistants,
  draggable,
  isDragging,
  scheduleLabel,
  primaryActionLabel,
  onSelect,
  onAssignAssistant,
  onPrimaryAction,
  onSchedule,
  onDragStart,
  onDragEnd,
}: {
  task: ProTask;
  selected: boolean;
  busyStage: ProTaskStage | null;
  assistants: AgentAssistant[];
  draggable?: boolean;
  isDragging?: boolean;
  scheduleLabel?: string;
  primaryActionLabel?: string;
  onSelect: (task: ProTask) => void;
  onAssignAssistant: (task: ProTask, assistantId: string) => void;
  onPrimaryAction?: (task: ProTask) => void;
  onSchedule?: (task: ProTask) => void;
  onDragStart?: (task: ProTask, event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const cardDescription = cleanTaskDescription(task);
  const assignedAssistantId = task.execution?.assistantId || task.defaultAssistantId || '';
  const assistantOptions = taskAssistantOptions(assistants, assignedAssistantId);
  const dueDate = task.jiraFields?.dueDate || jiraRemoteSyncField(task.description, 'Due date');
  const remoteStatus = taskRemoteStatus(task);
  const fixVersion = compactFixVersionLabel(task);
  const sprint = task.sprint?.split(/[,，;；\n]+/).map(item => item.trim()).filter(Boolean)[0] || '';
  const displayKey = taskDisplayKey(task);
  const metaItemClass = 'inline-flex min-w-0 max-w-[112px] shrink-0 items-center gap-1 text-[10px] leading-none text-fg-5';
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
      <div className="flex min-w-0 items-start gap-2">
        <TicketTypeIcon task={task} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-fg">
            {displayKey && <span className="font-mono text-[12px] text-primary">{displayKey} </span>}
            {task.title}
          </div>
        </div>
      </div>
      {cardDescription && <div className="mt-1.5 line-clamp-4 text-[12px] leading-relaxed text-fg-4">{cardDescription}</div>}
      <div
        className="mt-1.5 flex min-w-0 items-center gap-2"
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {dueDate && (
            <span className={metaItemClass} title={`Due ${dueDate}`}>
              Due {formatDateOnly(dueDate)}
            </span>
          )}
          {sprint && (
            <span className={metaItemClass} title={task.sprint}>
              <span className="truncate">Sprint {sprint}</span>
            </span>
          )}
          {fixVersion && (
            <span className={metaItemClass} title={jiraTaskFixVersions(task).join(', ')}>
              <span className="truncate">Fix {fixVersion}</span>
            </span>
          )}
          <span className={metaItemClass}>
            <span className="shrink-0">Assignee</span>
            <AssistantInlinePicker
              value={assignedAssistantId}
              options={assistantOptions}
              onChange={(assistantId) => onAssignAssistant(task, assistantId)}
              compact
            />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {remoteStatus && (
            <Badge variant={remoteStatusTone(remoteStatus)} className="h-4 max-w-[92px] shrink-0 px-1.5 text-[9.5px]" title={remoteStatus}>
              <span className="truncate">{remoteStatus}</span>
            </Badge>
          )}
          <span className="whitespace-nowrap text-[10px] leading-none text-fg-5">Created {formatTime(task.createdAt)}</span>
        </div>
      </div>
      {onSchedule && (
        <div
          className="mt-2 flex min-w-0 items-center justify-between gap-2"
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
        >
          <span className="truncate text-[10.5px] text-fg-5">{task.plannedDate ? `Planned ${plannedDateLabel(task.plannedDate, localDateInputValue())}` : 'Not planned for a day'}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {onPrimaryAction && (
              <Button variant="secondary" size="sm" className="h-6 px-2 text-[10.5px]" onClick={() => onPrimaryAction(task)}>
                {primaryActionLabel || 'Open'}
              </Button>
            )}
            <Button variant={task.plannedDate ? 'outline' : 'outline'} size="sm" className="h-6 shrink-0 px-2 text-[10.5px]" onClick={() => onSchedule(task)}>
              {scheduleLabel || 'Add to today'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function dailyTaskSourceLabel(task: ProTask, spaces: TaskSpace[]): string {
  const direct = task.spaceId ? spaces.find(space => space.id === task.spaceId) : null;
  if (direct?.name) return direct.name;
  if (task.spaceId === ANALYZE_TASK_SPACE_ID || task.origin?.type === 'jira-analyze') return 'Ticket Analyze';
  if (task.spaceId === JIRA_TASK_SPACE_ID || task.kind.startsWith('jira')) return 'Jira';
  if (task.spaceId === PERSONAL_TASK_SPACE_ID || task.origin?.type === 'manual') return 'Personal';
  return 'Task';
}

type SyncTicketProgress = {
  status: 'idle' | 'running' | 'completed' | 'failed';
  query?: string;
  issueKey?: string;
  action?: 'created' | 'updated';
  task?: ProTask;
  error?: string;
};

function dailyItemStatusTone(status: DailyItem['status']): 'ok' | 'warn' | 'muted' | 'accent' {
  if (status === 'task-created') return 'accent';
  if (status === 'done') return 'ok';
  if (status === 'archived') return 'muted';
  return 'warn';
}

function dailyItemStatusLabel(status: DailyItem['status']): string {
  if (status === 'task-created') return 'Task ready';
  if (status === 'done') return 'Done';
  if (status === 'archived') return 'Archived';
  return 'Action';
}

function dailyPrimaryLabel(task: ProTask): string {
  if (task.status === 'backlog') return 'Clarify';
  if (task.status === 'refinement') return 'Goal';
  if (task.status === 'coding') return 'Resume';
  if (task.status === 'resolved') return 'Mark done';
  return 'Open';
}

function jiraColumnForTask(task: ProTask): JiraColumnKey {
  if (task.status === 'done') return 'done';
  if (task.status === 'resolved') return 'review';
  const latest = task.stageRuns[0];
  if (latest?.status === 'failed' || latest?.status === 'cancelled') return 'working';
  if (task.status === 'coding') return 'working';
  if (task.status === 'refinement') return 'refinement';
  return 'backlog';
}

function DailyDateControls({
  selectedDate,
  onChange,
  compact = false,
}: {
  selectedDate: string;
  onChange: (date: string) => void;
  compact?: boolean;
}) {
  const baseDate = useMemo(() => {
    const parsed = new Date(`${selectedDate}T12:00:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }, [selectedDate]);
  const shift = (days: number) => {
    const next = new Date(baseDate);
    next.setDate(next.getDate() + days);
    onChange(localDateInputValue(next));
  };
  return (
    <div className={cn('flex flex-nowrap items-center gap-2', compact && 'gap-1.5')}>
      <Button variant="ghost" size="icon" className={cn('h-8 w-8 shrink-0', compact && 'h-7 w-7')} onClick={() => shift(-1)} title="Previous day" aria-label="Previous day">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </Button>
      <Button variant="secondary" size="sm" className={cn('h-8 shrink-0 px-2.5 text-[11px]', compact && 'h-7 px-2 text-[10.5px]')} onClick={() => onChange(localDateInputValue())}>Today</Button>
      <label
        className={cn(
          'relative inline-flex h-8 min-w-[58px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-control-border bg-control px-2.5 text-[12px] font-medium text-fg transition-colors hover:border-control-border-h focus-within:border-primary/50',
          compact && 'h-7 min-w-[50px] px-2 text-[11px]',
        )}
        title={selectedDate.replace(/-/g, '/')}
      >
        <span aria-hidden="true">{formatMonthDay(selectedDate)}</span>
        <input
          type="date"
          value={selectedDate}
          onChange={event => onChange(event.target.value || localDateInputValue())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Select date"
        />
      </label>
      <Button variant="ghost" size="icon" className={cn('h-8 w-8 shrink-0', compact && 'h-7 w-7')} onClick={() => shift(1)} title="Next day" aria-label="Next day">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Button>
    </div>
  );
}

function DailyPlannerSidebar({
  selectedDate,
  items,
  tasks,
  onDateChange,
  onOpenManager,
  onPromoteItem,
  onOpenTask,
  onUpdateItem,
  onDeleteItem,
  onReorderItems,
}: {
  selectedDate: string;
  items: DailyItem[];
  tasks: ProTask[];
  onDateChange: (date: string) => void;
  onOpenManager: () => void;
  onPromoteItem: (item: DailyItem) => void;
  onOpenTask: (item: DailyItem) => void;
  onUpdateItem: (itemId: string, title: string) => void;
  onDeleteItem: (itemId: string) => void;
  onReorderItems: (itemIds: string[]) => void;
}) {
  const [editingTitles, setEditingTitles] = useState<Record<string, string>>({});
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const itemInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const commitTitle = (item: DailyItem) => {
    const nextTitle = (editingTitles[item.id] ?? item.title).trim();
    if (!nextTitle || nextTitle === item.title) return;
    onUpdateItem(item.id, nextTitle);
  };
  const focusItemTitle = (item: DailyItem) => {
    setEditingTitles(prev => ({ ...prev, [item.id]: prev[item.id] ?? item.title }));
    window.setTimeout(() => {
      itemInputRefs.current[item.id]?.focus();
      itemInputRefs.current[item.id]?.select();
    }, 0);
  };

  return (
    <aside className="panel-isolated hidden h-full w-[320px] max-w-[calc(100vw-16px)] shrink-0 overflow-hidden rounded-xl border border-edge/70 bg-panel/96 shadow-[var(--th-card-shadow)] backdrop-blur-md md:flex md:min-h-0 md:flex-col">
      <div className="shrink-0 border-b border-edge/40 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DailyDateControls selectedDate={selectedDate} onChange={onDateChange} compact />
          </div>
          <Button variant="primary" size="icon" className="h-8 w-8 shrink-0" onClick={onOpenManager} title="Capture planned item" aria-label="Capture planned item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Button>
          <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{items.length}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-edge/45 bg-inset/25 px-3 py-5 text-[11px] text-fg-5">
            No planned work for this day yet.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => {
              const task = item.taskId ? tasks.find(candidate => candidate.id === item.taskId) : null;
              const taskKey = item.taskKey || taskDisplayKey(task);
              const editable = !item.taskId;
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggingItemId(item.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={() => {
                    if (!draggingItemId || draggingItemId === item.id) return;
                    const order = items.map(entry => entry.id);
                    const from = order.indexOf(draggingItemId);
                    const to = order.indexOf(item.id);
                    if (from < 0 || to < 0) return;
                    const next = order.slice();
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    onReorderItems(next);
                    setDraggingItemId(null);
                  }}
                  onDragEnd={() => setDraggingItemId(null)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2.5 transition',
                    item.taskId ? 'border-primary/30 bg-primary/[0.06]' : 'border-edge/55 bg-panel-alt/35 hover:border-edge-h hover:bg-panel-h',
                    draggingItemId === item.id && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md border border-edge/60 bg-inset text-[11px] font-semibold tabular-nums text-fg-4 transition hover:border-primary/35 hover:text-primary active:cursor-grabbing"
                      title="Drag to reorder priority"
                      aria-label="Drag to reorder priority"
                    >
                      {index + 1}
                    </button>
                    <div className="min-w-0 flex-1">
                      <input
                        value={editingTitles[item.id] ?? item.title}
                        onChange={event => {
                          if (!editable) return;
                          setEditingTitles(prev => ({ ...prev, [item.id]: event.target.value }));
                        }}
                        onBlur={() => editable && commitTitle(item)}
                        onKeyDown={event => {
                          if (editable && event.key === 'Enter') {
                            event.preventDefault();
                            commitTitle(item);
                            event.currentTarget.blur();
                          }
                        }}
                        ref={node => {
                          itemInputRefs.current[item.id] = node;
                        }}
                        disabled={!editable}
                        className={cn(
                          'w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-semibold leading-snug text-fg-2 outline-none transition focus:border-control-border focus:bg-control',
                          !editable && 'cursor-default text-fg-3 disabled:opacity-100',
                        )}
                        aria-label={editable ? 'Edit planned item' : 'Planned item title'}
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-5">
                      <Badge variant={dailyItemStatusTone(item.status)}>{dailyItemStatusLabel(item.status)}</Badge>
                      <span>{formatHourMinute(item.createdAt || item.updatedAt)}</span>
                      {taskKey && <span className="font-mono font-semibold text-primary">{taskKey}</span>}
                      {item.sourceTodoId && <span>Inbox</span>}
                      {item.sourceTaskId && <span>Work Item</span>}
                      {item.relatedTaskId && <span>Linked</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => item.taskId ? onOpenTask(item) : onPromoteItem(item)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-primary"
                        title={item.taskId ? 'Open Work Item' : 'Create Work Item'}
                        aria-label={item.taskId ? 'Open Work Item' : 'Create Work Item'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          {item.taskId ? <path d="M15 3h6v6" /> : <path d="M5 12h14M12 5l7 7-7 7" />}
                          {item.taskId ? <path d="M10 14 21 3" /> : null}
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuItemId(current => current === item.id ? null : item.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-panel-h hover:text-fg-3"
                        title="More actions"
                        aria-label="More actions"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
                        </svg>
                      </button>
                      <div className="relative">
                        {menuItemId === item.id && (
                          <div className="absolute right-0 top-8 z-40 w-40 overflow-hidden rounded-lg border border-edge bg-panel py-1 text-[11px] shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
                            {editable && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuItemId(null);
                                  focusItemTitle(item);
                                }}
                                className="flex w-full items-center px-3 py-2 text-left text-fg-3 transition hover:bg-panel-h"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMenuItemId(null);
                                onDeleteItem(item.id);
                              }}
                              className="flex w-full items-center px-3 py-2 text-left text-err transition hover:bg-err/[0.08]"
                            >
                              Delete planned item
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function jiraStatusForColumn(column: JiraColumnKey): ProTaskStatus {
  if (column === 'refinement') return 'refinement';
  if (column === 'working') return 'coding';
  if (column === 'review') return 'resolved';
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
  if (status === 'resolved') return 'verification';
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
  title = 'Create Work Item',
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

  const assistantOptions = useMemo(() => taskAssistantOptions(assistants, draft.defaultAssistantId), [assistants, draft.defaultAssistantId]);
  const assistantLabel = assistants.find(assistant => assistant.id === draft.defaultAssistantId)?.name || 'None';
  const workspaceLabel = workspaces.find(workspace => workspace.path === draft.workdir)?.name || workspaceShortLabel(draft.workdir) || 'Workspace';
  const canCreate = !!(draft.title.trim() || draft.description.trim()) && !creating;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title={title}
        description="Describe the work. Title is optional; Pikiclaw can create one from the description."
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Work Item fields</div>
            <div className="max-w-[220px] truncate text-[11px] text-fg-5">{assistantLabel} · {workspaceLabel}</div>
          </div>
          <label className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg-2">Assign</div>
              <div className="text-[11px] text-fg-5">Optional owner for the first pass</div>
            </div>
            <select value={draft.defaultAssistantId} onChange={event => setDraft(prev => ({ ...prev, defaultAssistantId: event.target.value }))} className="h-8 w-[210px] max-w-[54%] rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">None</option>
              {assistantOptions.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
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

function DailyIntakeModal({
  open,
  creating,
  selectedDate,
  value,
  items,
  onChange,
  onCreateOne,
  onUpdateItem,
  onDeleteItem,
  onReorderItems,
  onClose,
}: {
  open: boolean;
  creating: boolean;
  selectedDate: string;
  value: string;
  items: DailyItem[];
  onChange: (value: string) => void;
  onCreateOne: () => void;
  onUpdateItem: (itemId: string, title: string) => void;
  onDeleteItem: (itemId: string) => void;
  onReorderItems: (itemIds: string[]) => void;
  onClose: () => void;
}) {
  const [editingTitles, setEditingTitles] = useState<Record<string, string>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const itemInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!open) {
      setEditingTitles({});
      setDraggingItemId(null);
    }
  }, [open]);

  const commitTitle = (item: DailyItem) => {
    const nextTitle = (editingTitles[item.id] ?? item.title).trim();
    if (!nextTitle || nextTitle === item.title) return;
    onUpdateItem(item.id, nextTitle);
  };

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={`Work Plan · ${selectedDate.replace(/-/g, '/')}`}
        description="Capture planned items for the day, order them by priority, and promote execution-ready items into Work Items."
        onClose={onClose}
      />
      <div className="space-y-4" data-testid="work-plan-modal">
        <div className="flex items-center gap-2">
          <Input
          autoFocus
          value={value}
          onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCreateOne();
              }
            }}
            placeholder="Capture a planned item"
            className="flex-1"
          />
          <Button variant="primary" disabled={creating || !value.trim()} onClick={onCreateOne}>
            {creating ? <Spinner /> : null}
            Capture
          </Button>
        </div>
        <div className="rounded-xl border border-edge/55 bg-panel-alt/35">
          <div className="border-b border-edge/40 px-3 py-2 text-[11px] font-medium text-fg-5">
            Planned items
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge/45 bg-inset/25 px-3 py-5 text-[11px] text-fg-5">
                No planned work for this day yet.
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, index) => {
                  const editable = !item.taskId;
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDraggingItemId(item.id)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={() => {
                        if (!draggingItemId || draggingItemId === item.id) return;
                        const order = items.map(entry => entry.id);
                        const from = order.indexOf(draggingItemId);
                        const to = order.indexOf(item.id);
                        if (from < 0 || to < 0) return;
                        const next = order.slice();
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        onReorderItems(next);
                        setDraggingItemId(null);
                      }}
                      onDragEnd={() => setDraggingItemId(null)}
                      className={cn(
                        'rounded-lg border border-edge/50 bg-panel/80 px-2.5 py-2 transition',
                        draggingItemId === item.id && 'opacity-60',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md border border-edge/60 bg-inset text-[11px] font-semibold tabular-nums text-fg-4 transition hover:border-primary/35 hover:text-primary active:cursor-grabbing"
                          title="Drag to reorder priority"
                          aria-label="Drag to reorder priority"
                        >
                          {index + 1}
                        </button>
                        <input
                          value={editingTitles[item.id] ?? item.title}
                          onChange={event => {
                            if (!editable) return;
                            setEditingTitles(prev => ({ ...prev, [item.id]: event.target.value }));
                          }}
                          onBlur={() => editable && commitTitle(item)}
                          onKeyDown={event => {
                            if (editable && event.key === 'Enter') {
                              event.preventDefault();
                              commitTitle(item);
                              (event.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                          ref={node => {
                            itemInputRefs.current[item.id] = node;
                          }}
                          disabled={!editable}
                          className={cn(
                            'min-w-0 flex-1 border-0 bg-transparent text-[12px] font-medium text-fg-2 outline-none',
                            !editable && 'cursor-default text-fg-3 disabled:opacity-100',
                          )}
                        />
                        <Badge variant={dailyItemStatusTone(item.status)}>{dailyItemStatusLabel(item.status)}</Badge>
                        {item.taskKey && <span className="font-mono text-[10px] font-semibold text-primary">{item.taskKey}</span>}
                        <span className="text-[10px] text-fg-5">{formatHourMinute(item.createdAt || item.updatedAt)}</span>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[10.5px]"
                            onClick={() => {
                              setEditingTitles(prev => ({ ...prev, [item.id]: prev[item.id] ?? item.title }));
                              window.setTimeout(() => {
                                itemInputRefs.current[item.id]?.focus();
                                itemInputRefs.current[item.id]?.select();
                              }, 0);
                            }}
                            title="Edit planned item"
                          >
                            Edit
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--th-danger,#b91c1c)]" onClick={() => onDeleteItem(item.id)} title="Delete planned item">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={creating}>Done</Button>
      </div>
    </Modal>
  );
}

function DailySourcePickerModal({
  open,
  todoItems,
  tasks,
  taskSpaces,
  selectedDate,
  onClose,
  onAddTodo,
  onAddTask,
}: {
  open: boolean;
  todoItems: TodoItem[];
  tasks: ProTask[];
  taskSpaces: TaskSpace[];
  selectedDate: string;
  onClose: () => void;
  onAddTodo: (item: TodoItem) => void;
  onAddTask: (task: ProTask) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title="Plan today"
        description={`Choose inbox items or existing Work Items to place on the ${formatDateOnly(`${selectedDate}T00:00:00`)} Work Plan.`}
        onClose={onClose}
      />
      <div className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-fg-2">Inbox items</div>
              <div className="text-[11px] text-fg-5">Planning an inbox item creates a Work Item and places it on today's plan.</div>
            </div>
            <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{todoItems.length}</Badge>
          </div>
          <div className="space-y-2">
            {todoItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge/45 bg-inset/25 px-3 py-4 text-[11px] text-fg-5">No open inbox items match the current filter.</div>
            ) : (
              todoItems.map(item => (
                <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-edge/60 bg-panel-alt/45 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-fg-2">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-[10.5px] text-fg-5">{item.body || item.source?.quote || 'Inbox item'}</div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onAddTodo(item)}>
                    Plan today
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-fg-2">Existing Work Items</div>
              <div className="text-[11px] text-fg-5">Personal, Jira, and custom Work Items keep their source space and are scheduled into today's plan.</div>
            </div>
            <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{tasks.length}</Badge>
          </div>
          <div className="space-y-2">
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge/45 bg-inset/25 px-3 py-4 text-[11px] text-fg-5">No existing Work Items match the current filter.</div>
            ) : (
              tasks.map(task => (
                <div key={task.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-edge/60 bg-panel-alt/45 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-fg-2">
                      {taskDisplayKey(task) ? `${taskDisplayKey(task)} · ` : ''}{task.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-fg-5">
                      <span>{dailyTaskSourceLabel(task, taskSpaces)}</span>
                      <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[displayTaskStatus(task.status)]}</Badge>
                      {task.plannedDate && <span>{plannedDateLabel(task.plannedDate, selectedDate)}</span>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onAddTask(task)}>
                    Plan today
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function TodoQuickAddModal({
  open,
  saving,
  value,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Capture inbox item" description="Capture a quick item from the page you're on right now." onClose={onClose} />
      <div className="space-y-3">
        <textarea
          autoFocus
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave();
            }
          }}
          placeholder="Capture a quick follow-up, idea, or work item..."
          className="min-h-28 w-full resize-y rounded-lg border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/60 focus:border-control-border-h focus:ring-2 focus:ring-[color:var(--th-selection-ring)]"
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={saving || !value.trim()}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </Modal>
  );
}

function AnalyzeTicketPromptModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useStore(s => s.toast);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open) return undefined;
    setLoading(true);
    void api.getAnalyzeTicketPrompt()
      .then(res => {
        if (cancelled) return;
        if (!res.ok) throw new Error(res.error || 'Failed to load prompt');
        setPrompt(res.prompt || '');
        setDefaultPrompt(res.defaultPrompt || '');
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Failed to load prompt', false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, toast]);

  const save = async () => {
    if (!prompt.trim() || saving) return;
    setSaving(true);
    try {
      const res = await api.updateAnalyzeTicketPrompt({ prompt });
      if (!res.ok) throw new Error(res.error || 'Failed to save prompt');
      setPrompt(res.prompt || prompt);
      setDefaultPrompt(res.defaultPrompt || defaultPrompt);
      toast('Analyze prompt saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save prompt', false);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.resetAnalyzeTicketPrompt();
      if (!res.ok) throw new Error(res.error || 'Failed to reset prompt');
      setPrompt(res.prompt || '');
      setDefaultPrompt(res.defaultPrompt || '');
      toast('Analyze prompt reset');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset prompt', false);
    } finally {
      setSaving(false);
    }
  };

  const changed = prompt.trim() !== defaultPrompt.trim();

  return (
    <Modal open={open} onClose={onClose} wide panelClassName="max-w-3xl">
      <ModalHeader title="Analyze ticket prompt" onClose={onClose} />
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-fg-5">
          Use <code className="rounded bg-inset px-1 py-0.5 text-[11px]">{'{{ticket_query}}'}</code> where the pasted ticket link or key should appear.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-fg-5"><Spinner /> Loading prompt...</div>
        ) : (
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            className="min-h-[360px] w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 font-mono text-[12px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-fg-5">{changed ? 'Custom prompt' : 'Using default prompt'}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={saving || loading} onClick={() => { void reset(); }}>Reset</Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Close</Button>
            <Button type="button" variant="primary" disabled={!prompt.trim() || saving || loading} onClick={() => { void save(); }}>
              {saving ? <Spinner /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AnalyzeJiraTicketModal({
  open,
  initialQuery,
  busy,
  onClose,
  onAnalyze,
  onOpenPrompt,
}: {
  open: boolean;
  initialQuery: string;
  busy?: boolean;
  onClose: () => void;
  onAnalyze: (draft: { query: string }) => void;
  onOpenPrompt: () => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
  }, [initialQuery, open]);

  const submit = () => {
    if (!query.trim() || busy) return;
    onAnalyze({ query: query.trim() });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Analyze ticket" onClose={onClose} />
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Paste Jira link, key, or ticket number"
          className="min-h-[110px] w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
        <p className="text-[11px] leading-relaxed text-fg-5">
          Workspace and agent are chosen automatically from the ticket. Analysis is stored under the Ticket Analyze space.
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onOpenPrompt}>View prompt</Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!query.trim() || busy}>
              {busy ? <Spinner /> : null}
              Analyze
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function SyncJiraTicketModal({
  open,
  initialQuery,
  busy,
  progress,
  onClose,
  onSync,
  onOpenTask,
}: {
  open: boolean;
  initialQuery: string;
  busy?: boolean;
  progress: SyncTicketProgress;
  onClose: () => void;
  onSync: (draft: { query: string }) => void;
  onOpenTask: (task: ProTask) => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
  }, [initialQuery, open]);

  const submit = () => {
    if (!query.trim() || busy) return;
    onSync({
      query: query.trim(),
    });
  };
  const stepDetails = [
    {
      label: 'Retrieving ticket from remote',
      detail: progress.status === 'running' ? (progress.query || query.trim()) : progress.issueKey || progress.query || query.trim(),
    },
    {
      label: 'Ticket found',
      detail: progress.status === 'completed' ? progress.issueKey || taskDisplayKey(progress.task) : undefined,
    },
    {
      label: 'Starting sync',
      detail: progress.status === 'completed' ? 'Jira fields are ready to apply' : undefined,
    },
    {
      label: 'Checking local task',
      detail: progress.status === 'completed'
        ? progress.action === 'updated' ? 'Existing task found' : 'No existing task found'
        : undefined,
    },
    {
      label: progress.status === 'completed' && progress.action === 'updated' ? 'Applying incremental update' : 'Creating new task',
      detail: progress.status === 'completed'
        ? progress.action === 'updated' ? 'Updated changed fields' : 'Created in Jira space'
        : undefined,
    },
    {
      label: 'Sync completed',
      detail: progress.status === 'completed' ? progress.issueKey || taskDisplayKey(progress.task) : undefined,
    },
  ];
  const statusForStep = (index: number): 'done' | 'active' | 'pending' | 'failed' => {
    if (progress.status === 'completed') return 'done';
    if (progress.status === 'failed') return index === 0 ? 'failed' : 'pending';
    if (progress.status === 'running') return index === 0 ? 'active' : 'pending';
    return 'pending';
  };
  const hasProgress = progress.status !== 'idle';

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Sync ticket" onClose={onClose} />
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Paste Jira link, key, or ticket number"
          className="min-h-[96px] w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
        {hasProgress && (
          <div className="rounded-lg border border-edge/60 bg-panel-alt/50 px-3 py-3">
            <div className="space-y-2">
              {stepDetails.map((step, index) => {
                const status = statusForStep(index);
                return (
                  <div key={step.label} className="flex min-w-0 items-start gap-2">
                    <span className={cn(
                      'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold',
                      status === 'done' && 'border-ok/45 bg-ok/12 text-ok',
                      status === 'active' && 'border-primary/45 bg-primary/12 text-primary',
                      status === 'failed' && 'border-warn/45 bg-warn/12 text-warn',
                      status === 'pending' && 'border-edge bg-inset text-fg-5',
                    )}>
                      {status === 'done' ? '✓' : status === 'active' ? <Spinner /> : status === 'failed' ? '!' : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cn(
                        'text-[12px] font-medium',
                        status === 'pending' ? 'text-fg-5' : 'text-fg-2',
                      )}>
                        {step.label}
                      </div>
                      {step.detail && <div className="mt-0.5 truncate text-[10.5px] text-fg-5">{step.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {progress.status === 'completed' && progress.task && (
              <div className="mt-3 flex min-w-0 items-center justify-between gap-3 rounded-md border border-ok/25 bg-ok/[0.06] px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => onOpenTask(progress.task!)}
                  className="min-w-0 truncate text-left font-mono text-[12px] font-semibold text-primary hover:underline"
                >
                  {progress.issueKey || taskDisplayKey(progress.task)}
                </button>
                <Badge variant="ok">{progress.action === 'created' ? 'created' : 'updated'}</Badge>
              </div>
            )}
            {progress.status === 'failed' && progress.error && (
              <div className="mt-3 rounded-md border border-warn/30 bg-warn/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-warn">
                {progress.error}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {progress.status === 'completed' ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" variant="primary" disabled={!query.trim() || busy}>
            {busy ? <Spinner /> : null}
            Sync
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TodoListModal({
  open,
  items,
  creating,
  selectedDailyDate,
  onClose,
  onCreateTodo,
  onCreateChat,
  onCreateTask,
  onCreateDaily,
}: {
  open: boolean;
  items: TodoItem[];
  creating: boolean;
  selectedDailyDate: string;
  onClose: () => void;
  onCreateTodo: () => void;
  onCreateChat: (item: TodoItem) => void;
  onCreateTask: (item: TodoItem) => void;
  onCreateDaily: (item: TodoItem) => void;
}) {
  const visibleItems = orderTodoItems(items.filter(item => item.status !== 'archived'));
  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title="Inbox items"
        description={`Turn captures into Work Items first; start a chat or plan for ${formatDateOnly(`${selectedDailyDate}T00:00:00`)} when needed.`}
        onClose={onClose}
      />
      <div className="space-y-4" data-testid="jira-inbox-items-modal">
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onCreateTodo} data-testid="jira-inbox-capture">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Capture inbox item
          </Button>
        </div>
        <div className="space-y-2">
          {visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge/45 px-4 py-12 text-center text-[13px] text-fg-5">No inbox items yet.</div>
          ) : visibleItems.map(item => {
            const body = item.body && item.body !== item.title ? item.body : item.source?.quote || '';
            const completed = item.status !== 'open';
            return (
              <div key={item.id} className={cn('rounded-lg border px-3 py-2.5', completed ? 'border-edge/35 bg-panel-alt/30 opacity-70' : 'border-edge/45 bg-panel-alt/55')}>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge/45 bg-panel-alt text-fg-4">
                    <TodoGlyph className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="rounded-md border border-edge/60 bg-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-5">Inbox item</span>
                      {completed && <span className="rounded-md border border-edge/60 bg-inset px-1.5 py-0.5 text-[10px] text-fg-5">closed</span>}
                    </div>
                    <div className={cn('text-[13px] font-medium text-fg-3', completed && 'line-through text-fg-5')}>{item.title}</div>
                    {body && <div className="mt-1 line-clamp-2 text-[11px] text-fg-5">{body}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <Button variant="primary" size="sm" className="h-7 px-2 text-[11px]" disabled={creating || completed} onClick={() => onCreateTask(item)} data-testid="jira-inbox-create-work-item">Create Work Item</Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={creating || completed} onClick={() => onCreateChat(item)} data-testid="jira-inbox-start-chat">Start Chat</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={creating || completed} onClick={() => onCreateDaily(item)} data-testid="jira-inbox-plan-today">Plan today</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
    { id: ALL_TASKS_SPACE_ID, name: 'All Work Items', kind: 'custom' as const },
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
            title="Hide work spaces"
            aria-label="Hide work spaces"
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
              placeholder="Search work items"
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
            title="Create work space"
            aria-label="Create work space"
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
  const assistantOptions = useMemo(() => taskAssistantOptions(assistants, draft.defaultAssistantId), [assistants, draft.defaultAssistantId]);

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
      <ModalHeader title="Create work space" description="Use a work space for personal Work Items, project queues, or writing pipelines." onClose={onClose} />
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
              {['codex', 'claude', 'copilot', 'cursor', 'agy', 'gemini', 'hermes'].map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Default assistant</div>
            <select value={draft.defaultAssistantId} onChange={event => setDraft(prev => ({ ...prev, defaultAssistantId: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">Runtime default</option>
              {assistantOptions.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
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
    refinement: { assistantId: 'assistant_refinement', instruction: 'Explain what the Jira task is, what needs to be done, retrieve relevant local/context material, state your understanding, open questions, risks, acceptance criteria, and a recommended plan. Do not code until the user confirms the goal and plan.' },
    coding: { assistantId: 'assistant_coding', instruction: 'Implement only after the confirmed Goal & Plan. Keep changes minimal, inspect relevant code paths first, summarize changed files, why each change was made, verification run, and remaining risk. Stop in Review; do not commit, create an MR, update Jira remotely, or mark Done until user approval.' },
    resolved: { assistantId: 'assistant_coding', instruction: 'Review the implementation with the user. Compare against the confirmed Goal & Plan, explain changed files and tradeoffs, collect user approval, and prepare the Verification plan. Do not write Jira remotely or submit an MR without explicit confirmation.' },
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
  const phaseLine = status === 'refinement'
    ? 'Phase guard: clarify and plan first. Explain the task, retrieve relevant context, list open questions, and wait for user confirmation before coding.'
    : status === 'coding'
      ? 'Phase guard: code only against the confirmed plan. After implementation, stop for user review before commit, MR, pipeline tracking, Done, or Jira write-back.'
      : status === 'resolved'
        ? 'Phase guard: review with the user. Prepare verification and follow-up actions, but do not submit remote changes until explicitly approved.'
        : status === 'done'
          ? 'Phase guard: summarize final outcome, verification evidence, and any Jira write-back/MR status that was already confirmed.'
          : 'Phase guard: identify the useful next task stage and ask for confirmation if scope is unclear.';
  return [
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
    '',
    `Open the ${STATUS_LABEL[status]} chat thread for this ticket.`,
    modeLine,
    phaseLine,
    instruction ? `Status instruction:\n${instruction}` : '',
    userPrompt?.trim()
      ? `User question:\n${userPrompt.trim()}`
      : 'Start with a concise understanding of the ticket and what you can help with in this status.',
  ].filter(Boolean).join('\n');
}

function buildTaskReferenceContext(task: ProTask): string {
  const fields = task.jiraFields || {};
  const description = cleanTaskDescription(task);
  const fixVersions = jiraTaskFixVersions(task);
  const labels = fields.labels || [];
  const latestRuns = [...(task.stageRuns || [])]
    .sort((a, b) => Date.parse(b.startedAt || b.completedAt || '') - Date.parse(a.startedAt || a.completedAt || ''))
    .slice(0, 3);
  const runLines = latestRuns.map(run => [
    `- ${STAGE_LABEL[run.stage]}: ${run.status}`,
    run.output?.summary ? `; summary: ${run.output.summary}` : '',
  ].join(''));

  return [
    'Current Pikiclaw task context. Use this as the authoritative ticket/task background for the user message below.',
    `Title: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    fields.issueType || task.kind ? `Type: ${fields.issueType || task.kind}` : '',
    `Pikiclaw status: ${STATUS_LABEL[task.status]}`,
    fields.status || jiraRemoteSyncField(task.description, 'Status') ? `Jira status: ${fields.status || jiraRemoteSyncField(task.description, 'Status')}` : '',
    task.sprint ? `Sprint: ${task.sprint}` : '',
    fixVersions.length ? `Fix version: ${fixVersions.join(', ')}` : '',
    fields.assignee || jiraRemoteSyncField(task.description, 'Assignee') ? `Assignee: ${fields.assignee || jiraRemoteSyncField(task.description, 'Assignee')}` : '',
    fields.reporter || jiraRemoteSyncField(task.description, 'Reporter') ? `Reporter: ${fields.reporter || jiraRemoteSyncField(task.description, 'Reporter')}` : '',
    fields.priority || jiraRemoteSyncField(task.description, 'Priority') ? `Priority: ${fields.priority || jiraRemoteSyncField(task.description, 'Priority')}` : '',
    fields.dueDate || jiraRemoteSyncField(task.description, 'Due date') ? `Due date: ${fields.dueDate || jiraRemoteSyncField(task.description, 'Due date')}` : '',
    fields.updatedAt || jiraRemoteSyncField(task.description, 'Updated') ? `Updated: ${fields.updatedAt || jiraRemoteSyncField(task.description, 'Updated')}` : '',
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    description ? `Description:\n${description}` : '',
    task.subTasks?.length
      ? `Subtasks:\n${task.subTasks.map((subtask, index) => `${index + 1}. [${subtask.status}] ${subtask.title}`).join('\n')}`
      : '',
    runLines.length ? `Recent stage runs:\n${runLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

const TASK_OUTPUT_LANGUAGE_PROMPT = 'Output artifact language: 阶段产出的 wiki/document/report 默认使用中文；除非用户明确要求其他语言。普通 chat 回复可自然跟随用户语言。代码标识符、文件路径、接口名、错误信息、MR/Jira 标题等保持原文。';
const TASK_STAGE_DRAFT_PROMPT = 'Stage output rule: 当前阶段产出的 wiki/document/report 先作为 draft。后续 chat 应围绕这个 draft 回答问题和修订内容；不要把 draft 当作最终产物。只有用户点击 Confirm output 后，Pikiclaw 才会把它保存为该阶段正式 output 并显示在侧边栏。';
const TASK_DYNAMIC_WORKFLOW_PROMPT = 'Workflow rule: 不要假设所有 ticket 都有固定的 Background → Clarification → Coding → Test 流程。请根据 ticket 类型、描述、用户当前 prompt、已有输出和最近阶段结果，动态判断下一步最合适的 phase，并在阶段完成后主动给出下一步选择，例如继续讨论问题、确认当前 draft 为正式 output、进入下一 phase、跳过不需要的 phase，或补充测试/证据。';

function buildTicketChatContext(task: ProTask, status: ProTaskStatus, workflowInstruction?: string, jiraAssistantPrompt?: string | null): string {
  return [
    buildTaskReferenceContext(task),
    `Current ticket chat lane: ${STATUS_LABEL[status]}`,
    TASK_OUTPUT_LANGUAGE_PROMPT,
    TASK_STAGE_DRAFT_PROMPT,
    TASK_DYNAMIC_WORKFLOW_PROMPT,
    jiraAssistantPrompt?.trim()
      ? `Jira Assistant prompt:\n${jiraAssistantPrompt.trim()}`
      : '',
    workflowInstruction?.trim()
      ? `Status workflow prompt:\n${workflowInstruction.trim()}`
      : '',
    'Conversation rule: The user message below is about this ticket unless the user explicitly says otherwise. Do not ask the user to provide the ticket key, ticket URL, title, or description when this context already contains it.',
  ].filter(Boolean).join('\n\n');
}

function buildTicketReferenceEnvelope(context: string): string {
  const trimmed = context.trim();
  if (!trimmed) return '';
  const safe = trimmed.replace(/<\/pikiclaw_context>/gi, '</pikiclaw-context>');
  return [
    '<pikiclaw_context type="jira-ticket">',
    safe,
    '</pikiclaw_context>',
    '[Jira ticket context above was attached by Pikiclaw. Use it as the authoritative task background for the user message below; do not repeat it unless useful.]',
  ].join('\n');
}

function buildTicketChatPrompt(
  task: ProTask,
  status: ProTaskStatus,
  userPrompt?: string,
  workflowInstruction?: string,
  executionMode: 'direct' | 'interactive' = 'interactive',
  jiraAssistantPrompt?: string | null,
): string {
  return [
    buildTicketReferenceEnvelope(buildTicketChatContext(task, status, workflowInstruction, jiraAssistantPrompt)),
    buildStatusChatPrompt(task, status, userPrompt, workflowInstruction, executionMode),
  ].filter(Boolean).join('\n\n');
}

const ANALYZE_TICKET_PROMPT = [
  'Analyze this ticket before coding.',
  'Explain what the task is and what needs to be done.',
  'Inspect relevant local context, previous outputs, linked task context, and likely code/documentation areas.',
  'Return a concise Goal & Plan artifact with: goal, scope, assumptions, open questions, likely files, risks, acceptance criteria, and verification steps.',
  'Do not start coding yet. End by asking the user to confirm the goal and plan.',
].join(' ');

const DAILY_CLARIFY_PROMPT = [
  'This is a Daily work item that starts as a short sentence and needs clarification before execution.',
  'First clarify with the user: what needs to be done, what outcome is expected, what constraints or acceptance points matter, and whether there is an existing Jira ticket or Pikiclaw task that should be linked.',
  'Do not start implementation yet.',
  'End with a concise Goal artifact that captures the clarified objective, scope, expected output, and any related ticket/task references.',
].join(' ');

const DAILY_WORKING_PROMPT = [
  'Use the clarified Goal and any linked context as the execution contract for this Daily work item.',
  'Complete the implementation work, then summarize the conclusion, changed files, and concrete output.',
].join(' ');

const DAILY_REVIEW_PROMPT = [
  'Review this Daily work item against the clarified Goal and the implementation output.',
  'Check whether the expected output is met, call out any remaining risk or follow-up, and conclude whether this item is ready to mark done.',
].join(' ');

const REVISE_PLAN_PROMPT = [
  'Revise the Goal & Plan using the latest chat context.',
  'Keep it concise and actionable, and call out anything still unclear before coding.',
].join(' ');

const START_CODING_PROMPT = [
  'Start coding this ticket based on the agreed Goal & Plan.',
  'Keep changes minimal, inspect the relevant code paths first, and summarize what changed, why, changed files, verification result, and remaining risk when done.',
  'Stop in Review after coding. Do not commit, create an MR, update Jira remotely, or mark Done until the user approves.',
].join(' ');

const REVIEW_TICKET_PROMPT = [
  'Review the implementation against the agreed Goal & Plan.',
  'Summarize what changed, why it changed, which files matter, what was verified, and any remaining risk.',
  'Do not commit, create an MR, update Jira remotely, or mark the task done until the user approves the review.',
].join(' ');

const IMPROVE_TICKET_BACKGROUND_PROMPT = [
  '[pikiclaw-ticket-background]',
  '请帮我修订这个 ticket 的 Background，目标是形成“我自己的理解版本”。',
  '重点回答：这个 ticket 要我干嘛、为什么要做、需要做什么、可能要改哪些代码/配置/接口、验收点是什么、还有哪些不确定。',
  '请输出 Markdown，使用这些标题：我的理解、这个 ticket 要我干嘛、可能需要修改哪里、验收点、仍不确定。',
  '不要开始编码；如果需要看代码，可以先检索和说明依据，然后给出可保存到 Background 的版本。',
].join(' ');

const CREATE_TICKET_BACKGROUND_PROMPT = [
  '[pikiclaw-ticket-background]',
  'Analyze this ticket and create the durable Background document.',
  'Explain what the ticket is asking for, why it matters, likely modules/files, risks, and acceptance points.',
  'Do not code. Save or present a Markdown Background artifact that can replace reading the original description later.',
  'Use these sections: Background, Goal, Scope, Likely implementation areas, Acceptance points, Risks, Open questions.',
].join(' ');

const CREATE_CLARIFICATION_DOC_PROMPT = [
  'Use the ticket description and our conversation so far to produce the clarification document.',
  'Capture: goal, non-goals, confirmed decisions, acceptance criteria, implementation assumptions, dependencies, risks, and still-open questions.',
  'Do not code. End with a concise confirmation checklist for the user.',
].join(' ');

const SKIP_CODING_ANALYZE_MR_PROMPT = [
  'Coding was completed outside this Pikiclaw coding stage, or may already exist on a branch/MR.',
  'Ask for the MR/branch link only if it is not already available in the task context.',
  'Analyze the MR/branch against the clarified ticket: what changed, why it changed, important files, risks, and verification suggestions.',
  'Save or present an Implementation / MR Analysis artifact. Do not modify code unless the user explicitly asks.',
].join(' ');

const SELF_TEST_CASES_PROMPT = [
  'Help me plan self-test for this ticket before I execute it manually.',
  'First confirm the test cases with me. Then produce a complete Test Cases artifact with setup, cases, steps, expected results, evidence needed, and pass/fail criteria.',
  'Do not mark the task done yet.',
].join(' ');

const SELF_TEST_REPORT_PROMPT = [
  'Use the agreed test cases plus the evidence/conclusions I provide to produce the final Test Report.',
  'Track each case as passed, failed, blocked, or not run. Include screenshots/evidence references when available, remaining risks, and final recommendation.',
  'When all cases are complete, summarize whether this ticket can be marked done.',
].join(' ');

type TicketArtifactTab = 'raw' | 'background' | 'clarification' | 'implementation' | 'test-cases' | 'test-report';
type TicketDetailShelfTab = 'workflow' | TicketArtifactTab | 'files' | 'status';
type TicketOutputItem = {
  id: string;
  kind: ProOutput['kind'] | 'stage';
  title: string;
  summary: string;
  path?: string;
  url?: string;
  time: string;
  stage?: ProTaskStage;
};

const TICKET_ARTIFACT_TABS: Array<{ id: TicketArtifactTab; label: string }> = [
  { id: 'raw', label: 'Raw' },
  { id: 'background', label: 'Background' },
  { id: 'clarification', label: 'Clarification' },
  { id: 'implementation', label: 'Implementation' },
  { id: 'test-cases', label: 'Test Cases' },
  { id: 'test-report', label: 'Test Report' },
];

const TICKET_ARTIFACT_EMPTY: Record<TicketArtifactTab, string> = {
  raw: 'No raw ticket description.',
  background: 'No background document yet.',
  clarification: 'No clarification document yet.',
  implementation: 'No implementation or MR analysis yet.',
  'test-cases': 'No test cases yet.',
  'test-report': 'No test report yet.',
};

function isTicketArtifactTab(value: TicketDetailShelfTab): value is TicketArtifactTab {
  return TICKET_ARTIFACT_TABS.some(tab => tab.id === value);
}

function outputSearchText(output: Pick<TicketOutputItem, 'title' | 'summary' | 'kind'>): string {
  return `${output.kind} ${output.title} ${output.summary || ''}`.toLowerCase();
}

function outputMentions(output: Pick<TicketOutputItem, 'title' | 'summary' | 'kind'>, patterns: RegExp[]): boolean {
  const text = outputSearchText(output);
  return patterns.some(pattern => pattern.test(text));
}

function isTicketBackgroundOutput(output: TicketOutputItem): boolean {
  if (output.kind === 'background') return true;
  return outputMentions(output, [
    /\bticket background\b/,
    /\bbackground report\b/,
    /\bbackground document\b/,
    /背景分析/,
    /背景文档/,
  ]);
}

function ticketArtifactOutputs(task: ProTask, outputs: TicketOutputItem[], tab: TicketArtifactTab): TicketOutputItem[] {
  if (tab === 'background') return outputs.filter(isTicketBackgroundOutput);
  if (tab === 'clarification') {
    return outputs.filter(output => (
      output.stage === 'focus'
      || output.stage === 'refinement'
      || outputMentions(output, [/clarification/, /goal\s*&?\s*plan/, /\bplan\b/, /澄清/, /验收/, /范围/])
    ) && !isTicketBackgroundOutput(output));
  }
  if (tab === 'implementation') {
    return outputs.filter(output => (
      output.stage === 'coding'
      || output.kind === 'diff'
      || outputMentions(output, [/implementation/, /\bmr\b/, /merge request/, /\bpr\b/, /branch/, /diff/, /changed files?/, /working output/, /改动/, /实现/])
    ) && output.kind !== 'background');
  }
  if (tab === 'test-cases') {
    return outputs.filter(output => outputMentions(output, [/test cases?/, /test plan/, /测试用例/, /自测用例/]));
  }
  if (tab === 'test-report') {
    return outputs.filter(output => (
      output.stage === 'verification'
      || outputMentions(output, [/test report/, /verification result/, /review result/, /测试报告/, /验证结果/, /自测报告/])
    ) && !outputMentions(output, [/test cases?/, /test plan/, /测试用例/, /自测用例/]));
  }
  return [];
}

function latestRunForStage(task: ProTask, stage: ProTaskStage): StageRun | null {
  return [...(task.stageRuns || [])]
    .filter(run => run.stage === stage)
    .sort((a, b) => stageRunTimeMs(b) - stageRunTimeMs(a))[0] || null;
}

function hasCompletedStage(task: ProTask, stage: ProTaskStage): boolean {
  return (task.stageRuns || []).some(run => run.stage === stage && run.status === 'completed');
}

function hasAnalyzedTicketBackground(task: ProTask): boolean {
  return (task.events || []).some(event => event.type === 'background-updated' && event.actor !== 'system');
}

function buildTaskSelectionSideChatPrompt(request: SelectionSideChatRequest, locale: string): string {
  if (locale.startsWith('zh')) {
    return [
      '请基于下面从 task chat output 中选中的内容开启一个 side card 对话。',
      '',
      '选中内容：',
      request.quote.split('\n').map(line => `> ${line}`).join('\n'),
      '',
      `用户想继续处理的问题：${request.question || request.note}`,
    ].join('\n');
  }
  return [
    'Use the selected task chat output below as context for this side card.',
    '',
    'Selected text:',
    request.quote.split('\n').map(line => `> ${line}`).join('\n'),
    '',
    `User question: ${request.question || request.note}`,
  ].join('\n');
}

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
        {taskAssistantOptions(assistants, draft[field] as string | undefined).map(assistant => (
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
              {taskAssistantOptions(assistants, workflow.assistantId).map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
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
                {taskAssistantOptions(assistants, draft.lifecycleAssistantId).map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
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

function resolveTaskFilePath(workdir: string, target: FileLinkTarget): string {
  const path = target.path.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return path;
  return `${workdir.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

import { isMarkdownOutputPath, outputMarkdownPath } from './task-output-preview';

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

type TaskWorkflowStep = {
  key: string;
  label: string;
  stage?: ProTaskStage;
  status: TaskFlowStepStatus;
};

function latestTaskStageRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])].sort((a, b) => {
    const bTime = Date.parse(b.startedAt || b.completedAt || '');
    const aTime = Date.parse(a.startedAt || a.completedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  })[0] || null;
}

function stageRunTimeMs(run: StageRun): number {
  const values = [run.completedAt, run.startedAt]
    .map(value => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite) as number[];
  return values.length ? Math.max(...values) : 0;
}

function stageRunIsOpen(run: StageRun): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'waiting-user';
}

function isStaleStageRun(run: StageRun, now = Date.now()): boolean {
  const time = stageRunTimeMs(run);
  return stageRunIsOpen(run) && !!time && now - time > STALE_STAGE_RUN_MS;
}

function currentFlowStage(task: ProTask, busyStage?: ProTaskStage | null): ProTaskStage | 'done' {
  if (busyStage) return busyStage;
  const latestRun = latestTaskStageRun(task);
  if (latestRun && latestRun.status !== 'completed' && !isStaleStageRun(latestRun)) return latestRun.stage;
  if (task.status === 'done') return 'done';
  if (task.status === 'coding') return 'coding';
  if (task.status === 'resolved') return 'verification';
  return 'refinement';
}

function latestConfirmableStageRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])]
    .filter(run => run.status === 'completed'
      && !!(run.output?.summary || run.output?.diffSummary || run.output?.branch || run.output?.estimate)
      && !(run.outputIds || []).length)
    .sort((a, b) => stageRunTimeMs(b) - stageRunTimeMs(a))[0] || null;
}

function deriveTaskWorkflowSteps(task: ProTask, outputItems: TicketOutputItem[], busyStage?: ProTaskStage | null): TaskWorkflowStep[] {
  const activeStage = currentFlowStage(task, busyStage);
  const backgroundDone = hasAnalyzedTicketBackground(task) || ticketArtifactOutputs(task, outputItems, 'background').some(output => !!output.stage);
  const clarificationDone = ticketArtifactOutputs(task, outputItems, 'clarification').length > 0;
  const implementationDone = ticketArtifactOutputs(task, outputItems, 'implementation').length > 0 || !!task.prUrl;
  const testCasesDone = ticketArtifactOutputs(task, outputItems, 'test-cases').length > 0;
  const testReportDone = ticketArtifactOutputs(task, outputItems, 'test-report').length > 0;
  const isDaily = !!task.plannedDate && !isJiraLikeTask(task);
  const isBug = /bug|defect|incident|hotfix/i.test([task.kind, task.title, task.description].filter(Boolean).join(' '));
  const base: Array<{ key: string; label: string; stage?: ProTaskStage; done: boolean }> = isDaily
    ? [
        { key: 'goal', label: 'Goal', stage: 'refinement', done: clarificationDone || backgroundDone },
        { key: 'work', label: 'Work', stage: 'coding', done: implementationDone },
        { key: 'review', label: 'Review', stage: 'verification', done: testReportDone || task.status === 'done' },
        { key: 'done', label: 'Done', done: task.status === 'done' },
      ]
    : [
        { key: 'background', label: isBug ? 'Root cause' : 'Background', stage: 'refinement', done: backgroundDone },
        { key: 'clarification', label: 'Clarification', stage: 'refinement', done: clarificationDone },
        { key: 'implementation', label: task.prUrl ? 'MR analysis' : 'Implementation', stage: 'coding', done: implementationDone },
        { key: 'test-cases', label: 'Test cases', stage: 'verification', done: testCasesDone },
        { key: 'test-report', label: 'Test report', stage: 'verification', done: testReportDone },
        { key: 'done', label: 'Done', done: task.status === 'done' },
      ];
  let activeAssigned = false;
  return base.map((step, index) => {
    if (step.done) return { key: step.key, label: step.label, stage: step.stage, status: 'done' };
    const matchesActiveStage = step.stage ? step.stage === activeStage : activeStage === 'done';
    const firstIncomplete = base.findIndex(candidate => !candidate.done) === index;
    if (!activeAssigned && (firstIncomplete || matchesActiveStage || activeStage === 'done')) {
      activeAssigned = true;
      return { key: step.key, label: step.label, stage: step.stage, status: 'active' };
    }
    return { key: step.key, label: step.label, stage: step.stage, status: 'waiting' };
  });
}

function TicketWorkflowCard({
  title,
  label,
  status,
  summary,
  active,
  busy,
  onOpen,
  actions,
}: {
  title: string;
  label?: string;
  status: 'done' | 'active' | 'waiting';
  summary: string;
  active?: boolean;
  busy?: boolean;
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
            status === 'done' && 'border-ok bg-ok text-white',
            status === 'active' && 'border-primary bg-primary text-primary-fg',
            status === 'waiting' && 'border-edge bg-panel text-fg-5',
          )}
        >
          {status === 'done' ? (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : status === 'active' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{title}</span>
        {label && <Badge variant={status === 'done' ? 'ok' : status === 'active' ? 'accent' : 'muted'} className="h-4 px-1.5 text-[9.5px]">{label}</Badge>}
        {busy && <Spinner className="h-3 w-3 shrink-0" />}
      </div>
      <div className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-fg-5">{summary}</div>
    </>
  );
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-colors',
        active
          ? 'border-primary/40 bg-primary/[0.075]'
          : status === 'done'
            ? 'border-ok/25 bg-ok/[0.055]'
            : 'border-edge/55 bg-panel-alt/48',
      )}
    >
      {onOpen ? <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left">{content}</button> : content}
      {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

function TicketWorkflowNodeRow({
  title,
  label,
  status,
  outputCount,
  active,
  busy,
  onOpen,
}: {
  title: string;
  label?: string;
  status: 'done' | 'active' | 'waiting';
  outputCount?: number;
  active?: boolean;
  busy?: boolean;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
          status === 'done' && 'border-ok bg-ok text-white',
          status === 'active' && 'border-primary bg-primary text-primary-fg',
          status === 'waiting' && 'border-edge bg-panel text-fg-5',
        )}
      >
        {status === 'done' ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : status === 'active' ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-2">{title}</span>
      {busy && <Spinner className="h-3 w-3 shrink-0" />}
      {outputCount ? <span className="shrink-0 text-[10px] font-medium text-primary">{outputCount}</span> : null}
      {label && <Badge variant={status === 'done' ? 'ok' : status === 'active' ? 'accent' : 'muted'} className="h-4 px-1.5 text-[9.5px]">{label}</Badge>}
    </>
  );
  const className = cn(
    'flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors',
    active ? 'bg-primary/[0.08] ring-1 ring-primary/35' : 'hover:bg-panel-alt/70',
    !onOpen && 'cursor-default opacity-70 hover:bg-transparent',
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function TicketSidebarWorkflow({
  task,
  outputItems,
  activeTab,
  busyStage,
  onOpenArtifact,
}: {
  task: ProTask;
  outputItems: TicketOutputItem[];
  activeTab: TicketDetailShelfTab;
  busyStage?: ProTaskStage | null;
  onOpenArtifact: (tab: TicketArtifactTab) => void;
  onAnalyzeBackground: () => void;
  onClarify: () => void;
  onStartCoding: () => void;
  onSkipCoding: () => void;
  onPlanSelfTest: () => void;
  onWriteTestReport: () => void;
  onMarkDone: () => void;
}) {
  const hasRaw = !!cleanTaskDescription(task);
  const backgroundOutputs = ticketArtifactOutputs(task, outputItems, 'background');
  const clarificationOutputs = ticketArtifactOutputs(task, outputItems, 'clarification');
  const implementationOutputs = ticketArtifactOutputs(task, outputItems, 'implementation');
  const testCaseOutputs = ticketArtifactOutputs(task, outputItems, 'test-cases');
  const testReportOutputs = ticketArtifactOutputs(task, outputItems, 'test-report');
  const hasBackgroundDraft = backgroundOutputs.length > 0;
  const hasBackground = hasAnalyzedTicketBackground(task);
  const hasClarification = hasCompletedStage(task, 'refinement') || hasCompletedStage(task, 'focus') || clarificationOutputs.length > 0;
  const hasImplementation = hasCompletedStage(task, 'coding') || !!task.prUrl || implementationOutputs.length > 0;
  const hasTestCases = testCaseOutputs.length > 0;
  const hasTestReport = testReportOutputs.length > 0 || task.verificationRuns.some(run => !!run.result && run.result !== 'not-run');
  const codingRun = latestRunForStage(task, 'coding');
  const verificationRun = latestRunForStage(task, 'verification');
  const refinementRun = latestRunForStage(task, 'refinement') || latestRunForStage(task, 'focus');
  const busy = (stage: ProTaskStage) => busyStage === stage;
  const stageActive = (stage: ProTaskStage) => busyStage === stage
    || (stage === 'coding' && codingRun && stageRunIsOpen(codingRun))
    || (stage === 'verification' && verificationRun && stageRunIsOpen(verificationRun))
    || ((stage === 'refinement' || stage === 'focus') && refinementRun && stageRunIsOpen(refinementRun));
  const showClarification = hasBackground || hasClarification;
  const showCoding = hasClarification || hasImplementation || task.status === 'coding' || task.status === 'resolved' || task.status === 'done';
  const showSelfTest = hasImplementation || hasTestCases || hasTestReport || task.status === 'resolved' || task.status === 'done';
  const showDone = hasTestReport || task.status === 'resolved' || task.status === 'done';
  const selfTestTab: TicketArtifactTab = hasTestReport ? 'test-report' : 'test-cases';
  return (
    <section className="mb-3 space-y-2">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-fg-2">Ticket workflow</div>
          <div className="mt-0.5 truncate text-[11px] text-fg-5">{taskDisplayKey(task) || task.localKey || 'Task'} · {STATUS_LABEL[displayTaskStatus(task.status)]}</div>
        </div>
        <Badge variant={task.status === 'done' ? 'ok' : task.status === 'coding' ? 'accent' : task.status === 'resolved' ? 'warn' : 'muted'}>
          {outputItems.length} outputs
        </Badge>
      </div>
      <div className="rounded-lg border border-edge/55 bg-panel-alt/35 p-1.5">
        <TicketWorkflowNodeRow
          title="Desc"
          label="Raw"
          status={hasRaw ? 'done' : 'waiting'}
          outputCount={hasRaw ? 1 : 0}
          active={activeTab === 'raw'}
          onOpen={hasRaw ? () => onOpenArtifact('raw') : undefined}
        />
        <TicketWorkflowNodeRow
          title="Background"
          label={hasBackground ? 'Report' : hasBackgroundDraft ? 'Draft' : undefined}
          status={hasBackground ? 'done' : stageActive('refinement') ? 'active' : 'waiting'}
          outputCount={backgroundOutputs.length}
          active={activeTab === 'background'}
          busy={busy('refinement') && !hasBackground}
          onOpen={backgroundOutputs.length ? () => onOpenArtifact('background') : undefined}
        />
      {showClarification && (
        <TicketWorkflowNodeRow
          title="Clarification"
          label={hasClarification ? 'Doc' : undefined}
          status={hasClarification ? 'done' : stageActive('refinement') ? 'active' : 'waiting'}
          outputCount={clarificationOutputs.length}
          active={activeTab === 'clarification'}
          busy={busy('refinement') && hasBackground && !hasClarification}
          onOpen={clarificationOutputs.length ? () => onOpenArtifact('clarification') : undefined}
        />
      )}
      {showCoding && (
        <TicketWorkflowNodeRow
          title="Coding / MR"
          label={hasImplementation ? (task.prUrl ? 'MR' : 'Output') : undefined}
          status={hasImplementation ? 'done' : stageActive('coding') ? 'active' : 'waiting'}
          outputCount={implementationOutputs.length + (task.prUrl ? 1 : 0)}
          active={activeTab === 'implementation'}
          busy={busy('coding') && !hasImplementation}
          onOpen={hasImplementation ? () => onOpenArtifact('implementation') : undefined}
        />
      )}
      {showSelfTest && (
        <TicketWorkflowNodeRow
          title="Self Test"
          label={hasTestReport ? 'Report' : hasTestCases ? 'Cases' : undefined}
          status={hasTestReport ? 'done' : stageActive('verification') || hasTestCases ? 'active' : 'waiting'}
          outputCount={testCaseOutputs.length + testReportOutputs.length}
          active={activeTab === 'test-cases' || activeTab === 'test-report'}
          busy={busy('verification') && !hasTestReport}
          onOpen={(hasTestCases || hasTestReport) ? () => onOpenArtifact(selfTestTab) : undefined}
        />
      )}
      {showDone && (
        <TicketWorkflowNodeRow
          title="Done"
          status={task.status === 'done' ? 'done' : 'waiting'}
          label={task.status === 'done' ? 'Closed' : undefined}
          active={false}
          onOpen={hasTestReport ? () => onOpenArtifact('test-report') : undefined}
        />
      )}
      </div>
    </section>
  );
}

function TicketCurrentWorkflowAction({
  task,
  outputItems,
  busyStage,
  onAnalyzeBackground,
  onConfirmOutput,
}: {
  task: ProTask;
  outputItems: TicketOutputItem[];
  busyStage?: ProTaskStage | null;
  onAnalyzeBackground: () => void;
  onConfirmOutput: () => void;
}) {
  const backgroundOutputs = ticketArtifactOutputs(task, outputItems, 'background');
  const clarificationOutputs = ticketArtifactOutputs(task, outputItems, 'clarification');
  const implementationOutputs = ticketArtifactOutputs(task, outputItems, 'implementation');
  const testCaseOutputs = ticketArtifactOutputs(task, outputItems, 'test-cases');
  const testReportOutputs = ticketArtifactOutputs(task, outputItems, 'test-report');
  const confirmableRun = latestConfirmableStageRun(task);
  const workflowSteps = deriveTaskWorkflowSteps(task, outputItems, busyStage);
  const completedSteps = workflowSteps.filter(step => step.status === 'done').length;
  const activeStep = workflowSteps.find(step => step.status === 'active') || workflowSteps[0];
  const hasBackgroundDraft = backgroundOutputs.length > 0 || !!confirmableRun?.prompt.match(/\[pikiclaw-ticket-background\]/i);
  const hasBackground = hasAnalyzedTicketBackground(task);
  const hasClarification = hasCompletedStage(task, 'refinement') || hasCompletedStage(task, 'focus') || clarificationOutputs.length > 0;
  const hasImplementation = hasCompletedStage(task, 'coding') || !!task.prUrl || implementationOutputs.length > 0;
  const hasTestCases = testCaseOutputs.length > 0;
  const hasTestReport = testReportOutputs.length > 0 || task.verificationRuns.some(run => !!run.result && run.result !== 'not-run');
  const codingRun = latestRunForStage(task, 'coding');
  const verificationRun = latestRunForStage(task, 'verification');
  const refinementRun = latestRunForStage(task, 'refinement') || latestRunForStage(task, 'focus');
  const busy = (stage: ProTaskStage) => busyStage === stage;
  const stageActive = (stage: ProTaskStage) => busyStage === stage
    || (stage === 'coding' && codingRun && stageRunIsOpen(codingRun))
    || (stage === 'verification' && verificationRun && stageRunIsOpen(verificationRun))
    || ((stage === 'refinement' || stage === 'focus') && refinementRun && stageRunIsOpen(refinementRun));
  const actionButtonClass = 'h-7 px-2.5 text-[11px]';
  const showStartBackground = !confirmableRun && activeStep?.key === 'background';
  const activeLabel = confirmableRun
    ? 'Review draft'
    : activeStep?.label || (!hasBackground
    ? 'Background'
    : !hasClarification
      ? 'Clarification'
      : !hasImplementation
        ? 'Coding / MR'
        : !hasTestReport
          ? 'Self Test'
          : 'Done');
  const activeSummary = confirmableRun
    ? 'A draft output is ready. Continue asking questions in chat, or confirm it as the phase output.'
    : !hasBackground
    ? (hasBackgroundDraft ? 'Draft exists. Run background again to refresh the readable report.' : 'Create a readable understanding before planning.')
    : !hasClarification
      ? 'Clarify questions, decisions, boundaries, and acceptance criteria.'
      : !hasImplementation
        ? 'Start coding, or skip if work already exists on a branch/MR.'
        : !hasTestCases && !hasTestReport
          ? 'Plan test cases before manual self-test.'
          : !hasTestReport
            ? 'Test cases are ready; write the final report after evidence is provided.'
            : task.status === 'done'
              ? 'This ticket is complete.'
              : 'Finish the ticket when implementation and evidence are acceptable.';
  const activeStage: ProTaskStage = !hasImplementation && hasClarification ? 'coding' : !hasTestReport && hasImplementation ? 'verification' : 'refinement';
  const active = stageActive(activeStage);

  return (
    <div className="mx-auto w-full max-w-[920px]">
      <div className="rounded-lg border border-edge/65 bg-panel/86 px-3 py-2 shadow-sm backdrop-blur-xl">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-semibold text-fg-2">Current workflow action</span>
            <Badge variant={task.status === 'done' ? 'ok' : confirmableRun ? 'warn' : task.status === 'coding' ? 'accent' : task.status === 'resolved' ? 'warn' : 'muted'}>
              {activeLabel}
            </Badge>
            <span className="ml-auto shrink-0 text-[10px] font-medium text-fg-5">{completedSteps}/{workflowSteps.length} complete</span>
          </div>
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <span
            className={cn(
              'hidden h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] lg:inline-flex',
              active ? 'border-primary bg-primary text-primary-fg' : 'border-edge bg-panel text-fg-5',
            )}
          >
            {active ? <Spinner className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-fg-5">{activeSummary}</div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap gap-1.5 lg:w-auto lg:justify-end">
            {confirmableRun && (
              <Button variant="primary" size="sm" className={actionButtonClass} disabled={!!busyStage} onClick={onConfirmOutput}>
                Confirm output
              </Button>
            )}
            {showStartBackground && (
              <Button variant={!hasBackground ? 'secondary' : 'ghost'} size="sm" className={actionButtonClass} disabled={!!busyStage} onClick={onAnalyzeBackground}>
                {busy('refinement') && !hasBackground ? <Spinner /> : null}
                Start background
              </Button>
            )}
          </div>
          </div>
        </div>
      </div>
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
  onOpenArtifacts,
  artifactCount,
  workflowAction,
  onCreateSideChatFromSelection,
  onCreateTodoFromSelection,
  onOpenFileLink,
  onChatWorkdirChange,
  onTaskUpdated,
  buildChatPrompt,
  buildChatContext,
  t,
}: {
  task: ProTask;
  actions?: ReactNode;
  busyStage?: ProTaskStage | null;
  agents: AgentRuntimeStatus[];
  defaultAgent: string;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string, displayPrompt?: string | null) => Promise<void>;
  onOpenArtifacts: () => void;
  artifactCount: number;
  workflowAction?: ReactNode;
  onCreateSideChatFromSelection?: TaskSelectionSessionHandler<SelectionSideChatRequest>;
  onCreateTodoFromSelection?: TaskSelectionSessionHandler;
  onOpenFileLink?: OpenFileLinkHandler;
  onChatWorkdirChange?: (workdir: string) => void;
  onTaskUpdated?: (task: ProTask) => void;
  buildChatPrompt: (task: ProTask, status: ProTaskStatus, prompt?: string) => string;
  buildChatContext: (task: ProTask, status: ProTaskStatus) => string;
  t: (key: string) => string;
}) {
  const currentDefaultAgent = taskAssignee(task, defaultAgent);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<RichMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmingOutput, setConfirmingOutput] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(currentDefaultAgent);
  const [chatStatus, setChatStatus] = useState<ProTaskStatus>(displayTaskStatus(task.status));
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, StageSessionRef>>({});
  const [ticketDetailOpen, setTicketDetailOpen] = useState(false);
  const [taskTopScrolled, setTaskTopScrolled] = useState(false);
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
    setSelectedAgent(taskAssignee(task, defaultAgent));
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
  const runIsStale = run ? isStaleStageRun(run) : false;
  const activeStage = STATUS_CHAT_STAGE[activeStatus];
  const agentDiffersFromRun = !!runSession && !!selectedAgent && runSession.agent !== selectedAgent;
  const missingSessionHistory = !!run && !!error && /session history file not found/i.test(error);
  const canSendToRun = !!run && !runIsStale && !agentDiffersFromRun && !missingSessionHistory;
  const fields = task.jiraFields || {};
  const brief = taskBriefSummary(task);
  const summaryFallback = 'No ticket description yet. Ask the agent to inspect the task and create a plan.';
  const ticketSummary = brief || summaryFallback;
  const taskReferenceContext = useMemo(() => {
    if (typeof buildChatContext === 'function') return buildChatContext(task, activeStatus);
    return buildTicketChatContext(task, activeStatus);
  }, [activeStatus, buildChatContext, task]);
  const meaningfulMessages = messages.filter(message => !!compactMessageText(message));
  const lastMeaningfulMessage = meaningfulMessages[meaningfulMessages.length - 1] || null;
  const chatWorkdir = runSession?.workdir || task.workdir || '';
  const runDraftSummary = run
    ? (run.output?.summary || run.output?.diffSummary || run.output?.branch || estimateSummary(run) || '').trim()
    : '';
  const runHasConfirmedOutput = !!run?.outputIds?.length;
  const showOutputActions = runHasConfirmedOutput && !!lastMeaningfulMessage && lastMeaningfulMessage.role !== 'user';
  const showConfirmOutput = !!run && run.status === 'completed' && !!runDraftSummary && !runHasConfirmedOutput;

  useEffect(() => {
    onChatWorkdirChange?.(chatWorkdir);
  }, [chatWorkdir, onChatWorkdirChange, task.id]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setDraft('');
    setReloadKey(0);
    setSelectedAgent(currentDefaultAgent);
    setChatStatus(displayTaskStatus(task.status));
    setTicketDetailOpen(false);
    setTaskTopScrolled(false);
  }, [currentDefaultAgent, task.id, task.status]);

  const saveRuntimeSelection = useCallback((next: { agent?: string | null; model?: string | null; effort?: string | null }) => {
    const agent = Object.prototype.hasOwnProperty.call(next, 'agent') ? next.agent || null : task.execution?.agent || null;
    const model = Object.prototype.hasOwnProperty.call(next, 'model') ? next.model || null : task.execution?.model || null;
    const effort = Object.prototype.hasOwnProperty.call(next, 'effort') ? next.effort || null : task.execution?.effort || null;
    void api.updateProTaskExecution(task.id, {
      ownerMode: agent ? 'agent' : task.execution?.ownerMode || 'status',
      agent,
      assistantId: task.execution?.assistantId || null,
      defaultAssistantId: task.defaultAssistantId || null,
      mode: task.execution?.mode,
      model,
      effort,
    }).then(result => {
      if (result.ok && result.task) onTaskUpdated?.(result.task);
    }).catch(() => {});
  }, [onTaskUpdated, task.defaultAssistantId, task.execution?.agent, task.execution?.assistantId, task.execution?.effort, task.execution?.mode, task.execution?.model, task.execution?.ownerMode, task.id]);

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

  const startChat = async (status: ProTaskStatus = activeStatus, prompt?: string, displayPrompt?: string | null) => {
    setError(null);
    setSending(true);
    setChatStatus(status);
    try {
      await onStartStatusChat(task, status, prompt, selectedAgent, displayPrompt ?? prompt ?? null);
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
      const messagePrompt = typeof buildChatPrompt === 'function'
        ? buildChatPrompt(task, activeStatus, prompt)
        : buildStatusChatPrompt(task, activeStatus, prompt);
      const result = await api.sendSessionMessage(session.workdir, session.agent, session.sessionId, messagePrompt, {
        displayPrompt: prompt,
      });
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

  const confirmStageOutput = async () => {
    if (!run || confirmingOutput) return;
    setError(null);
    setConfirmingOutput(true);
    try {
      const result = await api.confirmProTaskStageOutput(task.id, run.id);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to confirm output');
      onTaskUpdated?.(result.task);
      onOpenArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm output');
    } finally {
      setConfirmingOutput(false);
    }
  };

  const taskHeader = (
    <div className="relative w-full overflow-hidden rounded-xl border border-edge/70 bg-panel/78 shadow-[0_14px_38px_rgba(15,23,42,0.12)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="relative px-3.5 py-3">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md border border-primary/20 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-primary">
            Desc
          </span>
          <span className="min-w-0 truncate text-[11px] text-fg-5">Ticket brief and current task context</span>
        </div>
        <div className={cn(
          'border-t border-edge/45 pt-2 text-[12px] leading-relaxed text-fg-4',
          ticketDetailOpen ? 'max-h-[260px] overflow-y-auto pr-1' : 'line-clamp-3',
        )}>
          {ticketDetailOpen ? <TaskDescriptionMarkdown task={task} /> : ticketSummary}
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-edge/45 pt-2 text-[11px] text-fg-5">
          <button type="button" onClick={() => setTicketDetailOpen(open => !open)} className="rounded-md px-1.5 py-1 font-medium text-primary transition hover:bg-panel-h hover:text-primary/80">
            {ticketDetailOpen ? 'Collapse detail' : 'Full detail'}
          </button>
          <button type="button" onClick={onOpenArtifacts} className="rounded-md px-1.5 py-1 transition hover:bg-panel-h hover:text-fg-3">
            {artifactCount ? `${artifactCount} output${artifactCount === 1 ? '' : 's'}` : 'Outputs open in the sidebar'}
          </button>
        </div>
      </div>
    </div>
  );
  const taskTop = (
    <div className={cn('relative z-10 mx-auto w-full max-w-[920px]', taskTopScrolled ? 'space-y-2' : 'space-y-3')}>
      {!taskTopScrolled && <div className="min-w-0">{taskHeader}</div>}
      <div className="sticky top-0 z-30">{workflowAction}</div>
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
        : runIsStale
          ? 'incomplete'
          : 'running',
    runDetail: runIsStale ? 'This task run is stale; no active runtime is attached.' : null,
    runStartedAt: run.startedAt,
    runUpdatedAt: run.completedAt || run.startedAt,
    title: task.title,
    lastQuestion: run.displayPrompt || run.prompt,
  } satisfies SessionInfo) : null;

  if (run && runSession && panelSession) {
    const isPendingSession = runSession.sessionId.startsWith('pending_');
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--th-session-bg)]">
        <div className="shrink-0 px-5 pb-3 pt-3">
          {taskTop}
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
            initialPendingPrompt={isPendingSession ? run.displayPrompt || run.prompt : null}
            initialPendingCreatedAt={isPendingSession ? run.startedAt || null : null}
            referenceContextPrompt={taskReferenceContext}
            initialRuntimeSelection={{
              agent: selectedAgent || task.execution?.agent || null,
              model: task.execution?.model || null,
              effort: task.execution?.effort || null,
            }}
            suppressLiveStreamState={runIsStale}
            onSessionChange={handleRunSessionChange}
            onTranscriptScroll={({ scrollTop }) => setTaskTopScrolled(scrollTop > 24)}
            onRuntimeSelectionChange={(next) => {
              saveRuntimeSelection(next);
            }}
            onOpenFileLink={onOpenFileLink}
            onCreateSideChatFromSelection={(request) => onCreateSideChatFromSelection?.(runSession, request)}
            onCreateTodoFromSelection={(request) => onCreateTodoFromSelection?.(runSession, request)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[var(--th-session-bg)]">
      <div
        className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-[130px]"
        onScroll={event => setTaskTopScrolled(event.currentTarget.scrollTop > 24)}
      >
        <div className="pb-5">
          <div className="sticky top-0 z-20 -mx-5 mb-5 px-5 pb-3 pt-3">
            <div className="absolute inset-x-0 top-0 h-[calc(100%+28px)] bg-gradient-to-b from-[var(--th-session-bg)] via-[var(--th-session-bg)]/92 to-transparent" />
            {taskTop}
          </div>
          <div className="mx-auto max-w-[860px] px-5">
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
                const normalized = ensureRichMessageBlocks(message);
                const text = compactMessageText(normalized);
                if (!text && !normalized.blocks?.some(block => block.type === 'image')) return null;
                const user = normalized.role === 'user';
                if (user) {
                  return (
                    <div key={`${normalized.role}-${normalized.createdAt || index}`} className="flex justify-end">
                      <div className="max-w-[78%] min-w-0">
                        <UserBubble
                          text={text}
                          blocks={normalized.blocks}
                          createdAt={normalized.createdAt}
                          t={t}
                        />
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={`${normalized.role}-${normalized.createdAt || index}`} className="flex justify-start">
                    <div className="max-w-[min(100%,860px)] min-w-0 rounded-md border border-edge bg-panel px-3 py-2">
                      <AssistantMsg
                        message={normalized}
                        t={t}
                        onOpenFileLink={onOpenFileLink}
                        workdir={chatWorkdir || undefined}
                      />
                    </div>
                  </div>
                );
              })}
              {showConfirmOutput && (
                <div className="flex justify-start">
                  <div className="max-w-[min(100%,720px)] rounded-lg border border-primary/25 bg-primary/[0.055] px-3 py-2 shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-fg-2">Draft output ready</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-5">{runDraftSummary}</div>
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="h-7 shrink-0 px-2.5 text-[11px]"
                        disabled={confirmingOutput}
                        onClick={() => { void confirmStageOutput(); }}
                      >
                        {confirmingOutput ? <Spinner /> : null}
                        Confirm output
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {showOutputActions && (
                <div className="flex justify-start">
                  <div className="max-w-[78%] rounded-lg border border-edge/60 bg-panel-alt/68 px-3 py-2 shadow-sm">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Next actions</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={sending || busyStage === STATUS_CHAT_STAGE.coding}
                        onClick={() => { void startChat('coding', START_CODING_PROMPT, 'Start coding'); }}
                        className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-fg transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-45"
                      >
                        {busyStage === STATUS_CHAT_STAGE.coding ? <Spinner className="mr-1 h-3 w-3" /> : null}
                        Start coding
                      </button>
                      <button
                        type="button"
                        disabled={sending || busyStage === STATUS_CHAT_STAGE.refinement}
                        onClick={() => { void startChat('refinement', REVISE_PLAN_PROMPT, 'Revise plan'); }}
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
                  onChange={event => {
                    const agent = event.target.value;
                    setSelectedAgent(agent);
                    saveRuntimeSelection({ agent });
                  }}
                  className="max-w-[150px] appearance-none bg-transparent text-[11px] font-medium text-fg-3 outline-none"
                >
                  {agentOptions.map(agent => <option key={agent.value} value={agent.value}>{agent.label}</option>)}
                </select>
              </label>
              <div className="min-w-0 flex-1" />
              <button
                type="button"
                disabled={sending || busyStage === activeStage || (!draft.trim() && canSendToRun)}
                onClick={() => {
                  if (draft.trim()) void sendMessage();
                  else void startChat(activeStatus, undefined, 'Start workflow');
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
  const fixVersions = jiraTaskFixVersions(task);
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
          <TaskPropertyRow label="Jira status">
            <span className={cn('truncate', fields.status || fallback.status ? 'text-fg-2' : 'text-fg-5')}>
              {fields.status || fallback.status || '--'}
            </span>
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
          <TaskPropertyRow label="Fix version">
            {fixVersions.length ? (
              <span className="flex min-w-0 flex-wrap gap-1">
                {fixVersions.slice(0, 3).map(version => <Badge key={version} variant="muted">{version}</Badge>)}
              </span>
            ) : (
              <span className="text-fg-5">--</span>
            )}
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
  const fixVersions = jiraTaskFixVersions(task);
  return (
    <section className="rounded-md border border-edge bg-panel-alt px-3 py-3">
      <div className="mb-3 text-[13px] font-semibold text-fg-2">Jira metadata</div>
      <div className="space-y-3">
        <TaskMetaItem label="Key" value={taskDisplayKey(task)} mono />
        <TaskMetaItem label="Ticket type" value={fields.issueType || ticketType.label} />
        <TaskMetaItem label="Sprint" value={task.sprint} />
        <TaskMetaItem label="Fix version" value={fixVersions.join(', ')} />
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

function JiraRemoteUpdatePanel({
  task,
  onTaskUpdated,
}: {
  task: ProTask;
  onTaskUpdated?: (task: ProTask) => void;
}) {
  const toast = useStore(s => s.toast);
  const [draft, setDraft] = useState<JiraRemoteUpdateDraft>(() => remoteUpdateDraftFromTask(task));
  const [runs, setRuns] = useState<JiraRemoteUpdateRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const taskVersionKey = jiraTaskFixVersions(task).join('\u0000');
  const fields = useMemo(() => remoteUpdateFieldsFromDraft(task, draft), [draft, task, taskVersionKey]);
  const changedFields = Object.keys(fields) as Array<keyof JiraRemoteUpdateFields>;
  const hasChanges = changedFields.length > 0;

  const replaceRun = useCallback((run: JiraRemoteUpdateRun) => {
    setRuns(prev => [run, ...prev.filter(item => item.id !== run.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  }, []);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getJiraRemoteUpdates(task.id);
      if (!result.ok) throw new Error(result.error || 'Failed to load Jira updates');
      setRuns(result.runs || []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load Jira updates', false);
    } finally {
      setLoading(false);
    }
  }, [task.id, toast]);

  useEffect(() => {
    setDraft(remoteUpdateDraftFromTask(task));
  }, [task.id, task.jiraFields?.status, task.jiraFields?.dueDate, task.sprint, taskVersionKey]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const createDraft = async () => {
    if (!task.jiraKey || !hasChanges || creating) return;
    setCreating(true);
    try {
      const result = await api.createJiraRemoteUpdate(task.id, fields);
      if (!result.ok || !result.run) throw new Error(result.error || 'Failed to create Jira update draft');
      replaceRun(result.run);
      toast('Jira update draft created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create Jira update draft', false);
    } finally {
      setCreating(false);
    }
  };

  const applyRun = async (run: JiraRemoteUpdateRun) => {
    if (busyRunId) return;
    setBusyRunId(run.id);
    try {
      const result = await api.applyJiraRemoteUpdate(run.id);
      if (result.run) replaceRun(result.run);
      if (result.task) {
        onTaskUpdated?.(result.task);
        setDraft(remoteUpdateDraftFromTask(result.task));
      }
      if (!result.ok) throw new Error(result.error || 'Jira update failed');
      toast('Jira update applied');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Jira update failed', false);
      void loadRuns();
    } finally {
      setBusyRunId(null);
    }
  };

  const cancelRun = async (run: JiraRemoteUpdateRun) => {
    if (busyRunId) return;
    setBusyRunId(run.id);
    try {
      const result = await api.cancelJiraRemoteUpdate(run.id);
      if (!result.ok || !result.run) throw new Error(result.error || 'Failed to cancel Jira update');
      replaceRun(result.run);
      toast('Jira update cancelled');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to cancel Jira update', false);
    } finally {
      setBusyRunId(null);
    }
  };

  return (
    <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-fg-3">Jira write-back</div>
          <div className="mt-0.5 truncate text-[10.5px] text-fg-5">Remote changes require a draft confirmation.</div>
        </div>
        <Badge variant={task.jiraKey ? 'muted' : 'warn'}>{task.jiraKey || 'No Jira'}</Badge>
      </div>
      <div className="grid gap-2">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Status</span>
          <Input
            value={draft.status}
            onChange={event => setDraft(prev => ({ ...prev, status: event.target.value }))}
            placeholder="In Progress"
            className="h-8 text-[12px]"
            disabled={!task.jiraKey}
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Sprint</span>
            <Input
              value={draft.sprint}
              onChange={event => setDraft(prev => ({ ...prev, sprint: event.target.value }))}
              placeholder="Sprint name"
              className="h-8 text-[12px]"
              disabled={!task.jiraKey}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Due date</span>
            <input
              type="date"
              value={draft.dueDate}
              onChange={event => setDraft(prev => ({ ...prev, dueDate: event.target.value }))}
              className="h-8 rounded-md border border-control-border bg-control px-2 text-[12px] text-fg outline-none transition hover:border-control-border-h focus:border-primary/50 disabled:opacity-45"
              disabled={!task.jiraKey}
            />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Fix version</span>
          <Input
            value={draft.fixVersionsText}
            onChange={event => setDraft(prev => ({ ...prev, fixVersionsText: event.target.value }))}
            placeholder="version-a, version-b"
            className="h-8 text-[12px]"
            disabled={!task.jiraKey}
          />
        </label>
      </div>
      {hasChanges ? (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/[0.045] px-2.5 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Pending diff</div>
          <div className="space-y-1">
            {changedFields.map(field => (
              <div key={field} className="grid grid-cols-[74px_minmax(0,1fr)] gap-2 text-[11px]">
                <span className="text-fg-5">{jiraRemoteFieldLabel(field as JiraRemoteUpdateRun['diff'][number]['field'])}</span>
                <span className="min-w-0 truncate text-fg-3">{jiraRemoteValueLabel(fields[field] as any)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-edge/50 bg-inset/25 px-2.5 py-2 text-[11px] text-fg-5">
          No remote field changes.
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="primary" size="sm" className="h-7 px-2 text-[11px]" disabled={!task.jiraKey || !hasChanges || creating} onClick={() => { void createDraft(); }}>
          {creating ? <Spinner /> : null}
          Draft update
        </Button>
      </div>
      <div className="mt-4 border-t border-edge/55 pt-3">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-fg-4">Update history</span>
          {loading && <Spinner />}
        </div>
        {runs.length === 0 ? (
          <div className="rounded-md border border-dashed border-edge/60 px-2.5 py-3 text-[11px] text-fg-5">No Jira write-back runs yet.</div>
        ) : (
          <div className="space-y-2">
            {runs.slice(0, 4).map(run => {
              const busy = busyRunId === run.id;
              const actionable = run.status === 'draft' || run.status === 'failed';
              return (
                <div key={run.id} className="rounded-md border border-edge/55 bg-panel/70 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={jiraRemoteUpdateStatusTone(run.status)} className="h-4 px-1.5 text-[9.5px]">{run.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg-5">{formatTime(run.updatedAt)}</span>
                    {busy && <Spinner />}
                  </div>
                  <div className="mt-1 space-y-1">
                    {(run.diff || []).slice(0, 4).map(item => (
                      <div key={`${run.id}:${item.field}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[11px]">
                        <span className="text-fg-5">{jiraRemoteFieldLabel(item.field)}</span>
                        <span className="min-w-0 truncate text-fg-3">{jiraRemoteValueLabel(item.from)} → {jiraRemoteValueLabel(item.to)}</span>
                      </div>
                    ))}
                  </div>
                  {run.error && <div className="mt-1 line-clamp-2 text-[11px] text-warn">{run.error}</div>}
                  {actionable && (
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[10.5px]" disabled={!!busyRunId} onClick={() => { void cancelRun(run); }}>
                        Cancel
                      </Button>
                      <Button variant="secondary" size="sm" className="h-6 px-2 text-[10.5px]" disabled={!!busyRunId} onClick={() => { void applyRun(run); }}>
                        Apply
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function TicketBackgroundEditor({
  task,
  output,
  value,
  dirty,
  saving,
  error,
  onChange,
  onSave,
  onImproveWithAgent,
}: {
  task: ProTask;
  output?: ProOutput | null;
  value: string;
  dirty: boolean;
  saving: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onImproveWithAgent: () => void;
}) {
  return (
    <section className="rounded-lg border border-primary/20 bg-primary/[0.045] px-3 py-3">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-fg-2">Ticket background</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">
            Your working understanding of what this ticket asks you to do.
          </div>
        </div>
        <Badge variant={dirty ? 'warn' : 'accent'}>{dirty ? 'Edited' : 'Saved'}</Badge>
      </div>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-h-[220px] w-full resize-y rounded-md border border-edge bg-inset/55 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-fg outline-none transition focus:border-primary/45"
        placeholder="Write your understanding of this ticket..."
      />
      {output?.path && (
        <div className="mt-2 truncate font-mono text-[10px] text-fg-5" title={output.path}>
          {output.path}
        </div>
      )}
      {error && <div className="mt-2 text-[11px] text-err">{error}</div>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={onImproveWithAgent}>
          Improve with agent
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={saving || !value.trim()}
          onClick={onSave}
        >
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </section>
  );
}

function TaskDetail({
  task,
  linkCandidates,
  linkedTask,
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
  onAssignAssistant,
  onStartStatusChat,
  onSubtaskDraftChange,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartSubtask,
  onTaskUpdated,
  onReopen,
  onOpenLinkedTask,
  onCreateSideChatFromSelection,
  onCreateTodoFromSelection,
  buildChatPrompt,
  buildChatContext,
}: {
  task: ProTask | null;
  linkCandidates: ProTask[];
  linkedTask: ProTask | null;
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
  onAssignAssistant: (task: ProTask, assistantId: string) => void;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string, displayPrompt?: string | null) => Promise<void>;
  onSubtaskDraftChange: (draft: { title: string; description: string; assignedAgent: string; assistantId: string }) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
  onStartSubtask: (task: ProTask, subtaskId: string) => void;
  onTaskUpdated?: (task: ProTask) => void;
  onReopen?: (task: ProTask) => void;
  onOpenLinkedTask?: (task: ProTask) => void;
  onCreateSideChatFromSelection?: TaskSelectionSessionHandler<SelectionSideChatRequest>;
  onCreateTodoFromSelection?: TaskSelectionSessionHandler;
  buildChatPrompt: (task: ProTask, status: ProTaskStatus, prompt?: string) => string;
  buildChatContext: (task: ProTask, status: ProTaskStatus) => string;
}) {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);
  const [shelfTab, setShelfTab] = useState<TicketDetailShelfTab>('workflow');
  const [contextOpen, setContextOpen] = useState(true);
  const [fileBrowserPath, setFileBrowserPath] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [activeChatWorkdir, setActiveChatWorkdir] = useState('');
  const [backgroundDraft, setBackgroundDraft] = useState('');
  const [backgroundDirty, setBackgroundDirty] = useState(false);
  const [backgroundSaving, setBackgroundSaving] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [confirmingStageOutput, setConfirmingStageOutput] = useState(false);
  const sortedRuns = useMemo(() => [...(task?.stageRuns || [])].sort((a, b) => {
    const bTime = Date.parse(b.startedAt || b.completedAt || '');
    const aTime = Date.parse(a.startedAt || a.completedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  }), [task?.stageRuns]);
  const outputItems = useMemo<TicketOutputItem[]>(() => {
    if (!task) return [];
    return (task.outputs || []).map(output => ({
      id: output.id,
      kind: output.kind,
      title: output.title,
      summary: output.summary || output.path || output.url || '',
      path: output.path,
      time: output.createdAt,
      stage: output.stageRunId ? sortedRuns.find(run => run.id === output.stageRunId)?.stage : undefined,
    })).sort((a, b) => {
      const bTime = Date.parse(b.time || '');
      const aTime = Date.parse(a.time || '');
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [sortedRuns, task]);
  const backgroundOutput = useMemo(() => {
    return (task?.outputs || []).find(output => output.kind === 'background') || null;
  }, [task?.outputs]);
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
  const previewWorkdir = activeChatWorkdir || inferredWorkdir;
  const artifactOutputItems = useMemo(() => {
    if (!task || !isTicketArtifactTab(shelfTab)) return outputItems;
    return ticketArtifactOutputs(task, outputItems, shelfTab);
  }, [outputItems, shelfTab, task]);
  const selectedOutput = useMemo(() => {
    if (!artifactOutputItems.length) return null;
    return artifactOutputItems.find(output => output.id === selectedOutputId) || artifactOutputItems[0];
  }, [artifactOutputItems, selectedOutputId]);
  const selectedOutputMarkdownPath = selectedOutput ? outputMarkdownPath(selectedOutput) : null;
  const handleOpenFileLink = useCallback((target: FileLinkTarget) => {
    const workdir = previewWorkdir.trim();
    const resolvedPath = workdir ? resolveTaskFilePath(workdir, target) : target.path;
    setContextOpen(true);
    setShelfTab('files');
    if (workdir) setFileBrowserPath(resolvedPath);
    void api.openInEditor(resolvedPath).catch(() => {});
  }, [previewWorkdir]);
  const saveBackground = useCallback(async () => {
    if (!task || backgroundSaving) return;
    setBackgroundSaving(true);
    setBackgroundError(null);
    try {
      const result = await api.updateProTaskBackground(task.id, backgroundDraft);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to save background');
      onTaskUpdated?.(result.task);
      setBackgroundDirty(false);
    } catch (err) {
      setBackgroundError(err instanceof Error ? err.message : 'Failed to save background');
    } finally {
      setBackgroundSaving(false);
    }
  }, [backgroundDraft, backgroundSaving, onTaskUpdated, task]);
  const improveBackgroundWithAgent = useCallback(() => {
    if (!task) return;
    setContextOpen(false);
    void onStartStatusChat(task, 'refinement', [
      IMPROVE_TICKET_BACKGROUND_PROMPT,
      backgroundDraft.trim() ? `\n\nCurrent Background:\n${backgroundDraft.trim()}` : '',
    ].join(''), undefined, 'Improve background');
  }, [backgroundDraft, onStartStatusChat, task]);
  const openArtifactTab = useCallback((tab: TicketArtifactTab) => {
    setContextOpen(true);
    setShelfTab(tab);
    setSelectedOutputId(null);
  }, []);
  const updateStatusThenStartChat = useCallback(async (status: ProTaskStatus, prompt: string, displayPrompt: string) => {
    if (!task) return;
    let nextTask = task;
    if (task.status !== status) {
      const result = await api.updateProTaskStatus(task.id, status);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task status');
      nextTask = result.task;
      onTaskUpdated?.(nextTask);
    }
    await onStartStatusChat(nextTask, status, prompt, undefined, displayPrompt);
  }, [onStartStatusChat, onTaskUpdated, task]);
  const analyzeBackground = useCallback(() => {
    if (!task) return;
    void updateStatusThenStartChat('refinement', CREATE_TICKET_BACKGROUND_PROMPT, 'Start background').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start background analysis', false);
    });
  }, [task, toast, updateStatusThenStartChat]);
  const createClarificationDoc = useCallback(() => {
    openArtifactTab('clarification');
    void updateStatusThenStartChat('refinement', CREATE_CLARIFICATION_DOC_PROMPT, 'Start clarification').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start clarification', false);
    });
  }, [openArtifactTab, toast, updateStatusThenStartChat]);
  const startCodingFromLifecycle = useCallback(() => {
    openArtifactTab('implementation');
    void updateStatusThenStartChat('coding', START_CODING_PROMPT, 'Start coding').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start coding', false);
    });
  }, [openArtifactTab, toast, updateStatusThenStartChat]);
  const skipCodingAndAnalyze = useCallback(() => {
    openArtifactTab('implementation');
    void updateStatusThenStartChat('resolved', SKIP_CODING_ANALYZE_MR_PROMPT, 'Skip coding and analyze MR').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start MR analysis', false);
    });
  }, [openArtifactTab, toast, updateStatusThenStartChat]);
  const planSelfTest = useCallback(() => {
    openArtifactTab('test-cases');
    void updateStatusThenStartChat('resolved', SELF_TEST_CASES_PROMPT, 'Plan self test').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start self-test planning', false);
    });
  }, [openArtifactTab, toast, updateStatusThenStartChat]);
  const writeTestReport = useCallback(() => {
    openArtifactTab('test-report');
    void updateStatusThenStartChat('resolved', SELF_TEST_REPORT_PROMPT, 'Write test report').catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to start test report', false);
    });
  }, [openArtifactTab, toast, updateStatusThenStartChat]);
  const markTaskDone = useCallback(async () => {
    if (!task || task.status === 'done') return;
    try {
      const result = await api.updateProTaskStatus(task.id, 'done');
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to complete task');
      onTaskUpdated?.(result.task);
      toast('Task completed');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to complete task', false);
    }
  }, [onTaskUpdated, task, toast]);
  const confirmLatestStageOutput = useCallback(async () => {
    if (!task || confirmingStageOutput) return;
    const run = latestConfirmableStageRun(task);
    if (!run) {
      toast('No draft output to confirm', false);
      return;
    }
    setConfirmingStageOutput(true);
    try {
      const result = await api.confirmProTaskStageOutput(task.id, run.id);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to confirm output');
      onTaskUpdated?.(result.task);
      setContextOpen(true);
      setShelfTab(run.stage === 'coding' ? 'implementation' : run.stage === 'verification' ? 'test-report' : 'background');
      toast('Output confirmed');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to confirm output', false);
    } finally {
      setConfirmingStageOutput(false);
    }
  }, [confirmingStageOutput, onTaskUpdated, task, toast]);
  useEffect(() => {
    setContextOpen(true);
    setShelfTab('workflow');
    setFileBrowserPath(inferredWorkdir);
    setSelectedOutputId(null);
    setActiveChatWorkdir('');
    setBackgroundError(null);
  }, [inferredWorkdir, task?.id]);
  useEffect(() => {
    setBackgroundDraft(backgroundOutput?.summary || '');
    setBackgroundDirty(false);
    setBackgroundError(null);
  }, [backgroundOutput?.id, backgroundOutput?.summary, task?.id]);
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
  const assignee = fields.assignee || jiraRemoteSyncField(task.description, 'Assignee');
  const updatedAt = fields.updatedAt || jiraRemoteSyncField(task.description, 'Updated') || task.updatedAt;
  const createdAt = task.createdAt || jiraRemoteSyncField(task.description, 'Created');
  const assignedAssistantId = task.execution?.assistantId || task.defaultAssistantId || '';
  const assignAssistantOptions = taskAssistantOptions(assistants, assignedAssistantId);
  const displayKey = taskDisplayKey(task);
  const jiraUrl = jiraTaskUrl(task);
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
  const shelfTabs: Array<{ id: TicketDetailShelfTab; label: string; count?: number }> = [
    { id: 'workflow', label: 'Task workflow' },
    { id: 'files', label: 'Files', count: fileItems.length },
    { id: 'status', label: 'Overview' },
  ];
  const workflowAction = (
    <TicketCurrentWorkflowAction
      task={task}
      outputItems={outputItems}
      busyStage={busy?.taskId === task.id ? busy.stage : null}
      onAnalyzeBackground={analyzeBackground}
      onConfirmOutput={() => { void confirmLatestStageOutput(); }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-[var(--th-session-bg)]">
      <div className="relative z-50 flex h-[48px] shrink-0 items-center gap-3 border-b border-edge/55 bg-panel/72 px-4 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <TicketTypeIcon task={task} />
          {displayKey && <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">{displayKey}</span>}
          {jiraUrl ? (
            <a
              className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg transition-colors hover:text-primary hover:underline"
              href={jiraUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open in Jira: ${jiraUrl}`}
              aria-label={`Open ${displayKey || task.title} in Jira`}
            >
              {task.title}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={task.title}>{task.title}</span>
          )}
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
        'relative grid min-h-0 flex-1 overflow-hidden',
        contextOpen
          ? 'grid-rows-[minmax(0,1fr)_minmax(260px,38%)] min-[980px]:grid-cols-[minmax(0,1fr)_390px] min-[980px]:grid-rows-[minmax(0,1fr)]'
          : 'grid-cols-1',
      )}>
        <main className="min-h-0 min-w-0 overflow-hidden">
          <div className="flex h-full min-h-0 w-full flex-col">
            <div className="min-h-0 flex-1">
            <TaskChatWindow
              task={task}
              actions={actions}
              agents={agents}
              defaultAgent={defaultAgent}
              busyStage={busy?.taskId === task.id ? busy.stage : null}
              onStartStatusChat={onStartStatusChat}
              onOpenArtifacts={() => {
                setContextOpen(true);
                setShelfTab('workflow');
              }}
              artifactCount={outputItems.length}
              workflowAction={workflowAction}
              onCreateSideChatFromSelection={onCreateSideChatFromSelection}
              onCreateTodoFromSelection={onCreateTodoFromSelection}
              onOpenFileLink={handleOpenFileLink}
              onChatWorkdirChange={setActiveChatWorkdir}
              onTaskUpdated={onTaskUpdated}
              buildChatPrompt={buildChatPrompt}
              buildChatContext={buildChatContext}
              t={t}
            />
            </div>
          </div>
        </main>

        {contextOpen ? <aside className="relative min-h-0 min-w-0 overflow-hidden border-t border-edge/60 bg-panel/78 min-[980px]:border-l min-[980px]:border-t-0">
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
              {shelfTab === 'workflow' && (
                <TicketSidebarWorkflow
                  task={task}
                  outputItems={outputItems}
                  activeTab={shelfTab}
                  busyStage={busy?.taskId === task.id ? busy.stage : null}
                  onOpenArtifact={openArtifactTab}
                  onAnalyzeBackground={analyzeBackground}
                  onClarify={createClarificationDoc}
                  onStartCoding={startCodingFromLifecycle}
                  onSkipCoding={skipCodingAndAnalyze}
                  onPlanSelfTest={planSelfTest}
                  onWriteTestReport={writeTestReport}
                  onMarkDone={() => { void markTaskDone(); }}
                />
              )}
              {shelfTab === 'status' && (
                <div className="space-y-4">
                  <section className="rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                      <dt className="text-fg-5">Assign</dt>
                      <dd className="min-w-0">
                        <AssistantInlinePicker
                          value={assignedAssistantId}
                          options={assignAssistantOptions}
                          onChange={(assistantId) => onAssignAssistant(task, assistantId)}
                        />
                      </dd>
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
                      {task.plannedDate && (
                        <>
                          <dt className="text-fg-5">Planned day</dt>
                          <dd className="min-w-0 truncate text-fg-3">{plannedDateLabel(task.plannedDate, task.plannedDate)}</dd>
                          <dt className="text-fg-5">Linked task</dt>
                          <dd className="min-w-0 space-y-1.5">
                            <select
                              value={task.linkedTaskId || ''}
                              onChange={event => onMetaChange(task, { linkedTaskId: event.target.value || null })}
                              className="h-7 w-full rounded-md border border-transparent bg-transparent px-0 text-[12px] text-fg-3 outline-none transition hover:border-edge hover:bg-panel focus:border-primary/40"
                            >
                              <option value="">None</option>
                              {linkCandidates.map(candidate => (
                                <option key={candidate.id} value={candidate.id}>
                                  {taskDisplayKey(candidate) ? `${taskDisplayKey(candidate)} · ` : ''}{candidate.title}
                                </option>
                              ))}
                            </select>
                            {linkedTask && (
                              <button
                                type="button"
                                onClick={() => onOpenLinkedTask?.(linkedTask)}
                                className="truncate text-[11px] text-primary hover:text-primary/80"
                                title={linkedTask.title}
                              >
                                {taskDisplayKey(linkedTask) ? `${taskDisplayKey(linkedTask)} · ` : ''}{linkedTask.title}
                              </button>
                            )}
                          </dd>
                        </>
                      )}
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
                  <JiraRemoteUpdatePanel task={task} onTaskUpdated={onTaskUpdated} />
                </div>
              )}

              {shelfTab === 'files' && (
                <div className="space-y-3">
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

              {isTicketArtifactTab(shelfTab) && (
                <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
                  {shelfTab === 'raw' ? (
                    <section className="min-h-0 overflow-y-auto rounded-lg border border-edge/65 bg-panel-alt/55 px-3 py-3">
                      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-fg-2">Raw ticket description</div>
                        {jiraUrl && (
                          <a className="text-[11px] font-semibold text-primary hover:underline" href={jiraUrl} target="_blank" rel="noreferrer">
                            Jira
                          </a>
                        )}
                      </div>
                      <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-fg-3 prose-p:my-2 prose-li:my-1 prose-strong:text-fg">
                        {cleanTaskDescription(task) ? <TaskDescriptionMarkdown task={task} /> : TICKET_ARTIFACT_EMPTY.raw}
                      </div>
                    </section>
                  ) : shelfTab === 'background' ? (
                    <TicketBackgroundEditor
                      task={task}
                      output={backgroundOutput}
                      value={backgroundDraft}
                      dirty={backgroundDirty}
                      saving={backgroundSaving}
                      error={backgroundError}
                      onChange={(value) => {
                        setBackgroundDraft(value);
                        setBackgroundDirty(true);
                      }}
                      onSave={() => { void saveBackground(); }}
                      onImproveWithAgent={improveBackgroundWithAgent}
                    />
                  ) : artifactOutputItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-edge/70 px-3 py-8 text-center">
                      <div className="text-[12px] font-semibold text-fg-4">{TICKET_ARTIFACT_EMPTY[shelfTab]}</div>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {shelfTab === 'clarification' && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={!!busy} onClick={createClarificationDoc}>
                            Start
                          </Button>
                        )}
                        {shelfTab === 'implementation' && (
                          <>
                            <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" disabled={!!busy} onClick={startCodingFromLifecycle}>
                              Code
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={!!busy} onClick={skipCodingAndAnalyze}>
                              Skip
                            </Button>
                          </>
                        )}
                        {shelfTab === 'test-cases' && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={!!busy} onClick={planSelfTest}>
                            Plan
                          </Button>
                        )}
                        {shelfTab === 'test-report' && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={!!busy} onClick={writeTestReport}>
                            Report
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-h-0 space-y-2 overflow-y-auto">
                        {artifactOutputItems.map(output => {
                          const active = selectedOutput?.id === output.id;
                          return (
                            <button
                              key={output.id}
                              type="button"
                              onClick={() => setSelectedOutputId(output.id)}
                              className={cn(
                                'w-full rounded-lg border px-3 py-2.5 text-left transition-[border-color,background,transform] duration-150 active:translate-y-px',
                                active ? 'border-primary/32 bg-primary/[0.075]' : 'border-edge/65 bg-panel-alt/58 hover:border-edge-h hover:bg-panel-h/55',
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {output.stage && <Badge variant={stageTone(output.stage)}>{STAGE_LABEL[output.stage]}</Badge>}
                                <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{output.title}</div>
                              </div>
                              {output.summary && <div className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-fg-4">{output.summary}</div>}
                              {output.time && <div className="mt-2 text-[10px] text-fg-5">{formatTime(output.time)}</div>}
                            </button>
                          );
                        })}
                      </div>
                      {selectedOutput && (
                        <div className="min-h-[190px] border-t border-edge/55 pt-3">
                          {selectedOutput.summary && (
                            <GeneratedOutputCards
                              text={selectedOutput.summary}
                              compact
                              onOpenFileLink={handleOpenFileLink}
                              className="mb-2"
                            />
                          )}
                          {selectedOutputMarkdownPath && previewWorkdir ? (
                            <MarkdownFilePreviewCard
                              target={{ path: selectedOutputMarkdownPath }}
                              workdir={previewWorkdir}
                              onOpenFileLink={handleOpenFileLink}
                              t={t}
                            />
                          ) : selectedOutput.summary ? (
                            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge/40 bg-panel/50 px-3 py-2 text-[11.5px] leading-relaxed text-fg-3">
                              {selectedOutput.summary}
                            </pre>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </aside> : null}
      </div>
    </div>
  );
}

function TaskInlineWorkbench({
  task,
  linkCandidates,
  linkedTask,
  defaultAgent,
  agents,
  assistants,
  busy,
  reopening,
  workspaces,
  fallbackWorkdir,
  subtaskDraft,
  onMetaChange,
  onAssignAssistant,
  onStartStatusChat,
  onSubtaskDraftChange,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartSubtask,
  onTaskUpdated,
  onReopen,
  onSyncJira,
  syncingJira,
  onResetTask,
  resetting,
  onOpenFull,
  dailyItem,
  onBackToAction,
  onOpenLinkedTask,
  onCreateSideChatFromSelection,
  onCreateTodoFromSelection,
  buildChatPrompt,
  buildChatContext,
}: {
  task: ProTask | null;
  linkCandidates: ProTask[];
  linkedTask: ProTask | null;
  defaultAgent: string;
  agents: AgentRuntimeStatus[];
  assistants: AgentAssistant[];
  busy?: { taskId: string; stage: ProTaskStage } | null;
  reopening?: boolean;
  workspaces: WorkspaceEntry[];
  fallbackWorkdir?: string;
  subtaskDraft: { title: string; description: string; assignedAgent: string; assistantId: string };
  onMetaChange: (task: ProTask, patch: TaskMetaPatch) => void;
  onAssignAssistant: (task: ProTask, assistantId: string) => void;
  onStartStatusChat: (task: ProTask, status: ProTaskStatus, prompt?: string, agent?: string, displayPrompt?: string | null) => Promise<void>;
  onSubtaskDraftChange: (draft: { title: string; description: string; assignedAgent: string; assistantId: string }) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
  onStartSubtask: (task: ProTask, subtaskId: string) => void;
  onTaskUpdated?: (task: ProTask) => void;
  onReopen?: (task: ProTask) => void;
  onSyncJira?: (task: ProTask) => void;
  syncingJira?: boolean;
  onResetTask?: (task: ProTask) => void;
  resetting?: boolean;
  onOpenFull: () => void;
  dailyItem?: DailyItem | null;
  onBackToAction?: (item: DailyItem) => void;
  onOpenLinkedTask?: (task: ProTask) => void;
  onCreateSideChatFromSelection?: TaskSelectionSessionHandler<SelectionSideChatRequest>;
  onCreateTodoFromSelection?: TaskSelectionSessionHandler;
  buildChatPrompt: (task: ProTask, status: ProTaskStatus, prompt?: string) => string;
  buildChatContext: (task: ProTask, status: ProTaskStatus) => string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [task?.id]);

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
        linkCandidates={linkCandidates}
        linkedTask={linkedTask}
        defaultAgent={defaultAgent}
        agents={agents}
        assistants={assistants}
        busy={busy}
        reopening={reopening}
        workspaces={workspaces}
        fallbackWorkdir={fallbackWorkdir}
        subtaskDraft={subtaskDraft}
        onMetaChange={onMetaChange}
        onAssignAssistant={onAssignAssistant}
        onStartStatusChat={onStartStatusChat}
        onSubtaskDraftChange={onSubtaskDraftChange}
        onCreateSubtask={onCreateSubtask}
        onUpdateSubtaskStatus={onUpdateSubtaskStatus}
        onStartSubtask={onStartSubtask}
	        onTaskUpdated={onTaskUpdated}
		        onReopen={onReopen}
		        onOpenLinkedTask={onOpenLinkedTask}
        onCreateSideChatFromSelection={onCreateSideChatFromSelection}
        onCreateTodoFromSelection={onCreateTodoFromSelection}
        buildChatPrompt={buildChatPrompt}
        buildChatContext={buildChatContext}
        actions={(
          <>
            {dailyItem && onBackToAction && (
              <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => onBackToAction(dailyItem)}>
                Back to action
              </Button>
            )}
	            <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onOpenFull}>
	              Open
	            </Button>
            {((onSyncJira && task.jiraKey) || onResetTask) && (
              <div className="relative z-[60]">
                <Button
                  variant="ghost"
                  size="icon"
                  className="!h-7 !w-7 text-[12px]"
                  aria-label="Task actions"
                  aria-expanded={menuOpen}
                  onClick={event => {
                    event.stopPropagation();
                    setMenuOpen(open => !open);
                  }}
                >
                  ...
                </Button>
                {menuOpen && (
                  <div
                    className="absolute right-0 top-[calc(100%+8px)] z-[120] w-40 overflow-hidden rounded-xl border border-edge-h/70 bg-dropdown p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18),0_4px_12px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.03] backdrop-blur-md"
                    role="menu"
                    onClick={event => event.stopPropagation()}
                  >
                    {onSyncJira && task.jiraKey && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!!syncingJira}
                        onClick={() => {
                          setMenuOpen(false);
                          onSyncJira(task);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-fg-3 transition-colors hover:bg-panel-h hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                      >
                        {syncingJira ? (
                          <Spinner />
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 12a9 9 0 0 1-15 6.7" />
                            <path d="M3 12a9 9 0 0 1 15-6.7" />
                            <path d="M18 3v5h-5" />
                            <path d="M6 21v-5h5" />
                          </svg>
                        )}
                        <span>Sync Jira</span>
                      </button>
                    )}
                    {onResetTask && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!!resetting}
                        onClick={() => {
                          setMenuOpen(false);
                          onResetTask(task);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-warn transition-colors hover:bg-warn/[0.10] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {resetting ? (
                          <Spinner />
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.7" />
                            <path d="M3 4v6h6" />
                          </svg>
                        )}
                        <span>Reset task</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
	          </>
	        )}
	      />
    </aside>
  );
}

function ClosedJiraTasksSection({
  tasks,
  selectedTask,
  reopeningTaskId,
  onOpenTask,
  onReopen,
}: {
  tasks: ProTask[];
  selectedTask: ProTask | null;
  reopeningTaskId: string | null;
  onOpenTask: (task: ProTask) => void;
  onReopen: (task: ProTask) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="mt-3 rounded-xl border border-edge/50 bg-panel-alt/35 px-3 py-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-fg-2">Closed</div>
          <div className="truncate text-[10px] text-fg-5">Remote status is closed</div>
        </div>
        <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{tasks.length}</Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {tasks.slice(0, 12).map(task => (
          <div
            key={task.id}
            className={cn(
              'min-w-0 rounded-lg border border-edge/55 bg-panel/62 px-3 py-2 text-left transition hover:border-edge-h hover:bg-panel-h',
              selectedTask?.id === task.id && 'border-primary/35 bg-primary/[0.055]',
            )}
          >
            <button type="button" onClick={() => onOpenTask(task)} className="block w-full min-w-0 text-left">
              <div className="mb-1 flex min-w-0 items-center gap-2">
                {taskDisplayKey(task) && <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">{taskDisplayKey(task)}</span>}
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
                onClick={() => { onReopen(task); }}
              >
                {reopeningTaskId === task.id ? <Spinner /> : null}
                Reopen
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function JiraSyncMonitor({
  runs,
  selectedRun,
  detailsOpen,
  syncing,
  compact = false,
  onSync,
  onSyncTicket,
  onStop,
  stopping,
  onSelectRun,
  onCloseDetails,
  onApplyItems,
  applying,
}: {
  runs: JiraSyncRun[];
  selectedRun: JiraSyncRun | null;
  detailsOpen: boolean;
  syncing: boolean;
  compact?: boolean;
  onSync: () => void;
  onSyncTicket: () => void;
  onStop: (runId: string) => void;
  stopping: boolean;
  onSelectRun: (runId: string) => void;
  onCloseDetails: () => void;
  onApplyItems: (runId: string, itemIds: string[]) => void;
  applying: boolean;
}) {
  const activeRun = syncRunActive(selectedRun) ? selectedRun : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenuSoonRef = useRef<number | null>(null);
  const scheduleMenuClose = () => {
    closeMenuSoonRef.current = window.setTimeout(() => setMenuOpen(false), 120);
  };
  const cancelMenuClose = () => {
    if (closeMenuSoonRef.current != null) {
      window.clearTimeout(closeMenuSoonRef.current);
      closeMenuSoonRef.current = null;
    }
  };
  useEffect(() => () => {
    if (closeMenuSoonRef.current != null) window.clearTimeout(closeMenuSoonRef.current);
  }, []);
  return (
    <>
      <div className={cn(
        'flex min-w-0 items-center gap-2',
        compact ? 'flex-none' : 'flex-1 border-l border-edge/60 pl-3',
      )}>
        <span className={cn('shrink-0 text-[12px] font-semibold text-fg-3', compact && 'text-[11px]')}>Jira sync</span>
        <div
          className="relative inline-flex shrink-0"
          onBlur={scheduleMenuClose}
          onFocus={cancelMenuClose}
          onMouseEnter={cancelMenuClose}
          onMouseLeave={scheduleMenuClose}
        >
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex h-6 w-7 items-center justify-center rounded-l-md border border-edge bg-panel-alt text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg disabled:pointer-events-none disabled:opacity-55"
            title={syncing ? 'Syncing Jira' : 'Sync all Jira tickets'}
            aria-label={syncing ? 'Syncing Jira' : 'Sync all Jira tickets'}
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
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            className="inline-flex h-6 w-5 items-center justify-center rounded-r-md border border-l-0 border-edge bg-panel-alt text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
            title="Jira sync options"
            aria-label="Jira sync options"
            aria-expanded={menuOpen}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-7 z-50 min-w-[158px] rounded-md border border-edge bg-popover p-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSync();
                }}
                disabled={syncing}
                className="flex h-8 w-full items-center rounded px-2 text-left text-[12px] text-fg-3 hover:bg-panel-h disabled:pointer-events-none disabled:opacity-55"
              >
                Sync all tickets
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSyncTicket();
                }}
                className="flex h-8 w-full items-center rounded px-2 text-left text-[12px] text-fg-3 hover:bg-panel-h"
              >
                Sync one ticket
              </button>
            </div>
          )}
        </div>
        {activeRun && (
          <button
            type="button"
            onClick={() => onStop(activeRun.id)}
            disabled={stopping}
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-warn/35 bg-warn/10 px-2 text-[11px] font-medium text-warn transition-colors hover:border-warn/60 hover:bg-warn/15 disabled:pointer-events-none disabled:opacity-55"
            title="Stop Jira sync"
          >
            Stop
          </button>
        )}
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
            <JiraSyncDetailsContent run={selectedRun} onApplyItems={onApplyItems} applying={applying} />
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

function JiraSyncDetailsContent({
  run,
  onApplyItems,
  applying,
}: {
  run: JiraSyncRun;
  onApplyItems: (runId: string, itemIds: string[]) => void;
  applying: boolean;
}) {
  const counts = syncChangeCounts(run);
  const hasChanges = (run.changes || []).length > 0;
  const candidateItems = (run.items || []).filter(item => item.status !== 'applied');
  const appliedItems = (run.items || []).filter(item => item.status === 'applied');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(candidateItems.filter(item => item.selected !== false).map(item => item.id)));
  useEffect(() => {
    setSelectedIds(new Set(candidateItems.filter(item => item.selected !== false).map(item => item.id)));
  }, [run.id, run.updatedAt]);
  const toggleItem = (itemId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const selectedCount = selectedIds.size;
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
            {candidateItems.length > 0 && (
              <div className="mb-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold text-fg-3">Sync candidates</div>
                    <div className="mt-0.5 text-[11px] text-fg-5">{selectedCount} of {candidateItems.length} selected{appliedItems.length ? ` · ${appliedItems.length} already applied` : ''}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-edge bg-panel-alt px-2 py-1 text-[11px] text-fg-4 hover:border-edge-h hover:bg-panel-h"
                      onClick={() => setSelectedIds(new Set(candidateItems.map(item => item.id)))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-edge bg-panel-alt px-2 py-1 text-[11px] text-fg-4 hover:border-edge-h hover:bg-panel-h"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={!selectedCount || applying}
                      onClick={() => onApplyItems(run.id, [...selectedIds])}
                    >
                      {applying ? 'Applying' : 'Apply selected'}
                    </Button>
                  </div>
                </div>
                <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                  {candidateItems.map(item => (
                    <label key={item.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-edge/45 bg-panel/75 px-2.5 py-2 hover:border-edge-h hover:bg-panel-h">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleItem(item.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          {item.jiraKey && <span className="font-mono text-[11px] text-primary">{item.jiraKey}</span>}
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-3">{item.title}</span>
                          {item.ticketStatus && <Badge variant="muted">{item.ticketStatus}</Badge>}
                        </span>
                        <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-5">
                          {item.sprint && <span>sprint {item.sprint}</span>}
                          {item.assignee && <span>assignee {item.assignee}</span>}
                          {item.priority && <span>priority {item.priority}</span>}
                          {item.updatedAt && <span>updated {formatTime(item.updatedAt)}</span>}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
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

function parsePromptEditSessionKey(value: string | null | undefined): { agent: string; sessionId: string } | null {
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { agent: value.slice(0, idx), sessionId: value.slice(idx + 1) };
}

function promptForAssistant(assistant: AgentAssistant): string {
  return assistant.prompt || assistant.defaultPrompt || assistant.responsibility || '';
}

function buildJiraPromptEditRequest(assistant: AgentAssistant, currentPrompt: string, idea: string): string {
  return [
    `You are helping edit the prompt for ${assistant.name}.`,
    `Assistant responsibility:\n${assistant.responsibility || 'Own the Jira dashboard workflow.'}`,
    '',
    'Act as a senior prompt architect. Convert the user request into a complete, production-ready replacement prompt.',
    'Use prompt best practices: clear role, scope, inputs, workflow, decision rules, constraints, safety guardrails, output expectations, and failure handling.',
    'Ask a concise clarifying question only if the request is impossible to satisfy safely without more information. Otherwise, generate the new prompt directly.',
    'Keep the prompt specific to the Jira dashboard owner assistant. Do not produce a short note, a partial diff, or commentary-only output.',
    '',
    'Current prompt:',
    '<CurrentPrompt>',
    currentPrompt,
    '</CurrentPrompt>',
    '',
    'User change request:',
    idea,
    '',
    'When ready, output the complete replacement prompt exactly once using this block:',
    '<PikiclawPromptPatch>',
    'Full replacement prompt goes here.',
    '</PikiclawPromptPatch>',
  ].join('\n');
}

function JiraAssistantPromptModal({
  open,
  assistant,
  workdir,
  defaultAgent,
  onClose,
  onSaved,
}: {
  open: boolean;
  assistant: AgentAssistant | null;
  workdir?: string;
  defaultAgent: string;
  onClose: () => void;
  onSaved: (assistant: AgentAssistant) => void;
}) {
  const toast = useStore(s => s.toast);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [customized, setCustomized] = useState(false);
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [activeSession, setActiveSession] = useState<{ agent: string; sessionId: string } | null>(null);
  const [lastAppliedPatch, setLastAppliedPatch] = useState('');
  const runtimeWorkdir = workdir || '';
  const agent = assistant?.preferredAgents?.[0] || defaultAgent || 'codex';
  const generated = useAssistantGeneratedOutput({
    active: open && !!activeSession && !!runtimeWorkdir,
    workdir: runtimeWorkdir,
    agent: activeSession?.agent,
    sessionId: activeSession?.sessionId,
  });

  useEffect(() => {
    let cancelled = false;
    if (!open || !assistant) return undefined;
    setLoading(true);
    setPrompt('');
    setDefaultPrompt('');
    setIdea('');
    setActiveSession(null);
    setLastAppliedPatch('');
    void api.getProAssistantPrompt(assistant.id)
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setPrompt(res.prompt || promptForAssistant(assistant));
          setDefaultPrompt(res.defaultPrompt || assistant.defaultPrompt || '');
          setCustomized(!!res.customized);
        } else {
          toast(res.error || 'Failed to load prompt', false);
        }
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Failed to load prompt', false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assistant, open, toast]);

  useEffect(() => {
    const nextPrompt = generated.promptPatch?.trim();
    if (!nextPrompt || nextPrompt === lastAppliedPatch) return;
    setPrompt(nextPrompt);
    setLastAppliedPatch(nextPrompt);
    toast('Prompt draft updated. Review it, then save when ready.', true);
  }, [generated.promptPatch, lastAppliedPatch, toast]);

  const changedFromDefault = prompt.trim() !== defaultPrompt.trim();
  const statusText = working
    ? 'Working on the prompt...'
    : generated.loading && activeSession
      ? 'Reading assistant output...'
      : generated.error
        ? generated.error
        : lastAppliedPatch
          ? 'Generated prompt is loaded above. You can edit it before saving.'
          : 'Type the change you want. The assistant will rewrite the prompt above.';

  const startPromptEdit = async () => {
    const request = idea.trim();
    if (!assistant || !request || !runtimeWorkdir || working) return;
    setWorking(true);
    try {
      const result = await api.sendSessionMessage(
        runtimeWorkdir,
        activeSession?.agent || agent,
        activeSession?.sessionId || '',
        buildJiraPromptEditRequest(assistant, prompt, request),
        { timeoutMs: 30_000, displayPrompt: request },
      );
      if (!result.ok) throw new Error(result.error || 'Failed to start prompt edit');
      const nextSession = parsePromptEditSessionKey(result.sessionKey);
      if (nextSession) setActiveSession(nextSession);
      setIdea('');
      toast('Assistant is working on the prompt.', true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start prompt edit', false);
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (!assistant || saving) return;
    setSaving(true);
    try {
      const res = await api.updateProAssistantPrompt(assistant.id, { prompt });
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to save prompt');
      setCustomized(!!res.customized);
      onSaved(res.assistant);
      toast('Prompt saved', true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save prompt', false);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!assistant || saving) return;
    setSaving(true);
    try {
      const res = await api.resetProAssistantPrompt(assistant.id);
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to reset prompt');
      setPrompt(res.prompt || '');
      setDefaultPrompt(res.defaultPrompt || '');
      setCustomized(false);
      setLastAppliedPatch('');
      onSaved(res.assistant);
      toast('Prompt reset', true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset prompt', false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open && !!assistant}
      onClose={onClose}
      wide
      panelStyle={{ maxWidth: 'min(980px, calc(100vw - 32px))', maxHeight: 'min(92vh, 900px)' }}
    >
      <ModalHeader
        title={assistant ? `${assistant.name} prompt` : 'Jira Assistant prompt'}
        description={assistant?.responsibility}
        onClose={onClose}
      />
      <div className="space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="accent">{assistant?.surfaceId || 'dashboard'}</Badge>
          <Badge variant="muted">{assistant?.kind || 'page-owner'}</Badge>
          {customized ? <Badge variant="warn">Customized</Badge> : <Badge variant="ok">Default</Badge>}
          {changedFromDefault && <Badge variant="muted">edited draft</Badge>}
        </div>
        <textarea
          autoFocus
          value={prompt}
          disabled={loading}
          onChange={event => setPrompt(event.target.value)}
          spellCheck={false}
          className="min-h-[430px] w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 font-mono text-[13px] leading-relaxed text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)] disabled:opacity-60"
          placeholder={loading ? 'Loading prompt...' : 'Prompt'}
        />
        <form
          className="rounded-lg border border-edge bg-panel-alt p-3"
          onSubmit={event => {
            event.preventDefault();
            void startPromptEdit();
          }}
        >
          <div className="relative">
            <input
              value={idea}
              onChange={event => setIdea(event.target.value)}
              disabled={loading || working || !runtimeWorkdir}
              placeholder="Tell the assistant how to improve this prompt..."
              className="h-10 w-full rounded-md border border-control-border bg-control px-3 pr-12 text-[13px] text-fg outline-none transition placeholder:text-fg-5/65 focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)] disabled:opacity-60"
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              aria-label="Generate prompt"
              className="absolute right-1 top-1 h-8 w-8"
              disabled={!idea.trim() || loading || working || !runtimeWorkdir}
            >
              {working ? <Spinner /> : null}
              {!working && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              )}
            </Button>
          </div>
          <div className={cn('mt-2 text-[11px] leading-relaxed', generated.error ? 'text-err' : 'text-fg-5')}>
            {runtimeWorkdir ? statusText : 'Select a workspace before generating prompt changes.'}
          </div>
        </form>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-[11px] text-fg-5">{runtimeWorkdir || 'No workspace selected'}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={saving} onClick={onClose}>Close</Button>
            <Button variant="secondary" disabled={saving || loading} onClick={() => void reset()}>
              {saving ? <Spinner /> : null}
              Reset
            </Button>
            <Button variant="primary" disabled={saving || loading || !prompt.trim()} onClick={() => void save()}>
              {saving ? <Spinner /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function JiraDashboardSettingsMenu({
  canOpenAssistantPrompt,
  canOpenSyncDetails,
  fixVersion,
  fixVersionOptions,
  onOpenAssistantPrompt,
  onOpenSyncDetails,
  onRefreshSync,
  onOpenWorkflowSettings,
  onFixVersionChange,
}: {
  canOpenAssistantPrompt: boolean;
  canOpenSyncDetails: boolean;
  fixVersion: string;
  fixVersionOptions: string[];
  onOpenAssistantPrompt: () => void;
  onOpenSyncDetails: () => void;
  onRefreshSync: () => void;
  onOpenWorkflowSettings: () => void;
  onFixVersionChange: (fixVersion: string) => void;
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
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 overflow-hidden rounded-lg border border-edge bg-panel py-1 text-[12px] shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
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
          <label className="block px-3 py-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Fix version</span>
            <select
              value={fixVersion}
              onChange={event => onFixVersionChange(event.target.value || 'all')}
              className="h-8 w-full rounded-md border border-control-border bg-control px-2 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
            >
              <option value="all">All fix versions</option>
              {fixVersionOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div className="my-1 border-t border-edge/60" />
          <button
            type="button"
            disabled={!canOpenAssistantPrompt}
            className="flex w-full items-center px-3 py-2 text-left text-fg-3 transition hover:bg-panel-h disabled:pointer-events-none disabled:opacity-45"
            onClick={() => runAction(onOpenAssistantPrompt)}
          >
            Jira Assistant prompt
          </button>
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

function JiraAssistantCoordinator({
  tasks,
  selectedTask,
  selectedDate,
  busy,
  onOpenTask,
  onClarifyTask,
  onCodeTask,
  onReviewTask,
}: {
  tasks: ProTask[];
  selectedTask: ProTask | null;
  selectedDate: string;
  busy?: { taskId: string; stage: ProTaskStage } | null;
  onOpenTask: (task: ProTask) => void;
  onClarifyTask: (task: ProTask) => void;
  onCodeTask: (task: ProTask) => void;
  onReviewTask: (task: ProTask) => void;
}) {
  const activeTasks = tasks.filter(task => !isClosedRemoteTask(task));
  const readyTasks = activeTasks.filter(task => task.status === 'backlog' || task.status === 'refinement');
  const workingTasks = activeTasks.filter(task => task.status === 'coding');
  const reviewTasks = activeTasks.filter(task => task.status === 'resolved');
  const blockedTasks = activeTasks.filter(task => {
    const latest = latestTaskStageRun(task);
    return latest?.status === 'failed' || latest?.status === 'waiting-user' || task.subTasks.some(item => item.status === 'blocked');
  });
  const todayTasks = activeTasks.filter(task => task.plannedDate === selectedDate);
  const nextReady = readyTasks[0] || workingTasks[0] || reviewTasks[0] || null;
  const nextBlocked = blockedTasks[0] || null;
  const selectedBusy = !!selectedTask && busy?.taskId === selectedTask.id;
  const selectedLabel = selectedTask
    ? `${taskDisplayKey(selectedTask) ? `${taskDisplayKey(selectedTask)} · ` : ''}${selectedTask.title}`
    : 'Select a task to coordinate';
  const stats = [
    { label: 'Today', value: todayTasks.length, tone: 'muted' as const },
    { label: 'Ready', value: readyTasks.length, tone: 'accent' as const },
    { label: 'Working', value: workingTasks.length, tone: 'warn' as const },
    { label: 'Review', value: reviewTasks.length, tone: 'accent' as const },
    { label: 'Blocked', value: blockedTasks.length, tone: blockedTasks.length ? 'warn' as const : 'muted' as const },
  ];

  return (
    <section className="mb-3 rounded-xl border border-edge/55 bg-panel-alt/45 px-3 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="accent">Jira Assistant</Badge>
            <span className="min-w-0 truncate text-[12px] font-semibold text-fg-3" title={selectedLabel}>{selectedLabel}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
            {stats.map(item => (
              <span key={item.label} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-edge/55 bg-panel/65 px-2 text-[11px] text-fg-4">
                <span>{item.label}</span>
                <Badge variant={item.tone} className="h-4 px-1.5 text-[9.5px]">{item.value}</Badge>
              </span>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
          {nextBlocked && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onOpenTask(nextBlocked)}>
              Open blocker
            </Button>
          )}
          {nextReady && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onOpenTask(nextReady)}>
              Next task
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!selectedTask || selectedBusy}
            onClick={() => selectedTask && onClarifyTask(selectedTask)}
          >
            {selectedBusy && busy?.stage === 'refinement' ? <Spinner /> : null}
            Clarify
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!selectedTask || selectedBusy}
            onClick={() => selectedTask && onCodeTask(selectedTask)}
          >
            {selectedBusy && busy?.stage === 'coding' ? <Spinner /> : null}
            Code
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!selectedTask || selectedBusy}
            onClick={() => selectedTask && onReviewTask(selectedTask)}
          >
            {selectedBusy && busy?.stage === 'verification' ? <Spinner /> : null}
            Review
          </Button>
        </div>
      </div>
    </section>
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
                              {taskDisplayKey(task) && <span className="shrink-0 font-mono text-[11px] text-primary">{taskDisplayKey(task)}</span>}
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
  const location = useLocation();
  const navigate = useNavigate();
  const standaloneDailyRoute = location.pathname === '/daily';
  const diagnosticsRoute = location.pathname === '/task-diagnostics';
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [tasks, setTasks] = useState<ProTask[]>([]);
  const [dailyItems, setDailyItems] = useState<DailyItem[]>([]);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [quickTodoOpen, setQuickTodoOpen] = useState(false);
  const [quickTodoText, setQuickTodoText] = useState('');
  const [analyzeTicketOpen, setAnalyzeTicketOpen] = useState(false);
  const [analyzeTicketPromptOpen, setAnalyzeTicketPromptOpen] = useState(false);
  const [analyzeTicketInitialQuery, setAnalyzeTicketInitialQuery] = useState('');
  const [analyzeTicketBusy, setAnalyzeTicketBusy] = useState(false);
  const [syncTicketOpen, setSyncTicketOpen] = useState(false);
  const [syncTicketInitialQuery, setSyncTicketInitialQuery] = useState('');
  const [syncTicketBusy, setSyncTicketBusy] = useState(false);
  const [syncTicketProgress, setSyncTicketProgress] = useState<SyncTicketProgress>({ status: 'idle' });
  const [taskSpaces, setTaskSpaces] = useState<TaskSpace[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(standaloneDailyRoute ? DAILY_VIEW_ID : readStoredTaskSelectedSpace());
  const [dailyDateAuto, setDailyDateAuto] = useState<boolean>(() => !normalizeDailyDateParam(new URLSearchParams(location.search).get('date')));
  const [selectedDailyDate, setSelectedDailyDate] = useState<string>(() => (
    normalizeDailyDateParam(new URLSearchParams(location.search).get('date')) || localDateInputValue()
  ));
  const [dailyQuickAdd, setDailyQuickAdd] = useState('');
  const [spaceSidebarCollapsed, setSpaceSidebarCollapsed] = useState<boolean>(() => readStoredTaskSpaceSidebarCollapsed());
  const [spaceSearchFocusTick, setSpaceSearchFocusTick] = useState(0);
  const [taskDetailLayout, setTaskDetailLayout] = useState<TaskDetailLayout>(() => readStoredTaskDetailLayout());
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [todoCreating, setTodoCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [dailyCreateOpen, setDailyCreateOpen] = useState(false);
  const [dailySourceOpen, setDailySourceOpen] = useState(false);
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false);
  const [spaceCreateBusy, setSpaceCreateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jiraAssistantPromptOpen, setJiraAssistantPromptOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [taskDeleteTarget, setTaskDeleteTarget] = useState<ProTask | null>(null);
  const [resettingTaskId, setResettingTaskId] = useState<string | null>(null);
  const [taskResetTarget, setTaskResetTarget] = useState<ProTask | null>(null);
  const [savingJiraFieldsTaskId, setSavingJiraFieldsTaskId] = useState<string | null>(null);
  const [syncingJiraTaskId, setSyncingJiraTaskId] = useState<string | null>(null);
  const [reopeningTaskId, setReopeningTaskId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<JiraColumnKey | null>(null);
  const [jiraConfig, setJiraConfig] = useState<JiraWorkflowConfig>(DEFAULT_JIRA_ASSISTANT_CONFIG);
  const [selectedTicketType, setSelectedTicketType] = useState<string>('all');
  const [activeSprint, setActiveSprint] = useState<string>(() => readStoredJiraActiveSprint());
  const [selectedSprint, setSelectedSprint] = useState<string>(() => readStoredJiraActiveSprint());
  const [selectedFixVersion, setSelectedFixVersion] = useState<string>('all');
  const [selectedJiraStatus, setSelectedJiraStatus] = useState<string>('all');
  const [jiraSourceControlsOpen, setJiraSourceControlsOpen] = useState(false);
  const [jiraMobileActionsOpen, setJiraMobileActionsOpen] = useState(false);
  const [ticketQuery, setTicketQuery] = useState('');
  const [syncRuns, setSyncRuns] = useState<JiraSyncRun[]>([]);
  const [selectedSyncRunId, setSelectedSyncRunId] = useState<string | null>(null);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncStopBusy, setSyncStopBusy] = useState(false);
  const [syncApplyBusy, setSyncApplyBusy] = useState(false);
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
  const focusOpenTaskNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (standaloneDailyRoute) {
      setSelectedSpaceId(current => current === DAILY_VIEW_ID ? current : DAILY_VIEW_ID);
      return;
    }
    if (!standaloneDailyRoute) {
      setSelectedSpaceId(current => current === DAILY_VIEW_ID ? readStoredTaskSelectedSpace() : current);
    }
  }, [location.pathname, standaloneDailyRoute]);

  useEffect(() => {
    if (standaloneDailyRoute || selectedSpaceId === DAILY_VIEW_ID) return;
    writeStoredTaskSelectedSpace(selectedSpaceId);
  }, [selectedSpaceId, standaloneDailyRoute]);

  useEffect(() => {
    if (loading || standaloneDailyRoute || selectedSpaceId === DAILY_VIEW_ID) return;
    const builtIn = selectedSpaceId === ALL_TASKS_SPACE_ID || selectedSpaceId === JIRA_TASK_SPACE_ID || selectedSpaceId === PERSONAL_TASK_SPACE_ID || selectedSpaceId === ANALYZE_TASK_SPACE_ID;
    if (!builtIn && !taskSpaces.some(space => space.id === selectedSpaceId)) {
      setSelectedSpaceId(JIRA_TASK_SPACE_ID);
    }
  }, [loading, selectedSpaceId, standaloneDailyRoute, taskSpaces]);

  useEffect(() => {
    if (!standaloneDailyRoute) return;
    const dateParam = normalizeDailyDateParam(new URLSearchParams(location.search).get('date'));
    const date = dateParam || localDateInputValue();
    setDailyDateAuto(!dateParam);
    setSelectedDailyDate(current => current === date ? current : date);
  }, [location.search, standaloneDailyRoute]);

  useEffect(() => {
    if (!dailyDateAuto) return;
    const syncToday = () => {
      const today = localDateInputValue();
      setSelectedDailyDate(current => current === today ? current : today);
    };
    syncToday();
    const timer = window.setInterval(syncToday, 60_000);
    return () => window.clearInterval(timer);
  }, [dailyDateAuto]);

  const updateSelectedDailyDate = useCallback((date: string) => {
    const nextDate = normalizeDailyDateParam(date) || localDateInputValue();
    const today = localDateInputValue();
    setDailyDateAuto(nextDate === today);
    setSelectedDailyDate(nextDate);
    if (!standaloneDailyRoute) return;
    const params = new URLSearchParams(location.search);
    if (nextDate === today) params.delete('date');
    else params.set('date', nextDate);
    const query = params.toString();
    navigate(query ? `/daily?${query}` : '/daily', { replace: true });
  }, [location.search, navigate, standaloneDailyRoute]);

  const taskSpaceCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [ALL_TASKS_SPACE_ID]: tasks.length,
    };
    for (const task of tasks) {
      const spaceId = task.spaceId || (task.kind.startsWith('jira') ? JIRA_TASK_SPACE_ID : PERSONAL_TASK_SPACE_ID);
      counts[spaceId] = (counts[spaceId] || 0) + 1;
    }
    return counts;
  }, [selectedDailyDate, tasks]);
  const dailyView = selectedSpaceId === DAILY_VIEW_ID;
  const activeTaskSpace = useMemo(() => taskSpaces.find(space => space.id === selectedSpaceId) || null, [selectedSpaceId, taskSpaces]);
  const activeSpaceIsJira = selectedSpaceId === JIRA_TASK_SPACE_ID || activeTaskSpace?.kind === 'jira';
  const jiraOwnerAssistant = useMemo(
    () => assistants.find(assistant => assistant.id === 'assistant_dashboard_owner')
      || assistants.find(assistant => assistant.kind === 'page-owner' && assistant.surfaceId === 'dashboard')
      || null,
    [assistants],
  );
  const jiraOwnerAssistantPrompt = useMemo(() => (
    jiraOwnerAssistant?.prompt
    || jiraOwnerAssistant?.defaultPrompt
    || jiraOwnerAssistant?.responsibility
    || ''
  ), [jiraOwnerAssistant]);
  const activeSpaceTasks = useMemo(() => {
    if (selectedSpaceId === DAILY_VIEW_ID) {
      return tasks.filter(task => task.plannedDate === selectedDailyDate);
    }
    if (selectedSpaceId === ALL_TASKS_SPACE_ID) return tasks;
    return tasks.filter(task => (task.spaceId || (task.kind.startsWith('jira') ? JIRA_TASK_SPACE_ID : PERSONAL_TASK_SPACE_ID)) === selectedSpaceId);
  }, [selectedDailyDate, selectedSpaceId, tasks]);
  const jiraFilterOptions = useMemo(() => buildJiraFilterOptions(activeSpaceTasks), [activeSpaceTasks]);
  const visibleTasks = useMemo(() => {
    const normalizedQuery = ticketQuery.trim().toLowerCase();
    if (!dailyView && activeSpaceIsJira) {
      return activeSpaceTasks.filter(task => jiraTaskMatchesFilters(task, {
        ticketType: selectedTicketType === 'all' ? '' : selectedTicketType,
        query: ticketQuery,
        sprint: selectedSprint === 'all' ? '' : selectedSprint,
        fixVersion: selectedFixVersion === 'all' ? '' : selectedFixVersion,
        status: selectedJiraStatus === 'all' ? '' : selectedJiraStatus,
      }));
    }
    if (!normalizedQuery) return activeSpaceTasks;
    return activeSpaceTasks.filter(task => [
      task.jiraKey,
      task.title,
      task.description,
      task.jiraFields?.status,
      task.jiraFields?.assignee,
      task.jiraFields?.reporter,
      task.sprint,
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery));
  }, [activeSpaceIsJira, activeSpaceTasks, dailyView, selectedFixVersion, selectedJiraStatus, selectedSprint, selectedTicketType, ticketQuery]);
  const dailySourceTasks = useMemo(() => {
    const normalizedQuery = ticketQuery.trim().toLowerCase();
    return tasks
      .filter(task => task.plannedDate !== selectedDailyDate && displayTaskStatus(task.status) !== 'done')
      .filter(task => {
        if (!normalizedQuery) return true;
        return [
          task.jiraKey,
          task.title,
          task.description,
          task.jiraFields?.status,
          task.jiraFields?.assignee,
          task.jiraFields?.reporter,
          task.sprint,
        ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 12);
  }, [selectedDailyDate, tasks, ticketQuery]);
  const dailyTodoItems = useMemo(() => {
    const normalizedQuery = ticketQuery.trim().toLowerCase();
    return todoItems
      .filter(item => item.status === 'open')
      .filter(item => {
        if (!normalizedQuery) return true;
        return [item.title, item.body, item.source?.quote].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 12);
  }, [ticketQuery, todoItems]);
  const tasksById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
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
        tasksInColumn.sort((a, b) => column.key === 'backlog'
          ? compareBacklogTasks(a, b, mode)
          : mode === 'asc'
            ? taskSyncSortTime(a) - taskSyncSortTime(b)
            : taskSyncSortTime(b) - taskSyncSortTime(a));
      }
    }
    return grouped;
  }, [boardTasks, columnManualOrder, columnSortModes]);
  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedId) || null, [selectedId, tasks]);
  const jiraProjectKeyHint = useMemo(() => {
    const selectedProject = jiraProjectKeyFromIssueKey(selectedTask?.jiraKey);
    if (selectedProject) return selectedProject;
    for (const task of activeSpaceTasks) {
      const project = jiraProjectKeyFromIssueKey(task.jiraKey);
      if (project) return project;
    }
    return '';
  }, [activeSpaceTasks, selectedTask?.jiraKey]);
  const selectedTaskDailyItem = useMemo(
    () => (selectedTask ? dailyItems.find(item => item.taskId === selectedTask.id) || null : null),
    [dailyItems, selectedTask],
  );
  const selectedLinkedTask = useMemo(
    () => (selectedTask?.linkedTaskId ? tasksById.get(selectedTask.linkedTaskId) || null : null),
    [tasksById, selectedTask],
  );
  const selectedTaskLinkCandidates = useMemo(
    () => tasks
      .filter(task => task.id !== selectedTask?.id)
      .sort((a, b) => {
        const jiraDelta = Number(!!b.jiraKey) - Number(!!a.jiraKey);
        if (jiraDelta) return jiraDelta;
        return a.title.localeCompare(b.title);
      }),
    [selectedTask?.id, tasks],
  );
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
  const linkedTaskContext = useCallback((task: ProTask) => linkedTaskContextLines(task.linkedTaskId ? tasksById.get(task.linkedTaskId) || null : null).join('\n'), [tasksById]);

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
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') terminalSyncRunIdsRef.current.add(run.id);
    }
    setSyncRuns(runs);
    setSelectedSyncRunId(current => current || runs[0]?.id || null);
    if (options.refreshTasksOnCompletion && !firstLoad && hasNewCompletedRun) {
      const tasksResult = await api.getProTasks();
      if (tasksResult.ok) setTasks(tasksResult.tasks || []);
    }
  }, []);

  useEffect(() => {
    if (selectedTicketType !== 'all' && !jiraFilterOptions.ticketTypes.includes(selectedTicketType)) setSelectedTicketType('all');
    if (selectedSprint !== 'all' && jiraFilterOptions.sprints.length > 0 && !jiraFilterOptions.sprints.includes(selectedSprint)) setSelectedSprint('all');
    if (activeSprint !== 'all' && jiraFilterOptions.sprints.length > 0 && !jiraFilterOptions.sprints.includes(activeSprint)) {
      setActiveSprint('all');
      writeStoredJiraActiveSprint('all');
    }
    if (selectedFixVersion !== 'all' && !jiraFilterOptions.fixVersions.includes(selectedFixVersion)) setSelectedFixVersion('all');
    if (selectedJiraStatus !== 'all' && !jiraFilterOptions.statuses.includes(selectedJiraStatus)) setSelectedJiraStatus('all');
  }, [activeSprint, jiraFilterOptions, selectedFixVersion, selectedJiraStatus, selectedSprint, selectedTicketType]);

  useEffect(() => {
    if (selectedId && visibleTasks.some(task => task.id === selectedId)) return;
    setSelectedId(visibleTasks[0]?.id || null);
  }, [selectedId, visibleTasks]);

  const loadDailyItems = useCallback(async (date: string) => {
    const result = await api.getDailyItems(date);
    if (!result.ok) throw new Error(result.error || 'Failed to load daily items');
    setDailyItems(result.items || []);
  }, []);

  const loadWorkspacesForOptions = useCallback(async () => {
    const result = await api.getWorkspaces();
    if (result.ok) setWorkspaces(result.workspaces || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (standaloneDailyRoute) {
        const [result, dailyItemsResult, spacesResult] = await Promise.all([
          api.getProTasks(),
          api.getDailyItems(selectedDailyDate),
          api.getTaskSpaces(),
        ]);
        if (!result.ok) throw new Error(result.error || 'Failed to load work items');
        setTasks(result.tasks);
        if (dailyItemsResult.ok) setDailyItems(dailyItemsResult.items || []);
        if (spacesResult.ok) setTaskSpaces(spacesResult.spaces || []);
        setSelectedId(current => current || result.tasks[0]?.id || null);
        return;
      }
      const [result, dailyItemsResult, todosResult, spacesResult, assistantsResult, jiraConfigResult, cyclesResult] = await Promise.all([
        api.getProTasks(),
        api.getDailyItems(selectedDailyDate),
        api.getProTodos(),
        api.getTaskSpaces(),
        api.getProAssistants(),
        api.getJiraWorkflowConfig(),
        api.getJiraCycles(),
      ]);
      if (!result.ok) throw new Error(result.error || 'Failed to load work items');
      setTasks(result.tasks);
      if (dailyItemsResult.ok) setDailyItems(dailyItemsResult.items || []);
      if (todosResult.ok) setTodoItems(orderTodoItems(todosResult.items || []));
      if (spacesResult.ok) setTaskSpaces(spacesResult.spaces || []);
      if (assistantsResult.ok) setAssistants(assistantsResult.assistants || []);
      if (jiraConfigResult.ok) setJiraConfig({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...jiraConfigResult.config });
      if (cyclesResult.ok) setCycles(cyclesResult.cycles || []);
      setSelectedId(current => current || result.tasks[0]?.id || null);
      void loadSyncRuns().catch(() => {});
      void loadWorkspacesForOptions().catch(() => {});
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load work items', false);
    } finally {
      setLoading(false);
    }
  }, [loadSyncRuns, loadWorkspacesForOptions, selectedDailyDate, standaloneDailyRoute, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    void loadDailyItems(selectedDailyDate).catch(err => {
      toast(err instanceof Error ? err.message : 'Failed to load daily items', false);
    });
  }, [loadDailyItems, selectedDailyDate, toast]);

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
    const navState = location.state as { openTaskId?: string; openTaskNonce?: number } | null;
    const openTaskId = typeof navState?.openTaskId === 'string' ? navState.openTaskId : '';
    const nonce = typeof navState?.openTaskNonce === 'number' ? navState.openTaskNonce : null;
    if (!openTaskId || nonce == null || focusOpenTaskNonceRef.current === nonce) return;
    const task = tasks.find(item => item.id === openTaskId);
    if (!task) return;
    focusOpenTaskNonceRef.current = nonce;
    openTaskDetail(task);
  }, [location.state, openTaskDetail, tasks]);

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

  const updateTaskPlannedDate = useCallback(async (task: ProTask, plannedDate: string | null) => {
    try {
      const result = await api.updateProTaskMeta(task.id, { plannedDate });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task day');
      upsertTask(result.task);
      if (plannedDate) setDailySourceOpen(false);
      else {
        await loadDailyItems(selectedDailyDate).catch(() => {});
        toast('Work Item returned to plan');
      }
      return result.task;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update task day', false);
      return null;
    }
  }, [loadDailyItems, selectedDailyDate, toast, upsertTask]);

  const createDailyTask = useCallback(async () => {
    const title = dailyQuickAdd.trim();
    if (!title) return;
    setCreating(true);
    try {
      const result = await api.createDailyItems({ date: selectedDailyDate, titles: [title] });
      if (!result.ok || !result.items) throw new Error(result.error || 'Failed to capture planned items');
      setDailyItems(prev => [...prev, ...result.items!].sort((a, b) => a.sortOrder - b.sortOrder));
      setDailyQuickAdd('');
      toast('Planned item captured');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to capture planned item', false);
    } finally {
      setCreating(false);
    }
  }, [dailyQuickAdd, selectedDailyDate, toast]);

  const createTaskFromTodoItem = useCallback(async (item: TodoItem) => {
    try {
      const result = await api.addTodoToDaily({ date: selectedDailyDate, todoId: item.id });
      if (!result.ok || !result.item || !result.taskId) throw new Error(result.error || 'Failed to plan inbox item');
      await Promise.all([loadDailyItems(selectedDailyDate), refresh()]);
      setDailySourceOpen(false);
      setTodoModalOpen(false);
      toast('Inbox item planned for today');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to plan inbox item', false);
    }
  }, [loadDailyItems, refresh, selectedDailyDate, toast]);

  const openCreateQuickTodo = useCallback(() => {
    setTodoModalOpen(false);
    setQuickTodoText('');
    setQuickTodoOpen(true);
  }, []);

  const closeQuickTodo = useCallback(() => {
    setQuickTodoOpen(false);
    setQuickTodoText('');
  }, []);

  const saveQuickTodo = useCallback(async () => {
    const body = quickTodoText.trim();
    if (!body || todoCreating) return;
    setTodoCreating(true);
    try {
      const result = await api.createProTodo({ title: body, body, source: { type: 'quick-capture', workdir: state?.runtimeWorkdir || undefined } });
      if (!result.ok || !result.item) throw new Error(result.error || 'Failed to save inbox item');
      setTodoItems(prev => orderTodoItems([result.item!, ...prev.filter(item => item.id !== result.item!.id)]));
      closeQuickTodo();
      toast('Inbox item saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save inbox item', false);
    } finally {
      setTodoCreating(false);
    }
  }, [closeQuickTodo, quickTodoText, state?.runtimeWorkdir, toast, todoCreating]);

  const createChatFromTodoItem = useCallback(async (item: TodoItem) => {
    if (todoCreating) return;
    setTodoCreating(true);
    try {
      const result = await api.createProTodoChat({
        todoIds: [item.id],
        workdir: item.source?.workdir || state?.runtimeWorkdir,
      });
      if (!result.ok) throw new Error(result.error || 'Failed to start chat from inbox item');
      setTodoItems(prev => prev.filter(current => current.id !== item.id));
      toast('Chat started from inbox item');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start chat from inbox item', false);
    } finally {
      setTodoCreating(false);
    }
  }, [state?.runtimeWorkdir, toast, todoCreating]);

  const createTaskFromTodoListItem = useCallback(async (item: TodoItem) => {
    if (todoCreating) return;
    setTodoCreating(true);
    try {
      const description = item.body || item.source?.quote || item.title;
      const result = await api.createProTask({
        title: item.title,
        description,
        spaceId: PERSONAL_TASK_SPACE_ID,
        kind: 'todo',
        workdir: item.source?.workdir || state?.runtimeWorkdir,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to create work item from inbox item');
      const archive = await api.updateProTodo(item.id, { status: 'archived' });
      if (!archive.ok) throw new Error(archive.error || 'Failed to archive inbox item');
      setTodoItems(prev => prev.filter(current => current.id !== item.id));
      upsertTask(result.task);
      toast('Work item created from inbox item');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create work item from inbox item', false);
    } finally {
      setTodoCreating(false);
    }
  }, [state?.runtimeWorkdir, toast, todoCreating, upsertTask]);

  const addExistingTaskToDaily = useCallback(async (task: ProTask) => {
    try {
      const result = await api.addTaskToDaily({ date: selectedDailyDate, taskId: task.id });
      if (!result.ok || !result.item) throw new Error(result.error || 'Failed to plan Work Item');
      await Promise.all([loadDailyItems(selectedDailyDate), refresh()]);
      toast(task.plannedDate === selectedDailyDate ? 'Work Item already planned today' : 'Work Item planned today');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to plan Work Item', false);
    }
  }, [loadDailyItems, refresh, selectedDailyDate, toast]);

  const activateSelectedSprint = useCallback(() => {
    if (!selectedSprint || selectedSprint === 'all') return;
    setActiveSprint(selectedSprint);
    writeStoredJiraActiveSprint(selectedSprint);
    toast(`Active sprint set to ${selectedSprint}`);
  }, [selectedSprint, toast]);

  const promoteDailyItem = useCallback(async (item: DailyItem) => {
    if (item.taskId) {
      const task = tasks.find(candidate => candidate.id === item.taskId);
      if (task) openTaskDetail(task);
      return;
    }
    if (item.status !== 'open') return;
    setCreating(true);
    try {
      const result = await api.promoteDailyItems({
        date: selectedDailyDate,
        itemIds: [item.id],
        workdir: state?.runtimeWorkdir,
      });
      if (!result.ok) throw new Error(result.error || 'Failed to create Work Items from planned items');
      await Promise.all([loadDailyItems(selectedDailyDate), refresh()]);
      toast('Work Item created from planned item');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create Work Items from planned items', false);
    } finally {
      setCreating(false);
    }
  }, [loadDailyItems, openTaskDetail, refresh, selectedDailyDate, state?.runtimeWorkdir, tasks, toast]);

  const revertDailyItemTask = useCallback(async (item: DailyItem) => {
    if (!item.taskId) return;
    try {
      const result = await api.revertDailyItemTask(item.id);
      if (!result.ok || !result.item) throw new Error(result.error || 'Failed to return Work Item to plan');
      setDailyItems(prev => prev.map(current => current.id === item.id ? result.item! : current));
      await refresh();
      toast('Work Item returned to plan');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to return Work Item to plan', false);
      await loadDailyItems(selectedDailyDate).catch(() => {});
    }
  }, [loadDailyItems, refresh, selectedDailyDate, toast]);

  const reorderDailyItemsForDate = useCallback(async (orderedIds: string[]) => {
    if (!orderedIds.length) return;
    const reordered = orderedIds
      .map(id => dailyItems.find(item => item.id === id))
      .filter((item): item is DailyItem => !!item);
    setDailyItems(reordered.map((entry, index) => ({ ...entry, sortOrder: index })));
    try {
      const result = await api.reorderDailyItems({ date: selectedDailyDate, itemIds: orderedIds });
      if (!result.ok || !result.items) throw new Error(result.error || 'Failed to reorder planned items');
      setDailyItems(result.items);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reorder planned items', false);
      await loadDailyItems(selectedDailyDate).catch(() => {});
    }
  }, [dailyItems, loadDailyItems, selectedDailyDate, toast]);

  const openDailyItemTask = useCallback((item: DailyItem) => {
    if (!item.taskId) return;
    const task = tasks.find(candidate => candidate.id === item.taskId);
    if (task) openTaskDetail(task);
  }, [openTaskDetail, tasks]);

  const renameDailyItem = useCallback(async (itemId: string, title: string) => {
    try {
      const result = await api.updateDailyItem(itemId, { title });
      if (!result.ok || !result.item) throw new Error(result.error || 'Failed to update planned item');
      setDailyItems(prev => prev.map(item => item.id === itemId ? result.item! : item));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update planned item', false);
      await loadDailyItems(selectedDailyDate).catch(() => {});
    }
  }, [loadDailyItems, selectedDailyDate, toast]);

  const removeDailyItem = useCallback(async (itemId: string) => {
    try {
      const result = await api.deleteDailyItem(itemId);
      if (!result.ok) throw new Error(result.error || 'Failed to delete planned item');
      setDailyItems(prev => prev.filter(item => item.id !== itemId));
      toast('Planned item deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete planned item', false);
    }
  }, [toast]);

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
      if (!result.ok || !result.space) throw new Error(result.error || 'Failed to create work space');
      setTaskSpaces(prev => [...prev.filter(space => space.id !== result.space!.id), result.space!]);
      setSelectedSpaceId(result.space.id);
      setSpaceCreateOpen(false);
      toast('Work space created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create work space', false);
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

  const openSyncTicket = useCallback(() => {
    setSyncTicketInitialQuery(selectedTask?.jiraKey || ticketQuery.trim());
    setSyncTicketProgress({ status: 'idle' });
    setSyncTicketOpen(true);
  }, [selectedTask?.jiraKey, ticketQuery]);

  const closeSyncTicket = useCallback(() => {
    if (syncTicketBusy) return;
    setSyncTicketOpen(false);
    setSyncTicketProgress({ status: 'idle' });
  }, [syncTicketBusy]);

  const openSyncedTicketTask = useCallback((task: ProTask) => {
    setSelectedSpaceId(task.spaceId || JIRA_TASK_SPACE_ID);
    setSyncTicketOpen(false);
    setSyncTicketProgress({ status: 'idle' });
    openTaskDetail(task);
  }, [openTaskDetail]);

  const syncJiraTicket = useCallback(async (draft: { query: string }) => {
    const query = draft.query.trim();
    if (!query || syncTicketBusy) return;
    setSyncTicketBusy(true);
    setSyncTicketProgress({ status: 'running', query });
    try {
      const result = await api.syncJiraTicket({
        query,
        projectKey: jiraProjectKeyHint || undefined,
        workdir: activeTaskSpace?.defaultWorkdir || state?.runtimeWorkdir,
        spaceId: activeSpaceIsJira && selectedSpaceId !== ALL_TASKS_SPACE_ID ? selectedSpaceId : JIRA_TASK_SPACE_ID,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to sync Jira ticket');
      upsertTask(result.task);
      setSelectedSpaceId(result.task.spaceId || JIRA_TASK_SPACE_ID);
      setSyncTicketProgress({
        status: 'completed',
        query,
        issueKey: result.issueKey || result.task.jiraKey,
        action: result.action || 'updated',
        task: result.task,
      });
      toast(`${result.issueKey || result.task.jiraKey || 'Ticket'} ${result.action === 'created' ? 'created' : 'updated'}`);
    } catch (err) {
      setSyncTicketProgress({
        status: 'failed',
        query,
        error: err instanceof Error ? err.message : 'Failed to sync Jira ticket',
      });
      toast(err instanceof Error ? err.message : 'Failed to sync Jira ticket', false);
    } finally {
      setSyncTicketBusy(false);
    }
  }, [activeSpaceIsJira, activeTaskSpace?.defaultWorkdir, jiraProjectKeyHint, openTaskDetail, selectedSpaceId, state?.runtimeWorkdir, syncTicketBusy, toast, upsertTask]);

  const openAnalyzeTicket = useCallback(() => {
    setAnalyzeTicketInitialQuery(selectedTask?.jiraKey || ticketQuery.trim());
    setAnalyzeTicketOpen(true);
  }, [selectedTask?.jiraKey, ticketQuery]);

  const analyzeJiraTicket = useCallback(async (draft: { query: string }) => {
    const query = draft.query.trim();
    if (!query || analyzeTicketBusy) return;
    setAnalyzeTicketBusy(true);
    try {
      const result = await api.analyzeJiraTicket({ query });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to start ticket analysis');
      upsertTask(result.task);
      setSelectedSpaceId(ANALYZE_TASK_SPACE_ID);
      setAnalyzeTicketOpen(false);
      openTaskDetail(result.task);
      const workspaceNote = result.workdirResolution?.reason || 'Workspace selected automatically.';
      toast(result.issueLookupError
        ? `Analysis started (${workspaceNote}). Jira prefetch failed: ${result.issueLookupError}`
        : `Analysis started. ${workspaceNote}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start ticket analysis', false);
    } finally {
      setAnalyzeTicketBusy(false);
    }
  }, [analyzeTicketBusy, openTaskDetail, toast, upsertTask]);

  const stopJiraSync = useCallback(async (runId: string) => {
    setSyncStopBusy(true);
    try {
      const result = await api.stopJiraMcpSyncRun(runId);
      if (!result.ok || !result.run) throw new Error(result.error || 'Failed to stop Jira sync');
      setSyncRuns(prev => [result.run!, ...prev.filter(run => run.id !== result.run!.id)]);
      setSelectedSyncRunId(result.run.id);
      toast('Jira sync stopped');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to stop Jira sync', false);
    } finally {
      setSyncStopBusy(false);
    }
  }, [toast]);

  const applyJiraSyncItems = useCallback(async (runId: string, itemIds: string[]) => {
    if (!itemIds.length) return;
    setSyncApplyBusy(true);
    try {
      const result = await api.applyJiraMcpSyncRun(runId, itemIds);
      if (!result.ok || !result.run) throw new Error(result.error || 'Failed to apply Jira sync items');
      setSyncRuns(prev => [result.run!, ...prev.filter(run => run.id !== result.run!.id)]);
      setSelectedSyncRunId(result.run.id);
      const tasksResult = await api.getProTasks();
      if (tasksResult.ok) setTasks(tasksResult.tasks || []);
      toast(`Applied ${itemIds.length} Jira item${itemIds.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to apply Jira sync items', false);
    } finally {
      setSyncApplyBusy(false);
    }
  }, [toast]);

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

  const resetTask = useCallback(async () => {
    const task = taskResetTarget;
    if (!task || resettingTaskId) return;
    setResettingTaskId(task.id);
    try {
      const result = await api.resetProTask(task.id);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to reset task');
      upsertTask(result.task);
      setDetailMenuOpen(false);
      setTaskResetTarget(null);
      toast('Task reset');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset task', false);
    } finally {
      setResettingTaskId(null);
    }
  }, [resettingTaskId, taskResetTarget, toast, upsertTask]);

  const createTodoFromTaskSelection = useCallback(async (session: StageSessionRef, request: SelectionActionRequest) => {
    if (!request.quote.trim() || !request.note.trim()) return;
    const result = await api.createProTodo({
      kind: 'todo',
      title: request.note,
      body: request.note,
      source: {
        type: 'chat-selection',
        workdir: session.workdir,
        agent: session.agent,
        sessionId: session.sessionId,
        turnIndex: request.turnIndex,
        quote: request.quote,
      },
    });
    if (!result.ok) throw new Error(result.error || 'Failed to save inbox item');
    toast('Inbox item saved');
  }, [toast]);

  const createSideChatFromTaskSelection = useCallback(async (session: StageSessionRef, request: SelectionSideChatRequest) => {
    if (!request.quote.trim() || !request.question.trim()) return;
    const created = await api.createSideChat(session.workdir, session.agent, session.sessionId, 'Task side card');
    if (!created.ok || !created.session?.sessionId) throw new Error(created.error || 'Failed to create side card');
    const prompt = buildTaskSelectionSideChatPrompt(request, locale);
    const sent = await api.sendSessionMessage(created.session.workdir || session.workdir, created.session.agent || session.agent, created.session.sessionId, prompt);
    if (!sent.ok) throw new Error(sent.error || 'Failed to start side card');
    toast('Side card created');
  }, [locale, toast]);

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

  const syncSingleJiraTask = useCallback(async (task: ProTask) => {
    if (!task.jiraKey || syncingJiraTaskId) return;
    setSyncingJiraTaskId(task.id);
    try {
      const result = await api.syncProTaskJiraFromRemote(task.id);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to sync Jira ticket');
      upsertTask(result.task);
      toast(`Synced ${result.task.jiraKey || task.jiraKey}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to sync Jira ticket', false);
    } finally {
      setSyncingJiraTaskId(null);
    }
  }, [syncingJiraTaskId, toast, upsertTask]);

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
    options: { assistantId?: string; agent?: string | null; prompt?: string; displayPrompt?: string | null; model?: string | null; effort?: string | null; executionMode?: 'direct' | 'interactive'; subtaskId?: string | null } = {},
  ): Promise<ProTask | null> => {
    setBusy({ taskId: task.id, stage });
    try {
      const result = await api.startProTaskStage(task.id, stage, {
        workdir: task.workdir || state?.runtimeWorkdir,
        assistantId: options.assistantId || undefined,
        agent: options.agent || undefined,
        prompt: options.prompt,
        displayPrompt: options.displayPrompt,
        model: options.model,
        effort: options.effort,
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

  const buildTaskChatContextForTask = useCallback((task: ProTask, status: ProTaskStatus) => {
    const workflow = jiraConfig.statusWorkflows?.[status] || {};
    const workflowInstruction = [workflow.instruction, linkedTaskContext(task)].filter(Boolean).join('\n\n');
    return buildTicketChatContext(task, status, workflowInstruction || undefined, jiraOwnerAssistantPrompt);
  }, [jiraConfig, jiraOwnerAssistantPrompt, linkedTaskContext]);

  const buildTaskChatPromptForTask = useCallback((task: ProTask, status: ProTaskStatus, prompt?: string) => {
    const workflow = jiraConfig.statusWorkflows?.[status] || {};
    const execution = resolveTaskExecution(task, jiraConfig);
    const workflowInstruction = [workflow.instruction, linkedTaskContext(task)].filter(Boolean).join('\n\n');
    return buildTicketChatPrompt(
      task,
      status,
      prompt,
      workflowInstruction || undefined,
      execution.mode,
      jiraOwnerAssistantPrompt,
    );
  }, [jiraConfig, jiraOwnerAssistantPrompt, linkedTaskContext]);

  const startStatusChat = useCallback(async (task: ProTask, status: ProTaskStatus, prompt?: string, agentOverride?: string, displayPrompt?: string | null) => {
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
      prompt: buildTaskChatPromptForTask(task, status, prompt),
      displayPrompt: displayPrompt ?? prompt ?? null,
      model: task.execution?.model || pickRandomModel(workflow.modelPool),
      effort: task.execution?.effort || null,
      executionMode: execution.mode,
    });
  }, [buildTaskChatPromptForTask, jiraConfig, startStage, state?.bot?.defaultAgent, state?.config?.defaultAgent]);

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
    const linkedContext = linkedTaskContext(task);
    const dailyPrompt = task.plannedDate
      ? (
          status === 'refinement'
            ? DAILY_CLARIFY_PROMPT
            : status === 'coding'
              ? DAILY_WORKING_PROMPT
              : status === 'resolved'
                ? DAILY_REVIEW_PROMPT
                : undefined
        )
      : undefined;
    const stagedTask = await startStage(task, stage, {
      assistantId: stageAssistantId,
      agent: stageAgent,
      prompt: [dailyPrompt || buildStatusWorkflowPrompt(task, status, workflow.instruction, execution.mode), linkedContext].filter(Boolean).join('\n\n') || undefined,
      model: task.execution?.model || pickRandomModel(workflow.modelPool),
      effort: task.execution?.effort || null,
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
  }, [jiraConfig, linkedTaskContext, startStage]);

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
    const targetStatus = jiraStatusForColumn(column);
    await moveTaskToStatus(task, targetStatus);
  }, [dailyView, moveTaskToStatus, tasks]);

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
    patch: { ownerMode?: 'status' | 'agent' | 'assistant'; agent?: string | null; assistantId?: string | null; defaultAssistantId?: string | null; mode?: 'direct' | 'interactive' },
  ) => {
    try {
      const current = resolveTaskExecution(task, jiraConfig);
      const result = await api.updateProTaskExecution(task.id, {
        ownerMode: patch.ownerMode || current.ownerMode,
        agent: patch.agent !== undefined ? patch.agent : current.agent,
        assistantId: patch.assistantId !== undefined ? patch.assistantId : current.assistantId,
        defaultAssistantId: patch.defaultAssistantId,
        mode: patch.mode || current.mode,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update execution settings');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update execution settings', false);
    }
  }, [jiraConfig, toast, upsertTask]);

  const assignTaskAssistant = useCallback(async (task: ProTask, assistantId: string) => {
    const selectedAssistantId = assistantId.trim();
    await updateTaskExecution(task, {
      ownerMode: selectedAssistantId ? 'assistant' : 'status',
      agent: null,
      assistantId: selectedAssistantId || null,
      defaultAssistantId: selectedAssistantId || null,
    });
  }, [updateTaskExecution]);

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

  const activeSpaceName = selectedSpaceId === DAILY_VIEW_ID
    ? 'Work Plan'
    : selectedSpaceId === ALL_TASKS_SPACE_ID
      ? 'All Work Items'
      : activeTaskSpace?.name || 'Work Items';
  const taskSpaceSelectItems = standaloneDailyRoute
    ? [{ id: DAILY_VIEW_ID, name: 'Work Plan', kind: 'custom' as const }, { id: ALL_TASKS_SPACE_ID, name: 'All Work Items', kind: 'custom' as const }, ...taskSpaces]
    : [{ id: ALL_TASKS_SPACE_ID, name: 'All Work Items', kind: 'custom' as const }, ...taskSpaces];
  const activeSpaceCount = activeSpaceTasks.length;
  const visibleSpaceCount = visibleTasks.length;
  const activeSpaceSubtitle = selectedSpaceId === DAILY_VIEW_ID
    ? `Work planned for ${formatDateOnly(`${selectedDailyDate}T00:00:00`)}`
    : selectedSpaceId === ALL_TASKS_SPACE_ID
      ? 'Across work spaces'
      : activeSpaceIsJira
        ? 'Jira-backed work space'
        : activeTaskSpace?.kind === 'personal'
          ? 'Personal work space'
          : 'Custom work space';
  const activeJiraFilterCount = [
    selectedTicketType !== 'all',
    selectedJiraStatus !== 'all',
    selectedSprint !== 'all',
    selectedFixVersion !== 'all',
  ].filter(Boolean).length;
  return (
    <div className="relative flex h-full min-h-[640px] flex-col overflow-hidden">
      {loading && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 inline-flex items-center gap-2 rounded-md border border-edge/60 bg-panel/92 px-2.5 py-1.5 text-[11px] text-fg-4 shadow-[var(--th-card-shadow)]">
          <Spinner /> Refreshing
        </div>
      )}
      {diagnosticsRoute && !standaloneDailyRoute && (
        <div className="shrink-0 border-b border-edge/55 bg-panel/72 px-3 py-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-5">Advanced Work Items Console</span>
                <Badge variant="muted" className="h-5 px-2 text-[10px]">Diagnostics</Badge>
              </div>
              <div className="mt-1 max-w-[760px] text-[11.5px] leading-relaxed text-fg-4">
                Jira sync, stage runs, verification, and low-level task controls live here. Use Work Items for the daily chat-first queue.
              </div>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0 self-start sm:self-center" onClick={() => navigate('/work-items')}>
              Open Work Items
            </Button>
          </div>
        </div>
      )}
        <div className="flex min-h-0 flex-1 gap-3">
          {standaloneDailyRoute ? (
            <DailyPlannerSidebar
              selectedDate={selectedDailyDate}
              items={dailyItems}
              tasks={tasks}
              onDateChange={updateSelectedDailyDate}
              onOpenManager={() => setDailyCreateOpen(true)}
              onPromoteItem={(item) => { void promoteDailyItem(item); }}
              onOpenTask={openDailyItemTask}
              onUpdateItem={(itemId, title) => { void renameDailyItem(itemId, title); }}
              onDeleteItem={(itemId) => { void removeDailyItem(itemId); }}
              onReorderItems={(itemIds) => { void reorderDailyItemsForDate(itemIds); }}
            />
          ) : (
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
          )}
          <div className="panel-isolated flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge/70 bg-panel/78 shadow-[var(--th-card-shadow)] backdrop-blur-md">
            <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-edge/45 bg-panel/45 px-3 py-2">
              {spaceSidebarCollapsed && !standaloneDailyRoute && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTaskSpaceSidebar}
                  title="Show work spaces"
                  aria-label="Show work spaces"
                  className="h-8 w-8 shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M9 4v16" />
                  </svg>
                </Button>
              )}
              {!standaloneDailyRoute && (
                <select
                  value={selectedSpaceId}
                  onChange={event => setSelectedSpaceId(event.target.value || ALL_TASKS_SPACE_ID)}
                  className="h-8 min-w-[132px] rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50 md:hidden"
                >
                  {taskSpaceSelectItems.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                </select>
              )}
              <div className="min-w-[150px] flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg" title={activeSpaceName}>{activeSpaceName}</span>
                  <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{visibleSpaceCount}</Badge>
                  {!dailyView && closedTasks.length > 0 && <span className="hidden text-[10.5px] text-fg-5 sm:inline">{closedTasks.length} closed</span>}
                </div>
                <div className="truncate text-[10.5px] text-fg-5">
                  {activeSpaceSubtitle}{activeSpaceCount !== visibleSpaceCount ? ` · ${activeSpaceCount} total` : ''}
                </div>
              </div>
              {dailyView && !standaloneDailyRoute && (
                <DailyDateControls selectedDate={selectedDailyDate} onChange={updateSelectedDailyDate} />
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={revealTaskSpaceSearch}
                title="Search work items"
                aria-label="Search work items"
                className={cn('h-8 w-8 shrink-0', !spaceSidebarCollapsed && 'md:hidden')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </Button>
              {!dailyView && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={openCreateQuickTodo} title="Capture inbox item" aria-label="Capture inbox item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </Button>
              )}
              {dailyView ? (
                <>
                  {!standaloneDailyRoute && (
                    <Button variant="primary" size="sm" className="shrink-0" onClick={() => setDailyCreateOpen(true)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Capture planned item
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="primary" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Create Work Item
                </Button>
              )}
              {activeSpaceIsJira && (
                <div className="order-last flex w-full min-w-0 flex-col gap-2 rounded-lg border border-edge/55 bg-panel-alt/30 px-2.5 py-2 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 items-center gap-2 md:flex-wrap">
                    <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
                      <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-edge/60 bg-inset px-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-5">
                        Source
                        <span className="normal-case tracking-normal text-fg-3">Jira</span>
                      </span>
                      <Badge variant="muted" className="h-5 px-2 text-[10px] tabular-nums">{activeSpaceCount}</Badge>
                      <span className={cn('min-w-0 flex-1 truncate text-[11px] md:hidden', selectedSyncRun?.status === 'failed' ? 'text-warn' : 'text-fg-5')}>
                        {jiraSyncCompactLabel(selectedSyncRun)}
                      </span>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <JiraSyncMonitor
                        runs={syncRuns}
                        selectedRun={selectedSyncRun}
                        detailsOpen={syncDetailsOpen}
                        syncing={syncBusy || syncRunActive(latestSyncRun)}
                        compact
                        onSync={() => { void runJiraSync(); }}
                        onSyncTicket={openSyncTicket}
                        onStop={(runId) => { void stopJiraSync(runId); }}
                        stopping={syncStopBusy}
                        onSelectRun={setSelectedSyncRunId}
                        onCloseDetails={() => setSyncDetailsOpen(false)}
                        onApplyItems={(runId, itemIds) => { void applyJiraSyncItems(runId, itemIds); }}
                        applying={syncApplyBusy}
                      />
                    </div>
                    <div className="hidden md:block">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-[11px]"
                        disabled={analyzeTicketBusy}
                        onClick={openAnalyzeTicket}
                      >
                        {analyzeTicketBusy ? <Spinner /> : null}
                        Analyze
                      </Button>
                    </div>
                    <Button
                      variant={jiraMobileActionsOpen ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px] md:hidden"
                      onClick={() => setJiraMobileActionsOpen(open => !open)}
                      aria-expanded={jiraMobileActionsOpen}
                    >
                      Actions
                      {syncBusy || syncRunActive(latestSyncRun) ? <Spinner /> : null}
                    </Button>
                  </div>
                  <div className="flex min-w-0 flex-nowrap items-center gap-2 lg:flex-1 lg:flex-wrap">
                    <input
                      value={ticketQuery}
                      onChange={event => setTicketQuery(event.target.value)}
                      placeholder="Search Jira work items"
                      className="h-8 min-w-0 flex-1 rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors placeholder:text-fg-5/55 hover:border-control-border-h focus:border-primary/50 sm:min-w-[180px]"
                    />
                    <Button
                      variant={jiraSourceControlsOpen || activeJiraFilterCount > 0 ? 'secondary' : 'outline'}
                      size="sm"
                      className={cn(
                        'h-8 shrink-0 px-2 text-[11px]',
                        activeJiraFilterCount > 0 && 'border-primary/35 text-primary',
                      )}
                      onClick={() => setJiraSourceControlsOpen(open => !open)}
                      aria-expanded={jiraSourceControlsOpen}
                    >
                      Filters
                      {activeJiraFilterCount > 0 && <Badge variant="accent" className="ml-1 h-4 px-1.5 text-[9px]">{activeJiraFilterCount}</Badge>}
                    </Button>
                    <div className="hidden md:block">
                      <JiraDashboardSettingsMenu
                        canOpenAssistantPrompt={!!jiraOwnerAssistant}
                        canOpenSyncDetails={syncRuns.length > 0}
                        fixVersion={selectedFixVersion}
                        fixVersionOptions={jiraFilterOptions.fixVersions}
                        onOpenAssistantPrompt={() => setJiraAssistantPromptOpen(true)}
                        onOpenSyncDetails={() => setSyncDetailsOpen(true)}
                        onRefreshSync={() => { void loadSyncRuns({ refreshTasksOnCompletion: true }); }}
                        onOpenWorkflowSettings={() => setSettingsOpen(true)}
                        onFixVersionChange={setSelectedFixVersion}
                      />
                    </div>
                  </div>
                  {jiraMobileActionsOpen && (
                    <div className="grid w-full min-w-0 gap-2 rounded-md border border-edge/45 bg-inset/35 p-2 md:hidden">
                      <JiraSyncMonitor
                        runs={syncRuns}
                        selectedRun={selectedSyncRun}
                        detailsOpen={syncDetailsOpen}
                        syncing={syncBusy || syncRunActive(latestSyncRun)}
                        compact
                        onSync={() => { void runJiraSync(); }}
                        onSyncTicket={openSyncTicket}
                        onStop={(runId) => { void stopJiraSync(runId); }}
                        stopping={syncStopBusy}
                        onSelectRun={setSelectedSyncRunId}
                        onCloseDetails={() => setSyncDetailsOpen(false)}
                        onApplyItems={(runId, itemIds) => { void applyJiraSyncItems(runId, itemIds); }}
                        applying={syncApplyBusy}
                      />
                      <div className="flex min-w-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          disabled={analyzeTicketBusy}
                          onClick={openAnalyzeTicket}
                        >
                          {analyzeTicketBusy ? <Spinner /> : null}
                          Analyze
                        </Button>
                        <JiraDashboardSettingsMenu
                          canOpenAssistantPrompt={!!jiraOwnerAssistant}
                          canOpenSyncDetails={syncRuns.length > 0}
                          fixVersion={selectedFixVersion}
                          fixVersionOptions={jiraFilterOptions.fixVersions}
                          onOpenAssistantPrompt={() => setJiraAssistantPromptOpen(true)}
                          onOpenSyncDetails={() => setSyncDetailsOpen(true)}
                          onRefreshSync={() => { void loadSyncRuns({ refreshTasksOnCompletion: true }); }}
                          onOpenWorkflowSettings={() => setSettingsOpen(true)}
                          onFixVersionChange={setSelectedFixVersion}
                        />
                      </div>
                    </div>
                  )}
                  {jiraSourceControlsOpen && (
                    <div className="grid w-full min-w-0 grid-cols-1 gap-2 border-t border-edge/35 pt-2 sm:grid-cols-2 xl:w-auto xl:min-w-[620px] xl:grid-cols-[minmax(140px,1fr)_minmax(130px,1fr)_minmax(150px,1.2fr)_auto_auto] xl:border-l xl:border-t-0 xl:pl-2 xl:pt-0">
                      <select
                        value={selectedTicketType}
                        onChange={event => setSelectedTicketType(event.target.value || 'all')}
                        className="h-8 min-w-0 rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
                      >
                        <option value="all">All ticket types</option>
                        {jiraFilterOptions.ticketTypes.map(ticketType => (
                          <option key={ticketType} value={ticketType}>{ticketType}</option>
                        ))}
                      </select>
                      <select
                        value={selectedJiraStatus}
                        onChange={event => setSelectedJiraStatus(event.target.value || 'all')}
                        className="h-8 min-w-0 rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
                      >
                        <option value="all">All Jira status</option>
                        {jiraFilterOptions.statuses.map(status => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                      <select
                        value={selectedSprint}
                        onChange={event => setSelectedSprint(event.target.value || 'all')}
                        className="h-8 min-w-0 rounded-md border border-control-border bg-control px-2.5 text-[12px] text-fg outline-none transition-colors hover:border-control-border-h focus:border-primary/50"
                      >
                        <option value="all">All sprints</option>
                        {jiraFilterOptions.sprintGroups.map(({ sprint, tasks: sprintTasks }) => (
                          <option key={sprint} value={sprint}>{sprint} ({sprintTasks.length})</option>
                        ))}
                      </select>
                      <Button
                        variant={selectedSprint !== 'all' && selectedSprint === activeSprint ? 'secondary' : 'outline'}
                        size="sm"
                        disabled={selectedSprint === 'all'}
                        className={cn(
                          'h-8 shrink-0 px-2 text-[11px]',
                          selectedSprint !== 'all' && selectedSprint === activeSprint && 'border-ok/35 bg-ok/10 text-ok',
                        )}
                        onClick={activateSelectedSprint}
                        title={selectedSprint === 'all' ? 'Select a sprint before setting it active' : `Use ${selectedSprint} as the default sprint view`}
                      >
                        Active
                      </Button>
                      {SHOW_JIRA_CYCLE_FEATURE && (
                        activeCycle ? (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="inline-flex h-8 min-w-0 max-w-[190px] items-center gap-1.5 rounded-md border border-edge bg-panel-alt px-2 text-[11px] text-fg-4">
                              <span className="truncate">{activeCycle.name}</span>
                              <Badge variant="ok">{activeCycle.tasks.length}</Badge>
                            </span>
                            <Button variant="outline" size="sm" className="h-8 px-2 text-[11px]" disabled={cycleBusy} onClick={() => { void closeActiveCycle(); }}>
                              {cycleBusy ? <Spinner /> : null}
                              Close
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-[11px]"
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
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
              <div
                className={cn(
                  'grid min-h-0 flex-1 grid-cols-1 overflow-hidden',
                  taskDetailLayout === 'side' && '2xl:grid-cols-[minmax(0,1fr)_minmax(560px,42vw)]',
                )}
              >
              <div className="min-h-0 overflow-y-auto p-3">
                {activeSpaceIsJira && (
	                  <JiraAssistantCoordinator
	                    tasks={visibleTasks}
                    selectedTask={selectedTask}
                    selectedDate={selectedDailyDate}
                    busy={busy}
                    onOpenTask={openTaskDetail}
                    onClarifyTask={(task) => {
                      if (task.status === 'backlog') void moveTaskToStatus(task, 'refinement');
                      else void startStatusChat(task, 'refinement', ANALYZE_TICKET_PROMPT, undefined, 'Clarify task');
                    }}
                    onCodeTask={(task) => {
                      if (task.status === 'coding') void startStatusChat(task, 'coding', START_CODING_PROMPT, undefined, 'Start coding');
                      else void moveTaskToStatus(task, 'coding');
                    }}
                    onReviewTask={(task) => {
                      if (task.status === 'resolved') void startStatusChat(task, 'resolved', REVIEW_TICKET_PROMPT, undefined, 'Review task');
                      else void moveTaskToStatus(task, 'resolved');
                    }}
	                  />
	                )}
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
                          <Badge variant={JIRA_COLUMN_BADGE[column.key]} className="h-5 px-2 text-[10px] tabular-nums">
                            {byStatus.get(column.key)?.length || 0}
                          </Badge>
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
                            standaloneDailyRoute && dailyView ? (
                              <div
                                className={cn(
                                  'flex h-24 items-center justify-center rounded-lg border border-dashed bg-inset/30 text-[11px]',
                                  dragOverColumn === column.key
                                    ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                                    : 'border-edge/40 text-fg-5/60',
                                )}
                              >
                                Select a planned item on the left to create a Work Item in Inbox
                              </div>
                            ) : (
                            <button
                              type="button"
                              onClick={() => (dailyView ? setDailyCreateOpen(true) : setCreateOpen(true))}
                              className={cn(
                                'flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-inset/30 text-center transition hover:border-primary/45 hover:bg-primary/[0.04] hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
                                dragOverColumn === column.key
                                  ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                                  : 'border-edge/40 text-fg-5/70',
                              )}
                              title={dailyView ? 'Capture planned item' : 'Create Work Item'}
                              aria-label={dailyView ? 'Capture planned item' : 'Create Work Item'}
                            >
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-edge/55 bg-panel/80 text-fg-4 shadow-sm transition group-hover/column:border-primary/35 group-hover/column:text-primary">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                  <line x1="12" y1="5" x2="12" y2="19" />
                                  <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                              </span>
                              <span className="text-[12px] font-semibold text-fg-3">{dailyView ? 'Capture planned item' : 'Create Work Item'}</span>
                            </button>
                            )
                          ) : (
                            <div
                              className={cn(
                                'flex h-24 items-center justify-center rounded-lg border border-dashed bg-inset/30 text-[11px]',
                                dragOverColumn === column.key
                                  ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                                  : 'border-edge/40 text-fg-5/60',
                              )}
                            >
                              No work items
                            </div>
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
                                  assistants={assistants}
                                  draggable
                                  isDragging={draggingTaskId === task.id}
                                  scheduleLabel={dailyView ? 'Remove from daily' : task.plannedDate === localDateInputValue() ? 'Planned' : 'Add to today'}
                                  primaryActionLabel={dailyView ? dailyPrimaryLabel(task) : undefined}
                                  onSelect={openTaskDetail}
                                  onAssignAssistant={(nextTask, assistantId) => { void assignTaskAssistant(nextTask, assistantId); }}
                                  onPrimaryAction={dailyView ? (nextTask) => {
                                    if (nextTask.status === 'backlog') {
                                      void moveTaskToStatus(nextTask, 'refinement');
                                      return;
                                    }
                                    if (nextTask.status === 'refinement') {
                                      void startStatusChat(nextTask, 'refinement', DAILY_CLARIFY_PROMPT, undefined, 'Daily clarify');
                                      return;
                                    }
                                    if (nextTask.status === 'coding') {
                                      void startStatusChat(nextTask, 'coding', DAILY_WORKING_PROMPT, undefined, 'Daily work');
                                      return;
                                    }
                                    if (nextTask.status === 'resolved') {
                                      void moveTaskToStatus(nextTask, 'done');
                                      return;
                                    }
                                    openTaskDetail(nextTask);
                                  } : undefined}
                                  onSchedule={dailyView ? (nextTask) => { void updateTaskPlannedDate(nextTask, null); } : undefined}
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

                <ClosedJiraTasksSection
                  tasks={closedTasks}
                  selectedTask={selectedTask}
                  reopeningTaskId={reopeningTaskId}
                  onOpenTask={openTaskDetail}
                  onReopen={(task) => { void reopenClosedTask(task); }}
                />

                {SHOW_JIRA_CYCLE_FEATURE && activeSpaceIsJira && (
                  <div className="mt-3">
                    <JiraCyclePanel
                      cycles={cycles}
                      taskCounts={cycleTaskCounts}
                      tasksByCycle={tasksByCycle}
                      expandedIds={expandedCycleIds}
                      onToggleExpanded={toggleCycleExpanded}
                      onDeleteCycle={setCycleDeleteTarget}
                    />
                  </div>
                )}
              </div>

              {taskDetailLayout === 'side' && (
                <TaskInlineWorkbench
                  task={selectedTask}
                  linkCandidates={selectedTaskLinkCandidates}
                  linkedTask={selectedLinkedTask}
                  defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
                  agents={agentStatus?.agents || []}
                  assistants={assistants}
                  busy={busy}
                  reopening={selectedTask ? reopeningTaskId === selectedTask.id : false}
                  workspaces={workspaces}
                  fallbackWorkdir={state?.runtimeWorkdir}
                  subtaskDraft={subtaskDraft}
                  onMetaChange={(task, patch) => { void updateTaskMeta(task, patch); }}
                  onAssignAssistant={(task, assistantId) => { void assignTaskAssistant(task, assistantId); }}
                  onStartStatusChat={startStatusChat}
                  onSubtaskDraftChange={setSubtaskDraft}
                  onCreateSubtask={(task) => { void createSubtask(task); }}
                  onUpdateSubtaskStatus={(task, subtaskId, status) => { void updateSubtaskStatus(task, subtaskId, status); }}
                  onStartSubtask={(task, subtaskId) => { void startSubtask(task, subtaskId); }}
                  onTaskUpdated={upsertTask}
                  onReopen={(task) => { void reopenClosedTask(task); }}
                  onSyncJira={(task) => { void syncSingleJiraTask(task); }}
                  syncingJira={selectedTask ? syncingJiraTaskId === selectedTask.id : false}
                  onResetTask={setTaskResetTarget}
                  resetting={selectedTask ? resettingTaskId === selectedTask.id : false}
                  dailyItem={selectedTaskDailyItem}
                  onBackToAction={(item) => { void revertDailyItemTask(item); }}
                  onOpenLinkedTask={openTaskDetail}
                  onCreateSideChatFromSelection={createSideChatFromTaskSelection}
                  onCreateTodoFromSelection={createTodoFromTaskSelection}
                  buildChatPrompt={buildTaskChatPromptForTask}
                  buildChatContext={buildTaskChatContextForTask}
                  onOpenFull={() => setDetailOpen(true)}
	                />
	              )}
	            </div>
	          </div>
	        </div>
      <CreateJiraTaskModal
        open={createOpen}
        creating={creating}
        title="Create Work Item"
        workspaces={workspaces.length ? workspaces : [{ path: state?.runtimeWorkdir || '', name: state?.runtimeWorkdir || 'Workspace' }]}
        assistants={assistants}
        defaultWorkdir={activeTaskSpace?.defaultWorkdir || state?.runtimeWorkdir || workspaces[0]?.path || ''}
        defaultAgent={activeTaskSpace?.defaultAgent || state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
        defaultAssistantId={activeTaskSpace?.defaultAssistantId}
        onClose={() => setCreateOpen(false)}
        onCreate={createTask}
      />
      <TodoListModal
        open={todoModalOpen}
        items={todoItems}
        creating={todoCreating}
        selectedDailyDate={selectedDailyDate}
        onClose={() => setTodoModalOpen(false)}
        onCreateTodo={openCreateQuickTodo}
        onCreateChat={(item) => { void createChatFromTodoItem(item); }}
        onCreateTask={(item) => { void createTaskFromTodoListItem(item); }}
        onCreateDaily={(item) => { void createTaskFromTodoItem(item); }}
      />
	      <TodoQuickAddModal
	        open={quickTodoOpen}
	        saving={todoCreating}
        value={quickTodoText}
        onChange={setQuickTodoText}
		        onClose={closeQuickTodo}
		        onSave={() => { void saveQuickTodo(); }}
		      />
      <SyncJiraTicketModal
        open={syncTicketOpen}
        initialQuery={syncTicketInitialQuery}
        busy={syncTicketBusy}
        progress={syncTicketProgress}
        onClose={closeSyncTicket}
        onSync={(draft) => { void syncJiraTicket(draft); }}
        onOpenTask={openSyncedTicketTask}
      />
      <AnalyzeJiraTicketModal
        open={analyzeTicketOpen}
        initialQuery={analyzeTicketInitialQuery}
        busy={analyzeTicketBusy}
        onClose={() => setAnalyzeTicketOpen(false)}
        onOpenPrompt={() => {
          setAnalyzeTicketOpen(false);
          setAnalyzeTicketPromptOpen(true);
        }}
        onAnalyze={(draft) => { void analyzeJiraTicket(draft); }}
      />
      <AnalyzeTicketPromptModal
        open={analyzeTicketPromptOpen}
        onClose={() => setAnalyzeTicketPromptOpen(false)}
      />
	      <DailyIntakeModal
        open={dailyCreateOpen}
        creating={creating}
        selectedDate={selectedDailyDate}
        value={dailyQuickAdd}
        items={dailyItems}
        onChange={setDailyQuickAdd}
        onCreateOne={() => { void createDailyTask(); }}
        onUpdateItem={(itemId, title) => { void renameDailyItem(itemId, title); }}
        onDeleteItem={(itemId) => { void removeDailyItem(itemId); }}
        onReorderItems={(itemIds) => { void reorderDailyItemsForDate(itemIds); }}
        onClose={() => setDailyCreateOpen(false)}
      />
      <DailySourcePickerModal
        open={dailySourceOpen}
        todoItems={dailyTodoItems}
        tasks={dailySourceTasks}
        taskSpaces={taskSpaces}
        selectedDate={selectedDailyDate}
        onClose={() => setDailySourceOpen(false)}
        onAddTodo={(item) => { void createTaskFromTodoItem(item); }}
        onAddTask={(task) => { void addExistingTaskToDaily(task); }}
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
      {SHOW_JIRA_CYCLE_FEATURE && (
        <>
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
        </>
      )}
      <JiraAssistantConfigModal
        open={settingsOpen}
        saving={savingConfig}
        assistants={assistants}
        agents={agentStatus?.agents || []}
        config={jiraConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={saveJiraConfig}
      />
      <JiraAssistantPromptModal
        open={jiraAssistantPromptOpen}
        assistant={jiraOwnerAssistant}
        workdir={state?.runtimeWorkdir}
        defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
        onClose={() => setJiraAssistantPromptOpen(false)}
        onSaved={(assistant) => {
          setAssistants(prev => prev.some(item => item.id === assistant.id)
            ? prev.map(item => item.id === assistant.id ? assistant : item)
            : [assistant, ...prev]);
        }}
      />
      <Modal
        open={detailOpen && !!selectedTask}
        onClose={() => {
          setDetailMenuOpen(false);
          setDetailOpen(false);
        }}
        wide
        panelClassName="rounded-[20px] border-[color:var(--th-chat-window-border-active)] bg-[var(--th-chat-window-bg)] ring-1 ring-[color:var(--th-chat-window-ring)]"
        contentClassName="h-full max-h-full overflow-hidden"
        panelStyle={{
          width: 'min(1512px, calc(100vw - clamp(32px, 4vw, 56px)))',
          maxWidth: 'min(1512px, calc(100vw - clamp(32px, 4vw, 56px)))',
          height: 'min(920px, calc(100dvh - clamp(32px, 4vw, 56px)))',
          maxHeight: 'calc(100dvh - clamp(32px, 4vw, 56px))',
          borderRadius: 20,
          background: 'var(--th-chat-window-bg)',
          boxShadow: 'var(--th-chat-window-shadow-focus)',
        }}
      >
        <div data-task-detail-modal className="h-full min-h-0">
          <TaskDetail
            task={selectedTask}
            linkCandidates={selectedTaskLinkCandidates}
            linkedTask={selectedLinkedTask}
            defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
            agents={agentStatus?.agents || []}
            assistants={assistants}
            busy={busy}
            reopening={selectedTask ? reopeningTaskId === selectedTask.id : false}
            workspaces={workspaces}
            fallbackWorkdir={state?.runtimeWorkdir}
            subtaskDraft={subtaskDraft}
            onMetaChange={(task, patch) => { void updateTaskMeta(task, patch); }}
            onAssignAssistant={(task, assistantId) => { void assignTaskAssistant(task, assistantId); }}
            onStartStatusChat={startStatusChat}
            onSubtaskDraftChange={setSubtaskDraft}
            onCreateSubtask={(task) => { void createSubtask(task); }}
            onUpdateSubtaskStatus={(task, subtaskId, status) => { void updateSubtaskStatus(task, subtaskId, status); }}
            onStartSubtask={(task, subtaskId) => { void startSubtask(task, subtaskId); }}
            onTaskUpdated={upsertTask}
            onReopen={(task) => { void reopenClosedTask(task); }}
            onOpenLinkedTask={openTaskDetail}
            onCreateSideChatFromSelection={createSideChatFromTaskSelection}
            onCreateTodoFromSelection={createTodoFromTaskSelection}
            buildChatPrompt={buildTaskChatPromptForTask}
            buildChatContext={buildTaskChatContextForTask}
            actions={selectedTask ? (
              <>
                {selectedTaskDailyItem && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => { void revertDailyItemTask(selectedTaskDailyItem); }}
                  >
                    Back to plan
                  </Button>
                )}
                <div className="relative z-[60]">
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
	                      className="absolute right-0 top-[calc(100%+8px)] z-[120] w-44 overflow-hidden rounded-xl border border-edge-h/70 bg-dropdown p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18),0_4px_12px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.03] backdrop-blur-md"
	                      role="menu"
	                    >
                      {selectedTask.jiraKey && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={syncingJiraTaskId === selectedTask.id}
                          onClick={() => {
                            setDetailMenuOpen(false);
                            void syncSingleJiraTask(selectedTask);
                          }}
                          className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-fg-3 transition-colors hover:bg-panel-h hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                        >
                          {syncingJiraTaskId === selectedTask.id ? (
                            <Spinner />
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M21 12a9 9 0 0 1-15 6.7" />
                              <path d="M3 12a9 9 0 0 1 15-6.7" />
                              <path d="M18 3v5h-5" />
                              <path d="M6 21v-5h5" />
                            </svg>
                          )}
                          <span>Sync Jira</span>
                        </button>
                      )}
	                      <button
	                        type="button"
	                        role="menuitem"
                        onClick={() => {
                          setDetailMenuOpen(false);
                          void addExistingTaskToDaily(selectedTask);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-fg-3 transition-colors hover:bg-panel-h hover:text-fg"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M8 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
                          <path d="m9 11 8-8" />
                          <path d="M15 3h6v6" />
                        </svg>
                        <span>Plan today</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDetailMenuOpen(false);
                          setCreateOpen(true);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-fg-3 transition-colors hover:bg-panel-h hover:text-fg"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        <span>Create Work Item</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={resettingTaskId === selectedTask.id}
                        onClick={() => {
                          setDetailMenuOpen(false);
                          setTaskResetTarget(selectedTask);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-semibold text-warn transition-colors hover:bg-warn/[0.10] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {resettingTaskId === selectedTask.id ? (
                          <Spinner />
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.7" />
                            <path d="M3 4v6h6" />
                          </svg>
                        )}
                        <span>Reset task</span>
                      </button>
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
            Delete <span className="font-semibold text-fg">{taskDisplayKey(taskDeleteTarget) || taskDeleteTarget?.title}</span> from Pikiclaw? External tickets are not deleted.
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
      <Modal open={!!taskResetTarget} onClose={() => setTaskResetTarget(null)}>
        <ModalHeader title="Reset task" onClose={() => setTaskResetTarget(null)} />
        <div className="space-y-4">
          <div className="text-[13px] leading-relaxed text-fg-3">
            Reset <span className="font-semibold text-fg">{taskDisplayKey(taskResetTarget) || taskResetTarget?.title}</span>?
            This keeps the ticket and Jira metadata, but clears generated outputs, stage runs, subtasks, verification records, PR link, and returns the task to Backlog.
          </div>
          <div className="rounded-lg border border-warn/25 bg-warn/[0.08] px-3 py-2 text-[12px] leading-relaxed text-warn">
            This only resets Pikiclaw local progress. External Jira tickets are not changed.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={!!resettingTaskId} onClick={() => setTaskResetTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!!resettingTaskId} onClick={() => { void resetTask(); }}>
              {resettingTaskId ? <Spinner /> : null}
              Reset
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
