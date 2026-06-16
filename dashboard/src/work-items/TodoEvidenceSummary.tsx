import type { ReactNode } from 'react';
import type { TodoItem } from '../types';
import { cn } from '../utils';
import { todoSourceSessionLabel } from './todoWorkItemEvidence';

export type TodoEvidenceCopy = {
  sourceQuote: string;
  sourceSession: string;
  linkedChat: string;
};

export function todoEvidenceSourceLabel(item: TodoItem): string {
  if (item.kind === 'review-comment') return 'Review comment';
  if (item.source?.type === 'chat-selection') return 'Chat selection';
  if (item.source?.type === 'review-comment') return 'Review comment';
  return 'Inbox capture';
}

export function todoEvidenceWorkspaceLabel(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
}

export function todoEvidenceLinkedChatLabel(item: TodoItem): string {
  return item.linkedChat ? `${item.linkedChat.agent}:${item.linkedChat.sessionId}` : '';
}

export function TodoEvidenceSummary({
  item,
  copy,
  sourceLabel,
  statusLabel,
  statusClassName,
  updatedLabel,
  imageCountLabel,
  sourceSessionLabel,
  workspaceLabel,
  linkedChatLabel,
  titleClassName,
  bodyClassName,
  imageStripTestId,
  onImageClick,
  footerPrefix,
}: {
  item: TodoItem;
  copy: TodoEvidenceCopy;
  sourceLabel?: string;
  statusLabel?: string;
  statusClassName?: string;
  updatedLabel?: string;
  imageCountLabel?: (count: number) => string;
  sourceSessionLabel?: string;
  workspaceLabel?: string;
  linkedChatLabel?: string;
  titleClassName?: string;
  bodyClassName?: string;
  imageStripTestId?: string;
  onImageClick?: (image: NonNullable<TodoItem['images']>[number]) => void;
  footerPrefix?: ReactNode;
}) {
  const sourceSession = sourceSessionLabel ?? todoSourceSessionLabel(item);
  const sourceWorkspace = workspaceLabel ?? (item.source?.workdir ? todoEvidenceWorkspaceLabel(item.source.workdir) : '');
  const linkedChat = linkedChatLabel ?? todoEvidenceLinkedChatLabel(item);
  const body = item.body || item.source?.quote || '';
  const imageCount = item.images?.length || 0;

  return (
    <div className="min-w-0 flex-1 text-left">
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
        {sourceLabel && (
          <span className="rounded-md border border-edge/55 bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-fg-5">
            {sourceLabel}
          </span>
        )}
        {statusLabel && (
          <span className={cn('rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]', statusClassName || 'border-edge/55 bg-inset text-fg-5')}>
            {statusLabel}
          </span>
        )}
        {imageCount > 0 && imageCountLabel && (
          <span className="rounded-md border border-primary/25 bg-primary/[0.08] px-1.5 py-0.5 text-[9.5px] font-medium text-primary">
            {imageCountLabel(imageCount)}
          </span>
        )}
        {item.linkedChat && (
          <span className="rounded-md border border-edge/55 bg-inset px-1.5 py-0.5 text-[9.5px] font-medium text-fg-5">{copy.linkedChat}</span>
        )}
        {item.source?.quote && (
          <span className="rounded-md border border-edge/55 bg-inset px-1.5 py-0.5 text-[9.5px] font-medium text-fg-5">{copy.sourceQuote}</span>
        )}
        {item.source?.agent && item.source?.sessionId && (
          <span className="max-w-full truncate rounded-md border border-edge/55 bg-inset px-1.5 py-0.5 text-[9.5px] font-medium text-fg-5">
            {copy.sourceSession}
          </span>
        )}
      </div>
      <div className={cn('truncate text-[13px] font-medium text-fg-3 group-hover:text-fg', titleClassName)} title={[item.title, body].filter(Boolean).join('\n\n')}>
        {item.title}
      </div>
      {body && (
        <div className={cn('mt-0.5 line-clamp-1 text-[11px] text-fg-5', bodyClassName)}>
          {body}
        </div>
      )}
      {!!item.images?.length && (
        <div className="mt-2 flex min-w-0 gap-1.5 overflow-hidden" data-testid={imageStripTestId}>
          {item.images.slice(0, 3).map(image => {
            const thumbnail = (
              <img
                src={image.dataUrl}
                alt={image.name}
                className="h-10 w-14 rounded-md border border-edge object-cover"
              />
            );
            return onImageClick ? (
              <button
                key={image.id}
                type="button"
                onClick={() => onImageClick(image)}
                className="shrink-0 rounded-md transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                data-testid="todo-evidence-image-preview"
              >
                {thumbnail}
              </button>
            ) : (
              <span key={image.id} className="shrink-0">
                {thumbnail}
              </span>
            );
          })}
        </div>
      )}
      {(updatedLabel || sourceSession || sourceWorkspace || linkedChat || footerPrefix) && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10.5px] text-fg-5">
          {footerPrefix}
          {updatedLabel && <span>{updatedLabel}</span>}
          {sourceSession && <span className="max-w-full truncate">{sourceSession}</span>}
          {sourceWorkspace && <span className="max-w-full truncate font-mono">{sourceWorkspace}</span>}
          {linkedChat && <span className="max-w-full truncate">{linkedChat}</span>}
        </div>
      )}
    </div>
  );
}
