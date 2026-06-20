import Foundation
import Testing
@testable import PikiclawMac

@Test func voiceboxMultipartBodyCarriesFieldsAndAudioFile() {
    let body = VoiceboxMultipart.body(
        boundary: "boundary",
        fields: [("language", "zh"), ("model", "turbo")],
        fileFieldName: "file",
        fileName: "turn.wav",
        mimeType: "audio/wav",
        fileData: Data([0x01, 0x02, 0x03])
    )
    let text = String(data: body, encoding: .utf8) ?? ""

    #expect(text.contains("name=\"language\""))
    #expect(text.contains("zh"))
    #expect(text.contains("name=\"model\""))
    #expect(text.contains("turbo"))
    #expect(text.contains("name=\"file\"; filename=\"turn.wav\""))
    #expect(text.contains("Content-Type: audio/wav"))
    #expect(text.hasSuffix("--boundary--\r\n"))
}

@Test func voiceWAVWriterProducesPCM16MonoHeader() throws {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-voicebox-runtime-test-\(UUID().uuidString).wav")
    defer { try? FileManager.default.removeItem(at: url) }

    try VoiceWAVWriter.writeMonoPCM16(samples: [-32768, 0, 32767], sampleRate: 16_000, to: url)
    let data = try Data(contentsOf: url)

    #expect(String(data: data[0..<4], encoding: .ascii) == "RIFF")
    #expect(String(data: data[8..<12], encoding: .ascii) == "WAVE")
    #expect(String(data: data[12..<16], encoding: .ascii) == "fmt ")
    #expect(String(data: data[36..<40], encoding: .ascii) == "data")
    #expect(data.count == 44 + 6)
}
