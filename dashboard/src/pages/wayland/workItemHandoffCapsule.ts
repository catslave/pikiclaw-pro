import type { ProTask, StageRun } from '../../types';
import { summarizeWorkItemDecisionAudit } from './workItemDecisionAuditCommand';
import { summarizeWorkItemOperationalState } from './workItemOperationalState';
import { workItemSourceEvidence } from './workItemSourceEvidence';

export interface WorkItemHandoffCapsule {
  title: string;
  summary: string;
  markdown: string;
  sourceCount: number;
  runCount: number;
  outputCount: number;
  eventCount: number;
  needsDecisionReview: boolean;
  latestRunLabel: string;
  nextActionLabel: string;
}

export interface WorkItemAgentLaunchPromptOptions {
  actionLabel: string;
  actionInstruction: string;
}

type HandoffOutput = {
  id: string;
  title: string;
  summary?: string;
  createdAt: string;
  url?: string;
  path?: string;
};

function compact(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 220): string {
  const text = compact(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

function line(label: string, value: string | undefined | null): string {
  const text = compact(value);
  return text ? `- ${label}: ${text}` : '';
}

function sourceLabel(task: ProTask): string {
  if (task.jiraKey) return task.jiraKey;
  if (task.kind === 'todo') return 'Todo';
  return task.kind || 'Manual';
}

function eventTime(value?: string | null): number {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function latestRun(task: ProTask): StageRun | null {
  return [...(task.stageRuns || [])].sort((a, b) => {
    const left = eventTime(a.completedAt || a.startedAt);
    const right = eventTime(b.completedAt || b.startedAt);
    return right - left;
  })[0] || null;
}

function outputItems(task: ProTask): HandoffOutput[] {
  const direct = (task.outputs || []).map(output => ({
    id: output.id,
    title: output.title,
    summary: output.summary,
    createdAt: output.createdAt,
    url: output.url,
    path: output.path,
  }));
  const stageOutputs = (task.stageRuns || [])
    .filter(run => !!run.output)
    .map(run => ({
      id: `stage:${run.id}`,
      title: `${run.stage} result`,
      summary: run.output?.summary || run.output?.diffSummary || run.output?.changedFiles?.join(', '),
      createdAt: run.completedAt || run.startedAt || task.updatedAt,
    }));
  return [...direct, ...stageOutputs]
    .filter(item => compact(item.title))
    .sort((a, b) => eventTime(b.createdAt) - eventTime(a.createdAt));
}

function outputCount(task: ProTask): number {
  return (task.outputs || []).length + (task.stageRuns || []).filter(run => !!run.output).length;
}

function runLabel(run: StageRun | null): string {
  if (!run) return 'No stage run yet';
  return `${run.stage} · ${run.status}`;
}

function runOwner(run: StageRun | null): string {
  if (!run) return '';
  return compact(run.assistantId || run.selectedAgent || run.session?.agent);
}

export function buildWorkItemHandoffCapsule(task: ProTask): WorkItemHandoffCapsule {
  const operational = summarizeWorkItemOperationalState(task);
  const decisionAudit = summarizeWorkItemDecisionAudit(task);
  const sourceEvidence = workItemSourceEvidence(task);
  const run = latestRun(task);
  const outputs = outputItems(task);
  const recentEvents = [...(task.events || [])].sort((a, b) => eventTime(b.createdAt) - eventTime(a.createdAt));
  const source = sourceLabel(task);
  const latestRunLabel = runLabel(run);
  const nextActionLabel = `${operational.nextActionLabel}: ${operational.nextActionDetail}`;

  const contextLines = [
    line('ID', task.localKey || task.id),
    line('Status', task.status),
    line('Source', source),
    task.jiraUrl ? line('Jira', `${task.jiraKey || 'Ticket'} ${task.jiraUrl}`) : line('Jira', task.jiraKey),
    line('Project', task.workdir),
    line('Owner', operational.ownerLabel),
    line('State', `${operational.stateLabel} · ${operational.guardrailLabel}`),
    line('Next', nextActionLabel),
    decisionAudit.needsReview ? line('Decision audit', decisionAudit.detail) : '',
    line('PR / MR', task.prUrl),
  ].filter(Boolean);

  const sourceLines = sourceEvidence.slice(0, 4).map(item => {
    const detail = [item.value, item.detail].map(clip).filter(Boolean).join(' - ');
    return `- ${item.label}: ${detail}`;
  });

  const runLines = run ? [
    line('Latest run', latestRunLabel),
    line('Run owner', runOwner(run)),
    line('Session', run.session?.sessionId),
    line('Run summary', run.output?.summary || run.output?.diffSummary || run.displayPrompt || run.prompt),
    run.output?.changedFiles?.length ? `- Changed files: ${run.output.changedFiles.slice(0, 6).join(', ')}` : '',
  ].filter(Boolean) : ['- No stage run yet.'];

  const outputLines = outputs.slice(0, 4).map(output => {
    const target = output.url || output.path || '';
    const detail = [output.summary, target].map(item => clip(item || '')).filter(Boolean).join(' - ');
    return `- ${output.title}${detail ? `: ${detail}` : ''}`;
  });

  const eventLines = recentEvents.slice(0, 3).map(event => (
    `- ${event.createdAt}: ${event.actor} ${event.type} - ${clip(event.summary)}`
  ));

  const markdown = [
    '# Work Item Handoff',
    '',
    `## ${task.title}`,
    ...contextLines,
    task.description ? ['', '## Goal / Context', clip(task.description, 1000)] : '',
    sourceLines.length ? ['', '## Source Evidence', ...sourceLines] : '',
    ['', '## Execution', ...runLines],
    outputLines.length ? ['', '## Deliverables', ...outputLines] : '',
    eventLines.length ? ['', '## Recent Timeline', ...eventLines] : '',
  ].flat().filter(lineText => lineText !== '').join('\n');

  return {
    title: 'Handoff capsule',
    summary: `${source} · ${operational.stateLabel} · ${nextActionLabel}`,
    markdown,
    sourceCount: sourceEvidence.length,
    runCount: (task.stageRuns || []).length,
    outputCount: outputCount(task),
    eventCount: recentEvents.length,
    needsDecisionReview: decisionAudit.needsReview,
    latestRunLabel,
    nextActionLabel,
  };
}

export function buildWorkItemAgentLaunchPrompt(task: ProTask, options: WorkItemAgentLaunchPromptOptions): string {
  const capsule = buildWorkItemHandoffCapsule(task);
  const outputs = outputItems(task).slice(0, 4);
  const run = latestRun(task);
  return [
    `Work Item action: ${compact(options.actionLabel)}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Source: ${sourceLabel(task)}`,
    task.jiraKey ? `Ticket: ${task.jiraKey}${task.jiraUrl ? ` (${task.jiraUrl})` : ''}` : '',
    task.workdir ? `Project path: ${task.workdir}` : '',
    task.description ? `Description:\n${task.description}` : '',
    run ? `Latest stage: ${run.stage} · ${run.status}` : '',
    '',
    'Handoff capsule:',
    capsule.markdown,
    outputs.length ? ['', 'Recent deliverables:', ...outputs.map(output => `- ${output.title}${output.summary ? `: ${output.summary}` : ''}`)] : '',
    '',
    compact(options.actionInstruction),
  ].flat().filter(item => item !== '').join('\n');
}
