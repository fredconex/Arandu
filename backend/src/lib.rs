use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Manager, Listener};
use tokio::sync::Mutex;
use std::sync::Arc;

mod models;
mod config;
mod process;
mod scanner;
mod huggingface;
mod downloader;
mod llamacpp_manager;
mod system_monitor;

use config::*;
use process::*;
use process::launch_model_external as launch_model_external_impl;
use scanner::*;
use huggingface::*;
use models::{GlobalConfig, ModelConfig, ModelPreset, ProcessInfo, SessionState, WindowState, ProcessOutput, SearchResult, ModelDetails, DownloadStartResult};
use downloader::{DownloadManager, DownloadStatus};
use llamacpp_manager::{LlamaCppReleaseFrontend as LlamaCppRelease, LlamaCppAssetFrontend as LlamaCppAsset};
use system_monitor::*;

// Import ProcessHandle from process module
use process::ProcessHandle;

/// Detect backend type from asset name
fn detect_backend_type(asset_name: &str) -> String {
    let name_lower = asset_name.to_lowercase();
    
    if name_lower.contains("cuda") || name_lower.contains("cudart") {
        "cuda".to_string()
    } else if name_lower.contains("vulkan") {
        "vulkan".to_string()
    } else if name_lower.contains("opencl") {
        "opencl".to_string()
    } else if name_lower.contains("metal") {
        "metal".to_string()
    } else if name_lower.contains("cpu") || (!name_lower.contains("cuda") && !name_lower.contains("vulkan") && !name_lower.contains("opencl") && !name_lower.contains("metal")) {
        "cpu".to_string()
    } else {
        "unknown".to_string()
    }
}


// Global application state
#[derive(Debug)]
pub struct AppState {
    pub config: Arc<Mutex<GlobalConfig>>,
    pub model_configs: Arc<Mutex<HashMap<String, ModelConfig>>>,
    pub running_processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    pub child_processes: Arc<Mutex<HashMap<String, Arc<Mutex<ProcessHandle>>>>>, // Simplified process tracking
    pub session_state: Arc<Mutex<SessionState>>,
    pub download_manager: Arc<Mutex<DownloadManager>>,
}

// Implement Clone manually to avoid derive issues with Child
impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            model_configs: self.model_configs.clone(),
            running_processes: self.running_processes.clone(),
            child_processes: self.child_processes.clone(),
            session_state: self.session_state.clone(),
            download_manager: self.download_manager.clone(),
        }
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(GlobalConfig::default())),
            model_configs: Arc::new(Mutex::new(HashMap::new())),
            running_processes: Arc::new(Mutex::new(HashMap::new())),
            child_processes: Arc::new(Mutex::new(HashMap::new())),
            session_state: Arc::new(Mutex::new(SessionState::default())),
            download_manager: Arc::new(Mutex::new(DownloadManager::new())),
        }
    }
    
    // Method to cleanup all child processes when app exits
    pub async fn cleanup_all_processes(&self) {
        println!("Starting cleanup of all child processes...");
        
        let process_count = {
            let child_processes = self.child_processes.lock().await;
            child_processes.len()
        };
        
        println!("Found {} processes to clean up", process_count);
        
        if process_count == 0 {
            println!("No processes to clean up");
            return;
        }
        
        let mut child_processes = self.child_processes.lock().await;
        let mut running_processes = self.running_processes.lock().await;
        
        for (process_id, handle_arc) in child_processes.drain() {
            println!("Terminating process: {}", process_id);
            let mut handle_guard = handle_arc.lock().await;
            if let Some(mut child) = handle_guard.take_child() {
                match child.kill().await {
                    Ok(_) => println!("Successfully killed process: {}", process_id),
                    Err(e) => {
                        eprintln!("Failed to kill process {}: {}", process_id, e);
                        // Try to force kill on Windows
                        #[cfg(windows)]
                        {
                            if let Some(id) = child.id() {
                                println!("Attempting force kill of PID: {}", id);
                                let _ = std::process::Command::new("taskkill")
                                    .args(["/PID", &id.to_string(), "/F"])
                                    .output();
                            }
                        }
                    }
                }
            } else {
                println!("Process {} already terminated", process_id);
            }
        }
        
        // Clear the running processes list
        running_processes.clear();
        println!("Process cleanup completed");
    }
    
    // Force cleanup that drops all child processes immediately
    // This relies on kill_on_drop(true) to terminate the processes
    pub fn force_cleanup_all_processes(&self) {
        println!("Force cleaning up all child processes (synchronous)...");
        
        // Use try_lock to avoid blocking if already locked
        if let Ok(mut child_processes) = self.child_processes.try_lock() {
            let count = child_processes.len();
            if count == 0 {
                println!("No processes to clean up");
                return;
            }
            
            println!("Force cleaning {} processes", count);
            
            // On Windows, use taskkill for immediate termination
            #[cfg(windows)]
            {
                // Collect all PIDs first
                let mut pids = Vec::new();
                for (_process_id, handle_arc) in child_processes.iter() {
                    if let Ok(handle_guard) = handle_arc.try_lock() {
                        if let Some(pid) = handle_guard.get_child_id() {
                            pids.push(pid);
                        }
                    }
                }
                
                // Kill all processes at once if we have PIDs
                if !pids.is_empty() {
                    println!("Force killing {} PIDs", pids.len());
                    for pid in pids {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/PID", &pid.to_string(), "/F", "/T"]) // /T kills child processes too
                            .status();
                    }
                }
            }
            
            #[cfg(not(windows))]
            {
                // On Unix systems, use kill -9
                for (process_id, handle_arc) in child_processes.iter() {
                    if let Ok(handle_guard) = handle_arc.try_lock() {
                        if let Some(pid) = handle_guard.get_child_id() {
                            let _ = std::process::Command::new("kill")
                                .args(["-9", &pid.to_string()])
                                .status();
                        }
                    }
                }
            }
            
            child_processes.clear(); // This will drop all ProcessHandle instances
            println!("Force dropped {} process handles", count);
        } else {
            println!("Could not acquire lock for force cleanup, relying on kill_on_drop");
        }
        
        if let Ok(mut running_processes) = self.running_processes.try_lock() {
            running_processes.clear();
        }
        
        println!("Force cleanup completed");
    }
}

