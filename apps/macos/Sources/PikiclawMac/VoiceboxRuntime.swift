import AVFoundation
import CoreAudio
import Foundation
import Speech

struct VoiceboxConfiguration: Equatable {
    var enabled: Bool
    var baseURLString: String
    var profile: String
    var sttModel: String
    var ttsEngine: String
    var personality: Bool

    var baseURL: URL? {
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

struct VoiceboxProfile: Identifiable, Hashable, Decodable {
    var id: String
    var name: String
    var language: String
    var voiceType: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case language
        case voiceType = "voice_type"
    }
}

struct VoiceboxHealth: Decodable {
    var status: String
    var modelLoaded: Bool?
    var gpuAvailable: Bool?
    var backendType: String?

    enum CodingKeys: String, CodingKey {
        case status
        case modelLoaded = "model_loaded"
        case gpuAvailable = "gpu_available"
        case backendType = "backend_type"
    }
}

struct VoiceboxGeneration: Decodable {
    var id: String?
    var status: String?
    var duration: Double?
}

struct VoiceboxTranscription: Decodable {
    var text: String
    var duration: Double?
}

enum VoiceboxClientError: LocalizedError {
    case disabled
    case invalidBaseURL
    case transport(String)
    case server(status: Int, message: String)
    case emptyTranscript

    var errorDescription: String? {
        switch self {
        case .disabled:
            return "Voicebox is disabled."
        case .invalidBaseURL:
            return "Voicebox URL is invalid."
        case .transport(let message):
            return message
        case .server(let status, let message):
            return "Voicebox \(status): \(message)"
        case .emptyTranscript:
            return "Voicebox returned an empty transcript."
        }
    }
}

struct VoiceboxClient {
    var configuration: VoiceboxConfiguration
    var session: URLSession = .shared

    func health() async throws -> VoiceboxHealth {
        let data = try await getData(path: "/health")
        return try JSONDecoder.voicebox.decode(VoiceboxHealth.self, from: data)
    }

    func profiles() async throws -> [VoiceboxProfile] {
        let data = try await getData(path: "/profiles")
        return try JSONDecoder.voicebox.decode([VoiceboxProfile].self, from: data)
    }

    func transcribe(audioFile: URL, language: VoiceRecognitionLanguage) async throws -> VoiceboxTranscription {
        do {
            return try await transcribe(audioFile: audioFile, language: language, fileFieldName: "file")
        } catch VoiceboxClientError.server(let status, _) where status == 400 || status == 422 {
            return try await transcribe(audioFile: audioFile, language: language, fileFieldName: "audio")
        }
    }

    func speak(_ text: String, language: VoiceRecognitionLanguage) async throws -> VoiceboxGeneration {
        guard configuration.enabled else { throw VoiceboxClientError.disabled }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { throw VoiceboxClientError.emptyTranscript }
        let data = try JSONSerialization.data(withJSONObject: [
            "text": clean,
            "profile": configuration.profile.trimmingCharacters(in: .whitespacesAndNewlines),
            "engine": emptyToNull(configuration.ttsEngine),
            "personality": configuration.personality,
            "language": language.voiceboxLanguageCode,
        ].compactMapValues { $0 }, options: [])
        let response = try await request(path: "/speak", method: "POST", body: data, contentType: "application/json")
        return try JSONDecoder.voicebox.decode(VoiceboxGeneration.self, from: response)
    }

    private func transcribe(audioFile: URL, language: VoiceRecognitionLanguage, fileFieldName: String) async throws -> VoiceboxTranscription {
        guard configuration.enabled else { throw VoiceboxClientError.disabled }
        let audio = try Data(contentsOf: audioFile)
        let boundary = "PikiclawVoiceboxBoundary-\(UUID().uuidString)"
        let fields: [(String, String)] = [
            ("language", language.voiceboxLanguageCode),
            ("model", configuration.sttModel.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)),
        ].filter { !$0.1.isEmpty }
        let body = VoiceboxMultipart.body(
            boundary: boundary,
            fields: fields,
            fileFieldName: fileFieldName,
            fileName: audioFile.lastPathComponent,
            mimeType: "audio/wav",
            fileData: audio
        )
        let response = try await request(path: "/transcribe", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
        let transcript = try JSONDecoder.voicebox.decode(VoiceboxTranscription.self, from: response)
        if transcript.text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty {
            throw VoiceboxClientError.emptyTranscript
        }
        return transcript
    }

    private func getData(path: String) async throws -> Data {
        try await request(path: path, method: "GET", body: nil, contentType: nil)
    }

