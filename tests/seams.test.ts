import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blankMap, processMap } from '../src/maps.ts';
import { ProjectedStroke } from '../src/projection.ts';
import { buildUvPadding, padUvGutters, texelWeights } from '../src/uv-padding.ts';
import { paintCorner } from './fixtures/paint-corner.ts';
const settings = {
  enabled: true,
  texels: 8,
  dither: .3,
  levels: 256
};
const brush = {
  tool: 'pencil' as const,
  size: 500,
  opacity: 1,
  color: '#ff0000',
  value: 1,
  hardness: 1
};
test('UV coverage uses the square texel footprint and an interior sample at seams', () => {
  assert.equal(texelWeights(0, 0, [{ x: .6, y: -.1 }, { x: 1, y: 0 }, { x: .6, y: .1 }]), null);
  const t = [{ x: .3, y: -.8 }, { x: 1, y: 0 }, { x: .3, y: .8 }] as const;
  const weights = texelWeights(0, 0, [...t])!;
  assert.ok(weights.every(w => w > 0), 'Visibility sample still sits on a triangle edge');
  const x = weights.reduce((sum, w, i) => sum + w * t[i].x, 0);
  const y = weights.reduce((sum, w, i) => sum + w * t[i].y, 0);
  assert.ok(x < .5 && x > .3 && Math.abs(y) < .5);
});
test('concave seams remain painted with native, coarse and fractional grids', () => {
  const { meshes, camera } = paintCorner(), p = blankMap('diffuse', 128, 128);
  new ProjectedStroke(p, meshes, camera, 400, 400).dab(200, 200, { ...brush, size: 2000 }, false);
  const padding = buildUvPadding(meshes, 128, 128), ray = new THREE.Raycaster();
  for (const texels of [1, 4, 8, 17.3]) {
    const out = processMap(p, 128, 128, { ...settings, texels }, padding);
    let checked = 0;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
      ray.setFromCamera(new THREE.Vector2((x + .5) / 100 - 1, 1 - (y + .5) / 100), camera);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit?.uv) continue;
      checked++;
      assert.equal(sample(out, hit.uv.x, hit.uv.y), 255, `Paint gap at ${x},${y}, grid ${texels}`);
    }
    assert.ok(checked > 10000);
  }
});
function fixture() {
  const geometry = new THREE.PlaneGeometry(2, 2),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i),
      v = uv.getY(i);
    uv.setXY(i, .12 + .35 * u + .09 * v, .14 + .06 * u + .29 * v);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide
  }));
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  mesh.updateMatrixWorld();
  return {
    mesh,
    camera
  };
}
function sample(p: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}, u: number, v: number) {
  return p.data[(Math.min(p.height - 1, Math.floor((1 - v) * p.height)) * p.width + Math.min(p.width - 1, Math.floor(u * p.width))) * 4];
}
for (const texels of [1, 8, 17.3]) test(`a fully painted slanted UV island has no unpainted edge at ${texels} texels per pixel`, () => {
  const {
      mesh,
      camera
    } = fixture(),
    p = blankMap('diffuse', 128, 128);
  const stroke = new ProjectedStroke(p, [mesh], camera, 400, 400);
  stroke.dab(200, 200, brush, false);
  const processed = processMap(p, p.width, p.height, {
    ...settings,
    texels
  }, buildUvPadding([mesh], p.width, p.height));
  let missing = 0;
  for (let edge = 0; edge < 4; edge++) for (let n = 0; n <= 100; n++) {
    const t = n / 100,
      u = edge === 0 ? .001 : edge === 1 ? .999 : t,
      v = edge === 2 ? .001 : edge === 3 ? .999 : t;
    if (sample(processed, .12 + .35 * u + .09 * v, .14 + .06 * u + .29 * v) !== 255) missing++;
  }
  assert.equal(missing, 0, `${missing} visible boundary samples still show the unpainted base`);
});
test('grazing surfaces are painted without screen-ray rounding gaps', () => {
  const {
      mesh,
      camera
    } = fixture(),
    p = blankMap('diffuse', 128, 128);
  mesh.rotation.y = 1.38;
  mesh.updateMatrixWorld();
  new ProjectedStroke(p, [mesh], camera, 400, 400).dab(200, 200, brush, false);
  for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) assert.equal(sample(p, .12 + .35 * x / 20 + .09 * y / 20, .14 + .06 * x / 20 + .29 * y / 20), 255);
});
test('exact visibility prevents painting a nearby hidden surface', () => {
  const {
      mesh: front,
      camera
    } = fixture(),
    {
      mesh: back
    } = fixture(),
    p = blankMap('diffuse', 128, 128);
  const uv = back.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + .43);
  back.position.z = -.001;
  back.updateMatrixWorld();
  new ProjectedStroke(p, [front, back], camera, 400, 400).dab(200, 200, brush, false);
  assert.equal(sample(p, .34, .3), 255);
  assert.equal(sample(p, .77, .3), 212);
});
test('padding preserves island contents, erased alpha and the original buffers', () => {
  const {
      mesh
    } = fixture(),
    p = blankMap('diffuse', 128, 128),
    layout = buildUvPadding([mesh], 128, 128);
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = i % 251;
    p.data[i + 3] = i / 4 % 3 ? 255 : 0;
  }
  const before = p.data.slice(),
    out = padUvGutters(p, layout, 16, 16);
  assert.deepEqual(p.data, before);
  for (let i = 0; i < layout.nearest.length; i++) if (layout.nearest[i] === i + 1) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), p.data.slice(i * 4, i * 4 + 4));
  assert.ok(out.data.some((v, i) => v !== p.data[i]), 'Gutter did not extend');
});
test('padding respects separate islands and unequal texture dimensions', () => {
  const {
      mesh: a
    } = fixture(),
    {
      mesh: b
    } = fixture(),
    p = blankMap('glow', 256, 64);
  const uv = b.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + .43);
  const layout = buildUvPadding([a, b], 256, 64);
  for (let i = 0; i < layout.nearest.length; i++) if (layout.nearest[i] === i + 1) {
    p.data[i * 4] = i % 256 < 140 ? 30 : 240;
    p.data[i * 4 + 3] = 71;
  }
  const out = padUvGutters(p, layout, 16, 16);
  assert.equal(sample(out, .34, .3), 30);
  assert.equal(sample(out, .77, .3), 240);
  for (let i = 0; i < layout.nearest.length; i++) if (layout.nearest[i] === i + 1) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), p.data.slice(i * 4, i * 4 + 4));
});
test('UV padding works on an island smaller than one texel and ignores degenerate UVs', () => {
  const {
      mesh
    } = fixture(),
    p = blankMap('diffuse', 16, 16),
    uv = mesh.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, .311 + uv.getX(i) * .01, .274 + uv.getY(i) * .01);
  const layout = buildUvPadding([mesh], 16, 16);
  assert.ok(layout.nearest.some(v => v > 0));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0);
  const empty = buildUvPadding([mesh], 16, 16);
  assert.ok(empty.nearest.every(v => v === 0));
  assert.deepEqual(padUvGutters(p, empty, 4, 4), p);
});
