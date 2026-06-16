import type { AgentAssistant } from '../../types';

export type AssistantImportInput = {
  name: string;
  responsibility: string;
  preferredAgents?: string[];
  kind?: AgentAssistant['kind'];
  surfaceId?: string;
  objectTypes?: string[];
  prompt?: string;
  defaultPrompt?: string;
  allowedActions?: string[];
  labels?: string[];
  enabled?: boolean;
};

type FrontmatterValue = string | string[];
type Frontmatter = Record<string, FrontmatterValue>;

const MAX_NAME = 120;
const MAX_SHORT_TEXT = 1_200;
const MAX_PROMPT = 48_000;

export function parseAssistantImportText(input: string): AssistantImportInput[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Import is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseAssistantImportJson(trimmed);
  return [normalizeImportedAssistantMarkdown(trimmed)];
}

export function parseAssistantImportJson(input: string): AssistantImportInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Import must be valid assistant JSON or SKILL.md markdown.');
  }

  const source = parsed && typeof parsed === 'object' && Array.isArray((parsed as { assistants?: unknown }).assistants)
    ? (parsed as { assistants: unknown[] }).assistants
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { assistantProfiles?: unknown }).assistantProfiles)
      ? (parsed as { assistantProfiles: unknown[] }).assistantProfiles
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { agentProfiles?: unknown }).agentProfiles)
        ? (parsed as { agentProfiles: unknown[] }).agentProfiles
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { profiles?: unknown }).profiles)
          ? (parsed as { profiles: unknown[] }).profiles
          : Array.isArray(parsed)
            ? parsed
            : [parsed];

  if (!source.length) throw new Error('Import does not contain any assistants.');
  return source.map(normalizeImportedAssistantItem);
}

function normalizeImportedAssistantItem(raw: unknown, index: number): AssistantImportInput {
  if (!raw || typeof raw !== 'object') throw new Error(`Assistant #${index + 1} must be an object.`);
  const item = raw as Record<string, unknown>;
  const name = firstNonEmpty([
    importText(item.name, MAX_NAME),
    importText(item.title, MAX_NAME),
    importText(item.displayName, MAX_NAME),
    importText(item.id, MAX_NAME),
  ]);
  if (!name) throw new Error(`Assistant #${index + 1} is missing name.`);

  const responsibility = firstNonEmpty([
    importText(item.responsibility, MAX_SHORT_TEXT),
    importText(item.description, MAX_SHORT_TEXT),
    importText(item.summary, MAX_SHORT_TEXT),
    importText(item.purpose, MAX_SHORT_TEXT),
  ]);
  if (!responsibility) throw new Error(`Assistant "${name}" is missing responsibility or description.`);

  const prompt = firstNonEmpty([
    importText(item.prompt, MAX_PROMPT),
    importText(item.systemPrompt, MAX_PROMPT),
    importText(item.instructions, MAX_PROMPT),
    importText(item.instruction, MAX_PROMPT),
    importText(item.defaultPrompt, MAX_PROMPT),
    responsibility,
  ]);

  return {
    name,
    responsibility,
    preferredAgents: importStringList(firstPresent(item.preferredAgents, item.agents, item.agent, item.backend, item.presetAgentType), 8),
    kind: normalizeImportedKind(item.kind ?? item.type),
    surfaceId: importText(item.surfaceId, 160) || undefined,
    objectTypes: importStringList(firstPresent(item.objectTypes, item.objects, item.surfaces), 16),
    prompt,
    defaultPrompt: importText(item.defaultPrompt, MAX_PROMPT) || prompt,
    allowedActions: importStringList(firstPresent(item.allowedActions, item.actions, item.capabilities, item.tools), 24),
    labels: uniqueItems([...importStringList(firstPresent(item.labels, item.tags), 16), 'imported', 'json-import'], 16),
    enabled: item.enabled !== false,
  };
}

function normalizeImportedAssistantMarkdown(input: string): AssistantImportInput {
  const parsed = splitFrontmatter(input);
  const body = parsed.body.trim();
  const heading = firstMarkdownHeading(body);
  const name = firstNonEmpty([
    frontmatterString(parsed.frontmatter, ['title']),
    heading,
    frontmatterString(parsed.frontmatter, ['name']),
    frontmatterString(parsed.frontmatter, ['id']),
  ]).slice(0, MAX_NAME);
  if (!name) throw new Error('Assistant markdown is missing a title.');

  const responsibility = firstNonEmpty([
    frontmatterString(parsed.frontmatter, ['responsibility', 'description', 'summary', 'purpose']),
    parseSectionItems(body, ['Use when', 'Purpose', 'Responsibility', 'Responsibilities', 'Role'], 3).join(' '),
    firstMarkdownParagraph(body),
    `Assistant imported from ${frontmatterString(parsed.frontmatter, ['name']) || 'SKILL.md'}.`,
  ]).slice(0, MAX_SHORT_TEXT);

  const prompt = firstNonEmpty([
    frontmatterString(parsed.frontmatter, ['prompt', 'systemPrompt', 'instructions', 'instruction', 'defaultPrompt']),
    parseSectionText(body, ['System prompt', 'Prompt', 'Instructions', 'Behavior', 'Workflow']),
    body,
    responsibility,
  ]).slice(0, MAX_PROMPT);

  return {
    name,
    responsibility,
    preferredAgents: uniqueItems([
      ...frontmatterList(parsed.frontmatter, ['preferredAgents', 'agents', 'agent', 'backend', 'presetAgentType']),
    ], 8),
    kind: normalizeImportedKind(frontmatterString(parsed.frontmatter, ['kind', 'type'])),
    surfaceId: frontmatterString(parsed.frontmatter, ['surfaceId', 'surface']) || undefined,
    objectTypes: uniqueItems(frontmatterList(parsed.frontmatter, ['objectTypes', 'objects', 'surfaces']), 16),
    prompt,
    defaultPrompt: prompt,
    allowedActions: uniqueItems([
      ...frontmatterList(parsed.frontmatter, ['allowedActions', 'actions', 'capabilities', 'tools']),
      ...parseSectionItems(body, ['Allowed actions', 'Actions', 'Capabilities', 'Tools'], 24),
    ], 24),
    labels: uniqueItems([
      ...frontmatterList(parsed.frontmatter, ['labels', 'tags']),
      'imported',
      'skill-md',
    ], 16),
    enabled: true,
  };
}

