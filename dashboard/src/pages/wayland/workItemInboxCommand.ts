import type { TodoItem } from '../../types';
import { commandLane, type WorkItemCommandLane } from './workItemCommandLanes';

export interface WorkItemInboxCommandItem {
  key: string;
  title: string;
  detail: string;
  to: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  priority?: number;
  lanes?: WorkItemCommandLane[];
  keys: string[];
  tone: 'primary' | 'ok' | 'warn' | 'idle';
  keywords: string[];
}

export interface WorkItemInboxCommandOptions {
  limit?: number;
}

function todoEvidenceLabels(item: TodoItem): string[] {
  const labels: string[] = [];
  if (item.body?.trim()) labels.push('note');
  if (item.source?.quote?.trim()) labels.push('quote');
  if (item.images?.length) labels.push(`${item.images.length} image${item.images.length === 1 ? '' : 's'}`);
  if (item.source?.sessionId) labels.push('source chat');
  if (item.source?.workdir) labels.push('workspace');
  if (item.linkedChat) labels.push('linked chat');
  return labels;
}

function todoSourceLabel(item: TodoItem): string {
  if (item.source?.type === 'chat-selection') return 'Chat capture';
  if (item.source?.type === 'review-comment') return 'Review comment';
  return 'Inbox capture';
}

function todoTime(item: TodoItem): number {
  const updated = Date.parse(item.updatedAt || '');
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(item.createdAt || '');
  return Number.isFinite(created) ? created : 0;
}

function chatFocusUrl(args: { workdir?: string; agent?: string; sessionId?: string }): string | null {
  if (!args.workdir || !args.agent || !args.sessionId) return null;
  const params = new URLSearchParams();
  params.set('workdir', args.workdir);
  params.set('agent', args.agent);
  params.set('session', args.sessionId);
  params.set('nonce', String(Date.now()));
  return `/conversations/session?${params.toString()}`;
}

function todoChatTarget(item: TodoItem): { to: string; label: string } | null {
  const linked = chatFocusUrl(item.linkedChat || {});
  if (linked) return { to: linked, label: 'Open linked chat' };
  const source = chatFocusUrl(item.source || {});
  if (source) return { to: source, label: 'Open source chat' };
  return null;
}

export function buildWorkItemInboxCommandItems(
  items: TodoItem[],
  options: WorkItemInboxCommandOptions = {},
): WorkItemInboxCommandItem[] {
  const limit = options.limit ?? 12;

  return items
    .filter(item => item.status === 'open')
    .sort((a, b) => todoTime(b) - todoTime(a))
    .slice(0, limit)
    .map(item => {
      const evidence = todoEvidenceLabels(item);
      const source = todoSourceLabel(item);
      const workdir = item.source?.workdir || item.linkedChat?.workdir || '';
      const chatTarget = todoChatTarget(item);
      const hasRichEvidence = evidence.some(label => label.includes('image') || label === 'quote' || label === 'source chat' || label === 'linked chat');
      return {
        key: `inbox:${item.id}`,
        title: `Inbox capture: ${item.title}`,
        detail: `${source} · ${evidence.length ? evidence.join(' · ') : 'needs source detail'}${workdir ? ` · ${workdir}` : ''}`,
        to: `/work-items?source=inbox&todo=${encodeURIComponent(item.id)}`,
        secondaryTo: chatTarget?.to,
        secondaryLabel: chatTarget?.label,
        priority: chatTarget ? 28 : hasRichEvidence ? 12 : 0,
        lanes: [
          commandLane('Source', chatTarget ? 'Chat' : item.source?.quote ? 'Quote' : item.images?.length ? 'Image' : 'Inbox', chatTarget ? 'source' : hasRichEvidence ? 'attention' : 'idle'),
          commandLane('Execution', 'Promote', 'execution'),
        ],
        keys: hasRichEvidence ? ['Promote', 'Evidence'] : ['Promote', 'Inbox'],
        tone: hasRichEvidence ? 'ok' as const : 'idle' as const,
        keywords: [
          'inbox capture',
          'todo intake',
          'promote todo',
          'work item intake',
          'plan today',
          'start chat',
          item.id,
          item.kind,
          item.title,
          item.body || '',
          item.source?.type || '',
          item.source?.quote || '',
          item.source?.agent || '',
          item.source?.sessionId || '',
          item.source?.workdir || '',
          item.linkedChat?.agent || '',
          item.linkedChat?.sessionId || '',
          ...(item.images || []).map(image => image.name),
        ].filter(Boolean),
      };
    });
}
