import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button, Input, Spinner } from '../../components/ui';
import { useStore } from '../../store';
import type { TodoItem } from '../../types';

function fmt(value: string | undefined) {
  if (!value) return '--';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-md border border-edge bg-panel-alt px-3 py-8 text-center text-sm text-fg-5">{label}</div>;
}

export function InboxTab() {
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
      if (!res.ok) throw new Error(res.error || 'Failed to load inbox');
      setItems(res.items || []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load inbox', false);
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
      toast('Inbox chat created');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create chat', false);
    } finally {
      setCreating(false);
    }
  }, [creating, items, prompt, runtimeWorkdir, selectedItems, toast]);

  if (loading) {
    return <div className="flex min-h-40 items-center justify-center text-sm text-fg-4"><Spinner /> Loading inbox...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-edge bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-fg">Todo Inbox</h3>
            <p className="mt-1 text-sm text-fg-4">Capture ideas from chat or the quick button, then turn one or many items into a focused chat when you are ready.</p>
          </div>
          <span className="rounded border border-edge bg-control px-2 py-1 text-[11px] text-fg-5">Cross-chat capture</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row">
          <Input value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Optional instruction for the new chat" />
          <Button variant="primary" disabled={!selectedItems.length || creating} onClick={() => void createChat()}>
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
