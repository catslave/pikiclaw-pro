/**
 * Skill installer — wrapper around `npx skills` CLI.
 *
 * Skills are installed via the community-standard `npx skills add` command.
 * Global skills go to ~/.pikiclaw/skills/, project skills to <workdir>/.pikiclaw/skills/.
 *
 * The upstream CLI doesn't recognize `pikiclaw` as an agent, so we install with
 * `--agent claude-code` (the driver pikiclaw runs by default) and rely on
 * ~/.claude/skills → ~/.pikiclaw/skills being symlinked to the same directory.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { initializeProjectSkills } from './skills.js';
import { listSkillQuarantine, quarantineSkillMarkdown, removeSkillQuarantine, type SkillQuarantineRecord } from './skill-quarantine.js';
import { scanSkillMarkdown, skillImportVerdict, type SkillImportVerdict, type SkillImportWarning } from './skill-safety.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInstallOpts {
  /** Install globally (all projects) or project-scoped. */
  global?: boolean;
  /** If the repo has multiple skills, install a specific one. */
  skill?: string;
  /** Project working directory (required for project-scoped installs). */
  workdir?: string;
}

export interface SkillInstallResult {
  ok: boolean;
  error?: string;
  output?: string;
}

export interface SkillRemoveResult {
  ok: boolean;
  error?: string;
}

export interface SkillMarkdownScanResult {
  name: string;
  label: string | null;
  description: string | null;
  detectedType: string | null;
  verdict: SkillImportVerdict;
  warnings: SkillImportWarning[];
}

export interface SkillMarkdownImportResult {
  ok: boolean;
  error?: string;
  needsReview?: boolean;
  blocked?: boolean;
  quarantined?: boolean;
  scan?: SkillMarkdownScanResult;
  quarantine?: SkillQuarantineRecord;
  name?: string;
  path?: string;
  output?: string;
}

export interface SkillQuarantineRestoreResult {
  ok: boolean;
  restored?: boolean;
  removed?: boolean;
  blocked?: boolean;
  name?: string;
  path?: string;
  scan?: SkillMarkdownScanResult;
  record?: SkillQuarantineRecord;
  error?: string;
}

export type SkillFolderImportEntryStatus = 'imported' | 'needs_review' | 'blocked' | 'skipped' | 'error';

export interface SkillFolderImportEntryResult {
  sourcePath: string;
  sourceName: string;
  name: string;
  status: SkillFolderImportEntryStatus;
  scan?: SkillMarkdownScanResult;
  path?: string;
  quarantine?: SkillQuarantineRecord;
  quarantined?: boolean;
  error?: string;
}

export interface SkillFolderImportResult {
  ok: boolean;
  sourcePath?: string;
  entries: SkillFolderImportEntryResult[];
  imported: number;
  needsReview: number;
  blocked: number;
  skipped: number;
  errors: number;
  quarantined: number;
  warnings: string[];
  error?: string;
}

export type SkillGitImportResult = SkillFolderImportResult;
export type SkillZipImportResult = SkillFolderImportResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.pikiclaw', 'skills');
const INSTALL_TIMEOUT_MS = 60_000;
const REMOVE_TIMEOUT_MS = 10_000;
const GIT_IMPORT_TIMEOUT_MS = 90_000;
const MAX_SKILL_MARKDOWN_CHARS = 300_000;
const MAX_SKILL_FOLDER_ENTRIES = 50;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024;
const GIT_URL_ALLOWLIST = [/^https:\/\//, /^git@[a-zA-Z0-9.-]+:/];
const ZIP_EXECUTABLE_REF_RE = /\.(\/scripts\/[^\s)'"]+|\/bin\/[^\s)'"]+)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make sure the global skills directory exists, and that the agent-specific
 * dirs that the upstream skills CLI writes to (`~/.claude/skills`,
 * `~/.agents/skills`) resolve back to it. This is what lets us install with
 * `--agent claude-code` and still read the results from `~/.pikiclaw/skills`.
 */
function ensureGlobalSkillsDir(): void {
  fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  for (const linkDir of [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
  ]) {
    try {
      const stat = fs.lstatSync(linkDir);
      if (stat.isSymbolicLink()) {
        const real = fs.realpathSync(linkDir);
        if (real === fs.realpathSync(GLOBAL_SKILLS_DIR)) continue;
      }
      // Existing dir/link doesn't match — leave it alone rather than destroy user data.
      continue;
    } catch {
      try {
        fs.mkdirSync(path.dirname(linkDir), { recursive: true });
        fs.symlinkSync(GLOBAL_SKILLS_DIR, linkDir, 'dir');
      } catch { /* best effort */ }
    }
  }
}

function runNpx(args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile('npx', args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
      });
    });
    // Prevent child from keeping parent alive
    child.unref?.();
  });
}

