import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { api } from '../../api';
import { FeatureAgentDialog } from '../../components/FeatureAgentDialog';
import { Badge, Button, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { AgentAssistant, AgentRuntimeStatus, JiraWorkflowConfig, ProSubtaskStatus, ProTask, ProTaskStage, ProTaskStatus, RichMessage, StageRun, VerificationResult, VerificationRun, WorkspaceEntry } from '../../types';
import { cn } from '../../utils';

const STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const STAGES: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix'];
type JiraColumnKey = 'backlog' | 'running' | 'incomplete' | 'review' | 'done';

const JIRA_COLUMNS: Array<{ key: JiraColumnKey; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'Synced or planned' },
  { key: 'running', label: 'Running', hint: 'Refinement in progress' },
  { key: 'incomplete', label: 'Coding', hint: 'Implementation in progress' },
  { key: 'review', label: 'Resolved', hint: 'Ready for validation' },
  { key: 'done', label: 'Done', hint: 'Closed work' },
];

const STATUS_LABEL: Record<ProTaskStatus, string> = {
  backlog: 'Backlog',
  refinement: 'Refinement',
  coding: 'Coding',
  resolved: 'Resolved',
  done: 'Done',
};

const STAGE_LABEL: Record<ProTaskStage, string> = {
  focus: 'Focus',
  refinement: 'Refine',
  coding: 'Code',
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

function formatTime(value: string | null | undefined): string {
  if (!value) return '--';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '--';
  return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function stageTone(stage: ProTaskStage): 'ok' | 'warn' | 'muted' | 'accent' {
  if (stage === 'coding') return 'warn';
  if (stage === 'verification' || stage === 'demo') return 'accent';
  if (stage === 'bugfix') return 'warn';
  return 'muted';
}

function taskCardColor(status: ProTaskStatus): string {
  if (status === 'refinement') return 'border-l-cyan-400 bg-cyan-400/[0.055] hover:bg-cyan-400/[0.09]';
  if (status === 'coding') return 'border-l-amber-400 bg-amber-400/[0.065] hover:bg-amber-400/[0.10]';
  if (status === 'resolved') return 'border-l-sky-400 bg-sky-400/[0.055] hover:bg-sky-400/[0.09]';
  if (status === 'done') return 'border-l-emerald-400 bg-emerald-400/[0.055] hover:bg-emerald-400/[0.09]';
  return 'border-l-slate-400 bg-panel hover:bg-panel-h';
}

function TaskCard({
  task,
  selected,
  busyStage,
  draggable,
  isDragging,
  onSelect,
  onStatus,
  onStartStage,
  onDragStart,
  onDragEnd,
}: {
  task: ProTask;
  selected: boolean;
  busyStage: ProTaskStage | null;
  draggable?: boolean;
  isDragging?: boolean;
  onSelect: (task: ProTask) => void;
  onStatus?: (task: ProTask, status: ProTaskStatus) => void;
  onStartStage?: (task: ProTask, stage: ProTaskStage) => void;
  onDragStart?: (task: ProTask, event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
}) {
  const latestRun = task.stageRuns[0];
  const progress = subtaskProgress(task);
  return (
    <button
      type="button"
      draggable={draggable}
      onClick={() => onSelect(task)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart?.(task, event);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'w-full rounded-md border border-l-4 px-3 py-2.5 text-left shadow-sm transition duration-150',
        draggable && 'cursor-grab active:cursor-grabbing',
        taskCardColor(task.status),
        isDragging && 'scale-[0.98] opacity-35 shadow-none',
        selected ? 'border-[color:var(--th-selection-border)] bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)]' : 'border-edge',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg">{task.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-5">
            {task.jiraKey && <span className="font-mono">{task.jiraKey}</span>}
            {task.sprint && <span>{task.sprint}</span>}
            <span>{formatTime(task.updatedAt)}</span>
          </div>
        </div>
        <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
      </div>
      {task.description && <div className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-fg-4">{task.description}</div>}
      {progress.total > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-edge bg-panel-alt px-2 py-1.5 text-[11px] text-fg-4">
          <span className="font-semibold text-fg-3">Subtasks</span>
          <span>{progress.done}/{progress.total}</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        </div>
      )}
      {latestRun && (
        <div className="mt-2 rounded-md border border-edge bg-panel-alt px-2 py-1.5 text-[11px] text-fg-4">
          Latest: {STAGE_LABEL[latestRun.stage]} · {latestRun.session.agent}:{latestRun.session.sessionId.slice(0, 8)}
        </div>
      )}
    </button>
  );
}

function jiraColumnForTask(task: ProTask): JiraColumnKey {
  if (task.status === 'done') return 'done';
  const latest = task.stageRuns[0];
  if (latest?.status === 'failed' || latest?.status === 'cancelled') return 'incomplete';
  if (task.status === 'resolved') return 'review';
  if (task.status === 'coding') return 'incomplete';
  if (task.status === 'refinement') return 'running';
  return 'backlog';
}

function jiraStatusForColumn(column: JiraColumnKey): ProTaskStatus {
  if (column === 'running') return 'refinement';
  if (column === 'incomplete') return 'coding';
  if (column === 'review') return 'resolved';
  if (column === 'done') return 'done';
  return 'backlog';
}

function jiraStageForStatus(status: ProTaskStatus): ProTaskStage | null {
  if (status === 'refinement') return 'refinement';
  if (status === 'coding') return 'coding';
  return null;
}

function CreateJiraTaskModal({
  open,
  creating,
  workspaces,
  assistants,
  defaultWorkdir,
  defaultAgent,
  onClose,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  workspaces: WorkspaceEntry[];
  assistants: AgentAssistant[];
  defaultWorkdir: string;
  defaultAgent: string;
  onClose: () => void;
  onCreate: (draft: { title: string; description: string; workdir: string; defaultAgent: string; defaultAssistantId: string }) => void;
}) {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    workdir: defaultWorkdir,
    defaultAgent,
    defaultAssistantId: assistants.find(item => item.id === 'assistant_refinement')?.id || '',
  });

  useEffect(() => {
    if (!open) return;
    setDraft(prev => ({
      ...prev,
      workdir: prev.workdir || defaultWorkdir,
      defaultAgent: prev.defaultAgent || defaultAgent,
      defaultAssistantId: prev.defaultAssistantId || assistants.find(item => item.id === 'assistant_refinement')?.id || '',
    }));
  }, [assistants, defaultAgent, defaultWorkdir, open]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Create Jira task" onClose={onClose} />
      <div className="space-y-3">
        <Input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} placeholder="Title" />
        <textarea
          autoFocus
          value={draft.description}
          onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))}
          placeholder="Description"
          className="min-h-28 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
        <div className="grid gap-2 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Workspace</div>
            <select value={draft.workdir} onChange={event => setDraft(prev => ({ ...prev, workdir: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {workspaces.map(ws => <option key={ws.path} value={ws.path}>{ws.name || ws.path.split('/').pop() || ws.path}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Agent</div>
            <select value={draft.defaultAgent} onChange={event => setDraft(prev => ({ ...prev, defaultAgent: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes'].map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Assistant</div>
            <select value={draft.defaultAssistantId} onChange={event => setDraft(prev => ({ ...prev, defaultAssistantId: event.target.value }))} className="h-9 w-full rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">Runtime default</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
        <Button variant="primary" disabled={!draft.title.trim() || creating} onClick={() => onCreate(draft)}>
          {creating ? <Spinner /> : null}
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
          {renderSelect('Running / Refinement', 'refinementAssistantId')}
          {renderSelect('Coding', 'codingAssistantId')}
          {renderSelect('Daily sync', 'ticketSyncAssistantId')}
          {renderSelect('Knowledge', 'knowledgeAssistantId')}
        </div>
        <div className="space-y-2 rounded-md border border-edge bg-panel-alt px-3 py-2.5">
          <label className="flex items-center justify-between gap-3 text-[12px] text-fg-3">
            <span>Run Knowledge Assistant when task enters Running</span>
            <input
              type="checkbox"
              checked={draft.runKnowledgeOnRefinement !== false}
              onChange={event => setDraft(prev => ({ ...prev, runKnowledgeOnRefinement: event.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[12px] text-fg-3">
            <span>Run Knowledge Assistant when task enters Coding</span>
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
            {STATUSES.map(renderStatusWorkflow)}
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

function compactMessageText(message: RichMessage): string {
  const text = message.text || message.blocks?.filter(block => block.type === 'text').map(block => block.content).join('\n') || '';
  return text.trim();
}

function StageRunChatPreview({ run }: { run: StageRun }) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<RichMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSessionMessages(run.session.workdir, run.session.agent, run.session.sessionId, { lastNTurns: 4, rich: true })
      .then(result => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error || 'Failed to load chat');
          setMessages([]);
          return;
        }
        setMessages((result.richMessages || []).slice(-8));
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [run.session.agent, run.session.sessionId, run.session.workdir]);

  const visible = expanded ? messages : messages.slice(-4);
  return (
    <div className="mt-3 rounded-md border border-edge bg-inset px-2.5 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Chat</div>
        {messages.length > 4 && (
          <button type="button" onClick={() => setExpanded(prev => !prev)} className="text-[11px] font-medium text-primary hover:underline">
            {expanded ? 'Collapse' : `Show ${messages.length} messages`}
          </button>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-fg-5"><Spinner /> Loading chat...</div>
      ) : error ? (
        <div className="text-[12px] text-err">{error}</div>
      ) : visible.length === 0 ? (
        <div className="text-[12px] text-fg-5">No chat transcript yet.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((message, index) => {
            const text = compactMessageText(message);
            if (!text) return null;
            return (
              <div key={`${message.role}-${message.createdAt || index}`} className={cn(
                'rounded-md border px-2 py-1.5 text-[12px] leading-relaxed',
                message.role === 'user'
                  ? 'border-primary/20 bg-primary/[0.055] text-fg-3'
                  : 'border-edge bg-panel text-fg-4',
              )}>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">{message.role === 'user' ? 'User' : 'Agent'}</div>
                <div className="max-h-44 overflow-auto whitespace-pre-wrap">{text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JiraNativeFields({
  task,
  saving,
  onSave,
}: {
  task: ProTask;
  saving?: boolean;
  onSave: (task: ProTask, fields: { reporter?: string; assignee?: string; status?: string; dueDate?: string; priority?: string; labels?: string[] }) => void;
}) {
  const fields = task.jiraFields || {};
  const [draft, setDraft] = useState({
    reporter: fields.reporter || '',
    assignee: fields.assignee || '',
    status: fields.status || '',
    dueDate: fields.dueDate || '',
    priority: fields.priority || '',
    labels: (fields.labels || []).join(', '),
  });

  useEffect(() => {
    setDraft({
      reporter: fields.reporter || '',
      assignee: fields.assignee || '',
      status: fields.status || '',
      dueDate: fields.dueDate || '',
      priority: fields.priority || '',
      labels: (fields.labels || []).join(', '),
    });
  }, [task.id, fields.reporter, fields.assignee, fields.status, fields.dueDate, fields.priority, fields.labels]);

  return (
    <details className="rounded-md border border-edge bg-panel-alt px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">
        Jira native fields
      </summary>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Input value={draft.reporter} onChange={event => setDraft(prev => ({ ...prev, reporter: event.target.value }))} placeholder="Reporter" />
        <Input value={draft.assignee} onChange={event => setDraft(prev => ({ ...prev, assignee: event.target.value }))} placeholder="Assignee" />
        <Input value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value }))} placeholder="Jira ticket status" />
        <Input value={draft.dueDate} onChange={event => setDraft(prev => ({ ...prev, dueDate: event.target.value }))} placeholder="Due date" />
        <Input value={draft.priority} onChange={event => setDraft(prev => ({ ...prev, priority: event.target.value }))} placeholder="Priority" />
        <Input value={draft.labels} onChange={event => setDraft(prev => ({ ...prev, labels: event.target.value }))} placeholder="Labels, comma separated" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-fg-5">
          Pikiclaw status remains separate. Jira ticket status is manually synced here.
          {fields.updatedAt ? ` Last synced ${formatTime(fields.updatedAt)}.` : ''}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => onSave(task, {
            reporter: draft.reporter,
            assignee: draft.assignee,
            status: draft.status,
            dueDate: draft.dueDate,
            priority: draft.priority,
            labels: parseModelPool(draft.labels),
          })}
        >
          {saving ? <Spinner /> : null}
          Save Jira fields
        </Button>
      </div>
    </details>
  );
}

function TaskStatusProgress({ status }: { status: ProTaskStatus }) {
  const activeIndex = Math.max(0, STATUSES.indexOf(status));
  return (
    <div className="rounded-md border border-edge bg-panel-alt px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Status progress</div>
        <Badge variant={taskStatusTone(status)}>{STATUS_LABEL[status]}</Badge>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {STATUSES.map((item, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={item} className="min-w-0">
              <div
                className={cn(
                  'h-1.5 rounded-full transition',
                  done ? 'bg-[var(--th-ok)]' : active ? 'bg-primary' : 'bg-inset',
                )}
              />
              <div className={cn('mt-1 truncate text-[10px] font-medium', active ? 'text-fg-2' : done ? 'text-fg-4' : 'text-fg-5')}>
                {STATUS_LABEL[item]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskTimeAudit({ task }: { task: ProTask }) {
  const userSeconds = taskUserFocusSeconds(task);
  const agentSeconds = taskAgentSeconds(task);
  const lifecycleSeconds = taskLifecycleSeconds(task);
  const focusCount = task.focusSessions?.length || 0;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-md border border-edge bg-panel-alt px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">My focus</div>
        <div className="mt-1 text-[15px] font-semibold text-fg">{formatDuration(userSeconds)}</div>
        <div className="mt-0.5 text-[11px] text-fg-5">{focusCount} opens</div>
      </div>
      <div className="rounded-md border border-edge bg-panel-alt px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Agent time</div>
        <div className="mt-1 text-[15px] font-semibold text-fg">{formatDuration(agentSeconds)}</div>
        <div className="mt-0.5 text-[11px] text-fg-5">{task.stageRuns.length} runs</div>
      </div>
      <div className="rounded-md border border-edge bg-panel-alt px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-5">Lifecycle</div>
        <div className="mt-1 text-[15px] font-semibold text-fg">{formatDuration(lifecycleSeconds)}</div>
        <div className="mt-0.5 text-[11px] text-fg-5">created {formatTime(task.createdAt)}</div>
      </div>
    </div>
  );
}

function TaskDetail({
  task,
  verifyDraft,
  onVerifyDraft,
  assistants,
  agents,
  config,
  onStartVerification,
  onFinishVerification,
  onCompleteStage,
  onExclusiveMode,
  onExecution,
  onStatus,
  onStartStage,
  onDelete,
  onUpdateJiraFields,
  deleting,
  savingJiraFields,
  busyStage,
}: {
  task: ProTask | null;
  verifyDraft: { environment: string; url: string; notes: string };
  onVerifyDraft: (patch: Partial<{ environment: string; url: string; notes: string }>) => void;
  assistants: AgentAssistant[];
  agents: AgentRuntimeStatus[];
  config: JiraWorkflowConfig;
  onStartVerification: (task: ProTask) => void;
  onFinishVerification: (task: ProTask, run: VerificationRun, result: VerificationResult) => void;
  onCompleteStage: (task: ProTask, run: StageRun) => void;
  onExclusiveMode: (task: ProTask, enabled: boolean) => void;
  onExecution: (task: ProTask, patch: { ownerMode?: 'status' | 'agent' | 'assistant'; agent?: string | null; assistantId?: string | null; mode?: 'direct' | 'interactive' }) => void;
  onStatus: (task: ProTask, status: ProTaskStatus) => void;
  onStartStage: (task: ProTask, stage: ProTaskStage) => void;
  onDelete: (task: ProTask) => void;
  onUpdateJiraFields: (task: ProTask, fields: { reporter?: string; assignee?: string; status?: string; dueDate?: string; priority?: string; labels?: string[] }) => void;
  deleting?: boolean;
  savingJiraFields?: boolean;
  busyStage?: ProTaskStage | null;
}) {
  if (!task) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-edge bg-panel text-sm text-fg-4">
        Select a Jira task
      </div>
    );
  }
  const execution = resolveTaskExecution(task, config);
  const ownerLabel = execution.ownerMode === 'assistant'
    ? assistants.find(assistant => assistant.id === execution.assistantId)?.name || execution.assistantId || 'Runtime assistant'
    : execution.ownerMode === 'agent'
      ? agents.find(agent => agent.agent === execution.agent)?.label || execution.agent || 'Runtime agent'
      : 'Per-status workflow';
  return (
    <div className="h-full overflow-y-auto rounded-md border border-edge bg-panel">
      <div className="border-b border-edge bg-panel px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {task.jiraKey && <span className="font-mono text-[12px] font-semibold text-primary">{task.jiraKey}</span>}
              <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
              <Badge variant="muted">{task.kind}</Badge>
              {task.exclusiveMode && <Badge variant="warn">Exclusive</Badge>}
            </div>
            <h3 className="text-[18px] font-semibold leading-snug text-fg">{task.title}</h3>
          </div>
          <Button variant="ghost" disabled={deleting} onClick={() => onDelete(task)}>
            {deleting ? <Spinner /> : null}
            Delete
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <TaskStatusProgress status={task.status} />
          <TaskTimeAudit task={task} />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
          <section className="min-w-0 rounded-md border border-edge bg-panel-alt px-3 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Details</div>
            <div className="grid gap-x-4 gap-y-2 text-[12px] md:grid-cols-2">
              <div>
                <div className="text-fg-5">Workspace</div>
                <div className="truncate text-fg-3" title={task.workdir || undefined}>{task.workdir || '--'}</div>
              </div>
              <div>
                <div className="text-fg-5">Sprint</div>
                <div className="text-fg-3">{task.sprint || '--'}</div>
              </div>
              <div>
                <div className="text-fg-5">Jira status</div>
                <div className="text-fg-3">{task.jiraFields?.status || '--'}</div>
              </div>
              <div>
                <div className="text-fg-5">Assignee</div>
                <div className="text-fg-3">{task.jiraFields?.assignee || '--'}</div>
              </div>
            </div>
            {task.jiraUrl && (
              <a className="mt-3 inline-flex text-[12px] font-medium text-primary hover:underline" href={task.jiraUrl} target="_blank" rel="noreferrer">Open Jira ticket</a>
            )}
          </section>

          <section className="rounded-md border border-edge bg-panel-alt px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Execution</div>
              <span className="truncate text-[11px] text-fg-5" title={ownerLabel}>{ownerLabel}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <select
                value={task.status}
                onChange={event => onStatus(task, event.target.value as ProTaskStatus)}
                className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
                title="Pikiclaw task status"
              >
                {STATUSES.map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
              </select>
              <select
                value={execution.mode}
                onChange={event => onExecution(task, { mode: event.target.value as 'direct' | 'interactive' })}
                className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
                title="Execution mode"
              >
                <option value="direct">Direct mode</option>
                <option value="interactive">Needs input</option>
              </select>
              <select
                value={execution.ownerMode}
                onChange={event => onExecution(task, { ownerMode: event.target.value as 'status' | 'agent' | 'assistant' })}
                className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
                title="Lifecycle owner mode"
              >
                <option value="status">Per-status</option>
                <option value="agent">Single agent</option>
                <option value="assistant">Single assistant</option>
              </select>
              {execution.ownerMode === 'assistant' ? (
                <select
                  value={execution.assistantId}
                  onChange={event => onExecution(task, { assistantId: event.target.value || null })}
                  className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
                >
                  <option value="">Default assistant</option>
                  {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
                </select>
              ) : (
                <select
                  value={execution.agent}
                  onChange={event => onExecution(task, { agent: event.target.value || null })}
                  disabled={execution.ownerMode !== 'agent'}
                  className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40 disabled:opacity-50"
                >
                  <option value="">Runtime agent</option>
                  {agents.filter(agent => agent.installed).map(agent => <option key={agent.agent} value={agent.agent}>{agent.label}</option>)}
                </select>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value=""
                disabled={!!busyStage}
                onChange={event => {
                  const stage = event.target.value as ProTaskStage;
                  if (stage) onStartStage(task, stage);
                }}
                className="h-8 rounded-md border border-edge bg-panel px-2.5 text-[12px] text-fg outline-none focus:border-primary/40 disabled:opacity-50"
              >
                <option value="">Start agent stage...</option>
                {STAGES.map(stage => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}
              </select>
              <button
                type="button"
                onClick={() => onExclusiveMode(task, !task.exclusiveMode)}
                className="h-8 rounded-md border border-edge bg-panel px-2.5 text-[12px] font-medium text-fg-4 transition-colors hover:border-edge-h hover:bg-panel-h hover:text-fg"
              >
                {task.exclusiveMode ? 'Shared focus' : 'Exclusive focus'}
              </button>
            </div>
          </section>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {task.description && (
          <section>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Description</div>
            <div className="whitespace-pre-wrap rounded-md border border-edge bg-panel-alt px-3 py-3 text-[13px] leading-relaxed text-fg-3">{task.description}</div>
          </section>
        )}
        <JiraNativeFields task={task} saving={savingJiraFields} onSave={onUpdateJiraFields} />
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Agent Activity</div>
            <select
              value=""
              disabled={!!busyStage}
              onChange={event => {
                const stage = event.target.value as ProTaskStage;
                if (stage) onStartStage(task, stage);
              }}
              className="h-8 rounded-md border border-edge bg-panel px-2.5 text-[12px] text-fg outline-none focus:border-primary/40 disabled:opacity-50"
            >
              <option value="">New side stage...</option>
              {STAGES.map(stage => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {task.stageRuns.length === 0 ? (
              <div className="rounded-md border border-edge bg-panel-alt px-3 py-6 text-center text-[12px] text-fg-5">No agent activity yet.</div>
            ) : task.stageRuns.map(run => (
              <div key={run.id} className="rounded-md border border-edge bg-panel-alt px-3 py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant={stageTone(run.stage)}>{STAGE_LABEL[run.stage]}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] text-fg-3">{run.session.agent}:{run.session.sessionId}</div>
                    <div className="mt-0.5 text-[11px] text-fg-5">{formatTime(run.startedAt)} · {run.status} · {run.selectedAgentReason}</div>
                  </div>
                  {run.status !== 'completed' && (
                    <Button size="sm" variant="ghost" onClick={() => onCompleteStage(task, run)}>Complete</Button>
                  )}
                </div>
                {estimateSummary(run) && (
                  <div className="mt-2 rounded-md border border-edge bg-inset px-2 py-1 text-[11px] text-fg-4">
                    Estimate: {estimateSummary(run)}
                  </div>
                )}
                <StageRunChatPreview run={run} />
                {(run.output?.branch || run.output?.testResultId || run.output?.diffSummary || run.output?.changedFiles?.length) && (
                  <div className="mt-2 rounded-md border border-edge bg-inset px-2 py-2 text-[11px] text-fg-4">
                    {run.output.branch && <div>Branch: <span className="font-mono text-fg-3">{run.output.branch}</span></div>}
                    {run.output.testResultId && <div>Test: <span className="font-mono text-fg-3">{run.output.testResultId}</span></div>}
                    {run.output.diffSummary && <div className="mt-1 whitespace-pre-wrap">{run.output.diffSummary}</div>}
                    {!!run.output.changedFiles?.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {run.output.changedFiles.map(file => (
                          <span key={file} className="rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[10px] text-fg-4">{file}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {run.focus && (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-edge bg-inset px-2 py-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Mind Map</div>
                      <div className="space-y-1">
                        {run.focus.mindMap.map(node => (
                          <div key={node.id} className="text-[11px] text-fg-4" style={{ paddingLeft: node.parentId ? 14 : 0 }}>
                            {node.parentId ? '- ' : ''}{node.label}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md border border-edge bg-inset px-2 py-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Focus Questions</div>
                      <div className="space-y-1">
                        {run.focus.questions.map(question => (
                          <div key={question.id} className="text-[11px] text-fg-4">
                            <span className="font-medium text-fg-3">{question.topic}:</span> {question.question}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-fg-4">Prompt</summary>
                  <pre className="mt-2 max-h-52 overflow-auto rounded-md border border-edge bg-inset p-2 text-[11px] leading-relaxed text-fg-3 whitespace-pre-wrap">{run.prompt}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Verification</div>
          <div className="rounded-md border border-edge bg-panel-alt px-3 py-3">
            <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)_auto]">
              <Input value={verifyDraft.environment} onChange={event => onVerifyDraft({ environment: event.target.value })} placeholder="cnlab03" />
              <Input value={verifyDraft.url} onChange={event => onVerifyDraft({ url: event.target.value })} placeholder="https://..." />
              <Button variant="secondary" disabled={!verifyDraft.url.trim()} onClick={() => onStartVerification(task)}>Open Verify</Button>
            </div>
            <textarea
              value={verifyDraft.notes}
              onChange={event => onVerifyDraft({ notes: event.target.value })}
              placeholder="Verification notes"
              className="mt-2 min-h-16 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[12px] text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
            />
            <div className="mt-3 space-y-2">
              {(task.verificationRuns || []).length === 0 ? (
                <div className="text-[12px] text-fg-5">No verification run yet.</div>
              ) : task.verificationRuns.map(run => (
                <div key={run.id} className="rounded-md border border-edge bg-inset px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={run.result === 'passed' ? 'ok' : run.result === 'failed' ? 'err' : run.result === 'blocked' ? 'warn' : 'muted'}>
                      {run.result || 'not-run'}
                    </Badge>
                    <span className="text-[12px] text-fg-4">{run.environment}</span>
                    {run.browserSession?.url && <a className="truncate text-[12px] text-primary hover:underline" href={run.browserSession.url} target="_blank" rel="noreferrer">{run.browserSession.url}</a>}
                  </div>
                  <div className="mt-1 text-[11px] text-fg-5">{formatTime(run.startedAt)}{run.completedAt ? ` - ${formatTime(run.completedAt)}` : ''}</div>
                  {!run.completedAt && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {VERIFY_RESULTS.map(result => (
                        <Button key={result} size="sm" variant="ghost" onClick={() => onFinishVerification(task, run, result)}>
                          Mark {result}
                        </Button>
                      ))}
                    </div>
                  )}
                  {run.notes && <div className="mt-2 whitespace-pre-wrap text-[12px] text-fg-4">{run.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Ticket Timeline</div>
          {!!task.focusSessions?.length && (
            <div className="mb-2 rounded-md border border-edge bg-panel-alt px-3 py-2">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">My focus sessions</div>
              <div className="space-y-1">
                {task.focusSessions.slice(0, 8).map(session => (
                  <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span className="text-fg-3">{formatTime(session.openedAt)}</span>
                    <span className="text-fg-5">
                      {formatDuration(typeof session.durationSeconds === 'number' ? session.durationSeconds : secondsBetween(session.openedAt, session.closedAt || new Date().toISOString()))}
                      {!session.closedAt ? ' · active' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {task.events.map(event => (
              <div key={event.id} className="rounded-md border border-edge bg-panel-alt px-3 py-2">
                <div className="text-[12px] text-fg-3">{event.summary}</div>
                <div className="mt-1 text-[11px] text-fg-5">{event.type} · {event.actor} · {formatTime(event.createdAt)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function JiraTab() {
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const agentStatus = useStore(s => s.agentStatus);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [tasks, setTasks] = useState<ProTask[]>([]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [savingJiraFieldsTaskId, setSavingJiraFieldsTaskId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<JiraColumnKey | null>(null);
  const [jiraConfig, setJiraConfig] = useState<JiraWorkflowConfig>(DEFAULT_JIRA_ASSISTANT_CONFIG);
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [verifyDraft, setVerifyDraft] = useState({ environment: 'cnlab03', url: '', notes: '' });
  const [subtaskDraft, setSubtaskDraft] = useState({ title: '', description: '', assignedAgent: '', assistantId: '' });
  const activeFocusSessionRef = useRef<{ taskId: string; focusSessionId: string } | null>(null);

  const sprintOptions = useMemo(() => {
    return Array.from(new Set(tasks.map(task => task.sprint).filter((sprint): sprint is string => !!sprint))).sort();
  }, [tasks]);
  const visibleTasks = useMemo(() => {
    return selectedSprint === 'all'
      ? tasks
      : tasks.filter(task => task.sprint === selectedSprint);
  }, [selectedSprint, tasks]);
  const byStatus = useMemo(() => {
    const grouped = new Map<JiraColumnKey, ProTask[]>();
    for (const column of JIRA_COLUMNS) grouped.set(column.key, []);
    for (const task of visibleTasks) grouped.get(jiraColumnForTask(task))?.push(task);
    return grouped;
  }, [visibleTasks]);
  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedId) || null, [selectedId, tasks]);
  const draggingTask = useMemo(() => tasks.find(task => task.id === draggingTaskId) || null, [draggingTaskId, tasks]);

  useEffect(() => {
    if (selectedSprint !== 'all' && !sprintOptions.includes(selectedSprint)) setSelectedSprint('all');
  }, [selectedSprint, sprintOptions]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [result, assistantsResult, workspacesResult, jiraConfigResult] = await Promise.all([
        api.getProTasks(),
        api.getProAssistants(),
        api.getWorkspaces(),
        api.getJiraWorkflowConfig(),
      ]);
      if (!result.ok) throw new Error(result.error || 'Failed to load Jira tasks');
      setTasks(result.tasks);
      if (assistantsResult.ok) setAssistants(assistantsResult.assistants || []);
      if (workspacesResult.ok) setWorkspaces(workspacesResult.workspaces || []);
      if (jiraConfigResult.ok) setJiraConfig({ ...DEFAULT_JIRA_ASSISTANT_CONFIG, ...jiraConfigResult.config });
      setSelectedId(current => current || result.tasks[0]?.id || null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load Jira tasks', false);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upsertTask = useCallback((task: ProTask) => {
    setTasks(prev => {
      const next = prev.filter(item => item.id !== task.id);
      next.unshift(task);
      return next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
    setSelectedId(task.id);
  }, []);

  const openTaskDetail = useCallback((task: ProTask) => {
    setSelectedId(task.id);
    setDetailOpen(true);
  }, []);

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
    const title = taskDraft.title.trim();
    if (!title) return;
    setCreating(true);
    try {
      const result = await api.createProTask({
        title,
        description: taskDraft.description,
        sprint: selectedSprint !== 'all' ? selectedSprint : undefined,
        kind: 'jira-ticket',
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
  }, [selectedSprint, state?.runtimeWorkdir, toast, upsertTask]);

  const updateStatus = useCallback(async (task: ProTask, status: ProTaskStatus): Promise<ProTask | null> => {
    try {
      const result = await api.updateProTaskStatus(task.id, status);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task');
      upsertTask(result.task);
      return result.task;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update task', false);
      return null;
    }
  }, [toast, upsertTask]);

  const deleteTask = useCallback(async (task: ProTask) => {
    if (deletingTaskId) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete Jira task "${task.title}" from Pikiclaw?`)) return;
    setDeletingTaskId(task.id);
    try {
      const result = await api.deleteProTask(task.id);
      if (!result.ok) throw new Error(result.error || 'Failed to delete task');
      setTasks(prev => prev.filter(item => item.id !== task.id));
      setSelectedId(current => current === task.id ? null : current);
      setDetailOpen(false);
      toast('Jira task deleted');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete task', false);
    } finally {
      setDeletingTaskId(null);
    }
  }, [deletingTaskId, toast]);

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

  const startStage = useCallback(async (
    task: ProTask,
    stage: ProTaskStage,
    options: { assistantId?: string; agent?: string | null; prompt?: string; model?: string | null; executionMode?: 'direct' | 'interactive' } = {},
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
      toast('Verification opened');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start verification', false);
    }
  }, [toast, upsertTask, verifyDraft]);

  const finishVerification = useCallback(async (task: ProTask, run: VerificationRun, resultValue: VerificationResult) => {
    try {
      const result = await api.finishVerificationRun(task.id, run.id, resultValue, verifyDraft.notes);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to finish verification');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to finish verification', false);
    }
  }, [toast, upsertTask, verifyDraft.notes]);

  return (
    <div className="flex h-full min-h-[640px] flex-col rounded-xl border border-edge bg-panel" style={{ boxShadow: 'var(--th-card-shadow)' }}>
      <div className="shrink-0 border-b border-edge/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg">Jira Dashboard</div>
            <div className="mt-0.5 text-[11px] text-fg-5">Track Jira-backed tasks with the same lightweight board layout as Workspace.</div>
          </div>
          <select
            value={selectedSprint}
            onChange={event => setSelectedSprint(event.target.value || 'all')}
            className="h-8 min-w-[150px] rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
          >
            <option value="all">All sprints</option>
            {sprintOptions.map(sprint => (
              <option key={sprint} value={sprint}>{sprint}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            Assistants
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAgentCreateOpen(true)}>
            Agent create
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create task
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-fg-4"><Spinner /> {t('sessions.loading')}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
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
                  'min-h-0 rounded-lg border border-edge/50 bg-panel-alt/35 flex flex-col overflow-hidden transition',
                  dragOverColumn === column.key ? 'border-primary/45 bg-[var(--th-selection-bg)] ring-2 ring-inset ring-[color:var(--th-selection-ring)]' : '',
                )}
              >
                <div className="shrink-0 border-b border-edge/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="muted" className="h-5 px-2 text-[10px]">{byStatus.get(column.key)?.length || 0}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-fg-2">{column.label}</div>
                      <div className="truncate text-[10px] text-fg-5">{column.hint}</div>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {dragOverColumn === column.key && draggingTask && jiraColumnForTask(draggingTask) !== column.key && (
                    <div className="mb-2 flex h-[76px] items-center justify-center rounded-md border border-dashed border-primary/45 bg-primary/[0.055] text-[11px] font-medium text-primary">
                      Drop to move to {column.label}
                    </div>
                  )}
                  {(byStatus.get(column.key) || []).length === 0 ? (
                    <div className={cn(
                      'flex h-24 items-center justify-center rounded-md border border-dashed text-[11px]',
                      dragOverColumn === column.key
                        ? 'border-primary/35 bg-primary/[0.035] text-primary/80'
                        : 'border-edge/40 text-fg-5/60',
                    )}>No tasks</div>
                  ) : (
                    <div className="space-y-2">
                      {(byStatus.get(column.key) || []).map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          selected={false}
                          busyStage={busy?.taskId === task.id ? busy.stage : null}
                          draggable
                          isDragging={draggingTaskId === task.id}
                          onSelect={openTaskDetail}
                          onDragStart={(next) => setDraggingTaskId(next.id)}
                          onDragEnd={() => {
                            setDraggingTaskId(null);
                            setDragOverColumn(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      <CreateJiraTaskModal
        open={createOpen}
        creating={creating}
        workspaces={workspaces.length ? workspaces : [{ path: state?.runtimeWorkdir || '', name: state?.runtimeWorkdir || 'Workspace' }]}
        assistants={assistants}
        defaultWorkdir={state?.runtimeWorkdir || workspaces[0]?.path || ''}
        defaultAgent={state?.bot?.defaultAgent || state?.config?.defaultAgent || 'codex'}
        onClose={() => setCreateOpen(false)}
        onCreate={createTask}
      />
      <FeatureAgentDialog
        open={agentCreateOpen}
        onClose={() => setAgentCreateOpen(false)}
        workdir={state?.runtimeWorkdir || workspaces[0]?.path || ''}
        config={{
          kind: 'jira-task',
          title: 'Create Jira task with Agent',
          description: 'Use a task-creation assistant to clarify goal, boundary, acceptance points, workspace, owner mode, and execution mode before the task is created.',
          assistantName: 'Task Creator Assistant',
          assistantResponsibility: 'Guide rough intent into a clear Jira/Pikiclaw task by asking for missing goal, boundary, assumptions, acceptance points, workspace, lifecycle owner, and direct or interactive execution preference.',
          placeholder: 'Describe what you want to do. Example: help me create a task for verifying cnlab03 login after the new deployment.',
          submitLabel: 'Start task assistant',
        }}
      />
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
        onClose={() => setDetailOpen(false)}
        wide
        panelStyle={{ maxWidth: 'min(960px, calc(100vw - 32px))' }}
      >
        <ModalHeader title="Jira task focus mode" description="Time is tracked while this focus window is open." onClose={() => setDetailOpen(false)} />
        <div className="h-[min(72vh,760px)]">
          <TaskDetail
            task={selectedTask}
            verifyDraft={verifyDraft}
            onVerifyDraft={(patch) => setVerifyDraft(prev => ({ ...prev, ...patch }))}
            assistants={assistants}
            agents={agentStatus?.agents || []}
            config={jiraConfig}
            onStartVerification={startVerification}
            onFinishVerification={finishVerification}
            onCompleteStage={completeStage}
            onExclusiveMode={toggleExclusiveMode}
            onExecution={(task, patch) => { void updateTaskExecution(task, patch); }}
            onStatus={(task, status) => { void moveTaskToStatus(task, status); }}
            onStartStage={(task, stage) => { void startStage(task, stage); }}
            onDelete={(task) => { void deleteTask(task); }}
            onUpdateJiraFields={(task, fields) => { void updateTaskJiraFields(task, fields); }}
            deleting={!!selectedTask && deletingTaskId === selectedTask.id}
            savingJiraFields={!!selectedTask && savingJiraFieldsTaskId === selectedTask.id}
            busyStage={selectedTask && busy?.taskId === selectedTask.id ? busy.stage : null}
          />
        </div>
      </Modal>
    </div>
  );
}
