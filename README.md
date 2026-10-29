# dudu · 桌面效率工作台

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="108" height="108" alt="dudu logo" />
</p>

<p align="center">
  <strong>截图 · 翻译 · 剪贴板历史一体化 桌面效率工具</strong>
</p>

<p align="center">
  <a href="https://github.com/muzi86754781/dudu/actions"><img src="https://img.shields.io/github/actions/workflow/status/muzi86754781/dudu/build-and-release.yml?branch=main&label=Build%20%26%20Release&logo=github" alt="Build Status"></a>
  <a href="https://github.com/muzi86754781/dudu/releases"><img src="https://img.shields.io/github/v/release/muzi86754781/dudu?color=3b6e54&label=Release" alt="Latest Release"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-40735a" alt="Platform Support">
  <img src="https://img.shields.io/badge/Security-SQLCipher%20Encrypted-27ae60" alt="Security">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
</p>

---

## 1. 产品定位与核心价值

**dudu** 是一款面向知识工作者与开发者的跨平台桌面常驻效率工具。它将日常高频使用的 **截图标注**、**文本/划词翻译与 OCR**、**剪贴板历史管理** 深度整合为一体。

- **即时响应**：全局快捷键随时唤起，即开即用、即用即走，无需等待主窗口加载。
- **本地优先**：所有复制的历史内容、翻译缓存与加密密钥均留存于本机，数据库采用 **SQLCipher** 加密、密钥由系统凭据库保管，绝不上云、零行为追踪（仅翻译请求会按用户主动操作访问对应翻译引擎服务）。
- **开箱即用**：无需繁琐配置，内置系统级离线 OCR 与免配置翻译引擎；首次运行仅需一次隐私授权确认。

---

## 2. 核心功能矩阵

### 📸 截图与标注工作台
- **多种采集模式**：
  - **区域截图**（默认 `Ctrl+Alt+A` / `Cmd+Shift+A`）：拖拽精准选区，实时显示物理像素尺寸与选区提示。
  - **窗口截图**（默认 `Ctrl+Alt+W` / `Cmd+Shift+W`）：从当前已打开的窗口列表中选择目标窗口，一键捕获。
  - **全屏截图**（默认 `Ctrl+Alt+F` / `Cmd+Shift+F`）：捕获光标所在显示器完整画面，多屏下自动跟随光标位置（无法定位光标时回退主显示器）。
  - **延时截图**：支持 3s / 5s / 10s 倒计时截图（主面板「截图」页入口），适合捕获临时下拉菜单或悬停 Tooltip。
- **标注工具套件**（浮动工具栏点选）：
  - 矩形、椭圆、箭头、自由手绘画笔。
  - 文字标注（单行输入，自适应字号）、步骤序号（自动 1/2/3 递增）。
  - 敏感信息马赛克涂抹。
  - **标注撤销 / 重做**（`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`）：仅作用于标注图形，上限 100 条。
- **即时操作面板**：
  - 一键复制图片到剪贴板、另存为文件（PNG / JPG / WebP）。
  - **屏幕钉（贴图）**：将截图置顶钉在屏幕前端，支持缩放、透明度调节、拖拽移动与双击回到编辑器继续标注。
  - **屏幕取色器**（`Ctrl+Alt+C` / `Cmd+Shift+C`）：光标悬浮实时显示放大镜网格（15×15），呈现 HEX 与 RGB 色值，移动到目标色值后按 `C` 键复制到剪贴板。
  - **长截图拼接**：自动滚动截取目标页面并逐段拼接为长图，完成后可复制或另存为图片文件。

### 🌐 翻译与 OCR 识别
- **多元触发**：
  - **划词翻译**（默认 `Ctrl+Alt+D` / `Cmd+D`）：在任意软件选中文字后按下快捷键，自动带入原文并翻译。
  - **截图 OCR**（默认 `Ctrl+Alt+S` / `Cmd+S`）：框选屏幕任意区域，通过系统原生离线引擎识别提取文本（Windows 为 Media OCR；macOS 依赖系统 Vision 组件）。
  - **输入翻译**（默认 `Ctrl+Alt+T` / `Cmd+A`）：主面板手动输入或粘贴长文本翻译。
- **多引擎支持与缓存**：
  - 内置 Google 翻译（免配置，但在部分网络环境下不可达，此时请在设置中切换引擎）；支持填入 DeepL Free、百度翻译、有道智云的自有 API 密钥。
  - 24 小时本地加密缓存，相同文本再次翻译秒级返回，减少不必要的网络请求。
  - **默认中英互译智能配对**：目标语言选择「自动」时，中文输入 → 英文译文、英文输入 → 简体中文译文（日文等其余语言兜底简体中文）；也可在设置中手动固定目标语言。
- **程序员效率增强**：
  - **代码命名拆分与转换**：一键将 `camelCase`、`PascalCase`、`snake_case`、`kebab-case`、`SCREAMING_SNAKE` 互转互拆。
  - **常用词速查词典**：内置程序员高频词表，单词查询返回音标、词性与中文释义。
  - **语音朗读（TTS）**：支持译文发音朗读（依赖系统语音包）。

