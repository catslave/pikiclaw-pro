export type WorkItemCaptureSource = 'manual' | 'todo' | 'jira-ticket';

export type WorkItemCaptureEvidencePresetKey =
  | 'images'
  | 'inbox-note'
  | 'linked-chat'
  | 'quote'
  | 'session'
  | 'workspace';

export interface WorkItemCaptureEvidencePreset {
  key: WorkItemCaptureEvidencePresetKey;
  label: string;
  sectionLabel: string;
  template: string;
}

export type WorkItemCaptureEvidenceCandidateKind =
  | 'image'
  | 'inbox-note'
  | 'linked-chat'
  | 'project-reference'
  | 'quote'
  | 'session'
  | 'workspace';

export interface WorkItemCaptureEvidenceCandidate {
  id: string;
  kind: WorkItemCaptureEvidenceCandidateKind;
  label: string;
  value: string;
  detail?: string;
}

export interface WorkItemCaptureRecentSessionInput {
  agent?: string | null;
  sessionId?: string | null;
  title?: string | null;
  workdir?: string | null;
  workspaceName?: string | null;
}

export interface WorkItemCaptureFileInput {
  name?: string | null;
  path?: string | null;
  type?: string | null;
}

const PRESETS: Record<WorkItemCaptureEvidencePresetKey, WorkItemCaptureEvidencePreset> = {
  'inbox-note': {
    key: 'inbox-note',
    label: 'Inbox note',
    sectionLabel: 'Inbox note',
    template: 'Inbox note: ',
  },
  quote: {
    key: 'quote',
    label: 'Quote',
    sectionLabel: 'Quoted source',
    template: 'Quoted source: ',
  },
  session: {
    key: 'session',
    label: 'Session',
    sectionLabel: 'Source session',
    template: 'Source session: agent:session-id',
  },
  workspace: {
    key: 'workspace',
    label: 'Workspace',
    sectionLabel: 'Source workspace',
    template: 'Source workspace: /path/to/workspace',
  },
  'linked-chat': {
    key: 'linked-chat',
    label: 'Linked chat',
    sectionLabel: 'Linked chat',
    template: 'Linked chat: agent:session-id',
  },
  images: {
    key: 'images',
    label: 'Image',
    sectionLabel: 'Images',
    template: 'Images:\n- screenshot.png',
  },
};

const SOURCE_PRESETS: Record<WorkItemCaptureSource, WorkItemCaptureEvidencePresetKey[]> = {
  manual: ['quote', 'session', 'workspace', 'images'],
  todo: ['inbox-note', 'quote', 'linked-chat', 'images'],
  'jira-ticket': ['quote', 'session', 'images', 'workspace'],
};

export function workItemCaptureEvidencePresets(source: WorkItemCaptureSource): WorkItemCaptureEvidencePreset[] {
  return SOURCE_PRESETS[source].map(key => PRESETS[key]);
}

export function workItemCaptureDescriptionHasPreset(description: string, preset: WorkItemCaptureEvidencePreset): boolean {
  const marker = `${preset.sectionLabel}:`;
  return description
    .split('\n')
    .some(line => line.trim().startsWith(marker));
}

export function appendWorkItemCaptureEvidencePreset(
  description: string,
  preset: WorkItemCaptureEvidencePreset,
): string {
  if (workItemCaptureDescriptionHasPreset(description, preset)) return description;
  const clean = description.trimEnd();
  return clean ? `${clean}\n\n${preset.template}` : preset.template;
}

function candidateSectionLabel(kind: WorkItemCaptureEvidenceCandidateKind): string {
  if (kind === 'image') return 'Images';
  if (kind === 'inbox-note') return 'Inbox note';
  if (kind === 'quote') return 'Quoted source';
  if (kind === 'linked-chat') return 'Linked chat';
  if (kind === 'session') return 'Source session';
  if (kind === 'project-reference') return 'Source workspace';
  return 'Source workspace';
}

function candidateLine(candidate: WorkItemCaptureEvidenceCandidate): string {
  if (candidate.kind === 'image') return `Images:\n- ${candidate.value}`;
  return `${candidateSectionLabel(candidate.kind)}: ${candidate.value}`;
}

