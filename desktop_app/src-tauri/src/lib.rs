use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

#[derive(Serialize, Deserialize, Debug)]
pub struct BlenderResponse {
    pub status: String,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BlenderRequest<'a> {
    pub command: &'a str,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Send a command to Blender's TCP socket server and return the response.
#[tauri::command]
fn blender_send_command(
    host: Option<String>,
    port: Option<u16>,
    command: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let host_str = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let port_num = port.unwrap_or(9876);
    let addr_str = format!("{}:{}", host_str, port_num);

    let socket_addr: SocketAddr = addr_str
        .parse()
        .map_err(|e| format!("Invalid socket address {}: {}", addr_str, e))?;

    let mut stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
        .map_err(|e| format!("Cannot connect to Blender at {}: {}. Ensure Blender is running with blend-ai server started.", addr_str, e))?;

    stream
        .set_read_timeout(Some(Duration::from_secs(45)))
        .map_err(|e| format!("Failed to set read timeout: {}", e))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("Failed to set write timeout: {}", e))?;

    let req = BlenderRequest {
        command: &command,
        params: params.unwrap_or(serde_json::json!({})),
    };

    let payload = serde_json::to_vec(&req)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    let length = payload.len() as u32;
    let len_bytes = length.to_be_bytes();

    stream
        .write_all(&len_bytes)
        .map_err(|e| format!("Failed to write length header: {}", e))?;
    stream
        .write_all(&payload)
        .map_err(|e| format!("Failed to write payload: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("Failed to flush stream: {}", e))?;

    // Read 4-byte response length
    let mut resp_len_bytes = [0u8; 4];
    stream
        .read_exact(&mut resp_len_bytes)
        .map_err(|e| format!("Failed to read response length header: {}", e))?;
    let resp_length = u32::from_be_bytes(resp_len_bytes) as usize;

    if resp_length > 100 * 1024 * 1024 {
        return Err(format!("Response too large: {} bytes", resp_length));
    }

    let mut resp_buf = vec![0u8; resp_length];
    stream
        .read_exact(&mut resp_buf)
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let resp_value: serde_json::Value = serde_json::from_slice(&resp_buf)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    Ok(resp_value)
}

/// Check if Blender's TCP server is alive and reachable.
#[tauri::command]
fn blender_check_connection(host: Option<String>, port: Option<u16>) -> bool {
    let host_str = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let port_num = port.unwrap_or(9876);
    let addr_str = format!("{}:{}", host_str, port_num);

    if let Ok(socket_addr) = addr_str.parse::<SocketAddr>() {
        TcpStream::connect_timeout(&socket_addr, Duration::from_millis(800)).is_ok()
    } else {
        false
    }
}

/// Helper to find Blender executable across common installation paths
fn find_blender_binary() -> Option<String> {
    if let Ok(path) = std::env::var("BLENDER_PATH") {
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    if let Ok(path) = std::env::var("BLENDER_EXE") {
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        ];
        for c in candidates {
            if std::path::Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_path = "/Applications/Blender.app/Contents/MacOS/Blender";
        if std::path::Path::new(mac_path).exists() {
            return Some(mac_path.to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let linux_path = "/usr/bin/blender";
        if std::path::Path::new(linux_path).exists() {
            return Some(linux_path.to_string());
        }
    }

    None
}

/// Launch Blender with auto-start script if not already running.
#[tauri::command]
fn blender_launch(blender_path: Option<String>, script_path: Option<String>) -> Result<String, String> {
    let path = blender_path
        .filter(|p| !p.trim().is_empty())
        .or_else(find_blender_binary)
        .unwrap_or_else(|| {
            #[cfg(target_os = "windows")]
            { r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe".to_string() }
            #[cfg(target_os = "macos")]
            { "/Applications/Blender.app/Contents/MacOS/Blender".to_string() }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            { "blender".to_string() }
        });

    let mut cmd = Command::new(&path);
    if let Some(s) = script_path {
        cmd.arg("--python").arg(s);
    } else {
        cmd.arg("--python-expr").arg("import bpy; bpy.ops.blendai.start_server()");
    }

    match cmd.spawn() {
        Ok(_) => Ok("Blender launched successfully".to_string()),
        Err(e) => Err(format!("Failed to launch Blender at {}: {}", path, e)),
    }
}

/// Recursively scan any directory on disk for 3D model assets and optional metadata.json
#[tauri::command]
fn scan_asset_directory(path: String) -> Result<serde_json::Value, String> {
    let clean_path = path.trim().trim_matches('"').trim_matches('\'').to_string();
    let root = std::path::Path::new(&clean_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Directory not found: {}", clean_path));
    }

    let mut assets = Vec::new();
    let mut categories = std::collections::BTreeSet::new();
    let valid_exts = ["glb", "gltf", "fbx", "obj", "blend", "stl", "usd", "usdz", "dae"];

    fn visit_dir(
        dir: &std::path::Path,
        root: &std::path::Path,
        valid_exts: &[&str],
        assets: &mut Vec<serde_json::Value>,
        categories: &mut std::collections::BTreeSet<String>,
    ) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    visit_dir(&p, root, valid_exts, assets, categories);
                } else if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if valid_exts.contains(&ext_lower.as_str()) {
                            let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("model");
                            let rel = p.strip_prefix(root).unwrap_or(&p);
                            let parent_name = p.parent()
                                .and_then(|pa| pa.file_name())
                                .and_then(|n| n.to_str())
                                .unwrap_or("general");

                            let category = if let Some(first_comp) = rel.components().next() {
                                let c = first_comp.as_os_str().to_string_lossy().to_string();
                                if c == p.file_name().unwrap_or_default().to_string_lossy() {
                                    "general".to_string()
                                } else {
                                    c
                                }
                            } else {
                                parent_name.to_string()
                            };

                            categories.insert(category.clone());

                            // Check for metadata.json in same dir
                            let meta_path = p.parent().map(|pa| pa.join("metadata.json"));
                            let mut dims = None;
                            let mut asset_name = file_stem.replace('_', " ");
                            let mut asset_id = rel.to_string_lossy().replace('\\', "/");

                            if let Some(mp) = meta_path {
                                if mp.exists() {
                                    if let Ok(content) = std::fs::read_to_string(mp) {
                                        if let Ok(meta_json) = serde_json::from_str::<serde_json::Value>(&content) {
                                            if let Some(n) = meta_json.get("name").and_then(|v| v.as_str()) {
                                                asset_name = n.to_string();
                                            }
                                            if let Some(id) = meta_json.get("id").and_then(|v| v.as_str()) {
                                                asset_id = id.to_string();
                                            }
                                            if let Some(geom) = meta_json.get("geometry") {
                                                if let (Some(w), Some(d), Some(h)) = (
                                                    geom.get("width_mm").and_then(|v| v.as_f64()),
                                                    geom.get("depth_mm").and_then(|v| v.as_f64()),
                                                    geom.get("height_mm").and_then(|v| v.as_f64()),
                                                ) {
                                                    dims = Some(serde_json::json!({
                                                        "width": (w / 1000.0 * 1000.0).round() / 1000.0,
                                                        "depth": (d / 1000.0 * 1000.0).round() / 1000.0,
                                                        "height": (h / 1000.0 * 1000.0).round() / 1000.0,
                                                    }));
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            assets.push(serde_json::json!({
                                "id": asset_id,
                                "name": asset_name,
                                "category": category,
                                "subcategory": parent_name,
                                "dimensions_m": dims,
                                "model_path": p.to_string_lossy().to_string(),
                                "format": ext_lower.to_uppercase(),
                            }));
                        }
                    }
                }
            }
        }
    }

    visit_dir(root, root, &valid_exts, &mut assets, &mut categories);

    Ok(serde_json::json!({
        "valid": true,
        "path": clean_path,
        "total": assets.len(),
        "categories": categories.into_iter().collect::<Vec<_>>(),
        "assets": assets
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            blender_send_command,
            blender_check_connection,
            blender_launch,
            scan_asset_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
