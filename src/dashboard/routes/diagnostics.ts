import { Hono } from 'hono';
import {
  buildDiagnosticsBundle,
  checkDiagnosticsRateLimit,
  type DiagnosticsRuntimeSnapshot,
} from '../../core/diagnostics-bundle.js';
import { loadUserConfig } from '../../core/config/user-config.js';
import { runtime } from '../runtime.js';

const app = new Hono();

function runtimeSnapshot(): DiagnosticsRuntimeSnapshot {
  const config = loadUserConfig();
  const defaultAgent = runtime.getRuntimeDefaultAgent(config);
  return {
    dashboardAttached: Boolean(runtime.getBotRef()),
    workdir: runtime.getRequestWorkdir(config),
    defaultAgent,
    defaultModel: runtime.getRuntimeModel(defaultAgent, config) || null,
    knownAgents: Array.from(runtime.knownAgents).sort(),
  };
}

app.get('/api/diagnostics/bundle', async (c) => {
  const rate = checkDiagnosticsRateLimit();
  if (!rate.allowed) {
    const retryAfter = Math.ceil((rate.retryAfterMs || 1000) / 1000);
    c.header('Retry-After', String(retryAfter));
    return c.json({ ok: false, error: 'Diagnostics bundle rate limit exceeded. Try again shortly.' }, 429);
  }

  try {
    const bundle = buildDiagnosticsBundle({ runtime: runtimeSnapshot() });
    return new Response(new Uint8Array(bundle.data), {
      headers: {
        'Content-Type': bundle.contentType,
        'Content-Disposition': `attachment; filename="${bundle.filename}"`,
        'Cache-Control': 'no-store',
        'X-Pikiclaw-Diagnostics-Bytes': String(bundle.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'Diagnostics bundle failed.');
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
