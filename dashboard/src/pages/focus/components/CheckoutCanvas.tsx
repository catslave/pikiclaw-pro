import type { FocusAction, FocusCommandCenter } from '../../../types';
import { Badge, Button, Spinner } from '../../../components/ui';
import { FocusActionButton } from './FocusActionButton';

function BriefList({
  title,
  items,
  empty,
  onAction,
}: {
  title: string;
  items: FocusCommandCenter['checkout']['completedToday'];
  empty: string;
  onAction: (action?: FocusAction | null) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.length ? items.map(item => (
          <div key={item.id} className="rounded-md border border-edge/70 bg-panel-alt px-3 py-2">
            <div className="text-sm font-medium text-fg">{item.title}</div>
            {item.summary && <div className="mt-1 text-xs text-fg-4">{item.summary}</div>}
            {item.action && <div className="mt-2"><FocusActionButton action={item.action} label={item.action.label} onAction={onAction} /></div>}
          </div>
        )) : <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-5">{empty}</div>}
      </div>
    </div>
  );
}

export function CheckoutCanvas({
  command,
  copy,
  maintaining,
  onAction,
  onMaintenance,
  onEndDay,
}: {
  command: FocusCommandCenter;
  copy: Record<string, string>;
  maintaining: boolean;
  onAction: (action?: FocusAction | null) => void;
  onMaintenance: () => void;
  onEndDay: () => void;
}) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">{copy.checkout}</h2>
        <Button variant="ghost" onClick={onEndDay}>{copy.endDay}</Button>
      </div>
      <div className="space-y-4">
        <BriefList title={copy.completedToday} items={command.checkout.completedToday} empty={copy.emptyCheckout} onAction={onAction} />
        <BriefList title={copy.syncProposals} items={command.checkout.syncProposals} empty={copy.emptyCheckout} onAction={onAction} />
        <BriefList title={copy.cleanup} items={command.checkout.cleanupCandidates} empty={copy.emptyCheckout} onAction={onAction} />
      </div>
      <div className="mt-4">
        <Button variant="primary" onClick={onMaintenance} disabled={maintaining}>
          {maintaining ? <Spinner /> : null}
          {copy.maintenance}
        </Button>
      </div>
    </section>
  );
}
