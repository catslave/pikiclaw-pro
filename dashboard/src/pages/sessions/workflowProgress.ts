export type WorkflowProgressStatus = 'running' | 'blocked' | 'done';

export interface WorkflowProgressSnapshot {
  currentStep: number;
  totalSteps: number;
  title: string;
  status: WorkflowProgressStatus;
}

export type WorkflowAskType = 'text' | 'number' | 'choice' | 'boolean' | 'rating';

export interface WorkflowAskMarker {
  question: string;
  type: WorkflowAskType;
  options: string[];
  max?: number;
  placeholder?: string;
}

const FENCE_RE = /^\s*```/;
const LEGACY_PROGRESS_RE = /^Workflow progress:\s*Step\s+(\d+)\s*\/\s*(\d+)\s*(.*)$/i;
const PIPE_PROGRESS_RE = /^Workflow progress:\s*(.+)$/i;
const COMPLETE_RE = /^Workflow complete\b/i;
const STATUS_RE = /(?:[-–—:]\s*)?(running|blocked|done|completed|complete)\.?\s*$/i;
const ASK_SOURCE_RE = /<ask\s+[^>]*?>[\s\S]*?<\/ask>|&lt;ask\s+[\s\S]*?&gt;[\s\S]*?&lt;\/ask&gt;/gi;
const ASK_RE = /^<ask\s+([^>]*?)>([\s\S]*?)<\/ask>$/i;
const ASK_ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

function clampStep(value: number, total: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(Math.floor(value), Math.max(1, total)));
}

function normalizeStatus(value: string | null): WorkflowProgressStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'done' || normalized === 'completed' || normalized === 'complete') return 'done';
  return 'running';
}

function parseProgressLine(line: string): WorkflowProgressSnapshot | null {
  const match = line.trim().match(LEGACY_PROGRESS_RE);
  if (!match) return parsePipeProgressLine(line);
  const rawCurrent = Number(match[1]);
  const rawTotal = Number(match[2]);
  const totalSteps = Math.max(1, Number.isFinite(rawTotal) ? Math.floor(rawTotal) : 1);
  const currentStep = clampStep(rawCurrent, totalSteps);
  let rest = (match[3] || '').trim().replace(/^[-–—:\s]+/, '');
  const statusMatch = rest.match(STATUS_RE);
  const status = normalizeStatus(statusMatch?.[1] || null);
  if (statusMatch) {
    rest = rest.slice(0, statusMatch.index).replace(/[-–—:\s]+$/, '').trim();
  }
  return {
    currentStep,
    totalSteps,
    title: rest || `Step ${currentStep}`,
    status,
  };
}

function parsePipeProgressLine(line: string): WorkflowProgressSnapshot | null {
  const match = line.trim().match(PIPE_PROGRESS_RE);
  if (!match) return null;
  const parts = match[1].split('|').map(part => part.trim()).filter(Boolean);
  let title = '';
  let stepMatch: RegExpMatchArray | null = null;
  let status: WorkflowProgressStatus = 'running';
  for (const part of parts) {
    const maybeStep = part.match(/^step\s+(\d+)\s*\/\s*(\d+)/i) || part.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (maybeStep) {
      stepMatch = maybeStep;
      continue;
    }
    const maybeStatus = part.match(/^status\s+(.+)$/i);
    if (maybeStatus) {
      status = normalizeStatus(maybeStatus[1]);
      continue;
    }
    if (!title) title = part;
  }
  if (!stepMatch) return null;
  const rawCurrent = Number(stepMatch[1]);
  const rawTotal = Number(stepMatch[2]);
  const totalSteps = Math.max(1, Number.isFinite(rawTotal) ? Math.floor(rawTotal) : 1);
  const currentStep = clampStep(rawCurrent, totalSteps);
  return {
    currentStep,
    totalSteps,
    title: title || `Step ${currentStep}`,
    status,
  };
}

function normalizeAskType(value: string | undefined): WorkflowAskType | null {
  const raw = value?.trim().toLowerCase();
  if (raw === 'text' || raw === 'number' || raw === 'choice' || raw === 'boolean' || raw === 'rating') return raw;
  return null;
}

function parseAskAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ASK_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASK_ATTR_RE.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function decodeWorkflowHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAskMarker(attrsText: string, questionText: string): WorkflowAskMarker | null {
  const attrs = parseAskAttrs(attrsText);
  const type = normalizeAskType(attrs.type);
  const question = questionText.trim();
  if (!type || !question) return null;
  const rawMax = Number(attrs.max);
  return {
    question,
    type,
    options: attrs.options ? attrs.options.split(',').map(item => item.trim()).filter(Boolean).slice(0, 12) : [],
    max: Number.isFinite(rawMax) && rawMax > 0 ? Math.min(10, Math.floor(rawMax)) : undefined,
    placeholder: attrs.placeholder?.trim() || undefined,
  };
}

function collectInlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let tickCount = 1;
    while (text[index + tickCount] === '`') tickCount += 1;
    const marker = '`'.repeat(tickCount);
    const close = text.indexOf(marker, index + tickCount);
    if (close < 0) {
      index += tickCount;
      continue;
    }
    ranges.push([index, close + tickCount]);
    index = close + tickCount;
  }
  return ranges;
}

function offsetInRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function scanWorkflowAskMarkerSources(text: string): Array<{ index: number; source: string; marker: WorkflowAskMarker }> {
  const ranges = collectInlineCodeRanges(text);
  const hits: Array<{ index: number; source: string; marker: WorkflowAskMarker }> = [];
  ASK_SOURCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASK_SOURCE_RE.exec(text)) !== null) {
    if (offsetInRanges(match.index, ranges)) continue;
    const source = match[0];
    const decoded = source.includes('&lt;') ? decodeWorkflowHtmlEntities(source) : source;
    const markerMatch = decoded.match(ASK_RE);
    if (!markerMatch) continue;
    const marker = parseAskMarker(markerMatch[1], markerMatch[2]);
    if (marker) hits.push({ index: match.index, source, marker });
  }
  return hits;
}

function splitOutsideFences(text: string): Array<{ text: string; inFence: boolean }> {
  const out: Array<{ text: string; inFence: boolean }> = [];
  const lines = String(text || '').split('\n');
  let inFence = false;
  let current: string[] = [];
  let currentFence = false;
  const flush = () => {
    if (current.length) out.push({ text: current.join('\n'), inFence: currentFence });
    current = [];
  };
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      flush();
      out.push({ text: line, inFence: inFence });
      inFence = !inFence;
      currentFence = inFence;
      continue;
    }
    if (current.length && currentFence !== inFence) flush();
    currentFence = inFence;
    current.push(line);
  }
  flush();
  return out;
}

export function parseWorkflowProgress(text: string): WorkflowProgressSnapshot | null {
  let inFence = false;
  let last: WorkflowProgressSnapshot | null = null;
  let sawComplete = false;

  for (const line of String(text || '').split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const parsed = parseProgressLine(line);
    if (parsed) {
      last = parsed;
      continue;
    }
    if (COMPLETE_RE.test(line.trim())) {
      sawComplete = true;
    }
  }

  if (last && sawComplete) {
    return { ...last, currentStep: last.totalSteps, status: 'done' };
  }
  return last;
}

export function extractWorkflowAskMarkers(text: string): WorkflowAskMarker[] {
  const asks: WorkflowAskMarker[] = [];
  for (const part of splitOutsideFences(text)) {
    if (part.inFence) continue;
    asks.push(...scanWorkflowAskMarkerSources(part.text).map(hit => hit.marker));
  }
  return asks;
}

export function latestWorkflowProgressFromTexts(texts: Array<string | null | undefined>): WorkflowProgressSnapshot | null {
  let latest: WorkflowProgressSnapshot | null = null;
  for (const text of texts) {
    const parsed = parseWorkflowProgress(text || '');
    if (parsed) latest = parsed;
  }
  return latest;
}

export function stripWorkflowProgressMarkers(text: string): string {
  let inFence = false;
  const out: string[] = [];
  for (const line of String(text || '').split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence && (parseProgressLine(line) || COMPLETE_RE.test(line.trim()))) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
}

export function stripWorkflowControlMarkers(text: string): string {
  return splitOutsideFences(text)
    .map(part => {
      if (part.inFence) return part.text;
      const withoutProgress = stripWorkflowProgressMarkers(part.text);
      const askHits = scanWorkflowAskMarkerSources(withoutProgress);
      let cursor = 0;
      let out = '';
      for (const hit of askHits) {
        out += withoutProgress.slice(cursor, hit.index);
        cursor = hit.index + hit.source.length;
      }
      out += withoutProgress.slice(cursor);
      return out.trim();
    })
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function buildWorkflowAskAnswerEnvelope(ask: { id: string; stepIndex: number }, answer: string): string {
  return [
    `[workflow_answer ask_id="${ask.id}" step_n="${ask.stepIndex}"]`,
    `<answer>${answer}</answer>`,
    '[/workflow_answer]',
  ].join('\n');
}
