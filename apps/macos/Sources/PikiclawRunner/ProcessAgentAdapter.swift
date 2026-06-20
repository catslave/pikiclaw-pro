import Foundation
import PikiclawCore

public struct ProcessAgentAdapter: AgentAdapter {
    public let descriptor: AgentDescriptor
    public var arguments: [String]
    public var useLaunchRequestArguments: Bool

    public init(descriptor: AgentDescriptor, arguments: [String] = [], useLaunchRequestArguments: Bool = true) {
        self.descriptor = descriptor
        self.arguments = arguments
        self.useLaunchRequestArguments = useLaunchRequestArguments
    }

    public func detect() async -> AgentDetection {
        let environment = NativeExecutableResolver.executionEnvironment()
        let path = NativeExecutableResolver.findExecutable(named: descriptor.executableName, environment: environment)
        return AgentDetection(
            isAvailable: path != nil,
            executablePath: path,
            authState: path == nil ? "unavailable" : "unknown",
            detail: path == nil ? "\(descriptor.executableName) was not found on PATH." : "Executable detected."
        )
    }

    public func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            var environment = NativeExecutableResolver.executionEnvironment(requestEnvironment: request.environment)
            guard let executablePath = NativeExecutableResolver.findExecutable(named: descriptor.executableName, environment: environment) else {
                continuation.yield(.failed("\(descriptor.executableName) was not found on PATH."))
                continuation.finish()
                return
            }
            environment = NativeExecutableResolver.environmentIncludingExecutableDirectory(executablePath, environment: environment)

            let process = Process()
            process.executableURL = URL(fileURLWithPath: executablePath)
            process.arguments = useLaunchRequestArguments && !request.arguments.isEmpty ? request.arguments : arguments
            process.currentDirectoryURL = URL(fileURLWithPath: request.workspacePath, isDirectory: true)
            process.environment = environment

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            let stdin = Pipe()
            process.standardInput = stdin

            let emitData: @Sendable (Data) -> Void = { data in
                guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return }
                continuation.yield(.output(text))
            }

            stdout.fileHandleForReading.readabilityHandler = { handle in emitData(handle.availableData) }
            stderr.fileHandleForReading.readabilityHandler = { handle in emitData(handle.availableData) }

            process.terminationHandler = { process in
                stdout.fileHandleForReading.readabilityHandler = nil
                stderr.fileHandleForReading.readabilityHandler = nil
                continuation.yield(.completed(exitCode: process.terminationStatus))
                continuation.finish()
            }

            do {
                continuation.yield(.stateChanged(.starting))
                try process.run()
                continuation.yield(.stateChanged(.running))
                if let stdinText = request.stdinText {
                    if let data = stdinText.data(using: .utf8) {
                        stdin.fileHandleForWriting.write(data)
                    }
                }
                try? stdin.fileHandleForWriting.close()
            } catch {
                try? stdin.fileHandleForWriting.close()
                continuation.yield(.failed(error.localizedDescription))
                continuation.finish()
            }
        }
    }
}

enum NativeExecutableResolver {
    static func executionEnvironment(
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment,
        requestEnvironment: [String: String] = [:],
        homeDirectory: String = NSHomeDirectory()
    ) -> [String: String] {
        var environment = baseEnvironment.merging(requestEnvironment) { _, new in new }
        environment["PATH"] = expandedPath(from: environment["PATH"], homeDirectory: environment["HOME"] ?? homeDirectory)
        return environment
    }

    static func findExecutable(named name: String, environment: [String: String]) -> String? {
        if name.contains("/") {
            return FileManager.default.isExecutableFile(atPath: name) ? name : nil
        }
        let pathValue = environment["PATH"] ?? expandedPath(from: nil, homeDirectory: environment["HOME"] ?? NSHomeDirectory())
        for directory in pathValue.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent(name).path
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return resolveWithLoginShell(name)
    }

    static func environmentIncludingExecutableDirectory(_ executablePath: String, environment: [String: String]) -> [String: String] {
        let directory = URL(fileURLWithPath: executablePath).deletingLastPathComponent().path
        var next = environment
        let pathValue = next["PATH"] ?? ""
        let parts = pathValue.split(separator: ":").map(String.init)
        if !parts.contains(directory) {
            next["PATH"] = ([directory] + parts).joined(separator: ":")
        }
        return next
    }

    static func expandedPath(from currentPath: String?, homeDirectory: String) -> String {
        var directories = currentPath?
            .split(separator: ":")
            .map(String.init)
            .filter { !$0.isEmpty } ?? []
        directories.append(contentsOf: [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            homePath(".local/bin", homeDirectory: homeDirectory),
            homePath(".cargo/bin", homeDirectory: homeDirectory),
            homePath(".asdf/shims", homeDirectory: homeDirectory),
            homePath(".nodenv/shims", homeDirectory: homeDirectory),
            homePath(".volta/bin", homeDirectory: homeDirectory),
            homePath(".bun/bin", homeDirectory: homeDirectory),
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ])
        directories.append(contentsOf: nodeVersionBins(homeDirectory: homeDirectory))
        var seen = Set<String>()
        return directories.filter { seen.insert($0).inserted }.joined(separator: ":")
    }

    private static func homePath(_ suffix: String, homeDirectory: String) -> String {
        URL(fileURLWithPath: homeDirectory).appendingPathComponent(suffix).path
    }

    private static func nodeVersionBins(homeDirectory: String) -> [String] {
        let root = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent(".nvm")
            .appendingPathComponent("versions")
            .appendingPathComponent("node")
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        return entries
            .filter { url in
                (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedDescending }
            .map { $0.appendingPathComponent("bin").path }
    }

    private static func resolveWithLoginShell(_ name: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v -- \(shellQuote(name))"]

        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }
        guard process.terminationStatus == 0 else { return nil }
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        let resolved = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !resolved.isEmpty, FileManager.default.isExecutableFile(atPath: resolved) else {
            return nil
        }
        return resolved
    }

    private static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}
