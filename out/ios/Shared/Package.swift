// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BkemoShared",
    platforms: [.iOS(.v17)],
    products: [.library(name: "BkemoShared", targets: ["BkemoShared"])],
    targets: [.target(name: "BkemoShared", path: "Sources/BkemoShared")]
)