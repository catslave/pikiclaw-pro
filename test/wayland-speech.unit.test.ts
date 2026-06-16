import { describe, expect, it } from 'vitest';
import { pickSpeechRecognitionLanguage } from '../dashboard/src/pages/wayland/speech';

describe('Wayland speech recognition language', () => {
  it('prefers Chinese browser language even when the UI is English', () => {
    expect(pickSpeechRecognitionLanguage('en', ['en-US', 'zh-CN'])).toBe('zh-CN');
    expect(pickSpeechRecognitionLanguage('en', ['zh_CN', 'en-US'])).toBe('zh-CN');
  });

  it('keeps regional Chinese variants for speech recognition', () => {
    expect(pickSpeechRecognitionLanguage('en', ['zh-TW', 'en-US'])).toBe('zh-TW');
    expect(pickSpeechRecognitionLanguage('en', ['zh-HK', 'en-US'])).toBe('zh-HK');
  });

  it('uses Chinese as the default speech language', () => {
    expect(pickSpeechRecognitionLanguage('zh-CN', [])).toBe('zh-CN');
    expect(pickSpeechRecognitionLanguage('en', [])).toBe('zh-CN');
    expect(pickSpeechRecognitionLanguage('en', ['en-US'])).toBe('zh-CN');
  });
});
