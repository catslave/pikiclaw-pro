import type { KnowledgeEntry, KnowledgeSourceFreshness, KnowledgeSourceRef } from '../../types';

export type MemorySourceHealthState = KnowledgeSourceFreshness | 'unlinked';
export type MemorySourceHealthFilter = 'all' | 'needs-review' | MemorySourceHealthState;

export interface MemorySourceHealth {
  entryId: string;
  worstState: MemorySourceHealthState;
  totalSources: number;
  trackedSources: number;
  checkableSources: number;
  needsReview: boolean;
  sourceCounts: Record<KnowledgeSourceFreshness, number>;
}

export interface MemorySourceHealthSummary {
  entries: MemorySourceHealth[];
  totalEntries: number;
  totalSources: number;
  trackedSources: number;
  checkableSources: number;
  needsReviewEntries: number;
  entryCounts: Record<MemorySourceHealthState, number>;
  sourceCounts: Record<KnowledgeSourceFreshness, number>;
}

export const MEMORY_SOURCE_HEALTH_FILTERS: MemorySourceHealthFilter[] = [
  'all',
  'needs-review',
  'stale',
  'missing',
  'unreadable',
  'unchecked',
  'fresh',
  'unlinked',
];

const SOURCE_FRESHNESS_VALUES: KnowledgeSourceFreshness[] = [
  'unchecked',
  'fresh',
  'stale',
  'missing',
  'unreadable',
  'unsupported',
];

const ENTRY_HEALTH_VALUES: MemorySourceHealthState[] = [
  'unlinked',
  ...SOURCE_FRESHNESS_VALUES,
];

const WORST_STATE_ORDER: MemorySourceHealthState[] = [
  'unlinked',
  'missing',
  'unreadable',
  'stale',
  'unchecked',
  'fresh',
  'unsupported',
];

function emptySourceCounts(): Record<KnowledgeSourceFreshness, number> {
  return {
    unchecked: 0,
    fresh: 0,
    stale: 0,
    missing: 0,
    unreadable: 0,
    unsupported: 0,
  };
}

function emptyEntryCounts(): Record<MemorySourceHealthState, number> {
  return {
    unlinked: 0,
    unchecked: 0,
    fresh: 0,
    stale: 0,
    missing: 0,
    unreadable: 0,
    unsupported: 0,
  };
}

export function memorySourceRefHealthState(ref: KnowledgeSourceRef): KnowledgeSourceFreshness {
  if (ref.sourceFreshness) return ref.sourceFreshness;
  if (ref.type === 'file') return 'unchecked';
  return 'unsupported';
}

function isCheckableSource(ref: KnowledgeSourceRef): boolean {
  return ref.type === 'file';
}

function healthNeedsReview(state: MemorySourceHealthState, checkableSources: number): boolean {
  if (state === 'unlinked' || state === 'missing' || state === 'unreadable' || state === 'stale') return true;
  return state === 'unchecked' && checkableSources > 0;
}

export function memorySourceHealthForEntry(entry: KnowledgeEntry): MemorySourceHealth {
  const sourceCounts = emptySourceCounts();
  const states: KnowledgeSourceFreshness[] = [];
  let checkableSources = 0;
  for (const ref of entry.sourceRefs) {
    const state = memorySourceRefHealthState(ref);
    sourceCounts[state] += 1;
    states.push(state);
    if (isCheckableSource(ref)) checkableSources += 1;
  }

  const totalSources = entry.sourceRefs.length + entry.artifactRefs.length + (entry.source ? 1 : 0);
  const trackedSources = entry.sourceRefs.length;
  const worstState = !totalSources
    ? 'unlinked'
    : WORST_STATE_ORDER.find(state => state !== 'unlinked' && states.includes(state as KnowledgeSourceFreshness)) || 'unsupported';

  return {
    entryId: entry.id,
    worstState,
    totalSources,
    trackedSources,
    checkableSources,
    needsReview: healthNeedsReview(worstState, checkableSources),
    sourceCounts,
  };
}

export function summarizeMemorySourceHealth(entries: KnowledgeEntry[]): MemorySourceHealthSummary {
  const sourceCounts = emptySourceCounts();
  const entryCounts = emptyEntryCounts();
  const healthEntries = entries.map(memorySourceHealthForEntry);
  let totalSources = 0;
  let trackedSources = 0;
  let checkableSources = 0;
  let needsReviewEntries = 0;

  for (const health of healthEntries) {
    entryCounts[health.worstState] += 1;
    totalSources += health.totalSources;
    trackedSources += health.trackedSources;
    checkableSources += health.checkableSources;
    if (health.needsReview) needsReviewEntries += 1;
    for (const state of SOURCE_FRESHNESS_VALUES) {
      sourceCounts[state] += health.sourceCounts[state];
    }
  }

  return {
    entries: healthEntries,
    totalEntries: entries.length,
    totalSources,
    trackedSources,
    checkableSources,
    needsReviewEntries,
    entryCounts,
    sourceCounts,
  };
}

export function memorySourceHealthFilterCount(summary: MemorySourceHealthSummary, filter: MemorySourceHealthFilter): number {
  if (filter === 'all') return summary.totalEntries;
  if (filter === 'needs-review') return summary.needsReviewEntries;
  return summary.entryCounts[filter];
}

export function memorySourceHealthFilterMatches(entry: KnowledgeEntry, filter: MemorySourceHealthFilter): boolean {
  if (filter === 'all') return true;
  const health = memorySourceHealthForEntry(entry);
  if (filter === 'needs-review') return health.needsReview;
  return health.worstState === filter || health.sourceCounts[filter as KnowledgeSourceFreshness] > 0;
}

export function isMemorySourceHealthState(value: string): value is MemorySourceHealthState {
  return ENTRY_HEALTH_VALUES.includes(value as MemorySourceHealthState);
}