function normalizeImportedKind(value: unknown): AgentAssistant['kind'] {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'automation') return 'automation';
  if (raw === 'creation') return 'creation';
  if (raw === 'custom' || raw === 'assistant' || raw === 'agent-profile' || raw === 'skill' || raw === 'specialist' || raw === 'team') return 'custom';
  return 'custom';
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function importText(value: unknown, maxLength = MAX_PROMPT): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function importStringList(value: unknown, maxItems: number): string[] {
  if (Array.isArray(value)) return uniqueItems(value.map(item => String(item || '').trim()).filter(Boolean), maxItems);
  if (typeof value === 'string') return uniqueItems(splitTokens(value), maxItems);
  return [];
}

function splitTokens(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map(item => stripMarkdownDecorations(item))
    .filter(Boolean);
}

function uniqueItems(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = stripMarkdownDecorations(value);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function splitFrontmatter(input: string): { frontmatter: Frontmatter; body: string } {
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: input };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { frontmatter: {}, body: input };
  return {
    frontmatter: parseFrontmatter(lines.slice(1, end).join('\n')),
    body: lines.slice(end + 1).join('\n'),
  };
}

function parseFrontmatter(raw: string): Frontmatter {
  const frontmatter: Frontmatter = {};
  let currentKey = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const listItem = trimmed.match(/^-\s+(.+)$/);
    if (listItem && currentKey) {
      const current = frontmatter[currentKey];
      const next = Array.isArray(current) ? current : current ? [current] : [];
      next.push(unquoteYaml(listItem[1]));
      frontmatter[currentKey] = next;
      continue;
    }
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) continue;
    currentKey = normalizeFrontmatterKey(match[1]);
    frontmatter[currentKey] = parseYamlScalar(match[2]);
  }
  return frontmatter;
}

function parseYamlScalar(rawValue: string): FrontmatterValue {
  const value = rawValue.trim();
  if (!value) return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(',').map(item => unquoteYaml(item)).filter(Boolean) : [];
  }
  return unquoteYaml(value);
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeFrontmatterKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function frontmatterString(frontmatter: Frontmatter, keys: string[]): string {
  for (const key of keys) {
    const value = frontmatter[normalizeFrontmatterKey(key)];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value[0]) return value[0].trim();
  }
  return '';
}

function frontmatterList(frontmatter: Frontmatter, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = frontmatter[normalizeFrontmatterKey(key)];
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === 'string') values.push(...splitTokens(value));
  }
  return values;
}

function firstMarkdownHeading(body: string): string {
  const h1 = body.match(/^\s*#\s+(.+)$/m);
  return h1 ? stripMarkdownDecorations(h1[1]) : '';
}

function firstMarkdownParagraph(body: string): string {
  const withoutHeading = body
    .replace(/^\s*#\s+.+$/m, '')
    .split(/\n{2,}/)
    .map(item => stripMarkdownDecorations(item.replace(/\r?\n/g, ' ')))
    .find(item => item && !item.startsWith('#') && !/^[-*]\s/.test(item));
  return withoutHeading || '';
}

function parseSectionItems(body: string, headings: string[], maxItems: number): string[] {
  const section = parseSectionText(body, headings);
  if (!section) return [];
  const items = section
    .split(/\r?\n/)
    .map(line => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)?.[1] || '')
    .map(stripMarkdownDecorations)
    .filter(Boolean);
  if (items.length) return uniqueItems(items, maxItems);
  return uniqueItems(section.split(/[.;]\s+/).map(stripMarkdownDecorations).filter(Boolean), maxItems);
}

function parseSectionText(body: string, headings: string[]): string {
  const wanted = new Set(headings.map(normalizeSectionHeading));
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{0,3}#{2,6}\s+(.+?)\s*$/);
    if (!match) continue;
    if (wanted.has(normalizeSectionHeading(match[1]))) {
      start = index + 1;
      break;
    }
  }
  if (start < 0) return '';
  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s{0,3}#{2,6}\s+/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join('\n').trim();
}

function stripMarkdownDecorations(value: string): string {
  return value
    .replace(/\([^)]*uses:[^)]*\)/gi, '')
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
    .replace(/[`*_>#]/g, '')
    .trim();
}

function normalizeSectionHeading(value: string): string {
  return stripMarkdownDecorations(value).toLowerCase();
}

function firstNonEmpty(values: string[]): string {
  return values.find(value => value.trim())?.trim() || '';
}
