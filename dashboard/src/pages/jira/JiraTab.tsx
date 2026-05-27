import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Input, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { ProTask, ProTaskStage, ProTaskStatus, StageRun, VerificationResult, VerificationRun } from '../../types';
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

const VERIFY_RESULTS: VerificationResult[] = ['passed', 'failed', 'blocked'];

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

function TaskDetail({
  task,
  verifyDraft,
  onVerifyDraft,
  onStartVerification,
  onFinishVerification,
  onCompleteStage,
  onExclusiveMode,
}: {
  task: ProTask | null;
  verifyDraft: { environment: string; url: string; notes: string };
  onVerifyDraft: (patch: Partial<{ environment: string; url: string; notes: string }>) => void;
  onStartVerification: (task: ProTask) => void;
  onFinishVerification: (task: ProTask, run: VerificationRun, result: VerificationResult) => void;
  onCompleteStage: (task: ProTask, run: StageRun) => void;
  onExclusiveMode: (task: ProTask, enabled: boolean) => void;
}) {
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
          {task.exclusiveMode && <Badge variant="warn">Exclusive</Badge>}
          <Badge variant={taskStatusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-[12px] text-fg-5">
          {task.jiraKey && <span className="font-mono">{task.jiraKey}</span>}
          {task.jiraUrl && <a className="text-primary hover:underline" href={task.jiraUrl} target="_blank" rel="noreferrer">Open Jira</a>}
          {task.workdir && <span className="truncate">{task.workdir}</span>}
        </div>
      </div>
      <div className="space-y-4 px-4 py-3">
        <section className="rounded-md border border-edge bg-panel-alt px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Execution Mode</div>
              <div className="mt-1 text-[12px] text-fg-4">
                Exclusive mode keeps this Jira task as the primary coding focus while other work remains queued.
              </div>
            </div>
            <Button variant={task.exclusiveMode ? 'secondary' : 'outline'} onClick={() => onExclusiveMode(task, !task.exclusiveMode)}>
              {task.exclusiveMode ? 'Disable Exclusive' : 'Enable Exclusive'}
            </Button>
          </div>
        </section>
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
                {estimateSummary(run) && (
                  <div className="mt-2 rounded-md border border-edge bg-inset px-2 py-1 text-[11px] text-fg-4">
                    Estimate: {estimateSummary(run)}
                  </div>
                )}
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
                {run.status !== 'completed' && (
                  <div className="mt-2">
                    <Button size="sm" variant="ghost" onClick={() => onCompleteStage(task, run)}>Mark stage complete</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Verification</div>
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
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draft, setDraft] = useState({ title: '', jiraKey: '', sprint: '', description: '' });
  const [syncDraft, setSyncDraft] = useState('');
  const [remoteSync, setRemoteSync] = useState({ baseUrl: '', email: '', token: '', jql: 'assignee = currentUser() ORDER BY updated DESC' });
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [verifyDraft, setVerifyDraft] = useState({ environment: 'cnlab03', url: '', notes: '' });
  const canSync = !!syncDraft.trim() || !!(remoteSync.baseUrl.trim() && remoteSync.token.trim());

  const sprintOptions = useMemo(() => {
    return Array.from(new Set(tasks.map(task => task.sprint).filter((sprint): sprint is string => !!sprint))).sort();
  }, [tasks]);
  const visibleTasks = useMemo(() => {
    return selectedSprint === 'all'
      ? tasks
      : tasks.filter(task => task.sprint === selectedSprint);
  }, [selectedSprint, tasks]);
  const selectedTask = visibleTasks.find(task => task.id === selectedId) || visibleTasks[0] || null;
  const byStatus = useMemo(() => {
    const grouped = new Map<ProTaskStatus, ProTask[]>();
    for (const status of STATUSES) grouped.set(status, []);
    for (const task of visibleTasks) grouped.get(task.status)?.push(task);
    return grouped;
  }, [visibleTasks]);

  useEffect(() => {
    if (selectedSprint !== 'all' && !sprintOptions.includes(selectedSprint)) setSelectedSprint('all');
  }, [selectedSprint, sprintOptions]);

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

  const syncTasks = useCallback(async () => {
    const raw = syncDraft.trim();
    const hasRemote = remoteSync.baseUrl.trim() && remoteSync.token.trim();
    if (!raw && !hasRemote) return;
    setSyncing(true);
    try {
      let result: { ok: boolean; tasks?: ProTask[]; error?: string };
      if (hasRemote) {
        result = await api.syncJiraFromRemote({
          ...remoteSync,
          sprint: draft.sprint,
          workdir: state?.runtimeWorkdir,
        });
      } else {
        let issues: Array<{ title: string; description?: string; jiraKey?: string; jiraUrl?: string; sprint?: string; issueType?: string; workdir?: string }>;
        if (raw.startsWith('[') || raw.startsWith('{')) {
          const parsed = JSON.parse(raw);
          issues = Array.isArray(parsed) ? parsed : [parsed];
        } else {
          issues = raw.split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
              const match = line.match(/^([A-Z][A-Z0-9]+-\d+)\s+(.+)$/);
              return match
                ? { jiraKey: match[1], title: match[2], sprint: draft.sprint, workdir: state?.runtimeWorkdir }
                : { title: line, sprint: draft.sprint, workdir: state?.runtimeWorkdir };
            });
        }
        result = await api.syncJiraTasks(issues);
      }
      if (!result.ok || !result.tasks) throw new Error(result.error || 'Failed to sync Jira tasks');
      setTasks(prev => {
        const byId = new Map(prev.map(task => [task.id, task] as const));
        for (const task of result.tasks || []) byId.set(task.id, task);
        return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      });
      setSelectedId(result.tasks[0]?.id || selectedId);
      toast(`Synced ${result.tasks.length} Jira task${result.tasks.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to sync Jira tasks', false);
    } finally {
      setSyncing(false);
    }
  }, [draft.sprint, remoteSync, selectedId, state?.runtimeWorkdir, syncDraft, toast]);

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

      <div className="rounded-md border border-edge bg-panel px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Jira Sync MVP</div>
            <div className="mt-1 text-[12px] text-fg-4">Paste JSON issues or one line per ticket, for example: IVAS-1234 Fix greeting timeout.</div>
          </div>
          <Button variant="secondary" disabled={!canSync || syncing} onClick={syncTasks}>
            {syncing ? <Spinner /> : null}
            Sync
          </Button>
        </div>
        <div className="mb-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_180px_minmax(0,1.2fr)]">
          <Input value={remoteSync.baseUrl} onChange={event => setRemoteSync(prev => ({ ...prev, baseUrl: event.target.value }))} placeholder="Jira base URL" />
          <Input value={remoteSync.email} onChange={event => setRemoteSync(prev => ({ ...prev, email: event.target.value }))} placeholder="Email (Cloud)" />
          <Input value={remoteSync.token} onChange={event => setRemoteSync(prev => ({ ...prev, token: event.target.value }))} placeholder="Token" type="password" />
          <Input value={remoteSync.jql} onChange={event => setRemoteSync(prev => ({ ...prev, jql: event.target.value }))} placeholder="JQL" />
        </div>
        <textarea
          value={syncDraft}
          onChange={event => setSyncDraft(event.target.value)}
          placeholder={'IVAS-1234 Fix greeting timeout\\nIVAS-1235 Analyze timeout boundary'}
          className="min-h-20 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[12px] text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
        />
      </div>

      <div className="rounded-md border border-edge bg-panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Sprint View</div>
          <Button
            size="sm"
            variant={selectedSprint === 'all' ? 'secondary' : 'ghost'}
            onClick={() => setSelectedSprint('all')}
          >
            All
          </Button>
          {sprintOptions.map(sprint => (
            <Button
              key={sprint}
              size="sm"
              variant={selectedSprint === sprint ? 'secondary' : 'ghost'}
              onClick={() => setSelectedSprint(sprint)}
            >
              {sprint}
            </Button>
          ))}
          {sprintOptions.length === 0 && <span className="text-[12px] text-fg-5">No sprint labels yet.</span>}
        </div>
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
          <TaskDetail
            task={selectedTask}
            verifyDraft={verifyDraft}
            onVerifyDraft={(patch) => setVerifyDraft(prev => ({ ...prev, ...patch }))}
            onStartVerification={startVerification}
            onFinishVerification={finishVerification}
            onCompleteStage={completeStage}
            onExclusiveMode={toggleExclusiveMode}
          />
        </div>
      )}
    </div>
  );
}
