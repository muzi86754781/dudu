// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
fn init_dpi() {
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn SetProcessDpiAwarenessContext(value: isize) -> i32;
        }
        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        let _ = SetProcessDpiAwarenessContext(-4);
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    init_dpi();

    dudu_lib::run();
}


