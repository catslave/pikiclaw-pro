import { describe, expect, it } from 'vitest';
import type { AgentAssistant, AutomationRule } from '../dashboard/src/types.ts';
import {
  buildTeamLaunchPlan,
  buildTeamProfiles,
  filterAndSortTeamProfiles,
  formatTeamSchedule,
  suggestTeamLaunchRoster,
} from '../dashboard/src/pages/wayland/teamLibrary.ts';

const assistant = (input: Partial<AgentAssistant> & Pick<AgentAssistant, 'id' | 'name'>): AgentAssistant => ({
  id: input.id,
  name: input.name,
  responsibility: input.responsibility || `${input.name} responsibility`,
  preferredAgents: input.preferredAgents || [],
  labels: input.labels || [],
  builtIn: input.builtIn ?? false,
  enabled: input.enabled ?? true,
  kind: input.kind,
  prompt: input.prompt,
  defaultPrompt: input.defaultPrompt,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
});

const automation = (input: Partial<AutomationRule> & Pick<AutomationRule, 'assistantId' | 'schedule'>): AutomationRule => ({
  id: `automation_${input.assistantId}_${input.schedule}`,
  name: input.name || 'Automation',
  schedule: input.schedule,
  prompt: input.prompt || 'Run this team task.',
  assistantId: input.assistantId,
  enabled: input.enabled ?? true,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
});

