use crate::AppState;
use crate::models::DownloadStartResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use std::path::Path;
use tauri::{Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DownloadState {
    Starting,
    Downloading,
    Paused,
    Extracting,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadConfig {
    pub base_url: String,
    pub destination_folder: String,
    pub auto_extract: bool,
    pub create_subfolder: Option<String>,
    pub files: Vec<String>, // List of files to download (for multi-file downloads)
    pub custom_headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadStatus {
    pub id: String,
    pub status: DownloadState,
    pub source_url: String,
    pub destination: String,
    pub files: Vec<String>,
    pub total_files: usize,
    pub files_completed: usize,
    pub current_file: String,
    pub progress: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed: f64,
    pub start_time: DateTime<Utc>,
    pub elapsed_time: i64,
    pub total_paused_time: i64,
    pub pause_start_time: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug)]
pub struct DownloadManager {
    pub downloads: HashMap<String, DownloadStatus>,
    pub download_history: Vec<DownloadStatus>,
    cancellation_tokens: HashMap<String, Arc<Mutex<bool>>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            downloads: HashMap::new(),
            download_history: Vec::new(),
            cancellation_tokens: HashMap::new(),
        }
    }

    pub fn add_download(&mut self, id: String, status: DownloadStatus) {
        self.downloads.insert(id.clone(), status);
        self.cancellation_tokens.insert(id, Arc::new(Mutex::new(false)));
    }

    pub fn get_status(&self, id: &str) -> Option<&DownloadStatus> {
        self.downloads.get(id)
    }

    pub fn pause_download(&mut self, id: &str) -> Result<(), String> {
        if let Some(status) = self.downloads.get_mut(id) {
            if matches!(status.status, DownloadState::Downloading) {
                status.status = DownloadState::Paused;
                status.pause_start_time = Some(chrono::Utc::now());
                Ok(())
            } else {
                Err("Download is not in a state that can be paused".to_string())
            }
        } else {
            Err("Download not found".to_string())
        }
    }

    pub fn resume_download(&mut self, id: &str) -> Result<(), String> {
        if let Some(status) = self.downloads.get_mut(id) {
            if matches!(status.status, DownloadState::Paused) {
                if let Some(pause_start) = status.pause_start_time {
                    let pause_duration = chrono::Utc::now().signed_duration_since(pause_start).num_seconds();
                    status.total_paused_time += pause_duration;
                    status.pause_start_time = None;
                }
                status.status = DownloadState::Downloading;
                Ok(())
            } else {
                Err("Download is not paused".to_string())
            }
        } else {
            Err("Download not found".to_string())
        }
    }

    pub fn cancel_download(&mut self, id: &str) -> Result<(), String> {
        if let Some(status) = self.downloads.get_mut(id) {
            status.status = DownloadState::Cancelled;
            if let Some(token) = self.cancellation_tokens.get(id) {
                let token = token.clone();
                tokio::spawn(async move {
                    let mut token_guard = token.lock().await;
                    *token_guard = true;
                });
            }
            Ok(())
        } else {
            Err("Download not found".to_string())
        }
    }

    pub fn clear_download_history(&mut self) {
        self.downloads.retain(|_, d|
            !matches!(d.status, DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled)
        );
        self.download_history.clear();
    }
}


