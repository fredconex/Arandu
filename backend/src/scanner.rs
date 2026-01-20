use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use glob::glob;
use regex::Regex;
use crate::models::*;

pub async fn scan_models(directory: &str) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error>> {
    if directory.is_empty() || !Path::new(directory).is_dir() {
        return Ok(Vec::new());
    }
    
    let pattern = format!("{}/**/*.gguf", directory);
    let files: Result<Vec<_>, _> = glob(&pattern)?.collect();
    let files = files?;
    
    let mut model_groups = std::collections::HashMap::new();
    
    // Group files by base name (handle split files)
    for path in files {
        let path_str = path.to_string_lossy().to_string();
        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        
        // Check if this is a split file (e.g., model-00001-of-00005.gguf)
        let re = Regex::new(r"(.+?)-\d{5}-of-\d{5}\.gguf$")?;
        if let Some(captures) = re.captures(&file_name) {
            let base_name = captures.get(1).unwrap().as_str().to_string();
            model_groups.entry(base_name).or_insert_with(Vec::new).push(path_str);
        } else {
            model_groups.entry(path_str.clone()).or_insert_with(Vec::new).push(path_str);
        }
    }
    
    let mut models = Vec::new();
    
    for (base_name, file_list) in model_groups {
        if let Ok(model_info) = process_model_group(&base_name, &file_list).await {
            models.push(model_info);
        }
    }
    
    // Sort by name
    models.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(models)
}

async fn process_model_group(base_name: &str, file_list: &[String]) -> Result<ModelInfo, Box<dyn std::error::Error>> {
    let first_file = file_list.first().ok_or("Empty file list")?;
    let first_path = Path::new(first_file);
    
    // Calculate total size
    let mut total_size = 0u64;
    for file_path in file_list {
        if let Ok(metadata) = fs::metadata(file_path) {
            total_size += metadata.len();
        }
    }
    
    // Get file metadata
    let metadata = fs::metadata(first_path)?;
    let modified_time = metadata.modified()?
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64;
    
    // Extract GGUF metadata
    let gguf_metadata = extract_gguf_metadata(first_path)?;
    
    // Determine display name
    let display_name = if file_list.len() > 1 {
        // Multi-file model
        base_name.to_string()
    } else {
        first_path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(base_name)
            .to_string()
    };
    
    // Extract quantization from filename
    let quantization = get_quantization_from_filename(&display_name);
    
    Ok(ModelInfo {
        path: first_file.clone(),
        name: display_name,
        size_gb: (total_size as f64) / (1024.0 * 1024.0 * 1024.0),
        architecture: gguf_metadata.architecture,
        model_name: gguf_metadata.name,
        quantization,
        date: modified_time,
    })
}

pub fn extract_gguf_metadata(file_path: &Path) -> Result<GgufMetadata, Box<dyn std::error::Error>> {
    let mut file = fs::File::open(file_path)?;
    
    // Read magic bytes
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    
    if &magic != b"GGUF" {
        return Ok(GgufMetadata {
            architecture: "Unknown".to_string(),
            name: file_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string(),
        });
    }
    
    // Skip version and tensor count
    file.seek(SeekFrom::Current(12))?;
    
    // Read metadata key-value count
    let mut kv_count_bytes = [0u8; 8];
    file.read_exact(&mut kv_count_bytes)?;
    let kv_count = u64::from_le_bytes(kv_count_bytes);
    
    let mut architecture = "Unknown".to_string();
    let mut name = file_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    // Read key-value pairs
    for _ in 0..kv_count {
        // Read key length
        let mut key_len_bytes = [0u8; 8];
        if file.read_exact(&mut key_len_bytes).is_err() {
            break;
        }
        let key_len = u64::from_le_bytes(key_len_bytes);
        
        // Read key
        let mut key_bytes = vec![0u8; key_len as usize];
        if file.read_exact(&mut key_bytes).is_err() {
            break;
        }
        let key = String::from_utf8_lossy(&key_bytes);
        
        // Read value type
        let mut value_type_bytes = [0u8; 4];
        if file.read_exact(&mut value_type_bytes).is_err() {
            break;
        }
        let value_type = u32::from_le_bytes(value_type_bytes);
        
        // Handle string values (type 8)
        if value_type == 8 {
            // Read value length
            let mut value_len_bytes = [0u8; 8];
            if file.read_exact(&mut value_len_bytes).is_err() {
                break;
            }
            let value_len = u64::from_le_bytes(value_len_bytes);
            
            // Read value
            let mut value_bytes = vec![0u8; value_len as usize];
            if file.read_exact(&mut value_bytes).is_err() {
                break;
            }
            let value = String::from_utf8_lossy(&value_bytes);
            
            match key.as_ref() {
                "general.architecture" => {
                    architecture = value.to_string();
                }
                "general.name" => {
                    name = value.to_string();
                }
                _ => {}
            }
        } else {
            // Skip non-string values
            break;
        }
    }
    
    Ok(GgufMetadata {
        architecture,
        name,
    })
}

