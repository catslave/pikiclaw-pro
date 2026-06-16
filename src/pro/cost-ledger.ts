import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createUsageCostEstimator,
  emptyUsageCostFields,
  mergeUsageCostFields,
  resolveUsageCostSource,
  type UsageCostFields,
  type UsageCostSource,
  type UsageCostEstimator,
} from './usage-cost.js';

export interface CostLedgerEvent extends UsageCostFields {
  id: string;
  agent: string;
  workdir: string;
  sessionId: string | null;
  threadId?: string | null;
  model: string | null;
  channel?: string | null;
  status: 'ok' | 'failed';
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  elapsedSeconds: number | null;
  createdAt: string;
}

export interface CostLedgerRecordInput {
  agent: string;
  workdir: string;
  sessionId?: string | null;
  threadId?: string | null;
  model?: string | null;
  channel?: string | null;
  status?: 'ok' | 'failed';
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  elapsedSeconds?: number | null;
  createdAt?: string | null;
}

export interface CostLedgerBucket extends UsageCostFields {
  key: string;
  eventCount: number;
  turnCount: number;
  totalTokens: number;
}

export interface CostLedgerSummary extends UsageCostFields {
  eventCount: number;
  totalTokens: number;
  latestEventAt: string | null;
  byAgent: CostLedgerBucket[];
  byModel: CostLedgerBucket[];
  byChannel: CostLedgerBucket[];
  bySession: CostLedgerBucket[];
  byDay: CostLedgerBucket[];
}

interface CostLedgerFile {
  version: 1;
  events: CostLedgerEvent[];
}

const MAX_LEDGER_EVENTS = 10_000;

function costLedgerFilePath() {
  return process.env.PIKICLAW_PRO_COST_LEDGER_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'cost-events.json');
}

function newId() {
  return `cost_${crypto.randomBytes(8).toString('hex')}`;
}

function cleanText(value: unknown, max = 240): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function cleanPath(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 2000 ? text.slice(0, 2000) : text;
}

function tokenNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function secondsNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
}

function normalizeCostSource(value: unknown): UsageCostSource {
  return value === 'estimated' || value === 'mixed' ? value : 'unknown';
}

function normalizeEvent(raw: any): CostLedgerEvent | null {
  const id = cleanText(raw?.id, 160);
  const agent = cleanText(raw?.agent, 80);
  const createdAt = cleanText(raw?.createdAt, 80);
  if (!id || !agent || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const inputTokens = tokenNumber(raw?.inputTokens);
  const outputTokens = tokenNumber(raw?.outputTokens);
  const cachedInputTokens = tokenNumber(raw?.cachedInputTokens);
  const cacheCreationInputTokens = tokenNumber(raw?.cacheCreationInputTokens);
  const totalTokens = tokenNumber(raw?.totalTokens) || inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens;
  const pricedTokens = tokenNumber(raw?.pricedTokens);
  const unpricedTokens = tokenNumber(raw?.unpricedTokens);
  return {
    id,
    agent,
    workdir: cleanPath(raw?.workdir),
    sessionId: cleanText(raw?.sessionId, 200) || null,
    threadId: cleanText(raw?.threadId, 200) || null,
    model: cleanText(raw?.model, 240) || null,
    channel: cleanText(raw?.channel, 80) || null,
    status: raw?.status === 'failed' ? 'failed' : 'ok',
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    totalTokens,
    elapsedSeconds: secondsNumber(raw?.elapsedSeconds),
    estimatedCostUsd: Math.max(0, Number(raw?.estimatedCostUsd || 0)),
    pricedTokens,
    unpricedTokens,
    costSource: normalizeCostSource(raw?.costSource ?? resolveUsageCostSource(pricedTokens, unpricedTokens)),
    createdAt,
  };
}

function readFile(): CostLedgerFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(costLedgerFilePath(), 'utf-8')) as CostLedgerFile;
    const events = Array.isArray(parsed?.events)
      ? parsed.events.map(normalizeEvent).filter((event): event is CostLedgerEvent => !!event)
      : [];
    return { version: 1, events };
  } catch {
    return { version: 1, events: [] };
  }
}

function writeFile(file: CostLedgerFile) {
  const filePath = costLedgerFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function dayKey(value: string): string {
  const time = Date.parse(value);
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString().slice(0, 10);
}

function emptyBucket(key: string): CostLedgerBucket {
  return {
    key,
    eventCount: 0,
    turnCount: 0,
    totalTokens: 0,
    ...emptyUsageCostFields(),
  };
}

function addEventToBucket(bucket: CostLedgerBucket, event: CostLedgerEvent): void {
  bucket.eventCount += 1;
  bucket.turnCount += event.status === 'ok' ? 1 : 0;
  bucket.totalTokens += event.totalTokens;
  mergeUsageCostFields(bucket, event);
}

function sortedBuckets(map: Map<string, CostLedgerBucket>, limit: number): CostLedgerBucket[] {
  return [...map.values()]
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens || b.eventCount - a.eventCount)
    .slice(0, limit);
}

