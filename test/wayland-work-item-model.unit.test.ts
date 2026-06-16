import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types.ts';
import {
  normalizeWorkItemDateParam,
  normalizeWorkItemFilter,
  normalizeWorkItemSourceFilter,
  workItemFilterCount,
  workItemFilterCountSummary,
  workItemFilterMatches,
  workItemFilterShowsIntake,
  workItemSourceFilterCount,
  workItemSourceFilterMatches,
  workItemSourceKind,
} from '../dashboard/src/pages/wayland/workItemModel.ts';

const task = (input: Partial<ProTask> & Pick<ProTask, 'id' | 'title'>): ProTask => ({
  id: input.id,
  title: input.title,
  description: input.description,
  kind: input.kind || 'manual',
  status: input.status || 'backlog',
  jiraKey: input.jiraKey,
  jiraFields: input.jiraFields,
  createdAt: input.createdAt || '2026-06-14T00:00:00.000Z',
  updatedAt: input.updatedAt || '2026-06-14T01:00:00.000Z',
  stageRuns: input.stageRuns || [],
  verificationRuns: input.verificationRuns || [],
  subTasks: input.subTasks || [],
  outputs: input.outputs || [],
});

describe('Wayland work item model', () => {
  it('normalizes status filters for URL state', () => {
    expect(normalizeWorkItemFilter('active')).toBe('active');
    expect(normalizeWorkItemFilter('attention')).toBe('attention');
    expect(normalizeWorkItemFilter('source')).toBe('source');
    expect(normalizeWorkItemFilter('review')).toBe('review');
    expect(normalizeWorkItemFilter('deliverables')).toBe('deliverables');
    expect(normalizeWorkItemFilter('backlog')).toBe('backlog');
    expect(normalizeWorkItemFilter('done')).toBe('done');
    expect(normalizeWorkItemFilter('closed')).toBe('active');
    expect(normalizeWorkItemFilter(null)).toBe('active');
  });

  it('normalizes source filters for URL state', () => {
    expect(normalizeWorkItemSourceFilter('inbox')).toBe('inbox');
    expect(normalizeWorkItemSourceFilter('ticket')).toBe('ticket');
    expect(normalizeWorkItemSourceFilter('manual')).toBe('manual');
    expect(normalizeWorkItemSourceFilter('automation')).toBe('automation');
    expect(normalizeWorkItemSourceFilter('jira')).toBe('all');
    expect(normalizeWorkItemSourceFilter(null)).toBe('all');
  });

  it('normalizes Work Plan date parameters for Daily intake migration', () => {
    expect(normalizeWorkItemDateParam('2026-06-14')).toBe('2026-06-14');
    expect(normalizeWorkItemDateParam('2026-6-14')).toBe('');
    expect(normalizeWorkItemDateParam('today')).toBe('');
    expect(normalizeWorkItemDateParam(null)).toBe('');
  });

  it('classifies todo, Jira, manual, and automation work items by product source', () => {
    expect(workItemSourceKind(task({ id: 'todo-1', title: 'Inbox note', kind: 'todo' }))).toBe('inbox');
    expect(workItemSourceKind(task({ id: 'jira-1', title: 'Remote ticket', kind: 'manual', jiraKey: 'AIR-123' }))).toBe('ticket');
    expect(workItemSourceKind(task({ id: 'bug-1', title: 'Bug ticket', kind: 'jira-bug' }))).toBe('ticket');
    expect(workItemSourceKind(task({ id: 'auto-1', title: 'Daily run', kind: 'automation' }))).toBe('automation');
    expect(workItemSourceKind(task({ id: 'note-1', title: 'Manual note' }))).toBe('manual');
  });

  it('matches combined Work Item source filters', () => {
    const inbox = task({ id: 'todo-1', title: 'Inbox note', kind: 'todo' });
    const ticket = task({ id: 'jira-1', title: 'Remote ticket', jiraKey: 'AIR-123' });

    expect(workItemSourceFilterMatches(inbox, 'all')).toBe(true);
    expect(workItemSourceFilterMatches(inbox, 'inbox')).toBe(true);
    expect(workItemSourceFilterMatches(inbox, 'ticket')).toBe(false);
    expect(workItemSourceFilterMatches(ticket, 'ticket')).toBe(true);
    expect(workItemSourceFilterMatches(ticket, 'manual')).toBe(false);
  });

  it('treats open intake sources as active backlog work, not done or output work', () => {
    const backlog = task({ id: 'manual-1', title: 'Manual backlog', status: 'backlog' });
    const coding = task({ id: 'code-1', title: 'Coding', status: 'coding' });
    const done = task({ id: 'done-1', title: 'Done', status: 'done' });
    const withOutput = task({
      id: 'output-1',
      title: 'Output',
      status: 'coding',
      outputs: [{ id: 'out-1', title: 'Patch', kind: 'diff', createdAt: '2026-06-14T01:00:00.000Z' }],
    });
    const tasks = [backlog, coding, done, withOutput];

    expect(workItemFilterMatches(backlog, 'backlog')).toBe(true);
    expect(workItemFilterShowsIntake('active')).toBe(true);
    expect(workItemFilterShowsIntake('backlog')).toBe(true);
    expect(workItemFilterShowsIntake('all')).toBe(true);
    expect(workItemFilterShowsIntake('done')).toBe(false);
    expect(workItemFilterShowsIntake('source')).toBe(false);
    expect(workItemFilterShowsIntake('review')).toBe(false);
    expect(workItemFilterShowsIntake('deliverables')).toBe(false);

    expect(workItemFilterCount(tasks, 'active', 3)).toBe(6);
    expect(workItemFilterCount(tasks, 'backlog', 3)).toBe(4);
    expect(workItemFilterCount(tasks, 'all', 3)).toBe(7);
    expect(workItemFilterCount(tasks, 'done', 3)).toBe(1);
    expect(workItemFilterCount(tasks, 'deliverables', 3)).toBe(1);
    expect(workItemFilterCountSummary(tasks, 'backlog', 3)).toEqual({
      tasks: 1,
      intake: 3,
      total: 4,
    });
    expect(workItemFilterCountSummary(tasks, 'done', 3)).toEqual({
      tasks: 1,
      intake: 0,
      total: 1,
    });
  });

  it('filters Work Items that need source refresh or richer evidence', () => {
    const staleJira = task({
      id: 'jira-stale',
      title: 'Stale Jira',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-123',
      jiraFields: { status: 'In Progress', updatedAt: '2026-06-01T00:00:00.000Z' },
    });
    const freshJira = task({
      id: 'jira-fresh',
      title: 'Fresh Jira',
      kind: 'jira-ticket',
      jiraKey: 'IVAS-124',
      jiraFields: { status: 'In Progress', updatedAt: new Date().toISOString() },
    });
    const thinTodo = task({ id: 'todo-thin', title: 'Thin todo', kind: 'todo' });
    const richTodo = task({
      id: 'todo-rich',
      title: 'Rich todo',
      kind: 'todo',
      description: [
        'Inbox note: inspect this capture',
        'Quoted source: button does not work',
        'Images:',
        '- broken.png',
      ].join('\n'),
    });

    expect(workItemFilterMatches(staleJira, 'source')).toBe(true);
    expect(workItemFilterMatches(freshJira, 'source')).toBe(false);
    expect(workItemFilterMatches(thinTodo, 'source')).toBe(true);
    expect(workItemFilterMatches(richTodo, 'source')).toBe(false);
    expect(workItemFilterCount([staleJira, freshJira, thinTodo, richTodo], 'source', 8)).toBe(2);
  });

  it('counts promoted work items and intake sources in the same source filter model', () => {
    const inbox = task({ id: 'todo-1', title: 'Promoted inbox note', kind: 'todo' });
    const ticket = task({ id: 'jira-1', title: 'Remote ticket', jiraKey: 'AIR-123' });
    const manual = task({ id: 'note-1', title: 'Manual note' });

    expect(workItemSourceFilterCount([inbox, ticket, manual], 'all', { inbox: 2, manual: 3 })).toBe(8);
    expect(workItemSourceFilterCount([inbox, ticket, manual], 'inbox', { inbox: 2, manual: 3 })).toBe(3);
    expect(workItemSourceFilterCount([inbox, ticket, manual], 'manual', { inbox: 2, manual: 3 })).toBe(4);
    expect(workItemSourceFilterCount([inbox, ticket, manual], 'ticket', { inbox: 2, manual: 3 })).toBe(1);
    expect(workItemSourceFilterCount([inbox, ticket, manual], 'automation', { inbox: 2, manual: 3 })).toBe(0);
  });
});
