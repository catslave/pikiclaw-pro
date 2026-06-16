import { describe, expect, it } from 'vitest';
import type {
  AgentRuntimeStatus,
  AppUpdateStatus,
  BrowserStatus,
  ChannelSetupState,
  CliCatalogItem,
  McpCatalogItem,
  PermissionStatus,
  ProUsageBudgetAlert,
  SkillQuarantineRecord,
  WorkspaceEntry,
} from '../dashboard/src/types';
import { summarizeSettingsAttention, type SettingsAttentionInput } from '../dashboard/src/pages/wayland/settingsAttention';

function agent(input: Partial<AgentRuntimeStatus> = {}): AgentRuntimeStatus {
  return {
    agent: 'codex',
    label: 'Codex',
    installed: true,
    selectedModel: null,
    selectedEffort: null,
    isDefault: true,
    models: [],
    usage: null,
    ...input,
  };
}

function update(input: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  return {
    ok: true,
    packageName: 'pikiclaw',
    currentVersion: '1.0.0',
    latestVersion: null,
    updateAvailable: false,
    checkedAt: '2026-06-14T00:00:00.000Z',
    registryUrl: 'https://registry.npmjs.org/pikiclaw/latest',
    packageUrl: 'https://www.npmjs.com/package/pikiclaw',
    installCommand: 'npm install -g pikiclaw@latest',
    detail: 'Current',
    ...input,
  };
}

function browser(input: Partial<BrowserStatus> = {}): BrowserStatus {
  return {
    status: 'ready',
    enabled: true,
    headlessMode: 'headed',
    chromeInstalled: true,
    profileCreated: true,
    running: false,
    pid: null,
    profileDir: '/tmp/profile',
    detail: 'Ready',
    ...input,
  };
}

function channel(input: Partial<ChannelSetupState>): ChannelSetupState {
  return {
    channel: 'slack',
    configured: true,
    ready: true,
    validated: true,
    status: 'ready',
    detail: 'Ready',
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

function mcp(input: Partial<McpCatalogItem> & Pick<McpCatalogItem, 'id' | 'state'>): McpCatalogItem {
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

function budgetAlert(input: Partial<ProUsageBudgetAlert> = {}): ProUsageBudgetAlert {
  return {
    id: 'alert-1',
    budgetId: 'budget-1',
    budgetName: 'Daily Codex',
    scope: 'agent',
    unit: 'tokens',
    limitTokens: 1000,
    limitUsd: 0,
    usedTokens: 1200,
    usedUsd: 0,
    period: 'day',
    periodStart: '2026-06-14T00:00:00.000Z',
    eventId: 'event-1',
    agent: 'codex',
    model: null,
    createdAt: '2026-06-14T01:00:00.000Z',
    ...input,
  };
}

function quarantine(input: Partial<SkillQuarantineRecord> = {}): SkillQuarantineRecord {
  return {
    id: 'q-1',
    name: 'danger-skill',
    scope: 'project',
    createdAt: '2026-06-14T00:00:00.000Z',
    verdict: 'blocked',
    warnings: [{ severity: 'danger', message: 'dangerous command' }],
    reason: 'dangerous command',
    root: '/repo',
    path: '/repo/danger-skill',
    skillPath: '/repo/danger-skill/SKILL.md',
    metaPath: '/repo/danger-skill/.pikiclaw-skill.json',
    ...input,
  };
}

function workspace(input: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path: '/repo/pikiclaw',
    name: 'Pikiclaw',
    rules: '',
    instructions: '',
    memory: '',
    ...input,
  };
}

function baseInput(input: Partial<SettingsAttentionInput> = {}): SettingsAttentionInput {
  return {
    runtimeReady: true,
    restartPhase: null,
    appUpdate: update(),
    appUpdateLoading: false,
    browser: browser(),
    browserLoading: false,
    browserAutomationEnabled: false,
    channels: [],
    permissions: [],
    cliCatalog: [],
    cliLoading: false,
    mcpItems: [],
    capabilityLoading: false,
    skillQuarantineRecords: [],
    budgetAlerts: [],
    budgetAlertsLoading: false,
    notificationPrefs: { master: true, budgetWarn: true },
    browserNotificationPermission: 'granted',
    defaultAgentStatus: agent(),
    installedAgentCount: 1,
    currentWorkspace: workspace(),
    currentWorkdir: '/repo/pikiclaw',
    ...input,
  };
}

describe('settings attention', () => {
  it('sorts critical operational blockers before softer warnings', () => {
    const summary = summarizeSettingsAttention(baseInput({
      appUpdate: update({ latestVersion: '1.1.0', updateAvailable: true }),
      browserAutomationEnabled: true,
      browser: browser({ status: 'chrome_missing', chromeInstalled: false, detail: 'Chrome missing' }),
      skillQuarantineRecords: [quarantine()],
    }));

    expect(summary.critical).toBe(2);
    expect(summary.warning).toBe(1);
    expect(summary.items.map(item => item.id).slice(0, 2)).toEqual(['browser-chrome-missing', 'skill-quarantine']);
    expect(summary.headline).toBe('3 items need attention');
  });

  it('does not warn for optional disabled browser automation or unconfigured channels', () => {
    const summary = summarizeSettingsAttention(baseInput({
      browserAutomationEnabled: false,
      browser: browser({ status: 'disabled', enabled: false }),
      channels: [channel({ configured: false, ready: false, validated: false, status: 'missing', detail: 'Not configured' })],
    }));

    expect(summary.ready).toBe(true);
    expect(summary.items).toEqual([]);
  });

  it('surfaces CLI auth, MCP auth, and denied browser notifications together', () => {
    const summary = summarizeSettingsAttention(baseInput({
      cliCatalog: [cli({ id: 'gh', state: 'installed_not_auth', authDetail: 'Run gh auth login' })],
      mcpItems: [mcp({ id: 'linear', name: 'Linear', state: 'needs_auth' })],
      browserNotificationPermission: 'denied',
    }));

    expect(summary.items.map(item => item.id)).toEqual([
      'browser-notifications-denied',
      'cli-needs-auth',
      'mcp-needs-auth',
    ]);
  });

  it('links budget alerts to notifications and catches missing default project wrapping', () => {
    const summary = summarizeSettingsAttention(baseInput({
      budgetAlerts: [budgetAlert()],
      notificationPrefs: { master: false, budgetWarn: false },
      currentWorkspace: null,
      currentWorkdir: '/repo/untracked',
      defaultAgentStatus: agent({ installed: false, installCommand: 'npm install -g @openai/codex' }),
      installedAgentCount: 1,
    }));

    expect(summary.items.map(item => item.id)).toContain('budget-alerts');
    expect(summary.items.map(item => item.id)).toContain('budget-notifications-muted');
    expect(summary.items.map(item => item.id)).toContain('workspace-not-project');
    expect(summary.items.map(item => item.id)).toContain('default-agent-missing');
    expect(summary.warning).toBe(4);
  });
});
