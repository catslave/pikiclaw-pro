import { describe, expect, it } from 'vitest';
import {
  batchConversationExportFilename,
  composeBatchConversationMarkdown,
} from '../dashboard/src/pages/wayland/conversationExport.ts';

describe('Wayland conversation batch export', () => {
  it('builds a deterministic batch filename', () => {
    expect(batchConversationExportFilename(3, new Date('2026-06-13T02:03:04.000Z'))).toBe('conversations-3-2026-06-13T02-03-04.md');
  });

  it('composes selected conversations and failed exports into one markdown artifact', () => {
    const markdown = composeBatchConversationMarkdown([
      {
        title: 'Trace Analysis',
        workspaceName: 'IVAR-NG',
        workdir: '/repo/ivar-ng',
        agent: 'codex',
        sessionId: 'sess-1',
        filename: 'session-codex-sess-1.md',
        content: '# Session Export\n\n[user]\nInvestigate trace.',
      },
      {
        title: 'Release Plan',
        workspaceName: 'Pikiclaw Pro',
        workdir: '/repo/pikiclaw',
        agent: 'claude',
        sessionId: 'sess-2',
        content: '[assistant]\nPlan ready.',
      },
    ], {
      exportedAt: '2026-06-13T10:00:00.000Z',
      errors: [{
        title: 'Broken Session',
        workspaceName: 'Archive',
        workdir: '/repo/archive',
        agent: 'codex',
        sessionId: 'missing',
        error: 'No conversation found.',
      }],
    });

    expect(markdown).toContain('# Pikiclaw Conversation Export');
    expect(markdown).toContain('- Conversations: 2');
    expect(markdown).toContain('- Failed: 1');
    expect(markdown).toContain('1. Trace Analysis - IVAR-NG - codex');
    expect(markdown).toContain('## Failed Exports');
    expect(markdown).toContain('Broken Session - Archive - codex - No conversation found.');
    expect(markdown).toContain('## Conversation 1: Trace Analysis');
    expect(markdown).toContain('- Source export: session-codex-sess-1.md');
    expect(markdown).toContain('Investigate trace.');
    expect(markdown).toContain('## Conversation 2: Release Plan');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});
