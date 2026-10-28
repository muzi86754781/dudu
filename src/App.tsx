import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Clipboard,
  ScanLine,
  Languages,
  Settings as SettingsIcon,
  BookOpen,
  Search,
  Star,
  Copy,
  Trash2,
  Pause,
  Play,
  ArrowUpRight,
  Command,
  Image as ImageIcon,
  FileText,
  Download,
  Upload,
  Check,
  ShieldCheck,
  ChevronRight,
  X,
  Volume2,
  ArrowLeftRight,
  Camera,
  Clock,
  Monitor,
  Pin,
  Keyboard,
  Sun,
  Moon,
  RefreshCw,
  Scissors,
  ExternalLink,
  BookA,
  Code2,
} from 'lucide-react';
import { call, desktop, on } from './bridge';
import {
  defaults,
  filterClips,
  shortcutLabels,
  splitIdentifier,
  getIdentifierVariants,
  lookupDictionary,
  validateSettings,
  type Clip,
  type Settings,
  type Status,
  type Page,
  type Translation,
  type DictEntry,
} from './model';
import CaptureEditor from './CaptureEditor';
import QuickTranslate from './QuickTranslate';

const nav = [
  ['clipboard', Clipboard, '剪贴板'],
  ['capture', ScanLine, '截图工作台'],
  ['translate', Languages, '翻译与识别'],
] as const;