// Implement Drop trait for emergency cleanup
// Note: This will only be called when the entire application is shutting down
impl Drop for AppState {
    fn drop(&mut self) {
        // For now, let's be conservative and NOT do global cleanup in Drop
        // The window event handlers should handle cleanup when needed
        println!("AppState dropping, skipping emergency process cleanup in Drop implementation");
        
        // If you want to be extra safe, you could do this:
        /*
        let has_processes = {
            if let Ok(child_processes) = self.child_processes.try_lock() {
                !child_processes.is_empty()
            } else {
                false
            }
        };
        
        if has_processes {
            println!("AppState dropping with running processes, but skipping cleanup in Drop");
        }
        */
    }
}

// Tauri commands
#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<GlobalConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
async fn save_config(
    models_directory: String,
    executable_folder: String,
    theme_color: String,
    background_color: String,
    theme_is_synced: bool,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    println!("Saving config: models_dir={}, exec_folder={}, theme={}, background={}, synced={}", models_directory, executable_folder, theme_color, background_color, theme_is_synced);
    
    // Preserve existing active executable folder
    let (existing_active_path, existing_active_version) = {
        let cfg = state.config.lock().await;
        (cfg.active_executable_folder.clone(), cfg.active_executable_version.clone())
    };
    let config = GlobalConfig {
        models_directory: models_directory.clone(),
        executable_folder,
        active_executable_folder: existing_active_path,
        active_executable_version: existing_active_version,
        theme_color,
        background_color,
        theme_is_synced,
    };
    
    // Update global config
    {
        let mut global_config = state.config.lock().await;
        *global_config = config.clone();
    }
    
    // Save to file
    if let Err(e) = save_settings(&state).await {
        println!("Failed to save settings: {}", e);
        return Ok(serde_json::json!({
            "success": false,
            "error": format!("Failed to save settings: {}", e)
        }));
    }
    
    // Cleanup leftover download files in the new models directory
    if let Err(e) = huggingface::cleanup_leftover_downloads(&models_directory).await {
        eprintln!("Warning: Failed to cleanup leftover downloads: {}", e);
    }
    
    // Scan models with new directory
    match scan_models(&models_directory).await {
        Ok(models) => {
            println!("Successfully scanned {} models", models.len());
            Ok(serde_json::json!({
                "success": true,
                "models": models
            }))
        },
        Err(e) => {
            println!("Failed to scan models: {}", e);
            Ok(serde_json::json!({
                "success": false,
                "error": format!("Failed to scan models: {}", e)
            }))
        }
    }
}

#[tauri::command]
async fn scan_models_command(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().await;
    let models = scan_models(&config.models_directory).await
        .map_err(|e| format!("Failed to scan models: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "models": models
    }))
}

#[tauri::command]
async fn scan_mmproj_files_command(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().await;
    let files = scan_mmproj_files(&config.models_directory).await
        .map_err(|e| format!("Failed to scan mmproj files: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "files": files
    }))
}

#[tauri::command]
async fn get_model_settings(
    model_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ModelConfig, String> {
    let model_configs = state.model_configs.lock().await;
    Ok(model_configs.get(&model_path)
        .cloned()
        .unwrap_or_else(|| ModelConfig::new(model_path)))
}

#[tauri::command]
async fn update_model_settings(
    model_path: String,
    config: ModelConfig,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut model_configs = state.model_configs.lock().await;
        model_configs.insert(model_path, config);
    }
    
    save_settings(&state).await
        .map_err(|e| format!("Failed to save settings: {}", e))
}

