import { paddedIndex } from './uv-padding.ts';
import type { UvPadding } from './uv-padding.ts';
export type MapKind = 'diffuse' | 'spec' | 'glow';
export const MAPS: MapKind[] = ['diffuse', 'spec', 'glow'];
export type Pixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};
export type Processing = {
  enabled: boolean;
  texels: number;
  dither: number;
  levels: number;
};
export const defaults: Processing = {
  enabled: true,
  texels: 4,
  dither: 0.3,
  levels: 256
};
export const bayer = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
export function gridSize(width: number, height: number, texels: number) {
  return [Math.max(1, Math.floor(width / Math.max(1, texels))), Math.max(1, Math.floor(height / Math.max(1, texels)))];
}
// Rows are Bayer cells, columns are source bytes. Both CPU processing and the
// live GPU display use these exact bytes, avoiding quantization-boundary drift.
// Diffuse is quantized in its encoded sRGB values; masks in linear intensity.
export function quantizationTable(settings?: Pick<Processing, 'enabled' | 'levels' | 'dither'>) {
  const steps = settings?.enabled ? Math.max(1, Math.min(255, Math.round(settings.levels) - 1)) : 255;
  const strength = settings?.enabled ? Math.max(0, Math.min(1, settings.dither)) : 0;
  const table = new Uint8Array(256 * 64);
  for (let cell = 0; cell < 64; cell++) {
    const offset = ((bayer[cell] + .5) / 64 - .5) * strength;
    for (let value = 0; value < 256; value++) {
      const level = Math.max(0, Math.min(steps, Math.floor(value * steps / 255 + offset + .5)));
      table[cell * 256 + value] = Math.round(level * 255 / steps);
    }
  }
  return table;
}
export function processMap(source: Pixels, width: number, height: number, settings: Processing, padding?: UvPadding): Pixels {
  if (!settings.enabled) return {
    ...source,
    data: source.data.slice()
  };
  const [w, h] = gridSize(width, height, settings.texels);
  const data = new Uint8ClampedArray(w * h * 4);
  const colors = quantizationTable(settings);
  const rx = Math.ceil(source.width / w),
    ry = Math.ceil(source.height / h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(source.width - 1, Math.floor((x + 0.5) / w * source.width));
    const sy = Math.min(source.height - 1, Math.floor((y + 0.5) / h * source.height));
    const pixel = sy * source.width + sx;
    const src = (padding ? paddedIndex(padding, pixel, rx, ry) : pixel) * 4,
      dst = (y * w + x) * 4;
    const cell = ((y & 7) * 8 + (x & 7)) * 256;
    for (let c = 0; c < 3; c++) data[dst + c] = colors[cell + source.data[src + c]];
    data[dst + 3] = source.data[src + 3];
  }
  return {
    width: w,
    height: h,
    data
  };
}
export function canvasOf(p: Pixels, target = document.createElement('canvas')) {
  target.width = p.width;
  target.height = p.height;
  target.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return target;
}
export function pixelsOf(c: HTMLCanvasElement): Pixels {
  return {
    width: c.width,
    height: c.height,
    data: c.getContext('2d', {
      willReadFrequently: true
    })!.getImageData(0, 0, c.width, c.height).data
  };
}
export function blankMap(kind: MapKind, w = 512, h = 512): Pixels {
  const data = new Uint8ClampedArray(w * h * 4),
    value = kind === 'diffuse' ? 212 : 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  return {
    width: w,
    height: h,
    data
  };
}
export async function readMap(file: File, kind: MapKind): Promise<Pixels> {
  if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error('Choose a PNG or JPEG.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Maximum map size: 4096 × 4096. Resize the image before importing.');
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    const p = pixelsOf(c);
    if (kind !== 'diffuse') for (let i = 0; i < p.data.length; i += 4) {
      const l = Math.round(p.data[i] * .2126 + p.data[i + 1] * .7152 + p.data[i + 2] * .0722);
      p.data[i] = p.data[i + 1] = p.data[i + 2] = l;
      p.data[i + 3] = 255;
    }
    return p;
  } finally {
    bitmap.close();
  }
}
export type Change = {
  kind: MapKind;
  before: Pixels;
  after: Pixels;
  label: string;
};
export class History {
  past: Change[] = [];
  future: Change[] = [];
  push(change: Change) {
    this.past.push(change);
    this.future = [];
    while (this.past.length > 30 || this.past.length > 1 && this.bytes() > 128 * 1024 * 1024) this.past.shift();
  }
  bytes() {
    return this.past.reduce((n, x) => n + x.before.data.byteLength + x.after.data.byteLength, 0);
  }
  undo() {
    const c = this.past.pop();
    if (c) this.future.push(c);
    return c;
  }
  redo() {
    const c = this.future.pop();
    if (c) this.past.push(c);
    return c;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
export function copyPixels(p: Pixels): Pixels {
  return {
    ...p,
    data: p.data.slice()
  };
}
