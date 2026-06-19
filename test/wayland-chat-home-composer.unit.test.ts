import { describe, expect, it } from 'vitest';
import { canSubmitChatHomeMessage } from '../dashboard/src/pages/wayland/chatHomeComposer';

describe('Wayland chat home composer', () => {
  it('allows image-only messages to be submitted', () => {
    expect(canSubmitChatHomeMessage('', 1)).toBe(true);
    expect(canSubmitChatHomeMessage('   ', 2)).toBe(true);
  });

  it('requires either text or an attachment', () => {
    expect(canSubmitChatHomeMessage('', 0)).toBe(false);
    expect(canSubmitChatHomeMessage('describe this', 0)).toBe(true);
  });
});
