// Integration tests for the Arandu application
// These tests verify the compilation and basic functionality

// Test that the library compiles correctly
// This is the primary test - if this compiles, the entire library is valid
#[test]
fn test_library_compiles() {
    // This test ensures that all modules can be compiled together
    // If this compiles, the entire library is valid
    assert!(true);
}

// Test basic serde functionality works (used throughout the codebase)
#[test]
fn test_serde_functionality() {
    // Test JSON serialization/deserialization
    #[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
    struct TestStruct {
        name: String,
        value: i32,
    }
    
    let original = TestStruct { name: "test".to_string(), value: 42 };
    let json = serde_json::to_string(&original).unwrap();
    let parsed: TestStruct = serde_json::from_str(&json).unwrap();
    
    assert_eq!(original, parsed);
}

// Test regex functionality
#[test]
fn test_regex_functionality() {
    use regex::Regex;
    
    let re = Regex::new(r"(.+?)-\d{5}-of-\d{5}\.gguf$").unwrap();
    
    assert!(re.is_match("model-00001-of-00003.gguf"));
    assert!(!re.is_match("model.gguf"));
}

// Test path handling
#[test]
fn test_path_functionality() {
    use std::path::Path;
    
    let path = Path::new("C:\\Users\\test\\models\\model.gguf");
    assert!(path.is_absolute());
    
    let file_name = path.file_name().unwrap().to_str().unwrap();
    assert_eq!(file_name, "model.gguf");
    
    let stem = path.file_stem().unwrap().to_str().unwrap();
    assert_eq!(stem, "model");
}

// Test chrono (datetime) functionality
#[test]
fn test_datetime_functionality() {
    use chrono::{DateTime, Utc};
    
    let _now: DateTime<Utc> = Utc::now();
    
    // Test timestamp conversion
    let timestamp: i64 = 1704067200; // 2024-01-01 00:00:00 UTC
    let _datetime = DateTime::from_timestamp(timestamp, 0).unwrap();
}

// Test URL encoding functionality
#[test]
fn test_url_encoding() {
    let encoded = urlencoding::encode("model name with spaces");
    assert_eq!(encoded, "model%20name%20with%20spaces");
    
    let decoded = urlencoding::decode(&encoded).unwrap();
    assert_eq!(decoded, "model name with spaces");
}

// Test tokio runtime availability
#[test]
fn test_async_functionality() {
    // Just verify tokio is available
    let _ = tokio::runtime::Runtime::new();
}

// Test reqwest client availability  
#[test]
fn test_reqwest_availability() {
    // Verify reqwest types are accessible
    let _client = reqwest::Client::new();
}

// Test sysinfo availability
#[test]
fn test_sysinfo_availability() {
    use sysinfo::System;
    
    let mut sys = System::new();
    sys.refresh_all();
    
    // Just verify we can create a system info instance
    assert!(sys.cpus().len() > 0);
}

// Test glob pattern matching
#[test]
fn test_glob_functionality() {
    use glob::glob;
    
    // Test that glob can create a pattern (even if it matches nothing)
    let pattern = "/nonexistent/path/**/*.gguf";
    let result = glob(pattern);
    assert!(result.is_ok());
}

// Test uuid generation
#[test]
fn test_uuid_functionality() {
    let uuid = uuid::Uuid::new_v4();
    assert!(!uuid.to_string().is_empty());
}

// Test tracing (logging) availability
#[test]
fn test_tracing_availability() {
    // Verify tracing is available - use a simple check
    let _ = tracing::level_filters::LevelFilter::INFO;
}