#[tauri::command]
async fn get_model_presets(
    model_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ModelPreset>, String> {
    let model_configs = state.model_configs.lock().await;
    let config = model_configs.get(&model_path)
        .cloned()
        .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
    Ok(config.presets)
}

#[tauri::command]
async fn update_model_presets(
    model_path: String,
    presets: Vec<ModelPreset>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // Update the model config
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        // Replace all presets with the new list
        config.presets = presets;
        
        // Update the config
        model_configs.insert(model_path, config);
    } // Release the lock here
    
    // Save to disk (this will acquire its own locks)
    if let Err(e) = save_settings(&state).await {
        return Err(format!("Failed to save settings: {}", e));
    }
    
    Ok(serde_json::json!({
        "success": true,
        "message": "Presets updated successfully"
    }))
}

#[tauri::command]
async fn save_model_preset(
    model_path: String,
    preset: ModelPreset,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    println!("Saving preset: {:?} for model: {}", preset, model_path);
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        println!("Current presets count: {}", config.presets.len());
        
        // Check if preset with this ID already exists
        if let Some(existing) = config.presets.iter_mut().find(|p| p.id == preset.id) {
            println!("Updating existing preset: {}", preset.id);
            *existing = preset.clone();
        } else {
            println!("Adding new preset: {}", preset.id);
            config.presets.push(preset.clone());
        }
        
        println!("New presets count: {}", config.presets.len());
        
        // If this preset is marked as default, update default_preset_id
        if preset.is_default {
            // Remove default flag from other presets
            for p in config.presets.iter_mut() {
                if p.id != preset.id {
                    p.is_default = false;
                }
            }
            config.default_preset_id = Some(preset.id.clone());
        }
        
        model_configs.insert(model_path.clone(), config);
        println!("Model config updated in state");
    }
    
    println!("Calling save_settings...");
    let result = save_settings(&state).await
        .map_err(|e| format!("Failed to save settings: {}", e));
    
    if result.is_ok() {
        println!("Settings saved successfully");
    } else {
        println!("Failed to save settings: {:?}", result);
    }
    
    result
}

#[tauri::command]
async fn delete_model_preset(
    model_path: String,
    preset_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        config.presets.retain(|p| p.id != preset_id);
        
        // If the deleted preset was the default, clear default_preset_id
        if config.default_preset_id.as_ref() == Some(&preset_id) {
            config.default_preset_id = None;
        }
        
        model_configs.insert(model_path, config);
    }
    
    save_settings(&state).await
        .map_err(|e| format!("Failed to save settings: {}", e))
}

#[tauri::command]
async fn set_default_preset(
    model_path: String,
    preset_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        // Update default flag on all presets
        for preset in config.presets.iter_mut() {
            preset.is_default = preset.id == preset_id;
        }
        
        config.default_preset_id = Some(preset_id);
        model_configs.insert(model_path, config);
    }
    
    save_settings(&state).await
        .map_err(|e| format!("Failed to save settings: {}", e))
}

#[tauri::command]
async fn launch_model_with_preset(
    model_path: String,
    preset_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // Get the preset arguments
    let custom_args = {
        let model_configs = state.model_configs.lock().await;
        let config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        if let Some(pid) = preset_id {
            // Find the preset
            config.presets.iter()
                .find(|p| p.id == pid)
                .map(|p| p.custom_args.clone())
                .unwrap_or_else(|| config.custom_args.clone())
        } else if let Some(default_id) = config.default_preset_id {
            // Use default preset
            config.presets.iter()
                .find(|p| p.id == default_id)
                .map(|p| p.custom_args.clone())
                .unwrap_or_else(|| config.custom_args.clone())
        } else {
            // Use current custom_args
            config.custom_args.clone()
        }
    };
    
    // Store original args for restoration
    let original_args = {
        let model_configs = state.model_configs.lock().await;
        let config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        config.custom_args.clone()
    };
    
    // Temporarily update the model config with preset args
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        config.custom_args = custom_args;
        model_configs.insert(model_path.clone(), config);
    } // Release the lock here
    
    // Launch the model (this may acquire locks internally)
    let result = launch_model_server(model_path.clone(), &state).await
        .map_err(|e| format!("Failed to launch model: {}", e))?;
    
    // Restore original args
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        config.custom_args = original_args;
        model_configs.insert(model_path, config);
    }
    
    Ok(serde_json::json!({
        "success": true,
        "process_id": result.process_id,
        "model_name": result.model_name,
        "server_host": result.server_host,
        "server_port": result.server_port
    }))
}

#[tauri::command]
async fn launch_model(
    model_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let result = launch_model_server(model_path, &state).await
        .map_err(|e| format!("Failed to launch model: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "process_id": result.process_id,
        "model_name": result.model_name,
        "server_host": result.server_host,
        "server_port": result.server_port
    }))
}

