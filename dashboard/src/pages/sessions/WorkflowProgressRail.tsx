import { cn } from '../../utils';
import type { WorkflowProgressSnapshot, WorkflowProgressStatus } from './workflowProgress';

function statusLabel(status: WorkflowProgressStatus): string {
  if (status === 'blocked') return 'Blocked';
  if (status === 'done') return 'Done';
  return 'Running';
}

function statusTone(status: WorkflowProgressStatus): string {
  if (status === 'blocked') return 'border-warn/30 bg-warn/[0.10] text-warn';
  if (status === 'done') return 'border-ok/30 bg-ok/[0.10] text-ok';
  return 'border-primary/30 bg-primary/[0.10] text-primary';
}

export function WorkflowProgressRail({ progress, compact = false }: { progress: WorkflowProgressSnapshot; compact?: boolean }) {
  const completedSteps = progress.status === 'done'
    ? progress.currentStep
    : Math.max(0, progress.currentStep - 1);
  const percent = Math.max(0, Math.min(100, (completedSteps / Math.max(1, progress.totalSteps)) * 100));
  const dots = Array.from({ length: Math.min(progress.totalSteps, 12) });

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.045] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]',
      compact ? 'px-3 py-2' : 'px-3.5 py-3',
    )}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_14px_var(--th-primary)]" />
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-4">Workflow run</span>
          </div>
          <div className="mt-1 min-w-0 break-words text-[13px] font-semibold leading-snug text-fg">
            Step {progress.currentStep}/{progress.totalSteps}
            <span className="text-fg-5"> · </span>
            {progress.title}
          </div>
        </div>
        <span className={cn('shrink-0 rounded-md border px-2 py-1 text-[10.5px] font-semibold leading-none', statusTone(progress.status))}>
          {statusLabel(progress.status)}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-inset">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            progress.status === 'blocked' ? 'bg-warn' : progress.status === 'done' ? 'bg-ok' : 'bg-primary',
          )}
          style={{ width: `${progress.status === 'running' ? Math.max(percent, 8) : percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {dots.map((_, index) => {
          const step = index + 1;
          const active = step === progress.currentStep;
          const done = step <= completedSteps;
          return (
            <span
              key={step}
              className={cn(
                'h-1.5 min-w-0 flex-1 rounded-full transition-colors',
                done ? 'bg-primary/70' : active ? 'bg-primary/35' : 'bg-fg-6/25',
                progress.status === 'blocked' && active && 'bg-warn/60',
                progress.status === 'done' && done && 'bg-ok/70',
              )}
            />
          );
        })}
        {progress.totalSteps > dots.length && (
          <span className="ml-1 shrink-0 text-[10px] font-medium text-fg-5">+{progress.totalSteps - dots.length}</span>
        )}
      </div>
    </div>
  );
}

export function WorkflowProgressStrip({ progress }: { progress: WorkflowProgressSnapshot }) {
  const completedSteps = progress.status === 'done'
    ? progress.currentStep
    : Math.max(0, progress.currentStep - 1);
  const percent = Math.max(0, Math.min(100, (completedSteps / Math.max(1, progress.totalSteps)) * 100));
  const stepLabel = `Step ${progress.currentStep}/${progress.totalSteps} · ${progress.title}`;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.055] px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_14px_var(--th-primary)]" />
        <div className="min-w-0 flex-1">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-5">Workflow</span>
          <span className="ml-2 hidden min-w-0 truncate text-[12px] font-semibold text-fg sm:inline">
            {stepLabel}
          </span>
        </div>
        <span className={cn('shrink-0 rounded-md border px-2 py-1 text-[10.5px] font-semibold leading-none', statusTone(progress.status))}>
          {statusLabel(progress.status)}
        </span>
      </div>
      <div className="mt-1 min-w-0 truncate text-[12px] font-semibold text-fg sm:hidden">
        {stepLabel}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-inset">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            progress.status === 'blocked' ? 'bg-warn' : progress.status === 'done' ? 'bg-ok' : 'bg-primary',
          )}
          style={{ width: `${progress.status === 'running' ? Math.max(percent, 8) : percent}%` }}
        />
      </div>
    </div>
  );
}
