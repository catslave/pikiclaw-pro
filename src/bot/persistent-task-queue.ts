/**
 * Durable queue for tasks that are queued but have not started running yet.
 *
 * Running tasks are intentionally not persisted here: after a process restart
 * we cannot know whether their side effects already happened, so only tasks
 * that were still waiting behind the active turn are safe to replay.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Agent, HandoverRef } from '../agent/index.js';
import type { ChatId } from '../core/utils.js';

export interface PersistedQueuedTask {
  version: 1;
  taskId: string;
  createdAt: number;
  chatId: ChatId;
  sourceMessageId: number | string;
  workdir: string;
  agent: Agent;
  sessionId: string;
  prompt: string;
  attachments: string[];
  modelId?: string | null;
  thinkingEffort?: string | null;
  handoverFrom?: HandoverRef | null;
  goalContinuation?: { kind: 'continuation' | 'budget_wrapup'; goalId: string };
  forkOf?: { parentSessionId: string; atTurn: number };
}

interface QueueFile {
  version: 1;
  tasks: PersistedQueuedTask[];
}

function queueFilePath() {
  return process.env.PIKICLAW_TASK_QUEUE_FILE || path.join(os.homedir(), '.pikiclaw', 'task-queue.json');
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readQueueFile(): QueueFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFilePath(), 'utf-8')) as QueueFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
    return {
      version: 1,
      tasks: parsed.tasks.filter(task => (
        task
        && task.version === 1
        && typeof task.taskId === 'string'
        && typeof task.workdir === 'string'
        && typeof task.agent === 'string'
        && typeof task.sessionId === 'string'
        && typeof task.prompt === 'string'
      )),
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeQueueFile(file: QueueFile) {
  const filePath = queueFilePath();
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

export function loadPersistedQueuedTasks(): PersistedQueuedTask[] {
  return readQueueFile().tasks.sort((a, b) => a.createdAt - b.createdAt);
}

export function upsertPersistedQueuedTask(task: PersistedQueuedTask) {
  const file = readQueueFile();
  const next = file.tasks.filter(existing => existing.taskId !== task.taskId);
  next.push(task);
  next.sort((a, b) => a.createdAt - b.createdAt);
  writeQueueFile({ version: 1, tasks: next });
}

export function removePersistedQueuedTask(taskId: string) {
  const file = readQueueFile();
  const next = file.tasks.filter(task => task.taskId !== taskId);
  if (next.length === file.tasks.length) return;
  writeQueueFile({ version: 1, tasks: next });
}

export function reorderPersistedQueuedTasks(taskIds: string[]) {
  if (!taskIds.length) return;
  const order = new Map(taskIds.map((taskId, idx) => [taskId, idx]));
  const file = readQueueFile();
  const matching = file.tasks.filter(task => order.has(task.taskId));
  if (matching.length < 2) return;
  const baseCreatedAt = Math.min(...matching.map(task => task.createdAt));
  const next = file.tasks.map(task => {
    const idx = order.get(task.taskId);
    return idx == null ? task : { ...task, createdAt: baseCreatedAt + idx };
  });
  next.sort((a, b) => a.createdAt - b.createdAt);
  writeQueueFile({ version: 1, tasks: next });
}
