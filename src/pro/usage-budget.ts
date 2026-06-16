import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCostLedgerEvents, type CostLedgerEvent } from './cost-ledger.js';

export type UsageBudgetScope = 'global' | 'agent' | 'model';
export type UsageBudgetPeriod = 'day' | 'week' | 'month';
export type UsageBudgetAction = 'warn' | 'pause';
export type UsageBudgetState = 'ok' | 'warn' | 'over';
export type UsageBudgetUnit = 'tokens' | 'usd';

export interface UsageBudget {
  id: string;
  name: string;
  scope: UsageBudgetScope;
  scopeKey?: string;
  unit: UsageBudgetUnit;
  limitTokens: number;
  limitUsd: number;
  period: UsageBudgetPeriod;
  action: UsageBudgetAction;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageBudgetInput {
  id?: string;
  name?: unknown;
  scope?: unknown;
  scopeKey?: unknown;
  unit?: unknown;
  limitTokens?: unknown;
  limitUsd?: unknown;
  period?: unknown;
  action?: unknown;
  enabled?: unknown;
}

export interface UsageBudgetStatus extends UsageBudget {
  usedTokens: number;
  usedUsd: number;
  usedPercent: number | null;
  periodStart: string;
  periodEnd: string;
  state: UsageBudgetState;
  matchedChats: number;
  matchedEvents: number;
}

export interface UsageBudgetAlert {
  id: string;
  budgetId: string;
  budgetName: string;
  scope: UsageBudgetScope;
  scopeKey?: string;
  unit: UsageBudgetUnit;
  limitTokens: number;
  limitUsd: number;
  usedTokens: number;
  usedUsd: number;
  period: UsageBudgetPeriod;
  periodStart: string;
  eventId: string;
  agent: string;
  model: string | null;
  channel?: string | null;
  sessionId?: string | null;
  createdAt: string;
}

export interface UsageBudgetGateContext {
  agent?: string | null;
  model?: string | null;
}

export type UsageBudgetGateResult =
  | { allowed: true }
  | { allowed: false; budget: UsageBudgetStatus; message: string };

export interface UsageBudgetSummaryInput {
  byDay: Array<{ day: string; totalTokens: number }>;
  byAgent: Array<{ agent: string; totalTokens: number }>;
  topChats: Array<{ agent: string; model?: string | null; totalTokens: number; createdAt: string | null; updatedAt: string | null }>;
  totals: { totalTokens: number };
}

export interface UsageBudgetStatusOptions {
  costLedgerEvents?: CostLedgerEvent[];
}

interface UsageBudgetFile {
  version: 1;
  budgets: UsageBudget[];
}

interface UsageBudgetAlertFile {
  version: 1;
  alerts: UsageBudgetAlert[];
}

const MAX_USAGE_BUDGET_ALERTS = 200;

function usageBudgetFilePath() {
  return process.env.PIKICLAW_PRO_USAGE_BUDGET_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'usage-budgets.json');
}

function usageBudgetAlertFilePath() {
  return process.env.PIKICLAW_PRO_USAGE_BUDGET_ALERT_FILE || path.join(os.homedir(), '.pikiclaw', 'pro', 'usage-budget-alerts.json');
}

function newId() {
  return `budget_${crypto.randomBytes(8).toString('hex')}`;
}

function newAlertId() {
  return `budget_alert_${crypto.randomBytes(8).toString('hex')}`;
}

function cleanText(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function normalizeScope(value: unknown): UsageBudgetScope {
  if (value === 'model') return 'model';
  return value === 'agent' ? 'agent' : 'global';
}

function normalizePeriod(value: unknown): UsageBudgetPeriod {
  return value === 'week' || value === 'month' ? value : 'day';
}

function normalizeAction(value: unknown): UsageBudgetAction {
  return value === 'pause' ? 'pause' : 'warn';
}

function normalizeUnit(value: unknown): UsageBudgetUnit {
  return value === 'usd' ? 'usd' : 'tokens';
}

function normalizeTokenLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('limitTokens must be greater than 0');
  return Math.max(1, Math.floor(n));
}

function normalizeUsdLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('limitUsd must be greater than 0');
  return Math.round(n * 10000) / 10000;
}

