use tokio::process::{Child, Command as TokioCommand};
use tokio::io::{BufReader, AsyncBufReadExt};
use std::process::Stdio;
use std::path::Path;
use uuid::Uuid;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::models::*;
use crate::AppState;
use crate::config::save_settings;

/// Resolve a model/path argument to an absolute path.
/// - `%models%/...` is joined against the configured models directory.
/// - A relative (non-absolute, non-prefixed) path is also joined against the
///   models directory (handles hand-written relative values).
/// - An absolute path is returned unchanged.
fn resolve_model_path(path: &str, models_directory: &str) -> String {
    if let Some(rest) = path.strip_prefix("%models%/") {
        return std::path::Path::new(models_directory)
            .join(rest)
            .to_string_lossy()
            .into_owned();
    }
    if !Path::new(path).is_absolute() {
        return std::path::Path::new(models_directory)
            .join(path)
            .to_string_lossy()
            .into_owned();
    }
    path.to_string()
}

async fn resolve_llama_server_path_with_fallback(
    state: &AppState,
    global_config: &GlobalConfig,
) -> std::path::PathBuf {
    use std::fs;
    use std::time::SystemTime;

    let exe_name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    
    // First, try the preferred path using active executable folder
    if let Some(active_path) = &global_config.active_executable_folder {
        let preferred = std::path::Path::new(active_path).join(exe_name);
        if preferred.exists() {
            return preferred;
        }
    }
    
    // Fallback: look for the latest installed version under <exec>/versions
    let versions_dir = std::path::Path::new(&global_config.executable_folder).join("versions");
    let mut candidates: Vec<(std::path::PathBuf, Option<SystemTime>)> = Vec::new();
    
    if versions_dir.exists() {
        if let Ok(read_dir) = fs::read_dir(&versions_dir) {
            for entry in read_dir.flatten() {
                let version_path = entry.path();
                if version_path.is_dir() {
                    // Check for nested structure (version/backend/)
                    if let Ok(backend_dir) = fs::read_dir(&version_path) {
                        for backend_entry in backend_dir.flatten() {
                            let backend_path = backend_entry.path();
                            if backend_path.is_dir() {
                                let server_path = backend_path.join(exe_name);
                                if server_path.exists() {
                                    let created = backend_entry
                                        .metadata()
                                        .ok()
                                        .and_then(|m| m.created().ok());
                                    candidates.push((backend_path.clone(), created));
                                }
                            }
                        }
                    }
                    
                    // Also check for old flat structure (backward compatibility)
                    let server_path = version_path.join(exe_name);
                    if server_path.exists() {
                        let created = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.created().ok());
                        candidates.push((version_path.clone(), created));
                    }
                }
            }
        }
    }

    // Sort by created time desc, fall back to lexicographic name if no created
    candidates.sort_by(|a, b| match (a.1, b.1) {
        (Some(ta), Some(tb)) => tb.cmp(&ta),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.0.cmp(&a.0),
    });

    if let Some((chosen_dir, _)) = candidates.first() {
        // Update config to set this as active
        {
            let mut cfg = state.config.lock().await;
            let path_str = chosen_dir.to_string_lossy().to_string();
            cfg.active_executable_folder = Some(path_str);
            cfg.active_executable_version = Some(chosen_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string());
        }
        if let Err(e) = save_settings(state).await {
            eprintln!("Warning: failed to save settings after fallback activation: {}", e);
        }
        return chosen_dir.join(exe_name);
    }

    // Final fallback to the base executable folder
    std::path::Path::new(&global_config.executable_folder).join(exe_name)
}

// Simple wrapper for child process that ensures cleanup
// The key insight: keep Child directly accessible for kill_on_drop to work properly
#[derive(Debug)]
pub struct ProcessHandle {
    child: Option<Child>,
    process_id: String,
}

impl ProcessHandle {
    fn new(child: Child, process_id: String) -> Self {
        Self {
            child: Some(child),
            process_id,
        }
    }
    
    pub fn take_child(&mut self) -> Option<Child> {
        self.child.take()
    }
    
    pub fn get_child_mut(&mut self) -> Option<&mut Child> {
        self.child.as_mut()
    }
    
    pub fn get_child_id(&self) -> Option<u32> {
        self.child.as_ref().and_then(|c| c.id())
    }
}

// This ensures that if the ProcessHandle is dropped without explicit cleanup,
// the child process will still be terminated due to kill_on_drop(true)
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if let Some(child) = self.child.take() {
            println!("ProcessHandle dropping for {}, child will be killed by kill_on_drop", self.process_id);
            // Don't try to create async runtime in Drop - just drop the child
            // The kill_on_drop(true) setting should handle the termination
            drop(child);
        }
    }
}

