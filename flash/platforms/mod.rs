// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: platforms  —  downloadable board platform manager
// ─────────────────────────────────────────────────────────────────────────────

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use tsuki_ux::{info, warn, LiveBlock};

// ─── Registry URL ─────────────────────────────────────────────────────────────

pub const DEFAULT_BOARDS_REGISTRY: &str =
    "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json";

const CACHE_TTL: Duration = Duration::from_secs(24 * 3600);

// ─── Installed boards stored in memory ────────────────────────────────────────

/// Leaked &'static Board instances loaded from ~/.tsuki/boards/ at startup.
static DYNAMIC_BOARDS: OnceLock<Mutex<Vec<&'static Board>>> = OnceLock::new();

fn dynamic_registry() -> &'static Mutex<Vec<&'static Board>> {
    DYNAMIC_BOARDS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Register a heap-allocated Board as 'static (leaks intentionally — boards
/// are loaded once per process and never dropped).
fn register(b: Board) {
    let leaked: &'static Board = Box::leak(Box::new(b));
    dynamic_registry().lock().unwrap().push(leaked);
}

/// Look up a board from installed platforms (fallback after static catalog).
pub fn find_dynamic(id: &str) -> Option<&'static Board> {
    dynamic_registry()
        .lock()
        .unwrap()
        .iter()
        .find(|b| b.id.eq_ignore_ascii_case(id))
        .copied()
}

// ─── Directory helpers ────────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Compare two semver-like strings (e.g. "1.9.0" vs "1.10.0").
/// Falls back to lexicographic if parsing fails.
fn semver_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> (u64, u64, u64) {
        let mut parts = s.trim_start_matches('v').split('.');
        let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };
    parse(a).cmp(&parse(b))
}

fn boards_root() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".tsuki").join("boards"))
}

fn platform_dir(board_id: &str, version: &str) -> Option<PathBuf> {
    boards_root().map(|r| r.join(board_id).join(version))
}

