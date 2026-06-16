import type { AgentAssistant, AutomationRule } from '../../types';

export type AssistantLibraryFilter = 'all' | 'builtin' | 'custom' | 'bound' | 'automation';
export type AssistantDomain = 'all' | 'sell' | 'write' | 'research' | 'plan' | 'build' | 'run' | 'learn';

export const ASSISTANT_DOMAIN_VALUES: Exclude<AssistantDomain, 'all'>[] = [
  'sell',
  'write',
  'research',
  'plan',
  'build',
  'run',
  'learn',
];

export const ASSISTANT_DOMAIN_LABELS: Record<AssistantDomain, string> = {
  all: 'All domains',
  sell: 'Sell',
  write: 'Write',
  research: 'Research',
  plan: 'Plan',
  build: 'Build',
  run: 'Run',
  learn: 'Learn',
};

export type AssistantDetailRuntimeState = 'ready' | 'runtime-default' | 'missing-runtime' | 'disabled';

export interface AssistantLibraryDetailSummary {
  domain: Exclude<AssistantDomain, 'all'>;
  runtimeState: AssistantDetailRuntimeState;
  runtimeAgents: string[];
  missingAgents: string[];
  jobCount: number;
  capabilityCount: number;
  promptState: 'custom' | 'default' | 'empty';
}

const DOMAIN_KEYWORDS: Record<Exclude<AssistantDomain, 'all'>, string[]> = {
  sell: ['sell', 'sales', 'marketing', 'renewal', 'funnel', 'growth', 'customer'],
  write: ['write', 'writing', 'draft', 'copy', 'article', 'doc', 'docs', 'summary'],
  research: ['research', 'analyze', 'analysis', 'review', 'investigate', 'logs', 'trace'],
  plan: ['plan', 'planning', 'refine', 'clarify', 'estimate', 'strategy', 'roadmap'],
  build: ['build', 'code', 'coding', 'implement', 'develop', 'ship', 'mcp', 'skill'],
  run: ['run', 'operate', 'ops', 'automation', 'sync', 'schedule', 'workflow'],
  learn: ['learn', 'knowledge', 'memory', 'wiki', 'teach', 'concept'],
};

export function assistantLibrarySearchText(assistant: AgentAssistant): string {
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

export function resolveAssistantDomain(assistant: AgentAssistant): Exclude<AssistantDomain, 'all'> {
  const explicit = [...(assistant.labels || []), ...(assistant.objectTypes || [])]
    .map(item => item.toLowerCase())
    .find(item => ASSISTANT_DOMAIN_VALUES.includes(item as Exclude<AssistantDomain, 'all'>));
  if (explicit) return explicit as Exclude<AssistantDomain, 'all'>;

  const haystack = assistantLibrarySearchText(assistant);
  for (const domain of ASSISTANT_DOMAIN_VALUES) {
    if (DOMAIN_KEYWORDS[domain].some(keyword => haystack.includes(keyword))) return domain;
  }
  return 'plan';
}

export function normalizeAssistantFilter(value: string | null | undefined): AssistantLibraryFilter {
  if (value === 'builtin' || value === 'custom' || value === 'bound' || value === 'automation') return value;
  return 'all';
}

export function normalizeAssistantDomain(value: string | null | undefined): AssistantDomain {
  if (value && ASSISTANT_DOMAIN_VALUES.includes(value as Exclude<AssistantDomain, 'all'>)) {
    return value as AssistantDomain;
  }
  return 'all';
}

export function filterAssistantLibrary(
  assistants: AgentAssistant[],
  options: {
    query?: string;
    filter?: AssistantLibraryFilter;
    domain?: AssistantDomain;
    automationAssistantIds?: ReadonlySet<string>;
  },
): AgentAssistant[] {
  const query = String(options.query || '').trim().toLowerCase();
  const filter = options.filter || 'all';
  const domain = options.domain || 'all';
  const automationAssistantIds = options.automationAssistantIds || new Set<string>();

  return assistants.filter(assistant => {
    if (query && !assistantLibrarySearchText(assistant).includes(query)) return false;
    if (filter === 'builtin' && !assistant.builtIn) return false;
    if (filter === 'custom' && assistant.builtIn) return false;
    if (filter === 'bound' && !assistant.preferredAgents?.length) return false;
    if (filter === 'automation' && assistant.kind !== 'automation' && !automationAssistantIds.has(assistant.id)) return false;
    if (domain !== 'all' && resolveAssistantDomain(assistant) !== domain) return false;
    return true;
  });
}

export function summarizeAssistantLibraryDetail(
  assistant: AgentAssistant,
  automations: AutomationRule[],
  availableAgents?: ReadonlySet<string>,
): AssistantLibraryDetailSummary {
  const runtimeAgents = assistant.preferredAgents || [];
  const missingAgents = availableAgents && availableAgents.size > 0
    ? runtimeAgents.filter(agent => !availableAgents.has(agent))
    : [];
  const capabilityCount = new Set([
    ...(assistant.allowedActions || []),
    ...(assistant.objectTypes || []),
    ...(assistant.labels || []),
  ].map(item => item.trim()).filter(Boolean)).size;
  const promptState = String(assistant.prompt || '').trim()
    ? 'custom'
    : String(assistant.defaultPrompt || '').trim()
      ? 'default'
      : 'empty';
  const runtimeState: AssistantDetailRuntimeState = assistant.enabled === false
    ? 'disabled'
    : missingAgents.length
      ? 'missing-runtime'
      : runtimeAgents.length
        ? 'ready'
        : 'runtime-default';

  return {
    domain: resolveAssistantDomain(assistant),
    runtimeState,
    runtimeAgents,
    missingAgents,
    jobCount: automations.filter(job => job.assistantId === assistant.id).length,
    capabilityCount,
    promptState,
  };
}
