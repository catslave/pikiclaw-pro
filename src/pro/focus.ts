import type { Agent, SessionInfo, SessionOutput } from '../agent/types.js';
import type { KnowledgeArtifactRef, KnowledgeEntry, KnowledgeSourceRef } from './workflow.js';

export interface FocusSessionSignal {
  key: string;
  label: string;
}

export interface FocusSessionCandidate {
  session: SessionInfo;
  workdir: string;
  agent: Agent | string;
  sessionId: string;
  signals: FocusSessionSignal[];
}

export interface ExtractionDeduper {
  shouldQueue(key: string): boolean;
  markQueued(key: string): void;
  forget(key: string): void;
}

export function focusSessionKey(workdir: string | null | undefined, agent: string | null | undefined, sessionId: string | null | undefined): string {
  return [workdir || '', agent || '', sessionId || ''].join('::');
}

function sessionIdOf(session: SessionInfo): string {
  return typeof session.sessionId === 'string' ? session.sessionId : '';
}

function agentOf(session: SessionInfo): string {
  return typeof session.agent === 'string' ? session.agent : '';
}

function workdirOf(session: SessionInfo): string {
  return typeof session.workdir === 'string' ? session.workdir : '';
}

function signal(key: string, label: string): FocusSessionSignal {
  return { key, label };
}

export function getSessionValueSignals(session: SessionInfo): FocusSessionSignal[] {
  const signals: FocusSessionSignal[] = [];
  if (session.outputs?.length) signals.push(signal('outputs', 'Outputs'));
  if (session.lastPlan) signals.push(signal('plan', 'Plan'));
  const outcome = session.classification?.outcome;
  if (outcome === 'proposal') signals.push(signal('proposal', 'Proposal'));
  if (outcome === 'implementation') signals.push(signal('implementation', 'Implementation'));
  if (outcome === 'partial') signals.push(signal('partial', 'Partial work'));
  if (outcome === 'blocked') signals.push(signal('blocked', 'Blocked'));
  if (session.sideChats?.length) signals.push(signal('side-chats', 'Side chats'));
  if (session.titleSource === 'user' && session.title) signals.push(signal('user-title', 'Renamed'));
  if (session.userNote?.trim()) signals.push(signal('note', 'Note'));
  if (session.pinned) signals.push(signal('pinned', 'Pinned'));
  if (session.contextSources?.length) signals.push(signal('context-sources', 'Context'));
  if (session.migratedFrom || session.migratedTo || session.linkedSessions?.length) signals.push(signal('lineage', 'Lineage'));
  if (session.runState === 'incomplete') signals.push(signal('incomplete', 'Incomplete'));
  if (session.userStatus === 'review') signals.push(signal('review', 'Review'));
  return signals;
}

export function isKnowledgeCandidate(session: SessionInfo): boolean {
  if (!sessionIdOf(session) || !agentOf(session) || !workdirOf(session)) return false;
  if (session.archived) return false;
  if (session.runState !== 'completed') return false;
  const signals = getSessionValueSignals(session);
  return signals.some(item => item.key !== 'incomplete' && item.key !== 'review');
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isAutoSinkEligible(session: SessionInfo, now = new Date()): boolean {
  if (!sessionIdOf(session) || !agentOf(session) || !workdirOf(session)) return false;
  if (session.archived) return false;
  if (session.runState !== 'completed') return false;
  if (session.userStatus !== 'done' && session.userStatus !== 'parked') return false;
  if (!session.userStatusUpdatedAt) return false;
  if (getSessionValueSignals(session).length > 0) return false;
  const handledAt = Date.parse(session.userStatusUpdatedAt);
  if (!Number.isFinite(handledAt)) return false;
  return handledAt < startOfLocalDay(now).getTime();
}

function sourceMatchesSession(ref: KnowledgeSourceRef | undefined, workdir: string, agent: string, sessionId: string): boolean {
  return !!ref
    && ref.type === 'chat'
    && ref.workdir === workdir
    && ref.agent === agent
    && ref.sessionId === sessionId;
}

export function hasKnowledgeForSession(entries: KnowledgeEntry[], session: SessionInfo): boolean {
  const workdir = workdirOf(session);
  const agent = agentOf(session);
  const sessionId = sessionIdOf(session);
  if (!workdir || !agent || !sessionId) return false;
  return entries.some(entry => (
    entry.status !== 'hidden'
    && (
      sourceMatchesSession(entry.source, workdir, agent, sessionId)
      || (entry.sourceRefs || []).some(ref => sourceMatchesSession(ref, workdir, agent, sessionId))
    )
  ));
}

export function sessionToSourceRef(session: SessionInfo): KnowledgeSourceRef {
  return {
    type: 'chat',
    workdir: workdirOf(session),
    agent: agentOf(session),
    sessionId: sessionIdOf(session),
    title: session.title || session.lastQuestion || undefined,
  };
}

export function outputToArtifactRef(output: SessionOutput, session: SessionInfo): KnowledgeArtifactRef {
  return {
    kind: output.kind,
    title: output.title,
    outputId: output.id,
    workdir: output.session?.workdir || workdirOf(session),
    agent: output.session?.agent || agentOf(session),
    sessionId: output.session?.sessionId || sessionIdOf(session),
    path: output.path,
    url: output.url,
  };
}

export function candidateFromSession(session: SessionInfo): FocusSessionCandidate | null {
  if (!isKnowledgeCandidate(session)) return null;
  return {
    session,
    workdir: workdirOf(session),
    agent: agentOf(session),
    sessionId: sessionIdOf(session),
    signals: getSessionValueSignals(session),
  };
}

export function createExtractionDeduper(initialKeys: Iterable<string> = []): ExtractionDeduper {
  const queued = new Set(initialKeys);
  return {
    shouldQueue(key: string) {
      return !!key && !queued.has(key);
    },
    markQueued(key: string) {
      if (key) queued.add(key);
    },
    forget(key: string) {
      queued.delete(key);
    },
  };
}
