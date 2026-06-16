import type { AgentAssistant, AutomationRule, ProTask, WorkflowTemplate } from '../../types';
import { defaultAssistantLaunchpadIds, launchableAssistants } from './assistantLaunchpad';
import { buildTeamProfiles, type TeamProfile } from './teamLibrary';

export const WORK_OBJECT_LAUNCHPAD_STORAGE_KEY = 'pikiclaw:wayland-shell:work-object-launchpad';
export const WORK_OBJECT_LAUNCHPAD_PRESETS_STORAGE_KEY = 'pikiclaw:wayland-shell:work-object-launch-presets';
export const WORK_OBJECT_LAUNCHPAD_MAX = 8;
export const WORK_OBJECT_LAUNCHPAD_DEFAULT_COUNT = 8;

export type WorkObjectLaunchpadKind = 'assistant' | 'team' | 'workflow' | 'workItem' | 'intake';

export type WorkObjectLaunchpadRef = {
  kind: WorkObjectLaunchpadKind;
  id: string;
};

export type WorkObjectLaunchpadWorkflow = WorkflowTemplate & {
  featured?: boolean;
  cadence?: string;
};

export type WorkObjectLaunchpadInput = {
  assistants: AgentAssistant[];
  automations: AutomationRule[];
  workflows: WorkObjectLaunchpadWorkflow[];
  workItems: ProTask[];
  fallbackAgent: string;
};

export type WorkObjectLaunchPreset = {
  projectPath?: string;
  targetValue?: string;
  effort?: 'low' | 'medium' | 'high';
  permissionMode?: 'autopilot' | 'ask' | 'read-only';
  updatedAt?: string;
};

export function workObjectLaunchpadKey(kind: WorkObjectLaunchpadKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseWorkObjectLaunchpadKey(value: string): WorkObjectLaunchpadRef | null {
  const [kind, ...rest] = String(value || '').split(':');
  const id = rest.join(':').trim();
  if (!id) return null;
  if (kind === 'assistant' || kind === 'team' || kind === 'workflow' || kind === 'workItem' || kind === 'intake') {
    return { kind, id };
  }
  return null;
}

function activeWorkItems(workItems: ProTask[]): ProTask[] {
  return workItems.filter(item => item.status !== 'done' && item.status !== 'resolved');
}

function preferredTeamProfiles(input: WorkObjectLaunchpadInput): TeamProfile[] {
  return buildTeamProfiles(input.assistants, input.automations, input.fallbackAgent)
    .filter(profile => profile.assistant.enabled !== false)
    .sort((a, b) => Number(b.standing) - Number(a.standing) || b.rosterSize - a.rosterSize || a.assistant.name.localeCompare(b.assistant.name));
}

function preferredWorkItems(workItems: ProTask[]): ProTask[] {
  return activeWorkItems(workItems)
    .sort((a, b) => {
      const aAttention = a.stageRuns.some(run => run.status === 'failed' || run.status === 'waiting-user');
      const bAttention = b.stageRuns.some(run => run.status === 'failed' || run.status === 'waiting-user');
      return Number(bAttention) - Number(aAttention) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
}

export function allowedWorkObjectLaunchpadKeys(input: WorkObjectLaunchpadInput): string[] {
  return [
    workObjectLaunchpadKey('intake', 'todo'),
    workObjectLaunchpadKey('intake', 'jira-ticket'),
    workObjectLaunchpadKey('intake', 'daily'),
    workObjectLaunchpadKey('intake', 'notes'),
    ...launchableAssistants(input.assistants).map(item => workObjectLaunchpadKey('assistant', item.id)),
    ...preferredTeamProfiles(input).map(profile => workObjectLaunchpadKey('team', profile.assistant.id)),
    ...input.workflows.map(item => workObjectLaunchpadKey('workflow', item.id)),
    ...input.workItems.map(item => workObjectLaunchpadKey('workItem', item.id)),
  ];
}

export function defaultWorkObjectLaunchpadKeys(
  input: WorkObjectLaunchpadInput,
  max = WORK_OBJECT_LAUNCHPAD_DEFAULT_COUNT,
): string[] {
  const limit = Math.max(0, Math.min(max, WORK_OBJECT_LAUNCHPAD_MAX));
  const selected: string[] = [];
  const seen = new Set<string>();
  const selectedAssistantIds = new Set<string>();
  const add = (key: string | null | undefined) => {
    if (!key || seen.has(key) || selected.length >= limit) return;
    selected.push(key);
    seen.add(key);
    const ref = parseWorkObjectLaunchpadKey(key);
    if (ref?.kind === 'assistant' || ref?.kind === 'team') selectedAssistantIds.add(ref.id);
  };
  const teams = preferredTeamProfiles(input);

  add(workObjectLaunchpadKey('intake', 'todo'));
  add(workObjectLaunchpadKey('intake', 'jira-ticket'));
  add(workObjectLaunchpadKey('intake', 'daily'));
  add(workObjectLaunchpadKey('intake', 'notes'));
  add(teams[0] ? workObjectLaunchpadKey('team', teams[0].assistant.id) : null);
  for (const assistantId of defaultAssistantLaunchpadIds(input.assistants, 2)) {
    if (selectedAssistantIds.has(assistantId)) continue;
    add(workObjectLaunchpadKey('assistant', assistantId));
  }
  const featuredWorkflow = input.workflows.find(item => item.featured) || input.workflows[0];
  add(featuredWorkflow ? workObjectLaunchpadKey('workflow', featuredWorkflow.id) : null);
  const workItem = preferredWorkItems(input.workItems)[0];
  add(workItem ? workObjectLaunchpadKey('workItem', workItem.id) : null);

  return selected.slice(0, limit);
}

export function normalizeWorkObjectLaunchpadKeys(keys: unknown, input: WorkObjectLaunchpadInput): string[] | null {
  if (!Array.isArray(keys)) return null;
  const allowed = new Set(allowedWorkObjectLaunchpadKeys(input));
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of keys) {
    const key = String(raw || '').trim();
    if (!key || seen.has(key) || !allowed.has(key)) continue;
    normalized.push(key);
    seen.add(key);
    if (normalized.length >= WORK_OBJECT_LAUNCHPAD_MAX) break;
  }
  return normalized;
}

function cleanPresetString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  if (!clean) return undefined;
  return clean.slice(0, maxLength);
}

export function normalizeWorkObjectLaunchPreset(value: unknown): WorkObjectLaunchPreset | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const projectPath = cleanPresetString(input.projectPath, 4096);
  const targetValue = cleanPresetString(input.targetValue, 512);
  const effort = input.effort === 'low' || input.effort === 'medium' || input.effort === 'high'
    ? input.effort
    : undefined;
  const permissionMode = input.permissionMode === 'autopilot' || input.permissionMode === 'ask' || input.permissionMode === 'read-only'
    ? input.permissionMode
    : undefined;
  const updatedAt = cleanPresetString(input.updatedAt, 64);
  const preset: WorkObjectLaunchPreset = {};
  if (projectPath) preset.projectPath = projectPath;
  if (targetValue && (
    targetValue.startsWith('agent:')
    || targetValue.startsWith('assistant:')
    || targetValue.startsWith('model:')
  )) preset.targetValue = targetValue;
  if (effort) preset.effort = effort;
  if (permissionMode) preset.permissionMode = permissionMode;
  if (updatedAt) preset.updatedAt = updatedAt;
  return Object.keys(preset).length ? preset : null;
}

