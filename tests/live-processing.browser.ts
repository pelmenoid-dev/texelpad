import { reportResults } from './browser-report';
import { seedTestModel } from './fixtures/demo';
import * as THREE from 'three';
import { Studio } from '../src/studio';
import { MAPS, blankMap, canvasOf, copyPixels } from '../src/maps';
import { ProjectedStroke } from '../src/projection';

// Integration regression: compare actual GPU sampling after each edit against a
// freshly uploaded reference. Checking CPU dimensions or texture bindings alone
// cannot detect stale immutable WebGL storage.
const output = document.querySelector('#results')!;
const results: {
  name: string;
  pass: boolean;
  detail?: string;
}[] = [];
const s = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});
seedTestModel(s);
const geometry = new THREE.PlaneGeometry(2, 2);
const probeMaterial = new THREE.RawShaderMaterial({
  uniforms: {
    image: {
      value: null
    }
  },
  depthTest: false,
  depthWrite: false,
  vertexShader: 'precision highp float; attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
  fragmentShader: 'precision highp float; uniform sampler2D image; varying vec2 vUv; void main(){gl_FragColor=texture2D(image,vUv);}'
});
const probeScene = new THREE.Scene();
probeScene.add(new THREE.Mesh(geometry, probeMaterial));
const probeTarget = new THREE.WebGLRenderTarget(64, 64, {
  depthBuffer: false
});
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
function clearErrors(studio = s) {
  const gl = studio.renderer.getContext();
  for (let i = 0; i < 32 && gl.getError() !== gl.NO_ERROR; i++);
}
function sample(studio: Studio, texture: THREE.Texture) {
  const renderer = studio.renderer,
    previous = renderer.getRenderTarget();
  probeMaterial.uniforms.image.value = texture;
  renderer.setRenderTarget(probeTarget);
  renderer.render(probeScene, new THREE.Camera());
  const pixels = new Uint8Array(64 * 64 * 4);
  renderer.readRenderTargetPixels(probeTarget, 0, 0, 64, 64, pixels);
  renderer.setRenderTarget(previous);
  return pixels;
}
function assertGpu(studio = s) {
  const gl = studio.renderer.getContext();
  studio.composer.render();
  expect(gl.getError() === gl.NO_ERROR, 'WebGL error while uploading resized maps');
  expect(studio.material.map === studio.textures.diffuse && studio.material.specularMap === studio.textures.spec && studio.material.emissiveMap === studio.textures.glow, 'Material uses stale texture bindings');
  for (const kind of MAPS) {
    const reference = new THREE.CanvasTexture(canvasOf(studio.processed[kind]));
    reference.minFilter = reference.magFilter = THREE.NearestFilter;
    reference.generateMipmaps = false;
    reference.colorSpace = kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    try {
      const actual = sample(studio, studio.textures[kind]),
        expected = sample(studio, reference);
      let mismatches = 0;
      for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) mismatches++;
      expect(mismatches === 0, `${kind}: ${mismatches}/${actual.length} GPU channels differ from the processed map`);
      expect(gl.getError() === gl.NO_ERROR, `${kind}: WebGL sampling error`);
    } finally {
      reference.dispose();
    }
  }
}
async function check(name: string, fn: () => void | Promise<void>) {
  clearErrors();
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
  output.textContent = results.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? '\n  ' + r.detail : ''}`).join('\n');
}
async function fileOf(width: number, height: number) {
  const p = blankMap('diffuse', width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    p.data[i] = x * 17 % 256;
    p.data[i + 1] = y * 29 % 256;
    p.data[i + 2] = (x + y) * 7 % 256;
    p.data[i + 3] = x < width / 3 ? 64 : 255;
  }
  const blob = await new Promise<Blob>(resolve => canvasOf(p).toBlob(b => resolve(b!), 'image/png'));
  return new File([blob], 'resized-map.png', {
    type: 'image/png'
  });
}
async function run() {
  await check('Initial maps match GPU sampling', () => assertGpu());
  const originals = Object.fromEntries(MAPS.map(k => [k, copyPixels(s.maps[k])]));
  await check('Grid shrink 128 → 32 updates all GPU maps', () => {
    s.setProcessing({
      texels: 16
    });
    assertGpu();
  });
  await check('Grid grow 32 → 512 updates all GPU maps', () => {
    s.setProcessing({
      texels: 1
    });
    assertGpu();
  });
  await check('Fractional grid (73 × 73) updates all GPU maps', () => {
    s.setProcessing({
      texels: 7
    });
    assertGpu();
  });
  await check('Dithering and levels update without resizing', () => {
    s.setProcessing({
      dither: 1,
      levels: 3
    });
    assertGpu();
    s.setProcessing({
      dither: 0
    });
    assertGpu();
  });
  await check('Disable and re-enable pixelation updates GPU sizes', () => {
    s.setProcessing({
      enabled: false
    });
    assertGpu();
    s.setProcessing({
      enabled: true
    });
    assertGpu();
  });
  await check('Processing preserves all original maps', () => {
    for (const k of MAPS) expect(s.maps[k].data.every((v, i) => v === originals[k].data[i]), `${k} source changed`);
  });
  await check('Paint and undo/redo update GPU after a grid change', () => {
    const before = copyPixels(s.maps.diffuse);
    const stroke = new ProjectedStroke(s.maps.diffuse, s.meshes, s.camera, 640, 480);
    stroke.dab(320, 224, {
      ...s.brush,
      size: 100,
      color: '#ff0022'
    }, false);
    expect(stroke.changed, 'Stroke missed the model');
    s.history.push({
      kind: 'diffuse',
      before,
      after: copyPixels(s.maps.diffuse),
      label: 'GPU regression stroke'
    });
    s.refresh('diffuse');
    assertGpu();
    s.undo();
    assertGpu();
    s.redo();
    assertGpu();
  });
  await check('Different source sizes realign every GPU map', async () => {
    await s.loadMap(await fileOf(300, 180), 'diffuse');
    assertGpu();
    await s.loadMap(await fileOf(64, 96), 'spec');
    assertGpu();
  });
  await check('Undo/redo of a resized import keeps GPU maps aligned', () => {
    s.undo();
    assertGpu();
    s.undo();
    assertGpu();
    s.redo();
    assertGpu();
    s.redo();
    assertGpu();
  });
  await check('New fixture after resized imports updates all GPU maps', () => {
    seedTestModel(s);
    assertGpu();
  });
  await check('Repeated grid changes release old GPU textures', () => {
    s.setProcessing({
      texels: 4
    });
    assertGpu();
    const baseline = s.renderer.info.memory.textures;
    for (const texels of [64, 2, 15.7, 3, 8, 1, 4]) {
      s.setProcessing({
        texels
      });
      assertGpu();
    }
    expect(s.renderer.info.memory.textures === baseline, `Texture count grew from ${baseline} to ${s.renderer.info.memory.textures}`);
  });
  await check('Keyboard slider changes the actual live studio grid', async () => {
    const frame = document.createElement('iframe');
    frame.src = '/?qa-frame=1';
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px';
    document.body.append(frame);
    try {
      await new Promise<void>(resolve => frame.onload = () => resolve());
      let studio: Studio | undefined;
      for (let i = 0; i < 100; i++) {
        studio = (frame.contentWindow as Window & {
          __workshop?: Studio;
        }).__workshop;
        if (studio) break;
        await new Promise(r => setTimeout(r, 50));
      }
      expect(studio, 'UI studio did not initialize');
      const slider = frame.contentDocument!.querySelector('[role="slider"][aria-label="Texels per pixel: slider"]');
      expect(slider, 'Grid slider missing');
      slider.dispatchEvent(new (frame.contentWindow as unknown as {
        KeyboardEvent: typeof KeyboardEvent;
      }).KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true
      }));
      await new Promise(r => setTimeout(r, 50));
      expect(studio.processing.texels === 4.1 && studio.processed.diffuse.width === 124, `UI did not change grid: ${studio.processing.texels}`);
      // GPU readback above covers this same production refresh path. Keep this
      // check to UI wiring: Three's buffer instanceof checks are realm-specific.
      expect(studio.material.map?.image.width === 124 && studio.material.specularMap?.image.width === 124 && studio.material.emissiveMap?.image.width === 124, 'Slider did not update all map dimensions');
    } finally {
      frame.remove();
    }
  });
  const report = {
    suite: 'live-pixelation-gpu',
    date: new Date().toISOString(),
    tests: results
  };
  reportResults(report);
  document.title = results.every(r => r.pass) ? 'PASS · Live pixelation' : 'FAIL · Live pixelation';
}
void run().catch(async error => {
  output.textContent = String(error);
  reportResults({
    suite: 'live-pixelation-gpu',
    error: String(error),
    tests: results
  });
});