// Universal download function
pub async fn start_download(
    config: DownloadConfig,
    state: &AppState,
    app_handle: tauri::AppHandle,
) -> Result<DownloadStartResult, Box<dyn std::error::Error>> {
    use tokio::fs;

    let download_id = generate_download_id(&config);

    // Create destination folder if it doesn't exist
    let final_destination = if let Some(subfolder) = &config.create_subfolder {
        let subfolder_path = Path::new(&config.destination_folder).join(subfolder);
        fs::create_dir_all(&subfolder_path).await?;
        subfolder_path.to_string_lossy().to_string()
    } else {
        fs::create_dir_all(&config.destination_folder).await?;
        config.destination_folder.clone()
    };

    // Determine files to download
    let files_to_download = if config.files.is_empty() {
        // Single file download - extract filename from URL
        let filename = extract_filename_from_url(&config.base_url)?;
        vec![filename]
    } else {
        config.files.clone()
    };

    // Add to download manager
    {
        let mut download_manager = state.download_manager.lock().await;
        let download_status = DownloadStatus {
            id: download_id.clone(),
            status: DownloadState::Starting,
            source_url: config.base_url.clone(),
            destination: final_destination.clone(),
            files: files_to_download.clone(),
            total_files: files_to_download.len(),
            files_completed: 0,
            current_file: String::new(),
            progress: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
            speed: 0.0,
            start_time: chrono::Utc::now(),
            elapsed_time: 0,
            total_paused_time: 0,
            pause_start_time: None,
            error: None,
            message: Some(format!("Starting download from {}", config.base_url)),
        };

        download_manager.add_download(download_id.clone(), download_status);
    }

    // Start the download task in the background
    let state_clone = state.clone();
    let download_id_for_task = download_id.clone();
    let config_clone = config.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        if let Err(e) = execute_download(
            download_id_for_task.clone(),
            config_clone,
            final_destination,
            files_to_download,
            &state_clone,
            app_handle,
        ).await {
            // Update download status to failed
            let mut download_manager = state_clone.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id_for_task) {
                status.status = DownloadState::Failed;
                status.error = Some(e.to_string());
            }
        }
    });

    // Emit an event to open the download manager window
    let _ = app_handle_clone.emit("open-download-manager", ());

    Ok(DownloadStartResult {
        download_id,
        message: format!("Download started from {}", config.base_url),
    })
}

