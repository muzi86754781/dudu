import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Square,
  Circle,
  ArrowUpRight,
  Pen,
  Grid2X2,
  Type,
  Hash,
  Undo2,
  ScanLine,
  Languages,
  Pin,
  Download,
  X,
  Check,
  Move,
  Minus,
  Plus,
  Copy,
  Sparkles,
  ScrollText,
} from 'lucide-react';
import { call } from './bridge';
import { normalizedRect, rgbToHex, type Capture } from './model';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type Shape = {
  tool: string;
  points: Point[];
  color: string;
  width: number;
  text?: string;
  index?: number;
};

const PRESET_COLORS = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#eab308', // 黄
  '#22c55e', // 绿
  '#06b6d4', // 青
  '#3b82f6', // 蓝
  '#8b5cf6', // 紫
  '#ffffff', // 白
  '#000000', // 黑
];

const PRESET_WIDTHS = [2, 4, 8];

// Top-level ErrorBoundary to guarantee graceful fallback
class CaptureErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Capture runtime error caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#161a1d',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            zIndex: 99999,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <p style={{ fontSize: 14 }}>截图遇到问题：{this.state.error}</p>
          <button
            style={{
              padding: '8px 20px',
              background: '#47765b',
              color: '#ffffff',
              border: 0,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
            onClick={() => void call('cancel_capture')}
          >
            退出截图
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function CaptureEditor({ mode }: { mode: string }) {
  if (mode === 'pin') {
    return (
      <CaptureErrorBoundary>
        <PinViewer />
      </CaptureErrorBoundary>
    );
  }

  return (
    <CaptureErrorBoundary>
      <CaptureScreen mode={mode} />
    </CaptureErrorBoundary>
  );
}

// Standalone Pin Viewer Component
function PinViewer() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    void call<Capture>('pending_capture').then(setCapture).catch(() => {});
  }, []);

  return (
    <div className="pin-window" style={{ opacity }} onDoubleClick={() => void call('edit_pin')}>
      <div
        className="pin-toolbar"
        data-tauri-drag-region
        onPointerDown={e => {
          if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
          void call('drag_window');
        }}
      >
        <button
          aria-label="拖动贴图"
          onPointerDown={e => {
            e.stopPropagation();
            void call('drag_window');
          }}
          title="按住拖动窗口"
        >
          <Move size={14} />
        </button>
        <button
          aria-label="缩小贴图"
          onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(1)))}
          title="缩小"
        >
          <Minus size={14} />
        </button>
        <span style={{ fontSize: 11, minWidth: 34, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          aria-label="放大贴图"
          onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(1)))}
          title="放大"
        >
          <Plus size={14} />
        </button>
        <input
          aria-label="贴图透明度"
          title="透明度"
          type="range"
          min="0.2"
          max="1"
          step="0.05"
          value={opacity}
          onChange={e => setOpacity(+e.target.value)}
        />
        <button
          aria-label="复制贴图"
          onClick={() => {
            if (capture) void call('capture_output', { data: capture.data, action: 'copy' });
          }}
          title="复制图片"
        >
          <Copy size={14} />
        </button>
        <button
          aria-label="保存贴图"
          onClick={() => {
            if (capture) void call('capture_output', { data: capture.data, action: 'save' });
          }}
          title="保存为文件"
        >
          <Download size={14} />
        </button>
        <button aria-label="关闭贴图" onClick={() => void call('close_pin')} title="关闭贴图 (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="pin-image-wrapper">
        {capture ? (
          <img
            src={capture.data}
            alt="置顶贴图"
            style={{ width: `${zoom * 100}%` }}
            draggable={false}
          />
        ) : (
          <span style={{ fontSize: 12, color: '#666' }}>正在准备贴图…</span>
        )}
      </div>
    </div>
  );
}

