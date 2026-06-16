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
} from '../../types';

export type SettingsAttentionTone = 'ok' | 'warn' | 'err' | 'idle' | 'active' | 'running';

export type SettingsAttentionTarget =
  | 'agents'
  | 'browser'
  | 'budgets'
  | 'channels'
  | 'diagnostics'
  | 'extensions'
  | 'notifications'
  | 'permissions'
  | 'projects'
  | 'runtime'
  | 'update';

export interface SettingsAttentionItem {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: SettingsAttentionTone;
  priority: number;
  actionLabel: string;
  target: SettingsAttentionTarget;
}

export interface SettingsAttentionSummary {
  items: SettingsAttentionItem[];
  total: number;
  critical: number;
  warning: number;
  running: number;
  ready: boolean;
  tone: SettingsAttentionTone;
  headline: string;
  chips: string[];
}

export interface SettingsAttentionNotificationPrefs {
  master?: boolean;
  budgetWarn?: boolean;
}

export interface SettingsAttentionInput {
  runtimeReady: boolean;
  restartPhase?: string | null;
  appUpdate: AppUpdateStatus | null;
  appUpdateLoading?: boolean;
  browser: BrowserStatus | null;
  browserLoading?: boolean;
  browserAutomationEnabled: boolean;
  channels: ChannelSetupState[];
  permissions: Array<[string, PermissionStatus]>;
  cliCatalog: CliCatalogItem[];
  cliLoading?: boolean;
  mcpItems: McpCatalogItem[];
  capabilityLoading?: boolean;
  skillQuarantineRecords: SkillQuarantineRecord[];
  budgetAlerts: ProUsageBudgetAlert[];
  budgetAlertsLoading?: boolean;
  notificationPrefs: SettingsAttentionNotificationPrefs;
  browserNotificationPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  defaultAgentStatus?: AgentRuntimeStatus | null;
  installedAgentCount: number;
  currentWorkspace: WorkspaceEntry | null;
  currentWorkdir: string;
}

function push(items: SettingsAttentionItem[], item: Omit<SettingsAttentionItem, 'priority'> & { priority?: number }): void {
  items.push({ priority: item.tone === 'err' ? 100 : item.tone === 'warn' ? 60 : item.tone === 'running' ? 35 : 20, ...item });
}

function channelLabel(channel: ChannelSetupState): string {
  return channel.channel.charAt(0).toUpperCase() + channel.channel.slice(1);
}

function mcpLabel(item: McpCatalogItem): string {
  return item.name || item.id;
}

function cliLabel(item: CliCatalogItem): string {
  return item.name || item.binary || item.id;
}

function sortAttention(a: SettingsAttentionItem, b: SettingsAttentionItem): number {
  return b.priority - a.priority || a.title.localeCompare(b.title);
}

