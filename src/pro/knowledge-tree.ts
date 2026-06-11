import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type KnowledgeTreeNodeKind = 'folder' | 'repo';
export type KnowledgeTreeNodeStatus = 'ready' | 'missing' | 'error';

export interface KnowledgeTreeStats {
  fileCount: number;
  directoryCount: number;
  primaryLanguages: string[];
  frameworks: string[];
  topLevelFiles: string[];
}

export interface KnowledgeTreeNode {
  id: string;
  title: string;
  kind: KnowledgeTreeNodeKind;
  status: KnowledgeTreeNodeStatus;
  path?: string;
  relativePath?: string;
  parentId?: string | null;
  workspacePaths: string[];
  summary: string;
  design: string;
  boundary?: string;
  implementation?: string;
  highlights: string[];
  stats?: KnowledgeTreeStats;
  error?: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt?: string;
  children: KnowledgeTreeNode[];
}

export interface KnowledgeTreeFile {
  version: 1;
  roots: KnowledgeTreeNode[];
}

export interface WorkspaceKnowledgeResult {
  node: KnowledgeTreeNode;
  tree: KnowledgeTreeNode[];
  created: boolean;
  linked: boolean;
}

const MAX_CONCEPT_SCAN_DEPTH = 3;
const MAX_CONCEPT_EVIDENCE = 6;
const MAX_SCAN_ITEMS = 5000;
const MAX_README_CHARS = 900;

const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.pikiclaw',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'out',
  'target',
  'temp',
  'tmp',
  'venv',
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.c': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.css': 'CSS',
  '.go': 'Go',
  '.html': 'HTML',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.jsx': 'React',
  '.kt': 'Kotlin',
  '.mjs': 'JavaScript',
  '.mm': 'Objective-C++',
  '.php': 'PHP',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.scala': 'Scala',
  '.scss': 'SCSS',
  '.sh': 'Shell',
  '.swift': 'Swift',
  '.ts': 'TypeScript',
  '.tsx': 'React',
  '.vue': 'Vue',
};

