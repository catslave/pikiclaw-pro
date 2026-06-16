import type { AgentAssistant, AutomationRule } from '../../types';

export type TeamLibraryFilter = 'all' | 'standing' | 'custom' | 'automation';
export type TeamLibrarySortKey = 'default' | 'name' | 'roles' | 'schedule';

export interface TeamProfile {
  assistant: AgentAssistant;
  rosterSize: number;
  standing: boolean;
  jobCount: number;
  agents: string[];
  scheduleLabel: string | null;
  scheduleRank: number;
}

export type TeamLaunchRoleKind = 'leader' | 'teammate';

export interface TeamLaunchRole {
  id: string;
  role: TeamLaunchRoleKind;
  title: string;
  agent: string;
  responsibility: string;
}

export interface TeamLaunchPlan {
  teamName: string;
  mission: string;
  projectName: string;
  modeLabel: string;
  rosterSource: string;
  leader: TeamLaunchRole;
  teammates: TeamLaunchRole[];
  roster: TeamLaunchRole[];
  capabilityReview: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'idle' }>;
  guardrails: string[];
  handoffPrompt: string;
}

export interface TeamRosterSuggestion {
  agents: string[];
  fellBackToDefaults: boolean;
  matchedTokens: string[];
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MANUAL_SCHEDULE_RANK = Number.MAX_SAFE_INTEGER;
const TEAM_SUGGESTION_STOPWORDS = new Set([
  'and',
  'are',
  'for',
  'from',
  'help',
  'into',
  'need',
  'next',
  'our',
  'the',
  'this',
  'with',
]);
const AGENT_ROLE_KEYWORDS: Record<string, string[]> = {
  codex: ['code', 'repo', 'diff', 'test', 'tests', 'bug', 'fix', 'review', 'implementation', 'migration', 'browser', 'typescript'],
  cursor: ['code', 'edit', 'repo', 'implementation', 'frontend', 'ui', 'refactor'],
  copilot: ['code', 'review', 'implementation', 'test', 'tests'],
  gemini: ['research', 'analysis', 'compare', 'source', 'docs', 'audit', 'summarize', 'vision', 'browser'],
  hermes: ['plan', 'strategy', 'orchestrate', 'coordinate', 'split', 'sequence', 'risk', 'architecture'],
  claude: ['reason', 'review', 'writing', 'docs', 'architecture', 'analysis'],
  agy: ['agent', 'automation', 'workflow', 'orchestrate', 'plan'],
};

function timeRank(value: string | undefined): number {
  const [rawHour = '0', rawMinute = '0'] = String(value || '').split(':');
  const hour = Number.parseInt(rawHour, 10);
  const minute = Number.parseInt(rawMinute, 10);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function weekdayLabel(value: string | undefined): string {
  const numeric = Number.parseInt(String(value || '1'), 10);
  return WEEKDAY_LABELS[((Number.isFinite(numeric) ? numeric : 1) + 7) % 7] || 'Mon';
}

export function formatTeamSchedule(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw === 'manual' || raw === 'one-time') return null;
  const [kind, first = '', second = ''] = raw.split('@');
  if (kind === 'daily') return `Daily ${first || '09:00'}`;
  if (kind === 'weekly') return `Weekly ${weekdayLabel(first)} ${second || '09:00'}`;
  if (kind === 'biweekly') return `Biweekly ${weekdayLabel(first)} ${second || '09:00'}`;
  if (kind === 'monthly') return `Monthly day ${first || '1'} ${second || '09:00'}`;
  return raw;
}

export function teamScheduleRank(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  if (!raw || raw === 'manual' || raw === 'one-time') return MANUAL_SCHEDULE_RANK;
  const [kind, first = '', second = ''] = raw.split('@');
  if (kind === 'daily') return timeRank(first);
  if (kind === 'weekly') return 10_000 + Number.parseInt(first || '1', 10) * 1440 + timeRank(second);
  if (kind === 'biweekly') return 20_000 + Number.parseInt(first || '1', 10) * 1440 + timeRank(second);
  if (kind === 'monthly') return 30_000 + Number.parseInt(first || '1', 10) * 1440 + timeRank(second);
  return MANUAL_SCHEDULE_RANK - 1;
}

function teamSearchText(assistant: AgentAssistant): string {
  return [
    assistant.name,
    assistant.kind,
    assistant.responsibility,
    assistant.prompt,
    assistant.defaultPrompt,
    assistant.preferredAgents?.join(' '),
    assistant.allowedActions?.join(' '),
    assistant.labels?.join(' '),
    assistant.objectTypes?.join(' '),
    assistant.surfaceId,
    assistant.id,
  ].filter(Boolean).join(' ').toLowerCase();
}

function normalizeLaunchMission(value: string | null | undefined): string {
  return String(value || '').trim() || 'Help me define and execute the next useful outcome for this team.';
}

function normalizeProjectName(value: string | null | undefined): string {
  return String(value || '').trim() || 'current project';
}

function teamBriefText(profile: TeamProfile): string {
  const assistant = profile.assistant;
  return String(assistant.responsibility || assistant.defaultPrompt || assistant.prompt || '').trim();
}

function launchAgentLabel(agent: string): string {
  if (!agent || agent === 'runtime') return 'Runtime default';
  return agent;
}

function normalizeAgentList(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function tokenizeTeamGoal(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 2 && !TEAM_SUGGESTION_STOPWORDS.has(token)),
  ));
}