function runGitClone(url: string, destDir: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile('git', ['clone', '--depth', '1', '--', url, destDir], {
      timeout: GIT_IMPORT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      shell: false,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
      });
    });
    child.unref?.();
  });
}

function frontmatterValue(content: string, key: string): string | null {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fm[1].match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'));
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '').trim() || null;
}

function firstMarkdownHeading(content: string): string | null {
  return content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || null;
}

function slugifySkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function validateSkillName(name: string): boolean {
  return /^[a-zA-Z0-9._-]{1,80}$/.test(name)
    && name !== '.'
    && name !== '..'
    && path.basename(name) === name;
}

export function isAllowedSkillGitUrl(url: string): boolean {
  return GIT_URL_ALLOWLIST.some(pattern => pattern.test(url.trim()));
}

function resolveContainedZipEntry(baseDir: string, entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.split('/').some(segment => segment === '..')) return null;
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function isZipSymlink(entry: JSZip.JSZipObject): boolean {
  const unixPermissions = typeof entry.unixPermissions === 'number'
    ? entry.unixPermissions
    : undefined;
  return unixPermissions !== undefined && (unixPermissions & 0o170000) === 0o120000;
}

function zipEntryName(entry: JSZip.JSZipObject): string {
  const unsafeOriginalName = (entry as any).unsafeOriginalName;
  return typeof unsafeOriginalName === 'string' && unsafeOriginalName.trim()
    ? unsafeOriginalName
    : entry.name;
}

function zipEntryBaseName(entry: JSZip.JSZipObject): string {
  const normalized = zipEntryName(entry).replace(/\\/g, '/');
  return normalized.split('/').pop() || '';
}

export function previewSkillMarkdownImport(content: string, preferredName?: string): SkillMarkdownScanResult {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('content is required');
  if (trimmed.length > MAX_SKILL_MARKDOWN_CHARS) throw new Error('SKILL.md is too large');
  const declaredType = (frontmatterValue(trimmed, 'type') || frontmatterValue(trimmed, 'kind') || '').toLowerCase() || null;
  const rawName = preferredName?.trim()
    || frontmatterValue(trimmed, 'name')
    || frontmatterValue(trimmed, 'id')
    || firstMarkdownHeading(trimmed)
    || '';
  const name = validateSkillName(rawName) ? rawName : slugifySkillName(rawName);
  if (!validateSkillName(name)) throw new Error('valid skill name is required');
  const label = frontmatterValue(trimmed, 'label') || frontmatterValue(trimmed, 'title') || firstMarkdownHeading(trimmed);
  const description = frontmatterValue(trimmed, 'description') || frontmatterValue(trimmed, 'summary');
  const warnings = scanSkillMarkdown(trimmed);
  if (declaredType && declaredType !== 'skill' && declaredType !== 'capability') {
    warnings.unshift({
      severity: 'danger',
      message: `This file declares type: ${declaredType}; import it from the matching Assistant or Workflow library.`,
    });
  }
  return { name, label, description, detectedType: declaredType, verdict: skillImportVerdict(warnings), warnings };
}

