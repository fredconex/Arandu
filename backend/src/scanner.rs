use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use glob::glob;
use regex::Regex;
use crate::models::*;

// GGUF value types
const GGUF_TYPE_UINT8: u32   = 0;
const GGUF_TYPE_INT8: u32    = 1;
const GGUF_TYPE_UINT16: u32  = 2;
const GGUF_TYPE_INT16: u32   = 3;
const GGUF_TYPE_UINT32: u32  = 4;
const GGUF_TYPE_INT32: u32   = 5;
const GGUF_TYPE_FLOAT32: u32 = 6;
const GGUF_TYPE_BOOL: u32    = 7;
const GGUF_TYPE_STRING: u32  = 8;
const GGUF_TYPE_ARRAY: u32   = 9;
const GGUF_TYPE_UINT64: u32  = 10;
const GGUF_TYPE_INT64: u32   = 11;
const GGUF_TYPE_FLOAT64: u32 = 12;

const MAX_KV_ENTRIES: u64 = 1024;
const MAX_STRING_LEN: u64 = 1024 * 1024; // 1MB guard

pub fn scan_models(directory: &str) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error>> {
    if directory.is_empty() || !Path::new(directory).is_dir() {
        return Ok(Vec::new());
    }

    let pattern = format!("{}/**/*.gguf", directory);
    let files: Result<Vec<_>, _> = glob(&pattern)?.collect();
    let files = files?;

    let split_re = Regex::new(r"(.+?)-\d{5}-of-\d{5}\.gguf$")?;
    let mut model_groups: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for path in files {
        let path_str = path.to_string_lossy().to_string();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let key = if let Some(captures) = split_re.captures(&file_name) {
            captures.get(1).unwrap().as_str().to_string()
        } else {
            path_str.clone()
        };

        model_groups
            .entry(key)
            .or_default()
            .push(path_str);
    }

    let mut models: Vec<ModelInfo> = model_groups
        .iter()
        .filter_map(|(base_name, file_list)| {
            match process_model_group(base_name, file_list) {
                Ok(info) => Some(info),
                Err(e) => {
                    eprintln!("Warning: skipping model group '{}': {}", base_name, e);
                    None
                }
            }
        })
        .collect();

    models.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(models)
}