function launchRoleTitle(agent: string, role: TeamLaunchRoleKind, index: number): string {
  const suffix = role === 'leader' ? 'leader' : `teammate ${index}`;
  return `${launchAgentLabel(agent)} ${suffix}`;
}

function buildLaunchRole(agent: string, role: TeamLaunchRoleKind, index: number, teamName: string): TeamLaunchRole {
  return {
    id: `${role}:${index}:${agent || 'runtime'}`,
    role,
    title: launchRoleTitle(agent, role, index),
    agent: agent || 'runtime',
    responsibility: role === 'leader'
      ? `Coordinate ${teamName}, split the work, and synthesize the final answer.`
      : `Handle one focused slice of the mission and report findings back to the leader.`,
  };
}

function pickSchedule(jobs: AutomationRule[]): { label: string | null; rank: number } {
  let best: { label: string | null; rank: number } = { label: null, rank: MANUAL_SCHEDULE_RANK };
  for (const job of jobs) {
    const rank = teamScheduleRank(job.schedule);
    if (rank < best.rank) best = { label: formatTeamSchedule(job.schedule), rank };
  }
  return best;
}

export function buildTeamProfiles(
  assistants: AgentAssistant[],
  automations: AutomationRule[],
  fallbackAgent: string,
): TeamProfile[] {
  const jobsByAssistant = new Map<string, AutomationRule[]>();
  for (const job of automations) {
    if (!job.assistantId) continue;
    const existing = jobsByAssistant.get(job.assistantId) || [];
    existing.push(job);
    jobsByAssistant.set(job.assistantId, existing);
  }

  return assistants
    .filter(assistant => assistant.kind !== 'page-owner')
    .map(assistant => {
      const jobs = jobsByAssistant.get(assistant.id) || [];
      const rosterSize = Math.max(1, assistant.preferredAgents?.length || 0);
      const standing = assistant.kind === 'automation'
        || assistant.kind === 'task-stage'
        || jobs.length > 0
        || rosterSize > 1
        || (assistant.labels || []).some(label => /standing|team|roster|company/i.test(label));
      const schedule = pickSchedule(jobs);
      return {
        assistant,
        rosterSize,
        standing,
        jobCount: jobs.length,
        agents: assistant.preferredAgents?.length ? assistant.preferredAgents : [fallbackAgent || 'runtime'],
        scheduleLabel: schedule.label,
        scheduleRank: schedule.rank,
      };
    });
}

export function filterAndSortTeamProfiles(
  profiles: TeamProfile[],
  options: { query?: string; filter?: TeamLibraryFilter; sortKey?: TeamLibrarySortKey },
): TeamProfile[] {
  const query = String(options.query || '').trim().toLowerCase();
  const filter = options.filter || 'all';
  const sortKey = options.sortKey || 'default';
  const filtered = profiles.filter(profile => {
    if (query && !teamSearchText(profile.assistant).includes(query)) return false;
    if (filter === 'standing' && !profile.standing) return false;
    if (filter === 'custom' && profile.assistant.builtIn) return false;
    if (filter === 'automation' && !profile.jobCount && profile.assistant.kind !== 'automation') return false;
    return true;
  });

  if (sortKey === 'default') return filtered;
  return [...filtered].sort((a, b) => {
    if (sortKey === 'name') return a.assistant.name.localeCompare(b.assistant.name);
    if (sortKey === 'roles') return b.rosterSize - a.rosterSize || a.assistant.name.localeCompare(b.assistant.name);
    if (sortKey === 'schedule') return a.scheduleRank - b.scheduleRank || a.assistant.name.localeCompare(b.assistant.name);
    return 0;
  });
}

