/**
 * Project skill discovery from .pikiclaw/skills and .claude/commands.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig, saveUserConfig } from '../core/config/user-config.js';
import { scanSkillSecurity, type SkillSecurityReport } from './skill-safety.js';

export type SkillScope = 'global' | 'project';

export interface SkillInfo {
  name: string;
  label: string | null;
  description: string | null;
  source: 'skills';
  /** Whether this skill is global (all workspaces) or project-scoped. */
  scope: SkillScope;
  /** Absolute path to the skill definition when it can be read locally. */
  path?: string;
  /** Optional category declared in SKILL.md frontmatter. */
  category?: string | null;
  /** Optional search tags declared in SKILL.md frontmatter. */
  tags?: string[];
  /** Lightweight Skill Guard report for library health and filtering. */
  security?: SkillSecurityReport;
  /** MCP server packages required by this skill. */
  mcpRequires?: string[];
  /** Whether this skill is surfaced as an always-at-hand reference in chats. */
  pinned?: boolean;
}

export interface SkillListResult {
  skills: SkillInfo[];
  workdir: string;
}

export interface PinnedSkillListResult {
  skills: SkillInfo[];
  global: string[];
  project: string[];
  workdir: string;
}

export interface SkillPinResult {
  ok: boolean;
  name?: string;
  pinned?: boolean;
  scope?: SkillScope;
  error?: string;
}

export interface RetrievedSkillInfo {
  skill: SkillInfo;
  score: number;
  matchedTerms: number;
}

export interface ProjectSkillPaths {
  sharedSkillFile: string | null;
  claudeSkillFile: string | null;
  agentsSkillFile: string | null;
}

interface ProjectSkillRoots {
  canonicalRoot: string;
  claudeRoot: string;
  agentsRoot: string;
}

function resolveProjectSkillRoots(workdir: string): ProjectSkillRoots {
  return {
    canonicalRoot: path.join(workdir, '.pikiclaw', 'skills'),
    claudeRoot: path.join(workdir, '.claude', 'skills'),
    agentsRoot: path.join(workdir, '.agents', 'skills'),
  };
}

function normalizePinnedName(value: string): string {
  return value.trim().toLowerCase();
}

function validSkillName(value: string): boolean {
  return /^[a-zA-Z0-9._-]{1,80}$/.test(value)
    && value !== '.'
    && value !== '..'
    && path.basename(value) === value;
}

function workspacePinKey(workdir: string): string {
  return path.resolve(workdir);
}

function normalizedPinnedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    const key = normalizePinnedName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function pinnedNamesForWorkdir(workdir: string): { global: string[]; project: string[]; set: Set<string> } {
  const config = loadUserConfig();
  const skillsConfig = config.extensions?.skills || {};
  const global = normalizedPinnedList(skillsConfig.pinnedGlobal);
  const project = normalizedPinnedList(skillsConfig.pinnedByWorkspace?.[workspacePinKey(workdir)]);
  return {
    global,
    project,
    set: new Set([...global, ...project].map(normalizePinnedName)),
  };
}

function withPinnedState(workdir: string, skills: SkillInfo[]): SkillInfo[] {
  const pinned = pinnedNamesForWorkdir(workdir).set;
  return skills.map(skill => ({
    ...skill,
    pinned: pinned.has(normalizePinnedName(skill.name)),
  }));
}

function resolveSkillFile(root: string, skillName: string): string {
  return path.join(root, skillName, 'SKILL.md');
}

