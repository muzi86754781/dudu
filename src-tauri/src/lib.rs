#[macro_use]
pub mod logger;
mod model;
mod store;

use arboard::Clipboard;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use enigo::{Axis, Direction, Enigo, Key, Keyboard, Mouse, Settings as InputSettings};
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader, RgbaImage};
use model::{err, now, Capture, Clip, Result, Settings, Status, Translation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Cursor,
    path::PathBuf,
    sync::{Mutex, RwLock},
};
use tauri::{
    image::Image as TauriImage,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    db: Mutex<store::Store>,
    settings: Mutex<Settings>,
    capture: RwLock<Option<RgbaImage>>,
    capture_cache: RwLock<Option<Capture>>,
    data_dir: PathBuf,
}

impl AppState {
    fn settings(&self) -> Result<Settings> {
        self.settings.lock().map(|v| v.clone()).map_err(err)
    }
    fn save(&self, s: Settings) -> Result<()> {
        s.validate()?;
        self.db.lock().map_err(err)?.save_settings(&s)?;
        *self.settings.lock().map_err(err)? = s;
        Ok(())
    }
    fn clips(&self, full: bool) -> Result<Vec<Clip>> {
        self.db.lock().map_err(err)?.list(full)
    }
}

#[tauri::command]
fn status() -> Status {
    Status {
        ready: true,
        error: String::new(),
        shortcut_errors: Vec::new(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        platform: std::env::consts::OS.to_owned(),
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings> {
    state.settings()
}

fn register_shortcuts<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &Settings,
) -> Vec<String> {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    let mut errors = Vec::new();
    for (id, accelerator) in &settings.shortcuts {
        let action_id = id.clone();
        let app_clone = app.clone();
        if let Err(e) = manager.on_shortcut(accelerator.as_str(), move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            match action_id.as_str() {
                "clipboard" => {
                    log_info!("shortcut", "快捷键触发: 剪贴板历史");
                    let _ = app_clone.emit("navigate", "clipboard");
                    let _ = show_main(&app_clone);
                }
                "region" | "window" | "fullscreen" | "ocr" | "color" => {
                    let mode = action_id.clone();
                    let a = app_clone.clone();
                    log_info!("shortcut", "快捷键触发截图: 模式={}", mode);
                    std::thread::spawn(move || {
                        if let Err(e) = capture_start(&a, &mode, 0, None) {
                            log_error!("shortcut", "截图启动失败: {}", e);
                            let _ = a.emit("error", e);
                        }
                    });
                }
                "translate" => {
                    let a = app_clone.clone();
                    log_info!("shortcut", "快捷键触发: 独立翻译窗口");
                    std::thread::spawn(move || {
                        if let Err(e) = show_quick_translate(&a, None) {
                            log_error!("shortcut", "唤起快速翻译窗口失败: {}", e);
                        }
                    });
                }
                "selection" => {
                    let a = app_clone.clone();
                    log_info!("shortcut", "快捷键触发: 划词翻译");
                    std::thread::spawn(move || {
                        let text = selected_text().ok();
                        if let Err(e) = show_quick_translate(&a, text) {
                            log_error!("shortcut", "唤起划词翻译失败: {}", e);
                        }
                    });
                }
                _ => {}
            }
        }) {
            errors.push(format!("{id}（{accelerator}）：{e}"));
        }
    }
    errors
}

fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<()> {
    let w = app.get_webview_window("main").ok_or("主窗口不可用")?;
    w.show().map_err(err)?;
    w.unminimize().map_err(err)?;
    w.set_focus().map_err(err)
}

fn show_quick_translate<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    initial_text: Option<String>,
) -> Result<()> {
    if let Some(w) = app.get_webview_window("quick-translate") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(text) = initial_text {
            let _ = w.emit("quick-translate-text", text);
        }
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?quick-translate=1".into());
    let w = WebviewWindowBuilder::new(app, "quick-translate", url)
        .title("dudu 翻译")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .inner_size(440.0, 310.0)
        .center()
        .skip_taskbar(true)
        .build()
        .map_err(err)?;
    let _ = w.set_focus();
    if let Some(text) = initial_text {
        let w_clone = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let _ = w_clone.emit("quick-translate-text", text);
        });
    }
    Ok(())
}

