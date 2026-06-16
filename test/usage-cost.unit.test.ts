import { describe, expect, it } from 'vitest';
import { buildUsageCostIndex, emptyUsageCostFields, estimateUsageCost, mergeUsageCostFields } from '../src/pro/usage-cost.js';
import type { ModelsDevCatalog } from '../src/model/index.js';

const catalog: ModelsDevCatalog = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-sonnet-4': {
        id: 'claude-sonnet-4',
        cost: {
          input: 3,
          output: 15,
          cache_read: 0.3,
        },
      },
    },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: {
      'openrouter/solar-mini': {
        id: 'openrouter/solar-mini',
        cost: {
          input: 0.15,
          output: 0.6,
        },
      },
    },
  },
};

function closeTo(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9);
}

describe('usage cost estimator', () => {
  it('prices input, output, and cache read tokens from models.dev cost metadata', () => {
    const index = buildUsageCostIndex(catalog);
    const estimate = estimateUsageCost(index, 'claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 2_000_000,
    });

    closeTo(estimate.estimatedCostUsd, 11.1);
    expect(estimate).toMatchObject({
      pricedTokens: 3_500_000,
      unpricedTokens: 0,
      costSource: 'estimated',
    });
  });

  it('resolves provider-prefixed model ids by their last segment', () => {
    const index = buildUsageCostIndex(catalog);
    const estimate = estimateUsageCost(index, 'anthropic/claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    closeTo(estimate.estimatedCostUsd, 3);
    expect(estimate.pricedTokens).toBe(1_000_000);
  });

  it('keeps unknown model usage as unpriced instead of guessing a rate', () => {
    const index = buildUsageCostIndex(catalog);
    const estimate = estimateUsageCost(index, 'unknown-model', {
      inputTokens: 1000,
      outputTokens: 250,
      cachedInputTokens: 500,
    });

    expect(estimate).toEqual({
      estimatedCostUsd: 0,
      pricedTokens: 0,
      unpricedTokens: 1750,
      costSource: 'unknown',
    });
  });

  it('marks aggregate cost as mixed when priced and unpriced usage are merged', () => {
    const total = emptyUsageCostFields();
    mergeUsageCostFields(total, {
      estimatedCostUsd: 1,
      pricedTokens: 1000,
      unpricedTokens: 0,
      costSource: 'estimated',
    });
    mergeUsageCostFields(total, {
      estimatedCostUsd: 0,
      pricedTokens: 0,
      unpricedTokens: 500,
      costSource: 'unknown',
    });

    expect(total).toEqual({
      estimatedCostUsd: 1,
      pricedTokens: 1000,
      unpricedTokens: 500,
      costSource: 'mixed',
    });
  });
});
