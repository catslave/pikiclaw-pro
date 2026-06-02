import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir } from './support/env.ts';
import { createTodoItem, getTodoItems } from '../src/pro/todos.ts';
import { createProTask, getProTask, updateProTaskMeta } from '../src/pro/tasks.ts';
import {
  addTaskToDaily,
  addTodoToDaily,
  createDailyItems,
  listDailyItems,
  promoteDailyItemsToTasks,
  revertDailyItemTask,
  revertDailyItemTaskForTask,
  reorderDailyItems,
} from '../src/pro/daily-items.ts';

let tmpDir: string;
let previousTaskFile: string | undefined;
let previousTodoFile: string | undefined;
let previousDailyFile: string | undefined;

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-daily-');
  previousTaskFile = process.env.PIKICLAW_PRO_TASK_FILE;
  previousTodoFile = process.env.PIKICLAW_PRO_TODO_FILE;
  previousDailyFile = process.env.PIKICLAW_PRO_DAILY_FILE;
  process.env.PIKICLAW_PRO_TASK_FILE = path.join(tmpDir, 'tasks.json');
  process.env.PIKICLAW_PRO_TODO_FILE = path.join(tmpDir, 'todos.json');
  process.env.PIKICLAW_PRO_DAILY_FILE = path.join(tmpDir, 'daily-items.json');
});

