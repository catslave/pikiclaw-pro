import AppKit
import SwiftUI

enum PKThemePreference: String, CaseIterable, Identifiable {
    static let storageKey = "pikiclaw-native-theme"

    case dark
    case light

    var id: String { rawValue }

    var colorScheme: ColorScheme {
        switch self {
        case .dark: .dark
        case .light: .light
        }
    }

    var title: String {
        switch self {
        case .dark: "Dark"
        case .light: "Light"
        }
    }

    var detail: String {
        switch self {
        case .dark: "Low-glare focus mode for long sessions."
        case .light: "Bright review mode for daytime work."
        }
    }

    var systemImage: String {
        switch self {
        case .dark: "moon"
        case .light: "sun.max"
        }
    }
}

private struct PKColorSpec {
    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat

    var nsColor: NSColor {
        NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
    }
}

private func pkColor(_ red: Double, _ green: Double, _ blue: Double, _ alpha: Double = 1) -> PKColorSpec {
    PKColorSpec(red: CGFloat(red), green: CGFloat(green), blue: CGFloat(blue), alpha: CGFloat(alpha))
}

private func pkAdaptive(light: PKColorSpec, dark: PKColorSpec) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
        let matched = appearance.bestMatch(from: [.aqua, .darkAqua])
        return (matched == .darkAqua ? dark : light).nsColor
    })
}

enum PKTheme {
    static let surface = pkAdaptive(light: pkColor(0.957, 0.961, 0.968), dark: pkColor(0.067, 0.067, 0.075))
    static let surfaceRaised = pkAdaptive(light: pkColor(0.992, 0.994, 0.997), dark: pkColor(0.106, 0.110, 0.122))
    static let surfaceHover = pkAdaptive(light: pkColor(0.902, 0.918, 0.940), dark: pkColor(0.176, 0.180, 0.200))
    static let sidebar = pkAdaptive(light: pkColor(0.992, 0.994, 0.997, 0.96), dark: pkColor(0.078, 0.082, 0.094, 0.88))
    static let panel = pkAdaptive(light: pkColor(0.992, 0.994, 0.997), dark: pkColor(0.106, 0.110, 0.122))
    static let panelAlt = pkAdaptive(light: pkColor(0.940, 0.949, 0.961), dark: pkColor(0.176, 0.180, 0.200))
    static let control = pkAdaptive(light: pkColor(0.070, 0.110, 0.180, 0.080), dark: pkColor(1, 1, 1, 0.060))
    static let controlBorder = pkAdaptive(light: pkColor(0.070, 0.110, 0.180, 0.220), dark: pkColor(0.58, 0.64, 0.72, 0.28))
    static let selected = pkAdaptive(light: pkColor(0.110, 0.190, 0.320, 0.100), dark: pkColor(1, 1, 1, 0.070))
    static let inset = pkAdaptive(light: pkColor(0.918, 0.932, 0.948), dark: pkColor(1, 1, 1, 0.055))
    static let edge = pkAdaptive(light: pkColor(0.070, 0.110, 0.180, 0.160), dark: pkColor(1, 1, 1, 0.13))
    static let edgeStrong = pkAdaptive(light: pkColor(0.070, 0.110, 0.180, 0.280), dark: pkColor(1, 1, 1, 0.24))
    static let text = pkAdaptive(light: pkColor(0.059, 0.090, 0.165, 0.98), dark: pkColor(1, 1, 1, 0.94))
    static let text2 = pkAdaptive(light: pkColor(0.118, 0.161, 0.231, 0.86), dark: pkColor(1, 1, 1, 0.78))
    static let text3 = pkAdaptive(light: pkColor(0.278, 0.333, 0.412, 0.74), dark: pkColor(1, 1, 1, 0.55))
    static let text4 = pkAdaptive(light: pkColor(0.278, 0.333, 0.412, 0.58), dark: pkColor(1, 1, 1, 0.46))
    static let primary = pkAdaptive(light: pkColor(0.055, 0.330, 0.580), dark: pkColor(0.498, 0.796, 0.733))
    static let primaryText = pkAdaptive(light: pkColor(1, 1, 1), dark: pkColor(0.012, 0.090, 0.078))
    static let jira = pkAdaptive(light: pkColor(0.000, 0.322, 0.800), dark: pkColor(0.322, 0.612, 1.000))
    static let jiraText = pkAdaptive(light: pkColor(1, 1, 1), dark: pkColor(0.020, 0.063, 0.141))
    static let ok = pkAdaptive(light: pkColor(0.045, 0.520, 0.290), dark: pkColor(0.204, 0.827, 0.600))
    static let warn = pkAdaptive(light: pkColor(0.961, 0.620, 0.043), dark: pkColor(0.984, 0.749, 0.141))
    static let err = pkAdaptive(light: pkColor(0.937, 0.267, 0.267), dark: pkColor(0.973, 0.443, 0.443))
    static let gridLine = pkAdaptive(light: pkColor(0.070, 0.110, 0.180, 0.026), dark: pkColor(1, 1, 1, 0.035))
}

struct PKPanel: ViewModifier {
    var radius: CGFloat = 8
    var fill: Color = PKTheme.surfaceRaised

    func body(content: Content) -> some View {
        content
            .background(fill.opacity(0.92))
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .stroke(PKTheme.edge, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: radius))
    }
}

extension View {
    func pkPanel(radius: CGFloat = 8, fill: Color = PKTheme.surfaceRaised) -> some View {
        modifier(PKPanel(radius: radius, fill: fill))
    }
}
