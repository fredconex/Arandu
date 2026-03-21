use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalConfig {
    pub models_directory: String,
    pub executable_folder: String,
    #[serde(default)]
    pub active_executable_folder: Option<String>,
    #[serde(default)]
    pub active_executable_version: Option<String>,
    pub theme_color: String,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    #[serde(default = "default_theme_is_synced")]
    pub theme_is_synced: bool,
}

fn default_background_color() -> String {
    "dark-gray".to_string()
}

fn default_theme_is_synced() -> bool {
    true
}

impl Default for GlobalConfig {
    fn default() -> Self {
        let base_dir = dirs::home_dir().unwrap_or_default().join(".Arandu");
        Self {
            models_directory: base_dir.join("models").to_str().unwrap_or_default().to_string(),
            executable_folder: base_dir.join("llama.cpp").to_str().unwrap_or_default().to_string(),
            active_executable_folder: None,
            active_executable_version: None,
            theme_color: "dark-gray".to_string(),
            background_color: "dark-gray".to_string(),
            theme_is_synced: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPreset {
    pub id: String,
    pub name: String,
    pub custom_args: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub custom_args: String,
    pub server_host: String,
    pub server_port: u16,
    pub model_path: String,
    #[serde(default)]
    pub presets: Vec<ModelPreset>,
    #[serde(default)]
    pub default_preset_id: Option<String>,
}

impl ModelConfig {
    pub fn new(model_path: String) -> Self {
        Self {
            custom_args: String::new(),
            server_host: "127.0.0.1".to_string(),
            server_port: 8080,
            model_path,
            presets: Vec::new(),
            default_preset_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub path: String,
    pub name: String,
    pub size_gb: f64,
    pub architecture: String,
    pub model_name: String,
    pub quantization: String,
    pub date: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GgufMetadata {
    pub architecture: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: String,
    pub model_path: String,
    pub model_name: String,
    pub host: String,
    pub port: u16,
    pub command: Vec<String>,
    pub status: ProcessStatus,
    pub output: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_sent_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProcessStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub process_id: String,
    pub server_host: String,
    pub server_port: u16,
    pub model_name: String,
    pub command: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessOutput {
    pub output: Vec<String>,
    pub is_running: bool,
    pub return_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub windows: HashMap<String, WindowState>,
    pub terminals: HashMap<String, TerminalState>,
    pub desktop_state: DesktopState,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            windows: HashMap::new(),
            terminals: HashMap::new(),
            desktop_state: DesktopState::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub window_type: String,
    pub title: String,
    pub content: String,
    pub position: Position,
    pub size: Size,
    pub visible: bool,
    pub z_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalState {
    pub process_id: String,
    pub model_name: String,
    pub model_path: String,
    pub host: String,
    pub port: u16,
    pub status: String,
    pub output: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopState {
    pub icon_positions: HashMap<String, Position>,
    pub sort_type: Option<String>,
    pub sort_direction: String,
    pub theme: String,
    #[serde(default = "default_background_color")]
    pub background: String,
    #[serde(default = "default_theme_is_synced")]
    pub theme_synced: bool,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            icon_positions: HashMap::new(),
            sort_type: None,
            sort_direction: "asc".to_string(),
            theme: "dark-gray".to_string(),
            background: "dark-gray".to_string(),
            theme_synced: true,
        }
    }
}

// Hugging Face related structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub success: bool,
    pub models: Vec<ModelBasic>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBasic {
    pub id: String,
    pub name: String,
    pub author: String,
    pub downloads: u64,
    pub likes: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetails {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: Option<String>,
    pub downloads: u64,
    pub likes: u64,
    pub total_files: u32,
    pub gguf_files: HashMap<String, GgufFileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GgufFileInfo {
    pub filename: String,
    pub path: String,
    pub size: u64,
    pub quantization_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStartResult {
    pub download_id: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_global_config_default() {
        let config = GlobalConfig::default();
        
        assert!(!config.models_directory.is_empty());
        assert!(!config.executable_folder.is_empty());
        assert_eq!(config.theme_color, "dark-gray");
        assert_eq!(config.background_color, "dark-gray");
        assert!(config.theme_is_synced);
    }

    #[test]
    fn test_global_config_serialization() {
        let config = GlobalConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: GlobalConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(config.models_directory, deserialized.models_directory);
        assert_eq!(config.executable_folder, deserialized.executable_folder);
    }

    #[test]
    fn test_model_config_new() {
        let config = ModelConfig::new("test/model.gguf".to_string());
        
        assert_eq!(config.model_path, "test/model.gguf");
        assert!(config.custom_args.is_empty());
        assert_eq!(config.server_host, "127.0.0.1");
        assert_eq!(config.server_port, 8080);
        assert!(config.presets.is_empty());
        assert!(config.default_preset_id.is_none());
    }

    #[test]
    fn test_model_config_serialization() {
        let config = ModelConfig::new("test/model.gguf".to_string());
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ModelConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(config.model_path, deserialized.model_path);
        assert_eq!(config.server_port, deserialized.server_port);
    }

    #[test]
    fn test_model_preset() {
        let preset = ModelPreset {
            id: "test-preset".to_string(),
            name: "Test Preset".to_string(),
            custom_args: "-c 4096".to_string(),
            is_default: true,
        };
        
        assert_eq!(preset.id, "test-preset");
        assert!(preset.is_default);
    }

    #[test]
    fn test_process_status_variants() {
        let _ = ProcessStatus::Starting;
        let _ = ProcessStatus::Running;
        let _ = ProcessStatus::Stopped;
        let _ = ProcessStatus::Failed;
    }

    #[test]
    fn test_position_default() {
        let pos = Position { x: 0, y: 0 };
        assert_eq!(pos.x, 0);
        assert_eq!(pos.y, 0);
    }

    #[test]
    fn test_size_default() {
        let size = Size { width: 800, height: 600 };
        assert_eq!(size.width, 800);
        assert_eq!(size.height, 600);
    }

    #[test]
    fn test_desktop_state_default() {
        let state = DesktopState::default();
        
        assert!(state.icon_positions.is_empty());
        assert_eq!(state.sort_direction, "asc");
        assert_eq!(state.theme, "dark-gray");
    }

    #[test]
    fn test_session_state_default() {
        let state = SessionState::default();
        
        assert!(state.windows.is_empty());
        assert!(state.terminals.is_empty());
    }

    #[test]
    fn test_gguf_file_info() {
        let info = GgufFileInfo {
            filename: "model-Q4_K_M.gguf".to_string(),
            path: "/models/model-Q4_K_M.gguf".to_string(),
            size: 4_000_000_000,
            quantization_type: Some("Q4_K_M".to_string()),
        };
        
        assert!(info.quantization_type.is_some());
        assert_eq!(info.quantization_type.unwrap(), "Q4_K_M");
    }
}