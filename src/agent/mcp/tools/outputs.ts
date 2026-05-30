/**
 * Session output tools.
 *
 * Lets an agent register generated documents/reports with the current chat so
 * the dashboard can surface them in the Output tab.
 */

import fs from 'node:fs';
import type { McpToolModule, ToolContext, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';
import { resolveOutputPathAlias, saveSessionOutput, SESSION_OUTPUT_KINDS } from '../../session-outputs.js';

const tools: McpToolModule['tools'] = [
  {
    name: 'pikiclaw_save_output',
    description: 'Register or create a generated document/report/output for the current Pikiclaw chat. Use this after producing a plan, analysis report, durable markdown note, generated file, image, diff summary, or final deliverable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Optional stable id when updating the same output across turns.',
        },
        title: {
          type: 'string',
          description: 'Short human-readable title for the output.',
        },
        kind: {
          type: 'string',
          enum: SESSION_OUTPUT_KINDS,
          description: 'Output kind. Use document for markdown plans/reports.',
        },
        summary: {
          type: 'string',
          description: 'Brief preview shown in the Output tab.',
        },
        path: {
          type: 'string',
          description: 'Existing file path to register. Supports absolute paths, @workspace/..., @workdir/..., ~/..., or workspace-relative paths.',
        },
        url: {
          type: 'string',
          description: 'External URL to register when the output lives outside the local filesystem.',
        },
        content: {
          type: 'string',
          description: 'Markdown content to save into the session workspace when no durable file already exists.',
        },
        pinned: {
          type: 'boolean',
          description: 'Whether to pin this output.',
        },
      },
      required: ['title'],
    },
  },
];

function summarize(value: string, max = 180): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function handleSaveOutput(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return toolResult('Error: title is required', true);
  if (!ctx.workspace) return toolResult('Error: session workspace is unavailable', true);

  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  const resolvedPath = rawPath ? resolveOutputPathAlias(rawPath, ctx.workspace, ctx.workdir) : '';
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    return toolResult(`Error: output file does not exist: ${resolvedPath}`, true);
  }

  const output = saveSessionOutput({
    workspacePath: ctx.workspace,
    workdir: ctx.workdir,
    agent: ctx.agent,
    sessionId: ctx.sessionId,
    input: {
      title,
      id: typeof args.id === 'string' ? args.id : undefined,
      kind: SESSION_OUTPUT_KINDS.includes(args.kind as any) ? args.kind as any : undefined,
      summary: typeof args.summary === 'string' ? args.summary : undefined,
      path: resolvedPath || undefined,
      url: typeof args.url === 'string' ? args.url : undefined,
      content: typeof args.content === 'string' ? args.content : undefined,
      pinned: args.pinned === true,
    },
  });
  toolLog('pikiclaw_save_output', `OK ${output.id} title=${JSON.stringify(summarize(output.title))} path=${output.path || '(none)'}`);
  return toolResult(JSON.stringify({ ok: true, output }, null, 2));
}

export const outputTools: McpToolModule = {
  tools,
  handle(name, args, ctx) {
    switch (name) {
      case 'pikiclaw_save_output': return handleSaveOutput(args, ctx);
      default: return toolResult(`Unknown output tool: ${name}`, true);
    }
  },
};
