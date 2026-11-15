import type { Mesh } from 'three';
import type { Pixels } from './maps';
export type UvPoint = {
  x: number;
  y: number;
};
export type UvTriangle = [UvPoint, UvPoint, UvPoint];

// A texel has an area. Its center need not be inside the UV triangle for the
// triangle to sample it with nearest filtering. Return a surface point for it.
export function texelWeights(x: number, y: number, t: UvTriangle): number[] | null {
  const [a, b, c] = t,
    den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(den) < 1e-12) return null;
  const s = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den;
  const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den;
  const marginA = .5 * (Math.abs(b.y - c.y) + Math.abs(c.x - b.x)) / Math.abs(den);
  const marginB = .5 * (Math.abs(c.y - a.y) + Math.abs(a.x - c.x)) / Math.abs(den);
  const marginC = .5 * (Math.abs(a.y - b.y) + Math.abs(b.x - a.x)) / Math.abs(den);
  if (s >= marginA && v >= marginB && 1 - s - v >= marginC) return [s, v, 1 - s - v];
  // Clip to the actual square footprint. Projecting the center onto an edge
  // puts visibility rays on a mesh seam, where the neighbouring face can hide
  // them. The interior of the clipped polygon is a stable surface sample.
  let polygon: UvPoint[] = t;
  for (const [axis, bound, sign] of [['x', x - .5, 1], ['x', x + .5, -1], ['y', y - .5, 1], ['y', y + .5, -1]] as const) {
    const clipped: UvPoint[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dp = (p[axis] - bound) * sign, dq = (q[axis] - bound) * sign;
      if (dp >= 0) clipped.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const f = dp / (dp - dq);
        clipped.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
      }
    }
    polygon = clipped;
    if (polygon.length < 3) return null;
  }
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) {
    const p = polygon[i], q = polygon[i + 1], o = polygon[0];
    area += (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  }
  if (Math.abs(area) < 1e-12) return null;
  const px = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
  const py = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
  const u = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / den;
  const w = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / den;
  return [u, w, 1 - u - w];
}
export type UvPadding = {
  width: number;
  height: number;
  nearest: Uint32Array;
};
export function paddedIndex(layout: UvPadding, p: number, rx: number, ry: number): number {
  const from = layout.nearest[p] - 1,
    w = layout.width;
  return from >= 0 && Math.abs(p % w - from % w) <= rx && Math.abs(Math.floor(p / w) - Math.floor(from / w)) <= ry ? from : p;
}

// Geometry-only lookup, reused across strokes and all maps of the same size.
// Owned texels always point to themselves, including transparent/erased ones.
export function buildUvPadding(meshes: Mesh[], width: number, height: number): UvPadding {
  const nearest = new Uint32Array(width * height);
  for (const mesh of meshes) {
    const uv = mesh.geometry.getAttribute('uv'),
      index = mesh.geometry.index;
    if (!uv) continue;
    const count = index?.count ?? uv.count;
    for (let i = 0; i < count; i += 3) {
      const t = [0, 1, 2].map(k => {
        const id = index ? index.getX(i + k) : i + k;
        return {
          x: uv.getX(id) * width,
          y: (1 - uv.getY(id)) * height
        };
      }) as UvTriangle;
      const minX = Math.max(0, Math.floor(Math.min(...t.map(p => p.x)) - 1)),
        maxX = Math.min(width - 1, Math.ceil(Math.max(...t.map(p => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...t.map(p => p.y)) - 1)),
        maxY = Math.min(height - 1, Math.ceil(Math.max(...t.map(p => p.y))));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const p = y * width + x;
        if (!nearest[p] && texelWeights(x + .5, y + .5, t)) nearest[p] = p + 1;
      }
    }
  }
  const queue = new Uint32Array(width * height);
  let head = 0,
    tail = 0;
  // Start only at island borders; the queue never contains the whole interior.
  for (let p = 0; p < nearest.length; p++) if (nearest[p]) {
    const x = p % width;
    if (x > 0 && !nearest[p - 1] || x + 1 < width && !nearest[p + 1] || p >= width && !nearest[p - width] || p + width < nearest.length && !nearest[p + width]) queue[tail++] = p;
  }
  while (head < tail) {
    const p = queue[head++],
      x = p % width;
    const visit = (q: number) => {
      if (!nearest[q]) {
        nearest[q] = nearest[p];
        queue[tail++] = q;
      }
    };
    if (x > 0) visit(p - 1);
    if (x + 1 < width) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p + width < nearest.length) visit(p + width);
  }
  return {
    width,
    height,
    nearest
  };
}

// Extend only into the UV gutter, never across another island or an alpha cutout.
// One grid cell of gutter also covers fractional grids and unequal map sizes.
export function padUvGutters(source: Pixels, layout: UvPadding, gridWidth: number, gridHeight: number): Pixels {
  if (source.width !== layout.width || source.height !== layout.height) throw Error('UV padding size mismatch');
  const data = source.data.slice(),
    w = source.width;
  const rx = Math.ceil(w / gridWidth),
    ry = Math.ceil(source.height / gridHeight);
  for (let p = 0; p < layout.nearest.length; p++) {
    const from = paddedIndex(layout, p, rx, ry);
    if (from === p) continue;
    for (let c = 0; c < 4; c++) data[p * 4 + c] = source.data[from * 4 + c];
  }
  return {
    ...source,
    data
  };
}