### 📋 剪贴板历史管理
- **全格式自动捕获**：
  - 自动记录复制的纯文本、代码与图片（富文本内容仅提取纯文本），图片以缩略图形式入库；Windows 下复制文件时同步记录文件路径列表（不含文件内容）。
  - **去重与合并**：内容相同不重复记录，5 分钟内重复操作自动合并。
  - **隐私白名单与忽略过滤**：默认自动识别并跳过**桌面端**密码管理器（1Password、Bitwarden、KeePass 等，依据前台进程名匹配）；在**浏览器中使用的网页版**密码管理器无法识别，复制前请留意来源。支持用户自定义敏感词黑名单。
  - **macOS 平台**：剪贴板记录已恢复，需在「系统设置 → 隐私与安全性 → 辅助功能」授权 dudu；未授权时不记录并在面板顶部提示。截图另需「屏幕录制」授权。Windows 不受影响。
- **便捷调用与键盘导航**：
  - 全局快捷键呼出面板（默认 `Ctrl+Alt+V` / `Cmd+Shift+V`）。
  - 方向键选择，回车（Enter）自动写入系统剪贴板并模拟粘贴到当前焦点窗口。
  - 数字键 `Alt + 1~9` 快速选取对应条目。
  - **连续合并粘贴（Serial Paste）**：支持勾选多个历史片段，按顺序组合（换行符、Tab 制表符、空格分隔）一次性批量粘贴。
- **检索与备份**：
  - 即时子串检索，关键词高亮展示。
  - 收藏片段固定置顶，不会被历史容量规则淘汰。
  - 支持将全部数据与配置导出为 JSON 备份或从备份文件恢复（备份含剪贴板明文，导出时请勿外传；翻译 API 密钥自 v0.1.8 起不再导出）。

---

## 3. 全局默认快捷键速查表

| 功能操作 | Windows 快捷键 | macOS 快捷键 | 可否自定义 |
| :--- | :--- | :--- | :---: |
| **区域截图** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>A</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd> | 是 |
| **窗口截图** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>W</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>W</kbd> | 是 |
| **全屏截图** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> | 是 |
| **划词翻译** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>D</kbd> | <kbd>Cmd</kbd> + <kbd>D</kbd> | 是 |
| **截图 OCR** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>S</kbd> | <kbd>Cmd</kbd> + <kbd>S</kbd> | 是 |
| **输入翻译面板** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> | <kbd>Cmd</kbd> + <kbd>A</kbd> | 是 |
| **剪贴板历史** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>V</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> | 是 |
| **屏幕取色器** | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | 是 |

*注：若快捷键与系统或微信、QQ 等现有软件冲突，可在「偏好设置 → 全局快捷键」中重新自定义，保存时会自动进行冲突检测。*

---

## 4. 技术架构与安全性

```mermaid
graph TD
    UI["前端 UI (React 19 + TypeScript + Vite)"]
    IPC["Tauri 2 IPC 双向桥接"]
    Core["Rust 核心常驻服务 (Tauri 2.x)"]
    DB[("本地 SQLCipher 数据库")]
    Keyring["系统凭据库 (Windows DPAPI / macOS Keychain)"]
    NativeCapture["屏幕捕获层 (xcap / ScreenCaptureKit / BitBlt)"]
    NativeOCR["离线 OCR 层 (Windows Media OCR / macOS Vision)"]
    Clipboard["剪贴板监听与模拟 (arboard + enigo)"]

    UI <--> IPC
    IPC <--> Core
    Core --> DB
    DB <--> Keyring
    Core --> NativeCapture
    Core --> NativeOCR
    Core --> Clipboard
```

- **底层引擎**：Tauri 2.x + Rust 2021 Edition，轻量常驻后台。
- **存储加密**：SQLCipher 数据库密钥由系统安全凭据管理（Windows Credential Manager / macOS Keychain）派发，密钥丢失时拒绝重建数据库、保护既有数据。
- **权限需求说明**：
  - **macOS**：初次运行截图需授予「屏幕录制」权限；模拟快捷键输入需授予「辅助功能」权限。
  - **Windows**：开机自启通过标准注册表 Run 项注册，可自由开关。

---

## 5. 本地开发与构建

### 运行环境准备
- **Node.js**：v20 或更高版本
- **Rust**：1.78 或更高版本
- **Windows**：Visual Studio C++ 生成工具 + NASM + Strawberry Perl（用于编译 OpenSSL/SQLCipher）
- **macOS**：Xcode Command Line Tools（包含 swiftc）

### 开发命令

```bash
# 1. 安装前端依赖
npm install

# 2. 运行前端单元测试
npm test

# 3. 启动开发模式（热重载）
npm run dev

# 4. 前端构建检查
npm run build
```

---

## 6. GitHub Actions 自动化编译发布

本项目已配置 GitHub Actions 流水线（`.github/workflows/build-and-release.yml`）。
在推送代码至 `main` 分支或创建 `v*` Tag 时，GitHub Actions 会自动编译并打包全平台安装包：

- **Windows x64**：
  - `dudu-x64-setup.exe`（NSIS 快速安装器）
  - `dudu.msi`（企业级 Windows Installer）
- **macOS (Apple Silicon arm64)**：
  - `dudu-aarch64.dmg`
- **macOS (Intel x86_64)**：
  - `dudu-x64.dmg`

编译完成后，安装包将自动挂载至该次 Workflow Run 的 **Artifacts**，并同步自动生成对应的 **GitHub Release** 版本。

---

## 7. 许可证

本项目基于 [MIT License](LICENSE) 开源。
