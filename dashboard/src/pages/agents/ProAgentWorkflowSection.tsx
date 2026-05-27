import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, Input, Spinner } from '../../components/ui';
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

export function ProAgentWorkflowSection() {
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [assistantDraft, setAssistantDraft] = useState({ name: '', responsibility: '', preferredAgents: 'codex,claude' });
  const [automationDraft, setAutomationDraft] = useState({ name: '', schedule: 'manual', prompt: '', agent: '', assistantId: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [assistantRes, automationRes] = await Promise.all([
      api.getProAssistants(),
      api.getProAutomations(),
    ]);
    if (assistantRes.ok) setAssistants(assistantRes.assistants || []);
    if (automationRes.ok) setAutomations(automationRes.automations || []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createAssistant = useCallback(async () => {
    setBusy('assistant');
    try {
      const res = await api.createProAssistant({
        name: assistantDraft.name,
        responsibility: assistantDraft.responsibility,
        preferredAgents: assistantDraft.preferredAgents.split(',').map(item => item.trim()).filter(Boolean),
      });
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to create assistant');
      setAssistants(prev => [res.assistant!, ...prev]);
      setAssistantDraft({ name: '', responsibility: '', preferredAgents: 'codex,claude' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create assistant', false);
    } finally {
      setBusy(null);
    }
  }, [assistantDraft, toast]);

  const createAutomation = useCallback(async () => {
    setBusy('automation');
    try {
      const res = await api.createProAutomation({
        name: automationDraft.name,
        schedule: automationDraft.schedule,
        prompt: automationDraft.prompt,
        workdir: runtimeWorkdir,
        agent: automationDraft.agent || null,
        assistantId: automationDraft.assistantId || null,
      });
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to create automation');
      setAutomations(prev => [res.automation!, ...prev]);
      setAutomationDraft({ name: '', schedule: 'manual', prompt: '', agent: '', assistantId: '' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create automation', false);
    } finally {
      setBusy(null);
    }
  }, [automationDraft, runtimeWorkdir, toast]);

  const runAutomation = useCallback(async (item: AutomationRule) => {
    setBusy(item.id);
    try {
      const res = await api.runProAutomation(item.id);
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to run automation');
      setAutomations(prev => prev.map(candidate => candidate.id === item.id ? res.automation! : candidate));
      toast('Automation queued');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to run automation', false);
    } finally {
      setBusy(null);
    }
  }, [toast]);

  return (
    <section className="space-y-3 border-t border-edge pt-4">
      <div>
        <div className="text-base font-semibold tracking-tight text-fg">Agent Assistants & Automation</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">
          Assign reusable assistants to workflow stages. Defaults include refinement, coding, ticket sync, and knowledge extraction.
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-edge bg-panel p-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Assistants</div>
          <div className="grid gap-2 lg:grid-cols-[160px_1fr_150px_auto]">
            <Input value={assistantDraft.name} onChange={event => setAssistantDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Name" />
            <Input value={assistantDraft.responsibility} onChange={event => setAssistantDraft(prev => ({ ...prev, responsibility: event.target.value }))} placeholder="Responsibility" />
            <Input value={assistantDraft.preferredAgents} onChange={event => setAssistantDraft(prev => ({ ...prev, preferredAgents: event.target.value }))} placeholder="codex,claude" />
            <Button variant="primary" disabled={!assistantDraft.name || busy === 'assistant'} onClick={() => void createAssistant()}>
              {busy === 'assistant' ? <Spinner /> : null}
              Create
            </Button>
          </div>
          {!assistants.length ? <Empty label="No assistants yet." /> : (
            <div className="grid gap-2">
              {assistants.map(item => (
                <div key={item.id} className="rounded-md border border-edge/60 bg-panel-alt px-3 py-2.5">
                  <div className="font-semibold text-fg">{item.name}</div>
                  <div className="mt-1 text-sm text-fg-4">{item.responsibility}</div>
                  <div className="mt-2 text-xs text-fg-5">Agents: {item.preferredAgents.join(', ') || 'runtime default'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-edge bg-panel p-3">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Scheduled jobs</div>
            <div className="mt-1 text-[12px] text-fg-4">Jobs are assistant-owned automation: describe the work, pick schedule, agent or assistant, then review run history.</div>
          </div>
          <div className="grid gap-2 lg:grid-cols-[150px_120px_1fr]">
            <Input value={automationDraft.name} onChange={event => setAutomationDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Job name" />
            <Input value={automationDraft.schedule} onChange={event => setAutomationDraft(prev => ({ ...prev, schedule: event.target.value }))} placeholder="Schedule" />
            <Input value={automationDraft.prompt} onChange={event => setAutomationDraft(prev => ({ ...prev, prompt: event.target.value }))} placeholder="What should the agent do?" />
          </div>
          <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
            <select
              value={automationDraft.agent}
              onChange={event => setAutomationDraft(prev => ({ ...prev, agent: event.target.value }))}
              className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
            >
              <option value="">Runtime default agent</option>
              {['codex', 'claude', 'copilot', 'cursor', 'gemini', 'hermes'].map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
            <select
              value={automationDraft.assistantId}
              onChange={event => setAutomationDraft(prev => ({ ...prev, assistantId: event.target.value }))}
              className="h-9 rounded-md border border-edge bg-inset px-2.5 text-[12px] text-fg outline-none focus:border-primary/40"
            >
              <option value="">No assistant binding</option>
              {assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
            <Button variant="primary" disabled={!automationDraft.name || !automationDraft.prompt || busy === 'automation'} onClick={() => void createAutomation()}>
              {busy === 'automation' ? <Spinner /> : null}
              Create job
            </Button>
          </div>
          {!automations.length ? <Empty label="No automation rules yet." /> : (
            <div className="grid gap-2">
              {automations.map(item => (
                <div key={item.id} className="rounded-md border border-edge/60 bg-panel-alt px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-fg">{item.name}</div>
                      <div className="mt-1 text-xs text-fg-5">{item.schedule} · last run {fmt(item.lastRunAt)}</div>
                      <div className="mt-2 text-sm text-fg-4">{item.prompt}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-fg-5">
                        {item.agent && <span className="rounded border border-edge bg-panel px-1.5 py-0.5">agent: {item.agent}</span>}
                        {item.assistantId && <span className="rounded border border-edge bg-panel px-1.5 py-0.5">assistant: {assistants.find(a => a.id === item.assistantId)?.name || item.assistantId}</span>}
                      </div>
                      {!!item.runHistory?.length && (
                        <div className="mt-2 rounded-md border border-edge bg-inset px-2 py-1.5">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-5">Runs</div>
                          {item.runHistory.slice(0, 5).map(run => (
                            <div key={run.id} className="flex items-center justify-between gap-2 text-[11px] text-fg-4">
                              <span>{fmt(run.ranAt)}</span>
                              <span className="font-mono">{run.sessionKey || run.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void runAutomation(item)}>
                      {busy === item.id ? <Spinner /> : null}
                      Run
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
