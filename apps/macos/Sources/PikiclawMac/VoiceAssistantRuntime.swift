import AVFoundation
import Speech

enum VoicePermissionRequester {
    static func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        let currentStatus = SFSpeechRecognizer.authorizationStatus()
        guard currentStatus == .notDetermined else {
            return currentStatus
        }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    static func requestMicrophoneAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}

enum VoiceRecognitionLanguage: String, CaseIterable, Identifiable {
    case chinese
    case english

    var id: String { rawValue }

    var shortTitle: String {
        switch self {
        case .chinese: return "中文"
        case .english: return "EN"
        }
    }

    var displayName: String {
        switch self {
        case .chinese: return "中文"
        case .english: return "English"
        }
    }

    var localeIdentifier: String {
        switch self {
        case .chinese: return "zh-CN"
        case .english: return "en-US"
        }
    }

    var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    var speechSynthesisLanguage: String {
        switch self {
        case .chinese: return "zh-CN"
        case .english: return "en-US"
        }
    }
}

struct SystemSpeechVoiceOption: Identifiable, Hashable {
    var id: String
    var name: String
    var language: String

    var displayName: String {
        let localizedLanguage = Locale.current.localizedString(forIdentifier: language) ?? language
        return "\(name) · \(localizedLanguage)"
    }

    static func options(for language: VoiceRecognitionLanguage) -> [SystemSpeechVoiceOption] {
        let voices = AVSpeechSynthesisVoice.speechVoices()
        let matching = voices.filter { isLanguage($0.language, compatibleWith: language) }
        let selectedVoices = matching.isEmpty ? voices : matching
        return selectedVoices
            .sorted { lhs, rhs in
                if lhs.language == rhs.language {
                    return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
                }
                return lhs.language.localizedCaseInsensitiveCompare(rhs.language) == .orderedAscending
            }
            .map { voice in
                SystemSpeechVoiceOption(
                    id: voice.identifier,
                    name: voice.name,
                    language: voice.language
                )
            }
    }

    static func displayName(for identifier: String, language: VoiceRecognitionLanguage) -> String {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Auto" }
        return options(for: language).first(where: { $0.id == trimmed })?.displayName ?? "Custom"
    }

    static func compatibleVoice(identifier: String, language: VoiceRecognitionLanguage) -> AVSpeechSynthesisVoice? {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty,
           let selectedVoice = AVSpeechSynthesisVoice(identifier: trimmed),
           isLanguage(selectedVoice.language, compatibleWith: language) {
            return selectedVoice
        }
        if let exactVoice = AVSpeechSynthesisVoice(language: language.speechSynthesisLanguage) {
            return exactVoice
        }
        return AVSpeechSynthesisVoice.speechVoices()
            .first { isLanguage($0.language, compatibleWith: language) }
    }

    static func isLanguage(_ voiceLanguage: String, compatibleWith language: VoiceRecognitionLanguage) -> Bool {
        let normalizedVoiceLanguage = normalizedLanguageIdentifier(voiceLanguage)
        let normalizedTargetLanguage = normalizedLanguageIdentifier(language.speechSynthesisLanguage)
        guard let targetBase = normalizedTargetLanguage.split(separator: "-").first else {
            return normalizedVoiceLanguage == normalizedTargetLanguage
        }
        return normalizedVoiceLanguage == normalizedTargetLanguage
            || normalizedVoiceLanguage.split(separator: "-").first == targetBase
    }

    private static func normalizedLanguageIdentifier(_ identifier: String) -> String {
        identifier
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()
    }
}

@MainActor
final class VoiceCaptureController: ObservableObject {
    @Published var transcript = ""
    @Published var isRecording = false
    @Published var statusLine = "Ready"
    @Published var audioLevel = 0.0
    @Published var recognitionLanguage: VoiceRecognitionLanguage = .chinese

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    var isSpeechAvailable: Bool {
        guard hasRequiredUsageDescriptions else { return false }
        return makeSpeechRecognizer()?.isAvailable == true
    }

    var nativeSpeechReadinessMessage: String? {
        guard Bundle.main.bundleURL.pathExtension == "app" else {
            return "Native listening needs the bundled Pikiclaw.app. You can type the brief here for now."
        }
        guard hasUsageDescription("NSSpeechRecognitionUsageDescription") else {
            return "Native listening needs the bundled Pikiclaw.app so macOS can show speech permission."
        }
        guard hasUsageDescription("NSMicrophoneUsageDescription") else {
            return "Native listening needs the bundled Pikiclaw.app so macOS can show microphone permission."
        }
        guard isSpeechAvailable else {
            return "Speech recognition is unavailable right now. You can still type the brief."
        }
        return nil
    }

