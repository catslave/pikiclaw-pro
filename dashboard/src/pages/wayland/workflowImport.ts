export type WorkflowRecipeInput = {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  outputs?: string[];
  steps: string[];
  capabilities?: string[];
  promptHint?: string;
  cadence?: string;
  defaultEffort?: 'low' | 'medium' | 'high';
};

type FrontmatterValue = string | string[];
type Frontmatter = Record<string, FrontmatterValue>;

const MAX_DESCRIPTION = 1_000;
const MAX_PROMPT = 4_000;
const MAX_NAME = 160;

export function parseWorkflowImportText(input: string): WorkflowRecipeInput[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Import is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseWorkflowImportJson(trimmed);
  return [normalizeImportedWorkflowMarkdown(trimmed)];
}

export function parseWorkflowImportJson(input: string): WorkflowRecipeInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Import must be valid workflow JSON or SKILL.md markdown.');
  }
  const source = parsed && typeof parsed === 'object' && Array.isArray((parsed as { workflows?: unknown }).workflows)
    ? (parsed as { workflows: unknown[] }).workflows
    : Array.isArray(parsed)
      ? parsed
      : [parsed];
  if (!source.length) throw new Error('Import does not contain any workflows.');
  return source.map(normalizeImportedWorkflowItem);
}

function normalizeImportedWorkflowItem(raw: unknown, index: number): WorkflowRecipeInput {
  if (!raw || typeof raw !== 'object') throw new Error(`Workflow #${index + 1} must be an object.`);
  const item = raw as Record<string, unknown>;
  const name = workflowImportText(item.name, MAX_NAME);
  const description = workflowImportText(item.description, MAX_DESCRIPTION);
  const steps = workflowImportStringList(item.steps, 'lines', 20);
  if (!name) throw new Error(`Workflow #${index + 1} is missing name.`);
  if (!description) throw new Error(`Workflow "${name}" is missing description.`);
  if (!steps.length) throw new Error(`Workflow "${name}" is missing steps.`);
  return {
    name,
    description,
    category: workflowImportText(item.category, 120) || 'Imported',
    tags: workflowImportStringList(item.tags, 'tokens', 24),
    outputs: workflowImportStringList(item.outputs, 'lines', 12),
    steps,
    capabilities: workflowImportStringList(item.capabilities, 'tokens', 12),
    promptHint: workflowImportText(item.promptHint, MAX_PROMPT) || description,
    cadence: workflowImportText(item.cadence, 80) || 'On demand',
    defaultEffort: workflowImportEffort(item.defaultEffort),
  };
}

function normalizeImportedWorkflowMarkdown(input: string): WorkflowRecipeInput {
  const parsed = splitFrontmatter(input);
  const body = parsed.body.trim();
  const heading = firstMarkdownHeading(body);
  const name = firstNonEmpty([
    frontmatterString(parsed.frontmatter, ['title']),
    heading,
    frontmatterString(parsed.frontmatter, ['name']),
  ]).slice(0, MAX_NAME);
  if (!name) throw new Error('Workflow markdown is missing a title.');

  const steps = parseMarkdownSteps(body);
  if (!steps.length) throw new Error(`Workflow "${name}" is missing steps.`);

  const useWhen = parseSectionItems(body, ['Use when', 'Purpose', 'Goal'], 3).join(' ');
  const description = firstNonEmpty([
    frontmatterString(parsed.frontmatter, ['description', 'summary']),
    useWhen,
    firstMarkdownParagraph(body),
    `Reusable workflow imported from ${frontmatterString(parsed.frontmatter, ['name']) || 'SKILL.md'}.`,
  ]).slice(0, MAX_DESCRIPTION);

  const dependencyCapabilities = parseSectionItems(body, ['Depends on (skills)', 'Depends on', 'Skills', 'Tools', 'Capabilities'], 12);
  const tags = uniqueWorkflowItems([
    ...frontmatterList(parsed.frontmatter, ['tags', 'labels']),
    'workflow',
    'skill-md',
  ], 24);
  const capabilities = uniqueWorkflowItems([
    ...frontmatterList(parsed.frontmatter, ['capabilities', 'tools', 'depends', 'skills']),
    ...dependencyCapabilities,
    ...parseUsesMetadata(body),
  ], 12);

  return {
    name,
    description,
    category: frontmatterString(parsed.frontmatter, ['category']) || 'Imported',
    tags,
    outputs: uniqueWorkflowItems(parseSectionItems(body, ['Outputs', 'Expected outputs', 'Deliverables', 'Result'], 12), 12),
    steps,
    capabilities,
    promptHint: firstNonEmpty([
      frontmatterString(parsed.frontmatter, ['promptHint', 'prompt', 'instruction', 'instructions']),
      body,
      description,
    ]).slice(0, MAX_PROMPT),
    cadence: frontmatterString(parsed.frontmatter, ['cadence', 'schedule']) || 'On demand',
    defaultEffort: workflowImportEffort(frontmatterString(parsed.frontmatter, ['defaultEffort', 'effort'])),
  };
}

