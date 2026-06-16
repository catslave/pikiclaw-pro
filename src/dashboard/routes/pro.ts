/**
 * Dashboard API routes for Pikiclaw Pro workflow objects.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { loadUserConfig, loadWorkspaces } from '../../core/config/user-config.js';
import { resolveAgentModel } from '../../core/config/runtime-config.js';
import { normalizeSessionContextSources } from '../../agent/context-sources.js';
import { findPikiclawSessionInfo } from '../../agent/session.js';
import type { Agent } from '../../agent/index.js';
import { querySessionMessages } from '../../bot/session-hub.js';
import { runtime } from '../runtime.js';
import { createDashboardSideChat, queueDashboardSessionTask } from '../session-control.js';
import { enrichWorkbenchSideChats } from '../workbench-side-chats.js';
import {
  clickBrowserPanelSession,
  closeBrowserPanelSession,
  createBrowserPanelSession,
  navigateBrowserPanelSession,
  reloadBrowserPanelSession,
  snapshotBrowserPanelSession,
  typeBrowserPanelSession,
} from '../browser-panel.js';
import {
  addStageRun,
  appendProTaskSourceEvidence,
  archiveTaskSpace,
  assignProTasksToCycle,
  createSubtask,
  createProTask,
  createTaskSpace,
  confirmStageRunOutput,
  deleteProTask,
  finishVerificationRun,
  finishUserFocusSession,
  getProTask,
  getProTaskWorkbench,
  isProTaskStage,
  isProTaskStatus,
  isProSubtaskStatus,
  listProTasks,
  listTaskSpaces,
  resetProTask,
  setExclusiveMode,
  startVerificationRun,
  startUserFocusSession,
  syncJiraTask,
  updateStageRun,
  updateSubtask,
  updateJiraFields,
  updateProTaskExecution,
  updateProTaskCycle,
  updateProTaskMeta,
  updateTaskBackground,
  updateProTaskStatus,
  updateTaskSpace,
  upsertAnalyzeTicketTask,
  type VerificationResult,
} from '../../pro/tasks.js';
import {
  addTaskToDaily,
  addTodoToDaily,
  createDailyItems,
  deleteDailyItem,
  listDailyItems,
  promoteDailyItemsToTasks,
  revertDailyItemTask,
  revertDailyItemTaskForTask,
  reorderDailyItems,
  updateDailyItem,
} from '../../pro/daily-items.js';
import { createTodoItem, deleteTodoItem, getTodoItems, linkTodoChat, listTodoItems, updateTodoItem, type TodoImageAttachment, type TodoItem } from '../../pro/todos.js';
import {
  createNotePage,
  deleteNotePage,
  getNotePage,
  getOrCreateDailyNote,
  listNoteTree,
  promoteNoteSelection,
  readNoteDocument,
  reorderNotePages,
  resolveNoteAsset,
  saveNoteAsset,
  searchNotes,
  updateNotePage,
  writeNoteDocument,
} from '../../pro/notes.js';
import { closeActiveJiraCycle, deleteJiraCycle, kickOffJiraCycle, listJiraCycles } from '../../pro/jira-cycles.js';
import {
  buildAnalyzeTicketPrompt,
  issueKindFromType,
  parseJiraTicketQuery,
  resolveWorkdirForJiraAnalyze,
} from '../../pro/jira-analyze.js';
import { applyJiraRemoteUpdate, fetchJiraIssueFromMcp, resolveJiraIssueKeyInput } from '../../pro/jira-remote.js';
import { buildAutomationRunPrompt, collectAutomationContextSources } from '../../pro/automation-context.js';
import { importProjectReferencesAsKnowledge } from '../../pro/knowledge-import.js';
import { refreshKnowledgeEntrySources } from '../../pro/knowledge-source-freshness.js';
import { evaluateCurrentUsageBudgetGate } from '../../pro/usage-budget-gate.js';
import { buildProUsageSummary, clearProUsageSummaryCache } from '../../pro/usage-summary.js';
import { deleteUsageBudget, listUsageBudgetAlerts, upsertUsageBudget } from '../../pro/usage-budget.js';
import {
  cancelJiraRemoteUpdateRun,
  createAgentAssistant,
  createAutomationRule,
  createCustomWorkflowRecipe,
  createJiraSyncRun,
  createJiraRemoteUpdateRun,
  createKnowledgeEntry,
  deleteAutomationRule,
  deleteCustomWorkflowRecipe,
  deleteKnowledgeEntry,
  deleteAgentAssistant,
  getJiraRemoteUpdateRun,
  applyJiraSyncRunItems,
  getAssistantPrompt,
  getAnalyzeTicketPrompt,
  getJiraWorkflowConfig,
  getJiraSyncRun,
  resetAnalyzeTicketPrompt,
  listAgentAssistants,
  listAutomationRules,
  listCustomWorkflowRecipes,
  listWorkflowRuns,
  getWorkflowRun,
  listJiraSyncRuns,
  listJiraRemoteUpdateRuns,
  listKnowledgeEntries,
  ingestWorkflowRunMarkersFromMessages,
  reconcileWorkflowRunMarkersFromMessages,
  markAutomationMissedRun,
  markAutomationRun,
  markStalledWorkflowRunAutonomousWorkers,
  answerWorkflowRunAsk,
  completeWorkflowRunStepAutonomous,
  recordWorkflowRunStepAutonomousDispatch,
  recordWorkflowRunAsk,
  recordWorkflowRun,
  stopJiraSyncRun,
  updateAgentAssistant,
  resetAgentAssistantPrompt,
  updateAgentAssistantPrompt,
  updateAutomationRule,
  updateCustomWorkflowRecipe,
  updateJiraSyncRun,
  updateJiraRemoteUpdateRun,
  updateAnalyzeTicketPrompt,
  updateJiraWorkflowConfig,
  updateKnowledgeEntry,
  updateWorkflowRunAskDelivery,
  deleteWorkflowRun,
  upsertAutomationRuleByKey,
  type AgentAssistant,
  type AutomationRule,
  type WorkflowRunRecord,
  type WorkflowRunStep,
} from '../../pro/workflow.js';

const app = new Hono();
const JIRA_MCP_SYNC_AUTOMATION_KEY = 'jira-mcp-sync';
const REVIEW_LINK_META_CACHE_TTL_MS = 10 * 60 * 1000;
const reviewLinkMetaCache = new Map<string, { value: ReviewLinkMeta; cachedAt: number }>();

type ReviewLinkMeta = {
  provider: 'gitlab' | 'github' | 'unknown';
  url: string;
  repo?: string;
  number?: string;
  title?: string;
  displayTitle?: string;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readProjectContextRef(value: unknown): { source: string; hash: string; title?: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const source = readString(input.source);
  const hash = readString(input.hash);
  if (!source || !hash) return null;
  return {
    source,
    hash,
    title: readString(input.title) || null,
  };
}

function firstEnvString(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function parseReviewLink(value: string): ReviewLinkMeta | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const mergeIndex = segments.findIndex(item => item === 'merge_requests');
  if (mergeIndex > 0 && segments[mergeIndex + 1]) {
    const repoIndex = segments[mergeIndex - 1] === '-' ? mergeIndex - 2 : mergeIndex - 1;
    const repo = segments[repoIndex] || url.hostname.replace(/^www\./, '');
    return {
      provider: 'gitlab',
      url: url.toString(),
      repo,
      number: segments[mergeIndex + 1],
      displayTitle: `${repo} !${segments[mergeIndex + 1]}`,
    };
  }
  const pullIndex = segments.findIndex(item => item === 'pull');
  if (pullIndex > 0 && segments[pullIndex + 1]) {
    const repo = segments[pullIndex - 1] || url.hostname.replace(/^www\./, '');
    return {
      provider: 'github',
      url: url.toString(),
      repo,
      number: segments[pullIndex + 1],
      displayTitle: `${repo} #${segments[pullIndex + 1]}`,
    };
  }
  return {
    provider: 'unknown',
    url: url.toString(),
    repo: url.hostname.replace(/^www\./, ''),
    displayTitle: url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, ''),
  };
}

function gitlabApiUrl(meta: ReviewLinkMeta): string | null {
  if (meta.provider !== 'gitlab' || !meta.number) return null;
  const url = new URL(meta.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const mergeIndex = segments.findIndex(item => item === 'merge_requests');
  if (mergeIndex <= 0) return null;
  const projectSegments = segments.slice(0, segments[mergeIndex - 1] === '-' ? mergeIndex - 1 : mergeIndex);
  if (!projectSegments.length) return null;
  return `${url.origin}/api/v4/projects/${encodeURIComponent(projectSegments.join('/'))}/merge_requests/${encodeURIComponent(meta.number)}`;
}

function githubApiUrl(meta: ReviewLinkMeta): string | null {
  if (meta.provider !== 'github' || !meta.number) return null;
  const url = new URL(meta.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const pullIndex = segments.findIndex(item => item === 'pull');
  if (pullIndex < 2) return null;
  return `https://api.github.com/repos/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}/pulls/${encodeURIComponent(meta.number)}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code) || 0));
}

function titleFromPageTitle(rawTitle: string, meta: ReviewLinkMeta): string {
  let title = decodeHtmlEntities(rawTitle).replace(/\s+/g, ' ').trim();
  if (!title) return '';
  if (/^(sign in|sign-in|login|log in)(\s+·\s+|\s+-\s+|$)/i.test(title)) return '';
  if (meta.provider === 'github') {
    title = title
      .replace(/\s+by\s+.+?\s+·\s+Pull Request\s+#\d+\s+·\s+.+$/i, '')
      .replace(/\s+·\s+Pull Request\s+#\d+\s+·\s+.+$/i, '')
      .trim();
  } else if (meta.provider === 'gitlab') {
    title = title
      .replace(/\s+\(!?\d+\)\s+·\s+Merge requests\s+·\s+.+$/i, '')
      .replace(/\s+·\s+Merge requests\s+·\s+.+$/i, '')
      .trim();
  }
  return title.length > 180 ? `${title.slice(0, 177).trimEnd()}...` : title;
}

async function fetchReviewPageTitle(meta: ReviewLinkMeta): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(meta.url, {
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return '';
    const html = await response.text();
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match?.[1] ? titleFromPageTitle(match[1], meta) : '';
  } catch {
    return '';
  }
}

async function fetchReviewLinkMeta(rawUrl: string): Promise<ReviewLinkMeta | null> {
  const parsed = parseReviewLink(rawUrl);
  if (!parsed) return null;
  const cached = reviewLinkMetaCache.get(parsed.url);
  if (cached && Date.now() - cached.cachedAt < REVIEW_LINK_META_CACHE_TTL_MS) return cached.value;

  const apiUrl = parsed.provider === 'gitlab' ? gitlabApiUrl(parsed) : githubApiUrl(parsed);
  if (!apiUrl) {
    reviewLinkMetaCache.set(parsed.url, { value: parsed, cachedAt: Date.now() });
    return parsed;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (parsed.provider === 'gitlab') {
    const token = firstEnvString('GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN', 'GITLAB_ACCESS_TOKEN');
    if (token) headers['PRIVATE-TOKEN'] = token;
  } else if (parsed.provider === 'github') {
    const token = firstEnvString('GITHUB_TOKEN', 'GH_TOKEN');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(apiUrl, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      const body: any = await response.json();
      const title = readString(body?.title);
      const value = title
        ? { ...parsed, title, displayTitle: `${parsed.displayTitle} · ${title}` }
        : parsed;
      reviewLinkMetaCache.set(parsed.url, { value, cachedAt: Date.now() });
      return value;
    }
  } catch {
    // Fall back to the readable repo + review number title below.
  }
  const pageTitle = await fetchReviewPageTitle(parsed);
  if (pageTitle) {
    const value = { ...parsed, title: pageTitle, displayTitle: `${parsed.displayTitle} · ${pageTitle}` };
    reviewLinkMetaCache.set(parsed.url, { value, cachedAt: Date.now() });
    return value;
  }
  reviewLinkMetaCache.set(parsed.url, { value: parsed, cachedAt: Date.now() });
  return parsed;
}

function isUploadFile(value: unknown): value is {
  name?: string;
  type?: string;
  size?: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return !!value
    && typeof value === 'object'
    && typeof (value as any).arrayBuffer === 'function';
}

function extensionForTodoImage(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/jpg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    case 'image/svg+xml': return '.svg';
    case 'image/avif': return '.avif';
    case 'image/bmp': return '.bmp';
    default: return '.png';
  }
}

function sanitizeTodoImageFilename(image: TodoImageAttachment, index: number): string {
  const baseName = path.basename(image.name || `todo-image-${index + 1}`);
  const parsed = path.parse(baseName);
  const safeStem = (parsed.name || `todo-image-${index + 1}`)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `todo-image-${index + 1}`;
  const ext = parsed.ext || extensionForTodoImage(image.mimeType);
  return `${String(index + 1).padStart(2, '0')}-${safeStem}${ext.toLowerCase()}`;
}

function decodeTodoImageDataUrl(image: TodoImageAttachment): Buffer | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(image.dataUrl || '');
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length ? buffer : null;
}

async function materializeTodoImages(items: TodoItem[]): Promise<{ attachments: string[]; cleanup: () => Promise<void> }> {
  const images = items.flatMap(item => item.images || []);
  if (!images.length) return { attachments: [], cleanup: async () => {} };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pikiclaw-todo-images-'));
  try {
    const attachments: string[] = [];
    for (const [index, image] of images.entries()) {
      const buffer = decodeTodoImageDataUrl(image);
      if (!buffer) continue;
      const filePath = path.join(tempDir, sanitizeTodoImageFilename(image, index));
      await fs.writeFile(filePath, buffer);
      attachments.push(filePath);
    }
    return {
      attachments,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function pickAssistantAgent(assistant?: AgentAssistant, fallbackAgent?: string | null): string | null {
  const explicit = readString(fallbackAgent);
  if (explicit) return explicit;
  const preferred = assistant?.preferredAgents?.find(agent => readString(agent));
  return preferred || null;
}

function buildAssistantPrompt(prompt: string, assistant?: AgentAssistant): string {
  if (!assistant) return prompt;
  return [
    `You are running as Pikiclaw Assistant: ${assistant.name}`,
    '',
    'Assistant responsibility:',
    assistant.responsibility,
    '',
    'Task:',
    prompt,
  ].join('\n');
}

function buildQuickAssistantPrompt(prompt: string, assistant: AgentAssistant): string {
  const workingPrompt = readString(assistant.prompt) || readString(assistant.defaultPrompt);
  return [
    `You are running as Pikiclaw Assistant: ${assistant.name}`,
    '',
    'Assistant responsibility:',
    assistant.responsibility,
    workingPrompt ? 'Assistant working prompt:' : '',
    workingPrompt,
    '',
    'User input:',
    prompt,
  ].filter(part => part !== '').join('\n');
}

function mergeJiraRawFields(input: any): Record<string, unknown> | undefined {
  const raw = input?.rawFields && typeof input.rawFields === 'object'
    ? { ...input.rawFields }
    : input?.fields && typeof input.fields === 'object'
      ? { ...input.fields }
      : {};
  const fixVersion = input?.fixVersions ?? input?.fixVersion;
  if (fixVersion != null) raw.fixVersions = fixVersion;
  return Object.keys(raw).length ? raw : undefined;
}

function buildJiraMcpSyncPrompt(runId?: string): string {
  return [
    'Sync Jira through the configured Jira/Atlassian MCP server.',
    runId ? `Jira sync run id: ${runId}` : '',
    '',
    'Requirements:',
    runId ? '- Immediately call `pikiclaw_pro_report_jira_sync_progress` with this runId before each visible step.' : '',
    runId ? '- Report which Jira MCP tool/query you are using, how many tickets you found, and when task writing starts.' : '',
    '- Prefer `pikiclaw_pro_pull_jira_sync_candidates` for the pull step. It uses the configured Jira MCP service from the Pikiclaw backend, records candidates, and avoids relying on agent-visible Atlassian tool namespace selection.',
    '- If `pikiclaw_pro_pull_jira_sync_candidates` succeeds, do not call Jira search/get issue yourself and do not call `pikiclaw_pro_record_jira_sync_candidates` again.',
    '- Only fall back to direct Jira MCP tools when `pikiclaw_pro_pull_jira_sync_candidates` is unavailable or returns an error. In that fallback, prefer `mcp_atlassian_service` / `mcp__mcp_atlassian_service` Jira tools before generic `mcp__atlassian`.',
    '- Only sync Jira issues assigned to me / the current Jira user. Do not sync issues assigned to other people, unassigned issues, watched issues, reporter-only issues, or team-wide results unless they are also assigned to me.',
    '- Default sync scope is current sprint active work only: use an assignee-scoped query such as `assignee = currentUser() AND sprint in openSprints() AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC`.',
    '- If Jira does not support `sprint in openSprints()` in this instance, keep `assignee = currentUser()` and exclude Closed/Cancelled before writing candidates.',
    '- Before recording candidates, discard any issue whose assignee is not me / the current Jira user.',
    '- Do not record or sync Closed or Cancelled Jira issues.',
    '- After pulling Jira issues, call `pikiclaw_pro_record_jira_sync_candidates` with an `issues` array. Do not call `pikiclaw_pro_sync_jira_issues` during the pull step; the user will apply selected candidates from the dashboard.',
    runId ? '- Include the same runId when calling `pikiclaw_pro_record_jira_sync_candidates`.' : '',
    '- When using Jira search/get issue, request summary, description, issuetype, status, assignee, reporter, fixVersions, duedate, priority, labels, updated, and the sprint custom field `customfield_10652` when available.',
    '- Each issue passed to that tool should include jiraKey/key, title/summary, description, issueType, jiraUrl/url, sprint, fixVersion/fixVersions, reporter, assignee, ticketStatus/status, dueDate, priority, labels, updatedAt, linked issues, remote links, and development/MR links when available.',
    '- Sync Jira tickets into Pikiclaw task context: keep title, description, ticket key, link, sprint, native Jira fields, and changed remote notes.',
    '- Append remote updates as new notes instead of overwriting existing local task context.',
    '- Mark newly assigned tickets and changed tickets clearly.',
    '- Summarize what was synced, what changed, and anything that needs manual attention.',
  ].filter(Boolean).join('\n');
}

type AutomationQueueSource = 'manual' | 'scheduler';

function emitScheduledTaskEvent(
  rule: AutomationRule,
  status: 'queued' | 'completed' | 'failed' | 'missed',
  details: { sessionKey?: string; error?: unknown; scheduledFor?: string } = {},
) {
  runtime.emitDashboardEvent({
    type: 'scheduled-task',
    key: rule.id,
    automationId: rule.id,
    name: rule.name,
    schedule: rule.schedule,
    status,
    sessionKey: details.sessionKey,
    scheduledFor: details.scheduledFor,
    error: typeof details.error === 'string'
      ? details.error
      : details.error instanceof Error
        ? details.error.message
        : details.error == null
          ? undefined
          : String(details.error),
  });
}

async function queueAutomationRule(rule: AutomationRule, source: AutomationQueueSource = 'manual') {
  const config = loadUserConfig();
  const assistant = rule.assistantId ? listAgentAssistants().find(item => item.id === rule.assistantId) : undefined;
  const agent = pickAssistantAgent(assistant, rule.agent);
  const workdir = rule.workdir || runtime.getRequestWorkdir(config);
  const model = agent ? resolveAgentModel(config, agent as any) : null;
  const budgetGate = await evaluateCurrentUsageBudgetGate({ agent, model });
  if (!budgetGate.allowed) {
    const updated = markAutomationRun(rule.id, undefined, {
      error: budgetGate.message,
      code: 'usage_budget_paused',
      budgetId: budgetGate.budget.id,
      budgetName: budgetGate.budget.name,
    });
    if (source === 'scheduler') emitScheduledTaskEvent(rule, 'failed', { error: budgetGate.message });
    return {
      queued: {
        ok: false as const,
        error: budgetGate.message,
        code: 'usage_budget_paused',
        budget: budgetGate.budget,
      },
      updated,
    };
  }
  const syncRun = rule.key === JIRA_MCP_SYNC_AUTOMATION_KEY
    ? createJiraSyncRun({ assistantId: rule.assistantId, assistantName: assistant?.name, agent, workdir })
    : null;
  if (syncRun) {
    updateJiraSyncRun(syncRun.id, {
      status: 'starting',
      event: { label: 'Scheduled sync triggered', detail: `${rule.schedule} · ${assistant?.name || 'assistant'} · ${agent || runtime.getRuntimeDefaultAgent(config)}` },
    });
  }
  const queued = await queueDashboardSessionTask({
    workdir,
    agent,
    sessionId: '',
    prompt: buildAssistantPrompt(buildAutomationRunPrompt({
      name: rule.name,
      schedule: rule.schedule,
      prompt: syncRun ? buildJiraMcpSyncPrompt(syncRun.id) : rule.prompt,
    }), assistant),
    attachments: [],
    contextSources: collectAutomationContextSources({
      workdir,
      includeProjectReferences: rule.includeProjectReferences,
      projectReferenceNames: rule.projectReferenceNames,
    }),
  });
  if (!queued.ok) {
    if (syncRun) updateJiraSyncRun(syncRun.id, { status: 'failed', error: queued.error, event: { label: 'Failed to start scheduled sync session', detail: queued.error } });
    const updated = markAutomationRun(rule.id, undefined, { error: queued.error });
    if (source === 'scheduler') emitScheduledTaskEvent(rule, 'failed', { error: queued.error });
    return { queued, updated };
  }
  if (syncRun) updateJiraSyncRun(syncRun.id, { status: 'queued', sessionKey: queued.sessionKey, event: { label: 'Scheduled agent session queued', detail: queued.sessionKey || queued.taskId || 'Queued' } });
  const updated = markAutomationRun(rule.id, queued.sessionKey, { taskId: queued.taskId });
  if (source === 'scheduler') emitScheduledTaskEvent(rule, 'queued', { sessionKey: queued.sessionKey });
  return { queued, updated };
}

function parseSchedule(schedule: string): { cadence: string; time: string; weekday?: number; day?: number } | null {
  const raw = readString(schedule);
  if (!raw || raw === 'manual' || raw === 'one-time') return null;
  if (raw === 'daily') return { cadence: 'daily', time: '09:00' };
  if (raw === 'weekly') return { cadence: 'weekly', weekday: 1, time: '09:00' };
  if (raw === 'biweekly') return { cadence: 'biweekly', weekday: 1, time: '09:00' };
  if (raw === 'monthly') return { cadence: 'monthly', day: 1, time: '09:00' };
  const parts = raw.split('@');
  const cadence = parts[0] || '';
  const time = parts[parts.length - 1] || '';
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  if (cadence === 'daily') return { cadence, time };
  if (cadence === 'weekly' || cadence === 'biweekly') {
    const weekday = Number(parts[1] ?? 1);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    return { cadence, weekday, time };
  }
  if (cadence === 'monthly') {
    const day = Number(parts[1] ?? 1);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    return { cadence, day, time };
  }
  return null;
}

function automationDueSlot(rule: AutomationRule, now = new Date()): string | null {
  if (!rule.enabled) return null;
  const parsed = parseSchedule(rule.schedule);
  if (!parsed) return null;
  const [hour, minute] = parsed.time.split(':').map(Number);
  if (now.getHours() !== hour || now.getMinutes() !== minute) return null;
  const dateKey = now.toISOString().slice(0, 10);
  if (parsed.cadence === 'daily') return `${rule.id}:${dateKey}:${parsed.time}`;
  if (parsed.cadence === 'weekly') {
    if (now.getDay() !== parsed.weekday) return null;
    return `${rule.id}:week:${dateKey}:${parsed.time}`;
  }
  if (parsed.cadence === 'biweekly') {
    if (now.getDay() !== parsed.weekday) return null;
    const week = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
    if (week % 2 !== 0) return null;
    return `${rule.id}:biweek:${dateKey}:${parsed.time}`;
  }
  if (parsed.cadence === 'monthly') {
    if (now.getDate() !== parsed.day) return null;
    return `${rule.id}:month:${dateKey}:${parsed.time}`;
  }
  return null;
}

const AUTOMATION_MISSED_GRACE_MS = 90_000;

function automationDateAtTime(base: Date, time: string): Date {
  const [hour = '9', minute = '0'] = time.split(':');
  const date = new Date(base);
  date.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
  return date;
}

function previousAutomationDueAt(rule: AutomationRule, now = new Date()): Date | null {
  if (!rule.enabled) return null;
  const parsed = parseSchedule(rule.schedule);
  if (!parsed) return null;
  if (parsed.cadence === 'daily') {
    const today = automationDateAtTime(now, parsed.time);
    return today.getTime() <= now.getTime() ? today : new Date(today.getTime() - 24 * 60 * 60 * 1000);
  }
  if (parsed.cadence === 'weekly' || parsed.cadence === 'biweekly') {
    if (parsed.weekday == null) return null;
    const candidate = automationDateAtTime(now, parsed.time);
    let delta = (now.getDay() - parsed.weekday + 7) % 7;
    if (delta === 0 && candidate.getTime() > now.getTime()) delta = 7;
    let previous = new Date(candidate.getTime() - delta * 24 * 60 * 60 * 1000);
    if (parsed.cadence === 'biweekly') {
      const week = Math.floor(previous.getTime() / (7 * 24 * 60 * 60 * 1000));
      if (week % 2 !== 0) previous = new Date(previous.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    return previous;
  }
  if (parsed.cadence === 'monthly') {
    if (parsed.day == null) return null;
    const candidate = automationDateAtTime(new Date(now.getFullYear(), now.getMonth(), parsed.day), parsed.time);
    return candidate.getTime() <= now.getTime()
      ? candidate
      : automationDateAtTime(new Date(now.getFullYear(), now.getMonth() - 1, parsed.day), parsed.time);
  }
  return null;
}

function latestAutomationKnownRunAt(rule: AutomationRule): number {
  const values = [
    rule.lastRunAt,
    ...(rule.runHistory || []).flatMap(item => [item.ranAt, item.scheduledFor]),
  ];
  return values.reduce((latest, value) => {
    if (!value) return latest;
    const time = Date.parse(value);
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, 0);
}

function recordMissedAutomationIfNeeded(rule: AutomationRule, now = new Date()): AutomationRule | null {
  const dueAt = previousAutomationDueAt(rule, now);
  if (!dueAt) return null;
  if (now.getTime() - dueAt.getTime() < AUTOMATION_MISSED_GRACE_MS) return null;
  if (latestAutomationKnownRunAt(rule) >= dueAt.getTime()) return null;
  const scheduledFor = dueAt.toISOString();
  const updated = markAutomationMissedRun(rule.id, scheduledFor, {
    error: `Scheduled task missed its ${dueAt.toLocaleString()} run window while Pikiclaw was not available to queue it.`,
  });
  emitScheduledTaskEvent(updated, 'missed', { scheduledFor, error: updated.runHistory?.[0]?.error });
  return updated;
}

const runningScheduleSlots = new Set<string>();

async function runDueAutomations() {
  for (const rule of listAutomationRules()) {
    recordMissedAutomationIfNeeded(rule);
    const slot = automationDueSlot(rule);
    if (!slot || runningScheduleSlots.has(slot)) continue;
    const lastRunKey = rule.lastRunAt ? automationDueSlot({ ...rule, lastRunAt: undefined }, new Date(rule.lastRunAt)) : null;
    if (lastRunKey === slot) continue;
    runningScheduleSlots.add(slot);
    void queueAutomationRule(rule, 'scheduler').finally(() => {
      setTimeout(() => runningScheduleSlots.delete(slot), 70_000);
    });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __pikiclawProAutomationSchedulerStarted: boolean | undefined;
}

if (!globalThis.__pikiclawProAutomationSchedulerStarted) {
  globalThis.__pikiclawProAutomationSchedulerStarted = true;
  setInterval(() => { void runDueAutomations(); }, 60_000).unref?.();
  setTimeout(() => { void runDueAutomations(); }, 5_000).unref?.();
}

function parseSessionKey(sessionKey: string | null | undefined): { agent: string; sessionId: string } | null {
  const raw = readString(sessionKey);
  if (!raw) return null;
  const index = raw.indexOf(':');
  if (index <= 0 || index >= raw.length - 1) return null;
  return { agent: raw.slice(0, index), sessionId: raw.slice(index + 1) };
}

function workflowRunParentSession(run: WorkflowRunRecord): { agent: string; sessionId: string } | null {
  const agent = readString(run.agent);
  const sessionId = readString(run.sessionId);
  if (agent && sessionId) return { agent, sessionId };
  return parseSessionKey(run.sessionKey);
}

function buildWorkflowAutonomousStepPrompt(run: WorkflowRunRecord, step: WorkflowRunStep): string {
  const steps = (run.steps || []).map(item => {
    const marker = item.index === step.index ? 'TARGET' : item.index < step.index ? 'context' : 'later';
    return `${item.index}. [${marker}] ${item.title}`;
  });
  return [
    '[Workflow Autonomous Step]',
    `Parent workflow: ${run.workflowName}`,
    `Parent run id: ${run.id}`,
    `Target step: ${step.index}/${run.totalSteps} - ${step.title}`,
    run.workdir ? `Project: ${run.workdir}` : '',
    run.note ? `Run note: ${run.note}` : '',
    '',
    'You are a child worker spawned by Pikiclaw to execute exactly one workflow step.',
    'Do not restart the whole workflow. Do not continue later steps unless they are required to finish this step.',
    'Use the project files, skills, MCP, CLI tools, and local context available in this child chat.',
    '',
    'Workflow map:',
    ...steps,
    '',
    'Execution contract:',
    '- Start with a one-line statement of what this step will produce.',
    '- Perform the concrete work needed for the target step.',
    '- If blocked, stop and state the exact missing decision, credential, file, or risk.',
    '- Finish with Markdown sections: Result, Evidence, Files or commands used, Handoff back to parent workflow.',
    '- Do not claim the parent workflow is complete; only report this step outcome.',
  ].filter(Boolean).join('\n');
}

app.get('/api/pro/task-spaces', (c) => {
  return c.json({ ok: true, spaces: listTaskSpaces() });
});

app.post('/api/pro/task-spaces', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ ok: true, space: createTaskSpace(body || {}) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/task-spaces/:spaceId', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ ok: true, space: updateTaskSpace(c.req.param('spaceId'), body || {}) });
  } catch (e: any) {
    const status = e?.message === 'task space not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/task-spaces/:spaceId', (c) => {
  try {
    return c.json({ ok: true, space: archiveTaskSpace(c.req.param('spaceId')) });
  } catch (e: any) {
    const status = e?.message === 'task space not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/tasks', (c) => {
  const spaceId = readString(c.req.query('spaceId'));
  const plannedDate = readString(c.req.query('plannedDate'));
  return c.json({
    ok: true,
    tasks: listProTasks({
      ...(spaceId && spaceId !== 'all' ? { spaceId } : {}),
      ...(plannedDate ? { plannedDate } : {}),
    }),
  });
});

app.get('/api/pro/jira/cycles', (c) => {
  return c.json({ ok: true, cycles: listJiraCycles() });
});

app.post('/api/pro/jira/cycles/kickoff', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const cycle = kickOffJiraCycle({ name: body?.name, startDate: body?.startDate, endDate: body?.endDate });
    const taskIds = Array.isArray(body?.taskIds) ? body.taskIds.filter((id: unknown): id is string => typeof id === 'string') : [];
    const tasks = assignProTasksToCycle(taskIds, cycle.id);
    return c.json({ ok: true, cycle, tasks });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/jira/cycles/close-active', (c) => {
  try {
    return c.json({ ok: true, cycle: closeActiveJiraCycle() });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.delete('/api/pro/jira/cycles/:cycleId', (c) => {
  try {
    return c.json({ ok: true, cycle: deleteJiraCycle(c.req.param('cycleId')) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 404);
  }
});

app.get('/api/pro/usage-summary', async (c) => {
  try {
    return c.json({ ok: true, summary: await buildProUsageSummary(c.req.query('limit'), { cache: c.req.query('fresh') !== '1' }) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/usage-budget-alerts', (c) => {
  try {
    return c.json({ ok: true, alerts: listUsageBudgetAlerts(Number(c.req.query('limit') || 20)) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/usage-budgets', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const budget = upsertUsageBudget(body);
    clearProUsageSummaryCache();
    return c.json({ ok: true, budget });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.delete('/api/pro/usage-budgets/:budgetId', (c) => {
  try {
    const deleted = deleteUsageBudget(c.req.param('budgetId'));
    if (deleted) clearProUsageSummaryCache();
    return c.json({ ok: true, deleted });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 404);
  }
});

app.get('/api/pro/notes/tree', (c) => {
  try {
    return c.json({ ok: true, ...listNoteTree() });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/notes/daily', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, page: getOrCreateDailyNote(body?.date) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/notes/pages', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, page: createNotePage({ title: body?.title, parentId: body?.parentId }) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/notes/pages/reorder', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, pages: reorderNotePages(body?.parentId, Array.isArray(body?.pageIds) ? body.pageIds : []) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/notes/search', (c) => {
  try {
    return c.json({ ok: true, results: searchNotes(c.req.query('q') || '') });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/notes/assets/:pageId/:fileName', async (c) => {
  try {
    const asset = resolveNoteAsset(c.req.param('pageId'), c.req.param('fileName'));
    const bytes = await fs.readFile(asset.filePath);
    return c.body(bytes, 200, {
      'Content-Type': asset.mimeType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  } catch (e: any) {
    const status = e?.code === 'ENOENT' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/notes/pages/:pageId', (c) => {
  const page = getNotePage(c.req.param('pageId'));
  return page ? c.json({ ok: true, page }) : c.json({ ok: false, error: 'note page not found' }, 404);
});

app.patch('/api/pro/notes/pages/:pageId', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const patch: { title?: string; parentId?: string | null; deletedAt?: string | null } = {};
    if (body && Object.prototype.hasOwnProperty.call(body, 'title')) patch.title = body.title;
    if (body && Object.prototype.hasOwnProperty.call(body, 'parentId')) patch.parentId = body.parentId;
    if (body && Object.prototype.hasOwnProperty.call(body, 'deletedAt')) patch.deletedAt = body.deletedAt;
    return c.json({ ok: true, page: updateNotePage(c.req.param('pageId'), patch) });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/notes/pages/:pageId', (c) => {
  try {
    return c.json({ ok: true, page: deleteNotePage(c.req.param('pageId'), c.req.query('permanent') === '1') });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/notes/pages/:pageId/document', (c) => {
  try {
    return c.json({ ok: true, blocks: readNoteDocument(c.req.param('pageId')) });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.put('/api/pro/notes/pages/:pageId/document', async (c) => {
  try {
    const body = await c.req.json();
    const blocks = Array.isArray(body) ? body : body?.blocks;
    return c.json({ ok: true, blocks: writeNoteDocument(c.req.param('pageId'), blocks) });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/notes/pages/:pageId/assets', async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get('file') || form.get('image');
    if (!isUploadFile(file)) return c.json({ ok: false, error: 'image file is required' }, 400);
    const asset = saveNoteAsset(c.req.param('pageId'), {
      name: readString(file.name) || 'note-image.png',
      mimeType: readString(file.type) || 'image/png',
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return c.json({ ok: true, asset });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/notes/promote', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config = loadUserConfig();
    const result = promoteNoteSelection({
      pageId: body?.pageId,
      target: body?.target,
      text: body?.text,
      date: body?.date,
      workdir: readString(body?.workdir) || runtime.getRequestWorkdir(config),
    });
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    const status = e?.message === 'note page not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/todos', (c) => {
  return c.json({ ok: true, items: listTodoItems() });
});

app.get('/api/pro/daily-items', (c) => {
  const date = readString(c.req.query('date'));
  return c.json({ ok: true, items: listDailyItems(date || undefined) });
});

app.post('/api/pro/daily-items', async (c) => {
  try {
    const body = await c.req.json();
    const items = createDailyItems({
      date: body?.date,
      titles: Array.isArray(body?.titles) ? body.titles : [],
      relatedTaskId: body?.relatedTaskId,
    });
    return c.json({ ok: true, items });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/daily-items/from-todo', async (c) => {
  try {
    const body = await c.req.json();
    const result = addTodoToDaily(body?.date, body?.todoId);
    return c.json({ ok: true, item: result.item, taskId: result.taskId });
  } catch (e: any) {
    const status = e?.message === 'todo not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/daily-items/from-task', async (c) => {
  try {
    const body = await c.req.json();
    const result = addTaskToDaily(body?.date, body?.taskId);
    return c.json({ ok: true, item: result.item });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/daily-items/promote', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const result = promoteDailyItemsToTasks(
      body?.date,
      Array.isArray(body?.itemIds) ? body.itemIds : [],
      { workdir: readString(body?.workdir) || runtime.getRequestWorkdir(config) },
    );
    return c.json({ ok: true, items: result.items, taskIds: result.taskIds });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/daily-items/reorder', async (c) => {
  try {
    const body = await c.req.json();
    const items = reorderDailyItems(body?.date, Array.isArray(body?.itemIds) ? body.itemIds : []);
    return c.json({ ok: true, items });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/daily-items/:itemId', async (c) => {
  try {
    const body = await c.req.json();
    const item = updateDailyItem(c.req.param('itemId'), {
      title: body?.title,
      status: body?.status,
      relatedTaskId: Object.prototype.hasOwnProperty.call(body || {}, 'relatedTaskId') ? body.relatedTaskId : undefined,
    });
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'daily item not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/daily-items/:itemId/revert-task', async (c) => {
  try {
    const item = revertDailyItemTask(c.req.param('itemId'));
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'daily item not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/daily-items/:itemId', (c) => {
  try {
    const item = deleteDailyItem(c.req.param('itemId'));
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'daily item not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/todos', async (c) => {
  try {
    const body = await c.req.json();
    const item = createTodoItem({
      kind: body?.kind,
      title: body?.title,
      body: body?.body,
      source: body?.source,
      images: body?.images,
    });
    return c.json({ ok: true, item });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/todos/:todoId', async (c) => {
  try {
    const body = await c.req.json();
    const update: { title?: string; body?: string; status?: TodoItem['status']; images?: unknown } = {};
    if (body && Object.prototype.hasOwnProperty.call(body, 'title')) update.title = body.title;
    if (body && Object.prototype.hasOwnProperty.call(body, 'body')) update.body = body.body;
    if (body && Object.prototype.hasOwnProperty.call(body, 'status')) update.status = body.status;
    if (body && Object.prototype.hasOwnProperty.call(body, 'images')) update.images = body.images;
    const item = updateTodoItem(c.req.param('todoId'), update);
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'todo not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/todos/:todoId', (c) => {
  try {
    const item = deleteTodoItem(c.req.param('todoId'));
    return c.json({ ok: true, item });
  } catch (e: any) {
    const status = e?.message === 'todo not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/todos/chat', async (c) => {
  try {
    const body = await c.req.json();
    const todoIds = Array.isArray(body?.todoIds) ? body.todoIds.map(String) : [];
    const items = getTodoItems(todoIds);
    if (!items.length) return c.json({ ok: false, error: 'todoIds are required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || items.find(item => item.source?.workdir)?.source?.workdir || runtime.getRequestWorkdir(config);
    const userPrompt = readString(body?.prompt);
    const prompt = [
      'Please start a focused chat for the following captured todo/review items.',
      '',
      ...items.map((item, index) => [
        `Item ${index + 1}: ${item.title}`,
        item.body ? `Note: ${item.body}` : '',
        item.images?.length ? `Images: ${item.images.map(image => image.name).join(', ')}` : '',
        item.source?.quote ? `Quoted context:\n${item.source.quote}` : '',
        item.source?.agent && item.source?.sessionId ? `Source session: ${item.source.agent}:${item.source.sessionId}${typeof item.source.turnIndex === 'number' ? ` turn ${item.source.turnIndex}` : ''}` : '',
      ].filter(Boolean).join('\n')),
      userPrompt ? `\nUser instruction:\n${userPrompt}` : '',
    ].join('\n\n');
    const imageUploads = await materializeTodoImages(items);
    try {
      const queued = await queueDashboardSessionTask({
        workdir,
        agent: readString(body?.agent) || null,
        sessionId: '',
        prompt,
        model: readString(body?.model) || null,
        effort: readString(body?.effort) || null,
        attachments: imageUploads.attachments,
      });
      if (!queued.ok) {
        const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
        return c.json(queued, statusCode);
      }
      const session = parseSessionKey(queued.sessionKey);
      for (const item of items) {
        if (session) {
          linkTodoChat(item.id, { workdir, agent: session.agent, sessionId: session.sessionId });
        } else {
          updateTodoItem(item.id, { status: 'chat-created' });
        }
      }
      return c.json({ ok: true, queued, items: getTodoItems(items.map(item => item.id)) });
    } finally {
      await imageUploads.cleanup();
    }
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/review-comments', async (c) => {
  try {
    const body = await c.req.json();
    const item = createTodoItem({
      kind: 'review-comment',
      title: body?.title,
      body: body?.body,
      source: { ...(body?.source || {}), type: 'review-comment' },
      images: body?.images,
    });
    return c.json({ ok: true, item });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/assistants', (c) => {
  return c.json({ ok: true, assistants: listAgentAssistants() });
});

app.get('/api/pro/review-link-meta', async (c) => {
  const url = readString(c.req.query('url'));
  if (!url) return c.json({ ok: false, error: 'url is required' }, 400);
  const meta = await fetchReviewLinkMeta(url);
  if (!meta) return c.json({ ok: false, error: 'unsupported review link' }, 400);
  return c.json({ ok: true, meta });
});

app.get('/api/pro/assistants/history', (c) => {
  const limitQuery = readString(c.req.query('limit'));
  const limitRaw = Number.parseInt(limitQuery || '50', 10);
  const limit = limitQuery === 'all'
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const config = loadUserConfig();
  const defaultWorkdir = runtime.getRequestWorkdir(config);
  const assistants = listAgentAssistants();
  const history: Record<string, any[]> = Object.fromEntries(assistants.map(assistant => [assistant.id, []]));
  const seen = new Set<string>();

  const addSession = (entry: {
    assistantId?: string;
    source: 'automation' | 'jira-sync' | 'stage-run';
    sourceLabel?: string;
    workdir?: string;
    agent?: string;
    sessionId?: string;
    sessionKey?: string;
  }) => {
    const assistantId = readString(entry.assistantId);
    if (!assistantId) return;
    const parsed = parseSessionKey(entry.sessionKey);
    const agent = readString(entry.agent) || parsed?.agent || '';
    const sessionId = readString(entry.sessionId) || parsed?.sessionId || '';
    const workdir = readString(entry.workdir) || defaultWorkdir;
    if (!agent || !sessionId || !workdir) return;
    if (!history[assistantId]) history[assistantId] = [];
    const key = `${assistantId}:${workdir}:${agent}:${sessionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const session = findPikiclawSessionInfo(workdir, agent as any, sessionId);
    if (!session) return;
    history[assistantId].push({
      assistantId,
      source: entry.source,
      sourceLabel: entry.sourceLabel,
      workdir,
      agent,
      sessionId,
      sessionKey: `${agent}:${sessionId}`,
      title: session?.title ?? null,
      lastQuestion: session?.lastQuestion ?? null,
      lastMessageText: session?.lastMessageText ?? null,
      runState: session?.runState,
      createdAt: session?.createdAt ?? null,
      updatedAt: session?.runUpdatedAt || session?.createdAt || null,
      runUpdatedAt: session?.runUpdatedAt ?? null,
      numTurns: session?.numTurns ?? null,
    });
  };

  for (const task of listProTasks()) {
    for (const run of task.stageRuns || []) {
      addSession({
        assistantId: run.assistantId,
        source: 'stage-run',
        sourceLabel: `${task.title || task.id} · ${run.stage}`,
        workdir: run.session?.workdir || task.workdir,
        agent: run.session?.agent,
        sessionId: run.session?.sessionId,
      });
    }
  }

  for (const rule of listAutomationRules()) {
    for (const run of rule.runHistory || []) {
      addSession({
        assistantId: rule.assistantId,
        source: 'automation',
        sourceLabel: rule.name,
        workdir: rule.workdir,
        sessionKey: run.sessionKey,
      });
    }
  }

  for (const run of listJiraSyncRuns()) {
    addSession({
      assistantId: run.assistantId,
      source: 'jira-sync',
      sourceLabel: run.issueKeys?.length ? run.issueKeys.join(', ') : 'Jira sync',
      workdir: run.workdir,
      agent: run.agent,
      sessionKey: run.sessionKey,
    });
  }

  for (const assistantId of Object.keys(history)) {
    history[assistantId] = history[assistantId]
      .sort((a, b) => Date.parse(b.runUpdatedAt || b.updatedAt || b.createdAt || '') - Date.parse(a.runUpdatedAt || a.updatedAt || a.createdAt || ''));
    if (Number.isFinite(limit)) history[assistantId] = history[assistantId].slice(0, limit);
  }

  return c.json({ ok: true, history });
});

app.post('/api/pro/assistants/:assistantId/run', async (c) => {
  try {
    const assistantId = readString(c.req.param('assistantId'));
    const assistant = listAgentAssistants().find(item => item.id === assistantId);
    if (!assistant) return c.json({ ok: false, error: 'assistant not found' }, 404);
    if (assistant.enabled === false) return c.json({ ok: false, error: 'assistant is disabled' }, 400);

    const body = await c.req.json();
    const userPrompt = readString(body?.prompt);
    if (!userPrompt) return c.json({ ok: false, error: 'prompt is required' }, 400);
    const displayPrompt = readString(body?.displayPrompt) || userPrompt;
    const projectContext = readProjectContextRef(body?.projectContext);
    const contextSources = normalizeSessionContextSources(body?.contextSources);

    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const agent = pickAssistantAgent(assistant, readString(body?.agent) || null);
    const queued = await queueDashboardSessionTask({
      workdir,
      agent,
      sessionId: '',
      prompt: buildQuickAssistantPrompt(userPrompt, assistant),
      displayPrompt,
      permissionMode: readString(body?.permissionMode) || null,
      attachments: [],
      contextSources,
      projectContext,
      origin: {
        channel: 'dashboard',
        chatId: `quick-assistant:${assistant.id}`,
        chatType: 'quick-assistant',
        sourceMessageId: `quick-${Date.now().toString(36)}`,
      },
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }

    const session = parseSessionKey(queued.sessionKey);
    return c.json({
      ok: true,
      assistant,
      queued,
      session: session ? { workdir, agent: session.agent, sessionId: session.sessionId } : null,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/assistants/:assistantId/prompt', (c) => {
  try {
    const prompt = getAssistantPrompt(c.req.param('assistantId'));
    return c.json({ ok: true, ...prompt });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/assistants/:assistantId/prompt', async (c) => {
  try {
    const body = await c.req.json();
    const assistant = updateAgentAssistantPrompt(c.req.param('assistantId'), { prompt: body?.prompt });
    return c.json({
      ok: true,
      assistant,
      prompt: assistant.prompt || assistant.defaultPrompt || assistant.responsibility,
      defaultPrompt: assistant.defaultPrompt || assistant.responsibility,
      customized: (assistant.prompt || '').trim() !== (assistant.defaultPrompt || assistant.responsibility).trim(),
    });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/assistants/:assistantId/reset-prompt', (c) => {
  try {
    const assistant = resetAgentAssistantPrompt(c.req.param('assistantId'));
    return c.json({
      ok: true,
      assistant,
      prompt: assistant.prompt || assistant.defaultPrompt || assistant.responsibility,
      defaultPrompt: assistant.defaultPrompt || assistant.responsibility,
      customized: false,
    });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/jira/config', (c) => {
  return c.json({ ok: true, config: getJiraWorkflowConfig() });
});

app.patch('/api/pro/jira/config', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ ok: true, config: updateJiraWorkflowConfig({
      refinementAssistantId: body?.refinementAssistantId,
      codingAssistantId: body?.codingAssistantId,
      ticketSyncAssistantId: body?.ticketSyncAssistantId,
      knowledgeAssistantId: body?.knowledgeAssistantId,
      runKnowledgeOnRefinement: body?.runKnowledgeOnRefinement,
      runKnowledgeOnCoding: body?.runKnowledgeOnCoding,
      statusWorkflows: body?.statusWorkflows,
    }) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/assistants', async (c) => {
  try {
    const body = await c.req.json();
    const assistant = createAgentAssistant({
      name: body?.name,
      responsibility: body?.responsibility,
      preferredAgents: body?.preferredAgents,
      kind: body?.kind,
      surfaceId: body?.surfaceId,
      objectTypes: body?.objectTypes,
      prompt: body?.prompt,
      defaultPrompt: body?.defaultPrompt,
      allowedActions: body?.allowedActions,
      labels: body?.labels,
      enabled: body?.enabled,
    });
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/assistants/:assistantId', async (c) => {
  try {
    const body = await c.req.json();
    const assistant = updateAgentAssistant(c.req.param('assistantId'), {
      name: body?.name,
      responsibility: body?.responsibility,
      preferredAgents: body?.preferredAgents,
      kind: body?.kind,
      surfaceId: body?.surfaceId,
      objectTypes: body?.objectTypes,
      prompt: body?.prompt,
      defaultPrompt: body?.defaultPrompt,
      allowedActions: body?.allowedActions,
      labels: body?.labels,
      enabled: body?.enabled,
    });
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/assistants/:assistantId', (c) => {
  try {
    const assistant = deleteAgentAssistant(c.req.param('assistantId'));
    return c.json({ ok: true, assistant });
  } catch (e: any) {
    const status = e?.message === 'assistant not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/workflow-recipes', (c) => {
  return c.json({ ok: true, workflows: listCustomWorkflowRecipes() });
});

app.post('/api/pro/workflow-recipes', async (c) => {
  try {
    const body = await c.req.json();
    const workflow = createCustomWorkflowRecipe({
      name: body?.name,
      description: body?.description,
      category: body?.category,
      tags: body?.tags,
      outputs: body?.outputs,
      steps: body?.steps,
      capabilities: body?.capabilities,
      promptHint: body?.promptHint,
      cadence: body?.cadence,
      defaultEffort: body?.defaultEffort,
    });
    return c.json({ ok: true, workflow });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/workflow-recipes/:workflowId', async (c) => {
  try {
    const body = await c.req.json();
    const input: {
      name?: unknown;
      description?: unknown;
      category?: unknown;
      tags?: unknown;
      outputs?: unknown;
      steps?: unknown;
      capabilities?: unknown;
      promptHint?: unknown;
      cadence?: unknown;
      defaultEffort?: unknown;
    } = {};
    if (body && typeof body === 'object') {
      for (const key of ['name', 'description', 'category', 'tags', 'outputs', 'steps', 'capabilities', 'promptHint', 'cadence', 'defaultEffort'] as const) {
        if (Object.prototype.hasOwnProperty.call(body, key)) input[key] = body[key];
      }
    }
    const workflow = updateCustomWorkflowRecipe(c.req.param('workflowId'), input);
    return c.json({ ok: true, workflow });
  } catch (e: any) {
    const status = e?.message === 'workflow not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/workflow-recipes/:workflowId', (c) => {
  try {
    const workflow = deleteCustomWorkflowRecipe(c.req.param('workflowId'));
    return c.json({ ok: true, workflow });
  } catch (e: any) {
    const status = e?.message === 'workflow not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/workflow-runs', (c) => {
  return c.json({
    ok: true,
    runs: listWorkflowRuns({
      activeOnly: c.req.query('activeOnly'),
      limit: c.req.query('limit'),
    }),
  });
});

app.post('/api/pro/workflow-runs/watchdog', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = markStalledWorkflowRunAutonomousWorkers({
      timeoutMs: body?.timeoutMs,
      limit: body?.limit,
    });
    return c.json({ ok: true, result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/workflow-runs/ingest-markers', async (c) => {
  try {
    const body = await c.req.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    const run = ingestWorkflowRunMarkersFromMessages({
      workdir: body?.workdir,
      agent: body?.agent,
      sessionId: body?.sessionId,
      messages: text
        ? [{
            role: 'assistant',
            text,
            blocks: [{ type: 'text', content: text, phase: 'final_answer' }],
          }]
        : [],
    });
    return c.json({ ok: true, run });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/workflow-runs/reconcile-session', async (c) => {
  try {
    const body = await c.req.json();
    const workdir = typeof body?.workdir === 'string' ? body.workdir : '';
    const agent = typeof body?.agent === 'string' ? body.agent : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (!workdir || !agent || !sessionId) {
      return c.json({ ok: false, error: 'workdir, agent, and sessionId are required' }, 400);
    }

    const messages = await querySessionMessages({
      workdir,
      agent: agent as Agent,
      sessionId,
      rich: true,
    });
    if (!messages.ok) {
      return c.json({ ok: false, error: messages.error || 'session messages unavailable' }, 404);
    }

    const reconciliation = reconcileWorkflowRunMarkersFromMessages({
      workdir,
      agent,
      sessionId,
      messages: messages.richMessages || messages.messages,
    });
    return c.json({
      ok: true,
      ...reconciliation,
      totalTurns: messages.totalTurns,
      window: messages.window || null,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/workflow-runs', async (c) => {
  try {
    const body = await c.req.json();
    const run = recordWorkflowRun({
      id: body?.id,
      workflowId: body?.workflowId,
      workflowName: body?.workflowName,
      title: body?.title,
      workdir: body?.workdir,
      agent: body?.agent,
      model: body?.model,
      effort: body?.effort,
      assistantId: body?.assistantId,
      assistantName: body?.assistantName,
      sessionKey: body?.sessionKey,
      sessionId: body?.sessionId,
      note: body?.note,
      currentStep: body?.currentStep,
      totalSteps: body?.totalSteps,
      steps: body?.steps,
      asks: body?.asks,
      status: body?.status,
      lastMarker: body?.lastMarker,
    });
    return c.json({ ok: true, run });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/workflow-runs/:runId/steps/:stepIndex/autonomous', async (c) => {
  let dispatchRunId = '';
  let dispatchStepIndex = 0;
  try {
    const run = getWorkflowRun(c.req.param('runId'));
    if (!run) return c.json({ ok: false, error: 'workflow run not found' }, 404);
    const stepIndex = Math.floor(Number(c.req.param('stepIndex')) || 0);
    const step = run.steps.find(item => item.index === stepIndex);
    if (!step) return c.json({ ok: false, error: 'workflow step not found' }, 404);
    if (!run.workdir) return c.json({ ok: false, error: 'workflow run has no project workspace' }, 400);
    const parent = workflowRunParentSession(run);
    if (!parent) return c.json({ ok: false, error: 'workflow run has no parent chat session' }, 400);

    const child = createDashboardSideChat({
      workdir: run.workdir,
      agent: parent.agent,
      parentSessionId: parent.sessionId,
      title: `${run.workflowName} - Step ${step.index}`,
    });
    if (!child.ok) return c.json(child, 400);
    const childSession = parseSessionKey(child.sessionKey);
    if (!childSession) return c.json({ ok: false, error: 'autonomous child session was not created' }, 500);

    const prompt = buildWorkflowAutonomousStepPrompt(run, step);
    const dispatch = recordWorkflowRunStepAutonomousDispatch(run.id, step.index, {
      childAgent: childSession.agent,
      childSessionId: childSession.sessionId,
      childSessionKey: child.sessionKey,
    });
    dispatchRunId = dispatch.run.id;
    dispatchStepIndex = dispatch.step.index;

    const queued = await queueDashboardSessionTask({
      workdir: run.workdir,
      agent: childSession.agent,
      sessionId: childSession.sessionId,
      prompt,
      displayPrompt: `Run workflow step ${step.index}: ${step.title}`,
      model: run.model || null,
      effort: run.effort || null,
      origin: {
        channel: 'workflow',
        chatId: run.id,
        chatType: 'autonomous-step',
        sourceMessageId: `step:${step.index}`,
      },
    });
    if (!queued.ok) {
      const failed = completeWorkflowRunStepAutonomous(dispatchRunId, dispatchStepIndex, {
        state: 'failed',
        childAgent: childSession.agent,
        childSessionId: childSession.sessionId,
        childSessionKey: child.sessionKey,
        error: queued.error || 'Autonomous worker failed to queue.',
      });
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json({ ...queued, run: failed.run, step: failed.step }, statusCode);
    }

    const queuedSession = parseSessionKey(queued.sessionKey) || childSession;
    const updated = recordWorkflowRunStepAutonomousDispatch(run.id, step.index, {
      dispatchId: dispatch.step.autonomousRun?.dispatchId,
      childAgent: queuedSession.agent,
      childSessionId: queuedSession.sessionId,
      childSessionKey: queued.sessionKey || child.sessionKey,
      taskId: queued.taskId,
    });
    return c.json({ ok: true, run: updated.run, step: updated.step, queued, child });
  } catch (e: any) {
    if (dispatchRunId && dispatchStepIndex) {
      try {
        const failed = completeWorkflowRunStepAutonomous(dispatchRunId, dispatchStepIndex, {
          state: 'failed',
          error: e?.message || String(e),
        });
        return c.json({ ok: false, run: failed.run, step: failed.step, error: e?.message || String(e) }, 400);
      } catch {}
    }
    const status = e?.message === 'workflow run not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/workflow-runs/:runId/asks', async (c) => {
  try {
    const body = await c.req.json();
    const result = recordWorkflowRunAsk(c.req.param('runId'), {
      id: body?.id,
      stepIndex: body?.stepIndex,
      question: body?.question,
      type: body?.type,
      options: body?.options,
      max: body?.max,
      placeholder: body?.placeholder,
    });
    return c.json({ ok: true, run: result.run, ask: result.ask });
  } catch (e: any) {
    const status = e?.message === 'workflow run not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/workflow-runs/:runId/asks/:askId', async (c) => {
  try {
    const body = await c.req.json();
    const result = answerWorkflowRunAsk(c.req.param('runId'), c.req.param('askId'), {
      answer: body?.answer,
      skipped: body?.skipped,
    });
    return c.json({ ok: true, run: result.run, ask: result.ask });
  } catch (e: any) {
    const status = e?.message === 'workflow run not found' || e?.message === 'workflow ask not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/workflow-runs/:runId/asks/:askId/delivery', async (c) => {
  try {
    const body = await c.req.json();
    const result = updateWorkflowRunAskDelivery(c.req.param('runId'), c.req.param('askId'), {
      deliveryStatus: body?.deliveryStatus,
      status: body?.status,
      error: body?.error,
      taskId: body?.taskId,
    });
    return c.json({ ok: true, run: result.run, ask: result.ask });
  } catch (e: any) {
    const status = e?.message === 'workflow run not found' || e?.message === 'workflow ask not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/workflow-runs/:runId', (c) => {
  try {
    const run = deleteWorkflowRun(c.req.param('runId'));
    return c.json({ ok: true, run });
  } catch (e: any) {
    const status = e?.message === 'workflow run not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/automations', (c) => {
  return c.json({ ok: true, automations: listAutomationRules() });
});

app.post('/api/pro/automations', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const automation = createAutomationRule({
      key: body?.key,
      name: body?.name,
      schedule: body?.schedule,
      prompt: body?.prompt,
      workdir: body?.workdir || runtime.getRequestWorkdir(config),
      agent: body?.agent,
      assistantId: body?.assistantId,
      enabled: body?.enabled,
      includeProjectReferences: body?.includeProjectReferences,
      projectReferenceNames: body?.projectReferenceNames,
    });
    return c.json({ ok: true, automation });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/automations/:automationId', async (c) => {
  try {
    const body = await c.req.json();
    const input: {
      name?: unknown;
      schedule?: unknown;
      prompt?: unknown;
      workdir?: unknown;
      agent?: unknown;
      assistantId?: unknown;
      enabled?: unknown;
      includeProjectReferences?: unknown;
      projectReferenceNames?: unknown;
    } = {};
    if (body && typeof body === 'object') {
      for (const key of ['name', 'schedule', 'prompt', 'workdir', 'agent', 'assistantId', 'enabled', 'includeProjectReferences', 'projectReferenceNames'] as const) {
        if (Object.prototype.hasOwnProperty.call(body, key)) input[key] = body[key];
      }
    }
    const automation = updateAutomationRule(c.req.param('automationId'), input);
    return c.json({ ok: true, automation });
  } catch (e: any) {
    const status = e?.message === 'automation not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/automations/:automationId', (c) => {
  try {
    const automation = deleteAutomationRule(c.req.param('automationId'));
    return c.json({ ok: true, automation });
  } catch (e: any) {
    const status = e?.message === 'automation not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/automations/:automationId/run', async (c) => {
  try {
    const automation = listAutomationRules().find(item => item.id === c.req.param('automationId'));
    if (!automation) return c.json({ ok: false, error: 'automation not found' }, 404);
    const { queued, updated } = await queueAutomationRule(automation);
    if (!queued.ok) {
      const statusCode = (queued as any).code === 'usage_budget_paused' ? 429 : queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, automation: updated, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/jira/mcp-sync/run', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config = loadUserConfig();
    const assistantId = readString(body?.assistantId) || getJiraWorkflowConfig().ticketSyncAssistantId;
    const assistant = assistantId ? listAgentAssistants().find(item => item.id === assistantId) : undefined;
    const agent = pickAssistantAgent(assistant, readString(body?.agent) || null);
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const run = createJiraSyncRun({ assistantId, assistantName: assistant?.name, agent, workdir });
    updateJiraSyncRun(run.id, {
      status: 'starting',
      event: {
        label: `Using ${assistant?.name || 'selected assistant'}`,
        detail: `Agent: ${agent || runtime.getRuntimeDefaultAgent(config)} · Workdir: ${workdir}`,
      },
    });
    const queued = await queueDashboardSessionTask({
      workdir,
      agent,
      sessionId: '',
      prompt: buildAssistantPrompt(buildJiraMcpSyncPrompt(run.id), assistant),
      attachments: [],
    });
    if (!queued.ok) {
      updateJiraSyncRun(run.id, {
        status: 'failed',
        error: queued.error,
        event: { label: 'Failed to start sync session', detail: queued.error },
      });
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const updated = updateJiraSyncRun(run.id, {
      status: 'queued',
      sessionKey: queued.sessionKey,
      event: { label: 'Agent session queued', detail: queued.sessionKey || queued.taskId || 'Queued' },
    });
    return c.json({ ok: true, queued, run: updated });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/jira/analyze-ticket/prompt', (c) => {
  try {
    const result = getAnalyzeTicketPrompt();
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.patch('/api/pro/jira/analyze-ticket/prompt', async (c) => {
  try {
    const body = await c.req.json();
    const result = updateAnalyzeTicketPrompt({ prompt: body?.prompt });
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/jira/analyze-ticket/prompt/reset', (c) => {
  try {
    const result = resetAnalyzeTicketPrompt();
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/jira/analyze-ticket', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = parseJiraTicketQuery(body?.query);
    if (!parsed) return c.json({ ok: false, error: 'query is required' }, 400);
    const config = loadUserConfig();
    const jiraConfig = getJiraWorkflowConfig();
    const fallbackWorkdir = runtime.getRequestWorkdir(config);
    let issue: Awaited<ReturnType<typeof fetchJiraIssueFromMcp>>['issue'] | null = null;
    let issueLookupError: string | undefined;
    if (parsed.jiraKey) {
      try {
        const fetched = await fetchJiraIssueFromMcp(parsed.jiraKey);
        issue = fetched.issue;
      } catch (error: any) {
        issueLookupError = error?.message || String(error);
      }
    }
    const workdirResolution = resolveWorkdirForJiraAnalyze({
      jiraKey: parsed.jiraKey || issue?.jiraKey,
      issue,
      query: parsed.query,
      fallbackWorkdir,
      workspaces: loadWorkspaces(),
      routes: jiraConfig.jiraWorkspaceRoutes,
    });
    const workdir = readString(body?.workdir) || workdirResolution.workdir || fallbackWorkdir;
    const agent = readString(body?.agent) || null;
    const promptTemplate = getAnalyzeTicketPrompt().prompt;
    const prompt = buildAnalyzeTicketPrompt(promptTemplate, parsed.query, {
      jiraKey: parsed.jiraKey || issue?.jiraKey,
      issueSummary: issue?.title || issue?.summary,
      workdirResolution: { ...workdirResolution, workdir },
    });
    const taskTitle = issue?.title || issue?.summary || parsed.jiraKey || parsed.query.slice(0, 120);
    const task = upsertAnalyzeTicketTask({
      title: taskTitle,
      description: issue?.description || undefined,
      kind: issueKindFromType(issue?.issueType),
      workdir,
      jiraKey: parsed.jiraKey || issue?.jiraKey,
      jiraUrl: parsed.jiraUrl || issue?.jiraUrl,
    });
    const assistantId = jiraConfig.refinementAssistantId;
    const queued = await queueDashboardSessionTask({
      workdir,
      agent,
      sessionId: '',
      prompt,
      displayPrompt: `Analyze ${parsed.jiraKey || parsed.query}`,
      attachments: [],
      origin: {
        channel: 'task',
        chatId: task.id,
        chatType: 'refinement',
        sourceMessageId: null,
      },
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const session = parseSessionKey(queued.sessionKey);
    if (!session) return c.json({ ok: false, error: 'analyze session was not created' }, 500);
    const updated = addStageRun({
      taskId: task.id,
      stage: 'refinement',
      prompt,
      session: { workdir, agent: session.agent, sessionId: session.sessionId },
      assistantId,
      selectedAgentReason: 'Ticket analyze flow uses the Pikiclaw runtime default agent.',
    });
    return c.json({
      ok: true,
      task: updated,
      queued,
      workdirResolution: { ...workdirResolution, workdir },
      issueLookupError,
      session: { workdir, agent: session.agent, sessionId: session.sessionId },
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/jira/sync-ticket', async (c) => {
  try {
    const body = await c.req.json();
    const query = readString(body?.query || body?.jiraKey || body?.ticket);
    const jiraKey = resolveJiraIssueKeyInput(query, body?.projectKey || body?.projectKeyHint);
    if (!jiraKey) {
      return c.json({ ok: false, error: 'Enter a Jira key/link, or provide a project key for ticket numbers.' }, 400);
    }
    const config = loadUserConfig();
    const existing = listProTasks().find(task => task.jiraKey?.toLowerCase() === jiraKey.toLowerCase()) || null;
    const pulled = await fetchJiraIssueFromMcp(jiraKey);
    const task = syncJiraTask({
      ...pulled.issue,
      jiraKey: pulled.issue.jiraKey || jiraKey,
      workdir: readString(body?.workdir) || runtime.getRequestWorkdir(config),
      spaceId: readString(body?.spaceId) || undefined,
    });
    return c.json({
      ok: true,
      task,
      issueKey: task.jiraKey || jiraKey,
      action: existing ? 'updated' : 'created',
      source: pulled.source,
      tried: pulled.tried,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/jira/mcp-sync/runs', (c) => {
  return c.json({ ok: true, runs: listJiraSyncRuns() });
});

app.get('/api/pro/jira/mcp-sync/runs/:runId', (c) => {
  const run = getJiraSyncRun(c.req.param('runId'));
  if (!run) return c.json({ ok: false, error: 'jira sync run not found' }, 404);
  return c.json({ ok: true, run });
});

app.post('/api/pro/jira/mcp-sync/runs/:runId/stop', (c) => {
  try {
    const run = getJiraSyncRun(c.req.param('runId'));
    if (!run) return c.json({ ok: false, error: 'jira sync run not found' }, 404);
    const stopped = stopJiraSyncRun(run.id, 'Stopped from Jira sync panel.');
    const sessionKey = stopped.sessionKey || run.sessionKey;
    if (sessionKey) runtime.getBotRef()?.stopAllSessionTasks(sessionKey);
    return c.json({ ok: true, run: stopped });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/jira/mcp-sync/runs/:runId/apply', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const run = applyJiraSyncRunItems(c.req.param('runId'), Array.isArray(body?.itemIds) ? body.itemIds : []);
    return c.json({ ok: true, run });
  } catch (e: any) {
    const status = e?.message === 'jira sync run not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/jira/mcp-sync/schedule', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const schedule = readString(body?.schedule);
    if (!schedule || !parseSchedule(schedule)) return c.json({ ok: false, error: 'valid schedule is required' }, 400);
    const assistantId = readString(body?.assistantId) || getJiraWorkflowConfig().ticketSyncAssistantId;
    const automation = upsertAutomationRuleByKey(JIRA_MCP_SYNC_AUTOMATION_KEY, {
      name: 'Jira MCP sync',
      schedule,
      prompt: buildJiraMcpSyncPrompt(),
      workdir: readString(body?.workdir) || runtime.getRequestWorkdir(config),
      assistantId,
      enabled: body?.enabled !== false,
    });
    return c.json({ ok: true, automation });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.get('/api/pro/knowledge', (c) => {
  const query = c.req.query();
  return c.json({
    ok: true,
    knowledge: listKnowledgeEntries({
      query: query.query || query.q,
      tag: query.tag,
      sourceType: query.sourceType,
      workspace: query.workspace || query.workdir,
      status: query.status,
      kind: query.kind,
    }),
  });
});

app.post('/api/pro/knowledge', async (c) => {
  try {
    const body = await c.req.json();
    const entry = createKnowledgeEntry({
      title: body?.title,
      body: body?.body,
      kind: body?.kind,
      status: body?.status,
      summary: body?.summary,
      source: body?.source,
      sourceRefs: body?.sourceRefs,
      artifactRefs: body?.artifactRefs,
      confidence: body?.confidence,
      createdBy: body?.createdBy,
      tags: body?.tags,
    });
    return c.json({ ok: true, entry });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/knowledge/import-project-references', async (c) => {
  try {
    const body = await c.req.json();
    const result = importProjectReferencesAsKnowledge({
      workdir: readString(body?.workdir),
      status: body?.status,
      maxFiles: body?.maxFiles,
    });
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/knowledge/:id/source-refresh', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = refreshKnowledgeEntrySources(c.req.param('id'), {
      acceptCurrent: Boolean(body?.acceptCurrent),
    });
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/knowledge/:id', async (c) => {
  try {
    const body = await c.req.json();
    const entry = updateKnowledgeEntry(c.req.param('id'), {
      title: body?.title,
      body: body?.body,
      kind: body?.kind,
      status: body?.status,
      summary: body?.summary,
      tags: body?.tags,
      confidence: body?.confidence,
      sourceRefs: body?.sourceRefs,
      artifactRefs: body?.artifactRefs,
    });
    return c.json({ ok: true, entry });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.delete('/api/pro/knowledge/:id', async (c) => {
  try {
    const hard = c.req.query('hard') === '1' || c.req.query('hard') === 'true';
    const entry = deleteKnowledgeEntry(c.req.param('id'), { hard });
    return c.json({ ok: true, entry });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/skill-quick-setup', async (c) => {
  try {
    const body = await c.req.json();
    const repo = readString(body?.repo);
    if (!repo) return c.json({ ok: false, error: 'repo is required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const prompt = [
      'Quick setup this GitHub project for me.',
      '',
      `Repository: ${repo}`,
      '',
      'Requirements:',
      '- Inspect the repository README and install/setup docs.',
      '- Clone or use the repository as appropriate inside this workspace.',
      '- Install required dependencies with the safest package manager implied by the repo.',
      '- Run the documented validation command or the closest local smoke test.',
      '- Report exact commands executed, files changed, and anything that still needs manual credentials.',
    ].join('\n');
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: readString(body?.agent) || null,
      sessionId: '',
      prompt,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.post('/api/pro/skill-command', async (c) => {
  try {
    const body = await c.req.json();
    const command = readString(body?.command);
    const environment = readString(body?.environment);
    const subject = readString(body?.subject);
    if (!['test', 'login', 'create-account'].includes(command)) {
      return c.json({ ok: false, error: 'unsupported command' }, 400);
    }
    if (!environment) return c.json({ ok: false, error: 'environment is required' }, 400);
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || runtime.getRequestWorkdir(config);
    const displayCommand = command === 'create-account' ? 'create account' : command;
    const slashCommand = command === 'create-account'
      ? `/create ${environment} account`
      : `/${command} ${environment}${subject ? ` ${subject}` : ''}`;
    const prompt = [
      `Execute Pikiclaw skill command: ${slashCommand}`,
      '',
      `Action: ${displayCommand}`,
      `Environment: ${environment}`,
      subject ? `Subject: ${subject}` : '',
      '',
      'Requirements:',
      '- Use the managed browser/profile if login or UI validation is needed.',
      '- For test, open the target environment, validate the requested flow, and summarize the result/status.',
      '- For login, open the environment and complete or verify login state.',
      '- For create account, prepare the account flow and report the created account handoff without exposing secrets in logs.',
      '- When the browser is closed or the flow finishes, return a concise execution result that can update the task/test state.',
    ].filter(Boolean).join('\n');
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: readString(body?.agent) || null,
      sessionId: '',
      prompt,
      attachments: [],
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/tasks/:taskId', (c) => {
  const task = getProTask(c.req.param('taskId'));
  if (!task) return c.json({ ok: false, error: 'task not found' }, 404);
  return c.json({ ok: true, task });
});

app.get('/api/pro/tasks/:taskId/workbench', (c) => {
  const workbench = getProTaskWorkbench(c.req.param('taskId'));
  if (!workbench) return c.json({ ok: false, error: 'task not found' }, 404);
  return c.json({
    ok: true,
    workbench: enrichWorkbenchSideChats(workbench, (workdir, agent, sessionId) => (
      findPikiclawSessionInfo(workdir, agent as Agent, sessionId)
    )),
  });
});

app.delete('/api/pro/tasks/:taskId', (c) => {
  try {
    const task = deleteProTask(c.req.param('taskId'));
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/reset', (c) => {
  try {
    const task = resetProTask(c.req.param('taskId'));
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const task = createProTask({
      title: body?.title,
      description: body?.description,
      kind: body?.kind,
      status: body?.status,
      plannedDate: body?.plannedDate,
      linkedTaskId: body?.linkedTaskId,
      spaceId: body?.spaceId,
      origin: body?.origin,
      workdir: body?.workdir || runtime.getRequestWorkdir(config),
      defaultAgent: body?.defaultAgent,
      defaultAssistantId: body?.defaultAssistantId,
      jiraKey: body?.jiraKey,
      jiraUrl: body?.jiraUrl,
      prUrl: body?.prUrl,
      sprint: body?.sprint,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/jira/sync', async (c) => {
  try {
    const body = await c.req.json();
    const config = loadUserConfig();
    const issues = readString(body?.baseUrl) && readString(body?.token)
      ? await fetchJiraIssues({
          baseUrl: body.baseUrl,
          token: body.token,
          jql: body.jql,
          email: body.email,
          sprint: body.sprint,
          workdir: body.workdir || runtime.getRequestWorkdir(config),
        })
      : Array.isArray(body?.issues)
      ? body.issues
      : [{
        title: body?.title,
        description: body?.description,
        issueType: body?.issueType,
        jiraKey: body?.jiraKey,
        jiraUrl: body?.jiraUrl,
        prUrl: body?.prUrl || body?.mergeRequestUrl,
        sprint: body?.sprint,
        spaceId: body?.spaceId,
        workdir: body?.workdir,
        reporter: body?.reporter,
        assignee: body?.assignee,
        ticketStatus: body?.ticketStatus || body?.status,
        dueDate: body?.dueDate,
        priority: body?.priority,
        labels: body?.labels,
        updatedAt: body?.updatedAt || body?.updated,
        rawFields: mergeJiraRawFields(body),
      }];
    const tasks = issues.map((issue: any) => syncJiraTask({
      title: issue?.title,
      description: issue?.description,
      issueType: issue?.issueType,
      jiraKey: issue?.jiraKey,
      jiraUrl: issue?.jiraUrl,
      sprint: issue?.sprint,
      spaceId: issue?.spaceId || body?.spaceId,
      workdir: issue?.workdir || runtime.getRequestWorkdir(config),
      prUrl: issue?.prUrl || issue?.mergeRequestUrl,
      reporter: issue?.reporter,
      assignee: issue?.assignee,
      ticketStatus: issue?.ticketStatus || issue?.status,
      dueDate: issue?.dueDate,
      fixVersion: issue?.fixVersion,
      fixVersions: issue?.fixVersions,
      priority: issue?.priority,
      labels: Array.isArray(issue?.labels) ? issue.labels : undefined,
      updatedAt: issue?.updatedAt || issue?.updated,
      rawFields: mergeJiraRawFields(issue),
    }));
    return c.json({ ok: true, tasks });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.patch('/api/pro/tasks/:taskId/status', async (c) => {
  try {
    const body = await c.req.json();
    const status = readString(body?.status);
    if (!isProTaskStatus(status)) return c.json({ ok: false, error: 'invalid status' }, 400);
    const task = updateProTaskStatus(c.req.param('taskId'), status);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/jira-fields', async (c) => {
  try {
    const body = await c.req.json();
    const task = updateJiraFields(c.req.param('taskId'), body || {});
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/jira-sync', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const task = getProTask(taskId);
    if (!task) return c.json({ ok: false, error: 'task not found' }, 404);
    if (!task.jiraKey) return c.json({ ok: false, error: 'task is not linked to a Jira ticket' }, 400);
    const config = loadUserConfig();
    const pulled = await fetchJiraIssueFromMcp(task.jiraKey);
    const synced = syncJiraTask({
      ...pulled.issue,
      jiraKey: task.jiraKey,
      jiraUrl: pulled.issue.jiraUrl || task.jiraUrl,
      spaceId: task.spaceId,
      workdir: task.workdir || runtime.getRequestWorkdir(config),
      prUrl: task.prUrl,
    });
    return c.json({ ok: true, task: synced, source: pulled.source, tried: pulled.tried });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.get('/api/pro/jira/remote-updates', (c) => {
  const taskId = readString(c.req.query('taskId'));
  return c.json({ ok: true, runs: listJiraRemoteUpdateRuns(taskId || undefined) });
});

app.post('/api/pro/tasks/:taskId/jira-remote-updates', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const task = getProTask(taskId);
    if (!task) return c.json({ ok: false, error: 'task not found' }, 404);
    if (!task.jiraKey) return c.json({ ok: false, error: 'task is not linked to a Jira ticket' }, 400);
    const body = await c.req.json();
    const currentFields = {
      status: task.jiraFields?.status,
      fixVersions: task.jiraFields?.fixVersions,
      sprint: task.sprint,
      dueDate: task.jiraFields?.dueDate,
    };
    const run = createJiraRemoteUpdateRun({
      taskId,
      jiraKey: task.jiraKey,
      jiraUrl: task.jiraUrl,
      currentFields,
      fields: body?.fields || body,
    });
    return c.json({ ok: true, run });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

app.post('/api/pro/jira/remote-updates/:runId/apply', async (c) => {
  const runId = c.req.param('runId');
  try {
    const existing = getJiraRemoteUpdateRun(runId);
    if (!existing) return c.json({ ok: false, error: 'jira remote update run not found' }, 404);
    if (existing.status === 'applied') return c.json({ ok: false, error: 'jira update already applied' }, 400);
    if (existing.status === 'cancelled') return c.json({ ok: false, error: 'cancelled jira update cannot be applied' }, 400);
    const applying = updateJiraRemoteUpdateRun(runId, {
      status: 'applying',
      event: { label: 'Applying Jira update', detail: existing.diff.map(item => item.field).join(', ') },
    });
    const applied = await applyJiraRemoteUpdate(applying);
    const localPatch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(applying.fields, 'status')) localPatch.status = applying.fields.status;
    if (Object.prototype.hasOwnProperty.call(applying.fields, 'sprint')) localPatch.sprint = applying.fields.sprint;
    if (Object.prototype.hasOwnProperty.call(applying.fields, 'dueDate')) localPatch.dueDate = applying.fields.dueDate;
    if (Object.prototype.hasOwnProperty.call(applying.fields, 'fixVersions')) localPatch.fixVersions = applying.fields.fixVersions;
    const task = updateJiraFields(applying.taskId, localPatch);
    const run = updateJiraRemoteUpdateRun(runId, {
      status: 'applied',
      remoteTool: applied.remoteTool,
      event: { label: 'Jira update applied', detail: applied.remoteTool },
    });
    return c.json({ ok: true, run, task });
  } catch (e: any) {
    const message = e?.message || String(e);
    let run = getJiraRemoteUpdateRun(runId);
    if (run) {
      run = updateJiraRemoteUpdateRun(runId, {
        status: 'failed',
        error: message,
        event: { label: 'Jira update failed', detail: message },
      });
    }
    return c.json({ ok: false, error: message, run }, 400);
  }
});

app.post('/api/pro/jira/remote-updates/:runId/cancel', (c) => {
  try {
    const run = cancelJiraRemoteUpdateRun(c.req.param('runId'));
    return c.json({ ok: true, run });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/exclusive-mode', async (c) => {
  try {
    const body = await c.req.json();
    const task = setExclusiveMode(c.req.param('taskId'), !!body?.enabled);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/execution', async (c) => {
  try {
    const body = await c.req.json();
    const task = updateProTaskExecution(c.req.param('taskId'), {
      ownerMode: body?.ownerMode,
      agent: body?.agent,
      assistantId: body?.assistantId,
      defaultAssistantId: body?.defaultAssistantId,
      mode: body?.mode,
      model: body?.model,
      effort: body?.effort,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/cycle', async (c) => {
  try {
    const body = await c.req.json();
    const task = updateProTaskCycle(c.req.param('taskId'), { cycleId: body?.cycleId });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/meta', async (c) => {
  try {
    const body = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (body && Object.prototype.hasOwnProperty.call(body, 'workdir')) patch.workdir = body.workdir;
    if (body && Object.prototype.hasOwnProperty.call(body, 'prUrl')) patch.prUrl = body.prUrl;
    if (body && Object.prototype.hasOwnProperty.call(body, 'plannedDate')) patch.plannedDate = body.plannedDate;
    if (body && Object.prototype.hasOwnProperty.call(body, 'linkedTaskId')) patch.linkedTaskId = body.linkedTaskId;
    let task = updateProTaskMeta(c.req.param('taskId'), patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'plannedDate') && !patch.plannedDate) {
      const reverted = revertDailyItemTaskForTask(c.req.param('taskId'));
      task = getProTask(c.req.param('taskId')) || task;
      return c.json({ ok: true, task, dailyItem: reverted });
    }
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/source-evidence', async (c) => {
  try {
    const body = await c.req.json();
    const task = appendProTaskSourceEvidence(c.req.param('taskId'), {
      kind: body?.kind,
      value: body?.value,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/background', async (c) => {
  try {
    const body = await c.req.json();
    const task = updateTaskBackground(c.req.param('taskId'), {
      summary: body?.summary,
      source: body?.source,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/focus-sessions', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const task = startUserFocusSession(c.req.param('taskId'), { source: body?.source });
    const focusSession = task.focusSessions?.[0];
    return c.json({ ok: true, task, focusSession });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/focus-sessions/:focusSessionId', async (c) => {
  try {
    const task = finishUserFocusSession(c.req.param('taskId'), c.req.param('focusSessionId'));
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/stage-runs', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const task = getProTask(taskId);
    if (!task) return c.json({ ok: false, error: 'task not found' }, 404);

    const body = await c.req.json();
    const stage = readString(body?.stage);
    if (!isProTaskStage(stage)) return c.json({ ok: false, error: 'invalid stage' }, 400);

    const assistantId = readString(body?.assistantId) || task.execution?.assistantId || task.defaultAssistantId || undefined;
    const assistant = assistantId ? listAgentAssistants().find(item => item.id === assistantId) : undefined;
    const config = loadUserConfig();
    const workdir = readString(body?.workdir) || task.workdir || runtime.getRequestWorkdir(config);
    const prompt = withExecutionModeInstruction(
      readString(body?.prompt) || buildDefaultStagePrompt(task, stage, assistant),
      readString(body?.executionMode) || task.execution?.mode || 'direct',
    );
    const requestedAgent = readString(body?.agent) || task.execution?.agent || task.defaultAgent || assistant?.preferredAgents?.[0] || null;
    const displayPrompt = readString(body?.displayPrompt) || undefined;
    const queued = await queueDashboardSessionTask({
      workdir,
      agent: requestedAgent,
      sessionId: '',
      prompt,
      displayPrompt,
      model: readString(body?.model) || null,
      effort: readString(body?.effort) || null,
      attachments: [],
      origin: {
        channel: 'task',
        chatId: taskId,
        chatType: stage,
        sourceMessageId: typeof body?.subtaskId === 'string' ? body.subtaskId : null,
      },
    });
    if (!queued.ok) {
      const statusCode = queued.error === 'Bot is not running' ? 503 : 400;
      return c.json(queued, statusCode);
    }
    const session = parseSessionKey(queued.sessionKey);
    if (!session) return c.json({ ok: false, error: 'stage session was not created' }, 500);

    const updated = addStageRun({
      taskId,
      subtaskId: body?.subtaskId,
      stage,
      prompt,
      displayPrompt,
      session: { workdir, agent: session.agent, sessionId: session.sessionId },
      assistantId,
      selectedAgentReason: requestedAgent
        ? assistant
          ? `Selected by ${assistant.name}.`
          : 'Selected by task default or user stage setting.'
        : 'Selected by Pikiclaw runtime default agent.',
    });
    return c.json({ ok: true, task: updated, queued });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.patch('/api/pro/tasks/:taskId/stage-runs/:stageRunId', async (c) => {
  try {
    const body = await c.req.json();
    const status = readString(body?.status);
    const task = updateStageRun(c.req.param('taskId'), c.req.param('stageRunId'), {
      ...(status ? { status: status as any } : {}),
      session: body?.session && typeof body.session === 'object' ? {
        workdir: readString(body.session.workdir),
        agent: readString(body.session.agent),
        sessionId: readString(body.session.sessionId),
      } : undefined,
      summary: body?.summary,
      estimate: body?.estimate,
      branch: body?.branch,
      diffSummary: body?.diffSummary,
      changedFiles: Array.isArray(body?.changedFiles) ? body.changedFiles : undefined,
      testResultId: body?.testResultId,
      knowledgeRefs: Array.isArray(body?.knowledgeRefs) ? body.knowledgeRefs : undefined,
      focus: body?.focus,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/stage-runs/:stageRunId/confirm-output', async (c) => {
  try {
    const task = confirmStageRunOutput(c.req.param('taskId'), c.req.param('stageRunId'), { actor: 'user' });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/subtasks', async (c) => {
  try {
    const body = await c.req.json();
    const task = createSubtask(c.req.param('taskId'), {
      title: body?.title,
      description: body?.description,
      status: body?.status,
      assignedAgent: body?.assignedAgent,
      assistantId: body?.assistantId,
      workdir: body?.workdir,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/subtasks/:subtaskId', async (c) => {
  try {
    const body = await c.req.json();
    const rawStatus = readString(body?.status);
    if (rawStatus && !isProSubtaskStatus(rawStatus)) return c.json({ ok: false, error: 'invalid subtask status' }, 400);
    const task = updateSubtask(c.req.param('taskId'), c.req.param('subtaskId'), {
      title: body?.title,
      description: body?.description,
      status: body?.status,
      assignedAgent: body?.assignedAgent,
      assistantId: body?.assistantId,
      workdir: body?.workdir,
      stageRunId: body?.stageRunId,
    });
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/tasks/:taskId/verification-runs', async (c) => {
  try {
    const body = await c.req.json();
    const task = startVerificationRun(c.req.param('taskId'), {
      environment: body?.environment,
      url: body?.url,
      stageRunId: body?.stageRunId,
      pipeline: body?.pipeline,
    });
    const latest = task.verificationRuns[0];
    return c.json({ ok: true, task, verificationRun: latest });
  } catch (e: any) {
    const status = e?.message === 'task not found' ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.patch('/api/pro/tasks/:taskId/verification-runs/:verificationRunId', async (c) => {
  try {
    const body = await c.req.json();
    const rawResult = readString(body?.result);
    const result = isVerificationResult(rawResult) ? rawResult : 'not-run';
    const task = finishVerificationRun(c.req.param('taskId'), c.req.param('verificationRunId'), result, body?.notes);
    return c.json({ ok: true, task });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 400;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

function isVerificationResult(value: string): value is VerificationResult {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'not-run';
}

app.post('/api/pro/browser-sessions', async (c) => {
  try {
    const body = await c.req.json();
    const url = readString(body?.url);
    if (!url) return c.json({ ok: false, error: 'url is required' }, 400);
    const snapshot = await createBrowserPanelSession(url);
    return c.json({ ok: true, snapshot });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/pro/browser-sessions/:sessionId', async (c) => {
  try {
    const snapshot = await snapshotBrowserPanelSession(c.req.param('sessionId'));
    return c.json({ ok: true, snapshot });
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 500;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.post('/api/pro/browser-sessions/:sessionId/actions', async (c) => {
  try {
    const body = await c.req.json();
    const action = readString(body?.action);
    const sessionId = c.req.param('sessionId');
    if (action === 'navigate') {
      const url = readString(body?.url);
      if (!url) return c.json({ ok: false, error: 'url is required' }, 400);
      return c.json({ ok: true, snapshot: await navigateBrowserPanelSession(sessionId, url) });
    }
    if (action === 'reload') return c.json({ ok: true, snapshot: await reloadBrowserPanelSession(sessionId) });
    if (action === 'click') {
      return c.json({
        ok: true,
        snapshot: await clickBrowserPanelSession(sessionId, Number(body?.xRatio || 0), Number(body?.yRatio || 0)),
      });
    }
    if (action === 'type') {
      return c.json({ ok: true, snapshot: await typeBrowserPanelSession(sessionId, String(body?.text || '')) });
    }
    return c.json({ ok: false, error: 'unsupported browser action' }, 400);
  } catch (e: any) {
    const status = e?.message?.includes('not found') ? 404 : 500;
    return c.json({ ok: false, error: e?.message || String(e) }, status);
  }
});

app.delete('/api/pro/browser-sessions/:sessionId', async (c) => {
  await closeBrowserPanelSession(c.req.param('sessionId'));
  return c.json({ ok: true });
});

async function fetchJiraIssues(opts: {
  baseUrl: string;
  token: string;
  email?: string;
  jql?: string;
  sprint?: string;
  workdir?: string;
}) {
  const baseUrl = readString(opts.baseUrl).replace(/\/+$/, '');
  const token = readString(opts.token);
  if (!baseUrl || !token) throw new Error('baseUrl and token are required');
  const params = new URLSearchParams();
  params.set('jql', readString(opts.jql) || 'assignee = currentUser() ORDER BY updated DESC');
  params.set('maxResults', '50');
  params.set('fields', 'summary,description,issuetype,assignee,reporter,status,duedate,priority,labels,updated');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const email = readString(opts.email);
  headers.Authorization = email
    ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
    : `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/rest/api/3/search?${params.toString()}`, { headers });
  if (!response.ok) {
    throw new Error(`Jira sync failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { issues?: any[] };
  return (payload.issues || []).map(issue => ({
    jiraKey: issue?.key,
    jiraUrl: issue?.key ? `${baseUrl}/browse/${issue.key}` : undefined,
    title: issue?.fields?.summary || issue?.key || 'Untitled Jira issue',
    description: jiraDescriptionToText(issue?.fields?.description),
    issueType: issue?.fields?.issuetype?.name,
    reporter: issue?.fields?.reporter?.displayName || issue?.fields?.reporter?.name || issue?.fields?.reporter?.emailAddress,
    assignee: issue?.fields?.assignee?.displayName || issue?.fields?.assignee?.name || issue?.fields?.assignee?.emailAddress,
    ticketStatus: issue?.fields?.status?.name,
    dueDate: issue?.fields?.duedate,
    priority: issue?.fields?.priority?.name,
    labels: Array.isArray(issue?.fields?.labels) ? issue.fields.labels : undefined,
    updatedAt: issue?.fields?.updated,
    rawFields: issue?.fields,
    sprint: opts.sprint,
    workdir: opts.workdir,
  }));
}

function jiraDescriptionToText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const chunks: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') chunks.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };
  visit(value);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function buildDefaultStagePrompt(task: NonNullable<ReturnType<typeof getProTask>>, stage: string, assistant?: ReturnType<typeof listAgentAssistants>[number]): string {
  const outputRule = 'When you produce a durable background, plan, clarification, implementation analysis, test cases, or report, treat it as a draft for the current stage. Stage output artifacts such as wiki/document/report should default to Chinese unless the user explicitly asks for another language; ordinary chat replies may naturally follow the user language. The user may discuss and revise it in chat; Pikiclaw will save it as a formal ticket output only after the user clicks Confirm output.';
  const workflowRule = 'Do not force every task through one fixed workflow. Choose the next useful phase from the ticket type, prompt, existing outputs, and latest stage result. After finishing a phase, proactively offer next actions such as discuss questions, confirm the current draft as the formal output, move to the next phase, skip an unnecessary phase, or collect testing evidence.';
  const common = [
    assistant ? `Assistant: ${assistant.name}\nResponsibility:\n${assistant.responsibility}` : '',
    `Task: ${task.title}`,
    task.jiraKey ? `Jira: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.description ? `Description:\n${task.description}` : '',
    task.subTasks?.length
      ? `Subtasks:\n${task.subTasks.map((subtask, index) => `${index + 1}. [${subtask.status}] ${subtask.title}${subtask.assignedAgent ? ` (agent: ${subtask.assignedAgent})` : ''}`).join('\n')}`
      : 'Subtasks: none yet. If the work naturally spans multiple projects or independent streams, propose subtasks with title, scope, recommended agent/assistant, and dependencies.',
    workflowRule,
  ].filter(Boolean).join('\n\n');

  if (stage === 'focus') {
    return `${common}\n\nEnter Focus Mode. Discuss the requirement with me before coding. Keep asking for goal, boundary, constraints, risks, and acceptance criteria until they are clear. Maintain a concise mind-map outline in markdown with nodes for Goal, Scope, Non-goals, Constraints, Risks, Acceptance Criteria, Open Questions, and Plan. End with an estimated completion time split into coding, user understanding, review, and verification time.\n\n${outputRule}`;
  }
  if (stage === 'refinement') {
    return `${common}\n\nRefine this task. Analyze goal, scope, risks, dependencies, acceptance criteria, implementation approach, estimate point, and estimated completion time split into coding, user understanding, review, and verification time. Do not modify files yet. Produce a Background or Clarification document when the understanding is stable.\n\n${outputRule}`;
  }
  if (stage === 'coding') {
    return `${common}\n\nImplement this task with minimal changes. After coding, summarize branch/status, changed files, tests run, remaining uncertainty, and verification steps. If coding happened elsewhere, analyze the branch/MR instead of modifying files and produce an Implementation / MR Analysis document.\n\n${outputRule}`;
  }
  if (stage === 'verification' || stage === 'demo') {
    return `${common}\n\nPrepare ${stage} for this task. Identify the target environment, deployment/pipeline checks needed, browser entry URL if known, login assumptions, and the manual steps I should verify. Produce Test Cases before manual execution and a Test Report after evidence is provided. Do not proceed with destructive actions.\n\n${outputRule}`;
  }
  if (stage === 'bugfix') {
    return `${common}\n\nAnalyze the reported bug, identify likely root cause, propose a minimal fix, implement it if enough evidence is available, and summarize verification steps.`;
  }
  return `${common}\n\nWork on the ${stage} stage for this task and summarize the result.`;
}

function withExecutionModeInstruction(prompt: string, mode: string): string {
  const instruction = mode === 'interactive'
    ? 'Execution mode: user-intervention. Continue autonomously when possible, but if a decision, missing requirement, credential, environment, or risky tradeoff blocks progress, ask the user for input and wait before continuing.'
    : 'Execution mode: direct. Do not ask the user for routine input. Make reasonable assumptions, proceed autonomously, solve the task end to end, and only stop for genuinely unsafe or impossible actions.';
  return `${instruction}\n\n${prompt}`;
}

export default app;
