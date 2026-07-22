# Ferrum Tauri host

This package is the migration host for the Tabby-based Ferrum UI. It keeps the
existing Angular/xterm workspace while moving native responsibilities out of
Electron and into Rust commands.

Implemented in this milestone:

- native Tauri 2 application shell;
- Rust PTY spawn, input, resize, output events and termination;
- atomic configuration load/save commands;
- Angular providers for `PTYInterface` and `ShellProvider`;
- size-oriented Rust release profile.

The Electron host remains the runnable feature-complete target while the WebView
bootstrap and SSH/SFTP adapters are moved behind the same interfaces. The
placeholder in `frontend/` exists only so `cargo check` and Tauri configuration
validation can run before the production WebView bundle is attached.
