/**
 * Dashboard Knowledge routes: repository/folder knowledge trees and workspace links.
 */

import { Hono } from 'hono';
import {
  createOrLinkWorkspaceKnowledge,
  getKnowledgeTreeNode,
  listKnowledgeTree,
  reanalyzeKnowledgeNode,
} from '../../pro/knowledge-tree.js';

const app = new Hono();

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

app.get('/api/knowledge', c => {
  return c.json({ ok: true, tree: listKnowledgeTree() });
});

app.get('/api/knowledge/nodes/:id', c => {
  const node = getKnowledgeTreeNode(c.req.param('id'));
  if (!node) return c.json({ ok: false, error: 'knowledge node not found' }, 404);
  return c.json({ ok: true, node });
});

app.post('/api/knowledge/workspace', async c => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const workdir = readString(body?.workdir);
    const nodeId = readString(body?.nodeId) || null;
    if (!workdir) return c.json({ ok: false, error: 'workdir is required' }, 400);
    const result = createOrLinkWorkspaceKnowledge(workdir, nodeId);
    return c.json({ ok: true, ...result });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'failed to link knowledge' }, 500);
  }
});

app.post('/api/knowledge/nodes/:id/analyze', c => {
  try {
    const node = reanalyzeKnowledgeNode(c.req.param('id'));
    return c.json({ ok: true, node, tree: listKnowledgeTree() });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'failed to analyze knowledge node' }, 500);
  }
});

export default app;
