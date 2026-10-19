//! Build script: Tauri's build step, with the app's own commands declared so
//! that each window can be given only the commands it needs (v0.18.3,
//! `permissions/windows.toml`, `capabilities/`). The command list is read
//! from the `generate_handler!` in `src/lib.rs`, so a new command is denied
//! to every window until a permission set grants it.

fn registered_commands() -> Vec<&'static str> {
    let lib = std::fs::read_to_string("src/lib.rs").expect("src/lib.rs is readable");
    let start = lib
        .find("generate_handler![")
        .expect("generate_handler! in src/lib.rs");
    let block = &lib[start..];
    let block = &block[..block.find(']').expect("generate_handler! is closed")];
    block
        .split(',')
        .filter_map(|entry| entry.trim().rsplit("::").next())
        .map(str::trim)
        .filter(|name| {
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
        .map(|name| &*Box::leak(name.to_string().into_boxed_str()))
        .collect()
}

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=permissions/windows.toml");
    let commands: &'static [&'static str] = Box::leak(registered_commands().into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("tauri build step");
}
