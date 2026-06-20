import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../dashboard/src/types.ts';
import {
  buildChatWorkspaceGroups,
  canAttachChatWorkspaceSession,
  chatWorkspacePaneGridClass,
  visibleChatWorkspaceChildren,
} from '../dashboard/src/pages/sessions/chatWorkspaceGroups.ts';

function session(input: Partial<SessionInfo> & Pick<SessionInfo, 'agent' | 'sessionId'>): SessionInfo {
  return {
    sessionId: input.sessionId,
    agent: input.agent,
    runState: 'completed',
    sideChats: [],
    ...input,
  };
}

describe('chat workspace groups', () => {
  it('builds parent groups with visible child chats', () => {
    const parent = session({
      agent: 'codex',
      sessionId: 'parent',
      sideChats: [
        { agent: 'codex', sessionId: 'child-a', title: 'Plan A', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:01:00.000Z' },
        { agent: 'codex', sessionId: 'child-hidden', title: 'Hidden', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:01:00.000Z', hidden: true },
        { agent: 'codex', sessionId: 'child-a', title: 'Duplicate', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:02:00.000Z' },
      ],
    });
    const child = session({
      agent: 'codex',
      sessionId: 'child-a',
      sideChatOf: { agent: 'codex', sessionId: 'parent' },
    });
    const root = session({ agent: 'codex', sessionId: 'root' });

    expect(visibleChatWorkspaceChildren(parent).map(ref => ref.sessionId)).toEqual(['child-a']);
    expect(buildChatWorkspaceGroups([parent, child, root]).map(group => ({
      parent: group.parent.sessionId,
      children: group.children.map(ref => ref.sessionId),
    }))).toEqual([
      { parent: 'parent', children: ['child-a'] },
      { parent: 'root', children: [] },
    ]);
  });

  it('guards invalid nesting and maps pane counts to stable grids', () => {
    expect(canAttachChatWorkspaceSession(
      { agent: 'codex', sessionId: 'parent' },
      { agent: 'codex', sessionId: 'child' },
    )).toBe(true);
    expect(canAttachChatWorkspaceSession(
      { agent: 'codex', sessionId: 'same' },
      { agent: 'codex', sessionId: 'same' },
    )).toBe(false);
    expect(canAttachChatWorkspaceSession(
      { agent: 'codex', sessionId: 'child', sideChatOf: { agent: 'codex', sessionId: 'parent' } },
      { agent: 'codex', sessionId: 'parent' },
    )).toBe(false);

    expect(chatWorkspacePaneGridClass(1)).toBe('grid-cols-1');
    expect(chatWorkspacePaneGridClass(2)).toBe('grid-cols-1 xl:grid-cols-2');
    expect(chatWorkspacePaneGridClass(4)).toBe('grid-cols-1 lg:grid-cols-2');
  });
});