    private func request(path: String, method: String, body: Data?, contentType: String?) async throws -> Data {
        guard configuration.enabled else { throw VoiceboxClientError.disabled }
        guard let baseURL = configuration.baseURL else { throw VoiceboxClientError.invalidBaseURL }
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 45
        request.setValue("pikiclaw-native-macos", forHTTPHeaderField: "X-Voicebox-Client-Id")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw VoiceboxClientError.transport("Voicebox returned a non-HTTP response.")
            }
            guard (200..<300).contains(http.statusCode) else {
                throw VoiceboxClientError.server(status: http.statusCode, message: VoiceboxClient.errorMessage(from: data))
            }
            return data
        } catch let error as VoiceboxClientError {
            throw error
        } catch {
            throw VoiceboxClientError.transport(error.localizedDescription)
        }
    }

    private static func errorMessage(from data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let detail = object["detail"] as? String { return detail }
            if let message = object["message"] as? String { return message }
        }
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Request failed."
    }
}

private func emptyToNull(_ value: String) -> Any? {
    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return clean.isEmpty ? nil : clean
}

enum VoiceboxMultipart {
    static func body(
        boundary: String,
        fields: [(String, String)],
        fileFieldName: String,
        fileName: String,
        mimeType: String,
        fileData: Data
    ) -> Data {
        var data = Data()
        for (name, value) in fields {
            data.appendUTF8("--\(boundary)\r\n")
            data.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            data.appendUTF8("\(value)\r\n")
        }
        data.appendUTF8("--\(boundary)\r\n")
        data.appendUTF8("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(fileName)\"\r\n")
        data.appendUTF8("Content-Type: \(mimeType)\r\n\r\n")
        data.append(fileData)
        data.appendUTF8("\r\n--\(boundary)--\r\n")
        return data
    }
}

struct VoiceAudioPacket {
    var samples: [Int16]
    var sampleRate: Double
    var level: Double
}

private final class VoiceLiveTranscriptBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private weak var request: SFSpeechAudioBufferRecognitionRequest?

    func set(_ request: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        self.request = request
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let request = request
        lock.unlock()
        request?.append(buffer)
    }

    func endAudio() {
        lock.lock()
        let request = request
        self.request = nil
        lock.unlock()
        request?.endAudio()
    }
}

enum VoiceAudioMeter {
    static func packet(from buffer: AVAudioPCMBuffer) -> VoiceAudioPacket? {
        guard let channelData = buffer.floatChannelData else { return nil }
        let channelCount = max(1, Int(buffer.format.channelCount))
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return nil }

        var samples: [Int16] = []
        samples.reserveCapacity(frameCount)
        var sum = 0.0

        for frame in 0..<frameCount {
            var mixed = 0.0
            for channel in 0..<channelCount {
                mixed += Double(channelData[channel][frame])
            }
            let mono = max(-1.0, min(1.0, mixed / Double(channelCount)))
            sum += mono * mono
            samples.append(Int16(max(Double(Int16.min), min(Double(Int16.max), mono * Double(Int16.max)))))
        }

        let rms = sqrt(sum / Double(frameCount))
        let boosted = pow(max(0, rms - 0.006) * 14, 0.70)
        return VoiceAudioPacket(samples: samples, sampleRate: buffer.format.sampleRate, level: min(1, max(0, boosted)))
    }
}

struct VoiceWAVWriter {
    static func writeMonoPCM16(samples: [Int16], sampleRate: Double, to url: URL) throws {
        var data = Data()
        let byteRate = UInt32(sampleRate) * 2
        let blockAlign: UInt16 = 2
        let subchunk2Size = UInt32(samples.count * MemoryLayout<Int16>.size)
        let chunkSize = UInt32(36) + subchunk2Size

        data.appendASCII("RIFF")
        data.appendLittleEndian(chunkSize)
        data.appendASCII("WAVE")
        data.appendASCII("fmt ")
        data.appendLittleEndian(UInt32(16))
        data.appendLittleEndian(UInt16(1))
        data.appendLittleEndian(UInt16(1))
        data.appendLittleEndian(UInt32(sampleRate))
        data.appendLittleEndian(byteRate)
        data.appendLittleEndian(blockAlign)
        data.appendLittleEndian(UInt16(16))
        data.appendASCII("data")
        data.appendLittleEndian(subchunk2Size)
        for sample in samples {
            data.appendLittleEndian(sample)
        }
        try data.write(to: url, options: .atomic)
    }
}

struct VoiceInputDeviceSnapshot: Equatable {
    var id: AudioDeviceID
    var name: String
    var transportType: UInt32
    var inputChannels: UInt32

    var isVirtual: Bool {
        transportType == kAudioDeviceTransportTypeVirtual
            || name.localizedCaseInsensitiveContains("BlackHole")
            || name.localizedCaseInsensitiveContains("Loopback")
            || name.localizedCaseInsensitiveContains("Soundflower")
            || name.localizedCaseInsensitiveContains("OBS")
    }

    var isLikelyBuiltInMicrophone: Bool {
        transportType == kAudioDeviceTransportTypeBuiltIn
            || name.localizedCaseInsensitiveContains("microphone")
    }
}

struct VoiceInputDeviceSelection {
    var activeDevice: VoiceInputDeviceSnapshot?
    var originalDeviceID: AudioDeviceID?
    var message: String
}

