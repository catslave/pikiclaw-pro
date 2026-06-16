import type { TodoItem } from './todos.js';

function formatTodoImageSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function todoSourceSessionLabel(item: TodoItem): string {
  const source = item.source;
  if (!source?.agent || !source.sessionId) return '';
  return `${source.agent}:${source.sessionId}${typeof source.turnIndex === 'number' ? ` turn ${source.turnIndex}` : ''}`;
}

export function todoToWorkItemDescription(item: TodoItem): string {
  const sourceSession = todoSourceSessionLabel(item);
  const parts = [
    item.body ? `Inbox note:\n${item.body}` : '',
    item.source?.quote ? `Quoted source:\n${item.source.quote}` : '',
    item.images?.length
      ? `Images:\n${item.images.map(image => {
        const size = formatTodoImageSize(image.size);
        return `- ${image.name}${size ? ` (${size})` : ''}`;
      }).join('\n')}`
      : '',
    sourceSession ? `Source session: ${sourceSession}` : '',
    item.source?.workdir ? `Source workspace: ${item.source.workdir}` : '',
    item.linkedChat ? `Linked chat: ${item.linkedChat.agent}:${item.linkedChat.sessionId}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}
