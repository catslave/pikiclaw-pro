import { afterEach, describe, expect, it, vi } from 'vitest';
import { isImeCompositionKeyEvent } from '../dashboard/src/utils';

describe('dashboard IME keyboard guard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps composer shortcuts inactive while IME composition owns the key event', () => {
    expect(isImeCompositionKeyEvent({ key: 'Enter' }, true)).toBe(true);
    expect(isImeCompositionKeyEvent({ key: 'Enter', nativeEvent: { isComposing: true } }, false)).toBe(true);
    expect(isImeCompositionKeyEvent({ key: 'Enter', keyCode: 229 }, false)).toBe(true);
    expect(isImeCompositionKeyEvent({ key: 'Enter', nativeEvent: { keyCode: 229 } }, false)).toBe(true);
  });

  it('guards the Enter event that immediately follows compositionend', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    const compositionEndedAt = Date.now();

    expect(isImeCompositionKeyEvent({ key: 'Enter' }, false, compositionEndedAt)).toBe(true);

    vi.advanceTimersByTime(121);

    expect(isImeCompositionKeyEvent({ key: 'Enter' }, false, compositionEndedAt)).toBe(false);
    expect(isImeCompositionKeyEvent({ key: 'a' }, false, compositionEndedAt)).toBe(false);
  });
});
