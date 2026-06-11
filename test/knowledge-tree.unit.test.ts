import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import {
  createOrLinkWorkspaceKnowledge,
  listKnowledgeTree,
  reanalyzeKnowledgeNode,
  resetKnowledgeTreeForTests,
} from '../src/pro/knowledge-tree.ts';

let tmpDir: string;
let repoDir: string;
let previousKnowledgeFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-knowledge-tree-');
  repoDir = path.join(tmpDir, 'demo-repo');
  fs.mkdirSync(path.join(repoDir, 'src', 'core'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'dashboard', 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Demo Repo\n\nA small orchestrator dashboard.');
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
    name: 'demo-repo',
    description: 'A demo workspace for knowledge analysis.',
    dependencies: { react: '^19.0.0', hono: '^4.0.0' },
    devDependencies: { typescript: '^5.0.0', vite: '^7.0.0' },
  }));
  fs.writeFileSync(path.join(repoDir, 'src', 'core', 'index.ts'), 'export const core = true;\n');
  fs.writeFileSync(path.join(repoDir, 'dashboard', 'src', 'App.tsx'), 'export function App() { return null; }\n');
  previousKnowledgeFile = process.env.PIKICLAW_KNOWLEDGE_TREE_FILE;
  process.env.PIKICLAW_KNOWLEDGE_TREE_FILE = path.join(tmpDir, 'knowledge-tree.json');
});

afterEach(() => {
  resetKnowledgeTreeForTests();
  if (previousKnowledgeFile == null) delete process.env.PIKICLAW_KNOWLEDGE_TREE_FILE;
  else process.env.PIKICLAW_KNOWLEDGE_TREE_FILE = previousKnowledgeFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('knowledge tree store', () => {
  it('creates a repo knowledge tree from a workspace path', () => {
    const result = createOrLinkWorkspaceKnowledge(repoDir);
    expect(result.created).toBe(true);
    expect(result.node.kind).toBe('repo');
    expect(result.node.title).toBe('demo-repo');
    expect(result.node.summary).toContain('代码仓库级 Knowledge 节点');
    expect(result.node.summary).toContain('组件职责、边界和实现证据');
    expect(result.node.summary).toContain('不要求与文件目录一一对应');
    expect(result.node.boundary).toContain('组件边界');
    expect(result.node.implementation).toContain('实现总览');
    expect(result.node.children.map(child => child.title)).toEqual(expect.arrayContaining([
      'Dashboard component',
      'Runtime foundation component',
    ]));
    expect(result.node.children.map(child => child.title)).not.toEqual(expect.arrayContaining(['dashboard', 'src']));
    expect(result.node.children.flatMap(child => child.children.map(evidence => evidence.title))).toEqual(expect.arrayContaining(['dashboard', 'src']));
    const dashboard = result.node.children.find(child => child.title === 'Dashboard component');
    expect(dashboard?.summary).toContain('这是 Dashboard component');
    expect(dashboard?.boundary).toContain('组件边界');
    expect(dashboard?.boundary).toContain('用户可见的信息架构');
    expect(dashboard?.implementation).toContain('dashboard');
    expect(dashboard?.children[0]?.boundary).toContain('证据边界');
    expect(result.node.stats?.frameworks).toEqual(expect.arrayContaining(['React', 'Hono', 'TypeScript', 'Vite']));
    expect(listKnowledgeTree()).toHaveLength(1);
  });

  it('reuses an existing node when linking the same workspace again', () => {
    const first = createOrLinkWorkspaceKnowledge(repoDir);
    const second = createOrLinkWorkspaceKnowledge(repoDir);
    expect(second.created).toBe(false);
    expect(second.linked).toBe(false);
    expect(second.node.id).toBe(first.node.id);
    expect(listKnowledgeTree()).toHaveLength(1);
  });

  it('links a workspace to an existing node by id', () => {
    const first = createOrLinkWorkspaceKnowledge(repoDir);
    const otherWorkspace = path.join(tmpDir, 'other');
    fs.mkdirSync(otherWorkspace);
    const linked = createOrLinkWorkspaceKnowledge(otherWorkspace, first.node.id);
    expect(linked.created).toBe(false);
    expect(linked.linked).toBe(true);
    expect(linked.node.workspacePaths).toEqual(expect.arrayContaining([repoDir, otherWorkspace]));
  });

  it('reanalyzes an existing node and preserves its id', () => {
    const first = createOrLinkWorkspaceKnowledge(repoDir);
    fs.mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'scripts', 'dev.sh'), 'echo dev\n');
    const updated = reanalyzeKnowledgeNode(first.node.id);
    expect(updated.id).toBe(first.node.id);
    const ops = updated.children.find(child => child.title === 'Quality and operations component');
    expect(ops?.children.map(child => child.title)).toEqual(expect.arrayContaining(['scripts']));
    expect(ops?.implementation).toContain('scripts');
  });
});