function normalizeBudget(raw: any): UsageBudget | null {
  const id = cleanText(raw?.id, 160);
  if (!id) return null;
  const now = new Date().toISOString();
  const scope = normalizeScope(raw?.scope);
  const scopeKey = scope === 'agent' || scope === 'model' ? cleanText(raw?.scopeKey, 240) : undefined;
  if ((scope === 'agent' || scope === 'model') && !scopeKey) return null;
  const unit = normalizeUnit(raw?.unit);
  const limitTokens = Number(raw?.limitTokens);
  const limitUsd = Number(raw?.limitUsd);
  if (unit === 'tokens' && (!Number.isFinite(limitTokens) || limitTokens <= 0)) return null;
  if (unit === 'usd' && (!Number.isFinite(limitUsd) || limitUsd <= 0)) return null;
  return {
    id,
    name: cleanText(raw?.name, 160) || defaultBudgetName(scope, scopeKey, unit),
    scope,
    scopeKey,
    unit,
    limitTokens: Number.isFinite(limitTokens) && limitTokens > 0 ? Math.max(1, Math.floor(limitTokens)) : 0,
    limitUsd: Number.isFinite(limitUsd) && limitUsd > 0 ? Math.round(limitUsd * 10000) / 10000 : 0,
    period: normalizePeriod(raw?.period),
    action: normalizeAction(raw?.action),
    enabled: raw?.enabled !== false,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now,
  };
}

function readFile(): UsageBudgetFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageBudgetFilePath(), 'utf-8')) as UsageBudgetFile;
    return {
      version: 1,
      budgets: Array.isArray(parsed?.budgets)
        ? parsed.budgets.map(normalizeBudget).filter((item): item is UsageBudget => !!item)
        : [],
    };
  } catch {
    return { version: 1, budgets: [] };
  }
}

function normalizeAlert(raw: any): UsageBudgetAlert | null {
  const id = cleanText(raw?.id, 160);
  const budgetId = cleanText(raw?.budgetId, 160);
  const budgetName = cleanText(raw?.budgetName, 160);
  const eventId = cleanText(raw?.eventId, 160);
  const agent = cleanText(raw?.agent, 80);
  const createdAt = cleanText(raw?.createdAt, 80);
  const periodStartValue = cleanText(raw?.periodStart, 80);
  if (!id || !budgetId || !budgetName || !eventId || !agent) return null;
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  if (!periodStartValue || Number.isNaN(Date.parse(periodStartValue))) return null;
  const scope = normalizeScope(raw?.scope);
  const scopeKey = scope === 'agent' || scope === 'model' ? cleanText(raw?.scopeKey, 240) : undefined;
  if ((scope === 'agent' || scope === 'model') && !scopeKey) return null;
  const unit = normalizeUnit(raw?.unit);
  return {
    id,
    budgetId,
    budgetName,
    scope,
    scopeKey,
    unit,
    limitTokens: tokenNumber(raw?.limitTokens),
    limitUsd: Math.round(usdNumber(raw?.limitUsd) * 10000) / 10000,
    usedTokens: tokenNumber(raw?.usedTokens),
    usedUsd: Math.round(usdNumber(raw?.usedUsd) * 10000) / 10000,
    period: normalizePeriod(raw?.period),
    periodStart: periodStartValue,
    eventId,
    agent,
    model: cleanText(raw?.model, 240) || null,
    channel: cleanText(raw?.channel, 80) || null,
    sessionId: cleanText(raw?.sessionId, 200) || null,
    createdAt,
  };
}

function readAlertFile(): UsageBudgetAlertFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageBudgetAlertFilePath(), 'utf-8')) as UsageBudgetAlertFile;
    return {
      version: 1,
      alerts: Array.isArray(parsed?.alerts)
        ? parsed.alerts.map(normalizeAlert).filter((item): item is UsageBudgetAlert => !!item)
        : [],
    };
  } catch {
    return { version: 1, alerts: [] };
  }
}