enum VoiceInputDeviceManager {
    private static let preserveVirtualInputKey = "PikiclawMac.voicePreserveVirtualInputForTesting"

    static func prepareVoiceInput() -> VoiceInputDeviceSelection {
        guard let current = defaultInputDevice() else {
            return VoiceInputDeviceSelection(
                activeDevice: nil,
                originalDeviceID: nil,
                message: "Input: system default"
            )
        }
        if current.isVirtual, UserDefaults.standard.bool(forKey: preserveVirtualInputKey) {
            return VoiceInputDeviceSelection(
                activeDevice: current,
                originalDeviceID: nil,
                message: "Input: \(current.name) · preserved virtual input"
            )
        }
        guard current.isVirtual, let preferred = preferredPhysicalInputDevice(excluding: current.id) else {
            return VoiceInputDeviceSelection(
                activeDevice: current,
                originalDeviceID: nil,
                message: "Input: \(current.name)"
            )
        }
        let didSwitch = setDefaultInputDevice(preferred.id)
        return VoiceInputDeviceSelection(
            activeDevice: didSwitch ? preferred : current,
            originalDeviceID: didSwitch ? current.id : nil,
            message: didSwitch
                ? "Input: \(preferred.name) · switched from \(current.name)"
                : "Input: \(current.name) · could not switch to \(preferred.name)"
        )
    }

    static func restoreDefaultInputDevice(_ deviceID: AudioDeviceID) {
        _ = setDefaultInputDevice(deviceID)
    }

    private static func preferredPhysicalInputDevice(excluding excludedID: AudioDeviceID) -> VoiceInputDeviceSnapshot? {
        let physicalInputs = inputDevices()
            .filter { $0.id != excludedID && !$0.isVirtual && $0.inputChannels > 0 }
        return physicalInputs.first(where: { $0.isLikelyBuiltInMicrophone })
            ?? physicalInputs.first
    }

    private static func defaultInputDevice() -> VoiceInputDeviceSnapshot? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(0)
        var dataSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            &deviceID
        )
        guard status == noErr, deviceID != 0 else { return nil }
        return inputDevices().first(where: { $0.id == deviceID })
            ?? snapshot(for: deviceID)
    }

    private static func inputDevices() -> [VoiceInputDeviceSnapshot] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize
        )
        guard sizeStatus == noErr, dataSize > 0 else { return [] }
        let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var devices = [AudioDeviceID](repeating: 0, count: deviceCount)
        let dataStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            &devices
        )
        guard dataStatus == noErr else { return [] }
        return devices.compactMap(snapshot(for:))
            .filter { $0.inputChannels > 0 }
    }

    private static func snapshot(for deviceID: AudioDeviceID) -> VoiceInputDeviceSnapshot? {
        let channels = inputChannelCount(for: deviceID)
        guard channels > 0 else { return nil }
        return VoiceInputDeviceSnapshot(
            id: deviceID,
            name: deviceName(for: deviceID) ?? "Input \(deviceID)",
            transportType: transportType(for: deviceID),
            inputChannels: channels
        )
    }

    private static func setDefaultInputDevice(_ deviceID: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var mutableDeviceID = deviceID
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            UInt32(MemoryLayout<AudioDeviceID>.size),
            &mutableDeviceID
        )
        return status == noErr
    }

    private static func deviceName(for deviceID: AudioDeviceID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        let rawPointer = UnsafeMutableRawPointer.allocate(
            byteCount: Int(dataSize),
            alignment: MemoryLayout<CFString>.alignment
        )
        defer { rawPointer.deallocate() }
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, rawPointer)
        guard status == noErr else { return nil }
        let name = rawPointer.load(as: CFString.self)
        return name as String
    }

    private static func transportType(for deviceID: AudioDeviceID) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var transport = UInt32(0)
        var dataSize = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, &transport)
        return status == noErr ? transport : 0
    }

    private static func inputChannelCount(for deviceID: AudioDeviceID) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &dataSize)
        guard sizeStatus == noErr, dataSize > 0 else { return 0 }
        let rawPointer = UnsafeMutableRawPointer.allocate(
            byteCount: Int(dataSize),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { rawPointer.deallocate() }
        let audioBufferList = rawPointer.bindMemory(to: AudioBufferList.self, capacity: 1)
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, audioBufferList)
        guard status == noErr else { return 0 }
        let bufferList = UnsafeMutableAudioBufferListPointer(audioBufferList)
        return bufferList.reduce(UInt32(0)) { total, buffer in
            total + buffer.mNumberChannels
        }
    }
}

enum VoiceDebugLog {
    static let logURL: URL = {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Pikiclaw", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("voice.log")
    }()

    private static let queue = DispatchQueue(label: "com.pikiclaw.voice-debug-log")

    static func write(_ message: String) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let line = "\(formatter.string(from: Date())) \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        queue.async {
            if FileManager.default.fileExists(atPath: logURL.path),
               let handle = try? FileHandle(forWritingTo: logURL) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: logURL, options: .atomic)
            }
        }
    }
}

