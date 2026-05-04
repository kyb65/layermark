// src-tauri/src/commands.rs
// Phase 1: File I/O + anchor ID generation
// Replace the contents of src-tauri/src/lib.rs with this,
// or add #[path = "commands.rs"] mod commands; to lib.rs

use rand::Rng;
use std::collections::HashSet;
use std::path::PathBuf;

// ── Anchor ID generation ─────────────────────────────────────────────────────
// Spec: ^[a-z0-9]{8}$, CSPRNG, globally unique within file

const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

fn gen_id_once() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

#[tauri::command]
pub fn generate_anchor_id(existing_ids: Vec<String>) -> String {
    let used: HashSet<String> = existing_ids.into_iter().collect();
    loop {
        let id = gen_id_once();
        if !used.contains(&id) {
            return id;
        }
    }
}

// ── File I/O ─────────────────────────────────────────────────────────────────
// .lm and .lmm files are read/written as UTF-8 strings.
// Tauri's fs plugin handles sandboxing; these commands add
// the note-pair abstraction (always open content + memo together).

#[tauri::command]
pub fn read_note_pair(folder: String) -> Result<NotePair, String> {
    let base = PathBuf::from(&folder);
    let content_path = base.join("content.lm");
    let memo_path = base.join("memo.lmm");

    let content = std::fs::read_to_string(&content_path)
        .map_err(|e| format!("Failed to read content.lm: {e}"))?;

    // memo.lmm may not exist yet (new note)
    let memo = if memo_path.exists() {
        Some(
            std::fs::read_to_string(&memo_path)
                .map_err(|e| format!("Failed to read memo.lmm: {e}"))?,
        )
    } else {
        None
    };

    Ok(NotePair {
        folder,
        content,
        memo,
    })
}

#[tauri::command]
pub fn write_note_pair(folder: String, content: String, memo: String) -> Result<(), String> {
    let base = PathBuf::from(&folder);
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Cannot create note folder: {e}"))?;

    std::fs::write(base.join("content.lm"), &content)
        .map_err(|e| format!("Failed to write content.lm: {e}"))?;

    std::fs::write(base.join("memo.lmm"), &memo)
        .map_err(|e| format!("Failed to write memo.lmm: {e}"))?;

    Ok(())
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────
// pulldown-cmark converts .lm content to HTML for the renderer.
// The frontend receives HTML and overlays SVG on top.

#[tauri::command]
pub fn render_markdown(markdown: String) -> String {
    use pulldown_cmark::{html, Options, Parser};

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);

    let parser = Parser::new_ext(&markdown, opts);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

// ── Unicode code point offset ─────────────────────────────────────────────────
// spec: position = Unicode code point offset, NOT byte offset, NOT UTF-16 units
// Rust chars() iterates code points — matches the spec exactly.

#[tauri::command]
pub fn plain_text_from_markdown(markdown: String) -> PlainTextResult {
    use pulldown_cmark::{Event, Options, Parser};

    let parser = Parser::new_ext(&markdown, Options::empty());
    let mut plain = String::new();
    for event in parser {
        if let Event::Text(t) | Event::Code(t) = event {
            plain.push_str(&t);
        } else if let Event::SoftBreak | Event::HardBreak = event {
            plain.push('\n');
        }
    }
    let code_point_count = plain.chars().count();
    PlainTextResult {
        plain,
        code_point_count,
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct NotePair {
    pub folder: String,
    pub content: String,
    pub memo: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PlainTextResult {
    pub plain: String,
    pub code_point_count: usize,
}
