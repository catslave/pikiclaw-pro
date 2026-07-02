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
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-markdown.git", from: "0.6.0"),
        .package(url: "https://github.com/JohnSundell/Splash.git", from: "0.16.0")
    ],
    targets: [
        .target(name: "PikiclawCore"),
        .target(name: "PikiclawRunner", dependencies: ["PikiclawCore"]),
        .executableTarget(
            name: "PikiclawMac",
            dependencies: [
                "PikiclawCore",
                "PikiclawRunner",
                .product(name: "Markdown", package: "swift-markdown"),
                .product(name: "Splash", package: "Splash")
            ],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(name: "PikiclawCoreTests", dependencies: ["PikiclawCore"]),
        .testTarget(name: "PikiclawMacTests", dependencies: ["PikiclawMac"]),
        .testTarget(name: "PikiclawRunnerTests", dependencies: ["PikiclawRunner"])
    ]
)
