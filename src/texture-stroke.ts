import type { Pixels } from './maps';
import type { Brush } from './projection';

export type TextureRect = { left: number; top: number; width: number; height: number };
export type TextureSampling = { width: number; height: number; indices: Uint32Array };

// Match object-fit: contain, including rectangular maps in the square preview.
export function textureRect(width: number, height: number, mapWidth: number, mapHeight: number): TextureRect {
  const scale = Math.min(width / mapWidth, height / mapHeight);
  const w = mapWidth * scale, h = mapHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

// A brush narrower than a displayed texel must still address that texel.
// Snap only these sub-pixel dabs to its editable source sample, including UV
// padding. Interpolation still runs in preview coordinates, before snapping.
export function textureDab(x: number, y: number, size: number, rect: TextureRect, pixels: Pixels, sampling?: TextureSampling): [number, number] {
  const width = sampling?.width ?? pixels.width, height = sampling?.height ?? pixels.height;
  if (size >= Math.max(rect.width / width, rect.height / height, rect.width / pixels.width, rect.height / pixels.height)
    || x < rect.left || y < rect.top || x >= rect.left + rect.width || y >= rect.top + rect.height) return [x, y];
  const u = (x - rect.left) / rect.width, v = (y - rect.top) / rect.height;
  const index = sampling ? sampling.indices[Math.floor(v * height) * width + Math.floor(u * width)]
    : Math.floor(v * pixels.height) * pixels.width + Math.floor(u * pixels.width);
  return [rect.left + (index % pixels.width + .5) / pixels.width * rect.width,
    rect.top + (Math.floor(index / pixels.width) + .5) / pixels.height * rect.height];
}

// CPU fallback for direct texture painting. Coverage is accumulated once per
// stroke, so slower movement does not build up opacity differently from 3D.
export class TextureStroke {
  readonly base: Uint8ClampedArray;
  private coverage: Float32Array;
  changed = false;
  constructor(readonly pixels: Pixels, readonly rect: TextureRect, private sampling?: TextureSampling) {
    this.base = pixels.data.slice();
    this.coverage = new Float32Array(pixels.width * pixels.height);
  }
  *dabSteps(cx: number, cy: number, brush: Brush, grayscale: boolean): Generator<boolean, void> {
    if (brush.opacity <= 0) return;
    [cx, cy] = textureDab(cx, cy, brush.size, this.rect, this.pixels, this.sampling);
    const { width: w, height: h, data } = this.pixels, rect = this.rect, r = brush.size / 2;
    const minX = Math.max(0, Math.floor((cx - r - rect.left) / rect.width * w));
    const maxX = Math.min(w - 1, Math.floor((cx + r - rect.left) / rect.width * w));
    const minY = Math.max(0, Math.floor((cy - r - rect.top) / rect.height * h));
    const maxY = Math.min(h - 1, Math.floor((cy + r - rect.top) / rect.height * h));
    const rgb = grayscale ? [brush.value * 255, brush.value * 255, brush.value * 255]
      : [1, 3, 5].map(i => parseInt(brush.color.slice(i, i + 2), 16));
    let updated = false;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = Math.abs(rect.left + (x + .5) / w * rect.width - cx) / r;
        const dy = Math.abs(rect.top + (y + .5) / h * rect.height - cy) / r;
        const d = brush.tool === 'pencil' ? Math.max(dx, dy) : Math.hypot(dx, dy);
        if (d > 1) continue;
        const alpha = brush.opacity * (brush.tool === 'brush' ? Math.min(1, (1 - d) / Math.max(.001, 1 - brush.hardness)) : 1);
        const p = y * w + x, offset = p * 4;
        if (alpha <= this.coverage[p]) continue;
        this.coverage[p] = alpha;
        if (brush.tool === 'eraser' && !grayscale) data[offset + 3] = Math.round(this.base[offset + 3] * (1 - alpha));
        else {
          const baseAlpha = this.base[offset + 3] / 255, outAlpha = alpha + baseAlpha * (1 - alpha);
          for (let c = 0; c < 3; c++) data[offset + c] = Math.round(((brush.tool === 'eraser' ? 0 : rgb[c]) * alpha + this.base[offset + c] * baseAlpha * (1 - alpha)) / Math.max(outAlpha, 1e-8));
          data[offset + 3] = Math.round(outAlpha * 255);
        }
        this.changed = updated = true;
      }
      if ((y - minY) % 8 === 7) { yield updated; updated = false; }
    }
    yield updated;
  }
}
