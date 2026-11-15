import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ProjectedStroke } from '../src/projection.ts';
import { StrokeVisibility } from '../src/stroke-visibility.ts';
import { blankMap, copyPixels } from '../src/maps.ts';
import { ReferenceStroke } from './fixtures/reference-stroke.ts';
import type { Brush } from '../src/projection.ts';

const brush: Brush = { tool: 'brush', size: 128, color: '#bb397f', value: 0.6, opacity: 0.4, hardness: 0.65 };
function fixture() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  for (const group of mesh.geometry.groups) group.materialIndex = 0;
  mesh.rotation.y = 0.2;
  mesh.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.01, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { meshes: [mesh], camera };
}
function paint(stroke: ProjectedStroke | ReferenceStroke, settings = brush, grayscale = false) {
  for (let i = 0; i < 8; i++) stroke.dab(125 + i * 10, 120 + Math.sin(i) * 25, settings, grayscale);
}

test('successive strokes reuse surface samples but keep paint, alpha and coverage independent', t => {
  const { meshes, camera } = fixture();
  const actual = blankMap('diffuse', 63, 47), expected = copyPixels(actual);
  const first = new ProjectedStroke(actual, meshes, camera, 320, 240);
  paint(first);
  paint(new ReferenceStroke(expected, meshes, camera, 320, 240));
  let calls = 0;
  const visible = StrokeVisibility.prototype.visible;
  t.mock.method(StrokeVisibility.prototype, 'visible', function (...args: Parameters<typeof visible>) {
    calls++;
    return visible.apply(this, args);
  });
  const second = new ProjectedStroke(actual, meshes, camera, 320, 240, first.projection);
  assert.equal(second.projection, first.projection);
  assert.notEqual(second.coverage, first.coverage);
  assert.ok(second.coverage.every(value => value === 0));
  assert.deepEqual(second.base, expected.data);
  const settings = { ...brush, color: '#27a5ee' };
  paint(second, settings);
  paint(new ReferenceStroke(expected, meshes, camera, 320, 240), settings);
  assert.equal(calls, 0, 'Second stroke repeated visibility checks for the same surface');
  assert.deepEqual(actual.data, expected.data);
  const mask = blankMap('spec', 63, 47), expectedMask = copyPixels(mask);
  const third = new ProjectedStroke(mask, meshes, camera, 320, 240, second.projection);
  assert.equal(third.projection, second.projection, 'Same-size maps should share surface samples');
  paint(third, brush, true);
  paint(new ReferenceStroke(expectedMask, meshes, camera, 320, 240), brush, true);
  assert.deepEqual(mask.data, expectedMask.data);
});

test('projection reuse invalidates on camera, viewport, map and mesh changes', () => {
  const changes: [string, (f: ReturnType<typeof fixture>, dims: number[]) => void][] = [
    ['camera position', f => { f.camera.position.x += 0.4; }],
    ['camera projection', f => { f.camera.fov = 65; f.camera.updateProjectionMatrix(); }],
    ['viewport', (_, dims) => { dims[0] = 330; }],
    ['map size', (_, dims) => { dims[2] = 67; }],
    ['mesh transform', f => { f.meshes[0].position.x += 0.2; }],
    ['parent transform', f => { const group = new THREE.Group(); group.add(f.meshes[0]); group.rotation.z = 0.3; }],
    ['position update', f => { const p = f.meshes[0].geometry.getAttribute('position'); p.setX(0, -0.2); p.needsUpdate = true; }],
    ['UV update', f => { const uv = f.meshes[0].geometry.getAttribute('uv'); uv.setX(0, 0.3); uv.needsUpdate = true; }],
    ['UV replacement', f => { const g = f.meshes[0].geometry; const uv = g.getAttribute('uv').clone(); uv.setX(0, 0.7); g.setAttribute('uv', uv); }],
    ['index update', f => { const i = f.meshes[0].geometry.index!; i.setX(0, 1); i.needsUpdate = true; }],
    ['index replacement', f => { const g = f.meshes[0].geometry; g.setIndex(g.index!.clone()); }],
    ['geometry replacement', f => { f.meshes[0].geometry = new THREE.PlaneGeometry(2, 2); }],
    ['model replacement', f => { f.meshes[0] = f.meshes[0].clone(); }],
    ['layers', f => { f.meshes[0].layers.set(1); }],
    ['material side', f => { f.meshes[0].material.side = THREE.BackSide; }],
    ['material array', f => { Reflect.set(f.meshes[0], 'material', [f.meshes[0].material]); }],
    ['draw range', f => { f.meshes[0].geometry.setDrawRange(0, 6); }],
    ['groups', f => { f.meshes[0].geometry.groups[0].count = 3; }],
  ];
  for (const [name, change] of changes) {
    const f = fixture(), dims = [320, 240, 63, 47];
    const original = new ProjectedStroke(blankMap('diffuse', 63, 47), f.meshes, f.camera, 320, 240);
    paint(original);
    change(f, dims);
    const actual = blankMap('diffuse', dims[2], dims[3]), expected = copyPixels(actual);
    const next = new ProjectedStroke(actual, f.meshes, f.camera, dims[0], dims[1], original.projection);
    assert.notEqual(next.projection, original.projection, name);
    paint(next);
    paint(new ReferenceStroke(expected, f.meshes, f.camera, dims[0], dims[1]));
    assert.deepEqual(actual.data, expected.data, name);
  }
});

