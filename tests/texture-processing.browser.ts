import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { Studio } from '../src/studio';
import { MAPS, blankMap, copyPixels, pixelsOf } from '../src/maps';
import type { Pixels } from '../src/maps';
import { createArchive } from '../src/export';
import { captureProject, encodeProject, decodeProject, restoreProject } from '../src/project';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';

const tests: BrowserResult[] = [];
const s = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});
function expect(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); tests.push({ name, pass: true }); }
  catch (error) { tests.push({ name, pass: false, detail: String(error) }); }
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2);
}
function same(a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 0) {
  return a.length === b.length && Array.from(a).every((value, i) => Math.abs(value - b[i]) <= tolerance);
}
function snapshots() { return MAPS.map(kind => copyPixels(s.processed[kind])); }
const settings = { enabled: true, texels: 2.5, dither: 1, levels: 4 };
async function png(bytes: Uint8Array) {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return pixelsOf(canvas);
  } finally { bitmap.close(); }
}
async function run() {
  s.setModel(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial()));
  s.frameModel();
  s.maps = { diffuse: blankMap('diffuse', 64, 48), spec: blankMap('spec', 32, 96), glow: blankMap('glow', 96, 32) };
  for (const kind of MAPS) {
    const map = s.maps[kind];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const value = (x * 17 + y * 31) % 256;
      map.data.set(kind === 'diffuse' ? [value, (value + 53) % 256, (value + 119) % 256, 255] : [value, value, value, 255], (y * map.width + x) * 4);
    }
  }
  const source = MAPS.map(kind => copyPixels(s.maps[kind]));
  s.setProcessing(settings);
  const coarse = snapshots();
  await check('All maps use the shared grid and four-level RGB; grayscale stays grayscale', () => {
    for (const kind of MAPS) {
      const map = s.processed[kind];
      expect(map.width === 25 && map.height === 19, 'Grid dimensions differ');
      for (let i = 0; i < map.data.length; i += 4) {
        for (let c = 0; c < 3; c++) expect([0, 85, 170, 255].includes(map.data[i + c]), 'Unexpected quantized level');
        expect(map.data[i + 3] === 255, 'Alpha changed');
        if (kind !== 'diffuse') expect(map.data[i] === map.data[i + 1] && map.data[i] === map.data[i + 2], 'Mask gained a color');
      }
    }
  });
  await check('Changing Dithering updates every texture and preview without reallocating GPU storage', () => {
    const textures = MAPS.map(kind => s.textures[kind]), versions = textures.map(t => t.version);
    const delivered = new Map<string, Pixels>();
    const off = MAPS.map(kind => s.subscribeTexture(kind, pixels => delivered.set(kind, pixels)));
    try {
      s.setProcessing({ dither: 0 });
      MAPS.forEach((kind, i) => {
        expect(!same(coarse[i].data, s.processed[kind].data), `${kind}: dither control had no effect`);
        expect(delivered.get(kind) === s.processed[kind], `${kind}: preview did not update`);
        expect(s.textures[kind] === textures[i] && s.textures[kind].version > versions[i], 'Texture storage was replaced or upload was missed');
      });
    } finally { off.forEach(stop => stop()); }
  });
  await check('Processing can be toggled and adjusted repeatedly without cumulative loss', () => {
    s.setProcessing({ levels: 11, dither: .35, texels: 4 });
    s.setProcessing({ enabled: false });
    MAPS.forEach((kind, i) => {
      expect(s.processed[kind].width === source[i].width && s.processed[kind].height === source[i].height, 'Disabled mode retained the grid');
      expect(same(s.processed[kind].data, source[i].data), 'Disabled mode retained quantization');
    });
    s.setProcessing(settings);
    MAPS.forEach((kind, i) => {
      expect(same(s.processed[kind].data, coarse[i].data), 'Processing accumulated');
      expect(same(s.maps[kind].data, source[i].data), 'Source bytes changed');
    });
  });

  // Compare actual lit pixels to a plain Phong render followed only by the
  // established luminance curve. Any remaining post-light Bayer fails this.
  const renderer = s.renderer, geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene(), mesh = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(geometry, s.material);
  scene.add(mesh, new THREE.AmbientLight(0xffffff, .23));
  const key = new THREE.DirectionalLight(0xffffff, .7); key.position.set(-1, 1, 2); scene.add(key);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 3;
  const target = new THREE.WebGLRenderTarget(50, 38, { type: THREE.FloatType, depthBuffer: false });
  const read = () => {
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const data = new Float32Array(50 * 38 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 50, 38, data);
    renderer.setRenderTarget(null);
    expect(renderer.getContext().getError() === 0 && data.every(Number.isFinite), 'Invalid rendered output');
    return data;
  };
  await check('Lit RGB includes textured diffuse, specular and glow without a second quantization pass', () => {
    s.specStrength = 1; s.updateMaterial();
    const reference = s.material.clone();
    reference.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;');
    };
    reference.customProgramCacheKey = () => 'plain-phong-emission-reference';
    try {
      for (const intensity of [.15, .7, 2]) {
        key.intensity = intensity;
        mesh.material = reference; const linear = read();
        mesh.material = s.material; const actual = read();
        for (let i = 0; i < actual.length; i += 4) {
          const luma = linear[i] * .2126 + linear[i + 1] * .7152 + linear[i + 2] * .0722;
          const factor = luma / Math.max(luma, .0001) / (1 + Math.max(luma - .35, 0) * .75);
          for (let c = 0; c < 3; c++) expect(Math.abs(actual[i + c] - linear[i + c] * factor) < .0001, 'Lighting was quantized again or tone curve changed');
          expect(actual[i + 3] === linear[i + 3], 'Material alpha changed');
        }
      }
    } finally { mesh.material = s.material; reference.dispose(); }
  });
  await check('Unlit shows the processed diffuse without lights, emission or tone roll-off', () => {
    s.setRenderMode('unlit');
    const reference = new THREE.MeshBasicMaterial({ map: s.textures.diffuse, transparent: true });
    try {
      const actual = read();
      mesh.material = reference; const expected = read();
      expect(same(actual, expected, .0001), 'Unlit differs from the processed texture');
      expect(!s.bloom.enabled && s.meshes.every(m => !m.castShadow && !m.receiveShadow), 'Unlit retains lighting effects');
    } finally { mesh.material = s.material; reference.dispose(); s.setRenderMode('lit'); }
  });
  await check('Light and camera changes never rebake the maps', () => {
    const before = snapshots(), versions = MAPS.map(kind => s.textures[kind].version);
    s.lightAngle = 170; s.camera.position.x += 2; s.updateMaterial(); s.composer.render();
    MAPS.forEach((kind, i) => expect(same(before[i].data, s.processed[kind].data) && s.textures[kind].version === versions[i], 'Lighting changed a map'));
  });
  await check('Pixel grid PNGs match all previews; Original retains source colors and dimensions', async () => {
    for (const processed of [false, true]) {
      const archive = unzipSync(await createArchive(s, processed));
      const meta = JSON.parse(strFromU8(archive['material.json']));
      expect(meta.version === 3 && meta.dither.stage === 'before-lighting' && meta.dither.bakedIntoTextures === processed, 'Wrong export processing contract');
      expect(meta.unitySurfacePixels._Dither === 0, 'Export would enable a second dither pass');
      expect(meta.unitySurfacePixels._TexelsPerPixel === (processed ? 1 : settings.texels), 'Export would sample twice');
      for (const kind of MAPS) {
        const result = await png(archive[`${kind}.png`]), expected = processed ? s.processed[kind] : s.sourceForExport(kind);
        expect(result.width === expected.width && result.height === expected.height && same(result.data, expected.data), `${kind}: PNG differs from ${processed ? 'preview' : 'source'}`);
      }
    }
  });
  await check('Changing settings changes Pixel grid exports but leaves Original PNGs identical', async () => {
    const original = unzipSync(await createArchive(s, false)), processed = unzipSync(await createArchive(s, true));
    s.setProcessing({ levels: 7, dither: .3 });
    const nextOriginal = unzipSync(await createArchive(s, false)), nextProcessed = unzipSync(await createArchive(s, true));
    for (const kind of MAPS) {
      expect(same(original[`${kind}.png`], nextOriginal[`${kind}.png`]), 'Original was color-processed');
      expect(!same(processed[`${kind}.png`], nextProcessed[`${kind}.png`]), 'Pixel grid export ignored settings');
    }
  });
  await check('Disabled processing exports original values with no baked dither', async () => {
    s.setProcessing({ enabled: false });
    const archive = unzipSync(await createArchive(s, true)), meta = JSON.parse(strFromU8(archive['material.json']));
    expect(!meta.dither.bakedIntoTextures && meta.unitySurfacePixels._TexelsPerPixel === 1, 'Disabled export advertises active processing');
    for (const kind of MAPS) {
      const result = await png(archive[`${kind}.png`]);
      expect(result.width === s.maps[kind].width && same(result.data, s.maps[kind].data), 'Disabled export modified source pixels');
    }
    s.setProcessing(settings);
  });
  await check('Project round-trip restores editable sources and regenerates the exact processed maps', async () => {
    const saved = await decodeProject(await encodeProject(captureProject(s))), expected = snapshots();
    s.newProject(); restoreProject(s, saved);
    MAPS.forEach((kind, i) => {
      expect(same(source[i].data, s.maps[kind].data), 'Saved project baked the source');
      expect(same(expected[i].data, s.processed[kind].data), 'Reopened preview changed');
    });
    s.setProcessing({ enabled: false });
    MAPS.forEach((kind, i) => expect(same(source[i].data, s.processed[kind].data), 'Reopened source cannot be recovered'));
  });
  target.dispose(); geometry.dispose();
}
void run().catch(error => tests.push({ name: 'Texture processing suite', pass: false, detail: String(error) })).finally(() => {
  s.dispose(); reportResults({ suite: 'texture-processing', tests });
});
