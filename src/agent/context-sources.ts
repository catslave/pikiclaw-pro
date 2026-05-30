import type {
  Agent,
  SessionContextOutputSource,
  SessionContextSessionSource,
  SessionContextSource,
  SessionContextSourceMode,
} from './types.js';

const VALID_MODES = new Set<SessionContextSourceMode>(['compact', 'last_n_turns', 'selected_turns', 'full']);

function text(value: unknown, max = 4096): string {
  const out = typeof value === 'string' ? value.trim() : '';
  return out.length <= max ? out : out.slice(0, max).trimEnd();
}

function positiveInt(value: unknown, fallback: number | null = null): number | null {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function nonNegativeInt(value: unknown, fallback: number | null = null): number | null {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function sourceKey(source: SessionContextSource): string {
  if (source.kind === 'output') {
    return `output:${source.workdir}:${source.agent}:${source.sessionId}:${source.outputId}`;
  }
  return `session:${source.workdir}:${source.agent}:${source.sessionId}`;
}

export function normalizeSessionContextSources(value: unknown): SessionContextSource[] {
  if (!Array.isArray(value)) return [];
  const out: SessionContextSource[] = [];
  const seen = new Set<string>();
  let sessionSourceCount = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const kind = item.kind === 'output' ? 'output' : item.kind === 'session' ? 'session' : null;
    if (!kind) continue;
    const workdir = text(item.workdir, 4096);
    const agent = text(item.agent, 80) as Agent;
    const sessionId = text(item.sessionId, 240);
    if (!workdir || !agent || !sessionId) continue;

    let source: SessionContextSource | null = null;
    if (kind === 'session') {
      if (sessionSourceCount >= 1) continue;
      const rawMode = text(item.mode, 40) as SessionContextSourceMode;
      const mode = VALID_MODES.has(rawMode) ? rawMode : 'compact';
      source = {
        kind,
        workdir,
        agent,
        sessionId,
        title: text(item.title, 240) || null,
        mode,
        lastNTurns: positiveInt(item.lastNTurns, null),
        turnStart: nonNegativeInt(item.turnStart, null),
        turnEnd: nonNegativeInt(item.turnEnd, null),
      } satisfies SessionContextSessionSource;
      sessionSourceCount += 1;
    } else {
      const outputId = text(item.outputId, 180) || text(item.id, 180);
      const title = text(item.title, 240);
      if (!outputId || !title) continue;
      source = {
        kind,
        workdir,
        agent,
        sessionId,
        outputId,
        title,
        summary: text(item.summary, 8000) || null,
        path: text(item.path, 4096) || null,
        url: text(item.url, 4096) || null,
        turnIndex: nonNegativeInt(item.turnIndex, null),
      } satisfies SessionContextOutputSource;
    }
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}
