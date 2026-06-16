import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getKnowledgeEntry,
  updateKnowledgeEntry,
  type KnowledgeEntry,
  type KnowledgeSourceFreshness,
  type KnowledgeSourceRef,
} from './workflow.js';

export interface KnowledgeSourceFreshnessCheck {
  index: number;
  type: KnowledgeSourceRef['type'];
  title: string;
  locator?: string;
  freshness: KnowledgeSourceFreshness;
  checkedAt: string;
  changed: boolean;
  size?: number;
  mtimeMs?: number;
  hash?: string;
  error?: string;
}

export interface KnowledgeSourceRefreshResult {
  entry: KnowledgeEntry;
  aggregate: KnowledgeSourceFreshness;
  checkedAt: string;
  checks: KnowledgeSourceFreshnessCheck[];
  supported: number;
  stale: number;
  missing: number;
  unreadable: number;
}

const MAX_HASH_BYTES = 1024 * 1024;

function resolveFileRefPath(ref: KnowledgeSourceRef): string {
  const raw = String(ref.path || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return path.resolve(raw);
  const workdir = String(ref.workdir || '').trim();
  return workdir ? path.resolve(workdir, raw) : path.resolve(raw);
}

function titleForRef(ref: KnowledgeSourceRef, index: number): string {
  return ref.title || ref.path || ref.url || ref.outputId || ref.sessionId || ref.taskId || `source ${index + 1}`;
}

function checksumFile(filePath: string, size: number): string | undefined {
  if (size > MAX_HASH_BYTES) return undefined;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function aggregateFreshness(checks: KnowledgeSourceFreshnessCheck[]): KnowledgeSourceFreshness {
  if (!checks.length) return 'unsupported';
  if (checks.some(check => check.freshness === 'missing')) return 'missing';
  if (checks.some(check => check.freshness === 'unreadable')) return 'unreadable';
  if (checks.some(check => check.freshness === 'stale')) return 'stale';
  if (checks.some(check => check.freshness === 'fresh')) return 'fresh';
  return 'unsupported';
}

function refreshFileRef(ref: KnowledgeSourceRef, index: number, checkedAt: string, acceptCurrent: boolean): {
  ref: KnowledgeSourceRef;
  check: KnowledgeSourceFreshnessCheck;
} {
  const filePath = resolveFileRefPath(ref);
  const baseCheck = {
    index,
    type: ref.type,
    title: titleForRef(ref, index),
    locator: filePath || ref.path,
    checkedAt,
  };

  if (!filePath) {
    const next = {
      ...ref,
      sourceFreshness: 'missing' as const,
      sourceCheckedAt: checkedAt,
      sourceError: 'file path is missing',
    };
    return {
      ref: next,
      check: { ...baseCheck, freshness: 'missing', changed: false, error: next.sourceError },
    };
  }

  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const next = {
        ...ref,
        sourceFreshness: 'unreadable' as const,
        sourceCheckedAt: checkedAt,
        sourceError: 'symlink sources are not read for freshness',
      };
      return {
        ref: next,
        check: { ...baseCheck, freshness: 'unreadable', changed: false, error: next.sourceError },
      };
    }
    if (!stat.isFile()) {
      const next = {
        ...ref,
        sourceFreshness: 'unreadable' as const,
        sourceCheckedAt: checkedAt,
        sourceError: 'source is not a file',
      };
      return {
        ref: next,
        check: { ...baseCheck, freshness: 'unreadable', changed: false, error: next.sourceError },
      };
    }

    const hash = checksumFile(filePath, stat.size);
    const previousHash = ref.sourceHash || undefined;
    const previousSize = ref.sourceSize;
    const previousMtimeMs = ref.sourceMtimeMs;
    const hasBaseline = Boolean(previousHash) || previousSize !== undefined || previousMtimeMs !== undefined;
    const changed = hasBaseline
      ? Boolean(
        (previousHash && hash && previousHash !== hash)
        || (previousSize !== undefined && previousSize !== stat.size)
        || (previousMtimeMs !== undefined && Math.round(previousMtimeMs) !== Math.round(stat.mtimeMs)),
      )
      : false;
    const acceptBaseline = acceptCurrent || !hasBaseline;
    const freshness: KnowledgeSourceFreshness = changed && !acceptCurrent ? 'stale' : 'fresh';
    const next: KnowledgeSourceRef = {
      ...ref,
      path: filePath,
      sourceFreshness: freshness,
      sourceCheckedAt: checkedAt,
      sourceCurrentHash: hash,
      sourceCurrentMtimeMs: stat.mtimeMs,
      sourceCurrentSize: stat.size,
      sourceError: undefined,
    };
    if (acceptBaseline) {
      next.sourceHash = hash;
      next.sourceMtimeMs = stat.mtimeMs;
      next.sourceSize = stat.size;
      next.sourceAcceptedAt = checkedAt;
    }
    return {
      ref: next,
      check: {
        ...baseCheck,
        freshness,
        changed: changed && !acceptCurrent,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash,
      },
    };
  } catch (err: any) {
    const missing = err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
    const next = {
      ...ref,
      sourceFreshness: missing ? 'missing' as const : 'unreadable' as const,
      sourceCheckedAt: checkedAt,
      sourceError: err?.message || (missing ? 'file not found' : 'file unreadable'),
    };
    return {
      ref: next,
      check: {
        ...baseCheck,
        freshness: next.sourceFreshness,
        changed: false,
        error: next.sourceError,
      },
    };
  }
}

export function refreshKnowledgeEntrySources(
  id: string,
  options: { acceptCurrent?: boolean; now?: Date } = {},
): KnowledgeSourceRefreshResult {
  const entry = getKnowledgeEntry(id);
  if (!entry) throw new Error('knowledge entry not found');
  const checkedAt = (options.now || new Date()).toISOString();
  const acceptCurrent = Boolean(options.acceptCurrent);
  const checks: KnowledgeSourceFreshnessCheck[] = [];
  const sourceRefs = entry.sourceRefs.map((ref, index) => {
    if (ref.type !== 'file') {
      checks.push({
        index,
        type: ref.type,
        title: titleForRef(ref, index),
        locator: ref.url || ref.path || ref.outputId || ref.sessionId || ref.taskId || ref.workdir,
        freshness: 'unsupported',
        checkedAt,
        changed: false,
      });
      return ref;
    }
    const refreshed = refreshFileRef(ref, index, checkedAt, acceptCurrent);
    checks.push(refreshed.check);
    return refreshed.ref;
  });
  const updated = updateKnowledgeEntry(entry.id, { sourceRefs });
  const aggregate = aggregateFreshness(checks);
  return {
    entry: updated,
    aggregate,
    checkedAt,
    checks,
    supported: checks.filter(check => check.type === 'file').length,
    stale: checks.filter(check => check.freshness === 'stale').length,
    missing: checks.filter(check => check.freshness === 'missing').length,
    unreadable: checks.filter(check => check.freshness === 'unreadable').length,
  };
}