    func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            Task { await startRecording() }
        }
    }

    func startRecording() async {
        guard !isRecording else { return }
        if let readiness = nativeSpeechReadinessMessage {
            statusLine = readiness
            return
        }

        let speechStatus = await requestSpeechAuthorization()
        guard speechStatus == .authorized else {
            statusLine = "Speech permission is not available."
            return
        }

        let microphoneAllowed = await requestMicrophoneAccess()
        guard microphoneAllowed else {
            statusLine = "Microphone permission is not available."
            return
        }

        let recognizer = makeSpeechRecognizer()
        speechRecognizer = recognizer
        let engine = AVAudioEngine()
        audioEngine = engine

        guard let recognizer, recognizer.isAvailable else {
            statusLine = "Speech recognizer is unavailable."
            return
        }

        recognitionTask?.cancel()
        recognitionTask = nil
        transcript = ""

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        let inputNode = engine.inputNode
        inputNode.removeTap(onBus: 0)
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(
            onBus: 0,
            bufferSize: 1024,
            format: recordingFormat,
            block: Self.makeAudioTap(for: request, controller: self)
        )

        engine.prepare()
        do {
            try engine.start()
            isRecording = true
            statusLine = "Listening · \(recognitionLanguage.displayName)"
        } catch {
            statusLine = "Microphone start failed: \(error.localizedDescription)"
            inputNode.removeTap(onBus: 0)
            recognitionRequest = nil
            audioEngine = nil
            return
        }

        recognitionTask = recognizer.recognitionTask(
            with: request,
            resultHandler: Self.makeRecognitionHandler(for: self)
        )
    }

    func stopRecording() {
        guard isRecording || audioEngine?.isRunning == true else { return }
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        audioEngine = nil
        isRecording = false
        audioLevel = 0
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            statusLine = "Ready"
        } else {
            statusLine = "Captured"
        }
    }

    nonisolated private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await VoicePermissionRequester.requestSpeechAuthorization()
    }

    nonisolated private func requestMicrophoneAccess() async -> Bool {
        await VoicePermissionRequester.requestMicrophoneAccess()
    }

    nonisolated private static func makeAudioTap(
        for request: SFSpeechAudioBufferRecognitionRequest,
        controller: VoiceCaptureController
    ) -> AVAudioNodeTapBlock {
        { [weak request, weak controller] buffer, _ in
            request?.append(buffer)
            let level = normalizedAudioLevel(from: buffer)
            Task { @MainActor [weak controller] in
                guard let controller else { return }
                controller.audioLevel = max(level, controller.audioLevel * 0.62)
            }
        }
    }

    nonisolated private static func normalizedAudioLevel(from buffer: AVAudioPCMBuffer) -> Double {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let channelCount = max(1, Int(buffer.format.channelCount))
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return 0 }

        var sum = 0.0
        var sampleCount = 0
        for channel in 0..<channelCount {
            let samples = channelData[channel]
            var frame = 0
            while frame < frameCount {
                let sample = Double(samples[frame])
                sum += sample * sample
                sampleCount += 1
                frame += 4
            }
        }
        guard sampleCount > 0 else { return 0 }

        let rms = sqrt(sum / Double(sampleCount))
        let boosted = pow(max(0, rms - 0.008) * 18, 0.72)
        return min(1, max(0, boosted))
    }

    nonisolated private static func makeRecognitionHandler(
        for controller: VoiceCaptureController
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak controller] result, error in
            let transcript = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal == true
            let errorDescription = error?.localizedDescription
            Task { @MainActor [weak controller] in
                guard let controller else { return }
                if let transcript {
                    controller.transcript = transcript
                    controller.statusLine = isFinal ? "Captured" : "Understanding"
                    if isFinal {
                        controller.stopRecording()
                    }
                }
                if let errorDescription {
                    controller.statusLine = "Speech stopped: \(errorDescription)"
                    controller.stopRecording()
                }
            }
        }
    }

    private var hasRequiredUsageDescriptions: Bool {
        hasUsageDescription("NSSpeechRecognitionUsageDescription")
            && hasUsageDescription("NSMicrophoneUsageDescription")
    }

    private func hasUsageDescription(_ key: String) -> Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func makeSpeechRecognizer() -> SFSpeechRecognizer? {
        SFSpeechRecognizer(locale: recognitionLanguage.locale)
    }
}

@MainActor
final class VoiceReportSpeaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var isSpeaking = false

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(
        _ text: String,
        voiceIdentifier: String = "",
        language: VoiceRecognitionLanguage = .chinese
    ) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.rate = 0.48
        let selectedVoice = SystemSpeechVoiceOption.compatibleVoice(identifier: voiceIdentifier, language: language)
        utterance.voice = selectedVoice
            ?? AVSpeechSynthesisVoice(language: language.speechSynthesisLanguage)
            ?? AVSpeechSynthesisVoice(language: "en-US")
        isSpeaking = true
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        isSpeaking = false
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
        }
    }
}