describe('Wayland team library model', () => {
  it('promotes scheduled and multi-agent assistants into standing team profiles', () => {
    const profiles = buildTeamProfiles([
      assistant({ id: 'solo', name: 'Solo Reviewer', preferredAgents: ['codex'] }),
      assistant({ id: 'release', name: 'Release Company', preferredAgents: ['codex', 'gemini'] }),
      assistant({ id: 'cron', name: 'Weekly Watch', preferredAgents: ['codex'] }),
    ], [
      automation({ assistantId: 'cron', schedule: 'weekly@5@17:00' }),
    ], 'codex');

    expect(profiles.find(item => item.assistant.id === 'solo')?.standing).toBe(false);
    expect(profiles.find(item => item.assistant.id === 'release')?.standing).toBe(true);
    expect(profiles.find(item => item.assistant.id === 'cron')).toMatchObject({
      standing: true,
      jobCount: 1,
      scheduleLabel: 'Weekly Fri 17:00',
    });
  });

  it('sorts by schedule before manual teams when requested', () => {
    const profiles = buildTeamProfiles([
      assistant({ id: 'manual', name: 'Manual Team' }),
      assistant({ id: 'monthly', name: 'Monthly Team' }),
      assistant({ id: 'daily', name: 'Daily Team' }),
    ], [
      automation({ assistantId: 'monthly', schedule: 'monthly@12@10:00' }),
      automation({ assistantId: 'daily', schedule: 'daily@08:00' }),
    ], 'codex');

    expect(filterAndSortTeamProfiles(profiles, { sortKey: 'schedule' }).map(item => item.assistant.id)).toEqual([
      'daily',
      'monthly',
      'manual',
    ]);
  });

  it('keeps filter semantics aligned with the visible team rail', () => {
    const profiles = buildTeamProfiles([
      assistant({ id: 'builtin', name: 'Built-in Team', builtIn: true, kind: 'automation' }),
      assistant({ id: 'custom', name: 'Custom Squad', builtIn: false, labels: ['team'] }),
      assistant({ id: 'plain', name: 'Plain Assistant', builtIn: false }),
    ], [
      automation({ assistantId: 'builtin', schedule: 'daily@09:00' }),
    ], 'codex');

    expect(filterAndSortTeamProfiles(profiles, { filter: 'automation' }).map(item => item.assistant.id)).toEqual(['builtin']);
    expect(filterAndSortTeamProfiles(profiles, { filter: 'custom' }).map(item => item.assistant.id)).toEqual(['custom', 'plain']);
    expect(filterAndSortTeamProfiles(profiles, { query: 'squad' }).map(item => item.assistant.id)).toEqual(['custom']);
  });

  it('formats the recurring schedule labels shown on team cards', () => {
    expect(formatTeamSchedule('daily@08:30')).toBe('Daily 08:30');
    expect(formatTeamSchedule('weekly@1@09:00')).toBe('Weekly Mon 09:00');
    expect(formatTeamSchedule('biweekly@2@10:15')).toBe('Biweekly Tue 10:15');
    expect(formatTeamSchedule('monthly@21@16:45')).toBe('Monthly day 21 16:45');
    expect(formatTeamSchedule('manual')).toBeNull();
  });

  it('builds a structured team launch plan with leader, teammates, and guardrails', () => {
    const [profile] = buildTeamProfiles([
      assistant({
        id: 'release',
        name: 'Release Company',
        responsibility: 'Coordinate release readiness across code, test, and risk.',
        preferredAgents: ['codex', 'gemini', 'hermes'],
        labels: ['standing'],
      }),
    ], [
      automation({ assistantId: 'release', schedule: 'weekly@5@17:00' }),
    ], 'codex');

    const plan = buildTeamLaunchPlan(profile, {
      mission: 'Review the release risk and produce a ship/no-ship recommendation.',
      projectName: 'Pikiclaw',
      permissionMode: 'ask',
    });

    expect(plan.modeLabel).toBe('Assistant-backed team handoff');
    expect(plan.leader).toMatchObject({ role: 'leader', agent: 'codex' });
    expect(plan.teammates.map(item => item.agent)).toEqual(['gemini', 'hermes']);
    expect(plan.capabilityReview.map(item => item.label)).toContain('Runtime');
    expect(plan.guardrails.join('\n')).toContain('ask');
    expect(plan.handoffPrompt).toContain('[Team Launch Plan]');
    expect(plan.handoffPrompt).toContain('Project: Pikiclaw');
    expect(plan.handoffPrompt).toContain('Leader: codex leader');
    expect(plan.handoffPrompt).toContain('Teammate: gemini teammate 2');
    expect(plan.handoffPrompt).toContain('[Start]');
  });

  it('suggests a mission-specific roster while preserving the saved team leader', () => {
    const [profile] = buildTeamProfiles([
      assistant({
        id: 'release',
        name: 'Release Company',
        responsibility: 'Coordinate release readiness across code, test, and risk.',
        preferredAgents: ['codex'],
        labels: ['standing'],
      }),
    ], [], 'codex');

    const suggestion = suggestTeamLaunchRoster(profile, {
      mission: 'Research architecture risk, compare source docs, and split a migration plan.',
      availableAgents: ['codex', 'gemini', 'hermes'],
      maxAgents: 3,
    });

    expect(suggestion.fellBackToDefaults).toBe(false);
    expect(suggestion.agents[0]).toBe('codex');
    expect(suggestion.agents).toContain('gemini');
    expect(suggestion.agents).toContain('hermes');
    expect(suggestion.matchedTokens).toEqual(expect.arrayContaining(['research', 'risk', 'plan']));
  });

  it('marks suggested rosters in the chat handoff prompt', () => {
    const [profile] = buildTeamProfiles([
      assistant({
        id: 'release',
        name: 'Release Company',
        preferredAgents: ['codex'],
      }),
    ], [], 'codex');

    const plan = buildTeamLaunchPlan(profile, {
      mission: 'Review release risk.',
      agents: ['codex', 'gemini'],
      rosterSource: 'Suggested from mission · review, risk',
    });

    expect(plan.rosterSource).toBe('Suggested from mission · review, risk');
    expect(plan.teammates.map(item => item.agent)).toEqual(['gemini']);
    expect(plan.handoffPrompt).toContain('Roster source: Suggested from mission · review, risk');
    expect(plan.capabilityReview.find(item => item.label === 'Source')).toMatchObject({
      value: 'Suggested from mission · review, risk',
      tone: 'ok',
    });
  });

  it('keeps runtime-default teams honest in capability review', () => {
    const [profile] = buildTeamProfiles([
      assistant({ id: 'plain', name: 'Plain Assistant', preferredAgents: [] }),
    ], [], '');

    const plan = buildTeamLaunchPlan(profile);

    expect(plan.leader.agent).toBe('runtime');
    expect(plan.teammates).toEqual([]);
    expect(plan.capabilityReview.find(item => item.label === 'Leader')).toMatchObject({
      value: 'Runtime default',
      tone: 'warn',
    });
    expect(plan.capabilityReview.find(item => item.label === 'Runtime')?.value).toBe('Assistant-backed team handoff');
  });
});
