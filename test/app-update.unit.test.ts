import { describe, expect, it } from 'vitest';
import {
  buildAppUpdateStatus,
  compareAppVersions,
} from '../src/core/app-update.ts';

describe('app update status', () => {
  it('compares semantic versions numerically', () => {
    expect(compareAppVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareAppVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareAppVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareAppVersions('v2.1.0', '2.0.9')).toBe(1);
  });

  it('builds npm-native update status', () => {
    const current = buildAppUpdateStatus('0.4.0', '0.5.0', '2026-06-13T00:00:00.000Z');
    expect(current).toMatchObject({
      ok: true,
      packageName: 'pikiclaw',
      currentVersion: '0.4.0',
      latestVersion: '0.5.0',
      updateAvailable: true,
      installCommand: 'npm install -g pikiclaw@latest',
    });

    const upToDate = buildAppUpdateStatus('0.5.0', '0.5.0', '2026-06-13T00:00:00.000Z');
    expect(upToDate.updateAvailable).toBe(false);
    expect(upToDate.detail).toContain('current');
  });
});
