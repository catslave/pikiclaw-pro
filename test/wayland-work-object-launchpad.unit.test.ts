import { describe, expect, it } from 'vitest';
import type { AgentAssistant, AutomationRule, ProTask, WorkflowTemplate } from '../dashboard/src/types.ts';
import {
  addWorkObjectLaunchpadKey,
  defaultWorkObjectLaunchpadKeys,
  moveWorkObjectLaunchpadKey,
  normalizeWorkObjectLaunchPreset,
  normalizeWorkObjectLaunchPresets,
  normalizeWorkObjectLaunchpadKeys,
  parseWorkObjectLaunchpadKey,
  pinWorkObjectLaunchpadKey,
  removeWorkObjectLaunchPreset,
  removeWorkObjectLaunchpadKey,
  setWorkObjectLaunchPreset,
  workObjectLaunchpadCandidates,
  workObjectLaunchpadKey,
  type WorkObjectLaunchpadInput,
} from '../dashboard/src/pages/wayland/workObjectLaunchpad.ts';

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
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:00:00.000Z',
});

const workflow = (input: Partial<WorkflowTemplate> & Pick<WorkflowTemplate, 'id' | 'name'>): WorkflowTemplate & { featured?: boolean; cadence?: string } => ({
  id: input.id,
  name: input.name,
  description: input.description || `${input.name} workflow`,
  category: input.category || 'Build',
  tags: input.tags || [],
  featured: input.featured,
  cadence: 'On demand',
});

const task = (input: Partial<ProTask> & Pick<ProTask, 'id' | 'title'>): ProTask => ({
  id: input.id,
  title: input.title,
  kind: input.kind || 'manual',
  status: input.status || 'backlog',
  workdir: input.workdir,
  createdAt: input.createdAt || '2026-06-14T00:00:00.000Z',
  updatedAt: input.updatedAt || '2026-06-14T01:00:00.000Z',
  stageRuns: input.stageRuns || [],
  verificationRuns: input.verificationRuns || [],
  subTasks: input.subTasks || [],
});

const automation = (input: Partial<AutomationRule> & Pick<AutomationRule, 'id' | 'name' | 'assistantId'>): AutomationRule => ({
  id: input.id,
  name: input.name,
  assistantId: input.assistantId,
  schedule: input.schedule || 'daily@09:00',
  prompt: input.prompt || 'Run this team.',
  enabled: input.enabled ?? true,
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:00:00.000Z',
});

function input(overrides: Partial<WorkObjectLaunchpadInput> = {}): WorkObjectLaunchpadInput {
  const assistants = overrides.assistants || [
    assistant({ id: 'review', name: 'Review Team', labels: ['team'], preferredAgents: ['codex'] }),
    assistant({ id: 'writer', name: 'Writer', labels: ['write'] }),
    assistant({ id: 'disabled', name: 'Disabled', enabled: false }),
  ];
  return {
    assistants,
    automations: overrides.automations || [automation({ id: 'auto-review', name: 'Review Daily', assistantId: 'review' })],
    workflows: overrides.workflows || [workflow({ id: 'release', name: 'Release Review', featured: true })],
    workItems: overrides.workItems || [task({ id: 'task-1', title: 'Follow up', stageRuns: [{ id: 'run-1', stage: 'refinement', status: 'waiting-user', startedAt: '2026-06-14T01:00:00.000Z' }] as ProTask['stageRuns'] })],
    fallbackAgent: overrides.fallbackAgent || 'codex',
  };
}

