import type {
  AgentAssistant,
  AgentRuntimeStatus,
  AutomationRule,
  CliCatalogItem,
  McpCatalogItem,
  SkillCatalogItem,
  SkillInfo,
  WorkspaceEntry,
} from '../../types';

export type CapabilityAvailabilityLaneKey = 'global' | 'project' | 'chat' | 'consumers';
export type CapabilityAvailabilityTone = 'ok' | 'warn' | 'err' | 'idle' | 'active';

export interface CapabilityAvailabilityLane {
  key: CapabilityAvailabilityLaneKey;
  title: string;
  value: number;
  detail: string;
  ready: number;
  attention: number;
  missing: number;
  tone: CapabilityAvailabilityTone;
  chips: string[];
  primaryAction: string;
}

export interface CapabilityAvailabilityInput {
  mcpItems: McpCatalogItem[];
  skillItems: SkillCatalogItem[];
  installedSkills: SkillInfo[];
  cliItems: CliCatalogItem[];
  assistants: AgentAssistant[];
  automations: AutomationRule[];
  workflowRecipeCount: number;
  installedAgents: AgentRuntimeStatus[];
  primaryWorkspace: WorkspaceEntry | null;
}

function isReadyMcp(item: McpCatalogItem): boolean {
  return item.state === 'ready' || !!item.isBuiltin;
}

function needsMcpAttention(item: McpCatalogItem): boolean {
  return item.state === 'needs_auth' || item.state === 'unhealthy' || item.state === 'disabled';
}

function addSkillKeys(keys: Set<string>, item: SkillInfo | SkillCatalogItem): void {
  if ('installedNames' in item && item.installedNames.length) {
    item.installedNames.forEach(name => {
      const key = name.trim().toLowerCase();
      if (key) keys.add(key);
    });
    return;
  }
  const key = ('name' in item ? item.name : '').trim().toLowerCase();
  if (key) keys.add(key);
}

function countScopedSkills(installedSkills: SkillInfo[], skillItems: SkillCatalogItem[], scope: 'global' | 'project'): number {
  const keys = new Set<string>();
  installedSkills.filter(skill => skill.scope === scope).forEach(skill => addSkillKeys(keys, skill));
  skillItems.filter(skill => skill.installed && skill.scope === scope).forEach(skill => addSkillKeys(keys, skill));
  return keys.size;
}

function activeProjectContextCount(workspace: WorkspaceEntry | null): number {
  if (!workspace) return 0;
  return [workspace.rules, workspace.instructions, workspace.memory].filter(value => String(value || '').trim()).length;
}

function preferredAgentReady(workspace: WorkspaceEntry | null, installedAgents: AgentRuntimeStatus[]): boolean {
  if (!workspace?.preferredAgent) return true;
  return installedAgents.some(agent => agent.agent === workspace.preferredAgent && agent.installed);
}

function assistantHasReadyAgent(assistant: AgentAssistant, installedAgents: AgentRuntimeStatus[]): boolean {
  const preferred = assistant.preferredAgents || [];
  if (!preferred.length) return installedAgents.length > 0;
  return preferred.some(agent => installedAgents.some(item => item.agent === agent && item.installed));
}

function laneTone(ready: number, attention: number, missing: number, idleWhenEmpty = true): CapabilityAvailabilityTone {
  if (attention > 0) return 'warn';
  if (missing > 0 && ready === 0) return 'err';
  if (missing > 0) return 'warn';
  if (ready > 0) return 'ok';
  return idleWhenEmpty ? 'idle' : 'active';
}

