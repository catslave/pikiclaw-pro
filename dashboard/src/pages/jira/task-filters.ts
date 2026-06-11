import type { ProTask } from '../../types';

export type JiraTaskFilters = {
  ticketType: string;
  query: string;
  sprint: string;
  fixVersion: string;
  status?: string;
};

export type JiraTaskFilterOptions = {
  ticketTypes: string[];
  sprints: string[];
  fixVersions: string[];
  statuses: string[];
  sprintGroups: Array<{ sprint: string; tasks: ProTask[] }>;
};

function normalize(value: string | undefined | null): string {
  return (value || '').trim().toLowerCase();
}

const TICKET_TYPE_ORDER = ['Epic', 'Task', 'Story', 'Bug'];

function namedValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return namedValue(object.name)
      || namedValue(object.value)
      || namedValue(object.summary)
      || namedValue(object.key);
  }
  return '';
}

function collectSearchParts(value: unknown, parts: string[], seen: WeakSet<object>, depth = 0) {
  if (value == null || depth > 5) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) parts.push(text);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchParts(item, parts, seen, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key) parts.push(key);
      collectSearchParts(item, parts, seen, depth + 1);
    }
  }
}

export function jiraTaskSearchText(task: ProTask): string {
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  collectSearchParts([
    task.jiraKey,
    task.jiraUrl,
    task.localKey,
    task.title,
    task.description,
    task.kind,
    task.status,
    task.sprint,
    task.workdir,
    task.prUrl,
    task.origin,
    task.execution,
    task.jiraFields?.reporter,
    task.jiraFields?.assignee,
    task.jiraFields?.status,
    task.jiraFields?.dueDate,
    task.jiraFields?.fixVersions,
    task.jiraFields?.priority,
    task.jiraFields?.labels,
    task.jiraFields?.issueType,
    task.jiraFields?.updatedAt,
    task.jiraFields?.raw,
    jiraTaskFixVersions(task),
    task.subTasks,
    task.events,
    task.outputs,
    task.verificationRuns,
    (task.stageRuns || []).map(run => ({
      stage: run.stage,
      status: run.status,
      assistantId: run.assistantId,
      selectedAgent: run.selectedAgent,
      selectedAgentReason: run.selectedAgentReason,
      focus: run.focus,
      output: run.output,
    })),
  ], parts, seen);
  return parts.join(' ');
}

export function jiraTaskTicketType(task: ProTask): string {
  const raw = task.jiraFields?.issueType || (task.kind.startsWith('jira-') ? task.kind.replace(/^jira-/, '') : task.kind);
  const normalized = normalize(raw);
  if (normalized === 'ticket' || normalized === 'jira-ticket') return 'Task';
  if (normalized === 'task' || normalized === 'todo') return 'Task';
  if (normalized === 'epic' || normalized === 'initiative' || normalized === 'init') return 'Epic';
  if (normalized === 'bug') return 'Bug';
  if (normalized === 'story') return 'Story';
  return raw ? raw.trim() : 'Task';
}

export function jiraTaskFixVersions(task: ProTask): string[] {
  const raw = task.jiraFields?.raw || {};
  const candidates = [
    task.jiraFields?.fixVersions,
    raw.fixVersion,
    raw.fixVersions,
    raw.fixversion,
    raw.fixversions,
    raw.versions,
  ];
  const versions = new Set<string>();

  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      const label = namedValue(value);
      if (label) versions.add(label);
    }
  }

  return [...versions];
}

export function jiraTaskSprints(task: ProTask): string[] {
  const sprint = (task.sprint || '').trim();
  if (!sprint) return [];
  return [...new Set(sprint.split(/[,，;；\n]+/).map(item => item.trim()).filter(Boolean))];
}

export function jiraTaskRemoteStatus(task: ProTask): string {
  const raw = task.jiraFields?.status || task.jiraFields?.raw?.status;
  return namedValue(raw) || '';
}

export function buildJiraFilterOptions(tasks: ProTask[]): JiraTaskFilterOptions {
  const ticketTypes = new Set<string>();
  const fixVersions = new Set<string>();
  const statuses = new Set<string>();
  const sprintGroups = new Map<string, ProTask[]>();

  for (const task of tasks) {
    const ticketType = jiraTaskTicketType(task);
    if (ticketType) ticketTypes.add(ticketType);
    const status = jiraTaskRemoteStatus(task);
    if (status) statuses.add(status);
    for (const fixVersion of jiraTaskFixVersions(task)) fixVersions.add(fixVersion);
    for (const sprint of jiraTaskSprints(task)) {
      const group = sprintGroups.get(sprint) || [];
      group.push(task);
      sprintGroups.set(sprint, group);
    }
  }

  const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const sortTicketTypes = (values: Set<string>) => [...values].sort((a, b) => {
    const ai = TICKET_TYPE_ORDER.indexOf(a);
    const bi = TICKET_TYPE_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return {
    ticketTypes: sortTicketTypes(ticketTypes),
    sprints: sort(new Set(sprintGroups.keys())),
    fixVersions: sort(fixVersions),
    statuses: sort(statuses),
    sprintGroups: [...sprintGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([sprint, sprintTasks]) => ({ sprint, tasks: sprintTasks })),
  };
}

export function jiraTaskMatchesFilters(task: ProTask, filters: JiraTaskFilters): boolean {
  const ticketType = normalize(filters.ticketType);
  if (ticketType && normalize(jiraTaskTicketType(task)) !== ticketType) return false;

  const sprint = normalize(filters.sprint);
  if (sprint && !jiraTaskSprints(task).some(value => normalize(value) === sprint)) return false;

  const fixVersion = normalize(filters.fixVersion);
  if (fixVersion && !jiraTaskFixVersions(task).some(value => normalize(value) === fixVersion)) return false;

  const status = normalize(filters.status);
  if (status && normalize(jiraTaskRemoteStatus(task)) !== status) return false;

  const query = normalize(filters.query);
  if (query) {
    const haystack = normalize(jiraTaskSearchText(task));
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.every(token => haystack.includes(token))) return false;
  }

  return true;
}