#[tauri::command]
async fn launch_model_external(
    model_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let result = launch_model_external_impl(model_path, &state).await
        .map_err(|e| format!("Failed to launch model externally: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "message": result.message
    }))
}

#[tauri::command]
async fn launch_model_with_preset_external(
    model_path: String,
    preset_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // Get the preset arguments
    let custom_args = {
        let model_configs = state.model_configs.lock().await;
        let config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        if let Some(pid) = preset_id {
            // Find the preset
            config.presets.iter()
                .find(|p| p.id == pid)
                .map(|p| p.custom_args.clone())
                .unwrap_or_else(|| config.custom_args.clone())
        } else if let Some(default_id) = config.default_preset_id {
            // Use default preset
            config.presets.iter()
                .find(|p| p.id == default_id)
                .map(|p| p.custom_args.clone())
                .unwrap_or_else(|| config.custom_args.clone())
        } else {
            // Use current custom_args
            config.custom_args.clone()
        }
    };
    
    // Store original args for restoration
    let original_args = {
        let model_configs = state.model_configs.lock().await;
        let config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        config.custom_args.clone()
    };
    
    // Temporarily update the model config with preset args
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        
        config.custom_args = custom_args;
        model_configs.insert(model_path.clone(), config);
    } // Release the lock here
    
    // Launch the model externally (this may acquire locks internally)
    let result = launch_model_external_impl(model_path.clone(), &state).await
        .map_err(|e| format!("Failed to launch model externally: {}", e))?;
    
    // Restore original args
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        config.custom_args = original_args;
        model_configs.insert(model_path, config);
    }
    
    Ok(serde_json::json!({
        "success": true,
        "message": result.message
    }))
}

#[tauri::command]
async fn delete_model_file(
    model_path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use std::fs;
    
    // Security checks - scope the config lock
    let (models_dir, model_file) = {
        let config = state.config.lock().await;
        let models_dir = PathBuf::from(&config.models_directory);
        let model_file = PathBuf::from(&model_path);
        (models_dir, model_file)
    }; // Config lock is dropped here
    
    // Check if file exists before deletion
    if !model_file.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "File does not exist"
        }));
    }
    
    // Ensure the file is within the models directory
    if !model_file.starts_with(&models_dir) {
        return Ok(serde_json::json!({
            "success": false,
            "error": "Cannot delete files outside of models directory"
        }));
    }
    
    // Ensure it's a .gguf file
    if !model_path.to_lowercase().ends_with(".gguf") {
        return Ok(serde_json::json!({
            "success": false,
            "error": "Only .gguf files can be deleted"
        }));
    }
    
    // Delete the file
    match fs::remove_file(&model_path) {
        Ok(_) => {
            // Remove from model configs - scope the lock
            {
                let mut model_configs = state.model_configs.lock().await;
                model_configs.remove(&model_path);
            } // Model configs lock is dropped here
            
            // Save settings
            if let Err(e) = save_settings(&state).await {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to save settings: {}", e)
                }));
            }
            
            // Add a small delay to ensure file system has processed the deletion
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            // Emit file deletion event to frontend
            use tauri::Emitter;
            let _ = app_handle.emit("file-deleted", ());
            
            Ok(serde_json::json!({
                "success": true
            }))
        },
        Err(e) => {
            Ok(serde_json::json!({
                "success": false,
                "error": format!("Failed to delete file: {}", e)
            }))
        }
    }
}

#[tauri::command]
async fn kill_process(
    process_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    terminate_process(process_id, &state).await
        .map_err(|e| format!("Failed to kill process: {}", e))
}

#[tauri::command]
async fn get_process_output(
    process_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ProcessOutput, String> {
    get_process_logs(process_id, &state).await
        .map_err(|e| format!("Failed to get process output: {}", e))
}

#[tauri::command]
async fn browse_folder(
    initial_dir: Option<String>,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let dialog = app.dialog();
    let mut file_dialog = dialog.file();
    
    if let Some(initial) = initial_dir {
        file_dialog = file_dialog.set_directory(initial);
    }
    
    // Use a channel to convert callback to async
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    file_dialog.pick_folder(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });
    
    match rx.await {
        Ok(result) => Ok(result),
        Err(_) => Err("Dialog was cancelled or failed".to_string()),
    }
}

