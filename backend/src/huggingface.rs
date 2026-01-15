use crate::models::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

/// Cleanup leftover .download files from interrupted downloads during startup
pub async fn cleanup_leftover_downloads(models_directory: &str) -> Result<usize, Box<dyn std::error::Error>> {
    if models_directory.is_empty() {
        return Ok(0);
    }
    
    let models_path = Path::new(models_directory);
    if !models_path.exists() {
        return Ok(0);
    }
    
    let mut cleaned_count = 0;
    
    // Recursively walk through the models directory
    let mut entries = fs::read_dir(models_path).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        
        if path.is_dir() {
            // Recursively clean subdirectories (author folders, model folders)
            if let Ok(count) = cleanup_directory_downloads(&path).await {
                cleaned_count += count;
            }
        } else if path.is_file() {
            // Check if it's a .gguf.download file
            if is_gguf_download_file(&path) {
                match fs::remove_file(&path).await {
                    Ok(_) => {
                        println!("Cleaned up leftover download file: {:?}", path);
                        cleaned_count += 1;
                    },
                    Err(e) => {
                        eprintln!("Failed to remove download file {:?}: {}", path, e);
                    }
                }
            }
        }
    }
    
    if cleaned_count > 0 {
        println!("Startup cleanup: removed {} leftover .gguf.download files", cleaned_count);
    }
    
    Ok(cleaned_count)
}

/// Recursively clean .gguf.download files from a directory
fn cleanup_directory_downloads(dir_path: &Path) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<usize, Box<dyn std::error::Error>>> + Send + '_>> {
    Box::pin(async move {
        let mut cleaned_count = 0;
        
        let mut entries = fs::read_dir(dir_path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            
            if path.is_dir() {
                // Recursively clean subdirectories
                if let Ok(count) = cleanup_directory_downloads(&path).await {
                    cleaned_count += count;
                }
            } else if path.is_file() {
                // Check if it's a .gguf.download file
                if is_gguf_download_file(&path) {
                    match fs::remove_file(&path).await {
                        Ok(_) => {
                            println!("Cleaned up leftover download file: {:?}", path);
                            cleaned_count += 1;
                        },
                        Err(e) => {
                            eprintln!("Failed to remove download file {:?}: {}", path, e);
                        }
                    }
                }
            }
        }
        
        Ok(cleaned_count)
    })
}

/// Strictly check if a file is a .gguf.download file
/// Only files ending with exactly ".gguf.download" will be considered for removal
fn is_gguf_download_file(path: &Path) -> bool {
    if let Some(file_name) = path.file_name() {
        if let Some(file_str) = file_name.to_str() {
            // Must end with exactly ".gguf.download" - case insensitive for safety
            return file_str.to_lowercase().ends_with(".gguf.download");
        }
    }
    false
}

pub async fn search_models(
    query: String,
    limit: usize,
    sort_by: String,
) -> Result<SearchResult, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    
    // Build search URL with parameters - add full parameter to get complete model information
    let url = format!(
        "https://huggingface.co/api/models?search={}&filter=gguf,conversational&sort={}&limit={}&full=true",
        urlencoding::encode(&query),
        match sort_by.as_str() {
            "downloads" => "downloads",
            "likes" => "likes", 
            "updated" => "lastModified",
            _ => "" // relevance - default
        },
        limit
    );
    
    println!("Searching with URL: {}", url);
    
    let response = client
        .get(&url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .send()
        .await?;
    
    if !response.status().is_success() {
        return Err(format!("API request failed with status: {}", response.status()).into());
    }
    
    let models_data: Value = response.json().await?;
    let models_array = models_data.as_array()
        .ok_or("Invalid response format: expected array")?;
    
    let mut models = Vec::new();
    
    for model_data in models_array {
        if let Some(model) = parse_model_basic(model_data) {
            models.push(model);
        }
    }
    
    let total = models.len();
    
    Ok(SearchResult {
        success: true,
        models,
        total,
    })
}

