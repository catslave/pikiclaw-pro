import type { ProTask } from '../../types';

export type WorkItemSourceEvidenceKind =
  | 'daily'
  | 'image'
  | 'jira-comment'
  | 'jira-link'
  | 'jira-ticket'
  | 'linked-chat'
  | 'linked-task'
  | 'note'
  | 'quote'
  | 'session'
  | 'workspace';

export interface WorkItemSourceEvidence {
  id: string;
  kind: WorkItemSourceEvidenceKind;
  label: string;
  value: string;
  detail?: string;
  url?: string;
}

export interface WorkItemEvidenceSessionRef {
  agent: string;
  sessionId: string;
}

const SECTION_LABELS = [
  'Inbox note',
  'Quoted source',
  'Images',
  'Source session',
  'Source workspace',
  'Linked chat',
] as const;

function normalizeText(value: unknown, max = 4000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function descriptionSections(description: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: typeof SECTION_LABELS[number] | null = null;
  for (const rawLine of description.split('\n')) {
    const line = rawLine.trim();
    const label = SECTION_LABELS.find(item => line.startsWith(`${item}:`));
    if (label) {
      current = label;
      const value = line.slice(label.length + 1).trim();
      sections.set(label, value);
      continue;
    }
    if (current) {
      const previous = sections.get(current) || '';
      sections.set(current, [previous, line].filter(Boolean).join('\n'));
    }
  }
  return sections;
}

function firstLine(value: string): string {
  return value.split('\n').map(line => line.trim()).find(Boolean) || value.trim();
}

function imageEvidence(value: string): WorkItemSourceEvidence[] {
  return value
    .split('\n')
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line, index) => ({
      id: `image:${index}:${line}`,
      kind: 'image' as const,
      label: index === 0 ? 'Images' : 'Image',
      value: line,
    }));
}