export function listCostLedgerEvents(limit = 200): CostLedgerEvent[] {
  const n = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)));
  return readFile().events
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, n);
}

export async function recordCostLedgerEvent(input: CostLedgerRecordInput, opts: { estimator?: UsageCostEstimator } = {}): Promise<CostLedgerEvent> {
  const estimator = opts.estimator || await createUsageCostEstimator();
  const inputTokens = tokenNumber(input.inputTokens);
  const outputTokens = tokenNumber(input.outputTokens);
  const cachedInputTokens = tokenNumber(input.cachedInputTokens);
  const cacheCreationInputTokens = tokenNumber(input.cacheCreationInputTokens);
  const estimated = estimator.estimate(input.model, { inputTokens, outputTokens, cachedInputTokens });
  if (cacheCreationInputTokens > 0) {
    estimated.unpricedTokens += cacheCreationInputTokens;
    estimated.costSource = resolveUsageCostSource(estimated.pricedTokens, estimated.unpricedTokens);
  }
  const event: CostLedgerEvent = {
    id: newId(),
    agent: cleanText(input.agent, 80) || 'unknown',
    workdir: cleanPath(input.workdir),
    sessionId: cleanText(input.sessionId, 200) || null,
    threadId: cleanText(input.threadId, 200) || null,
    model: cleanText(input.model, 240) || null,
    channel: cleanText(input.channel, 80) || null,
    status: input.status === 'failed' ? 'failed' : 'ok',
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    totalTokens: inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens,
    elapsedSeconds: secondsNumber(input.elapsedSeconds),
    createdAt: cleanText(input.createdAt, 80) || new Date().toISOString(),
    ...estimated,
  };
  const file = readFile();
  const events = [event, ...file.events]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_LEDGER_EVENTS);
  writeFile({ version: 1, events });
  return event;
}

export function buildCostLedgerSummary(events: CostLedgerEvent[] = listCostLedgerEvents(1000)): CostLedgerSummary {
  const byAgent = new Map<string, CostLedgerBucket>();
  const byModel = new Map<string, CostLedgerBucket>();
  const byChannel = new Map<string, CostLedgerBucket>();
  const bySession = new Map<string, CostLedgerBucket>();
  const byDay = new Map<string, CostLedgerBucket>();
  const summary: CostLedgerSummary = {
    eventCount: 0,
    totalTokens: 0,
    latestEventAt: null,
    byAgent: [],
    byModel: [],
    byChannel: [],
    bySession: [],
    byDay: [],
    ...emptyUsageCostFields(),
  };

  for (const event of events) {
    summary.eventCount += 1;
    summary.totalTokens += event.totalTokens;
    mergeUsageCostFields(summary, event);
    if (!summary.latestEventAt || Date.parse(event.createdAt) > Date.parse(summary.latestEventAt)) {
      summary.latestEventAt = event.createdAt;
    }
    const agentBucket = byAgent.get(event.agent) || emptyBucket(event.agent);
    addEventToBucket(agentBucket, event);
    byAgent.set(agentBucket.key, agentBucket);

    const modelKey = event.model || '(unknown model)';
    const modelBucket = byModel.get(modelKey) || emptyBucket(modelKey);
    addEventToBucket(modelBucket, event);
    byModel.set(modelBucket.key, modelBucket);

    const channelKey = event.channel || '(dashboard/local)';
    const channelBucket = byChannel.get(channelKey) || emptyBucket(channelKey);
    addEventToBucket(channelBucket, event);
    byChannel.set(channelBucket.key, channelBucket);

    const sessionKey = event.sessionId || event.threadId || '(no session)';
    const sessionBucket = bySession.get(sessionKey) || emptyBucket(sessionKey);
    addEventToBucket(sessionBucket, event);
    bySession.set(sessionBucket.key, sessionBucket);

    const day = dayKey(event.createdAt);
    const dayBucket = byDay.get(day) || emptyBucket(day);
    addEventToBucket(dayBucket, event);
    byDay.set(dayBucket.key, dayBucket);
  }

  summary.byAgent = sortedBuckets(byAgent, 12);
  summary.byModel = sortedBuckets(byModel, 12);
  summary.byChannel = sortedBuckets(byChannel, 12);
  summary.bySession = sortedBuckets(bySession, 12);
  summary.byDay = [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 30);
  return summary;
}
