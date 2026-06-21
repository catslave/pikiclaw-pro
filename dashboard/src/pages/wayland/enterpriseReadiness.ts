import type {
  AgentRuntimeStatus,
  AutomationRule,
  CliCatalogItem,
  McpCatalogItem,
  ProTask,
  SkillCatalogItem,
  SkillInfo,
  SkillQuarantineRecord,
  WorkspaceEntry,
} from '../../types';

export type EnterpriseReadinessTone = 'ok' | 'warn' | 'err' | 'idle' | 'active';
export type EnterpriseReadinessKey = 'workbench' | 'agents' | 'connectors' | 'review' | 'lineage' | 'audit' | 'automation' | 'governance';

export interface EnterpriseReadinessRow {
  key: EnterpriseReadinessKey;
  title: string;
  target: string;
  value: string;
  detail: string;
  ready: number;
  attention: number;
  missing: number;
  tone: EnterpriseReadinessTone;
  chips: string[];
  nextAction: string;
}

export interface EnterpriseReadinessInput {
  mcpItems: McpCatalogItem[];
  skillItems: SkillCatalogItem[];
  installedSkills: SkillInfo[];
  skillQuarantineRecords: SkillQuarantineRecord[];
  cliItems: CliCatalogItem[];
  automations: AutomationRule[];
  workflowRecipeCount: number;
  installedAgents: AgentRuntimeStatus[];
  primaryWorkspace: WorkspaceEntry | null;
  workItems: ProTask[];
}

function uniqueSkillCount(installedSkills: SkillInfo[], skillItems: SkillCatalogItem[]): number {
  const keys = new Set<string>();
  installedSkills.forEach(skill => {
    const key = skill.name.trim().toLowerCase();
    if (key) keys.add(key);
  });
  skillItems.filter(item => item.installed).forEach(item => {
    if (item.installedNames.length) {
      item.installedNames.forEach(name => {
        const key = name.trim().toLowerCase();
        if (key) keys.add(key);
      });
      return;
    }
    const key = item.name.trim().toLowerCase();
    if (key) keys.add(key);
  });
  return keys.size;
}

function workspaceContextCount(workspace: WorkspaceEntry | null): number {
  if (!workspace) return 0;
  return [workspace.rules, workspace.instructions, workspace.memory].filter(value => String(value || '').trim()).length;
}

function rowTone(ready: number, attention: number, missing: number): EnterpriseReadinessTone {
  if (attention > 0) return 'warn';
  if (missing > 0 && ready === 0) return 'warn';
  if (missing > 0) return 'active';
  if (ready > 0) return 'ok';
  return 'idle';
}

function summarizeWorkItemArtifacts(workItems: ProTask[]): {
  workItemCount: number;
  directOutputCount: number;
  stageOutputCount: number;
  reviewCount: number;
  runningCount: number;
  outputCount: number;
  stageRunCount: number;
  sessionLinkedRunCount: number;
  agentLinkedRunCount: number;
  assistantLinkedRunCount: number;
  eventCount: number;
  userDecisionCount: number;
  guardedTaskCount: number;
  unguardedTaskCount: number;
  taskWithoutEventsCount: number;
} {
  return workItems.reduce((summary, task) => {
    const stageRuns = task.stageRuns || [];
    const events = task.events || [];
    const directOutputCount = task.outputs?.length || 0;
    const stageOutputCount = stageRuns.filter(run => !!run.output).length;
    const reviewCount = stageRuns.filter(run => run.status === 'failed' || run.status === 'waiting-user').length;
    const runningCount = stageRuns.filter(run => run.status === 'queued' || run.status === 'running').length;
    const sessionLinkedRunCount = stageRuns.filter(run => !!(run.session?.workdir && run.session?.agent && run.session?.sessionId)).length;
    const agentLinkedRunCount = stageRuns.filter(run => !!(run.selectedAgent || run.session?.agent)).length;
    const assistantLinkedRunCount = stageRuns.filter(run => !!run.assistantId).length;
    const userDecisionCount = events.filter(isUserDecisionEvent).length;
    const hasGuardedChange = events.some(isGuardedChangeEvent);
    summary.directOutputCount += directOutputCount;
    summary.stageOutputCount += stageOutputCount;
    summary.reviewCount += reviewCount;
    summary.runningCount += runningCount;
    summary.outputCount += directOutputCount + stageOutputCount;
    summary.stageRunCount += stageRuns.length;
    summary.sessionLinkedRunCount += sessionLinkedRunCount;
    summary.agentLinkedRunCount += agentLinkedRunCount;
    summary.assistantLinkedRunCount += assistantLinkedRunCount;
    summary.eventCount += events.length;
    summary.userDecisionCount += userDecisionCount;
    if (hasGuardedChange) {
      summary.guardedTaskCount += 1;
      if (!userDecisionCount) summary.unguardedTaskCount += 1;
    }
    if (!events.length) summary.taskWithoutEventsCount += 1;
    return summary;
  }, {
    workItemCount: workItems.length,
    directOutputCount: 0,
    stageOutputCount: 0,
    reviewCount: 0,
    runningCount: 0,
    outputCount: 0,
    stageRunCount: 0,
    sessionLinkedRunCount: 0,
    agentLinkedRunCount: 0,
    assistantLinkedRunCount: 0,
    eventCount: 0,
    userDecisionCount: 0,
    guardedTaskCount: 0,
    unguardedTaskCount: 0,
    taskWithoutEventsCount: 0,
  });
}

