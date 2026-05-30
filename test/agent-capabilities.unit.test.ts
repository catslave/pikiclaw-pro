import { describe, expect, it } from 'vitest';
import { allDriverIds, getDriverCapabilities } from '../src/agent/index.ts';

describe('agent capability matrix', () => {
  it('declares plan and goal modes for every integrated driver', () => {
    const ids = allDriverIds().sort();
    expect(ids).toEqual(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'hermes', 'openclaw']);

    for (const id of ids) {
      const caps = getDriverCapabilities(id);
      expect(caps.plan?.mode).toMatch(/^(native|portable|unsupported)$/);
      expect(caps.goal?.mode).toMatch(/^(native|portable|unsupported)$/);
      expect(caps.humanInput?.mode).toMatch(/^(native|portable|unsupported)$/);
      expect(caps.resume?.mode).toMatch(/^(native|portable|unsupported)$/);
    }
  });

  it('marks only verified first-party planning paths as native', () => {
    expect(getDriverCapabilities('codex').plan?.mode).toBe('native');
    expect(getDriverCapabilities('claude').plan?.mode).toBe('native');
    expect(getDriverCapabilities('gemini').plan?.mode).toBe('native');
    expect(getDriverCapabilities('hermes').plan?.mode).toBe('unsupported');
    expect(getDriverCapabilities('copilot').plan?.mode).toBe('portable');
    expect(getDriverCapabilities('cursor').plan?.mode).toBe('portable');
    expect(getDriverCapabilities('openclaw').plan?.mode).toBe('portable');
  });

  it('keeps native goal ownership limited to codex and claude', () => {
    expect(getDriverCapabilities('codex').goal?.source).toContain('thread/goal');
    expect(getDriverCapabilities('codex').goal?.mode).toBe('native');
    expect(getDriverCapabilities('claude').goal?.mode).toBe('native');
    for (const id of ['copilot', 'cursor', 'gemini', 'hermes', 'openclaw']) {
      expect(getDriverCapabilities(id).goal?.mode).toBe('portable');
    }
  });
});
