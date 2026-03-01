use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use sysinfo::{System};
use std::path::Path;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub memory_total_gb: f32,
    pub memory_used_gb: f32,
    pub gpu_name: String,
    pub gpu_usage: f32,
    pub gpu_memory_total_gb: f32,
    pub gpu_memory_used_gb: f32,
    pub timestamp: u64,
    pub models_folder_size_gb: f32,
    pub models_count: u32,
}

#[tauri::command]
pub async fn get_system_stats(state: tauri::State<'_, crate::AppState>) -> Result<SystemStats, String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    
    // CPU usage (average of all cores)
    let cpu_usage = sys.global_cpu_usage();
    
    // Memory information in GB
    let memory_total_gb = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let memory_used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    
    // GPU information
    let (gpu_name, gpu_usage, gpu_memory_total_gb, gpu_memory_used_gb) = get_gpu_info();
    
    // Models folder statistics
    let (models_folder_size_gb, models_count) = get_models_stats(&state).await;
    
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    
    Ok(SystemStats {
        cpu_usage,
        memory_total_gb,
        memory_used_gb,
        gpu_name,
        gpu_usage,
        gpu_memory_total_gb,
        gpu_memory_used_gb,
        timestamp,
        models_folder_size_gb,
        models_count,
    })
}

fn get_gpu_info() -> (String, f32, f32, f32) {
    // Cross-platform GPU detection via all-smi
    // This supports NVIDIA, AMD, Apple Silicon, and more.
    if let Ok(smi) = all_smi::AllSmi::new() {
        let gpus = smi.get_gpu_info();
        if !gpus.is_empty() {
            // Get the first GPU found
            let gpu = &gpus[0];
            let name = gpu.name.clone();
            
            // all-smi provides memory in bytes as u64
            let total_gb = gpu.total_memory as f32 / (1024.0 * 1024.0 * 1024.0);
            let used_gb = gpu.used_memory as f32 / (1024.0 * 1024.0 * 1024.0);
            
            let usage_percent = gpu.utilization as f32;
            
            return (name, usage_percent, total_gb, used_gb);
        }
    }

    ("No GPU detected".to_string(), 0.0, 0.0, 0.0)
}

async fn get_models_stats(state: &crate::AppState) -> (f32, u32) {
    // Get models directory from config
    let models_dir = {
        let config = state.config.lock().await;
        config.models_directory.clone()
    };
    
    // Check if directory exists
    if models_dir.is_empty() || !Path::new(&models_dir).is_dir() {
        return (0.0, 0);
    }
    
    // Calculate total size and count .gguf files
    let (total_size, model_count) = calculate_directory_stats(&models_dir);
    
    // Convert bytes to GB
    let size_gb = total_size as f32 / (1024.0 * 1024.0 * 1024.0);
    
    (size_gb, model_count)
}

fn calculate_directory_stats(dir: &str) -> (u64, u32) {
    let mut total_size = 0u64;
    let mut model_count = 0u32;
    
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            
            if path.is_file() {
                // Count .gguf files
                if let Some(ext) = path.extension() {
                    if ext == "gguf" {
                        model_count += 1;
                    }
                }
                
                // Add file size
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            } else if path.is_dir() {
                // Recursively process subdirectories
                let (sub_size, sub_count) = calculate_directory_stats(path.to_str().unwrap_or(""));
                total_size += sub_size;
                model_count += sub_count;
            }
        }
    }
    
    (total_size, model_count)
}