function knowledgeTreeFilePath() {
  return process.env.PIKICLAW_KNOWLEDGE_TREE_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'knowledge-tree.json');
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return `know_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeText(value: unknown, max = 4000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function normalizePathInput(value: string): string {
  const trimmed = value.trim();
  const expanded = trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  return path.resolve(expanded);
}

function safeReadJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeStringArray(value: unknown, maxItems = 80): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeText(item, 500);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeStats(value: unknown): KnowledgeTreeStats | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    fileCount: Math.max(0, Math.floor(Number(raw.fileCount) || 0)),
    directoryCount: Math.max(0, Math.floor(Number(raw.directoryCount) || 0)),
    primaryLanguages: normalizeStringArray(raw.primaryLanguages, 8),
    frameworks: normalizeStringArray(raw.frameworks, 12),
    topLevelFiles: normalizeStringArray(raw.topLevelFiles, 18),
  };
}

function normalizeNode(value: unknown, fallbackParentId: string | null = null): KnowledgeTreeNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = normalizeText(raw.id, 120) || newId();
  const title = normalizeText(raw.title, 240);
  if (!title) return null;
  const status: KnowledgeTreeNodeStatus = raw.status === 'missing' || raw.status === 'error' ? raw.status : 'ready';
  const kind: KnowledgeTreeNodeKind = raw.kind === 'repo' ? 'repo' : 'folder';
  const nodePath = normalizeText(raw.path, 4000) || undefined;
  const children = Array.isArray(raw.children)
    ? raw.children.map(child => normalizeNode(child, id)).filter(Boolean) as KnowledgeTreeNode[]
    : [];
  return {
    id,
    title,
    kind,
    status,
    path: nodePath,
    relativePath: normalizeText(raw.relativePath, 1000) || undefined,
    parentId: normalizeText(raw.parentId, 120) || fallbackParentId,
    workspacePaths: normalizeStringArray(raw.workspacePaths, 80).map(normalizePathInput),
    summary: normalizeText(raw.summary, 8000),
    design: normalizeText(raw.design, 8000),
    boundary: normalizeText(raw.boundary, 8000) || undefined,
    implementation: normalizeText(raw.implementation, 8000) || undefined,
    highlights: normalizeStringArray(raw.highlights, 12),
    stats: normalizeStats(raw.stats),
    error: normalizeText(raw.error, 2000) || undefined,
    createdAt: normalizeText(raw.createdAt, 80) || nowIso(),
    updatedAt: normalizeText(raw.updatedAt, 80) || nowIso(),
    analyzedAt: normalizeText(raw.analyzedAt, 80) || undefined,
    children,
  };
}

function normalizeFile(value: unknown): KnowledgeTreeFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, roots: [] };
  const roots = Array.isArray((value as Record<string, unknown>).roots)
    ? ((value as Record<string, unknown>).roots as unknown[]).map(root => normalizeNode(root)).filter(Boolean) as KnowledgeTreeNode[]
    : [];
  return { version: 1, roots };
}

export function loadKnowledgeTree(): KnowledgeTreeFile {
  return normalizeFile(safeReadJson(knowledgeTreeFilePath()));
}

function saveKnowledgeTree(file: KnowledgeTreeFile) {
  const filePath = knowledgeTreeFilePath();
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, roots: file.roots }, null, 2));
}

export function listKnowledgeTree(): KnowledgeTreeNode[] {
  return loadKnowledgeTree().roots;
}

function walkNodes(nodes: KnowledgeTreeNode[], visit: (node: KnowledgeTreeNode) => void) {
  for (const node of nodes) {
    visit(node);
    walkNodes(node.children, visit);
  }
}

function findNode(nodes: KnowledgeTreeNode[], id: string): KnowledgeTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export function getKnowledgeTreeNode(id: string): KnowledgeTreeNode | null {
  return findNode(loadKnowledgeTree().roots, id.trim());
}

function replaceNode(nodes: KnowledgeTreeNode[], id: string, replacement: KnowledgeTreeNode): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      nodes[i] = replacement;
      return true;
    }
    if (replaceNode(nodes[i].children, id, replacement)) return true;
  }
  return false;
}

function findNodeByPathOrWorkspace(nodes: KnowledgeTreeNode[], targetPath: string): KnowledgeTreeNode | null {
  let found: KnowledgeTreeNode | null = null;
  walkNodes(nodes, node => {
    if (found) return;
    const ownPath = node.path ? normalizePathInput(node.path) : '';
    if (ownPath === targetPath || node.workspacePaths.some(item => normalizePathInput(item) === targetPath)) found = node;
  });
  return found;
}

function uniquePush(values: string[], value: string): boolean {
  if (values.some(item => normalizePathInput(item) === value)) return false;
  values.push(value);
  return true;
}

function isIgnoredEntry(name: string, isDirectory: boolean): boolean {
  if (!name || name === '.DS_Store') return true;
  if (isDirectory && IGNORED_DIRS.has(name)) return true;
  if (name.endsWith('.log') || name.endsWith('.tmp')) return true;
  return false;
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => !isIgnoredEntry(entry.name, entry.isDirectory()))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

function readPackageSummary(dir: string): { name?: string; description?: string; frameworks: string[] } {
  const pkg = safeReadJson(path.join(dir, 'package.json'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { frameworks: [] };
  const raw = pkg as Record<string, unknown>;
  const deps = {
    ...(raw.dependencies && typeof raw.dependencies === 'object' && !Array.isArray(raw.dependencies) ? raw.dependencies as Record<string, unknown> : {}),
    ...(raw.devDependencies && typeof raw.devDependencies === 'object' && !Array.isArray(raw.devDependencies) ? raw.devDependencies as Record<string, unknown> : {}),
  };
  const frameworks = new Set<string>();
  for (const dep of Object.keys(deps)) {
    if (dep === 'react' || dep === 'react-dom') frameworks.add('React');
    if (dep === 'vite' || dep === '@vitejs/plugin-react') frameworks.add('Vite');
    if (dep === 'hono' || dep === '@hono/node-server') frameworks.add('Hono');
    if (dep === 'zustand') frameworks.add('Zustand');
    if (dep === 'tailwindcss' || dep === '@tailwindcss/vite') frameworks.add('Tailwind CSS');
    if (dep === 'vitest') frameworks.add('Vitest');
    if (dep === 'typescript') frameworks.add('TypeScript');
    if (dep === 'playwright') frameworks.add('Playwright');
    if (dep === 'next') frameworks.add('Next.js');
    if (dep === 'vue') frameworks.add('Vue');
    if (dep === 'svelte') frameworks.add('Svelte');
  }
  return {
    name: normalizeText(raw.name, 160) || undefined,
    description: normalizeText(raw.description, 600) || undefined,
    frameworks: [...frameworks],
  };
}

function readReadmeLead(dir: string): string {
  const names = ['README.md', 'README.zh-CN.md', 'README.txt', 'readme.md'];
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      const raw = fs.readFileSync(filePath, 'utf8').slice(0, MAX_README_CHARS);
      const lines = raw
        .split(/\r?\n/)
        .map(line => line.replace(/^#+\s*/, '').trim())
        .filter(line => line && !line.startsWith('![') && !line.startsWith('<img'));
      if (lines.length) return lines.slice(0, 4).join(' ');
    } catch {
      // keep looking
    }
  }
  return '';
}

function collectStats(dir: string): KnowledgeTreeStats {
  const languageCounts = new Map<string, number>();
  const frameworks = new Set<string>(readPackageSummary(dir).frameworks);
  let fileCount = 0;
  let directoryCount = 0;
  let visited = 0;
  const stack = [dir];
  while (stack.length && visited < MAX_SCAN_ITEMS) {
    const current = stack.pop()!;
    for (const entry of readDir(current)) {
      visited += 1;
      if (visited >= MAX_SCAN_ITEMS) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        directoryCount += 1;
        stack.push(fullPath);
        continue;
      }
      fileCount += 1;
      const language = LANGUAGE_BY_EXT[path.extname(entry.name).toLowerCase()];
      if (language) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
      if (entry.name === 'vite.config.ts' || entry.name === 'vite.config.js') frameworks.add('Vite');
      if (entry.name === 'vitest.config.ts' || entry.name === 'vitest.config.js') frameworks.add('Vitest');
      if (entry.name === 'tailwind.config.ts' || entry.name === 'tailwind.config.js') frameworks.add('Tailwind CSS');
      if (entry.name === 'tsconfig.json') frameworks.add('TypeScript');
    }
  }
  const primaryLanguages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([language]) => language);
  const topLevelFiles = readDir(dir).filter(entry => entry.isFile()).slice(0, 18).map(entry => entry.name);
  return {
    fileCount,
    directoryCount,
    primaryLanguages,
    frameworks: [...frameworks].sort(),
    topLevelFiles,
  };
}

function isRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'))
    || fs.existsSync(path.join(dir, 'package.json'))
    || fs.existsSync(path.join(dir, 'go.mod'))
    || fs.existsSync(path.join(dir, 'pyproject.toml'))
    || fs.existsSync(path.join(dir, 'Cargo.toml'));
}

function summaryForFolder(title: string, kind: KnowledgeTreeNodeKind, stats: KnowledgeTreeStats, readmeLead: string, pkgDescription?: string): string {
  const base = kind === 'repo'
    ? `这是一个代码仓库级 Knowledge 节点，包含 ${stats.directoryCount} 个目录和 ${stats.fileCount} 个文件。`
    : `这是 ${title} 目录的 Knowledge 节点，包含 ${stats.directoryCount} 个子目录和 ${stats.fileCount} 个文件。`;
  const stack = [
    stats.primaryLanguages.length ? `主要语言/形态是 ${stats.primaryLanguages.join('、')}。` : '',
    stats.frameworks.length ? `可识别的框架或工具包括 ${stats.frameworks.join('、')}。` : '',
  ].filter(Boolean).join(' ');
  const source = pkgDescription || readmeLead;
  return [
    base,
    stack,
    '下方 Knowledge tree 是按分析得到的组件职责、边界和实现证据组织，不要求与文件目录一一对应。',
    source ? `项目自述/元数据提示：${source}` : '当前总结来自目录结构、文件类型和本地元数据扫描。',
  ].filter(Boolean).join(' ');
}

function buildHighlights(stats: KnowledgeTreeStats, evidencePaths: string[], topFiles: string[]): string[] {
  const highlights: string[] = [];
  if (stats.primaryLanguages.length) highlights.push(`主要语言：${stats.primaryLanguages.join('、')}`);
  if (stats.frameworks.length) highlights.push(`框架/工具：${stats.frameworks.join('、')}`);
  if (evidencePaths.length) highlights.push(`代表性证据：${evidencePaths.slice(0, 8).join('、')}`);
  if (topFiles.length) highlights.push(`顶层文件：${topFiles.slice(0, 8).join('、')}`);
  if (!highlights.length) highlights.push('该节点暂无足够结构信号，后续可以通过会话或手动笔记补充。');
  return highlights.slice(0, 6);
}

interface DirectorySignal {
  name: string;
  fullPath: string;
  relativePath: string;
  depth: number;
  stats: KnowledgeTreeStats;
}

interface ConceptSpec {
  key: string;
  title: string;
  purpose: string;
  design: string;
  owns: string;
  excludes: string;
  implementationFocus: string;
  priority: number;
  matcher: (signal: DirectorySignal) => boolean;
}

const CONCEPT_SPECS: ConceptSpec[] = [
  {
    key: 'interface',
    title: 'Dashboard component',
    purpose: '面向用户的 dashboard、Web 体验、页面组件和浏览器侧交互',
    design: '这个组件回答“用户在哪里完成工作”。它通常把路由、页面、组件、状态和视觉反馈放在一起理解，而不是按每个前端目录逐个展开。',
    owns: '用户可见的信息架构、工作台页面、交互状态、视觉反馈和浏览器侧 API 调用',
    excludes: '不直接拥有 agent 执行契约、后台进程生命周期或第三方渠道协议',
    implementationFocus: '优先阅读路由入口、页面容器、共享组件、API client、状态 hooks 和样式约束',
    priority: 10,
    matcher: signal => /(^|\/)(dashboard|web|ui|client|frontend|pages|components|app)(\/|$)/i.test(signal.relativePath),
  },
  {
    key: 'agents-tools',
    title: 'Agent and tool component',
    purpose: 'Agent 驱动、模型适配、MCP、Skills、工具调用和外部执行面',
    design: '这个组件回答“能力如何被接入和调用”。它按 agent/model/tool 的 contract 组织，而不是按实现文件位置组织。',
    owns: 'agent driver contract、模型/工具接入、MCP 会话桥、skills 发现安装和外部 CLI 执行边界',
    excludes: '不拥有具体渠道渲染，也不应该把产品页面状态耦合进 agent contract',
    implementationFocus: '优先阅读 driver registry、agent stream、MCP bridge、tool definitions、extension merge 和 CLI detector',
    priority: 20,
    matcher: signal => /(^|\/)(agent|agents|drivers|model|models|mcp|skills|tools|extensions|catalog)(\/|$)/i.test(signal.relativePath),
  },
  {
    key: 'integrations',
    title: 'Integration/channel component',
    purpose: 'IM 渠道、第三方系统、外部平台和协议适配',
    design: '这个组件回答“外部世界如何进入系统”。它把渠道隔离、适配器和认证边界放在同一知识视角里看。',
    owns: '外部 channel transport、消息收发协议、第三方平台认证和渠道隔离策略',
    excludes: '不直接拥有核心 agent 执行逻辑，也不应该把单个渠道的格式泄漏到共享 bot runtime',
    implementationFocus: '优先阅读 channel base contract、各平台 bot/renderer、OAuth/provider glue 和协议适配器',
    priority: 30,
    matcher: signal => /(^|\/)(channels|integrations|providers|telegram|feishu|slack|discord|weixin|wecom|dingtalk|jira|oauth)(\/|$)/i.test(signal.relativePath),
  },
  {
    key: 'domain-state',
    title: 'Workflow state component',
    purpose: '产品工作流对象、持久化状态、任务、知识、笔记和业务域模型',
    design: '这个组件回答“系统记住什么、如何推进工作”。它优先按对象生命周期和状态转移组织。',
    owns: '任务、todo、knowledge、输出、笔记等产品对象的生命周期、持久化文件和状态转移',
    excludes: '不拥有低层进程控制，也不应该直接决定各渠道如何展示同一状态',
    implementationFocus: '优先阅读 store 文件、workflow helpers、route handlers、对象 schema 和状态迁移逻辑',
    priority: 40,
    matcher: signal => /(^|\/)(pro|workflow|task|tasks|todo|todos|notes|knowledge|store|stores|state|domain|data)(\/|$)/i.test(signal.relativePath),
  },
  {
    key: 'runtime',
    title: 'Runtime foundation component',
    purpose: '底层运行时、服务端 API、会话编排、进程控制和共享基础设施',
    design: '这个组件回答“系统如何跑起来”。它聚合支撑主流程的基础设施和服务边界，适合先看入口、状态流和错误恢复策略。',
    owns: 'HTTP runtime、daemon/server 入口、会话编排、bot runtime、进程控制、平台抽象和共享配置',
    excludes: '不应该吸收具体产品页面逻辑，也不应该让渠道实现反向依赖核心基础设施',
    implementationFocus: '优先阅读 server/runtime 入口、session orchestration、core utilities、process control 和 config resolution',
    priority: 50,
    matcher: signal => /(^|\/)(src|core|server|runtime|session|service|services|bot|cli|process|platform)(\/|$)/i.test(signal.relativePath),
  },
  {
    key: 'quality-ops',
    title: 'Quality and operations component',
    purpose: '测试、脚本、配置、部署、文档和工程支撑材料',
    design: '这个组件回答“如何验证、运行和维护”。它把测试、脚本、文档和配置作为工程反馈回路来看。',
    owns: '测试入口、运行脚本、构建配置、文档资产、静态资源和工程维护反馈回路',
    excludes: '不拥有业务运行时职责，也不应该成为产品逻辑的隐藏入口',
    implementationFocus: '优先阅读 focused tests、dev/build scripts、config files、docs 和运维辅助资产',
    priority: 60,
    matcher: signal => /(^|\/)(test|tests|__tests__|scripts|docs|docker|config|configs|\.github|assets|public|static)(\/|$)/i.test(signal.relativePath),
  },
];

const FALLBACK_CONCEPT: ConceptSpec = {
  key: 'project-shape',
  title: 'Local module component',
  purpose: '无法归入专门层级的局部模块、资源和实现细节',
  design: '这个组件保留分析器尚未明确归类的结构信号，后续可以通过人工编辑或更深会话分析继续拆分。',
  owns: '局部模块、资源文件和暂时无法归入主组件边界的实现证据',
  excludes: '不代表一个稳定架构边界，直到后续分析把它拆入更明确的组件',
  implementationFocus: '优先阅读代表性目录和顶层文件，再决定是否沉淀为新的组件节点',
  priority: 100,
  matcher: () => true,
};

function gatherDirectorySignals(dir: string, rootDir: string, depth = 0, out: DirectorySignal[] = []): DirectorySignal[] {
  if (depth >= MAX_CONCEPT_SCAN_DEPTH || out.length >= 120) return out;
  for (const entry of readDir(dir)) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);
    out.push({
      name: entry.name,
      fullPath,
      relativePath,
      depth: relativePath.split(path.sep).filter(Boolean).length,
      stats: collectStats(fullPath),
    });
    gatherDirectorySignals(fullPath, rootDir, depth + 1, out);
    if (out.length >= 120) break;
  }
  return out;
}

function conceptForSignal(signal: DirectorySignal): ConceptSpec {
  return CONCEPT_SPECS.find(spec => spec.matcher(signal)) || FALLBACK_CONCEPT;
}

function aggregateStats(signals: DirectorySignal[]): KnowledgeTreeStats {
  const languageCounts = new Map<string, number>();
  const frameworks = new Set<string>();
  const topLevelFiles = new Set<string>();
  let fileCount = 0;
  let directoryCount = 0;
  for (const signal of signals) {
    fileCount += signal.stats.fileCount;
    directoryCount += signal.stats.directoryCount;
    for (const language of signal.stats.primaryLanguages) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
    for (const framework of signal.stats.frameworks) frameworks.add(framework);
    for (const file of signal.stats.topLevelFiles) topLevelFiles.add(file);
  }
  return {
    fileCount,
    directoryCount,
    primaryLanguages: [...languageCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([language]) => language),
    frameworks: [...frameworks].sort().slice(0, 12),
    topLevelFiles: [...topLevelFiles].slice(0, 18),
  };
}

function signalScore(signal: DirectorySignal): number {
  return Math.max(0, 6 - signal.depth) * 100 + signal.stats.fileCount + signal.stats.directoryCount * 2;
}

function selectEvidence(signals: DirectorySignal[]): DirectorySignal[] {
  const selected: DirectorySignal[] = [];
  const seenTop = new Set<string>();
  for (const signal of [...signals].sort((a, b) => signalScore(b) - signalScore(a) || a.relativePath.localeCompare(b.relativePath))) {
    const top = signal.relativePath.split(path.sep)[0] || signal.relativePath;
    if (seenTop.has(top) && selected.length >= Math.ceil(MAX_CONCEPT_EVIDENCE / 2)) continue;
    selected.push(signal);
    seenTop.add(top);
    if (selected.length >= MAX_CONCEPT_EVIDENCE) break;
  }
  return selected;
}

function statsBrief(stats: KnowledgeTreeStats): string {
  const parts = [
    `${stats.directoryCount} 个子目录`,
    `${stats.fileCount} 个文件`,
    stats.primaryLanguages.length ? `主要语言/形态：${stats.primaryLanguages.join('、')}` : '',
    stats.frameworks.length ? `技术信号：${stats.frameworks.join('、')}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

