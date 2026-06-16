import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SkillMarkdownScanResult } from './skill-installer.js';

export type SkillQuarantineScope = 'global' | 'project';

export interface SkillQuarantineRecord {
  id: string;
  name: string;
  scope: SkillQuarantineScope;
  createdAt: string;
  verdict: 'blocked';
  warnings: SkillMarkdownScanResult['warnings'];
  reason: string;
  root: string;
  path: string;
  skillPath: string;
  metaPath: string;
  workdir?: string;
}

export interface SkillQuarantineListResult {
  records: SkillQuarantineRecord[];
}

export interface SkillQuarantineRemoveResult {
  ok: boolean;
  removed?: boolean;
  error?: string;
}

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.pikiclaw', 'skills');
const QUARANTINE_DIR_NAME = '.quarantine';

function projectSkillsDir(workdir: string): string {
  return path.join(workdir, '.pikiclaw', 'skills');
}

function quarantineRoot(opts: { global?: boolean; workdir?: string }): string {
  return path.join(opts.global ? GLOBAL_SKILLS_DIR : projectSkillsDir(opts.workdir!), QUARANTINE_DIR_NAME);
}

function safeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'skill';
}

function recordFromMeta(root: string, id: string, workdir?: string): SkillQuarantineRecord | null {
  const dir = path.join(root, id);
  const metaPath = path.join(dir, 'meta.json');
  const skillPath = path.join(dir, 'SKILL.md');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Partial<SkillQuarantineRecord>;
    const scope: SkillQuarantineScope = meta.scope === 'global' ? 'global' : 'project';
    return {
      id,
      name: String(meta.name || id),
      scope,
      createdAt: String(meta.createdAt || ''),
      verdict: 'blocked',
      warnings: Array.isArray(meta.warnings) ? meta.warnings as SkillMarkdownScanResult['warnings'] : [],
      reason: String(meta.reason || 'Blocked by Skill Guard'),
      root,
      path: dir,
      skillPath,
      metaPath,
      workdir: scope === 'project' ? String(meta.workdir || workdir || '') : undefined,
    };
  } catch {
    return null;
  }
}

function listQuarantineRoot(root: string, workdir?: string): SkillQuarantineRecord[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => recordFromMeta(root, entry.name, workdir))
      .filter((record): record is SkillQuarantineRecord => !!record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function quarantineSkillMarkdown(
  content: string,
  scan: SkillMarkdownScanResult,
  opts: { global?: boolean; workdir?: string },
): SkillQuarantineRecord {
  if (!opts.global && !opts.workdir) {
    throw new Error('workdir is required for project-scoped skill quarantine');
  }
  const scope: SkillQuarantineScope = opts.global ? 'global' : 'project';
  const root = quarantineRoot(opts);
  const createdAt = new Date().toISOString();
  const baseId = safeSegment(scan.name);
  let id = `${baseId}-${Date.now().toString(36)}`;
  let dir = path.join(root, id);
  let suffix = 2;
  while (fs.existsSync(dir)) {
    id = `${baseId}-${Date.now().toString(36)}-${suffix++}`;
    dir = path.join(root, id);
  }

  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, 'SKILL.md');
  const metaPath = path.join(dir, 'meta.json');
  const reason = scan.warnings.find(item => item.severity === 'danger')?.message || 'Blocked by Skill Guard';
  const record: SkillQuarantineRecord = {
    id,
    name: scan.name,
    scope,
    createdAt,
    verdict: 'blocked',
    warnings: scan.warnings,
    reason,
    root,
    path: dir,
    skillPath,
    metaPath,
    workdir: scope === 'project' ? opts.workdir : undefined,
  };
  fs.writeFileSync(skillPath, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
  fs.writeFileSync(metaPath, JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

export function listSkillQuarantine(workdir?: string): SkillQuarantineListResult {
  const records = [
    ...listQuarantineRoot(path.join(GLOBAL_SKILLS_DIR, QUARANTINE_DIR_NAME)),
    ...(workdir ? listQuarantineRoot(path.join(projectSkillsDir(workdir), QUARANTINE_DIR_NAME), workdir) : []),
  ];
  return { records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

export function removeSkillQuarantine(id: string, workdir?: string): SkillQuarantineRemoveResult {
  const cleanId = safeSegment(id);
  if (!cleanId || cleanId !== id) return { ok: false, error: 'invalid quarantine id' };
  const roots = [
    path.join(GLOBAL_SKILLS_DIR, QUARANTINE_DIR_NAME),
    ...(workdir ? [path.join(projectSkillsDir(workdir), QUARANTINE_DIR_NAME)] : []),
  ];
  for (const root of roots) {
    const target = path.join(root, cleanId);
    const resolvedRoot = path.resolve(root) + path.sep;
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(resolvedRoot)) continue;
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, removed: true };
  }
  return { ok: true, removed: false };
}
