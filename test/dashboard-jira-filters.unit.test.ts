import { describe, expect, it } from 'vitest';
import {
  buildJiraFilterOptions,
  jiraTaskFixVersions,
  jiraTaskMatchesFilters,
  type JiraTaskFilters,
} from '../dashboard/src/pages/jira/task-filters.ts';
import type { ProTask } from '../dashboard/src/types.ts';

function task(overrides: Partial<ProTask>): ProTask {
  return {
    id: overrides.id || 'task_1',
    title: overrides.title || 'Untitled',
    kind: overrides.kind || 'jira-ticket',
    status: overrides.status || 'backlog',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    ...overrides,
  };
}

describe('Jira dashboard filters', () => {
  it('matches ticket type, query, and sprint together', () => {
    const matching = task({
      title: 'Add Jira dashboard filters',
      jiraFields: {
        issueType: 'Epic',
        raw: {
          customfield_10014: 'Productivity Initiative',
          parent: { key: 'PRO-1', fields: { summary: 'Ignored parent fallback' } },
        },
      },
      sprint: 'Sprint 42',
    });
    const wrongEpic = task({
      id: 'task_2',
      title: 'Add Jira dashboard filters',
      jiraFields: { issueType: 'Bug', raw: { customfield_10014: 'Productivity Initiative' } },
      sprint: 'Sprint 42',
    });
    const filters: JiraTaskFilters = {
      ticketType: 'Epic',
      query: 'dashboard filter',
      sprint: 'Sprint 42',
      fixVersion: '',
    };

    expect(jiraTaskMatchesFilters(matching, filters)).toBe(true);
    expect(jiraTaskMatchesFilters(wrongEpic, filters)).toBe(false);
  });

  it('builds ticket type, sprint, and fixVersion filter indexes from synced ticket tasks', () => {
    const options = buildJiraFilterOptions([
      task({ title: 'One', kind: 'jira-bug', jiraFields: { issueType: 'Bug', raw: { fixVersions: [{ name: '2026.06' }] } }, sprint: 'Sprint 2' }),
      task({ title: 'Two', kind: 'jira-epic', jiraFields: { issueType: 'Epic', raw: { fixVersion: '2026.05' } }, sprint: 'Sprint 1' }),
      task({ title: 'Three', kind: 'jira-ticket', jiraFields: { raw: { versions: [{ value: '2026.06' }] } }, sprint: 'Sprint 1' }),
    ]);

    expect(options.ticketTypes).toEqual(['Epic', 'Task', 'Bug']);
    expect(options.sprints).toEqual(['Sprint 1', 'Sprint 2']);
    expect(options.fixVersions).toEqual(['2026.05', '2026.06']);
    expect(options.sprintGroups.map(group => ({ sprint: group.sprint, count: group.tasks.length }))).toEqual([
      { sprint: 'Sprint 1', count: 2 },
      { sprint: 'Sprint 2', count: 1 },
    ]);
  });

  it('splits multi-sprint ticket fields into separate filter items and matches any sprint', () => {
    const multiSprint = task({
      title: 'Moved across sprint boundary',
      sprint: 'AIR2606(0309-0322) , AIR2607(0323-0405)',
    });
    const options = buildJiraFilterOptions([multiSprint]);

    expect(options.sprints).toEqual(['AIR2606(0309-0322)', 'AIR2607(0323-0405)']);
    expect(options.sprintGroups.map(group => ({ sprint: group.sprint, count: group.tasks.length }))).toEqual([
      { sprint: 'AIR2606(0309-0322)', count: 1 },
      { sprint: 'AIR2607(0323-0405)', count: 1 },
    ]);
    expect(jiraTaskMatchesFilters(multiSprint, {
      ticketType: '',
      query: '',
      sprint: 'AIR2607(0323-0405)',
      fixVersion: '',
    })).toBe(true);
  });

  it('filters by fixVersion parsed from synced raw Jira fields', () => {
    const taskWithVersion = task({
      title: 'Ship release fix',
      jiraFields: { issueType: 'Bug', raw: { fixVersions: [{ name: '2026.06' }, { name: 'Hotfix' }] } },
    });

    expect(jiraTaskMatchesFilters(taskWithVersion, {
      ticketType: '',
      query: '',
      sprint: '',
      fixVersion: '2026.06',
    })).toBe(true);
    expect(jiraTaskMatchesFilters(taskWithVersion, {
      ticketType: '',
      query: '',
      sprint: '',
      fixVersion: '2026.07',
    })).toBe(false);
  });

  it('prefers explicit synced fixVersions when building and matching filters', () => {
    const taskWithExplicitVersions = task({
      title: 'Ship explicit version',
      jiraFields: {
        issueType: 'Task',
        status: 'In Progress',
        fixVersions: ['2026.08', 'Hotfix'],
        raw: { fixVersions: [{ name: 'Legacy' }] },
      },
    });

    expect(jiraTaskFixVersions(taskWithExplicitVersions)).toEqual(['2026.08', 'Hotfix', 'Legacy']);
    expect(buildJiraFilterOptions([taskWithExplicitVersions]).fixVersions).toEqual(['2026.08', 'Hotfix', 'Legacy']);
    expect(buildJiraFilterOptions([taskWithExplicitVersions]).statuses).toEqual(['In Progress']);
    expect(jiraTaskMatchesFilters(taskWithExplicitVersions, {
      ticketType: '',
      query: '',
      sprint: '',
      fixVersion: 'Hotfix',
      status: 'In Progress',
    })).toBe(true);
    expect(jiraTaskMatchesFilters(taskWithExplicitVersions, {
      ticketType: '',
      query: '',
      sprint: '',
      fixVersion: 'Hotfix',
      status: 'Done',
    })).toBe(false);
  });

  it('searches synced Jira content beyond the ticket title', () => {
    const richTask = task({
      title: 'Plain ticket title',
      description: 'Investigate silence after filler playback.',
      jiraKey: 'AIR-123',
      jiraUrl: 'https://jira.example/browse/AIR-123',
      sprint: 'AIR2612',
      jiraFields: {
        issueType: 'Bug',
        assignee: 'Mina Chen',
        reporter: 'Ops Team',
        priority: 'High',
        labels: ['voice-runtime', 'handoff-risk'],
        raw: {
          customfield_10101: 'Jupiter call platform',
          acceptance: { summary: 'Escalation path stays visible' },
        },
      },
      subTasks: [{
        id: 'sub_1',
        taskId: 'task_1',
        title: 'Trace SIP timeout',
        description: 'Check turn latency around agent handoff.',
        status: 'todo',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        stageRunIds: [],
      }],
      events: [{
        id: 'event_1',
        taskId: 'task_1',
        type: 'jira-synced',
        createdAt: '2026-06-01T00:00:00.000Z',
        actor: 'system',
        summary: 'Remote comment mentioned customer callback.',
      }],
      stageRuns: [{
        id: 'run_1',
        taskId: 'task_1',
        stage: 'refinement',
        status: 'completed',
        session: { workdir: '/repo/app', agent: 'codex', sessionId: 'session_1' },
        prompt: 'Do not use prompt text for this assertion.',
        output: {
          summary: 'Likely IVR race condition.',
          diffSummary: 'Reviewed telephony state machine.',
          changedFiles: ['src/voice/handoff.ts'],
        },
      }],
      outputs: [{
        id: 'out_1',
        kind: 'stage-summary',
        title: 'Evidence note',
        summary: 'Dashboard should show blocked verification.',
        taskId: 'task_1',
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
      verificationRuns: [{
        id: 'verify_1',
        taskId: 'task_1',
        environment: 'cnlab03',
        result: 'blocked',
        notes: 'Needs Redpanda replay evidence.',
        startedAt: '2026-06-01T00:00:00.000Z',
      }],
    });

    for (const query of [
      'filler playback',
      'Mina handoff-risk',
      'Jupiter escalation',
      'SIP timeout',
      'customer callback',
      'IVR race',
      'blocked verification',
      'Redpanda replay',
    ]) {
      expect(jiraTaskMatchesFilters(richTask, {
        ticketType: '',
        query,
        sprint: '',
        fixVersion: '',
      })).toBe(true);
    }
  });

  it('requires every query token to match the same Jira task', () => {
    const richTask = task({
      title: 'Searchable Jira task',
      description: 'Contains a browser regression note.',
      jiraFields: { labels: ['frontend'] },
    });

    expect(jiraTaskMatchesFilters(richTask, {
      ticketType: '',
      query: 'browser frontend',
      sprint: '',
      fixVersion: '',
    })).toBe(true);
    expect(jiraTaskMatchesFilters(richTask, {
      ticketType: '',
      query: 'browser backend',
      sprint: '',
      fixVersion: '',
    })).toBe(false);
  });
});
