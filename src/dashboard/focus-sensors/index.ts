import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceEntry } from '../../core/config/user-config.js';
import type { SessionInfo } from '../../agent/types.js';
import type { ProTask } from '../../pro/tasks.js';
import type { FocusGitSnapshot, FocusSandbox } from '../focus-command-center.js';
import { inspectFocusGit } from '../focus-command-center.js';
import { listFocusSandboxes } from '../focus-sandbox-store.js';
import { buildDigestIndex } from '../focus-digest-service.js';
import { listKnowledgeEntries } from '../../pro/workflow.js';
import { resolveUserStatus } from '../../bot/session-hub.js';

export interface FocusSessionSensorSnapshot {
  running: number;
  blocked: number;
  review: number;
  incomplete: number;
  attentionTotal: number;
}

export interface FocusJiraSensorItem {
  taskId: string;
  jiraKey?: string | null;
  title: string;
  status?: string | null;
  updatedAt?: string | null;
  assignee?: string | null;
  changeHint?: string | null;
}

export interface FocusJiraSensorSnapshot {
  todayIncoming: FocusJiraSensorItem[];
  resolvedPendingSync: FocusJiraSensorItem[];
  ok: boolean;
  error?: string | null;
}

export interface FocusSandboxSensorItem {
  sandboxId: string;
  title: string;
  progress: number;
  state: string;
  deltaHint?: string | null;
}

export interface FocusSensorSnapshot {
  capturedAt: string;
  localDay: string;
  git: FocusGitSnapshot[];
  session: FocusSessionSensorSnapshot;
  jira: FocusJiraSensorSnapshot;
  sandboxes: FocusSandboxSensorItem[];
}

function focusDir() {
  return process.env.PIKICLAW_FOCUS_DIR || path.join(os.homedir(), '.pikiclaw', 'focus');
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isAttentionSession(session: SessionInfo): boolean {
  if (session.archived) return false;
  if (session.running || session.runState === 'running' || session.runState === 'incomplete') return true;
  if (session.classification?.outcome === 'blocked' || session.classification?.outcome === 'partial') return true;
  const status = resolveUserStatus(session);
  return status === 'active' || status === 'review';
}

export function collectSessionSensor(sessions: SessionInfo[]): FocusSessionSensorSnapshot {
  let running = 0;
  let blocked = 0;
  let review = 0;
  let incomplete = 0;
  for (const session of sessions) {
    if (session.archived) continue;
    if (session.running || session.runState === 'running') running += 1;
    if (session.runState === 'incomplete') incomplete += 1;
    if (session.classification?.outcome === 'blocked' || session.classification?.outcome === 'partial') blocked += 1;
    if (resolveUserStatus(session) === 'review') review += 1;
  }
  return {
    running,
    blocked,
    review,
    incomplete,
    attentionTotal: sessions.filter(isAttentionSession).length,
  };
}

export function collectJiraSensor(tasks: ProTask[], now = new Date()): FocusJiraSensorSnapshot {
  const todayStart = startOfLocalDay(now).getTime();
  try {
    const todayIncoming = tasks
      .filter(task => {
        const updated = Date.parse(task.jiraFields?.updatedAt || task.updatedAt || '') || 0;
        return updated >= todayStart || task.plannedDate === localDateKey(now);
      })
      .slice(0, 12)
      .map(task => ({
        taskId: task.id,
        jiraKey: task.jiraKey,
        title: task.title,
        status: task.status,
        updatedAt: task.updatedAt,
        assignee: task.jiraFields?.assignee || null,
        changeHint: task.plannedDate === localDateKey(now) ? 'Planned for today' : 'Jira updated today',
      }));
    const resolvedPendingSync = tasks
      .filter(task => task.status === 'resolved' && (task.jiraKey || task.jiraUrl))
      .slice(0, 12)
      .map(task => ({
        taskId: task.id,
        jiraKey: task.jiraKey,
        title: task.title,
        status: task.status,
        updatedAt: task.updatedAt,
        changeHint: 'Ready for Jira / QA sync',
      }));
    return { todayIncoming, resolvedPendingSync, ok: true };
  } catch (error: any) {
    return { todayIncoming: [], resolvedPendingSync: [], ok: false, error: error?.message || String(error) };
  }
}

export function collectSandboxSensor(activeSandboxes: FocusSandbox[]): FocusSandboxSensorItem[] {
  return activeSandboxes.slice(0, 12).map(item => ({
    sandboxId: item.id,
    title: item.title,
    progress: item.progress,
    state: item.state,
    deltaHint: item.breakpoint || item.summary || null,
  }));
}

export async function collectFocusSensorSnapshot(input: {
  workspaces: WorkspaceEntry[];
  sessions: SessionInfo[];
  tasks: ProTask[];
  activeSandboxes: FocusSandbox[];
  now?: Date;
}): Promise<FocusSensorSnapshot> {
  const now = input.now || new Date();
  const git = await inspectFocusGit(input.workspaces);
  return {
    capturedAt: now.toISOString(),
    localDay: localDateKey(now),
    git,
    session: collectSessionSensor(input.sessions),
    jira: collectJiraSensor(input.tasks, now),
    sandboxes: collectSandboxSensor(input.activeSandboxes),
  };
}

export function sensorSnapshotPath(localDay: string) {
  return path.join(focusDir(), `snapshot-${localDay}.json`);
}

export function saveSensorSnapshot(snapshot: FocusSensorSnapshot) {
  fs.mkdirSync(focusDir(), { recursive: true });
  fs.writeFileSync(sensorSnapshotPath(snapshot.localDay), JSON.stringify(snapshot, null, 2));
}

export function loadSensorSnapshot(localDay: string): FocusSensorSnapshot | null {
  const filePath = sensorSnapshotPath(localDay);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FocusSensorSnapshot;
  } catch {
    return null;
  }
}

export function loadPreviousSensorSnapshot(localDay: string): FocusSensorSnapshot | null {
  const dir = focusDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(name => name.startsWith('snapshot-') && name.endsWith('.json') && name !== `snapshot-${localDay}.json`)
    .sort()
    .reverse();
  for (const name of files) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as FocusSensorSnapshot;
    } catch {
      continue;
    }
  }
  return null;
}

export function sensorDigestSummary(snapshot: FocusSensorSnapshot, previous: FocusSensorSnapshot | null): string {
  const parts = [
    `Git workspaces dirty: ${snapshot.git.filter(item => item.changedFiles > 0).length}`,
    `Attention sessions: ${snapshot.session.attentionTotal}`,
    `Jira incoming today: ${snapshot.jira.todayIncoming.length}`,
    `Resolved pending sync: ${snapshot.jira.resolvedPendingSync.length}`,
  ];
  if (previous) {
    parts.push(`Attention delta: ${snapshot.session.attentionTotal - previous.session.attentionTotal}`);
  }
  const digests = buildDigestIndex(listKnowledgeEntries({ status: 'published' }));
  parts.push(`Session digests indexed: ${digests.size}`);
  parts.push(`Persisted sandboxes: ${listFocusSandboxes().length}`);
  return parts.join('\n');
}
