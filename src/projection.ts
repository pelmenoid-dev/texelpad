import * as THREE from 'three';
import type { Pixels } from './maps';
import { texelWeights } from './uv-padding.ts';
import type { UvTriangle, UvPoint } from './uv-padding.ts';
import { StrokeVisibility } from './stroke-visibility.ts';
export type Brush = {
  tool: 'brush' | 'pencil' | 'eraser' | 'pick' | 'hand';
  size: number;
  opacity: number;
  color: string;
  value: number;
  hardness: number;
};
type Vertex = {
  x: number;
  y: number;
  iw: number;
  u: number;
  v: number;
};
type Face = {
  world: THREE.Vector3[];
  texels: UvTriangle;
  screen: Vertex[];
  bounds: number[];
};
type SampleTile = {
  // 0: unknown, 1: projected, 2: visible, 3: hidden, 4: outside UV/frustum.
  state: Uint8Array;
  points: Float64Array;
  unavailable: Uint16Array;
};
const tileSize = 16;
const tilePixels = tileSize * tileSize;
const maxSampleTiles = Math.floor(32 * 1024 * 1024 / (tilePixels * 25 + tileSize * 2));
type ProjectionKey = (number | object | null)[];

export function projectionKey(pixels: Pixels, meshes: THREE.Mesh[], camera: THREE.PerspectiveCamera, width: number, height: number): ProjectionKey | undefined {
  camera.updateMatrixWorld();
  // Deformed vertices can change without a BufferAttribute version update.
  // Rebuild their projection for each stroke instead of retaining stale hits.
  if (meshes.some(mesh => mesh instanceof THREE.SkinnedMesh || mesh.morphTargetInfluences?.length)) return;
  const key: ProjectionKey = [pixels.width, pixels.height, width, height, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    key.push(mesh, geometry, mesh.layers.mask, ...mesh.matrixWorld.elements, geometry.drawRange.start, geometry.drawRange.count);
    for (const attribute of [geometry.getAttribute('position'), geometry.getAttribute('uv'), geometry.index]) {
      key.push(attribute, attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute?.version ?? -1);
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    key.push(Number(Array.isArray(mesh.material)), materials.length, ...materials.map(material => material?.side ?? -1), geometry.groups.length);
    for (const group of geometry.groups) key.push(group.start, group.count, group.materialIndex ?? 0);
  }
  return key;
}

export type StrokeProjection = {
  readonly key: ProjectionKey | undefined;
  readonly camera: THREE.PerspectiveCamera;
  readonly faces: Face[];
  readonly visibility: StrokeVisibility;
  readonly sampleTiles: Map<number, SampleTile>;
};
function clip(poly: Vertex[], axis: 'x' | 'y', bound: number, greater: boolean) {
  const output: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ai = greater ? a[axis] >= bound : a[axis] <= bound,
      bi = greater ? b[axis] >= bound : b[axis] <= bound;
    if (ai) output.push(a);
    if (ai !== bi) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      output.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        iw: a.iw + (b.iw - a.iw) * t,
        u: a.u + (b.u - a.u) * t,
        v: a.v + (b.v - a.v) * t
      });
    }
  }
  return output;
}
function rowSpan(poly: UvPoint[], y: number) {
  let left = Infinity, right = -Infinity;
  // A conservative strip includes the texel footprint and the edge nudge.
  // Scanning the whole UV bounding box is costly for long diagonal polygons.
  const low = y - 1, high = y + 2;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dy = b.y - a.y;
    let start = 0, end = 1;
    if (dy === 0) {
      if (a.y < low || a.y > high) continue;
    } else {
      const t0 = (low - a.y) / dy, t1 = (high - a.y) / dy;
      start = Math.max(0, Math.min(t0, t1));
      end = Math.min(1, Math.max(t0, t1));
      if (start > end) continue;
    }
    const x0 = a.x + (b.x - a.x) * start, x1 = a.x + (b.x - a.x) * end;
    left = Math.min(left, x0, x1);
    right = Math.max(right, x0, x1);
  }
  return [Math.floor(left) - 1, Math.ceil(right) + 1];
}
function createProjection(key: ProjectionKey | undefined, pixels: Pixels, meshes: THREE.Mesh[], camera: THREE.PerspectiveCamera, width: number, height: number): StrokeProjection {
  const view = camera.clone();
  view.matrixAutoUpdate = false;
  view.matrix.copy(camera.matrixWorld);
  view.updateMatrixWorld(true);
  camera = view;
  const visibility = new StrokeVisibility(meshes);
  const faces: Face[] = [];
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry,
      uv = geo.getAttribute('uv'),
      idx = geo.index,
      count = idx ? idx.count : geo.getAttribute('position').count;
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(k => idx ? idx.getX(i + k) : i + k);
      const world = ids.map(id => mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      const tex = ids.map(id => new THREE.Vector2(uv.getX(id), uv.getY(id)));
      const screen = world.map((p, k) => {
        const clip = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        const iw = 1 / clip.w;
        return {
          x: (clip.x * iw * .5 + .5) * width,
          y: (.5 - clip.y * iw * .5) * height,
          iw,
          u: tex[k].x * iw,
          v: tex[k].y * iw
        };
      });
      if (screen.some(v => v.iw <= 0)) continue;
      const texels = tex.map(p => ({
        x: p.x * pixels.width,
        y: (1 - p.y) * pixels.height
      })) as UvTriangle;
      faces.push({
        world,
        texels,
        screen,
        bounds: [Math.min(...screen.map(v => v.x)), Math.min(...screen.map(v => v.y)), Math.max(...screen.map(v => v.x)), Math.max(...screen.map(v => v.y))]
      });
    }
  }
  return { key, camera: view, faces, visibility, sampleTiles: new Map() };
}