function evidenceLabel(paths: string[], fallback: string): string {
  return paths.length ? paths.join('、') : fallback;
}

function boundaryForConcept(spec: ConceptSpec, evidencePaths: string[], fallback: string): string {
  return [
    `组件边界：${spec.title} 负责 ${spec.owns}。`,
    `非职责：${spec.excludes}。`,
    `当前边界由 ${evidenceLabel(evidencePaths, fallback)} 这些源码证据支撑；这些证据用于解释组件，不等于完整目录索引。`,
  ].join(' ');
}

function implementationForConcept(spec: ConceptSpec, stats: KnowledgeTreeStats, evidencePaths: string[], fallback: string): string {
  return [
    `实现入口：${spec.implementationFocus}。`,
    `代表性位置：${evidenceLabel(evidencePaths, fallback)}。`,
    `当前扫描到的实现信号：${statsBrief(stats)}。`,
    stats.topLevelFiles.length ? `相关顶层文件包括 ${stats.topLevelFiles.slice(0, 8).join('、')}。` : '',
  ].filter(Boolean).join(' ');
}

function boundaryForEvidence(signal: DirectorySignal, componentTitle: string): string {
  return [
    `证据边界：${signal.relativePath} 是 ${componentTitle} 的局部实现证据。`,
    '它用于说明这个组件在源码中的落点，不代表整个组件边界，也不要求继续完整展开目录树。',
  ].join(' ');
}

