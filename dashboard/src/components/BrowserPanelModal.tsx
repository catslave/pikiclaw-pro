import type { BrowserPanelSnapshot } from '../types';
import { Button, Input, Modal, ModalHeader, Badge } from './ui';

export function BrowserPanelModal({
  snapshot,
  busy,
  urlDraft,
  typeDraft,
  onUrlDraft,
  onTypeDraft,
  onNavigate,
  onReload,
  onClickImage,
  onTypeText,
  onClose,
}: {
  snapshot: BrowserPanelSnapshot | null;
  busy: boolean;
  urlDraft: string;
  typeDraft: string;
  onUrlDraft: (value: string) => void;
  onTypeDraft: (value: string) => void;
  onNavigate: () => void;
  onReload: () => void;
  onClickImage: (xRatio: number, yRatio: number) => void;
  onTypeText: () => void;
  onClose: () => void;
}) {
  if (!snapshot) return null;
  return (
    <Modal
      open
      onClose={onClose}
      wide
      panelStyle={{ maxWidth: 'min(1180px, calc(100vw - 24px))', width: 'min(1180px, calc(100vw - 24px))' }}
    >
      <ModalHeader
        title="Pikiclaw Browser"
        description="Managed profile browser session. Click the preview to interact; use text input for typing into the focused field."
        onClose={onClose}
      />
      <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input value={urlDraft} onChange={event => onUrlDraft(event.target.value)} placeholder="https://..." />
          <Button variant="secondary" disabled={busy || !urlDraft.trim()} onClick={onNavigate}>Open</Button>
          <Button variant="ghost" disabled={busy} onClick={onReload}>Refresh</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input value={typeDraft} onChange={event => onTypeDraft(event.target.value)} placeholder="Type into focused field" />
          <Button variant="secondary" disabled={busy || !typeDraft} onClick={onTypeText}>Type</Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-fg-5">
          <Badge variant="muted">{busy ? 'Working' : 'Ready'}</Badge>
          <span className="truncate font-mono">{snapshot.url}</span>
          {snapshot.title && <span className="truncate">· {snapshot.title}</span>}
        </div>
        <div className="overflow-hidden rounded-lg border border-edge bg-inset">
          <button
            type="button"
            disabled={busy}
            className="block w-full cursor-crosshair disabled:cursor-wait"
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              onClickImage((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
            }}
          >
            <img
              src={snapshot.image}
              alt={snapshot.title || snapshot.url}
              className="block h-auto w-full select-none"
              draggable={false}
            />
          </button>
        </div>
      </div>
    </Modal>
  );
}
