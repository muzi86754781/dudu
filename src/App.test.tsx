// T3 / T4: App 级行为测试（@testing-library/react + jsdom，mock ./bridge）
// T3: Esc 焦点守卫——无输入框聚焦时 Esc 调 hide_main；输入框聚焦时不调。
// T4: open-window-picker 事件 → 进入 capture 页并拉取 list_windows；
//     capture-error 事件 → 前端以 error 文案呈现（不再静默吞给隐藏主窗）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const handlers = new Map<string, (payload?: unknown) => void>();

vi.mock('./bridge', () => ({
  call: vi.fn(),
  desktop: true,
  on: vi.fn((event: string, handler: (p?: unknown) => void) => {
    handlers.set(event, handler);
    return Promise.resolve(() => handlers.delete(event));
  }),
}));

import App from './App';
import { call } from './bridge';
import { defaults } from './model';

beforeEach(() => {
  handlers.clear();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'get_settings':
        return Promise.resolve({ ...defaults });
      case 'list_clips':
        return Promise.resolve([]);
      case 'status':
        return Promise.resolve({ ready: true, error: '', shortcutErrors: [], version: '0.1.8', platform: 'win32' });
      case 'translation_history':
        return Promise.resolve([]);
      case 'clipboard_status':
        return Promise.resolve({ enabled: true, reason: '' });
      case 'list_windows':
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
});

const hideMainCalls = () =>
  vi.mocked(call).mock.calls.filter(c => c[0] === 'hide_main').length;

describe('T3: Esc focus guard', () => {
  it('hides the main window on Esc when nothing input-like is focused', async () => {
    render(<App />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('get_settings'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(hideMainCalls()).toBe(1);
  });

  it('does NOT hide the main window on Esc while an input is focused', async () => {
    render(<App />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('get_settings'));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const before = hideMainCalls();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(hideMainCalls()).toBe(before);
    input.remove();
  });
});

describe('T4: window-picker + capture-error wiring', () => {
  it('open-window-picker event loads the window list', async () => {
    render(<App />);
    await waitFor(() => expect(handlers.has('open-window-picker')).toBe(true));
    handlers.get('open-window-picker')!();
    await waitFor(() => expect(call).toHaveBeenCalledWith('list_windows'));
  });

  it('capture-error event surfaces as a visible error message', async () => {
    render(<App />);
    await waitFor(() => expect(handlers.has('capture-error')).toBe(true));
    handlers.get('capture-error')!('mock capture failure');
    await waitFor(() => screen.getByText('mock capture failure'));
  });
});
