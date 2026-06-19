import type { ProTask, SessionInfo, WorkspaceEntry } from '../../types';
import { workItemNeedsAttention, workItemOutputCount } from './workItemModel';

export type ProjectConversationStepKey = 'project' | 'conversation' | 'work-item';
export type ProjectConversationStepTone = 'ready' | 'active' | 'warn' | 'idle';

export interface ProjectConversationInput {
  workdir: string;
  session: Pick<SessionInfo, 'runState' | 'projectContext' | 'sideChats'>;
}

export interface ProjectConversationStep {
  key: ProjectConversationStepKey;
  label: string;
  value: string;
  detail: string;
  tone: ProjectConversationStepTone;
}

export interface ProjectConversationModel {
  contextCount: number;
  contextAppliedCount: number;
  conversationCount: number;
  runningConversationCount: number;
  incompleteConversationCount: number;
  sideChatCount: number;
  activeWorkItemCount: number;
  attentionWorkItemCount: number;
  deliverableCount: number;
  steps: ProjectConversationStep[];
}

function hasProjectText(value: string | null | undefined): boolean {
  return !!String(value || '').trim();
}

function projectContextCount(workspace: WorkspaceEntry): number {
  return [workspace.rules, workspace.instructions, workspace.memory].filter(hasProjectText).length;
}

function isActiveWorkItem(task: ProTask): boolean {
  return task.status !== 'done' && task.status !== 'resolved';
}

export function buildProjectConversationModel(input: {
  workspace: WorkspaceEntry;
  conversations: ProjectConversationInput[];
  tasks: ProTask[];
}): ProjectConversationModel {
  const scopedConversations = input.conversations.filter(item => item.workdir === input.workspace.path);
  const scopedTasks = input.tasks.filter(task => task.workdir === input.workspace.path);
  const contextCount = projectContextCount(input.workspace);
  const contextAppliedCount = scopedConversations.filter(item => item.session.projectContext).length;
  const runningConversationCount = scopedConversations.filter(item => item.session.runState === 'running').length;
  const incompleteConversationCount = scopedConversations.filter(item => item.session.runState === 'incomplete').length;
  const sideChatCount = scopedConversations.reduce((total, item) => total + (item.session.sideChats?.length || 0), 0);
  const activeWorkItems = scopedTasks.filter(isActiveWorkItem);
  const attentionWorkItemCount = scopedTasks.filter(workItemNeedsAttention).length;
  const deliverableCount = scopedTasks.reduce((total, task) => total + workItemOutputCount(task), 0);

  return {
    contextCount,
    contextAppliedCount,
    conversationCount: scopedConversations.length,
    runningConversationCount,
    incompleteConversationCount,
    sideChatCount,
    activeWorkItemCount: activeWorkItems.length,
    attentionWorkItemCount,
    deliverableCount,
    steps: [
      {
        key: 'project',
        label: 'Project',
        value: `${contextCount}/3`,
        detail: contextCount
          ? `${contextAppliedCount} chats use context`
          : 'context missing',
        tone: contextCount ? 'ready' : 'warn',
      },
      {
        key: 'conversation',
        label: 'Conversation',
        value: String(scopedConversations.length),
        detail: runningConversationCount
          ? `${runningConversationCount} running`
          : incompleteConversationCount
            ? `${incompleteConversationCount} follow-up`
            : `${sideChatCount} side chats`,
        tone: runningConversationCount
          ? 'active'
          : incompleteConversationCount
            ? 'warn'
            : scopedConversations.length
              ? 'ready'
              : 'idle',
      },
      {
        key: 'work-item',
        label: 'Work Item',
        value: String(activeWorkItems.length),
        detail: attentionWorkItemCount
          ? `${attentionWorkItemCount} attention`
          : `${deliverableCount} saved deliverables`,
        tone: attentionWorkItemCount
          ? 'warn'
          : activeWorkItems.length
            ? 'active'
            : deliverableCount
              ? 'ready'
              : 'idle',
      },
    ],
  };
}
