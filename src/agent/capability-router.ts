import type { Agent } from './types.js';

const OPENCLAW_CAPABILITY_ROUTING_ENABLED = false;

export type RoutedCapability = 'web_reading' | 'cursor_perspective' | 'cross_check';

export interface CapabilityRouteDecision {
  capability: RoutedCapability;
  agent: Agent;
  openclawAgent: 'codex' | 'cursor';
  prompt: string;
  reason: string;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/i;

function normalized(input: string): string {
  return input.trim().toLowerCase();
}

function isSlashCommand(input: string): boolean {
  return /^\/[a-z0-9_-]+(?:\s|$)/i.test(input.trim());
}

function autoCrossCheckLane(input: string): 'codex' | 'cursor' | null {
  const match = input.trim().match(/^\[Pikiclaw Auto Cross-check:\s*(Codex|Cursor)\]/i);
  if (!match) return null;
  return match[1].toLowerCase() as 'codex' | 'cursor';
}

function isAutoSynthesis(input: string): boolean {
  return /^\[Pikiclaw Auto Synthesis\]/i.test(input.trim());
}

function isInternalParallelPrompt(input: string): boolean {
  return /^Multi-agent run:\s*\S+/i.test(input.trim());
}

function mentionsWebReading(input: string): boolean {
  const text = normalized(input);
  if (URL_RE.test(input)) return true;
  return [
    '打开网页',
    '打开页面',
    '阅读网页',
    '阅读页面',
    '读网页',
    '读页面',
    '总结网页',
    '总结页面',
    '看这个链接',
    'read this page',
    'read this url',
    'open this page',
    'open this url',
    'summarize this page',
    'summarize this url',
  ].some(pattern => text.includes(pattern));
}

function mentionsCursorPerspective(input: string): boolean {
  const text = normalized(input);
  return [
    'cursor 视角',
    'cursor视角',
    'ide 视角',
    'ide视角',
    '编辑器视角',
    '从 cursor',
    '用 cursor',
    'cursor perspective',
    'ide perspective',
  ].some(pattern => text.includes(pattern));
}

function mentionsCrossCheck(input: string): boolean {
  const text = normalized(input);
  return [
    '交叉检查',
    '交叉验证',
    '多个 agent',
    '多 agent',
    'multi agent',
    'multi-agent',
    'cross check',
    'cross-check',
    'second opinion',
    '再确认一下',
  ].some(pattern => text.includes(pattern));
}

function prependCapabilityPrompt(capability: RoutedCapability, userPrompt: string): string {
  const header = capability === 'web_reading'
    ? [
      'Pikiclaw selected its web-reading capability for this request.',
      'Use OpenClaw Gateway browser/page-reading tools when available. The user should not need to know OpenClaw is being used.',
      'Open the URL or page described by the user, read the visible content, then answer with a concise summary and any important caveats.',
    ]
    : capability === 'cursor_perspective'
      ? [
        'Pikiclaw selected its IDE/Cursor perspective capability for this request.',
        'Use the OpenClaw Cursor agent context when available. Focus on what Cursor/IDE context can add, and avoid explaining the backend plumbing.',
      ]
      : [
        'Pikiclaw selected its multi-agent cross-check capability for this request.',
        'Use OpenClaw Gateway as a composite backend. Cross-check the request from Codex and Cursor perspectives when available, then merge the result into one answer.',
        'Call out disagreements or uncertainty clearly, without exposing ACP/Gateway implementation details unless the user asks.',
      ];

  return `${header.join('\n')}\n\nUser request:\n${userPrompt}`;
}

export function resolveCapabilityRoute(opts: {
  prompt: string;
  selectedAgent: Agent;
  attachments?: string[];
  openclawAvailable?: boolean;
}): CapabilityRouteDecision | null {
  const prompt = opts.prompt || '';
  if (!prompt.trim()) return null;
  if (opts.selectedAgent === 'openclaw') return null;
  if (isAutoSynthesis(prompt)) return null;
  if (isInternalParallelPrompt(prompt)) return null;
  const lane = autoCrossCheckLane(prompt);
  if (lane === 'codex') return null;
  if (lane === 'cursor') {
    return {
      capability: 'cursor_perspective',
      agent: 'cursor',
      openclawAgent: 'cursor',
      prompt: prependCapabilityPrompt('cursor_perspective', prompt),
      reason: 'auto cross-check Cursor lane via native Cursor agent',
    };
  }
  if (isSlashCommand(prompt)) return null;
  if (!OPENCLAW_CAPABILITY_ROUTING_ENABLED && (mentionsWebReading(prompt) || mentionsCrossCheck(prompt))) return null;

  if (mentionsCursorPerspective(prompt)) {
    return {
      capability: 'cursor_perspective',
      agent: 'cursor',
      openclawAgent: 'cursor',
      prompt: prependCapabilityPrompt('cursor_perspective', prompt),
      reason: 'IDE/Cursor perspective requested via native Cursor agent',
    };
  }

  if (mentionsCrossCheck(prompt)) {
    if (opts.openclawAvailable === false) return null;
    return {
      capability: 'cross_check',
      agent: 'openclaw',
      openclawAgent: 'codex',
      prompt: prependCapabilityPrompt('cross_check', prompt),
      reason: 'multi-agent cross-check requested',
    };
  }

  if (mentionsWebReading(prompt)) {
    if (opts.openclawAvailable === false) return null;
    return {
      capability: 'web_reading',
      agent: 'openclaw',
      openclawAgent: 'codex',
      prompt: prependCapabilityPrompt('web_reading', prompt),
      reason: 'web/page reading requested',
    };
  }

  return null;
}
