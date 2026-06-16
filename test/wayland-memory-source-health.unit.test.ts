import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry } from '../dashboard/src/types.ts';
import {
  memorySourceHealthFilterCount,
  memorySourceHealthFilterMatches,
  memorySourceHealthForEntry,
  memorySourceRefHealthState,
  summarizeMemorySourceHealth,
} from '../dashboard/src/pages/wayland/memorySourceHealth.ts';

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'knowledge-alpha',
    title: 'Memory source health',
    body: 'Durable fact with source trail.',
    kind: 'knowledge-card',
    status: 'hidden',
    sourceRefs: [],
    artifactRefs: [],
    confidence: 'medium',
    createdBy: 'manual',
    tags: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T01:00:00.000Z',
    ...overrides,
  };
}

describe('Wayland Memory source health', () => {
  it('treats unchecked file sources as reviewable source health', () => {
    const ref = { type: 'file' as const, path: '/repo/spec.md', title: 'Spec' };
    const health = memorySourceHealthForEntry(entry({ sourceRefs: [ref] }));

    expect(memorySourceRefHealthState(ref)).toBe('unchecked');
    expect(health).toMatchObject({
      worstState: 'unchecked',
      checkableSources: 1,
      needsReview: true,
    });
  });

  it('marks entries without any source trail as unlinked', () => {
    const health = memorySourceHealthForEntry(entry());

    expect(health).toMatchObject({
      worstState: 'unlinked',
      totalSources: 0,
      needsReview: true,
    });
    expect(memorySourceHealthFilterMatches(entry(), 'unlinked')).toBe(true);
    expect(memorySourceHealthFilterMatches(entry(), 'needs-review')).toBe(true);
  });

  it('summarizes worst state, source counts, and filter counts', () => {
    const fresh = entry({
      id: 'fresh',
      sourceRefs: [{ type: 'file', path: '/repo/fresh.md', sourceFreshness: 'fresh' }],
    });
    const staleMixed = entry({
      id: 'stale',
      sourceRefs: [
        { type: 'file', path: '/repo/ok.md', sourceFreshness: 'fresh' },
        { type: 'file', path: '/repo/stale.md', sourceFreshness: 'stale' },
      ],
    });
    const missing = entry({
      id: 'missing',
      sourceRefs: [{ type: 'file', path: '/repo/missing.md', sourceFreshness: 'missing' }],
    });
    const manual = entry({
      id: 'manual',
      sourceRefs: [{ type: 'manual', title: 'Human note' }],
    });

    const summary = summarizeMemorySourceHealth([fresh, staleMixed, missing, manual]);

    expect(summary.totalEntries).toBe(4);
    expect(summary.totalSources).toBe(5);
    expect(summary.needsReviewEntries).toBe(2);
    expect(summary.entryCounts).toMatchObject({
      fresh: 1,
      stale: 1,
      missing: 1,
      unsupported: 1,
    });
    expect(summary.sourceCounts).toMatchObject({
      fresh: 2,
      stale: 1,
      missing: 1,
      unsupported: 1,
    });
    expect(memorySourceHealthFilterCount(summary, 'needs-review')).toBe(2);
    expect(memorySourceHealthFilterCount(summary, 'fresh')).toBe(1);
    expect(memorySourceHealthFilterMatches(staleMixed, 'fresh')).toBe(true);
    expect(memorySourceHealthFilterMatches(staleMixed, 'stale')).toBe(true);
    expect(memorySourceHealthFilterMatches(manual, 'needs-review')).toBe(false);
  });
});
