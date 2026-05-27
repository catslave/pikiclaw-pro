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

function splitAgents(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

const defaultAssistantDraft = { name: '', responsibility: '', preferredAgents: 'codex,claude' };

export function ProAssistantsSection() {
  const toast = useStore(s => s.toast);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [editing, setEditing] = useState<AgentAssistant | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(defaultAssistantDraft);
  const [busy, setBusy] = useState(false);

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
      preferredAgents: assistant.preferredAgents.join(','),
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
        preferredAgents: splitAgents(draft.preferredAgents),
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
            <button
              key={item.id}
              type="button"
              onClick={() => openEdit(item)}
              className="rounded-lg border border-edge bg-panel p-3 text-left shadow-sm transition hover:border-edge-h hover:bg-panel-h"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-fg">{item.name}</div>
                  <div className="mt-1 line-clamp-3 text-sm leading-relaxed text-fg-4">{item.responsibility}</div>
                </div>
                <span className="rounded border border-edge bg-control px-2 py-1 text-[11px] text-fg-5">Edit</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(item.preferredAgents.length ? item.preferredAgents : ['runtime default']).map(agent => (
                  <span key={agent} className="rounded border border-edge bg-panel-alt px-1.5 py-0.5 text-[11px] text-fg-5">{agent}</span>
                ))}
              </div>
            </button>
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
            className="min-h-28 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <Input value={draft.preferredAgents} onChange={event => setDraft(prev => ({ ...prev, preferredAgents: event.target.value }))} placeholder="codex,claude" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
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
  const [draft, setDraft] = useState({ name: '', schedule: 'manual', prompt: '', agent: '', assistantId: '' });
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
    if (!draft.name.trim() || !draft.prompt.trim() || busy) return;
    setBusy('create');
    try {
      const res = await api.createProAutomation({
        name: draft.name,
        schedule: draft.schedule,
        prompt: draft.prompt,
        workdir: runtimeWorkdir,
        agent: draft.agent || null,
        assistantId: draft.assistantId || null,
      });
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to create job');
      setJobs(prev => [res.automation!, ...prev]);
      setDraft({ name: '', schedule: 'manual', prompt: '', agent: '', assistantId: '' });
      setCreateOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create job', false);
    } finally {
      setBusy(null);
    }
  }, [busy, draft, runtimeWorkdir, toast]);

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
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create job</Button>
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
          <div className="grid gap-2 md:grid-cols-[1fr_150px]">
            <Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Job name" />
            <Input value={draft.schedule} onChange={event => setDraft(prev => ({ ...prev, schedule: event.target.value }))} placeholder="manual / daily 9am" />
          </div>
          <textarea
            value={draft.prompt}
            onChange={event => setDraft(prev => ({ ...prev, prompt: event.target.value }))}
            placeholder="What should the assistant do when this job runs?"
            className="min-h-28 w-full resize-y rounded-md border border-control-border bg-control px-3 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <select value={draft.agent} onChange={event => setDraft(prev => ({ ...prev, agent: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">Runtime default agent</option>
              {['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes'].map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
            <select value={draft.assistantId} onChange={event => setDraft(prev => ({ ...prev, assistantId: event.target.value }))} className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40">
              <option value="">No assistant binding</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy === 'create'}>Cancel</Button>
          <Button variant="primary" disabled={!draft.name.trim() || !draft.prompt.trim() || busy === 'create'} onClick={() => void createJob()}>
            {busy === 'create' ? <Spinner /> : null}
            Create
          </Button>
        </div>
      </Modal>
    </section>
  );
}
