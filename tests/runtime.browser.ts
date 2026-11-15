import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Studio } from '../src/studio';
import { MAPS, blankMap, copyPixels } from '../src/maps';
import { ReferenceStroke } from './fixtures/reference-stroke';
import { GpuStroke } from '../src/gpu-paint';
import { saveProject, decodeProject, defaultProjectUI } from '../src/project';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';
const results: BrowserResult[] = [];
const output = document.querySelector('#results')!;
let changes = 0;
const studio = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => { changes++; }, () => {}, () => {});
const canvas = studio.renderer.domElement;
const captures = new Set<number>();
// Synthetic pointer events cannot create native capture. Model only that browser API;
// painting, projection, event ownership, history and cancellation use production code.
canvas.setPointerCapture = id => {
  captures.add(id);
};
canvas.hasPointerCapture = id => captures.has(id);
canvas.releasePointerCapture = id => {
  captures.delete(id);
};
function expect(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
async function check(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    results.push({
      name,
      pass: true
    });
  } catch (error) {
    results.push({
      name,
      pass: false,
      detail: String(error)
    });
  }
  output.textContent = JSON.stringify(results, null, 2);
}
function pointer(type: string, id: number, primary = true, x = 400, y = 300) {
  const bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    pointerId: id,
    pointerType: 'touch',
    isPrimary: primary,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: bounds.left + x,
    clientY: bounds.top + y
  }));
}
async function run() {
  studio.setModel(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial()));
  studio.camera.position.set(0, 1.5, 5);
  studio.controls.target.set(0, 1.5, 0);
  studio.controls.update();
  studio.maps = {
    diffuse: blankMap('diffuse', 64, 64),
    spec: blankMap('spec', 64, 64),
    glow: blankMap('glow', 64, 64)
  };
  studio.setProcessing({
    enabled: false
  });
  await new Promise(requestAnimationFrame);
  await check('Secondary pointers cannot replace or finish the active stroke', () => {
    const before = studio.maps.diffuse.data.slice();
    pointer('pointerdown', 1);
    pointer('pointerdown', 2, false);
    pointer('pointerup', 2, false);
    pointer('pointercancel', 2, false);
    pointer('lostpointercapture', 2, false);
    expect(!studio.controls.enabled, 'Secondary pointer released the stroke');
    expect(studio.history.past.length === 0, 'Stroke committed before its owner finished');
    pointer('pointerup', 1);
    expect(studio.controls.enabled && captures.size === 0, 'Owner did not release capture');
    expect(Number(studio.history.past.length) === 1, 'Stroke history was lost');
    expect(studio.maps.diffuse.data.some((value, index) => value !== before[index]), 'Test did not paint');
    studio.undo();
    expect(studio.maps.diffuse.data.every((value, index) => value === before[index]), 'Undo missed part of the stroke');
    studio.redo();
  });
  await check('Cancellation and tool changes release capture and preserve history', () => {
    studio.history.clear();
    studio.brush.color = '#ff0000';
    pointer('pointerdown', 3);
    pointer('pointercancel', 3);
    expect(studio.controls.enabled && captures.size === 0 && studio.history.past.length === 1, 'Cancelled stroke was lost');
    studio.brush.color = '#00ff00';
    pointer('pointerdown', 4);
    studio.setTool('eraser');
    expect(studio.controls.enabled && captures.size === 0 && Number(studio.history.past.length) === 2, 'Tool change left a captured pointer');
    studio.setTool('pencil');
  });
  await check('A non-primary touch cannot start painting', () => {
    const count = studio.history.past.length;
    pointer('pointerdown', 5, false);
    pointer('pointerup', 5, false);
    expect(studio.controls.enabled && captures.size === 0 && studio.history.past.length === count, 'Secondary touch started a stroke');
  });
  await check('Eyedropper clamps accepted UV tolerance at every map edge', () => {
    const intersect = THREE.Raycaster.prototype.intersectObjects;
    let uv = new THREE.Vector2(-0.0005, 1.0005);
    THREE.Raycaster.prototype.intersectObjects = () => [{
      uv
    }] as THREE.Intersection[];
    try {
      studio.maps.diffuse.data.set([1, 2, 3, 255], 0);
      studio.maps.diffuse.data.set([4, 5, 6, 255], studio.maps.diffuse.data.length - 4);
      studio.sample(400, 300);
      expect(studio.brush.color === '#010203', 'Upper-left sample was not clamped');
      uv = new THREE.Vector2(1.0005, -0.0005);
      studio.sample(400, 300);
      expect(String(studio.brush.color) === '#040506', 'Lower-right sample was not clamped');
      studio.selectMap('spec');
      studio.sample(400, 300);
      expect(Number.isFinite(studio.brush.value), 'Mask sample is invalid');
    } finally {
      THREE.Raycaster.prototype.intersectObjects = intersect;
      studio.selectMap('diffuse');
    }
  });
  for (const defect of ['indices', 'index type', 'triangle', 'positions', 'uv'] as const) {
    await check(`Invalid ${defect} leave the current model intact`, () => {
      const current = studio.model;
      const geometry = new THREE.PlaneGeometry(2, 2);
      const material = new THREE.MeshBasicMaterial();
      if (defect === 'indices') geometry.setIndex([0, 1, 2, 0, 1, 999]);
      if (defect === 'index type') geometry.setIndex(new THREE.BufferAttribute(new Float32Array([0, 1, 2]), 1));
      if (defect === 'triangle') geometry.setIndex([0, 1, 2, 0]);
      if (defect === 'positions') geometry.getAttribute('position').setX(0, NaN);
      if (defect === 'uv') geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 3));
      let rejected = false;
      try {
        studio.setModel(new THREE.Mesh(geometry, material));
      } catch {
        rejected = true;
      } finally {
        geometry.dispose();
        material.dispose();
      }
      expect(rejected && studio.model === current, 'Invalid model replaced the current document');
    });
  }
  await check('Map selection reuses processed pixels and GPU textures', () => {
    const before = MAPS.map(kind => ({
      pixels: studio.processed[kind],
      texture: studio.textures[kind],
      version: studio.textures[kind].version
    }));
    for (const kind of MAPS) studio.selectMap(kind);
    MAPS.forEach((kind, i) => {
      expect(studio.processed[kind] === before[i].pixels && studio.textures[kind] === before[i].texture && studio.textures[kind].version === before[i].version, 'Selecting a map reprocessed textures');
    });
    studio.view = 'map';
    studio.selectMap('spec');
    expect(studio.material.map === studio.textures.spec, 'Legacy map view did not follow selection');
    studio.view = 'material';
    studio.selectMap('diffuse');
    studio.refresh();
  });
  for (const enabled of [false, true]) {
    await check(`Fast painting batches uploads, preserves every sample and flushes on release (pixelisation ${enabled})`, async () => {
      studio.maps.diffuse = blankMap('diffuse', 64, 64);
      studio.history.clear();
      Object.assign(studio.brush, { tool: 'brush', size: 128, opacity: 0.4, hardness: 0.35, color: '#b23d78' });
      studio.setProcessing({ enabled, texels: 2 });
      studio.refresh();
      studio.dirty = false;
      const before = copyPixels(studio.maps.diffuse), expected = copyPixels(before);
      const reference = new ReferenceStroke(expected, studio.meshes, studio.camera, 800, 600);
      const texture = studio.textures.diffuse, version = texture.version;
      const processed = studio.processed.diffuse, changeCount = changes;
      const refresh = studio.refresh;
      let previews = 0;
      const unsubscribe = studio.subscribeTexture('diffuse', () => { previews++; });
      let refreshes = 0, materialInvalidations = 0;
      studio.refresh = function (kind) {
        refreshes++;
        const version = this.material.version;
        refresh.call(this, kind);
        materialInvalidations += this.material.version - version;
      };
      try {
        pointer('pointerdown', 20, true, 320, 300);
        const gpu=Reflect.get(studio,'stroke') instanceof GpuStroke;
        expect(gpu, 'GPU painting was not selected on a capable context');
        reference.dab(320, 300, studio.brush, false);
        for (let x = 340; x <= 440; x += 20) {
          pointer('pointermove', 20, true, x, 300);
          reference.dab(x, 300, studio.brush, false);
        }
        expect(refreshes === 0 && changes === changeCount && texture.version === version, 'Pointer events uploaded or redrew before the frame');
        expect(studio.hasPendingPaint && !studio.dirty, 'Input was not queued');
        expect(studio.maps.diffuse.data.every((v, i) => v === before.data[i]), 'Pointer events painted synchronously');
        for (let frame = 0; studio.hasPendingPaint && frame < 120; frame++) {
          const previousRefreshes = refreshes;
          await new Promise(requestAnimationFrame);
          expect(refreshes - previousRefreshes <= 1, 'Frame uploaded the texture more than once');
        }
        expect(!studio.hasPendingPaint && studio.dirty, 'Painting did not catch up with input');
        for (let frame=0;previews===0 && frame<120;frame++) await new Promise(requestAnimationFrame);
        expect(previews>0 && refreshes===0, 'GPU preview is missing or painting read back synchronously');
        expect(studio.maps.diffuse.data.every((v,i)=>v===before.data[i]), 'GPU stroke copied source pixels back before release');
        expect(changes === changeCount, 'Painting rerendered the editor controls');
        expect(studio.processed.diffuse !== processed && studio.material.map!==texture && texture.version===version, 'Live GPU texture did not update');
        expect(materialInvalidations === 0, 'Painting unnecessarily invalidated the material');
        pointer('pointermove', 20, true, 460, 300);
        reference.dab(460, 300, studio.brush, false);
        const beforeRelease = refreshes;
        pointer('pointerup', 20, true, 460, 300);
        expect(refreshes === beforeRelease + 1 && !studio.hasPendingPaint && studio.history.past.length === 1, 'Release did not flush the last pending input');
        expect(studio.maps.diffuse.data.every((v, i) => v === expected.data[i]), 'Final stroke differs from the reference');
        studio.undo();
        expect(studio.maps.diffuse.data.every((v, i) => v === before.data[i]), 'Undo lost the start of the stroke');
        studio.redo();
        expect(studio.maps.diffuse.data.every((v, i) => v === expected.data[i]), 'Redo lost the final sample');
      } finally {
        unsubscribe();
        studio.refresh = refresh;
        studio.endStroke();
      }
    });
  }
  await check('Map changes commit queued input to the original map', () => {
    const before = copyPixels(studio.maps.diffuse), mask = studio.maps.spec.data.slice();
    const expected = copyPixels(before);
    studio.history.clear();
    studio.brush.color = '#ac3481';
    const reference = new ReferenceStroke(expected, studio.meshes, studio.camera, 800, 600);
    pointer('pointerdown', 23, true, 380, 300);
    pointer('pointermove', 23, true, 400, 300);
    reference.dab(380, 300, studio.brush, false);
    reference.dab(400, 300, studio.brush, false);
    expect(studio.hasPendingPaint, 'Fixture did not queue paint');
    studio.selectMap('spec');
    expect(!studio.hasPendingPaint && studio.history.past.length === 1 && captures.size === 0, 'Map change left a pending stroke');
    expect(studio.maps.diffuse.data.every((v, i) => v === expected.data[i]), 'Map change lost queued samples');
    expect(studio.maps.spec.data.every((v, i) => v === mask[i]), 'Queued paint reached the newly selected map');
    studio.undo();
    expect(studio.maps.diffuse.data.every((v, i) => v === before.data[i]), 'Undo affected the wrong map');
    studio.redo();
    studio.selectMap('diffuse');
  });
  await check('Studio reuses surface samples until the view changes', () => {
    studio.history.clear();
    studio.brush.color = '#c92e65';
    pointer('pointerdown', 24);
    pointer('pointerup', 24);
    const painter=Reflect.get(studio,'gpuPainter');
    const cached = Reflect.get(painter, 'surface');
    expect(cached, 'Studio did not retain the surface projection');
    studio.brush.color = '#38ad79';
    pointer('pointerdown', 25);
    pointer('pointerup', 25);
    expect(Reflect.get(painter, 'surface') === cached, 'Same-view stroke discarded surface samples');
    const position = studio.camera.position.clone();
    studio.camera.position.x += 0.3;
    studio.controls.update();
    const expected = copyPixels(studio.maps.diffuse);
    const reference = new ReferenceStroke(expected, studio.meshes, studio.camera, 800, 600);
    studio.brush.color = '#ce823f';
    reference.dab(400, 300, studio.brush, false);
    pointer('pointerdown', 26);
    pointer('pointerup', 26);
    expect(Reflect.get(painter, 'surface') !== cached, 'Camera change reused stale samples');
    expect(studio.maps.diffuse.data.every((v, i) => v === expected.data[i]), 'Changed view painted stale geometry');
    studio.camera.position.copy(position);
    studio.controls.update();
  });
  await check('Resize commits pending paint before changing the projection', () => {
    const count = studio.history.past.length, version = studio.textures.diffuse.version;
    studio.brush.color = '#7ee8aa';
    pointer('pointerdown', 21);
    studio.host.style.width = '801px';
    studio.resize();
    expect(studio.textures.diffuse.version > version, 'Resize discarded pending texture pixels');
    expect(studio.history.past.length === count + 1 && captures.size === 0 && studio.controls.enabled, 'Resize left an uncommitted stroke');
    studio.host.style.width = '800px';
    studio.resize();
  });
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (blob: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  const picker = pickerWindow.showSaveFilePicker;
  try {
    await check('Cancelling Save keeps the unsaved-work guard', async () => {
      studio.dirty = true;
      pickerWindow.showSaveFilePicker = async () => {
        throw new DOMException('Cancelled', 'AbortError');
      };
      expect((await saveProject(studio, defaultProjectUI)) === false && studio.dirty, 'Cancel marked the document as saved');
    });
    await check('A write failure keeps the unsaved-work guard', async () => {
      let aborted = false;
      pickerWindow.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async () => {},
          close: async () => {
            throw Error('Disk full');
          },
          abort: async () => { aborted = true; }
        })
      });
      let failed = false;
      try {
        await saveProject(studio, defaultProjectUI);
      } catch {
        failed = true;
      }
      expect(failed && studio.dirty, 'Failed write marked the document as saved');
      expect(aborted, 'Failed save left the writable stream open');
    });
    await check('Successful Save includes queued paint before clearing dirty', async () => {
      let written: Blob | undefined;
      const historyCount = studio.history.past.length;
      studio.brush.color = '#1048c7';
      pointer('pointerdown', 22);
      expect(studio.hasPendingPaint, 'Fixture did not queue paint before Save');
      pickerWindow.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async blob => {
            written = blob;
          },
          close: async () => {
            expect(studio.dirty, 'Dirty cleared before close');
          }
        })
      });
      expect(await saveProject(studio, defaultProjectUI), 'Save failed');
      expect(!studio.hasPendingPaint && studio.history.past.length === historyCount + 1, 'Save missed queued paint');
      expect(written && !studio.dirty, 'Missing saved bytes or dirty state');
      const restored = await decodeProject(written);
      expect(restored.model !== null && restored.history.past.length === studio.history.past.length, 'Save lost document contents');
      const savedPixels = atob(restored.maps.diffuse.data);
      expect(studio.maps.diffuse.data.every((value, i) => value === savedPixels.charCodeAt(i)), 'Saved texture missed queued pixels');
    });
  } finally {
    if (picker) pickerWindow.showSaveFilePicker = picker;else delete pickerWindow.showSaveFilePicker;
  }
  await check('Studio disposal releases output-pass and shadow resources exactly once', () => {
    studio.composer.render();
    const outputPass = studio.composer.passes.find(pass => pass instanceof OutputPass) as OutputPass;
    let outputDisposals = 0,
      shadowDisposals = 0;
    outputPass.material.addEventListener('dispose', () => {
      outputDisposals++;
    });
    studio.scene.traverse(object => {
      if (object instanceof THREE.DirectionalLight && object.shadow.map) {
        object.shadow.map.addEventListener('dispose', () => {
          shadowDisposals++;
        });
      }
    });
    studio.dispose();
    studio.dispose();
    expect(Reflect.get(studio, 'strokeProjection') === undefined, 'Disposed studio retained its projection cache');
    expect(outputDisposals === 1 && shadowDisposals === 1, `Resource disposal counts: output ${outputDisposals}, shadow ${shadowDisposals}`);
    expect(!canvas.isConnected, 'Disposed viewport is still mounted');
  });
}
void run().catch(error => {
  results.push({
    name: 'Runtime suite',
    pass: false,
    detail: String(error)
  });
}).finally(() => {
  studio.dispose();
  reportResults({
    suite: 'runtime',
    tests: results
  });
});
