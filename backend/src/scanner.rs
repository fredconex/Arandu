use anyhow::Result;
use std::fs;
use std::io::{BufReader, Read};
use std::path::Path;
use glob::glob;
use regex::Regex;
use crate::models::*;

const MAX_KV_ENTRIES: u64 = 1024;
const MAX_STRING_LEN: u64 = 1024 * 1024; // 1MB guard

pub fn scan_models(directory: &str) -> Result<Vec<ModelInfo>> {
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

/// A lightweight reader that mirrors the Pascal TGGUFModel approach:
/// parse every KV value properly instead of skipping unknown types.
/// Uses a BufReader to amortize the many tiny read_exact calls (1–8 bytes each)
/// into large buffered reads, avoiding a syscall per field.
struct GgufReader {
    file: BufReader<fs::File>,
    version: u32,
}

impl GgufReader {

    fn read_u8(&mut self) -> Result<u8, Box<dyn std::error::Error>> {
        let mut buf = [0u8; 1];
        self.file.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    fn read_u16(&mut self) -> Result<u16, Box<dyn std::error::Error>> {
        let mut buf = [0u8; 2];
        self.file.read_exact(&mut buf)?;
        Ok(u16::from_le_bytes(buf))
    }

    fn read_u32(&mut self) -> Result<u32, Box<dyn std::error::Error>> {
        let mut buf = [0u8; 4];
        self.file.read_exact(&mut buf)?;
        Ok(u32::from_le_bytes(buf))
    }

    fn read_u64(&mut self) -> Result<u64, Box<dyn std::error::Error>> {
        let mut buf = [0u8; 8];
        self.file.read_exact(&mut buf)?;
        Ok(u64::from_le_bytes(buf))
    }

    /// Like Pascal's ReadVersionSize: u32 for v1, u64 for v2/v3.
    fn read_size(&mut self) -> Result<u64, Box<dyn std::error::Error>> {
        if self.version == 1 {
            Ok(self.read_u32()? as u64)
        } else {
            self.read_u64()
        }
    }

    /// Read a GGUF length-prefixed string using version-aware length.
    fn read_string(&mut self) -> Result<String, Box<dyn std::error::Error>> {
        let len = self.read_size()?;
        if len > MAX_STRING_LEN {
            return Err(format!("String length {} exceeds safety limit", len).into());
        }
        let mut bytes = vec![0u8; len as usize];
        self.file.read_exact(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Read and discard a value of the given type — mirrors Pascal's case dispatch.
    fn skip_value(&mut self, value_type: u32) -> Result<(), Box<dyn std::error::Error>> {
        match value_type {
            0 | 1 => { self.read_u8()?; }                        // uint8 / int8
            2 | 3 => { self.read_u16()?; }                       // uint16 / int16
            4 | 5 | 6 => { self.read_u32()?; }                   // uint32 / int32 / float32
            7 => { self.read_u8()?; }                            // bool
            8 => { self.read_string()?; }                        // string
            9 => {                                               // array
                let elem_type = self.read_u32()?;
                let count = self.read_size()?;
                if count > MAX_KV_ENTRIES * 1024 {
                    return Err(format!("Array count {} exceeds safety limit", count).into());
                }
                for _ in 0..count {
                    self.skip_value(elem_type)?;
                }
            }
            10 | 11 | 12 => { self.read_u64()?; }               // uint64 / int64 / float64
            other => return Err(format!("Unknown GGUF value type: {}", other).into()),
        }
        Ok(())
    }
}

pub fn extract_gguf_metadata(
    file_path: &Path,
) -> Result<GgufMetadata, Box<dyn std::error::Error>> {
    let file = fs::File::open(file_path)?;
    let fallback_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Wrap immediately in a BufReader so the magic + version reads are also buffered.
    // The buffer is large enough to pull the entire header in one OS read.
    let mut buffered = BufReader::with_capacity(65536, file);

    // Magic
    let mut magic = [0u8; 4];
    buffered.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        return Ok(GgufMetadata {
            architecture: "Unknown".to_string(),
            name: fallback_name,
        });
    }

    // Version
    let mut buf4 = [0u8; 4];
    buffered.read_exact(&mut buf4)?;
    let version = u32::from_le_bytes(buf4);

    // Convert the BufReader<File> into a GgufReader (which wraps its own BufReader).
    // To avoid double-buffering, consume the inner file and re-wrap it.
    // Simpler: pass the buffered reader directly by changing GgufReader to accept it.
    let mut reader = GgufReader { file: buffered, version };

    // Tensor count (skip)
    reader.read_size()?;

    // KV count
    let kv_count = reader.read_size()?.min(MAX_KV_ENTRIES);

    let mut architecture = "Unknown".to_string();
    let mut name = fallback_name;
    let mut found_architecture = false;
    let mut found_name = false;

    for _ in 0..kv_count {
        if found_architecture && found_name {
            break;
        }

        let key = match reader.read_string() {
            Ok(k) => k,
            Err(_) => break,
        };

        let value_type = match reader.read_u32() {
            Ok(t) => t,
            Err(_) => break,
        };

        // If it's a string and we care about this key, read it; otherwise skip.
        if value_type == 8 {
            let value = match reader.read_string() {
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
                _ => {} // string we don't need — already consumed, nothing to skip
            }
        } else if reader.skip_value(value_type).is_err() {
            break;
        }
    }

    Ok(GgufMetadata { architecture, name })
}

pub fn get_quantization_from_filename(filename: &str) -> String {
    let base = filename.strip_suffix(".gguf").unwrap_or(filename);
    let separator = base.rfind('-').or_else(|| base.rfind('.'));

    if let Some(pos) = separator {
        let token = &base[pos + 1..];
        if !token.is_empty() {
            return token.to_uppercase();
        }
    }

    base.to_uppercase()
}

pub fn scan_mmproj_files(
    directory: &str,
) -> Result<Vec<serde_json::Value>> {
    if directory.is_empty() || !Path::new(directory).is_dir() {
        return Ok(Vec::new());
    }

    let base_path = Path::new(directory);
    let pattern = format!("{}/**/*.gguf", directory);

    let mut files: Vec<serde_json::Value> = glob(&pattern)?
        .filter_map(|entry| entry.ok())
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