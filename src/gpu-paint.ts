import * as THREE from 'three';
import { quantizationTable } from './maps';
import type { Pixels, Processing } from './maps';
import type { Brush } from './projection';
import { projectionKey } from './projection';
import type { StrokeSink } from './stroke-queue';
import type { TextureRect } from './texture-stroke';
import { textureDab } from './texture-stroke';
import { StrokeVisibility } from './stroke-visibility';
import { MAX_DABS, compositeFragment, coverageFragment, coverageVertex, displayFragment, fullscreenVertex, textureCoverageFragment } from './gpu-paint-shaders';

const options = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
function table(data: Float32Array, maxSize: number) {
  const width = Math.min(maxSize, Math.max(1, data.length / 4));
  const height = Math.max(1, Math.ceil(data.length / 4 / width));
  if (height > maxSize)
    throw Error('Paint geometry exceeds GPU texture limits.');
  const padded = new Float32Array(width * height * 4);
  padded.set(data);
  const texture = new THREE.DataTexture(padded, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}
function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, side: THREE.DoubleSide });
}
class Surface {
  key: ReturnType<typeof projectionKey>;
  geometry = new THREE.BufferGeometry();
  faces: THREE.DataTexture;
  nodes: THREE.DataTexture;
  triangles: THREE.DataTexture;
  nodeCount: number;
  viewProjection: THREE.Matrix4;
  constructor(pixels: Pixels, meshes: THREE.Mesh[], camera: THREE.PerspectiveCamera, width: number, height: number, maxSize: number) {
    this.key = projectionKey(pixels, meshes, camera, width, height);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const view = camera.matrixWorldInverse.clone();
    view.setPosition(0, 0, 0);
    this.viewProjection = camera.projectionMatrix.clone().multiply(view);
    const bvh = new StrokeVisibility(meshes).gpuData(eye);
    const positions: number[] = [], ids: number[] = [], indices: number[] = [], faces: number[] = [];
    for (const mesh of meshes) {
      const geo = mesh.geometry, uv = geo.getAttribute('uv'), index = geo.index;
      const count = index?.count ?? geo.getAttribute('position').count;
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
        const world = vertices.map(id => mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).sub(eye));
        if (world.some(p => new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(this.viewProjection).w <= 0))
          continue;
        const texels = vertices.map(id => new THREE.Vector2(uv.getX(id) * pixels.width, (1 - uv.getY(id)) * pixels.height));
        const [ta, tb, tc] = texels;
        // Reject collapsed UVs before float/FMA rounding on the GPU can turn
        // their zero area into a tiny triangle that paints unrelated texels.
        if (Math.abs((tb.y - tc.y) * (ta.x - tc.x) + (tc.x - tb.x) * (ta.y - tc.y)) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...texels.map(t => t.x)) - 1));
        const y0 = Math.max(0, Math.floor(Math.min(...texels.map(t => t.y)) - 1));
        const x1 = Math.min(pixels.width, Math.ceil(Math.max(...texels.map(t => t.x))) + 1);
        const y1 = Math.min(pixels.height, Math.ceil(Math.max(...texels.map(t => t.y))) + 1);
        if (x0 >= x1 || y0 >= y1)
          continue;
        // Keep tiny UV islands representable: subtract the integer tile origin
        // before converting to float, rather than rounding large atlas UVs.
        for (const t of texels)
          t.sub(new THREE.Vector2(x0, y0));
        const face = faces.length / 20, vertex = positions.length / 3;
        // Five RGBA entries per face, decoded by coverageFragment: anchor,
        // two world-space edges, local UVs, BVH triangle and atlas origin.
        faces.push(
          ...world[0].toArray(), texels[0].x,
          ...world[1].clone().sub(world[0]).toArray(), texels[0].y,
          ...world[2].clone().sub(world[0]).toArray(), texels[1].x,
          texels[1].y, texels[2].x, texels[2].y, bvh.indices.get(mesh)?.get(i) ?? -1,
          x0, y0, 0, 0,
        );
        positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
        ids.push(face, face, face, face);
        indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
      }
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('faceId', new THREE.Float32BufferAttribute(ids, 1));
    this.geometry.setIndex(indices);
    this.faces = table(new Float32Array(faces), maxSize);
    this.nodes = table(bvh.nodes, maxSize);
    this.triangles = table(bvh.triangles, maxSize);
    this.nodeCount = bvh.nodes.length / 8;
  }
  matches(key: ReturnType<typeof projectionKey>) {
    return !!key && !!this.key && key.length === this.key.length && key.every((v, i) => v === this.key![i]);
  }
  dispose() {
    this.geometry.dispose();
    this.faces.dispose();
    this.nodes.dispose();
    this.triangles.dispose();
  }
}
// Owns one surface cache and one active stroke. CPU painting remains available
// for contexts without renderable/blendable 32-bit float attachments.
export class GpuPainter {
  private surface?: Surface;
  private disposed = false;
  private failed = false;
  private quad = new THREE.PlaneGeometry(2, 2);
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private coverage = material(coverageVertex, coverageFragment, {
    faces: { value: null }, nodes: { value: null }, triangles: { value: null }, nodeCount: { value: 0 },
    viewProjection: { value: new THREE.Matrix4() }, viewport: { value: new THREE.Vector2() }, mapSize: { value: new THREE.Vector2() },
    dabs: { value: Array.from({ length: MAX_DABS }, () => new THREE.Vector2()) }, dabCount: { value: 0 }, radius: { value: 1 }, opacity: { value: 1 }, hardness: { value: 1 }, tool: { value: 0 },
  });
  private composite = material(fullscreenVertex, compositeFragment, {
    base: { value: null }, previous: { value: null }, previousCoverage: { value: null }, coverage: { value: null },
    color: { value: new THREE.Vector3() }, eraseAlpha: { value: false }, initialize: { value: false },
  });
  private textureCoverage = material(fullscreenVertex, textureCoverageFragment, {
    ...Object.fromEntries(['mapSize', 'dabs', 'dabCount', 'radius', 'opacity', 'hardness', 'tool'].map(key => [key, this.coverage.uniforms[key]])),
    rect: { value: new THREE.Vector4() },
  });
  private display = material(fullscreenVertex, displayFragment, { painted: { value: null }, sampling: { value: null }, quantization: { value: null }, srgb: { value: false } });
  constructor(readonly renderer: THREE.WebGLRenderer) {
    this.mesh = new THREE.Mesh(this.quad, this.composite);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.coverage.blending = THREE.CustomBlending;
    this.coverage.blendEquation = THREE.MaxEquation;
    this.coverage.blendSrc = THREE.OneFactor;
    this.coverage.blendDst = THREE.OneFactor;
    this.reset();
  }
  private warmup() {
    // Exercise the actual float/MRT pipelines on a one-pixel offscreen target.
    // Shader linking and driver pipeline creation happen before a gesture.
    const stroke = new GpuStroke(this, { width: 1, height: 1, data: new Uint8ClampedArray(4) }, new Uint32Array(1), 1, 1, false);
    const empty = table(new Float32Array(20), this.renderer.capabilities.maxTextureSize), geometry = this.quad.clone();
    geometry.setAttribute('faceId', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
    try {
      const u = this.coverage.uniforms;
      u.faces.value = empty;
      u.nodes.value = empty;
      u.triangles.value = empty;
      u.mapSize.value.set(1, 1);
      u.viewport.value.set(1, 1);
      this.draw(this.coverage, stroke.coverage, geometry, true);
      this.draw(this.textureCoverage, stroke.coverage);
      this.initialize(stroke);
      this.draw(this.composite, stroke.next);
      this.present(stroke);
    }
    finally {
      stroke.dispose();
      empty.dispose();
      geometry.dispose();
      this.clearSurface();
    }
  }
  get supported() {
    return !this.disposed && !this.failed && !this.renderer.getContext().isContextLost() && this.renderer.extensions.has('EXT_color_buffer_float') && this.renderer.extensions.has('EXT_float_blend');
  }
  disable() {
    this.failed = true;
    this.clearSurface();
  }
  reset() {
    this.clearSurface();
    this.failed = false;
    if (this.supported) {
      try { this.warmup(); }
      catch { this.disable(); }
    }
  }
  begin(pixels: Pixels, meshes: THREE.Mesh[], camera: THREE.PerspectiveCamera, width: number, height: number, sampling: Uint32Array, outputWidth: number, outputHeight: number, grayscale: boolean, processing?: Processing) {
    if (!this.supported)
      return;
    const limit = this.renderer.capabilities.maxTextureSize;
    if (Math.max(pixels.width, pixels.height, outputWidth, outputHeight) > limit)
      return;
    const key = projectionKey(pixels, meshes, camera, width, height);
    if (!this.surface?.matches(key)) {
      this.clearSurface();
      this.surface = new Surface(pixels, meshes, camera, width, height, this.renderer.capabilities.maxTextureSize);
    }
    const u = this.coverage.uniforms;
    u.faces.value = this.surface.faces;
    u.nodes.value = this.surface.nodes;
    u.triangles.value = this.surface.triangles;
    u.nodeCount.value = this.surface.nodeCount;
    u.viewProjection.value = this.surface.viewProjection;
    u.viewport.value.set(width, height);
    u.mapSize.value.set(pixels.width, pixels.height);
    return new GpuStroke(this, pixels, sampling, outputWidth, outputHeight, grayscale, processing);
  }
  beginTexture(pixels: Pixels, rect: TextureRect, sampling: Uint32Array, width: number, height: number, grayscale: boolean, processing: Processing) {
    if (!this.supported || Math.max(pixels.width, pixels.height, width, height) > this.renderer.capabilities.maxTextureSize) return;
    return new GpuStroke(this, pixels, sampling, width, height, grayscale, processing, rect);
  }
  clearSurface() {
    this.surface?.dispose();
    this.surface = undefined;
    this.mesh.geometry = this.quad;
    for (const name of ['faces', 'nodes', 'triangles']) this.coverage.uniforms[name].value = null;
  }
  private draw(shader: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget, geometry: THREE.BufferGeometry = this.quad, clear = false) {
    const r = this.renderer, previous = r.getRenderTarget(), autoClear = r.autoClear;
    const color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    try {
      r.autoClear = false;
      r.setRenderTarget(target);
      if (clear) {
        r.setClearColor(0, 0);
        r.clear(true, false, false);
      }
      this.mesh.geometry = geometry;
      this.mesh.material = shader;
      r.render(this.scene, this.camera);
    }
    finally {
      r.setRenderTarget(previous);
      r.autoClear = autoClear;
      r.setClearColor(color, alpha);
    }
  }
  initialize(stroke: GpuStroke) {
    const u = this.composite.uniforms;
    u.base.value = stroke.baseTexture;
    // Bind real textures even for the initialization branch; samplers must not
    // alias an attached target or conflict with the integer sampling texture.
    u.previous.value = stroke.baseTexture;
    u.previousCoverage.value = stroke.baseTexture;
    u.coverage.value = stroke.baseTexture;
    u.initialize.value = true;
    this.draw(this.composite, stroke.current);
    u.initialize.value = false;
  }
  paint(stroke: GpuStroke, points: THREE.Vector2[], brush: Brush, grayscale: boolean) {
    const u = this.coverage.uniforms;
    points.forEach((point, i) => u.dabs.value[i].copy(point));
    u.dabCount.value = points.length;
    u.radius.value = brush.size / 2;
    u.opacity.value = brush.opacity;
    u.hardness.value = brush.hardness;
    u.tool.value = brush.tool === 'pencil' ? 0 : brush.tool === 'brush' ? 1 : 2;
    if (stroke.textureRect) {
      const rect = stroke.textureRect;
      u.mapSize.value.set(stroke.pixels.width, stroke.pixels.height);
      this.textureCoverage.uniforms.rect.value.set(rect.left, rect.top, rect.width, rect.height);
      this.draw(this.textureCoverage, stroke.coverage);
    } else this.draw(this.coverage, stroke.coverage, this.surface!.geometry, true);
    const c = this.composite.uniforms, color = new THREE.Color(brush.color).convertLinearToSRGB();
    c.base.value = stroke.baseTexture;
    c.previous.value = stroke.current.texture;
    c.previousCoverage.value = stroke.current.textures[1];
    c.coverage.value = stroke.coverage.texture;
    c.eraseAlpha.value = brush.tool === 'eraser' && !grayscale;
    const rgb = brush.tool === 'eraser' ? [0, 0, 0] : grayscale ? [brush.value, brush.value, brush.value] : [color.r, color.g, color.b];
    c.color.value.set(rgb[0], rgb[1], rgb[2]);
    this.draw(this.composite, stroke.next);
    [stroke.current, stroke.next] = [stroke.next, stroke.current];
  }
  present(stroke: GpuStroke) {
    const u = this.display.uniforms;
    u.painted.value = stroke.current.texture;
    u.sampling.value = stroke.sampling;
    u.quantization.value = stroke.quantization;
    u.srgb.value = !stroke.grayscale;
    this.draw(this.display, stroke.output);
  }
  release(stroke: GpuStroke) {
    if (this.composite.uniforms.base.value === stroke.baseTexture) {
      for (const name of ['base', 'previous', 'previousCoverage', 'coverage']) this.composite.uniforms[name].value = null;
    }
    if (this.display.uniforms.sampling.value === stroke.sampling) {
      this.display.uniforms.painted.value = null;
      this.display.uniforms.sampling.value = null;
      this.display.uniforms.quantization.value = null;
    }
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.clearSurface();
    this.quad.dispose();
    this.coverage.dispose();
    this.textureCoverage.dispose();
    this.composite.dispose();
    this.display.dispose();
  }
}
function paintTarget(width: number, height: number) {
  const target = new THREE.WebGLRenderTarget(width, height, { ...options, count: 2 });
  target.textures[1].format = THREE.RedFormat;
  target.textures[1].type = THREE.FloatType;
  target.textures[1].internalFormat = 'R32F';
  return target;
}
export class GpuStroke {
  readonly base: Uint8ClampedArray;
  readonly baseTexture: THREE.DataTexture;
  readonly coverage: THREE.WebGLRenderTarget;
  readonly output: THREE.WebGLRenderTarget;
  readonly sampling: THREE.DataTexture;
  readonly quantization: THREE.DataTexture;
  current: THREE.WebGLRenderTarget;
  next: THREE.WebGLRenderTarget;
  changed = false;
  private points: THREE.Vector2[] = [];
  private brush?: Brush;
  private initialized = false;
  private previewPending = false;
  private revision = 0;
  private disposed = false;
  private replay: {
    x: number;
    y: number;
    brush: Brush;
  }[] = [];
  constructor(private painter: GpuPainter, readonly pixels: Pixels, sampling: Uint32Array, width: number, height: number, readonly grayscale: boolean, processing?: Processing, readonly textureRect?: TextureRect) {
    this.base = pixels.data.slice();
    this.baseTexture = new THREE.DataTexture(new Uint8Array(this.base.buffer), pixels.width, pixels.height);
    this.baseTexture.needsUpdate = true;
    this.current = paintTarget(pixels.width, pixels.height);
    this.next = paintTarget(pixels.width, pixels.height);
    this.coverage = new THREE.WebGLRenderTarget(pixels.width, pixels.height, { ...options, format: THREE.RedFormat, type: THREE.FloatType });
    this.output = new THREE.WebGLRenderTarget(width, height, { ...options, colorSpace: grayscale ? THREE.NoColorSpace : THREE.SRGBColorSpace });
    this.sampling = new THREE.DataTexture(sampling, width, height, THREE.RedIntegerFormat, THREE.UnsignedIntType);
    this.sampling.internalFormat = 'R32UI';
    this.sampling.needsUpdate = true;
    this.quantization = new THREE.DataTexture(quantizationTable(processing), 256, 64, THREE.RedFormat);
    this.quantization.needsUpdate = true;
  }
  *dabSteps(x: number, y: number, brush: Brush): Generator<boolean, void> {
    if (brush.opacity <= 0)
      return;
    if (this.brush && (this.points.length === MAX_DABS || (Object.keys(brush) as (keyof Brush)[]).some(key => brush[key] !== this.brush![key])))
      this.flush();
    this.brush = { ...brush };
    const point = this.textureRect ? textureDab(x, y, brush.size, this.textureRect, this.pixels,
      { width: this.output.width, height: this.output.height, indices: this.sampling.image.data as Uint32Array }) : [x, y];
    this.points.push(new THREE.Vector2(point[0], point[1]));
    this.replay.push({ x, y, brush: this.brush });
    yield true;
  }
  flush() {
    if (!this.points.length)
      return false;
    if (this.painter.renderer.getContext().isContextLost()) {
      this.points = [];
      return false;
    }
    if (!this.initialized) {
      this.painter.initialize(this);
      this.initialized = true;
    }
    this.painter.paint(this, this.points, this.brush!, this.grayscale);
    this.points = [];
    this.changed = true;
    return true;
  }
  present() {
    this.flush();
    if (this.initialized) {
      this.painter.present(this);
      this.revision++;
    }
  }
  async preview(draw: (pixels: Pixels) => void) {
    if (!this.initialized || this.previewPending || this.disposed)
      return;
    this.previewPending = true;
    const { width, height } = this.output, bytes = new Uint8Array(width * height * 4);
    try {
      let revision: number;
      do {
        revision = this.revision;
        const read = this.painter.renderer.readRenderTargetPixelsAsync(this.output, 0, 0, width, height, bytes);
        // Three r180 leaves its PBO bound while awaiting the fence. A pointerup
        // can synchronously commit in that interval; typed-array readPixels is
        // invalid with PIXEL_PACK_BUFFER bound. The queued transfer keeps its
        // buffer, and Three rebinds it when the fence resolves.
        const gl = this.painter.renderer.getContext() as WebGL2RenderingContext;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        await read;
        if (this.disposed)
          return;
        const data = new Uint8ClampedArray(bytes.length), row = width * 4;
        for (let y = 0; y < height; y++)
          data.set(bytes.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
        draw({ width, height, data });
      } while (revision !== this.revision);
    }
    finally {
      this.previewPending = false;
    }
  }
  commit() {
    this.flush();
    if (!this.initialized)
      return;
    const { width, height, data } = this.pixels;
    this.painter.renderer.readRenderTargetPixels(this.current, 0, 0, width, height, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.changed = data.some((value, i) => value !== this.base[i]);
  }
  recover(stroke: StrokeSink) {
    for (const { x, y, brush } of this.replay)
      for (const _ of stroke.dabSteps(x, y, brush, this.grayscale)) { /* Complete the recorded stroke after context loss. */ }
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.painter.release(this);
    this.points = [];
    this.replay = [];
    this.current.dispose();
    this.next.dispose();
    this.coverage.dispose();
    this.output.dispose();
    this.sampling.dispose();
    this.quantization.dispose();
    this.baseTexture.dispose();
  }
}
