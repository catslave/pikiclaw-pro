import { describe, expect, it } from 'vitest';
import {
  buildAnalyzeTicketPrompt,
  DEFAULT_ANALYZE_TICKET_PROMPT,
  issueKindFromType,
  parseJiraTicketQuery,
  resolveWorkdirForJiraAnalyze,
} from '../src/pro/jira-analyze.ts';
import {
  getAnalyzeTicketPrompt,
  resetAnalyzeTicketPrompt,
  updateAnalyzeTicketPrompt,
} from '../src/pro/workflow.ts';

describe('jira analyze helpers', () => {
  it('parses browse links and bare issue keys', () => {
    expect(parseJiraTicketQuery('https://jira.ringcentral.com/browse/IVAG-1177')).toEqual({
      query: 'https://jira.ringcentral.com/browse/IVAG-1177',
      jiraKey: 'IVAG-1177',
      jiraUrl: 'https://jira.ringcentral.com/browse/IVAG-1177',
    });
    expect(parseJiraTicketQuery('ivag-42')).toEqual({
      query: 'ivag-42',
      jiraKey: 'IVAG-42',
      jiraUrl: 'https://jira.ringcentral.com/browse/IVAG-42',
    });
    expect(parseJiraTicketQuery('')).toBeNull();
  });

  it('builds analyze prompts from templates and extras', () => {
    const prompt = buildAnalyzeTicketPrompt('Inspect {{ticket_query}}', 'IVAG-1', {
      jiraKey: 'IVAG-1',
      issueSummary: 'Broken handoff',
      workdirResolution: {
        workdir: '/repo/iva',
        reason: 'Matched project',
        confidence: 'high',
      },
    });
    expect(prompt).toContain('Inspect IVAG-1');
    expect(prompt).toContain('Resolved Jira key: IVAG-1');
    expect(prompt).toContain('Broken handoff');
    expect(prompt).toContain('/repo/iva');
  });

  it('resolves workspace from configured routes and project heuristics', () => {
    const routed = resolveWorkdirForJiraAnalyze({
      jiraKey: 'IVAG-9',
      query: 'IVAG-9',
      fallbackWorkdir: '/fallback',
      workspaces: [],
      routes: [{ match: 'ivag', matchType: 'project', workdir: '/repo/iva-ng' }],
    });
    expect(routed.workdir).toBe('/repo/iva-ng');
    expect(routed.confidence).toBe('high');

    const heuristic = resolveWorkdirForJiraAnalyze({
      jiraKey: 'NOVA-1',
      query: 'NOVA-1',
      fallbackWorkdir: '/fallback',
      workspaces: [{ path: '/Users/me/Codes/nova', name: 'nova' }],
      routes: [],
    });
    expect(heuristic.workdir).toBe('/Users/me/Codes/nova');

    const fallback = resolveWorkdirForJiraAnalyze({
      query: 'search text only',
      fallbackWorkdir: '/fallback',
      workspaces: [],
      routes: [],
    });
    expect(fallback.workdir).toBe('/fallback');
    expect(fallback.confidence).toBe('low');
  });

  it('maps issue types to jira task kinds', () => {
    expect(issueKindFromType('Bug')).toBe('jira-bug');
    expect(issueKindFromType('Story')).toBe('jira-ticket');
  });

  it('stores and resets analyze ticket prompt in workflow config', () => {
    const custom = 'Analyze {{ticket_query}} with logs first.';
    const updated = updateAnalyzeTicketPrompt({ prompt: custom });
    expect(updated.prompt).toBe(custom);
    expect(updated.customized).toBe(true);
    expect(getAnalyzeTicketPrompt().prompt).toBe(custom);
    const reset = resetAnalyzeTicketPrompt();
    expect(reset.prompt).toBe(DEFAULT_ANALYZE_TICKET_PROMPT);
    expect(reset.customized).toBe(false);
  });
});
