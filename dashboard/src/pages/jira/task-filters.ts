import type { ProTask } from '../../types';

export type JiraTaskFilters = {
  ticketType: string;
  ticketName: string;
  sprint: string;
  fixVersion: string;
};

export type JiraTaskFilterOptions = {
  ticketTypes: string[];
  sprints: string[];
  fixVersions: string[];
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

export function buildJiraFilterOptions(tasks: ProTask[]): JiraTaskFilterOptions {
  const ticketTypes = new Set<string>();
  const fixVersions = new Set<string>();
  const sprintGroups = new Map<string, ProTask[]>();

  for (const task of tasks) {
    const ticketType = jiraTaskTicketType(task);
    if (ticketType) ticketTypes.add(ticketType);
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

  const ticketName = normalize(filters.ticketName);
  if (ticketName) {
    const haystack = normalize([task.title, task.jiraKey, task.localKey].filter(Boolean).join(' '));
    const tokens = ticketName.split(/\s+/).filter(Boolean);
    if (!tokens.every(token => haystack.includes(token))) return false;
  }

  return true;
}
