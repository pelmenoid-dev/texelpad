import { useEffect, useRef } from 'react';
import { canvasOf } from '../maps';
import type { MapKind, Pixels } from '../maps';
import type { Studio } from '../studio';
import { textureRect } from '../texture-stroke';

export function TextureCanvas({ studio, kind, name }: { studio: Studio | null; kind: MapKind; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), cursor = useRef<HTMLDivElement>(null);
  const pixels = studio?.processed[kind];
  useEffect(() => {
    if (!studio || !ref.current) return;
    const canvas = ref.current;
    const draw = (pixels: Pixels) => canvasOf(pixels, canvas);
    draw(studio.processed[kind]);
    // Paint frames update the canvas without rerendering the editor controls.
    const unsubscribe = studio.subscribeTexture(kind, draw), unbind = studio.bindTextureCanvas(canvas);
    return () => { unsubscribe(); unbind(); };
  }, [studio, kind]);
  useEffect(() => {
    const canvas = overlay.current;
    if (!studio || !canvas || !studio.uvVisible || !pixels) return;
    const path = new Path2D();
    for (const mesh of studio.meshes) {
      const { geometry } = mesh, uv = geometry.getAttribute('uv'), index = geometry.index;
      if (!uv) continue;
      const edges = new Set<string>();
      for (let i = 0; i < (index?.count ?? uv.count); i += 3) {
        const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
        for (let k = 0; k < 3; k++) {
          const a = ids[k], b = ids[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (edges.has(key)) continue;
          edges.add(key);
          path.moveTo(uv.getX(a), 1 - uv.getY(a));
          path.lineTo(uv.getX(b), 1 - uv.getY(b));
        }
      }
    }
    const draw = () => {
      const box = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      const rect = textureRect(canvas.width, canvas.height, pixels.width, pixels.height), ctx = canvas.getContext('2d')!;
      const fitted = new Path2D();
      fitted.addPath(path, new DOMMatrix([rect.width, 0, 0, rect.height, rect.left, rect.top]));
      ctx.strokeStyle = 'rgb(255 255 255 / 70%)';
      ctx.lineWidth = 2.5 * ratio;
      ctx.stroke(fitted);
      ctx.strokeStyle = 'rgb(25 22 33 / 85%)';
      ctx.lineWidth = ratio;
      ctx.stroke(fitted);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [studio, studio?.model, studio?.uvVisible, pixels?.width, pixels?.height]);
  const tool = studio?.brush.tool;
  return <>
    <canvas ref={ref} className="texture-paint-canvas" role="img" aria-label={`${name} texture preview`}
      onPointerMove={e => {
        if (!cursor.current || !studio || !pixels) return;
        const box = e.currentTarget.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
        const rect = textureRect(box.width, box.height, pixels.width, pixels.height);
        const visible = e.pointerType !== 'touch' && tool !== 'hand' && x >= rect.left && y >= rect.top && x < rect.left + rect.width && y < rect.top + rect.height;
        cursor.current.style.display = visible ? 'block' : 'none';
        cursor.current.style.left = `${x}px`;
        cursor.current.style.top = `${y}px`;
      }}
      onPointerLeave={() => { if (cursor.current) cursor.current.style.display = 'none'; }}
    />
    {studio?.uvVisible && <canvas ref={overlay} className="texture-uv-overlay" aria-hidden="true" />}
    <div ref={cursor} className={`brush-cursor${tool === 'pencil' ? ' square' : ''}`} aria-hidden="true"
      style={{ width: tool === 'pick' ? 1 : studio?.brush.size, height: tool === 'pick' ? 1 : studio?.brush.size }} />
  </>;
}
