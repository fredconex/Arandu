use crate::AppState;
use crate::models::DownloadStartResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    cancellation_tokens: HashMap<String, Arc<std::sync::atomic::AtomicBool>>,
    pause_flags: HashMap<String, Arc<std::sync::atomic::AtomicBool>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            downloads: HashMap::new(),
            download_history: Vec::new(),
            cancellation_tokens: HashMap::new(),
            pause_flags: HashMap::new(),
        }
    }

    pub fn add_download(&mut self, id: String, status: DownloadStatus) {
        self.downloads.insert(id.clone(), status);
        self.cancellation_tokens.insert(id.clone(), Arc::new(std::sync::atomic::AtomicBool::new(false)));
        self.pause_flags.insert(id, Arc::new(std::sync::atomic::AtomicBool::new(false)));
    }

    pub fn get_control_flags(&self, id: &str) -> (Arc<std::sync::atomic::AtomicBool>, Arc<std::sync::atomic::AtomicBool>) {
        let cancel = self.cancellation_tokens.get(id).cloned().unwrap_or_else(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));
        let pause = self.pause_flags.get(id).cloned().unwrap_or_else(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));
        (cancel, pause)
    }

    pub fn get_status(&self, id: &str) -> Option<&DownloadStatus> {
        self.downloads.get(id)
    }

    pub fn pause_download(&mut self, id: &str) -> Result<(), String> {
        if let Some(status) = self.downloads.get_mut(id) {
            if matches!(status.status, DownloadState::Downloading | DownloadState::Starting) {
                status.status = DownloadState::Paused;
                status.speed = 0.0;
                status.pause_start_time = Some(chrono::Utc::now());
                if let Some(flag) = self.pause_flags.get(id) {
                    flag.store(true, std::sync::atomic::Ordering::Relaxed);
                }
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
                if let Some(flag) = self.pause_flags.get(id) {
                    flag.store(false, std::sync::atomic::Ordering::Relaxed);
                }
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
            status.speed = 0.0;
            if let Some(flag) = self.cancellation_tokens.get(id) {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
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

// Struct to hold remote file probing information
struct RemoteFileInfo {
    total_size: u64,
    supports_ranges: bool,
}

async fn probe_remote_file(
    client: &reqwest::Client,
    url: &str,
    base_headers: &reqwest::header::HeaderMap,
) -> Option<RemoteFileInfo> {
    // Try HEAD request first
    if let Ok(resp) = client.head(url).headers(base_headers.clone()).send().await {
        if resp.status().is_success() {
            let accepts_ranges = resp
                .headers()
                .get(reqwest::header::ACCEPT_RANGES)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_lowercase().contains("bytes"))
                .unwrap_or(false);
            if let Some(len) = resp.content_length() {
                if len > 0 {
                    return Some(RemoteFileInfo {
                        total_size: len,
                        supports_ranges: accepts_ranges,
                    });
                }
            }
        }
    }

    // If HEAD failed or had no length, probe with a tiny range request (Range: bytes=0-0)
    let mut range_headers = base_headers.clone();
    range_headers.insert(
        reqwest::header::RANGE,
        reqwest::header::HeaderValue::from_static("bytes=0-0"),
    );
    if let Ok(resp) = client.get(url).headers(range_headers).send().await {
        if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            if let Some(cr) = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(total_str) = cr.split('/').last() {
                    if let Ok(total) = total_str.trim().parse::<u64>() {
                        return Some(RemoteFileInfo {
                            total_size: total,
                            supports_ranges: true,
                        });
                    }
                }
            }
        } else if resp.status().is_success() {
            if let Some(len) = resp.content_length() {
                return Some(RemoteFileInfo {
                    total_size: len,
                    supports_ranges: false,
                });
            }
        }
    }

    None
}

async fn stitch_parts(
    part_paths: &[std::path::PathBuf],
    output_path: &Path,
) -> Result<(), String> {
    use tokio::fs::File;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut out_file = File::create(output_path)
        .await
        .map_err(|e| format!("Failed to create output file for stitching: {}", e))?;

    let mut buffer = vec![0u8; 8 * 1024 * 1024]; // 8MB buffer for rapid disk stitching
    for part_path in part_paths {
        let mut in_file = File::open(part_path)
            .await
            .map_err(|e| format!("Failed to open part file {:?}: {}", part_path, e))?;

        loop {
            let bytes_read = in_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Error reading from {:?}: {}", part_path, e))?;
            if bytes_read == 0 {
                break;
            }
            out_file
                .write_all(&buffer[..bytes_read])
                .await
                .map_err(|e| format!("Error writing during stitching: {}", e))?;
        }
    }
    out_file
        .flush()
        .await
        .map_err(|e| format!("Failed to flush stitched file: {}", e))?;

    // Cleanup temporary part files
    for part_path in part_paths {
        let _ = tokio::fs::remove_file(part_path).await;
    }

    Ok(())
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
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    let client = reqwest::Client::builder()
        .tcp_nodelay(true)
        .http1_only() // force separate connections per chunk instead of h2 multiplexing
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    for (file_index, file_path) in files.iter().enumerate() {
        // Check if download was cancelled before starting each file
        if check_cancellation_status(&download_id, state).await? {
            return Err("Download cancelled by user".to_string());
        }

        // Wait if paused
        wait_if_paused(&download_id, state).await?;

        // Construct download URL
        let download_url = if files.len() == 1 && config.files.is_empty() {
            config.base_url.clone()
        } else {
            format!("{}/{}", config.base_url.trim_end_matches('/'), file_path.trim_start_matches('/'))
        };

        // Update current file and source URL
        {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                status.current_file = file_path.clone();
                status.source_url = download_url.clone();
                status.status = DownloadState::Downloading;
            }
        }

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

        // Build base headers
        let mut base_headers = HeaderMap::new();
        base_headers.insert(ACCEPT, HeaderValue::from_static("*/*"));

        if let Some(custom) = &config.custom_headers {
            for (key, value) in custom {
                match (
                    HeaderName::try_from(key.as_str()),
                    HeaderValue::from_str(value),
                ) {
                    (Ok(name), Ok(val)) => {
                        base_headers.insert(name, val);
                    }
                    (Err(e), _) => eprintln!("Failed to parse header name '{}': {}", key, e),
                    (_, Err(e)) => eprintln!("Failed to parse header value for '{}': {}", key, e),
                }
            }
        } else {
            base_headers.insert(
                USER_AGENT,
                HeaderValue::from_static("Universal-Downloader/1.0"),
            );
        }

        // Probe remote file to check size & range support
        let remote_info = probe_remote_file(&client, &download_url, &base_headers).await;
        let total_size = remote_info.as_ref().map(|info| info.total_size).unwrap_or(0);
        let supports_ranges = remote_info.as_ref().map(|info| info.supports_ranges).unwrap_or(false);

        // Update total bytes in state if known
        if total_size > 0 {
            let mut download_manager = state.download_manager.lock().await;
            if let Some(s) = download_manager.downloads.get_mut(&download_id) {
                s.total_bytes = total_size;
            }
        }

        // Parallel chunk downloads threshold: >= 10MB and server supports ranges
        const MIN_PARALLEL_SIZE: u64 = 10 * 1024 * 1024;
        const NUM_CHUNKS: usize = 8;

        let (cancel_flag, pause_flag) = {
            let dm = state.download_manager.lock().await;
            dm.get_control_flags(&download_id)
        };

        if supports_ranges && total_size >= MIN_PARALLEL_SIZE {
            println!(
                "Starting 8-way parallel download for {} ({} MB)",
                file_name,
                total_size / (1024 * 1024)
            );

            let chunk_size = total_size / NUM_CHUNKS as u64;
            let mut chunk_ranges = Vec::new();
            let mut part_paths = Vec::new();
            let mut initial_downloaded = 0u64;

            for i in 0..NUM_CHUNKS {
                let start = i as u64 * chunk_size;
                let end = if i == NUM_CHUNKS - 1 {
                    total_size - 1
                } else {
                    (i as u64 + 1) * chunk_size - 1
                };
                let part_path = Path::new(&destination_folder)
                    .join(format!("{}.download.part{}", file_name, i));

                // Check for existing partial chunk bytes
                let existing_len = if part_path.exists() {
                    tokio::fs::metadata(&part_path).await.map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };
                let expected_chunk_len = end - start + 1;
                let valid_existing_len = if existing_len <= expected_chunk_len {
                    existing_len
                } else {
                    let _ = tokio::fs::remove_file(&part_path).await;
                    0
                };

                initial_downloaded += valid_existing_len;
                chunk_ranges.push((start, end, valid_existing_len));
                part_paths.push(part_path);
            }

            let downloaded_atomic = Arc::new(AtomicU64::new(initial_downloaded));
            let is_completed = Arc::new(AtomicBool::new(false));
            let start_time = std::time::Instant::now();

            // Spawn progress emitter task
            let progress_download_id = download_id.clone();
            let progress_atomic = downloaded_atomic.clone();
            let progress_completed = is_completed.clone();
            let progress_app_handle = app_handle.clone();
            let progress_state_dm = state.download_manager.clone();
            let progress_pause_flag = pause_flag.clone();
            let progress_cancel_flag = cancel_flag.clone();
            let total_files_count = files.len();

            let progress_handle = tokio::spawn(async move {
                let mut last_progress = 0u8;
                while !progress_completed.load(Ordering::Relaxed) {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    if progress_completed.load(Ordering::Relaxed) {
                        break;
                    }

                    let cur_downloaded = progress_atomic.load(Ordering::Relaxed);
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let is_paused = progress_pause_flag.load(Ordering::Relaxed);
                    let is_cancelled = progress_cancel_flag.load(Ordering::Relaxed);
                    let speed = if is_paused || is_cancelled {
                        0.0
                    } else if elapsed > 0.0 {
                        (cur_downloaded.saturating_sub(initial_downloaded)) as f64 / elapsed
                    } else {
                        0.0
                    };

                    let file_progress = if total_size > 0 {
                        (cur_downloaded as f32 / total_size as f32) * 100.0
                    } else {
                        0.0
                    };
                    let overall_progress = ((file_index as f32 + file_progress / 100.0) / total_files_count as f32) * 100.0;
                    let cur_progress = overall_progress as u8;

                    {
                        let mut dm = progress_state_dm.lock().await;
                        if let Some(s) = dm.downloads.get_mut(&progress_download_id) {
                            s.downloaded_bytes = cur_downloaded;
                            s.speed = speed;
                            let current_elapsed = chrono::Utc::now()
                                .signed_duration_since(s.start_time)
                                .num_seconds();
                            s.elapsed_time = current_elapsed - s.total_paused_time;
                            s.progress = cur_progress;

                            if cur_progress.abs_diff(last_progress) >= 1 || elapsed > 1.0 || is_paused {
                                last_progress = cur_progress;
                                let _ = progress_app_handle.emit("download-progress", s.clone());
                            }
                        }
                    }
                }
            });

            // Spawn concurrent chunk workers
            let mut chunk_futures = Vec::new();
            for (chunk_idx, (start, end, existing_len)) in chunk_ranges.into_iter().enumerate() {
                let client_clone = client.clone();
                let url_clone = download_url.clone();
                let part_path = part_paths[chunk_idx].clone();
                let base_headers_clone = base_headers.clone();
                let downloaded_counter = downloaded_atomic.clone();
                let expected_chunk_len = end - start + 1;
                let chunk_cancel_flag = cancel_flag.clone();
                let chunk_pause_flag = pause_flag.clone();

                chunk_futures.push(tokio::spawn(async move {
                    if existing_len >= expected_chunk_len {
                        return Ok(());
                    }

                    const MAX_RETRIES: u32 = 5;
                    let mut chunk_downloaded = existing_len;

                    for attempt in 1..=MAX_RETRIES {
                        if chunk_cancel_flag.load(Ordering::Relaxed) {
                            return Err("Download cancelled by user".to_string());
                        }
                        while chunk_pause_flag.load(Ordering::Relaxed) {
                            if chunk_cancel_flag.load(Ordering::Relaxed) {
                                return Err("Download cancelled by user".to_string());
                            }
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        }

                        let range_start = start + chunk_downloaded;
                        let mut headers_map = base_headers_clone.clone();
                        if let Ok(range_val) = HeaderValue::from_str(&format!("bytes={}-{}", range_start, end)) {
                            headers_map.insert(reqwest::header::RANGE, range_val);
                        }

                        let resp = match client_clone.get(&url_clone).headers(headers_map).send().await {
                            Ok(r) => r,
                            Err(e) => {
                                if attempt >= MAX_RETRIES {
                                    return Err(format!("Chunk {} failed after {} attempts: {}", chunk_idx, MAX_RETRIES, e));
                                }
                                tokio::time::sleep(tokio::time::Duration::from_secs(attempt as u64)).await;
                                continue;
                            }
                        };

                        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                            if attempt >= MAX_RETRIES {
                                return Err(format!("Chunk {} received HTTP {}", chunk_idx, resp.status()));
                            }
                            tokio::time::sleep(tokio::time::Duration::from_secs(attempt as u64)).await;
                            continue;
                        }

                        use tokio::fs::OpenOptions;
                        let mut part_file = match OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&part_path)
                            .await
                        {
                            Ok(f) => f,
                            Err(e) => return Err(format!("Failed to open part file: {}", e)),
                        };

                        let mut stream = resp.bytes_stream();
                        let mut stream_err = None;

                        while let Some(chunk_res) = stream.next().await {
                            if chunk_cancel_flag.load(Ordering::Relaxed) {
                                return Err("Download cancelled by user".to_string());
                            }
                            while chunk_pause_flag.load(Ordering::Relaxed) {
                                if chunk_cancel_flag.load(Ordering::Relaxed) {
                                    return Err("Download cancelled by user".to_string());
                                }
                                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            }

                            match chunk_res {
                                Ok(data) => {
                                    if let Err(e) = part_file.write_all(&data).await {
                                        stream_err = Some(e.to_string());
                                        break;
                                    }
                                    let len = data.len() as u64;
                                    chunk_downloaded += len;
                                    downloaded_counter.fetch_add(len, Ordering::Relaxed);
                                }
                                Err(e) => {
                                    stream_err = Some(e.to_string());
                                    break;
                                }
                            }
                        }

                        let _ = part_file.flush().await;

                        if stream_err.is_none() && chunk_downloaded >= expected_chunk_len {
                            return Ok(());
                        }

                        if attempt >= MAX_RETRIES {
                            return Err(format!(
                                "Chunk {} stream failed after {} retries: {:?}",
                                chunk_idx, MAX_RETRIES, stream_err
                            ));
                        }
                        tokio::time::sleep(tokio::time::Duration::from_secs(attempt as u64)).await;
                    }

                    Ok(())
                }));
            }

            // Await all chunk downloads
            let results = futures_util::future::join_all(chunk_futures).await;
            is_completed.store(true, Ordering::Relaxed);
            let _ = progress_handle.await;

            // Check if any chunk failed
            for res in results {
                match res {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => return Err(e),
                    Err(join_err) => return Err(format!("Chunk task panicked: {}", join_err)),
                }
            }

            // Stitch all chunks together
            println!("All chunks downloaded successfully. Stitching {}...", file_name);
            stitch_parts(&part_paths, &temp_path).await?;
        } else {
            // Fallback: Robust Single-Stream Downloader
            println!("Using single-stream download for {}", file_name);
            const MAX_RETRIES: u32 = 5;
            let mut attempt = 0u32;
            let start_time = std::time::Instant::now();
            let mut downloaded;

            loop {
                attempt += 1;

                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err("Download cancelled by user".to_string());
                }
                while pause_flag.load(Ordering::Relaxed) {
                    if cancel_flag.load(Ordering::Relaxed) {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Err("Download cancelled by user".to_string());
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                }

                let resume_from = if temp_path.exists() {
                    tokio::fs::metadata(&temp_path).await.map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };

                let mut headers_map = base_headers.clone();
                if resume_from > 0 {
                    if let Ok(range_val) = HeaderValue::from_str(&format!("bytes={}-", resume_from)) {
                        headers_map.insert(reqwest::header::RANGE, range_val);
                    }
                }

                let response = match client.get(&download_url).headers(headers_map).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        if attempt >= MAX_RETRIES {
                            return Err(format!("Failed to connect after {} attempts: {}", MAX_RETRIES, e));
                        }
                        tokio::time::sleep(tokio::time::Duration::from_secs((attempt * 2) as u64)).await;
                        continue;
                    }
                };

                let status_code = response.status();
                if !status_code.is_success() && status_code != reqwest::StatusCode::PARTIAL_CONTENT {
                    if attempt >= MAX_RETRIES {
                        return Err(format!("Failed to download {}: {}", file_path, status_code));
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs((attempt * 2) as u64)).await;
                    continue;
                }

                let server_resumed = status_code == reqwest::StatusCode::PARTIAL_CONTENT;
                if resume_from > 0 && !server_resumed {
                    downloaded = 0;
                    let _ = tokio::fs::remove_file(&temp_path).await;
                } else {
                    downloaded = resume_from;
                }

                let mut file = if server_resumed && resume_from > 0 {
                    use tokio::fs::OpenOptions;
                    OpenOptions::new().append(true).open(&temp_path).await
                        .map_err(|e| e.to_string())?
                } else {
                    File::create(&temp_path).await
                        .map_err(|e| e.to_string())?
                };

                let mut stream = response.bytes_stream();
                let mut stream_error: Option<String> = None;
                let mut last_emit = std::time::Instant::now();

                while let Some(chunk) = stream.next().await {
                    if cancel_flag.load(Ordering::Relaxed) {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Err("Download cancelled by user".to_string());
                    }
                    while pause_flag.load(Ordering::Relaxed) {
                        if cancel_flag.load(Ordering::Relaxed) {
                            let _ = tokio::fs::remove_file(&temp_path).await;
                            return Err("Download cancelled by user".to_string());
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    }

                    match chunk {
                        Err(e) => {
                            stream_error = Some(e.to_string());
                            break;
                        }
                        Ok(data) => {
                            if let Err(e) = file.write_all(&data).await {
                                stream_error = Some(e.to_string());
                                break;
                            }
                            downloaded += data.len() as u64;

                            let elapsed = start_time.elapsed().as_secs_f64();
                            let is_paused = pause_flag.load(Ordering::Relaxed);
                            let speed = if is_paused { 0.0 } else if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };

                            if last_emit.elapsed().as_millis() >= 300 {
                                last_emit = std::time::Instant::now();
                                let mut download_manager = state.download_manager.lock().await;
                                if let Some(s) = download_manager.downloads.get_mut(&download_id) {
                                    s.downloaded_bytes = downloaded;
                                    s.speed = speed;
                                    let current_elapsed = chrono::Utc::now().signed_duration_since(s.start_time).num_seconds();
                                    s.elapsed_time = current_elapsed - s.total_paused_time;

                                    if total_size > 0 {
                                        let file_progress = (downloaded as f32 / total_size as f32) * 100.0;
                                        let overall_progress = ((file_index as f32 + file_progress / 100.0) / files.len() as f32) * 100.0;
                                        s.progress = overall_progress as u8;
                                    }
                                    let _ = app_handle.emit("download-progress", s.clone());
                                }
                            }
                        }
                    }
                }

                let _ = file.flush().await;

                if let Some(err_msg) = stream_error {
                    if attempt >= MAX_RETRIES {
                        return Err(format!("Download failed after {} attempts: {}", MAX_RETRIES, err_msg));
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs((attempt * 2) as u64)).await;
                    continue;
                }

                break;
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
        // Extract if requested and file is a zip
        if config.auto_extract && file_name.to_lowercase().ends_with(".zip") {
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
            
            if let Err(e) = extract_zip(&final_path, &destination_folder, &download_id, &app_handle).await {
                // Don't fail the download, just log the extraction error
                let mut download_manager = state.download_manager.lock().await;
                if let Some(status) = download_manager.downloads.get_mut(&download_id) {
                    status.message = Some(format!("Downloaded but extraction failed: {}", e));
                }
            } else {
                // Remove the zip file after successful extraction
                if let Err(e) = tokio::fs::remove_file(&final_path).await {
                    eprintln!("Warning: Failed to remove zip file after extraction: {}", e);
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