pub async fn launch_model_server(
    model_path: String,
    state: &AppState,
) -> Result<LaunchResult, Box<dyn std::error::Error>> {
    let (global_config, model_config) = {
        let config = state.config.lock().await;
        let model_configs = state.model_configs.lock().await;
        let model_config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        (config.clone(), model_config)
    };
    
    // Resolve server path with fallback to latest installed version if needed
    let executable_path = resolve_llama_server_path_with_fallback(state, &global_config).await;
    
    if !executable_path.exists() {
        return Err(format!("Server executable not found at: {:?}", executable_path).into());
    }
    
    let requested_port = parse_port_from_args(&model_config.custom_args, model_config.server_port);
    let actual_port = find_available_port(requested_port);
    let host = parse_host_from_args(&model_config.custom_args, &model_config.server_host);
    
    // If we had to change the port, update the model config for this session
    let final_port = if actual_port != requested_port {
        println!("Port {} was in use, using port {} instead", requested_port, actual_port);
        actual_port
    } else {
        requested_port
    };
    
    // Build command with custom args if any
    let mut full_command = vec![executable_path.to_string_lossy().to_string()];
    let base_args = vec![
        "-m".to_string(),
        model_config.model_path.clone(),
        "--port".to_string(),
        final_port.to_string(),
    ];
    
    // Add custom arguments if present
    let mut custom_args_to_add = Vec::new();
    if !model_config.custom_args.trim().is_empty() {
        let mut custom_args = parse_custom_args(&model_config.custom_args);
        filter_port_args(&mut custom_args); // Filter out --port arguments
        
        // Resolve relative paths for --mmproj, -mm and --model-draft
        let mut i = 0;
        while i < custom_args.len() {
            if (custom_args[i] == "--mmproj" || custom_args[i] == "-mm" || custom_args[i] == "--model-draft") && i + 1 < custom_args.len() {
                let path = &custom_args[i + 1];
                if !std::path::Path::new(path).is_absolute() || path.starts_with("%models%/") {
                    custom_args[i + 1] = resolve_model_path(path, &global_config.models_directory);
                }
                i += 2;
            } else {
                i += 1;
            }
        }
        custom_args_to_add = custom_args;
    }

    full_command.extend(base_args.clone());
    full_command.extend(custom_args_to_add.clone());

    let mut cmd = TokioCommand::new(&executable_path);
    cmd.args(&base_args[0..]); // Use args instead of individual calls for clarity
    if !custom_args_to_add.is_empty() {
        cmd.args(&custom_args_to_add);
    }
    
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .kill_on_drop(true); // Ensure child process is killed when dropped

    // Hide console window on Windows release builds
    #[cfg(all(windows, not(debug_assertions)))]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    
    let mut child = cmd.spawn()?;
    let process_id = Uuid::new_v4().to_string();
    
    // Get stdout and stderr for output capture
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    
    let model_name = std::path::Path::new(&model_config.model_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    let process_info = ProcessInfo {
        id: process_id.clone(),
        model_path: model_config.model_path.clone(),
        model_name: model_name.clone(),
        host: host.clone(),
        port: final_port,
        command: full_command.clone(),
        status: ProcessStatus::Starting,
        output: Vec::new(),
        created_at: Utc::now(),
        last_sent_line: Some(0),
    };
    
    // Store the process info and child
    {
        let mut processes = state.running_processes.lock().await;
        processes.insert(process_id.clone(), process_info);
    }
    
    // Store the child process using simplified wrapper
    let process_handle = Arc::new(Mutex::new(ProcessHandle::new(child, process_id.clone())));
    {
        let mut child_processes = state.child_processes.lock().await;
        child_processes.insert(process_id.clone(), process_handle.clone());
    }
    
    // Spawn task to handle output capture
    let state_clone = state.clone();
    let process_id_clone = process_id.clone();
    let handle_clone = process_handle.clone();
    
    tokio::spawn(async move {
        handle_process_output(state_clone, process_id_clone, handle_clone, stdout, stderr).await;
    });
    
    Ok(LaunchResult {
        success: true,
        process_id,
        server_host: host,
        server_port: final_port,
        model_name,
        command: full_command,
        message: "Model server launched successfully".to_string(),
    })
}

pub async fn launch_model_external(
    model_path: String,
    state: &AppState,
) -> Result<LaunchResult, Box<dyn std::error::Error>> {
    let (global_config, model_config) = {
        let config = state.config.lock().await;
        let model_configs = state.model_configs.lock().await;
        let model_config = model_configs.get(&model_path)
            .cloned()
            .unwrap_or_else(|| ModelConfig::new(model_path.clone()));
        (config.clone(), model_config)
    };
    
    // Resolve server path with fallback to latest installed version if needed
    let executable_path = resolve_llama_server_path_with_fallback(state, &global_config).await;
    
    if !executable_path.exists() {
        return Err(format!("Server executable not found at: {:?}", executable_path).into());
    }
    
    let requested_port = parse_port_from_args(&model_config.custom_args, model_config.server_port);
    let actual_port = find_available_port(requested_port);
    let host = parse_host_from_args(&model_config.custom_args, &model_config.server_host);
    
    // If we had to change the port, update the model config for this session
    let final_port = if actual_port != requested_port {
        println!("Port {} was in use, using port {} instead", requested_port, actual_port);
        actual_port
    } else {
        requested_port
    };
    
    // For external launch, spawn in a new terminal window
    let mut cmd_args = vec![
        "-m".to_string(),
        model_config.model_path.clone(),
        "--port".to_string(),
        final_port.to_string(),
    ];
    
    // Add custom arguments if present
    if !model_config.custom_args.trim().is_empty() {
        let mut custom_args = parse_custom_args(&model_config.custom_args);
        filter_port_args(&mut custom_args); // Filter out --port arguments
        
        // Resolve relative paths for --mmproj, -mm and --model-draft
        let mut i = 0;
        while i < custom_args.len() {
            if (custom_args[i] == "--mmproj" || custom_args[i] == "-mm" || custom_args[i] == "--model-draft") && i + 1 < custom_args.len() {
                let path = &custom_args[i + 1];
                if !std::path::Path::new(path).is_absolute() || path.starts_with("%models%/") {
                    custom_args[i + 1] = resolve_model_path(path, &global_config.models_directory);
                }
                i += 2;
            } else {
                i += 1;
            }
        }
        
        cmd_args.extend(custom_args);
    }
    
    // Launch in external terminal
    #[cfg(windows)]
    {
        let mut cmd = TokioCommand::new("cmd");
        cmd.args(["/c", "start", "cmd", "/k"])
           .arg(executable_path.to_string_lossy().to_string())
           .args(&cmd_args);
        cmd.spawn()?;
    }
    
    #[cfg(not(windows))]
    {
        let mut cmd = TokioCommand::new("x-terminal-emulator");
        cmd.args(["-e"])
           .arg(executable_path.to_string_lossy().to_string())
           .args(&cmd_args);
        
        // Fallback to other terminal emulators if x-terminal-emulator fails
        if cmd.spawn().is_err() {
            let mut cmd = TokioCommand::new("gnome-terminal");
            cmd.args(["--"])
               .arg(executable_path.to_string_lossy().to_string())
               .args(&cmd_args);
            
            if cmd.spawn().is_err() {
                let mut cmd = TokioCommand::new("xterm");
                cmd.args(["-e"])
                   .arg(executable_path.to_string_lossy().to_string())
                   .args(&cmd_args);
                cmd.spawn()?;
            }
        }
    }
    
    let model_name = std::path::Path::new(&model_config.model_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    Ok(LaunchResult {
        success: true,
        process_id: "external".to_string(),
        server_host: host,
        server_port: final_port,
        model_name,
        command: Vec::new(),
        message: "Model launched in external terminal".to_string(),
    })
}

async fn handle_process_output(
    state: AppState,
    process_id: String,
    process_handle: Arc<Mutex<ProcessHandle>>,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
) {
    
    let mut stdout_reader = BufReader::new(stdout);
    let mut stderr_reader = BufReader::new(stderr);
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    
    loop {
        tokio::select! {
            read_stdout = stdout_reader.read_until(b'\n', &mut stdout_buf) => {
                match read_stdout {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&stdout_buf).to_string();
                        let formatted_line = format!("[OUT] {}", line.trim_end());
                        add_output_line(&state, &process_id, formatted_line).await;
                        stdout_buf.clear();
                    },
                    Err(e) => {
                        eprintln!("Error reading stdout: {}", e);
                        break;
                    }
                }
            },
            read_stderr = stderr_reader.read_until(b'\n', &mut stderr_buf) => {
                match read_stderr {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&stderr_buf).to_string();
                        let formatted_line = format!("[INFO] {}", line.trim_end());
                        add_output_line(&state, &process_id, formatted_line).await;
                        stderr_buf.clear();
                    },
                    Err(e) => {
                        eprintln!("Error reading stderr: {}", e);
                        break;
                    }
                }
            }
        }
    }
    
    // Wait for process to finish and get exit code
    let exit_code = {
        let mut handle_guard = process_handle.lock().await;
        if let Some(mut child_process) = handle_guard.take_child() {
            match child_process.wait().await {
                Ok(status) => status.code().unwrap_or(-1),
                Err(_) => -1,
            }
        } else {
            -1
        }
    };
    
    // Update process status to stopped and clean up child process tracking
    {
        let mut processes = state.running_processes.lock().await;
        if let Some(process_info) = processes.get_mut(&process_id) {
            process_info.status = ProcessStatus::Stopped;
            let exit_msg = format!("Process exited with code: {}", exit_code);
            process_info.output.push(exit_msg);
        }
    }
    
    // Remove from child process tracking since it has exited
    {
        let mut child_processes = state.child_processes.lock().await;
        child_processes.remove(&process_id);
        println!("Process {} exited naturally, removed from tracking", process_id);
    }
}

