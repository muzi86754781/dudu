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
} from 'lucide-react';
import { call } from './bridge';
import { normalizedRect, rgbToHex, hexToRgb, type Capture } from './model';

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

export default function CaptureEditor({ mode }: { mode: string }) {
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
  const [showColorPalette, setShowColorPalette] = useState(false);

  // Pin window properties
  const [opacity, setOpacity] = useState(1);
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  // Load pending capture data
  useEffect(() => {
    void call<Capture>('pending_capture')
      .then(c => {
        setCapture(c);
        if (['fullscreen', 'window', 'image', 'pin'].includes(mode)) {
          setCrop({ x: 0, y: 0, width: c.width, height: c.height });
        }
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          renderAnnotations();
        };
        img.src = c.data;
      })
      .catch(e => showToast(e.message));
  }, [mode]);

  // Render annotations onto crop canvas
  const renderAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !crop || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, crop.width, crop.height);
    // Draw cropped portion from original image
    ctx.drawImage(
      img,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );

    // Draw saved and in-progress shapes
    for (const s of [...shapes, ...(drawing ? [drawing] : [])]) {
      drawShape(ctx, s);
    }
  }, [crop, shapes, drawing]);

  useEffect(() => {
    renderAnnotations();
  }, [renderAnnotations]);

  // Current hover pixel color details for loupe
  const hoverPixelInfo = useMemo(() => {
    if (!capture || !hoverPoint || !imageRef.current) return null;
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = capture.width;
      offscreen.height = capture.height;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(imageRef.current, 0, 0);

      const pxX = Math.min(capture.width - 1, Math.max(0, Math.floor(hoverPoint.x)));
      const pxY = Math.min(capture.height - 1, Math.max(0, Math.floor(hoverPoint.y)));
      const d = ctx.getImageData(pxX, pxY, 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      const rgb = `RGB(${d[0]}, ${d[1]}, ${d[2]})`;
      return { pxX, pxY, hex, rgb, r: d[0], g: d[1], b: d[2] };
    } catch {
      return null;
    }
  }, [capture, hoverPoint]);

  // Render 15x15 pixel grid onto magnifier loupe
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

    // Sample 15x15 pixels around cursor
    const sampleSize = 15;
    const half = Math.floor(sampleSize / 2);
    const cellSize = loupe.width / sampleSize; // approx 9.3px per cell

    // Draw zoomed pixels
    ctx.drawImage(
      img,
      pxX - half,
      pxY - half,
      sampleSize,
      sampleSize,
      0,
      0,
      loupe.width,
      loupe.height
    );

    // Draw grid lines
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

    // Horizontal blue line (skipping center cell)
    ctx.beginPath();
    ctx.moveTo(0, centerStart + cellSize / 2);
    ctx.lineTo(centerStart, centerStart + cellSize / 2);
    ctx.moveTo(centerStart + cellSize, centerStart + cellSize / 2);
    ctx.lineTo(loupe.width, centerStart + cellSize / 2);
    ctx.stroke();

    // Vertical blue line (skipping center cell)
    ctx.beginPath();
    ctx.moveTo(centerStart + cellSize / 2, 0);
    ctx.lineTo(centerStart + cellSize / 2, centerStart);
    ctx.moveTo(centerStart + cellSize / 2, centerStart + cellSize);
    ctx.lineTo(centerStart + cellSize / 2, loupe.height);
    ctx.stroke();

    // White outline for the center sampled pixel
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(centerStart, centerStart, cellSize, cellSize);
  }, [crop, hoverPoint]);

  // Global keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea')) return;

      if (e.key === 'Escape') {
        if (activeTool) {
          setActiveTool(null);
          return;
        }
        void call('cancel_capture');
      }

      // Enter to finish and copy
      if (e.key === 'Enter' && crop) {
        e.preventDefault();
        void handleOutput('copy');
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
  }, [crop, hoverPixelInfo, colorFormat, activeTool]);

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
      // Trigger OCR recognition first, then forward text to quick-translate
      await call('capture_output', { data: dataUrl, action: 'ocr' });
      // Close capture window and open quick translate
      void call('cancel_capture');
    } catch (e) {
      showToast((e as Error).message || '文字识别失败');
    } finally {
      setBusy(false);
    }
  };

  // Pin window mode (existing floating pinned reference)
  if (mode === 'pin') {
    return (
      <div className="pin-window" style={{ opacity }} onDoubleClick={() => void call('edit_pin')}>
        <div className="pin-toolbar">
          <button aria-label="拖动贴图" onPointerDown={() => void call('drag_window')} title="拖动">
            <Move size={14} />
          </button>
          <button aria-label="缩小贴图" onClick={() => setZoom(z => Math.max(0.2, z - 0.1))} title="缩小">
            <Minus size={14} />
          </button>
          <button aria-label="放大贴图" onClick={() => setZoom(z => Math.min(3, z + 0.1))} title="放大">
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
            title="复制"
          >
            <Copy size={14} />
          </button>
          <button
            aria-label="保存贴图"
            onClick={() => {
              if (capture) void call('capture_output', { data: capture.data, action: 'save' });
            }}
            title="保存"
          >
            <Download size={14} />
          </button>
          <button aria-label="关闭贴图" onClick={() => void call('close_pin')} title="关闭">
            <X size={14} />
          </button>
        </div>
        {capture && <img src={capture.data} alt="置顶参考图片" style={{ width: `${zoom * 100}%` }} />}
      </div>
    );
  }

  if (!capture) {
    return (
      <div className="capture-loading">
        <span>正在准备屏幕捕获…</span>
      </div>
    );
  }

  // Magnifier Loupe position calculation (prevent overflowing screen)
  const loupePosition = useMemo(() => {
    if (!hoverPoint || !capture) return { left: 0, top: 0, show: false };
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const clientX = (hoverPoint.x / capture.width) * winW;
    const clientY = (hoverPoint.y / capture.height) * winH;

    const loupeW = 145;
    const loupeH = 220;
    const offset = 18;

    let left = clientX + offset;
    let top = clientY + offset;

    // Flip to left if near right edge
    if (left + loupeW > winW - 10) {
      left = clientX - loupeW - offset;
    }
    // Flip to top if near bottom edge
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

  // Floating Toolbar Position (Attached to bottom-right of selection, flips if overflowing)
  const isToolbarBottom = cropTop + cropH + 52 <= winH;
  const toolbarTop = isToolbarBottom ? cropTop + cropH + 8 : Math.max(8, cropTop - 48);
  const toolbarRight = Math.max(12, winW - (cropLeft + cropW));

  return (
    <div
      className="screen-capture-viewport stage-2"
      onPointerMove={handleStage2PointerMove}
      onPointerUp={handleStage2PointerUp}
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
        style={{
          top: `${toolbarTop}px`,
          right: `${toolbarRight}px`,
        }}
      >
        {/* Brand / Decorative Icon */}
        <div className="toolbar-brand-dot" title="dudu 截图">
          <Sparkles size={16} />
        </div>

        {/* 1. Rect */}
        <button
          className={`tb-btn ${activeTool === 'rect' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'rect' ? null : 'rect')}
          title="矩形标注"
        >
          <Square size={16} />
        </button>

        {/* 2. Circle */}
        <button
          className={`tb-btn ${activeTool === 'ellipse' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'ellipse' ? null : 'ellipse')}
          title="圆形标注"
        >
          <Circle size={16} />
        </button>

        {/* 3. Arrow */}
        <button
          className={`tb-btn ${activeTool === 'arrow' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')}
          title="箭头标注"
        >
          <ArrowUpRight size={17} />
        </button>

        {/* 4. Pen */}
        <button
          className={`tb-btn ${activeTool === 'pen' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'pen' ? null : 'pen')}
          title="自由画笔"
        >
          <Pen size={15} />
        </button>

        {/* 5. Mosaic */}
        <button
          className={`tb-btn ${activeTool === 'mosaic' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'mosaic' ? null : 'mosaic')}
          title="马赛克"
        >
          <Grid2X2 size={16} />
        </button>

        {/* 6. Text */}
        <button
          className={`tb-btn ${activeTool === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')}
          title="添加文字"
        >
          <Type size={16} />
        </button>

        {/* 7. Number step */}
        <button
          className={`tb-btn ${activeTool === 'number' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'number' ? null : 'number')}
          title="序号标记"
        >
          <Hash size={16} />
        </button>

        {/* 8. Undo */}
        <button
          className="tb-btn"
          disabled={!shapes.length}
          onClick={undoShape}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>

        <div className="tb-divider" />

        {/* 9. OCR */}
        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('ocr')}
          title="文字识别"
        >
          <ScanLine size={16} />
        </button>

        {/* 10. Translate */}
        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleTranslate()}
          title="翻译区域文字"
        >
          <Languages size={16} />
        </button>

        {/* 11. Pin */}
        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('pin')}
          title="置顶贴图"
        >
          <Pin size={16} />
        </button>

        {/* 12. Save */}
        <button
          className="tb-btn"
          disabled={busy}
          onClick={() => void handleOutput('save')}
          title="保存为文件"
        >
          <Download size={16} />
        </button>

        {/* 13. Cancel */}
        <button
          className="tb-btn cancel-btn"
          onClick={() => void call('cancel_capture')}
          title="取消截图 (Esc)"
        >
          <X size={17} />
        </button>

        {/* 14. Finish & Copy */}
        <button
          className="tb-btn confirm-btn"
          disabled={busy}
          onClick={() => void handleOutput('copy')}
          title="完成截图并复制 (Enter / 双击)"
        >
          <Check size={18} />
        </button>
      </div>

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