export function importSkillMarkdown(
  content: string,
  opts: { global?: boolean; workdir?: string; name?: string; confirmed?: boolean; overwrite?: boolean } = {},
): SkillMarkdownImportResult {
  let scan: SkillMarkdownScanResult;
  try {
    scan = previewSkillMarkdownImport(content, opts.name);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invalid SKILL.md' };
  }

  if (scan.detectedType && scan.detectedType !== 'skill' && scan.detectedType !== 'capability') {
    return { ok: false, blocked: true, error: scan.warnings[0]?.message || 'unsupported skill type', scan };
  }
  if (!opts.global && !opts.workdir) {
    return { ok: false, error: 'workdir is required for project-scoped skill import', scan };
  }
  if (scan.verdict === 'blocked') {
    try {
      const quarantine = quarantineSkillMarkdown(content, scan, { global: opts.global, workdir: opts.workdir });
      return {
        ok: false,
        blocked: true,
        quarantined: true,
        error: 'blocked by skill import safety review',
        scan,
        quarantine,
      };
    } catch (e: any) {
      return { ok: false, blocked: true, error: e?.message || 'blocked by skill import safety review', scan };
    }
  }
  if (scan.verdict === 'review' && !opts.confirmed) {
    return { ok: false, needsReview: true, scan, error: 'review required before importing this skill' };
  }
  if (opts.global) ensureGlobalSkillsDir();
  else initializeProjectSkills(opts.workdir!);

  const parent = opts.global ? GLOBAL_SKILLS_DIR : path.join(opts.workdir!, '.pikiclaw', 'skills');
  const dir = path.join(parent, scan.name);
  const file = path.join(dir, 'SKILL.md');
  const resolvedParent = path.resolve(parent) + path.sep;
  const resolvedFile = path.resolve(file);
  if (!resolvedFile.startsWith(resolvedParent)) {
    return { ok: false, error: 'invalid skill path', scan };
  }
  if (fs.existsSync(file) && !opts.overwrite) {
    return { ok: false, error: `skill "${scan.name}" already exists`, scan };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const body = content.endsWith('\n') ? content : `${content}\n`;
    fs.writeFileSync(file, body, 'utf-8');
    return { ok: true, scan, name: scan.name, path: file, output: `imported ${scan.name} to ${file}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'skill import failed', scan };
  }
}

export function restoreSkillQuarantine(
  id: string,
  opts: { workdir?: string; overwrite?: boolean } = {},
): SkillQuarantineRestoreResult {
  const cleanId = id.trim();
  if (!cleanId) return { ok: false, error: 'id is required' };
  const record = listSkillQuarantine(opts.workdir).records.find(item => item.id === cleanId);
  if (!record) return { ok: false, error: 'quarantined skill not found' };

  let content = '';
  try {
    content = fs.readFileSync(record.skillPath, 'utf-8');
  } catch (e: any) {
    return { ok: false, record, error: e?.message || 'failed to read quarantined SKILL.md' };
  }

  let scan: SkillMarkdownScanResult;
  try {
    scan = previewSkillMarkdownImport(content, record.name);
  } catch (e: any) {
    return { ok: false, record, error: e?.message || 'invalid quarantined SKILL.md' };
  }
  if (scan.detectedType && scan.detectedType !== 'skill' && scan.detectedType !== 'capability') {
    return {
      ok: false,
      blocked: true,
      record,
      scan,
      error: scan.warnings[0]?.message || 'unsupported skill type',
    };
  }
  if (scan.verdict === 'blocked') {
    return {
      ok: false,
      blocked: true,
      record,
      scan,
      error: 'still blocked by skill import safety review',
    };
  }

  const result = importSkillMarkdown(content, {
    global: record.scope === 'global',
    workdir: record.scope === 'project' ? (record.workdir || opts.workdir) : undefined,
    name: scan.name,
    confirmed: true,
    overwrite: opts.overwrite,
  });
  if (!result.ok) {
    return {
      ok: false,
      record,
      scan: result.scan || scan,
      error: result.error || 'failed to restore quarantined skill',
    };
  }

  const removed = removeSkillQuarantine(record.id, record.workdir || opts.workdir);
  if (!removed.ok) {
    return {
      ok: false,
      restored: true,
      record,
      scan,
      name: result.name,
      path: result.path,
      error: removed.error || 'skill restored, but failed to remove quarantine record',
    };
  }
  return {
    ok: true,
    restored: true,
    removed: removed.removed,
    record,
    scan,
    name: result.name,
    path: result.path,
  };
}

function discoverSkillMarkdownFiles(srcPath: string): Array<{ sourcePath: string; sourceName: string }> {
  const stat = fs.lstatSync(srcPath);
  if (stat.isSymbolicLink()) throw new Error(`Rejected: source path is a symlink - ${srcPath}`);
  if (!stat.isDirectory()) throw new Error(`Rejected: source path is not a directory - ${srcPath}`);

  const rootSkill = path.join(srcPath, 'SKILL.md');
  if (fs.existsSync(rootSkill)) {
    const skillStat = fs.lstatSync(rootSkill);
    if (skillStat.isSymbolicLink()) throw new Error(`Rejected: source folder contains a symlink - ${rootSkill}`);
    return [{ sourcePath: rootSkill, sourceName: path.basename(srcPath) }];
  }

  const discovered: Array<{ sourcePath: string; sourceName: string }> = [];
  for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const childDir = path.join(srcPath, entry.name);
    const childStat = fs.lstatSync(childDir);
    if (childStat.isSymbolicLink()) throw new Error(`Rejected: source folder contains a symlink - ${childDir}`);
    if (!childStat.isDirectory()) continue;
    const skillPath = path.join(childDir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const skillStat = fs.lstatSync(skillPath);
    if (skillStat.isSymbolicLink()) throw new Error(`Rejected: source folder contains a symlink - ${skillPath}`);
    discovered.push({ sourcePath: skillPath, sourceName: entry.name });
    if (discovered.length > MAX_SKILL_FOLDER_ENTRIES) {
      throw new Error(`Rejected: folder contains more than ${MAX_SKILL_FOLDER_ENTRIES} skills`);
    }
  }
  return discovered.sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function summarizeFolderEntries(
  sourcePath: string,
  entries: SkillFolderImportEntryResult[],
  warnings: string[] = [],
  error?: string,
): SkillFolderImportResult {
  return {
    ok: !error && entries.every(entry => entry.status !== 'error'),
    sourcePath,
    entries,
    imported: entries.filter(entry => entry.status === 'imported').length,
    needsReview: entries.filter(entry => entry.status === 'needs_review').length,
    blocked: entries.filter(entry => entry.status === 'blocked').length,
    skipped: entries.filter(entry => entry.status === 'skipped').length,
    errors: entries.filter(entry => entry.status === 'error').length,
    quarantined: entries.filter(entry => entry.quarantined).length,
    warnings,
    error,
  };
}

export function importSkillFolder(
  srcPath: string,
  opts: {
    global?: boolean;
    workdir?: string;
    overwrite?: boolean;
    includeClean?: boolean;
    includeReview?: boolean;
    quarantineBlocked?: boolean;
    selectedReviewNames?: string[];
  } = {},
): SkillFolderImportResult {
  const sourcePath = srcPath.trim();
  if (!sourcePath) return summarizeFolderEntries(sourcePath, [], [], 'source path is required');
  if (!path.isAbsolute(sourcePath)) return summarizeFolderEntries(sourcePath, [], [], 'source path must be absolute');
  if (!opts.global && !opts.workdir) {
    return summarizeFolderEntries(sourcePath, [], [], 'workdir is required for project-scoped skill import');
  }

  let discovered: Array<{ sourcePath: string; sourceName: string }>;
  try {
    discovered = discoverSkillMarkdownFiles(sourcePath);
  } catch (e: any) {
    return summarizeFolderEntries(sourcePath, [], [], e?.message || 'failed to scan skill folder');
  }
  if (!discovered.length) {
    return summarizeFolderEntries(sourcePath, [], [], 'no SKILL.md files found in folder');
  }

  const includeClean = opts.includeClean !== false;
  const includeReview = opts.includeReview === true;
  const quarantineBlocked = opts.quarantineBlocked !== false;
  const selectedReviewNames = Array.isArray(opts.selectedReviewNames)
    ? new Set(opts.selectedReviewNames.map(name => name.trim().toLowerCase()).filter(Boolean))
    : null;
  const warnings: string[] = [];
  const entries: SkillFolderImportEntryResult[] = [];

  for (const item of discovered) {
    let content = '';
    try {
      content = fs.readFileSync(item.sourcePath, 'utf-8');
      const scan = previewSkillMarkdownImport(content, item.sourceName);
      const base: SkillFolderImportEntryResult = {
        sourcePath: item.sourcePath,
        sourceName: item.sourceName,
        name: scan.name,
        status: 'skipped',
        scan,
      };

      if (scan.detectedType && scan.detectedType !== 'skill' && scan.detectedType !== 'capability') {
        entries.push({
          ...base,
          status: 'error',
          error: scan.warnings[0]?.message || 'unsupported skill type',
        });
        continue;
      }

      if (scan.verdict === 'blocked') {
        if (!quarantineBlocked) {
          entries.push({
            ...base,
            status: 'blocked',
            error: 'blocked by skill import safety review',
          });
          continue;
        }
        const result = importSkillMarkdown(content, {
          global: opts.global,
          workdir: opts.workdir,
          name: scan.name,
          confirmed: true,
          overwrite: opts.overwrite,
        });
        entries.push({
          ...base,
          status: 'blocked',
          quarantine: result.quarantine,
          quarantined: !!result.quarantined,
          error: result.error || 'blocked by skill import safety review',
        });
        continue;
      }

      if (scan.verdict === 'review' && !includeReview) {
        entries.push({
          ...base,
          status: 'needs_review',
          error: 'review required before importing this skill',
        });
        continue;
      }
      if (scan.verdict === 'review' && selectedReviewNames && !selectedReviewNames.has(scan.name.toLowerCase())) {
        entries.push({
          ...base,
          status: 'skipped',
          error: 'review entry not selected',
        });
        continue;
      }
      if (scan.verdict === 'clean' && !includeClean) {
        entries.push({
          ...base,
          status: 'skipped',
          error: 'clean import not requested',
        });
        continue;
      }

      const result = importSkillMarkdown(content, {
        global: opts.global,
        workdir: opts.workdir,
        name: scan.name,
        confirmed: scan.verdict === 'review',
        overwrite: opts.overwrite,
      });
      if (result.ok) {
        entries.push({
          ...base,
          status: 'imported',
          path: result.path,
        });
      } else if (result.error?.includes('already exists')) {
        entries.push({
          ...base,
          status: 'skipped',
          error: result.error,
        });
      } else {
        entries.push({
          ...base,
          status: result.needsReview ? 'needs_review' : 'error',
          error: result.error || 'skill import failed',
        });
      }
    } catch (e: any) {
      entries.push({
        sourcePath: item.sourcePath,
        sourceName: item.sourceName,
        name: item.sourceName,
        status: 'error',
        error: e?.message || 'skill import failed',
      });
    }
  }

  if (entries.length >= MAX_SKILL_FOLDER_ENTRIES) {
    warnings.push(`Only the first ${MAX_SKILL_FOLDER_ENTRIES} skills were scanned.`);
  }
  return summarizeFolderEntries(sourcePath, entries, warnings);
}

export async function importSkillGit(
  url: string,
  opts: {
    global?: boolean;
    workdir?: string;
    overwrite?: boolean;
    includeClean?: boolean;
    includeReview?: boolean;
    quarantineBlocked?: boolean;
    selectedReviewNames?: string[];
  } = {},
): Promise<SkillGitImportResult> {
  const sourceUrl = url.trim();
  if (!sourceUrl) return summarizeFolderEntries(sourceUrl, [], [], 'git URL is required');
  if (!isAllowedSkillGitUrl(sourceUrl)) {
    return summarizeFolderEntries(sourceUrl, [], [], `Rejected: git URL uses a disallowed scheme - ${sourceUrl}`);
  }
  if (!opts.global && !opts.workdir) {
    return summarizeFolderEntries(sourceUrl, [], [], 'workdir is required for project-scoped skill import');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-skill-git-'));
  try {
    const clone = await runGitClone(sourceUrl, tmpDir);
    if (!clone.ok) {
      const error = clone.stderr.trim().split('\n').pop()?.trim() || 'git clone failed';
      return summarizeFolderEntries(sourceUrl, [], [], error);
    }
    const result = importSkillFolder(tmpDir, opts);
    return { ...result, sourcePath: sourceUrl };
  } catch (e: any) {
    return summarizeFolderEntries(sourceUrl, [], [], e?.message || 'git import failed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function importSkillZip(
  zipPath: string,
  opts: {
    global?: boolean;
    workdir?: string;
    overwrite?: boolean;
    includeClean?: boolean;
    includeReview?: boolean;
    quarantineBlocked?: boolean;
    selectedReviewNames?: string[];
  } = {},
): Promise<SkillZipImportResult> {
  const sourcePath = zipPath.trim();
  if (!sourcePath) return summarizeFolderEntries(sourcePath, [], [], 'zip path is required');
  if (!path.isAbsolute(sourcePath)) return summarizeFolderEntries(sourcePath, [], [], 'zip path must be absolute');
  if (!opts.global && !opts.workdir) {
    return summarizeFolderEntries(sourcePath, [], [], 'workdir is required for project-scoped skill import');
  }

  try {
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) return summarizeFolderEntries(sourcePath, [], [], `Rejected: source zip is a symlink - ${sourcePath}`);
    if (!stat.isFile()) return summarizeFolderEntries(sourcePath, [], [], `Rejected: source path is not a file - ${sourcePath}`);
  } catch (e: any) {
    return summarizeFolderEntries(sourcePath, [], [], e?.message || 'failed to read zip file');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-skill-zip-'));
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
    const files = Object.values(zip.files).filter(entry => !entry.dir);
    const skillEntries = files.filter(entry => !isZipSymlink(entry) && zipEntryBaseName(entry) === 'SKILL.md');
    if (skillEntries.length > 1) {
      return summarizeFolderEntries(
        sourcePath,
        [],
        [],
        `Rejected: zip contains ${skillEntries.length} SKILL.md files. Import a single skill per zip, or use the folder import for bundles.`,
      );
    }

    let totalBytes = 0;
    let skillBody: string | null = null;
    let skillEntryNameForInstall = '';
    const warnings: string[] = [];
    for (const entry of files) {
      const entryName = zipEntryName(entry);
      if (isZipSymlink(entry)) {
        return summarizeFolderEntries(sourcePath, [], [], `Rejected: zip contains a symlink entry - ${entryName}`);
      }
      if (resolveContainedZipEntry(tmpDir, entryName) === null) {
        return summarizeFolderEntries(sourcePath, [], [], `Rejected: zip entry escapes extraction dir - ${entryName}`);
      }
      const declaredSize = (entry as any)._data?.uncompressedSize;
      if (typeof declaredSize === 'number' && declaredSize > MAX_ZIP_ENTRY_BYTES) {
        return summarizeFolderEntries(sourcePath, [], [], `Rejected: zip entry exceeds size cap - ${entryName}`);
      }
      if (!entryName.toLowerCase().endsWith('.md')) continue;

      const data = Buffer.from(await entry.async('arraybuffer'));
      if (data.length > MAX_ZIP_ENTRY_BYTES) {
        return summarizeFolderEntries(sourcePath, [], [], `Rejected: zip entry exceeds size cap - ${entryName}`);
      }
      totalBytes += data.length;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        return summarizeFolderEntries(sourcePath, [], [], 'Rejected: zip total decompressed size exceeds cap');
      }
      const text = data.toString('utf-8');
      if (ZIP_EXECUTABLE_REF_RE.test(text)) {
        warnings.push(`Warning: ${entryName} references a relative executable path`);
      }
      if (zipEntryBaseName(entry) === 'SKILL.md') {
        skillBody = text;
        skillEntryNameForInstall = entryName;
      }
    }

    if (!skillBody) {
      return summarizeFolderEntries(sourcePath, [], warnings, 'no SKILL.md files found in zip');
    }
    let preview: SkillMarkdownScanResult;
    try {
      preview = previewSkillMarkdownImport(skillBody);
    } catch (e: any) {
      return summarizeFolderEntries(sourcePath, [], warnings, e?.message || 'invalid SKILL.md');
    }
    const extractedSkillDir = path.join(tmpDir, preview.name);
    fs.mkdirSync(extractedSkillDir, { recursive: true });
    fs.writeFileSync(path.join(extractedSkillDir, 'SKILL.md'), skillBody.endsWith('\n') ? skillBody : `${skillBody}\n`, 'utf-8');
    const result = importSkillFolder(tmpDir, opts);
    const sourceHint = skillEntryNameForInstall ? [`Imported ZIP skill entry: ${skillEntryNameForInstall}`] : [];
    return { ...result, sourcePath, warnings: [...result.warnings, ...warnings, ...sourceHint] };
  } catch (e: any) {
    return summarizeFolderEntries(sourcePath, [], [], e?.message || 'zip import failed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Install a skill from a source (GitHub owner/repo, URL, or local path).
 *
 * Uses `npx skills add <source>` with appropriate flags.
 */
export async function installSkill(source: string, opts: SkillInstallOpts = {}): Promise<SkillInstallResult> {
  const { global: isGlobal, skill, workdir } = opts;

  if (!isGlobal && !workdir) {
    return { ok: false, error: 'workdir is required for project-scoped skill installation' };
  }

  const cwd = isGlobal ? os.homedir() : workdir!;
  const args = ['-y', 'skills', 'add', source, '--yes', '--agent', 'claude-code'];

  if (isGlobal) {
    args.push('-g');
    ensureGlobalSkillsDir();
  }

  if (skill) {
    args.push('-s', skill);
  }

  const result = await runNpx(args, cwd, INSTALL_TIMEOUT_MS);

  if (!result.ok) {
    const errorMsg = result.stderr.trim().split('\n').pop()?.trim() || 'installation failed';
    return { ok: false, error: errorMsg, output: result.stdout + result.stderr };
  }

  return { ok: true, output: result.stdout };
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove an installed skill by name.
 * Deletes the skill directory from the appropriate location.
 */
export function removeSkill(skillName: string, opts: { global?: boolean; workdir?: string } = {}): SkillRemoveResult {
  const { global: isGlobal, workdir } = opts;

  if (!isGlobal && !workdir) {
    return { ok: false, error: 'workdir is required for project-scoped skill removal' };
  }

  // Security: prevent path traversal — skill name must be a plain directory name
  const sanitized = path.basename(skillName);
  if (!sanitized || sanitized === '.' || sanitized === '..' || sanitized !== skillName) {
    return { ok: false, error: 'invalid skill name' };
  }

  const parentDir = isGlobal
    ? GLOBAL_SKILLS_DIR
    : path.join(workdir!, '.pikiclaw', 'skills');
  const skillDir = path.join(parentDir, sanitized);

  // Double-check the resolved path is inside the expected parent
  const realParent = path.resolve(parentDir);
  const realSkill = path.resolve(skillDir);
  if (!realSkill.startsWith(realParent + path.sep)) {
    return { ok: false, error: 'invalid skill path' };
  }

  try {
    if (!fs.existsSync(skillDir)) {
      return { ok: false, error: `skill "${sanitized}" not found` };
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'removal failed' };
  }
}

// ---------------------------------------------------------------------------
// List installed (enhanced)
// ---------------------------------------------------------------------------

export function getGlobalSkillsDir(): string {
  return GLOBAL_SKILLS_DIR;
}

// ---------------------------------------------------------------------------
// Check for updates
// ---------------------------------------------------------------------------

export async function checkSkillUpdates(opts: { global?: boolean; workdir?: string } = {}): Promise<SkillInstallResult> {
  const cwd = opts.global ? os.homedir() : (opts.workdir || process.cwd());
  const args = ['-y', 'skills', 'check'];
  if (opts.global) args.push('-g');
  return runNpx(args, cwd, INSTALL_TIMEOUT_MS).then(r => ({
    ok: r.ok,
    output: r.stdout,
    error: r.ok ? undefined : r.stderr,
  }));
}