function writeFile(file: UsageBudgetFile) {
  const filePath = usageBudgetFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function writeAlertFile(file: UsageBudgetAlertFile) {
  const filePath = usageBudgetAlertFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function defaultBudgetName(scope: UsageBudgetScope, scopeKey?: string, unit: UsageBudgetUnit = 'tokens'): string {
  const label = unit === 'usd' ? 'spend budget' : 'token budget';
  if (scope === 'agent' && scopeKey) return `${scopeKey} ${label}`;
  if (scope === 'model' && scopeKey) return `${scopeKey} ${label}`;
  return `Global ${label}`;
}

export function periodStart(period: UsageBudgetPeriod, at: Date = new Date()): Date {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  if (period === 'day') return d;
  if (period === 'week') {
    const dow = d.getDay();
    const daysSinceMonday = (dow + 6) % 7;
    d.setDate(d.getDate() - daysSinceMonday);
    return d;
  }
  d.setDate(1);
  return d;
}

function budgetState(used: number, limit: number): UsageBudgetState {
  if (used >= limit) return 'over';
  if (used >= limit * 0.8) return 'warn';
  return 'ok';
}

function dayValue(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tokenNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function usedTokensForBudget(budget: UsageBudget, summary: UsageBudgetSummaryInput, start: Date): { usedTokens: number; matchedChats: number } {
  const startKey = localDayKey(start);
  if (budget.scope === 'global') {
    const dayRows = summary.byDay.filter(row => dayValue(row.day) >= startKey);
    if (dayRows.length) {
      return {
        usedTokens: dayRows.reduce((sum, row) => sum + tokenNumber(row.totalTokens), 0),
        matchedChats: dayRows.reduce((sum, row) => sum + (tokenNumber((row as any).chatCount) || 0), 0),
      };
    }
    return { usedTokens: tokenNumber(summary.totals.totalTokens), matchedChats: summary.topChats.length };
  }

  const key = budget.scopeKey || '';
  if (budget.scope === 'model') {
    const chats = summary.topChats.filter(chat => {
      if ((chat.model || '') !== key) return false;
      const rawDate = chat.updatedAt || chat.createdAt;
      const time = rawDate ? Date.parse(rawDate) : NaN;
      return Number.isFinite(time) && time >= start.getTime();
    });
    return {
      usedTokens: chats.reduce((sum, chat) => sum + tokenNumber(chat.totalTokens), 0),
      matchedChats: chats.length,
    };
  }

  const chats = summary.topChats.filter(chat => {
    if (chat.agent !== key) return false;
    const rawDate = chat.updatedAt || chat.createdAt;
    const time = rawDate ? Date.parse(rawDate) : NaN;
    return Number.isFinite(time) && time >= start.getTime();
  });
  if (chats.length) {
    return {
      usedTokens: chats.reduce((sum, chat) => sum + tokenNumber(chat.totalTokens), 0),
      matchedChats: chats.length,
    };
  }

  const agent = summary.byAgent.find(row => row.agent === key);
  return { usedTokens: agent ? tokenNumber(agent.totalTokens) : 0, matchedChats: 0 };
}

function usdNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function usedUsdForBudget(budget: UsageBudget, events: CostLedgerEvent[], start: Date): { usedUsd: number; matchedEvents: number } {
  const startTime = start.getTime();
  const matching = events.filter(event => {
    const time = Date.parse(event.createdAt);
    if (!Number.isFinite(time) || time < startTime) return false;
    if (budget.scope === 'global') return true;
    if (budget.scope === 'agent') return event.agent === budget.scopeKey;
    return (event.model || '') === budget.scopeKey;
  });
  return {
    usedUsd: Math.round(matching.reduce((sum, event) => sum + usdNumber(event.estimatedCostUsd), 0) * 10000) / 10000,
    matchedEvents: matching.length,
  };
}

function budgetMatchesEvent(budget: UsageBudget, event: CostLedgerEvent): boolean {
  if (budget.scope === 'global') return true;
  if (budget.scope === 'agent') return event.agent === budget.scopeKey;
  return (event.model || '') === budget.scopeKey;
}

function eventUsageForBudget(budget: UsageBudget, event: CostLedgerEvent): number {
  return budget.unit === 'usd' ? usdNumber(event.estimatedCostUsd) : tokenNumber(event.totalTokens);
}

function budgetLimit(budget: UsageBudget): number {
  return budget.unit === 'usd' ? budget.limitUsd : budget.limitTokens;
}

function usageBudgetAlertLatchKey(budgetId: string, start: Date): string {
  return `${budgetId}:${start.toISOString()}`;
}

export function listUsageBudgets(): UsageBudget[] {
  return readFile().budgets.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function listUsageBudgetAlerts(limit = 20): UsageBudgetAlert[] {
  const n = Math.max(1, Math.min(MAX_USAGE_BUDGET_ALERTS, Math.floor(Number(limit) || 20)));
  return readAlertFile().alerts
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, n);
}

export function deleteUsageBudgetAlertsForBudget(id: string): number {
  const budgetId = cleanText(id, 160);
  if (!budgetId) return 0;
  const file = readAlertFile();
  const next = file.alerts.filter(alert => alert.budgetId !== budgetId);
  if (next.length === file.alerts.length) return 0;
  writeAlertFile({ version: 1, alerts: next });
  return file.alerts.length - next.length;
}

export function hasEnabledPauseUsageBudget(): boolean {
  return listUsageBudgets().some(budget => budget.enabled && budget.action === 'pause');
}

export function upsertUsageBudget(input: UsageBudgetInput): UsageBudget {
  const file = readFile();
  const now = new Date().toISOString();
  const id = cleanText(input.id, 160) || newId();
  const existing = file.budgets.find(item => item.id === id);
  const scope = normalizeScope(input.scope ?? existing?.scope);
  const scopeKey = scope === 'agent' || scope === 'model' ? cleanText(input.scopeKey ?? existing?.scopeKey, scope === 'model' ? 240 : 120) : undefined;
  if ((scope === 'agent' || scope === 'model') && !scopeKey) throw new Error('scopeKey is required for scoped budgets');
  const unit = normalizeUnit(input.unit ?? existing?.unit);
  const limitTokens = unit === 'tokens'
    ? (input.limitTokens == null && existing?.unit === 'tokens' ? existing.limitTokens : normalizeTokenLimit(input.limitTokens))
    : (existing?.limitTokens || 0);
  const limitUsd = unit === 'usd'
    ? (input.limitUsd == null && existing?.unit === 'usd' ? existing.limitUsd : normalizeUsdLimit(input.limitUsd))
    : (existing?.limitUsd || 0);
  const budget: UsageBudget = {
    id,
    name: cleanText(input.name, 160) || existing?.name || defaultBudgetName(scope, scopeKey, unit),
    scope,
    scopeKey,
    unit,
    limitTokens,
    limitUsd,
    period: normalizePeriod(input.period ?? existing?.period),
    action: normalizeAction(input.action ?? existing?.action),
    enabled: input.enabled == null ? existing?.enabled !== false : input.enabled !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = file.budgets.filter(item => item.id !== id);
  next.unshift(budget);
  writeFile({ version: 1, budgets: next });
  deleteUsageBudgetAlertsForBudget(id);
  return budget;
}

export function deleteUsageBudget(id: string): boolean {
  const budgetId = cleanText(id, 160);
  const file = readFile();
  const next = file.budgets.filter(item => item.id !== budgetId);
  if (next.length === file.budgets.length) return false;
  writeFile({ version: 1, budgets: next });
  deleteUsageBudgetAlertsForBudget(budgetId);
  return true;
}

export function recordUsageBudgetWarnAlertsForEvent(
  event: CostLedgerEvent,
  events: CostLedgerEvent[] = listCostLedgerEvents(1000),
): UsageBudgetAlert[] {
  const eventTime = Date.parse(event.createdAt);
  if (!Number.isFinite(eventTime)) return [];
  const budgets = listUsageBudgets().filter(budget => budget.enabled && budget.action === 'warn' && budgetMatchesEvent(budget, event));
  if (!budgets.length) return [];

  const ledgerEvents = events.some(item => item.id === event.id) ? events : [event, ...events];
  const alertFile = readAlertFile();
  const existingLatchKeys = new Set(alertFile.alerts.map(alert => usageBudgetAlertLatchKey(alert.budgetId, new Date(alert.periodStart))));
  const nextAlerts: UsageBudgetAlert[] = [];

  for (const budget of budgets) {
    const limit = budgetLimit(budget);
    const currentUsage = eventUsageForBudget(budget, event);
    if (limit <= 0 || currentUsage <= 0) continue;
    const start = periodStart(budget.period, new Date(eventTime));
    const startTime = start.getTime();
    const periodEvents = ledgerEvents.filter(item => {
      const time = Date.parse(item.createdAt);
      return Number.isFinite(time) && time >= startTime && time <= eventTime && budgetMatchesEvent(budget, item);
    });
    const usedAfter = Math.round(periodEvents.reduce((sum, item) => sum + eventUsageForBudget(budget, item), 0) * 10000) / 10000;
    const usedBefore = Math.max(0, Math.round((usedAfter - currentUsage) * 10000) / 10000);
    if (usedAfter < limit || usedBefore >= limit) continue;

    const latch = usageBudgetAlertLatchKey(budget.id, start);
    if (existingLatchKeys.has(latch)) continue;
    existingLatchKeys.add(latch);
    nextAlerts.push({
      id: newAlertId(),
      budgetId: budget.id,
      budgetName: budget.name,
      scope: budget.scope,
      scopeKey: budget.scopeKey,
      unit: budget.unit,
      limitTokens: budget.limitTokens,
      limitUsd: budget.limitUsd,
      usedTokens: budget.unit === 'tokens' ? Math.floor(usedAfter) : 0,
      usedUsd: budget.unit === 'usd' ? usedAfter : 0,
      period: budget.period,
      periodStart: start.toISOString(),
      eventId: event.id,
      agent: event.agent,
      model: event.model,
      channel: event.channel || null,
      sessionId: event.sessionId || null,
      createdAt: new Date().toISOString(),
    });
  }

  if (nextAlerts.length) {
    const alerts = [...nextAlerts, ...alertFile.alerts]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, MAX_USAGE_BUDGET_ALERTS);
    writeAlertFile({ version: 1, alerts });
  }
  return nextAlerts;
}

export function buildUsageBudgetStatuses(
  summary: UsageBudgetSummaryInput,
  at: Date = new Date(),
  opts: UsageBudgetStatusOptions = {},
): UsageBudgetStatus[] {
  return listUsageBudgets().map(budget => {
    const start = periodStart(budget.period, at);
    const { usedTokens, matchedChats } = budget.enabled
      ? usedTokensForBudget(budget, summary, start)
      : { usedTokens: 0, matchedChats: 0 };
    const { usedUsd, matchedEvents } = budget.enabled && budget.unit === 'usd'
      ? usedUsdForBudget(budget, opts.costLedgerEvents || [], start)
      : { usedUsd: 0, matchedEvents: 0 };
    const used = budget.unit === 'usd' ? usedUsd : usedTokens;
    const limit = budget.unit === 'usd' ? budget.limitUsd : budget.limitTokens;
    return {
      ...budget,
      usedTokens,
      usedUsd,
      usedPercent: limit > 0 ? (used / limit) * 100 : null,
      periodStart: start.toISOString(),
      periodEnd: at.toISOString(),
      state: budget.enabled ? budgetState(used, limit) : 'ok',
      matchedChats,
      matchedEvents,
    };
  });
}

function budgetMatchesGateContext(budget: UsageBudgetStatus, ctx: UsageBudgetGateContext): boolean {
  if (budget.scope === 'global') return true;
  if (budget.scope === 'model') {
    const model = typeof ctx.model === 'string' ? ctx.model.trim() : '';
    return !!model && budget.scopeKey === model;
  }
  const agent = typeof ctx.agent === 'string' ? ctx.agent.trim() : '';
  return !!agent && budget.scopeKey === agent;
}

export function evaluateUsageBudgetGate(
  budgets: UsageBudgetStatus[],
  ctx: UsageBudgetGateContext,
): UsageBudgetGateResult {
  const blocking = budgets
    .filter(budget => budget.enabled && budget.action === 'pause' && budget.state === 'over' && budgetMatchesGateContext(budget, ctx))
    .sort((a, b) => (b.usedPercent || 0) - (a.usedPercent || 0))[0];
  if (!blocking) return { allowed: true };
  const scope = blocking.scope !== 'global' && blocking.scopeKey ? ` for ${blocking.scopeKey}` : '';
  if (blocking.unit === 'usd') {
    return {
      allowed: false,
      budget: blocking,
      message: `${blocking.name} is over its ${blocking.period} spend budget${scope}: $${blocking.usedUsd.toFixed(2)}/$${blocking.limitUsd.toFixed(2)} used.`,
    };
  }
  return {
    allowed: false,
    budget: blocking,
    message: `${blocking.name} is over its ${blocking.period} token budget${scope}: ${blocking.usedTokens}/${blocking.limitTokens} tokens used.`,
  };
}