function workflowImportStringList(value: unknown, mode: 'lines' | 'tokens', maxItems: number): string[] {
  if (Array.isArray(value)) {
    return uniqueWorkflowItems(value.map(item => String(item || '').trim()).filter(Boolean), maxItems);
  }
  if (typeof value === 'string') {
    return mode === 'lines'
      ? splitWorkflowLines(value, maxItems)
      : uniqueWorkflowItems(splitWorkflowTokens(value), maxItems);
  }
  return [];
}

function workflowImportEffort(value: unknown): WorkflowRecipeInput['defaultEffort'] {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function workflowImportText(value: unknown, maxLength = MAX_PROMPT): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function splitWorkflowLines(value: string, maxItems = 20): string[] {
  return value
    .split(/\r?\n/)
    .map(item => stripMarkdownDecorations(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function splitWorkflowTokens(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map(item => stripMarkdownDecorations(item))
    .filter(Boolean);
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
    else if (typeof value === 'string') values.push(...splitWorkflowTokens(value));
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

function parseMarkdownSteps(body: string): string[] {
  const steps: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{2,6}\s+Step\s+\d+\s*[:.-]?\s*(.+)$/i);
    if (heading) {
      steps.push(stripStepMetadata(heading[1]));
      continue;
    }
    const bold = line.match(/^\s*(?:[-*]\s*)?\*\*Step\s+\d+\s*[:.-]\s*(.+?)\*\*/i);
    if (bold) steps.push(stripStepMetadata(bold[1]));
  }
  if (steps.length) return uniqueWorkflowItems(steps, 20);

  const sectionSteps = parseSectionItems(body, ['Steps', 'Workflow steps', 'Procedure', 'Runbook'], 20);
  if (sectionSteps.length) return sectionSteps;

  const fallback = body
    .split(/\r?\n/)
    .map(line => line.match(/^\s*\d+[.)]\s+(.+)$/)?.[1] || '')
    .map(stripStepMetadata)
    .filter(Boolean);
  return uniqueWorkflowItems(fallback, 20);
}

function parseSectionItems(body: string, headings: string[], maxItems: number): string[] {
  const lines = sectionLines(body, headings);
  if (!lines.length) return [];
  const items: string[] = [];
  for (const line of lines) {
    const listItem = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      items.push(stripStepMetadata(listItem[1]));
      continue;
    }
    const plain = stripStepMetadata(line);
    if (plain && !plain.startsWith('#')) items.push(plain);
  }
  return uniqueWorkflowItems(items, maxItems);
}

function sectionLines(body: string, headings: string[]): string[] {
  const wanted = new Set(headings.map(normalizeMarkdownHeading));
  const lines = body.split(/\r?\n/);
  let activeLevel = 0;
  const result: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{2,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const normalized = normalizeMarkdownHeading(heading[2]);
      if (wanted.has(normalized)) {
        activeLevel = level;
        result.length = 0;
        continue;
      }
      if (activeLevel && level <= activeLevel) break;
    } else if (activeLevel) {
      result.push(line);
    }
  }
  return result.map(item => item.trim()).filter(Boolean);
}

function normalizeMarkdownHeading(value: string): string {
  return stripMarkdownDecorations(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseUsesMetadata(body: string): string[] {
  const items: string[] = [];
  const re = /\(uses:\s*([^)]+)\)/gi;
  for (const match of body.matchAll(re)) {
    items.push(...splitWorkflowTokens(match[1]));
  }
  return uniqueWorkflowItems(items, 12);
}

function stripStepMetadata(value: string): string {
  return stripMarkdownDecorations(value.replace(/\(uses:\s*[^)]+\)/gi, ''));
}

function stripMarkdownDecorations(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/, '')
    .trim();
}

function uniqueWorkflowItems(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= maxItems) break;
  }
  return result;
}

function firstNonEmpty(values: string[]): string {
  return values.map(value => value.trim()).find(Boolean) || '';
}
