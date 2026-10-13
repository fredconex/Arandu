use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
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

// One long-lived System: creating System::new_all() + refresh_all() per call enumerates every
// process on the machine and (on Windows) opens fresh PDH/handle resources each time.
static SYS: OnceLock<Mutex<System>> = OnceLock::new();

// Walking the whole models folder is expensive; refresh at most every 30s.
const MODELS_STATS_TTL: Duration = Duration::from_secs(30);
static LAST_STATS: Mutex<Option<SystemStats>> = Mutex::new(None);
static MODELS_CACHE: Mutex<Option<(Instant, String, f32, u32)>> = Mutex::new(None);

#[tauri::command]
pub async fn get_system_stats(
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<SystemStats, String> {
    // Backend guard: when the window is hidden to tray (or minimized) nobody is looking,
    // so return the last snapshot instead of hitting WMI/NVML/the disk again.
    {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            let hidden = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
            if hidden {
                if let Some(last) = LAST_STATS.lock().ok().and_then(|g| g.clone()) {
                    return Ok(last);
                }
            }
        }
    }

    let models_dir = {
        let config = state.config.lock().await;
        config.models_directory.clone()
    };

    // All of this is blocking work (sysinfo, GPU driver query, directory walk):
    // keep it off the async worker threads.
    tokio::task::spawn_blocking(move || {
        let (cpu_usage, total_mem, used_mem) = {
            let mut sys = SYS
                .get_or_init(|| Mutex::new(System::new()))
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (sys.global_cpu_usage(), sys.total_memory(), sys.used_memory())
        };

        let memory_total_gb = total_mem as f32 / (1024.0 * 1024.0 * 1024.0);
        let memory_used_gb = used_mem as f32 / (1024.0 * 1024.0 * 1024.0);

        let (gpu_name, gpu_usage, gpu_memory_total_gb, gpu_memory_used_gb) = get_gpu_info();
        let (models_folder_size_gb, models_count) = get_models_stats_cached(&models_dir);

        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        SystemStats {
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
        }
    })
    .await
    .map_err(|e| format!("System stats task failed: {}", e))
    .map(|stats| {
        if let Ok(mut last) = LAST_STATS.lock() {
            *last = Some(stats.clone());
        }
        stats
    })
}

fn get_models_stats_cached(models_dir: &str) -> (f32, u32) {
    if models_dir.is_empty() || !Path::new(models_dir).is_dir() {
        return (0.0, 0);
    }

    let mut cache = MODELS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((t, dir, size, count)) = cache.as_ref() {
        if dir == models_dir && t.elapsed() < MODELS_STATS_TTL {
            return (*size, *count);
        }
    }

    let (total_size, model_count) = calculate_directory_stats(models_dir);
    let size_gb = total_size as f32 / (1024.0 * 1024.0 * 1024.0);
    *cache = Some((Instant::now(), models_dir.to_string(), size_gb, model_count));
    (size_gb, model_count)
}

// ---- GPU monitoring -------------------------------------------------------------------
// gfxinfo::active_gpu() re-initializes NVML (or COM + a WMI query on Windows) on EVERY call.
// Doing that on each poll for hours churns native resources, and Windows has to unwind all of
// it when the process exits. Instead: create the GPU handle ONCE on a dedicated thread (the
// handle is !Send) and only ask it for fresh numbers on each poll.

struct GpuSnapshot {
    name: String,
    usage: f32,
    total_gb: f32,
    used_gb: f32,
}

impl GpuSnapshot {
    fn none() -> Self {
        Self { name: "No GPU detected".to_string(), usage: 0.0, total_gb: 0.0, used_gb: 0.0 }
    }
}

type GpuRequest = mpsc::Sender<GpuSnapshot>;
static GPU_WORKER: OnceLock<Mutex<mpsc::Sender<GpuRequest>>> = OnceLock::new();

fn gpu_worker() -> &'static Mutex<mpsc::Sender<GpuRequest>> {
    GPU_WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<GpuRequest>();
        std::thread::Builder::new()
            .name("gpu-monitor".into())
            .spawn(move || {
                let mut gpu = gfxinfo::active_gpu().ok();
                let mut last_attempt = Instant::now();

                for reply in rx {
                    // If detection failed at startup, retry at most once a minute
                    if gpu.is_none() && last_attempt.elapsed() > Duration::from_secs(60) {
                        gpu = gfxinfo::active_gpu().ok();
                        last_attempt = Instant::now();
                    }

                    let snap = match &gpu {
                        Some(g) => {
                            let vendor = g.vendor();
                            let model = g.model();
                            let name = if model.to_lowercase().contains(&vendor.to_lowercase()) {
                                model.to_string()
                            } else {
                                format!("{} {}", vendor, model)
                            };
                            let info = g.info();
                            GpuSnapshot {
                                name,
                                usage: info.load_pct() as f32,
                                total_gb: info.total_vram() as f32 / (1024.0 * 1024.0 * 1024.0),
                                used_gb: info.used_vram() as f32 / (1024.0 * 1024.0 * 1024.0),
                            }
                        }
                        None => GpuSnapshot::none(),
                    };
                    let _ = reply.send(snap);
                }
            })
            .expect("failed to spawn gpu-monitor thread");
        Mutex::new(tx)
    })
}

fn get_gpu_info() -> (String, f32, f32, f32) {
    let (reply_tx, reply_rx) = mpsc::channel();
    let sent = gpu_worker()
        .lock()
        .map(|tx| tx.send(reply_tx).is_ok())
        .unwrap_or(false);

    if sent {
        if let Ok(s) = reply_rx.recv_timeout(Duration::from_secs(5)) {
            return (s.name, s.usage, s.total_gb, s.used_gb);
        }
    }
    let n = GpuSnapshot::none();
    (n.name, n.usage, n.total_gb, n.used_gb)
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