fn process_model_group(
    base_name: &str,
    file_list: &[String],
) -> Result<ModelInfo, Box<dyn std::error::Error>> {
    let first_file = file_list.first().ok_or("Empty file list")?;
    let first_path = Path::new(first_file);

    let total_size: u64 = file_list
        .iter()
        .filter_map(|p| fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();

    let modified_time = fs::metadata(first_path)?
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64;

    let gguf_metadata = extract_gguf_metadata(first_path)?;

    let display_name = if file_list.len() > 1 {
        base_name.to_string()
    } else {
        first_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(base_name)
            .to_string()
    };

    let quantization = get_quantization_from_filename(&display_name);

    Ok(ModelInfo {
        path: first_file.clone(),
        name: display_name,
        size_gb: total_size as f64 / (1024.0_f64.powi(3)),
        architecture: gguf_metadata.architecture,
        model_name: gguf_metadata.name,
        quantization,
        date: modified_time,
    })
}

pub fn extract_gguf_metadata(
    file_path: &Path,
) -> Result<GgufMetadata, Box<dyn std::error::Error>> {
    let mut file = fs::File::open(file_path)?;
    let fallback_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;

    if &magic != b"GGUF" {
        return Ok(GgufMetadata {
            architecture: "Unknown".to_string(),
            name: fallback_name,
        });
    }

    // Version
    let mut buf4 = [0u8; 4];
    file.read_exact(&mut buf4)?;
    let _version = u32::from_le_bytes(buf4);

    // Tensor count (skip)
    let mut buf8 = [0u8; 8];
    file.read_exact(&mut buf8)?;

    // KV count
    file.read_exact(&mut buf8)?;
    let kv_count = u64::from_le_bytes(buf8).min(MAX_KV_ENTRIES);

    let mut architecture = "Unknown".to_string();
    let mut name = fallback_name;
    let mut found_architecture = false;
    let mut found_name = false;

    for _ in 0..kv_count {
        if found_architecture && found_name {
            break;
        }

        let key = match read_gguf_string(&mut file) {
            Ok(k) => k,
            Err(_) => break,
        };

        let mut buf4 = [0u8; 4];
        if file.read_exact(&mut buf4).is_err() {
            break;
        }
        let value_type = u32::from_le_bytes(buf4);

        if value_type == GGUF_TYPE_STRING {
            let value = match read_gguf_string(&mut file) {
                Ok(v) => v,
                Err(_) => break,
            };
            match key.as_str() {
                "general.architecture" => {
                    architecture = value;
                    found_architecture = true;
                }
                "general.name" => {
                    name = value;
                    found_name = true;
                }
                _ => {}
            }
        } else if skip_gguf_value(&mut file, value_type).is_err() {
            break;
        }
    }

    Ok(GgufMetadata { architecture, name })
}

/// Read a GGUF length-prefixed string (8-byte len + UTF-8 bytes).
fn read_gguf_string(file: &mut fs::File) -> Result<String, Box<dyn std::error::Error>> {
    let mut buf8 = [0u8; 8];
    file.read_exact(&mut buf8)?;
    let len = u64::from_le_bytes(buf8);

    if len > MAX_STRING_LEN {
        return Err(format!("String length {} exceeds safety limit", len).into());
    }

    let mut bytes = vec![0u8; len as usize];
    file.read_exact(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Skip a GGUF value of the given type, advancing the file cursor correctly.
fn skip_gguf_value(
    file: &mut fs::File,
    value_type: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    match value_type {
        GGUF_TYPE_UINT8 | GGUF_TYPE_INT8 | GGUF_TYPE_BOOL => {
            file.seek(SeekFrom::Current(1))?;
        }
        GGUF_TYPE_UINT16 | GGUF_TYPE_INT16 => {
            file.seek(SeekFrom::Current(2))?;
        }
        GGUF_TYPE_UINT32 | GGUF_TYPE_INT32 | GGUF_TYPE_FLOAT32 => {
            file.seek(SeekFrom::Current(4))?;
        }
        GGUF_TYPE_UINT64 | GGUF_TYPE_INT64 | GGUF_TYPE_FLOAT64 => {
            file.seek(SeekFrom::Current(8))?;
        }
        GGUF_TYPE_STRING => {
            // Read and discard the string
            read_gguf_string(file)?;
        }
        GGUF_TYPE_ARRAY => {
            // Array: element_type (u32) + count (u64) + count × element
            let mut buf4 = [0u8; 4];
            file.read_exact(&mut buf4)?;
            let elem_type = u32::from_le_bytes(buf4);

            let mut buf8 = [0u8; 8];
            file.read_exact(&mut buf8)?;
            let count = u64::from_le_bytes(buf8);

            // Guard against absurdly large arrays
            if count > MAX_KV_ENTRIES * 1024 {
                return Err(format!("Array count {} exceeds safety limit", count).into());
            }

            for _ in 0..count {
                skip_gguf_value(file, elem_type)?;
            }
        }
        other => {
            return Err(format!("Unknown GGUF value type: {}", other).into());
        }
    }
    Ok(())
}

pub fn get_quantization_from_filename(filename: &str) -> String {
    // Strip .gguf suffix if present, then take the last dash-separated token
    let base = filename
        .strip_suffix(".gguf")
        .unwrap_or(filename);

    // Try last '-' separator first, then last '.'
    let separator = base.rfind('-').or_else(|| base.rfind('.'));

    if let Some(pos) = separator {
        let token = &base[pos + 1..];
        if !token.is_empty() {
            return token.to_uppercase();
        }
    }

    // Fallback: return the whole base name uppercased if no separator found
    base.to_uppercase()
}

pub fn scan_mmproj_files(
    directory: &str,
) -> Result<Vec<serde_json::Value>, Box<dyn std::error::Error>> {
    if directory.is_empty() || !Path::new(directory).is_dir() {
        return Ok(Vec::new());
    }

    let base_path = Path::new(directory);
    let pattern = format!("{}/**/*.gguf", directory);

    let mut files: Vec<serde_json::Value> = glob(&pattern)?
        .filter_map(|entry| entry.ok())
        // Pre-filter by filename to avoid opening every GGUF
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_lowercase().contains("mmproj"))
                .unwrap_or(false)
        })
        .filter_map(|path| {
            let metadata = extract_gguf_metadata(&path).ok()?;
            if metadata.architecture.to_lowercase() != "clip" {
                return None;
            }
            let file_path = path
                .strip_prefix(base_path)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| path.to_string_lossy().into_owned());

            Some(serde_json::json!({
                "path": file_path,
                "name": metadata.name,
            }))
        })
        .collect();

    files.sort_by(|a, b| {
        let pa = a["path"].as_str().unwrap_or("");
        let pb = b["path"].as_str().unwrap_or("");
        pa.cmp(pb)
    });

    Ok(files)
}