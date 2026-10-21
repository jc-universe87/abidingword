//! The native API the frontend calls through Tauri's `invoke`.
//!
//! Commands are thin: they take typed input, call a repository function in
//! `crate::db`, and return typed output or an [`ErrorPayload`]. No SQL
//! crosses this boundary. The only file paths the frontend sends are the
//! files the user picked in the system's open dialog to import a Bible.
//!
//! Commands are marked `async` so database work runs off the window's main
//! thread and never freezes the interface.

pub mod annotations;
pub mod app;
pub mod assistant;
pub mod bibles;
pub mod blocks;
pub mod findings;
pub mod library;
pub mod materials;
pub mod presentation_templates;
pub mod presentations;
pub mod projects;
pub mod relations;
pub mod scripture;
pub mod sections;
pub mod settings;
pub mod source_annotations;
pub mod studies;
pub mod study_passages;
pub mod teaching;
pub mod teaching_templates;
pub mod templates;
pub mod workspaces;

use crate::error::ErrorPayload;

pub type CommandResult<T> = Result<T, ErrorPayload>;
