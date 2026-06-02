import { describe, expect, it } from 'vitest';
import {
  buildJiraFilterOptions,
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
  it('matches ticket type, ticket name, and sprint together', () => {
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
      ticketName: 'dashboard filter',
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
      ticketName: '',
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
      ticketName: '',
      sprint: '',
      fixVersion: '2026.06',
    })).toBe(true);
    expect(jiraTaskMatchesFilters(taskWithVersion, {
      ticketType: '',
      ticketName: '',
      sprint: '',
      fixVersion: '2026.07',
    })).toBe(false);
  });
});