export function summarizeCapabilityAvailability(input: CapabilityAvailabilityInput): CapabilityAvailabilityLane[] {
  const globalReadyMcp = input.mcpItems.filter(item => (item.scope === 'global' || item.scope === 'builtin' || item.isBuiltin) && isReadyMcp(item)).length;
  const globalAttentionMcp = input.mcpItems.filter(item => (item.scope === 'global' || item.scope === 'builtin' || item.isBuiltin) && needsMcpAttention(item)).length;
  const globalSkills = countScopedSkills(input.installedSkills, input.skillItems, 'global');
  const cliReady = input.cliItems.filter(item => item.state === 'ready').length;
  const cliAttention = input.cliItems.filter(item => item.state === 'installed_not_auth' || item.state === 'unknown').length;
  const cliMissing = input.cliItems.filter(item => item.state === 'not_installed').length;

  const projectReadyMcp = input.mcpItems.filter(item => item.scope === 'workspace' && isReadyMcp(item)).length;
  const projectAttentionMcp = input.mcpItems.filter(item => item.scope === 'workspace' && needsMcpAttention(item)).length;
  const projectSkills = countScopedSkills(input.installedSkills, input.skillItems, 'project');
  const projectContext = activeProjectContextCount(input.primaryWorkspace);
  const projectMissing = input.primaryWorkspace
    ? (projectContext ? 0 : 1) + (preferredAgentReady(input.primaryWorkspace, input.installedAgents) ? 0 : 1)
    : 1;

  const chatReady = globalReadyMcp + projectReadyMcp + globalSkills + projectSkills + cliReady + input.installedAgents.length;
  const chatAttention = globalAttentionMcp + projectAttentionMcp + cliAttention + (input.installedAgents.length ? 0 : 1);
  const chatMissing = cliMissing + projectMissing;

  const activeAssistants = input.assistants.filter(item => item.enabled !== false);
  const assistantsMissingAgents = activeAssistants.filter(item => !assistantHasReadyAgent(item, input.installedAgents)).length;
  const activeAutomations = input.automations.filter(item => item.enabled);
  const consumersReady = activeAssistants.length + input.workflowRecipeCount + activeAutomations.length;
  const consumersAttention = assistantsMissingAgents + input.automations.filter(item => item.enabled && item.workdir && input.primaryWorkspace && item.workdir !== input.primaryWorkspace.path).length;

  return [
    {
      key: 'global',
      title: 'Global',
      value: globalReadyMcp + globalSkills + cliReady,
      ready: globalReadyMcp + globalSkills + cliReady,
      attention: globalAttentionMcp + cliAttention,
      missing: cliMissing,
      tone: laneTone(globalReadyMcp + globalSkills + cliReady, globalAttentionMcp + cliAttention, cliMissing),
      detail: 'Available to every Project and terminal.',
      chips: [`${globalReadyMcp} MCP`, `${globalSkills} Skills`, `${cliReady} CLI ready`],
      primaryAction: 'Manage global tools',
    },
    {
      key: 'project',
      title: 'Project',
      value: projectReadyMcp + projectSkills + projectContext,
      ready: projectReadyMcp + projectSkills + projectContext,
      attention: projectAttentionMcp,
      missing: projectMissing,
      tone: laneTone(projectReadyMcp + projectSkills + projectContext, projectAttentionMcp, projectMissing),
      detail: input.primaryWorkspace ? `Scoped to ${input.primaryWorkspace.name || input.primaryWorkspace.path}.` : 'Choose a Project to bind workspace tools.',
      chips: [`${projectReadyMcp} MCP`, `${projectSkills} Skills`, `${projectContext}/3 context`],
      primaryAction: input.primaryWorkspace ? 'Open project scope' : 'Choose project',
    },
    {
      key: 'chat',
      title: 'Current Chat',
      value: chatReady,
      ready: chatReady,
      attention: chatAttention,
      missing: chatMissing,
      tone: laneTone(chatReady, chatAttention, chatMissing),
      detail: 'What a new chat can actually use right now.',
      chips: [`${input.installedAgents.length} agents`, `${globalReadyMcp + projectReadyMcp} MCP`, `${globalSkills + projectSkills} Skills`],
      primaryAction: 'Review launch context',
    },
    {
      key: 'consumers',
      title: 'Consumers',
      value: consumersReady,
      ready: consumersReady,
      attention: consumersAttention,
      missing: assistantsMissingAgents,
      tone: laneTone(consumersReady, consumersAttention, assistantsMissingAgents, false),
      detail: 'Assistants, workflows, and schedules depending on this stack.',
      chips: [`${activeAssistants.length} assistants`, `${input.workflowRecipeCount} workflows`, `${activeAutomations.length} schedules`],
      primaryAction: 'Review consumers',
    },
  ];
}
