import { afterEach, describe, expect, it } from 'vitest';
import {
  createFocusSandbox,
  listFocusSandboxes,
  promoteFocusSandbox,
  resetFocusSandboxStoreForTests,
  updateFocusSandbox,
} from '../src/dashboard/focus-sandbox-store.ts';
import { FOCUS_ACTIVE_SANDBOX_CAP } from '../src/pro/sandbox.ts';

describe('focus sandbox store', () => {
  afterEach(() => {
    resetFocusSandboxStoreForTests();
  });

  it('creates typed sandboxes', () => {
    const sandbox = createFocusSandbox({
      kind: 'bug',
      title: 'Fix redirect',
      workdir: '/repo/app',
      jiraKey: 'APP-1',
    });
    expect(sandbox.kind).toBe('bug');
    expect(sandbox.state).toBe('active');
    expect(listFocusSandboxes()).toHaveLength(1);
  });

  it('transitions active to paused to completed', () => {
    const sandbox = createFocusSandbox({ kind: 'todo', title: 'Todo', workdir: '/repo/app' });
    const paused = updateFocusSandbox(sandbox.id, { state: 'paused' });
    expect(paused?.state).toBe('paused');
    const completed = updateFocusSandbox(sandbox.id, { state: 'completed' });
    expect(completed?.state).toBe('completed');
    expect(completed?.completedAt).toBeTruthy();
  });

  it('demotes overflow active sandboxes when cap exceeded', () => {
    for (let i = 0; i < FOCUS_ACTIVE_SANDBOX_CAP + 1; i += 1) {
      createFocusSandbox({ kind: 'chat', title: `Sandbox ${i}`, workdir: '/repo/app' });
    }
    const active = listFocusSandboxes({ state: 'active' });
    expect(active.length).toBeLessThanOrEqual(FOCUS_ACTIVE_SANDBOX_CAP);
  });

  it('promotes paused sandbox back to active', () => {
    const sandbox = createFocusSandbox({ kind: 'review', title: 'Review MR', workdir: '/repo/app' });
    updateFocusSandbox(sandbox.id, { state: 'paused' });
    const promoted = promoteFocusSandbox(sandbox.id);
    expect(promoted?.state).toBe('active');
  });
});