export default function App() {
  const [page, setPage] = useState<Page>('clipboard');
  const [clips, setClips] = useState<Clip[]>([]);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [draft, setDraft] = useState<Settings>(defaults);
  const [status, setStatus] = useState<Status>({
    ready: false,
    error: '',
    shortcutErrors: [],
    version: '0.1.5',
    platform: '',
  });
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [consent, setConsent] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState('auto');
  const [to, setTo] = useState('zh-CN');
  const [engine, setEngine] = useState('google');
  const [history, setHistory] = useState<Translation[]>([]);
  const [edit, setEdit] = useState<Clip | null>(null);
  const [delay, setDelay] = useState(0);
  const [windows, setWindows] = useState<{ id: number; title: string }[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [serialSeparator, setSerialSeparator] = useState('\n');

  const serial = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = (s: string) => {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  };

  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const value = await fn();
      if (success) notify(success);
      return value;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    if (!desktop) return;
    try {
      const [s, c, st, h] = await Promise.all([
        call<Settings>('get_settings'),
        call<Clip[]>('list_clips'),
        call<Status>('status'),
        call<Translation[]>('translation_history'),
      ]);
      setSettings(s);
      setDraft(s);
      setConsent(!s.consent);
      setClips(c);
      setStatus(st);
      setHistory(h);
      setEngine(s.engine);
      setTo(s.target);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const cleanups: Promise<() => void>[] = [
      on<Clip[]>('clips', setClips),
      on<string>('navigate', p => {
        setPage(p as Page);
        setError('');
      }),
      on<string>('selected-text', t => {
        setSource(t);
        setPage('translate');
      }),
      on<string>('ocr-text', t => {
        setSource(t);
        setPage('translate');
        notify('文字识别完成');
      }),
      on<string>('error', setError),
      on<string>('color', c => {
        setColors(prev => [c, ...prev.filter(x => x !== c)].slice(0, 10));
        notify(`已复制 ${c}`);
      }),
    ];
    return () => {
      cleanups.forEach(p => void p.then(f => f()));
      clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const visible = useMemo(() => filterClips(clips, q, filter), [clips, q, filter]);

  useEffect(() => {
    setActive(0);
  }, [q, filter]);

  async function paste(clip: Clip) {
    await run(() => call('paste_clip', { id: clip.id }), '已粘贴');
  }

  // Keyboard navigation for clipboard list
  useEffect(() => {
    if (page !== 'clipboard' || consent || edit) return;
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches('input,textarea,select') &&
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'Enter'
      )
        return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(i => Math.min(i + 1, visible.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && visible[active]) {
        e.preventDefault();
        void paste(visible[active]);
      }
      if (e.altKey && /^[1-9]$/.test(e.key) && visible[+e.key - 1]) {
        e.preventDefault();
        void paste(visible[+e.key - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, visible, active, consent, edit, busy]);

  // Esc hides main window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && desktop) void call('hide_main');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function save(s: Settings) {
    const msg = validateSettings(s);
    if (msg) {
      setError(msg);
      return;
    }
    const st = await run(() => call<Status>('save_settings', { settings: s }), '设置已保存');
    if (st) {
      setSettings(s);
      setDraft(s);
      setStatus(st);
      if (st.shortcutErrors.length) setError(st.shortcutErrors.join('；'));
    }
  }

  async function capture(mode: string, id?: number) {
    await run(() => call('start_capture', { mode, delay, windowId: id ?? null }));
  }

  async function translate() {
    if (!source.trim()) return;
    const token = ++serial.current;
    const tr = await run(() => call<Translation>('translate', { text: source, from, to, engine }));
    if (tr && token === serial.current) {
      setResult(tr.result);
      setHistory(await call<Translation[]>('translation_history'));
      notify(tr.cached ? '已读取本地缓存' : '翻译完成');
    }
  }

  // Developer dictionary entry for current word
  const dictEntry: DictEntry | null = useMemo(() => {
    const trimmed = source.trim();
    if (/^[a-zA-Z_-]+$/.test(trimmed) && trimmed.length <= 30) {
      return lookupDictionary(trimmed);
    }
    return null;
  }, [source]);

  // Identifier casing variants
  const identifierVariants = useMemo(() => {
    const trimmed = source.trim();
    if (/^[a-zA-Z0-9_\-\s]+$/.test(trimmed) && trimmed.length <= 80 && trimmed.length > 2) {
      return getIdentifierVariants(trimmed);
    }
    return null;
  }, [source]);

  const route = new URLSearchParams(location.search);
  if (route.has('quick-translate')) return <QuickTranslate />;
  if (route.has('overlay')) return <CaptureEditor mode={route.get('overlay')!} />;
  if (route.has('pin')) return <CaptureEditor mode="pin" />;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('clipboard')} aria-label="dudu 首页">
          <span className="brand-mark">
            d<span>u</span>
          </span>
          <strong>
            dudu<span>桌面效率工作台</span>
          </strong>
        </button>

        <div className="space-label">效率工作空间</div>
        <nav>
          {nav.map(([id, Icon, title]) => (
            <button
              key={id}
              className={page === id ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setPage(id);
                setError('');
              }}
            >
              <Icon size={19} />
              {title}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="note-icon">
            <ShieldCheck size={19} />
          </span>
          <strong>
            灵感留在这里，
            <br />
            数据留在本机。
          </strong>
          <p>
            SQLCipher 加密存储，无云端同步。
            <br />
            快捷高效，保护你的每一份隐私。
          </p>
        </div>

        <div className="sidebar-bottom">
          <button
            className={page === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('settings')}
          >
            <SettingsIcon size={18} />
            偏好设置
          </button>
          <button
            className={page === 'help' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('help')}
          >
            <BookOpen size={18} />
            使用指南
          </button>
          <div className="version">
            <span className={desktop && status.ready ? 'status-dot' : 'status-dot muted'} />{' '}
            {desktop ? '本地工作空间' : '网页界面预览'}
            <span>v{status.version}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">dudu</span>
            <ChevronRight size={13} />
            <span>
              {page === 'settings'
                ? '偏好设置'
                : page === 'help'
                ? '使用指南'
                : nav.find(n => n[0] === page)?.[2]}
            </span>
          </div>
          <span className="topbar-tip">
            <Keyboard size={14} /> 全局快捷键随时唤起，即用即走
          </span>
          <button className="avatar" onClick={() => setPage('settings')} aria-label="偏好设置">
            <ShieldCheck size={17} />
          </button>
        </header>

        <div className="page-content">
          {!desktop && (
            <div className="preview-banner">
              <Monitor size={16} />
              当前为 Web 预览模式。截图、全局快捷键与剪贴板监听需在桌面端原生运行。
            </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button aria-label="关闭错误" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {status.error && <div role="alert" className="error-banner">{status.error}</div>}

          {/* PAGE: CLIPBOARD */}
          {page === 'clipboard' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CLIPBOARD WORKSPACE</div>
                  <h1>
                    每一次复制，都有迹可循<span>。</span>
                  </h1>
                  <p>文字、代码、图片与灵感片段，本地安全加密索引，随时一键调用。</p>
                </div>
                <button
                  className="secondary"
                  disabled={!desktop || busy || !settings.consent}
                  onClick={() => void save({ ...settings, paused: !settings.paused })}
                >
                  {settings.paused ? <Play size={15} /> : <Pause size={15} />}
                  {settings.paused ? '继续记录' : '暂停记录'}
                </button>
              </div>

              <div className="quick-actions">
                <button
                  onClick={() => {
                    setPage('capture');
                    void capture('region');
                  }}
                >
                  <span className="quick-icon green">
                    <Scissors size={22} />
                  </span>
                  <span>
                    <strong>区域截图</strong>
                    <small>按 {settings.shortcuts.region}，框选屏幕标注</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => setPage('translate')}>
                  <span className="quick-icon peach">
                    <Languages size={22} />
                  </span>
                  <span>
                    <strong>划词翻译与识别</strong>
                    <small>按 {settings.shortcuts.selection} 划词查词，离线 OCR</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              </div>

              <section className="history">
                <div className="section-heading">
                  <h2>
                    剪贴板历史 <span>{clips.length}</span>
                  </h2>
                  <span className="local-tag">
                    <span className="status-dot" /> SQLCipher 本地加密存储
                  </span>
                </div>

                <div className="history-toolbar">
                  <div className="tabs">
                    {[
                      ['all', '全部'],
                      ['text', '文字'],
                      ['image', '图片'],
                      ['favorites', '收藏'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={filter === id ? 'selected' : ''}
                        onClick={() => setFilter(id)}
                      >
                        {id === 'favorites' && <Star size={13} />} {label}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      placeholder="搜索文本内容、标题或来源应用…"
                      value={q}
                      onChange={e => setQ(e.target.value)}
                    />
                    {q && (
                      <button onClick={() => setQ('')} aria-label="清除搜索">
                        <X size={14} />
                      </button>
                    )}
                  </label>
                </div>

                {/* Multi-select continuous paste bar */}
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>已选择 {selected.length} 项</span>
                    <label className="separator-selector">
                      分隔符:
                      <select
                        value={serialSeparator}
                        onChange={e => setSerialSeparator(e.target.value)}
                      >
                        <option value="\n">换行符</option>
                        <option value="\t">制表符 (Tab)</option>
                        <option value=" ">空格</option>
                        <option value=", ">逗号</option>
                      </select>
                    </label>
                    <button
                      className="primary-small"
                      onClick={() =>
                        void run(() =>
                          call('serial_paste', {
                            ids: selected,
                            separator: serialSeparator === '\\n' ? '\n' : serialSeparator === '\\t' ? '\t' : serialSeparator,
                          })
                        )
                      }
                    >
                      连续合并粘贴
                    </button>
                    <button onClick={() => setSelected([])}>取消选择</button>
                  </div>
                )}

                {/* Clips Grid */}
                <div className="clip-grid">
                  {visible.map((clip, i) => (
                    <article
                      key={clip.id}
                      className={`clip-card ${active === i ? 'focused' : ''}`}
                      onClick={() => setActive(i)}
                      onDoubleClick={() => void paste(clip)}
                      tabIndex={0}
                    >
                      <div className="clip-meta">
                        <span>
                          {clip.kind === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}
                          {clip.source || '未知应用'}
                        </span>
                        <div>
                          <input
                            type="checkbox"
                            aria-label="选择条目"
                            checked={selected.includes(clip.id)}
                            onChange={e =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, clip.id]
                                  : selected.filter(id => id !== clip.id)
                              )
                            }
                          />
                          <button
                            aria-label={clip.favorite ? '取消收藏' : '收藏'}
                            className={clip.favorite ? 'favorited' : ''}
                            onClick={() =>
                              void run(async () => {
                                await call('favorite_clip', { id: clip.id });
                                setClips(await call<Clip[]>('list_clips'));
                              })
                            }
                          >
                            <Star size={15} fill={clip.favorite ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </div>

                      <div className="clip-body">
                        {clip.kind === 'image' ? (
                          <img src={clip.content} alt={clip.title || '剪贴板图片'} />
                        ) : (
                          <>
                            <strong>
                              {highlightMatch(clip.title || clip.content.split('\n')[0].slice(0, 70), q)}
                            </strong>
                            <p>{highlightMatch(clip.content, q)}</p>
                          </>
                        )}
                      </div>

                      <div className="clip-footer">
                        <span>
                          {new Date(clip.created).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <div>
                          <button
                            aria-label="复制条目"
                            title="复制到剪贴板"
                            onClick={() =>
                              void run(() => call('copy_clip', { id: clip.id }), '已复制到剪贴板')
                            }
                          >
                            <Copy size={14} />
                          </button>
                          {clip.kind === 'text' && (
                            <button
                              aria-label="编辑条目"
                              title="编辑内容"
                              onClick={() => setEdit({ ...clip })}
                            >
                              <FileText size={14} />
                            </button>
                          )}
                          <button
                            aria-label="删除条目"
                            title="删除"
                            onClick={() =>
                              void run(async () => {
                                await call('delete_clip', { id: clip.id });
                                setSelected(ids => ids.filter(id => id !== clip.id));
                                setClips(await call<Clip[]>('list_clips'));
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {!visible.length && (
                  <div className="empty-state">
                    <span>
                      <Clipboard size={34} strokeWidth={1.3} />
                    </span>
                    <h3>{q ? '未找到相关剪贴板记录' : '留住下一次灵感'}</h3>
                    <p>
                      {q
                        ? '换一个关键词，或切换内容分类试试。'
                        : settings.paused
                        ? '记录已暂停，点击右上角「继续记录」恢复。'
                        : '在任意应用复制文字、代码或图片，dudu 会自动为你安全留存。'}
                    </p>
                    <div>
                      <kbd>Ctrl / Cmd</kbd> + <kbd>C</kbd>
                      <span>开始积累你的工作片段</span>
                    </div>
                  </div>
                )}

                <footer className="history-footer">
                  <span>
                    <ShieldCheck size={13} />
                    仅保存在此设备 · 最多保留 {settings.limit} 条
                  </span>
                  <span>
                    <kbd>↑</kbd> <kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 直接粘贴 ·{' '}
                    <kbd>Alt + 1–9</kbd> 快速选取
                  </span>
                </footer>
              </section>
            </>
          )}

          {/* PAGE: CAPTURE */}
          {page === 'capture' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SCREENSHOT & ANNOTATION</div>
                  <h1>
                    把想法，留在画面里<span>。</span>
                  </h1>
                  <p>高清晰度物理像素采集，支持区域截图、窗口吸附、全屏截取、标注、贴图与取色。</p>
                </div>
                <label className="delay">
                  <Clock size={16} />
                  <select value={delay} onChange={e => setDelay(+e.target.value)}>
                    <option value={0}>立即截图</option>
                    {[3, 5, 10].map(n => (
                      <option key={n} value={n}>
                        延时 {n} 秒
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="capture-hero">
                <div className="capture-illustration">
                  <div className="window-decoration">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="selection-art">
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <ScanLine size={50} strokeWidth={1} />
                    <span>灵感，刚好框住。</span>
                    <span className="corner bl" />
                    <span className="corner br" />
                  </div>
                  <span className="art-caption">SELECT · ANNOTATE · PIN · SHARE</span>
                </div>

                <div>
                  <span className="pill">常驻桌面效率工具</span>
                  <h2>
                    屏幕上的每一处细节，
                    <br />
                    都值得顺手表达。
                  </h2>
                  <p>
                    支持矩形、椭圆、直线、箭头、手绘、文字、高亮、马赛克及步骤标记。完成标注后可一键复制图片、导出文件、复制 Markdown 或置顶贴图。
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void capture('region')}
                  >
                    <ScanLine size={17} />
                    开始区域截图
                    <kbd>{settings.shortcuts.region}</kbd>
                  </button>
                </div>
              </div>

              <div className="tool-grid">
                {[
                  ['fullscreen', Monitor, '全屏截图', '捕获活跃显示器全部画面', settings.shortcuts.fullscreen],
                  ['window', Camera, '窗口截图', '快速选择并截取特定窗口', settings.shortcuts.window],
                  ['ocr', FileText, '截图识别文字', '系统原生离线 OCR 识别', settings.shortcuts.ocr],
                  ['color', Sun, '屏幕取色器', '实时放大镜取色，复制 HEX', settings.shortcuts.color],
                ].map(([mode, Icon, title, desc, shortcut]) => {
                  const I = Icon as typeof Monitor;
                  return (
                    <button
                      key={String(mode)}
                      className="tool-card"
                      disabled={busy}
                      onClick={() => {
                        if (mode === 'window') {
                          void run(async () => setWindows(await call('list_windows')));
                        } else {
                          void capture(String(mode));
                        }
                      }}
                    >
                      <I size={23} />
                      <strong>{String(title)}</strong>
                      <span>{String(desc)}</span>
                      <kbd className="tool-shortcut">{String(shortcut)}</kbd>
                      <ArrowUpRight size={15} />
                    </button>
                  );
                })}
              </div>

              <button className="import-link" onClick={() => void run(() => call('open_image'))}>
                <Upload size={16} /> 打开已有本地图片，继续标注或识别
              </button>

              {colors.length > 0 && (
                <div className="color-history">
                  <span>最近取色记录：</span>
                  {colors.map(c => (
                    <button
                      key={c}
                      style={{ borderLeft: `18px solid ${c}` }}
                      onClick={() => void run(() => call('write_text', { text: c }), '已复制颜色')}
                      title={`点击复制 ${c}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* PAGE: TRANSLATE */}
          {page === 'translate' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">TRANSLATE & OCR</div>
                  <h1>
                    让表达，跨越语言边界<span>。</span>
                  </h1>
                  <p>输入、划词或屏幕截图识别，集成多翻译引擎与离线系统 OCR。</p>
                </div>
                <button className="secondary" onClick={() => void capture('ocr')}>
                  <ScanLine size={16} /> 截图 OCR 识别
                </button>
              </div>

              <div className="translation-panel">
                <div className="translation-options">
                  <select
                    aria-label="源语言"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                  >
                    <option value="auto">自动检测语言</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                  </select>

                  <button
                    aria-label="交换语言"
                    onClick={() => {
                      setFrom(to);
                      setTo(from === 'auto' ? 'en' : from);
                      setSource(result);
                      setResult(source);
                    }}
                  >
                    <ArrowLeftRight size={17} />
                  </button>

                  <select aria-label="目标语言" value={to} onChange={e => setTo(e.target.value)}>
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-TW">繁體中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="es">Español</option>
                    <option value="ru">Русский</option>
                  </select>

                  <select
                    aria-label="翻译引擎"
                    value={engine}
                    onChange={e => setEngine(e.target.value)}
                  >
                    <option value="google">Google（免费通用）</option>
                    <option value="deepl">DeepL Free</option>
                    <option value="baidu">百度翻译</option>
                  </select>
                </div>

                <div className="translation-columns">
                  <div>
                    <textarea
                      aria-label="待翻译文本"
                      placeholder="在此输入、粘贴，或通过划词快捷键直接带入选中文本…"
                      maxLength={10000}
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      onKeyDown={e => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void translate();
                      }}
                    />
                    <div className="text-tools">
                      <button onClick={() => setSource(splitIdentifier(source))}>
                        <Code2 size={13} /> 拆分代码命名
                      </button>
                      <span>{source.length} / 10000</span>
                      <button
                        aria-label="清空输入"
                        onClick={() => {
                          setSource('');
                          setResult('');
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="translation-result">
                    {result ? (
                      <p>{result}</p>
                    ) : (
                      <div className="result-placeholder">
                        <Languages size={28} strokeWidth={1.2} />
                        <p>翻译结果将在此呈现</p>
                        <small>按 Ctrl / Cmd + Enter 快速提交</small>
                      </div>
                    )}
                    <div className="text-tools">
                      <button
                        disabled={!result}
                        onClick={() => {
                          speechSynthesis.cancel();
                          const u = new SpeechSynthesisUtterance(result);
                          u.lang = to;
                          speechSynthesis.speak(u);
                        }}
                      >
                        <Volume2 size={15} /> 朗读
                      </button>
                      <button
                        disabled={!result}
                        onClick={() =>
                          void run(() => call('write_text', { text: result }), '已复制译文')
                        }
                      >
                        <Copy size={15} /> 复制译文
                      </button>
                    </div>
                  </div>
                </div>

                {/* Developer dictionary card */}
                {dictEntry && (
                  <div className="dictionary-card">
                    <div className="dict-header">
                      <BookA size={16} />
                      <strong>{dictEntry.word}</strong>
                      {dictEntry.phonetic && <span className="phonetic">{dictEntry.phonetic}</span>}
                      {dictEntry.pos && <span className="pos">{dictEntry.pos}</span>}
                    </div>
                    <p className="dict-definition">{dictEntry.definition}</p>
                    {dictEntry.example && <small className="dict-example">{dictEntry.example}</small>}
                  </div>
                )}

                {/* Developer identifier converter variants */}
                {identifierVariants && (
                  <div className="identifier-card">
                    <div className="identifier-title">
                      <Code2 size={14} /> 程序员命名快捷转换
                    </div>
                    <div className="identifier-grid">
                      {Object.entries(identifierVariants).map(([style, val]) => (
                        <button
                          key={style}
                          onClick={() => void run(() => call('write_text', { text: val }), `已复制 ${style}`)}
                          title="点击复制"
                        >
                          <small>{style}:</small> <code>{val}</code>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="translation-bottom">
                  <span>
                    <ShieldCheck size={14} /> 仅在发起翻译时向对应服务发送文本，历史记录缓存 24 小时。
                  </span>
                  <button
                    className="primary"
                    disabled={!source.trim() || busy}
                    onClick={() => void translate()}
                  >
                    {busy ? '正在翻译…' : '翻译'}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              </div>

              <div className="section-heading">
                <h2>翻译历史</h2>
                <span>本地保留 24 小时 · 最近 30 条</span>
              </div>
              {history.length ? (
                history.map(h => (
                  <button
                    className="translation-history"
                    key={h.id}
                    onClick={() => {
                      setSource(h.text);
                      setResult(h.result);
                      setFrom(h.from);
                      setTo(h.to);
                      setEngine(h.engine);
                    }}
                  >
                    <span>{h.text}</span>
                    <p>{h.result}</p>
                    <small>
                      {h.engine} · {new Date(h.created).toLocaleDateString()}
                    </small>
                    <ChevronRight size={16} />
                  </button>
                ))
              ) : (
                <div className="small-empty">输入文字或划词，开始你的第一次翻译。</div>
              )}
            </>
          )}

          {/* PAGE: SETTINGS */}
          {page === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PREFERENCES</div>
                  <h1>
                    适合你的，才顺手<span>。</span>
                  </h1>
                  <p>自定义快捷键、过滤规则与翻译密钥，让 dudu 贴合你的日常节奏。</p>
                </div>
                <button
                  className="primary"
                  disabled={busy || !desktop}
                  onClick={() => void save(draft)}
                >
                  <Check size={16} /> 保存偏好设置
                </button>
              </div>

              {/* General & Appearance */}
              <section className="settings-section">
                <h2>
                  <Sun size={18} /> 通用与外观
                </h2>
                <div className="setting-row">
                  <div>
                    <strong>外观主题</strong>
                    <p>跟随系统偏好，或锁定浅色 / 深色模式</p>
                  </div>
                  <div className="segmented">
                    {[
                      ['system', Monitor, '跟随系统'],
                      ['light', Sun, '浅色'],
                      ['dark', Moon, '深色'],
                    ].map(([value, Icon, label]) => {
                      const I = Icon as typeof Sun;
                      return (
                        <button
                          key={String(value)}
                          className={draft.theme === value ? 'selected' : ''}
                          onClick={() => {
                            setDraft({ ...draft, theme: value as Settings['theme'] });
                            document.documentElement.dataset.theme = String(value);
                          }}
                        >
                          <I size={14} />
                          {String(label)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Toggle
                  label="开机自启"
                  description="系统登录后，自动常驻在系统托盘中静默运行"
                  checked={draft.autostart}
                  onChange={v => setDraft({ ...draft, autostart: v })}
                />
              </section>

              {/* Capture Settings */}
              <section className="settings-section">
                <h2>
                  <ScanLine size={18} /> 截图偏好
                </h2>
                <div className="setting-row">
                  <div>
                    <strong>默认保存格式</strong>
                    <p>截图另存为文件时的首选图像格式</p>
                  </div>
                  <select
                    value={draft.saveFormat || 'png'}
                    onChange={e =>
                      setDraft({ ...draft, saveFormat: e.target.value as Settings['saveFormat'] })
                    }
                  >
                    <option value="png">PNG（高质量无损）</option>
                    <option value="jpg">JPG（文件体积小）</option>
                    <option value="webp">WebP（高压缩比现代格式）</option>
                  </select>
                </div>

                <Toggle
                  label="截图后自动复制到剪贴板"
                  description="选区完成或点击确认时，自动将图片写入系统剪贴板"
                  checked={draft.autoCopy}
                  onChange={v => setDraft({ ...draft, autoCopy: v })}
                />

                <Toggle
                  label="静默截图 OCR"
                  description="按下截图 OCR 快捷键后，识别成功直接写入剪贴板，不展开全屏编辑"
                  checked={draft.silentOcr}
                  onChange={v => setDraft({ ...draft, silentOcr: v })}
                />
              </section>

              {/* Clipboard & Privacy */}
              <section className="settings-section">
                <h2>
                  <Clipboard size={18} /> 剪贴板与隐私保护
                </h2>
                <Toggle
                  label="启用剪贴板记录"
                  description="关闭后不再记录新内容，已有记录与收藏仍妥善保留"
                  checked={!draft.paused}
                  onChange={v => setDraft({ ...draft, paused: !v })}
                />

                <Toggle
                  label="记录图片内容"
                  description="复制的图片生成缩略图，同样存储在本地加密库中"
                  checked={draft.captureImages}
                  onChange={v => setDraft({ ...draft, captureImages: v })}
                />

                <div className="setting-row">
                  <div>
                    <strong>历史保留条数上限</strong>
                    <p>达到上限时自动淘汰最旧的未收藏记录（100～5000 条）</p>
                  </div>
                  <input
                    aria-label="历史条数上限"
                    type="number"
                    min={100}
                    max={5000}
                    value={draft.limit}
                    onChange={e => setDraft({ ...draft, limit: +e.target.value })}
                  />
                </div>

                <label className="setting-field">
                  忽略的应用名称列表
                  <span>逗号分隔，匹配来源应用名称（如 1password, bitwarden, keepass 等）</span>
                  <input
                    value={draft.ignoreApps}
                    onChange={e => setDraft({ ...draft, ignoreApps: e.target.value })}
                  />
                </label>

                <label className="setting-field">
                  敏感词过滤规则
                  <span>逗号分隔，包含关键词的内容将自动丢弃不入库</span>
                  <input
                    value={draft.ignoreWords}
                    placeholder="例如：password, 银行卡, 身份证, 内部密码"
                    onChange={e => setDraft({ ...draft, ignoreWords: e.target.value })}
                  />
                </label>

                <div className="settings-buttons">
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(() => call('export_data'), '已导出备份（包含明文内容，请妥善保管）')
                    }
                  >
                    <Download size={15} /> 导出 JSON 备份
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(async () => {
                        await call('import_data');
                        await load();
                      }, '已成功导入备份')
                    }
                  >
                    <Upload size={15} /> 导入备份
                  </button>
                  <button className="danger-text" onClick={() => setConfirm(true)}>
                    <Trash2 size={15} /> 清空所有本地历史
                  </button>
                </div>
                <p className="setting-hint">
                  数据库采用 SQLCipher 加密，密钥妥善保管在系统原生凭据库（Windows Credential Manager / macOS Keychain）。
                </p>
              </section>

              {/* Translation Services */}
              <section className="settings-section">
                <h2>
                  <Languages size={18} /> 翻译与 OCR 引擎
                </h2>
                <label className="setting-field">
                  默认翻译引擎
                  <select
                    value={draft.engine}
                    onChange={e => setDraft({ ...draft, engine: e.target.value })}
                  >
                    <option value="google">Google 翻译（免费通用免配置）</option>
                    <option value="deepl">DeepL Free</option>
                    <option value="baidu">百度翻译</option>
                  </select>
                </label>

                <label className="setting-field">
                  DeepL Free API Key
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="填入你在 DeepL 开发者控制台申请的 Free API Key"
                    value={draft.deeplKey}
                    onChange={e => setDraft({ ...draft, deeplKey: e.target.value })}
                  />
                </label>

                <div className="two-fields">
                  <label className="setting-field">
                    百度翻译 App ID
                    <input
                      value={draft.baiduId}
                      placeholder="百度翻译开放平台 App ID"
                      onChange={e => setDraft({ ...draft, baiduId: e.target.value })}
                    />
                  </label>
                  <label className="setting-field">
                    百度翻译密钥
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="百度翻译密钥 Secret Key"
                      value={draft.baiduKey}
                      onChange={e => setDraft({ ...draft, baiduKey: e.target.value })}
                    />
                  </label>
                </div>

                <div className="two-fields">
                  <label className="setting-field">
                    有道智云 App Key (可选)
                    <input
                      value={draft.youdaoKey || ''}
                      placeholder="有道智云应用 ID"
                      onChange={e => setDraft({ ...draft, youdaoKey: e.target.value })}
                    />
                  </label>
                  <label className="setting-field">
                    有道应用密钥 (可选)
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="有道智云应用 Secret"
                      value={draft.youdaoSecret || ''}
                      onChange={e => setDraft({ ...draft, youdaoSecret: e.target.value })}
                    />
                  </label>
                </div>

                <label className="setting-field">
                  网络请求超时（秒）
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={draft.timeout}
                    onChange={e => setDraft({ ...draft, timeout: +e.target.value })}
                  />
                </label>

                <Toggle
                  label="剪贴板翻译"
                  description="复制外文后在后台自动尝试预翻译并缓存"
                  checked={draft.clipboardTranslate}
                  onChange={v => setDraft({ ...draft, clipboardTranslate: v })}
                />
              </section>

              {/* Global Shortcuts */}
              <section className="settings-section">
                <div className="section-heading">
                  <h2>
                    <Keyboard size={18} /> 全局快捷键
                  </h2>
                  <button onClick={() => setDraft({ ...draft, shortcuts: { ...defaults.shortcuts } })}>
                    恢复默认设置
                  </button>
                </div>
                {Object.entries(draft.shortcuts).map(([id, value]) => (
                  <label className="setting-row" key={id}>
                    <span>{shortcutLabels[id] || id}</span>
                    <input
                      aria-label={(shortcutLabels[id] || id) + '快捷键'}
                      value={value}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          shortcuts: { ...draft.shortcuts, [id]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                {status.shortcutErrors.map(x => (
                  <p className="error-text" key={x}>
                    {x}
                  </p>
                ))}
                <p className="setting-hint">
                  快捷键支持形如 Ctrl+Alt+A 或 Super+Shift+A。若按键被系统或其他第三方软件占用，保存时会明确提示冲突项。
                </p>
              </section>
            </>
          )}

          {/* PAGE: HELP */}
          {page === 'help' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">DOCUMENTATION & SUPPORT</div>
                  <h1>
                    你的桌面随身效率小帮手<span>。</span>
                  </h1>
                  <p>dudu v{status.version} · 截图 · 翻译 · 剪贴板历史一体化</p>
                </div>
              </div>

              <section className="settings-section guide">
                <h2>核心功能快捷键一览</h2>
                <div className="shortcuts-table">
                  <table>
                    <thead>
                      <tr>
                        <th>功能</th>
                        <th>Windows 默认</th>
                        <th>macOS 默认</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>区域截图</td>
                        <td><kbd>Ctrl+Alt+A</kbd></td>
                        <td><kbd>Cmd+Shift+A</kbd></td>
                        <td>拖拽选择截图，支持标注、贴图、保存与复制</td>
                      </tr>
                      <tr>
                        <td>窗口截图</td>
                        <td><kbd>Ctrl+Alt+W</kbd></td>
                        <td><kbd>Cmd+Shift+W</kbd></td>
                        <td>快速捕捉指定应用窗口</td>
                      </tr>
                      <tr>
                        <td>全屏截图</td>
                        <td><kbd>Ctrl+Alt+F</kbd></td>
                        <td><kbd>Cmd+Shift+F</kbd></td>
                        <td>捕捉活跃屏幕全部画面</td>
                      </tr>
                      <tr>
                        <td>划词翻译</td>
                        <td><kbd>Ctrl+Alt+D</kbd></td>
                        <td><kbd>Cmd+D</kbd></td>
                        <td>任意应用选中文字后唤起即时翻译</td>
                      </tr>
                      <tr>
                        <td>截图 OCR</td>
                        <td><kbd>Ctrl+Alt+S</kbd></td>
                        <td><kbd>Cmd+S</kbd></td>
                        <td>框选屏幕区域，系统原生离线 OCR 识别文本</td>
                      </tr>
                      <tr>
                        <td>输入翻译</td>
                        <td><kbd>Ctrl+Alt+T</kbd></td>
                        <td><kbd>Cmd+A</kbd></td>
                        <td>打开翻译工作面板，手动输入或转换命名</td>
                      </tr>
                      <tr>
                        <td>剪贴板历史</td>
                        <td><kbd>Ctrl+Alt+V</kbd></td>
                        <td><kbd>Cmd+Shift+V</kbd></td>
                        <td>唤起历史面板，回车粘贴，Alt+1~9 快速选取</td>
                      </tr>
                      <tr>
                        <td>屏幕取色</td>
                        <td><kbd>Ctrl+Alt+C</kbd></td>
                        <td><kbd>Cmd+Shift+C</kbd></td>
                        <td>悬浮放大镜查看 RGB / 十进制，点击复制 HEX</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h2>系统权限与隐私保障</h2>
                <p>
                  <strong>macOS 首次运行引导：</strong>截图需要「系统设置 → 隐私与安全性 → 屏幕录制」授权；模拟自动粘贴与选中文本需要「辅助功能」授权。在授予权限后，请退出并重新启动 dudu。
                </p>
                <p>
                  <strong>Windows 说明：</strong>Windows 端默认运行在当前用户上下文。若目标窗口具有管理员 (UAC) 权限，模拟快捷键可能无法直接写入，此时请按 Ctrl+V 手动粘贴。
                </p>
                <p>
                  <strong>数据与隐私承诺：</strong>所有剪贴板记录、截图与翻译历史完全保存在本机 SQLite 数据库中，使用 SQLCipher 高强度加密，绝不后台上传任何数据。
                </p>

                <h2>常见问题解答 (FAQ)</h2>
                <p>
                  <strong>Q: 关闭主窗口后 dudu 是否仍在后台运行？</strong>
                  <br />
                  A: 是的。点击窗口右上角关闭按钮会默认最小化至系统托盘，右键托盘图标可进行暂停记录、快速截图或彻底退出。
                </p>
                <p>
                  <strong>Q: 快捷键按下无反应怎么办？</strong>
                  <br />
                  A: 请进入偏好设置检查是否有快捷键被微信、QQ 或其他软件占用。可自定义为你喜欢的任意修饰键组合。
                </p>
                <p>
                  <strong>Q: 二维码识别与长截图如何使用？</strong>
                  <br />
                  A: 截图框选包含二维码的区域后，工具栏上方会自动提示识别出的内容，支持一键复制或在默认浏览器中打开。在标注栏中点击「+ 拼入长图」可连续截取多屏并在完成后一键合并。
                </p>

                <div className="settings-buttons">
                  <button className="secondary" onClick={() => void run(() => call('open_project'))}>
                    GitHub 仓库与源码 <ExternalLink size={14} />
                  </button>
                  <button className="secondary" onClick={() => void run(() => call('open_releases'))}>
                    <RefreshCw size={14} /> 检查更新与安装包发布
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="app-footer">
          <span>dudu · 留住灵感，顺手工作</span>
          <span>
            <Command size={12} /> 更少切换，更多专注 · 本地安全优先
          </span>
        </footer>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}

      {/* First-time Privacy Consent Modal */}
      {consent && (
        <div className="modal-backdrop">
          <section className="modal consent-modal">
            <span className="welcome-icon">
              <ShieldCheck size={30} />
            </span>
            <div className="eyebrow">WELCOME TO DUDU</div>
            <h2>先约定好，安心再开始。</h2>
            <p>
              dudu 会在后台记录你复制的文字、代码与图片，方便你在本机随时检索和再次使用。默认已为您自动忽略主流密码管理器。
            </p>
            <div className="privacy-points">
              <p>
                <Check size={16} /> 剪贴板历史与 API 密钥通过 SQLCipher 加密留存在本机
              </p>
              <p>
                <Check size={16} /> 仅在主动发起翻译时向所选引擎传输文本
              </p>
              <p>
                <Check size={16} /> 不收集使用行为统计，不进行后台隐式同步
              </p>
            </div>
            <p className="setting-hint">
              屏幕截图与快捷粘贴需要对应的系统权限。你可以随时在偏好设置中暂停或清空所有历史。
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const s = { ...settings, consent: true };
                  setStatus(await call<Status>('save_settings', { settings: s }));
                  setSettings(s);
                  setDraft(s);
                  setConsent(false);
                })
              }
            >
              同意隐私约定并开始使用
              <ChevronRight size={16} />
            </button>
            <button className="text-button" onClick={() => void run(() => call('quit_app'))}>
              退出应用
            </button>
          </section>
        </div>
      )}

      {/* Clear History Confirmation Modal */}
      {confirm && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>清空所有本地历史记录？</h2>
            <p>
              将立即彻底删除剪贴板历史（包括收藏项）与翻译本地缓存。此操作无法撤销。你的偏好设置和 API 密钥仍将保留。
            </p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirm(false)}>
                取消
              </button>
              <button
                className="danger"
                onClick={() =>
                  void run(async () => {
                    await call('clear_history');
                    setClips([]);
                    setHistory([]);
                    setSelected([]);
                    setConfirm(false);
                  }, '所有历史记录已安全清空')
                }
              >
                确认清空
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Edit Clip Modal */}
      {edit && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>编辑剪贴板片段</h2>
            <label className="setting-field">
              标题
              <input
                value={edit.title}
                onChange={e => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <textarea
              className="edit-content"
              value={edit.content}
              onChange={e => setEdit({ ...edit, content: e.target.value })}
            />
            <div className="modal-actions">
              <button className="secondary" onClick={() => setEdit(null)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() =>
                  void run(async () => {
                    await call('edit_clip', {
                      id: edit.id,
                      title: edit.title,
                      content: edit.content,
                    });
                    setClips(await call<Clip[]>('list_clips'));
                    setEdit(null);
                  })
                }
              >
                保存片段
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Window Picker Modal */}
      {windows.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>选择要截取的窗口</h2>
            <div className="window-list">
              {windows.map(w => (
                <button
                  key={w.id}
                  onClick={() => {
                    setWindows([]);
                    void capture('window', w.id);
                  }}
                >
                  <Monitor size={16} />
                  {w.title}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            <button className="secondary" onClick={() => setWindows([])}>
              取消
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={'toggle ' + (checked ? 'on' : '')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