function parseFrontmatterList(frontmatter: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inline = frontmatter.match(new RegExp(`^${escaped}:\\s*\\[(.*?)\\]\\s*$`, 'im'));
  if (inline) {
    return inline[1]
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, '').trim())
      .filter(Boolean);
  }
  const block = frontmatter.match(new RegExp(`^${escaped}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'im'));
  if (!block) return [];
  return block[1]
    .split('\n')
    .map(item => item.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function parseSkillMeta(content: string): { label: string | null; description: string | null; category?: string | null; tags?: string[]; mcpRequires?: string[] } {
  let label: string | null = null;
  let description: string | null = null;
  let category: string | null = null;
  let tags: string[] | undefined;
  let mcpRequires: string[] | undefined;
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const lm = fm[1].match(/^label:\s*(.+)/m);
    if (lm) label = lm[1].trim();
    const dm = fm[1].match(/^description:\s*(.+)/m);
    if (dm) description = dm[1].trim();
    const cm = fm[1].match(/^category:\s*(.+)/m);
    if (cm) category = cm[1].trim().replace(/^['"]|['"]$/g, '').trim() || null;
    tags = [
      ...parseFrontmatterList(fm[1], 'tags'),
      ...parseFrontmatterList(fm[1], 'keywords'),
    ];
    // Parse mcp_requires as YAML list
    const mr = fm[1].match(/^mcp_requires:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (mr) {
      mcpRequires = mr[1]
        .split('\n')
        .map(l => l.replace(/^\s*-\s*/, '').replace(/["']/g, '').trim())
        .filter(Boolean);
    }
  }
  if (!label) {
    const hm = content.match(/^#\s+(.+)$/m);
    if (hm) label = hm[1].trim();
  }
  return { label, description, category, tags, mcpRequires };
}

function hasFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function hasDir(dirPath: string): boolean {
  try { return fs.statSync(dirPath).isDirectory(); } catch { return false; }
}

function readSortedDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function listRelativeFiles(dirPath: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readSortedDir(dirPath)) {
    const abs = path.join(dirPath, entry);
    const rel = prefix ? path.join(prefix, entry) : entry;
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isDirectory()) files.push(...listRelativeFiles(abs, rel));
    else if (stat.isFile()) files.push(rel);
  }
  return files;
}

function realPathOrNull(filePath: string): string | null {
  try { return fs.realpathSync(filePath); } catch { return null; }
}

function ensureDirSymlink(linkPath: string, targetDir: string) {
  const desiredTarget = path.relative(path.dirname(linkPath), targetDir) || '.';
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(linkPath);
      const currentReal = realPathOrNull(path.resolve(path.dirname(linkPath), currentTarget));
      const desiredReal = realPathOrNull(targetDir);
      if (currentTarget === desiredTarget || (currentReal && desiredReal && currentReal === desiredReal)) return;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(desiredTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function copyMergedTree(
  sourceRoot: string,
  targetRoot: string,
  opts: { log?: (message: string) => void } = {},
) {
  for (const relPath of listRelativeFiles(sourceRoot)) {
    const sourcePath = path.join(sourceRoot, relPath);
    const targetPath = path.join(targetRoot, relPath);
    if (hasFile(targetPath)) {
      opts.log?.(`skills merge skipped existing file: ${relPath}`);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

export function initializeProjectSkills(workdir: string, opts: { log?: (message: string) => void } = {}): void {
  const { canonicalRoot, claudeRoot, agentsRoot } = resolveProjectSkillRoots(workdir);
  fs.mkdirSync(canonicalRoot, { recursive: true });
  const canonicalReal = realPathOrNull(canonicalRoot);

  for (const legacyRoot of [claudeRoot, agentsRoot]) {
    if (!hasDir(legacyRoot)) continue;
    const legacyReal = realPathOrNull(legacyRoot);
    if (legacyReal && canonicalReal && legacyReal === canonicalReal) continue;
    copyMergedTree(legacyRoot, canonicalRoot, opts);
  }

  for (const linkRoot of [claudeRoot, agentsRoot]) {
    ensureDirSymlink(linkRoot, canonicalRoot);
  }
  opts.log?.(`skills merged into .pikiclaw/skills and linked to .claude/.agents workdir=${workdir}`);
}

export function getProjectSkillPaths(workdir: string, skillName: string): ProjectSkillPaths {
  const { canonicalRoot, claudeRoot, agentsRoot } = resolveProjectSkillRoots(workdir);
  const sharedSkillFile = resolveSkillFile(canonicalRoot, skillName);
  const agentsSkillFile = resolveSkillFile(agentsRoot, skillName);
  const claudeSkillFile = resolveSkillFile(claudeRoot, skillName);
  return {
    sharedSkillFile: hasFile(sharedSkillFile) ? sharedSkillFile : null,
    agentsSkillFile: hasFile(agentsSkillFile) ? agentsSkillFile : null,
    claudeSkillFile: hasFile(claudeSkillFile) ? claudeSkillFile : null,
  };
}

// Matches the canonical prompt produced by `resolveSkillPrompt` (bot/commands)
// and `resolveSkillFromPrompt` (dashboard/session-control). Both build the same
// shape: `[Project directory: <wd>]\n\nRead the skill definition at \`<path>\`
// and execute the instructions defined there.[ Additional context: <args>]`.
//
// Whitespace between the segments is tolerant (`\s+`) so the regex still
// matches after the claude driver collapses interior `\s+` to single spaces
// when surfacing user text in `getClaudeSessionMessages`.
const SKILL_PROMPT_RE = /^\[Project directory: [^\]\n]+?\]\s+Read the skill definition at `([^`\n]+)` and execute the instructions defined there\.(?:\s+Additional context:\s+([\s\S]+?))?\s*$/;

/**
 * Inverse of `resolveSkillPrompt`. When a stored user message matches the
 * canonical skill-execution expansion, return the original `/skillname [args]`
 * shorthand for display. Returns null when the text isn't a recognized skill
 * prompt — callers should fall back to the raw text.
 *
 * The expanded form is what the agent CLI actually consumed and what gets
 * persisted to its session log; this collapse exists purely so the dashboard
 * (and other display surfaces) can render the slash command the user typed.
 */
export function collapseSkillPrompt(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = SKILL_PROMPT_RE.exec(text);
  if (!m) return null;
  // Skill files are always at `<root>/<skillName>/SKILL.md`. Split on both
  // `/` and `\` so Windows-generated paths (path.join) resolve correctly.
  const segments = m[1].split(/[/\\]/).filter(Boolean);
  if (segments.length < 2 || segments[segments.length - 1] !== 'SKILL.md') return null;
  const name = segments[segments.length - 2];
  if (!name) return null;
  const args = (m[2] || '').trim();
  return args ? `/${name} ${args}` : `/${name}`;
}

const GLOBAL_SKILLS_ROOT = path.join(os.homedir(), '.pikiclaw', 'skills');

function discoverSkillsFromDir(
  dir: string,
  scope: SkillScope,
  seen: Set<string>,
): SkillInfo[] {
  const skills: SkillInfo[] = [];
  for (const entry of readSortedDir(dir)) {
    if (!entry || seen.has(entry)) continue;
    const skillDir = path.join(dir, entry);
    const skillFile = resolveSkillFile(dir, entry);
    try { if (!fs.statSync(skillDir).isDirectory()) continue; } catch { continue; }
    if (!hasFile(skillFile)) continue;
    let meta: ReturnType<typeof parseSkillMeta> = { label: null, description: null, category: null };
    let security: SkillSecurityReport = { verdict: 'unscanned', warnings: [] };
    try {
      const content = fs.readFileSync(skillFile, 'utf-8');
      meta = parseSkillMeta(content);
      security = scanSkillSecurity(content);
    } catch {}
    skills.push({
      name: entry,
      label: meta.label,
      description: meta.description,
      source: 'skills',
      scope,
      path: skillFile,
      category: meta.category,
      tags: meta.tags,
      security,
      mcpRequires: meta.mcpRequires,
    });
    seen.add(entry);
  }
  return skills;
}

/**
 * List all skills — project-scoped (workdir) first, then global (~/.pikiclaw/skills/).
 * Project skills with the same name shadow global ones.
 */
export function listSkills(workdir: string): SkillListResult {
  const seen = new Set<string>();
  const { canonicalRoot } = resolveProjectSkillRoots(workdir);

  // Project skills take precedence
  const projectSkills = discoverSkillsFromDir(canonicalRoot, 'project', seen);
  // Global skills fill in the rest
  const globalSkills = discoverSkillsFromDir(GLOBAL_SKILLS_ROOT, 'global', seen);

  return { skills: withPinnedState(workdir, [...projectSkills, ...globalSkills]), workdir };
}

/** Return the global skills root directory path. */
export function getGlobalSkillsRoot(): string {
  return GLOBAL_SKILLS_ROOT;
}

export function listPinnedSkills(workdir: string): PinnedSkillListResult {
  const pinned = pinnedNamesForWorkdir(workdir);
  const skills = listSkills(workdir).skills
    .filter(skill => skill.pinned)
    .sort((a, b) => {
      const byScope = a.scope === b.scope ? 0 : a.scope === 'project' ? -1 : 1;
      if (byScope) return byScope;
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });
  return { skills, global: pinned.global, project: pinned.project, workdir };
}

export function setSkillPinned(
  skillName: string,
  pinned: boolean,
  opts: { global?: boolean; workdir?: string } = {},
): SkillPinResult {
  const name = skillName.trim();
  if (!validSkillName(name)) return { ok: false, error: 'invalid skill name' };
  if (!opts.global && !opts.workdir) return { ok: false, error: 'workdir is required for project-scoped skill pinning' };
  const workdir = opts.workdir ? path.resolve(opts.workdir) : process.cwd();
  const desiredScope: SkillScope = opts.global ? 'global' : 'project';
  const skill = listSkills(workdir).skills.find(item =>
    item.name.toLowerCase() === name.toLowerCase()
    && item.scope === desiredScope
  );
  if (!skill) return { ok: false, error: `skill "${name}" not found in ${desiredScope} scope` };
  if (skill.security?.verdict === 'blocked') {
    return { ok: false, error: 'blocked skills cannot be pinned into live chats' };
  }

  const config = loadUserConfig();
  const extensions = { ...(config.extensions || {}) };
  const skillsConfig = {
    ...(extensions.skills || {}),
    pinnedGlobal: normalizedPinnedList(extensions.skills?.pinnedGlobal),
    pinnedByWorkspace: { ...(extensions.skills?.pinnedByWorkspace || {}) },
  };
  const targetKey = desiredScope === 'global' ? '' : workspacePinKey(workdir);
  const existing = desiredScope === 'global'
    ? normalizedPinnedList(skillsConfig.pinnedGlobal)
    : normalizedPinnedList(skillsConfig.pinnedByWorkspace[targetKey]);
  const next = existing.filter(item => normalizePinnedName(item) !== normalizePinnedName(skill.name));
  if (pinned) next.push(skill.name);
  const normalizedNext = normalizedPinnedList(next);
  if (desiredScope === 'global') {
    skillsConfig.pinnedGlobal = normalizedNext;
  } else if (normalizedNext.length) {
    skillsConfig.pinnedByWorkspace[targetKey] = normalizedNext;
  } else {
    delete skillsConfig.pinnedByWorkspace[targetKey];
  }
  extensions.skills = skillsConfig;
  saveUserConfig({ ...config, extensions });
  return { ok: true, name: skill.name, pinned, scope: desiredScope };
}

const SKILL_RETRIEVAL_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'that', 'the',
  'this', 'to', 'use', 'we', 'with', 'you',
]);
const SKILL_RETRIEVAL_ALIASES: Record<string, string[]> = {
  发布: ['release', 'ship', 'shipping'],
  发版: ['release', 'ship', 'shipping'],
  检查: ['check', 'review', 'audit'],
  审查: ['review', 'audit'],
  代码: ['code'],
  总结: ['summarize', 'summary'],
  写: ['write', 'draft'],
  研究: ['research'],
  构建: ['build'],
  部署: ['deploy', 'deployment'],
  测试: ['test', 'testing'],
  修复: ['fix', 'repair'],
};
const SKILL_RETRIEVAL_K1 = 1.5;
const SKILL_RETRIEVAL_B = 0.75;

function tokenizeSkillSearch(text: string): string[] {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
    .map(token => token.trim())
    .filter(token => token.length > 1 && !SKILL_RETRIEVAL_STOPWORDS.has(token));
  const expanded = [...tokens];
  for (const [needle, aliases] of Object.entries(SKILL_RETRIEVAL_ALIASES)) {
    if (text.includes(needle)) expanded.push(...aliases);
  }
  return [...new Set(expanded)];
}

function skillSearchText(skill: SkillInfo): string {
  return [
    skill.name,
    skill.label || '',
    skill.description || '',
    skill.category || '',
    ...(skill.tags || []),
  ].join(' ');
}

export function retrieveRelevantSkills(
  workdir: string,
  query: string,
  opts: { limit?: number; includePinned?: boolean } = {},
): RetrievedSkillInfo[] {
  if (!query.trim()) return [];
  if (query.trim().startsWith('/') || collapseSkillPrompt(query)) return [];
  const queryTerms = tokenizeSkillSearch(query);
  if (!queryTerms.length) return [];

  const skills = listSkills(workdir).skills
    .filter(skill => skill.path && skill.security?.verdict !== 'blocked')
    .filter(skill => opts.includePinned || !skill.pinned);
  if (!skills.length) return [];

  const docs = skills.map(skill => {
    const terms = tokenizeSkillSearch(skillSearchText(skill));
    const termFreqs = new Map<string, number>();
    for (const term of terms) termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
    const nameTerms = new Set(tokenizeSkillSearch(skill.name));
    return { skill, terms, termFreqs, nameTerms };
  }).filter(doc => doc.terms.length > 0);
  if (!docs.length) return [];

  const df = new Map<string, number>();
  let totalLength = 0;
  for (const doc of docs) {
    totalLength += doc.terms.length;
    for (const term of doc.termFreqs.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const avgdl = totalLength / docs.length || 1;

  const results: RetrievedSkillInfo[] = [];
  for (const doc of docs) {
    let score = 0;
    let matchedTerms = 0;
    let matchedNameTerms = 0;
    for (const term of queryTerms) {
      const tf = doc.termFreqs.get(term) || 0;
      if (!tf) continue;
      matchedTerms += 1;
      if (doc.nameTerms.has(term)) matchedNameTerms += 1;
      const termDf = df.get(term) || 0;
      const idf = Math.log((docs.length - termDf + 0.5) / (termDf + 0.5) + 1);
      const norm = 1 - SKILL_RETRIEVAL_B + SKILL_RETRIEVAL_B * (doc.terms.length / avgdl);
      const tfSat = (tf * (SKILL_RETRIEVAL_K1 + 1)) / (tf + SKILL_RETRIEVAL_K1 * norm);
      score += idf * tfSat;
    }
    if (score <= 0) continue;
    if (matchedTerms < 2 && matchedNameTerms === 0 && score < 1.2) continue;
    results.push({ skill: doc.skill, score, matchedTerms });
  }

  return results
    .sort((a, b) => {
      const byScore = b.score - a.score;
      if (byScore) return byScore;
      const byScope = a.skill.scope === b.skill.scope ? 0 : a.skill.scope === 'project' ? -1 : 1;
      if (byScope) return byScope;
      return a.skill.name.localeCompare(b.skill.name, 'en', { sensitivity: 'base' });
    })
    .slice(0, opts.limit ?? 4);
}

export function buildPinnedSkillsPrompt(workdir: string): string {
  const pinned = listPinnedSkills(workdir).skills
    .filter(skill => skill.path && skill.security?.verdict !== 'blocked')
    .slice(0, 12);
  if (!pinned.length) return '';
  const lines = pinned.map(skill => {
    const title = skill.label && skill.label !== skill.name ? `${skill.name} (${skill.label})` : skill.name;
    const detail = skill.description ? ` - ${skill.description}` : '';
    return `- ${title} [${skill.scope}] -> ${skill.path}${detail}`;
  });
  return [
    'Pinned Pikiclaw Skills are always available in this chat.',
    'Use them only when relevant to the user request. When using one, read the referenced SKILL.md and follow its instructions.',
    ...lines,
  ].join('\n');
}

export function buildRelevantSkillsPrompt(workdir: string, query: string, opts: { limit?: number } = {}): string {
  const results = retrieveRelevantSkills(workdir, query, { limit: opts.limit ?? 4 });
  if (!results.length) return '';
  const lines = results.map(({ skill, score, matchedTerms }) => {
    const title = skill.label && skill.label !== skill.name ? `${skill.name} (${skill.label})` : skill.name;
    const detail = skill.description ? ` - ${skill.description}` : '';
    return `- ${title} [${skill.scope}; ${matchedTerms} match${matchedTerms === 1 ? '' : 'es'}; score ${score.toFixed(2)}] -> ${skill.path}${detail}`;
  });
  return [
    'Pikiclaw auto-selected relevant Skills for this turn.',
    'Use these only if they fit the user request. When using one, read the referenced SKILL.md and follow its instructions.',
    ...lines,
  ].join('\n');
}
