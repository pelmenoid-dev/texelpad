import { reportResults } from './browser-report';
import * as THREE from 'three';
import { Studio } from '../src/studio';
import { blankMap, canvasOf, copyPixels, MAPS } from '../src/maps';
import { ProjectedStroke } from '../src/projection';
import { createArchive } from '../src/export';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
const results: {
  name: string;
  pass: boolean;
  detail?: string;
}[] = [];
const s = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});
const expect = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({
      name,
      pass: true
    });
  } catch (e) {
    results.push({
      name,
      pass: false,
      detail: String(e)
    });
  }
  document.querySelector('#results')!.textContent = results.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail ?? ''}`).join('\n');
}
const geometry = new THREE.PlaneGeometry(2, 2),
  uv = geometry.getAttribute('uv');
for (let i = 0; i < uv.count; i++) {
  const u = uv.getX(i),
    v = uv.getY(i);
  uv.setXY(i, .12 + .35 * u + .09 * v, .14 + .06 * u + .29 * v);
}
s.setModel(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
s.maps = {
  diffuse: blankMap('diffuse', 128, 128),
  spec: blankMap('spec', 64, 96),
  glow: blankMap('glow', 256, 64)
};
s.camera.position.set(0, 1.5, 5);
s.controls.target.set(0, 1.5, 0);
s.controls.update();
s.refresh();
const scene = new THREE.Scene(),
  probeMaterial = new THREE.MeshBasicMaterial({
    toneMapped: false
  });
const probe = new THREE.Mesh(geometry, probeMaterial);
probe.matrixAutoUpdate = false;
probe.matrix.copy(s.meshes[0].matrixWorld);
scene.add(probe);
const target = new THREE.WebGLRenderTarget(256, 256, {
  depthBuffer: false
});
const camera = s.camera.clone();
camera.aspect = 1;
camera.updateProjectionMatrix();
function assertRed(texture: THREE.Texture) {
  const previous = s.renderer.getRenderTarget();
  const clearColor = s.renderer.getClearColor(new THREE.Color());
  const clearAlpha = s.renderer.getClearAlpha();
  s.renderer.setRenderTarget(target);
  s.renderer.setClearColor(0, 0);
  // Use a texture-free GPU coverage pass. CPU ray hits include boundary pixels
  // excluded by rasterization's top-left rule, which are not paint gaps.
  probeMaterial.map = null;
  probeMaterial.needsUpdate = true;
  s.renderer.render(scene, camera);
  const coverage = new Uint8Array(256 * 256 * 4);
  s.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, coverage);
  probeMaterial.map = texture;
  probeMaterial.needsUpdate = true;
  s.renderer.render(scene, camera);
  const pixels = new Uint8Array(256 * 256 * 4);
  s.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
  s.renderer.setRenderTarget(previous);
  s.renderer.setClearColor(clearColor, clearAlpha);
  let checked = 0,
    missing = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    if (coverage[i] < 250) continue;
    checked++;
    if (pixels[i] < 250 || pixels[i + 1] > 2 || pixels[i + 2] > 2) missing++;
  }
  expect(checked > 10000, 'No visible test surface');
  expect(missing === 0, `${missing}/${checked} visible fragments show paint gaps`);
  expect(s.renderer.getContext().getError() === 0, 'WebGL error');
}
async function run() {
  const before = copyPixels(s.maps.diffuse);
  new ProjectedStroke(s.maps.diffuse, s.meshes, s.camera, 640, 480).dab(320, 240, {
    ...s.brush,
    size: 1000,
    color: '#ff0000'
  }, false);
  s.history.push({
    kind: 'diffuse',
    before,
    after: copyPixels(s.maps.diffuse),
    label: 'Seam regression'
  });
  for (const texels of [1, 8, 17.3]) await check(`No GPU paint gaps at ${texels} texels per pixel`, () => {
    s.setProcessing({
      texels
    });
    s.refresh();
    assertRed(s.textures.diffuse);
  });
  await check('Undo and redo restore the stroke and regenerated gutters', () => {
    s.undo();
    expect(s.maps.diffuse.data.every((v, i) => v === before.data[i]), 'Undo changed source');
    s.redo();
    assertRed(s.textures.diffuse);
  });
  await check('All three maps use the same grid with independent resolutions', () => {
    for (const k of MAPS) {
      new ProjectedStroke(s.maps[k], s.meshes, s.camera, 640, 480).dab(320, 240, {
        ...s.brush,
        size: 1000,
        color: '#ff0000',
        value: .75
      }, k !== 'diffuse');
      s.refresh(k);
      expect(s.processed[k].width === s.processed.diffuse.width && s.processed[k].height === s.processed.diffuse.height, 'Map grids differ');
    }
    assertRed(s.textures.diffuse);
  });
  await check('Original and pixel-grid exports preserve the seam fix without editing source maps', async () => {
    const originals = MAPS.map(k => s.maps[k].data.slice());
    for (const processed of [false, true]) {
      const files = unzipSync(await createArchive(s, processed));
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(files['diffuse.png'])], {
        type: 'image/png'
      }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (!processed) {
        // Mirror Unity's point sampling at each coarse cell center.
        const sampled = document.createElement('canvas');
        sampled.width = s.processed.diffuse.width;
        sampled.height = s.processed.diffuse.height;
        const ctx = sampled.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0, sampled.width, sampled.height);
        const texture = new THREE.CanvasTexture(sampled);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        assertRed(texture);
        texture.dispose();
      } else {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        assertRed(texture);
        texture.dispose();
      }
    }
    MAPS.forEach((k, i) => expect(s.maps[k].data.every((v, j) => v === originals[i][j]), 'Export changed the editable source'));
  });
  // Import a standalone FBX fixture and paint from two camera angles.
  await check('FBX cube supports edge painting and rendering', async () => {
    const bytes = await (await fetch('/tests/fixtures/cube.fbx')).arrayBuffer();
    await s.loadModel(new File([bytes], 'cube.fbx'));
    expect(s.triangles === 12, 'FBX cube did not load all 12 triangles');
    s.setProcessing({
      texels: 8
    });
    s.maps.diffuse = blankMap('diffuse', 512, 512);
    const before = s.maps.diffuse.data.slice();
    for (const angle of [0, .85]) {
      s.camera.position.set(Math.sin(angle) * 4, 4.7, Math.cos(angle) * 4);
      s.controls.target.set(0, 1, 0);
      s.controls.update();
      new ProjectedStroke(s.maps.diffuse, s.meshes, s.camera, 640, 480).dab(320, 240, {
        ...s.brush,
        size: 1200,
        color: '#352e44'
      }, false);
    }
    s.refresh();
    s.composer.render();
    expect(s.maps.diffuse.data.some((value, i) => value !== before[i]), 'FBX cube did not receive paint');
    expect(s.renderer.getContext().getError() === 0, 'FBX render failed');
  });
  reportResults({
    suite: 'paint-seams',
    tests: results
  });
  document.title = results.every(r => r.pass) ? 'PASS · Paint seams' : 'FAIL · Paint seams';
  target.dispose();
  probeMaterial.dispose();
}
void run().catch(async e => {
  document.querySelector('#results')!.textContent = String(e);
  reportResults({
    suite: 'paint-seams',
    error: String(e),
    tests: results
  });
});