function isUserDecisionEvent(event: ProTask['events'][number]): boolean {
  if (event.actor !== 'user') return false;
  return event.type === 'jira-updated'
    || event.type === 'status-changed'
    || event.type === 'stage-output-confirmed'
    || event.type === 'exclusive-mode-changed'
    || event.type === 'task-reset'
    || event.type === 'verification-started'
    || event.type === 'verification-finished'
    || event.type === 'subtask-created'
    || event.type === 'subtask-updated'
    || event.type === 'background-updated'
    || event.type === 'user-focus-started'
    || event.type === 'user-focus-finished';
}

function isGuardedChangeEvent(event: ProTask['events'][number]): boolean {
  return event.type === 'jira-updated'
    || event.type === 'deployment-linked'
    || event.type === 'stage-output-confirmed'
    || event.type === 'exclusive-mode-changed'
    || event.type === 'task-reset';
}

export function summarizeEnterpriseReadiness(input: EnterpriseReadinessInput): EnterpriseReadinessRow[] {
  const contextCount = workspaceContextCount(input.primaryWorkspace);
  const focusAgents = ['codex', 'claude', 'gemini'];
  const installedFocusAgents = focusAgents.filter(agent => input.installedAgents.some(item => item.agent === agent && item.installed));
  const readyMcp = input.mcpItems.filter(item => item.state === 'ready' || item.isBuiltin).length;
  const mcpAttention = input.mcpItems.filter(item => item.state === 'needs_auth' || item.state === 'unhealthy' || item.state === 'disabled').length;
  const readyCli = input.cliItems.filter(item => item.state === 'ready').length;
  const cliAttention = input.cliItems.filter(item => item.state === 'installed_not_auth' || item.state === 'unknown').length;
  const skillCount = uniqueSkillCount(input.installedSkills, input.skillItems);
  const skillReview = input.installedSkills.filter(skill => skill.security?.verdict === 'review').length;
  const skillBlocked = input.skillQuarantineRecords.length + input.installedSkills.filter(skill => skill.security?.verdict === 'blocked').length;
  const enabledAutomations = input.automations.filter(item => item.enabled).length;
  const failedAutomations = input.automations.filter(item => (item.runHistory || [])[0]?.status === 'failed').length;
  const connectorReady = readyMcp + readyCli + skillCount;
  const connectorAttention = mcpAttention + cliAttention + skillReview + skillBlocked;
  const governanceReady = readyMcp + input.installedSkills.filter(skill => skill.security?.verdict === 'clean').length;
  const governanceAttention = mcpAttention + skillReview + skillBlocked;
  const workItemArtifacts = summarizeWorkItemArtifacts(input.workItems);
  const workItemArtifactMissing = workItemArtifacts.outputCount || workItemArtifacts.reviewCount || workItemArtifacts.runningCount ? 0 : 1;
  const lineageMissing = workItemArtifacts.stageRunCount
    ? Math.max(0, workItemArtifacts.stageRunCount - workItemArtifacts.sessionLinkedRunCount)
    : 1;
  const auditMissing = input.workItems.length
    ? workItemArtifacts.taskWithoutEventsCount
    : 1;

  return [
    {
      key: 'workbench',
      title: 'Workbench context',
      target: 'Project-scoped workbench with instructions, memory, and rules.',
      value: input.primaryWorkspace ? `${contextCount}/3` : 'No project',
      detail: input.primaryWorkspace
        ? `${input.primaryWorkspace.name || input.primaryWorkspace.path} contributes ${contextCount} context signals.`
        : 'Choose a Project before launching enterprise-scoped work.',
      ready: contextCount,
      attention: 0,
      missing: input.primaryWorkspace ? Math.max(0, 3 - contextCount) : 1,
      tone: rowTone(contextCount, 0, input.primaryWorkspace ? Math.max(0, 3 - contextCount) : 1),
      chips: ['Rules', 'Instructions', 'Memory'],
      nextAction: input.primaryWorkspace ? 'Fill missing Project context before high-stakes runs.' : 'Select or create a Project.',
    },
    {
      key: 'agents',
      title: 'Agent fleet',
      target: 'Codex, Claude, and Gemini available as comparable runtime choices.',
      value: `${installedFocusAgents.length}/3`,
      detail: installedFocusAgents.length
        ? `${installedFocusAgents.map(item => item[0].toUpperCase() + item.slice(1)).join(', ')} installed.`
        : 'No focus agent detected from the Codex / Claude / Gemini set.',
      ready: installedFocusAgents.length,
      attention: 0,
      missing: Math.max(0, 3 - installedFocusAgents.length),
      tone: rowTone(installedFocusAgents.length, 0, Math.max(0, 3 - installedFocusAgents.length)),
      chips: focusAgents.map(agent => installedFocusAgents.includes(agent) ? `${agent}: ready` : `${agent}: missing`),
      nextAction: installedFocusAgents.length >= 3 ? 'Keep parity surfaced per capability.' : 'Install or authenticate the missing focus agents.',
    },
    {
      key: 'connectors',
      title: 'Connectors & tools',
      target: 'MCP, Skills, and CLI tools form the open tool ecosystem.',
      value: String(connectorReady),
      detail: `${readyMcp} MCP · ${skillCount} Skills · ${readyCli} CLI ready.`,
      ready: connectorReady,
      attention: connectorAttention,
      missing: connectorReady ? 0 : 1,
      tone: rowTone(connectorReady, connectorAttention, connectorReady ? 0 : 1),
      chips: [`${readyMcp} MCP`, `${skillCount} Skills`, `${readyCli} CLI`],
      nextAction: connectorAttention ? 'Clear auth, health, or Skill Guard review items.' : 'Use workspace scope to keep tools relevant per Project.',
    },
    {
      key: 'review',
      title: 'Review & artifacts',
      target: 'Saved outputs, review-needed runs, and handoff artifacts stay attached to durable Work Items.',
      value: workItemArtifacts.reviewCount ? `${workItemArtifacts.reviewCount} review` : `${workItemArtifacts.outputCount} outputs`,
      detail: `${workItemArtifacts.workItemCount} Work Items · ${workItemArtifacts.directOutputCount} saved outputs · ${workItemArtifacts.stageOutputCount} stage results.`,
      ready: workItemArtifacts.outputCount,
      attention: workItemArtifacts.reviewCount,
      missing: workItemArtifactMissing,
      tone: rowTone(workItemArtifacts.outputCount, workItemArtifacts.reviewCount, workItemArtifactMissing),
      chips: [`${workItemArtifacts.directOutputCount} saved`, `${workItemArtifacts.stageOutputCount} stage`, `${workItemArtifacts.runningCount} running`],
      nextAction: workItemArtifacts.reviewCount
        ? 'Open Work Items runs needing review.'
        : workItemArtifacts.outputCount
          ? 'Review deliverables before handoff.'
          : workItemArtifacts.runningCount
            ? 'Wait for running Work Items to produce artifacts.'
            : 'Produce or save agent outputs into Work Items.',
    },
    {
      key: 'lineage',
      title: 'Run lineage',
      target: 'Stage runs keep session, agent, assistant, and workdir links for audit and handoff.',
      value: workItemArtifacts.stageRunCount
        ? `${workItemArtifacts.sessionLinkedRunCount}/${workItemArtifacts.stageRunCount}`
        : 'No runs',
      detail: `${workItemArtifacts.stageRunCount} stage runs · ${workItemArtifacts.agentLinkedRunCount} agent-linked · ${workItemArtifacts.assistantLinkedRunCount} assistant-linked.`,
      ready: workItemArtifacts.sessionLinkedRunCount,
      attention: lineageMissing && workItemArtifacts.stageRunCount ? lineageMissing : 0,
      missing: lineageMissing,
      tone: rowTone(workItemArtifacts.sessionLinkedRunCount, lineageMissing && workItemArtifacts.stageRunCount ? lineageMissing : 0, lineageMissing),
      chips: [`${workItemArtifacts.sessionLinkedRunCount} sessions`, `${workItemArtifacts.agentLinkedRunCount} agents`, `${workItemArtifacts.assistantLinkedRunCount} assistants`],
      nextAction: workItemArtifacts.stageRunCount
        ? lineageMissing
          ? 'Repair stage runs missing session lineage.'
          : 'Use run lineage for review, replay, and handoff.'
        : 'Start Work Item stages to create auditable run history.',
    },
    {
      key: 'audit',
      title: 'Decision audit',
      target: 'User decisions and guarded changes remain visible in durable Work Item timelines.',
      value: workItemArtifacts.userDecisionCount
        ? `${workItemArtifacts.userDecisionCount} decisions`
        : 'No decisions',
      detail: `${workItemArtifacts.eventCount} timeline events · ${workItemArtifacts.guardedTaskCount} guarded Work Items · ${workItemArtifacts.unguardedTaskCount} need review.`,
      ready: workItemArtifacts.userDecisionCount,
      attention: workItemArtifacts.unguardedTaskCount,
      missing: auditMissing,
      tone: rowTone(workItemArtifacts.userDecisionCount, workItemArtifacts.unguardedTaskCount, auditMissing),
      chips: [`${workItemArtifacts.eventCount} events`, `${workItemArtifacts.userDecisionCount} decisions`, `${workItemArtifacts.guardedTaskCount} guarded`],
      nextAction: workItemArtifacts.unguardedTaskCount
        ? 'Review guarded changes that lack user decision events.'
        : workItemArtifacts.userDecisionCount
          ? 'Use timeline decisions for audit and handoff.'
          : 'Record user decisions before remote writes or closeout.',
    },
    {
      key: 'automation',
      title: 'Scheduled automation',
      target: 'Recurring agent work with visible run history and review state.',
      value: `${enabledAutomations}/${input.automations.length}`,
      detail: `${input.workflowRecipeCount} workflow recipes · ${enabledAutomations} enabled schedules.`,
      ready: enabledAutomations + input.workflowRecipeCount,
      attention: failedAutomations,
      missing: enabledAutomations ? 0 : 1,
      tone: rowTone(enabledAutomations + input.workflowRecipeCount, failedAutomations, enabledAutomations ? 0 : 1),
      chips: [`${input.workflowRecipeCount} recipes`, `${enabledAutomations} enabled`, `${failedAutomations} failed`],
      nextAction: enabledAutomations ? 'Review failed or missed runs from Scheduled Tasks.' : 'Promote one repeatable workflow into a scheduled task.',
    },
    {
      key: 'governance',
      title: 'Governance & guardrails',
      target: 'Central health, quarantine, and review posture for capabilities.',
      value: governanceAttention ? `${governanceAttention} attention` : 'Clear',
      detail: `${input.skillQuarantineRecords.length} quarantined Skills · ${skillReview} review Skills · ${mcpAttention} MCP attention.`,
      ready: governanceReady,
      attention: governanceAttention,
      missing: governanceReady ? 0 : 1,
      tone: rowTone(governanceReady, governanceAttention, governanceReady ? 0 : 1),
      chips: [`${input.skillQuarantineRecords.length} quarantined`, `${skillReview} review`, `${mcpAttention} MCP`],
      nextAction: governanceAttention ? 'Resolve quarantine, review, or unhealthy connector items.' : 'Keep Skill Guard and MCP health visible during imports.',
    },
  ];
}
