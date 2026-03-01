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
    // Try to get NVIDIA GPU info
    match nvml_wrapper::Nvml::init() {
        Ok(nvml) => {
            match nvml.device_count() {
                Ok(count) if count > 0 => {
                    match nvml.device_by_index(0) {
                        Ok(device) => {
                            let name = device.name().unwrap_or_else(|_| "NVIDIA GPU".to_string());
                            
                            // Get GPU utilization
                            let gpu_usage = match device.utilization_rates() {
                                Ok(util) => util.gpu as f32,
                                Err(_) => 0.0,
                            };
                            
                            // Get GPU memory info
                            let (gpu_memory_total_gb, gpu_memory_used_gb) = match device.memory_info() {
                                Ok(mem_info) => {
                                    let total = mem_info.total as f32 / (1024.0 * 1024.0 * 1024.0);
                                    let used = mem_info.used as f32 / (1024.0 * 1024.0 * 1024.0);
                                    (total, used)
                                },
                                Err(_) => (0.0, 0.0),
                            };
                            
                            (name, gpu_usage, gpu_memory_total_gb, gpu_memory_used_gb)
                        },
                        Err(_) => ("NVIDIA GPU (info unavailable)".to_string(), 0.0, 0.0, 0.0)
                    }
                },
                _ => ("No NVIDIA GPU detected".to_string(), 0.0, 0.0, 0.0)
            }
        },
        Err(_) => {
            // Fallback for non-NVIDIA GPUs or when NVML is not available
            ("No NVIDIA GPU detected".to_string(), 0.0, 0.0, 0.0)
        }
    }
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