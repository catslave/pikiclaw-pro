import Testing
@testable import PikiclawMac

@Test func voiceRecognitionLanguagesCoverChineseAndEnglish() {
    #expect(VoiceRecognitionLanguage.chinese.localeIdentifier == "zh-CN")
    #expect(VoiceRecognitionLanguage.english.localeIdentifier == "en-US")
    #expect(VoiceRecognitionLanguage.chinese.shortTitle == "中文")
    #expect(VoiceRecognitionLanguage.english.shortTitle == "EN")
}
