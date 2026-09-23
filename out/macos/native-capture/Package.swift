// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BkemoCapture",
    platforms: [.macOS("26.0")],
    dependencies: [
        .package(path: "../../ios/Shared")
    ],
    targets: [
        .executableTarget(
            name: "BkemoCapture",
            dependencies: [
                .product(name: "BkemoShared", package: "Shared")
            ],
            path: "Sources/BkemoCapture"
        ),
        .testTarget(
            name: "BkemoCaptureTests",
            dependencies: ["BkemoCapture"],
            path: "Tests/BkemoCaptureTests"
        )
    ]
)
