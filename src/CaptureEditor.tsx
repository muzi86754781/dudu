import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Copy,
  Download,
  X,
  Undo2,
  Redo2,
  Pin,
  Type,
  ArrowUpRight,
  Square,
  Pen,
  Highlighter,
  Hash,
  Grid2X2,
  ScanLine,
  Code,
  Move,
  Minus,
  Plus,
  Circle,
  Slash,
  QrCode,
  Languages,
  Check,
  Maximize2,
  ExternalLink,
  Layers,
} from 'lucide-react';
import jsQR from 'jsqr';
import { call } from './bridge';
import { normalizedRect, rgbToHex, type Capture } from './model';

type Point = { x: number; y: number };
type Shape = {
  tool: string;
  points: Point[];
  color: string;
  width: number;
  text?: string;
  index?: number;
};

export default function CaptureEditor({ mode }: { mode: string }) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState('#ef5454');
  const [width, setWidth] = useState(4);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [drawing, setDrawing] = useState<Shape | null>(null);
  const [origin, setOrigin] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [text, setText] = useState('');
  const [detectedQr, setDetectedQr] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [stitchImages, setStitchImages] = useState<string[]>([]);
  const [copiedHint, setCopiedHint] = useState('');

  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const selection = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call<Capture>('pending_capture')
      .then(c => {
        setCapture(c);
        if (['fullscreen', 'window', 'image', 'pin'].includes(mode)) {
          setCrop({ x: 0, y: 0, width: c.width, height: c.height });
        }
        const img = new Image();
        img.onload = () => {
          image.current = img;
          render();
        };
        img.src = c.data;
      })
      .catch(e => setError(e.message));
  }, []);

  function render() {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !crop || !image.current) return;
    ctx.clearRect(0, 0, crop.width, crop.height);
    ctx.drawImage(
      image.current,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );
    for (const s of [...shapes, ...(drawing ? [drawing] : [])]) {
      draw(ctx, s);
    }
  }

  useEffect(() => {
    render();
  }, [capture, crop, shapes, drawing]);

  // QR Code detection on crop change
  useEffect(() => {
    if (!crop || !image.current) return;
    try {
      const c = document.createElement('canvas');
      c.width = crop.width;
      c.height = crop.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          image.current,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height
        );
        const imgData = ctx.getImageData(0, 0, crop.width, crop.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code && code.data) {
          setDetectedQr(code.data);
        } else {
          setDetectedQr(null);
        }
      }
    } catch {
      setDetectedQr(null);
    }
  }, [crop]);

  function add(shape: Shape) {
    setShapes(prev => [...prev, shape].slice(-100));
    setRedo([]);
  }

  function undo() {
    setShapes(prev => {
      if (!prev.length) return prev;
      setRedo(r => [...r, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function redoOne() {
    setRedo(prev => {
      if (!prev.length) return prev;
      setShapes(s => [...s, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea')) return;
      if (e.key === 'Escape') void call('cancel_capture');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoOne();
        else undo();
      }
      const tools: Record<string, string> = {
        a: 'arrow',
        l: 'line',
        r: 'rect',
        e: 'ellipse',
        p: 'pen',
        t: 'text',
        m: 'mosaic',
        h: 'highlight',
        n: 'number',
      };
      if (!e.ctrlKey && !e.metaKey && tools[e.key.toLowerCase()]) {
        setTool(tools[e.key.toLowerCase()]);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  function point(e: React.PointerEvent, el: HTMLElement, w: number, h: number): Point {
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(w, ((e.clientX - r.left) * w) / r.width)),
      y: Math.max(0, Math.min(h, ((e.clientY - r.top) * h) / r.height)),
    };
  }

  async function output(action: string) {
    if (!canvas.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = canvas.current.toDataURL('image/png');
      if (action === 'markdown') {
        await call('write_text', { text: `![截图](${dataUrl})` });
        setCopiedHint('已复制 Markdown');
        setTimeout(() => setCopiedHint(''), 2000);
        return;
      }
      if (action === 'stitch_add') {
        setStitchImages(prev => [...prev, dataUrl]);
        setCopiedHint(`已加入长截图拼接队列 (${stitchImages.length + 1} 屏)`);
        setTimeout(() => setCopiedHint(''), 2500);
        return;
      }
      await call('capture_output', { data: dataUrl, action });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Magnifying glass info for color picker
  const hoverColor = useMemo(() => {
    if (!capture || !hoverPoint || !image.current) return null;
    try {
      const c = document.createElement('canvas');
      c.width = capture.width;
      c.height = capture.height;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image.current, 0, 0);
      const pxX = Math.min(capture.width - 1, Math.max(0, Math.floor(hoverPoint.x)));
      const pxY = Math.min(capture.height - 1, Math.max(0, Math.floor(hoverPoint.y)));
      const d = ctx.getImageData(pxX, pxY, 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      const intVal = (d[0] << 16) + (d[1] << 8) + d[2];
      return { hex, r: d[0], g: d[1], b: d[2], intVal, pxX, pxY };
    } catch {
      return null;
    }
  }, [capture, hoverPoint]);

  // Floating Action Bar position
  const floatingBarStyle = useMemo(() => {
    if (!crop || !capture) return {};
    const bottomY = (crop.y + crop.height) / capture.height;
    const isNearBottom = bottomY > 0.82;
    return {
      left: `${Math.max(5, Math.min(95, (crop.x + crop.width / 2) / capture.width * 100))}%`,
      top: isNearBottom
        ? `${Math.max(4, (crop.y / capture.height) * 100 - 6)}%`
        : `${Math.min(96, ((crop.y + crop.height) / capture.height) * 100 + 3)}%`,
      transform: 'translateX(-50%)',
    };
  }, [crop, capture]);

  // Stitch images vertically
  async function completeStitch() {
    if (!stitchImages.length && !canvas.current) return;
    const all = [...stitchImages, ...(canvas.current ? [canvas.current.toDataURL('image/png')] : [])];
    if (all.length === 0) return;
    setBusy(true);
    try {
      // Load all images and stitch
      const loaded: HTMLImageElement[] = await Promise.all(
        all.map(
          src =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const im = new Image();
              im.onload = () => resolve(im);
              im.onerror = reject;
              im.src = src;
            })
        )
      );
      const maxW = Math.max(...loaded.map(im => im.width));
      const totalH = loaded.reduce((sum, im) => sum + im.height, 0);
      const stitchCanvas = document.createElement('canvas');
      stitchCanvas.width = maxW;
      stitchCanvas.height = totalH;
      const sCtx = stitchCanvas.getContext('2d')!;
      let curY = 0;
      for (const im of loaded) {
        sCtx.drawImage(im, 0, curY);
        curY += im.height;
      }
      const finalData = stitchCanvas.toDataURL('image/png');
      await call('capture_output', { data: finalData, action: 'copy' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Pin window mode
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
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  if (!capture) {
    return (
      <div className="capture-loading">
        {error || '正在准备屏幕采集…'}
        <button onClick={() => void call('cancel_capture')}>取消</button>
      </div>
    );
  }

  // Selection stage (crop is not finalized yet)
  if (!crop) {
    return (
      <div
        className="screen-selection"
        ref={selection}
        style={{ backgroundImage: `url(${capture.data})` }}
        onContextMenu={e => {
          e.preventDefault();
          void call('cancel_capture');
        }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e, e.currentTarget, capture.width, capture.height);
          if (mode === 'color') {
            if (hoverColor) {
              void call('capture_color', { color: hoverColor.hex });
            }
            return;
          }
          setOrigin(p);
          setEnd(p);
        }}
        onPointerMove={e => {
          const p = point(e, e.currentTarget, capture.width, capture.height);
          setHoverPoint(p);
          if (origin) setEnd(p);
        }}
        onPointerUp={e => {
          if (!origin) return;
          const r = normalizedRect(
            origin,
            point(e, e.currentTarget, capture.width, capture.height),
            capture.width,
            capture.height
          );
          if (r.width >= 4 && r.height >= 4) {
            setCrop({
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            });
          }
          setOrigin(null);
          setEnd(null);
        }}
      >
        <div className="selection-instructions">
          {mode === 'color' ? '移动光标实时取色 · 点击复制 HEX' : '拖动选择截图区域 · 双击全选'}
          <span>Esc 或右键取消</span>
        </div>

        {/* Magnifying Loupe for Color Picker */}
        {mode === 'color' && hoverColor && hoverPoint && (
          <div
            className="color-loupe"
            style={{
              left: `${Math.min(capture.width - 150, Math.max(20, hoverPoint.x + 25))}px`,
              top: `${Math.min(capture.height - 150, Math.max(20, hoverPoint.y + 25))}px`,
            }}
          >
            <div className="loupe-preview" style={{ background: hoverColor.hex }} />
            <div className="loupe-meta">
              <strong>{hoverColor.hex}</strong>
              <span>RGB({hoverColor.r}, {hoverColor.g}, {hoverColor.b})</span>
              <small>十进制: {hoverColor.intVal}</small>
              <small>坐标: {hoverColor.pxX}, {hoverColor.pxY}</small>
            </div>
          </div>
        )}

        {/* Selection Rectangle */}
        {origin && end && (() => {
          const r = normalizedRect(origin, end, capture.width, capture.height);
          return (
            <div
              className="selection-rect"
              style={{
                left: `${(r.x / capture.width) * 100}%`,
                top: `${(r.y / capture.height) * 100}%`,
                width: `${(r.width / capture.width) * 100}%`,
                height: `${(r.height / capture.height) * 100}%`,
              }}
            >
              <span>
                {Math.round(r.width)} × {Math.round(r.height)} px
              </span>
            </div>
          );
        })()}
      </div>
    );
  }

  // Annotation & Action Toolbar Stage
  return (
    <div className="capture-editor">
      <header>
        <span>
          <ScanLine size={18} />
          <strong>dudu 截图</strong>
          <small>
            {crop.width} × {crop.height} px
          </small>
        </span>
        <div>
          <button
            className={showToolbar ? 'selected' : ''}
            onClick={() => setShowToolbar(v => !v)}
            title="折叠/展开标注工具"
          >
            <Layers size={16} />
            标注
          </button>
          <button disabled={busy} onClick={() => void output('ocr')} title="文字识别">
            <ScanLine size={16} />
            识别文字
          </button>
          <button disabled={busy} onClick={() => void output('pin')} title="贴图置顶">
            <Pin size={16} />
            贴图
          </button>
          <button disabled={busy} onClick={() => void output('markdown')} title="复制 Markdown 语法">
            <Code size={16} />
            Markdown
          </button>
          <button disabled={busy} onClick={() => void output('base64')} title="复制 Base64">
            Base64
          </button>
          <button disabled={busy} onClick={() => void output('save')} title="保存文件 (PNG/JPG/WebP)">
            <Download size={16} />
            保存
          </button>
          <button className="primary" disabled={busy} onClick={() => void output('copy')}>
            <Copy size={16} />
            复制图片
          </button>
          <button onClick={() => void call('cancel_capture')} aria-label="取消截图">
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Annotation Tools */}
      {showToolbar && (
        <div className="editor-toolbar">
          {[
            ['arrow', ArrowUpRight, '箭头 (A)'],
            ['line', Slash, '直线 (L)'],
            ['rect', Square, '矩形 (R)'],
            ['ellipse', Circle, '椭圆 (E)'],
            ['pen', Pen, '画笔 (P)'],
            ['text', Type, '文字 (T)'],
            ['highlight', Highlighter, '高亮色块 (H)'],
            ['mosaic', Grid2X2, '马赛克 (M)'],
            ['number', Hash, '步骤序号 (N)'],
          ].map(([id, Icon, label]) => {
            const I = Icon as typeof Square;
            return (
              <button
                key={String(id)}
                aria-label={String(label)}
                title={String(label)}
                className={tool === id ? 'selected' : ''}
                onClick={() => setTool(String(id))}
              >
                <I size={18} />
              </button>
            );
          })}
          <i />
          <input
            aria-label="标注颜色"
            title="选择颜色"
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
          />
          <input
            aria-label="画笔粗细"
            title={`笔触粗细: ${width}px`}
            type="range"
            min="2"
            max="24"
            value={width}
            onChange={e => setWidth(+e.target.value)}
          />
          <i />
          <button aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!shapes.length} onClick={undo}>
            <Undo2 size={18} />
          </button>
          <button aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={!redo.length} onClick={redoOne}>
            <Redo2 size={18} />
          </button>
          <i />
          <button
            title="拼接长截图：将当前切片存入长图队列"
            onClick={() => void output('stitch_add')}
          >
            + 拼入长图
          </button>
          {stitchImages.length > 0 && (
            <button className="primary" onClick={() => void completeStitch()} title="完成拼接并复制">
              <Check size={15} /> 完成长图 ({stitchImages.length + 1} 屏)
            </button>
          )}
        </div>
      )}

      {error && <div role="alert" className="error-banner">{error}</div>}
      {copiedHint && <div className="toast" role="status"><Check size={16} />{copiedHint}</div>}

      {/* Detected QR code card */}
      {detectedQr && (
        <div className="qr-detected-banner">
          <QrCode size={18} />
          <span>
            识别到二维码内容: <strong>{detectedQr}</strong>
          </span>
          <div>
            <button
              onClick={() => {
                void call('write_text', { text: detectedQr });
                setCopiedHint('二维码内容已复制');
                setTimeout(() => setCopiedHint(''), 2000);
              }}
            >
              <Copy size={13} /> 复制
            </button>
            {/^https?:\/\//i.test(detectedQr) && (
              <button onClick={() => void call('open_external', { url: detectedQr })}>
                <ExternalLink size={13} /> 打开链接
              </button>
            )}
          </div>
        </div>
      )}

      {/* Canvas Area */}
      <div className="canvas-stage">
        <canvas
          ref={canvas}
          width={crop.width}
          height={crop.height}
          onPointerDown={e => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = point(e, e.currentTarget, crop.width, crop.height);
            if (tool === 'text') {
              setTextAt(p);
              setText('');
              return;
            }
            if (tool === 'number') {
              add({
                tool,
                points: [p],
                color,
                width,
                index: shapes.filter(s => s.tool === 'number').length + 1,
              });
              return;
            }
            setDrawing({ tool, points: [p, p], color, width });
          }}
          onPointerMove={e => {
            if (!drawing) return;
            const p = point(e, e.currentTarget, crop.width, crop.height);
            setDrawing({
              ...drawing,
              points: tool === 'pen' ? [...drawing.points, p] : [drawing.points[0], p],
            });
          }}
          onPointerUp={() => {
            if (drawing) {
              add(drawing);
              setDrawing(null);
            }
          }}
        />
      </div>

      {mode === 'ocr' && (
        <div className="ocr-prompt">
          <span>选区已确定，点击「识别文字」开始离线 OCR，或直接进入截图翻译。</span>
          <button className="primary" disabled={busy} onClick={() => void output('ocr')}>
            <ScanLine size={15} /> 识别文字
          </button>
        </div>
      )}

      {textAt && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>添加文字标注</h2>
            <textarea
              autoFocus
              className="edit-content"
              placeholder="输入标注文字，支持回车换行…"
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <div className="modal-actions">
              <button className="secondary" onClick={() => setTextAt(null)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => {
                  if (text.trim()) {
                    add({ tool: 'text', points: [textAt], text, color, width });
                  }
                  setTextAt(null);
                }}
              >
                确定添加
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, s: Shape) {
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
  }
  if (s.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      r.x + r.width / 2,
      r.y + r.height / 2,
      r.width / 2,
      r.height / 2,
      0,
      0,
      2 * Math.PI
    );
    ctx.stroke();
  }
  if (s.tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (s.tool === 'arrow' || s.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (s.tool === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const size = Math.max(12, s.width * 4);
      ctx.beginPath();
      ctx.moveTo(b.x - size * Math.cos(angle - 0.45), b.y - size * Math.sin(angle - 0.45));
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(angle + 0.45), b.y - size * Math.sin(angle + 0.45));
      ctx.stroke();
    }
  }
  if (s.tool === 'highlight') {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  if (s.tool === 'text') {
    ctx.font = `600 ${Math.max(18, s.width * 5)}px sans-serif`;
    s.text?.split('\n').forEach((line, i) => {
      ctx.fillText(line, a.x, a.y + i * Math.max(24, s.width * 6));
    });
  }
  if (s.tool === 'number') {
    const rad = Math.max(14, s.width * 4);
    ctx.beginPath();
    ctx.arc(a.x, a.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(15, s.width * 3.8)}px sans-serif`;
    ctx.fillText(String(s.index), a.x, a.y);
  }
  if (s.tool === 'mosaic' && r.width > 0 && r.height > 0) {
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
