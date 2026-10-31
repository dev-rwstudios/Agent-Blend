//! On-disk store for projects and chats.
//!
//! Everything lives under `<app data dir>/workspace/`. The frontend addresses
//! files with relative paths like `projects/<id>/project.json`; every path is
//! validated segment by segment so it can never escape that root (no `..`,
//! no absolute paths, no hidden entries such as `.trash`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const TRASH_DIR: &str = ".trash";

fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot locate app data directory: {}", e))?;
    let root = base.join("workspace");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create {}: {}", root.display(), e))?;
    Ok(root)
}

fn valid_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg.len() <= 128
        && !seg.starts_with('.')
        && seg.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Join a frontend-supplied relative path onto `root`, rejecting anything that
/// could point outside it.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim();
    if rel.is_empty() {
        return Err("Empty storage path".to_string());
    }
    let mut path = root.to_path_buf();
    for seg in rel.split('/') {
        if !valid_segment(seg) {
            return Err(format!("Invalid storage path: '{}'", rel));
        }
        path.push(seg);
    }
    Ok(path)
}

/// Write via a temporary file + rename so a crash never leaves a half-written file.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {}", parent.display(), e))?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, contents).map_err(|e| format!("Cannot write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot replace {}: {}", path.display(), e)
    })
}

/// Move `path` into `<root>/.trash/` instead of deleting it outright.
pub fn move_to_trash(root: &Path, rel: &str) -> Result<(), String> {
    let src = resolve(root, rel)?;
    if !src.exists() {
        return Ok(());
    }
    let trash = root.join(TRASH_DIR);
    fs::create_dir_all(&trash).map_err(|e| format!("Cannot create trash: {}", e))?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dest = trash.join(format!("{}_{}", stamp, rel.replace('/', "__")));
    fs::rename(&src, &dest).map_err(|e| format!("Cannot move {} to trash: {}", src.display(), e))
}

// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_root(app: AppHandle) -> Result<String, String> {
    Ok(root_dir(&app)?.to_string_lossy().to_string())
}

/// Absolute path for a stored file (it need not exist yet) — used to tell
/// Blender where a project's scene.blend lives.
// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_abs_path(app: AppHandle, path: String) -> Result<String, String> {
    Ok(resolve(&root_dir(&app)?, &path)?.to_string_lossy().to_string())
}

// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let p = resolve(&root_dir(&app)?, &path)?;
    if !p.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| format!("Cannot read {}: {}", p.display(), e))
}

// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_write(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    write_atomic(&resolve(&root_dir(&app)?, &path)?, &contents)
}

// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_exists(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(resolve(&root_dir(&app)?, &path)?.exists())
}

/// Names of the entries directly inside a stored directory (empty if it doesn't exist).
// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_list(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = resolve(&root_dir(&app)?, &path)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("Cannot list {}: {}", dir.display(), e))?
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| valid_segment(n) && !n.contains(".tmp-"))
        .collect();
    names.sort();
    Ok(names)
}

// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn storage_trash(app: AppHandle, path: String) -> Result<(), String> {
    move_to_trash(&root_dir(&app)?, &path)
}

/// Best guess at the bundled asset library, used to pre-fill a new project's
/// asset sources: $AGENT_BLEND_ASSETS_PATH, then the repo's asset_library/
/// (present when running from a checkout).
// File work stays off the main thread so the window never stalls on disk I/O.
#[tauri::command(async)]
pub fn default_asset_library() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("AGENT_BLEND_ASSETS_PATH") {
        if !p.trim().is_empty() {
            candidates.push(PathBuf::from(p));
        }
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("asset_library"));
    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .and_then(|p| p.canonicalize().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent_blend_storage_test_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let root = Path::new("/r");
        assert_eq!(resolve(root, "projects/abc-1/project.json").unwrap(), root.join("projects/abc-1/project.json"));
    }

    #[test]
    fn resolve_rejects_escapes_and_hidden() {
        let root = Path::new("/r");
        for bad in ["", "../x", "projects/../../etc", "/etc/passwd", "a//b", ".trash/x", "a/./b", "a\\b", "a/b c"] {
            assert!(resolve(root, bad).is_err(), "should reject {:?}", bad);
        }
    }

    #[test]
    fn write_is_atomic_and_readable() {
        let root = temp_root("write");
        let p = resolve(&root, "chats/c1/meta.json").unwrap();
        write_atomic(&p, "{\"a\":1}").unwrap();
        write_atomic(&p, "{\"a\":2}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":2}");
        let leftovers: Vec<_> = fs::read_dir(p.parent().unwrap()).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "no temp files left behind");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_moves_instead_of_deleting() {
        let root = temp_root("trash");
        write_atomic(&resolve(&root, "projects/p1/project.json").unwrap(), "{}").unwrap();
        move_to_trash(&root, "projects/p1").unwrap();
        assert!(!root.join("projects/p1").exists());
        let trashed: Vec<_> = fs::read_dir(root.join(TRASH_DIR)).unwrap().flatten().collect();
        assert_eq!(trashed.len(), 1);
        assert!(trashed[0].file_name().to_string_lossy().ends_with("projects__p1"));
        fs::remove_dir_all(root).unwrap();
    }
}