@MainActor
final class ContinuousVoiceSessionController: ObservableObject {
    struct FinalizedTurn: Identifiable, Equatable {
        enum Backend: String {
            case voicebox = "Voicebox"
            case apple = "Apple Speech"
        }

        let id = UUID()
        var text: String
        var backend: Backend
        var duration: Double?
    }

    @Published var transcript = ""
    @Published var statusLine = "Ready"
    @Published var audioLevel = 0.0
    @Published var recognitionLanguage: VoiceRecognitionLanguage = .chinese
    @Published var isConversationActive = false
    @Published var isListening = false
    @Published var isCapturingTurn = false
    @Published var isTranscribing = false
    @Published var isVoiceboxSpeaking = false
    @Published var voiceboxOnline = false
    @Published var voiceboxProfiles: [VoiceboxProfile] = []
    @Published var voiceboxStatus = "Voicebox not checked"
    @Published var finalizedTurn: FinalizedTurn?
    @Published var interruptionCount = 0
    @Published var diagnosticLine = "Voice diagnostics ready"
    @Published var lastTurnDebugLine = "No voice turn captured yet"
    @Published var inputDeviceLine = "Input device not checked"

    private var audioEngine: AVAudioEngine?
    private var originalInputDeviceID: AudioDeviceID?
    private var currentSamples: [Int16] = []
    private var currentSampleRate = 44_100.0
    private var turnStartedAt: Date?
    private var lastVoiceAt: Date?
    private var maxTurnLevel = 0.0
    private var silenceFrames = 0
    private var packetsSeen = 0
    private var lastDiagnosticsAt = Date.distantPast
    private var lastPacketLogAt = Date.distantPast
    private var liveTranscriptEnabled = false
    private var liveRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var liveRecognitionTask: SFSpeechRecognitionTask?
    private var liveSpeechRecognizer: SFSpeechRecognizer?
    private let liveTranscriptBuffer = VoiceLiveTranscriptBuffer()
    private var allowsBargeIn = false
    private var voiceboxSpeechID: UUID?
    private var inputSuppressedUntil = Date.distantPast
    private var configuration = VoiceboxConfiguration(
        enabled: true,
        baseURLString: "http://127.0.0.1:17493",
        profile: "",
        sttModel: "turbo",
        ttsEngine: "",
        personality: false
    )

    private let startThreshold = 0.026
    private let minimumContinuationThreshold = 0.022
    private let interruptionThreshold = 0.032
    private let minTurnDuration = 0.45
    private let maxTurnDuration = 18.0
    private let silenceToEnd = 1.05
    private let outputEchoSuppressionSeconds = 0.85

    var activityLabel: String {
        if isVoiceboxSpeaking { return "speaking" }
        if isTranscribing { return "transcribing" }
        if isCapturingTurn { return "capturing turn" }
        if isListening { return "listening" }
        if isConversationActive { return "paused" }
        return "ready"
    }

    var nativeSpeechReadinessMessage: String? {
        guard Bundle.main.bundleURL.pathExtension == "app" else {
            return "Native listening needs the bundled Pikiclaw.app. You can type the brief here for now."
        }
        guard hasUsageDescription("NSMicrophoneUsageDescription") else {
            return "Native listening needs the bundled Pikiclaw.app so macOS can show microphone permission."
        }
        if !configuration.enabled {
            guard hasUsageDescription("NSSpeechRecognitionUsageDescription") else {
                return "Apple fallback needs the bundled Pikiclaw.app so macOS can show speech permission."
            }
        }
        return nil
    }

    func applyConfiguration(_ next: VoiceboxConfiguration) {
        configuration = next
    }

    func refreshVoicebox(configuration: VoiceboxConfiguration) async {
        applyConfiguration(configuration)
        guard configuration.enabled else {
            voiceboxOnline = false
            voiceboxProfiles = []
            voiceboxStatus = "Voicebox disabled"
            return
        }
        do {
            let client = VoiceboxClient(configuration: configuration)
            let health = try await client.health()
            let profiles = (try? await client.profiles()) ?? []
            voiceboxOnline = true
            voiceboxProfiles = profiles
            let backend = health.backendType.map { " · \($0)" } ?? ""
            voiceboxStatus = "\(health.status)\(backend)"
        } catch {
            voiceboxOnline = false
            voiceboxProfiles = []
            voiceboxStatus = "Voicebox offline: \(error.localizedDescription)"
        }
    }

    func toggleConversation(configuration: VoiceboxConfiguration) {
        if isConversationActive {
            stopConversation()
        } else {
            Task { await startConversation(configuration: configuration) }
        }
    }