function implementationForEvidence(signal: DirectorySignal): string {
  return [
    `实现线索：${signal.relativePath} 下包含 ${statsBrief(signal.stats)}。`,
    signal.stats.topLevelFiles.length ? `可先看 ${signal.stats.topLevelFiles.slice(0, 8).join('、')}。` : '暂未识别出顶层文件，可从目录入口继续阅读。',
  ].join(' ');
}

function boundaryForRoot(kind: KnowledgeTreeNodeKind, title: string, componentTitles: string[]): string {
  const scope = kind === 'repo' ? '仓库' : '目录';
  const components = componentTitles.length ? componentTitles.join('、') : '尚未形成明确组件';
  return `组件边界：该 Knowledge 根节点代表 ${title} 这个${scope}的整体分析范围；子节点是分析器推断出的组件边界（${components}），不是文件系统目录的完整复制。根节点只负责给出全局阅读顺序，具体实现边界落在各组件节点和它们的证据节点中。`;
}

function implementationForRoot(stats: KnowledgeTreeStats, componentTitles: string[]): string {
  const componentPart = componentTitles.length ? `已识别组件：${componentTitles.join('、')}。` : '暂未识别出稳定组件层级。';
  return [
    `实现总览：当前范围扫描到 ${statsBrief(stats)}。`,
    componentPart,
    stats.topLevelFiles.length ? `顶层入口/配置线索包括 ${stats.topLevelFiles.slice(0, 10).join('、')}。` : '',
    '阅读时建议先看组件节点的边界，再进入代表性证据目录确认实现。',
  ].filter(Boolean).join(' ');
}

