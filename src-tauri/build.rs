fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let native_dir = std::path::Path::new(&manifest_dir).join("native");
        let helper_swift = native_dir.join("Helper.swift");
        let helper_bin = native_dir.join("dudu-native");

        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_else(|_| "aarch64".into());
        let triple = if arch == "aarch64" {
            "arm64-apple-macos13.0"
        } else {
            "x86_64-apple-macos13.0"
        };
        let result = std::process::Command::new("swiftc")
            .args([
                helper_swift.to_str().unwrap(),
                "-O",
                "-target",
                triple,
                "-o",
                helper_bin.to_str().unwrap(),
            ])
            .status()
            .expect("Xcode Command Line Tools are required to build the macOS OCR helper");
        assert!(result.success(), "Could not compile the native OCR helper");
    }
    println!("cargo:rerun-if-changed=native/Helper.swift");
    tauri_build::build()
}