describe('Wayland work object launchpad model', () => {
  it('builds defaults across native work object types', () => {
    expect(defaultWorkObjectLaunchpadKeys(input())).toEqual([
      'intake:todo',
      'intake:jira-ticket',
      'intake:daily',
      'intake:notes',
      'team:review',
      'assistant:writer',
      'workflow:release',
      'workItem:task-1',
    ]);
  });

  it('normalizes only currently valid mixed object keys', () => {
    const normalized = normalizeWorkObjectLaunchpadKeys([
      'intake:todo',
      'intake:todo',
      'intake:missing',
      'intake:daily',
      'intake:notes',
      'team:review',
      'assistant:disabled',
      'workflow:release',
      'workItem:missing',
    ], input());

    expect(normalized).toEqual(['intake:todo', 'intake:daily', 'intake:notes', 'team:review', 'workflow:release']);
    expect(normalizeWorkObjectLaunchpadKeys(undefined, input())).toBeNull();
  });

  it('returns candidates from the same allowed universe', () => {
    const candidates = workObjectLaunchpadCandidates(['intake:todo', 'team:review'], input());

    expect(candidates).toContain('intake:jira-ticket');
    expect(candidates).toContain('intake:daily');
    expect(candidates).toContain('intake:notes');
    expect(candidates).toContain('assistant:writer');
    expect(candidates).toContain('workflow:release');
    expect(candidates).toContain('workItem:task-1');
    expect(candidates).not.toContain('assistant:disabled');
  });

  it('parses, adds, removes, and moves mixed keys', () => {
    expect(workObjectLaunchpadKey('workflow', 'release')).toBe('workflow:release');
    expect(parseWorkObjectLaunchpadKey('workItem:task:with:colon')).toEqual({ kind: 'workItem', id: 'task:with:colon' });
    expect(parseWorkObjectLaunchpadKey('bad:release')).toBeNull();
    expect(addWorkObjectLaunchpadKey(['intake:todo'], 'workflow:release')).toEqual(['intake:todo', 'workflow:release']);
    expect(removeWorkObjectLaunchpadKey(['intake:todo', 'workflow:release'], 'intake:todo')).toEqual(['workflow:release']);
    expect(moveWorkObjectLaunchpadKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('pins a work object without duplicating or exceeding capacity', () => {
    expect(pinWorkObjectLaunchpadKey(['intake:todo'], 'workflow:release')).toEqual({
      keys: ['intake:todo', 'workflow:release'],
      added: true,
      alreadyPinned: false,
      atCapacity: false,
    });
    expect(pinWorkObjectLaunchpadKey(['workflow:release'], 'workflow:release')).toEqual({
      keys: ['workflow:release'],
      added: false,
      alreadyPinned: true,
      atCapacity: false,
    });
    expect(pinWorkObjectLaunchpadKey(['a', 'b'], 'c', 2)).toEqual({
      keys: ['a', 'b'],
      added: false,
      alreadyPinned: false,
      atCapacity: true,
    });
  });

  it('normalizes per-object launch presets safely', () => {
    expect(normalizeWorkObjectLaunchPreset({
      projectPath: ' /repo/pikiclaw ',
      targetValue: 'assistant:writer',
      effort: 'high',
      permissionMode: 'ask',
      updatedAt: '2026-06-14T00:00:00.000Z',
      ignored: true,
    })).toEqual({
      projectPath: '/repo/pikiclaw',
      targetValue: 'assistant:writer',
      effort: 'high',
      permissionMode: 'ask',
      updatedAt: '2026-06-14T00:00:00.000Z',
    });

    expect(normalizeWorkObjectLaunchPreset({
      targetValue: 'bad:target',
      effort: 'mega',
      permissionMode: 'write-everything',
    })).toBeNull();
  });

  it('sets, removes, and prunes launch presets by valid work object keys', () => {
    const presets = setWorkObjectLaunchPreset({}, 'workflow:release', {
      projectPath: '/repo/pikiclaw',
      targetValue: 'agent:codex',
      effort: 'medium',
      permissionMode: 'autopilot',
    });

    expect(presets).toEqual({
      'workflow:release': {
        projectPath: '/repo/pikiclaw',
        targetValue: 'agent:codex',
        effort: 'medium',
        permissionMode: 'autopilot',
      },
    });

    expect(setWorkObjectLaunchPreset(presets, 'bad:key', { targetValue: 'agent:codex' })).toBe(presets);
    expect(removeWorkObjectLaunchPreset(presets, 'workflow:release')).toEqual({});

    expect(normalizeWorkObjectLaunchPresets({
      'workflow:release': presets['workflow:release'],
      'workItem:missing': { targetValue: 'agent:codex' },
      'bad:key': { targetValue: 'agent:codex' },
    }, ['workflow:release'])).toEqual({
      'workflow:release': presets['workflow:release'],
    });
  });
});
