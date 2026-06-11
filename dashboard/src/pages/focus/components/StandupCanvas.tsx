import type { FocusAction, FocusBriefItem, FocusCommandCenter } from '../../../types';
import { Badge, Button } from '../../../components/ui';
import { FocusActionButton } from './FocusActionButton';

function BriefColumn({
  title,
  items,
  empty,
  onAction,
}: {
  title: string;
  items: FocusBriefItem[];
  empty: string;
  onAction: (action?: FocusAction | null) => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.length ? items.map(item => (
          <div key={item.id} className="rounded-md border border-edge/70 bg-panel-alt px-3 py-2">
            <div className="truncate text-sm font-medium text-fg">{item.title}</div>
            {item.summary && <div className="mt-1 line-clamp-2 text-xs text-fg-4">{item.summary}</div>}
            {item.action && (
              <div className="mt-2">
                <FocusActionButton action={item.action} label={item.action.label} onAction={onAction} />
              </div>
            )}
          </div>
        )) : <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-5">{empty}</div>}
      </div>
    </div>
  );
}

export function StandupCanvas({
  command,
  copy,
  onAction,
  onRefreshToday,
  refreshing,
}: {
  command: FocusCommandCenter;
  copy: Record<string, string>;
  onAction: (action?: FocusAction | null) => void;
  onRefreshToday: () => void;
  refreshing?: boolean;
}) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{copy.chief}</div>
          <h2 className="text-lg font-semibold text-fg">{copy.standup}</h2>
          <p className="mt-1 text-sm text-fg-4">{command.headline}</p>
        </div>
        <Button variant="secondary" onClick={onRefreshToday} disabled={refreshing}>{copy.refreshToday}</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <BriefColumn title={copy.yesterday} items={command.standup.yesterdayReview} empty={copy.emptyStandup} onAction={onAction} />
        <BriefColumn title={copy.incoming} items={command.standup.todayIncoming} empty={copy.emptyStandup} onAction={onAction} />
        <BriefColumn title={copy.recommendations} items={command.standup.recommendations} empty={copy.emptyStandup} onAction={onAction} />
      </div>
    </section>
  );
}
