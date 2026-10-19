//! Each window may call only the commands it needs (v0.18.3).
//!
//! Two kinds of check, so a command added later cannot slip past the model:
//!
//! * **Alignment:** every command registered in `src/lib.rs` is declared to
//!   Tauri (build.rs); the permission sets in `permissions/windows.toml`
//!   grant only registered commands; every command the interface calls is
//!   granted to the window that calls it; the audience screen's code calls
//!   only what its set grants.
//! * **Enforcement:** with the app's real capabilities (its generated
//!   context), Tauri's own permission check is asked, window by window, for
//!   every registered command and for representative plugin commands.

use std::collections::BTreeSet;
use std::path::Path;

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

fn read(path: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap()
}

/// The commands registered with `generate_handler!`.
fn registered() -> BTreeSet<String> {
    let lib = read("src/lib.rs");
    let start = lib.find("generate_handler![").unwrap();
    let block = &lib[start..];
    let block = &block[..block.find(']').unwrap()];
    block
        .split(',')
        .filter_map(|e| e.trim().rsplit("::").next())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .collect()
}

/// The commands a permission set of `permissions/windows.toml` grants.
fn set(identifier: &str) -> BTreeSet<String> {
    let toml = read("permissions/windows.toml");
    let at = toml
        .find(&format!("identifier = \"{identifier}\""))
        .unwrap_or_else(|| panic!("no set {identifier}"));
    let rest = &toml[at..];
    let list = &rest[rest.find("permissions = [").unwrap()..];
    let list = &list[..list.find(']').unwrap()];
    list.split('"')
        .filter(|s| s.starts_with("allow-"))
        .map(|s| s["allow-".len()..].replace('-', "_"))
        .collect()
}

/// `api.method` → the command it calls, from `tauriApi` in `src/lib/api.ts`
/// (a call may sit on a later line than its method name).
fn api_commands() -> Vec<(String, String)> {
    let api = read("../src/lib/api.ts");
    let body = &api[api.find("export const tauriApi").unwrap()..];
    let mut out = Vec::new();
    let mut method = String::new();
    for line in body.lines() {
        // A method of the object literal: two spaces, a name, a colon.
        if let Some(rest) = line.strip_prefix("  ") {
            if !rest.starts_with(' ') {
                if let Some((name, _)) = rest.split_once(':') {
                    if name.chars().all(|c| c.is_ascii_alphanumeric()) && !name.is_empty() {
                        method = name.to_string();
                    }
                }
            }
        }
        let mut rest = line;
        while let Some(at) = rest.find("call") {
            rest = &rest[at + 4..];
            let after =
                rest.trim_start_matches(|c: char| c != '(' && c != '"' && c != ' ' && c != ';');
            let Some(open) = after.strip_prefix("(\"") else {
                continue;
            };
            let name: String = open.chars().take_while(|c| *c != '"').collect();
            if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                out.push((method.clone(), name));
            }
        }
    }
    out
}

/// The audience screen's code: the window component and the hooks it uses.
const AUDIENCE_FILES: &[&str] = &[
    "../src/features/presentation/AudienceWindow.tsx",
    "../src/features/presentation/useSlideImages.ts",
    "../src/features/presentation/useDesignPages.ts",
    "../src/features/presentation/SlideView.tsx",
    "../src/features/presentation/TemplateSlide.tsx",
];

const AUDIENCE: &[&str] = &[
    "presentation_audience",
    "presentation_audience_state",
    "presentation_audience_key",
    "presentation_layout",
    "presentation_image",
];

/// Commands the audience screen must never reach (representative of what it
/// has no use for: files, exports, library, Bibles, settings, assistant).
const PRIVILEGED: &[&str] = &[
    "bible_import_preview",
    "bible_import_commit",
    "bible_remove",
    "bible_set_language",
    "settings_get",
    "settings_update",
    "presentation_export",
    "presentation_template_import",
    "presentation_audience_open",
    "presentation_audience_show",
    "library_import",
    "library_source_remove",
    "assistant_settings_update",
    "assistant_key_set",
    "backup_create",
    "app_log_error",
];

