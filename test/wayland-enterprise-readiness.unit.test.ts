import { describe, expect, it } from 'vitest';
import type {
  AgentRuntimeStatus,
  AutomationRule,
  CliCatalogItem,
  McpCatalogItem,
  ProOutput,
  ProTask,
  ProTaskEvent,
  SkillCatalogItem,
  SkillInfo,
  SkillQuarantineRecord,
  StageRun,
  WorkspaceEntry,
} from '../dashboard/src/types';
import { summarizeEnterpriseReadiness } from '../dashboard/src/pages/wayland/enterpriseReadiness';

function agent(agentName: string): AgentRuntimeStatus {
  return {
    agent: agentName as AgentRuntimeStatus['agent'],
    label: agentName,
    installed: true,
    selectedModel: null,
    selectedEffort: null,
    isDefault: false,
    models: [],
    usage: null,
  };
}

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

function automation(input: Partial<AutomationRule> & Pick<AutomationRule, 'id' | 'enabled'>): AutomationRule {
  const now = '2026-06-20T00:00:00.000Z';
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

function quarantine(input: Partial<SkillQuarantineRecord> & Pick<SkillQuarantineRecord, 'id' | 'name'>): SkillQuarantineRecord {
  return {
    scope: 'project',
    createdAt: '2026-06-20T00:00:00.000Z',
    verdict: 'blocked',
    warnings: [{ severity: 'danger', message: 'blocked' }],
    reason: 'blocked',
    root: '/repo/pikiclaw',
    path: '/repo/pikiclaw/.pikiclaw/skills/bad',
    skillPath: '/repo/pikiclaw/.pikiclaw/skills/bad/SKILL.md',
    metaPath: '/repo/pikiclaw/.pikiclaw/skills/bad/.meta.json',
    ...input,
  };
}

function output(input: Partial<ProOutput> & Pick<ProOutput, 'id' | 'kind' | 'title'>): ProOutput {
  return {
    taskId: 'task-artifacts',
    createdAt: '2026-06-20T00:00:00.000Z',
    ...input,
  };
}

function stageRun(input: Partial<StageRun> & Pick<StageRun, 'id' | 'stage' | 'status'>): StageRun {
  return {
    taskId: 'task-artifacts',
    session: {
      workdir: '/repo/pikiclaw',
      agent: 'codex',
      sessionId: `session-${input.id}`,
    },
    prompt: 'Continue',
    ...input,
  };
}

function event(input: Partial<ProTaskEvent> & Pick<ProTaskEvent, 'id' | 'type' | 'actor' | 'summary'>): ProTaskEvent {
  return {
    taskId: 'task-artifacts',
    createdAt: '2026-06-20T00:00:00.000Z',
    ...input,
  };
}

function task(input: Partial<ProTask> = {}): ProTask {
  const now = '2026-06-20T00:00:00.000Z';
  return {
    id: 'task-artifacts',
    title: 'Align agent artifacts',
    kind: 'manual',
    status: 'coding',
    createdAt: now,
    updatedAt: now,
    stageRuns: [],
    outputs: [],
    verificationRuns: [],
    subTasks: [],
    events: [],
    ...input,
  };
}

describe('enterprise readiness', () => {
  it('summarizes a ready enterprise platform posture', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [mcp({ id: 'github', state: 'ready', scope: 'global' })],
      skillItems: [skillCatalog({ id: 'repo-audit', scope: 'project', installedNames: ['repo-audit'] })],
      installedSkills: [
        { name: 'repo-audit', label: null, description: null, scope: 'project', security: { verdict: 'clean', warnings: [] } },
      ] satisfies SkillInfo[],
      skillQuarantineRecords: [],
      cliItems: [cli({ id: 'codex', state: 'ready' })],
      automations: [automation({ id: 'daily-review', enabled: true })],
      workflowRecipeCount: 2,
      installedAgents: [agent('codex'), agent('claude'), agent('gemini')],
      primaryWorkspace: workspace(),
      workItems: [task({
        outputs: [output({ id: 'handoff', kind: 'final', title: 'Handoff summary' })],
        stageRuns: [stageRun({ id: 'ready-run', stage: 'coding', status: 'completed', selectedAgent: 'codex', assistantId: 'assistant-dev' })],
        events: [event({ id: 'status', type: 'status-changed', actor: 'user', summary: 'Status changed from coding to resolved.' })],
      })],
    });

    expect(rows.find(row => row.key === 'workbench')?.value).toBe('3/3');
    expect(rows.find(row => row.key === 'agents')?.value).toBe('3/3');
    expect(rows.find(row => row.key === 'connectors')?.attention).toBe(0);
    expect(rows.find(row => row.key === 'review')?.missing).toBe(0);
    expect(rows.find(row => row.key === 'lineage')?.value).toBe('1/1');
    expect(rows.find(row => row.key === 'audit')?.value).toBe('1 decisions');
    expect(rows.find(row => row.key === 'governance')?.value).toBe('Clear');
  });

  it('surfaces governance attention from MCP health, Skill review, and quarantine', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [mcp({ id: 'jira', state: 'needs_auth', scope: 'workspace' })],
      skillItems: [],
      installedSkills: [
        { name: 'danger-review', label: null, description: null, scope: 'project', security: { verdict: 'review', warnings: [{ severity: 'warning', message: 'review' }] } },
      ] satisfies SkillInfo[],
      skillQuarantineRecords: [quarantine({ id: 'q1', name: 'blocked-skill' })],
      cliItems: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace({ memory: '' }),
      workItems: [],
    });

    const governance = rows.find(row => row.key === 'governance');
    expect(governance?.attention).toBe(3);
    expect(governance?.tone).toBe('warn');
    expect(governance?.chips).toContain('1 quarantined');
  });

  it('keeps missing scheduled automation actionable', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      skillQuarantineRecords: [],
      cliItems: [],
      automations: [automation({ id: 'manual-only', enabled: false })],
      workflowRecipeCount: 1,
      installedAgents: [agent('codex'), agent('claude')],
      primaryWorkspace: null,
      workItems: [],
    });

    const automationRow = rows.find(row => row.key === 'automation');
    expect(automationRow?.missing).toBe(1);
    expect(automationRow?.nextAction).toContain('scheduled task');
  });

  it('surfaces durable Work Item artifacts and review-needed runs', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      skillQuarantineRecords: [],
      cliItems: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace(),
      workItems: [
        task({
          outputs: [output({ id: 'out-1', kind: 'document', title: 'Review note' })],
          stageRuns: [
            stageRun({ id: 'stage-output', stage: 'coding', status: 'completed', output: { summary: 'Implemented changes.' } }),
            stageRun({ id: 'verify', stage: 'verification', status: 'failed' }),
          ],
        }),
      ],
    });

    const review = rows.find(row => row.key === 'review');
    expect(review?.ready).toBe(2);
    expect(review?.attention).toBe(1);
    expect(review?.tone).toBe('warn');
    expect(review?.value).toBe('1 review');
    expect(review?.chips).toContain('1 saved');
    expect(review?.chips).toContain('1 stage');
    expect(review?.nextAction).toContain('review');
  });

  it('tracks stage run lineage for audit and handoff', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      skillQuarantineRecords: [],
      cliItems: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace(),
      workItems: [
        task({
          stageRuns: [
            stageRun({ id: 'linked', stage: 'coding', status: 'completed', selectedAgent: 'codex', assistantId: 'assistant-dev' }),
            stageRun({
              id: 'missing-session',
              stage: 'verification',
              status: 'completed',
              session: { workdir: '', agent: '', sessionId: '' },
            }),
          ],
        }),
      ],
    });

    const lineage = rows.find(row => row.key === 'lineage');
    expect(lineage?.value).toBe('1/2');
    expect(lineage?.attention).toBe(1);
    expect(lineage?.tone).toBe('warn');
    expect(lineage?.chips).toContain('1 sessions');
    expect(lineage?.chips).toContain('1 assistants');
    expect(lineage?.nextAction).toContain('Repair');
  });

  it('tracks decision audit events and guarded changes needing review', () => {
    const rows = summarizeEnterpriseReadiness({
      mcpItems: [],
      skillItems: [],
      installedSkills: [],
      skillQuarantineRecords: [],
      cliItems: [],
      automations: [],
      workflowRecipeCount: 0,
      installedAgents: [agent('codex')],
      primaryWorkspace: workspace(),
      workItems: [
        task({
          id: 'task-decided',
          events: [
            event({ id: 'jira', type: 'jira-updated', actor: 'user', summary: 'Jira native fields updated manually in Pikiclaw.' }),
            event({ id: 'status', type: 'status-changed', actor: 'user', summary: 'Status changed from coding to resolved.' }),
          ],
        }),
        task({
          id: 'task-unguarded',
          events: [
            event({ id: 'deploy', type: 'deployment-linked', actor: 'system', summary: 'Deployment linked.' }),
          ],
        }),
        task({ id: 'task-no-events' }),
      ],
    });

    const audit = rows.find(row => row.key === 'audit');
    expect(audit?.value).toBe('2 decisions');
    expect(audit?.attention).toBe(1);
    expect(audit?.missing).toBe(1);
    expect(audit?.tone).toBe('warn');
    expect(audit?.chips).toContain('3 events');
    expect(audit?.chips).toContain('2 decisions');
    expect(audit?.chips).toContain('2 guarded');
    expect(audit?.nextAction).toContain('guarded changes');
  });
});
