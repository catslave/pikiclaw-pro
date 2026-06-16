import type { DailyItem, JiraRemoteUpdateRun, NotePage, ProTask, TodoItem } from '../../types';
import {
  buildWorkItemActionQueueItems,
  type WorkItemActionQueueItem,
} from './workItemActionQueue';

export const CHAT_HOME_DAILY_ASSISTANT_ID = 'assistant_daily';

export interface ChatHomeDailyLaunchDefaults {
  assistantId?: string | null;
  agent?: string | null;
  model?: string | null;
}

export interface ChatHomeDailyLaunchTargetInput {
  defaults?: ChatHomeDailyLaunchDefaults | null;
  assistantIds: string[];
  agentIds: string[];
  fallbackAssistantId?: string | null;
  fallbackAgent?: string | null;
}

export function chatHomeDailyLaunchTargetValue(input: ChatHomeDailyLaunchTargetInput): string | null {
  const assistantIds = new Set(input.assistantIds.map(item => item.trim()).filter(Boolean));
  const agentIds = new Set(input.agentIds.map(item => item.trim()).filter(Boolean));
  const preferredAssistantId = String(input.defaults?.assistantId || '').trim();
  const fallbackAssistantId = String(input.fallbackAssistantId || '').trim();
  const preferredAgent = String(input.defaults?.agent || '').trim();
  const fallbackAgent = String(input.fallbackAgent || '').trim();
  const model = String(input.defaults?.model || '').trim();

  if (preferredAssistantId && assistantIds.has(preferredAssistantId)) return `assistant:${preferredAssistantId}`;
  if (fallbackAssistantId && assistantIds.has(fallbackAssistantId)) return `assistant:${fallbackAssistantId}`;
  if (model) {
    const modelAgent = preferredAgent && agentIds.has(preferredAgent)
      ? preferredAgent
      : fallbackAgent && agentIds.has(fallbackAgent)
        ? fallbackAgent
        : '';
    if (modelAgent) return `model:${modelAgent}:${encodeURIComponent(model)}`;
  }
  if (preferredAgent && agentIds.has(preferredAgent)) return `agent:${preferredAgent}`;
  if (fallbackAgent && agentIds.has(fallbackAgent)) return `agent:${fallbackAgent}`;
  return null;
}

export function chatHomeWorkSurfaceLaunchTargetValue(input: ChatHomeDailyLaunchTargetInput): string | null {
  const assistantIds = new Set(input.assistantIds.map(item => item.trim()).filter(Boolean));
  const agentIds = new Set(input.agentIds.map(item => item.trim()).filter(Boolean));
  const preferredAssistantId = String(input.defaults?.assistantId || '').trim();
  const fallbackAssistantId = String(input.fallbackAssistantId || '').trim();
  const preferredAgent = String(input.defaults?.agent || '').trim();
  const fallbackAgent = String(input.fallbackAgent || '').trim();
  const model = String(input.defaults?.model || '').trim();

  if (preferredAssistantId && assistantIds.has(preferredAssistantId)) return `assistant:${preferredAssistantId}`;
  if (model) {
    const modelAgent = preferredAgent && agentIds.has(preferredAgent)
      ? preferredAgent
      : fallbackAgent && agentIds.has(fallbackAgent)
        ? fallbackAgent
        : '';
    if (modelAgent) return `model:${modelAgent}:${encodeURIComponent(model)}`;
  }
  if (preferredAgent && agentIds.has(preferredAgent)) return `agent:${preferredAgent}`;
  if (fallbackAssistantId && assistantIds.has(fallbackAssistantId)) return `assistant:${fallbackAssistantId}`;
  if (fallbackAgent && agentIds.has(fallbackAgent)) return `agent:${fallbackAgent}`;
  return null;
}

export interface BuildChatHomeNextActionsInput {
  workItems: ProTask[];
  todoItems: TodoItem[];
  inboxItems: TodoItem[];
  dailyItems: DailyItem[];
  notePages: NotePage[];
  jiraRemoteRuns: JiraRemoteUpdateRun[];
  selectedWorkspacePath?: string;
  todayDate: string;
  limit?: number;
}

function groupJiraRunsByTask(runs: JiraRemoteUpdateRun[]): Record<string, JiraRemoteUpdateRun[]> {
  return runs.reduce<Record<string, JiraRemoteUpdateRun[]>>((acc, run) => {
    acc[run.taskId] = [...(acc[run.taskId] || []), run];
    return acc;
  }, {});
}

function resolveChatHomeInboxItems(input: Pick<BuildChatHomeNextActionsInput, 'inboxItems' | 'todoItems'>): TodoItem[] {
  if (input.inboxItems.length) return input.inboxItems;
  return input.todoItems.filter(item => item.status === 'open');
}

function replaceLastNonCritical(
  selected: WorkItemActionQueueItem[],
  candidate: WorkItemActionQueueItem,
): WorkItemActionQueueItem[] {
  const replacementIndex = [...selected]
    .reverse()
    .findIndex(item => item.priority < 40 && item.kind !== 'jira' && item.kind !== 'source');
  if (replacementIndex < 0) return selected;
  const targetIndex = selected.length - 1 - replacementIndex;
  return selected.map((item, index) => (index === targetIndex ? candidate : item));
}

export function balanceChatHomeNextActionItems(
  items: WorkItemActionQueueItem[],
  limit: number,
): WorkItemActionQueueItem[] {
  const safeLimit = Math.max(1, limit);
  const selected = items.slice(0, safeLimit);
  if (selected.length < safeLimit || selected.some(item => item.kind === 'inbox')) return selected;

  const inboxCandidate = items.find(item => item.kind === 'inbox');
  if (!inboxCandidate) return selected;
  return replaceLastNonCritical(selected, inboxCandidate);
}