#[tauri::command]
fn hide_quick_translate(app: tauri::AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window("quick-translate") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
fn set_quick_translate_pin(app: tauri::AppHandle, pinned: bool) -> Result<()> {
    if let Some(w) = app.get_webview_window("quick-translate") {
        let _ = w.set_always_on_top(pinned);
    }
    Ok(())
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<()> {
    show_main(&app)?;
    app.emit("navigate", "settings").map_err(err)
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: Settings,
) -> Result<Status> {
    state.save(settings.clone())?;
    if settings.autostart {
        app.autolaunch().enable().map_err(err)?
    } else {
        app.autolaunch().disable().map_err(err)?
    }
    let errors = register_shortcuts(&app, &settings);
    let _ = refresh_tray(&app, &settings);
    Ok(Status {
        ready: true,
        error: String::new(),
        shortcut_errors: errors,
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
    })
}

#[tauri::command]
fn list_clips(state: tauri::State<'_, AppState>) -> Result<Vec<Clip>> {
    state.clips(false)
}

#[tauri::command]
fn favorite_clip(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<Clip>> {
    state.db.lock().map_err(err)?.favorite(&id)?;
    state.clips(false)
}

#[tauri::command]
fn delete_clip(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<Clip>> {
    state.db.lock().map_err(err)?.delete(&id)?;
    state.clips(false)
}

#[tauri::command]
fn edit_clip(
    state: tauri::State<'_, AppState>,
    id: String,
    title: String,
    content: String,
) -> Result<Vec<Clip>> {
    state.db.lock().map_err(err)?.edit(&id, &title, &content)?;
    state.clips(false)
}

#[tauri::command]
fn copy_clip(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let clip = state.db.lock().map_err(err)?.clip(&id)?;
    if clip.kind == "image" {
        Clipboard::new()
            .map_err(err)?
            .set_image(clipboard_image(&clip.content)?)
            .map_err(err)
    } else {
        Clipboard::new()
            .map_err(err)?
            .set_text(clip.content)
            .map_err(err)
    }
}

#[tauri::command]
fn paste_clip(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<()> {
    copy_by_id(&state, &id)?;
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(err)?
    }
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.close();
    }
    std::thread::sleep(std::time::Duration::from_millis(180));
    paste_shortcut()
}

fn copy_by_id(state: &AppState, id: &str) -> Result<()> {
    let clip = state.db.lock().map_err(err)?.clip(id)?;
    if clip.kind == "image" {
        Clipboard::new()
            .map_err(err)?
            .set_image(clipboard_image(&clip.content)?)
            .map_err(err)
    } else {
        Clipboard::new()
            .map_err(err)?
            .set_text(clip.content)
            .map_err(err)
    }
}

fn clipboard_image(content: &str) -> Result<arboard::ImageData<'static>> {
    let data = decode_data(content, 20 * 1024 * 1024)?;
    let image = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(err)?
        .decode()
        .map_err(err)?
        .to_rgba8();
    if image.width() as u64 * image.height() as u64 > 40_000_000 {
        return Err("图片分辨率超过安全上限".into());
    }
    Ok(arboard::ImageData {
        width: image.width() as usize,
        height: image.height() as usize,
        bytes: image.into_raw().into(),
    })
}

#[tauri::command]
fn serial_paste(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
    separator: String,
) -> Result<()> {
    if ids.is_empty() || ids.len() > 100 {
        return Err("请选择 1～100 条记录".into());
    }
    if ids.iter().any(|id| id.is_empty() || id.len() > 64) {
        return Err("无效的历史记录".into());
    }
    let db = state.db.lock().map_err(err)?;
    let mut text = String::new();
    for id in ids {
        let c = db.clip(&id)?;
        if c.kind != "text" {
            return Err("连续粘贴只支持文字记录".into());
        }
        if text.len() + c.content.len() > 1_000_000 {
            return Err("连续粘贴内容超过 1 MB".into());
        }
        if !text.is_empty() {
            text.push_str(&separator);
        }
        text.push_str(&c.content);
    }
    drop(db);
    Clipboard::new().map_err(err)?.set_text(text).map_err(err)?;
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(err)?
    }
    std::thread::sleep(std::time::Duration::from_millis(180));
    paste_shortcut()
}

#[tauri::command]
fn write_text(text: String) -> Result<()> {
    if text.len() > 1_000_000 {
        return Err("文本超过 1 MB".into());
    }
    Clipboard::new().map_err(err)?.set_text(text).map_err(err)
}

fn paste_shortcut() -> Result<()> {
    let mut e = Enigo::new(&InputSettings::default()).map_err(err)?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    e.key(modifier, Direction::Press).map_err(err)?;
    let result = e.key(Key::Unicode('v'), Direction::Click);
    let _ = e.key(modifier, Direction::Release);
    result.map_err(err)
}

fn selected_text() -> Result<String> {
    let mut clipboard = Clipboard::new().map_err(err)?;
    let old = clipboard.get_text().ok();
    let mut e = Enigo::new(&InputSettings::default()).map_err(err)?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    e.key(modifier, Direction::Press).map_err(err)?;
    e.key(Key::Unicode('c'), Direction::Click).map_err(err)?;
    let _ = e.key(modifier, Direction::Release);
    std::thread::sleep(std::time::Duration::from_millis(140));
    let selected = clipboard
        .get_text()
        .map_err(|_| "未能获取选中文字。请授予辅助功能权限后重试".to_string())?;
    if let Some(previous) = old {
        let _ = clipboard.set_text(previous);
    }
    if selected.trim().is_empty() {
        return Err("未检测到选中文字。请先选中文字再按快捷键".into());
    }
    if selected.len() > 100_000 {
        return Err("选中文字超过 100 KB".into());
    }
    Ok(selected)
}

#[tauri::command]
fn translation_history(state: tauri::State<'_, AppState>) -> Result<Vec<Translation>> {
    state.db.lock().map_err(err)?.history()
}

#[tauri::command]
async fn translate(
    state: tauri::State<'_, AppState>,
    text: String,
    from: String,
    to: String,
    engine: String,
) -> Result<Translation> {
    if text.trim().is_empty() || text.len() > 40_000 {
        return Err("请输入 1～40000 字节的文本".into());
    }
    if !["auto", "zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "ru"]
        .contains(&from.as_str())
        || !["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "ru"]
            .contains(&to.as_str())
    {
        return Err("暂不支持所选语言".into());
    }
    if !["google", "deepl", "baidu", "youdao"].contains(&engine.as_str()) {
        return Err("未知翻译引擎".into());
    }
    let config = state.settings()?;
    let mut hash = Sha256::new();
    hash.update(&text);
    hash.update(&from);
    hash.update(&to);
    hash.update(&engine);
    let id = format!("{:x}", hash.finalize());
    if let Some(mut cached) = state.db.lock().map_err(err)?.cached(&id)? {
        cached.cached = true;
        return Ok(cached);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout.clamp(3, 60)))
        .build()
        .map_err(err)?;
    let result = match engine.as_str() {
        "google" => google_translate(&client, &text, &from, &to).await?,
        "deepl" => {
            if config.deepl_key.trim().is_empty() {
                return Err("请先在偏好设置中填入 DeepL Free API Key".into());
            }
            deepl_translate(&client, &text, &from, &to, &config.deepl_key).await?
        }
        "baidu" => {
            if config.baidu_id.trim().is_empty() || config.baidu_key.trim().is_empty() {
                return Err("请先在偏好设置中填入百度 App ID 与密钥".into());
            }
            baidu_translate(&client, &text, &from, &to, &config.baidu_id, &config.baidu_key).await?
        }
        "youdao" => {
            if config.youdao_key.trim().is_empty() || config.youdao_secret.trim().is_empty() {
                return Err("请先在偏好设置中填入有道智云 App Key 与应用密钥".into());
            }
            youdao_translate(&client, &text, &from, &to, &config.youdao_key, &config.youdao_secret).await?
        }
        _ => unreachable!(),
    };
    let tr = Translation {
        id,
        text,
        result,
        engine,
        from,
        to,
        created: now(),
        cached: false,
    };
    state.db.lock().map_err(err)?.cache(&tr)?;
    Ok(tr)
}

fn google_lang(s: &str) -> &str {
    if s == "auto" {
        "auto"
    } else {
        s
    }
}

async fn google_translate(
    client: &reqwest::Client,
    text: &str,
    from: &str,
    to: &str,
) -> Result<String> {
    let sl = google_lang(from);
    let response = client
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[
            ("client", "gtx"),
            ("sl", sl),
            ("tl", to),
            ("dt", "t"),
            ("q", text),
        ])
        .send()
        .await
        .map_err(|_| "连接 Google 翻译失败，请检查网络或切换引擎".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Google 翻译返回 {}，请更换引擎或稍后重试",
            response.status().as_u16()
        ));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Google 翻译返回了无法解析的结果".to_string())?;
    body.get(0)
        .and_then(|segments| segments.as_array())
        .map(|segments| {
            segments
                .iter()
                .filter_map(|s| s.get(0).and_then(|x| x.as_str()))
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Google 翻译未返回译文".into())
}

async fn deepl_translate(
    client: &reqwest::Client,
    text: &str,
    from: &str,
    to: &str,
    key: &str,
) -> Result<String> {
    let target = to.replace('-', "_").to_uppercase();
    let source = if from == "auto" {
        String::new()
    } else {
        from.replace('-', "_").to_uppercase()
    };
    let response = client
        .post("https://api-free.deepl.com/v2/translate")
        .header("Authorization", format!("DeepL-Auth-Key {key}"))
        .form(&[
            ("text", text),
            ("target_lang", &target),
            ("source_lang", &source),
        ])
        .send()
        .await
        .map_err(|_| "连接 DeepL 失败，请检查网络".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "DeepL 返回 {}，请检查 API Key 和请求配额",
            response.status().as_u16()
        ));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(err)?
        .pointer("/translations/0/text")
        .and_then(|x| x.as_str())
        .map(str::to_owned)
        .ok_or_else(|| "DeepL 未返回译文".into())
}

fn baidu_lang(s: &str) -> &str {
    match s {
        "auto" => "auto",
        "zh-CN" => "zh",
        "zh-TW" => "cht",
        v => v,
    }
}

async fn baidu_translate(
    client: &reqwest::Client,
    text: &str,
    from: &str,
    to: &str,
    app_id: &str,
    key: &str,
) -> Result<String> {
    let from_mapped = baidu_lang(from);
    let to_mapped = baidu_lang(to);
    let salt = uuid::Uuid::new_v4().simple().to_string();
    let signature = format!("{:x}", md5::compute(format!("{app_id}{text}{salt}{key}")));
    let response = client
        .get("https://fanyi-api.baidu.com/api/trans/vip/translate")
        .query(&[
            ("q", text),
            ("from", from_mapped),
            ("to", to_mapped),
            ("appid", app_id),
            ("salt", &salt),
            ("sign", &signature),
        ])
        .send()
        .await
        .map_err(|_| "连接百度翻译失败，请检查网络".to_string())?;
    if !response.status().is_success() {
        return Err(format!("百度翻译返回 {}", response.status().as_u16()));
    }
    let body: serde_json::Value = response.json().await.map_err(err)?;
    if let Some(message) = body.get("error_msg").and_then(|x| x.as_str()) {
        return Err(format!("百度翻译：{message}"));
    }
    body.get("trans_result")
        .and_then(|v| v.as_array())
        .map(|v| {
            v.iter()
                .filter_map(|r| r.get("dst").and_then(|x| x.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "百度翻译未返回译文".into())
}

fn youdao_lang(s: &str) -> &str {
    match s {
        "auto" => "auto",
        "zh-CN" => "zh-CHS",
        "zh-TW" => "zh-CHT",
        "ja" => "ja",
        "en" => "en",
        "ko" => "ko",
        "fr" => "fr",
        "de" => "de",
        "es" => "es",
        "ru" => "ru",
        v => v,
    }
}

async fn youdao_translate(
    client: &reqwest::Client,
    text: &str,
    from: &str,
    to: &str,
    app_key: &str,
    app_secret: &str,
) -> Result<String> {
    let curtime = (now() / 1000).to_string();
    let salt = uuid::Uuid::new_v4().simple().to_string();
    let truncate = |q: &str| {
        let len = q.chars().count();
        if len <= 20 {
            q.to_string()
        } else {
            let prefix: String = q.chars().take(10).collect();
            let suffix: String = q.chars().skip(len - 10).collect();
            format!("{prefix}{len}{suffix}")
        }
    };
    let sign_str = format!("{}{}{}{}{}", app_key, truncate(text), salt, curtime, app_secret);
    let mut hasher = Sha256::new();
    hasher.update(sign_str.as_bytes());
    let sign = format!("{:x}", hasher.finalize());

    let from_mapped = youdao_lang(from);
    let to_mapped = youdao_lang(to);

    let response = client
        .post("https://openapi.youdao.com/api")
        .form(&[
            ("q", text),
            ("from", from_mapped),
            ("to", to_mapped),
            ("appKey", app_key),
            ("salt", &salt),
            ("sign", &sign),
            ("signType", "v3"),
            ("curtime", &curtime),
        ])
        .send()
        .await
        .map_err(|_| "连接有道翻译失败，请检查网络".to_string())?;

    if !response.status().is_success() {
        return Err(format!("有道翻译返回 {}", response.status().as_u16()));
    }
    let body: serde_json::Value = response.json().await.map_err(err)?;
    if let Some(err_code) = body.get("errorCode").and_then(|x| x.as_str()) {
        if err_code != "0" {
            return Err(format!("有道翻译错误码: {err_code}"));
        }
    }
    body.get("translation")
        .and_then(|v| v.as_array())
        .map(|v| {
            v.iter()
                .filter_map(|r| r.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "有道翻译未返回译文".into())
}

#[tauri::command]
fn start_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    mode: String,
    delay: u64,
    window_id: Option<u32>,
) -> Result<()> {
    capture_start_with_state(&app, state.inner(), &mode, delay, window_id)
}

fn capture_start<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mode: &str,
    delay: u64,
    window_id: Option<u32>,
) -> Result<()> {
    let state = app.state::<AppState>();
    capture_start_with_state(app, state.inner(), mode, delay, window_id)
}

fn capture_start_with_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppState,
    mode: &str,
    delay: u64,
    window_id: Option<u32>,
) -> Result<()> {
    log_info!("capture", "发起截图请求: 模式={}, 延迟={}s", mode, delay);
    if !["region", "window", "fullscreen", "ocr", "color"].contains(&mode) {
        log_error!("capture", "未知截图方式: {}", mode);
        return Err("未知截图方式".into());
    }
    if !state.settings()?.consent {
        log_warn!("capture", "用户尚未同意隐私说明，已拦截截图");
        return Err("请先同意隐私说明".into());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if delay > 0 {
        std::thread::sleep(std::time::Duration::from_secs(delay.min(10)));
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    let t_start = std::time::Instant::now();
    let monitors = xcap::Monitor::all().map_err(|e| {
        log_error!("capture", "获取显示器列表失败: {}", e);
        "无法捕获屏幕。请在系统设置中授权屏幕录制，然后重新打开 dudu".to_string()
    })?;
    if monitors.is_empty() {
        log_error!("capture", "未检测到可用显示器");
        return Err("未检测到可用显示器".into());
    }
    let image = if mode == "window" {
        let id = window_id.ok_or("请先选择一个窗口")?;
        let win = xcap::Window::all()
            .map_err(err)?
            .into_iter()
            .find(|w| w.id().ok() == Some(id))
            .ok_or("所选窗口已关闭")?;
        win.capture_image().map_err(err)?
    } else {
        let primary = monitors
            .iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .unwrap_or(&monitors[0]);
        primary
            .capture_image()
            .map_err(|e| {
                log_error!("capture", "主屏幕捕获失败: {}", e);
                "无法捕获屏幕。请确认 dudu 已获得屏幕录制权限".to_string()
            })?
    };
    let cap_ms = t_start.elapsed().as_millis();
    let width = image.width();
    let height = image.height();
    log_info!("capture", "底图截取成功: {}x{}，耗时: {}ms", width, height, cap_ms);

    *state.capture.write().map_err(err)? = Some(image.clone());

    let t_enc = std::time::Instant::now();
    let bytes = encode_screen_preview(&image)?;
    let enc_ms = t_enc.elapsed().as_millis();
    let size_kb = bytes.len() / 1024;
    log_info!("capture", "交互背板无损编码完成，耗时: {}ms, 大小: {}KB", enc_ms, size_kb);

    let cap = Capture {
        data: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        width,
        height,
    };
    *state.capture_cache.write().map_err(err)? = Some(cap.clone());
    let _ = app.emit("capture-ready", cap.clone());

    if let Some(existing) = app.get_webview_window("capture") {
        log_info!("capture", "复用现有截图窗口，立即显示并重聚焦点");
        let _ = existing.set_fullscreen(true);
        let _ = existing.set_position(tauri::LogicalPosition::new(0.0, 0.0));
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let _ = existing.emit("capture-ready", cap);
    } else {
        log_info!("capture", "创建全新全屏截图窗口");
        let url = WebviewUrl::App(format!("index.html?overlay={mode}").into());
        let builder = WebviewWindowBuilder::new(app, "capture", url)
            .title("dudu 截图工作台")
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .fullscreen(true);
        let win = builder.build().map_err(|e| {
            log_error!("capture", "创建截图窗口失败: {}", e);
            e.to_string()
        })?;
        let _ = win.set_focus();
    }
    Ok(())
}

fn encode_screen_preview(image: &RgbaImage) -> Result<Vec<u8>> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    let mut bytes = Cursor::new(Vec::new());
    let encoder = PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::NoFilter);
    if let Err(_) = encoder.write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        image::ExtendedColorType::Rgba8,
    ) {
        bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image.clone())
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(err)?;
    }
    Ok(bytes.into_inner())
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>> {
    encode_screen_preview(image)
}

fn decode_data(input: &str, limit: usize) -> Result<Vec<u8>> {
    let body = input
        .split_once(',')
        .map(|x| if x.0.contains(";base64") { x.1 } else { input })
        .unwrap_or(input);
    if body.len() > limit.saturating_mul(4) / 3 + 16 {
        return Err("图片文件超过 20 MB".into());
    }
    BASE64.decode(body).map_err(|_| "图片数据格式错误".into())
}

#[tauri::command]
fn pending_capture(state: tauri::State<'_, AppState>) -> Result<Capture> {
    if let Some(cached) = state.capture_cache.read().map_err(err)?.clone() {
        return Ok(cached);
    }
    let image = state
        .capture
        .read()
        .map_err(err)?
        .clone()
        .ok_or("没有待处理的截图")?;
    let width = image.width();
    let height = image.height();
    let cap = Capture {
        data: format!("data:image/png;base64,{}", BASE64.encode(encode_screen_preview(&image)?)),
        width,
        height,
    };
    *state.capture_cache.write().map_err(err)? = Some(cap.clone());
    Ok(cap)
}

#[tauri::command]
fn capture_output(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    data: String,
    action: String,
) -> Result<()> {
    let bytes = decode_data(&data, 40 * 1024 * 1024)?;
    let image = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(err)?
        .decode()
        .map_err(|_| "无法读取截图图像".to_string())?;
    let (w, h) = image.dimensions();
    if w == 0 || h == 0 || w as u64 * h as u64 > 40_000_000 {
        return Err("截图分辨率超过安全上限".into());
    }
    match action.as_str() {
        "copy" => Clipboard::new()
            .map_err(err)?
            .set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: image.to_rgba8().into_raw().into(),
            })
            .map_err(err)?,
        "base64" => Clipboard::new()
            .map_err(err)?
            .set_text(format!(
                "data:image/png;base64,{}",
                BASE64.encode(encode_png(&image.to_rgba8())?)
            ))
            .map_err(err)?,
        "save" => {
            let Some(path) = rfd::FileDialog::new()
                .set_title("保存截图")
                .set_file_name(format!("Screenshot_{}.png", chrono_stamp()))
                .add_filter("图片", &["png", "jpg", "jpeg", "webp"])
                .save_file()
            else {
                return Ok(());
            };
            let format = match path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png")
                .to_lowercase()
                .as_str()
            {
                "jpg" | "jpeg" => ImageFormat::Jpeg,
                "webp" => ImageFormat::WebP,
                _ => ImageFormat::Png,
            };
            image.save_with_format(path, format).map_err(err)?;
        }
        "ocr" => {
            let text = ocr(&image)?;
            if text.trim().is_empty() {
                return Err("没有识别出文字，请选择文字清晰的区域".into());
            }
            Clipboard::new().map_err(err)?.set_text(text.clone()).map_err(err)?;
            let _ = app.emit("ocr-text", text);
        }
        "pin" => {
            log_info!("capture", "Pin requested: {}x{}, data bytes: {}", w, h, data.len());
            let cap = Capture {
                data: data.clone(),
                width: w,
                height: h,
            };
            *state.capture.write().map_err(err)? = Some(image.to_rgba8());
            *state.capture_cache.write().map_err(err)? = Some(cap.clone());

            let pin_w = (w.clamp(200, 1400)) as f64;
            let pin_h = ((h + 40).clamp(160, 1000)) as f64;

            if let Some(existing) = app.get_webview_window("pin-1") {
                log_info!("capture", "复用现有贴图窗口 pin-1");
                let _ = existing.set_size(tauri::LogicalSize::new(pin_w, pin_h));
                let _ = existing.show();
                let _ = existing.unminimize();
                let _ = existing.set_focus();
                let _ = app.emit("pin-data", cap);
            } else {
                log_info!("capture", "创建全新贴图窗口 pin-1");
                let url = WebviewUrl::App("index.html?pin=1".into());
                let win = WebviewWindowBuilder::new(&app, "pin-1", url)
                    .title("dudu 贴图")
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .inner_size(pin_w, pin_h)
                    .center()
                    .build()
                    .map_err(err)?;
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        _ => return Err("未知图片操作".into()),
    }
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
        let _ = w.set_fullscreen(true);
        let _ = w.set_position(tauri::LogicalPosition::new(0.0, 0.0));
    }
    Ok(())
}

#[tauri::command]
fn edit_pin(app: tauri::AppHandle) -> Result<()> {
    let Some(pin) = app.get_webview_window("pin-1") else {
        return Err("贴图窗口已关闭".into());
    };
    let _ = pin.hide();
    let _ = pin.destroy();
    show_main(&app)
}

#[tauri::command]
fn close_pin(app: tauri::AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window("pin-1") {
        let _ = w.hide();
        let _ = w.destroy();
    }
    Ok(())
}

#[tauri::command]
fn drag_window(app: tauri::AppHandle) -> Result<()> {
    app.get_webview_window("pin-1")
        .ok_or("贴图窗口已关闭")?
        .start_dragging()
        .map_err(err)
}

#[tauri::command]
fn capture_color(app: tauri::AppHandle, color: String) -> Result<()> {
    if color.len() != 7 || !color.starts_with('#') || !color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("无效颜色值".into());
    }
    Clipboard::new().map_err(err)?.set_text(color.clone()).map_err(err)?;
    let _ = app.emit("color", color);
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
fn cancel_capture(app: tauri::AppHandle) -> Result<()> {
    log_info!("capture", "用户取消/退出截图工作台");
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
        let _ = w.set_fullscreen(true);
        let _ = w.set_position(tauri::LogicalPosition::new(0.0, 0.0));
    }
    Ok(())
}

