import { describe, expect, it } from 'vitest';
import type { DailyItem, JiraRemoteUpdateRun, NotePage, ProTask, TodoItem } from '../dashboard/src/types';
import {
  CHAT_HOME_DAILY_ASSISTANT_ID,
  balanceChatHomeNextActionItems,
  buildChatHomeNextActionItems,
  chatHomeDailyLaunchTargetValue,
  chatHomeWorkSurfaceLaunchTargetValue,
  chatHomeNextActionLoadLabel,
  chatHomeNextActionOwnerHint,
  chatHomeNextActionPlanTodayTarget,
  chatHomeNextActionPromoteTarget,
  chatHomeNextActionPrompt,
  chatHomeNextActionRoutes,
  chatHomeNextActionTaskId,
  chatHomeNextActionTodayPrompt,
} from '../dashboard/src/pages/wayland/chatHomeNextActions';
import type { WorkItemActionQueueItem, WorkItemActionQueueKind } from '../dashboard/src/pages/wayland/workItemActionQueue';

const now = '2026-06-16T00:00:00.000Z';

function task(input: Partial<ProTask> = {}): ProTask {
  return {
    id: input.id || 'task-1',
    localKey: input.localKey || 'PCL-1',
    title: input.title || 'Work item',
    kind: input.kind || 'manual',
    status: input.status || 'backlog',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    stageRuns: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

function todo(input: Partial<TodoItem> = {}): TodoItem {
  return {
    id: input.id || 'todo-1',
    kind: input.kind || 'todo',
    title: input.title || 'Inbox capture',
    status: input.status || 'open',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function daily(input: Partial<DailyItem> = {}): DailyItem {
  return {
    id: input.id || 'daily-1',
    date: input.date || '2026-06-16',
    title: input.title || 'Daily item',
    status: input.status || 'open',
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    ...input,
  };
}

function note(input: Partial<NotePage> = {}): NotePage {
  return {
    id: input.id || 'note-1',
    kind: input.kind || 'daily',
    title: input.title || 'Daily note',
    date: input.date || '2026-06-16',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    deletedAt: null,
    parentId: input.parentId,
    ...input,
  };
}

function run(input: Partial<JiraRemoteUpdateRun> & Pick<JiraRemoteUpdateRun, 'id' | 'taskId' | 'status'>): JiraRemoteUpdateRun {
  return {
    jiraKey: 'PCL-9',
    fields: {},
    diff: [],
    createdAt: now,
    updatedAt: now,
    events: [],
    ...input,
  };
}

function queueItem(
  kind: WorkItemActionQueueKind,
  priority: number,
  key: string,
  input: Partial<WorkItemActionQueueItem> = {},
): WorkItemActionQueueItem {
  return {
    key,
    kind,
    sourceLabel: kind === 'inbox' ? 'Inbox' : kind,
    actionLabel: kind === 'inbox' ? 'Promote' : 'Open',
    title: key,
    detail: 'Detail',
    to: kind === 'inbox' ? `/work-items?source=inbox&todo=${key}` : `/work-items?item=${key}`,
    priority,
    tone: kind === 'source' || kind === 'jira' ? 'warn' : 'ok',
    keys: kind === 'inbox' ? ['Promote'] : ['Open'],
    ...input,
  };
}

describe('Wayland Chat Home next actions', () => {
  it('uses project-scoped work items while keeping native intake sources visible', () => {
    const selectedProjectTask = task({
      id: 'project-task',
      workdir: '/repo/project-a',
      title: 'Repair project source',
      kind: 'todo',
    });
    const otherProjectTask = task({
      id: 'other-task',
      workdir: '/repo/project-b',
      title: 'Other deliverable',
      outputs: [{
        id: 'out-other',
        kind: 'file',
        title: 'Other report',
        path: '/tmp/other.md',
        createdAt: now,
      }],
    });

    const items = buildChatHomeNextActionItems({
      workItems: [otherProjectTask, selectedProjectTask],
      todoItems: [],
      inboxItems: [todo({ id: 'inbox-rich', body: 'Needs promotion', source: { type: 'manual' } })],
      dailyItems: [daily({ id: 'daily-plan' })],
      notePages: [note({ id: 'note-today' })],
      jiraRemoteRuns: [],
      selectedWorkspacePath: '/repo/project-a',
      todayDate: '2026-06-16',
      limit: 4,
    });

    expect(items.map(item => item.kind)).toEqual(['source', 'note', 'daily', 'inbox']);
    expect(items.some(item => item.title.includes('Other deliverable'))).toBe(false);
  });

  it('falls back to global work items when the selected project has no actions', () => {
    const globalTask = task({
      id: 'global-output',
      workdir: '/repo/project-b',
      title: 'Review global output',
      outputs: [{
        id: 'out-global',
        kind: 'file',
        title: 'Global report',
        path: '/tmp/global.md',
        createdAt: now,
      }],
    });

    const items = buildChatHomeNextActionItems({
      workItems: [globalTask],
      todoItems: [],
      inboxItems: [],
      dailyItems: [],
      notePages: [],
      jiraRemoteRuns: [],
      selectedWorkspacePath: '/repo/project-a',
      todayDate: '2026-06-16',
      limit: 4,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'deliverable',
      title: expect.stringContaining('Review global output'),
    });
  });

  it('falls back to open todos when explicit inbox actions have not loaded yet', () => {
    const items = buildChatHomeNextActionItems({
      workItems: [],
      todoItems: [todo({ id: 'todo-open', title: 'Open inbox fallback' })],
      inboxItems: [],
      dailyItems: [],
      notePages: [],
      jiraRemoteRuns: [],
      todayDate: '2026-06-16',
      limit: 4,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'inbox',
      title: 'Inbox capture: Open inbox fallback',
    });
  });

  it('keeps an inbox planning action visible when outputs would fill Chat Home', () => {
    const items = balanceChatHomeNextActionItems([
      queueItem('deliverable', 32, 'deliverable-1'),
      queueItem('note', 18, 'note-1'),
      queueItem('deliverable', 32, 'deliverable-2'),
      queueItem('deliverable', 32, 'deliverable-3'),
      queueItem('inbox', 12, 'todo-1'),
      queueItem('daily', 8, 'daily-1'),
    ], 4);

    expect(items.map(item => item.kind)).toEqual(['deliverable', 'note', 'deliverable', 'inbox']);
  });

  it('does not replace critical Jira or source actions to force inbox visibility', () => {
    const items = balanceChatHomeNextActionItems([
      queueItem('jira', 48, 'jira-1'),
      queueItem('jira', 48, 'jira-2'),
      queueItem('source', 40, 'source-1'),
      queueItem('source', 40, 'source-2'),
      queueItem('inbox', 12, 'todo-1'),
    ], 4);

    expect(items.map(item => item.kind)).toEqual(['jira', 'jira', 'source', 'source']);
  });

  it('keeps failed Jira actions critical on Chat Home', () => {
    const jiraTask = task({
      id: 'jira-task',
      workdir: '/repo/project-a',
      title: 'Review failed Jira write',
      kind: 'jira-ticket',
      jiraKey: 'PCL-9',
      jiraUrl: 'https://jira.example/browse/PCL-9',
    });

    const items = buildChatHomeNextActionItems({
      workItems: [jiraTask],
      todoItems: [],
      inboxItems: [todo({ id: 'inbox-rich', body: 'Needs promotion', source: { type: 'manual' } })],
      dailyItems: [],
      notePages: [],
      jiraRemoteRuns: [run({ id: 'run-failed', taskId: 'jira-task', status: 'failed', error: 'Permission denied' })],
      selectedWorkspacePath: '/repo/project-a',
      todayDate: '2026-06-16',
      limit: 2,
    });

    expect(items[0]).toMatchObject({
      kind: 'jira',
      tone: 'warn',
      secondaryLabel: 'Open Jira',
    });
  });

  it('extracts task ids for load-to-chat actions', () => {
    expect(chatHomeNextActionTaskId({
      to: '/work-items?task=task-1&tab=source',
    })).toBe('task-1');
    expect(chatHomeNextActionTaskId(queueItem('handoff', 35, 'handoff-task', {
      taskId: 'task-42',
      to: '/chat',
    }))).toBe('task-42');
    expect(chatHomeNextActionTaskId({
      to: '/work-items?source=inbox&todo=todo-1',
    })).toBeNull();
  });

  it('builds promote-ready targets only for native intake actions', () => {
    expect(chatHomeNextActionPromoteTarget({
      kind: 'inbox',
      to: '/work-items?source=inbox&todo=todo-1',
    })).toEqual({
      label: 'Promote',
      to: '/work-items?source=inbox&todo=todo-1&intent=promote',
    });

    expect(chatHomeNextActionPromoteTarget({
      kind: 'daily',
      to: '/work-items?source=manual&date=2026-06-16&daily=daily-1',
    })).toEqual({
      label: 'Plan',
      to: '/work-items?source=manual&date=2026-06-16&daily=daily-1&intent=promote',
    });

    expect(chatHomeNextActionPromoteTarget({
      kind: 'deliverable',
      to: '/work-items?task=task-1&tab=output',
    })).toBeNull();
  });

  it('builds plan-today targets only for inbox actions', () => {
    expect(chatHomeNextActionPlanTodayTarget({
      kind: 'inbox',
      to: '/work-items?source=inbox&todo=todo-1',
    })).toEqual({
      label: 'Today',
      to: '/work-items?source=inbox&todo=todo-1&intent=plan',
    });

    expect(chatHomeNextActionPlanTodayTarget({
      kind: 'note',
      to: '/work-items?source=manual&note=note-1',
    })).toBeNull();

    expect(chatHomeNextActionPlanTodayTarget({
      kind: 'jira',
      to: '/work-items?task=task-1&tab=jira',
    })).toBeNull();
  });

  it('surfaces Daily Assistant ownership for inbox Today actions', () => {
    expect(chatHomeNextActionOwnerHint({ kind: 'inbox' })).toEqual({
      label: 'Owner',
      value: 'Daily Assistant',
    });
    expect(chatHomeNextActionOwnerHint({ kind: 'note' })).toBeNull();
    expect(chatHomeNextActionOwnerHint({ kind: 'deliverable' })).toBeNull();
  });

  it('resolves a configured Daily Assistant before the built-in fallback owner', () => {
    expect(chatHomeDailyLaunchTargetValue({
      defaults: { assistantId: 'assistant_focus', agent: 'codex', model: 'gpt-5' },
      assistantIds: ['assistant_daily', 'assistant_focus'],
      agentIds: ['codex'],
      fallbackAssistantId: CHAT_HOME_DAILY_ASSISTANT_ID,
      fallbackAgent: 'codex',
    })).toBe('assistant:assistant_focus');
  });

  it('falls back to the built-in Daily Assistant when the configured owner is missing', () => {
    expect(chatHomeDailyLaunchTargetValue({
      defaults: { assistantId: 'assistant_missing', agent: 'codex', model: 'gpt-5' },
      assistantIds: ['assistant_daily'],
      agentIds: ['codex'],
      fallbackAssistantId: CHAT_HOME_DAILY_ASSISTANT_ID,
      fallbackAgent: 'codex',
    })).toBe(`assistant:${CHAT_HOME_DAILY_ASSISTANT_ID}`);
  });

  it('uses a Daily model override when no Assistant owner is available', () => {
    expect(chatHomeDailyLaunchTargetValue({
      defaults: { agent: 'codex', model: 'gpt-5-codex' },
      assistantIds: [],
      agentIds: ['codex', 'claude'],
      fallbackAssistantId: CHAT_HOME_DAILY_ASSISTANT_ID,
      fallbackAgent: 'claude',
    })).toBe('model:codex:gpt-5-codex');
  });

  it('uses the fallback agent for Daily model overrides when the configured agent is unavailable', () => {
    expect(chatHomeDailyLaunchTargetValue({
      defaults: { agent: 'missing', model: 'claude-opus-4.1' },
      assistantIds: [],
      agentIds: ['claude'],
      fallbackAssistantId: CHAT_HOME_DAILY_ASSISTANT_ID,
      fallbackAgent: 'claude',
    })).toBe('model:claude:claude-opus-4.1');
  });

  it('falls back to an Agent target for Daily work when no Assistant or model override exists', () => {
    expect(chatHomeDailyLaunchTargetValue({
      defaults: { agent: 'codex' },
      assistantIds: [],
      agentIds: ['codex'],
      fallbackAssistantId: CHAT_HOME_DAILY_ASSISTANT_ID,
      fallbackAgent: 'claude',
    })).toBe('agent:codex');
  });

  it('resolves a configured Work surface Assistant before task defaults', () => {
    expect(chatHomeWorkSurfaceLaunchTargetValue({
      defaults: { assistantId: 'assistant_task_creator', agent: 'codex', model: 'gpt-5.5' },
      assistantIds: ['assistant_refinement', 'assistant_task_creator'],
      agentIds: ['codex'],
      fallbackAssistantId: 'assistant_refinement',
      fallbackAgent: 'codex',
    })).toBe('assistant:assistant_task_creator');
  });

  it('lets Work surface model overrides beat fallback task assistants', () => {
    expect(chatHomeWorkSurfaceLaunchTargetValue({
      defaults: { agent: 'codex', model: 'gpt-5.5' },
      assistantIds: ['assistant_refinement'],
      agentIds: ['codex'],
      fallbackAssistantId: 'assistant_refinement',
      fallbackAgent: 'codex',
    })).toBe('model:codex:gpt-5.5');
  });

  it('falls back to the task Assistant when Work surface defaults are empty', () => {
    expect(chatHomeWorkSurfaceLaunchTargetValue({
      defaults: {},
      assistantIds: ['assistant_refinement'],
      agentIds: ['codex'],
      fallbackAssistantId: 'assistant_refinement',
      fallbackAgent: 'codex',
    })).toBe('assistant:assistant_refinement');
  });

  it('prioritizes Today before Promote for inbox actions', () => {
    expect(chatHomeNextActionRoutes({
      kind: 'inbox',
      to: '/work-items?source=inbox&todo=todo-1',
    })).toEqual([
      {
        kind: 'plan-today',
        label: 'Today',
        to: '/work-items?source=inbox&todo=todo-1&intent=plan',
        primary: true,
      },
      {
        kind: 'promote',
        label: 'Promote',
        to: '/work-items?source=inbox&todo=todo-1&intent=promote',
        primary: false,
      },
    ]);

    expect(chatHomeNextActionRoutes({
      kind: 'note',
      to: '/work-items?source=manual&note=note-1',
    })).toEqual([
      {
        kind: 'promote',
        label: 'Promote',
        to: '/work-items?source=manual&note=note-1&intent=promote',
        primary: true,
      },
    ]);
  });

  it('uses Daily Assistant semantics when loading inbox work into Chat Home', () => {
    expect(CHAT_HOME_DAILY_ASSISTANT_ID).toBe('assistant_daily');
    expect(chatHomeNextActionLoadLabel({ kind: 'inbox' })).toBe('Load today');
    expect(chatHomeNextActionLoadLabel({ kind: 'note' })).toBe('Load');

    const prompt = chatHomeNextActionTodayPrompt({
      sourceLabel: 'Inbox',
      title: 'Inbox capture: follow up',
      detail: 'Inbox capture · 1 image',
      to: '/work-items?source=inbox&todo=todo-1',
      keys: ['Promote', 'Evidence'],
      lanes: [
        { label: 'Source', value: 'Image', tone: 'source' },
        { label: 'Execution', value: 'Promote', tone: 'execution' },
      ],
    });

    expect(prompt).toContain('Plan this Inbox item for today with Daily Assistant.');
    expect(prompt).toContain('Signals: Promote, Evidence');
    expect(prompt).toContain('Lanes: Source: Image; Execution: Promote');
    expect(prompt).toContain('Goal & Plan');
    expect(prompt).toContain('wait for confirmation');
  });

  it('builds a compact fallback prompt for non-task actions', () => {
    const prompt = chatHomeNextActionPrompt({
      actionLabel: 'Promote',
      sourceLabel: 'Inbox',
      title: 'Inbox capture: follow up',
      detail: 'Inbox capture · 1 image',
      to: '/work-items?source=inbox&todo=todo-1',
      keys: ['Promote', 'Evidence'],
      lanes: [
        { label: 'Source', value: 'Image', tone: 'source' },
        { label: 'Execution', value: 'Promote', tone: 'execution' },
      ],
    });

    expect(prompt).toContain('Action: Promote');
    expect(prompt).toContain('Source: Inbox');
    expect(prompt).toContain('Signals: Promote, Evidence');
    expect(prompt).toContain('Lanes: Source: Image; Execution: Promote');
    expect(prompt).toContain('Route: /work-items?source=inbox&todo=todo-1');
    expect(prompt).toContain('Please help me complete the next concrete step.');
  });
});