function readString(value: unknown, max = 1000): string {
  if (typeof value === 'string') return normalizeText(value, max);
  if (typeof value === 'number' || typeof value === 'boolean') return normalizeText(String(value), max);
  return '';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function namedValue(value: unknown): string {
  const record = readRecord(value);
  if (record) return readString(record.name || record.displayName || record.value || record.key || record.title);
  return readString(value);
}

function textFromAdf(value: unknown): string {
  if (typeof value === 'string') return normalizeText(value, 1200);
  const record = readRecord(value);
  if (!record) return '';
  const text = readString(record.text, 1200);
  if (text) return text;
  return readArray(record.content)
    .map(textFromAdf)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function jiraBrowseUrl(key: string): string {
  return `https://jira.ringcentral.com/browse/${encodeURIComponent(key)}`;
}

function savedPrEvidence(prUrl: unknown): WorkItemSourceEvidence[] {
  const url = readString(prUrl, 2048);
  if (!url) return [];
  return [{
    id: `saved-pr:${url}`,
    kind: 'jira-link',
    label: 'Saved MR / PR',
    value: url,
    url,
  }];
}

function jiraCommentEvidence(raw: Record<string, unknown>): WorkItemSourceEvidence[] {
  const commentSource = readRecord(raw.comment)?.comments || raw.comments || raw.comment;
  const comments = readArray(commentSource).length ? readArray(commentSource) : readArray(raw.comments);
  return comments
    .map((item, index) => {
      const comment = readRecord(item);
      if (!comment) return null;
      const body = textFromAdf(comment.body || comment.text || comment.comment || comment.value);
      if (!body) return null;
      const author = namedValue(comment.author || comment.updateAuthor || comment.creator);
      const created = readString(comment.created || comment.updated, 80);
      const suffix = [author, created].filter(Boolean).join(' - ');
      return {
        id: `jira-comment:${readString(comment.id, 120) || index}:${body.slice(0, 80)}`,
        kind: 'jira-comment' as const,
        label: suffix ? `Jira comment - ${suffix}` : 'Jira comment',
        value: firstLine(body),
        detail: body,
      };
    })
    .filter((item): item is WorkItemSourceEvidence => !!item)
    .slice(0, 4);
}

function linkedIssueEvidence(raw: Record<string, unknown>): WorkItemSourceEvidence[] {
  return readArray(raw.issuelinks || raw.issueLinks || raw.linkedIssues || raw.links)
    .map((item, index) => {
      const link = readRecord(item);
      if (!link) return null;
      const issue = readRecord(link.outwardIssue) || readRecord(link.inwardIssue) || readRecord(link.issue) || readRecord(link.object) || link;
      const key = readString(issue.key || issue.jiraKey || issue.issueKey, 80);
      const fields = readRecord(issue.fields);
      const title = readString(fields?.summary || issue.summary || issue.title || issue.name, 240);
      const url = readString(issue.url || issue.jiraUrl || issue.webUrl, 2048) || (key ? jiraBrowseUrl(key) : '');
      const relation = namedValue(readRecord(link.type)?.outward || readRecord(link.type)?.inward || link.relationship || link.relation || link.type);
      if (!key && !title && !url) return null;
      return {
        id: `jira-link:${key || url || index}`,
        kind: 'jira-link' as const,
        label: relation ? `Linked issue - ${relation}` : 'Linked issue',
        value: key || title || url,
        detail: [key && title ? `${key} - ${title}` : title, url].filter(Boolean).join('\n') || undefined,
        url: url || undefined,
      };
    })
    .filter((item): item is WorkItemSourceEvidence => !!item)
    .slice(0, 6);
}

function collectDevelopmentLinks(value: unknown, output: unknown[] = []): unknown[] {
  const array = readArray(value);
  if (array.length) {
    output.push(...array);
    return output;
  }
  const record = readRecord(value);
  if (!record) return output;
  if (record.url || record.href || record.object) output.push(record);
  const nestedKeys = [
    'pullRequests',
    'pullrequests',
    'mergeRequests',
    'merge_requests',
    'branches',
    'commits',
    'reviews',
    'builds',
    'deployments',
    'values',
    'nodes',
    'items',
  ];
  for (const key of nestedKeys) collectDevelopmentLinks(record[key], output);
  return output;
}

function remoteLinkEvidence(raw: Record<string, unknown>): WorkItemSourceEvidence[] {
  const candidates = [
    ...readArray(raw.remoteLinks),
    ...readArray(raw.remotelinks),
    ...readArray(raw.remote_links),
    ...readArray(raw.developmentLinks),
    ...readArray(raw.devLinks),
    ...readArray(raw.development),
    ...collectDevelopmentLinks(raw.developmentPanel),
    ...collectDevelopmentLinks(raw.developmentStatus),
    ...collectDevelopmentLinks(raw.devStatus),
    ...collectDevelopmentLinks(raw.development),
  ];
  const seen = new Set<string>();
  return candidates
    .map((item, index) => {
      const link = readRecord(item);
      if (!link) return null;
      const object = readRecord(link.object) || link;
      const url = readString(object.url || object.href || link.url || link.href, 2048);
      const title = readString(
        object.title
        || object.name
        || object.displayId
        || object.id
        || object.message
        || link.title
        || link.name
        || link.displayId
        || link.id,
        240,
      ) || url;
      if (!url && !title) return null;
      const dedupeKey = `${url || ''}\u0000${title || ''}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      const type = readString(object.type || object.kind || link.type || link.kind, 80);
      return {
        id: `jira-remote-link:${url || title || index}`,
        kind: 'jira-link' as const,
        label: type ? `Jira ${type} link` : 'Jira remote link',
        value: title,
        detail: url && title !== url ? `${title}\n${url}` : undefined,
        url: url || undefined,
      };
    })
    .filter((item): item is WorkItemSourceEvidence => !!item)
    .slice(0, 6);
}

function jiraEvidence(task: Pick<ProTask, 'jiraKey' | 'jiraUrl' | 'jiraFields' | 'origin'>): WorkItemSourceEvidence[] {
  const evidence: WorkItemSourceEvidence[] = [];
  const key = readString(task.jiraKey || task.origin?.key, 80);
  const url = readString(task.jiraUrl || task.origin?.url, 2048) || (key ? jiraBrowseUrl(key) : '');
  const fields = task.jiraFields;
  if (key || url) {
    const meta = [
      fields?.issueType,
      fields?.status,
      fields?.assignee ? `Assignee: ${fields.assignee}` : '',
      fields?.priority ? `Priority: ${fields.priority}` : '',
      fields?.updatedAt ? `Updated: ${fields.updatedAt}` : '',
    ].filter(Boolean).join(' - ');
    evidence.push({
      id: `jira-ticket:${key || url}`,
      kind: 'jira-ticket',
      label: 'Jira ticket',
      value: key || url,
      detail: meta || undefined,
      url: url || undefined,
    });
  }
  const raw = readRecord(fields?.raw);
  if (!raw) return evidence;
  evidence.push(...jiraCommentEvidence(raw));
  evidence.push(...linkedIssueEvidence(raw));
  evidence.push(...remoteLinkEvidence(raw));
  return evidence;
}

export function parseWorkItemEvidenceSessionRef(value: string): WorkItemEvidenceSessionRef | null {
  const raw = normalizeText(value, 1000);
  if (!raw) return null;
  const match = raw.match(/^([a-zA-Z0-9_.-]+)\s*[:/]\s*(.+)$/);
  const agent = match?.[1]?.trim();
  const sessionId = match?.[2]?.trim();
  if (!agent || !sessionId) return null;
  return { agent, sessionId };
}

export function workItemSourceEvidence(task: Pick<ProTask, 'description' | 'plannedDate' | 'linkedTaskId' | 'kind' | 'origin' | 'jiraKey' | 'jiraUrl' | 'jiraFields' | 'prUrl'>): WorkItemSourceEvidence[] {
  const evidence: WorkItemSourceEvidence[] = [];
  const description = normalizeText(task.description, 16_000);
  const sections = descriptionSections(description);
  const noteMatch = description.match(/^From note:\s*(.+)$/m);

  if (task.plannedDate) {
    evidence.push({
      id: `daily:${task.plannedDate}`,
      kind: 'daily',
      label: 'Daily plan',
      value: task.plannedDate,
      detail: task.linkedTaskId ? `Related task ${task.linkedTaskId}` : undefined,
    });
  }
  if (task.linkedTaskId) {
    evidence.push({
      id: `linked-task:${task.linkedTaskId}`,
      kind: 'linked-task',
      label: 'Linked Work Item',
      value: task.linkedTaskId,
    });
  }
  evidence.push(...jiraEvidence(task));
  evidence.push(...savedPrEvidence(task.prUrl));
  if (noteMatch?.[1]) {
    evidence.push({
      id: `note:${noteMatch[1]}`,
      kind: 'note',
      label: 'Source note',
      value: noteMatch[1].trim(),
    });
  }

  const inboxNote = sections.get('Inbox note');
  if (inboxNote) {
    evidence.push({
      id: 'inbox-note',
      kind: 'note',
      label: 'Inbox note',
      value: firstLine(inboxNote),
      detail: inboxNote,
    });
  }
  const quote = sections.get('Quoted source');
  if (quote) {
    evidence.push({
      id: 'quote',
      kind: 'quote',
      label: 'Quote',
      value: firstLine(quote),
      detail: quote,
    });
  }
  const images = sections.get('Images');
  if (images) evidence.push(...imageEvidence(images));
  const session = sections.get('Source session');
  if (session) {
    evidence.push({
      id: `session:${session}`,
      kind: 'session',
      label: 'Source session',
      value: session,
    });
  }
  const workspace = sections.get('Source workspace');
  if (workspace) {
    evidence.push({
      id: `workspace:${workspace}`,
      kind: 'workspace',
      label: 'Source workspace',
      value: workspace,
    });
  }
  const linkedChat = sections.get('Linked chat');
  if (linkedChat) {
    evidence.push({
      id: `linked-chat:${linkedChat}`,
      kind: 'linked-chat',
      label: 'Linked chat',
      value: linkedChat,
    });
  }

  return evidence;
}

export function workItemHasSourceEvidence(task: Pick<ProTask, 'description' | 'plannedDate' | 'linkedTaskId' | 'kind' | 'origin' | 'jiraKey' | 'jiraUrl' | 'jiraFields'>): boolean {
  return workItemSourceEvidence(task).length > 0;
}
