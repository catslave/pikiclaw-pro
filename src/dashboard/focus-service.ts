/**
 * Focus background extraction service shared by dashboard routes and runtime hooks.
 */

import type { Agent, SessionContextSource, SessionInfo, SessionOutput } from '../agent/index.js';
import { findPikiclawSessionInfo } from '../agent/index.js';
import { queueDashboardSessionTask } from './session-control.js';
import {
  candidateFromSession,
  createExtractionDeduper,
  focusSessionKey,
  getSessionValueSignals,
  hasKnowledgeForSession,
  outputToArtifactRef,
  sessionToSourceRef,
} from '../pro/focus.js';
import {
  getAgentAssistant,
  getJiraWorkflowConfig,
  listAgentAssistants,
  listKnowledgeEntries,
} from '../pro/workflow.js';

const extractionDeduper = createExtractionDeduper();

function isFocusExtractionSession(session: SessionInfo): boolean {
  return typeof session.origin?.chatId === 'string' && session.origin.chatId.startsWith('focus-knowledge:');
}

function resolveKnowledgeAgent(fallbackAgent: string | null | undefined): string | null {
  const config = getJiraWorkflowConfig();
  const assistant = getAgentAssistant(config.knowledgeAssistantId || 'assistant_knowledge')
    || listAgentAssistants().find(item => item.id === 'assistant_knowledge');
  return assistant?.preferredAgents?.find(Boolean) || fallbackAgent || null;
}

function buildExtractionPrompt(session: SessionInfo, outputs: SessionOutput[]) {
  const sourceRef = sessionToSourceRef(session);
  const artifactRefs = outputs.map(output => outputToArtifactRef(output, session));
  const signals = getSessionValueSignals(session).map(item => item.label).join(', ') || 'none';
  return [
    'Extract durable Pikiclaw Focus knowledge from the attached source chat context.',
    '',
    'Create 1-3 reusable knowledge cards only if the source chat contains durable value: decisions, implementation notes, project-specific mental models, useful outputs, blockers, or reusable reasoning.',
    'Every card must be source-grounded. Do not invent facts. Keep cards concise and useful for continuing future work.',
    '',
    'Persist each card by calling `pikiclaw_pro_save_knowledge`.',
    'Use kind `knowledge-card` for reusable ideas or `session-digest` for a compact source-chat digest.',
    'Use status `published`, createdBy is handled by the tool, and confidence should be low/medium/high.',
    'Include the exact sourceRefs and artifactRefs below when relevant. Save at most 3 cards.',
    '',
    `Source chat ref:\n${JSON.stringify(sourceRef, null, 2)}`,
    artifactRefs.length ? `Artifact refs:\n${JSON.stringify(artifactRefs, null, 2)}` : 'Artifact refs: []',
    '',
    `Signals: ${signals}`,
    `Source title: ${session.title || session.lastQuestion || 'Untitled chat'}`,
    session.classification?.summary ? `Classification summary: ${session.classification.summary}` : '',
  ].filter(Boolean).join('\n');
}

export async function queueFocusExtraction(session: SessionInfo, force = false) {
  if (!session.workdir || !session.agent || !session.sessionId) return { ok: false as const, error: 'source session is incomplete' };
  const key = focusSessionKey(session.workdir, session.agent, session.sessionId);
  const knowledge = listKnowledgeEntries({ status: 'published' });
  if (!force && hasKnowledgeForSession(knowledge, session)) return { ok: true as const, queued: false, skipped: 'already-extracted', key };
  if (!force && isFocusExtractionSession(session)) return { ok: true as const, queued: false, skipped: 'focus-extraction-session', key };
  if (!force && !extractionDeduper.shouldQueue(key)) return { ok: true as const, queued: false, skipped: 'already-queued', key };
  const candidate = force ? { session } : candidateFromSession(session);
  if (!candidate) return { ok: true as const, queued: false, skipped: 'not-a-candidate', key };

  extractionDeduper.markQueued(key);
  const source: SessionContextSource = {
    kind: 'session',
    workdir: session.workdir,
    agent: session.agent,
    sessionId: session.sessionId,
    title: session.title || session.lastQuestion || 'Source chat',
    mode: 'compact',
  };
  const result = await queueDashboardSessionTask({
    workdir: session.workdir,
    agent: resolveKnowledgeAgent(session.agent),
    sessionId: '',
    prompt: buildExtractionPrompt(session, session.outputs || []),
    origin: { channel: 'task', chatId: `focus-knowledge:${key}` },
    contextSources: [source],
  });
  if (!result.ok) {
    extractionDeduper.forget(key);
    return { ok: false as const, queued: false, key, error: result.error };
  }
  return { ok: true as const, queued: true, key, task: result };
}

export async function queueFocusExtractionByRef(workdir: string, agent: Agent, sessionId: string, force = false) {
  const session = findPikiclawSessionInfo(workdir, agent, sessionId);
  if (!session) return { ok: false as const, queued: false, key: focusSessionKey(workdir, agent, sessionId), error: 'session not found' };
  return queueFocusExtraction(session, force);
}