afterEach(() => {
  if (previousTaskFile == null) delete process.env.PIKICLAW_PRO_TASK_FILE;
  else process.env.PIKICLAW_PRO_TASK_FILE = previousTaskFile;
  if (previousTodoFile == null) delete process.env.PIKICLAW_PRO_TODO_FILE;
  else process.env.PIKICLAW_PRO_TODO_FILE = previousTodoFile;
  if (previousDailyFile == null) delete process.env.PIKICLAW_PRO_DAILY_FILE;
  else process.env.PIKICLAW_PRO_DAILY_FILE = previousDailyFile;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Daily item store', () => {
  it('creates lightweight daily items for a selected day', () => {
    const items = createDailyItems({
      date: '2026-06-01',
      titles: ['Write standup', 'Review deploy plan'],
    });

    expect(items).toHaveLength(2);
    expect(items.map(item => item.status)).toEqual(['open', 'open']);
    expect(listDailyItems('2026-06-01').map(item => item.title)).toEqual([
      'Write standup',
      'Review deploy plan',
    ]);
  });

  it('promotes selected daily items into backlog tasks while keeping the daily record', () => {
    const [first, second] = createDailyItems({
      date: '2026-06-01',
      titles: ['Clarify onboarding', 'Plan the release'],
    });

    const promoted = promoteDailyItemsToTasks('2026-06-01', [first.id, second.id]);

    expect(promoted.taskIds).toHaveLength(2);
    const tasks = promoted.taskIds.map(taskId => getProTask(taskId));
    expect(tasks.map(task => task?.title)).toEqual(['Clarify onboarding', 'Plan the release']);
    expect(tasks.every(task => task?.status === 'backlog')).toBe(true);
    expect(tasks.every(task => task?.plannedDate === '2026-06-01')).toBe(true);
    expect(listDailyItems('2026-06-01').every(item => item.status === 'task-created')).toBe(true);
  });

  it('promotes daily items into tasks in the selected workspace', () => {
    const [item] = createDailyItems({
      date: '2026-06-01',
      titles: ['Prepare workspace scoped plan'],
    });

    const promoted = promoteDailyItemsToTasks('2026-06-01', [item.id], { workdir: '/repo/current' });

    expect(promoted.taskIds).toHaveLength(1);
    expect(getProTask(promoted.taskIds[0])).toMatchObject({
      title: 'Prepare workspace scoped plan',
      workdir: '/repo/current',
      plannedDate: '2026-06-01',
      status: 'backlog',
    });
    expect(listDailyItems('2026-06-01')[0]).toMatchObject({
      id: item.id,
      status: 'task-created',
      taskId: promoted.taskIds[0],
      taskKey: 'MY-0001',
    });
  });

  it('reverts a promoted daily item to open and removes the task from the day', () => {
    const [item] = createDailyItems({
      date: '2026-06-01',
      titles: ['Test rollback flow'],
    });
    const promoted = promoteDailyItemsToTasks('2026-06-01', [item.id]);
    const taskId = promoted.taskIds[0];

    const reverted = revertDailyItemTask(item.id);

    expect(reverted).toMatchObject({ id: item.id, status: 'open' });
    expect(reverted.taskId).toBeUndefined();
    expect(reverted.taskKey).toBeUndefined();
    expect(getProTask(taskId)?.plannedDate).toBeUndefined();
    const stored = listDailyItems('2026-06-01')[0];
    expect(stored).toMatchObject({ id: item.id, status: 'open' });
    expect(stored.taskId).toBeUndefined();
    expect(stored.taskKey).toBeUndefined();
  });

  it('reverts a daily item by task id when a task is removed from the daily board', () => {
    const [item] = createDailyItems({
      date: '2026-06-01',
      titles: ['Remove from daily board'],
    });
    const promoted = promoteDailyItemsToTasks('2026-06-01', [item.id]);
    const taskId = promoted.taskIds[0];

    const reverted = revertDailyItemTaskForTask(taskId);

    expect(reverted).toMatchObject({ id: item.id, status: 'open' });
    expect(reverted?.taskId).toBeUndefined();
    expect(reverted?.taskKey).toBeUndefined();
    expect(getProTask(taskId)?.plannedDate).toBeUndefined();
  });

  it('reverts a daily item by task id after the task day was already cleared', () => {
    const [item] = createDailyItems({
      date: '2026-06-01',
      titles: ['Remove after task meta update'],
    });
    const promoted = promoteDailyItemsToTasks('2026-06-01', [item.id]);
    const taskId = promoted.taskIds[0];
    updateProTaskMeta(taskId, { plannedDate: null });

    const reverted = revertDailyItemTaskForTask(taskId);

    expect(reverted).toMatchObject({ id: item.id, status: 'open' });
    expect(reverted?.taskId).toBeUndefined();
    expect(reverted?.taskKey).toBeUndefined();
  });

  it('repairs task-ready daily items when their task is no longer planned for that day', () => {
    const [item] = createDailyItems({
      date: '2026-06-01',
      titles: ['Repair stale daily action state'],
    });
    const promoted = promoteDailyItemsToTasks('2026-06-01', [item.id]);
    updateProTaskMeta(promoted.taskIds[0], { plannedDate: null });

    const [repaired] = listDailyItems('2026-06-01');

    expect(repaired).toMatchObject({ id: item.id, status: 'open' });
    expect(repaired.taskId).toBeUndefined();
    expect(repaired.taskKey).toBeUndefined();
  });

  it('adds a todo to daily by creating a task and archiving the original todo', () => {
    const todo = createTodoItem({
      title: 'Check API drift',
      body: 'Compare the dashboard state with the latest Jira fields.',
    });

    const result = addTodoToDaily('2026-06-01', todo.id);

    expect(result.item.taskId).toBeTruthy();
    expect(result.item.taskKey).toBe('MY-0001');
    expect(result.item.sourceTodoId).toBe(todo.id);
    expect(getProTask(result.taskId)).toMatchObject({
      title: 'Check API drift',
      status: 'backlog',
      plannedDate: '2026-06-01',
    });
    expect(getTodoItems([todo.id])[0]?.status).toBe('archived');
  });

  it('adds an existing task to daily without changing its space ownership', () => {
    const task = createProTask({
      title: 'Investigate regression',
      kind: 'jira-bug',
      spaceId: 'jira',
    });

    const result = addTaskToDaily('2026-06-01', task.id);

    expect(result.item.taskId).toBe(task.id);
    expect(result.item.taskKey).toBe(task.localKey);
    expect(result.item.sourceTaskId).toBe(task.id);
    expect(getProTask(task.id)).toMatchObject({
      id: task.id,
      spaceId: 'jira',
      plannedDate: '2026-06-01',
    });
  });

  it('reorders daily items to reflect user priority for the selected day', () => {
    const [first, second, third] = createDailyItems({
      date: '2026-06-01',
      titles: ['First item', 'Second item', 'Third item'],
    });

    const reordered = reorderDailyItems('2026-06-01', [third.id, first.id, second.id]);

    expect(reordered.map(item => item.id)).toEqual([third.id, first.id, second.id]);
    expect(listDailyItems('2026-06-01').map(item => item.title)).toEqual([
      'Third item',
      'First item',
      'Second item',
    ]);
  });
});
