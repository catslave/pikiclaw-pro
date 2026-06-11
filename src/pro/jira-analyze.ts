import path from 'node:path';
import type { WorkspaceEntry } from '../core/config/user-config.js';
import type { SyncJiraTaskInput } from './tasks.js';
import type { JiraWorkspaceRoute } from './workflow.js';

export const DEFAULT_ANALYZE_TICKET_PROMPT = [
  'Analyze a Jira ticket for me before implementation.',
  '',
  'Ticket link/key/search query: {{ticket_query}}',
  '',
  'Requirements:',
  '- Accept either a pasted Jira link, an issue key, or a loose ticket number/search text. Resolve the exact Jira issue first.',
  '- Pull the latest Jira name/summary, description, comments, status, assignee, reporter, sprint, due date, fix versions, labels, linked issues, and development links when available.',
  '- First explain what the ticket is asking for in plain language.',
  '- If it is a bug: explain the reported user-visible problem, impacted scenario, expected behavior, actual behavior, and any missing reproduction details.',
  '- For bugs, reconstruct the likely user/session/environment timeline from the ticket and comments. If sessionId, conversationId, environment, tenant/account, time range, or trace links are present, use available log/Kibana/trace tools or local logtrace workflows to pull evidence.',
  '- For bugs, analyze logs first: call out errors, latency spikes, missing events, cancellation/timeout paths, downstream failures, and any evidence that supports or rules out candidate causes.',
  '- Then inspect the relevant repo/code paths in the selected workspace. Connect log evidence to code behavior, likely ownership, risky assumptions, and where the root cause probably lives.',
  '- If it is a task/story: explain the requested product/engineering change, scope, dependencies, likely files/services, risks, and acceptance criteria.',
  '- Check linked or likely related merge requests from Jira development links, comments, branch names, or repository references when available; summarize each MR purpose, state, risk, and alignment.',
  '- End with a concise recommendation: likely root cause or implementation direction, confidence, next concrete steps, verification plan, and open questions/blockers.',
  '- If a lookup fails or evidence is unavailable, say exactly what failed and how that limits confidence.',
  '- Do not change files unless the user explicitly asks you to implement a fix.',
  '- Continue answering follow-up questions in this session. When the user asks to finalize or wrap up, produce a markdown Analysis Report with: ticket summary, evidence reviewed, findings, root cause hypothesis, recommendations, and open questions.',
].join('\n');

export interface ParsedJiraTicketQuery {
  query: string;
  jiraKey?: string;
  jiraUrl?: string;
}

export interface WorkdirResolution {
  workdir: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  matchedRule?: string;
}

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/i;
const JIRA_BROWSE_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)/i;

