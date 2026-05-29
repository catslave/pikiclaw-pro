import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { listProTasks, type ProTask } from './tasks.js';

export type JiraCycleStatus = 'active' | 'closed';

export interface JiraCycleTaskSnapshot {
  taskId: string;
  jiraKey?: string;
  title: string;
  assignee?: string;
  sprint?: string;
  completedAt: string;
}

export interface JiraCycle {
  id: string;
  name: string;
  status: JiraCycleStatus;
  startedAt: string;
  endsAt?: string;
  closedAt?: string;
  tasks: JiraCycleTaskSnapshot[];
}

interface JiraCycleFile {
  version: 1;
  cycles: JiraCycle[];
}

function cycleFilePath() {
  return process.env.PIKICLAW_PRO_JIRA_CYCLE_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'jira-cycles.json');
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function readFile(): JiraCycleFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(cycleFilePath(), 'utf-8')) as JiraCycleFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cycles)) return { version: 1, cycles: [] };
    return {
      version: 1,
      cycles: parsed.cycles
        .filter(cycle => cycle && typeof cycle.id === 'string' && typeof cycle.name === 'string')
        .map(cycle => ({
          ...cycle,
          status: cycle.status === 'active' ? 'active' : 'closed',
          tasks: Array.isArray(cycle.tasks) ? cycle.tasks : [],
        })),
    };
  } catch {
    return { version: 1, cycles: [] };
  }
}

function writeFile(file: JiraCycleFile) {
  const filePath = cycleFilePath();
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function normalizeName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, 80);
}

function parseLocalDate(value: unknown, endOfDay = false): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compactDateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function defaultCycleName(startedAt: string, endsAt?: string): string {
  const start = compactDateLabel(startedAt);
  const end = endsAt ? compactDateLabel(endsAt) : start;
  return start && end ? `${start}-${end}` : 'Cycle';
}

function doneTasksForWindow(tasks: ProTask[], startedAt: string, endsAt?: string): JiraCycleTaskSnapshot[] {
  const startMs = Date.parse(startedAt);
  const endMs = endsAt ? Date.parse(endsAt) : Date.now();
  return tasks
    .filter(task => {
      if (task.status !== 'done') return false;
      const doneMs = Date.parse(task.updatedAt);
      return Number.isFinite(doneMs) && doneMs >= startMs && doneMs <= endMs;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(task => ({
      taskId: task.id,
      jiraKey: task.jiraKey,
      title: task.title,
      assignee: task.jiraFields?.assignee,
      sprint: task.sprint,
      completedAt: task.updatedAt,
    }));
}

function hydrateActiveCycle(cycle: JiraCycle, tasks = listProTasks()): JiraCycle {
  if (cycle.status !== 'active') return cycle;
  return { ...cycle, tasks: doneTasksForWindow(tasks, cycle.startedAt, cycle.endsAt) };
}

export function listJiraCycles(): JiraCycle[] {
  const tasks = listProTasks();
  return readFile().cycles
    .map(cycle => hydrateActiveCycle(cycle, tasks))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function kickOffJiraCycle(input: { name?: unknown; startDate?: unknown; endDate?: unknown } = {}): JiraCycle {
  const file = readFile();
  const active = file.cycles.find(cycle => cycle.status === 'active');
  if (active) return hydrateActiveCycle(active);
  const now = new Date().toISOString();
  const startedAt = parseLocalDate(input.startDate, false) || now;
  const endsAt = parseLocalDate(input.endDate, true) || undefined;
  const cycle: JiraCycle = {
    id: newId('jira_cycle'),
    name: normalizeName(input.name) || defaultCycleName(startedAt, endsAt),
    status: 'active',
    startedAt,
    endsAt,
    tasks: [],
  };
  file.cycles.unshift(cycle);
  writeFile(file);
  return hydrateActiveCycle(cycle);
}

export function closeActiveJiraCycle(): JiraCycle | null {
  const file = readFile();
  const active = file.cycles.find(cycle => cycle.status === 'active');
  if (!active) return null;
  const closedAt = new Date().toISOString();
  active.status = 'closed';
  active.closedAt = closedAt;
  active.tasks = doneTasksForWindow(listProTasks(), active.startedAt, active.endsAt || closedAt);
  writeFile(file);
  return active;
}

export function deleteJiraCycle(cycleId: string): JiraCycle {
  const file = readFile();
  const index = file.cycles.findIndex(cycle => cycle.id === cycleId);
  if (index < 0) throw new Error('cycle not found');
  const [cycle] = file.cycles.splice(index, 1);
  writeFile(file);
  return cycle;
}