pub fn get_quantization_from_filename(filename: &str) -> String {
    // Find .gguf extension first, then search backwards for the first dash or dot
    let filename_lower = filename.to_lowercase();
    
    if let Some(gguf_pos) = filename_lower.find(".gguf") {
        let base_part = &filename[..gguf_pos];
        
        // Search backwards from the .gguf position to find the first dash or dot
        let mut last_separator_pos = None;
        
        // Check for dash first
        if let Some(dash_pos) = base_part.rfind('-') {
            last_separator_pos = Some(dash_pos);
        }
        
        // Check for dot, but only if it's after the last dash (or if no dash found)
        if let Some(dot_pos) = base_part.rfind('.') {
            if let Some(dash_pos) = last_separator_pos {
                // If dot is after dash, use dot
                if dot_pos > dash_pos {
                    last_separator_pos = Some(dot_pos);
                }
            } else {
                // No dash found, use dot
                last_separator_pos = Some(dot_pos);
            }
        }
        
        if let Some(separator_pos) = last_separator_pos {
            let quant_part = &base_part[separator_pos + 1..];
            if !quant_part.is_empty() {
                let quant_upper = quant_part.to_uppercase();
                // Return the extracted quantization part
                return quant_upper;
            }
        }
        
        // If no separator found, return the whole base name
        return base_part.to_string();
    }
    
    // Fallback: use pattern matching for edge cases
    let filename_upper = filename.to_uppercase();
    
    // Comprehensive list of known quantization formats (most specific first)
    let quantization_patterns = [
        // IQ formats
        "IQ4_NL", "IQ4_XS", "IQ3_XXS", "IQ3_XS", "IQ3_S", "IQ3_M",
        "IQ2_XXS", "IQ2_XS", "IQ2_S", "IQ2_M",
        "IQ1_S", "IQ1_M",
        "IQ5_K", "IQ5_K_M", "IQ5_K_S", "IQ6_K", "IQ7_K", "IQ8_K",
        
        // MXFP formats
        "MXFP4", "MXFP8",
        
        // Q formats with K variants
        "Q8_K_M", "Q8_K_S", "Q8_K",
        "Q6_K_M", "Q6_K_S", "Q6_K",
        "Q5_K_M", "Q5_K_S", "Q5_K",
        "Q4_K_M", "Q4_K_S", "Q4_K",
        "Q3_K_M", "Q3_K_S", "Q3_K_L", "Q3_K_XL", "Q3_K",
        "Q2_K_M", "Q2_K_S", "Q2_K",
        
        // Standard Q formats
        "Q8_0", "Q6_0", "Q5_1", "Q5_0", "Q4_1", "Q4_0", "Q3_0", "Q2_0",
        
        // Float formats
        "F32", "F16", "BF16",
        
        // Legacy formats
        "Q8", "Q6", "Q5", "Q4", "Q3", "Q2",
    ];
    
    for pattern in &quantization_patterns {
        if filename_upper.contains(pattern) {
            return pattern.to_string();
        }
    }
    
    "Unknown".to_string()
}

pub async fn scan_mmproj_files(directory: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    if directory.is_empty() || !Path::new(directory).is_dir() {
        return Ok(Vec::new());
    }
    
    let base_path = Path::new(directory);
    let pattern = format!("{}/**/*.gguf", directory);
    let entries = glob(&pattern)?;
    
    let mut files = Vec::new();
    for entry in entries {
        if let Ok(path) = entry {
            // Check if this GGUF file has CLIP architecture
            if let Ok(metadata) = extract_gguf_metadata(&path) {
                if metadata.architecture.to_lowercase() == "clip" {
                    if let Ok(rel_path) = path.strip_prefix(base_path) {
                        files.push(rel_path.to_string_lossy().to_string());
                    } else {
                        files.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    // Sort alphabetically
    files.sort();
    
    Ok(files)
}