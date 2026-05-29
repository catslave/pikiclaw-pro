/**
 * Local GitHub Copilot auth bridge.
 *
 * Copilot CLI accepts GitHub tokens via env vars, but it does not always read
 * OAuth records already written by IDE Copilot integrations. When no explicit
 * token env is present, reuse those local records for child processes only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return text;
  }
  return '';
}

function readCopilotOauthToken(home = os.homedir()): string {
  const oauth = readJson(path.join(home, '.config', 'github-copilot', 'oauth.json'));
  const records = (oauth as any)?.['https://github.com/login/oauth'];
  if (Array.isArray(records)) {
    for (const record of records) {
      const token = firstString(record?.accessToken);
      if (token) return token;
    }
  }

  const apps = readJson(path.join(home, '.config', 'github-copilot', 'apps.json'));
  if (apps && typeof apps === 'object') {
    for (const record of Object.values(apps as Record<string, any>)) {
      const token = firstString(record?.oauth_token, record?.accessToken);
      if (token) return token;
    }
  }
  return '';
}

export function copilotAuthEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (firstString(env.COPILOT_GITHUB_TOKEN, env.GH_TOKEN, env.GITHUB_TOKEN)) return {};
  const token = readCopilotOauthToken();
  return token ? { COPILOT_GITHUB_TOKEN: token } : {};
}