#[tauri::command]
fn set_long_capture_mode(
    app: tauri::AppHandle,
    enabled: bool,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<()> {
    let Some(capture_win) = app.get_webview_window("capture") else {
        return Ok(());
    };
    if enabled {
        let monitors = xcap::Monitor::all().map_err(err)?;
        let primary = monitors
            .iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .unwrap_or(&monitors[0]);
        let screen_w = primary.width() as f64;

        let hud_w = 380.0;
        let hud_h = 720.0;
        let hud_x = if (x + width / 2) as f64 > screen_w / 2.0 {
            24.0
        } else {
            (screen_w - hud_w - 24.0).max(10.0)
        };
        let hud_y = 60.0;

        log_info!("capture", "进入长截图控制台模式: 位置=({}, {}), 尺寸=({}, {})", hud_x, hud_y, hud_w, hud_h);
        let _ = capture_win.set_fullscreen(false);
        let _ = capture_win.set_size(tauri::LogicalSize::new(hud_w, hud_h));
        let _ = capture_win.set_position(tauri::LogicalPosition::new(hud_x, hud_y));
        let _ = capture_win.set_always_on_top(true);
    } else {
        log_info!("capture", "退出长截图模式，截图窗口重置为全屏");
        let _ = capture_win.set_fullscreen(true);
        let _ = capture_win.set_position(tauri::LogicalPosition::new(0.0, 0.0));
    }
    Ok(())
}

#[tauri::command]
fn get_debug_log_path() -> Result<String> {
    Ok(logger::get_primary_log_file().to_string_lossy().to_string())
}

#[tauri::command]
fn get_recent_logs(lines: Option<usize>) -> Result<String> {
    logger::read_recent_logs(lines.unwrap_or(100)).map_err(err)
}

#[tauri::command]
fn clear_debug_log() -> Result<()> {
    logger::clear_logs().map_err(err)
}

#[tauri::command]
fn open_log_folder() -> Result<()> {
    let dir = logger::get_log_dir();
    open::that(dir).map_err(err)
}

#[tauri::command]
fn frontend_log(level: String, tag: String, message: String) -> Result<()> {
    logger::log_raw(&level, &tag, &message);
    Ok(())
}

#[tauri::command]
fn scroll_target_page(delta: i32) -> Result<()> {
    let mut e = Enigo::new(&InputSettings::default()).map_err(err)?;
    e.scroll(delta, Axis::Vertical).map_err(err)
}

#[tauri::command]
fn scroll_and_capture_slice(
    delta: i32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<Capture> {
    if delta != 0 {
        let mut e = Enigo::new(&InputSettings::default()).map_err(err)?;
        let center_x = (x + width / 2) as i32;
        let center_y = (y + height / 2) as i32;
        let _ = e.move_location(center_x, center_y, enigo::Coordinate::Abs);
        let _ = e.scroll(delta, Axis::Vertical);
        std::thread::sleep(std::time::Duration::from_millis(180));
    }

    let monitors = xcap::Monitor::all().map_err(err)?;
    let primary = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(&monitors[0]);
    let img = primary.capture_image().map_err(err)?;

    let sub_w = width.min(img.width().saturating_sub(x));
    let sub_h = height.min(img.height().saturating_sub(y));
    let sub = image::imageops::crop_imm(&img, x, y, sub_w, sub_h).to_image();
    let bytes = encode_png(&sub)?;

    Ok(Capture {
        data: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        width: sub_w,
        height: sub_h,
    })
}

#[tauri::command]
fn hide_main(app: tauri::AppHandle) -> Result<()> {
    app.get_webview_window("main")
        .ok_or("主窗口不可用")?
        .hide()
        .map_err(err)
}

#[tauri::command]
fn list_windows() -> Result<Vec<HashMap<String, serde_json::Value>>> {
    xcap::Window::all().map_err(err).map(|wins| {
        wins.into_iter()
            .filter(|w| {
                w.width().unwrap_or(0) > 80
                    && w.height().unwrap_or(0) > 50
                    && !w.is_minimized().unwrap_or(true)
            })
            .filter_map(|w| {
                let title = w.title().ok()?;
                let id = w.id().ok()?;
                if title.trim().is_empty()
                    || title.to_lowercase().contains("dudu")
                    || title.to_lowercase().contains("program manager")
                {
                    return None;
                }
                let mut x = HashMap::new();
                x.insert("id".into(), id.into());
                x.insert("title".into(), title.into());
                Some(x)
            })
            .collect()
    })
}

#[tauri::command]
fn open_image(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<()> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("打开图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .pick_file()
    else {
        return Ok(());
    };
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > 20 * 1024 * 1024 {
        return Err("图片文件超过 20 MB".into());
    }
    let img = ImageReader::open(&path)
        .map_err(err)?
        .with_guessed_format()
        .map_err(err)?
        .decode()
        .map_err(|_| "无法打开这张图片".to_string())?
        .to_rgba8();
    if img.width() as u64 * img.height() as u64 > 40_000_000 {
        return Err("图片分辨率超过安全上限".into());
    }
    let width = img.width();
    let height = img.height();
    *state.capture.write().map_err(err)? = Some(img.clone());
    let bytes = encode_screen_preview(&img)?;
    let cap = Capture {
        data: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        width,
        height,
    };
    *state.capture_cache.write().map_err(err)? = Some(cap.clone());
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if let Some(existing) = app.get_webview_window("capture") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let _ = existing.emit("capture-ready", cap.clone());
    } else {
        let url = WebviewUrl::App("index.html?overlay=image".into());
        let win = WebviewWindowBuilder::new(&app, "capture", url)
            .title("dudu 截图工作台")
            .decorations(false)
            .always_on_top(true)
            .inner_size(width.min(1200) as f64, height.min(850) as f64)
            .center()
            .build()
            .map_err(err)?;
        let _ = win.set_focus();
    }
    let _ = app.emit("capture-ready", cap);
    Ok(())
}

#[tauri::command]
fn clear_history(state: tauri::State<'_, AppState>) -> Result<()> {
    state.db.lock().map_err(err)?.clear()
}

#[tauri::command]
fn export_data(state: tauri::State<'_, AppState>) -> Result<()> {
    let clips = state.clips(true)?;
    let settings = state.settings()?;
    let translations = state.db.lock().map_err(err)?.history()?;
    let content = serde_json::json!({
        "schemaVersion": 1,
        "exportedAt": now(),
        "settings": settings,
        "clipboard": clips,
        "translations": translations
    });
    let bytes = serde_json::to_vec_pretty(&content).map_err(err)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("备份超过 64 MB".into());
    }
    if let Some(path) = rfd::FileDialog::new()
        .set_title("导出 dudu 备份（内容未加密）")
        .set_file_name(format!("dudu-backup-{}.json", chrono_stamp()))
        .add_filter("JSON 文件", &["json"])
        .save_file()
    {
        std::fs::write(path, bytes).map_err(err)?
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    schema_version: u32,
    clipboard: Vec<Clip>,
    translations: Vec<Translation>,
    settings: Settings,
}

#[tauri::command]
fn import_data(state: tauri::State<'_, AppState>) -> Result<Vec<Clip>> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("导入 dudu 备份")
        .add_filter("JSON 文件", &["json"])
        .pick_file()
    else {
        return state.clips(false);
    };
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("备份超过 64 MB".into());
    }
    let raw = std::fs::read(path).map_err(err)?;
    let backup: Backup = serde_json::from_slice(&raw)
        .map_err(|_| "备份文件格式错误或版本不兼容".to_string())?;
    if backup.schema_version != 1 || backup.clipboard.len() > 5000 || backup.translations.len() > 30 {
        return Err("备份版本不兼容或包含过多记录".into());
    }
    backup.settings.validate()?;
    let db = state.db.lock().map_err(err)?;
    for c in backup.clipboard {
        if c.id.is_empty()
            || c.id.len() > 64
            || !['t', 'i']
                .iter()
                .any(|_| c.kind == "text" || c.kind == "image")
            || c.content.len() > 20 * 1024 * 1024
            || c.source.len() > 512
            || c.title.len() > 512
        {
            return Err("备份中包含不合法记录".into());
        }
        let preview = if c.kind == "image" {
            image_preview(&c.content)?
        } else {
            c.content.clone()
        };
        db.insert(&c, &preview, backup.settings.limit)?;
    }
    for t in backup.translations {
        if t.id.len() > 128 || t.text.len() > 40_000 || t.result.len() > 120_000 {
            return Err("翻译历史记录超出大小限制".into());
        }
        db.cache(&t)?;
    }
    db.save_settings(&backup.settings)?;
    drop(db);
    *state.settings.lock().map_err(err)? = backup.settings;
    state.clips(false)
}

fn image_preview(content: &str) -> Result<String> {
    let data = decode_data(content, 20 * 1024 * 1024)?;
    let img = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(err)?
        .decode()
        .map_err(|_| "图片记录损坏".to_string())?;
    if img.width() as u64 * img.height() as u64 > 40_000_000 {
        return Err("备份中的图片分辨率超限".into())
    }
    let thumbnail = img.thumbnail(320, 200).to_rgba8();
    let mut data = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(thumbnail)
        .write_to(&mut data, ImageFormat::Png)
        .map_err(err)?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(data.into_inner())))
}

