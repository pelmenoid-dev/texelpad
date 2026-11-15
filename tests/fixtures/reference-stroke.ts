// Frozen pre-optimization paint oracle. Intentionally slow; never imported by the app.
import * as THREE from 'three';
import type { Pixels } from '../../src/maps.ts';
import { texelWeights } from '../../src/uv-padding.ts';
import type { UvTriangle } from '../../src/uv-padding.ts';
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
export class ReferenceStroke {
  faces: Face[] = [];
  coverage: Float32Array;
  base: Uint8ClampedArray;
  changed = false;
  constructor(public pixels: Pixels, private meshes: THREE.Mesh[], private camera: THREE.PerspectiveCamera, private width: number, private height: number) {
    this.base = pixels.data.slice();
    this.coverage = new Float32Array(pixels.width * pixels.height);
    camera.updateMatrixWorld();
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
        this.faces.push({
          world,
          texels,
          screen,
          bounds: [Math.min(...screen.map(v => v.x)), Math.min(...screen.map(v => v.y)), Math.max(...screen.map(v => v.x)), Math.max(...screen.map(v => v.y))]
        });
      }
    }
  }
  dab(cx: number, cy: number, brush: Brush, grayscale: boolean) {
    const r = brush.size / 2,
      w = this.pixels.width,
      h = this.pixels.height,
      ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2(),
      point = new THREE.Vector3();
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const color = new THREE.Color(brush.color);
    color.convertLinearToSRGB();
    const rgb = grayscale ? [brush.value * 255, brush.value * 255, brush.value * 255] : [color.r * 255, color.g * 255, color.b * 255];
    for (const face of this.faces) {
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
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const weights = texelWeights(x + .5, y + .5, face.texels);
        if (!weights) continue;
        // Keep the ray just inside an edge instead of missing it through rounding.
        point.set(0, 0, 0);
        for (let k = 0; k < 3; k++) point.addScaledVector(face.world[k], (weights[k] + 1e-7) / (1 + 3e-7));
        const distance = point.distanceTo(eye),
          screen = point.clone().project(this.camera);
        if (screen.z < -1 || screen.z > 1) continue;
        const sx = (screen.x * .5 + .5) * this.width,
          sy = (.5 - screen.y * .5) * this.height;
        const dx = Math.abs(sx - cx) / r,
          dy = Math.abs(sy - cy) / r,
          d = brush.tool === 'pencil' ? Math.max(dx, dy) : Math.hypot(dx, dy);
        if (d > 1) continue;
        const alpha = brush.opacity * (brush.tool === 'brush' ? Math.min(1, (1 - d) / Math.max(.001, 1 - brush.hardness)) : 1);
        const pi = y * w + x,
          offset = pi * 4;
        if (alpha <= this.coverage[pi]) continue;
        // Test the actual surface point. A rounded screen-pixel ray can hit a
        // different face (or miss a silhouette), leaving triangular paint gaps.
        ndc.set(screen.x, screen.y);
        ray.setFromCamera(ndc, this.camera);
        const front = ray.intersectObjects(this.meshes, false)[0]?.distance ?? Infinity;
        const tolerance = Math.max(1e-6, distance * 1e-6);
        if (!Number.isFinite(front) || distance > front + tolerance) continue;
        this.coverage[pi] = alpha;
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
      }
    }
  }
}
