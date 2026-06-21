import Testing
@testable import PikiclawMac

@Test func voiceRecognitionLanguagesCoverChineseAndEnglish() {
    #expect(VoiceRecognitionLanguage.allCases.map(\.rawValue) == [
        "chinese",
        "cantonese",
        "english",
        "japanese",
        "korean",
    ])
    #expect(VoiceRecognitionLanguage.chinese.localeIdentifier == "zh-CN")
    #expect(VoiceRecognitionLanguage.cantonese.localeIdentifier == "zh-HK")
    #expect(VoiceRecognitionLanguage.english.localeIdentifier == "en-US")
    #expect(VoiceRecognitionLanguage.japanese.localeIdentifier == "ja-JP")
    #expect(VoiceRecognitionLanguage.korean.localeIdentifier == "ko-KR")
    #expect(VoiceRecognitionLanguage.chinese.shortTitle == "中文")
    #expect(VoiceRecognitionLanguage.cantonese.shortTitle == "粤语")
    #expect(VoiceRecognitionLanguage.english.shortTitle == "EN")
    #expect(VoiceRecognitionLanguage.japanese.shortTitle == "日本語")
    #expect(VoiceRecognitionLanguage.korean.shortTitle == "한국어")
}

@Test func voiceboxLanguageCodesCoverNaturalConversationLanguages() {
    #expect(VoiceRecognitionLanguage.chinese.voiceboxLanguageCode == "zh")
    #expect(VoiceRecognitionLanguage.cantonese.voiceboxLanguageCode == "yue")
    #expect(VoiceRecognitionLanguage.english.voiceboxLanguageCode == "en")
    #expect(VoiceRecognitionLanguage.japanese.voiceboxLanguageCode == "ja")
    #expect(VoiceRecognitionLanguage.korean.voiceboxLanguageCode == "ko")
}

@Test func speechVoiceLanguageMatchingKeepsChineseAndEnglishSeparate() {
    #expect(SystemSpeechVoiceOption.isLanguage("zh-CN", compatibleWith: .chinese))
    #expect(SystemSpeechVoiceOption.isLanguage("zh_CN", compatibleWith: .chinese))
    #expect(SystemSpeechVoiceOption.isLanguage("zh-HK", compatibleWith: .cantonese))
    #expect(SystemSpeechVoiceOption.isLanguage("en-US", compatibleWith: .english))
    #expect(SystemSpeechVoiceOption.isLanguage("ja-JP", compatibleWith: .japanese))
    #expect(SystemSpeechVoiceOption.isLanguage("ko-KR", compatibleWith: .korean))
    #expect(!SystemSpeechVoiceOption.isLanguage("en-US", compatibleWith: .chinese))
    #expect(!SystemSpeechVoiceOption.isLanguage("zh-CN", compatibleWith: .english))
    #expect(!SystemSpeechVoiceOption.isLanguage("ja-JP", compatibleWith: .korean))
}

@Test func voiceReportTonesProvideNaturalVariants() {
    #expect(VoiceReportTone.allCases.map(\.rawValue) == ["natural", "warm", "close", "calm", "studio", "bright", "quick", "deep"])
    #expect(VoiceReportTone.normalized("missing") == .natural)
    #expect(VoiceReportTone.normalized(" BRIGHT ") == .bright)
    #expect(VoiceReportTone.calm.speechRate < VoiceReportTone.bright.speechRate)
    #expect(VoiceReportTone.quick.speechRate > VoiceReportTone.studio.speechRate)
    #expect(VoiceReportTone.deep.pitchMultiplier < VoiceReportTone.warm.pitchMultiplier)
    #expect(VoiceReportTone.close.volume < VoiceReportTone.natural.volume)
}

@Test func systemSpeechVoicesRankChineseNaturalOptionsFirst() {
    let ranked = SystemSpeechVoiceOption.ranked([
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.basic", name: "Basic English", language: "en-US"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.tingting.premium", name: "Tingting Premium", language: "zh-CN"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.sinji", name: "Sin-ji", language: "zh-HK"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.daniel.premium", name: "Daniel Premium", language: "en-GB"),
    ], for: .chinese)

    #expect(ranked.map(\.id).prefix(3) == [
        "com.apple.speech.synthesis.voice.tingting.premium",
        "com.apple.speech.synthesis.voice.sinji",
        "com.apple.speech.synthesis.voice.daniel.premium",
    ])
    #expect(ranked[0].displayName.contains("Natural"))
}

@Test func systemSpeechVoicesRankJapaneseAndKoreanNaturalOptionsFirst() {
    let japanese = SystemSpeechVoiceOption.ranked([
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.basic", name: "Basic English", language: "en-US"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.kyoko.premium", name: "Kyoko Premium", language: "ja-JP"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.yuna", name: "Yuna", language: "ko-KR"),
    ], for: .japanese)
    let korean = SystemSpeechVoiceOption.ranked([
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.basic", name: "Basic English", language: "en-US"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.kyoko.premium", name: "Kyoko Premium", language: "ja-JP"),
        SystemSpeechVoiceOption(id: "com.apple.speech.synthesis.voice.yuna", name: "Yuna", language: "ko-KR"),
    ], for: .korean)

    #expect(japanese.first?.name == "Kyoko Premium")
    #expect(korean.first?.name == "Yuna")
}
