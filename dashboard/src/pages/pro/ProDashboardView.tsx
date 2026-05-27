import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button, Input, Spinner } from '../../components/ui';
import { useStore } from '../../store';
import type { AgentAssistant, AutomationRule, KnowledgeEntry, TodoItem } from '../../types';

export type ProDashboardViewKey = 'todos' | 'automation' | 'assistants' | 'knowledge';

function fmt(value: string | undefined) {
  if (!value) return '--';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-md border border-edge bg-panel-alt px-3 py-8 text-center text-sm text-fg-5">{label}</div>;
}

export function ProDashboardView({ view }: { view: ProDashboardViewKey }) {
  if (view === 'todos') return <TodoListView />;
  if (view === 'automation') return <AutomationView />;
  if (view === 'assistants') return <AssistantsView />;
  return <KnowledgeView />;
}

function TodoListView() {
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const [items, setItems] = useState<TodoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getProTodos();
      if (!res.ok) throw new Error(res.error || 'Failed to load todos');
      setItems(res.items || []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load todos', false);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedItems = useMemo(() => items.filter(item => selected.has(item.id)), [items, selected]);
  const createChat = useCallback(async () => {
    if (!selectedItems.length || creating) return;
    setCreating(true);
    try {
      const res = await api.createProTodoChat({
        todoIds: selectedItems.map(item => item.id),
        prompt,
        workdir: runtimeWorkdir,
      });
      if (!res.ok) throw new Error(res.error || 'Failed to create chat');
      if (res.items) setItems(res.items.concat(items.filter(item => !res.items?.some(updated => updated.id === item.id))));
      setSelected(new Set());
      setPrompt('');
      toast('Todo chat created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create chat', false);
    } finally {
      setCreating(false);
    }
  }, [creating, items, prompt, runtimeWorkdir, selectedItems, toast]);

  if (loading) return <div className="flex min-h-32 items-center justify-center text-sm text-fg-4"><Spinner /> Loading todos...</div>;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge bg-panel px-3 py-3">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">Create chat from selected todos</div>
        <div className="flex flex-col gap-2 lg:flex-row">
          <Input value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Optional instruction for the new chat" />
          <Button variant="primary" disabled={!selectedItems.length || creating} onClick={createChat}>
            {creating ? <Spinner /> : null}
            Create chat ({selectedItems.length})
          </Button>
        </div>
      </div>
      {!items.length ? <Empty label="No todos yet." /> : (
        <div className="grid gap-2">
          {items.map(item => (
            <label key={item.id} className="flex gap-3 rounded-md border border-edge bg-panel px-3 py-2.5">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={event => setSelected(prev => {
                  const next = new Set(prev);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold text-fg">{item.title}</div>
                  <span className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-fg-5">{item.kind}</span>
                  <span className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-fg-5">{item.status}</span>
                </div>
                {item.body && <div className="mt-1 text-sm text-fg-4">{item.body}</div>}
                {item.source?.quote && <div className="mt-2 line-clamp-2 rounded bg-panel-alt px-2 py-1 text-xs text-fg-5">{item.source.quote}</div>}
                <div className="mt-1 text-[11px] text-fg-5">{fmt(item.updatedAt)}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationView() {
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const [items, setItems] = useState<AutomationRule[]>([]);
  const [draft, setDraft] = useState({ name: '', schedule: 'manual', prompt: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.getProAutomations();
    if (res.ok) setItems(res.automations || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async () => {
    setBusy('create');
    try {
      const res = await api.createProAutomation({ ...draft, workdir: runtimeWorkdir });
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to create automation');
      setItems(prev => [res.automation!, ...prev]);
      setDraft({ name: '', schedule: 'manual', prompt: '' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create automation', false);
    } finally { setBusy(null); }
  }, [draft, runtimeWorkdir, toast]);

  const run = useCallback(async (item: AutomationRule) => {
    setBusy(item.id);
    try {
      const res = await api.runProAutomation(item.id);
      if (!res.ok || !res.automation) throw new Error(res.error || 'Failed to run automation');
      setItems(prev => prev.map(candidate => candidate.id === item.id ? res.automation! : candidate));
      toast('Automation queued');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to run automation', false);
    } finally { setBusy(null); }
  }, [toast]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge bg-panel px-3 py-3">
        <div className="grid gap-2 lg:grid-cols-[180px_140px_1fr_auto]">
          <Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Name" />
          <Input value={draft.schedule} onChange={event => setDraft(prev => ({ ...prev, schedule: event.target.value }))} placeholder="Schedule" />
          <Input value={draft.prompt} onChange={event => setDraft(prev => ({ ...prev, prompt: event.target.value }))} placeholder="Agent action prompt" />
          <Button variant="primary" disabled={!draft.name || !draft.prompt || busy === 'create'} onClick={create}>{busy === 'create' ? <Spinner /> : null}Create</Button>
        </div>
      </div>
      {!items.length ? <Empty label="No automation rules yet." /> : items.map(item => (
        <div key={item.id} className="rounded-md border border-edge bg-panel px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-fg">{item.name}</div>
              <div className="mt-1 text-xs text-fg-5">{item.schedule} · last run {fmt(item.lastRunAt)}</div>
              <div className="mt-2 text-sm text-fg-4">{item.prompt}</div>
            </div>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run(item)}>{busy === item.id ? <Spinner /> : null}Run now</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssistantsView() {
  const toast = useStore(s => s.toast);
  const [items, setItems] = useState<AgentAssistant[]>([]);
  const [draft, setDraft] = useState({ name: '', responsibility: '', preferredAgents: 'codex,claude' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { void api.getProAssistants().then(res => { if (res.ok) setItems(res.assistants || []); }); }, []);
  const create = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.createProAssistant({
        name: draft.name,
        responsibility: draft.responsibility,
        preferredAgents: draft.preferredAgents.split(',').map(item => item.trim()).filter(Boolean),
      });
      if (!res.ok || !res.assistant) throw new Error(res.error || 'Failed to create assistant');
      setItems(prev => [res.assistant!, ...prev]);
      setDraft({ name: '', responsibility: '', preferredAgents: 'codex,claude' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create assistant', false);
    } finally { setBusy(false); }
  }, [draft, toast]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge bg-panel px-3 py-3">
        <div className="grid gap-2 lg:grid-cols-[180px_1fr_180px_auto]">
          <Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Assistant name" />
          <Input value={draft.responsibility} onChange={event => setDraft(prev => ({ ...prev, responsibility: event.target.value }))} placeholder="Responsibility" />
          <Input value={draft.preferredAgents} onChange={event => setDraft(prev => ({ ...prev, preferredAgents: event.target.value }))} placeholder="codex,claude" />
          <Button variant="primary" disabled={!draft.name || busy} onClick={create}>{busy ? <Spinner /> : null}Create</Button>
        </div>
      </div>
      {!items.length ? <Empty label="No assistants yet." /> : items.map(item => (
        <div key={item.id} className="rounded-md border border-edge bg-panel px-3 py-2.5">
          <div className="font-semibold text-fg">{item.name}</div>
          <div className="mt-1 text-sm text-fg-4">{item.responsibility}</div>
          <div className="mt-2 text-xs text-fg-5">Agents: {item.preferredAgents.join(', ') || 'runtime default'}</div>
        </div>
      ))}
    </div>
  );
}

function KnowledgeView() {
  const toast = useStore(s => s.toast);
  const [items, setItems] = useState<KnowledgeEntry[]>([]);
  const [draft, setDraft] = useState({ title: '', body: '', tags: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { void api.getProKnowledge().then(res => { if (res.ok) setItems(res.knowledge || []); }); }, []);
  const create = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.createProKnowledge({
        title: draft.title,
        body: draft.body,
        tags: draft.tags.split(',').map(item => item.trim()).filter(Boolean),
      });
      if (!res.ok || !res.entry) throw new Error(res.error || 'Failed to create knowledge');
      setItems(prev => [res.entry!, ...prev]);
      setDraft({ title: '', body: '', tags: '' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create knowledge', false);
    } finally { setBusy(false); }
  }, [draft, toast]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge bg-panel px-3 py-3">
        <div className="grid gap-2 lg:grid-cols-[220px_1fr_180px_auto]">
          <Input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} placeholder="Concept title" />
          <Input value={draft.body} onChange={event => setDraft(prev => ({ ...prev, body: event.target.value }))} placeholder="Reusable explanation / note" />
          <Input value={draft.tags} onChange={event => setDraft(prev => ({ ...prev, tags: event.target.value }))} placeholder="tags" />
          <Button variant="primary" disabled={!draft.title || !draft.body || busy} onClick={create}>{busy ? <Spinner /> : null}Save</Button>
        </div>
      </div>
      {!items.length ? <Empty label="No knowledge entries yet." /> : items.map(item => (
        <div key={item.id} className="rounded-md border border-edge bg-panel px-3 py-2.5">
          <div className="font-semibold text-fg">{item.title}</div>
          <div className="mt-1 text-sm leading-relaxed text-fg-4">{item.body}</div>
          {!!item.tags.length && <div className="mt-2 flex flex-wrap gap-1">{item.tags.map(tag => <span key={tag} className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-fg-5">{tag}</span>)}</div>}
        </div>
      ))}
    </div>
  );
}