export function suggestTeamLaunchRoster(
  profile: TeamProfile,
  input: { mission?: string; availableAgents?: string[]; maxAgents?: number } = {},
): TeamRosterSuggestion {
  const mission = normalizeLaunchMission(input.mission);
  const tokens = tokenizeTeamGoal([
    mission,
    teamBriefText(profile),
    profile.assistant.name,
    profile.assistant.labels?.join(' ') || '',
  ].join(' '));
  const profileAgents = normalizeAgentList(profile.agents.length ? profile.agents : ['runtime']);
  const candidates = normalizeAgentList([
    ...profileAgents,
    ...(input.availableAgents || []),
  ]).filter(agent => agent !== 'runtime');
  if (!candidates.length) {
    return { agents: profileAgents, fellBackToDefaults: true, matchedTokens: [] };
  }

  const scored = candidates.map(agent => {
    const keywords = AGENT_ROLE_KEYWORDS[agent.toLowerCase()] || [];
    const matchedTokens = tokens.filter(token => agent.toLowerCase().includes(token) || keywords.some(keyword => keyword.includes(token) || token.includes(keyword)));
    const profileBonus = profileAgents.includes(agent) ? 2 : 0;
    return {
      agent,
      score: matchedTokens.length + profileBonus,
      matchedTokens,
    };
  });
  const hasKeywordMatch = scored.some(item => item.matchedTokens.length > 0);
  const maxAgents = Math.max(1, Math.min(Math.floor(Number(input.maxAgents) || 3), 4));
  const leader = profileAgents.find(agent => agent !== 'runtime') || [...scored].sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent))[0]?.agent || 'runtime';
  const picked = scored
    .filter(item => item.agent !== leader)
    .sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent))
    .slice(0, Math.max(0, maxAgents - 1))
    .map(item => item.agent);
  const agents = normalizeAgentList([leader, ...picked]);
  const selectedAgents = new Set(agents);
  const selectedMatchedTokens = new Set(scored.filter(item => selectedAgents.has(item.agent)).flatMap(item => item.matchedTokens));
  const matchedTokens = tokens.filter(token => selectedMatchedTokens.has(token)).slice(0, 10);
  return {
    agents: agents.length ? agents : profileAgents,
    fellBackToDefaults: !hasKeywordMatch,
    matchedTokens,
  };
}

export function buildTeamLaunchPlan(
  profile: TeamProfile,
  input: { mission?: string; projectName?: string; permissionMode?: string; agents?: string[]; rosterSource?: string } = {},
): TeamLaunchPlan {
  const teamName = profile.assistant.name;
  const mission = normalizeLaunchMission(input.mission);
  const projectName = normalizeProjectName(input.projectName);
  const agents = normalizeAgentList(input.agents?.length ? input.agents : (profile.agents.length ? profile.agents : ['runtime']));
  const rosterSource = input.rosterSource || (input.agents?.length ? 'Suggested from mission' : 'Saved team profile');
  const roster = agents.map((agent, index) => buildLaunchRole(agent, index === 0 ? 'leader' : 'teammate', index + 1, teamName));
  const leader = roster[0];
  const teammates = roster.slice(1);
  const brief = teamBriefText(profile);
  const permission = String(input.permissionMode || '').trim();
  const modeLabel = 'Assistant-backed team handoff';
  const guardrails = [
    'Start by confirming the mission, success criteria, and any missing constraints.',
    'Keep one visible chat thread as the source of truth; split work into roles before executing.',
    'Use extra agents or side chats only when the user confirms the roster or the backend explicitly supports them.',
    permission ? `Respect the current permission mode: ${permission}.` : 'Keep risky file, shell, and network actions behind visible user confirmation.',
  ];
  const rosterLines = roster.map(role => {
    const label = role.role === 'leader' ? 'Leader' : 'Teammate';
    return `- ${label}: ${role.title} (${launchAgentLabel(role.agent)}) - ${role.responsibility}`;
  });
  const handoffPrompt = [
    '[Team Launch Plan]',
    `Team: ${teamName}`,
    `Project: ${projectName}`,
    `Mission: ${mission}`,
    `Mode: ${modeLabel}`,
    `Roster source: ${rosterSource}`,
    profile.scheduleLabel ? `Standing cadence: ${profile.scheduleLabel}` : '',
    brief ? `Team brief: ${brief}` : '',
    '',
    'Roster:',
    ...rosterLines,
    '',
    'Guardrails:',
    ...guardrails.map(item => `- ${item}`),
    '',
    '[Start]',
    'Begin as the team leader: confirm the mission, propose the work split, then execute the first concrete step.',
  ].filter(Boolean).join('\n');

  return {
    teamName,
    mission,
    projectName,
    modeLabel,
    rosterSource,
    leader,
    teammates,
    roster,
    capabilityReview: [
      { label: 'Leader', value: launchAgentLabel(leader.agent), tone: leader.agent === 'runtime' ? 'warn' : 'ok' },
      { label: 'Teammates', value: `${teammates.length}`, tone: teammates.length ? 'ok' : 'idle' },
      { label: 'Backends', value: agents.map(launchAgentLabel).join(', '), tone: agents.includes('runtime') ? 'warn' : 'ok' },
      { label: 'Cadence', value: profile.scheduleLabel || 'On demand', tone: profile.scheduleLabel ? 'ok' : 'idle' },
      { label: 'Runtime', value: modeLabel, tone: 'warn' },
      { label: 'Source', value: rosterSource, tone: input.agents?.length ? 'ok' : 'idle' },
    ],
    guardrails,
    handoffPrompt,
  };
}