function buildEvidenceNode(signal: DirectorySignal, parentId: string, componentTitle: string, timestamp: string): KnowledgeTreeNode {
  return {
    id: newId(),
    title: signal.relativePath,
    kind: 'folder',
    status: 'ready',
    path: signal.fullPath,
    relativePath: signal.relativePath,
    parentId,
    workspacePaths: [],
    summary: `${signal.relativePath} 是 ${componentTitle} 的代表性实现证据，包含 ${signal.stats.directoryCount} 个子目录和 ${signal.stats.fileCount} 个文件。`,
    design: `它被保留在 Knowledge tree 中用于定位源码证据；它不是为了完整复刻目录树，而是帮助把概念解释落回可阅读的位置。`,
    boundary: boundaryForEvidence(signal, componentTitle),
    implementation: implementationForEvidence(signal),
    highlights: buildHighlights(signal.stats, [signal.relativePath], signal.stats.topLevelFiles),
    stats: signal.stats,
    createdAt: timestamp,
    updatedAt: timestamp,
    analyzedAt: timestamp,
    children: [],
  };
}

function buildConceptNode(spec: ConceptSpec, signals: DirectorySignal[], rootDir: string, parentId: string, timestamp: string): KnowledgeTreeNode {
  const id = newId();
  const evidence = selectEvidence(signals);
  const stats = aggregateStats(signals);
  const evidencePaths = evidence.map(signal => signal.relativePath);
  return {
    id,
    title: spec.title,
    kind: 'folder',
    status: 'ready',
    relativePath: `concept:${spec.key}`,
    parentId,
    workspacePaths: [],
    summary: `这是 ${spec.title}：${spec.purpose}。分析器把 ${signals.length} 个目录信号归入这个组件，代表性证据包括 ${evidenceLabel(evidencePaths, path.basename(rootDir))}。`,
    design: `${spec.design} 这一节点是分析后形成的组件层级，不要求与 repo/folder 的真实目录完全一致。`,
    boundary: boundaryForConcept(spec, evidencePaths, path.basename(rootDir)),
    implementation: implementationForConcept(spec, stats, evidencePaths, path.basename(rootDir)),
    highlights: buildHighlights(stats, evidencePaths, stats.topLevelFiles),
    stats,
    createdAt: timestamp,
    updatedAt: timestamp,
    analyzedAt: timestamp,
    children: evidence.map(signal => buildEvidenceNode(signal, id, spec.title, timestamp)),
  };
}

