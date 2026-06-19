import AVFoundation
import Speech

@MainActor
final class VoiceCaptureController: ObservableObject {
    @Published var transcript = ""
    @Published var isRecording = false
    @Published var statusLine = "Ready"

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))

    var isSpeechAvailable: Bool {
        speechRecognizer?.isAvailable == true
    }

    var nativeSpeechReadinessMessage: String? {
        guard Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") != nil else {
            return "Native listening needs the bundled Pikiclaw.app so macOS can show speech permission."
        }
        guard Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") != nil else {
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

        guard let speechRecognizer, speechRecognizer.isAvailable else {
            statusLine = "Speech recognizer is unavailable."
            return
        }

        recognitionTask?.cancel()
        recognitionTask = nil
        transcript = ""

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        inputNode.removeTap(onBus: 0)
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak request] buffer, _ in
            request?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isRecording = true
            statusLine = "Listening"
        } catch {
            statusLine = "Microphone start failed: \(error.localizedDescription)"
            inputNode.removeTap(onBus: 0)
            recognitionRequest = nil
            return
        }

        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    self.statusLine = result.isFinal ? "Captured" : "Understanding"
                    if result.isFinal {
                        self.stopRecording()
                    }
                }
                if let error {
                    self.statusLine = "Speech stopped: \(error.localizedDescription)"
                    self.stopRecording()
                }
            }
        }
    }

    func stopRecording() {
        guard isRecording || audioEngine.isRunning else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        isRecording = false
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            statusLine = "Ready"
        } else {
            statusLine = "Captured"
        }
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func requestMicrophoneAccess() async -> Bool {
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

@MainActor
final class VoiceReportSpeaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var isSpeaking = false

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.rate = 0.48
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
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
