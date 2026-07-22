use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState {
    sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtySpawnRequest {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
}

#[derive(Serialize)]
struct PtySpawnResult {
    id: String,
    pid: u32,
}

fn config_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No configuration directory is available".to_owned())?;
    Ok(base.join("Ferrum").join("config.yaml"))
}

#[tauri::command]
fn load_config() -> Result<String, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_config(content: String) -> Result<(), String> {
    let path = config_path()?;
    let parent = path.parent().ok_or_else(|| "Invalid configuration path".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("yaml.tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_owned())
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    request: PtySpawnRequest,
) -> Result<PtySpawnResult, String> {
    let system = native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new(request.command);
    command.args(request.args);
    if let Some(cwd) = request.cwd {
        command.cwd(cwd);
    }
    for (key, value) in request.env {
        command.env(key, value);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let pid = child.process_id().unwrap_or_default();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let reader_id = id.clone();

    std::thread::spawn(move || {
        let mut buffer = vec![0_u8; 32 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let _ = app.emit(&format!("pty:{reader_id}:data"), buffer[..length].to_vec());
                }
                Err(_) => break,
            }
        }
        let _ = app.emit(&format!("pty:{reader_id}:exit"), ());
        let _ = app.emit(&format!("pty:{reader_id}:close"), ());
    });

    state.sessions.lock().map_err(|error| error.to_string())?.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );

    Ok(PtySpawnResult { id, pid })
}

#[tauri::command]
fn pty_write(state: State<'_, PtyState>, id: String, data: Vec<u8>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions.get_mut(&id).ok_or_else(|| "PTY session not found".to_owned())?;
    session.writer.write_all(&data).map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions.get(&id).ok_or_else(|| "PTY session not found".to_owned())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols: columns,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let mut session = sessions.remove(&id).ok_or_else(|| "PTY session not found".to_owned())?;
    session.child.kill().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            default_shell,
            get_app_version,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ferrum");
}
