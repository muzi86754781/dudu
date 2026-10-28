import React, { useEffect, useRef, useState } from 'react';
import {
  Pin,
  Clock,
  Settings as SettingsIcon,
  Volume2,
  Copy,
  ArrowLeftRight,
  ChevronDown,
  X,
  Check,
  RotateCw,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { call, desktop, on } from './bridge';
import { lookupDictionary, type DictEntry, type Translation } from './model';

const LANGUAGES = [
  { id: 'auto', label: '自动检测' },
  { id: 'en', label: '英语' },
  { id: 'zh-CN', label: '中文(简体)' },
  { id: 'zh-TW', label: '中文(繁体)' },
  { id: 'ja', label: '日语' },
  { id: 'ko', label: '韩语' },
  { id: 'fr', label: '法语' },
  { id: 'de', label: '德语' },
  { id: 'es', label: '西班牙语' },
  { id: 'ru', label: '俄语' },
];

const ENGINES = [
  { id: 'google', name: 'Google翻译', icon: '🌐' },
  { id: 'deepl', name: 'DeepL翻译', icon: '⚡' },
  { id: 'baidu', name: '百度翻译', icon: '🐾' },
  { id: 'youdao', name: '有道翻译', icon: '📖' },
];

export default function QuickTranslate() {
  const [pinned, setPinned] = useState(true);
  const [text, setText] = useState('');
  const [from, setFrom] = useState('auto');
  const [to, setTo] = useState('zh-CN');
  const [engine, setEngine] = useState('google');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedInput, setCopiedInput] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Translation[]>([]);
  const [showEngineMenu, setShowEngineMenu] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestToken = useRef(0);

  // Focus input automatically
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Listen to incoming text (selection translate or window reopen)
  useEffect(() => {
    const cleanups: Promise<() => void>[] = [
      on<string>('quick-translate-text', newText => {
        if (newText) {
          setText(newText);
          doTranslate(newText, from, to, engine);
        }
        inputRef.current?.focus();
      }),
    ];
    // Check initial query parameter or storage
    const params = new URLSearchParams(window.location.search);
    const initialText = params.get('text');
    if (initialText) {
      setText(initialText);
      doTranslate(initialText, from, to, engine);
    }
    return () => {
      cleanups.forEach(p => void p.then(f => f()));
    };
  }, [from, to, engine]);

  // Load history
  const loadHistory = async () => {
    if (!desktop) return;
    try {
      const h = await call<Translation[]>('translation_history');
      setHistory(h || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  // Esc to hide/close window, or blur window if unpinned
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showHistory) {
          setShowHistory(false);
          return;
        }
        if (text) {
          setText('');
          setResult('');
          return;
        }
        if (desktop) void call('hide_quick_translate');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHistory, text]);

  // Auto hide on blur if not pinned
  useEffect(() => {
    const handleBlur = () => {
      if (!pinned && desktop && !showEngineMenu) {
        void call('hide_quick_translate');
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [pinned, showEngineMenu]);

  // Handle pin toggle
  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    if (desktop) {
      await call('set_quick_translate_pin', { pinned: next }).catch(() => {});
    }
  };

  // Perform translation
  const doTranslate = async (sourceText: string, srcLang: string, tgtLang: string, eng: string) => {
    const trimmed = sourceText.trim();
    if (!trimmed) {
      setResult('');
      setError('');
      setLoading(false);
      return;
    }
    const token = ++requestToken.current;
    setLoading(true);
    setError('');
    try {
      const tr = await call<Translation>('translate', {
        text: trimmed,
        from: srcLang,
        to: tgtLang,
        engine: eng,
      });
      if (token === requestToken.current && tr) {
        setResult(tr.result);
        void loadHistory();
      }
    } catch (e) {
      if (token === requestToken.current) {
        setError((e as Error).message || '翻译失败，请检查网络或服务密钥');
      }
    } finally {
      if (token === requestToken.current) {
        setLoading(false);
      }
    }
  };

  // Debounced auto-translate on typing
  const handleInputChange = (val: string) => {
    setText(val);
    clearTimeout(debounceTimer.current);
    if (!val.trim()) {
      setResult('');
      setError('');
      setLoading(false);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      void doTranslate(val, from, to, engine);
    }, 450);
  };

  // Swap languages
  const swapLanguages = () => {
    const newFrom = to === 'auto' ? 'en' : to;
    const newTo = from === 'auto' ? 'zh-CN' : from;
    setFrom(newFrom);
    setTo(newTo);
    if (result && !loading) {
      setText(result);
      setResult('');
      void doTranslate(result, newFrom, newTo, engine);
    } else if (text) {
      void doTranslate(text, newFrom, newTo, engine);
    }
  };

  // Text-to-speech
  const speak = (content: string, langHint?: string) => {
    if (!content.trim() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    if (langHint && langHint !== 'auto') {
      utterance.lang = langHint;
    }
    window.speechSynthesis.speak(utterance);
  };

  // Copy text to clipboard
  const copyText = async (content: string, type: 'input' | 'result') => {
    if (!content) return;
    try {
      if (desktop) {
        await call('write_text', { text: content });
      } else {
        await navigator.clipboard.writeText(content);
      }
      if (type === 'input') {
        setCopiedInput(true);
        setTimeout(() => setCopiedInput(false), 1800);
      } else {
        setCopiedResult(true);
        setTimeout(() => setCopiedResult(false), 1800);
      }
    } catch {
      // ignore
    }
  };

  // Quick dictionary lookup if single word
  const dictEntry: DictEntry | null = React.useMemo(() => {
    const trimmed = text.trim();
    if (/^[a-zA-Z_-]+$/.test(trimmed) && trimmed.length <= 30) {
      return lookupDictionary(trimmed);
    }
    return null;
  }, [text]);

  const currentEngineObj = ENGINES.find(e => e.id === engine) || ENGINES[0];

  return (
    <div className="quick-translate-window">
      {/* Top Header Bar (Draggable) */}
      <header className="quick-header" data-tauri-drag-region>
        <button
          className={`quick-icon-btn pin-btn ${pinned ? 'active' : ''}`}
          onClick={togglePin}
          title={pinned ? '取消置顶' : '固定在最前'}
          aria-label="置顶"
        >
          <Pin size={16} />
        </button>

        <div className="quick-header-center" data-tauri-drag-region />

        <div className="quick-header-right">
          <button
            className={`quick-icon-btn ${showHistory ? 'active' : ''}`}
            onClick={() => {
              setShowHistory(!showHistory);
              void loadHistory();
            }}
            title="历史记录"
            aria-label="历史记录"
          >
            <Clock size={16} />
          </button>
          <button
            className="quick-icon-btn"
            onClick={() => void call('open_settings_window')}
            title="偏好设置"
            aria-label="偏好设置"
          >
            <SettingsIcon size={16} />
          </button>
          <button
            className="quick-icon-btn close-btn"
            onClick={() => void call('hide_quick_translate')}
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Main Translate Box */}
      <div className="quick-content">
        {/* Input Card Container */}
        <div className="quick-input-card">
          <textarea
            ref={inputRef}
            className="quick-textarea"
            placeholder="请输入单词或文字"
            value={text}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void doTranslate(text, from, to, engine);
              }
            }}
          />

          <div className="quick-input-actions">
            <button
              className="action-pill-btn"
              onClick={() => speak(text, from)}
              disabled={!text.trim()}
              title="朗读原文"
            >
              <Volume2 size={15} />
            </button>
            <button
              className="action-pill-btn"
              onClick={() => void copyText(text, 'input')}
              disabled={!text.trim()}
              title="复制原文"
            >
              {copiedInput ? <Check size={15} color="#3b7a57" /> : <Copy size={15} />}
            </button>
            {text.trim() && (
              <button
                className="action-pill-btn clear-btn"
                onClick={() => {
                  setText('');
                  setResult('');
                  inputRef.current?.focus();
                }}
                title="清空"
              >
                <X size={13} />
              </button>
            )}
            <span className="char-count">{text.length > 0 ? text.length : ''}</span>
          </div>
        </div>

        {/* Language Selection Row */}
        <div className="quick-lang-bar">
          <div className="lang-selector">
            <select
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                if (text) void doTranslate(text, e.target.value, to, engine);
              }}
            >
              {LANGUAGES.map(lang => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>

          <button
            className="swap-lang-btn"
            onClick={swapLanguages}
            title="切换源语言与目标语言"
            aria-label="互换语言"
          >
            <ArrowLeftRight size={14} />
          </button>

          <div className="lang-selector">
            <select
              value={to}
              onChange={e => {
                setTo(e.target.value);
                if (text) void doTranslate(text, from, e.target.value, engine);
              }}
            >
              {LANGUAGES.filter(l => l.id !== 'auto').map(lang => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>
        </div>

        {/* Engine Bar & Result Card */}
        <div className="quick-result-card">
          <div className="engine-bar">
            <button
              className="engine-select-trigger"
              onClick={() => setShowEngineMenu(!showEngineMenu)}
            >
              <span className="engine-icon">{currentEngineObj.icon}</span>
              <strong className="engine-name">{currentEngineObj.name}</strong>
              <ChevronDown size={13} className="select-arrow" />
            </button>

            {loading && (
              <span className="quick-spinner" title="翻译中…">
                <RotateCw size={13} className="spinning" />
              </span>
            )}

            {result && !loading && (
              <div className="result-actions">
                <button
                  className="action-pill-btn"
                  onClick={() => speak(result, to)}
                  title="朗读译文"
                >
                  <Volume2 size={14} />
                </button>
                <button
                  className="action-pill-btn"
                  onClick={() => void copyText(result, 'result')}
                  title="复制译文"
                >
                  {copiedResult ? <Check size={14} color="#3b7a57" /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </div>

          {/* Engine Dropdown Menu */}
          {showEngineMenu && (
            <div className="engine-dropdown">
              {ENGINES.map(eng => (
                <button
                  key={eng.id}
                  className={`engine-item ${eng.id === engine ? 'selected' : ''}`}
                  onClick={() => {
                    setEngine(eng.id);
                    setShowEngineMenu(false);
                    if (text) void doTranslate(text, from, to, eng.id);
                  }}
                >
                  <span>{eng.icon}</span>
                  <span>{eng.name}</span>
                  {eng.id === engine && <Check size={13} className="check-icon" />}
                </button>
              ))}
            </div>
          )}

          {/* Translation Result Output */}
          <div className="result-body">
            {loading && !result && (
              <div className="skeleton-placeholder">
                <div className="skeleton-line line-1" />
                <div className="skeleton-line line-2" />
              </div>
            )}

            {error && <div className="quick-error">{error}</div>}

            {result && (
              <div className="result-text" onDoubleClick={() => void copyText(result, 'result')}>
                {result}
              </div>
            )}

            {!text.trim() && !result && !loading && !error && (
              <div className="quick-empty-hint">输入或粘贴文字，即刻自动翻译</div>
            )}

            {/* Offline Local Dictionary Extra Card */}
            {dictEntry && (
              <div className="quick-dict-box">
                <div className="dict-head">
                  <BookOpen size={13} />
                  <strong>{dictEntry.word}</strong>
                  {dictEntry.phonetic && <span className="dict-phonetic">{dictEntry.phonetic}</span>}
                </div>
                <div className="dict-def">{dictEntry.definition}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History Drawer */}
      {showHistory && (
        <div className="quick-history-drawer">
          <div className="drawer-header">
            <strong>翻译历史</strong>
            <button className="quick-icon-btn" onClick={() => setShowHistory(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="drawer-list">
            {history.length === 0 ? (
              <p className="drawer-empty">暂无翻译记录</p>
            ) : (
              history.map(item => (
                <div
                  key={item.id}
                  className="drawer-item"
                  onClick={() => {
                    setText(item.text);
                    setResult(item.result);
                    setShowHistory(false);
                    inputRef.current?.focus();
                  }}
                >
                  <div className="drawer-item-text">{item.text}</div>
                  <div className="drawer-item-res">{item.result}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

