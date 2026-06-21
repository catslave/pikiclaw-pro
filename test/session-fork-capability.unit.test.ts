import { describe, expect, it } from 'vitest';
import { summarizeForkCapability } from '../dashboard/src/pages/sessions/forkCapability';
import { getDriverCapabilities } from '../src/agent/index.ts';

describe('session fork capability summary', () => {
  it('labels Claude fork as a native branch session', () => {
    const summary = summarizeForkCapability(getDriverCapabilities('claude'));

    expect(summary.mode).toBe('native');
    expect(summary.label).toBe('Native branch');
    expect(summary.detail).toContain('Claude fork session');
  });

  it('labels Codex fork as a Pikiclaw portable branch handoff', () => {
    const summary = summarizeForkCapability(getDriverCapabilities('codex'));

    expect(summary.mode).toBe('portable');
    expect(summary.label).toBe('Portable branch');
    expect(summary.detail).toContain('app-server contract');
    expect(summary.title).toContain('handoff context');
  });

  it('labels Gemini fork as a portable branch when native fork is not verified', () => {
    const summary = summarizeForkCapability(getDriverCapabilities('gemini'));

    expect(summary.mode).toBe('portable');
    expect(summary.label).toBe('Portable branch');
    expect(summary.detail).toContain('No verified Gemini native fork protocol');
  });
});
