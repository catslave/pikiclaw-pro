import type { FocusCanvasBlock, FocusCommandCenter, FocusOutputItem, FocusSessionItem } from '../../../types';
import { StandupCanvas } from './StandupCanvas';
import { SandboxGrid } from './SandboxGrid';
import { CheckoutCanvas } from './CheckoutCanvas';
import { MemoryStrip } from './MemoryStrip';
import { IntentChip } from './IntentChip';
import type { FocusSandbox } from '../../../types';

export function FocusCanvas({
  command,
  outputs,
  candidates,
  copy,
  maintaining,
  onAction,
  onContinue,
  onOpen,
  onPromote,
  onMaintenance,
  onEndDay,
  onRefreshToday,
  onOpenOutput,
  onExtract,
  onIntent,
  loading,
  refreshing,
}: {
  command: FocusCommandCenter;
  outputs: FocusOutputItem[];
  candidates: FocusSessionItem[];
  copy: Record<string, string>;
  maintaining: boolean;
  onAction: (action?: import('../../../types').FocusAction | null) => void;
  onContinue: (sandbox: FocusSandbox) => void;
  onOpen: (sandbox: FocusSandbox) => void;
  onPromote?: (sandbox: FocusSandbox) => void;
  onMaintenance: () => void;
  onEndDay: () => void;
  onRefreshToday: () => void;
  onOpenOutput: (item: FocusOutputItem) => void;
  onExtract: (item: FocusSessionItem) => void;
  onIntent: (text: string) => void;
  loading?: boolean;
  refreshing?: boolean;
}) {
  const blocks = command.canvas || [];
  const queued = [...command.sandboxes.active.slice(3), ...command.sandboxes.paused].slice(0, 6);
  const active = command.sandboxes.active.slice(0, 3);

  const renderBlock = (block: FocusCanvasBlock, index: number) => {
    if (block.type === 'standup') {
      return (
        <StandupCanvas
          key={`standup-${index}`}
          command={command}
          copy={copy}
          onAction={onAction}
          onRefreshToday={onRefreshToday}
          refreshing={refreshing}
        />
      );
    }
    if (block.type === 'sandbox-grid') {
      return (
        <SandboxGrid
          key={`sandboxes-${index}`}
          active={block.sandboxes?.slice(0, block.maxVisible || 3) || active}
          queued={queued}
          copy={copy}
          onContinue={onContinue}
          onOpen={onOpen}
          onPromote={onPromote}
        />
      );
    }
    if (block.type === 'checkout') {
      return (
        <CheckoutCanvas
          key={`checkout-${index}`}
          command={command}
          copy={copy}
          maintaining={maintaining}
          onAction={onAction}
          onMaintenance={onMaintenance}
          onEndDay={onEndDay}
        />
      );
    }
    if (block.type === 'memory-strip') {
      return (
        <MemoryStrip
          key={`memory-${index}`}
          command={command}
          outputs={outputs}
          candidates={candidates}
          copy={copy}
          onOpenOutput={onOpenOutput}
          onExtract={onExtract}
        />
      );
    }
    if (block.type === 'intent-echo') {
      return (
        <div key={`intent-${index}`} className="rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-3 text-sm text-fg-3">
          {copy.intentApplied}: {block.userIntent}
          {block.revisedHeadline && <div className="mt-1 text-fg">{block.revisedHeadline}</div>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-5">
      <IntentChip placeholder={copy.intentPlaceholder} submitLabel={copy.intentSubmit} onSubmit={onIntent} disabled={loading} />
      {blocks.length
        ? blocks.map(renderBlock)
        : (
          <>
            <StandupCanvas command={command} copy={copy} onAction={onAction} onRefreshToday={onRefreshToday} refreshing={refreshing} />
            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
              <SandboxGrid active={active} queued={queued} copy={copy} onContinue={onContinue} onOpen={onOpen} onPromote={onPromote} />
              <div className="flex flex-col gap-5">
                <CheckoutCanvas command={command} copy={copy} maintaining={maintaining} onAction={onAction} onMaintenance={onMaintenance} onEndDay={onEndDay} />
                <MemoryStrip command={command} outputs={outputs} candidates={candidates} copy={copy} onOpenOutput={onOpenOutput} onExtract={onExtract} />
              </div>
            </div>
          </>
        )}
    </div>
  );
}