test('deformed meshes rebuild samples between strokes', () => {
  const { meshes, camera } = fixture(), mesh = meshes[0];
  const morph = mesh.geometry.getAttribute('position').clone();
  for (let i = 0; i < morph.count; i++) morph.setX(i, morph.getX(i) + 0.5);
  mesh.geometry.morphAttributes.position = [morph];
  mesh.updateMorphTargets();
  const original = new ProjectedStroke(blankMap('diffuse', 63, 47), meshes, camera, 320, 240);
  paint(original);
  mesh.morphTargetInfluences![0] = 1;
  const actual = blankMap('diffuse', 63, 47), expected = copyPixels(actual);
  const next = new ProjectedStroke(actual, meshes, camera, 320, 240, original.projection);
  assert.notEqual(next.projection, original.projection);
  paint(next);
  paint(new ReferenceStroke(expected, meshes, camera, 320, 240));
  assert.deepEqual(actual.data, expected.data);
});

test('block skipping preserves partial rows and changing opacity, including Float32 rounding', () => {
  const { meshes, camera } = fixture();
  for (const width of [15, 16, 17, 31, 33]) {
    const actual = blankMap('diffuse', width, 47), expected = copyPixels(actual);
    const fast = new ProjectedStroke(actual, meshes, camera, 320, 240);
    const reference = new ReferenceStroke(expected, meshes, camera, 320, 240);
    for (const opacity of [0.4, 0.7, 0.3, 0.7, 1, 0, 1]) {
      const settings = { ...brush, opacity, color: opacity === 0.7 ? '#22b994' : '#b94c55' };
      paint(fast, settings);
      paint(reference, settings);
      assert.deepEqual(actual.data, expected.data, `width ${width}, opacity ${opacity}`);
    }
  }
});

test('cached ray intersections handle axis-aligned rays and changing origins', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(100000, -100000, 100000);
  mesh.updateMatrixWorld();
  const visibility = new StrokeVisibility([mesh]);
  for (const offset of [new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1, 1, 5), new THREE.Vector3(5, 0, 0)]) {
    const origin = mesh.position.clone().add(offset);
    for (const direction of [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
      const ray = new THREE.Raycaster(origin, direction);
      const distance = ray.intersectObject(mesh)[0]?.distance ?? Infinity;
      assert.equal(visibility.distance(ray.ray), distance);
      for (const target of [0, 1, 5, 10]) {
        assert.equal(visibility.visible(ray.ray, target), Number.isFinite(distance) && target <= distance + Math.max(1e-6, target * 1e-6));
      }
    }
  }
});

test('painting remains exact when the surface sample cache is full', () => {
  const { meshes, camera } = fixture();
  const original = new ProjectedStroke(blankMap('diffuse', 63, 47), meshes, camera, 320, 240);
  original.dab(125, 120, { ...brush, size: 16 }, false);
  const tiles = original.projection.sampleTiles;
  const tile = tiles.values().next().value!;
  assert.ok(tile, 'Fixture did not cache a surface sample');
  // Occupy cache slots without allocating tens of MiB in a unit test. Negative
  // keys cannot collide with real surface tiles; their contents are never read.
  for (let i = 1; i <= 6000; i++) tiles.set(-i, tile);
  const actual = blankMap('diffuse', 63, 47), expected = copyPixels(actual);
  const stroke = new ProjectedStroke(actual, meshes, camera, 320, 240, original.projection);
  paint(stroke);
  paint(new ReferenceStroke(expected, meshes, camera, 320, 240));
  assert.deepEqual(actual.data, expected.data);
});
