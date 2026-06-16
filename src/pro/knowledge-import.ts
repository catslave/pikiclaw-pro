import fs from 'node:fs';
import path from 'node:path';
import {
  createKnowledgeEntry,
  listKnowledgeEntries,
  type KnowledgeEntry,
} from './workflow.js';
import { refreshKnowledgeEntrySources } from './knowledge-source-freshness.js';

export interface KnowledgeImportSkipped {
  path: string;
  reason: string;
}

export interface ProjectReferenceKnowledgeImportResult {
  imported: KnowledgeEntry[];
  skipped: KnowledgeImportSkipped[];
  scanned: number;
}

const MAX_IMPORT_FILES = 20;
const MAX_IMPORT_BYTES = 256_000;

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function summarizeReference(content: string, fallback: string): string {
  const line = content
    .split(/\r?\n/)
    .map(item => item.replace(/^#{1,6}\s+/, '').trim())
    .find(Boolean);
  return (line || fallback).slice(0, 1_000);
}

function titleFromReferenceName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base || name;
}

function existingReferencePaths(workdir: string): Set<string> {
  const paths = new Set<string>();
  for (const entry of listKnowledgeEntries({ workspace: workdir })) {
    for (const ref of entry.sourceRefs || []) {
      if (ref.type !== 'file' || !ref.path) continue;
      paths.add(path.resolve(ref.path));
    }
  }
  return paths;
}

export function importProjectReferencesAsKnowledge(input: {
  workdir: unknown;
  status?: unknown;
  maxFiles?: unknown;
}): ProjectReferenceKnowledgeImportResult {
  const workdir = typeof input.workdir === 'string' ? input.workdir.trim() : '';
  if (!workdir) throw new Error('workdir is required');

  const resolvedWorkdir = path.resolve(workdir);
  const referenceDir = path.join(resolvedWorkdir, '.pikiclaw', 'reference');
  const imported: KnowledgeEntry[] = [];
  const skipped: KnowledgeImportSkipped[] = [];
  const maxFiles = Math.max(1, Math.min(MAX_IMPORT_FILES, Number(input.maxFiles) || MAX_IMPORT_FILES));
  const status = input.status === 'published' ? 'published' : 'hidden';

  if (!fs.existsSync(referenceDir)) {
    return { imported, skipped, scanned: 0 };
  }

  const existing = existingReferencePaths(resolvedWorkdir);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(referenceDir, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    throw new Error(err?.message || 'failed to read project references');
  }

  let scanned = 0;
  for (const entry of entries) {
    if (imported.length >= maxFiles) break;
    const filePath = path.join(referenceDir, entry.name);
    scanned += 1;

    if (!isPathInside(referenceDir, filePath)) {
      skipped.push({ path: filePath, reason: 'outside reference pool' });
      continue;
    }
    if (!entry.isFile()) {
      skipped.push({ path: filePath, reason: 'not a file' });
      continue;
    }
    if (existing.has(path.resolve(filePath))) {
      skipped.push({ path: filePath, reason: 'already imported' });
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err: any) {
      skipped.push({ path: filePath, reason: err?.message || 'unreadable' });
      continue;
    }
    if (stat.size > MAX_IMPORT_BYTES) {
      skipped.push({ path: filePath, reason: `larger than ${MAX_IMPORT_BYTES} bytes` });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err: any) {
      skipped.push({ path: filePath, reason: err?.message || 'unreadable' });
      continue;
    }
    if (buffer.includes(0)) {
      skipped.push({ path: filePath, reason: 'binary file' });
      continue;
    }

    const body = buffer.toString('utf8').trim();
    if (!body) {
      skipped.push({ path: filePath, reason: 'empty file' });
      continue;
    }

    const title = titleFromReferenceName(entry.name);
    const created = createKnowledgeEntry({
      title,
      body,
      summary: summarizeReference(body, title),
      kind: 'knowledge-card',
      status,
      confidence: 'medium',
      createdBy: 'auto',
      tags: status === 'published'
        ? ['project-reference', 'imported', 'wiki']
        : ['project-reference', 'imported'],
      sourceRefs: [{
        type: 'file',
        workdir: resolvedWorkdir,
        path: filePath,
        title: entry.name,
      }],
    });
    existing.add(path.resolve(filePath));
    imported.push(refreshKnowledgeEntrySources(created.id, { acceptCurrent: true }).entry);
  }

  return { imported, skipped, scanned };
}
