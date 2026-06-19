// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PikiclawMacNative",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "PikiclawMac", targets: ["PikiclawMac"]),
        .library(name: "PikiclawCore", targets: ["PikiclawCore"]),
        .library(name: "PikiclawRunner", targets: ["PikiclawRunner"])
    ],
    targets: [
        .target(name: "PikiclawCore"),
        .target(name: "PikiclawRunner", dependencies: ["PikiclawCore"]),
        .executableTarget(
            name: "PikiclawMac",
            dependencies: ["PikiclawCore", "PikiclawRunner"]
        ),
        .testTarget(name: "PikiclawCoreTests", dependencies: ["PikiclawCore"]),
        .testTarget(name: "PikiclawRunnerTests", dependencies: ["PikiclawRunner"])
    ]
)

