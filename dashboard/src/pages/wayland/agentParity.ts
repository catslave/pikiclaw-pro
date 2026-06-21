import type { AgentCapabilityMatrix, AgentRuntimeStatus } from '../../types';

export type AgentParityFocusAgent = 'codex' | 'claude' | 'gemini';
export type AgentParityCellMode = 'native' | 'portable' | 'unsupported' | 'missing';
export type AgentParityTone = 'ok' | 'warn' | 'err' | 'idle' | 'active';

type AgentCapabilityKey = keyof Pick<
  AgentCapabilityMatrix,
  'plan'
    | 'goal'
    | 'humanInput'
    | 'approval'
    | 'artifacts'
    | 'resume'
    | 'forkCapability'
    | 'steer'
    | 'mcp'
    | 'imageGeneration'
>;

interface AgentParityTarget {
  key: AgentCapabilityKey;
  title: string;
  detail: string;
  enterpriseTarget: string;
  nextAction: string;
}

export interface AgentParityCell {
  agent: AgentParityFocusAgent;
  agentLabel: string;
  mode: AgentParityCellMode;
  modeLabel: string;
  summary: string;
  tone: AgentParityTone;
  note: string | null;
}

export interface AgentParityRow {
  key: AgentCapabilityKey;
  title: string;
  detail: string;
  enterpriseTarget: string;
  cells: Record<AgentParityFocusAgent, AgentParityCell>;
  tone: AgentParityTone;
  coverageLabel: string;
  chips: string[];
  gap: string;
  nextAction: string;
}

const FOCUS_AGENTS: Array<{ id: AgentParityFocusAgent; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
];

const TARGETS: AgentParityTarget[] = [
  {
    key: 'plan',
    title: 'Plan review',
    detail: 'Agent can propose, revise, approve, and implement plans.',
    enterpriseTarget: 'Codex and Claude-style plan review across surfaces.',
    nextAction: 'Keep plan lifecycle visible before long-running work starts.',
  },
  {
    key: 'goal',
    title: 'Goal continuity',
    detail: 'Persistent objective state can survive turns and surfaces.',
    enterpriseTarget: 'A cross-surface work objective with agent-specific controls.',
    nextAction: 'Show native versus portable goal actions in launchers and status bars.',
  },
  {
    key: 'humanInput',
    title: 'Human loop',
    detail: 'Agent can ask structured questions while a run is active.',
    enterpriseTarget: 'Codex-style structured input and Claude/Gemini tool-mediated asks.',
    nextAction: 'Normalize active-run questions into one Pikiclaw interaction surface.',
  },
  {
    key: 'approval',
    title: 'Approval gate',
    detail: 'Tool and command approvals stay explicit and auditable.',
    enterpriseTarget: 'Enterprise permission gates with reviewable decisions.',
    nextAction: 'Keep approval events tied to run history and workspace policy.',
  },
  {
    key: 'artifacts',
    title: 'Artifacts',
    detail: 'Run output can be rendered, recovered, and attached to work.',
    enterpriseTarget: 'Reviewable files, diffs, images, and generated outputs.',
    nextAction: 'Attach artifacts to Work Items instead of leaving them inside chat only.',
  },
  {
    key: 'resume',
    title: 'Resume',
    detail: 'Existing sessions can be recovered without losing context.',
    enterpriseTarget: 'Cross-surface handoff between CLI, dashboard, IM, and native app.',
    nextAction: 'Keep resume controls close to project and work-item history.',
  },
  {
    key: 'forkCapability',
    title: 'Fork / worktree',
    detail: 'A session can branch into isolated follow-up work.',
    enterpriseTarget: 'Parallel worktrees, branch isolation, and merge/reconcile flows.',
    nextAction: 'Promote portable branch handoff into a Pikiclaw worktree queue.',
  },
  {
    key: 'steer',
    title: 'Steer active turn',
    detail: 'A running turn can accept follow-up steering in place.',
    enterpriseTarget: 'Remote-control style correction without restarting the run.',
    nextAction: 'Expose steering only where the driver has a verified live channel.',
  },
  {
    key: 'mcp',
    title: 'MCP / tools',
    detail: 'Session-scoped tools can be injected into the agent runtime.',
    enterpriseTarget: 'Governed tool ecosystem with workspace and global scopes.',
    nextAction: 'Show tool health and trust alongside agent launch context.',
  },
  {
    key: 'imageGeneration',
    title: 'Image generation',
    detail: 'Generated images are surfaced as structured output.',
    enterpriseTarget: 'Multimodal artifact handling, not plain transcript text.',
    nextAction: 'Route generated media into the same artifact pipeline as files.',
  },
];

