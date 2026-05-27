import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type { AgentAssistant, ProSubtaskStatus, ProTask, ProTaskStage, ProTaskStatus, StageRun, VerificationResult, VerificationRun, WorkspaceEntry } from '../../types';
import { cn } from '../../utils';

const STATUSES: ProTaskStatus[] = ['backlog', 'refinement', 'coding', 'resolved', 'done'];
const STAGES: ProTaskStage[] = ['focus', 'refinement', 'coding', 'verification', 'demo', 'bugfix'];
type JiraColumnKey = 'backlog' | 'running' | 'incomplete' | 'review' | 'done';

const JIRA_COLUMNS: Array<{ key: JiraColumnKey; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'Synced or planned' },
  { key: 'running', label: 'Running', hint: 'Refinement or coding' },
  { key: 'incomplete', label: 'Incomplete', hint: 'Failed or blocked' },
  { key: 'review', label: 'To review', hint: 'Resolved, needs validation' },
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
  const progress = subtaskProgress(task);
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

function jiraColumnForTask(task: ProTask): JiraColumnKey {
  if (task.status === 'done') return 'done';
  const latest = task.stageRuns[0];
  if (latest?.status === 'failed' || latest?.status === 'cancelled') return 'incomplete';
  if (task.status === 'resolved') return 'review';
  if (task.status === 'refinement' || task.status === 'coding') return 'running';
  return 'backlog';
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
  subtaskDraft,
  onSubtaskDraft,
  onCreateSubtask,
  onUpdateSubtaskStatus,
  onStartVerification,
  onFinishVerification,
  onCompleteStage,
  onExclusiveMode,
}: {
  task: ProTask | null;
  verifyDraft: { environment: string; url: string; notes: string };
  onVerifyDraft: (patch: Partial<{ environment: string; url: string; notes: string }>) => void;
  subtaskDraft: { title: string; description: string; assignedAgent: string; assistantId: string };
  onSubtaskDraft: (patch: Partial<{ title: string; description: string; assignedAgent: string; assistantId: string }>) => void;
  onCreateSubtask: (task: ProTask) => void;
  onUpdateSubtaskStatus: (task: ProTask, subtaskId: string, status: ProSubtaskStatus) => void;
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
  const progress = subtaskProgress(task);
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
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Subtasks</div>
            <div className="text-[12px] text-fg-5">{progress.total ? `${progress.done}/${progress.total} done` : 'No subtasks'}</div>
          </div>
          <div className="rounded-md border border-edge bg-panel-alt px-3 py-3">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_120px_auto]">
              <Input value={subtaskDraft.title} onChange={event => onSubtaskDraft({ title: event.target.value })} placeholder="Subtask title" />
              <Input value={subtaskDraft.assignedAgent} onChange={event => onSubtaskDraft({ assignedAgent: event.target.value })} placeholder="agent" />
              <Input value={subtaskDraft.assistantId} onChange={event => onSubtaskDraft({ assistantId: event.target.value })} placeholder="assistant" />
              <Button variant="secondary" disabled={!subtaskDraft.title.trim()} onClick={() => onCreateSubtask(task)}>Add</Button>
            </div>
            <textarea
              value={subtaskDraft.description}
              onChange={event => onSubtaskDraft({ description: event.target.value })}
              placeholder="Optional scope / repo / dependency"
              className="mt-2 min-h-14 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[12px] text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
            />
            <div className="mt-3 space-y-2">
              {(task.subTasks || []).length === 0 ? (
                <div className="rounded-md border border-dashed border-edge px-3 py-5 text-center text-[12px] text-fg-5">
                  Use subtasks only when this task splits across projects, repos, or independent work streams.
                </div>
              ) : task.subTasks.map(subtask => (
                <div key={subtask.id} className="rounded-md border border-edge bg-inset px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[13px] text-fg">{subtask.title}</div>
                      {subtask.description && <div className="mt-1 text-[12px] text-fg-4">{subtask.description}</div>}
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-fg-5">
                        {subtask.assignedAgent && <span className="rounded border border-edge bg-panel px-1.5 py-0.5">agent: {subtask.assignedAgent}</span>}
                        {subtask.assistantId && <span className="rounded border border-edge bg-panel px-1.5 py-0.5">assistant: {subtask.assistantId}</span>}
                        {!!subtask.stageRunIds.length && <span className="rounded border border-edge bg-panel px-1.5 py-0.5">{subtask.stageRunIds.length} run link{subtask.stageRunIds.length === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                    <select
                      value={subtask.status}
                      onChange={event => onUpdateSubtaskStatus(task, subtask.id, event.target.value as ProSubtaskStatus)}
                      className="h-8 rounded-md border border-edge bg-panel px-2 text-[12px] text-fg outline-none focus:border-primary/40"
                    >
                      {SUBTASK_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
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
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<{ taskId: string; stage: ProTaskStage } | null>(null);
  const [draft, setDraft] = useState({ sprint: '' });
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [verifyDraft, setVerifyDraft] = useState({ environment: 'cnlab03', url: '', notes: '' });
  const [subtaskDraft, setSubtaskDraft] = useState({ title: '', description: '', assignedAgent: '', assistantId: '' });

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

  useEffect(() => {
    if (selectedSprint !== 'all' && !sprintOptions.includes(selectedSprint)) setSelectedSprint('all');
  }, [selectedSprint, sprintOptions]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [result, assistantsResult, workspacesResult] = await Promise.all([
        api.getProTasks(),
        api.getProAssistants(),
        api.getWorkspaces(),
      ]);
      if (!result.ok) throw new Error(result.error || 'Failed to load Jira tasks');
      setTasks(result.tasks);
      if (assistantsResult.ok) setAssistants(assistantsResult.assistants || []);
      if (workspacesResult.ok) setWorkspaces(workspacesResult.workspaces || []);
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

  const createTask = useCallback(async (taskDraft: { title: string; description: string; workdir: string; defaultAgent: string; defaultAssistantId: string }) => {
    const title = taskDraft.title.trim();
    if (!title) return;
    setCreating(true);
    try {
      const result = await api.createProTask({
        title,
        description: taskDraft.description,
        sprint: draft.sprint,
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
          <Input value={draft.sprint} onChange={event => setDraft({ sprint: event.target.value })} placeholder="Default sprint" className="max-w-[140px]" />
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
              <section key={column.key} className="min-h-0 rounded-lg border border-edge/50 bg-panel-alt/35 flex flex-col overflow-hidden">
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
                  {(byStatus.get(column.key) || []).length === 0 ? (
                    <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-edge/40 text-[11px] text-fg-5/60">No tasks</div>
                  ) : (
                    <div className="space-y-2">
                      {(byStatus.get(column.key) || []).map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          selected={false}
                          busyStage={busy?.taskId === task.id ? busy.stage : null}
                          onSelect={(next) => setSelectedId(next.id)}
                          onStatus={updateStatus}
                          onStartStage={startStage}
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
    </div>
  );
}