/// Path to the pre-compiled core.a for a board (returns any installed version).
pub fn precompiled_core(board_id: &str) -> Option<PathBuf> {
    let root = boards_root()?;
    let board_dir = root.join(board_id);
    // Walk version directories, pick latest (alphabetically last)
    let mut versions: Vec<_> = std::fs::read_dir(&board_dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    versions.sort();
    let version = versions.last()?;
    let precomp_dir = board_dir.join(version).join("precompiled");
    // Return the first .a file found
    std::fs::read_dir(&precomp_dir)
        .ok()?
        .flatten()
        .find(|e| e.path().extension().and_then(|x| x.to_str()) == Some("a"))
        .map(|e| e.path())
}

/// Companion .sig file storing the core_sig used during pre-compilation.
pub fn precompiled_core_sig(board_id: &str) -> Option<String> {
    let core = precompiled_core(board_id)?;
    std::fs::read_to_string(core.with_extension("sig")).ok()
}

// ─── Startup loader ───────────────────────────────────────────────────────────

/// Call once at startup (main.rs) to load all installed platforms into memory.
pub fn load_installed_platforms() {
    let Some(root) = boards_root() else { return };
    let Ok(entries) = std::fs::read_dir(&root) else { return };
    for entry in entries.flatten() {
        let board_dir = entry.path();
        if !board_dir.is_dir() {
            continue;
        }
        // Find latest version subdirectory
        let mut versions: Vec<_> = std::fs::read_dir(&board_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        versions.sort_by(|a, b| semver_cmp(a, b));
        if let Some(ver) = versions.last() {
            let toml_path = board_dir.join(ver).join("tsukiboard.toml");
            if toml_path.exists() {
                if let Some(board) = load_toml_as_board(&toml_path) {
                    register(board);
                }
            }
        }
    }
}

// ─── TOML → Board parsing ─────────────────────────────────────────────────────

fn leak_str(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

fn leak_strs(v: Vec<String>) -> &'static [&'static str] {
    let leaked: Vec<&'static str> = v.into_iter().map(leak_str).collect();
    Box::leak(leaked.into_boxed_slice())
}

/// Parse a tsukiboard.toml file and return a Board usable by the compile pipeline.
pub fn load_toml_as_board(path: &Path) -> Option<Board> {
    let raw = std::fs::read_to_string(path).ok()?;
    parse_board_toml(&raw)
}

pub fn parse_board_toml(raw: &str) -> Option<Board> {
    let mut id = String::new();
    let mut name = String::new();
    let mut fqbn = String::new();
    let mut variant = String::new();
    let mut flash_kb: u32 = 0;
    let mut ram_kb: u32 = 0;
    let mut f_cpu: u32 = 0;
    let mut toolchain_type = String::new();
    let mut toolchain_variant = String::new();
    let mut upload_baud: u32 = 921_600;
    let mut avr_mcu = String::new();
    let mut avr_programmer = String::new();
    let mut avr_baud: u32 = 0;
    let mut defines: Vec<String> = Vec::new();
    let mut in_define = false;
    let mut cur_define_name = String::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with("[[define]]") {
            if !cur_define_name.is_empty() {
                defines.push(cur_define_name.clone());
                cur_define_name.clear();
            }
            in_define = true;
            continue;
        }
        if line.starts_with("[[") || line.starts_with('[') {
            if !cur_define_name.is_empty() {
                defines.push(cur_define_name.clone());
                cur_define_name.clear();
            }
            in_define = false;
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        let val = line[eq + 1..].trim().trim_matches('"').to_string();

        if in_define {
            if key == "name" {
                cur_define_name = val;
            }
            continue;
        }
        // toolchain.variant overrides board.variant for esp32 sub-variants
        if key == "variant" && !toolchain_type.is_empty() {
            toolchain_variant = val.clone();
        }
        match key {
            "id"          => id = val,
            "name"        => name = val,
            "fqbn"        => fqbn = val,
            "variant"     => variant = val,
            "flash_kb"    => flash_kb = val.parse().unwrap_or(0),
            "ram_kb"      => ram_kb = val.parse().unwrap_or(0),
            "f_cpu"       => f_cpu = val.parse().unwrap_or(0),
            "type"        => toolchain_type = val,
            "upload_baud" => upload_baud = val.parse().unwrap_or(921_600),
            "upload_tool" => {} // stored implicitly via toolchain type
            "mcu"         => avr_mcu = val,
            "programmer"  => avr_programmer = val,
            "avr_baud"    => avr_baud = val.parse().unwrap_or(0),
            _ => {}
        }
    }
    if !cur_define_name.is_empty() {
        defines.push(cur_define_name);
    }

    if id.is_empty() || toolchain_type.is_empty() {
        return None;
    }

    let esp_variant = if !toolchain_variant.is_empty() {
        toolchain_variant.clone()
    } else {
        id.clone()
    };

    let toolchain = match toolchain_type.as_str() {
        "avr" => Toolchain::Avr {
            mcu:        leak_str(avr_mcu),
            f_cpu,
            programmer: leak_str(if avr_programmer.is_empty() {
                "arduino".into()
            } else {
                avr_programmer
            }),
            baud: if avr_baud > 0 { avr_baud } else { upload_baud },
        },
        "esp32"   => Toolchain::Esp32 { variant: leak_str(esp_variant) },
        "esp8266" => Toolchain::Esp8266,
        "rp2040"  => Toolchain::Rp2040,
        "sam"     => Toolchain::Sam {
            mcu:   leak_str(avr_mcu),
            f_cpu,
        },
        _ => return None,
    };

    Some(Board {
        id:       leak_str(id),
        name:     leak_str(name),
        fqbn:     leak_str(fqbn),
        variant:  leak_str(variant),
        flash_kb,
        ram_kb,
        toolchain,
        defines:  leak_strs(defines),
    })
}

// ─── Registry fetch ───────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct RegistryEntry {
    pub id:          String,
    pub description: String,
    pub author:      String,
    pub arch:        String,
    pub category:    String,
    pub latest:      String,
    pub toml_url:    String,
}

/// Fetch and parse boards.json from the given registry URL.
/// Results are cached for CACHE_TTL (24 h).
pub fn fetch_registry(registry_url: &str) -> Result<Vec<RegistryEntry>> {
    let cache_path = cache_path_for(registry_url);
    // Check cache freshness
    if let Ok(meta) = std::fs::metadata(&cache_path) {
        if let Ok(modified) = meta.modified() {
            if SystemTime::now()
                .duration_since(modified)
                .unwrap_or(CACHE_TTL)
                < CACHE_TTL
            {
                if let Ok(data) = std::fs::read_to_string(&cache_path) {
                    return parse_boards_json(&data);
                }
            }
        }
    }

    let data = http_get(registry_url)?;
    let _ = std::fs::create_dir_all(cache_path.parent().unwrap());
    let _ = std::fs::write(&cache_path, &data);
    parse_boards_json(&data)
}

fn cache_path_for(url: &str) -> PathBuf {
    let hash = {
        let mut h = 0u64;
        for b in url.bytes() {
            h = h.wrapping_mul(31).wrapping_add(b as u64);
        }
        format!("{:016x}", h)
    };
    home_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join(".tsuki")
        .join("cache")
        .join(format!("boards_{}.json", hash))
}

fn parse_boards_json(data: &str) -> Result<Vec<RegistryEntry>> {
    let mut entries = Vec::new();
    let boards_start = data
        .find("\"boards\"")
        .ok_or_else(|| FlashError::Other("invalid boards.json".into()))?;
    let brace_open = data[boards_start..]
        .find('{')
        .map(|i| boards_start + i)
        .ok_or_else(|| FlashError::Other("invalid boards.json".into()))?;

    let inner = &data[brace_open + 1..];
    let mut pos = 0;
    while pos < inner.len() {
        let Some(qs) = inner[pos..].find('"') else { break };
        let qs = pos + qs;
        let qe = inner[qs + 1..]
            .find('"')
            .map(|i| qs + 1 + i)
            .unwrap_or(inner.len());
        let key = &inner[qs + 1..qe];
        if key == "boards" {
            pos = qe + 1;
            continue;
        }
        let colon = inner[qe + 1..]
            .find(':')
            .map(|i| qe + 1 + i)
            .unwrap_or(inner.len());
        let obj_start = inner[colon + 1..]
            .find('{')
            .map(|i| colon + 1 + i)
            .unwrap_or(inner.len());
        let mut depth = 0usize;
        let mut obj_end = obj_start + 1;
        for (i, c) in inner[obj_start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        obj_end = obj_start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let obj_str = &inner[obj_start..=obj_end];

        let description = extract_json_str(obj_str, "description").unwrap_or_default();
        let author      = extract_json_str(obj_str, "author").unwrap_or_default();
        let arch        = extract_json_str(obj_str, "arch").unwrap_or_default();
        let category    = extract_json_str(obj_str, "category").unwrap_or_default();
        let latest      = extract_json_str(obj_str, "latest").unwrap_or_default();

        let toml_url = if !latest.is_empty() {
            let ver_key = format!("\"{}\"", latest);
            if let Some(vi) = obj_str.find(&ver_key) {
                let after = &obj_str[vi + ver_key.len()..];
                if let Some(col) = after.find(':') {
                    let trimmed = after[col + 1..].trim();
                    if trimmed.starts_with('"') {
                        let inner_str = &trimmed[1..];
                        inner_str[..inner_str.find('"').unwrap_or(inner_str.len())].to_string()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if !key.is_empty() && !toml_url.is_empty() {
            entries.push(RegistryEntry {
                id: key.to_string(),
                description,
                author,
                arch,
                category,
                latest,
                toml_url,
            });
        }
        pos = obj_end + 1;
    }
    Ok(entries)
}

fn extract_json_str(s: &str, key: &str) -> Option<String> {
    let ki = if key.is_empty() {
        0
    } else {
        let pattern = format!("\"{}\"", key);
        s.find(&pattern)? + pattern.len()
    };
    let after = if key.is_empty() { s } else { &s[ki..] };
    let col = if key.is_empty() { 0 } else { after.find(':')? + 1 };
    let trimmed = after[col..].trim_start();
    if !trimmed.starts_with('"') {
        return None;
    }
    let inner = &trimmed[1..];
    let end = inner.find('"')?;
    Some(inner[..end].to_string())
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

fn http_get(url: &str) -> Result<String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| FlashError::Other(format!("HTTP GET {}: {}", url, e)))?;
    resp.into_string()
        .map_err(|e| FlashError::Other(format!("reading response: {}", e)))
}

fn http_get_bytes(url: &str) -> Result<Vec<u8>> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| FlashError::Other(format!("HTTP GET {}: {}", url, e)))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| FlashError::Other(format!("reading bytes: {}", e)))?;
    Ok(buf)
}

// ─── Install ──────────────────────────────────────────────────────────────────

pub struct InstallOptions {
    pub registry_url: String,
    pub verbose:      bool,
    pub use_modules:  bool,
}

/// Download and install a board platform.
/// Returns the tsukiboard.toml content as a String.
pub fn install(board_id: &str, version_hint: Option<&str>, opts: &InstallOptions) -> Result<String> {
    let label = format!("platform install  {}", board_id);
    let mut block = LiveBlock::new(&label);
    block.start();

    block.line("fetching board registry...");
    let entries = fetch_registry(&opts.registry_url)?;
    let entry = entries
        .iter()
        .find(|e| e.id.eq_ignore_ascii_case(board_id))
        .ok_or_else(|| {
            FlashError::Other(format!("board '{}' not found in registry", board_id))
        })?;

    let version = version_hint.unwrap_or(&entry.latest);
    block.line(&format!("found {} v{}", entry.id, version));

    block.line("downloading tsukiboard.toml...");
    let toml_url = &entry.toml_url;
    let toml_data = http_get(toml_url)?;

    let base_url = toml_url
        .rsplitn(2, '/')
        .nth(1)
        .map(|s| format!("{}/", s))
        .unwrap_or_default();

    let dest = platform_dir(&entry.id, version)
        .ok_or_else(|| FlashError::Other("could not determine home directory".into()))?;
    std::fs::create_dir_all(&dest)
        .map_err(|e| FlashError::Other(format!("creating {}: {}", dest.display(), e)))?;

    std::fs::write(dest.join("tsukiboard.toml"), &toml_data)
        .map_err(|e| FlashError::Other(format!("writing toml: {}", e)))?;

    let companion_files = parse_companion_files(&toml_data);
    for (_, filename) in &companion_files {
        block.line(&format!("downloading {}...", filename));
        let url = format!("{}{}", base_url, filename);
        match http_get_bytes(&url) {
            Ok(data) => {
                if let Err(e) = std::fs::write(dest.join(filename), &data) {
                    block.line(&format!("  warn: failed to write {}: {}", filename, e));
                }
            }
            Err(e) => block.line(&format!("  warn: {}: {}", filename, e)),
        }
    }

    block.finish(true, None);
    Ok(toml_data)
}

fn parse_companion_files(toml: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();
    let mut in_files = false;
    for line in toml.lines() {
        let line = line.trim();
        if line == "[files]" {
            in_files = true;
            continue;
        }
        if line.starts_with('[') {
            in_files = false;
            continue;
        }
        if !in_files {
            continue;
        }
        if let Some(eq) = line.find('=') {
            let k = line[..eq].trim().to_string();
            let v = line[eq + 1..].trim().trim_matches('"').to_string();
            if !k.is_empty() && !v.is_empty() {
                files.push((k, v));
            }
        }
    }
    files
}

// ─── Pre-compile ──────────────────────────────────────────────────────────────

/// Pre-compile the board's core library and store it at
/// ~/.tsuki/boards/<id>/<version>/precompiled/core-<arch>.a
pub fn precompile(board_id: &str, use_modules: bool, verbose: bool) -> Result<()> {
    let label = format!("precompile core  [{}]", board_id);
    let mut block = LiveBlock::new(&label);
    block.start();

    let board = crate::boards::Board::find(board_id)
        .ok_or_else(|| FlashError::UnknownBoard(board_id.to_owned()))?;

    let sdk = match crate::sdk::resolve(board.arch(), board.variant, use_modules) {
        Ok(s) => s,
        Err(e) => {
            block.finish(false, Some("SDK not found"));
            return Err(e);
        }
    };
    let _ = sdk;

    let tmp = match temp_sketch_dir(board_id) {
        Ok(t) => t,
        Err(e) => {
            block.finish(false, Some("temp dir failed"));
            return Err(e);
        }
    };

    // Find the actual installed version directory
    let Some(dest) = (|| -> Option<PathBuf> {
        let root = boards_root()?;
        let board_dir = root.join(board_id);
        let mut versions: Vec<_> = std::fs::read_dir(&board_dir)
            .ok()?.flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        versions.sort_by(|a, b| semver_cmp(a, b));
        let ver = versions.last()?;
        Some(root.join(board_id).join(ver))
    })() else {
        block.finish(false, Some("no install dir"));
        return Err(FlashError::Other("could not locate install dir".into()));
    };
    let build_dir = dest.join("precompiled");
    std::fs::create_dir_all(&build_dir)
        .map_err(|e| FlashError::Other(format!("mkdir: {}", e)))?;

    block.line(&format!("compiling core for {}...", board.id));

    let req = crate::compile::CompileRequest {
        sketch_dir:       tmp.clone(),
        build_dir:        build_dir.clone(),
        project_name:     "precompile".into(),
        cpp_std:          "c++11".into(),
        lib_include_dirs: vec![],
        lib_source_dirs:  vec![],
        language:         crate::compile::Language::Cpp,
        use_modules,
        verbose,
        debug: false,
    };

    match crate::compile::compile(&req, board) {
        Ok(_) => {
            let arch = board.arch();
            for entry in std::fs::read_dir(&build_dir).into_iter().flatten().flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("a")
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("core-"))
                        .unwrap_or(false)
                {
                    let final_core = build_dir.join(format!("core-{}.a", arch));
                    let _ = std::fs::copy(&p, &final_core);
                    // The build backend writes .core_sig in the build directory (or a
                    // core-<arch>/ sub-dir depending on the backend version). Search both.
                    let sig_candidates = [
                        build_dir.join(".core_sig"),
                        build_dir.join(format!("core-{}", arch)).join(".core_sig"),
                    ];
                    for sig_src in &sig_candidates {
                        if sig_src.exists() {
                            let _ = std::fs::copy(
                                sig_src,
                                build_dir.join(format!("core-{}.sig", arch)),
                            );
                            break;
                        }
                    }
                    break;
                }
            }
            let _ = std::fs::remove_dir_all(&tmp);
            block.finish(true, None);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            block.finish(false, Some("core compilation failed"));
            Err(e)
        }
    }
}