function modeTone(mode: AgentParityCellMode): AgentParityTone {
  if (mode === 'native') return 'ok';
  if (mode === 'portable') return 'active';
  if (mode === 'missing') return 'warn';
  return 'warn';
}

function modeLabel(mode: AgentParityCellMode): string {
  if (mode === 'native') return 'Native';
  if (mode === 'portable') return 'Portable';
  if (mode === 'missing') return 'Needs install';
  return 'Unsupported';
}

function findAgent(agents: AgentRuntimeStatus[], id: AgentParityFocusAgent): AgentRuntimeStatus | null {
  return agents.find(item => item.agent === id) || null;
}

function summarizeCell(agents: AgentRuntimeStatus[], focus: { id: AgentParityFocusAgent; label: string }, key: AgentCapabilityKey): AgentParityCell {
  const runtime = findAgent(agents, focus.id);
  if (!runtime) {
    return {
      agent: focus.id,
      agentLabel: focus.label,
      mode: 'missing',
      modeLabel: modeLabel('missing'),
      summary: 'Agent is not in the local catalog.',
      tone: 'warn',
      note: null,
    };
  }
  if (!runtime.installed) {
    return {
      agent: focus.id,
      agentLabel: focus.label,
      mode: 'missing',
      modeLabel: modeLabel('missing'),
      summary: 'CLI is not installed or not detected.',
      tone: 'warn',
      note: null,
    };
  }
  const descriptor = runtime.capabilities?.[key];
  const mode: AgentParityCellMode = descriptor?.mode || 'unsupported';
  const note = descriptor?.note || null;
  const summary = note || descriptor?.source || descriptor?.statusSource || 'No verified driver contract.';
  return {
    agent: focus.id,
    agentLabel: focus.label,
    mode,
    modeLabel: modeLabel(mode),
    summary,
    tone: modeTone(mode),
    note,
  };
}

function rowTone(cells: AgentParityCell[]): AgentParityTone {
  if (cells.some(cell => cell.mode === 'unsupported')) return 'warn';
  if (cells.some(cell => cell.mode === 'missing')) return 'warn';
  if (cells.some(cell => cell.mode === 'portable')) return 'active';
  return 'ok';
}

function gapText(target: AgentParityTarget, cells: Record<AgentParityFocusAgent, AgentParityCell>): string {
  if (target.key === 'goal') {
    return 'Codex and Claude own goal state natively; Gemini uses Pikiclaw portable goal state, and Claude does not expose pause/resume.';
  }
  if (target.key === 'forkCapability') {
    return 'Claude can fork natively; Codex app-server and Gemini do not expose verified native fork contracts. Pikiclaw covers the immediate UX with portable branch handoff; the next gap is worktree isolation.';
  }
  const missingOrUnsupported = FOCUS_AGENTS
    .map(agent => cells[agent.id])
    .filter(cell => cell.mode === 'missing' || cell.mode === 'unsupported');
  if (missingOrUnsupported.length) {
    return `${missingOrUnsupported.map(cell => cell.agentLabel).join(', ')} need a verified ${target.title.toLowerCase()} path.`;
  }
  const portable = FOCUS_AGENTS
    .map(agent => cells[agent.id])
    .filter(cell => cell.mode === 'portable');
  if (portable.length) {
    return `${portable.map(cell => cell.agentLabel).join(', ')} use Pikiclaw portable behavior; surface that fallback clearly.`;
  }
  return `All focus agents expose ${target.title.toLowerCase()} natively.`;
}

export function summarizeAgentParity(agents: AgentRuntimeStatus[]): AgentParityRow[] {
  return TARGETS.map(target => {
    const cells = Object.fromEntries(
      FOCUS_AGENTS.map(agent => [agent.id, summarizeCell(agents, agent, target.key)]),
    ) as Record<AgentParityFocusAgent, AgentParityCell>;
    const cellList = FOCUS_AGENTS.map(agent => cells[agent.id]);
    const nativeCount = cellList.filter(cell => cell.mode === 'native').length;
    const portableCount = cellList.filter(cell => cell.mode === 'portable').length;
    const gapCount = cellList.filter(cell => cell.mode === 'unsupported' || cell.mode === 'missing').length;
    return {
      key: target.key,
      title: target.title,
      detail: target.detail,
      enterpriseTarget: target.enterpriseTarget,
      cells,
      tone: rowTone(cellList),
      coverageLabel: `${nativeCount}/${cellList.length} native`,
      chips: [`${nativeCount} native`, `${portableCount} portable`, `${gapCount} gaps`],
      gap: gapText(target, cells),
      nextAction: target.nextAction,
    };
  });
}
