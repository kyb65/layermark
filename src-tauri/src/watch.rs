// src-tauri/src/watch.rs
// Phase 3: content.lm file watcher using notify crate
// Emits "content-changed" Tauri event when content.lm is modified externally.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

// Global watcher state — only one folder watched at a time.
pub struct WatcherState {
    pub inner: Mutex<Option<RecommendedWatcher>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

// Start watching a note folder for content.lm changes.
// Replaces any existing watcher (stops previous watch automatically).
#[tauri::command]
pub fn watch_note_folder(
    folder: String,
    app: AppHandle,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    let folder_path = PathBuf::from(&folder);
    let folder_for_event = folder.clone();

    let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            // Only react to content.lm modify/create events
            let is_content = event.paths.iter().any(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n == "content.lm")
                    .unwrap_or(false)
            });
            if !is_content {
                return;
            }
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    let _ = app.emit("content-changed", folder_for_event.clone());
                }
                _ => {}
            }
        }
    })
    .map_err(|e| format!("Watcher init failed: {e}"))?;

    let mut w = watcher;
    w.watch(&folder_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Watcher watch failed: {e}"))?;

    let mut guard = state.inner.lock().unwrap();
    *guard = Some(w);

    Ok(())
}

// Stop watching — called when folder is closed or app quits.
#[tauri::command]
pub fn unwatch_note_folder(state: tauri::State<WatcherState>) {
    let mut guard = state.inner.lock().unwrap();
    *guard = None;
}