async fn execute_download(
    download_id: String,
    config: DownloadConfig,
    destination_folder: String,
    files: Vec<String>,
    state: &AppState,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;
    use std::path::Path;
    use futures_util::StreamExt;
    use tauri::Emitter;
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, USER_AGENT};

    let client = reqwest::Client::new();
    let mut last_emit_time = std::time::Instant::now();
    let mut last_progress = 0u8;

    for (file_index, file_path) in files.iter().enumerate() {
        // Check if download was cancelled before starting each file
        if check_cancellation_status(&download_id, state).await? {
            return Err("Download cancelled by user".to_string());
        }

        // Wait if paused
        wait_if_paused(&download_id, state).await?;

        // Update current file
        {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                status.current_file = file_path.clone();
                status.status = DownloadState::Downloading;
            }
        }

        // Construct download URL
        let download_url = if files.len() == 1 && config.files.is_empty() {
            // Single file download from direct URL
            config.base_url.clone()
        } else {
            // Multi-file download or specific file from base URL
            format!("{}/{}", config.base_url.trim_end_matches('/'), file_path.trim_start_matches('/'))
        };

        let file_name = Path::new(file_path).file_name()
            .ok_or("Invalid file path")?
            .to_string_lossy()
            .to_string();
        let final_path = Path::new(&destination_folder).join(&file_name);
        let temp_path = Path::new(&destination_folder).join(format!("{}.download", file_name));

        // Check if final file already exists
        if final_path.exists() {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                status.files_completed = file_index + 1;
                status.progress = ((file_index + 1) as f32 / files.len() as f32 * 100.0) as u8;
            }
            continue;
        }

        // Create request with headers (avoid duplicate User-Agent)
        let mut headers_map = HeaderMap::new();
        // Always send a generic Accept to play nice with CDNs
        headers_map.insert(ACCEPT, HeaderValue::from_static("*/*"));

        if let Some(custom) = &config.custom_headers {
            for (key, value) in custom {
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_bytes(key.as_bytes()),
                    HeaderValue::from_str(value),
                ) {
                    headers_map.insert(name, val);
                }
            }
        } else {
            // Default UA only if caller didn't supply one
            headers_map.insert(
                USER_AGENT,
                HeaderValue::from_static("Universal-Downloader/1.0"),
            );
        }

        let request = client.get(&download_url).headers(headers_map);

        // Start downloading to temp file
        let response = request
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Failed to download {}: {}", file_path, response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);

        // Update total bytes
        {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                status.total_bytes = total_size;
            }
        }

        // Create the temp file
        let mut file = File::create(&temp_path).await
            .map_err(|e| e.to_string())?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        let start_time = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            // Check for cancellation during download
            if check_cancellation_status(&download_id, state).await? {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err("Download cancelled by user".to_string());
            }

            // Handle pause
            wait_if_paused(&download_id, state).await?;

            let chunk = chunk.map_err(|e| e.to_string())?;
            file.write_all(&chunk).await
                .map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;

            // Calculate speed and elapsed time
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };

            // Update progress
            {
                let mut download_manager = state.download_manager.lock().await;
                if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                    status.downloaded_bytes = downloaded;
                    status.speed = speed;
                    
                    // Calculate elapsed time considering pauses
                    let current_elapsed = chrono::Utc::now().signed_duration_since(status.start_time).num_seconds();
                    status.elapsed_time = current_elapsed - status.total_paused_time;
                    
                    if total_size > 0 {
                        let file_progress = (downloaded as f32 / total_size as f32) * 100.0;
                        let overall_progress = ((file_index as f32 + file_progress / 100.0) / files.len() as f32) * 100.0;
                        status.progress = overall_progress as u8;
                    }
                }
            }
            
            // Emit real-time progress update (throttled to every 500ms or 1% progress)
            let current_time = std::time::Instant::now();
            let time_since_last_emit = current_time.duration_since(last_emit_time).as_millis();
            let current_progress = if total_size > 0 {
                let file_progress = (downloaded as f32 / total_size as f32) * 100.0;
                let overall_progress = ((file_index as f32 + file_progress / 100.0) / files.len() as f32) * 100.0;
                overall_progress as u8
            } else {
                0
            };
            
            // Emit only if 500ms have passed or progress changed by at least 1%
            if time_since_last_emit >= 500 || current_progress.abs_diff(last_progress) >= 1 {
                last_emit_time = current_time;
                last_progress = current_progress;
                
                //println!("Emitting download progress event for {}: {}%", download_id, current_progress);
                
                // Emit directly without spawning a new task
                let download_manager = state.download_manager.lock().await;
                if let Some(status) = download_manager.downloads.get(&download_id) {
                    let _ = app_handle.emit("download-progress", status.clone());
                }
            }
        }

        
                // Move temp file to final location
                // First, try to remove the final path if it exists (in case of resumed download)
                if final_path.exists() {
                    if let Err(e) = tokio::fs::remove_file(&final_path).await {
                        return Err(format!("Failed to remove existing file before finalizing download: {}", e));
                    }
                }
                
                // Now rename the temp file to final location
                if let Err(e) = tokio::fs::rename(&temp_path, &final_path).await {
                    // If rename fails, try alternative approach using copy and remove
                    if let Err(copy_error) = tokio::fs::copy(&temp_path, &final_path).await {
                        // Attempt to clean up the temp file
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Err(format!("Failed to finalize file (both rename and copy failed): {}, copy error: {}", e, copy_error));
                    } else {
                        // Copy succeeded, now remove the temp file
                        if let Err(remove_error) = tokio::fs::remove_file(&temp_path).await {
                            // Log the error but continue - the file was copied successfully
                            eprintln!("Warning: Could not remove temp file after copying: {}", remove_error);
                        }
                    }
                }
        // Extract if requested and file is a zip or tar.gz
        let is_zip = config.auto_extract && file_name.to_lowercase().ends_with(".zip");
        let is_tar_gz = config.auto_extract && (file_name.to_lowercase().ends_with(".tar.gz") || file_name.to_lowercase().ends_with(".tgz"));
        
        if is_zip || is_tar_gz {
            // Update status to extracting
            {
                let mut download_manager = state.download_manager.lock().await;
                if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                    status.status = DownloadState::Extracting;
                    status.message = Some("Extracting downloaded file...".to_string());
                }
            }
            
            // Emit extraction start event
            //println!("Emitting extraction start event for {}", download_id);
            let download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get(&download_id) {
                let _ = app_handle.emit("download-progress", status.clone());
            }
            
            // Extract based on file type
            let extract_result = if is_tar_gz {
                extract_tar_gz(&final_path, &destination_folder, &download_id, &app_handle).await
            } else {
                extract_zip(&final_path, &destination_folder, &download_id, &app_handle).await
            };
            
            if let Err(e) = extract_result {
                // Don't fail the download, just log the extraction error
                let mut download_manager = state.download_manager.lock().await;
                if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                    status.message = Some(format!("Downloaded but extraction failed: {}", e));
                }
            } else {
                // Remove the archive file after successful extraction
                if let Err(e) = tokio::fs::remove_file(&final_path).await {
                    eprintln!("Warning: Failed to remove archive file after extraction: {}", e);
                }
            }
        }

        // Mark file as completed
        {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                status.files_completed = file_index + 1;
                status.progress = ((file_index + 1) as f32 / files.len() as f32 * 100.0) as u8;
            }
        }
    }

    // Mark download as completed
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(status) = download_manager.downloads.get_mut(&download_id) {
            status.status = DownloadState::Completed;
            status.progress = 100;
            status.message = Some(format!("Download completed from {}", config.base_url));
        }
    }

    // Emit event to frontend
    app_handle.emit("download-complete", ()).unwrap();

    Ok(())
}



