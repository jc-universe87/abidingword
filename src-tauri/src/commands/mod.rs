//! The native API the frontend calls through Tauri's `invoke`.
//!
//! Commands are thin: they take typed input, call a repository function in
//! `crate::db`, and return typed output or an [`ErrorPayload`]. No SQL and no
//! file paths cross this boundary from the frontend.
//!
//! Commands are marked `async` so database work runs off the window's main
//! thread and never freezes the interface.

pub mod app;
pub mod blocks;
pub mod projects;
pub mod sections;
pub mod settings;
pub mod studies;
pub mod workspaces;

use crate::error::ErrorPayload;

pub type CommandResult<T> = Result<T, ErrorPayload>;