#[tauri::command]
async fn open_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    
    // Open URL in default browser using opener plugin
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
async fn open_model_folder(model_path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    use std::path::Path;
    
    // Get the directory containing the model file
    let model_file_path = Path::new(&model_path);
    let folder_path = model_file_path.parent()
        .ok_or_else(|| "Could not determine parent directory".to_string())?;
    
    // Convert path to string for the opener plugin
    let folder_path_str = folder_path.to_string_lossy().to_string();
    
    // Open folder in default file manager using opener plugin
    app.opener()
        .open_path(folder_path_str, None::<String>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

#[tauri::command]
async fn search_huggingface(
    query: String,
    limit: Option<usize>,
    sort_by: Option<String>,
) -> Result<SearchResult, String> {
    search_models(query, limit.unwrap_or(100), sort_by.unwrap_or_else(|| "relevance".to_string()))
        .await
        .map_err(|e| format!("Search failed: {}", e))
}

#[tauri::command]
async fn get_model_details(
    model_id: String,
) -> Result<ModelDetails, String> {
    get_huggingface_model_details(model_id)
        .await
        .map_err(|e| format!("Failed to get model details: {}", e))
}

#[tauri::command]
async fn download_model(
    model_id: String,
    _filename: String,
    files: Vec<String>,
    state: tauri::State<'_, AppState>,
   app_handle: tauri::AppHandle,
) -> Result<DownloadStartResult, String> {
    use crate::downloader::{DownloadConfig, start_download};
    
    // Get models directory from config
    let models_directory = {
        let config = state.config.lock().await;
        config.models_directory.clone()
    };
    
    // Create destination folder structure: models_directory/author/model_name/
    let author = model_id.split('/').next().unwrap_or("unknown");
    let model_name = model_id.split('/').nth(1).unwrap_or(&model_id);
    let destination_folder = format!("{}/{}/{}", models_directory, author, model_name);
    
    // Create download configuration
    let config = DownloadConfig {
        base_url: format!("https://huggingface.co/{}/resolve/main", model_id),
        destination_folder,
        auto_extract: false, // GGUF files don't need extraction
        create_subfolder: None, // We already created the subfolder structure
        files: files.clone(),
        custom_headers: Some({
            let mut headers = std::collections::HashMap::new();
            headers.insert("User-Agent".to_string(), "Arandu-Tauri/1.0".to_string());
            headers
        }),
    };
    
    start_download(config, &state, app_handle)
        .await
        .map_err(|e| format!("Failed to start download: {}", e))
}

#[tauri::command]
async fn get_download_status(
    download_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DownloadStatus, String> {
    let download_manager = state.download_manager.lock().await;
    download_manager.get_status(&download_id)
        .map(|status| status.clone())
        .ok_or_else(|| "Download not found".to_string())
}

#[tauri::command]
async fn get_all_downloads(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let download_manager = state.download_manager.lock().await;
    Ok(download_manager.downloads.values().cloned().collect())
}

#[tauri::command]
async fn cancel_download(
    download_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let mut download_manager = state.download_manager.lock().await;
    download_manager.cancel_download(&download_id).map_err(|e| format!("Failed to cancel download: {}", e))?;
    Ok(download_manager.downloads.values().cloned().collect())
}

#[tauri::command]
async fn pause_download(
    download_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let mut download_manager = state.download_manager.lock().await;
    download_manager.pause_download(&download_id).map_err(|e| format!("Failed to pause download: {}", e))?;
    Ok(download_manager.downloads.values().cloned().collect())
}

#[tauri::command]
async fn resume_download(
    download_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let mut download_manager = state.download_manager.lock().await;
    download_manager.resume_download(&download_id).map_err(|e| format!("Failed to resume download: {}", e))?;
    Ok(download_manager.downloads.values().cloned().collect())
}

#[tauri::command]
async fn get_all_downloads_and_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let download_manager = state.download_manager.lock().await;
    let mut all_downloads = download_manager.downloads.values().cloned().collect::<Vec<_>>();
    all_downloads.extend(download_manager.download_history.clone());
    Ok(all_downloads)
}

#[tauri::command]
async fn clear_download_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadStatus>, String> {
    let mut download_manager = state.download_manager.lock().await;
    download_manager.clear_download_history();
    let mut all_downloads = download_manager.downloads.values().cloned().collect::<Vec<_>>();
    all_downloads.extend(download_manager.download_history.clone());
    Ok(all_downloads)
}

#[tauri::command]
async fn delete_model(
    model_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use std::fs;
    
    // Security checks
    let config = state.config.lock().await;
    let models_dir = PathBuf::from(&config.models_directory);
    let model_file = PathBuf::from(&model_path);
    
    // Ensure the file is within the models directory
    if !model_file.starts_with(&models_dir) {
        return Err("Cannot delete files outside of models directory".to_string());
    }
    
    // Ensure it's a .gguf file
    if !model_path.to_lowercase().ends_with(".gguf") {
        return Err("Only .gguf files can be deleted".to_string());
    }
    
    // Delete the file
    fs::remove_file(&model_path)
        .map_err(|e| format!("Failed to delete file: {}", e))?;
    
    // Remove from model configs
    {
        let mut model_configs = state.model_configs.lock().await;
        model_configs.remove(&model_path);
    }
    
    // Save settings
    save_settings(&state).await
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_session_state(
    state: tauri::State<'_, AppState>,
) -> Result<SessionState, String> {
    let session = state.session_state.lock().await;
    Ok(session.clone())
}

#[tauri::command]
async fn save_window_state(
    window_id: String,
    window_state: WindowState,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session_state.lock().await;
    session.windows.insert(window_id, window_state);
    Ok(())
}

#[tauri::command]
async fn restart_application(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    println!("Application restart requested via command");
    
    // Perform cleanup but don't exit
    state.cleanup_all_processes().await;
    
    // Give time for cleanup to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
    
    println!("Application restart cleanup completed - frontend will reload");
    
    // Don't exit - let the frontend handle the reload
    Ok(())
}

#[tauri::command]
async fn graceful_exit(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    println!("Graceful exit requested via command");
    
    // Perform cleanup
    state.cleanup_all_processes().await;
    
    // Give time for cleanup to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
    
    println!("Graceful exit cleanup completed");
    
    // Exit the application
    app.exit(0);
    
    Ok(())
}

#[tauri::command]
async fn get_app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
async fn check_file_exists(
    model_id: String,
    filename: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    use std::path::Path;
    
    let config = state.config.lock().await;
    if config.models_directory.is_empty() {
        return Ok(false);
    }
    
    // Create the expected file path structure (author/model/filename)
    let author = model_id.split('/').next().unwrap_or("unknown");
    let model_name = model_id.split('/').nth(1).unwrap_or(&model_id);
    let file_path = Path::new(&config.models_directory)
        .join(author)
        .join(model_name)
        .join(&filename);
    
    Ok(file_path.exists())
}

#[tauri::command]
async fn remove_window_state(
    window_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session_state.lock().await;
    session.windows.remove(&window_id);
    Ok(())
}

#[tauri::command]
async fn download_from_url(
    url: String,
    destination_folder: String,
    extract: bool,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<DownloadStartResult, String> {
    use crate::downloader::{DownloadConfig, start_download};
    
    // Create download configuration
    let config = DownloadConfig {
        base_url: url,
        destination_folder,
        auto_extract: extract,
        create_subfolder: None,
        files: Vec::new(), // Single file download
        custom_headers: None,
    };
    
    start_download(config, &state, app_handle)
        .await
        .map_err(|e| format!("Failed to start download: {}", e))
}

#[tauri::command]
async fn get_llamacpp_releases() -> Result<Vec<LlamaCppRelease>, String> {
    llamacpp_manager::fetch_llamacpp_releases()
        .await
        .map_err(|e| format!("Failed to fetch llama.cpp releases: {}", e))
}

#[tauri::command]
async fn get_llamacpp_commit_info(tag_name: String) -> Result<llamacpp_manager::CommitInfo, String> {
    llamacpp_manager::fetch_commit_info(&tag_name)
        .await
        .map_err(|e| format!("Failed to fetch commit info: {}", e))
}

#[tauri::command]
async fn download_llamacpp_asset(
    asset: LlamaCppAsset,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<DownloadStartResult, String> {
    use crate::downloader::{DownloadConfig, start_download};
    
    // Get executable folder from config
    let executable_folder = {
        let config = state.config.lock().await;
        config.executable_folder.clone()
    };
    
    // Create download configuration
    let config = DownloadConfig {
        base_url: asset.download_url,
        destination_folder: executable_folder,
        auto_extract: true, // Llama.cpp assets are usually zips
        create_subfolder: None,
        files: Vec::new(), // Single file download
        custom_headers: Some({
            let mut headers = std::collections::HashMap::new();
            headers.insert("User-Agent".to_string(), "Arandu-Tauri/1.0".to_string());
            headers
        }),
    };
    
    start_download(config, &state, app_handle)
        .await
        .map_err(|e| format!("Failed to download llama.cpp asset: {}", e))
}

#[tauri::command]
async fn download_llamacpp_asset_to_version(
    asset: LlamaCppAsset,
    version_folder: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<DownloadStartResult, String> {
    use crate::downloader::{DownloadConfig, start_download};

    // Base executable folder from config
    let base_exec = {
        let config = state.config.lock().await;
        config.executable_folder.clone()
    };

    // Destination: <exec>/versions/<version_folder>
    let destination_folder = std::path::Path::new(&base_exec)
        .join("versions")
        .join(&version_folder)
        .to_string_lossy()
        .to_string();

    // Create download configuration
    let config = DownloadConfig {
        base_url: asset.download_url,
        destination_folder,
        auto_extract: true,
        create_subfolder: None,
        files: Vec::new(),
        custom_headers: Some({
            let mut headers = std::collections::HashMap::new();
            headers.insert("User-Agent".to_string(), "Arandu-Tauri/1.0".to_string());
            headers
        }),
    };

    start_download(config, &state, app_handle)
        .await
        .map_err(|e| format!("Failed to download llama.cpp asset: {}", e))
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct LlamaCppInstalledVersion {
    name: String,
    path: String,
    has_server: bool,
    created: Option<i64>,
    is_active: bool,
    backend_type: Option<String>,
}

#[tauri::command]
async fn list_llamacpp_versions(state: tauri::State<'_, AppState>) -> Result<Vec<LlamaCppInstalledVersion>, String> {
    use std::fs;
    use std::time::SystemTime;

    let (base_exec, active_path, active_version) = {
        let cfg = state.config.lock().await;
        (
            cfg.executable_folder.clone(),
            cfg.active_executable_folder.clone(),
            cfg.active_executable_version.clone(),
        )
    };
    let versions_dir = std::path::Path::new(&base_exec).join("versions");
    let mut out = Vec::new();
    
    if versions_dir.exists() {
        if let Ok(read_dir) = fs::read_dir(&versions_dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let version_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    
                    // Check if this is a nested structure (version/backend) or old flat structure
                    if let Ok(backend_dir) = fs::read_dir(&path) {
                        for backend_entry in backend_dir.flatten() {
                            let backend_path = backend_entry.path();
                            if backend_path.is_dir() {
                                let backend_name = backend_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                                let server_name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
                                let has_server = backend_path.join(server_name).exists();
                                let created = backend_entry.metadata().ok()
                                    .and_then(|m| m.created().ok())
                                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs() as i64);
                                let path_string = backend_path.to_string_lossy().to_string();
                                let backend_type = backend_name.clone();
                                
                                // Determine active by comparing full path
                                let is_active = if let Some(active_path) = &active_path {
                                    #[cfg(windows)]
                                    {
                                        let a = active_path.replace('\\', "/").trim_end_matches('/').to_lowercase();
                                        let b = path_string.replace('\\', "/").trim_end_matches('/').to_lowercase();
                                        a == b
                                    }
                                    #[cfg(not(windows))]
                                    {
                                        let a = active_path.trim_end_matches('/');
                                        let b = path_string.trim_end_matches('/');
                                        a == b
                                    }
                                } else { false };
                                
                                out.push(LlamaCppInstalledVersion { 
                                    name: format!("{}-{}", version_name, backend_name), 
                                    path: path_string, 
                                    has_server, 
                                    created, 
                                    is_active,
                                    backend_type: Some(backend_type),
                                });
                            }
                        }
                    }
                    
                    // Also check for old flat structure (backward compatibility)
                    let server_name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
                    if path.join(server_name).exists() {
                        let created = entry.metadata().ok()
                            .and_then(|m| m.created().ok())
                            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64);
                        let path_string = path.to_string_lossy().to_string();
                        let backend_type = detect_backend_type(&version_name);
                        
                        let is_active = if let Some(active_version) = &active_version {
                            active_version == &version_name
                        } else if let Some(active_path) = &active_path {
                            #[cfg(windows)]
                            {
                                let a = active_path.replace('\\', "/").trim_end_matches('/').to_lowercase();
                                let b = path_string.replace('\\', "/").trim_end_matches('/').to_lowercase();
                                a == b
                            }
                            #[cfg(not(windows))]
                            {
                                let a = active_path.trim_end_matches('/');
                                let b = path_string.trim_end_matches('/');
                                a == b
                            }
                        } else { false };
                        
                        out.push(LlamaCppInstalledVersion { 
                            name: version_name, 
                            path: path_string, 
                            has_server: true, 
                            created, 
                            is_active,
                            backend_type: Some(backend_type),
                        });
                    }
                }
            }
        }
    }
    
    // If there is exactly one installed version and none is active, set it active automatically
    let has_active = out.iter().any(|v| v.is_active);
    if out.len() == 1 && !has_active {
        if let Some(only) = out.get(0) {
            // Update config with this single version as active
            {
                let mut cfg = state.config.lock().await;
                cfg.active_executable_folder = Some(only.path.clone());
                cfg.active_executable_version = Some(only.name.clone());
            }
            // Best-effort save; if it fails, we still return the list
            if let Err(e) = save_settings(&state).await {
                eprintln!("Failed to save settings after auto-activating version: {}", e);
            }
            // Reflect activation in the returned list
            if let Some(first) = out.get_mut(0) {
                first.is_active = true;
            }
        }
    }
    Ok(out)
}

#[tauri::command]
async fn set_active_llamacpp_version(path: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    {
        let mut cfg = state.config.lock().await;
        // Save both path and derived version name
        let version_name = std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());
        cfg.active_executable_folder = Some(path);
        cfg.active_executable_version = version_name;
    }
    save_settings(&state).await.map_err(|e| format!("Failed to save settings: {}", e))
}

#[tauri::command]
async fn delete_llamacpp_version(path: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let base_exec = {
        let cfg = state.config.lock().await;
        cfg.executable_folder.clone()
    };

    let versions_root = Path::new(&base_exec).join("versions");
    let path_buf = Path::new(&path).to_path_buf();
    
    // Ensure deletion target is under versions root
    if !path_buf.starts_with(&versions_root) {
        return Err("Cannot delete outside versions directory".into());
    }
    
    if path_buf.exists() {
        fs::remove_dir_all(&path_buf).map_err(|e| format!("Failed to delete version: {}", e))?;
        
        // If we deleted a backend folder, check if the parent version folder is now empty
        if let Some(parent) = path_buf.parent() {
            if parent != versions_root && parent.exists() {
                if let Ok(entries) = fs::read_dir(parent) {
                    if entries.count() == 0 {
                        // Parent version folder is empty, remove it too
                        let _ = fs::remove_dir(parent);
                    }
                }
            }
        }
    }
    
    // Clear active if it pointed here
    {
        let mut cfg = state.config.lock().await;
        if cfg.active_executable_folder.as_deref() == Some(&path) {
            cfg.active_executable_folder = None;
            cfg.active_executable_version = None;
        }
    }
    save_settings(&state).await.map_err(|e| format!("Failed to save settings: {}", e))
}

// Initialize and load settings
async fn initialize_app_state() -> Result<AppState, Box<dyn std::error::Error>> {
    let state = AppState::new();
    load_settings(&state).await?;

    // Create models and executable directories if they don't exist
    {
        let config = state.config.lock().await;
        let models_dir = &config.models_directory;
        let exec_dir = &config.executable_folder;

        if !models_dir.is_empty() {
            if let Err(e) = std::fs::create_dir_all(models_dir) {
                eprintln!("Failed to create models directory: {}", e);
            }
        }

        if !exec_dir.is_empty() {
            if let Err(e) = std::fs::create_dir_all(exec_dir) {
                eprintln!("Failed to create executable directory: {}", e);
            }
            // also create versions directory
            let versions_dir = std::path::Path::new(exec_dir).join("versions");
            if let Err(e) = std::fs::create_dir_all(&versions_dir) {
                eprintln!("Failed to create versions directory: {}", e);
            }
        }
    }
    
    // Cleanup leftover download files from previous sessions
    {
        let config = state.config.lock().await;
        if !config.models_directory.is_empty() {
            if let Err(e) = huggingface::cleanup_leftover_downloads(&config.models_directory).await {
                eprintln!("Warning: Failed to cleanup leftover downloads: {}", e);
            }
        }
    }
    
    Ok(state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize app state
            let rt = tokio::runtime::Runtime::new().unwrap();
            let state = rt.block_on(initialize_app_state())
                .map_err(|e| format!("Failed to initialize app state: {}", e))?;
            
            println!("Application started, process tracking enabled with kill_on_drop");
            
            // Handle main window close event specifically
            if let Some(main_window) = app.get_webview_window("main") {
                let version = env!("CARGO_PKG_VERSION");
                let title = format!("Arandu v{}", version);
                main_window.set_title(&title).ok();
                
                let state_for_main_window = state.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        println!("Main window close button clicked, preventing default and cleaning up...");
                        
                        // Prevent the window from closing immediately
                        api.prevent_close();
                        
                        // Check for instant exit environment variable
                        if std::env::var("LLAMA_OS_INSTANT_EXIT").is_ok() {
                            println!("Instant exit enabled, skipping cleanup...");
                            std::process::exit(0);
                        }
                        
                        println!("Main window close button clicked, performing fast cleanup...");
                        state_for_main_window.force_cleanup_all_processes();
                        println!("Fast cleanup completed, exiting...");
                        std::process::exit(0);
                    }
                });
            }
            
            // For other windows (like terminals), just let them close normally without global cleanup
            // This is handled by the default behavior - no special handling needed
            
            // Fallback cleanup on app before exit
            let state_for_exit = state.clone();
            app.listen("tauri://before-exit", move |_| {
                println!("Before exit event received");
                let state_clone = state_for_exit.clone();
                tokio::spawn(async move {
                    println!("Application before exit, emergency cleanup...");
                    state_clone.cleanup_all_processes().await;
                });
            });
            
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            scan_models_command,
            get_model_settings,
            update_model_settings,
            get_model_presets,
            save_model_preset,
            update_model_presets,
            delete_model_preset,
            set_default_preset,
            launch_model_with_preset,
            launch_model,
            launch_model_external,
            launch_model_with_preset_external,
            delete_model_file,
            delete_model,
            kill_process,
            get_process_output,
            browse_folder,
            open_url,
            open_model_folder,
            search_huggingface,
            get_model_details,
            download_model,
            get_download_status,
            get_all_downloads,
            get_all_downloads_and_history,
            cancel_download,
            pause_download,
            resume_download,
            clear_download_history,
            download_from_url,
            get_llamacpp_releases,
            get_llamacpp_commit_info,
            download_llamacpp_asset,
            download_llamacpp_asset_to_version,
            list_llamacpp_versions,
            set_active_llamacpp_version,
            delete_llamacpp_version,
            get_session_state,
            save_window_state,
            remove_window_state,
            restart_application,
            graceful_exit,
            get_app_version,
            check_file_exists,
            get_system_stats,
            scan_mmproj_files_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
