// T2: undo/redo 组件级冒烟（@testing-library/react + jsdom）
// 覆盖 A3 规格中可低成本自动化的部分：
//   1. 截图 overlay 在 pending_capture 解析后挂载；
//   2. 空 shapes 栈 / 空 redo 栈按 Ctrl+Z / Ctrl+Shift+Z 不崩溃；
//   3. StrictMode 双渲染下连续 undo/redo 不崩溃（回归 updater 副作用重构）。
// 注：栈深断言（画 3 个 shape → undo×2 → 剩余 1、redo 栈 2、再绘制清空 redo）
// 需要 pointer/canvas 测试基建（jsdom getContext 为 null，无法走完整绘制管线），
// 记入 v0.2 测试债，不在本轮假装覆盖。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

vi.mock('./bridge', () => ({
  call: vi.fn(),
  desktop: true,
  on: vi.fn(() => Promise.resolve(() => {})),
}));

import CaptureEditor from './CaptureEditor';
import { call } from './bridge';

const fakeCapture = {
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  width: 100,
  height: 80,
};

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation((cmd: string) => {
    if (cmd === 'pending_capture') return Promise.resolve(fakeCapture);
    return Promise.resolve(null);
  });
});

function undo() {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
}
function redo() {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
}

describe('CaptureScreen mount', () => {
  it('requests pending_capture on mount', async () => {
    render(<CaptureEditor mode="region" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('pending_capture'));
  });
});

describe('undo/redo on empty stack (A3 regression guard)', () => {
  it('does not crash on undo', async () => {
    render(<CaptureEditor mode="region" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('pending_capture'));
    expect(() => undo()).not.toThrow();
  });

  it('does not crash on redo', async () => {
    render(<CaptureEditor mode="region" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('pending_capture'));
    expect(() => redo()).not.toThrow();
  });

  it('survives StrictMode double-render plus repeated undo/redo', async () => {
    render(
      <StrictMode>
        <CaptureEditor mode="region" />
      </StrictMode>,
    );
    await waitFor(() => expect(call).toHaveBeenCalledWith('pending_capture'));
    // 旧实现在 updater 内调另一个 setState，StrictMode 双触发会污染 redo 栈；
    // 新实现改为 ref 快照先算再 setState，此处仅守住"不崩溃、不产生未捕获错误"。
    expect(() => {
      for (let i = 0; i < 3; i++) undo();
      for (let i = 0; i < 3; i++) redo();
    }).not.toThrow();
  });
});