function buildConceptualChildren(rootDir: string, rootId: string, timestamp: string): KnowledgeTreeNode[] {
  const signals = gatherDirectorySignals(rootDir, rootDir);
  if (!signals.length) return [];
  const groups = new Map<string, { spec: ConceptSpec; signals: DirectorySignal[] }>();
  for (const signal of signals) {
    const spec = conceptForSignal(signal);
    const current = groups.get(spec.key) || { spec, signals: [] };
    current.signals.push(signal);
    groups.set(spec.key, current);
  }
  return [...groups.values()]
    .sort((a, b) => a.spec.priority - b.spec.priority || b.signals.length - a.signals.length)
    .map(group => buildConceptNode(group.spec, group.signals, rootDir, rootId, timestamp));
}

function designForRoot(stats: KnowledgeTreeStats, conceptTitles: string[]): string {
  const density = stats.directoryCount > 12
    ? '仓库结构信号较多，Knowledge tree 会优先压缩为少量组件边界。'
    : stats.fileCount > 40
      ? '文件数量较多，适合先按组件职责阅读，再回到代表性目录。'
      : '规模较轻，组件层级会尽量保持克制。';
  const split = conceptTitles.length
    ? `当前分析出的主要组件是：${conceptTitles.join('、')}。`
    : '当前还没有足够目录信号形成明确组件层级。';
  return `${density} ${split} 这些层级由分析器基于命名、技术栈、目录密度和元数据推断出来，不需要完整对齐文件系统。`;
}