    func startConversation(configuration: VoiceboxConfiguration) async {
        guard !isConversationActive else { return }
        applyConfiguration(configuration)
        VoiceDebugLog.write("conversation start requested voicebox=\(configuration.enabled) language=\(recognitionLanguage.localeIdentifier)")
        if let readiness = nativeSpeechReadinessMessage {
            statusLine = readiness
            diagnosticLine = readiness
            VoiceDebugLog.write("conversation blocked readiness=\(readiness)")
            return
        }
        let microphoneAllowed = await requestMicrophoneAccess()
        guard microphoneAllowed else {
            statusLine = "Microphone permission is not available."
            diagnosticLine = statusLine
            VoiceDebugLog.write("conversation blocked microphone_permission=false")
            return
        }

        liveTranscriptEnabled = await requestLiveTranscriptAccess()
        let inputSelection = VoiceInputDeviceManager.prepareVoiceInput()
        originalInputDeviceID = inputSelection.originalDeviceID
        inputDeviceLine = inputSelection.message
        VoiceDebugLog.write("input device \(inputSelection.message)")
        isConversationActive = true
        statusLine = configuration.enabled ? "Listening with Voicebox" : "Listening with Apple Speech"
        diagnosticLine = "\(inputSelection.message) · Live transcript \(liveTranscriptEnabled ? "on" : "off")"
        VoiceDebugLog.write("conversation permissions ok live_transcript=\(liveTranscriptEnabled)")
        do {
            try startAudioEngine()
            isListening = true
        } catch {
            isConversationActive = false
            isListening = false
            restoreInputDeviceIfNeeded()
            statusLine = "Microphone start failed: \(error.localizedDescription)"
            diagnosticLine = statusLine
            VoiceDebugLog.write("audio engine failed error=\(error.localizedDescription)")
        }
    }

    func stopConversation() {
        VoiceDebugLog.write("conversation stop requested")
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        restoreInputDeviceIfNeeded()
        currentSamples.removeAll(keepingCapacity: false)
        turnStartedAt = nil
        lastVoiceAt = nil
        maxTurnLevel = 0
        silenceFrames = 0
        packetsSeen = 0
        lastPacketLogAt = Date.distantPast
        liveTranscriptEnabled = false
        allowsBargeIn = false
        voiceboxSpeechID = nil
        inputSuppressedUntil = .distantPast
        stopLiveTranscript(cancelTask: true)
        isConversationActive = false
        isListening = false
        isCapturingTurn = false
        isTranscribing = false
        isVoiceboxSpeaking = false
        audioLevel = 0
        statusLine = transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Ready" : "Paused"
        diagnosticLine = "Conversation stopped"
    }

    func pauseForOutput(allowBargeIn: Bool = false) {
        guard isConversationActive else { return }
        allowsBargeIn = false
        isListening = false
        isCapturingTurn = false
        stopLiveTranscript(cancelTask: true)
        currentSamples.removeAll(keepingCapacity: true)
        suppressInputForOutputTail(seconds: outputEchoSuppressionSeconds)
        statusLine = "Speaking"
        diagnosticLine = statusLine
        VoiceDebugLog.write("conversation paused for output barge_in=\(allowBargeIn)")
    }

    func pauseForAgentRun() {
        guard isConversationActive else { return }
        allowsBargeIn = false
        isListening = false
        isCapturingTurn = false
        stopLiveTranscript(cancelTask: true)
        currentSamples.removeAll(keepingCapacity: true)
        statusLine = "Voice Assistant is working"
        diagnosticLine = statusLine
        VoiceDebugLog.write("conversation paused for agent run")
    }

    func resumeListening() {
        guard isConversationActive, !isTranscribing, !isVoiceboxSpeaking else { return }
        allowsBargeIn = false
        suppressInputForOutputTail(seconds: outputEchoSuppressionSeconds)
        isListening = true
        isCapturingTurn = false
        statusLine = configuration.enabled ? "Listening with Voicebox" : "Listening with Apple Speech"
        diagnosticLine = "Listening · mic \(formatPercent(audioLevel))"
        VoiceDebugLog.write("conversation resumed")
    }

    func cancelVoiceboxSpeechForInterruption() {
        guard isVoiceboxSpeaking || voiceboxSpeechID != nil else { return }
        voiceboxSpeechID = nil
        isVoiceboxSpeaking = false
        statusLine = "Interrupted by you"
        diagnosticLine = statusLine
        VoiceDebugLog.write("speech interrupted by input")
        resumeListening()
    }

    @discardableResult
    func speakWithVoiceboxIfAvailable(
        _ text: String,
        configuration: VoiceboxConfiguration,
        allowBargeIn: Bool = false
    ) async -> Bool {
        applyConfiguration(configuration)
        guard configuration.enabled else { return false }
        pauseForOutput(allowBargeIn: allowBargeIn)
        let speechID = UUID()
        voiceboxSpeechID = speechID
        isVoiceboxSpeaking = true
        do {
            _ = try await VoiceboxClient(configuration: configuration).speak(text, language: recognitionLanguage)
            let waitSeconds = estimatedSpeechSeconds(for: text)
            try? await Task.sleep(nanoseconds: UInt64(waitSeconds * 1_000_000_000))
            guard voiceboxSpeechID == speechID else { return true }
            voiceboxSpeechID = nil
            isVoiceboxSpeaking = false
            statusLine = "Voicebox spoke"
            resumeListening()
            return true
        } catch {
            if voiceboxSpeechID == speechID {
                voiceboxSpeechID = nil
            }
            isVoiceboxSpeaking = false
            statusLine = "Voicebox speak failed: \(error.localizedDescription)"
            diagnosticLine = statusLine
            VoiceDebugLog.write("voicebox speak failed error=\(error.localizedDescription)")
            return false
        }
    }

