import type { FocusSandbox } from '../../../types';
import { Badge, Button } from '../../../components/ui';

function TypeBadge({ sandbox }: { sandbox: FocusSandbox }) {
  const label = sandbox.type === 'jira' ? 'Jira'
    : sandbox.type === 'bug' ? 'Bug'
      : sandbox.type === 'review' ? 'Review'
        : sandbox.type === 'todo' ? 'Todo'
          : 'Chat';
  const variant = sandbox.type === 'bug' ? 'warn' : sandbox.type === 'chat' ? 'muted' : 'accent';
  return <Badge variant={variant}>{label}</Badge>;
}

function SandboxCard({
  sandbox,
  copy,
  onContinue,
  onOpen,
}: {
  sandbox: FocusSandbox;
  copy: Record<string, string>;
  onContinue: (sandbox: FocusSandbox) => void;
  onOpen: (sandbox: FocusSandbox) => void;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge sandbox={sandbox} />
            <Badge variant="ok">Active</Badge>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-fg">{sandbox.title}</h3>
          {sandbox.breakpoint && <p className="mt-1 text-sm text-fg-3">{sandbox.breakpoint}</p>}
        </div>
        <div className="text-right text-xs text-fg-5">{sandbox.progress}%</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onContinue(sandbox)}>{copy.continue}</Button>
        <Button variant="outline" onClick={() => onOpen(sandbox)}>{copy.open}</Button>
      </div>
    </div>
  );
}

function CompactSandboxRow({
  sandbox,
  copy,
  onContinue,
  onPromote,
}: {
  sandbox: FocusSandbox;
  copy: Record<string, string>;
  onContinue: (sandbox: FocusSandbox) => void;
  onPromote?: (sandbox: FocusSandbox) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-edge/70 bg-panel-alt px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{sandbox.title}</div>
        <span className="mt-1 block truncate text-xs text-fg-5">{sandbox.breakpoint || sandbox.summary || sandbox.workspaceName || sandbox.status}</span>
      </div>
      <div className="flex shrink-0 gap-2">
        {onPromote && <Button variant="ghost" onClick={() => onPromote(sandbox)}>{copy.promote}</Button>}
        <Button variant="outline" onClick={() => onContinue(sandbox)}>{copy.continue}</Button>
      </div>
    </div>
  );
}

export function SandboxGrid({
  active,
  queued,
  copy,
  onContinue,
  onOpen,
  onPromote,
}: {
  active: FocusSandbox[];
  queued: FocusSandbox[];
  copy: Record<string, string>;
  onContinue: (sandbox: FocusSandbox) => void;
  onOpen: (sandbox: FocusSandbox) => void;
  onPromote?: (sandbox: FocusSandbox) => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold text-fg">{copy.activeSandboxes}</h2>
          <Badge variant="muted">{active.length}</Badge>
        </div>
        <div className="space-y-3">
          {active.length
            ? active.map(sandbox => <SandboxCard key={sandbox.id} sandbox={sandbox} copy={copy} onContinue={onContinue} onOpen={onOpen} />)
            : <div className="rounded-md border border-dashed border-edge px-4 py-5 text-center text-sm text-fg-4">{copy.emptyActive}</div>}
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold text-fg">{copy.nextQueue}</h2>
          <Badge variant="muted">{queued.length}</Badge>
        </div>
        <div className="space-y-2">
          {queued.length
            ? queued.map(sandbox => <CompactSandboxRow key={sandbox.id} sandbox={sandbox} copy={copy} onContinue={onContinue} onPromote={onPromote} />)
            : <div className="rounded-md border border-dashed border-edge px-4 py-5 text-center text-sm text-fg-4">{copy.emptyQueue}</div>}
        </div>
      </section>
    </div>
  );
}
