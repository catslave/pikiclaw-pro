import type { NotePage, ProTask, SessionInfo, TodoItem } from '../../types';

export type WorkItemSourceEvidenceCandidateKind = 'inbox-note' | 'quote' | 'session' | 'workspace' | 'linked-chat';

export interface WorkItemSourceEvidenceCandidate {
  id: string;
  kind: WorkItemSourceEvidenceCandidateKind;
  label: string;
  value: string;
  detail?: string;
}

function pushCandidate(
  output: WorkItemSourceEvidenceCandidate[],
  seen: Set<string>,
  candidate: WorkItemSourceEvidenceCandidate,
) {
  const key = `${candidate.kind}\u0000${candidate.value.trim()}`;
  if (!candidate.value.trim() || seen.has(key)) return;
  seen.add(key);
  output.push(candidate);
}

function pathBaseName(value: string | undefined): string {
  const text = (value || '').trim().replace(/\/+$/, '');
  return text.split('/').filter(Boolean).pop() || text;
}

function compactSessionLabel(agent: string, sessionId: string): string {
  const clean = sessionId.trim();
  return `${agent}:${clean.length > 14 ? `${clean.slice(0, 11)}...` : clean}`;
}

function sessionCandidateLabel(session: SessionInfo): string {
  const agent = session.agent || 'session';
  const fallback = compactSessionLabel(agent, session.sessionId);
  const title = (session.title || '').replace(/\s+/g, ' ').trim();
  if (!title || /^#?\s*files mentioned by the user/i.test(title) || /codex-clipboard/i.test(title)) return fallback;
  return title.length > 42 ? `${title.slice(0, 39).trimEnd()}...` : title;
}

export function buildWorkItemSourceEvidenceCandidates(input: {
  task: ProTask;
  sourceTodo?: TodoItem | null;
  recentSessions?: SessionInfo[];
  notes?: NotePage[];
  limit?: number;
}): WorkItemSourceEvidenceCandidate[] {
  const { task, sourceTodo = null, recentSessions = [], notes = [], limit = 8 } = input;
  const candidates: WorkItemSourceEvidenceCandidate[] = [];
  const seen = new Set<string>();

  pushCandidate(candidates, seen, {
    id: 'workspace:task',
    kind: 'workspace',
    label: pathBaseName(task.workdir) || 'Current workspace',
    value: task.workdir || '',
    detail: task.workdir,
  });

  pushCandidate(candidates, seen, {
    id: 'todo:quote',
    kind: 'quote',
    label: 'Todo quote',
    value: sourceTodo?.source?.quote || '',
    detail: sourceTodo?.title,
  });

  if (sourceTodo?.source?.agent && sourceTodo.source.sessionId) {
    pushCandidate(candidates, seen, {
      id: 'todo:session',
      kind: 'session',
      label: compactSessionLabel(sourceTodo.source.agent, sourceTodo.source.sessionId),
      value: `${sourceTodo.source.agent}:${sourceTodo.source.sessionId}${typeof sourceTodo.source.turnIndex === 'number' ? ` turn ${sourceTodo.source.turnIndex}` : ''}`,
      detail: sourceTodo.title,
    });
  }

  if (sourceTodo?.linkedChat?.agent && sourceTodo.linkedChat.sessionId) {
    pushCandidate(candidates, seen, {
      id: 'todo:linked-chat',
      kind: 'linked-chat',
      label: compactSessionLabel(sourceTodo.linkedChat.agent, sourceTodo.linkedChat.sessionId),
      value: `${sourceTodo.linkedChat.agent}:${sourceTodo.linkedChat.sessionId}`,
      detail: sourceTodo.linkedChat.workdir,
    });
  }

  for (const run of task.stageRuns || []) {
    if (!run.session?.agent || !run.session.sessionId) continue;
    pushCandidate(candidates, seen, {
      id: `stage:${run.id}`,
      kind: 'session',
      label: `${run.stage} · ${run.session.agent}`,
      value: `${run.session.agent}:${run.session.sessionId}`,
      detail: run.status,
    });
    if (candidates.length >= limit) return candidates.slice(0, limit);
  }

  for (const session of recentSessions) {
    if (!session.agent || !session.sessionId) continue;
    pushCandidate(candidates, seen, {
      id: `recent-session:${session.agent}:${session.sessionId}`,
      kind: 'session',
      label: sessionCandidateLabel(session),
      value: `${session.agent}:${session.sessionId}`,
      detail: session.workdir,
    });
    if (candidates.length >= limit) return candidates.slice(0, limit);
  }

  for (const note of notes.filter(item => !item.deletedAt).slice(0, 3)) {
    pushCandidate(candidates, seen, {
      id: `note:${note.id}`,
      kind: 'inbox-note',
      label: note.title,
      value: note.title,
      detail: note.kind === 'daily' && note.date ? note.date : note.kind,
    });
    if (candidates.length >= limit) return candidates.slice(0, limit);
  }

  return candidates.slice(0, limit);
}
