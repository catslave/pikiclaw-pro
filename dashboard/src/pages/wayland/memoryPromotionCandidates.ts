import type { KnowledgeEntry } from '../../types';
import { memorySourceHealthForEntry } from './memorySourceHealth';

export interface MemoryPromotionCandidate {
  entry: KnowledgeEntry;
  score: number;
  band: 'ready' | 'review' | 'emerging';
  reasons: string[];
  sourceCount: number;
  backlinkCount: number;
  needsSourceReview: boolean;
}

function isWikiKnowledgeEntry(entry: KnowledgeEntry): boolean {
  return entry.status === 'published' || entry.tags.some(tag => tag.toLowerCase() === 'wiki');
}

function confidenceScore(entry: KnowledgeEntry): number {
  if (entry.confidence === 'high') return 18;
  if (entry.confidence === 'medium') return 10;
  return 2;
}

function recencyScore(entry: KnowledgeEntry, nowMs: number): number {
  const parsed = Date.parse(entry.updatedAt || entry.createdAt || '');
  if (!Number.isFinite(parsed)) return 0;
  const days = Math.max(0, Math.floor((nowMs - parsed) / 86_400_000));
  if (days <= 1) return 14;
  if (days <= 7) return 10;
  if (days <= 30) return 5;
  return 0;
}

function sourceScore(entry: KnowledgeEntry): number {
  const health = memorySourceHealthForEntry(entry);
  let score = Math.min(24, health.totalSources * 7);
  score += Math.min(12, health.trackedSources * 4);
  if (health.sourceCounts.fresh > 0) score += 10;
  if (health.needsReview) score -= 14;
  if (health.worstState === 'missing' || health.worstState === 'unreadable') score -= 10;
  if (health.worstState === 'unlinked') score -= 8;
  return score;
}

function backlinkCount(entry: KnowledgeEntry): number {
  return entry.artifactRefs.length + entry.sourceRefs.filter(ref => ref.sessionId || ref.taskId || ref.outputId || ref.path || ref.url).length;
}

function tagsScore(entry: KnowledgeEntry): number {
  const tags = entry.tags.filter(tag => tag.trim() && tag.toLowerCase() !== 'wiki');
  return Math.min(10, tags.length * 3);
}

function bodyScore(entry: KnowledgeEntry): number {
  const length = `${entry.summary || ''}\n${entry.body || ''}`.trim().length;
  if (length >= 600) return 10;
  if (length >= 240) return 7;
  if (length >= 80) return 4;
  return 0;
}

function createdByScore(entry: KnowledgeEntry): number {
  if (entry.createdBy === 'agent') return 6;
  if (entry.createdBy === 'manual') return 4;
  return 2;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function candidateReasons(entry: KnowledgeEntry, candidate: Omit<MemoryPromotionCandidate, 'reasons'>): string[] {
  const reasons: string[] = [];
  if (candidate.needsSourceReview) reasons.push('source review needed');
  if (entry.confidence === 'high') reasons.push('high confidence');
  if (entry.confidence === 'medium') reasons.push('medium confidence');
  if (candidate.sourceCount > 0) reasons.push(`${candidate.sourceCount} source${candidate.sourceCount === 1 ? '' : 's'}`);
  if (candidate.backlinkCount > 0) reasons.push(`${candidate.backlinkCount} backlink${candidate.backlinkCount === 1 ? '' : 's'}`);
  if (entry.createdBy === 'agent') reasons.push('agent distilled');
  if (entry.createdBy === 'manual') reasons.push('manual signal');
  if (!reasons.length) reasons.push('emerging memory');
  return reasons.slice(0, 4);
}

export function scoreMemoryPromotionCandidate(entry: KnowledgeEntry, nowMs = Date.now()): MemoryPromotionCandidate | null {
  if (isWikiKnowledgeEntry(entry)) return null;
  const health = memorySourceHealthForEntry(entry);
  const sourceCount = health.totalSources;
  const links = backlinkCount(entry);
  const score = clampScore(
    18
    + confidenceScore(entry)
    + recencyScore(entry, nowMs)
    + sourceScore(entry)
    + Math.min(16, links * 5)
    + tagsScore(entry)
    + bodyScore(entry)
    + createdByScore(entry),
  );
  const band: MemoryPromotionCandidate['band'] = score >= 72 && !health.needsReview
    ? 'ready'
    : score >= 50
      ? 'review'
      : 'emerging';
  const base = {
    entry,
    score,
    band,
    sourceCount,
    backlinkCount: links,
    needsSourceReview: health.needsReview,
  };
  return {
    ...base,
    reasons: candidateReasons(entry, base),
  };
}

export function memoryPromotionCandidates(entries: KnowledgeEntry[], nowMs = Date.now()): MemoryPromotionCandidate[] {
  return entries
    .map(entry => scoreMemoryPromotionCandidate(entry, nowMs))
    .filter((item): item is MemoryPromotionCandidate => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.entry.updatedAt || b.entry.createdAt || '') - Date.parse(a.entry.updatedAt || a.entry.createdAt || '');
    });
}