export function buildChatHomeNextActionItems(input: BuildChatHomeNextActionsInput): WorkItemActionQueueItem[] {
  const limit = Math.max(1, input.limit || 4);
  const selectedWorkspacePath = input.selectedWorkspacePath || '';
  const projectWorkItems = selectedWorkspacePath
    ? input.workItems.filter(task => task.workdir === selectedWorkspacePath)
    : input.workItems;
  const scopedWorkItems = projectWorkItems.length ? projectWorkItems : input.workItems;
  const inboxItems = resolveChatHomeInboxItems(input);

  const items = buildWorkItemActionQueueItems({
    tasks: scopedWorkItems,
    todos: inboxItems,
    dailyItems: input.dailyItems,
    notePages: input.notePages,
    jiraRunsByTask: groupJiraRunsByTask(input.jiraRemoteRuns),
    todayDate: input.todayDate,
    limit: Math.max(limit * 3, 12),
  });
  return balanceChatHomeNextActionItems(items, limit);
}

export function chatHomeNextActionTaskId(item: Pick<WorkItemActionQueueItem, 'to'>): string | null {
  const queryStart = item.to.indexOf('?');
  if (queryStart < 0) return null;
  const params = new URLSearchParams(item.to.slice(queryStart + 1));
  return params.get('task');
}

export function chatHomeNextActionPromoteTarget(
  item: Pick<WorkItemActionQueueItem, 'kind' | 'to'>,
): { label: string; to: string } | null {
  if (item.kind !== 'inbox' && item.kind !== 'daily' && item.kind !== 'note') return null;
  const [pathname, rawSearch = ''] = item.to.split('?');
  const params = new URLSearchParams(rawSearch);
  params.set('intent', 'promote');
  return {
    label: item.kind === 'daily' ? 'Plan' : 'Promote',
    to: `${pathname}?${params.toString()}`,
  };
}

export function chatHomeNextActionPlanTodayTarget(
  item: Pick<WorkItemActionQueueItem, 'kind' | 'to'>,
): { label: string; to: string } | null {
  if (item.kind !== 'inbox') return null;
  const [pathname, rawSearch = ''] = item.to.split('?');
  const params = new URLSearchParams(rawSearch);
  params.set('intent', 'plan');
  return {
    label: 'Today',
    to: `${pathname}?${params.toString()}`,
  };
}

export function chatHomeNextActionOwnerHint(
  item: Pick<WorkItemActionQueueItem, 'kind'>,
): { label: string; value: string } | null {
  if (item.kind !== 'inbox') return null;
  return { label: 'Owner', value: 'Daily Assistant' };
}

export type ChatHomeNextActionRouteKind = 'promote' | 'plan-today';

export interface ChatHomeNextActionRoute {
  kind: ChatHomeNextActionRouteKind;
  label: string;
  to: string;
  primary: boolean;
}

export function chatHomeNextActionRoutes(
  item: Pick<WorkItemActionQueueItem, 'kind' | 'to'>,
): ChatHomeNextActionRoute[] {
  const promoteTarget = chatHomeNextActionPromoteTarget(item);
  const planTodayTarget = chatHomeNextActionPlanTodayTarget(item);
  const routes: ChatHomeNextActionRoute[] = [];

  if (planTodayTarget) {
    routes.push({
      kind: 'plan-today',
      label: planTodayTarget.label,
      to: planTodayTarget.to,
      primary: true,
    });
  }
  if (promoteTarget) {
    routes.push({
      kind: 'promote',
      label: promoteTarget.label,
      to: promoteTarget.to,
      primary: !planTodayTarget,
    });
  }
  return routes;
}

export function chatHomeNextActionLoadLabel(item: Pick<WorkItemActionQueueItem, 'kind'>): string {
  return item.kind === 'inbox' ? 'Load today' : 'Load';
}

export function chatHomeNextActionPrompt(item: Pick<WorkItemActionQueueItem, 'actionLabel' | 'sourceLabel' | 'title' | 'detail' | 'to' | 'keys' | 'lanes'>): string {
  const signals = item.keys.length ? item.keys.join(', ') : '';
  const lanes = (item.lanes || [])
    .map(lane => `${lane.label}: ${lane.value}`)
    .join('; ');
  return [
    'Continue this Pikiclaw work item from Chat Home.',
    '',
    `Action: ${item.actionLabel}`,
    `Source: ${item.sourceLabel}`,
    `Title: ${item.title}`,
    `Context: ${item.detail}`,
    signals ? `Signals: ${signals}` : '',
    lanes ? `Lanes: ${lanes}` : '',
    `Route: ${item.to}`,
    '',
    'Please help me complete the next concrete step.',
  ].filter(line => line !== '').join('\n');
}

export function chatHomeNextActionTodayPrompt(item: Pick<WorkItemActionQueueItem, 'sourceLabel' | 'title' | 'detail' | 'to' | 'keys' | 'lanes'>): string {
  const signals = item.keys.length ? item.keys.join(', ') : '';
  const lanes = (item.lanes || [])
    .map(lane => `${lane.label}: ${lane.value}`)
    .join('; ');
  return [
    'Plan this Inbox item for today with Daily Assistant.',
    '',
    `Title: ${item.title}`,
    `Source: ${item.sourceLabel}`,
    `Context: ${item.detail}`,
    signals ? `Signals: ${signals}` : '',
    lanes ? `Lanes: ${lanes}` : '',
    `Route: ${item.to}`,
    '',
    'Turn it into a focused daily work session. Clarify the concrete goal, identify missing context, propose a short Goal & Plan, and wait for confirmation before changing files unless the request is already explicit.',
  ].filter(line => line !== '').join('\n');
}
