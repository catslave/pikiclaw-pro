import { describe, expect, it } from 'vitest';
import { summarizeGoalCapability } from '../dashboard/src/pages/sessions/goalCapability';
import { getDriverCapabilities } from '../src/agent/index.ts';

describe('session goal capability summary', () => {
  it('labels Codex goal state as native and fully controllable', () => {
    const summary = summarizeGoalCapability(getDriverCapabilities('codex').goal);

    expect(summary.label).toBe('Native goal');
    expect(summary.mode).toBe('native');
    expect(summary.controlHint).toBeNull();
    expect(summary.detail).toContain('thread/goal');
  });

  it('surfaces Claude native goal lifecycle limits', () => {
    const summary = summarizeGoalCapability(getDriverCapabilities('claude').goal);

    expect(summary.label).toBe('Native goal');
    expect(summary.mode).toBe('native');
    expect(summary.controlHint).toBe('Pause/resume unavailable');
    expect(summary.title).toContain('pause/resume');
  });

  it('marks Gemini goal as Pikiclaw portable state', () => {
    const summary = summarizeGoalCapability(getDriverCapabilities('gemini').goal);

    expect(summary.label).toBe('Portable goal');
    expect(summary.mode).toBe('portable');
    expect(summary.controlHint).toBeNull();
    expect(summary.detail).toContain('pikiclaw goal.json');
  });

  it('handles missing goal capability defensively', () => {
    const summary = summarizeGoalCapability(null);

    expect(summary.label).toBe('Goal unsupported');
    expect(summary.mode).toBe('unsupported');
    expect(summary.detail).toContain('No verified goal contract');
  });
});