function analyzeFolderNode(dir: string): KnowledgeTreeNode {
  const id = newId();
  const title = path.basename(dir) || dir;
  const stats = collectStats(dir);
  const pkg = readPackageSummary(dir);
  const readmeLead = readReadmeLead(dir);
  const kind: KnowledgeTreeNodeKind = isRepo(dir) ? 'repo' : 'folder';
  const createdAt = nowIso();
  const children = buildConceptualChildren(dir, id, createdAt);
  const componentTitles = children.map(child => child.title);
  return {
    id,
    title: pkg.name || title,
    kind,
    status: 'ready',
    path: dir,
    parentId: null,
    workspacePaths: [dir],
    summary: summaryForFolder(title, kind, stats, readmeLead, pkg.description),
    design: designForRoot(stats, componentTitles),
    boundary: boundaryForRoot(kind, pkg.name || title, componentTitles),
    implementation: implementationForRoot(stats, componentTitles),
    highlights: buildHighlights(stats, children.map(child => child.title), stats.topLevelFiles),
    stats,
    createdAt,
    updatedAt: createdAt,
    analyzedAt: createdAt,
    children,
  };
}

export function analyzeKnowledgePath(targetPath: string): KnowledgeTreeNode {
  const resolved = normalizePathInput(targetPath);
  if (!fs.existsSync(resolved)) {
    const timestamp = nowIso();
    return {
      id: newId(),
      title: path.basename(resolved) || resolved,
      kind: 'folder',
      status: 'missing',
      path: resolved,
      workspacePaths: [resolved],
      summary: '该路径当前不可访问，Knowledge 节点已创建，等待路径恢复后可以重新分析。',
      design: '暂时无法读取目录结构，因此还不能拆分子目录或推断设计理念。',
      boundary: '组件边界：路径不可访问，当前节点只能作为待恢复的 Knowledge 占位，暂不能声明真实组件边界。',
      implementation: '实现线索：暂无可读取源码。路径恢复后点击重新分析即可生成组件边界和实现证据。',
      highlights: ['路径不可访问'],
      error: 'Path not found',
      createdAt: timestamp,
      updatedAt: timestamp,
      children: [],
    };
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    const timestamp = nowIso();
    return {
      id: newId(),
      title: path.basename(resolved),
      kind: 'folder',
      status: 'error',
      path: resolved,
      workspacePaths: [],
      summary: 'Knowledge tree 目前只支持目录或仓库节点。',
      design: '请关联一个 folder 或 repo，以便生成树形拆解。',
      boundary: '组件边界：该路径不是目录，无法作为 repo/folder 组件范围来分析。',
      implementation: '实现线索：请改为选择目录或仓库，分析器会基于目录信号生成组件说明。',
      highlights: ['不支持的路径类型'],
      error: 'Path is not a directory',
      createdAt: timestamp,
      updatedAt: timestamp,
      children: [],
    };
  }
  return analyzeFolderNode(resolved);
}

