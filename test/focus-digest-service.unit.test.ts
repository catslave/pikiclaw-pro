import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry } from '../src/pro/workflow.ts';
import { buildDigestIndex, isDigestStale } from '../src/dashboard/focus-digest-service.ts';
import type { SessionInfo } from '../src/agent/types.ts';

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 's1',
    agent: 'codex',
    workdir: '/repo/app',
    createdAt: '2026-06-06T08:00:00.000Z',
    runUpdatedAt: '2026-06-06T10:00:00.000Z',
    ...overrides,
  } as SessionInfo;
}

describe('focus digest service', () => {
  it('builds digest index from session-digest knowledge entries', () => {
    const entries: KnowledgeEntry[] = [{
      id: 'k1',
      title: 'Digest',
      body: 'Stopped at auth middleware.',
      kind: 'session-digest',
      status: 'published',
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
      artifactRefs: [],
      confidence: 'high',
      createdBy: 'test',
      createdAt: '2026-06-06T09:00:00.000Z',
      updatedAt: '2026-06-06T09:00:00.000Z',
    }];
    const index = buildDigestIndex(entries);
    expect(index.get('/repo/app::codex::s1')).toBe('Stopped at auth middleware.');
  });

  it('marks digest stale when session updated later', () => {
    const entry: KnowledgeEntry = {
      id: 'k1',
      title: 'Digest',
      body: 'Old',
      kind: 'session-digest',
      status: 'published',
      sourceRefs: [{ type: 'chat', workdir: '/repo/app', agent: 'codex', sessionId: 's1' }],
      artifactRefs: [],
      confidence: 'medium',
      createdBy: 'test',
      createdAt: '2026-06-06T08:00:00.000Z',
      updatedAt: '2026-06-06T08:00:00.000Z',
    };
    expect(isDigestStale(entry, session({ runUpdatedAt: '2026-06-06T10:00:00.000Z' }))).toBe(true);
    expect(isDigestStale(entry, session({ runUpdatedAt: '2026-06-06T07:00:00.000Z' }), Date.parse('2026-06-06T08:30:00.000Z'))).toBe(false);
  });
});
