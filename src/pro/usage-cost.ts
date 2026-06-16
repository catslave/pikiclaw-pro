import { getModelsDevCatalog, type ModelsDevCatalog, type ModelsDevModel } from '../model/index.js';

export type UsageCostSource = 'estimated' | 'mixed' | 'unknown';

export interface UsageCostFields {
  estimatedCostUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
  costSource: UsageCostSource;
}

export interface UsageTokenSplit {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
}

type ModelCost = NonNullable<ModelsDevModel['cost']>;

export interface UsageCostEstimator {
  catalogReady: boolean;
  estimate(modelId: string | null | undefined, usage: UsageTokenSplit | null | undefined): UsageCostFields;
}

const CATALOG_TIMEOUT_MS = 1200;

function normalizedToken(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizedRate(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function emptyUsageCostFields(): UsageCostFields {
  return {
    estimatedCostUsd: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    costSource: 'unknown',
  };
}

export function resolveUsageCostSource(pricedTokens: number, unpricedTokens: number): UsageCostSource {
  if (pricedTokens > 0 && unpricedTokens > 0) return 'mixed';
  if (pricedTokens > 0) return 'estimated';
  return 'unknown';
}

export function mergeUsageCostFields(target: UsageCostFields, source: UsageCostFields): void {
  target.estimatedCostUsd += Math.max(0, Number(source.estimatedCostUsd || 0));
  target.pricedTokens += Math.max(0, Math.floor(Number(source.pricedTokens || 0)));
  target.unpricedTokens += Math.max(0, Math.floor(Number(source.unpricedTokens || 0)));
  target.costSource = resolveUsageCostSource(target.pricedTokens, target.unpricedTokens);
}

function hasUsableRates(cost: ModelCost | undefined): cost is ModelCost & { input: number; output: number } {
  return normalizedRate(cost?.input) !== undefined && normalizedRate(cost?.output) !== undefined;
}

function isMoreComplete(candidate: ModelCost, existing: ModelCost): boolean {
  const score = (cost: ModelCost): number => (cost.cache_read != null ? 2 : 0) + (cost.cache_write != null ? 1 : 0);
  return score(candidate) > score(existing);
}

function setPreferComplete(map: Map<string, ModelCost>, key: string, cost: ModelCost): void {
  if (!key) return;
  const existing = map.get(key);
  if (!existing || isMoreComplete(cost, existing)) map.set(key, cost);
}

export function buildUsageCostIndex(catalog: ModelsDevCatalog | null | undefined): Map<string, ModelCost> {
  const index = new Map<string, ModelCost>();
  if (!catalog) return index;
  for (const provider of Object.values(catalog)) {
    for (const [key, model] of Object.entries(provider.models || {})) {
      const cost = model?.cost;
      if (!cost || !hasUsableRates(cost)) continue;
      const ids = new Set([key, model.id].filter((value): value is string => typeof value === 'string' && !!value.trim()));
      for (const id of ids) {
        setPreferComplete(index, id, cost);
        const lower = id.toLowerCase();
        setPreferComplete(index, lower, cost);
        const lastSegment = lower.slice(lower.lastIndexOf('/') + 1);
        if (lastSegment !== lower) setPreferComplete(index, lastSegment, cost);
      }
    }
  }
  return index;
}

function lookupCost(index: Map<string, ModelCost>, modelId: string | null | undefined): ModelCost | undefined {
  const trimmed = String(modelId || '').trim();
  if (!trimmed) return undefined;
  return index.get(trimmed)
    || index.get(trimmed.toLowerCase())
    || index.get(trimmed.toLowerCase().slice(trimmed.lastIndexOf('/') + 1));
}

export function estimateUsageCost(index: Map<string, ModelCost>, modelId: string | null | undefined, usage: UsageTokenSplit | null | undefined): UsageCostFields {
  const input = normalizedToken(usage?.inputTokens);
  const output = normalizedToken(usage?.outputTokens);
  const cacheRead = normalizedToken(usage?.cachedInputTokens);
  const billableTokens = input + output + cacheRead;
  if (!billableTokens) return emptyUsageCostFields();

  const cost = lookupCost(index, modelId);
  if (!hasUsableRates(cost)) {
    return {
      estimatedCostUsd: 0,
      pricedTokens: 0,
      unpricedTokens: billableTokens,
      costSource: 'unknown',
    };
  }

  const inputRate = normalizedRate(cost.input)!;
  const outputRate = normalizedRate(cost.output)!;
  const cacheReadRate = normalizedRate(cost.cache_read) ?? inputRate;
  return {
    estimatedCostUsd: ((input / 1_000_000) * inputRate) + ((output / 1_000_000) * outputRate) + ((cacheRead / 1_000_000) * cacheReadRate),
    pricedTokens: billableTokens,
    unpricedTokens: 0,
    costSource: 'estimated',
  };
}

async function loadCatalogWithinTimeout(): Promise<ModelsDevCatalog | null> {
  const catalog = getModelsDevCatalog().catch(() => null);
  const timeout = new Promise<null>(resolve => {
    const timer = setTimeout(() => resolve(null), CATALOG_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([catalog, timeout]);
}

export async function createUsageCostEstimator(): Promise<UsageCostEstimator> {
  const catalog = await loadCatalogWithinTimeout();
  const index = buildUsageCostIndex(catalog);
  return {
    catalogReady: index.size > 0,
    estimate: (modelId, usage) => estimateUsageCost(index, modelId, usage),
  };
}