export function createOrLinkWorkspaceKnowledge(workdir: string, nodeId?: string | null): WorkspaceKnowledgeResult {
  const resolved = normalizePathInput(workdir);
  const file = loadKnowledgeTree();
  const timestamp = nowIso();

  if (nodeId) {
    const node = findNode(file.roots, nodeId);
    if (!node) throw new Error('Knowledge node not found');
    const linked = uniquePush(node.workspacePaths, resolved);
    node.updatedAt = timestamp;
    saveKnowledgeTree(file);
    return { node, tree: file.roots, created: false, linked };
  }

  const existing = findNodeByPathOrWorkspace(file.roots, resolved);
  if (existing) {
    const linked = uniquePush(existing.workspacePaths, resolved);
    existing.updatedAt = timestamp;
    saveKnowledgeTree(file);
    return { node: existing, tree: file.roots, created: false, linked };
  }

  const node = analyzeKnowledgePath(resolved);
  file.roots.unshift(node);
  saveKnowledgeTree(file);
  return { node, tree: file.roots, created: true, linked: true };
}

export function reanalyzeKnowledgeNode(id: string): KnowledgeTreeNode {
  const file = loadKnowledgeTree();
  const existing = findNode(file.roots, id.trim());
  if (!existing) throw new Error('Knowledge node not found');
  if (!existing.path) throw new Error('Knowledge node has no path to analyze');
  const next = analyzeKnowledgePath(existing.path);
  next.id = existing.id;
  next.parentId = existing.parentId;
  next.workspacePaths = existing.workspacePaths.length ? existing.workspacePaths : next.workspacePaths;
  next.createdAt = existing.createdAt;
  next.updatedAt = nowIso();
  if (!replaceNode(file.roots, existing.id, next)) throw new Error('Knowledge node not found');
  saveKnowledgeTree(file);
  return next;
}

export function resetKnowledgeTreeForTests() {
  const filePath = knowledgeTreeFilePath();
  try { fs.unlinkSync(filePath); } catch {}
}
