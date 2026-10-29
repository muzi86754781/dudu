use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Result<T> = std::result::Result<T, String>;

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub created: i64,
    pub favorite: bool,
    pub title: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Translation {
    pub id: String,
    pub text: String,
    pub result: String,
    pub engine: String,
    pub from: String,
    pub to: String,
    pub created: i64,
    pub cached: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub consent: bool,
    pub paused: bool,
    pub limit: usize,
    pub capture_images: bool,
    pub ignore_apps: String,
    pub ignore_words: String,
    pub theme: String,
    pub engine: String,
    pub target: String,
    pub deepl_key: String,
    pub baidu_id: String,
    pub baidu_key: String,
    pub youdao_key: String,
    pub youdao_secret: String,
    pub timeout: u64,
    pub autostart: bool,
    pub save_format: String,
    pub auto_copy: bool,
    pub silent_ocr: bool,
    pub silent_translate: bool,
    pub clipboard_translate: bool,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        let modifier = if cfg!(target_os = "macos") {
            "Super+Shift"
        } else {
            "Ctrl+Alt"
        };
        let shortcuts = [
            ("region", "A"),
            ("window", "W"),
            ("fullscreen", "F"),
            ("selection", "D"),
            ("ocr", "S"),
            ("translate", "T"),
            ("clipboard", "V"),
            ("color", "C"),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), format!("{modifier}+{v}")))
        .collect();

        Self {
            consent: false,
            paused: false,
            limit: 500,
            capture_images: true,
            ignore_apps: "1password,bitwarden,keepass,lastpass,dashlane,密码".into(),
            ignore_words: String::new(),
            theme: "system".into(),
            engine: "google".into(),
            target: "zh-CN".into(),
            deepl_key: String::new(),
            baidu_id: String::new(),
            baidu_key: String::new(),
            youdao_key: String::new(),
            youdao_secret: String::new(),
            timeout: 15,
            autostart: false,
            save_format: "png".into(),
            auto_copy: true,
            silent_ocr: false,
            silent_translate: false,
            clipboard_translate: false,
            shortcuts,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<()> {
        if !(100..=5000).contains(&self.limit) {
            return Err("历史条数应为 100～5000".into());
        }
        if !(3..=60).contains(&self.timeout) {
            return Err("请求超时应为 3～60 秒".into());
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            return Err("无效主题".into());
        }
        if !["google", "deepl", "baidu", "youdao"].contains(&self.engine.as_str()) {
            return Err("无效翻译引擎".into());
        }
        let expected = Self::default().shortcuts;
        if self.shortcuts.keys().ne(expected.keys()) {
            return Err("快捷键配置不完整".into());
        }
        let mut seen = std::collections::HashSet::new();
        for value in self.shortcuts.values() {
            if !value.contains('+') || !seen.insert(value.to_lowercase().replace(' ', "")) {
                return Err("快捷键格式错误或存在重复".into());
            }
            value
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .map_err(err)?;
        }
        Ok(())
    }

    pub fn permits(&self, source: &str, text: &str) -> bool {
        self.consent
            && !self.paused
            && !source.trim().is_empty()
            && !contains_word(&self.ignore_apps, source)
            && !contains_word(&self.ignore_words, text)
    }
}

fn contains_word(list: &str, text: &str) -> bool {
    let text = text.to_lowercase();
    list.split([',', '，', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|s| text.contains(&s.to_lowercase()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ready: bool,
    pub error: String,
    pub shortcut_errors: Vec<String>,
    pub version: String,
    pub platform: String,
}

#[derive(Clone, Serialize)]
pub struct Capture {
    pub data: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStatus {
    pub enabled: bool,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn privacy_is_opt_in() {
        let mut s = Settings::default();
        assert!(!s.permits("Editor", "hello"));
        s.consent = true;
        assert!(s.permits("Editor", "hello"));
        assert!(!s.permits("Bitwarden", "secret"));
        assert!(!s.permits("", "text"));
        s.ignore_words = "secret,私密".into();
        assert!(!s.permits("Editor", "a SECRET"));
        s.paused = true;
        assert!(!s.permits("Editor", "hi"));
    }

    #[test]
    fn validates_configuration() {
        let mut s = Settings::default();
        assert!(s.validate().is_ok());
        s.limit = 99;
        assert!(s.validate().is_err());
        s.limit = 500;
        s.shortcuts.insert("region".into(), s.shortcuts["ocr"].clone());
        assert!(s.validate().is_err());
    }
}