// Helper functions
fn generate_download_id(config: &DownloadConfig) -> String {
    let filename = if config.files.is_empty() {
        extract_filename_from_url(&config.base_url)
            .unwrap_or_else(|_| "download".to_string())
    } else {
        config.files.first().unwrap_or(&"download".to_string()).clone()
    };

    format!("download_{}_{}",
        chrono::Utc::now().timestamp_millis(),
        sanitize_filename(&filename)
    )
}

fn sanitize_filename(filename: &str) -> String {
    filename.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

fn extract_filename_from_url(url: &str) -> Result<String, String> {
    use url::Url;
    
    let parsed_url = Url::parse(url).map_err(|e| e.to_string())?;
    let filename = parsed_url.path_segments()
        .and_then(|segments| segments.last())
        .filter(|s| !s.is_empty())
        .unwrap_or("download")
        .to_string();
    
    Ok(filename)
}

async fn check_cancellation_status(download_id: &str, state: &AppState) -> Result<bool, String> {
    let download_manager = state.download_manager.lock().await;
    if let Some(status) = download_manager.downloads.get(download_id) {
        Ok(matches!(status.status, DownloadState::Cancelled))
    } else {
        Err("Download not found".to_string())
    }
}

async fn wait_if_paused(download_id: &str, state: &AppState) -> Result<(), String> {
    loop {
        let download_manager = state.download_manager.lock().await;
        if let Some(status) = download_manager.downloads.get(download_id) {
            if matches!(status.status, DownloadState::Cancelled) {
                return Err("Download cancelled by user".to_string());
            }
            if matches!(status.status, DownloadState::Paused) {
                drop(download_manager); // Release the lock
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }
            break; // Not paused, continue with download
        } else {
            return Err("Download not found".to_string());
        }
    }
    Ok(())
}

async fn extract_zip(zip_path: &Path, destination: &str, download_id: &str, app_handle: &tauri::AppHandle) -> Result<(), String> {
    use std::fs::File;
    use std::io::BufReader;
    use zip::ZipArchive;

    let file = File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let total_files = archive.len();
    
    // Emit extraction start event with total file count
    let _ = app_handle.emit("extraction-progress", serde_json::json!({
        "download_id": download_id,
        "extraction_progress": 0,
        "extraction_total_files": total_files,
        "extraction_completed_files": 0,
        "current_extracting_file": "Starting extraction..."
    }));

    for i in 0..total_files {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let outpath = Path::new(destination).join(file.name());

        if file.name().ends_with('/') {
            // Directory
            std::fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            // File
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p).map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            // Ensure the destination file doesn't exist before extraction to avoid conflicts
            if outpath.exists() {
                std::fs::remove_file(&outpath).map_err(|e| format!("Failed to remove existing file before extraction: {}", e))?;
            }
            let mut outfile = File::create(&outpath).map_err(|e| format!("Failed to create output file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
        }

        // Calculate and emit progress
        let completed_files = i + 1;
        let progress = ((completed_files as f64 / total_files as f64) * 100.0) as u8;
        
        let _ = app_handle.emit("extraction-progress", serde_json::json!({
            "download_id": download_id,
            "extraction_progress": progress,
            "extraction_total_files": total_files,
            "extraction_completed_files": completed_files,
            "current_extracting_file": file.name()
        }));
    }

    Ok(())
}

/// Extract a tar.gz archive
async fn extract_tar_gz(
    tar_gz_path: &Path,
    destination: &str,
    download_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    use std::fs::File;
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = File::open(tar_gz_path).map_err(|e| format!("Failed to open tar.gz file: {}", e))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    
    // Get total number of entries
    let entries: Vec<_> = archive.entries()
        .map_err(|e| format!("Failed to read tar entries: {}", e))?
        .filter_map(|e| e.ok())
        .collect();
    let total_files = entries.len();
    
    // Re-create archive since we consumed the iterator
    let file = File::open(tar_gz_path).map_err(|e| format!("Failed to open tar.gz file: {}", e))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    
    let dest_path = Path::new(destination);
    let mut completed_files = 0usize;
    
    // Emit extraction start event with total file count
    let _ = app_handle.emit("extraction-progress", serde_json::json!({
        "download_id": download_id,
        "extraction_progress": 0,
        "extraction_total_files": total_files,
        "extraction_completed_files": 0,
        "current_extracting_file": "Starting extraction..."
    }));
    
    for entry in archive.entries().map_err(|e| format!("Failed to read tar entries: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {}", e))?;
        
        let entry_path = entry.path()
            .map_err(|e| format!("Failed to get entry path: {}", e))?
            .into_owned();
        
        // Only extract files (not directories) and skip common Llama.cpp binary names we want to keep
        let file_name = entry_path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        
        // Skip the top-level directory in the archive (usually it's the versioned folder name)
        let relative_path: std::path::PathBuf = if entry_path.components().count() > 1 {
            entry_path.components().skip(1).collect()
        } else {
            entry_path.clone()
        };
        
        let outpath = dest_path.join(&relative_path);
        
        // Create parent directories if needed
        if let Some(parent) = outpath.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
        }
        
        // Only extract binary files that are in bin/ or the root, skip test files and other non-essential files
        let is_binary = file_name.contains("llama") || file_name.contains("server") || file_name.contains("cli");
        let skip_patterns = ["test", "README", "LICENSE", ".txt", ".md", ".json", ".toml", ".cmake", "CMake"];
        let should_skip = skip_patterns.iter().any(|p| file_name.contains(p)) && !is_binary;
        
        // Handle symlinks
        #[cfg(unix)]
        if entry.header().entry_type().is_symlink() {
            let outpath = dest_path.join(&relative_path);
            // Get the symlink target from header
            if let Ok(Some(link_target_path)) = entry.header().link_name() {
                let link_target = link_target_path.to_string_lossy().to_string();
                // Remove existing file/symlink if present
                if outpath.exists() || outpath.is_symlink() {
                    let _ = std::fs::remove_file(&outpath);
                }
                let _ = std::os::unix::fs::symlink(&link_target, &outpath);
            }
        }
        #[cfg(windows)]
        if entry.header().entry_type().is_symlink() {
            // Windows symlinks require special handling - skip for now on Windows
            let outpath = dest_path.join(&relative_path);
            if let Ok(Some(link_target_path)) = entry.header().link_name() {
                let _link_target = link_target_path.to_string_lossy().to_string();
                // On Windows, try to create a file symlink or skip
                if outpath.exists() || outpath.is_symlink() {
                    let _ = std::fs::remove_file(&outpath);
                }
                // Try using std::os::windows::fs::symlink_metadata if target exists
                // For now, we'll skip symlink creation on Windows
            }
        } else if entry.header().entry_type().is_file() && !should_skip {
            // Ensure the destination file doesn't exist before extraction
            if outpath.exists() {
                std::fs::remove_file(&outpath)
                    .map_err(|e| format!("Failed to remove existing file: {}", e))?;
            }
            
            entry.unpack(&outpath)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
            
            // Make executable if it's a llama binary
            #[cfg(unix)]
            if is_binary {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(metadata) = std::fs::metadata(&outpath) {
                    let mut perms = metadata.permissions();
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&outpath, perms);
                }
            }
            
            // Create symlinks for shared libraries (e.g., libmtmd.so.0.0.8012 -> libmtmd.so.0)
            #[cfg(unix)]
            if file_name.ends_with(".so") && file_name.contains(".so.") {
                if let Some(dot_pos) = file_name.rfind(".so.") {
                    let base_name = &file_name[..dot_pos + 3]; // e.g., libmtmd.so.0
                    let symlink_path = dest_path.join(base_name);
                    if !symlink_path.exists() {
                        let _ = std::os::unix::fs::symlink(&outpath, &symlink_path);
                    }
                }
            }
        }
        
        completed_files += 1;
        let progress = ((completed_files as f64 / total_files as f64) * 100.0) as u8;
        
        let _ = app_handle.emit("extraction-progress", serde_json::json!({
            "download_id": download_id,
            "extraction_progress": progress,
            "extraction_total_files": total_files,
            "extraction_completed_files": completed_files,
            "current_extracting_file": file_name
        }));
    }

    Ok(())
}