import type { Locale } from '../../i18n';

function normalizeLanguageTag(value: string): string {
  return value.trim().replace('_', '-');
}

function chineseSpeechLanguage(language: string): string | null {
  const tag = normalizeLanguageTag(language);
  if (!/^(zh|cmn|yue|wuu)(?:-|$)/i.test(tag)) return null;
  if (/(?:^|-)TW$/i.test(tag) || /(?:^|-)Hant$/i.test(tag)) return 'zh-TW';
  if (/(?:^|-)HK$/i.test(tag)) return 'zh-HK';
  return 'zh-CN';
}

export function pickSpeechRecognitionLanguage(locale: Locale, browserLanguages: readonly string[] = []): string {
  for (const language of browserLanguages) {
    const chinese = chineseSpeechLanguage(language);
    if (chinese) return chinese;
  }
  if (locale === 'zh-CN') return 'zh-CN';

  return 'zh-CN';
}

export function getBrowserSpeechRecognitionLanguage(locale: Locale): string {
  if (typeof navigator === 'undefined') return pickSpeechRecognitionLanguage(locale);
  const languages = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  return pickSpeechRecognitionLanguage(locale, languages);
}