export function normalizeWorkObjectLaunchPresets(
  value: unknown,
  allowedKeys?: string[],
): Record<string, WorkObjectLaunchPreset> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const normalized: Record<string, WorkObjectLaunchPreset> = {};
  for (const [rawKey, rawPreset] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || '').trim();
    if (!parseWorkObjectLaunchpadKey(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    const preset = normalizeWorkObjectLaunchPreset(rawPreset);
    if (!preset) continue;
    normalized[key] = preset;
  }
  return normalized;
}

export function workObjectLaunchpadCandidates(keys: string[], input: WorkObjectLaunchpadInput): string[] {
  const pinned = new Set(keys);
  return allowedWorkObjectLaunchpadKeys(input).filter(key => !pinned.has(key));
}

export function addWorkObjectLaunchpadKey(keys: string[], key: string): string[] {
  const normalized = String(key || '').trim();
  if (!normalized || keys.includes(normalized) || keys.length >= WORK_OBJECT_LAUNCHPAD_MAX) return keys;
  return [...keys, normalized];
}

export type PinWorkObjectLaunchpadResult = {
  keys: string[];
  added: boolean;
  alreadyPinned: boolean;
  atCapacity: boolean;
};

export function pinWorkObjectLaunchpadKey(
  keys: string[],
  key: string,
  max = WORK_OBJECT_LAUNCHPAD_MAX,
): PinWorkObjectLaunchpadResult {
  const normalized = String(key || '').trim();
  if (!normalized) {
    return { keys, added: false, alreadyPinned: false, atCapacity: false };
  }
  if (keys.includes(normalized)) {
    return { keys, added: false, alreadyPinned: true, atCapacity: false };
  }
  if (keys.length >= Math.max(0, max)) {
    return { keys, added: false, alreadyPinned: false, atCapacity: true };
  }
  return { keys: [...keys, normalized], added: true, alreadyPinned: false, atCapacity: false };
}

export function removeWorkObjectLaunchpadKey(keys: string[], key: string): string[] {
  return keys.filter(item => item !== key);
}

export function setWorkObjectLaunchPreset(
  presets: Record<string, WorkObjectLaunchPreset>,
  key: string,
  preset: WorkObjectLaunchPreset,
): Record<string, WorkObjectLaunchPreset> {
  const normalizedKey = String(key || '').trim();
  if (!parseWorkObjectLaunchpadKey(normalizedKey)) return presets;
  const normalizedPreset = normalizeWorkObjectLaunchPreset(preset);
  if (!normalizedPreset) {
    const { [normalizedKey]: _removed, ...rest } = presets;
    return rest;
  }
  return { ...presets, [normalizedKey]: normalizedPreset };
}

export function removeWorkObjectLaunchPreset(
  presets: Record<string, WorkObjectLaunchPreset>,
  key: string,
): Record<string, WorkObjectLaunchPreset> {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey || !(normalizedKey in presets)) return presets;
  const { [normalizedKey]: _removed, ...rest } = presets;
  return rest;
}

export function moveWorkObjectLaunchpadKey(keys: string[], key: string, direction: -1 | 1): string[] {
  const index = keys.indexOf(key);
  if (index < 0) return keys;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= keys.length) return keys;
  const next = [...keys];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}
