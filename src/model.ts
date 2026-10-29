export type Page = 'clipboard' | 'capture' | 'translate' | 'settings' | 'help';

export interface Clip {
  id: string;
  kind: 'text' | 'image' | 'file';
  content: string;
  source: string;
  created: number;
  favorite: boolean;
  title: string;
}

export interface Translation {
  id: string;
  text: string;
  result: string;
  engine: string;
  from: string;
  to: string;
  created: number;
  cached: boolean;
}

export interface Settings {
  consent: boolean;
  paused: boolean;
  limit: number;
  captureImages: boolean;
  ignoreApps: string;
  ignoreWords: string;
  theme: 'system' | 'light' | 'dark';
  engine: string;
  target: string;
  deeplKey: string;
  baiduId: string;
  baiduKey: string;
  youdaoKey: string;
  youdaoSecret: string;
  timeout: number;
  autostart: boolean;
  saveFormat: 'png' | 'jpg' | 'webp';
  autoCopy: boolean;
  silentOcr: boolean;
  silentTranslate: boolean;
  clipboardTranslate: boolean;
  shortcuts: Record<string, string>;
}

export interface Status {
  ready: boolean;
  error: string;
  shortcutErrors: string[];
  version: string;
  platform: string;
}

export interface Capture {
  data: string;
  width: number;
  height: number;
}

export interface DictEntry {
  word: string;
  phonetic?: string;
  pos?: string;
  definition: string;
  example?: string;
}

export const defaults: Settings = {
  consent: false,
  paused: false,
  limit: 500,
  captureImages: true,
  ignoreApps: '1password,bitwarden,keepass,lastpass,dashlane,密码',
  ignoreWords: '',
  theme: 'system',
  engine: 'google',
  target: 'auto',
  deeplKey: '',
  baiduId: '',
  baiduKey: '',
  youdaoKey: '',
  youdaoSecret: '',
  timeout: 15,
  autostart: false,
  saveFormat: 'png',
  autoCopy: true,
  silentOcr: false,
  silentTranslate: false,
  clipboardTranslate: false,
  shortcuts: {
    region: 'Ctrl+Alt+A',
    window: 'Ctrl+Alt+W',
    fullscreen: 'Ctrl+Alt+F',
    selection: 'Ctrl+Alt+D',
    ocr: 'Ctrl+Alt+S',
    translate: 'Ctrl+Alt+T',
    clipboard: 'Ctrl+Alt+V',
    color: 'Ctrl+Alt+C',
  },
};

export const shortcutLabels: Record<string, string> = {
  region: '区域截图',
  window: '窗口截图',
  fullscreen: '全屏截图',
  selection: '划词翻译',
  ocr: '截图 OCR',
  translate: '输入翻译',
  clipboard: '剪贴板历史',
  color: '屏幕取色',
};

