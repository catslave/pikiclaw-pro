import { describe, expect, it } from 'vitest';
import type { AgentAssistant } from '../dashboard/src/types.ts';
import {
  ASSISTANT_LAUNCHPAD_MAX,
  addAssistantLaunchpadId,
  assistantLaunchpadCandidates,
  defaultAssistantLaunchpadIds,
  moveAssistantLaunchpadId,
  normalizeAssistantLaunchpadIds,
  removeAssistantLaunchpadId,
  resolveAssistantLaunchpadEntries,
} from '../dashboard/src/pages/wayland/assistantLaunchpad.ts';

const assistant = (input: Partial<AgentAssistant> & Pick<AgentAssistant, 'id' | 'name'>): AgentAssistant => ({
  id: input.id,
  name: input.name,
  responsibility: input.responsibility || `${input.name} responsibility`,
  preferredAgents: input.preferredAgents || [],
  labels: input.labels || [],
  objectTypes: input.objectTypes || [],
  builtIn: input.builtIn ?? true,
  enabled: input.enabled ?? true,
  kind: input.kind,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
});

describe('Wayland assistant launchpad model', () => {
  it('builds default shortcuts across assistant domains', () => {
    const ids = defaultAssistantLaunchpadIds([
      assistant({ id: 'writer', name: 'Writer', labels: ['write'] }),
      assistant({ id: 'researcher', name: 'Researcher', labels: ['research'] }),
      assistant({ id: 'builder', name: 'Builder', labels: ['build'] }),
      assistant({ id: 'runner', name: 'Runner', labels: ['run'] }),
    ], 3);

    expect(ids).toEqual(['writer', 'researcher', 'builder']);
  });

  it('normalizes persisted IDs without resurrecting invalid or disabled assistants', () => {
    const assistants = [
      assistant({ id: 'a', name: 'A' }),
      assistant({ id: 'b', name: 'B', enabled: false }),
      assistant({ id: 'owner', name: 'Owner', kind: 'page-owner' }),
      assistant({ id: 'c', name: 'C' }),
    ];

    expect(normalizeAssistantLaunchpadIds(['a', 'a', 'b', 'missing', 'owner', 'c'], assistants)).toEqual(['a', 'c']);
    expect(normalizeAssistantLaunchpadIds(undefined, assistants)).toBeNull();
  });

  it('resolves entries and candidates from the same launchable universe', () => {
    const assistants = [
      assistant({ id: 'a', name: 'A' }),
      assistant({ id: 'b', name: 'B' }),
      assistant({ id: 'c', name: 'C', enabled: false }),
    ];

    expect(resolveAssistantLaunchpadEntries(['b', 'missing', 'a'], assistants).map(item => item.id)).toEqual(['b', 'a']);
    expect(assistantLaunchpadCandidates(['b'], assistants).map(item => item.id)).toEqual(['a']);
  });

  it('supports add, remove, and move with cap protection', () => {
    const full = Array.from({ length: ASSISTANT_LAUNCHPAD_MAX }, (_, index) => `a${index}`);

    expect(addAssistantLaunchpadId(['a'], 'b')).toEqual(['a', 'b']);
    expect(addAssistantLaunchpadId(['a'], 'a')).toEqual(['a']);
    expect(addAssistantLaunchpadId(full, 'extra')).toEqual(full);
    expect(removeAssistantLaunchpadId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(moveAssistantLaunchpadId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveAssistantLaunchpadId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveAssistantLaunchpadId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});