    private func startAudioEngine() throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        inputNode.removeTap(onBus: 0)
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw VoiceboxClientError.transport("No microphone input format is available.")
        }
        let liveTranscriptBuffer = liveTranscriptBuffer
        inputNode.installTap(
            onBus: 0,
            bufferSize: 1024,
            format: format,
            block: Self.makeAudioTap(for: self, liveTranscriptBuffer: liveTranscriptBuffer)
        )
        engine.prepare()
        try engine.start()
        audioEngine = engine
        VoiceDebugLog.write("audio engine started sample_rate=\(Int(format.sampleRate)) channels=\(format.channelCount)")
    }

    private func restoreInputDeviceIfNeeded() {
        guard let originalInputDeviceID else { return }
        VoiceInputDeviceManager.restoreDefaultInputDevice(originalInputDeviceID)
        VoiceDebugLog.write("input device restored id=\(originalInputDeviceID)")
        self.originalInputDeviceID = nil
    }

    nonisolated private static func makeAudioTap(
        for controller: ContinuousVoiceSessionController,
        liveTranscriptBuffer: VoiceLiveTranscriptBuffer
    ) -> AVAudioNodeTapBlock {
        { [weak controller] buffer, _ in
            liveTranscriptBuffer.append(buffer)
            guard let packet = VoiceAudioMeter.packet(from: buffer) else { return }
            Task { @MainActor [weak controller] in
                controller?.process(packet)
            }
        }
    }

    private func process(_ packet: VoiceAudioPacket) {
        audioLevel = max(packet.level, audioLevel * 0.66)
        packetsSeen += 1
        updateInputDiagnostics(for: packet)
        guard isConversationActive, isListening, !isTranscribing else { return }

        let now = Date()
        guard now >= inputSuppressedUntil else { return }
        let hasVoice = packet.level >= startThreshold
        if allowsBargeIn && !isCapturingTurn && packet.level >= interruptionThreshold {
            allowsBargeIn = false
            if isVoiceboxSpeaking {
                cancelVoiceboxSpeechForInterruption()
            }
            interruptionCount += 1
            beginTurn(sampleRate: packet.sampleRate, now: now)
        }
        if isVoiceboxSpeaking {
            return
        }
        if hasVoice && !isCapturingTurn {
            beginTurn(sampleRate: packet.sampleRate, now: now)
        }
        guard isCapturingTurn else { return }

        currentSamples.append(contentsOf: packet.samples)
        maxTurnLevel = max(maxTurnLevel, packet.level)
        let continuationThreshold = max(
            minimumContinuationThreshold,
            min(0.052, maxTurnLevel * 0.36)
        )
        let hasContinuingVoice = hasVoice || packet.level >= continuationThreshold
        if hasContinuingVoice {
            lastVoiceAt = now
            silenceFrames = 0
        } else {
            silenceFrames += packet.samples.count
        }

        let turnDuration = now.timeIntervalSince(turnStartedAt ?? now)
        let silentSeconds = Double(silenceFrames) / max(1, currentSampleRate)
        let quietSeconds = now.timeIntervalSince(lastVoiceAt ?? turnStartedAt ?? now)
        if turnDuration >= maxTurnDuration || (turnDuration >= minTurnDuration && silentSeconds >= silenceToEnd) {
            finishTurn()
        } else if turnDuration >= 1.0 && quietSeconds >= silenceToEnd {
            finishTurn()
        }
    }

    private func beginTurn(sampleRate: Double, now: Date) {
        currentSamples.removeAll(keepingCapacity: true)
        currentSampleRate = sampleRate
        turnStartedAt = now
        lastVoiceAt = now
        maxTurnLevel = 0
        silenceFrames = 0
        isCapturingTurn = true
        transcript = ""
        startLiveTranscript()
        statusLine = "Listening to this turn"
        diagnosticLine = "Turn started · mic \(formatPercent(audioLevel))"
        VoiceDebugLog.write("turn begin sample_rate=\(Int(sampleRate)) level=\(formatLevel(audioLevel))")
    }

    private func finishTurn() {
        guard isCapturingTurn else { return }
        let duration = Date().timeIntervalSince(turnStartedAt ?? Date())
        let sampleCount = currentSamples.count
        let peak = maxTurnLevel
        isCapturingTurn = false
        isListening = false
        isTranscribing = true
        stopLiveTranscript(cancelTask: false)
        statusLine = configuration.enabled ? "Transcribing with Voicebox" : "Transcribing with Apple Speech"
        diagnosticLine = "Turn closed · \(String(format: "%.1fs", duration)) · peak \(formatPercent(peak))"
        lastTurnDebugLine = "Last turn: \(String(format: "%.1fs", duration)), \(sampleCount) samples, peak \(formatPercent(peak))"
        VoiceDebugLog.write("turn finish duration=\(formatSeconds(duration)) samples=\(sampleCount) peak=\(formatLevel(peak))")

        let samples = currentSamples
        let sampleRate = currentSampleRate
        currentSamples.removeAll(keepingCapacity: true)
        Task {
            await transcribeTurn(samples: samples, sampleRate: sampleRate)
        }
    }

    private func transcribeTurn(samples: [Int16], sampleRate: Double) async {
        guard samples.count > Int(sampleRate * 0.20) else {
            isTranscribing = false
            lastTurnDebugLine = "Ignored a very short voice turn"
            diagnosticLine = lastTurnDebugLine
            VoiceDebugLog.write("turn ignored too_short samples=\(samples.count) sample_rate=\(Int(sampleRate))")
            resumeListening()
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pikiclaw-voice-turn-\(UUID().uuidString).wav")
        do {
            try VoiceWAVWriter.writeMonoPCM16(samples: samples, sampleRate: sampleRate, to: url)
            VoiceDebugLog.write("turn wav written path=\(url.path)")
            let result = try await transcribeAudioFile(url)
            transcript = result.text
            finalizedTurn = result
            statusLine = "Captured by \(result.backend.rawValue)"
            diagnosticLine = "Recognized · \(result.backend.rawValue)"
            lastTurnDebugLine = "Recognized by \(result.backend.rawValue): \(result.text)"
            VoiceDebugLog.write("turn transcribed backend=\(result.backend.rawValue) text=\(result.text)")
        } catch {
            statusLine = "Transcription failed: \(error.localizedDescription)"
            diagnosticLine = statusLine
            lastTurnDebugLine = statusLine
            VoiceDebugLog.write("turn transcription failed error=\(error.localizedDescription)")
        }
        try? FileManager.default.removeItem(at: url)
        isTranscribing = false
        resumeListening()
    }

    private func requestLiveTranscriptAccess() async -> Bool {
        guard hasUsageDescription("NSSpeechRecognitionUsageDescription") else { return false }
        let status = await VoicePermissionRequester.requestSpeechAuthorization()
        return status == .authorized
    }

    private func startLiveTranscript() {
        guard liveTranscriptEnabled else { return }
        stopLiveTranscript(cancelTask: true)
        guard let recognizer = SFSpeechRecognizer(locale: recognitionLanguage.locale),
              recognizer.isAvailable else {
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        liveSpeechRecognizer = recognizer
        liveRecognitionRequest = request
        liveTranscriptBuffer.set(request)
        liveRecognitionTask = recognizer.recognitionTask(
            with: request,
            resultHandler: Self.makeLiveTranscriptHandler(for: self)
        )
    }

    private func stopLiveTranscript(cancelTask: Bool) {
        liveTranscriptBuffer.endAudio()
        if cancelTask {
            liveRecognitionTask?.cancel()
        }
        liveRecognitionTask = nil
        liveRecognitionRequest = nil
        liveSpeechRecognizer = nil
    }

    nonisolated private static func makeLiveTranscriptHandler(
        for controller: ContinuousVoiceSessionController
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak controller] result, error in
            let transcript = result?.bestTranscription.formattedString
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let isFinal = result?.isFinal == true
            let didStop = isFinal || error != nil
            Task { @MainActor [weak controller] in
                guard let controller else { return }
                if let transcript, !transcript.isEmpty {
                    controller.transcript = transcript
                    controller.diagnosticLine = "Live transcript · \(transcript)"
                    VoiceDebugLog.write("live transcript final=\(isFinal) text=\(transcript)")
                    if controller.isCapturingTurn {
                        controller.statusLine = isFinal ? "Captured live transcript" : "Live transcript"
                    }
                }
                if didStop {
                    controller.stopLiveTranscript(cancelTask: false)
                }
            }
        }
    }

    private func transcribeAudioFile(_ url: URL) async throws -> FinalizedTurn {
        if configuration.enabled {
            do {
                let transcript = try await VoiceboxClient(configuration: configuration).transcribe(audioFile: url, language: recognitionLanguage)
                return FinalizedTurn(
                    text: transcript.text.trimmingCharacters(in: .whitespacesAndNewlines),
                    backend: .voicebox,
                    duration: transcript.duration
                )
            } catch {
                voiceboxOnline = false
                voiceboxStatus = "Voicebox fallback: \(error.localizedDescription)"
            }
        }

        let fallback = try await AppleSpeechFileTranscriber.transcribe(url: url, language: recognitionLanguage)
        return FinalizedTurn(
            text: fallback.trimmingCharacters(in: .whitespacesAndNewlines),
            backend: .apple,
            duration: nil
        )
    }

    private func requestMicrophoneAccess() async -> Bool {
        await VoicePermissionRequester.requestMicrophoneAccess()
    }

    private func updateInputDiagnostics(for packet: VoiceAudioPacket) {
        let now = Date()
        guard now.timeIntervalSince(lastDiagnosticsAt) >= 0.75 else { return }
        lastDiagnosticsAt = now
        let mode = isCapturingTurn ? "capturing" : (isListening ? "listening" : activityLabel)
        diagnosticLine = "Mic \(formatPercent(packet.level)) · \(mode)"
        if packetsSeen == 1 || packet.level >= startThreshold || now.timeIntervalSince(lastPacketLogAt) >= 2.0 {
            lastPacketLogAt = now
            VoiceDebugLog.write("audio packet count=\(packetsSeen) level=\(formatLevel(packet.level)) mode=\(mode)")
        }
    }

    private func hasUsageDescription(_ key: String) -> Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func estimatedSpeechSeconds(for text: String) -> Double {
        let characters = max(12, text.count)
        return min(16, max(1.8, Double(characters) / 9.5))
    }

    private func suppressInputForOutputTail(seconds: TimeInterval) {
        inputSuppressedUntil = max(inputSuppressedUntil, Date().addingTimeInterval(seconds))
    }

    private func formatPercent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }

    private func formatLevel(_ value: Double) -> String {
        String(format: "%.4f", value)
    }

    private func formatSeconds(_ value: Double) -> String {
        String(format: "%.2f", value)
    }
}