fn chrono_stamp() -> String {
    now().to_string()
}

#[cfg(windows)]
fn ocr(image: &DynamicImage) -> Result<String> {
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };
    let mut stream = InMemoryRandomAccessStream::new().map_err(err)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(err)?;
    let mut cursor = Cursor::new(Vec::new());
    image.write_to(&mut cursor, ImageFormat::Png).map_err(err)?;
    writer.WriteBytes(&cursor.into_inner()).map_err(err)?;
    writer.StoreAsync().map_err(err)?.get().map_err(err)?;
    writer.FlushAsync().map_err(err)?.get().map_err(err)?;
    stream.Seek(0).map_err(err)?;
    let decoder = BitmapDecoder::CreateAsync(&stream).map_err(err)?.get().map_err(err)?;
    let bitmap = decoder.GetSoftwareBitmapAsync().map_err(err)?.get().map_err(err)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(err)?;
    let result = engine.RecognizeAsync(&bitmap).map_err(err)?.get().map_err(err)?;
    Ok(result.Text().map_err(err)?.to_string())
}

#[cfg(target_os = "macos")]
fn ocr(image: &DynamicImage) -> Result<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut helper = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("native/dudu-native");
    if !helper.exists() {
        if let Ok(exe_dir) = std::env::current_exe() {
            if let Some(parent) = exe_dir.parent() {
                let candidate = parent.join("native/dudu-native");
                if candidate.exists() {
                    helper = candidate;
                } else {
                    let res_candidate = parent.join("../Resources/native/dudu-native");
                    if res_candidate.exists() {
                        helper = res_candidate;
                    }
                }
            }
        }
    }
    let mut child = Command::new(&helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "屏幕文字识别组件未安装，请重新安装 dudu".to_string())?;
    let mut png = Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).map_err(err)?;
    child
        .stdin
        .take()
        .ok_or("OCR helper stdin unavailable")?
        .write_all(&png.into_inner())
        .map_err(err)?;
    let output = child.wait_with_output().map_err(err)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8(output.stdout).map_err(err)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn ocr(_: &DynamicImage) -> Result<String> {
    Err("此版本仅提供 Windows 和 macOS OCR".into())
}

