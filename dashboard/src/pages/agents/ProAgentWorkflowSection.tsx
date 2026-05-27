import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button, Input, Modal, ModalHeader, Spinner } from '../../components/ui';
import { useStore } from '../../store';
import type { AgentAssistant, AutomationRule } from '../../types';

function fmt(value: string | undefined) {
  if (!value) return '--';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-md border border-edge bg-panel-alt px-3 py-6 text-center text-sm text-fg-5">{label}</div>;
}

const FALLBACK_AGENTS = ['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes'];
const SCHEDULE_PRESETS = [
  { value: 'one-time', label: 'One time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];
const defaultAssistantDraft = { name: '', responsibility: '', preferredAgents: [] as string[] };
const defaultJobDraft = { prompt: '', scheduleType: 'one-time', customSchedule: '', assistantId: '' };

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

export function ProAssistantsSection() {
  const toast = useStore(s => s.toast);
  const agentStatus = useStore(s => s.agentStatus);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [editing, setEditing] = useState<AgentAssistant | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(defaultAssistantDraft);
  const [busy, setBusy] = useState(false);

  const agentOptions = useMemo(() => {
    const agents = agentStatus?.agents?.length ? agentStatus.agents : [];
    const source = agents.length ? agents : FALLBACK_AGENTS.map(agent => ({ agent, label: agent, installed: true }));
    return source
      .filter(agent => agent.installed !== false)
      .map(agent => ({ value: agent.agent, label: agent.label || agent.agent }));
  }, [agentStatus]);

  const refresh = useCallback(async () => {
    const res = await api.getProAssistants();
    if (res.ok) setAssistants(res.assistants || []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setDraft(defaultAssistantDraft);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((assistant: AgentAssistant) => {
    setEditing(assistant);
    setDraft({
      name: assistant.name,
      responsibility: assistant.responsibility,
      preferredAgents: assistant.preferredAgents,
    });
    setModalOpen(true);
  }, []);

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
        preferredAgents: draft.preferredAgents,
      };
      const res = editing
        ? await api.updateProAssistant(editing.id, payload)
        : await api.createProAssistant(payload);
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to save assistant');
      setAssistants(prev => {
        const next = prev.filter(item => item.id !== res.assistant!.id);
        return [res.assistant!, ...next];
      });
      setModalOpen(false);
      setEditing(null);
      setDraft(defaultAssistantDraft);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save assistant', false);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, editing, toast]);

  const deleteAssistant = useCallback(async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const res = await api.deleteProAssistant(editing.id);
      if (!res.ok) throw new Error(res.error || 'Failed to delete assistant');
      setAssistants(prev => prev.filter(item => item.id !== editing.id));
      setModalOpen(false);
      setEditing(null);
      setDraft(defaultAssistantDraft);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete assistant', false);
    } finally {
      setBusy(false);
    }
  }, [busy, editing, toast]);

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

  return (
    <section className="space-y-3 border-t border-edge pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-tight text-fg">Assistants</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">
            Define role-specific assistants for refinement, coding, ticket sync, knowledge extraction, and future workflow stages.
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={openCreate}>Create assistant</Button>
      </div>

      {!assistants.length ? <Empty label="No assistants yet." /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {assistants.map(item => (
            <div
              key={item.id}
              className="rounded-lg border border-edge bg-panel p-3 text-left shadow-sm transition hover:border-edge-h hover:bg-panel-h"
            >
              <button type="button" onClick={() => openEdit(item)} className="flex w-full items-start gap-3 text-left">
                <PixelAvatar seed={item.avatarSeed || item.id} label={item.name} />
                <div className="min-w-0">
                  <div className="font-semibold text-fg">{item.name}</div>
                  <div className="mt-1 line-clamp-3 text-sm leading-relaxed text-fg-4">{item.responsibility}</div>
                </div>
              </button>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(item.preferredAgents.length ? item.preferredAgents : ['runtime default']).map(agent => (
                  <span key={agent} className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">{agent}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal}>
        <ModalHeader title={editing ? 'Edit assistant' : 'Create assistant'} onClose={closeModal} />
        <div className="space-y-3">
          <Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Assistant name" />
          <textarea
            value={draft.responsibility}
            onChange={event => setDraft(prev => ({ ...prev, responsibility: event.target.value }))}
            placeholder="Responsibility, boundaries, expected output, and when it should be used"
            className="min-h-40 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="rounded-md border border-edge bg-panel-alt p-2">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-5">Agents</div>
            <div className="flex flex-wrap gap-2">
              {agentOptions.map(agent => (
                <label key={agent.value} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-edge bg-control px-2 py-1 text-[12px] text-fg-3 transition hover:bg-control-h">
                  <input
                    type="checkbox"
                    checked={draft.preferredAgents.includes(agent.value)}
                    onChange={() => toggleDraftAgent(agent.value)}
                    className="h-3.5 w-3.5"
                  />
                  {agent.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing && (
            <Button variant="secondary" onClick={() => void deleteAssistant()} disabled={busy} className="text-red-500 hover:border-red-500/40 hover:bg-red-500/10">
              Delete
            </Button>
          )}
          <div className="min-w-0 flex-1" />
          <Button variant="ghost" onClick={closeModal} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!draft.name.trim() || busy} onClick={() => void saveAssistant()}>
            {busy ? <Spinner /> : null}
            Save
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function ProAutomationSection() {
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
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
      toast('Automation queued');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to run job', false);
    } finally {
      setBusy(null);
    }
  }, [toast]);

  return (
    <section className="space-y-3 border-t border-edge pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-tight text-fg">Automation</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">
            Assistant-owned scheduled jobs. Configure what should run, then review execution history separately.
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setDraft({ ...defaultJobDraft, assistantId: assistants[0]?.id || '' });
            setCreateOpen(true);
          }}
        >
          Create job
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Jobs</div>
          {!jobs.length ? <Empty label="No automation jobs yet." /> : jobs.map(job => (
            <div key={job.id} className="rounded-lg border border-edge bg-panel p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-fg">{job.name}</div>
                  <div className="mt-1 text-xs text-fg-5">{job.schedule} · last run {fmt(job.lastRunAt)}</div>
                  <div className="mt-2 text-sm text-fg-4">{job.prompt}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-fg-5">
                    {job.agent && <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">agent: {job.agent}</span>}
                    {job.assistantId && <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5">assistant: {assistants.find(a => a.id === job.assistantId)?.name || job.assistantId}</span>}
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void runJob(job)}>
                  {busy === job.id ? <Spinner /> : null}
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Execution history</div>
          {!history.length ? <Empty label="No execution history yet." /> : (
            <div className="space-y-2">
              {history.map(run => (
                <div key={`${run.job.id}:${run.id}`} className="rounded-md border border-edge bg-panel px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-[13px] font-medium text-fg">{run.job.name}</div>
                    <span className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">{run.status}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-fg-5">{fmt(run.ranAt)}</div>
                  {run.sessionKey && <div className="mt-1 truncate font-mono text-[11px] text-fg-4">{run.sessionKey}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader title="Create automation job" onClose={() => setCreateOpen(false)} />
        <div className="space-y-3">
          <textarea
            value={draft.prompt}
            onChange={event => setDraft(prev => ({ ...prev, prompt: event.target.value }))}
            placeholder="What should the assistant do?"
            className="min-h-32 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <select value={draft.assistantId} onChange={event => setDraft(prev => ({ ...prev, assistantId: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">Select assistant</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
            <select value={draft.scheduleType} onChange={event => setDraft(prev => ({ ...prev, scheduleType: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              {SCHEDULE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            </select>
          </div>
          {draft.scheduleType === 'custom' && (
            <Input value={draft.customSchedule} onChange={event => setDraft(prev => ({ ...prev, customSchedule: event.target.value }))} placeholder="Custom schedule, e.g. every weekday at 9am" />
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy === 'create'}>Cancel</Button>
          <Button variant="primary" disabled={!draft.prompt.trim() || !draft.assistantId || !scheduleLabel(draft) || busy === 'create'} onClick={() => void createJob()}>
            {busy === 'create' ? <Spinner /> : null}
            Create
          </Button>
        </div>
      </Modal>
    </section>
  );
}