#[test]
fn the_permission_sets_match_the_registered_commands_and_the_interface() {
    let registered = registered();
    let main = set("main-window");
    let audience = set("audience-window");
    assert!(registered.len() > 150, "{}", registered.len());
    // Only registered commands are granted.
    for name in main.iter().chain(&audience) {
        assert!(
            registered.contains(name),
            "permissions/windows.toml grants unknown command {name}"
        );
    }
    // The audience set is exactly the five.
    assert_eq!(
        audience,
        AUDIENCE.iter().map(|s| s.to_string()).collect(),
        "audience-window"
    );
    // Every command the interface calls is granted to some window …
    let calls = api_commands();
    assert!(calls.len() > 150, "{}", calls.len());
    for (method, command) in &calls {
        assert!(
            registered.contains(command),
            "api.{method} calls unregistered {command}"
        );
        assert!(
            main.contains(command) || audience.contains(command),
            "api.{method} calls {command}, which no window may call: add it to permissions/windows.toml"
        );
    }
    // … and nothing is granted that no screen calls.
    let called: BTreeSet<&String> = calls.iter().map(|(_, c)| c).collect();
    for name in &main {
        assert!(
            called.contains(name),
            "main-window grants {name}, which the interface never calls"
        );
    }
    // The audience-only commands are not the main window's.
    for name in [
        "presentation_audience",
        "presentation_audience_state",
        "presentation_audience_key",
    ] {
        assert!(!main.contains(name), "{name}");
    }
    // The audience screen's code calls nothing outside its set.
    let by_method: std::collections::HashMap<&str, &str> = calls
        .iter()
        .map(|(m, c)| (m.as_str(), c.as_str()))
        .collect();
    for file in AUDIENCE_FILES {
        let code = read(file);
        for (at, _) in code.match_indices("api.") {
            let method: String = code[at + 4..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            if let Some(command) = by_method.get(method.as_str()) {
                if !method.starts_with("on") {
                    assert!(
                        audience.contains(*command),
                        "{file} calls api.{method} ({command}), not in audience-window"
                    );
                }
            }
        }
    }
}

#[test]
fn the_capabilities_attach_one_set_to_each_window_and_little_else() {
    let audience: serde_json::Value =
        serde_json::from_str(&read("capabilities/audience.json")).unwrap();
    assert_eq!(audience["windows"], serde_json::json!(["audience"]));
    assert_eq!(
        audience["permissions"],
        serde_json::json!([
            "audience-window",
            "core:event:allow-listen",
            "core:event:allow-unlisten"
        ])
    );
    let main: serde_json::Value = serde_json::from_str(&read("capabilities/default.json")).unwrap();
    assert_eq!(main["windows"], serde_json::json!(["main"]));
    let permissions = main["permissions"].to_string();
    assert!(permissions.contains("\"main-window\""));
    assert!(!permissions.contains("audience-window"));
}

fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
) -> Result<(), String> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn refused(result: &Result<(), String>) -> bool {
    matches!(result, Err(e) if e.contains("not allowed"))
}

#[test]
fn tauri_refuses_each_window_what_its_capabilities_do_not_grant() {
    // No handlers: a command that passes the permission check fails afterwards
    // as unknown, one that does not is refused as "not allowed".
    let app = mock_builder()
        .build(tauri::generate_context!("tauri.conf.json", test = true))
        .unwrap();
    let audience = WebviewWindowBuilder::new(&app, "audience", Default::default())
        .build()
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main_set = set("main-window");
    for command in registered() {
        let from_audience = invoke(&audience, &command);
        assert_eq!(
            !refused(&from_audience),
            AUDIENCE.contains(&command.as_str()),
            "audience → {command}: {from_audience:?}"
        );
        let from_main = invoke(&main, &command);
        assert_eq!(
            !refused(&from_main),
            main_set.contains(&command),
            "main → {command}: {from_main:?}"
        );
    }
    for command in PRIVILEGED {
        assert!(refused(&invoke(&audience, command)), "audience → {command}");
    }
    // A window with any other label gets nothing.
    let stray = WebviewWindowBuilder::new(&app, "stray", Default::default())
        .build()
        .unwrap();
    assert!(refused(&invoke(&stray, "settings_get")));
    assert!(refused(&invoke(&stray, "presentation_audience_state")));
    // Plugins: dialogs, links, updates, window control and webview creation
    // are the main window's, never the audience screen's.
    for command in [
        "plugin:dialog|open",
        "plugin:dialog|save",
        "plugin:opener|open_url",
        "plugin:updater|check",
        "plugin:window|close",
        "plugin:window|set_fullscreen",
        "plugin:webview|create_webview_window",
        "plugin:event|emit",
    ] {
        assert!(refused(&invoke(&audience, command)), "audience → {command}");
    }
    for command in [
        "plugin:dialog|open",
        "plugin:dialog|save",
        "plugin:opener|open_url",
        "plugin:event|listen",
    ] {
        assert!(!refused(&invoke(&main, command)), "main → {command}");
    }
    assert!(!refused(&invoke(&audience, "plugin:event|listen")));
}
