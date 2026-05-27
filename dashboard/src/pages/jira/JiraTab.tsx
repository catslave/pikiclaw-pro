import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Input, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { ProTask, ProTaskStage, ProTaskStatus } from '../../types';
import { cn } from '../../utils';

const STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const STAGES: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix'];

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

function formatTime(value: string | null | undefined): string {
  if (!value) return '--';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '--';
  return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function TaskCard({
  task,
  selected,
  busyStage,
  onSelect,
  onStatus,
  onStartStage,
}: {
  task: ProTask;
  selected: boolean;
  busyStage: ProTaskStage | null;
  onSelect: (task: ProTask) => void;
  onStatus: (task: ProTask, status: ProTaskStatus) => void;
  onStartStage: (task: ProTask, stage: ProTaskStage) => void;
}) {
  const latestRun = task.stageRuns[0];
  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className={cn(
        'w-full rounded-md border bg-panel px-3 py-2.5 text-left shadow-sm transition hover:border-edge-h hover:bg-panel-h',
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
      {latestRun && (
        <div className="mt-2 rounded-md border border-edge bg-panel-alt px-2 py-1.5 text-[11px] text-fg-4">
          Latest: {STAGE_LABEL[latestRun.stage]} · {latestRun.session.agent}:{latestRun.session.sessionId.slice(0, 8)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STAGES.map(stage => (
          <Button
            key={stage}
            size="sm"
            variant={stage === 'coding' ? 'secondary' : 'ghost'}
            disabled={!!busyStage}
            onClick={(event) => {
              event.stopPropagation();
              onStartStage(task, stage);
            }}
          >
            {busyStage === stage ? <Spinner /> : null}
            {STAGE_LABEL[stage]}
          </Button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUSES.filter(status => status !== task.status).map(status => (
          <Button
            key={status}
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onStatus(task, status);
            }}
          >
            Move {STATUS_LABEL[status]}
          </Button>
        ))}
      </div>
    </button>
  );
}

function TaskDetail({ task }: { task: ProTask | null }) {
  if (!task) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-edge bg-panel text-sm text-fg-4">
        Select a Jira task
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto rounded-md border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-fg">{task.title}</h3>
          <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-[12px] text-fg-5">
          {task.jiraKey && <span className="font-mono">{task.jiraKey}</span>}
          {task.jiraUrl && <a className="text-primary hover:underline" href={task.jiraUrl} target="_blank" rel="noreferrer">Open Jira</a>}
          {task.workdir && <span className="truncate">{task.workdir}</span>}
        </div>
      </div>
      <div className="space-y-4 px-4 py-3">
        {task.description && (
          <section>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Description</div>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-3">{task.description}</div>
          </section>
        )}
        <section>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Stage Chats</div>
          <div className="space-y-2">
            {task.stageRuns.length === 0 ? (
              <div className="rounded-md border border-edge bg-panel-alt px-3 py-2 text-[12px] text-fg-5">No stage chat yet.</div>
            ) : task.stageRuns.map(run => (
              <div key={run.id} className="rounded-md border border-edge bg-panel-alt px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={stageTone(run.stage)}>{STAGE_LABEL[run.stage]}</Badge>
                  <span className="text-[12px] font-mono text-fg-4">{run.session.agent}:{run.session.sessionId}</span>
                </div>
                <div className="mt-1 text-[11px] text-fg-5">{formatTime(run.startedAt)} · {run.selectedAgentReason}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-fg-4">Prompt</summary>
                  <pre className="mt-2 max-h-52 overflow-auto rounded-md border border-edge bg-inset p-2 text-[11px] leading-relaxed text-fg-3 whitespace-pre-wrap">{run.prompt}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Timeline</div>
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
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);

  const [tasks, setTasks] = useState<ProTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draft, setDraft] = useState({ title: '', jiraKey: '', sprint: '', description: '' });

  const selectedTask = tasks.find(task => task.id === selectedId) || tasks[0] || null;
  const byStatus = useMemo(() => {
    const grouped = new Map<ProTaskStatus, ProTask[]>();
    for (const status of STATUSES) grouped.set(status, []);
    for (const task of tasks) grouped.get(task.status)?.push(task);
    return grouped;
  }, [tasks]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getProTasks();
      if (!result.ok) throw new Error(result.error || 'Failed to load Jira tasks');
      setTasks(result.tasks);
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

  const createTask = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    setCreating(true);
    try {
      const result = await api.createProTask({
        title,
        description: draft.description,
        jiraKey: draft.jiraKey,
        sprint: draft.sprint,
        kind: 'jira-ticket',
        workdir: state?.runtimeWorkdir,
      });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to create task');
      upsertTask(result.task);
      setDraft({ title: '', jiraKey: '', sprint: '', description: '' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create task', false);
    } finally {
      setCreating(false);
    }
  }, [draft, state?.runtimeWorkdir, toast, upsertTask]);

  const updateStatus = useCallback(async (task: ProTask, status: ProTaskStatus) => {
    try {
      const result = await api.updateProTaskStatus(task.id, status);
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to update task');
      upsertTask(result.task);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update task', false);
    }
  }, [toast, upsertTask]);

  const startStage = useCallback(async (task: ProTask, stage: ProTaskStage) => {
    setBusy({ taskId: task.id, stage });
    try {
      const result = await api.startProTaskStage(task.id, stage, { workdir: task.workdir || state?.runtimeWorkdir });
      if (!result.ok || !result.task) throw new Error(result.error || 'Failed to start stage chat');
      upsertTask(result.task);
      toast(`${STAGE_LABEL[stage]} stage chat queued`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start stage chat', false);
    } finally {
      setBusy(null);
    }
  }, [state?.runtimeWorkdir, toast, upsertTask]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-edge bg-panel px-4 py-3">
        <div className="grid gap-2 lg:grid-cols-[1fr_150px_120px_auto]">
          <Input
            value={draft.title}
            onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))}
            placeholder="Task title"
          />
          <Input
            value={draft.jiraKey}
            onChange={event => setDraft(prev => ({ ...prev, jiraKey: event.target.value }))}
            placeholder="Jira key"
          />
          <Input
            value={draft.sprint}
            onChange={event => setDraft(prev => ({ ...prev, sprint: event.target.value }))}
            placeholder="Sprint"
          />
          <Button variant="primary" disabled={!draft.title.trim() || creating} onClick={createTask}>
            {creating ? <Spinner /> : null}
            Create
          </Button>
        </div>
        <textarea
          value={draft.description}
          onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))}
          placeholder="Description"
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-fg-4"><Spinner /> {t('sessions.loading')}</div>
      ) : (
        <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <div className="grid gap-3 lg:grid-cols-5">
            {STATUSES.map(status => (
              <section key={status} className="min-w-0 rounded-md border border-edge bg-panel-alt p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">{STATUS_LABEL[status]}</div>
                  <Badge variant="muted">{byStatus.get(status)?.length || 0}</Badge>
                </div>
                <div className="space-y-2">
                  {(byStatus.get(status) || []).map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      selected={selectedTask?.id === task.id}
                      busyStage={busy?.taskId === task.id ? busy.stage : null}
                      onSelect={(next) => setSelectedId(next.id)}
                      onStatus={updateStatus}
                      onStartStage={startStage}
                    />
                  ))}
                  {(byStatus.get(status) || []).length === 0 && (
                    <div className="rounded-md border border-dashed border-edge px-3 py-6 text-center text-[12px] text-fg-5">No tasks</div>
                  )}
                </div>
              </section>
            ))}
          </div>
          <TaskDetail task={selectedTask} />
        </div>
      )}
    </div>
  );
}