// Fullscreen Screenshot Capture Component
function CaptureScreen({ mode }: { mode: string }) {
  // 1. ALL useState Hooks at top
  const [capture, setCapture] = useState<Capture | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [color, setColor] = useState('#ef4444');
  const [width, setWidth] = useState(4);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [drawing, setDrawing] = useState<Shape | null>(null);
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [resizingHandle, setResizingHandle] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ mouse: Point; crop: Rect } | null>(null);
  const [colorFormat, setColorFormat] = useState<'hex' | 'rgb'>('hex');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');
  const [isLongCapturing, setIsLongCapturing] = useState(false);
  const [longPageCount, setLongPageCount] = useState(1);
  const [longPreviewUrl, setLongPreviewUrl] = useState<string | null>(null);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [lastDragY, setLastDragY] = useState<number | null>(null);

  // 2. ALL useRef Hooks
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const longCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  // 3. useCallback for annotation rendering
  const renderAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !crop || !img || crop.width <= 0 || crop.height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.clearRect(0, 0, crop.width, crop.height);
      const sx = Math.max(0, Math.min(img.width - crop.width, crop.x));
      const sy = Math.max(0, Math.min(img.height - crop.height, crop.y));
      const sw = Math.min(crop.width, img.width - sx);
      const sh = Math.min(crop.height, img.height - sy);

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, crop.width, crop.height);

      for (const s of [...shapes, ...(drawing ? [drawing] : [])]) {
        drawShape(ctx, s);
      }
    } catch {
      // Prevent render crashes
    }
  }, [crop, shapes, drawing]);

  // 4. useMemo for current hover pixel color details (unconditional, zero allocation)
  const hoverPixelInfo = useMemo(() => {
    if (!capture || !hoverPoint || !imageRef.current) return null;
    try {
      if (!probeCanvasRef.current) {
        probeCanvasRef.current = document.createElement('canvas');
        probeCanvasRef.current.width = 1;
        probeCanvasRef.current.height = 1;
      }
      const ctx = probeCanvasRef.current.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const pxX = Math.min(capture.width - 1, Math.max(0, Math.floor(hoverPoint.x)));
      const pxY = Math.min(capture.height - 1, Math.max(0, Math.floor(hoverPoint.y)));
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(imageRef.current, pxX, pxY, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      const rgb = `RGB(${d[0]}, ${d[1]}, ${d[2]})`;
      return { pxX, pxY, hex, rgb, r: d[0], g: d[1], b: d[2] };
    } catch {
      return null;
    }
  }, [capture, hoverPoint]);

  // 5. useMemo for Magnifier Loupe position calculation (unconditional - NEVER placed after return)
  const loupePosition = useMemo(() => {
    if (!hoverPoint || !capture) return { left: 0, top: 0, show: false, crosshairX: 0, crosshairY: 0 };
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const clientX = (hoverPoint.x / capture.width) * winW;
    const clientY = (hoverPoint.y / capture.height) * winH;

    const loupeW = 145;
    const loupeH = 220;
    const offset = 18;

    let left = clientX + offset;
    let top = clientY + offset;

    if (left + loupeW > winW - 10) {
      left = clientX - loupeW - offset;
    }
    if (top + loupeH > winH - 10) {
      top = clientY - loupeH - offset;
    }

    return {
      left: Math.max(8, left),
      top: Math.max(8, top),
      crosshairX: clientX,
      crosshairY: clientY,
      show: true,
    };
  }, [hoverPoint, capture]);

  // 6. useEffect: Load pending capture data
  useEffect(() => {
    void call<Capture>('pending_capture')
      .then(c => {
        setCapture(c);
        if (['fullscreen', 'window', 'image'].includes(mode)) {
          setCrop({ x: 0, y: 0, width: c.width, height: c.height });
        }
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          renderAnnotations();
        };
        img.src = c.data;
      })
      .catch(e => showToast((e as Error).message || '截图载入失败'));
  }, [mode, renderAnnotations, showToast]);

  // 7. useEffect: Re-render annotations when state changes
  useEffect(() => {
    renderAnnotations();
  }, [renderAnnotations]);

  // 8. useEffect: Render 15x15 pixel grid onto magnifier loupe (Figure 1)
  useEffect(() => {
    if (crop || !hoverPoint || !imageRef.current || !loupeCanvasRef.current) return;
    const loupe = loupeCanvasRef.current;
    const ctx = loupe.getContext('2d');
    if (!ctx) return;

    const img = imageRef.current;
    const pxX = Math.floor(hoverPoint.x);
    const pxY = Math.floor(hoverPoint.y);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, loupe.width, loupe.height);

    const sampleSize = 15;
    const half = Math.floor(sampleSize / 2);
    const cellSize = loupe.width / sampleSize;

    const sx = Math.max(0, Math.min(img.width - sampleSize, pxX - half));
    const sy = Math.max(0, Math.min(img.height - sampleSize, pxY - half));

    try {
      ctx.drawImage(img, sx, sy, sampleSize, sampleSize, 0, 0, loupe.width, loupe.height);
    } catch {
      // Prevent IndexSizeError on boundary
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= sampleSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, loupe.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(loupe.width, i * cellSize);
      ctx.stroke();
    }

    // Crosshair target in center
    const centerStart = half * cellSize;
    ctx.strokeStyle = '#1882fc';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, centerStart + cellSize / 2);
    ctx.lineTo(centerStart, centerStart + cellSize / 2);
    ctx.moveTo(centerStart + cellSize, centerStart + cellSize / 2);
    ctx.lineTo(loupe.width, centerStart + cellSize / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerStart + cellSize / 2, 0);
    ctx.lineTo(centerStart + cellSize / 2, centerStart);
    ctx.moveTo(centerStart + cellSize / 2, centerStart + cellSize);
    ctx.lineTo(centerStart + cellSize / 2, loupe.height);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(centerStart, centerStart, cellSize, cellSize);
  }, [crop, hoverPoint]);

  // 9. Callbacks for Long Screenshot
  const startLongCapture = useCallback(() => {
    if (!crop || !imageRef.current) return;
    setIsLongCapturing(true);
    setLongPageCount(1);

    const c = document.createElement('canvas');
    c.width = crop.width;
    c.height = crop.height;
    const ctx = c.getContext('2d');
    if (ctx && imageRef.current) {
      ctx.drawImage(
        imageRef.current,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      longCanvasRef.current = c;
      setLongPreviewUrl(c.toDataURL('image/png'));
    }
    showToast('长截图已开启：滚动鼠标滚轮 或 向下拖拽页面实时拼接');
  }, [crop, showToast]);

  const stitchNewSlice = useCallback(
    (newSliceImg: HTMLImageElement) => {
      if (!longCanvasRef.current || !crop) return;
      const prevCanvas = longCanvasRef.current;
      const W = prevCanvas.width;
      const H1 = prevCanvas.height;
      const H2 = newSliceImg.height;

      const maxOverlap = Math.min(H2 - 20, Math.floor(H2 * 0.7));
      const minOverlap = 20;
      let bestOverlap = Math.floor(H2 * 0.35);

      try {
        const prevCtx = prevCanvas.getContext('2d');
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = W;
        sliceCanvas.height = H2;
        const sliceCtx = sliceCanvas.getContext('2d');
        if (prevCtx && sliceCtx) {
          sliceCtx.drawImage(newSliceImg, 0, 0);

          let minDiff = Infinity;
          for (let candidate = minOverlap; candidate <= maxOverlap; candidate += 4) {
            const row1 = prevCtx.getImageData(0, H1 - candidate, Math.min(W, 80), 1).data;
            const row2 = sliceCtx.getImageData(0, 0, Math.min(W, 80), 1).data;
            let diff = 0;
            for (let i = 0; i < row1.length; i += 4) {
              diff +=
                Math.abs(row1[i] - row2[i]) +
                Math.abs(row1[i + 1] - row2[i + 1]) +
                Math.abs(row1[i + 2] - row2[i + 2]);
            }
            if (diff < minDiff) {
              minDiff = diff;
              bestOverlap = candidate;
            }
          }
        }
      } catch {
        // fallback
      }

      const appendHeight = Math.max(30, H2 - bestOverlap);
      const newTotalHeight = H1 + appendHeight;

      const newCanvas = document.createElement('canvas');
      newCanvas.width = W;
      newCanvas.height = Math.min(18000, newTotalHeight);
      const newCtx = newCanvas.getContext('2d');
      if (!newCtx) return;

      newCtx.drawImage(prevCanvas, 0, 0);
      newCtx.drawImage(newSliceImg, 0, bestOverlap, W, appendHeight, 0, H1, W, appendHeight);

      longCanvasRef.current = newCanvas;
      const url = newCanvas.toDataURL('image/png');
      setLongPreviewUrl(url);
      setLongPageCount(prev => prev + 1);

      if (canvasRef.current) {
        canvasRef.current.width = W;
        canvasRef.current.height = newCanvas.height;
        const cCtx = canvasRef.current.getContext('2d');
        if (cCtx) cCtx.drawImage(newCanvas, 0, 0);
      }
    },
    [crop]
  );

  const triggerScrollAndStitch = useCallback(
    async (delta: number) => {
      if (!crop || busy) return;
      setBusy(true);
      try {
        const slice = await call<Capture>('scroll_and_capture_slice', {
          delta,
          x: Math.round(crop.x),
          y: Math.round(crop.y),
          width: Math.round(crop.width),
          height: Math.round(crop.height),
        });
        const img = new Image();
        img.onload = () => {
          stitchNewSlice(img);
          setBusy(false);
        };
        img.onerror = () => setBusy(false);
        img.src = slice.data;
      } catch {
        setBusy(false);
      }
    },
    [crop, busy, stitchNewSlice]
  );

  const finishLongCapture = useCallback(async () => {
    clearInterval(autoScrollTimer.current);
    setAutoScrolling(false);
    if (!longCanvasRef.current) {
      setIsLongCapturing(false);
      return;
    }
    const dataUrl = longCanvasRef.current.toDataURL('image/png');
    await call('capture_output', { data: dataUrl, action: 'copy' });
  }, []);

  // Ensure window keyboard focus
  useEffect(() => {
    window.focus();
  }, []);

  // 10. useEffect: Global keybindings (unconditional)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea')) return;

      if (e.key === 'Escape') {
        if (textAt) {
          setTextAt(null);
          return;
        }
        if (isLongCapturing) {
          clearInterval(autoScrollTimer.current);
          setAutoScrolling(false);
          setIsLongCapturing(false);
          return;
        }
        if (activeTool) {
          setActiveTool(null);
          return;
        }
        void call('cancel_capture');
      }

      // Enter to finish and copy
      if (e.key === 'Enter' && crop) {
        e.preventDefault();
        if (isLongCapturing) {
          void finishLongCapture();
        } else {
          void handleOutput('copy');
        }
      }

      // 'C' key in stage 1 to copy hover color
      if (!crop && (e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        if (hoverPixelInfo) {
          const colorText = colorFormat === 'hex' ? hoverPixelInfo.hex : hoverPixelInfo.rgb;
          void call('write_text', { text: colorText });
          showToast(`已复制颜色 ${colorText}`);
        }
      }

      // 'S' key in stage 1 to toggle RGB/HEX format
      if (!crop && (e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
        setColorFormat(prev => (prev === 'hex' ? 'rgb' : 'hex'));
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoShape();
        else undoShape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    crop,
    hoverPixelInfo,
    colorFormat,
    activeTool,
    isLongCapturing,
    textAt,
    showToast,
    finishLongCapture,
  ]);

  const undoShape = () => {
    setShapes(prev => {
      if (!prev.length) return prev;
      setRedo(r => [...r, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  };

  const redoShape = () => {
    setRedo(prev => {
      if (!prev.length) return prev;
      setShapes(s => [...s, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  };

  const addShape = (shape: Shape) => {
    setShapes(prev => [...prev, shape].slice(-100));
    setRedo([]);
  };

  // Convert client coordinates to screen physical pixels
  const getScreenPoint = (e: React.PointerEvent | MouseEvent): Point => {
    if (!capture) return { x: e.clientX, y: e.clientY };
    const rect = document.documentElement.getBoundingClientRect();
    const scaleX = capture.width / (rect.width || window.innerWidth);
    const scaleY = capture.height / (rect.height || window.innerHeight);
    return {
      x: Math.max(0, Math.min(capture.width, e.clientX * scaleX)),
      y: Math.max(0, Math.min(capture.height, e.clientY * scaleY)),
    };
  };

  // Stage 1: Pointer events (Drawing initial crop area)
  const handleStage1PointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = getScreenPoint(e);
    setDragOrigin(p);
    setDragCurrent(p);
  };

  const handleStage1PointerMove = (e: React.PointerEvent) => {
    const p = getScreenPoint(e);
    setHoverPoint(p);
    if (dragOrigin) {
      setDragCurrent(p);
    }
  };

  const handleStage1PointerUp = (e: React.PointerEvent) => {
    if (!dragOrigin || !capture) return;
    const p = getScreenPoint(e);
    const r = normalizedRect(dragOrigin, p, capture.width, capture.height);
    setDragOrigin(null);
    setDragCurrent(null);
    if (r.width >= 6 && r.height >= 6) {
      setCrop({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    }
  };

  // Stage 2: 8-point resize handle dragging & moving
  const handleResizeStart = (handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (!crop) return;
    setResizingHandle(handle);
    setResizeStart({ mouse: getScreenPoint(e), crop: { ...crop } });
  };

  const handleStage2PointerMove = (e: React.PointerEvent) => {
    const current = getScreenPoint(e);
    setHoverPoint(current);

    if (isLongCapturing && e.buttons === 1) {
      if (lastDragY !== null && e.clientY - lastDragY > 25) {
        setLastDragY(e.clientY);
        void triggerScrollAndStitch(-3);
      } else if (lastDragY === null) {
        setLastDragY(e.clientY);
      }
      return;
    }

    if (resizingHandle && resizeStart && capture) {
      const dx = current.x - resizeStart.mouse.x;
      const dy = current.y - resizeStart.mouse.y;
      const initial = resizeStart.crop;
      let { x, y, width, height } = initial;

      if (resizingHandle === 'move') {
        x = Math.max(0, Math.min(capture.width - width, initial.x + dx));
        y = Math.max(0, Math.min(capture.height - height, initial.y + dy));
      } else {
        if (resizingHandle.includes('w')) {
          const newX = Math.max(0, Math.min(initial.x + initial.width - 20, initial.x + dx));
          width = initial.width + (initial.x - newX);
          x = newX;
        }
        if (resizingHandle.includes('e')) {
          width = Math.max(20, Math.min(capture.width - initial.x, initial.width + dx));
        }
        if (resizingHandle.includes('n')) {
          const newY = Math.max(0, Math.min(initial.y + initial.height - 20, initial.y + dy));
          height = initial.height + (initial.y - newY);
          y = newY;
        }
        if (resizingHandle.includes('s')) {
          height = Math.max(20, Math.min(capture.height - initial.y, initial.height + dy));
        }
      }

      setCrop({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
    }
  };

  const handleStage2PointerUp = () => {
    setLastDragY(null);
    setResizingHandle(null);
    setResizeStart(null);
  };

  // Output action triggers
  const handleOutput = async (action: string) => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      await call('capture_output', { data: dataUrl, action });
    } catch (e) {
      showToast((e as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  // Perform translation directly on crop
  const handleTranslate = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      await call('capture_output', { data: dataUrl, action: 'ocr' });
      void call('cancel_capture');
    } catch (e) {
      showToast((e as Error).message || '文字识别失败');
    } finally {
      setBusy(false);
    }
  };

  // RENDER CONDITIONAL VIEWS AFTER ALL HOOKS
  if (!capture) {
    return (
      <div className="capture-loading" style={{ background: '#121619', color: '#fff' }}>
        <span>正在准备屏幕捕获…</span>
      </div>
    );
  }

  // Stage 1: Initial Selection & Figure 1 Magnifier Loupe
  if (!crop) {
    const draggingRect =
      dragOrigin && dragCurrent
        ? normalizedRect(dragOrigin, dragCurrent, capture.width, capture.height)
        : null;

    return (
      <div
        className="screen-capture-viewport"
        onContextMenu={e => {
          e.preventDefault();
          void call('cancel_capture');
        }}
        onPointerDown={handleStage1PointerDown}
        onPointerMove={handleStage1PointerMove}
        onPointerUp={handleStage1PointerUp}
      >
        {/* Fullscreen clean background image */}
        <img
          src={capture.data}
          alt="screen"
          className="fullscreen-raw-img"
          draggable={false}
        />

        {/* Dark overlay with cut-out hole during dragging */}
        <div className="screen-mask-overlay">
          {draggingRect && (
            <div
              className="selection-box-cutout"
              style={{
                left: `${(draggingRect.x / capture.width) * 100}%`,
                top: `${(draggingRect.y / capture.height) * 100}%`,
                width: `${(draggingRect.width / capture.width) * 100}%`,
                height: `${(draggingRect.height / capture.height) * 100}%`,
              }}
            >
              <span className="dimension-badge">
                {Math.round(draggingRect.width)} × {Math.round(draggingRect.height)}
              </span>
            </div>
          )}
        </div>

        {/* Figure 1: Crosshair & Magnifier Loupe with Color Picker */}
        {loupePosition.show && !draggingRect && hoverPixelInfo && (
          <>
            {/* Precision Crosshair indicator on mouse */}
            <div
              className="precision-crosshair"
              style={{
                left: `${loupePosition.crosshairX}px`,
                top: `${loupePosition.crosshairY}px`,
              }}
            >
              <div className="crosshair-h" />
              <div className="crosshair-v" />
            </div>

            {/* Magnifier Window & Info Box (Exact match with Fig 1) */}
            <div
              className="pixel-loupe-card"
              style={{
                left: `${loupePosition.left}px`,
                top: `${loupePosition.top}px`,
              }}
            >
              {/* Top: 15x15 Pixel Grid View */}
              <canvas
                ref={loupeCanvasRef}
                width={140}
                height={140}
                className="loupe-canvas"
              />

              {/* Bottom: Coordinates, Color Block, Key Prompts */}
              <div className="loupe-info-panel">
                <div className="coord-row">
                  ({hoverPixelInfo.pxX}, {hoverPixelInfo.pxY})
                </div>

                <div className="color-row">
                  <span
                    className="color-swatch"
                    style={{ backgroundColor: hoverPixelInfo.hex }}
                  />
                  <strong className="color-code">
                    {colorFormat === 'hex' ? hoverPixelInfo.hex : hoverPixelInfo.rgb}
                  </strong>
                </div>

                <div className="prompt-row">按 C 复制颜色</div>
                <div className="prompt-row">按 S 切换RGB/HEX</div>
              </div>
            </div>
          </>
        )}

        {toast && <div className="screen-toast">{toast}</div>}
      </div>
    );
  }

  // Stage 2: Figure 2 Selection Box with 8-Point Resize Handles & White Floating Toolbar
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const cropLeft = (crop.x / capture.width) * winW;
  const cropTop = (crop.y / capture.height) * winH;
  const cropW = (crop.width / capture.width) * winW;
  const cropH = (crop.height / capture.height) * winH;

  const isToolbarBottom = cropTop + cropH + 52 <= winH;
  const toolbarTop = isToolbarBottom ? cropTop + cropH + 8 : Math.max(8, cropTop - 48);
  const toolbarRight = Math.max(12, winW - (cropLeft + cropW));

  return (
    <div
      className="screen-capture-viewport stage-2"
      onPointerMove={handleStage2PointerMove}
      onPointerUp={handleStage2PointerUp}
      onWheel={e => {
        if (isLongCapturing && e.deltaY > 15) {
          void triggerScrollAndStitch(-3);
        }
      }}
      onContextMenu={e => {
        e.preventDefault();
        void call('cancel_capture');
      }}
    >
      {/* Background Image */}
      <img
        src={capture.data}
        alt="screen"
        className="fullscreen-raw-img"
        draggable={false}
      />

      {/* Dark Mask with Selection Cutout (Fig 2) */}
      <div
        className="screen-mask-overlay selection-active"
        style={{
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${cropLeft}px ${cropTop}px,
            ${cropLeft}px ${cropTop + cropH}px,
            ${cropLeft + cropW}px ${cropTop + cropH}px,
            ${cropLeft + cropW}px ${cropTop}px,
            ${cropLeft}px ${cropTop}px
          )`,
        }}
      />

      {/* The Active Selection Box (Fig 2 dashed border + 8 resize points) */}
      <div
        className="selection-active-box"
        style={{
          left: `${cropLeft}px`,
          top: `${cropTop}px`,
          width: `${cropW}px`,
          height: `${cropH}px`,
          cursor: activeTool ? 'crosshair' : 'move',
        }}
        onPointerDown={e => {
          if (!activeTool && e.button === 0) {
            handleResizeStart('move', e);
          }
        }}
        onDoubleClick={() => void handleOutput('copy')}
      >
        {/* Annotation Canvas inside selection */}
        <canvas
          ref={canvasRef}
          width={crop.width}
          height={crop.height}
          className="annotation-canvas"
          onPointerDown={e => {
            if (!activeTool || e.button !== 0) return;
            e.stopPropagation();
            const r = canvasRef.current?.getBoundingClientRect();
            if (!r) return;
            const p: Point = {
              x: ((e.clientX - r.left) * crop.width) / r.width,
              y: ((e.clientY - r.top) * crop.height) / r.height,
            };

            if (activeTool === 'text') {
              setTextAt(p);
              setTextInput('');
              return;
            }
            if (activeTool === 'number') {
              addShape({
                tool: 'number',
                points: [p],
                color,
                width,
                index: shapes.filter(s => s.tool === 'number').length + 1,
              });
              return;
            }
            setDrawing({ tool: activeTool, points: [p, p], color, width });
          }}
          onPointerMove={e => {
            if (!drawing) return;
            const r = canvasRef.current?.getBoundingClientRect();
            if (!r) return;
            const p: Point = {
              x: ((e.clientX - r.left) * crop.width) / r.width,
              y: ((e.clientY - r.top) * crop.height) / r.height,
            };
            setDrawing({
              ...drawing,
              points: drawing.tool === 'pen' ? [...drawing.points, p] : [drawing.points[0], p],
            });
          }}
          onPointerUp={() => {
            if (drawing) {
              addShape(drawing);
              setDrawing(null);
            }
          }}
        />

        {/* 8-Point Resize Handles (Circles from Fig 2) */}
        {!activeTool && (
          <>
            <div
              className="resize-handle handle-nw"
              onPointerDown={e => handleResizeStart('nw', e)}
            />
            <div
              className="resize-handle handle-n"
              onPointerDown={e => handleResizeStart('n', e)}
            />
            <div
              className="resize-handle handle-ne"
              onPointerDown={e => handleResizeStart('ne', e)}
            />
            <div
              className="resize-handle handle-e"
              onPointerDown={e => handleResizeStart('e', e)}
            />
            <div
              className="resize-handle handle-se"
              onPointerDown={e => handleResizeStart('se', e)}
            />
            <div
              className="resize-handle handle-s"
              onPointerDown={e => handleResizeStart('s', e)}
            />
            <div
              className="resize-handle handle-sw"
              onPointerDown={e => handleResizeStart('sw', e)}
            />
            <div
              className="resize-handle handle-w"
              onPointerDown={e => handleResizeStart('w', e)}
            />
          </>
        )}

        {/* Dimension badge at top-left of selection */}
        <div className="dimension-badge top-outside">
          {crop.width} × {crop.height}
        </div>
      </div>

      {/* Secondary Color & Size Palette Bar when tool is selected */}
      {activeTool && (
        <div
          className="sub-toolbar-palette"
          style={{
            top: `${Math.max(8, toolbarTop - 42)}px`,
            right: `${toolbarRight}px`,
          }}
        >
          <div className="palette-colors">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={`color-dot ${color === c ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="palette-divider" />
          <div className="palette-widths">
            {PRESET_WIDTHS.map(w => (
              <button
                key={w}
                className={`width-pill ${width === w ? 'active' : ''}`}
                onClick={() => setWidth(w)}
              >
                <span style={{ height: `${w}px` }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Figure 2: White Floating Pill Toolbar Attached to Selection */}
      <div
        className="floating-toolbar-pill"
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        style={{
          top: `${toolbarTop}px`,
          right: `${toolbarRight}px`,
        }}
      >
        <div className="toolbar-brand-dot" title="dudu 截图">
          <Sparkles size={16} />
        </div>

        <button
          className={`tb-btn ${activeTool === 'rect' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'rect' ? null : 'rect')}
          title="矩形标注"
        >
          <Square size={16} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'ellipse' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'ellipse' ? null : 'ellipse')}
          title="圆形标注"
        >
          <Circle size={16} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'arrow' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')}
          title="箭头标注"
        >
          <ArrowUpRight size={17} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'pen' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'pen' ? null : 'pen')}
          title="自由画笔"
        >
          <Pen size={15} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'mosaic' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'mosaic' ? null : 'mosaic')}
          title="马赛克"
        >
          <Grid2X2 size={16} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')}
          title="添加文字"
        >
          <Type size={16} />
        </button>

        <button
          className={`tb-btn ${activeTool === 'number' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'number' ? null : 'number')}
          title="序号标记"
        >
          <Hash size={16} />
        </button>

        <button
          className="tb-btn"
          disabled={!shapes.length}
          onClick={undoShape}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>

        <div className="tb-divider" />

        {/* Long Screenshot (滚轮/拖动拼接) */}
        <button
          className={`tb-btn ${isLongCapturing ? 'active' : ''}`}
          onClick={() => {
            if (!isLongCapturing) startLongCapture();
            else void finishLongCapture();
          }}
          title={isLongCapturing ? '完成长截图 (Enter)' : '长截图 (滚轮滚动/拖动页面拼接)'}
        >
          <ScrollText size={16} />
        </button>

        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('ocr')}
          title="文字识别"
        >
          <ScanLine size={16} />
        </button>

        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleTranslate()}
          title="翻译区域文字"
        >
          <Languages size={16} />
        </button>

        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('pin')}
          title="置顶贴图"
        >
          <Pin size={16} />
        </button>

        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('save')}
          title="保存为文件"
        >
          <Download size={16} />
        </button>

        <button
          className="tb-btn cancel-btn"
          onPointerDown={e => {
            e.stopPropagation();
            void call('cancel_capture');
          }}
          onClick={e => {
            e.stopPropagation();
            void call('cancel_capture');
          }}
          title="取消截图 (Esc)"
        >
          <X size={17} />
        </button>

        <button
          className="tb-btn confirm-btn"
          disabled={busy}
          onClick={() => {
            if (isLongCapturing) void finishLongCapture();
            else void handleOutput('copy');
          }}
          title="完成截图并复制 (Enter / 双击)"
        >
          <Check size={18} />
        </button>
      </div>

      {/* Long Screenshot Control Banner */}
      {isLongCapturing && (
        <div className="long-capture-banner" onPointerDown={e => e.stopPropagation()}>
          <span className="long-badge">长截图模式 · 第 {longPageCount} 屏</span>
          <span>鼠标滚轮滚动 或 鼠标按住左键向下拖动页面实时拼接</span>
          <button
            className="long-action-btn"
            onClick={() => {
              if (autoScrolling) {
                clearInterval(autoScrollTimer.current);
                setAutoScrolling(false);
              } else {
                setAutoScrolling(true);
                autoScrollTimer.current = setInterval(() => {
                  void triggerScrollAndStitch(-3);
                }, 450);
              }
            }}
          >
            {autoScrolling ? '暂停滚动' : '自动滚动'}
          </button>
          <button className="long-action-btn finish-btn" onClick={() => void finishLongCapture()}>
            <Check size={14} /> 完成长截图并复制 (Enter)
          </button>
          <button
            className="long-action-btn"
            onClick={() => {
              clearInterval(autoScrollTimer.current);
              setAutoScrolling(false);
              setIsLongCapturing(false);
            }}
            title="退出长截图"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Long Screenshot Live Preview Drawer */}
      {isLongCapturing && longPreviewUrl && (
        <div className="long-preview-drawer" onPointerDown={e => e.stopPropagation()}>
          <div className="long-preview-header">
            <span>长截图实时预览</span>
            <span>
              {crop.width} × {longCanvasRef.current?.height || crop.height} px
            </span>
          </div>
          <div className="long-preview-body">
            <img src={longPreviewUrl} alt="长截图预览" draggable={false} />
          </div>
        </div>
      )}

      {/* Modal for Text Annotation Input */}
      {textAt && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>添加文字标注</h2>
            <textarea
              autoFocus
              className="edit-content"
              placeholder="输入标注文字…"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
            />
            <div className="modal-actions">
              <button className="secondary" onClick={() => setTextAt(null)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => {
                  if (textInput.trim()) {
                    addShape({
                      tool: 'text',
                      points: [textAt],
                      text: textInput,
                      color,
                      width,
                    });
                  }
                  setTextAt(null);
                }}
              >
                确定
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="screen-toast">{toast}</div>}
    </div>
  );
}

// Draw Shapes Function
function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  const a = s.points[0];
  const b = s.points[s.points.length - 1];
  const r = normalizedRect(a, b, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.tool === 'rect') {
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  } else if (s.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      r.x + r.width / 2,
      r.y + r.height / 2,
      Math.max(1, r.width / 2),
      Math.max(1, r.height / 2),
      0,
      0,
      2 * Math.PI
    );
    ctx.stroke();
  } else if (s.tool === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = Math.max(14, s.width * 3.5);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 7), b.y - headLen * Math.sin(angle - Math.PI / 7));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 7), b.y - headLen * Math.sin(angle + Math.PI / 7));
    ctx.stroke();
  } else if (s.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  } else if (s.tool === 'text') {
    ctx.font = `600 ${Math.max(16, s.width * 5)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    s.text?.split('\n').forEach((line, i) => {
      ctx.fillText(line, a.x, a.y + i * Math.max(22, s.width * 6));
    });
  } else if (s.tool === 'number') {
    const rad = Math.max(13, s.width * 3.5);
    ctx.beginPath();
    ctx.arc(a.x, a.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(13, s.width * 3.2)}px sans-serif`;
    ctx.fillText(String(s.index), a.x, a.y);
  } else if (s.tool === 'mosaic' && r.width > 0 && r.height > 0) {
    const block = Math.max(8, s.width * 3);
    for (let y = Math.floor(r.y); y < r.y + r.height; y += block) {
      for (let x = Math.floor(r.x); x < r.x + r.width; x += block) {
        const w = Math.min(block, ctx.canvas.width - x, r.x + r.width - x);
        const h = Math.min(block, ctx.canvas.height - y, r.y + r.height - y);
        if (w < 1 || h < 1) continue;
        const px = ctx.getImageData(x, y, Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))).data;
        let red = 0,
          green = 0,
          blue = 0;
        for (let i = 0; i < px.length; i += 4) {
          red += px[i];
          green += px[i + 1];
          blue += px[i + 2];
        }
        const n = px.length / 4;
        ctx.fillStyle = `rgb(${Math.round(red / n)},${Math.round(green / n)},${Math.round(blue / n)})`;
        ctx.fillRect(x, y, w, h);
      }
    }
  }
  ctx.restore();
}
