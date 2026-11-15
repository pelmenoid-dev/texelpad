import * as THREE from 'three';
import type { Studio } from './studio';
import { MAPS } from './maps.ts';
import type { Change, MapKind, Pixels, Processing } from './maps.ts';
import type { Brush } from './projection.ts';
import { createGrayPalettes, extractDiffusePalette, isPaletteColor } from './palettes';
import type { GrayPalettes } from './palettes';
import { disposeModelResources } from './model-resources';
export type ProjectUI = {
  editorTab?: 'paint' | 'render';
  texturePreviewOpen?: boolean;
  processed: boolean;
  exportProcessed: boolean;
  mobilePanel: 'tools' | 'maps';
  exportOpen: boolean;
  helpOpen: boolean;
  sections?: Partial<Record<'paint' | 'color' | 'maps' | 'processing' | 'lighting', boolean>>;
};
export const defaultProjectUI: ProjectUI = {
  processed: true,
  exportProcessed: false,
  mobilePanel: 'tools',
  exportOpen: false,
  helpOpen: false
};
type StoredPixels = {
  width: number;
  height: number;
  data: string;
};
type StoredChange = {
  kind: MapKind;
  label: string;
  before: StoredPixels;
  after: StoredPixels;
};
export type ProjectData = {
  format: 'pixel-workshop-project';
  version: 1;
  savedAt: string;
  modelName: string;
  model: (ReturnType<THREE.Object3D['toJSON']> & {
    geometries?: unknown[];
    images?: unknown[];
    textures?: unknown[];
  }) | null;
  maps: Record<MapKind, StoredPixels>;
  history: {
    past: StoredChange[];
    future: StoredChange[];
  };
  palette?: string[];
  grayPalettes?: GrayPalettes;
  editor: {
    processing: Processing;
    active: MapKind;
    brush: Brush;
    lightAngle: number;
    glowStrength: number;
    specStrength: number;
    view: 'material' | 'map';
    gridVisible?: boolean;
    wireframeVisible?: boolean;
    uvVisible?: boolean;
    renderMode?: 'lit' | 'unlit';
  };
  camera: {
    position: number[];
    quaternion: number[];
    up: number[];
    fov: number;
    near: number;
    far: number;
    zoom: number;
    target: number[];
    position0: number[];
    target0: number[];
    zoom0: number;
  };
  ui: ProjectUI;
  dirty: boolean;
};
function encodePixels(p: Pixels): StoredPixels {
  let binary = '';
  for (let i = 0; i < p.data.length; i += 32768) binary += String.fromCharCode(...p.data.subarray(i, i + 32768));
  return {
    width: p.width,
    height: p.height,
    data: btoa(binary)
  };
}
function decodePixels(p: StoredPixels): Pixels {
  const binary = atob(p.data),
    data = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return {
    width: p.width,
    height: p.height,
    data
  };
}
export function captureProject(s: Studio, ui: ProjectUI = defaultProjectUI): ProjectData {
  s.endStroke();
  // Serialize normalized geometry and transforms, without GPU textures or lighting.
  // Map bytes are stored separately so even RGB under transparent alpha is exact.
  const clone = s.model.clone(true),
    placeholder = new THREE.MeshBasicMaterial();
  clone.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.material = placeholder;
      o.geometry = new THREE.BufferGeometry().copy(o.geometry);
    }
  });
  const model = s.meshes.length ? clone.toJSON() : null;
  placeholder.dispose();
  clone.traverse(o => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  const change = (c: Change): StoredChange => ({
    kind: c.kind,
    label: c.label,
    before: encodePixels(c.before),
    after: encodePixels(c.after)
  });
  return {
    format: 'pixel-workshop-project',
    version: 1,
    savedAt: new Date().toISOString(),
    modelName: s.modelName,
    model,
    palette: [...(s.palette ?? [])],
    grayPalettes: {
      spec: [...(s.grayPalettes?.spec ?? createGrayPalettes().spec)],
      glow: [...(s.grayPalettes?.glow ?? createGrayPalettes().glow)]
    },
    maps: Object.fromEntries(MAPS.map(k => [k, encodePixels(s.maps[k])])) as Record<MapKind, StoredPixels>,
    history: {
      past: s.history.past.map(change),
      future: s.history.future.map(change)
    },
    editor: {
      processing: {
        ...s.processing
      },
      active: s.active,
      brush: {
        ...s.brush
      },
      lightAngle: s.lightAngle,
      glowStrength: s.glowStrength,
      specStrength: s.specStrength,
      view: s.view,
      gridVisible: true,
      wireframeVisible: s.wireframe?.visible ?? false,
      uvVisible: s.uvVisible,
      renderMode: s.renderMode ?? 'lit'
    },
    camera: {
      position: s.camera.position.toArray(),
      quaternion: s.camera.quaternion.toArray(),
      up: s.camera.up.toArray(),
      fov: s.camera.fov,
      near: s.camera.near,
      far: s.camera.far,
      zoom: s.camera.zoom,
      target: s.controls.target.toArray(),
      position0: s.controls.position0.toArray(),
      target0: s.controls.target0.toArray(),
      zoom0: s.controls.zoom0
    },
    ui: {
      ...ui
    },
    dirty: s.dirty
  };
}
function requireValid(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(`Invalid project: ${message}`);
}
function finite(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function validateProject(value: unknown): asserts value is ProjectData {
  requireValid(value && typeof value === 'object', 'the file has no project data.');
  const p = value as ProjectData;
  requireValid(p.format === 'pixel-workshop-project', 'choose a .pxwork project, not a texture ZIP.');
  requireValid(p.version === 1, 'this project version is not supported.');
  requireValid(typeof p.modelName === 'string' && p.modelName.length <= 1024, 'model name.');
  if (p.palette !== undefined) requireValid(Array.isArray(p.palette) && p.palette.length <= 256 && p.palette.every(c => typeof c === 'string' && /^#[a-f0-9]{6}$/i.test(c)) && new Set(p.palette.map(c => c.toLowerCase())).size === p.palette.length, 'project palette.');
  if (p.grayPalettes !== undefined) {
    requireValid(p.grayPalettes && typeof p.grayPalettes === 'object' && !Array.isArray(p.grayPalettes), 'grayscale palettes.');
    for (const kind of ['spec', 'glow'] as const) {
      const colors = p.grayPalettes[kind];
      requireValid(Array.isArray(colors) && colors.length <= 256 && colors.every(c => isPaletteColor(c, true)) && new Set(colors.map(c => c.toLowerCase())).size === colors.length, `${kind} palette.`);
    }
  }
  requireValid(p.model === null || p.model?.object && Array.isArray(p.model.geometries), 'model geometry is missing.');
  requireValid(!p.model?.images?.length && !p.model?.textures?.length, 'external textures are not supported in project geometry.');
  let total = 0;
  const pixels = (m: StoredPixels) => {
    requireValid(m && Number.isInteger(m.width) && Number.isInteger(m.height) && finite(m.width, 1, 4096) && finite(m.height, 1, 4096), 'texture dimensions.');
    const bytes = m.width * m.height * 4;
    total += bytes;
    requireValid(total <= 512 * 1024 * 1024, 'textures and history exceed 512 MB.');
    requireValid(typeof m.data === 'string' && m.data.length === 4 * Math.ceil(bytes / 3) && /^[A-Za-z0-9+/]*={0,2}$/.test(m.data), 'texture pixels are incomplete.');
    requireValid(atob(m.data).length === bytes, 'texture byte count.');
  };
  for (const k of MAPS) pixels(p.maps?.[k]);
  for (const side of ['past', 'future'] as const) {
    requireValid(Array.isArray(p.history?.[side]) && p.history[side].length <= 60, 'undo history.');
    for (const c of p.history[side]) {
      requireValid(MAPS.includes(c.kind) && typeof c.label === 'string', 'undo entry.');
      pixels(c.before);
      pixels(c.after);
    }
  }
  const e = p.editor;
  requireValid(e && MAPS.includes(e.active) && ['material', 'map'].includes(e.view), 'active map or view.');
  requireValid(e.processing && typeof e.processing.enabled === 'boolean' && finite(e.processing.texels, 1, 64) && finite(e.processing.dither, 0, 1) && Number.isInteger(e.processing.levels) && finite(e.processing.levels, 2, 256), 'pixelation settings.');
  requireValid(finite(e.lightAngle, 0, 360) && finite(e.specStrength, 0, 2) && finite(e.glowStrength, 0, 8), 'lighting settings.');
  requireValid(e.renderMode === undefined || e.renderMode === 'lit' || e.renderMode === 'unlit', 'render mode.');
  requireValid(e.gridVisible === undefined || typeof e.gridVisible === 'boolean', 'studio grid visibility.');
  requireValid(e.wireframeVisible === undefined || typeof e.wireframeVisible === 'boolean', 'model wireframe visibility.');
  requireValid(e.uvVisible === undefined || typeof e.uvVisible === 'boolean', 'UV layout visibility.');
  const b = e.brush;
  requireValid(b && ['pencil', 'brush', 'eraser', 'pick', 'hand'].includes(b.tool) && finite(b.size, 1, 128) && finite(b.opacity, 0, 1) && finite(b.hardness, 0, 1) && finite(b.value, 0, 1) && /^#[a-f0-9]{6}$/i.test(b.color), 'brush settings.');
  const c = p.camera;
  requireValid(c, 'camera is missing.');
  for (const [key, n] of [['position', 3], ['quaternion', 4], ['up', 3], ['target', 3], ['position0', 3], ['target0', 3]] as const) requireValid(Array.isArray(c[key]) && c[key].length === n && c[key].every(v => finite(v, -1e6, 1e6)), 'camera coordinates.');
  requireValid(finite(c.fov, 1, 179) && finite(c.near, .000001, 1e5) && finite(c.far, c.near + 1e-6, 1e7) && finite(c.zoom, .000001, 1e5) && finite(c.zoom0, .000001, 1e5), 'camera lens.');
  requireValid(p.ui && ['processed', 'exportProcessed', 'exportOpen', 'helpOpen'].every(k => typeof p.ui[k as keyof ProjectUI] === 'boolean') && ['tools', 'maps'].includes(p.ui.mobilePanel), 'editor panels.');
  requireValid(p.ui.editorTab === undefined || p.ui.editorTab === 'paint' || p.ui.editorTab === 'render', 'editor tab.');
  requireValid(p.ui.texturePreviewOpen === undefined || typeof p.ui.texturePreviewOpen === 'boolean', 'texture preview visibility.');
  if (p.ui.sections !== undefined) requireValid(p.ui.sections !== null && typeof p.ui.sections === 'object' && !Array.isArray(p.ui.sections) && Object.entries(p.ui.sections).every(([key, value]) => ['paint', 'color', 'maps', 'processing', 'lighting'].includes(key) && typeof value === 'boolean'), 'section visibility.');
}
export async function encodeProject(project: ProjectData): Promise<Blob> {
  validateProject(project);
  const blob = await new Response(new Blob([JSON.stringify(project)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if (blob.size > 256 * 1024 * 1024) throw Error('The project exceeds the 256 MB file limit. The current work is still open and unsaved.');
  return blob;
}
export async function decodeProject(file: Blob): Promise<ProjectData> {
  if (file.size > 256 * 1024 * 1024) throw Error('The project file exceeds 256 MB.');
  let value: unknown;
  try {
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader(),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > 768 * 1024 * 1024) {
        await reader.cancel();
        throw Error('Unpacked project exceeds 768 MB.');
      }
      chunks.push(new Uint8Array(result.value));
    }
    value = JSON.parse(await new Blob(chunks).text());
  } catch {
    throw Error('Could not read this project. Choose a complete .pxwork file. The current project has not been replaced.');
  }
  validateProject(value);
  return value;
}
export function restoreProject(s: Studio, p: ProjectData): ProjectUI {
  validateProject(p);
  // Prepare everything before replacing the active document. Invalid files leave it intact.
  const maps = Object.fromEntries(MAPS.map(k => [k, decodePixels(p.maps[k])])) as Record<MapKind, Pixels>;
  const palette = p.palette === undefined ? extractDiffusePalette(maps.diffuse) : p.palette.map(c => c.toLowerCase());
  const change = (c: StoredChange): Change => ({
    ...c,
    before: decodePixels(c.before),
    after: decodePixels(c.after)
  });
  const past = p.history.past.map(change),
    future = p.history.future.map(change);
  const model = p.model === null ? null : new THREE.ObjectLoader().parse(p.model);
  try {
    if (model) s.setModel(model, false);else s.clearModel();
  } catch (error) {
    if (model) disposeModelResources(model, s.material);
    throw error;
  }
  s.modelName = p.modelName;
  s.maps = maps;
  s.history.past = past;
  s.history.future = future;
  s.palette = palette;
  const grayPalettes = p.grayPalettes ?? createGrayPalettes();
  s.grayPalettes = {
    spec: grayPalettes.spec.map(c => c.toLowerCase()),
    glow: grayPalettes.glow.map(c => c.toLowerCase())
  };
  Object.assign(s.processing, p.editor.processing);
  Object.assign(s.brush, p.editor.brush);
  s.active = p.editor.active;
  s.view = p.editor.view;
  s.lightAngle = p.editor.lightAngle;
  s.glowStrength = p.editor.glowStrength;
  s.specStrength = p.editor.specStrength;
  s.renderMode = p.editor.renderMode ?? 'lit';
  s.grid.visible = true;
  s.setWireframeVisible(p.editor.wireframeVisible ?? false);
  s.uvVisible = p.editor.uvVisible ?? false;
  s.setTool(p.editor.brush.tool);
  const c = p.camera;
  s.camera.position.fromArray(c.position);
  s.camera.quaternion.fromArray(c.quaternion);
  s.camera.up.fromArray(c.up);
  s.camera.fov = c.fov;
  s.camera.near = c.near;
  s.camera.far = c.far;
  s.camera.zoom = c.zoom;
  s.camera.updateProjectionMatrix();
  s.controls.target.fromArray(c.target);
  // Clear orbit damping from the preceding document before restoring its exact view.
  const damping = s.controls.enableDamping;
  s.controls.enableDamping = false;
  s.controls.update();
  s.controls.enableDamping = damping;
  s.controls.target.fromArray(c.target);
  s.camera.position.fromArray(c.position);
  s.camera.quaternion.fromArray(c.quaternion);
  s.camera.updateMatrixWorld(true);
  s.controls.position0.fromArray(c.position0);
  s.controls.target0.fromArray(c.target0);
  s.controls.zoom0 = c.zoom0;
  s.refresh();
  s.dirty = false;
  s.changed();
  return {
    ...p.ui
  };
}
export function projectFilename(modelName: string) {
  return `${modelName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Untitled'}.pxwork`;
}
type SaveHandle = {
  createWritable: () => Promise<{
    write: (blob: Blob) => Promise<void>;
    close: () => Promise<void>;
    abort?: (reason?: unknown) => Promise<void>;
  }>;
};
export async function saveProject(s: Studio, ui: ProjectUI): Promise<boolean> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<SaveHandle>;
  }).showSaveFilePicker;
  let handle: SaveHandle | undefined;
  if (picker) {
    try {
      handle = await picker.call(window, {
        suggestedName: projectFilename(s.modelName),
        types: [{
          description: 'Texelpad project',
          accept: {
            'application/octet-stream': ['.pxwork']
          }
        }]
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') return false;
      throw error;
    }
  }
  const blob = await encodeProject(captureProject(s, ui));
  if (handle) {
    const writer = await handle.createWritable();
    try {
      await writer.write(blob);
      await writer.close();
    } catch (error) {
      // Release the writable stream while preserving the original save failure.
      try { await writer.abort?.(error); } catch { /* The stream may already be closed. */ }
      throw error;
    }
  } else {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = projectFilename(s.modelName);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  s.dirty = false;
  s.changed();
  return true;
}
// One-time migration of an already-open legacy session; separate from normal project files.
export async function readSessionHandoff(): Promise<ProjectData | undefined> {
  const id = sessionStorage.getItem('pixel-workshop-handoff');
  if (!id) return;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('pixel-workshop-handoff', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        request = db.transaction('snapshots').objectStore('snapshots').get(id);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    };
  });
}
export function finishSessionHandoff() {
  sessionStorage.removeItem('pixel-workshop-handoff');
}
