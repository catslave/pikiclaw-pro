import { describe, expect, it } from 'vitest';
import { categorizeAssistantBlocks, ensureRichMessageBlocks } from '../dashboard/src/pages/sessions/AssistantContent.tsx';
import { buildGeneratedOutputInsights } from '../dashboard/src/pages/sessions/GeneratedOutputCards.tsx';
import type { RichMessage } from '../dashboard/src/types.ts';
import type { MessageBlock } from '../dashboard/src/types.ts';

describe('AssistantContent block categorization', () => {
  it('routes explicit commentary blocks into working narrative instead of final output', () => {
    const commentary: MessageBlock = {
      type: 'text',
      content: 'Tracing the Codex stream pipeline first.',
      phase: 'commentary',
    };
    const toolUse: MessageBlock = {
      type: 'tool_use',
      content: '{"cmd":"rg -n \\"stream\\" src"}',
      toolName: 'exec_command',
      toolId: 'call-1',
    };
    const toolResult: MessageBlock = {
      type: 'tool_result',
      content: 'src/bot.ts:610: snap.plan = event.plan?.steps?.length ? event.plan : null;',
      toolName: 'exec_command',
      toolId: 'call-1',
    };
    const finalAnswer: MessageBlock = {
      type: 'text',
      content: 'Fixed the panel to keep activity and answer text separate.',
      phase: 'final_answer',
    };

    const categorized = categorizeAssistantBlocks([commentary, toolUse, toolResult, finalAnswer]);

    expect(categorized.activityBlocks).toEqual([toolUse, toolResult]);
    expect(categorized.narrativeBlocks).toEqual([commentary]);
    expect(categorized.outputBlocks).toEqual([finalAnswer]);
  });

  it('builds generated output cards from files, checks, and task list output', () => {
    const insights = buildGeneratedOutputInsights([
      'Changed [AssistantContent.tsx](/repo/dashboard/src/pages/sessions/AssistantContent.tsx:42), `package.json`, and `notes.md`.',
      '- `npx vitest run test/dashboard-assistant-content.unit.test.ts` passed',
      '- `npm test` not run: broader suite is already failing elsewhere',
      '- [x] Wire cards into chat output',
      '- [ ] Tune the visual density after browser review',
    ].join('\n'));

    expect(insights.files.map(file => `${file.target.path}:${file.target.line || ''}`)).toEqual([
      '/repo/dashboard/src/pages/sessions/AssistantContent.tsx:42',
      'package.json:',
      'notes.md:',
    ]);
    expect(insights.checks.map(check => [check.command, check.status])).toEqual([
      ['npx vitest run test/dashboard-assistant-content.unit.test.ts', 'passed'],
      ['npm test', 'blocked'],
    ]);
    expect(insights.actions).toEqual([
      { label: 'Wire cards into chat output', done: true },
      { label: 'Tune the visual density after browser review', done: false },
    ]);
    expect(insights.files.some(file => file.target.path.endsWith('notes.md'))).toBe(true);
  });

  it('ensureRichMessageBlocks copies legacy text-only assistant messages into blocks', () => {
    const message: RichMessage = {
      role: 'assistant',
      text: 'Saved [notes.md](notes.md) for review.',
      blocks: [],
    };
    const normalized = ensureRichMessageBlocks(message);
    expect(normalized.blocks).toEqual([{ type: 'text', content: message.text }]);
  });
});
