use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use std::sync::Mutex;
use std::sync::LazyLock;

// Cache for releases to avoid excessive API calls
static RELEASES_CACHE: LazyLock<Mutex<Option<(Vec<LlamaCppReleaseFrontend>, Instant)>>> = 
    LazyLock::new(|| Mutex::new(None));

// Cache duration - GitHub allows 60 requests per hour for unauthenticated requests
// We'll cache for 10 minutes to be conservative
const CACHE_DURATION: Duration = Duration::from_secs(600);

// Llama.cpp specific types - updated to match GitHub API response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlamaCppRelease {
    pub id: u64,
    pub name: Option<String>,
    pub tag_name: String,
    pub published_at: String,
    pub body: Option<String>,
    pub assets: Vec<LlamaCppAsset>,
    pub draft: bool,
    pub prerelease: bool,
    pub html_url: String,
    pub tarball_url: String,
    pub zipball_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlamaCppAsset {
    pub id: u64,
    pub name: String,
    #[serde(rename = "browser_download_url")]
    pub download_url: String,
    pub size: u64,
    pub content_type: Option<String>,
    pub download_count: Option<u64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// Frontend-facing struct with correct field names
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlamaCppAssetFrontend {
    pub id: u64,
    pub name: String,
    pub download_url: String,
    pub size: u64,
    pub content_type: Option<String>,
    pub download_count: Option<u64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub html_url: String,
}

// Frontend-facing release struct
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlamaCppReleaseFrontend {
    pub id: u64,
    pub name: Option<String>,
    pub tag_name: String,
    pub published_at: String,
    pub body: Option<String>,
    pub formatted_body: Option<String>,
    pub commit_info: Option<CommitInfo>,
    pub assets: Vec<LlamaCppAssetFrontend>,
    pub draft: bool,
    pub prerelease: bool,
    pub html_url: String,
    pub tarball_url: String,
    pub zipball_url: String,
}

impl From<LlamaCppAsset> for LlamaCppAssetFrontend {
    fn from(asset: LlamaCppAsset) -> Self {
        Self {
            id: asset.id,
            name: asset.name,
            download_url: asset.download_url,
            size: asset.size,
            content_type: asset.content_type,
            download_count: asset.download_count,
            created_at: asset.created_at,
            updated_at: asset.updated_at,
        }
    }
}

impl From<LlamaCppRelease> for LlamaCppReleaseFrontend {
    fn from(release: LlamaCppRelease) -> Self {
        Self {
            id: release.id,
            name: release.name,
            tag_name: release.tag_name,
            published_at: release.published_at,
            body: release.body.clone(),
            formatted_body: format_release_body(&release.body),
            commit_info: None, // Initialize commit_info to None
            assets: release.assets.into_iter().map(|a| a.into()).collect(),
            draft: release.draft,
            prerelease: release.prerelease,
            html_url: release.html_url,
            tarball_url: release.tarball_url,
            zipball_url: release.zipball_url,
        }
    }
}

/// Format release body text to be more readable
fn format_release_body(body: &Option<String>) -> Option<String> {
    body.as_ref().and_then(|text| {
        if text.trim().is_empty() {
            None
        } else {
            // Basic formatting: convert markdown-like syntax to HTML
            let formatted = text
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with('#') {
                        // Headers
                        let level = trimmed.chars().take_while(|&c| c == '#').count();
                        let text = trimmed.trim_start_matches('#').trim();
                        format!("<h{}>{}</h{}>", level, text, level)
                    } else if trimmed.starts_with('-') || trimmed.starts_with('*') {
                        // List items
                        let text = trimmed.trim_start_matches(['-', '*', ' ']).trim();
                        format!("<li>{}</li>", text)
                    } else if trimmed.starts_with("```") {
                        // Code blocks
                        format!("<pre><code>{}</code></pre>", trimmed.trim_start_matches("```").trim_end_matches("```"))
                    } else if trimmed.starts_with('`') && trimmed.ends_with('`') {
                        // Inline code
                        let text = trimmed.trim_start_matches('`').trim_end_matches('`');
                        format!("<code>{}</code>", text)
                    } else if trimmed.starts_with("**") && trimmed.ends_with("**") {
                        // Bold text
                        let text = trimmed.trim_start_matches("**").trim_end_matches("**");
                        format!("<strong>{}</strong>", text)
                    } else if trimmed.starts_with('*') && trimmed.ends_with('*') && !trimmed.starts_with("**") {
                        // Italic text
                        let text = trimmed.trim_start_matches('*').trim_end_matches('*');
                        format!("<em>{}</em>", text)
                    } else if !trimmed.is_empty() {
                        // Regular text
                        format!("<p>{}</p>", trimmed)
                    } else {
                        // Empty lines become line breaks
                        "<br>".to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            
            Some(formatted)
        }
    })
}

/// Check if we have valid cached releases
fn get_cached_releases() -> Option<Vec<LlamaCppReleaseFrontend>> {
    if let Ok(cache) = RELEASES_CACHE.lock() {
        if let Some((releases, timestamp)) = cache.as_ref() {
            if timestamp.elapsed() < CACHE_DURATION {
                return Some(releases.clone());
            }
        }
    }
    None
}

/// Cache releases with timestamp
fn cache_releases(releases: Vec<LlamaCppReleaseFrontend>) {
    if let Ok(mut cache) = RELEASES_CACHE.lock() {
        *cache = Some((releases, Instant::now()));
    }
}

/// Fetch llama.cpp releases from GitHub API with proper rate limiting and caching
pub async fn fetch_llamacpp_releases() -> Result<Vec<LlamaCppReleaseFrontend>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first
    if let Some(cached_releases) = get_cached_releases() {
        println!("Returning cached releases ({} releases)", cached_releases.len());
        return Ok(cached_releases);
    }
    
    let client = reqwest::Client::new();
    
    // Use the proper GitHub API endpoint with correct headers
    let url = "https://api.github.com/repos/ggml-org/llama.cpp/releases";

    
    println!("Fetching llama.cpp releases from: {}", url);
    
    // Build request with proper GitHub API headers
    let request = client
        .get(url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    
    let response = request.send().await?;
    
    let status = response.status();
    println!("GitHub API response status: {}", status);
    
    // Check rate limiting headers
    if let Some(remaining) = response.headers().get("x-ratelimit-remaining") {
        if let Ok(remaining_str) = remaining.to_str() {
            if let Ok(remaining_int) = remaining_str.parse::<i32>() {
                println!("GitHub API rate limit remaining: {}", remaining_int);
                if remaining_int <= 5 {
                    println!("Warning: GitHub API rate limit is low!");
                }
            }
        }
    }
    
    if let Some(reset_time) = response.headers().get("x-ratelimit-reset") {
        if let Ok(reset_str) = reset_time.to_str() {
            if let Ok(reset_timestamp) = reset_str.parse::<u64>() {
                let reset_date = chrono::DateTime::from_timestamp(reset_timestamp as i64, 0);
                if let Some(date) = reset_date {
                    println!("GitHub API rate limit resets at: {}", date);
                }
            }
        }
    }
    
    // Check status before consuming the response
    if !status.is_success() {
        let response_text = response.text().await?;
        println!("GitHub API error response: {}", response_text);
        
        // Provide more specific error messages
        let error_message = match status.as_u16() {
            403 => "Rate limit exceeded. Please try again later.",
            404 => "Repository not found or access denied.",
            500..=599 => "GitHub API server error. Please try again later.",
            _ => &format!("GitHub API request failed with status: {}", status),
        };
        
        return Err(error_message.into());
    }
    
    // Get the response text for successful responses
    let response_text = response.text().await?;
    println!("GitHub API response body length: {} characters", response_text.len());
    
    // Parse releases
    let releases: Vec<LlamaCppRelease> = serde_json::from_str(&response_text)?;
    println!("Successfully parsed {} releases", releases.len());
    
    // Filter out draft and prerelease versions by default (can be made configurable later)
    let filtered_releases: Vec<LlamaCppRelease> = releases
        .into_iter()
        .filter(|r| !r.draft)
        .collect();
    
    println!("Filtered to {} stable releases", filtered_releases.len());
    
    // Convert to frontend-facing structs
    let frontend_releases: Vec<LlamaCppReleaseFrontend> = filtered_releases
        .into_iter()
        .map(|r| r.into())
        .collect();
    
    // Cache the results
    cache_releases(frontend_releases.clone());
    
    Ok(frontend_releases)
}

/// Fetch commit information from GitHub API
pub async fn fetch_commit_info(tag_name: &str) -> Result<CommitInfo, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    
    // Get the specific release to find the commit SHA
    let release_url = format!("https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/{}", tag_name);
    println!("Fetching release info from: {}", release_url);
    
    let release_response = client
        .get(&release_url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;
    
    if !release_response.status().is_success() {
        return Err(format!("Failed to fetch release info: {}", release_response.status()).into());
    }
    
    let release_data: serde_json::Value = release_response.json().await?;
    
    // Get the commit SHA from the release
    let commit_sha = release_data["target_commitish"].as_str()
        .ok_or("No commit SHA found in release response")?;
    
    println!("Found commit SHA: {} for tag: {}", commit_sha, tag_name);
    
    // Now fetch the commit details using the SHA
    let commit_url = format!("https://api.github.com/repos/ggml-org/llama.cpp/commits/{}", commit_sha);
    println!("Fetching commit info from: {}", commit_url);
    
    let commit_response = client
        .get(&commit_url)
        .header("User-Agent", "Arandu-Tauri/1.0")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;
    
    if !commit_response.status().is_success() {
        return Err(format!("Failed to fetch commit info: {}", commit_response.status()).into());
    }
    
    let commit_data: serde_json::Value = commit_response.json().await?;
    
    let sha = commit_data["sha"].as_str().unwrap_or("").to_string();
    let message = commit_data["commit"]["message"].as_str().unwrap_or("").to_string();
    let author = commit_data["commit"]["author"]["name"].as_str().unwrap_or("").to_string();
    let date = commit_data["commit"]["author"]["date"].as_str().unwrap_or("").to_string();
    let html_url = commit_data["html_url"].as_str().unwrap_or("").to_string();
    
    Ok(CommitInfo {
        sha,
        message,
        author,
        date,
        html_url,
    })
}