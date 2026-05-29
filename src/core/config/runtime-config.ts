/**
 * Runtime resolution of agent model and effort preferences.
 */

import type { Agent } from '../../agent/index.js';
import { normalizeClaudeModelId } from '../../agent/index.js';
import type { UserConfig } from './user-config.js';

export const DEFAULT_AGENT_MODELS: Record<Agent, string> = {
  claude: 'claude-opus-4-7',
  codex: 'gpt-5.5',
  copilot: 'gpt-5.3-codex',
  cursor: 'auto',
  gemini: 'gemini-3.1-pro-preview',
  hermes: 'anthropic/claude-sonnet-4',
  openclaw: '',
};

export const DEFAULT_AGENT_EFFORTS: Partial<Record<Agent, string>> = {
  claude: 'high',
  codex: 'medium',
  copilot: 'medium',
  cursor: 'medium',
  gemini: 'high',
  hermes: 'medium',
  openclaw: 'medium',
};

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function agentModelEnv(agent: Agent, env: Record<string, string | undefined> = process.env): string {
  switch (agent) {
    case 'claude': return trimmed(env.CLAUDE_MODEL);
    case 'codex': return trimmed(env.CODEX_MODEL);
    case 'copilot': return trimmed(env.COPILOT_MODEL);
    case 'cursor': return trimmed(env.CURSOR_MODEL);
    case 'gemini': return trimmed(env.GEMINI_MODEL);
    case 'hermes': return trimmed(env.HERMES_MODEL);
    case 'openclaw': return trimmed(env.OPENCLAW_MODEL);
  }
  return '';
}

export function agentEffortEnv(agent: Agent, env: Record<string, string | undefined> = process.env): string {
  switch (agent) {
    case 'claude': return trimmed(env.CLAUDE_REASONING_EFFORT).toLowerCase();
    case 'codex': return trimmed(env.CODEX_REASONING_EFFORT).toLowerCase();
    case 'copilot': return trimmed(env.COPILOT_REASONING_EFFORT).toLowerCase();
    case 'cursor': return trimmed(env.CURSOR_REASONING_EFFORT).toLowerCase();
    case 'gemini': return trimmed(env.GEMINI_REASONING_EFFORT).toLowerCase();
    case 'hermes': return trimmed(env.HERMES_REASONING_EFFORT).toLowerCase();
    case 'openclaw': return trimmed(env.OPENCLAW_REASONING_EFFORT).toLowerCase();
  }
  return '';
}

export function resolveAgentModel(config: Partial<UserConfig> | Record<string, any>, agent: Agent): string {
  let value = '';
  switch (agent) {
    case 'claude':
      value = trimmed((config as Partial<UserConfig>).claudeModel || agentModelEnv('claude') || DEFAULT_AGENT_MODELS.claude);
      return normalizeClaudeModelId(value);
    case 'codex':
      value = trimmed((config as Partial<UserConfig>).codexModel || agentModelEnv('codex') || DEFAULT_AGENT_MODELS.codex);
      return value || DEFAULT_AGENT_MODELS.codex;
    case 'copilot':
      value = trimmed((config as Partial<UserConfig>).copilotModel || agentModelEnv('copilot') || DEFAULT_AGENT_MODELS.copilot);
      return value || DEFAULT_AGENT_MODELS.copilot;
    case 'cursor':
      value = trimmed((config as Partial<UserConfig>).cursorModel || agentModelEnv('cursor') || DEFAULT_AGENT_MODELS.cursor);
      if (value === 'gpt-5') return DEFAULT_AGENT_MODELS.cursor;
      return value || DEFAULT_AGENT_MODELS.cursor;
    case 'gemini':
      value = trimmed((config as Partial<UserConfig>).geminiModel || agentModelEnv('gemini') || DEFAULT_AGENT_MODELS.gemini);
      return value || DEFAULT_AGENT_MODELS.gemini;
    case 'hermes':
      value = trimmed((config as Partial<UserConfig>).hermesModel || agentModelEnv('hermes') || DEFAULT_AGENT_MODELS.hermes);
      return value || DEFAULT_AGENT_MODELS.hermes;
    case 'openclaw':
      value = trimmed((config as Partial<UserConfig>).openclawModel || agentModelEnv('openclaw') || DEFAULT_AGENT_MODELS.openclaw);
      return value || DEFAULT_AGENT_MODELS.openclaw;
  }
  return '';
}

export function resolveAgentEffort(config: Partial<UserConfig> | Record<string, any>, agent: Agent): string | null {
  switch (agent) {
    case 'claude': {
      const value = trimmed((config as Partial<UserConfig>).claudeReasoningEffort || agentEffortEnv('claude') || DEFAULT_AGENT_EFFORTS.claude).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.claude || null;
    }
    case 'codex': {
      const value = trimmed((config as Partial<UserConfig>).codexReasoningEffort || agentEffortEnv('codex') || DEFAULT_AGENT_EFFORTS.codex).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.codex || null;
    }
    case 'copilot': {
      const value = trimmed((config as Partial<UserConfig>).copilotReasoningEffort || agentEffortEnv('copilot') || DEFAULT_AGENT_EFFORTS.copilot).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.copilot || null;
    }
    case 'cursor': {
      const value = trimmed((config as Partial<UserConfig>).cursorReasoningEffort || agentEffortEnv('cursor') || DEFAULT_AGENT_EFFORTS.cursor).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.cursor || null;
    }
    case 'gemini': {
      const value = trimmed((config as Partial<UserConfig>).geminiReasoningEffort || agentEffortEnv('gemini') || DEFAULT_AGENT_EFFORTS.gemini).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.gemini || null;
    }
    case 'hermes': {
      const value = trimmed((config as Partial<UserConfig>).hermesReasoningEffort || agentEffortEnv('hermes') || DEFAULT_AGENT_EFFORTS.hermes).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.hermes || null;
    }
    case 'openclaw': {
      const value = trimmed((config as Partial<UserConfig>).openclawReasoningEffort || agentEffortEnv('openclaw') || DEFAULT_AGENT_EFFORTS.openclaw).toLowerCase();
      return value || DEFAULT_AGENT_EFFORTS.openclaw || null;
    }
  }
  return null;
}

export function setAgentModelEnv(agent: Agent, value: string, env: NodeJS.ProcessEnv = process.env): void {
  switch (agent) {
    case 'claude': env.CLAUDE_MODEL = value; break;
    case 'codex': env.CODEX_MODEL = value; break;
    case 'copilot': env.COPILOT_MODEL = value; break;
    case 'cursor': env.CURSOR_MODEL = value; break;
    case 'gemini': env.GEMINI_MODEL = value; break;
    case 'hermes': env.HERMES_MODEL = value; break;
    case 'openclaw': env.OPENCLAW_MODEL = value; break;
  }
}

export function setAgentEffortEnv(agent: Agent, value: string, env: NodeJS.ProcessEnv = process.env): void {
  switch (agent) {
    case 'claude': env.CLAUDE_REASONING_EFFORT = value; break;
    case 'codex': env.CODEX_REASONING_EFFORT = value; break;
    case 'copilot': env.COPILOT_REASONING_EFFORT = value; break;
    case 'cursor': env.CURSOR_REASONING_EFFORT = value; break;
    case 'gemini': env.GEMINI_REASONING_EFFORT = value; break;
    case 'hermes': env.HERMES_REASONING_EFFORT = value; break;
    case 'openclaw': env.OPENCLAW_REASONING_EFFORT = value; break;
  }
}
