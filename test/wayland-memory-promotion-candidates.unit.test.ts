import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry } from '../dashboard/src/types.ts';
import {
  memoryPromotionCandidates,
  scoreMemoryPromotionCandidate,
} from '../dashboard/src/pages/wayland/memoryPromotionCandidates.ts';

const now = Date.parse('2026-06-15T00:00:00.000Z');

const entry = (input: Partial<KnowledgeEntry> & Pick<KnowledgeEntry, 'id' | 'title'>): KnowledgeEntry => ({
  id: input.id,
  title: input.title,
  body: input.body || `${input.title} body with enough durable detail to be useful later.`,
  summary: input.summary,
  kind: input.kind || 'knowledge-card',
  status: input.status || 'hidden',
  confidence: input.confidence || 'medium',
  createdBy: input.createdBy || 'manual',
  tags: input.tags || [],
  source: input.source,
  sourceRefs: input.sourceRefs || [],
  artifactRefs: input.artifactRefs || [],
  createdAt: input.createdAt || '2026-06-10T00:00:00.000Z',
  updatedAt: input.updatedAt || '2026-06-14T00:00:00.000Z',
});

describe('memory promotion candidates', () => {
  it('does not create candidates for published wiki entries', () => {
    expect(scoreMemoryPromotionCandidate(entry({
      id: 'wiki',
      title: 'Published',
      status: 'published',
    }), now)).toBeNull();

    expect(scoreMemoryPromotionCandidate(entry({
      id: 'tagged',
      title: 'Tagged wiki',
      tags: ['wiki'],
    }), now)).toBeNull();
  });

  it('scores sourced high-confidence memories above emerging notes', () => {
    const candidates = memoryPromotionCandidates([
      entry({
        id: 'ready',
        title: 'Ready concept',
        confidence: 'high',
        createdBy: 'agent',
        tags: ['architecture', 'decision'],
        body: 'A'.repeat(700),
        sourceRefs: [
          { type: 'file', path: '/repo/README.md', title: 'README', sourceFreshness: 'fresh' },
          { type: 'task', taskId: 'task-1', title: 'Task' },
        ],
        artifactRefs: [
          { kind: 'output', outputId: 'out-1', title: 'Output' },
        ],
      }),
      entry({
        id: 'loose',
        title: 'Loose note',
        confidence: 'low',
        body: 'short',
      }),
    ], now);

    expect(candidates.map(item => item.entry.id)).toEqual(['ready', 'loose']);
    expect(candidates[0].band).toBe('ready');
    expect(candidates[0].reasons).toContain('high confidence');
    expect(candidates[0].reasons.some(reason => reason.includes('source'))).toBe(true);
    expect(candidates[1].band).toBe('emerging');
  });

  it('marks high-value stale or unlinked entries for review instead of ready promotion', () => {
    const stale = scoreMemoryPromotionCandidate(entry({
      id: 'stale',
      title: 'Stale sourced concept',
      confidence: 'high',
      body: 'B'.repeat(700),
      sourceRefs: [
        { type: 'file', path: '/repo/old.md', title: 'Old file', sourceFreshness: 'stale' },
      ],
    }), now);

    expect(stale?.needsSourceReview).toBe(true);
    expect(stale?.band).not.toBe('ready');
    expect(stale?.reasons).toContain('source review needed');
  });
});
