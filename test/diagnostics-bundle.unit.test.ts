import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDiagnosticsBundle,
  checkDiagnosticsRateLimit,
  redactDiagnosticsValue,
  resetDiagnosticsRateLimitForTests,
} from '../src/core/diagnostics-bundle.ts';

describe('diagnostics bundle', () => {
  afterEach(() => {
    resetDiagnosticsRateLimitForTests();
  });

  it('redacts sensitive config values recursively', () => {
    const redacted = redactDiagnosticsValue({
      workdir: '/tmp/project',
      telegramBotToken: '123456:telegram-secret',
      extensions: {
        mcpTokens: {
          github: {
            accessToken: 'ghp_abcdefghijklmnopqrstuvwxyz',
            refreshToken: 'refresh-secret',
          },
        },
      },
      models: {
        providers: {
          openai: {
            apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz',
          },
        },
      },
    }) as Record<string, unknown>;

    expect(redacted.workdir).toBe('/tmp/project');
    expect(JSON.stringify(redacted)).not.toContain('telegram-secret');
    expect(JSON.stringify(redacted)).not.toContain('ghp_');
    expect(JSON.stringify(redacted)).not.toContain('sk-proj');
    expect(JSON.stringify(redacted)).toContain('[REDACTED]');
  });

  it('builds a gzip json bundle with redacted logs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-diagnostics-'));
    const logPath = path.join(dir, 'dev.log');
    fs.writeFileSync(logPath, [
      'runtime ready',
      'api_key=sk-proj-abcdefghijklmnopqrstuvwxyz',
      'finished cleanly',
    ].join('\n'));

    const bundle = buildDiagnosticsBundle({
      now: new Date('2026-06-13T00:00:00.000Z'),
      configPath: path.join(dir, 'setting.json'),
      config: {
        workdir: dir,
        slackBotToken: 'xoxb-secret-token',
      },
      runtime: {
        dashboardAttached: true,
        workdir: dir,
        defaultAgent: 'codex',
        defaultModel: 'gpt-5',
      },
      env: {
        NODE_ENV: 'test',
        TELEGRAM_BOT_TOKEN: 'should-not-be-picked',
      },
      logPaths: [logPath],
      homeDir: dir,
      cwd: dir,
      pid: 123,
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v22.0.0',
    });

    expect(bundle.filename).toBe('pikiclaw-diagnostics-2026-06-13T00-00-00-000Z.json.gz');
    const payload = JSON.parse(zlib.gunzipSync(bundle.data).toString('utf8')) as {
      app: { name: string };
      config: { data: unknown };
      environment: Record<string, string>;
      logs: Array<{ content?: string }>;
    };
    const serialized = JSON.stringify(payload);
    expect(payload.app.name).toBe('pikiclaw');
    expect(payload.environment.NODE_ENV).toBe('test');
    expect(serialized).not.toContain('xoxb-secret-token');
    expect(serialized).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz');
    expect(serialized).not.toContain('should-not-be-picked');
    expect(payload.logs[0]?.content).toContain('api_key=[REDACTED]');
  });

  it('rate limits repeated bundle collection attempts', () => {
    const start = Date.parse('2026-06-13T00:00:00.000Z');
    for (let index = 0; index < 5; index += 1) {
      expect(checkDiagnosticsRateLimit(start + index).allowed).toBe(true);
    }
    const blocked = checkDiagnosticsRateLimit(start + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    expect(checkDiagnosticsRateLimit(start + 61_000).allowed).toBe(true);
  });
});
