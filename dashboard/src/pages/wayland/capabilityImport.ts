export type CapabilityImportKind = 'skill' | 'workflow' | 'assistant';
export type CapabilityImportMode = 'auto' | CapabilityImportKind;

export function detectCapabilityImportKind(input: string, mode: CapabilityImportMode = 'auto'): CapabilityImportKind {
  if (mode !== 'auto') return mode;
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Import is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return detectJsonCapability(trimmed);
  return detectMarkdownCapability(trimmed);
}

function detectJsonCapability(input: string): CapabilityImportKind {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Import must be valid JSON or Markdown.');
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || typeof first !== 'object') throw new Error('Import does not contain a capability object.');
  const object = first as Record<string, unknown>;

  if (Array.isArray(object.workflows) || Array.isArray(object.workflowRecipes) || Array.isArray(object.recipes)) return 'workflow';
  if (Array.isArray(object.assistants) || Array.isArray(object.assistantProfiles) || Array.isArray(object.agentProfiles) || Array.isArray(object.profiles)) return 'assistant';
  if (Array.isArray(object.skills) || Array.isArray(object.capabilities)) return 'skill';

  const type = String(object.type || object.kind || object.presetAgentType || '').trim().toLowerCase();
  const typed = kindFromType(type);
  if (typed) return typed;

  if (Array.isArray(object.steps) || typeof object.promptHint === 'string' || typeof object.cadence === 'string') return 'workflow';
  if (typeof object.responsibility === 'string' || Array.isArray(object.preferredAgents) || Array.isArray(object.allowedActions)) return 'assistant';
  if (typeof object.content === 'string' || typeof object.skill === 'string' || typeof object.instructions === 'string') return 'skill';

  throw new Error('Could not detect capability type. Choose Skill, Workflow, or Assistant manually.');
}

function detectMarkdownCapability(input: string): CapabilityImportKind {
  const frontmatter = extractFrontmatter(input);
  const type = firstFrontmatterValue(frontmatter, ['type', 'kind', 'presetAgentType']);
  const typed = kindFromType(type);
  if (typed) return typed;

  if (/^\s{0,3}#{2,6}\s+(?:Steps|Workflow steps|Procedure|Runbook)\s*$/im.test(input)) return 'workflow';
  if (/^\s{0,3}#{2,6}\s+Step\s+\d+/im.test(input)) return 'workflow';
  if (/^\s*(?:[-*]\s*)?\*\*Step\s+\d+/im.test(input)) return 'workflow';
  if (/^\s{0,3}#{2,6}\s+(?:Role|Responsibility|Responsibilities|System prompt|Behavior)\s*$/im.test(input)) return 'assistant';

  return 'skill';
}

function kindFromType(type: string): CapabilityImportKind | null {
  const value = type.trim().toLowerCase();
  if (!value) return null;
  if (value === 'workflow' || value === 'workflow-template' || value === 'recipe') return 'workflow';
  if (value === 'agent-profile' || value === 'assistant' || value === 'specialist' || value === 'team') return 'assistant';
  if (value === 'skill' || value === 'capability') return 'skill';
  return null;
}

function extractFrontmatter(input: string): Record<string, string> {
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return {};
  const result: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) continue;
    result[normalizeKey(match[1])] = unquote(match[2]);
  }
  return result;
}

function firstFrontmatterValue(frontmatter: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = frontmatter[normalizeKey(key)];
    if (value) return value;
  }
  return '';
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