export class ProjectedStroke {
  coverage: Float32Array;
  base: Uint8ClampedArray;
  changed = false;
  readonly projection: StrokeProjection;
  private coveredRows: Uint16Array;
  private coveredOpacity = NaN;

  constructor(public pixels: Pixels, meshes: THREE.Mesh[], camera: THREE.PerspectiveCamera, private width: number, private height: number, cached?: StrokeProjection) {
    this.base = pixels.data.slice();
    this.coverage = new Float32Array(pixels.width * pixels.height);
    this.coveredRows = new Uint16Array(Math.ceil(pixels.width / tileSize) * pixels.height);
    const key = projectionKey(pixels, meshes, camera, width, height);
    this.projection = cached && key && cached.key && key.length === cached.key.length && key.every((value, i) => value === cached.key![i])
      ? cached : createProjection(key, pixels, meshes, camera, width, height);
  }
  dab(cx: number, cy: number, brush: Brush, grayscale: boolean) {
    let updated = false;
    for (const changed of this.dabSteps(cx, cy, brush, grayscale)) updated = changed || updated;
    return updated;
  }
  *dabSteps(cx: number, cy: number, brush: Brush, grayscale: boolean): Generator<boolean, void> {
    if (brush.opacity <= 0) return;
    // Coverage only increases during a stroke. These bits are valid for the
    // current opacity; changing it rebuilds them lazily from exact coverage.
    if (this.coveredOpacity !== brush.opacity) {
      this.coveredRows.fill(0);
      this.coveredOpacity = brush.opacity;
    }
    let updated = false;
    // Yield inside large footprints as well as between faces. A single dab
    // can exceed a frame; each chunk reports its changes for the live preview.
    let work = 0;
    const { camera, faces, visibility, sampleTiles } = this.projection;
    const r = brush.size / 2,
      w = this.pixels.width,
      h = this.pixels.height,
      tileColumns = Math.ceil(w / tileSize),
      tilesPerFace = tileColumns * Math.ceil(h / tileSize),
      ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2(),
      point = new THREE.Vector3(),
      screen = new THREE.Vector3();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const color = new THREE.Color(brush.color);
    color.convertLinearToSRGB();
    const rgb = grayscale ? [brush.value * 255, brush.value * 255, brush.value * 255] : [color.r * 255, color.g * 255, color.b * 255];
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      if (++work === 128) { yield updated; updated = false; work = 0; }
      const face = faces[faceIndex];
      const [x0, y0, x1, y1] = face.bounds;
      if (x1 < cx - r || x0 > cx + r || y1 < cy - r || y0 > cy + r) continue;
      let poly = clip(face.screen, 'x', cx - r, true);
      poly = clip(poly, 'x', cx + r, false);
      poly = clip(poly, 'y', cy - r, true);
      poly = clip(poly, 'y', cy + r, false);
      if (!poly.length) continue;
      const us = poly.map(v => v.u / v.iw),
        vs = poly.map(v => v.v / v.iw);
      const minX = Math.max(0, Math.floor(Math.min(...us) * w) - 1),
        maxX = Math.min(w - 1, Math.ceil(Math.max(...us) * w));
      const minY = Math.max(0, Math.floor((1 - Math.max(...vs)) * h) - 1),
        maxY = Math.min(h - 1, Math.ceil((1 - Math.min(...vs)) * h));
      const footprint = us.map((u, i) => ({ x: u * w, y: (1 - vs[i]) * h }));
      for (let y = minY; y <= maxY; y++) {
        if (++work === 128) { yield updated; updated = false; work = 0; }
        const [left, right] = rowSpan(footprint, y);
        const startX = Math.max(minX, left), endX = Math.min(maxX, right);
        for (let blockX = Math.floor(startX / tileSize) * tileSize; blockX <= endX; blockX += tileSize) {
          if (++work === 128) { yield updated; updated = false; work = 0; }
          const rowIndex = y * tileColumns + (blockX >>> 4), localY = y & 15;
          const first = Math.max(startX - blockX, 0), last = Math.min(endX - blockX, 15);
          let remaining = ((0xffff << first) & (0xffff >>> (15 - last))) & ~this.coveredRows[rowIndex];
          if (!remaining) continue;
          // Overlapping UV faces need independent entries: a shared texel token
          // evicts the other face on every dab and repeats its visibility ray.
          const tileId = faceIndex * tilesPerFace + (y >>> 4) * tileColumns + (blockX >>> 4);
          let tile = sampleTiles.get(tileId);
          // Bound cached arrays to 32 MiB even on heavily overlapping UV atlases.
          // Entries beyond the budget still use the same exact calculations.
          if (!tile && sampleTiles.size < maxSampleTiles) {
            tile = { state: new Uint8Array(tilePixels), points: new Float64Array(tilePixels * 3), unavailable: new Uint16Array(tileSize) };
            sampleTiles.set(tileId, tile);
          }
          // Skip covered and hidden texels a row of 16 at a time. The remaining
          // bits are visited left to right, preserving overlap/blending order.
          if (tile) remaining &= ~tile.unavailable[localY];
          while (remaining) {
            if (++work === 128) { yield updated; updated = false; work = 0; }
            const bit = remaining & -remaining, localX = 31 - Math.clz32(bit);
            remaining ^= bit;
            const x = blockX + localX, pi = y * w + x;
            if (this.coverage[pi] >= brush.opacity) {
              this.coveredRows[rowIndex] |= bit;
              continue;
            }
            const tileOffset = localY * tileSize + localX, sampleOffset = tileOffset * 3;
            const known = tile?.state[tileOffset] ?? 0;
            let nx: number, ny: number, distance: number;
            if (known) {
              nx = tile!.points[sampleOffset];
              ny = tile!.points[sampleOffset + 1];
              distance = tile!.points[sampleOffset + 2];
            } else {
              const weights = texelWeights(x + .5, y + .5, face.texels);
              if (!weights) {
                if (tile) { tile.state[tileOffset] = 4; tile.unavailable[localY] |= bit; }
                continue;
              }
              // Keep the ray just inside an edge instead of missing it through rounding.
              point.set(0, 0, 0);
              for (let k = 0; k < 3; k++) point.addScaledVector(face.world[k], (weights[k] + 1e-7) / (1 + 3e-7));
              screen.copy(point).project(camera);
              if (screen.z < -1 || screen.z > 1) {
                if (tile) { tile.state[tileOffset] = 4; tile.unavailable[localY] |= bit; }
                continue;
              }
              nx = screen.x;
              ny = screen.y;
              distance = point.distanceTo(eye);
              if (tile) {
                tile.state[tileOffset] = 1;
                tile.points[sampleOffset] = nx;
                tile.points[sampleOffset + 1] = ny;
                tile.points[sampleOffset + 2] = distance;
              }
            }
            const sx = (nx * .5 + .5) * this.width,
              sy = (.5 - ny * .5) * this.height;
            const dx = Math.abs(sx - cx) / r,
              dy = Math.abs(sy - cy) / r,
              d = brush.tool === 'pencil' ? Math.max(dx, dy) : Math.hypot(dx, dy);
            if (d > 1) continue;
            const alpha = brush.opacity * (brush.tool === 'brush' ? Math.min(1, (1 - d) / Math.max(.001, 1 - brush.hardness)) : 1);
            const offset = pi * 4;
            if (alpha <= this.coverage[pi]) continue;
            // Test the actual surface point. A rounded screen-pixel ray can hit a
            // different face (or miss a silhouette), leaving triangular paint gaps.
            if (known !== 2) {
              ndc.set(nx, ny);
              ray.setFromCamera(ndc, camera);
              const visible = visibility.visible(ray.ray, distance);
              if (tile) tile.state[tileOffset] = visible ? 2 : 3;
              if (!visible) {
                if (tile) tile.unavailable[localY] |= bit;
                continue;
              }
            }
            this.coverage[pi] = alpha;
            if (this.coverage[pi] >= brush.opacity) this.coveredRows[rowIndex] |= bit;
            const data = this.pixels.data;
            if (brush.tool === 'eraser' && !grayscale) {
              data[offset + 3] = Math.round(this.base[offset + 3] * (1 - alpha));
            } else {
              const baseAlpha = this.base[offset + 3] / 255,
                outAlpha = alpha + baseAlpha * (1 - alpha);
              for (let c = 0; c < 3; c++) data[offset + c] = Math.round(((brush.tool === 'eraser' ? 0 : rgb[c]) * alpha + this.base[offset + c] * baseAlpha * (1 - alpha)) / Math.max(outAlpha, 1e-8));
              data[offset + 3] = Math.round(outAlpha * 255);
            }
            this.changed = true;
            updated = true;
          }
        }
      }
    }
    yield updated;
  }
}