fn temp_sketch_dir(board_id: &str) -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("tsuki-precompile-{}", board_id));
    std::fs::create_dir_all(&dir)
        .map_err(|e| FlashError::Other(format!("temp dir: {}", e)))?;
    std::fs::write(dir.join("sketch.cpp"), b"void setup(){} void loop(){}")
        .map_err(|e| FlashError::Other(format!("write sketch: {}", e)))?;
    Ok(dir)
}

// ─── List ─────────────────────────────────────────────────────────────────────

pub struct InstalledPlatform {
    pub id:      String,
    pub version: String,
    pub name:    String,
    pub arch:    String,
}

pub fn list_installed() -> Vec<InstalledPlatform> {
    let Some(root) = boards_root() else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&root) else { return vec![] };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let board_dir = entry.path();
        if !board_dir.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let mut versions: Vec<_> = std::fs::read_dir(&board_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        versions.sort_by(|a, b| semver_cmp(a, b));
        if let Some(ver) = versions.last() {
            let toml_path = board_dir.join(ver).join("tsukiboard.toml");
            let (name, arch) = if let Ok(raw) = std::fs::read_to_string(&toml_path) {
                let name = raw
                    .lines()
                    .find(|l| l.trim().starts_with("name") && l.contains('='))
                    .and_then(|l| {
                        l.find('=')
                            .map(|i| l[i + 1..].trim().trim_matches('"').to_string())
                    })
                    .unwrap_or_else(|| id.clone());
                let arch = {
                    let mut found = false;
                    let mut arch_val = "unknown".to_string();
                    for line in raw.lines() {
                        if line.trim() == "[toolchain]" {
                            found = true;
                            continue;
                        }
                        if found && line.trim().starts_with("type") && line.contains('=') {
                            if let Some(i) = line.find('=') {
                                arch_val =
                                    line[i + 1..].trim().trim_matches('"').to_string();
                            }
                            break;
                        }
                        if found && line.trim().starts_with('[') {
                            break;
                        }
                    }
                    arch_val
                };
                (name, arch)
            } else {
                (id.clone(), "unknown".to_string())
            };
            result.push(InstalledPlatform {
                id: id.clone(),
                version: ver.clone(),
                name,
                arch,
            });
        }
    }
    result
}

// ─── Remove ───────────────────────────────────────────────────────────────────

pub fn remove(board_id: &str) -> Result<()> {
    let root = boards_root()
        .ok_or_else(|| FlashError::Other("could not determine home directory".into()))?;
    let board_dir = root.join(board_id);
    if !board_dir.exists() {
        return Err(FlashError::Other(format!(
            "platform '{}' is not installed",
            board_id
        )));
    }
    std::fs::remove_dir_all(&board_dir)
        .map_err(|e| FlashError::Other(format!("remove {}: {}", board_dir.display(), e)))?;
    dynamic_registry()
        .lock()
        .unwrap()
        .retain(|b| !b.id.eq_ignore_ascii_case(board_id));
    Ok(())
}