const MAX_LOG_LINES: usize = 1000;

async fn add_output_line(state: &AppState, process_id: &str, line: String) {
    let mut processes = state.running_processes.lock().await;
    if let Some(process_info) = processes.get_mut(process_id) {
        // Transition from Starting → Running on first output line
        if matches!(process_info.status, ProcessStatus::Starting) {
            process_info.status = ProcessStatus::Running;
        }

        process_info.output.push(line);

        // Keep buffer size strictly capped at MAX_LOG_LINES
        if process_info.output.len() > MAX_LOG_LINES {
            let drained = process_info.output.len() - MAX_LOG_LINES;
            process_info.output.drain(0..drained);
            
            // Shift the read cursor back by the number of drained lines,
            // clamping at 0 so subsequent reads don't skip or panic.
            process_info.last_sent_line = Some(
                process_info
                    .last_sent_line
                    .unwrap_or(0)
                    .saturating_sub(drained)
            );
        }
    }
}

pub async fn terminate_process(
    process_id: String,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("Terminating process: {}", process_id);
    
    // Kill the child process first, with timeout and forceful fallback
    {
        use tokio::time::{timeout, Duration};
        let mut child_processes = state.child_processes.lock().await;
        if let Some(handle_arc) = child_processes.remove(&process_id) {
            let mut handle_guard = handle_arc.lock().await;
            if let Some(mut child) = handle_guard.take_child() {
                match child.kill().await {
                    Ok(_) => {
                        // Wait for the process to actually exit, with timeout
                        match timeout(Duration::from_secs(5), child.wait()).await {
                            Ok(Ok(_)) => {
                                println!("Successfully killed and waited for process: {}", process_id);
                            },
                            Ok(Err(e)) => {
                                eprintln!("Error waiting for process {}: {}", process_id, e);
                            },
                            Err(_) => {
                                // Timeout expired, forcefully kill
                                #[cfg(windows)]
                                {
                                    use std::process::Command;
                                    if let Some(pid) = child.id() {
                                        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).output();
                                        println!("Forcefully killed process {} with PID {} after timeout", process_id, pid);
                                    }
                                }
                                #[cfg(unix)]
                                {
                                    use nix::sys::signal::{kill, Signal};
                                    use nix::unistd::Pid;
                                    if let Some(pid) = child.id() {
                                        let _ = kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
                                        println!("Forcefully killed process {} with PID {} after timeout", process_id, pid);
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => eprintln!("Failed to kill process {}: {}", process_id, e),
                }
            }
        }
    }
    
    // Update process status - do NOT remove from tracking immediately
    // This allows the frontend to fetch the remaining logs before the entry is gone
    {
        let mut processes = state.running_processes.lock().await;
        if let Some(process_info) = processes.get_mut(&process_id) {
            process_info.status = ProcessStatus::Stopped;
            process_info.output.push("--- Process terminated by user ---".to_string());
        }
    }
    
    Ok(())
}

pub async fn get_process_logs(
    process_id: String,
    state: &AppState,
) -> Result<ProcessOutput, Box<dyn std::error::Error>> {
    let mut processes = state.running_processes.lock().await;
    
    if let Some(process_info) = processes.get_mut(&process_id) {
        let total_lines = process_info.output.len();
        let last_sent = process_info.last_sent_line.unwrap_or(0).min(total_lines);
        
        let new_output = if last_sent < total_lines {
            let new_lines = process_info.output[last_sent..].to_vec();
            process_info.last_sent_line = Some(total_lines);
            new_lines
        } else {
            Vec::new()
        };
        
        Ok(ProcessOutput {
            output: new_output,
            is_running: matches!(process_info.status, ProcessStatus::Running | ProcessStatus::Starting),
            return_code: None,
        })
    } else {
        Err("Process not found".into())
    }
}

fn parse_host_from_args(custom_args: &str, default_host: &str) -> String {
    if let Some(host_pos) = custom_args.find("--host") {
        let after_host = &custom_args[host_pos + 6..];
        // Handle both --host=127.0.0.1 and --host 127.0.0.1 formats
        let host_str = if after_host.starts_with('=') {
            // Format: --host=127.0.0.1
            let after_equals = &after_host[1..];
            if let Some(space_pos) = after_equals.find(' ') {
                &after_equals[..space_pos]
            } else {
                after_equals
            }
        } else {
            // Format: --host 127.0.0.1
            let trimmed = after_host.trim_start();
            if let Some(space_pos) = trimmed.find(' ') {
                &trimmed[..space_pos]
            } else {
                trimmed
            }
        };
        
        return host_str.to_string();
    }
    default_host.to_string()
}

fn parse_port_from_args(custom_args: &str, default_port: u16) -> u16 {
    if let Some(port_pos) = custom_args.find("--port") {
        let after_port = &custom_args[port_pos + 6..];
        // Handle both --port=1234 and --port 1234 formats
        let port_str = if after_port.starts_with('=') {
            // Format: --port=1234
            let after_equals = &after_port[1..];
            if let Some(space_pos) = after_equals.find(' ') {
                &after_equals[..space_pos]
            } else {
                after_equals
            }
        } else {
            // Format: --port 1234
            let trimmed = after_port.trim_start();
            if let Some(space_pos) = trimmed.find(' ') {
                &trimmed[..space_pos]
            } else {
                trimmed
            }
        };
        
        if let Ok(port) = port_str.parse::<u16>() {
            return port;
        }
    }
    default_port
}

fn is_port_available(port: u16) -> bool {
    if let Ok(listener) = std::net::TcpListener::bind(format!("127.0.0.1:{}", port)) {
        // Port is available, close the listener
        drop(listener);
        true
    } else {
        // Port is in use
        false
    }
}

fn find_available_port(start_port: u16) -> u16 {
    let mut port = start_port;
    while !is_port_available(port) {
        port += 1;
        // Prevent infinite loop by setting a reasonable upper limit
        if port-start_port > 10 {
            // Only search for next 10 ports
            return start_port;
        }
    }
    port
}

fn filter_port_args(args: &mut Vec<String>) {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--port" {
            // Remove --port and the next argument (the port number)
            if i + 1 < args.len() {
                args.remove(i + 1);
            }
            args.remove(i);
        } else if args[i].starts_with("--port=") {
            // Remove --port=...
            args.remove(i);
        } else {
            i += 1;
        }
    }
}

fn parse_custom_args(custom_args: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current_arg = String::new();
    let mut in_single_quotes = false;
    let mut in_double_quotes = false;
    
    let mut chars = custom_args.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                // Peek at the next character to see if it's special
                if let Some(&next_ch) = chars.peek() {
                    if next_ch == '"' || next_ch == '\'' || next_ch == '\\' || next_ch == ' ' {
                        // It's escaping a special character, so consume the backslash and push the next char
                        current_arg.push(next_ch);
                        chars.next(); // consume it
                    } else {
                        // It's just a normal backslash (e.g., in a Windows path)
                        current_arg.push('\\');
                    }
                } else {
                    // Trailing backslash
                    current_arg.push('\\');
                }
            },
            '\'' if !in_double_quotes => {
                if current_arg.is_empty() || current_arg.ends_with('=') {
                    in_single_quotes = true;
                } else if in_single_quotes {
                    in_single_quotes = false;
                } else {
                    current_arg.push('\'');
                }
            },
            '"' if !in_single_quotes => {
                if current_arg.is_empty() || current_arg.ends_with('=') {
                    in_double_quotes = true;
                } else if in_double_quotes {
                    in_double_quotes = false;
                } else {
                    current_arg.push('"');
                }
            },
            ' ' | '\t' | '\n' | '\r' if !in_single_quotes && !in_double_quotes => {
                if !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            },
            _ => {
                current_arg.push(ch);
            }
        }
    }
    
    if !current_arg.is_empty() {
        args.push(current_arg);
    }
    
    args
}