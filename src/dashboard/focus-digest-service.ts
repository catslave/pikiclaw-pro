/**
 * Incremental session digest service for Focus sandboxes.
 */

import type { SessionInfo } from '../agent/index.js';
import { findPikiclawSessionInfo } from '../agent/index.js';
import { queueDashboardSessionTask } from './session-control.js';
import {
  createExtractionDeduper,
  focusSessionKey,
  sessionToSourceRef,
} from '../pro/focus.js';
import type { KnowledgeEntry } from '../pro/workflow.js';
import {
  getAgentAssistant,
  getJiraWorkflowConfig,
  listAgentAssistants,
  listKnowledgeEntries,
} from '../pro/workflow.js';

const digestDeduper = createExtractionDeduper();
const DIGEST_STALE_MS = 24 * 60 * 60 * 1000;

function isFocusExtractionSession(session: SessionInfo): boolean {
  return typeof session.origin?.chatId === 'string' && session.origin.chatId.startsWith('focus-knowledge:');
}

function isFocusDigestSession(session: SessionInfo): boolean {
  return typeof session.origin?.chatId === 'string' && session.origin.chatId.startsWith('focus-digest:');
}

function resolveDigestAgent(fallbackAgent: string | null | undefined): string | null {
  const config = getJiraWorkflowConfig();
  const assistant = getAgentAssistant(config.knowledgeAssistantId || 'assistant_knowledge')
    || listAgentAssistants().find(item => item.id === 'assistant_knowledge');
  return assistant?.preferredAgents?.find(Boolean) || fallbackAgent || null;
}

function digestEntryForSession(entries: KnowledgeEntry[], session: SessionInfo): KnowledgeEntry | null {
  const key = focusSessionKey(session.workdir || '', session.agent || '', session.sessionId || '');
  const matches = entries
    .filter(entry => entry.kind === 'session-digest')
    .filter(entry => (entry.sourceRefs || []).some(ref => ref.type === 'chat'
      && ref.workdir === session.workdir
      && ref.agent === session.agent
      && ref.sessionId === session.sessionId))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  return matches[0] || null;
}

export function buildDigestIndex(entries: KnowledgeEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== 'session-digest') continue;
    for (const ref of entry.sourceRefs || []) {
      if (ref.type !== 'chat' || !ref.workdir || !ref.agent || !ref.sessionId) continue;
      const key = focusSessionKey(ref.workdir, ref.agent, ref.sessionId);
      if (!map.has(key)) map.set(key, entry.body);
    }
  }
  return map;
}

export function isDigestStale(entry: KnowledgeEntry | null, session: SessionInfo, now = Date.now()): boolean {
  if (!entry) return true;
  const updated = Date.parse(entry.updatedAt || entry.createdAt || '') || 0;
  const sessionUpdated = Date.parse(session.runUpdatedAt || session.createdAt || '') || 0;
  if (sessionUpdated > updated) return true;
  return now - updated > DIGEST_STALE_MS;
}

function buildDigestPrompt(session: SessionInfo) {
  const sourceRef = sessionToSourceRef(session);
  return [
    'Create one compact session digest for the Focus command center.',
    'Summarize current progress, blockers, next step, and any file/line breakpoint the user should resume from.',
    'Keep it under 180 words. Be concrete and action-oriented.',
    '',
    'Persist by calling `pikiclaw_pro_save_knowledge` exactly once with:',
    '- kind: `session-digest`',
    '- status: `published`',
    '- title: short resume title',
    '- body: the digest text',
    '- sourceRefs: include the source chat ref below',
    '',
    `Source chat ref:\n${JSON.stringify(sourceRef, null, 2)}`,
    `Source title: ${session.title || session.lastQuestion || 'Untitled chat'}`,
    session.classification?.summary ? `Classification summary: ${session.classification.summary}` : '',
  ].filter(Boolean).join('\n');
}

export async function queueFocusDigest(session: SessionInfo, force = false) {
  if (!session.workdir || !session.agent || !session.sessionId) {
    return { ok: false as const, error: 'source session is incomplete' };
  }
  const key = focusSessionKey(session.workdir, session.agent, session.sessionId);
  if (isFocusExtractionSession(session) || isFocusDigestSession(session)) {
    return { ok: true as const, queued: false, skipped: 'focus-background-session', key };
  }
  const knowledge = listKnowledgeEntries({ status: 'published' });
  const existing = digestEntryForSession(knowledge, session);
  if (!force && existing && !isDigestStale(existing, session)) {
    return { ok: true as const, queued: false, skipped: 'digest-fresh', key };
  }
  const dedupeKey = `digest:${key}`;
  if (!force && !digestDeduper.shouldQueue(dedupeKey)) {
    return { ok: true as const, queued: false, skipped: 'already-queued', key };
  }
  digestDeduper.markQueued(dedupeKey);
  const result = await queueDashboardSessionTask({
    workdir: session.workdir,
    agent: resolveDigestAgent(session.agent),
    sessionId: '',
    prompt: buildDigestPrompt(session),
    origin: { channel: 'task', chatId: `focus-digest:${key}` },
    contextSources: [{
      kind: 'session',
      workdir: session.workdir,
      agent: session.agent,
      sessionId: session.sessionId,
      title: session.title || session.lastQuestion || 'Source chat',
      mode: 'compact',
    }],
  });
  if (!result.ok) {
    digestDeduper.forget(dedupeKey);
    return { ok: false as const, queued: false, key, error: result.error };
  }
  return { ok: true as const, queued: true, key };
}

export async function queueFocusDigestByRef(workdir: string, agent: string, sessionId: string, force = false) {
  const session = findPikiclawSessionInfo(workdir, agent as SessionInfo['agent'], sessionId);
  if (!session) return { ok: false as const, queued: false, key: focusSessionKey(workdir, agent, sessionId), error: 'session not found' };
  return queueFocusDigest(session, force);
}

export async function queueStaleDigests(sessions: SessionInfo[], force = false) {
  const knowledge = listKnowledgeEntries({ status: 'published' });
  const queued: string[] = [];
  const skipped: string[] = [];
  for (const session of sessions) {
    const key = focusSessionKey(session.workdir || '', session.agent || '', session.sessionId || '');
    const existing = digestEntryForSession(knowledge, session);
    if (!force && existing && !isDigestStale(existing, session)) {
      skipped.push(key);
      continue;
    }
    const result = await queueFocusDigest(session, force);
    if (result.ok && result.queued) queued.push(key);
    else if (result.ok && result.skipped) skipped.push(key);
  }
  return { queued, skipped };
}

export function getSessionDigestBody(session: SessionInfo, entries?: KnowledgeEntry[]): string | null {
  const knowledge = entries || listKnowledgeEntries({ status: 'published' });
  return digestEntryForSession(knowledge, session)?.body || null;
}
