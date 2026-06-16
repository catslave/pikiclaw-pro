export interface ScheduleProposalMarker {
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  includeProjectReferences: boolean;
  projectReferenceNames: string[];
}

const FENCE_RE = /^\s*```/;
const SCHEDULE_SOURCE_RE = /<schedule-proposal\s*[^>]*?>[\s\S]*?<\/schedule-proposal>|&lt;schedule-proposal\s*[\s\S]*?&gt;[\s\S]*?&lt;\/schedule-proposal&gt;/gi;
const SCHEDULE_RE = /^<schedule-proposal\s*([^>]*?)>([\s\S]*?)<\/schedule-proposal>$/i;
const ATTR_RE = /([\w-]+)\s*=\s*"([^"]*)"/g;
const CRON_PROPOSE_SOURCE_RE = /\[CRON_PROPOSE\]\s*\n?([\s\S]*?)\[\/CRON_PROPOSE\]/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(value)) !== null) {
    attrs[match[1]] = decodeEntities(match[2] || '').trim();
  }
  return attrs;
}

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

function normalizeSchedule(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw || raw === 'manual') return 'manual';
  if (/^daily@\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^weekly@[0-6]@\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^biweekly@[0-6]@\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^monthly@(?:[1-9]|[12]\d|3[01])@\d{2}:\d{2}$/.test(raw)) return raw;
  return 'manual';
}

function normalizeCronSchedule(value: string | undefined): string {
  const parts = String(value || '').trim().split(/\s+/);
  if (parts.length !== 5) return 'manual';
  const [minute, hour, day, month, weekday] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour) || month !== '*') return 'manual';
  const minuteNumber = Number(minute);
  const hourNumber = Number(hour);
  if (minuteNumber < 0 || minuteNumber > 59 || hourNumber < 0 || hourNumber > 23) return 'manual';
  const time = `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`;
  if ((day === '*' || day === '?') && (weekday === '*' || weekday === '?')) return `daily@${time}`;
  if ((day === '*' || day === '?') && weekday) {
    const weekMap: Record<string, string> = { SUN: '0', MON: '1', TUE: '2', WED: '3', THU: '4', FRI: '5', SAT: '6' };
    const normalizedWeekday = weekday.toUpperCase();
    const weekValue = weekMap[normalizedWeekday] ?? normalizedWeekday;
    if (/^[0-6]$/.test(weekValue)) return `weekly@${weekValue}@${time}`;
  }
  if (/^(?:[1-9]|[12]\d|3[01])$/.test(day) && (weekday === '*' || weekday === '?')) return `monthly@${Number(day)}@${time}`;
  return 'manual';
}

function normalizeReferenceNames(value: string | undefined): string[] {
  const seen = new Set<string>();
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(name => {
      if (!name.includes('/') && !name.includes('\\')) seen.add(name);
    });
  return [...seen].slice(0, 20);
}

function parseScheduleProposal(source: string): ScheduleProposalMarker | null {
  const decoded = source.includes('&lt;') ? decodeEntities(source) : source;
  const match = decoded.match(SCHEDULE_RE);
  if (!match) return null;
  const attrs = parseAttrs(match[1] || '');
  const prompt = decodeEntities(match[2] || '').trim();
  if (!prompt) return null;
  return {
    name: attrs.name || '',
    schedule: normalizeSchedule(attrs.schedule),
    prompt,
    enabled: normalizeBoolean(attrs.enabled, true),
    includeProjectReferences: normalizeBoolean(attrs['include-project-references'] ?? attrs.includeProjectReferences, false),
    projectReferenceNames: normalizeReferenceNames(attrs['project-reference-names'] ?? attrs.projectReferenceNames),
  };
}

function parseCronProposal(source: string): ScheduleProposalMarker | null {
  const match = source.match(/^\[CRON_PROPOSE\]\s*\n?([\s\S]*?)\[\/CRON_PROPOSE\]$/i);
  const body = match?.[1] || '';
  if (!body.trim()) return null;
  const name = body.match(/^name:\s*(.+)$/im)?.[1]?.trim() || '';
  const schedule = body.match(/^schedule:\s*(.+)$/im)?.[1]?.trim() || '';
  const message = body.match(/^message:\s*([\s\S]*?)(?=\n(?:name|schedule|schedule_description):|$)/im)?.[1]?.trim() || '';
  if (!name || !message) return null;
  return {
    name,
    schedule: normalizeCronSchedule(schedule),
    prompt: message,
    enabled: true,
    includeProjectReferences: false,
    projectReferenceNames: [],
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
      out.push({ text: line, inFence });
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

function scanScheduleProposalSources(text: string): Array<{ index: number; source: string; marker: ScheduleProposalMarker }> {
  const ranges = collectInlineCodeRanges(text);
  const hits: Array<{ index: number; source: string; marker: ScheduleProposalMarker }> = [];
  SCHEDULE_SOURCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCHEDULE_SOURCE_RE.exec(text)) !== null) {
    if (offsetInRanges(match.index, ranges)) continue;
    const source = match[0];
    const marker = parseScheduleProposal(source);
    if (marker) hits.push({ index: match.index, source, marker });
  }
  CRON_PROPOSE_SOURCE_RE.lastIndex = 0;
  while ((match = CRON_PROPOSE_SOURCE_RE.exec(text)) !== null) {
    if (offsetInRanges(match.index, ranges)) continue;
    const source = match[0];
    const marker = parseCronProposal(source);
    if (marker) hits.push({ index: match.index, source, marker });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export function extractScheduleProposalMarkers(text: string): ScheduleProposalMarker[] {
  const proposals: ScheduleProposalMarker[] = [];
  for (const part of splitOutsideFences(text)) {
    if (part.inFence) continue;
    proposals.push(...scanScheduleProposalSources(part.text).map(hit => hit.marker));
  }
  return proposals;
}

export function stripScheduleProposalMarkers(text: string): string {
  return splitOutsideFences(text)
    .map(part => {
      if (part.inFence) return part.text;
      const hits = scanScheduleProposalSources(part.text);
      let cursor = 0;
      let out = '';
      for (const hit of hits) {
        out += part.text.slice(cursor, hit.index);
        cursor = hit.index + hit.source.length;
      }
      out += part.text.slice(cursor);
      return out.trim();
    })
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function scheduleProposalSignature(marker: ScheduleProposalMarker): string {
  return [
    marker.name,
    marker.schedule,
    marker.prompt,
    marker.enabled ? '1' : '0',
    marker.includeProjectReferences ? '1' : '0',
    marker.projectReferenceNames.join(','),
  ].join('|');
}
