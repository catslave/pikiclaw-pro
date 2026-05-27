import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import type { PlatformSkillInfo } from '../../types';
import { Button, Spinner } from '../../components/ui';
import { cn } from '../../utils';

function statusLabel(status: PlatformSkillInfo['status']) {
  return status === 'ready' ? 'Ready' : 'Experimental';
}

function categoryLabel(category: PlatformSkillInfo['category']) {
  if (category === 'observability') return 'Observability';
  if (category === 'dev') return 'Dev';
  return 'Productivity';
}

export function SkillsTab() {
  const toast = useStore(s => s.toast);
  const runtimeWorkdir = useStore(s => s.state?.runtimeWorkdir ?? '');
  const [skills, setSkills] = useState<PlatformSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickRepo, setQuickRepo] = useState('');
  const [quickRunning, setQuickRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getPlatformSkills()
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setSkills(res.skills || []);
          setError(null);
        } else {
          setError(res.error || 'Failed to load skills');
        }
      })
      .catch(err => {
        if (!cancelled) setError(err?.message || 'Failed to load skills');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const copyExample = async (example: string) => {
    try {
      await navigator.clipboard?.writeText(example);
      toast('Copied command');
    } catch {
      toast('Copy failed', false);
    }
  };

  const runQuickSetup = async () => {
    const repo = quickRepo.trim();
    if (!repo || quickRunning) return;
    setQuickRunning(true);
    try {
      const res = await api.runSkillQuickSetup({ repo, workdir: runtimeWorkdir });
      if (!res.ok) throw new Error(res.error || 'Quick setup failed');
      toast('Quick setup queued');
      setQuickRepo('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Quick setup failed', false);
    } finally {
      setQuickRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-fg-4">
        <Spinner />
        <span className="ml-2">Loading skills...</span>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-md border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-300">{error}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-edge bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-fg">Quick setup</h3>
            <p className="mt-1 text-sm text-fg-4">Paste a GitHub repo and Pikiclaw will start an agent session to inspect, install dependencies, and validate it.</p>
          </div>
          <span className="rounded border border-edge bg-control px-2 py-1 text-[11px] text-fg-5">Agent workflow</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row">
          <input
            value={quickRepo}
            onChange={event => setQuickRepo(event.target.value)}
            placeholder="https://github.com/org/repo or org/repo"
            className="h-9 min-w-0 flex-1 rounded-md border border-control-border bg-control px-3 text-[13px] text-fg outline-none transition focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]"
          />
          <Button variant="primary" disabled={!quickRepo.trim() || quickRunning} onClick={() => void runQuickSetup()}>
            {quickRunning ? <Spinner /> : null}
            Start setup
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-edge bg-panel-alt px-3 py-2 text-sm text-fg-3">
        Platform skills are Pikiclaw-owned workflows. They can use controlled backend tools before handing evidence to the selected agent for analysis.
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {skills.map(skill => (
          <section
            key={skill.id}
            className="rounded-lg border border-edge bg-panel p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-fg">{skill.name}</h3>
                  <span className="rounded border border-edge bg-control px-1.5 py-0.5 font-mono text-[11px] text-fg-3">
                    {skill.trigger}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-fg-4">{skill.description}</p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded border px-2 py-1 text-[11px] font-medium',
                  skill.status === 'ready'
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                    : 'border-amber-400/25 bg-amber-400/10 text-amber-300',
                )}
              >
                {statusLabel(skill.status)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-fg-5">
              <span className="rounded border border-edge/45 px-2 py-1">{categoryLabel(skill.category)}</span>
              <span className="rounded border border-edge/45 px-2 py-1">Controlled workflow</span>
              <span className="rounded border border-edge/45 px-2 py-1">Agent analysis</span>
            </div>

            <div className="mt-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-5">Examples</div>
              {skill.examples.map(example => (
                <div key={example} className="flex items-center gap-2 rounded-md border border-edge/35 bg-control px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate text-[12px] text-fg-3">{example}</code>
                  <Button size="sm" variant="ghost" onClick={() => void copyExample(example)}>Copy</Button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