enum AppleSpeechFileTranscriber {
    static func transcribe(url: URL, language: VoiceRecognitionLanguage) async throws -> String {
        let status = SFSpeechRecognizer.authorizationStatus()
        let authorized: Bool
        if status == .notDetermined {
            authorized = await VoicePermissionRequester.requestSpeechAuthorization() == .authorized
        } else {
            authorized = status == .authorized
        }
        guard authorized else {
            throw VoiceboxClientError.transport("Apple speech permission is not available.")
        }
        guard let recognizer = SFSpeechRecognizer(locale: language.locale), recognizer.isAvailable else {
            throw VoiceboxClientError.transport("Apple speech recognizer is unavailable.")
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false

        return try await withCheckedThrowingContinuation { continuation in
            let state = AppleSpeechRecognitionState(continuation: continuation)
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let transcript = result?.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                   !transcript.isEmpty {
                    state.updateBestTranscript(transcript)
                }
                if let result, result.isFinal {
                    let transcript = result.bestTranscription.formattedString
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !transcript.isEmpty else {
                        state.complete(.failure(VoiceboxClientError.emptyTranscript))
                        return
                    }
                    state.complete(.success(transcript))
                } else if let error {
                    let fallback = state.fallbackTranscript()
                    if fallback.isEmpty {
                        state.complete(.failure(error))
                    } else {
                        state.complete(.success(fallback))
                    }
                }
            }
            state.setTask(task)

            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 12) {
                let fallback = state.fallbackTranscript()
                if fallback.isEmpty {
                    state.complete(.failure(VoiceboxClientError.transport("Apple speech timed out.")))
                } else {
                    state.complete(.success(fallback))
                }
            }
        }
    }
}

