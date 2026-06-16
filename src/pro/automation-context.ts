import fs from 'node:fs';
import path from 'node:path';
import type { SessionContextSource } from '../agent/types.js';

const MAX_AUTOMATION_REFERENCE_SOURCES = 20;
const DEFAULT_TASK_NAME = 'Scheduled task';
const DEFAULT_SCHEDULE = 'manual';

export function collectAutomationContextSources(input: {
  workdir?: string | null;
  includeProjectReferences?: boolean | null;
  projectReferenceNames?: unknown;
}): SessionContextSource[] {
  if (input.includeProjectReferences !== true) return [];
  const workdir = typeof input.workdir === 'string' ? input.workdir.trim() : '';
  if (!workdir) return [];
  const selectedNames = Array.isArray(input.projectReferenceNames)
    ? new Set(input.projectReferenceNames
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean))
    : null;
  if (selectedNames && selectedNames.size === 0) return [];

  const resolvedWorkdir = path.resolve(workdir);
  const referenceDir = path.join(resolvedWorkdir, '.pikiclaw', 'reference');
  if (!fs.existsSync(referenceDir)) return [];

  try {
    return fs.readdirSync(referenceDir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .filter(entry => !selectedNames || selectedNames.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_AUTOMATION_REFERENCE_SOURCES)
      .map(entry => ({
        kind: 'file' as const,
        workdir: resolvedWorkdir,
        path: path.join(referenceDir, entry.name),
        title: entry.name,
        source: 'project-reference',
      }));
  } catch {
    return [];
  }
}

function cleanLine(value: string | null | undefined, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

export function buildAutomationRunPrompt(input: {
  name?: string | null;
  schedule?: string | null;
  prompt: string;
}): string {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return '';
  if (/^\[Scheduled Task (Context|Execution)\]/.test(prompt)) return prompt;

  const taskName = cleanLine(input.name, DEFAULT_TASK_NAME);
  const schedule = cleanLine(input.schedule, DEFAULT_SCHEDULE);

  return `[Scheduled Task Context]
Task: ${taskName}
Schedule: ${schedule}

Rules:
1. This is a Pikiclaw scheduled task execution, not an ordinary user chat.
2. Execute the task directly; do not ask clarifying questions unless execution is impossible.
3. Focus on producing useful, actionable output.
4. If the task requires external data, use the latest available information and make sources or assumptions explicit.
[/Scheduled Task Context]

${prompt}`;
}
