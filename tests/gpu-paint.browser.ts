import * as THREE from 'three';
import { Studio } from '../src/studio';
import { GpuPainter, GpuStroke } from '../src/gpu-paint';
import { ProjectedStroke } from '../src/projection';
import type { Brush } from '../src/projection';
import { blankMap, copyPixels, processMap } from '../src/maps';
import type { Pixels, Processing } from '../src/maps';
import { buildUvPadding, paddedIndex, texelWeights } from '../src/uv-padding';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';
const tests: BrowserResult[] = [];
const studio = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => { }, () => { }, () => { });
const painter = new GpuPainter(studio.renderer);
const brush: Brush = { tool: 'brush', size: 128, opacity: .4, hardness: .35, color: '#b23d78', value: .63 };
function expect(value: unknown, message: string): asserts value { if (!value)
  throw Error(message); }
async function check(name: string, run: () => void | Promise<void>) {
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2) + '\nRunning: ' + name;
  try {
    await run();
    tests.push({ name, pass: true });
  }
  catch (error) {
    tests.push({ name, pass: false, detail: String(error) });
  }
}
function comparison(actual: Pixels, expected: Pixels, maxError = 1, projection?: ProjectedStroke) {
  let max = 0, different = 0;
  const first: unknown[] = [];
  const boundary = new Set<number>();
  actual.data.forEach((value, i) => {
    const delta = Math.abs(value - expected.data[i]);
    max = Math.max(max, delta);
    if (delta <= maxError)
      return;
    const p = Math.floor(i / 4), x = p % actual.width + .5, y = Math.floor(p / actual.width) + .5;
    // GPU float arithmetic can put a surface point on the other side of a UV
    // edge/visibility tolerance. Interior paint must still agree within 1 byte;
    // the boundary allowance is spatially checked and capped, never global.
    if (projection?.projection.faces.some(face => { const w = texelWeights(x, y, face.texels); return w && Math.min(...w) < 1e-4; }))
      boundary.add(p);
    else {
      different++;
      if (first.length < 8)
        first.push({ i, actual: value, expected: expected.data[i] });
    }
  });
  expect(different === 0, `${different} channels exceed ${maxError}/255; maximum ${max}; ${JSON.stringify(first)}`);
  expect(boundary.size <= Math.ceil(actual.width * actual.height / 65536) + 4, `${boundary.size} UV boundary texels differ`);
}
function begin(pixels: Pixels, grayscale = false, sampling = Uint32Array.from({ length: pixels.width * pixels.height }, (_, i) => i), width = pixels.width, height = pixels.height, processing?: Processing) {
  const stroke = painter.begin(pixels, studio.meshes, studio.camera, 800, 600, sampling, width, height, grayscale, processing);
  expect(stroke, 'GPU path unavailable on the test renderer');
  return stroke;
}
function dab(stroke: GpuStroke, x: number, y: number, settings = brush) { for (const _ of stroke.dabSteps(x, y, settings)) { /* Drain this input sample. */ } }
function plane() {
  const geometry = new THREE.PlaneGeometry(2, 2), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, .12 + .35 * u + .09 * v, .14 + .06 * u + .29 * v);
  }
  studio.setModel(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  studio.camera.position.set(0, 1.5, 5);
  studio.controls.target.set(0, 1.5, 0);
  studio.controls.update();
}
function pointer(type: string, x = 400, y = 300) {
  const canvas = studio.renderer.domElement, bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: 'pen', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: bounds.left + x, clientY: bounds.top + y, bubbles: true }));
}
const captures = new Set<number>();
studio.renderer.domElement.setPointerCapture = id => { captures.add(id); };
studio.renderer.domElement.hasPointerCapture = id => captures.has(id);
studio.renderer.domElement.releasePointerCapture = id => { captures.delete(id); };
async function run() {
  await check('GPU backend is supported and WebGL starts without errors', () => {
    expect(painter.supported, 'Float rendering/blending unsupported');
    expect(studio.renderer.getContext().getError() === 0, 'Initial GL error');
  });
  plane();
  for (const tool of ['pencil', 'brush', 'eraser'] as const)
    for (const grayscale of [false, true])
      await check(`${tool}, ${grayscale ? 'mask' : 'diffuse'}: alpha, UV edges and batched samples match CPU`, () => {
        const actual = blankMap('diffuse', 127, 63);
        for (let i = 0; i < actual.data.length; i++)
          actual.data[i] = (i * 13 + 137) % 256;
        const expected = copyPixels(actual), cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600), gpu = begin(actual, grayscale);
        try {
          const settings = { ...brush, tool };
          for (let i = 0; i < 40; i++) {
            const x = 330 + Math.sin(i * .25) * 100, y = 280 + Math.cos(i * .2) * 65;
            cpu.dab(x, y, settings, grayscale);
            dab(gpu, x, y, settings);
          }
          gpu.commit();
          comparison(actual, expected);
          expect(gpu.changed, 'Fixture did not paint');
        }
        finally {
          gpu.dispose();
        }
      });
  await check('Brush settings are captured per sample, including opacity decreases and color changes', () => {
    const actual = blankMap('diffuse', 127, 63), expected = copyPixels(actual), cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600), gpu = begin(actual);
    try {
      const variants = [{ opacity: .3, color: '#eab265' }, { opacity: .65, color: '#386fa4' }, { opacity: .2, color: '#bb4372' }, { opacity: 1, color: '#3bad79' }];
      for (const change of variants)
        for (let i = 0; i < 6; i++) {
          const settings = { ...brush, ...change, hardness: i / 5 }, x = 340 + i * 18, y = 300;
          cpu.dab(x, y, settings, false);
          dab(gpu, x, y, settings);
        }
      gpu.commit();
      comparison(actual, expected);
    }
    finally {
      gpu.dispose();
    }
  });
  for (const grayscale of [false, true]) for (const levels of [4, 11, 256])
    await check(`GPU display and asynchronous preview preserve ${levels}-level Bayer, orientation, alpha and ${grayscale ? 'mask values' : 'sRGB colors'}`, async () => {
      const actual = blankMap('diffuse', 127, 63);
      for (let i = 0; i < actual.data.length; i++)
        actual.data[i] = (i * 13 + 137) % 256;
      const padding = buildUvPadding(studio.meshes, 127, 63), settings = { enabled: true, texels: 4.3, dither: .73, levels };
      const processed = processMap(actual, 256, 128, settings, padding), { width, height } = processed, sampling = new Uint32Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = Math.floor((y + .5) / height * 63) * 127 + Math.floor((x + .5) / width * 127);
          sampling[y * width + x] = paddedIndex(padding, index, Math.ceil(127 / width), Math.ceil(63 / height));
        }
      const gpu = begin(actual, grayscale, sampling, width, height, settings);
      try {
        dab(gpu, 400, 300);
        gpu.present();
        let preview: Pixels | undefined;
      const pending = gpu.preview(p => { preview = p; });
      dab(gpu, 430, 310, { ...brush, opacity: .8 });
      gpu.present();
      // Release may arrive while an older preview transfer is still pending.
      gpu.commit();
      expect(studio.renderer.getContext().getError() === 0, 'Pending preview blocked synchronous commit');
      await pending;
        gpu.commit();
        expect(preview, 'Preview was not delivered');
        comparison(preview, processMap(actual, 256, 128, settings, padding));
        expect(studio.renderer.getContext().getError() === 0, 'GPU display error');
      }
      finally {
        gpu.dispose();
      }
    });
  await check('Hidden UV islands are not painted through a separate foreground surface', () => {
    const front = new THREE.PlaneGeometry(2, 2), back = new THREE.PlaneGeometry(2, 2);
    for (const [geo, offset] of [[front, 0], [back, .5]] as const) {
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++)
        uv.setX(i, uv.getX(i) * .45 + offset);
    }
    const group = new THREE.Group(), material = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(front, material), b = new THREE.Mesh(back, material);
    a.position.z = .02;
    group.add(a, b);
    studio.setModel(group);
    const actual = blankMap('diffuse', 128, 128), expected = copyPixels(actual), cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600), gpu = begin(actual);
    try {
      const settings = { ...brush, tool: 'pencil' as const, size: 2000, opacity: 1 };
      cpu.dab(400, 300, settings, false);
      dab(gpu, 400, 300, settings);
      gpu.commit();
      comparison(actual, expected, 0);
    }
    finally {
      gpu.dispose();
    }
  });
  plane();
  studio.maps = { diffuse: blankMap('diffuse',128,64), spec: blankMap('spec',64,96), glow: blankMap('glow',96,64) };
  studio.setProcessing({enabled:true,texels:2.5,levels:4,dither:.8});
  for (const kind of ['diffuse','spec','glow'] as const) await check(`${kind}: live binding, commit and undo/redo keep independent map sizes`,async()=>{
    studio.selectMap(kind);
    Object.assign(studio.brush,brush);
    const before=copyPixels(studio.maps[kind]), others=Object.entries(studio.maps).filter(([key])=>key!==kind).map(([key,pixels])=>({key,pixels:copyPixels(pixels)}));
    pointer('pointerdown');
    await new Promise(requestAnimationFrame);
    expect(Reflect.get(studio,'stroke') instanceof GpuStroke,'Map did not use GPU painting');
    const texture=kind==='diffuse'?studio.material.map:kind==='spec'?studio.material.specularMap:studio.material.emissiveMap;
    expect(texture!==studio.textures[kind],'Model did not bind the live GPU map');
    pointer('pointermove',420,300);pointer('pointerup');
    const after=copyPixels(studio.maps[kind]);
    expect(after.data.some((value,i)=>value!==before.data[i]),'Map did not commit paint');
    for(const other of others) comparison(studio.maps[other.key as keyof typeof studio.maps],other.pixels,0);
    studio.undo();comparison(studio.maps[kind],before,0);
    studio.redo();comparison(studio.maps[kind],after,0);
    expect(studio.renderer.getContext().getError()===0,'Live map left a WebGL error');
  });
  await studio.loadModel(new File([await (await fetch('./fixtures/cube.fbx')).arrayBuffer()], 'cube.fbx'));
  for (const [resolution, size] of [[512, 40], [512, 128], [1024, 128]])
    await check(`FBX cube with overlapping UVs: ${resolution}px map, ${size}px brush preserves interior pixels and UV boundaries`, () => {
      const actual = blankMap('diffuse', resolution, resolution), expected = copyPixels(actual);
      const cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600), gpu = begin(actual);
      try {
        for (let i = 0; i < 24; i++) {
          const x = 400 + Math.sin(i * .25) * 90, y = 300 + Math.cos(i * .2) * 50, settings = { ...brush, size };
          cpu.dab(x, y, settings, false);
          dab(gpu, x, y, settings);
        }
        gpu.commit();
        expect(gpu.changed, 'Cube fixture did not receive paint');
        comparison(actual, expected, 1, cpu);
      }
      finally {
        gpu.dispose();
      }
    });
  plane();
  studio.selectMap('diffuse');
  studio.maps.diffuse = blankMap('diffuse', 64, 64);
  studio.refresh();
  await check('Outside-model and zero-opacity gestures add no history', () => {
    studio.history.clear();
    studio.dirty = false;
    Object.assign(studio.brush, brush);
    pointer('pointerdown', -1000, -1000);
    pointer('pointerup');
    studio.brush.opacity = 0;
    pointer('pointerdown');
    pointer('pointerup');
    expect(studio.history.past.length === 0, 'No-op stroke created a history entry');
    expect(!studio.dirty, 'No-op stroke marked the project as changed');
    studio.brush.opacity = 1;
  });
  await check('Unavailable GPU features fall back to the existing painter', () => {
    const engine = Reflect.get(studio, 'gpuPainter');
    Object.defineProperty(engine, 'supported', { configurable: true, value: false });
    try {
      pointer('pointerdown');
      expect(Reflect.get(studio, 'stroke') instanceof ProjectedStroke, 'CPU fallback was not used');
      pointer('pointerup');
      expect(studio.history.past.length === 1, 'Fallback did not commit paint');
    }
    finally {
      delete engine.supported;
    }
  });
  for (const failure of ['begin', 'paint', 'present', 'readback'] as const) {
    await check(`A GPU ${failure} failure preserves every dab, history and pointer ownership`, () => {
      const engine: GpuPainter = Reflect.get(studio, 'gpuPainter');
      const target = failure === 'readback' ? studio.renderer : engine;
      const method = failure === 'readback' ? 'readRenderTargetPixels' : failure;
      const original = Reflect.get(target, method);
      studio.maps.diffuse = blankMap('diffuse', 64, 64);
      studio.refresh();
      studio.history.clear();
      Object.assign(studio.brush, brush);
      const expected = copyPixels(studio.maps.diffuse);
      const cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600);
      Reflect.set(target, method, () => {
        if (failure === 'readback') studio.maps.diffuse.data.fill(0);
        throw Error(`Simulated GPU ${failure} failure`);
      });
      try {
        pointer('pointerdown');
        cpu.dab(400, 300, brush, false);
        // More than one batch: the failing generator must retry the dab that
        // triggered its flush, then preserve all the later queued segments.
        for (let i = 1; i <= 40; i++) {
          pointer('pointermove', 400 + i, 300);
          cpu.dab(400 + i, 300, brush, false);
        }
        Reflect.get(studio, 'processPaint').call(studio);
        if (failure === 'present') Reflect.get(studio, 'flushPaint').call(studio);
        pointer('pointerup');
        comparison(studio.maps.diffuse, expected, 0);
        expect(studio.history.past.length === 1 && captures.size === 0 && studio.controls.enabled, 'Recovery lost history or pointer ownership');
        studio.undo();
        comparison(studio.maps.diffuse, blankMap('diffuse', 64, 64), 0);
        studio.redo();
        comparison(studio.maps.diffuse, expected, 0);
        pointer('pointerdown');
        expect(Reflect.get(studio, 'stroke') instanceof ProjectedStroke, 'Failed backend was retried before restoration');
        pointer('pointerup');
      } finally {
        Reflect.set(target, method, original);
        studio.endStroke();
        engine.reset();
      }
    });
  }
  await check('Context loss replays pending GPU paint and restores a usable editor', async () => {
    const extension = studio.renderer.getContext().getExtension('WEBGL_lose_context');
    expect(extension, 'Context-loss extension unavailable');
    const environment = () => {
      const target: THREE.WebGLCubeRenderTarget = Reflect.get(studio, 'envTarget');
      const data = new Uint8Array(target.width * target.height * 4);
      studio.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data, 0);
      return data;
    };
    const reflections = environment();
    studio.maps.diffuse = blankMap('diffuse', 64, 64);
    studio.refresh();
    studio.history.clear();
    Object.assign(studio.brush, brush);
    const expected = copyPixels(studio.maps.diffuse), cpu = new ProjectedStroke(expected, studio.meshes, studio.camera, 800, 600);
    cpu.dab(400, 300, brush, false);
    cpu.dab(420, 300, brush, false);
    pointer('pointerdown');
    await new Promise(requestAnimationFrame);
    expect(Reflect.get(studio, 'stroke').changed, 'Context-loss fixture did not render GPU paint');
    pointer('pointermove', 420, 300);
    expect(Reflect.get(studio, 'stroke') instanceof GpuStroke, 'Context-loss fixture missed GPU path');
    const lost = new Promise(resolve => studio.renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }));
    extension.loseContext();
    await lost;
    const restored = new Promise(resolve => studio.renderer.domElement.addEventListener('webglcontextrestored', resolve, { once: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    extension.restoreContext();
    await restored;
    expect(environment().every((value, i) => value === reflections[i]), 'Context restoration lost environment reflections');
    comparison(studio.maps.diffuse, expected, 0);
    expect(studio.history.past.length === 1 && !studio.hasPendingPaint && captures.size === 0, 'Context loss lost the gesture');
    studio.brush.color = '#32ba79';
    pointer('pointerdown');
    pointer('pointerup');
    expect(studio.history.past.length === 2, 'Painting did not resume after restoration');
  });
  await check('GPU resources are released after completed strokes and painter disposal', () => {
    const before = studio.renderer.info.memory.textures;
    const gpu = begin(blankMap('diffuse', 64, 64));
    dab(gpu, 400, 300);
    gpu.present();
    gpu.commit();
    gpu.dispose();
    expect(studio.renderer.info.memory.textures <= before + 3, 'Completed stroke retained render targets');
    expect(Reflect.get(painter, 'composite').uniforms.base.value === null && Reflect.get(painter, 'display').uniforms.sampling.value === null, 'Disposed stroke retained source pixels in uniforms');
    let disposals = 0;
    const surface = Reflect.get(painter, 'surface');
    surface.faces.addEventListener('dispose', () => disposals++);
    painter.dispose();
    painter.dispose();
    expect(disposals === 1, 'Surface cache disposal was not idempotent');
  });
}
void run().catch(error => tests.push({ name: 'GPU suite', pass: false, detail: String(error) })).finally(() => {
  painter.dispose();
  studio.dispose();
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2);
  reportResults({ suite: 'gpu-paint', tests });
});