function cleanLabel(value: string | null | undefined, fallback: string): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text || /^#?\s*files mentioned by the user/i.test(text) || /codex-clipboard/i.test(text)) return fallback;
  return text.length > 36 ? `${text.slice(0, 33).trimEnd()}...` : text;
}

function pushCandidate(
  output: WorkItemCaptureEvidenceCandidate[],
  seen: Set<string>,
  candidate: WorkItemCaptureEvidenceCandidate,
) {
  const value = candidate.value.trim();
  if (!value) return;
  const key = `${candidate.kind}\u0000${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push({ ...candidate, value });
}

export function buildWorkItemCaptureEvidenceCandidates(input: {
  source: WorkItemCaptureSource;
  workdir?: string;
  workspaceName?: string;
  recent?: WorkItemCaptureRecentSessionInput[];
  attachments?: WorkItemCaptureFileInput[];
  references?: WorkItemCaptureFileInput[];
  limit?: number;
}): WorkItemCaptureEvidenceCandidate[] {
  const { source, workdir = '', workspaceName = '', recent = [], attachments = [], references = [], limit = 7 } = input;
  const candidates: WorkItemCaptureEvidenceCandidate[] = [];
  const seen = new Set<string>();

  pushCandidate(candidates, seen, {
    id: 'workspace:current',
    kind: 'workspace',
    label: workspaceName || 'Current workspace',
    value: workdir,
    detail: workdir,
  });

  for (const file of attachments.slice(0, 4)) {
    const name = (file.name || '').trim();
    const type = (file.type || '').trim();
    if (!name) continue;
    pushCandidate(candidates, seen, {
      id: `attachment:${name}`,
      kind: type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name) ? 'image' : 'inbox-note',
      label: name,
      value: name,
      detail: type || 'Attachment',
    });
  }

  for (const file of references.slice(0, 4)) {
    const name = (file.name || '').trim();
    const path = (file.path || '').trim();
    if (!name && !path) continue;
    pushCandidate(candidates, seen, {
      id: `reference:${path || name}`,
      kind: 'project-reference',
      label: name || path.split('/').filter(Boolean).pop() || 'Reference',
      value: path || name,
      detail: 'Project reference',
    });
  }

  for (const item of recent) {
    const agent = (item.agent || '').trim();
    const sessionId = (item.sessionId || '').trim();
    if (!agent || !sessionId) continue;
    const value = `${agent}:${sessionId}`;
    const sameWorkspace = !workdir || item.workdir === workdir;
    const label = cleanLabel(item.title, `${agent}:${sessionId.length > 14 ? `${sessionId.slice(0, 11)}...` : sessionId}`);
    pushCandidate(candidates, seen, {
      id: `recent:${agent}:${sessionId}`,
      kind: source === 'todo' && sameWorkspace ? 'linked-chat' : 'session',
      label,
      value,
      detail: item.workspaceName || item.workdir || '',
    });
    if (candidates.length >= limit) break;
  }

  return candidates.slice(0, limit);
}

export function appendWorkItemCaptureEvidenceCandidate(
  description: string,
  candidate: WorkItemCaptureEvidenceCandidate,
): string {
  const line = candidateLine(candidate);
  if (candidate.kind === 'image') {
    const imageLine = `- ${candidate.value}`;
    const lines = description.split('\n');
    if (lines.some(item => item.trim() === imageLine)) return description;
    const imageIndex = lines.findIndex(item => item.trim() === 'Images:');
    if (imageIndex >= 0) {
      const next = [...lines];
      let insertAt = imageIndex + 1;
      while (insertAt < next.length && next[insertAt].trim().startsWith('- ')) insertAt += 1;
      next.splice(insertAt, 0, imageLine);
      return next.join('\n').trimEnd();
    }
  }
  if (description.split('\n').some(item => item.trim() === line)) return description;
  const clean = description.trimEnd();
  return clean ? `${clean}\n\n${line}` : line;
}

export function workItemCaptureDescriptionHasCandidate(
  description: string,
  candidate: WorkItemCaptureEvidenceCandidate,
): boolean {
  if (candidate.kind === 'image') {
    return description
      .split('\n')
      .some(item => item.trim() === `- ${candidate.value}`);
  }
  const line = candidateLine(candidate);
  return description
    .split('\n')
    .some(item => item.trim() === line);
}