fn start_listener(app: tauri::AppHandle, db_path: PathBuf) {
    std::thread::Builder::new()
        .name("dudu-clipboard".into())
        .spawn(move || {
            let _ = db_path;
            let Ok(mut clipboard) = Clipboard::new() else { return };
            let mut last_text = String::new();
            let mut last_image = String::new();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(600));
                let Some(state) = app.try_state::<AppState>() else { break };
                let Ok(settings) = state.settings() else { continue };
                if settings.paused || !settings.consent {
                    continue;
                }
                if let Ok(text) = clipboard.get_text() {
                    let text = text.trim_end_matches('\0').to_owned();
                    if !text.trim().is_empty()
                        && text.len() <= 128 * 1024
                        && text != last_text
                    {
                        let source = foreground_app();
                        if !settings.permits(&source, &text) {
                            last_text = text;
                            continue;
                        }
                        let c = Clip {
                            id: uuid::Uuid::new_v4().to_string(),
                            kind: "text".into(),
                            title: text
                                .lines()
                                .next()
                                .unwrap_or("")
                                .chars()
                                .take(80)
                                .collect(),
                            content: text.clone(),
                            source: source.clone(),
                            created: now(),
                            favorite: false,
                        };
                        if let Some(s) = app.try_state::<AppState>() {
                            if let Ok(db) = s.db.lock() {
                                if !db.is_recent_duplicate("text", &text, 300_000) {
                                    let _ = db.insert(&c, "", settings.limit);
                                    last_text = text.clone();
                                    let _ = app.emit("clips", s.clips(false).unwrap_or_default());
                                }
                            }
                        }
                    }
                } else if settings.capture_images {
                    if let Ok(img) = clipboard.get_image() {
                        let hash = format!("{:x}", Sha256::digest(img.bytes.as_ref()));
                        if hash != last_image
                            && img.width > 0
                            && img.height > 0
                            && img.width.saturating_mul(img.height) <= 40_000_000
                            && img.bytes.len() <= 20 * 1024 * 1024
                        {
                            let source = foreground_app();
                            if !settings.permits(&source, "") {
                                last_image = hash;
                                continue;
                            }
                            let rgba = match RgbaImage::from_raw(
                                img.width as u32,
                                img.height as u32,
                                img.bytes.into_owned(),
                            ) {
                                Some(v) => v,
                                None => continue,
                            };
                            let mut png = Cursor::new(Vec::new());
                            if DynamicImage::ImageRgba8(rgba)
                                .write_to(&mut png, ImageFormat::Png)
                                .is_ok()
                            {
                                let data = format!(
                                    "data:image/png;base64,{}",
                                    BASE64.encode(png.into_inner())
                                );
                                let c = Clip {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    kind: "image".into(),
                                    content: data.clone(),
                                    title: "截图图片".into(),
                                    source: source.clone(),
                                    created: now(),
                                    favorite: false,
                                };
                                let preview = image_preview(&data).unwrap_or_default();
                                if let Some(s) = app.try_state::<AppState>() {
                                    if let Ok(db) = s.db.lock() {
                                        if db.insert(&c, &preview, settings.limit).is_ok() {
                                            last_image = hash;
                                            let _ = app.emit(
                                                "clips",
                                                s.clips(false).unwrap_or_default(),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
        .ok();
}

#[cfg(windows)]
fn foreground_app() -> String {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return String::new();
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    if pid == 0 || pid == unsafe { GetCurrentProcessId() } {
        return String::new();
    }
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return String::new();
    };
    let mut path_buf = [0u16; 1024];
    let mut len = path_buf.len() as u32;
    let res = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(path_buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    if res.is_ok() && len > 0 {
        let full_path = String::from_utf16_lossy(&path_buf[..len as usize]);
        if let Some(file_name) = std::path::Path::new(&full_path).file_name() {
            return file_name.to_string_lossy().to_string();
        }
    }
    String::new()
}

#[cfg(target_os = "macos")]
fn foreground_app() -> String {
    String::new()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn foreground_app() -> String {
    String::new()
}

fn create_tray_menu<M: tauri::Manager<R>, R: tauri::Runtime>(
    manager: &M,
    settings: &Settings,
) -> tauri::Result<Menu<R>> {
    let get_sc = |k: &str| -> String {
        settings.shortcuts.get(k).cloned().unwrap_or_default()
    };

    let sc_region = get_sc("region");
    let sc_window = get_sc("window");
    let sc_fullscreen = get_sc("fullscreen");
    let sc_color = get_sc("color");
    let sc_translate = get_sc("translate");
    let sc_selection = get_sc("selection");
    let sc_clipboard = get_sc("clipboard");

    let title_region = if sc_region.is_empty() { "区域截图".into() } else { format!("区域截图 ({})", sc_region) };
    let title_window = if sc_window.is_empty() { "窗口截图".into() } else { format!("窗口截图 ({})", sc_window) };
    let title_fullscreen = if sc_fullscreen.is_empty() { "全屏截图".into() } else { format!("全屏截图 ({})", sc_fullscreen) };
    let title_color = if sc_color.is_empty() { "屏幕取色".into() } else { format!("屏幕取色 ({})", sc_color) };
    let title_translate = if sc_translate.is_empty() { "输入翻译".into() } else { format!("输入翻译 ({})", sc_translate) };
    let title_selection = if sc_selection.is_empty() { "划词翻译".into() } else { format!("划词翻译 ({})", sc_selection) };
    let title_clipboard = if sc_clipboard.is_empty() { "剪贴板历史".into() } else { format!("剪贴板历史 ({})", sc_clipboard) };
    let title_pause = if settings.paused { "继续剪贴板记录" } else { "暂停剪贴板记录" };

    let item_region = MenuItem::with_id(manager, "region", title_region, true, None::<&str>)?;
    let item_window = MenuItem::with_id(manager, "window", title_window, true, None::<&str>)?;
    let item_fullscreen = MenuItem::with_id(manager, "fullscreen", title_fullscreen, true, None::<&str>)?;
    let item_color = MenuItem::with_id(manager, "color", title_color, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(manager)?;
    let item_translate = MenuItem::with_id(manager, "translate", title_translate, true, None::<&str>)?;
    let item_selection = MenuItem::with_id(manager, "selection", title_selection, true, None::<&str>)?;
    let item_clipboard = MenuItem::with_id(manager, "clipboard", title_clipboard, true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(manager)?;
    let item_settings = MenuItem::with_id(manager, "settings", "偏好设置", true, None::<&str>)?;
    let item_pause = MenuItem::with_id(manager, "pause", title_pause, true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(manager)?;
    let item_quit = MenuItem::with_id(manager, "quit", "退出 dudu", true, None::<&str>)?;

    Menu::with_items(
        manager,
        &[
            &item_region,
            &item_window,
            &item_fullscreen,
            &item_color,
            &sep1,
            &item_translate,
            &item_selection,
            &item_clipboard,
            &sep2,
            &item_settings,
            &item_pause,
            &sep3,
            &item_quit,
        ],
    )
}

fn refresh_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>, settings: &Settings) -> Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = create_tray_menu(app, settings) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    Ok(())
}

fn build_tray<R: tauri::Runtime>(app: &tauri::App<R>, settings: &Settings) -> tauri::Result<()> {
    let menu = create_tray_menu(app, settings)?;
    let icon = TauriImage::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("dudu · 桌面效率工作台")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "region" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = capture_start(&a, "region", 0, None);
                });
            }
            "window" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = capture_start(&a, "window", 0, None);
                });
            }
            "fullscreen" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = capture_start(&a, "fullscreen", 0, None);
                });
            }
            "color" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = capture_start(&a, "color", 0, None);
                });
            }
            "translate" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = show_quick_translate(&a, None);
                });
            }
            "selection" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let text = selected_text().ok();
                    let _ = show_quick_translate(&a, text);
                });
            }
            "clipboard" => {
                let _ = app.emit("navigate", "clipboard");
                let _ = show_main(app);
            }
            "settings" => {
                let _ = app.emit("navigate", "settings");
                let _ = show_main(app);
            }
            "pause" => {
                let state = app.state::<AppState>();
                if let Ok(mut s) = state.settings() {
                    s.paused = !s.paused;
                    let _ = state.save(s.clone());
                    let _ = refresh_tray(app, &s);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            logger::init_logger();
            let base = app
                .path()
                .app_data_dir()
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            std::fs::create_dir_all(&base)?;
            let db_path = base.join("dudu.db");
            let database = store::Store::open(&db_path).map_err(|e| {
                std::io::Error::other(format!("无法安全打开本地数据库：{e}"))
            })?;
            let settings = database.settings().map_err(|e| std::io::Error::other(e))?;
            app.manage(AppState {
                db: Mutex::new(database),
                settings: Mutex::new(settings.clone()),
                capture: RwLock::new(None),
                capture_cache: RwLock::new(None),
                data_dir: base.clone(),
            });
            let icon_errors = register_shortcuts(app.handle(), &settings);
            let _ = build_tray(app, &settings);
            if !icon_errors.is_empty() {
                let _ = app.emit(
                    "error",
                    format!("部分快捷键被其他应用占用：{}", icon_errors.join("；")),
                );
            }
            start_listener(app.handle().clone(), db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            get_settings,
            save_settings,
            list_clips,
            favorite_clip,
            delete_clip,
            edit_clip,
            copy_clip,
            paste_clip,
            serial_paste,
            write_text,
            translation_history,
            translate,
            hide_quick_translate,
            set_quick_translate_pin,
            open_settings_window,
            start_capture,
            pending_capture,
            capture_output,
            edit_pin,
            close_pin,
            drag_window,
            capture_color,
            cancel_capture,
            set_long_capture_mode,
            scroll_target_page,
            scroll_and_capture_slice,
            hide_main,
            list_windows,
            open_image,
            clear_history,
            export_data,
            import_data,
            quit_app,
            open_project,
            open_releases,
            open_external,
            get_debug_log_path,
            get_recent_logs,
            clear_debug_log,
            open_log_folder,
            frontend_log
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("dudu failed to start");
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0)
}

#[tauri::command]
fn open_project() -> Result<()> {
    open::that("https://github.com/muzi86754781/dudu").map_err(err)
}

#[tauri::command]
fn open_releases() -> Result<()> {
    open::that("https://github.com/muzi86754781/dudu/releases").map_err(err)
}

#[tauri::command]
fn open_external(url: String) -> Result<()> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持打开网页链接".into());
    }
    open::that(url).map_err(err)
}
