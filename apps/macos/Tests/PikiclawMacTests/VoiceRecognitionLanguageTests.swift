import Testing
@testable import PikiclawMac

@Test func voiceRecognitionLanguagesCoverChineseAndEnglish() {
    #expect(VoiceRecognitionLanguage.chinese.localeIdentifier == "zh-CN")
    #expect(VoiceRecognitionLanguage.english.localeIdentifier == "en-US")
    #expect(VoiceRecognitionLanguage.chinese.shortTitle == "中文")
    #expect(VoiceRecognitionLanguage.english.shortTitle == "EN")
}

@Test func speechVoiceLanguageMatchingKeepsChineseAndEnglishSeparate() {
    #expect(SystemSpeechVoiceOption.isLanguage("zh-CN", compatibleWith: .chinese))
    #expect(SystemSpeechVoiceOption.isLanguage("zh_CN", compatibleWith: .chinese))
    #expect(SystemSpeechVoiceOption.isLanguage("en-US", compatibleWith: .english))
    #expect(!SystemSpeechVoiceOption.isLanguage("en-US", compatibleWith: .chinese))
    #expect(!SystemSpeechVoiceOption.isLanguage("zh-CN", compatibleWith: .english))
}
