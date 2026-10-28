use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LOG_MUTEX: Mutex<()> = Mutex::new(());

pub fn get_log_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let p = PathBuf::from(app_data).join("com.dudu.desktop").join("logs");
            let _ = fs::create_dir_all(&p);
            return p;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join("Library").join("Logs").join("dudu");
            let _ = fs::create_dir_all(&p);
            return p;
        }
    }
    let p = std::env::temp_dir().join("dudu_logs");
    let _ = fs::create_dir_all(&p);
    p
}

pub fn get_primary_log_file() -> PathBuf {
    get_log_dir().join("dudu.log")
}

pub fn get_temp_log_file() -> PathBuf {
    std::env::temp_dir().join("dudu_debug.log")
}

pub fn init_logger() {
    let p1 = get_primary_log_file();
    let p2 = get_temp_log_file();
    log_info!(
        "system",
        "=== dudu application started (Version: {}) ===",
        env!("CARGO_PKG_VERSION")
    );
    log_info!("system", "Primary log path: {}", p1.display());
    log_info!("system", "Temp log path: {}", p2.display());
}

pub fn log_raw(level: &str, target: &str, message: &str) {
    let _guard = LOG_MUTEX.lock();
    let now = chrono_timestamp();
    let line = format!("[{now}] [{level}] [{target}] {message}\n");

    // Print to console if attached
    #[cfg(debug_assertions)]
    eprint!("{line}");

    // Write to primary log
    let p1 = get_primary_log_file();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p1) {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }

    // Write to temp log for fast user access
    let p2 = get_temp_log_file();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p2) {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

fn chrono_timestamp() -> String {
    // Lightweight millisecond timestamp without pulling huge dependencies
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_secs = now.as_secs();
    let millis = now.subsec_millis();

    // Standard date-time calculation for UTC/local approximate
    let secs = total_secs % 86400;
    let hours = (secs / 3600 + 8) % 24; // Default to UTC+8 for Chinese users
    let mins = (secs % 3600) / 60;
    let s = secs % 60;

    format!("{hours:02}:{mins:02}:{s:02}.{millis:03}")
}

#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log_raw("INFO", $target, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log_raw("WARN", $target, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log_raw("ERROR", $target, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log_raw("DEBUG", $target, &format!($($arg)*))
    };
}

pub fn read_recent_logs(max_lines: usize) -> Result<String, String> {
    let p = get_primary_log_file();
    let content = fs::read_to_string(&p).map_err(|e| format!("无法读取日志文件: {e}"))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].join("\n"))
}

pub fn clear_logs() -> Result<(), String> {
    let _guard = LOG_MUTEX.lock();
    let p1 = get_primary_log_file();
    let p2 = get_temp_log_file();
    let _ = fs::write(&p1, "");
    let _ = fs::write(&p2, "");
    Ok(())
}
