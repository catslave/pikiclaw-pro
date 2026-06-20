import type { SessionInfo } from '../../types';

export type ChatWorkspaceGroupChild = NonNullable<SessionInfo['sideChats']>[number];

export type ChatWorkspaceGroup = {
  parent: SessionInfo;
  children: ChatWorkspaceGroupChild[];
};

export type ChatWorkspaceDropTarget = {
  agent: string;
  sessionId: string;
  sideChatOf?: { agent: string; sessionId: string } | null;
};

export function chatWorkspaceSessionKey(agent: string | null | undefined, sessionId: string | null | undefined): string {
  return `${agent || ''}:${sessionId || ''}`;
}

export function canAttachChatWorkspaceSession(parent: ChatWorkspaceDropTarget, child: ChatWorkspaceDropTarget): boolean {
  if (!parent.agent || !parent.sessionId || !child.agent || !child.sessionId) return false;
  if (parent.agent === child.agent && parent.sessionId === child.sessionId) return false;
  if (parent.sideChatOf?.agent === child.agent && parent.sideChatOf.sessionId === child.sessionId) return false;
  return true;
}

export function visibleChatWorkspaceChildren(session: SessionInfo): ChatWorkspaceGroupChild[] {
  const seen = new Set<string>();
  const out: ChatWorkspaceGroupChild[] = [];
  for (const ref of session.sideChats || []) {
    if (!ref?.agent || !ref.sessionId || ref.hidden) continue;
    const key = chatWorkspaceSessionKey(ref.agent, ref.sessionId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function buildChatWorkspaceGroups(sessions: SessionInfo[]): ChatWorkspaceGroup[] {
  return sessions
    .filter(session => !session.sideChatOf)
    .map(parent => ({
      parent,
      children: visibleChatWorkspaceChildren(parent),
    }));
}

export function chatWorkspacePaneGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 xl:grid-cols-2';
  return 'grid-cols-1 lg:grid-cols-2';
}