export function filterClips(items: Clip[], q: string, filter: string): Clip[] {
  const query = q.toLocaleLowerCase().trim();
  return items
    .filter(x => {
      const matchFilter =
        filter === 'all' ||
        (filter === 'favorites' && x.favorite) ||
        filter === x.kind;
      if (!matchFilter) return false;
      if (!query) return true;
      return (x.content + ' ' + x.source + ' ' + x.title).toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.created - a.created);
}

export function validateSettings(s: Settings): string {
  if (!Number.isInteger(s.limit) || s.limit < 100 || s.limit > 5000) {
    return '历史条数应为 100～5000';
  }
  if (!Number.isFinite(s.timeout) || s.timeout < 3 || s.timeout > 60) {
    return '请求超时应为 3～60 秒';
  }
  const keys = Object.values(s.shortcuts).map(x => x.toLowerCase().replace(/\s/g, ''));
  if (new Set(keys).size !== keys.length) {
    return '快捷键存在重复，请为每个操作设置不同组合';
  }
  if (keys.some(x => !x.includes('+') || x.endsWith('+'))) {
    return '快捷键需要包含修饰键和按键，例如 Ctrl+Alt+A';
  }
  return '';
}

/**
 * Split programming identifiers like camelCase, PascalCase, snake_case into words
 */
export function splitIdentifier(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * Identifier casing converters for developers
 */
export function getIdentifierVariants(text: string): Record<string, string> {
  const words = splitIdentifier(text)
    .split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(Boolean);
  if (!words.length) return {};

  const camel = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  const pascal = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const snake = words.join('_');
  const kebab = words.join('-');
  const screaming = words.map(w => w.toUpperCase()).join('_');

  return {
    camelCase: camel,
    PascalCase: pascal,
    snake_case: snake,
    'kebab-case': kebab,
    SCREAMING_SNAKE: screaming,
  };
}

export function normalizedRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number
) {
  const x = Math.max(0, Math.min(width, Math.min(a.x, b.x)));
  const y = Math.max(0, Math.min(height, Math.min(a.y, b.y)));
  return {
    x,
    y,
    width: Math.min(width - x, Math.abs(a.x - b.x)),
    height: Math.min(height - y, Math.abs(a.y - b.y)),
  };
}

/**
 * Built-in concise English-Chinese dictionary for developer words
 */
export const quickDictionary: Record<string, DictEntry> = {
  function: { word: 'function', phonetic: '/ˈfʌŋkʃn/', pos: 'n.', definition: '功能；函数；起作用', example: 'Declare an asynchronous function.' },
  component: { word: 'component', phonetic: '/kəmˈpəʊnənt/', pos: 'n.', definition: '组件；部件；成分', example: 'Reusable React component.' },
  clipboard: { word: 'clipboard', phonetic: '/ˈklɪpbɔːd/', pos: 'n.', definition: '剪贴板；带夹垫板', example: 'Copy text to system clipboard.' },
  capture: { word: 'capture', phonetic: '/ˈkæptʃə(r)//', pos: 'v./n.', definition: '捕获；截取；捕捉', example: 'Capture full screen screenshot.' },
  translate: { word: 'translate', phonetic: '/trænzˈleɪt/', pos: 'v.', definition: '翻译；转化；解释', example: 'Translate foreign text instantly.' },
  asynchronous: { word: 'asynchronous', phonetic: '/eɪˈsɪŋkrənəs/', pos: 'adj.', definition: '异步的；不同时的', example: 'Handle asynchronous promise.' },
  synchronous: { word: 'synchronous', phonetic: '/ˈsɪŋkrənəs/', pos: 'adj.', definition: '同步的', example: 'Synchronous blocking execution.' },
  undefined: { word: 'undefined', phonetic: '/ˌʌndɪˈfaɪnd/', pos: 'adj.', definition: '未定义的；不明确的', example: 'Variable is undefined.' },
  immutable: { word: 'immutable', phonetic: '/ɪˈmjuːtəbl/', pos: 'adj.', definition: '不可变的', example: 'Immutable state tree.' },
  middleware: { word: 'middleware', phonetic: '/ˈmɪdlweə(r)/', pos: 'n.', definition: '中间件', example: 'Express authentication middleware.' },
  repository: { word: 'repository', phonetic: '/rɪˈpɒzətri/', pos: 'n.', definition: '代码库；仓库', example: 'Push changes to git repository.' },
  encrypt: { word: 'encrypt', phonetic: '/ɪnˈkrɪpt/', pos: 'v.', definition: '加密', example: 'Encrypt local SQLite database.' },
  decrypt: { word: 'decrypt', phonetic: '/diːˈkrɪpt/', pos: 'v.', definition: '解密', example: 'Decrypt credentials securely.' },
  permission: { word: 'permission', phonetic: '/pəˈmɪʃn/', pos: 'n.', definition: '权限；许可', example: 'Request screen recording permission.' },
  shortcut: { word: 'shortcut', phonetic: '/ˈʃɔːtkʌt/', pos: 'n.', definition: '快捷键；捷径', example: 'Global shortcut listener.' },
};

export function lookupDictionary(word: string): DictEntry | null {
  const normalized = word.trim().toLowerCase();
  return quickDictionary[normalized] || null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}
