import type { AgentAssistant } from '../../types';
import { ASSISTANT_DOMAIN_VALUES, resolveAssistantDomain } from './assistantLibrary';

export const ASSISTANT_LAUNCHPAD_STORAGE_KEY = 'pikiclaw:wayland-shell:assistant-launchpad';
export const ASSISTANT_LAUNCHPAD_MAX = 8;
export const ASSISTANT_LAUNCHPAD_DEFAULT_COUNT = 6;

export function launchableAssistants(assistants: AgentAssistant[]): AgentAssistant[] {
  return assistants.filter(item => item.kind !== 'page-owner' && item.enabled !== false);
}

export function defaultAssistantLaunchpadIds(
  assistants: AgentAssistant[],
  max = ASSISTANT_LAUNCHPAD_DEFAULT_COUNT,
): string[] {
  const limit = Math.max(0, Math.min(max, ASSISTANT_LAUNCHPAD_MAX));
  const launchable = launchableAssistants(assistants);
  const selected: AgentAssistant[] = [];
  const selectedIds = new Set<string>();

  for (const domain of ASSISTANT_DOMAIN_VALUES) {
    if (selected.length >= limit) break;
    const candidate = launchable.find(item => !selectedIds.has(item.id) && resolveAssistantDomain(item) === domain);
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  for (const candidate of launchable) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  return selected.slice(0, limit).map(item => item.id);
}

export function normalizeAssistantLaunchpadIds(ids: unknown, assistants: AgentAssistant[]): string[] | null {
  if (!Array.isArray(ids)) return null;
  const allowed = new Set(launchableAssistants(assistants).map(item => item.id));
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    normalized.push(id);
    seen.add(id);
    if (normalized.length >= ASSISTANT_LAUNCHPAD_MAX) break;
  }
  return normalized;
}

export function resolveAssistantLaunchpadEntries(ids: string[], assistants: AgentAssistant[]): AgentAssistant[] {
  const byId = new Map(launchableAssistants(assistants).map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter((item): item is AgentAssistant => !!item);
}

export function assistantLaunchpadCandidates(ids: string[], assistants: AgentAssistant[]): AgentAssistant[] {
  const pinned = new Set(ids);
  return launchableAssistants(assistants).filter(item => !pinned.has(item.id));
}

export function addAssistantLaunchpadId(ids: string[], assistantId: string): string[] {
  const id = assistantId.trim();
  if (!id || ids.includes(id) || ids.length >= ASSISTANT_LAUNCHPAD_MAX) return ids;
  return [...ids, id];
}

export function removeAssistantLaunchpadId(ids: string[], assistantId: string): string[] {
  return ids.filter(id => id !== assistantId);
}

export function moveAssistantLaunchpadId(ids: string[], assistantId: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(assistantId);
  if (index < 0) return ids;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}
