import { describe, expect, it } from 'vitest';
import type {
  AgentAssistant,
  AgentRuntimeStatus,
  AutomationRule,
  CliCatalogItem,
  McpCatalogItem,
  SkillCatalogItem,
  SkillInfo,
  WorkspaceEntry,
} from '../dashboard/src/types';
import { summarizeCapabilityAvailability } from '../dashboard/src/pages/wayland/capabilityAvailability';

function mcp(input: Partial<McpCatalogItem> & Pick<McpCatalogItem, 'id' | 'state' | 'scope'>): McpCatalogItem {
  return {
    name: input.id,
    description: '',
    descriptionZh: '',
    category: 'dev',
    transport: { type: 'stdio', summary: 'stdio' },
    auth: { type: 'none' },
    isRecommended: false,
    installed: input.state !== 'recommended',
    ...input,
  };
}

function cli(input: Partial<CliCatalogItem> & Pick<CliCatalogItem, 'id' | 'state'>): CliCatalogItem {
  return {
    binary: input.id,
    name: input.id,
    description: '',
    descriptionZh: '',
    category: 'agent',
    install: { type: 'manual', commands: [] },
    auth: { type: 'none' },
    platform: 'darwin',
    ...input,
  };
}

function agent(agentName: string, installed = true): AgentRuntimeStatus {
  return {
    agent: agentName as AgentRuntimeStatus['agent'],
    label: agentName,
    installed,
    selectedModel: null,
    selectedEffort: null,
    isDefault: false,
    models: [],
    usage: null,
  };
}

function assistant(input: Partial<AgentAssistant> & Pick<AgentAssistant, 'id' | 'preferredAgents'>): AgentAssistant {
  return {
    name: input.id,
    responsibility: '',
    preferredAgents: input.preferredAgents,
    ...input,
  };
}

function automation(input: Partial<AutomationRule> & Pick<AutomationRule, 'id' | 'enabled'>): AutomationRule {
  const now = '2026-06-14T00:00:00.000Z';
  return {
    name: input.id,
    schedule: 'daily@09:00',
    prompt: '',
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function skillCatalog(input: Partial<SkillCatalogItem> & Pick<SkillCatalogItem, 'id' | 'scope' | 'installedNames'>): SkillCatalogItem {
  return {
    name: input.id,
    description: '',
    descriptionZh: '',
    source: 'local',
    category: 'dev',
    installed: true,
    ...input,
  };
}

function workspace(input: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path: '/repo/pikiclaw',
    name: 'Pikiclaw',
    rules: 'Rules',
    instructions: 'Instructions',
    memory: 'Memory',
    ...input,
  };
}

describe('capability availability', () => {
  it('summarizes global, project, and current chat availability', () => {
    const lanes = summarizeCapabilityAvailability({
      mcpItems: [
        mcp({ id: 'global-ready', state: 'ready', scope: 'global' }),
        mcp({ id: 'workspace-ready', state: 'ready', scope: 'workspace' }),
      ],
      skillItems: [],
      installedSkills: [
        { name: 'global-skill', label: null, description: null, scope: 'global' },
        { name: 'project-skill', label: null, description: null, scope: 'project' },
      ] satisfies SkillInfo[],
      cliItems: [cli({ id: 'codex', state: 'ready' })],
      assistants: [assistant({ id: 'builder', preferredAgents: ['codex'] })],
      automations: [automation({ id: 'daily-check', enabled: true })],
      workflowRecipeCount: 2,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace(),
    });

    expect(lanes.find(lane => lane.key === 'global')?.ready).toBe(3);
    expect(lanes.find(lane => lane.key === 'project')?.ready).toBe(5);
    expect(lanes.find(lane => lane.key === 'chat')?.attention).toBe(0);
    expect(lanes.find(lane => lane.key === 'consumers')?.ready).toBe(4);
  });

  it('marks missing project scope when no workspace is selected', () => {
    const lane = summarizeCapabilityAvailability({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      cliItems: [],
      assistants: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [],
      primaryWorkspace: null,
    }).find(item => item.key === 'project');

    expect(lane?.missing).toBe(1);
    expect(lane?.tone).toBe('err');
  });

  it('surfaces consumers needing missing preferred agents', () => {
    const lane = summarizeCapabilityAvailability({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      cliItems: [],
      assistants: [assistant({ id: 'reviewer', preferredAgents: ['claude'] })],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace(),
    }).find(item => item.key === 'consumers');

    expect(lane?.attention).toBe(1);
    expect(lane?.missing).toBe(1);
    expect(lane?.tone).toBe('warn');
  });

  it('deduplicates installed skills that also appear in the catalog', () => {
    const globalLane = summarizeCapabilityAvailability({
      mcpItems: [],
      skillItems: [skillCatalog({ id: 'catalog-dev', scope: 'global', installedNames: ['dev'] })],
      installedSkills: [
        { name: 'dev', label: null, description: null, scope: 'global' },
      ],
      cliItems: [],
      assistants: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [],
      primaryWorkspace: workspace(),
    }).find(item => item.key === 'global');

    expect(globalLane?.ready).toBe(1);
    expect(globalLane?.chips).toContain('1 Skills');
  });
});