fn parse_model_basic(data: &Value) -> Option<ModelBasic> {
    let id = data.get("id")?.as_str()?.to_string();
    let name = id.clone(); // Use ID as name for now
    let author = id.split('/').next().unwrap_or("unknown").to_string();
    
    // Try multiple field names for last modified date
    let last_modified = data.get("lastModified")
        .and_then(|v| v.as_str())
        .or_else(|| data.get("last_modified").and_then(|v| v.as_str()))
        .or_else(|| data.get("updatedAt").and_then(|v| v.as_str()))
        .or_else(|| data.get("updated_at").and_then(|v| v.as_str()))
        .or_else(|| data.get("createdAt").and_then(|v| v.as_str()))
        .or_else(|| data.get("created_at").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    
    // Debug logging for all available fields
    //println!("Model {}: Available fields = {:?}", id, data.as_object().map(|obj| obj.keys().collect::<Vec<_>>()));
    //println!("Model {}: lastModified from API = {:?}", id, last_modified);
    
    Some(ModelBasic {
        id,
        name,
        author,
        downloads: data.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
        likes: data.get("likes").and_then(|v| v.as_u64()).unwrap_or(0),
        last_modified,
    })
}

pub async fn get_huggingface_model_details(
    model_id: String,
) -> Result<ModelDetails, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    
    // Get model info
    let model_url = format!("https://huggingface.co/api/models/{}", model_id);
    let model_response = client
        .get(&model_url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .send()
        .await?;
    
    if !model_response.status().is_success() {
        return Err(format!("Failed to fetch model info: {}", model_response.status()).into());
    }
    
    let model_data: Value = model_response.json().await?;
    
    // Get file tree to find GGUF files
    let files_url = format!("https://huggingface.co/api/models/{}/tree/main?recursive=true", model_id);
    let files_response = client
        .get(&files_url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .send()
        .await?;
    
    let files_data: Value = if files_response.status().is_success() {
        files_response.json().await?
    } else {
        json!([])
    };
    
    // Parse the model details
    let id = model_data.get("id").and_then(|v| v.as_str()).unwrap_or(&model_id).to_string();
    let name = id.clone();
    let author = id.split('/').next().unwrap_or("unknown").to_string();
    let description = model_data.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
    let downloads = model_data.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
    let likes = model_data.get("likes").and_then(|v| v.as_u64()).unwrap_or(0);
    
    // Find and organize GGUF files
    let mut gguf_files = HashMap::new();
    let mut total_files = 0;
    
    if let Some(files_array) = files_data.as_array() {
        for file in files_array {
            if let Some(file_path) = file.get("path").and_then(|v| v.as_str()) {
                // Count all files
                total_files += 1;
                
                // Process GGUF files specifically
                if file_path.to_lowercase().ends_with(".gguf") {
                    let size = file.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    let filename = file_path.split('/').last().unwrap_or(file_path).to_string();
                    let quantization_type = extract_quantization_type(file_path);
                    
                    gguf_files.insert(filename.clone(), GgufFileInfo {
                        filename: filename.clone(),
                        path: file_path.to_string(),
                        size,
                        quantization_type,
                    });
                }
            }
        }
    }
    
    Ok(ModelDetails {
        id,
        name,
        author,
        description,
        downloads,
        likes,
        total_files,
        gguf_files,
    })
}

fn extract_quantization_type(filename: &str) -> Option<String> {
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
                return Some(quant_upper);
            }
        }
        
        // If no separator found, return the whole base name
        return Some(base_part.to_string());
    }
    
    // Fallback: use the original pattern matching for edge cases
    let patterns = [
        // IQ formats
        "iq4_nl", "iq4_xs", "iq3_xxs", "iq3_xs", "iq3_s", "iq3_m",
        "iq2_xxs", "iq2_xs", "iq2_s", "iq2_m",
        "iq1_s", "iq1_m",
        
        // Q formats with K variants (most specific first)
        "q8_k_m", "q8_k_s", "q8_k",
        "q6_k_m", "q6_k_s", "q6_k", 
        "q5_k_m", "q5_k_s", "q5_k",
        "q4_k_m", "q4_k_s", "q4_k",
        "q3_k_m", "q3_k_s", "q3_k_l", "q3_k",
        "q2_k_m", "q2_k_s", "q2_k",
        
        // Standard Q formats
        "q8_0", "q6_0", "q5_1", "q5_0", "q4_1", "q4_0", "q3_0", "q2_0",
        
        // Float formats
        "fp16", "f16", "f32", "bf16"
    ];
    
    for pattern in &patterns {
        if filename_lower.contains(pattern) {
            return Some(pattern.to_uppercase());
        }
    }
    
    Some("UNKNOWN".to_string())
}
