import { describe, it, expect } from 'vitest';
import {
  defaults,
  filterClips,
  normalizedRect,
  splitIdentifier,
  getIdentifierVariants,
  lookupDictionary,
  rgbToHex,
  hexToRgb,
  validateSettings,
  type Clip,
} from './model';

describe('clipboard search', () => {
  const items: Clip[] = [
    { id: '1', kind: 'text', content: 'Hello World', source: 'Editor', created: 20, favorite: false, title: '' },
    { id: '2', kind: 'image', content: 'data:image/png;base64,x', source: 'Browser', created: 10, favorite: true, title: 'diagram' },
  ];

  it('filters by content, source and title without losing favorites ordering', () => {
    expect(filterClips(items, '', 'all').map(x => x.id)).toEqual(['2', '1']);
    expect(filterClips(items, 'EDITOR', 'all').map(x => x.id)).toEqual(['1']);
    expect(filterClips(items, 'diagram', 'image')).toHaveLength(1);
    expect(filterClips(items, 'Hello', 'favorites')).toHaveLength(0);
  });
});

describe('configuration safety', () => {
  it('rejects duplicate shortcuts and invalid retention', () => {
    expect(validateSettings({ ...defaults, shortcuts: { a: 'Ctrl+Alt+A', b: 'ctrl+alt+a' } })).toContain('重复');
    expect(validateSettings({ ...defaults, limit: NaN })).toContain('历史');
    expect(validateSettings(defaults)).toBe('');
  });
});

describe('capture geometry', () => {
  it('handles reverse drag and clamps the crop to physical image bounds', () => {
    expect(normalizedRect({ x: 90, y: 80 }, { x: 10, y: 20 }, 100, 100)).toEqual({ x: 10, y: 20, width: 80, height: 60 });
    expect(normalizedRect({ x: -5, y: -5 }, { x: 200, y: 200 }, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('developer identifier conversions and dictionary', () => {
  it('prepares code identifiers for translation and casing variants', () => {
    expect(splitIdentifier('getHTTPResponse_user-name')).toBe('get HTTP Response user name');
    const variants = getIdentifierVariants('getHTTPResponse');
    expect(variants.camelCase).toBe('getHttpResponse');
    expect(variants.PascalCase).toBe('GetHttpResponse');
    expect(variants.snake_case).toBe('get_http_response');
    expect(variants['kebab-case']).toBe('get-http-response');
    expect(variants.SCREAMING_SNAKE).toBe('GET_HTTP_RESPONSE');
  });

  it('looks up dictionary definitions', () => {
    const entry = lookupDictionary('function');
    expect(entry).not.toBeNull();
    expect(entry?.definition).toContain('函数');
    expect(lookupDictionary('nonexistentwordxyz')).toBeNull();
  });

  it('converts rgb and hex colors', () => {
    expect(rgbToHex(255, 0, 128)).toBe('#FF0080');
    expect(hexToRgb('#FF0080')).toEqual({ r: 255, g: 0, b: 128 });
  });
});

describe('legacy settings compat (serde round-trip guard)', () => {
  // 死开关已从设置页 UI 移除，但 Rust Settings 结构体仍消费这些字段，
  // 前端 defaults 必须继续携带，否则 Rust 反序列化走默认路径时行为漂移。
  it('keeps the 5 retired switch fields in defaults', () => {
    const d = defaults as unknown as Record<string, unknown>;
    for (const k of ['saveFormat', 'autoCopy', 'silentOcr', 'silentTranslate', 'clipboardTranslate']) {
      expect(d[k]).not.toBeUndefined();
    }
  });
});

describe('configuration boundary values', () => {
  it('accepts limit/timeout at exact edges and rejects one step outside', () => {
    expect(validateSettings({ ...defaults, limit: 100 })).toBe('');
    expect(validateSettings({ ...defaults, limit: 5000 })).toBe('');
    expect(validateSettings({ ...defaults, limit: 99 })).toContain('历史');
    expect(validateSettings({ ...defaults, limit: 5001 })).toContain('历史');
    expect(validateSettings({ ...defaults, timeout: 3 })).toBe('');
    expect(validateSettings({ ...defaults, timeout: 60 })).toBe('');
    expect(validateSettings({ ...defaults, timeout: 2 })).toContain('超时');
    expect(validateSettings({ ...defaults, timeout: 61 })).toContain('超时');
  });
});
