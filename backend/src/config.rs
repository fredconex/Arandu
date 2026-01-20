use std::path::{Path, PathBuf};
use std::collections::HashMap;
use serde_json;
use tokio::fs;
use crate::models::*;
use crate::AppState;

const SETTINGS_FILE: &str = "settings.json";

pub async fn get_settings_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut path = dirs::home_dir()
        .ok_or("Could not find home directory")?;
    path.push(".Arandu");
    
    // Create directory if it doesn't exist
    fs::create_dir_all(&path).await?;
    path.push(SETTINGS_FILE);
    
    Ok(path)
}

/// Convert absolute model path to relative path based on models directory
fn make_path_relative(absolute_path: &str, models_dir: &str) -> String {
    if models_dir.is_empty() {
        return absolute_path.to_string();
    }
    
    let abs_path = Path::new(absolute_path);
    let base_path = Path::new(models_dir);
    
    if let Ok(rel_path) = abs_path.strip_prefix(base_path) {
        rel_path.to_string_lossy().to_string()
    } else {
        absolute_path.to_string()
    }
}

/// Convert relative model path to absolute path based on models directory
fn make_path_absolute(relative_path: &str, models_dir: &str) -> String {
    if models_dir.is_empty() || Path::new(relative_path).is_absolute() {
        return relative_path.to_string();
    }
    
    let base_path = Path::new(models_dir);
    let full_path = base_path.join(relative_path);
    full_path.to_string_lossy().to_string()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SettingsFile {
    global_config: GlobalConfig,
    model_configs: HashMap<String, ModelConfig>,
}

pub async fn load_settings(state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let settings_path = get_settings_path().await?;
    
    if !settings_path.exists() {
        tracing::info!("Settings file does not exist, using defaults");
        return Ok(());
    }
    
    let contents = fs::read_to_string(&settings_path).await?;
    let settings: SettingsFile = serde_json::from_str(&contents)?;
    
    // Get models directory for path conversion
    let models_dir = settings.global_config.models_directory.clone();
    
    // Update global config
    {
        let mut config = state.config.lock().await;
        *config = settings.global_config;
    }
    
    // Update model configs, converting relative paths to absolute
    {
        let mut model_configs = state.model_configs.lock().await;
        let mut absolute_configs = HashMap::new();
        
        for (relative_path, mut config) in settings.model_configs {
            let absolute_path = make_path_absolute(&relative_path, &models_dir);
            config.model_path = absolute_path.clone();
            absolute_configs.insert(absolute_path, config);
        }
        
        *model_configs = absolute_configs;
    }
    
    tracing::info!("Settings loaded successfully from {:?}", settings_path);
    Ok(())
}

pub async fn save_settings(state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let settings_path = get_settings_path().await?;
    
    let global_config = {
        let config = state.config.lock().await;
        config.clone()
    };
    
    let models_dir = global_config.models_directory.clone();
    
    let model_configs = {
        let configs = state.model_configs.lock().await;
        let mut relative_configs = HashMap::new();
        
        // Convert absolute paths to relative paths for storage
        for (absolute_path, config) in configs.iter() {
            let relative_path = make_path_relative(absolute_path, &models_dir);
            let mut config_clone = config.clone();
            config_clone.model_path = relative_path.clone();
            relative_configs.insert(relative_path, config_clone);
        }
        
        relative_configs
    };
    
    let settings = SettingsFile {
        global_config,
        model_configs,
    };
    
    let contents = serde_json::to_string_pretty(&settings)?;
    fs::write(&settings_path, contents).await?;
    
    tracing::info!("Settings saved successfully to {:?}", settings_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_path_relative() {
        // Test with Windows-style paths
        let absolute = "C:\\Users\\test\\models\\llama-3.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_relative(absolute, base);
        assert_eq!(result, "llama-3.gguf");

        // Test with nested paths
        let absolute = "C:\\Users\\test\\models\\subfolder\\model.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_relative(absolute, base);
        assert_eq!(result, "subfolder\\model.gguf");

        // Test with path outside base directory
        let absolute = "C:\\Users\\other\\model.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_relative(absolute, base);
        assert_eq!(result, absolute); // Should return original path

        // Test with empty base directory
        let absolute = "C:\\Users\\test\\models\\model.gguf";
        let base = "";
        let result = make_path_relative(absolute, base);
        assert_eq!(result, absolute); // Should return original path
    }

    #[test]
    fn test_make_path_absolute() {
        // Test with relative path
        let relative = "llama-3.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_absolute(relative, base);
        assert_eq!(result, "C:\\Users\\test\\models\\llama-3.gguf");

        // Test with nested relative path
        let relative = "subfolder\\model.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_absolute(relative, base);
        assert_eq!(result, "C:\\Users\\test\\models\\subfolder\\model.gguf");

        // Test with already absolute path
        let absolute = "C:\\Users\\test\\models\\model.gguf";
        let base = "C:\\Users\\test\\models";
        let result = make_path_absolute(absolute, base);
        assert_eq!(result, absolute); // Should return original path

        // Test with empty base directory
        let relative = "model.gguf";
        let base = "";
        let result = make_path_absolute(relative, base);
        assert_eq!(result, relative); // Should return original path
    }
}