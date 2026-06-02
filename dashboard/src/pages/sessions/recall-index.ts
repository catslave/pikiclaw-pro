import type { ProOutput, SessionSideChatRef } from '../../types';
import type { Turn } from './utils';

export type RecallIndexGroup = 'outline' | 'important';
export type RecallIndexKind = 'user' | 'assistant' | 'plan' | 'output' | 'file' | 'link' | 'side-chat';

export interface RecallIndexItem {
  id: string;
  group: RecallIndexGroup;
  kind: RecallIndexKind;
  title: string;
  subtitle?: string;
  turnIndex?: number;
  outputId?: string;
  sideChatKey?: string;
  path?: string;
  url?: string;
}

export interface RecallIndexResult {
  outline: RecallIndexItem[];
  important: RecallIndexItem[];
  olderTurnsNotIndexed: boolean;
}

export interface BuildRecallIndexInput {
  turns: Turn[];
  startTurn: number;
  totalTurns: number;
  outputs?: ProOutput[] | null;
  sideChats?: SessionSideChatRef[] | null;
  maxOutlineItems?: number;
  maxImportantItems?: number;
}

const DEFAULT_MAX_OUTLINE_ITEMS = 18;
const DEFAULT_MAX_IMPORTANT_ITEMS = 18;

function oneLine(value: string | null | undefined, max = 96): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function shortPath(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `.../${parts.slice(-3).join('/')}`;
}

function hasProposedPlan(text: string): boolean {
  return /<proposed_plan\b/i.test(text)
    || /\bproposed plan\b/i.test(text)
    || /^#+\s*plan\b/im.test(text)
    || /^#+\s*implementation plan\b/im.test(text);
}

function assistantHasRecallText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length < 24) return false;
  if (/^(ok|done|fixed|sure|sounds good)[.!]?\s*$/i.test(trimmed)) return false;
  return true;
}

function outputKind(output: ProOutput): RecallIndexKind {
  if (output.kind === 'link' || output.url) return 'link';
  if (output.kind === 'file' || output.kind === 'document' || output.kind === 'diff' || output.path) return 'file';
  return 'output';
}

function outputSubtitle(output: ProOutput): string {
  if (output.summary) return oneLine(output.summary, 110);
  if (output.path) return shortPath(output.path);
  if (output.url) return oneLine(output.url, 110);
  return output.kind;
}

function sideChatTitle(ref: SessionSideChatRef, index: number): string {
  return ref.title?.trim() || `Side card ${index + 1}`;
}

export function buildRecallIndex({
  turns,
  startTurn,
  totalTurns,
  outputs,
  sideChats,
  maxOutlineItems = DEFAULT_MAX_OUTLINE_ITEMS,
  maxImportantItems = DEFAULT_MAX_IMPORTANT_ITEMS,
}: BuildRecallIndexInput): RecallIndexResult {
  const outline: RecallIndexItem[] = [];

  turns.forEach((turn, index) => {
    const turnIndex = startTurn + index;
    const userTitle = oneLine(turn.user?.text, 96);
    if (userTitle) {
      outline.push({
        id: `turn-${turnIndex}-user`,
        group: 'outline',
        kind: 'user',
        title: userTitle,
        subtitle: `Turn ${turnIndex + 1}`,
        turnIndex,
      });
    }

    const assistantText = turn.assistant?.text || '';
    if (hasProposedPlan(assistantText)) {
      outline.push({
        id: `turn-${turnIndex}-plan`,
        group: 'outline',
        kind: 'plan',
        title: 'Proposed plan',
        subtitle: oneLine(assistantText.replace(/<\/?proposed_plan>/gi, ''), 110) || `Turn ${turnIndex + 1}`,
        turnIndex,
      });
    } else if (assistantHasRecallText(assistantText)) {
      outline.push({
        id: `turn-${turnIndex}-assistant`,
        group: 'outline',
        kind: 'assistant',
        title: oneLine(assistantText, 96),
        subtitle: `Answer · Turn ${turnIndex + 1}`,
        turnIndex,
      });
    }
  });

  const important: RecallIndexItem[] = [];
  (outputs || []).forEach(output => {
    const title = oneLine(output.title || output.path || output.url || output.id, 96);
    if (!title) return;
    important.push({
      id: `output-${output.id}`,
      group: 'important',
      kind: outputKind(output),
      title,
      subtitle: outputSubtitle(output),
      turnIndex: typeof output.turnIndex === 'number' ? output.turnIndex : undefined,
      outputId: output.id,
      path: output.path,
      url: output.url,
    });
  });

  (sideChats || []).filter(ref => !ref.hidden).forEach((ref, index) => {
    important.push({
      id: `side-chat-${ref.agent}:${ref.sessionId}`,
      group: 'important',
      kind: 'side-chat',
      title: sideChatTitle(ref, index),
      subtitle: ref.userStatus ? `Side card · ${ref.userStatus}` : 'Side card',
      sideChatKey: `${ref.agent}:${ref.sessionId}`,
    });
  });

  return {
    outline: outline.slice(-Math.max(0, maxOutlineItems)),
    important: important.slice(0, Math.max(0, maxImportantItems)),
    olderTurnsNotIndexed: startTurn > 0 && totalTurns > turns.length,
  };
}
