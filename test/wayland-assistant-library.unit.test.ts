import { describe, expect, it } from 'vitest';
import type { AgentAssistant } from '../dashboard/src/types.ts';
import {
  filterAssistantLibrary,
  normalizeAssistantDomain,
  normalizeAssistantFilter,
  resolveAssistantDomain,
  summarizeAssistantLibraryDetail,
} from '../dashboard/src/pages/wayland/assistantLibrary.ts';

const assistant = (input: Partial<AgentAssistant> & Pick<AgentAssistant, 'id' | 'name'>): AgentAssistant => ({
  id: input.id,
  name: input.name,
  responsibility: input.responsibility || `${input.name} responsibility`,
  preferredAgents: input.preferredAgents || [],
  allowedActions: input.allowedActions || [],
  labels: input.labels || [],
  objectTypes: input.objectTypes || [],
  builtIn: input.builtIn ?? false,
  enabled: input.enabled ?? true,
  kind: input.kind,
  prompt: input.prompt,
  defaultPrompt: input.defaultPrompt,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
});

describe('Wayland assistant library model', () => {
  it('normalizes URL filter params defensively', () => {
    expect(normalizeAssistantFilter('bound')).toBe('bound');
    expect(normalizeAssistantFilter('weird')).toBe('all');
    expect(normalizeAssistantDomain('research')).toBe('research');
    expect(normalizeAssistantDomain('unknown')).toBe('all');
  });

  it('prefers explicit domain metadata before keyword inference', () => {
    expect(resolveAssistantDomain(assistant({
      id: 'explicit',
      name: 'Release Writer',
      labels: ['build'],
      responsibility: 'Write a release note.',
    }))).toBe('build');

    expect(resolveAssistantDomain(assistant({
      id: 'logs',
      name: 'Log Analysis',
      responsibility: 'Investigate logs, trace IDs, and incident snippets.',
    }))).toBe('research');
  });

  it('filters by query, type, domain, and automation ownership', () => {
    const assistants = [
      assistant({ id: 'code', name: 'Coding Assistant', builtIn: true, preferredAgents: ['codex'], responsibility: 'Implement scoped code changes.' }),
      assistant({ id: 'knowledge', name: 'Knowledge Assistant', responsibility: 'Promote memory into wiki concepts.' }),
      assistant({ id: 'cron', name: 'Ticket Sync Assistant', kind: 'automation', responsibility: 'Run scheduled ticket sync jobs.' }),
    ];
    const automationAssistantIds = new Set(['cron']);

    expect(filterAssistantLibrary(assistants, { filter: 'bound' }).map(item => item.id)).toEqual(['code']);
    expect(filterAssistantLibrary(assistants, { filter: 'automation', automationAssistantIds }).map(item => item.id)).toEqual(['cron']);
    expect(filterAssistantLibrary(assistants, { domain: 'learn' }).map(item => item.id)).toEqual(['knowledge']);
    expect(filterAssistantLibrary(assistants, { query: 'ticket', domain: 'run' }).map(item => item.id)).toEqual(['cron']);
  });

  it('summarizes assistant object readiness for the detail view', () => {
    const coding = assistant({
      id: 'code',
      name: 'Coding Assistant',
      preferredAgents: ['codex', 'missing-agent'],
      allowedActions: ['chat', 'workflow'],
      objectTypes: ['task'],
      labels: ['build'],
      prompt: 'Use the scoped coding prompt.',
    });
    const summary = summarizeAssistantLibraryDetail(coding, [
      {
        id: 'job-1',
        name: 'Nightly coding scan',
        schedule: 'daily',
        prompt: 'Scan work items',
        assistantId: 'code',
        enabled: true,
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ], new Set(['codex']));

    expect(summary.domain).toBe('build');
    expect(summary.runtimeState).toBe('missing-runtime');
    expect(summary.missingAgents).toEqual(['missing-agent']);
    expect(summary.jobCount).toBe(1);
    expect(summary.capabilityCount).toBe(4);
    expect(summary.promptState).toBe('custom');
  });
});
