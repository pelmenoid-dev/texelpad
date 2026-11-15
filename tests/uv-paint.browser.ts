import * as THREE from 'three';
import { Studio } from '../src/studio';
import { GpuPainter, GpuStroke } from '../src/gpu-paint';
import { TextureStroke, textureRect } from '../src/texture-stroke';
import { blankMap, copyPixels, processMap } from '../src/maps';
import type { Pixels } from '../src/maps';
import type { Brush } from '../src/projection';
import { captureProject, restoreProject, validateProject } from '../src/project';
import { paintCorner } from './fixtures/paint-corner';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';
const tests: BrowserResult[] = [];
const s = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});
const painter = new GpuPainter(s.renderer), canvas = document.querySelector<HTMLCanvasElement>('#texture')!;
const unbind = s.bindTextureCanvas(canvas), captures = new Set<number>();
canvas.setPointerCapture = id => { captures.add(id); };
canvas.hasPointerCapture = id => captures.has(id);
canvas.releasePointerCapture = id => { captures.delete(id); };
const brush: Brush = { tool: 'brush', size: 40, opacity: .63, color: '#8f5bd4', value: .7, hardness: .65 };
function expect(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); tests.push({ name, pass: true }); }
  catch (error) { tests.push({ name, pass: false, detail: String(error) }); }
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2);
}
function same(actual: Pixels, expected: Pixels, tolerance = 0) {
  expect(actual.width === expected.width && actual.height === expected.height, 'Dimensions differ');
  const count = actual.data.reduce((sum, v, i) => sum + Number(Math.abs(v - expected.data[i]) > tolerance), 0);
  expect(!count, `${count} channels differ by more than ${tolerance}`);
}
function pointer(type: string, x = 150, y = 150, id = 1, target = canvas, extra: PointerEventInit = {}) {
  const box = target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: box.left + x, clientY: box.top + y, ...extra }));
}
function reset() {
  s.newProject();
  s.maps.diffuse = blankMap('diffuse', 256, 128);
  s.setProcessing({ enabled: false });
  Object.assign(s.brush, brush);
}
async function run() {
  for (const tool of ['pencil', 'brush', 'eraser'] as const) for (const mask of [false, true]) {
    await check(`Direct GPU ${tool}, ${mask ? 'mask' : 'diffuse'} matches CPU on rectangular alpha maps`, () => {
      const actual = blankMap('diffuse', 127, 63);
      for (let i = 0; i < actual.data.length; i++) actual.data[i] = (i * 13 + 137) % 256;
      const expected = copyPixels(actual), rect = textureRect(300, 300, 127, 63), cpu = new TextureStroke(expected, rect);
      const gpu = painter.beginTexture(actual, rect, Uint32Array.from({ length: 127 * 63 }, (_, i) => i), 127, 63, mask, { enabled: false, texels: 1, levels: 256, dither: 0 });
      expect(gpu, 'Direct GPU path unavailable');
      try {
        for (let i = 0; i < 40; i++) {
          const x = 50 + i * 5, y = 140 + Math.sin(i) * 25, b = { ...brush, tool, size: 128 };
          for (const _ of cpu.dabSteps(x, y, b, mask)) { /* Drain. */ }
          for (const _ of gpu.dabSteps(x, y, b)) { /* Drain. */ }
        }
        gpu.commit(); same(actual, expected, 1);
      } finally { gpu.dispose(); }
    });
  }
  await check('Preview paints without a model; shared undo/redo restores original bytes', async () => {
    reset();
    const before = copyPixels(s.maps.diffuse);
    pointer('pointerdown');
    expect(Reflect.get(s, 'stroke') instanceof GpuStroke, 'Preview did not use the GPU');
    pointer('pointermove', 210, 150);
    await new Promise(requestAnimationFrame);
    pointer('pointerup', 210, 150);
    expect(s.history.past.length === 1 && !captures.size && s.controls.enabled, 'Stroke ownership or history leaked');
    const after = copyPixels(s.maps.diffuse);
    expect(after.data.some((v, i) => v !== before.data[i]), 'Preview did not paint');
    s.undo(); same(s.maps.diffuse, before);
    s.redo(); same(s.maps.diffuse, after);
  });
  await check('Letterboxing and unrelated pointers cannot start, extend or finish a texture stroke', () => {
    reset();
    pointer('pointerdown', 150, 20); pointer('pointerup');
    expect(s.history.past.length === 0, 'Letterbox started a stroke');
    pointer('pointerdown');
    pointer('pointermove', 20, 150, 2); pointer('pointerup', 20, 150, 2);
    expect(captures.has(1), 'Unrelated pointer ended the stroke');
    pointer('pointermove', 600, 300, 1, s.renderer.domElement);
    pointer('pointerup', 600, 300, 1, s.renderer.domElement);
    expect(captures.has(1), 'Viewport stole texture pointer ownership');
    pointer('pointercancel');
    expect(!captures.size && s.history.past.length === 1, 'Cancellation did not commit exactly once');
    expect(s.maps.diffuse.data[(64 * 256 + 20) * 4] === 212, 'Unrelated input painted');
  });
  await check('Map changes finish queued texture paint before switching; pick samples original bytes', () => {
    reset();
    s.brush.tool = 'pencil'; s.brush.color = '#ff0000'; s.brush.opacity = 1;
    pointer('pointerdown'); pointer('pointermove', 200, 150);
    s.selectMap('spec');
    expect(!captures.size && s.history.past[0]?.kind === 'diffuse', 'Map switch lost pending paint');
    same(s.maps.spec, blankMap('spec'));
    s.selectMap('diffuse');
    pointer('pointerdown', 150, 150, 1, canvas, { altKey: true });
    expect(s.brush.color === '#ff0000' && s.history.past.length === 1, 'Pick changed history or sampled wrong location');
  });
  await check('Live processed preview, commit and settings changes preserve direct paint', async () => {
    reset(); s.setProcessing({ enabled: true, texels: 4, levels: 4, dither: .7 });
    pointer('pointerdown'); pointer('pointermove', 210, 150);
    Reflect.get(s, 'processPaint').call(s); Reflect.get(s, 'flushPaint').call(s);
    const stroke = Reflect.get(s, 'stroke') as GpuStroke;
    expect(s.material.map === stroke.output.texture, 'Direct paint did not reach the model material');
    let preview: Pixels | undefined;
    await stroke.preview(p => { preview = p; });
    // A prior live preview can own the asynchronous readback; the next frame
    // still has to converge on exactly the processed source at commit.
    pointer('pointerup', 210, 150);
    same(s.processed.diffuse, processMap(s.maps.diffuse, 256, 128, s.processing));
    if (preview) same(preview, s.processed.diffuse, 1);
    const source = copyPixels(s.maps.diffuse);
    s.setProcessing({ enabled: false }); same(s.processed.diffuse, source);
  });
  await check('Direct GPU failure replays the gesture through the texture fallback', () => {
    reset();
    const engine = Reflect.get(s, 'gpuPainter') as GpuPainter, original = engine.paint;
    const expected = copyPixels(s.maps.diffuse), cpu = new TextureStroke(expected, textureRect(300, 300, 256, 128));
    for (const _ of cpu.dabSteps(150, 150, brush, false)) { /* Drain. */ }
    engine.paint = () => { throw Error('Simulated direct paint failure'); };
    try { pointer('pointerdown'); pointer('pointerup'); same(s.maps.diffuse, expected); }
    finally { engine.paint = original; engine.reset(); }
    expect(s.history.past.length === 1 && !captures.size && s.controls.enabled, 'Recovery leaked ownership');
  });
  await check('A one-pixel pencil edits the addressed preview cell, including coarse grids and tiny source maps', () => {
    for (const sourceWidth of [16, 512]) for (const gpu of [true, false]) {
      reset();
      s.maps.diffuse = blankMap('diffuse', sourceWidth, sourceWidth);
      s.setProcessing({ enabled: true, texels: 4, levels: 256 });
      Object.assign(s.brush, { tool: 'pencil', size: 1, opacity: 1, color: '#ff0000' });
      const engine = Reflect.get(s, 'gpuPainter') as GpuPainter;
      if (!gpu) Object.defineProperty(engine, 'supported', { configurable: true, value: false });
      try {
        const { width, height } = s.processed.diffuse, x = 123.2, y = 163.7;
        pointer('pointerdown', x, y); pointer('pointerup', x, y);
        const i = (Math.floor(y / 300 * height) * width + Math.floor(x / 300 * width)) * 4;
        expect(s.processed.diffuse.data[i] === 255 && s.processed.diffuse.data[i + 1] === 0, `One-pixel pencil missed the displayed cell (${sourceWidth}, ${gpu})`);
      } finally { if (!gpu) Reflect.deleteProperty(engine, 'supported'); }
    }
  });
  await check('Project saves finish direct strokes and preserve UV visibility; legacy projects default to hidden', () => {
    reset(); s.setUvVisible(true);
    pointer('pointerdown'); pointer('pointermove', 200, 150);
    const data = captureProject(s), painted = copyPixels(s.maps.diffuse);
    validateProject(data);
    s.newProject(); restoreProject(s, data);
    expect(s.uvVisible && s.history.past.length === 1, 'UV state or stroke history was lost');
    same(s.maps.diffuse, painted);
    delete data.editor.uvVisible; restoreProject(s, data);
    expect(!s.uvVisible, 'Legacy project inherited UV visibility');
  });
  await check('GPU painting covers a concave corner at native, coarse and fractional grids', () => {
    const { group, camera } = paintCorner();
    s.setModel(group, false); s.camera.copy(camera);
    s.maps.diffuse = blankMap('diffuse', 128, 128);
    const original = s.material, material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const scene = new THREE.Scene();
    const probe = group.clone(true); probe.traverse(o => { if (o instanceof THREE.Mesh) o.material = material; }); scene.add(probe);
    const target = new THREE.WebGLRenderTarget(400, 400);
    const gpu = painter.begin(s.maps.diffuse, s.meshes, camera, 400, 400, Uint32Array.from({ length: 128 * 128 }, (_, i) => i), 128, 128, false)!;
    const render = (map: THREE.Texture | null) => {
      material.map = map; material.needsUpdate = true;
      s.renderer.setRenderTarget(target); s.renderer.render(scene, camera);
      const bytes = new Uint8Array(400 * 400 * 4); s.renderer.readRenderTargetPixels(target, 0, 0, 400, 400, bytes); return bytes;
    };
    const previous = s.renderer.getRenderTarget(), background = s.renderer.getClearColor(new THREE.Color());
    try {
      for (const _ of gpu.dabSteps(200, 200, { ...brush, tool: 'pencil', size: 2000, opacity: 1, color: '#ff0000' })) { /* Drain. */ }
      gpu.commit();
      s.renderer.setClearColor(0);
      const coverage = render(null);
      for (const texels of [1, 4, 8, 17.3]) {
        s.setProcessing({ enabled: true, texels, levels: 256 });
        const pixels = render(s.textures.diffuse);
        let checked = 0, missing = 0;
        for (let i = 0; i < pixels.length; i += 4) if (coverage[i] > 250) {
          checked++;
          if (pixels[i] < 250 || pixels[i + 1] > 2 || pixels[i + 2] > 2) missing++;
        }
        expect(checked > 50000 && !missing, `${missing}/${checked} corner fragments unpainted at grid ${texels}`);
      }
      expect(s.material === original, 'Shared material replaced');
    } finally { s.renderer.setRenderTarget(previous); s.renderer.setClearColor(background); gpu.dispose(); target.dispose(); material.dispose(); }
  });
  expect(s.renderer.getContext().getError() === 0, 'UV tests left a WebGL error');
  unbind(); painter.dispose(); s.dispose();
  reportResults({ suite: 'uv-paint', tests });
}
void run().catch(error => reportResults({ suite: 'uv-paint', error: String(error), tests }));