export function summarizeSettingsAttention(input: SettingsAttentionInput): SettingsAttentionSummary {
  const items: SettingsAttentionItem[] = [];

  if (!input.runtimeReady) {
    push(items, {
      id: 'runtime-starting',
      title: 'Runtime is not ready',
      detail: 'The local daemon is still starting, so chat launch and background work may be delayed.',
      meta: input.restartPhase ? `Restart: ${input.restartPhase}` : 'Runtime health',
      tone: 'warn',
      actionLabel: 'Review runtime',
      target: 'runtime',
      priority: 70,
    });
  } else if (input.restartPhase && input.restartPhase !== 'confirm') {
    push(items, {
      id: 'runtime-restart',
      title: 'Runtime restart in progress',
      detail: 'Wait for the dashboard to reconnect before launching new agent work.',
      meta: input.restartPhase,
      tone: 'running',
      actionLabel: 'View status',
      target: 'runtime',
    });
  }

  if (input.appUpdateLoading) {
    push(items, {
      id: 'update-checking',
      title: 'Checking for updates',
      detail: 'Pikiclaw is checking the npm release channel for the latest available version.',
      meta: 'Update check',
      tone: 'running',
      actionLabel: 'Refresh update',
      target: 'update',
    });
  } else if (input.appUpdate?.ok && input.appUpdate.updateAvailable) {
    push(items, {
      id: 'update-available',
      title: 'Pikiclaw update available',
      detail: `Current v${input.appUpdate.currentVersion}; latest v${input.appUpdate.latestVersion || 'latest'}.`,
      meta: input.appUpdate.installCommand,
      tone: 'warn',
      actionLabel: 'Check update',
      target: 'update',
    });
  } else if (input.appUpdate && !input.appUpdate.ok) {
    push(items, {
      id: 'update-check-failed',
      title: 'Update check failed',
      detail: input.appUpdate.error || input.appUpdate.detail || 'The release check did not complete.',
      meta: input.appUpdate.registryUrl || 'npm registry',
      tone: 'warn',
      actionLabel: 'Retry',
      target: 'update',
    });
  }

  if (input.installedAgentCount === 0) {
    push(items, {
      id: 'agents-missing',
      title: 'No agent CLI is ready',
      detail: 'Install or authenticate at least one agent before using the chat-first workspace.',
      meta: 'Agent layer',
      tone: 'err',
      actionLabel: 'Open Agents',
      target: 'agents',
      priority: 110,
    });
  } else if (input.defaultAgentStatus?.installed === false) {
    push(items, {
      id: 'default-agent-missing',
      title: 'Default agent is missing',
      detail: `${input.defaultAgentStatus.label || input.defaultAgentStatus.agent} is selected as default but is not installed.`,
      meta: input.defaultAgentStatus.installCommand || 'Choose another default',
      tone: 'warn',
      actionLabel: 'Open Agents',
      target: 'agents',
    });
  }

  if (input.browserLoading) {
    push(items, {
      id: 'browser-scanning',
      title: 'Scanning browser automation',
      detail: 'Checking the managed browser profile and Chrome installation state.',
      meta: 'Browser MCP',
      tone: 'running',
      actionLabel: 'Open browser setup',
      target: 'browser',
    });
  } else if (input.browserAutomationEnabled && input.browser?.status === 'chrome_missing') {
    push(items, {
      id: 'browser-chrome-missing',
      title: 'Managed browser cannot start',
      detail: input.browser.detail || 'Chrome is missing, so browser-backed tools cannot run.',
      meta: input.browser.profileDir || 'Managed profile',
      tone: 'err',
      actionLabel: 'Open browser setup',
      target: 'browser',
      priority: 105,
    });
  } else if (input.browserAutomationEnabled && input.browser?.status === 'needs_setup') {
    push(items, {
      id: 'browser-needs-setup',
      title: 'Browser profile needs setup',
      detail: input.browser.detail || 'Open the managed browser once to prepare login and profile storage.',
      meta: input.browser.profileDir || 'Managed profile',
      tone: 'warn',
      actionLabel: 'Open browser setup',
      target: 'browser',
    });
  }

  const configuredChannels = input.channels.filter(channel => channel.configured);
  const brokenChannels = configuredChannels.filter(channel => channel.status === 'invalid' || channel.status === 'error');
  const pendingChannels = configuredChannels.filter(channel => !channel.ready && !channel.validated && channel.status !== 'invalid' && channel.status !== 'error');
  if (brokenChannels.length) {
    push(items, {
      id: 'channels-broken',
      title: 'Channel credentials need repair',
      detail: brokenChannels.map(channel => `${channelLabel(channel)}: ${channel.detail}`).slice(0, 2).join(' · '),
      meta: `${brokenChannels.length} terminal${brokenChannels.length === 1 ? '' : 's'}`,
      tone: 'err',
      actionLabel: 'Open Channels',
      target: 'channels',
      priority: 95,
    });
  } else if (pendingChannels.length) {
    push(items, {
      id: 'channels-pending',
      title: 'Configured channels are not ready',
      detail: pendingChannels.map(channel => `${channelLabel(channel)}: ${channel.detail}`).slice(0, 2).join(' · '),
      meta: `${pendingChannels.length} terminal${pendingChannels.length === 1 ? '' : 's'}`,
      tone: 'warn',
      actionLabel: 'Open Channels',
      target: 'channels',
    });
  }

  const permissionAttention = input.permissions.filter(([, permission]) => permission.checkable && !permission.granted);
  if (permissionAttention.length) {
    push(items, {
      id: 'permissions-missing',
      title: 'Native permissions need attention',
      detail: permissionAttention.map(([name, permission]) => `${name}: ${permission.detail}`).slice(0, 2).join(' · '),
      meta: `${permissionAttention.length} permission${permissionAttention.length === 1 ? '' : 's'}`,
      tone: 'warn',
      actionLabel: 'Open permissions',
      target: 'permissions',
    });
  }

  if (input.cliLoading) {
    push(items, {
      id: 'cli-scanning',
      title: 'Scanning CLI capability auth',
      detail: 'Checking installed tools and sign-in state used by agents.',
      meta: 'CLI catalog',
      tone: 'running',
      actionLabel: 'Open Extensions',
      target: 'extensions',
    });
  } else {
    const cliNeedsAuth = input.cliCatalog.filter(item => item.state === 'installed_not_auth' || item.state === 'unknown');
    if (cliNeedsAuth.length) {
      push(items, {
        id: 'cli-needs-auth',
        title: 'CLI tools need authentication',
        detail: cliNeedsAuth.map(item => `${cliLabel(item)}${item.authDetail ? `: ${item.authDetail}` : ''}`).slice(0, 2).join(' · '),
        meta: `${cliNeedsAuth.length} tool${cliNeedsAuth.length === 1 ? '' : 's'}`,
        tone: 'warn',
        actionLabel: 'Open Extensions',
        target: 'extensions',
      });
    }
  }

  if (input.capabilityLoading) {
    push(items, {
      id: 'capability-scanning',
      title: 'Scanning MCP and Skill Guard',
      detail: 'Checking workspace-scoped MCP health and quarantined Skill imports.',
      meta: 'Capability hub',
      tone: 'running',
      actionLabel: 'Open Extensions',
      target: 'extensions',
    });
  } else {
    const unhealthyMcp = input.mcpItems.filter(item => item.state === 'unhealthy');
    const mcpNeedsAuth = input.mcpItems.filter(item => item.state === 'needs_auth');
    if (unhealthyMcp.length) {
      push(items, {
        id: 'mcp-unhealthy',
        title: 'MCP servers are unhealthy',
        detail: unhealthyMcp.map(mcpLabel).slice(0, 3).join(', '),
        meta: `${unhealthyMcp.length} MCP server${unhealthyMcp.length === 1 ? '' : 's'}`,
        tone: 'err',
        actionLabel: 'Open Extensions',
        target: 'extensions',
        priority: 92,
      });
    }
    if (mcpNeedsAuth.length) {
      push(items, {
        id: 'mcp-needs-auth',
        title: 'MCP servers need auth',
        detail: mcpNeedsAuth.map(mcpLabel).slice(0, 3).join(', '),
        meta: `${mcpNeedsAuth.length} MCP server${mcpNeedsAuth.length === 1 ? '' : 's'}`,
        tone: 'warn',
        actionLabel: 'Open Extensions',
        target: 'extensions',
      });
    }
    if (input.skillQuarantineRecords.length) {
      push(items, {
        id: 'skill-quarantine',
        title: 'Skill Guard quarantined imports',
        detail: input.skillQuarantineRecords.map(record => `${record.name}: ${record.reason}`).slice(0, 2).join(' · '),
        meta: `${input.skillQuarantineRecords.length} blocked Skill${input.skillQuarantineRecords.length === 1 ? '' : 's'}`,
        tone: 'err',
        actionLabel: 'Review Skill Guard',
        target: 'extensions',
        priority: 98,
      });
    }
  }

  if (input.budgetAlertsLoading) {
    push(items, {
      id: 'budgets-scanning',
      title: 'Checking usage budgets',
      detail: 'Looking for recent token or cost budget alerts from Mission Control.',
      meta: 'Usage budgets',
      tone: 'running',
      actionLabel: 'Open budgets',
      target: 'budgets',
    });
  } else if (input.budgetAlerts.length) {
    const first = input.budgetAlerts[0];
    push(items, {
      id: 'budget-alerts',
      title: 'Usage budget alert',
      detail: `${first.budgetName} crossed its ${first.unit === 'usd' ? 'cost' : 'token'} limit.`,
      meta: `${input.budgetAlerts.length} recent alert${input.budgetAlerts.length === 1 ? '' : 's'}`,
      tone: 'warn',
      actionLabel: 'Open budgets',
      target: 'budgets',
      priority: 75,
    });
    if (!input.notificationPrefs.master || !input.notificationPrefs.budgetWarn) {
      push(items, {
        id: 'budget-notifications-muted',
        title: 'Budget alerts are muted',
        detail: 'Recent budget alerts exist, but notification rules will not interrupt you for future crossings.',
        meta: input.notificationPrefs.master ? 'Budget rule off' : 'Notifications muted',
        tone: 'warn',
        actionLabel: 'Review notifications',
        target: 'notifications',
      });
    }
  }

  if (input.notificationPrefs.master && input.browserNotificationPermission === 'denied') {
    push(items, {
      id: 'browser-notifications-denied',
      title: 'Browser notifications are blocked',
      detail: 'Dashboard notification rules are enabled, but the browser has denied system notifications.',
      meta: 'Browser permission',
      tone: 'warn',
      actionLabel: 'Review notifications',
      target: 'notifications',
    });
  }

  if (input.currentWorkdir && !input.currentWorkspace) {
    push(items, {
      id: 'workspace-not-project',
      title: 'Current workspace is not a Project',
      detail: 'Wrap the active folder as a Project to make rules, references, memory, and defaults visible from Chat Home.',
      meta: input.currentWorkdir,
      tone: 'warn',
      actionLabel: 'Open Projects',
      target: 'projects',
    });
  }

  const sorted = items.sort(sortAttention);
  const critical = sorted.filter(item => item.tone === 'err').length;
  const warning = sorted.filter(item => item.tone === 'warn').length;
  const running = sorted.filter(item => item.tone === 'running').length;
  const ready = critical === 0 && warning === 0;
  const tone: SettingsAttentionTone = critical ? 'err' : warning ? 'warn' : running ? 'running' : 'ok';

  return {
    items: sorted,
    total: sorted.length,
    critical,
    warning,
    running,
    ready,
    tone,
    headline: ready ? 'Operational inbox is clear' : `${critical + warning} item${critical + warning === 1 ? '' : 's'} need attention`,
    chips: [
      `${critical} critical`,
      `${warning} warning`,
      `${running} checking`,
    ],
  };
}
