import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { canvasOf, processMap, gridSize, defaults, MAPS, History, copyPixels, blankMap, readMap } from './maps';
import type { MapKind, Pixels, Processing } from './maps';
import { ProjectedStroke } from './projection';
import type { Brush, StrokeProjection } from './projection';
import { StrokeQueue } from './stroke-queue';
import { TextureStroke, textureRect } from './texture-stroke';
import type { TextureRect } from './texture-stroke';
import { GpuPainter, GpuStroke } from './gpu-paint';
import { installSurfaceLook } from './surface-look';
import { buildUvPadding, paddedIndex, padUvGutters } from './uv-padding';
import type { UvPadding } from './uv-padding';
import { createDiffusePalette, createGrayPalettes, grayHex, isPaletteColor } from './palettes';
import { disposeModelResources } from './model-resources';
const defaultBrush: Brush = {
  tool: 'pencil',
  size: 24,
  opacity: 1,
  color: '#e9aa72',
  value: .75,
  hardness: .65
};
const blankMaps = () => ({
  diffuse: blankMap('diffuse'),
  spec: blankMap('spec'),
  glow: blankMap('glow')
});
export class Studio {
  scene = new THREE.Scene();
  grid = new THREE.GridHelper(12, 24, 0xb4afbe, 0xd3d0d9);
  camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: 0xffffff,
    shininess: 65,
    transparent: true,
    alphaTest: .015,
    side: THREE.DoubleSide,
    emissive: 0xffffff,
    emissiveIntensity: 1.5
  });
  wireframe = new THREE.Group();
  private wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    wireframe: true,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  private wireMeshes: {
    source: THREE.Mesh;
    overlay: THREE.Mesh;
  }[] = [];
  private surfaceLook = installSurfaceLook(this.material);
  private paddingCache = new Map<string, UvPadding>();
  model: THREE.Object3D = new THREE.Group();
  meshes: THREE.Mesh[] = [];
  maps = blankMaps();
  processed = {} as Record<MapKind, Pixels>;
  canvases = {} as Record<MapKind, HTMLCanvasElement>;
  textures = {} as Record<MapKind, THREE.CanvasTexture>;
  processing: Processing = {
    ...defaults
  };
  active: MapKind = 'diffuse';
  uvVisible = false;
  history = new History();
  modelName = 'Untitled';
  triangles = 0;
  brush: Brush = {
    ...defaultBrush
  };
  lightAngle = 35;
  glowStrength = 1.5;
  specStrength = .7;
  private documentDirty = false;
  get dirty() { return this.documentDirty || this.stroke instanceof GpuStroke && this.stroke.changed; }
  set dirty(value: boolean) { this.documentDirty = value; }
  view: 'material' | 'map' = 'material';
  unpaintableMeshes = 0;
  renderMode: 'lit' | 'unlit' = 'lit';
  palette = createDiffusePalette();
  grayPalettes = createGrayPalettes();
  private colorPick?: {
    tool: Brush['tool'];
    accept: (color: string) => void;
    cancel: () => void;
  };
  private frame = 0;
  private lastFrameTime = 0;
  private frameInterval = 1000 / 60;
  private paintPending?: MapKind;
  private textureListeners = new Set<(kind: MapKind, pixels: Pixels) => void>();
  private observer: ResizeObserver;
  private stroke?: ProjectedStroke | GpuStroke | TextureStroke;
  private gpuPainter: GpuPainter;
  private strokeProjection?: StrokeProjection;
  private strokeQueue?: StrokeQueue;
  private strokeKind?: MapKind;
  private pointerId?: number;
  private pointerElement?: HTMLCanvasElement;
  private rotation = new THREE.Group();
  private envTarget: THREE.WebGLCubeRenderTarget;
  private disposed = false;
  private cleanups: (() => void)[] = [];
  private light = new THREE.DirectionalLight(0xffedcd, 3.4);
  private fill = new THREE.DirectionalLight(0xb4cae9, 1.7);
  constructor(public host: HTMLDivElement, public changed: () => void, public warn: (text: string) => void, public cursor: (x: number, y: number, visible: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.gpuPainter = new GpuPainter(this.renderer);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The model shader uses Unity SurfacePixels' roll-off before dithering.
    // A second ACES curve in OutputPass would change those quantized colors.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D model: paint with the left mouse button, orbit with the right');
    this.scene.background = new THREE.Color('#eeedf1');
    this.scene.add(new THREE.HemisphereLight(0xd8d4ee, 0x52596c, 1.3));
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.left = -5;
    this.light.shadow.camera.right = 5;
    this.light.shadow.camera.top = 5;
    this.light.shadow.camera.bottom = -5;
    this.light.shadow.normalBias = .03;
    this.rotation.add(this.light, this.fill);
    this.light.position.set(4, 6, 4);
    this.fill.position.set(-4, 3, -3);
    this.scene.add(this.rotation);
    this.grid.position.y = -.015;
    this.scene.add(this.grid);
    this.wireframe.name = "Model wireframe";
    this.wireframe.visible = false;
    this.scene.add(this.wireframe);
    this.envTarget = new THREE.WebGLCubeRenderTarget(128, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter
    });
    this.updateEnvironment();
    this.material.envMap = this.envTarget.texture;
    this.material.combine = THREE.AddOperation;
    this.material.reflectivity = .2;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .15;
    this.controls.mouseButtons = {
      LEFT: undefined as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    this.controls.minDistance = .7;
    this.controls.maxDistance = 20;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .25, .25, 1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.refresh();
    this.frameModel();
    this.controls.saveState();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.bindEvents();
    const contextLost = () => this.endStroke();
    const contextRestored = () => {
      this.gpuPainter.reset();
      // Render targets lose their contents with the context. Source textures
      // can be uploaded again, but the reflection cubemap must be rendered.
      this.updateEnvironment();
      this.refresh();
    };
    this.renderer.domElement.addEventListener('webglcontextlost', contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    this.cleanups.push(() => {
      this.renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
    });
    this.controls.addEventListener('start', () => {
      this.dirty = true;
      this.changed();
    });
    this.render();
  }
  private updateEnvironment() {
    const environment = new THREE.Scene();
    // Broad, feathered light lobes approximate a rough reflection. A solid
    // rectangle becomes a sharp stripe on curved surfaces. Keep the background
    // black so unlit directions add no reflection or diffuse tint.
    environment.background = new THREE.Color(0x000000);
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
      const intensity = Math.round(255 * Math.max(0, 1 - u * u - v * v) ** 2);
      data.set([intensity, intensity, intensity, 255], (y * size + x) * 4);
    }
    const profile = new THREE.DataTexture(data, size, size);
    profile.minFilter = profile.magFilter = THREE.LinearFilter;
    profile.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(10, 8);
    const material = new THREE.MeshBasicMaterial({ map: profile, side: THREE.DoubleSide,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
    for (const pos of [[-3, -1, 4], [4, 1, -3], [0, 5, 0]]) {
      const panel = new THREE.Mesh(geometry, material);
      panel.position.set(...(pos as [number, number, number]));
      panel.lookAt(0, 0, 0);
      environment.add(panel);
    }
    try {
      new THREE.CubeCamera(.1, 30, this.envTarget).update(this.renderer, environment);
    } finally {
      geometry.dispose();
      material.dispose();
      profile.dispose();
    }
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x === w && size.y === h && this.camera.aspect === w / h) return;
    if (this.stroke) this.endStroke();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
  render = (time = performance.now()) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.render);
    const interval = time - this.lastFrameTime;
    // Learn display cadence while idle, so a busy paint frame cannot increase
    // its own budget. Leave time for texture upload, rendering and input.
    if (!this.stroke && interval > 4 && interval < 34) {
      this.frameInterval = Math.min(interval, this.frameInterval + (interval - this.frameInterval) * .01);
    }
    this.lastFrameTime = time;
    if (!this.stroke) this.controls.update();
    this.processPaint(performance.now() + Math.min(10, this.frameInterval * .75));
    this.flushPaint();
    if (this.wireframe.visible) this.syncWireframe();
    this.composer.render();
  };
  frameModel() {
    if (this.stroke) this.endStroke();
    this.camera.position.set(4.1, 2.8, 5.6);
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();
  }
  setWireframeVisible(visible: boolean) {
    this.wireframe.visible = visible;
    this.grid.visible = true;
    this.material.polygonOffset = visible;
    this.material.polygonOffsetFactor = 1;
    this.material.polygonOffsetUnits = 1;
    this.dirty = true;
    this.changed();
  }
  private syncWireframe() {
    for (const {
      source,
      overlay
    } of this.wireMeshes) {
      source.updateWorldMatrix(true, false);
      overlay.matrix.copy(source.matrixWorld);
      overlay.matrixWorldNeedsUpdate = true;
      overlay.visible = true;
      for (let parent: THREE.Object3D | null = source; parent; parent = parent.parent) {
        if (!parent.visible) {
          overlay.visible = false;
          break;
        }
      }
    }
  }
  private rebuildWireframe() {
    // Separate scene overlays share source geometry; painting and project serialization use only the original meshes.
    this.wireMeshes = this.meshes.map(source => {
      const overlay = source.clone(false);
      overlay.name = `Wireframe: ${source.name}`;
      overlay.material = this.wireMaterial;
      overlay.matrixAutoUpdate = false;
      overlay.castShadow = false;
      overlay.receiveShadow = false;
      overlay.renderOrder = 1;
      overlay.morphTargetInfluences = source.morphTargetInfluences;
      this.wireframe.add(overlay);
      return {
        source,
        overlay
      };
    });
    this.syncWireframe();
  }
  setTool(tool: Brush['tool']) {
    if (this.colorPick && tool !== 'pick') {
      const pending = this.colorPick;
      this.colorPick = undefined;
      pending.cancel();
    }
    this.endStroke();
    this.brush.tool = tool;
    this.dirty = true;
    this.controls.mouseButtons.LEFT = tool === 'hand' ? THREE.MOUSE.ROTATE : undefined as unknown as THREE.MOUSE;
    this.changed();
  }
  paletteFor(kind: MapKind) {
    return kind === 'diffuse' ? this.palette : this.grayPalettes[kind];
  }
  brushColorFor(kind: MapKind) {
    return kind === 'diffuse' ? this.brush.color.toLowerCase() : grayHex(this.brush.value);
  }
  setBrushColor(color: string, kind: MapKind = 'diffuse') {
    if (!isPaletteColor(color, kind !== 'diffuse')) return;
    if (kind === 'diffuse') this.brush.color = color.toLowerCase();else this.brush.value = parseInt(color.slice(1, 3), 16) / 255;
    this.dirty = true;
    this.changed();
  }
  pickColorOnce(accept: (color: string) => void, cancel: () => void) {
    this.cancelColorPick(false);
    this.colorPick = {
      tool: this.brush.tool === 'pick' ? 'pencil' : this.brush.tool,
      accept,
      cancel
    };
    this.setTool('pick');
  }
  cancelColorPick(notify = true) {
    const pending = this.colorPick;
    if (!pending) return;
    this.colorPick = undefined;
    this.setTool(pending.tool);
    if (notify) pending.cancel();
  }
  private replacePalette(kind: MapKind, colors: string[]) {
    if (kind === 'diffuse') this.palette = colors;else this.grayPalettes = {
      ...this.grayPalettes,
      [kind]: colors
    };
  }
  addPaletteColor(value = this.brush.color, kind: MapKind = 'diffuse') {
    const color = value.toLowerCase(),
      colors = this.paletteFor(kind);
    if (!isPaletteColor(color, kind !== 'diffuse') || colors.includes(color) || colors.length >= 256) return false;
    this.replacePalette(kind, [...colors, color]);
    this.setBrushColor(color, kind);
    return true;
  }
  editPaletteColor(index: number, value: string, kind: MapKind = 'diffuse') {
    const color = value.toLowerCase(),
      colors = this.paletteFor(kind);
    if (!Number.isInteger(index) || index < 0 || index >= colors.length || !isPaletteColor(color, kind !== 'diffuse') || colors.some((c, i) => i !== index && c === color)) return false;
    this.replacePalette(kind, colors.map((c, i) => i === index ? color : c));
    this.setBrushColor(color, kind);
    return true;
  }
  removePaletteColor(index = this.palette.indexOf(this.brush.color.toLowerCase()), kind: MapKind = 'diffuse') {
    const colors = this.paletteFor(kind);
    if (!Number.isInteger(index) || index < 0 || index >= colors.length) return;
    this.replacePalette(kind, colors.filter((_, i) => i !== index));
    this.dirty = true;
    this.changed();
  }
  setRenderMode(mode: 'lit' | 'unlit') {
    this.endStroke();
    this.renderMode = mode;
    this.updateMaterial();
    this.dirty = true;
    this.changed();
  }
  updateMaterial() {
    this.rotation.rotation.y = THREE.MathUtils.degToRad(this.lightAngle);
    this.material.shininess = 65;
    this.material.specular.setScalar(1);
    this.surfaceLook.setSpecularStrength(this.specStrength);
    this.material.envMapRotation.y = this.rotation.rotation.y;
    this.material.emissiveIntensity = this.glowStrength;
    const lit = this.renderMode === 'lit';
    this.surfaceLook.setUnlit(!lit);
    this.bloom.enabled = lit;
    for (const mesh of this.meshes) {
      mesh.castShadow = lit;
      mesh.receiveShadow = lit;
    }
  }
  private uvPadding(kind: MapKind) {
    const p = this.maps[kind],
      key = `${p.width}:${p.height}`;
    let padding = this.paddingCache.get(key);
    if (!padding) {
      padding = buildUvPadding(this.meshes, p.width, p.height);
      if (this.paddingCache.size >= 3) this.paddingCache.delete(this.paddingCache.keys().next().value!);
      this.paddingCache.set(key, padding);
    }
    return padding;
  }
  sourceForExport(kind: MapKind) {
    const [w, h] = gridSize(this.maps.diffuse.width, this.maps.diffuse.height, this.processing.enabled ? this.processing.texels : 1);
    return padUvGutters(this.maps[kind], this.uvPadding(kind), w, h);
  }
  refresh(only?: MapKind) {
    for (const kind of only ? [only] : MAPS) {
      const pixels = processMap(this.maps[kind], this.maps.diffuse.width, this.maps.diffuse.height, this.processing, this.processing.enabled ? this.uvPadding(kind) : undefined);
      const canvas = this.canvases[kind];
      // WebGL texture storage is immutable after upload. Check the old canvas
      // size before canvasOf resizes it; needsUpdate alone cannot resize the GPU.
      const resize = !this.textures[kind] || !canvas || canvas.width !== pixels.width || canvas.height !== pixels.height;
      if (resize) this.textures[kind]?.dispose();
      this.processed[kind] = pixels;
      this.canvases[kind] = canvasOf(pixels, canvas);
      if (resize) {
        const texture = new THREE.CanvasTexture(this.canvases[kind]);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        this.textures[kind] = texture;
      }
      this.textures[kind].needsUpdate = true;
      for (const listener of this.textureListeners) listener(kind, pixels);
    }
    const map = this.textures[this.view === 'material' ? 'diffuse' : this.active];
    const rebind = this.material.map !== map || this.material.specularMap !== this.textures.spec || this.material.emissiveMap !== this.textures.glow;
    this.material.map = map;
    this.material.specularMap = this.textures.spec;
    this.material.emissiveMap = this.textures.glow;
    if (rebind) this.material.needsUpdate = true;
    this.updateMaterial();
  }
  subscribeTexture(kind: MapKind, draw: (pixels: Pixels) => void) {
    const listener = (updated: MapKind, pixels: Pixels) => {
      if (updated === kind) draw(pixels);
    };
    this.textureListeners.add(listener);
    return () => { this.textureListeners.delete(listener); };
  }
  private paintSampling() {
    const source = this.maps[this.active], processed = this.processed[this.active];
    const { width, height } = processed, sampling = new Uint32Array(width * height);
    const padding = this.processing.enabled ? this.uvPadding(this.active) : undefined;
    const rx = Math.ceil(source.width / width), ry = Math.ceil(source.height / height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x + .5) / width * source.width));
      const sy = Math.min(source.height - 1, Math.floor((y + .5) / height * source.height));
      const index = sy * source.width + sx;
      sampling[y * width + x] = padding ? paddedIndex(padding, index, rx, ry) : index;
    }
    return { width, height, indices: sampling };
  }
  private beginGpuStroke(rect?: TextureRect) {
    if (!this.gpuPainter.supported) return;
    const source = this.maps[this.active], { width, height, indices: sampling } = this.paintSampling();
    try {
      if (rect) return this.gpuPainter.beginTexture(source, rect, sampling, width, height, this.active !== 'diffuse', this.processing);
      return this.gpuPainter.begin(source, this.meshes, this.camera, this.host.clientWidth, this.host.clientHeight, sampling, width, height, this.active !== 'diffuse', this.processing);
    } catch {
      this.gpuPainter.disable();
      this.warn('GPU painting could not start. Painting will use the CPU until the graphics context is restored.');
    }
  }
  setProcessing(p: Partial<Processing>) {
    this.endStroke();
    Object.assign(this.processing, p);
    this.dirty = true;
    this.refresh();
    this.changed();
  }
  setUvVisible(visible: boolean) {
    this.uvVisible = visible;
    this.dirty = true;
    this.changed();
  }
  selectMap(kind: MapKind) {
    this.cancelColorPick(false);
    this.endStroke();
    this.active = kind;
    this.dirty = true;
    if (this.view === 'map') {
      this.material.map = this.textures[kind];
      this.material.needsUpdate = true;
    }
    this.changed();
  }
  clearModel() {
    this.cancelColorPick(false);
    this.endStroke();
    this.disposeModel();
    this.paddingCache.clear();
    this.model = new THREE.Group();
    this.meshes = [];
    this.triangles = 0;
    this.unpaintableMeshes = 0;
    this.cursor(0, 0, false);
  }
  newProject() {
    this.clearModel();
    this.modelName = 'Untitled';
    this.maps = blankMaps();
    this.history.clear();
    this.palette = createDiffusePalette();
    this.grayPalettes = createGrayPalettes();
    this.processing = {
      ...defaults
    };
    this.brush = {
      ...defaultBrush
    };
    this.active = 'diffuse';
    this.uvVisible = false;
    this.view = 'material';
    this.renderMode = 'lit';
    this.lightAngle = 35;
    this.specStrength = .7;
    this.glowStrength = 1.5;
    this.setWireframeVisible(false);
    this.setTool('pencil');
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 38;
    this.camera.near = .01;
    this.camera.far = 100;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.frameModel();
    this.controls.saveState();
    this.controls.enableDamping = damping;
    this.refresh();
    this.dirty = false;
    this.changed();
  }
  setModel(object: THREE.Object3D, normalize = true) {
    const meshes: THREE.Mesh[] = [];
    let triangles = 0,
      paintableMeshes = 0;
    object.traverse(o => {
      if (o instanceof THREE.Mesh) {
        let uv = o.geometry.getAttribute('uv');
        const pos = o.geometry.getAttribute('position');
        if (!pos || pos.itemSize !== 3 || pos.count < 3) throw new Error('A mesh has invalid vertex positions.');
        for (let i = 0; i < pos.count; i++) if (![pos.getX(i), pos.getY(i), pos.getZ(i)].every(Number.isFinite)) throw new Error('A mesh has invalid vertex positions.');
        const index = o.geometry.index,
          count = index?.count ?? pos.count;
        if (index && (index.itemSize !== 1 || !(index.array instanceof Uint8Array || index.array instanceof Uint16Array || index.array instanceof Uint32Array))) throw new Error('A mesh has invalid triangle indices.');
        if (count < 3 || count % 3 !== 0) throw new Error('A mesh has incomplete triangles.');
        if (index) for (let i = 0; i < index.count; i++) {
          const vertex = index.getX(i);
          if (!Number.isInteger(vertex) || vertex < 0 || vertex >= pos.count) throw new Error('A mesh has invalid triangle indices.');
        }
        if (!uv || uv.count !== pos.count) {
          uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
          o.geometry.setAttribute('uv', uv);
        }
        if (uv.itemSize !== 2) throw new Error('The model contains invalid UV coordinates.');
        let minU = Infinity,
          minV = Infinity,
          maxU = -Infinity,
          maxV = -Infinity;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i),
            v = uv.getY(i);
          if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('The model contains invalid UV coordinates.');
          minU = Math.min(minU, u);
          minV = Math.min(minV, v);
          maxU = Math.max(maxU, u);
          maxV = Math.max(maxV, v);
        }
        if (minU < -.001 || minV < -.001 || maxU > 1.001 || maxV > 1.001) throw new Error('This version uses one 0–1 UV tile. Pack your UVs into this tile.');
        let usable = false;
        for (let t = 0; t < count; t += 3) {
          const a = index ? index.getX(t) : t,
            b = index ? index.getX(t + 1) : t + 1,
            c = index ? index.getX(t + 2) : t + 2;
          const area = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
          if (Math.abs(area) > 1e-10) {
            usable = true;
            break;
          }
        }
        if (usable) paintableMeshes++;
        meshes.push(o);
        triangles += (o.geometry.index?.count ?? pos.count) / 3;
      }
    });
    if (!meshes.length) throw new Error('No model geometry was found in this file.');
    if (!paintableMeshes) throw new Error('The model has no usable UVs. Unwrap it in a 3D editor first.');
    if (triangles > 200000) throw new Error('Use a model with no more than 200,000 triangles.');
    const box = new THREE.Box3().setFromObject(object),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3()),
      scale = 3 / Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('The model has no measurable size.');
    this.cancelColorPick(false);
    this.endStroke();
    this.disposeModel();
    this.paddingCache.clear();
    this.model = normalize ? new THREE.Group() : object;
    if (normalize) {
      this.model.add(object);
      this.model.scale.setScalar(scale);
      this.model.position.copy(center).multiplyScalar(-scale);
      this.model.position.y = -box.min.y * scale;
    }
    for (const m of meshes) {
      const old = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of old) if (mat !== this.material) {
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
        mat.dispose();
      }
      m.material = this.material;
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.meshes = meshes;
    this.triangles = triangles;
    this.unpaintableMeshes = meshes.length - paintableMeshes;
    this.scene.add(this.model);
    this.model.updateMatrixWorld(true);
    this.rebuildWireframe();
  }
  async loadModel(file: File) {
    const replacingModel = this.meshes.length > 0;
    if (file.size > 100 * 1024 * 1024) throw new Error('The model must be smaller than 100 MB.');
    const ext = file.name.split('.').pop()?.toLowerCase();
    let object: THREE.Object3D;
    if (ext === 'obj') {
      const {
        OBJLoader
      } = await import('three/addons/loaders/OBJLoader.js');
      object = new OBJLoader().parse(await file.text());
    } else if (ext === 'fbx') {
      const {
        FBXLoader
      } = await import('three/addons/loaders/FBXLoader.js');
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
      object = new FBXLoader(manager).parse(await file.arrayBuffer(), '');
    } else throw new Error('Choose an OBJ or FBX with UVs.');
    try {
      this.setModel(object);
    } catch (e) {
      disposeModelResources(object, this.material);
      throw e;
    }
    this.modelName = file.name;
    if (replacingModel) {
      this.palette = createDiffusePalette();
      this.grayPalettes = createGrayPalettes();
      this.maps = blankMaps();
      this.history.clear();
    }
    this.dirty = true;
    this.refresh();
    this.frameModel();
    this.changed();
    if (this.unpaintableMeshes) this.warn(`${this.unpaintableMeshes} meshes have no usable UVs and can only be viewed.`);
  }
  async loadMap(file: File, kind: MapKind) {
    const next = await readMap(file, kind);
    this.endStroke();
    this.history.push({
      kind,
      before: copyPixels(this.maps[kind]),
      after: copyPixels(next),
      label: 'Import map'
    });
    this.maps[kind] = next;
    this.dirty = true;
    this.refresh();
    this.changed();
  }
  undo() {
    this.endStroke();
    const c = this.history.undo();
    if (c) {
      this.maps[c.kind] = copyPixels(c.before);
      this.active = c.kind;
      this.dirty = true;
      this.refresh();
      this.changed();
    }
  }
  redo() {
    this.endStroke();
    const c = this.history.redo();
    if (c) {
      this.maps[c.kind] = copyPixels(c.after);
      this.active = c.kind;
      this.dirty = true;
      this.refresh();
      this.changed();
    }
  }
  sample(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / this.host.clientWidth * 2 - 1, 1 - y / this.host.clientHeight * 2), this.camera);
    const uv = ray.intersectObjects(this.meshes, false)[0]?.uv;
    if (!uv) return;
    this.sampleUv(uv.x, uv.y);
  }
  private sampleUv(u: number, v: number) {
    const p = this.maps[this.active],
      i = (Math.max(0, Math.min(p.height - 1, Math.floor((1 - v) * p.height))) * p.width + Math.max(0, Math.min(p.width - 1, Math.floor(u * p.width)))) * 4;
    if (this.active === 'diffuse') this.brush.color = '#' + [0, 1, 2].map(c => p.data[i + c].toString(16).padStart(2, '0')).join('');else this.brush.value = p.data[i] / 255;
    this.dirty = true;
    const pending = this.colorPick;
    if (pending) {
      this.colorPick = undefined;
      this.setTool(pending.tool);
      pending.accept(this.brushColorFor(this.active));
    }
    this.changed();
  }
  bindTextureCanvas(el: HTMLCanvasElement) {
    const local = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top, box };
    };
    const down = (e: PointerEvent) => {
      if (this.pointerId !== undefined || e.button !== 0 || !e.isPrimary || this.brush.tool === 'hand') return;
      const { x, y, box } = local(e), pixels = this.processed[this.active];
      const rect = textureRect(box.width, box.height, pixels.width, pixels.height);
      if (x < rect.left || y < rect.top || x >= rect.left + rect.width || y >= rect.top + rect.height) return;
      e.preventDefault();
      if (this.brush.tool === 'pick' || e.altKey) {
        this.sampleUv((x - rect.left) / rect.width, 1 - (y - rect.top) / rect.height);
        return;
      }
      try { this.stroke = this.beginGpuStroke(rect) ?? new TextureStroke(this.maps[this.active], rect, this.paintSampling()); }
      catch (error) { this.warn(`Could not start painting: ${String(error)}`); return; }
      this.strokeKind = this.active;
      this.controls.enabled = false;
      this.pointerId = e.pointerId;
      this.pointerElement = el;
      el.setPointerCapture(e.pointerId);
      this.strokeQueue = new StrokeQueue(this.stroke, this.active !== 'diffuse');
      this.strokeQueue.add(x, y, this.brush);
    };
    const move = (e: PointerEvent) => {
      if (this.pointerElement !== el || this.pointerId !== e.pointerId) return;
      const { x, y } = local(e);
      this.strokeQueue?.add(x, y, this.brush);
    };
    const finish = (e: PointerEvent) => {
      if (this.pointerElement === el && this.pointerId === e.pointerId) this.endStroke();
    };
    const preventMenu = (e: Event) => e.preventDefault();
    const events = { pointerdown: down, pointermove: move, pointerup: finish, pointercancel: finish, lostpointercapture: finish };
    for (const [name, handler] of Object.entries(events)) el.addEventListener(name, handler as EventListener);
    el.addEventListener('contextmenu', preventMenu);
    let size = '';
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect(), next = `${box.width}:${box.height}`;
      if (size && next !== size && this.pointerElement === el) this.endStroke();
      size = next;
    });
    observer.observe(el);
    return () => {
      if (this.pointerElement === el) this.endStroke();
      observer.disconnect();
      for (const [name, handler] of Object.entries(events)) el.removeEventListener(name, handler as EventListener);
      el.removeEventListener('contextmenu', preventMenu);
    };
  }
  private bindEvents() {
    const el = this.renderer.domElement;
    const on = (name: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      el.addEventListener(name, fn, opts);
      this.cleanups.push(() => el.removeEventListener(name, fn, opts));
    };
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
    };
    on('pointerdown', ((e: PointerEvent) => {
      if (this.pointerId !== undefined) {
        e.stopImmediatePropagation();
        return;
      }
      if (!this.meshes.length || e.button !== 0 || this.brush.tool === 'hand') return;
      e.stopImmediatePropagation();
      if (!e.isPrimary) return;
      const p = local(e);
      if (this.brush.tool === 'pick' || e.altKey) {
        this.sample(p.x, p.y);
        return;
      }
      // Construct the stroke before taking ownership, so a setup failure
      // cannot leave orbit controls disabled or a pointer captured.
      try {
        this.stroke = this.beginGpuStroke() ?? new ProjectedStroke(this.maps[this.active], this.meshes, this.camera, this.host.clientWidth, this.host.clientHeight, this.strokeProjection);
      } catch (error) {
        this.warn(`Could not start painting: ${String(error)}`);
        return;
      }
      this.strokeKind = this.active;
      this.controls.enabled = false;
      this.pointerId = e.pointerId;
      this.pointerElement = el;
      el.setPointerCapture(e.pointerId);
      if (this.stroke instanceof ProjectedStroke) this.strokeProjection = this.stroke.projection;
      this.strokeQueue = new StrokeQueue(this.stroke, this.active !== 'diffuse');
      this.strokeQueue.add(p.x, p.y, this.brush);
    }) as EventListener, {
      capture: true
    });
    on('pointermove', ((e: PointerEvent) => {
      const p = local(e);
      this.cursor(p.x, p.y, this.meshes.length > 0 && this.brush.tool !== 'hand');
      if (this.pointerElement === el && this.pointerId === e.pointerId) this.strokeQueue?.add(p.x, p.y, this.brush);
    }) as EventListener);
    const finish = ((e: PointerEvent) => {
      if (this.pointerElement === el && e.pointerId === this.pointerId) this.endStroke();
    }) as EventListener;
    on('pointerup', finish);
    on('pointercancel', finish);
    on('lostpointercapture', finish);
    on('pointerleave', (() => this.cursor(0, 0, false)) as EventListener);
    on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }
  get hasPendingPaint() { return this.strokeQueue?.pending ?? false; }
  private recoverGpuStroke(notify: boolean) {
    const gpu = this.stroke;
    if (!(gpu instanceof GpuStroke)) return;
    this.gpuPainter.disable();
    // A failed readback may have partially overwritten the source buffer.
    // Replay from the original bytes, including dabs already flushed to GPU.
    gpu.pixels.data.set(gpu.base);
    const fallback = gpu.textureRect ? new TextureStroke(gpu.pixels, gpu.textureRect,
      { width: gpu.output.width, height: gpu.output.height, indices: gpu.sampling.image.data as Uint32Array })
      : new ProjectedStroke(gpu.pixels, this.meshes, this.camera, this.host.clientWidth, this.host.clientHeight);
    gpu.recover(fallback);
    gpu.dispose();
    this.stroke = fallback;
    if (fallback instanceof ProjectedStroke) this.strokeProjection = fallback.projection;
    this.strokeQueue?.replaceSink(fallback);
    this.paintPending = this.strokeKind;
    if (fallback.changed) this.dirty = true;
    if (notify) this.warn('GPU painting was interrupted. The stroke was recovered using the CPU painter.');
  }
  private processPaint(deadline = Infinity) {
    try {
      if (this.strokeQueue?.advance(deadline)) {
        if (this.stroke instanceof GpuStroke) this.stroke.flush();
        this.paintPending = this.strokeKind;
        if (!(this.stroke instanceof GpuStroke)) this.dirty = true;
      }
    } catch (error) {
      if (!(this.stroke instanceof GpuStroke)) throw error;
      this.recoverGpuStroke(true);
      this.processPaint(deadline);
    }
  }
  private flushPaint() {
    const kind = this.paintPending;
    if (!kind) return;
    this.paintPending = undefined;
    if (this.stroke instanceof GpuStroke) {
      const stroke = this.stroke;
      try { stroke.present(); }
      catch {
        this.recoverGpuStroke(true);
        this.paintPending = undefined;
        this.refresh(kind);
        return;
      }
      const texture = stroke.output.texture;
      if (kind === 'diffuse' && this.view === 'material' || this.view === 'map' && this.active === kind) this.material.map = texture;
      if (kind === 'spec') this.material.specularMap = texture;
      if (kind === 'glow') this.material.emissiveMap = texture;
      void stroke.preview(pixels => {
        if (this.stroke !== stroke || this.disposed) return;
        this.processed[kind] = pixels;
        for (const listener of this.textureListeners) listener(kind, pixels);
      }).catch(error => { if (this.stroke === stroke && !this.disposed && !this.renderer.getContext().isContextLost()) this.warn(String(error)); });
    } else this.refresh(kind);
  }
  endStroke() {
    // Save, export, map/tool changes and pointer cancellation must see the last
    // input, even if the next animation frame has not presented it yet.
    this.processPaint();
    if (this.stroke instanceof GpuStroke) {
      if (this.renderer.getContext().isContextLost()) {
        this.recoverGpuStroke(false);
      } else {
        try { this.stroke.commit(); }
        catch { this.recoverGpuStroke(true); }
      }
      this.paintPending = undefined;
      this.refresh(this.strokeKind);
    } else this.flushPaint();
    if (this.stroke && this.strokeKind && this.stroke.changed) {
      const p = this.maps[this.strokeKind];
      this.history.push({
        kind: this.strokeKind,
        before: {
          width: p.width,
          height: p.height,
          data: this.stroke.base
        },
        after: copyPixels(p),
        label: this.brush.tool
      });
      this.dirty = true;
    }
    const pointer = this.pointerId, el = this.pointerElement;
    if (this.stroke instanceof GpuStroke) this.stroke.dispose();
    this.stroke = undefined;
    this.strokeKind = undefined;
    this.strokeQueue = undefined;
    this.pointerId = undefined;
    this.pointerElement = undefined;
    if (pointer !== undefined && el?.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
    this.controls.enabled = true;
    this.changed();
  }
  private disposeModel() {
    this.strokeProjection = undefined;
    this.gpuPainter.clearSurface();
    this.wireframe.clear();
    this.wireMeshes = [];
    this.scene.remove(this.model);
    disposeModelResources(this.model, this.material);
  }
  dispose() {
    if (this.disposed) return;
    this.colorPick = undefined;
    this.disposed = true;
    this.strokeQueue = undefined;
    if (this.stroke instanceof GpuStroke) this.stroke.dispose();
    this.stroke = undefined;
    this.textureListeners.clear();
    const pointer = this.pointerId, element = this.pointerElement;
    this.pointerId = undefined;
    this.pointerElement = undefined;
    if (pointer !== undefined && element?.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.cleanups.forEach(f => f());
    this.controls.dispose();
    this.disposeModel();
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
      }
    });
    this.material.dispose();
    this.wireMaterial.dispose();
    Object.values(this.textures).forEach(t => t.dispose());
    this.envTarget.dispose();
    this.light.shadow.dispose();
    this.fill.shadow.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.gpuPainter.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