private final class AppleSpeechRecognitionState: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private var bestTranscript = ""
    private var task: SFSpeechRecognitionTask?
    private let continuation: CheckedContinuation<String, Error>

    init(continuation: CheckedContinuation<String, Error>) {
        self.continuation = continuation
    }

    func setTask(_ task: SFSpeechRecognitionTask) {
        lock.lock()
        self.task = task
        lock.unlock()
    }

    func updateBestTranscript(_ transcript: String) {
        lock.lock()
        bestTranscript = transcript
        lock.unlock()
    }

    func fallbackTranscript() -> String {
        lock.lock()
        let transcript = bestTranscript
        lock.unlock()
        return transcript
    }

    func complete(_ result: Result<String, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let taskToCancel = task
        lock.unlock()
        taskToCancel?.cancel()
        continuation.resume(with: result)
    }
}

extension VoiceRecognitionLanguage {
    var voiceboxLanguageCode: String {
        switch self {
        case .chinese: return "zh"
        case .cantonese: return "yue"
        case .english: return "en"
        case .japanese: return "ja"
        case .korean: return "ko"
        }
    }
}

private extension JSONDecoder {
    static var voicebox: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

private extension URL {
    func appending(path: String) -> URL {
        var clean = path
        if clean.hasPrefix("/") {
            clean.removeFirst()
        }
        return appendingPathComponent(clean)
    }
}

private extension Data {
    mutating func appendUTF8(_ string: String) {
        append(string.data(using: .utf8) ?? Data())
    }

    mutating func appendASCII(_ string: String) {
        append(string.data(using: .ascii) ?? Data())
    }

    mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
        var next = value.littleEndian
        Swift.withUnsafeBytes(of: &next) { append(contentsOf: $0) }
    }
}