function normalizeText(value: unknown, max = 16_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function parseJiraTicketQuery(rawQuery: unknown): ParsedJiraTicketQuery | null {
  const query = normalizeText(rawQuery, 2048);
  if (!query) return null;
  const browseMatch = query.match(JIRA_BROWSE_RE);
  const keyMatch = browseMatch || query.match(JIRA_KEY_RE);
  const jiraKey = keyMatch?.[1]?.toUpperCase();
  const jiraUrl = browseMatch
    ? query.match(/https?:\/\/[^\s]+/i)?.[0]
    : jiraKey
      ? `https://jira.ringcentral.com/browse/${encodeURIComponent(jiraKey)}`
      : undefined;
  return { query, jiraKey, jiraUrl };
}

function workspaceBasename(workdir: string): string {
  return path.basename(workdir.replace(/\/+$/, '')).toLowerCase();
}

function issueHaystack(issue?: SyncJiraTaskInput | null): string {
  if (!issue) return '';
  return [
    issue.title,
    issue.summary,
    issue.description,
    issue.issueType,
    ...(issue.labels || []),
  ].filter(Boolean).join('\n').toLowerCase();
}

function componentFromIssue(issue?: SyncJiraTaskInput | null): string {
  const raw = issue?.rawFields;
  if (!raw || typeof raw !== 'object') return '';
  const fields = (raw as Record<string, unknown>).fields;
  if (!fields || typeof fields !== 'object') return '';
  const component = (fields as Record<string, unknown>).components;
  if (Array.isArray(component) && component.length) {
    const first = component[0];
    if (first && typeof first === 'object') {
      return normalizeText((first as Record<string, unknown>).name, 120);
    }
  }
  return '';
}

function matchesRoute(route: JiraWorkspaceRoute, args: {
  project: string;
  component: string;
  labels: string[];
  haystack: string;
}): boolean {
  const match = normalizeText(route.match, 160).toLowerCase();
  if (!match) return false;
  if (route.matchType === 'project') return args.project === match || args.project.startsWith(match);
  if (route.matchType === 'component') return args.component.toLowerCase().includes(match);
  if (route.matchType === 'label') return args.labels.some(label => label.toLowerCase().includes(match));
  return args.haystack.includes(match);
}

export function resolveWorkdirForJiraAnalyze(args: {
  jiraKey?: string;
  issue?: SyncJiraTaskInput | null;
  query: string;
  fallbackWorkdir: string;
  workspaces: WorkspaceEntry[];
  routes?: JiraWorkspaceRoute[];
}): WorkdirResolution {
  const fallback = normalizeText(args.fallbackWorkdir, 2048);
  const project = (args.jiraKey || '').split('-')[0]?.toUpperCase() || '';
  const component = componentFromIssue(args.issue);
  const labels = (args.issue?.labels || []).map(label => label.toLowerCase());
  const haystack = `${issueHaystack(args.issue)}\n${normalizeText(args.query, 2048).toLowerCase()}`;

  for (const route of args.routes || []) {
    const workdir = normalizeText(route.workdir, 2048);
    if (!workdir) continue;
    if (matchesRoute(route, { project: project.toLowerCase(), component, labels, haystack })) {
      return {
        workdir,
        reason: `Matched workspace route "${route.match}" (${route.matchType}).`,
        confidence: 'high',
        matchedRule: route.match,
      };
    }
  }

  if (project) {
    const projectLower = project.toLowerCase();
    for (const workspace of args.workspaces) {
      const workdir = normalizeText(workspace.path, 2048);
      if (!workdir) continue;
      const name = normalizeText(workspace.name, 240).toLowerCase();
      const base = workspaceBasename(workdir);
      if (
        name.includes(projectLower)
        || base.includes(projectLower)
        || projectLower.includes(name)
        || (name && projectLower.replace(/g$/i, '').includes(name.replace(/-ng$/i, '')))
      ) {
        return {
          workdir,
          reason: `Matched workspace "${workspace.name || base}" from Jira project ${project}.`,
          confidence: 'medium',
        };
      }
    }
  }

  for (const workspace of args.workspaces) {
    const workdir = normalizeText(workspace.path, 2048);
    if (!workdir) continue;
    const name = normalizeText(workspace.name, 240).toLowerCase();
    const base = workspaceBasename(workdir);
    if ((name && haystack.includes(name)) || (base.length > 3 && haystack.includes(base))) {
      return {
        workdir,
        reason: `Matched workspace "${workspace.name || base}" from ticket text.`,
        confidence: 'medium',
      };
    }
  }

  return {
    workdir: fallback,
    reason: fallback ? 'Using current runtime workspace.' : 'No workspace match found.',
    confidence: 'low',
  };
}

export function buildAnalyzeTicketPrompt(
  template: string,
  query: string,
  extras: {
    jiraKey?: string;
    issueSummary?: string;
    workdirResolution?: WorkdirResolution;
  } = {},
): string {
  const base = normalizeText(template, 48_000) || DEFAULT_ANALYZE_TICKET_PROMPT;
  let prompt = base.includes('{{ticket_query}}')
    ? base.replace(/\{\{ticket_query\}\}/g, query)
    : `${base}\n\nTicket link/key/search query: ${query}`;
  if (extras.jiraKey) prompt += `\n\nResolved Jira key: ${extras.jiraKey}`;
  if (extras.issueSummary) prompt += `\n\nPrefetched Jira summary: ${extras.issueSummary}`;
  if (extras.workdirResolution) {
    prompt += `\n\nSelected workspace: ${extras.workdirResolution.workdir}`;
    prompt += `\nWorkspace selection reason: ${extras.workdirResolution.reason}`;
  }
  return prompt;
}

export function issueKindFromType(issueType?: string): 'jira-bug' | 'jira-ticket' {
  const type = normalizeText(issueType, 120).toLowerCase();
  return type.includes('bug') ? 'jira-bug' : 'jira-ticket';
}
