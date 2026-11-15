import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StrokeVisibility } from '../src/stroke-visibility.ts';
import { ProjectedStroke } from '../src/projection.ts';
import type { Brush } from '../src/projection.ts';
import { blankMap, copyPixels } from '../src/maps.ts';
import { ReferenceStroke } from './fixtures/reference-stroke.ts';

const brush: Brush = { tool: 'brush', size: 128, color: '#b23d78', value: 0.35, opacity: 0.4, hardness: 0.35 };

function camera() {
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.01, 100);
  camera.position.set(0.4, 0.2, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

test('visibility BVH matches Three rays for mirrored meshes, material sides and draw ranges', () => {
  const meshes = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map((side, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ side }));
    mesh.position.set(i - 1, 0, -i * 0.2);
    mesh.rotation.set(0.1 * i, 0.3, 0.2);
    mesh.scale.set(i === 1 ? -1 : 1, 0.8, 1.2);
    mesh.updateMatrixWorld();
    return mesh;
  });
  meshes[0].geometry.setDrawRange(3, 21);
  const grouped = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), [
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  ]);
  for (const group of grouped.geometry.groups) group.materialIndex = (group.materialIndex ?? 0) % 2;
  grouped.position.set(0, 0.7, 0.3);
  grouped.updateMatrixWorld();
  const objects: THREE.Mesh[] = [...meshes, grouped];
  const visibility = new StrokeVisibility(objects);
  for (const origin of [new THREE.Vector3(0.2, 0.3, 4), new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, 0)]) {
    for (let y = -5; y <= 5; y++) for (let x = -8; x <= 8; x++) {
      const direction = new THREE.Vector3(x / 5, y / 5, -0.2).sub(origin).normalize();
      const ray = new THREE.Raycaster(origin, direction);
      const expected = ray.intersectObjects(objects, false)[0]?.distance ?? Infinity;
      const actual = visibility.distance(ray.ray);
      assert.ok(actual === expected || Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
      for (const distance of [0.5, 2, 5, 20]) {
        const visible = Number.isFinite(expected) && distance <= expected + Math.max(1e-6, distance * 1e-6);
        assert.equal(visibility.visible(ray.ray, distance), visible, 'Early occlusion changed visibility');
      }
    }
  }
});

test('overlapping hidden UV faces retain their own cached surface samples', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), material);
  const uv = front.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5);
  const back = [0.1, 0.2].map(depth => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.position.z = -depth;
    mesh.updateMatrixWorld();
    return mesh;
  });
  front.updateMatrixWorld();
  const pixels = blankMap('diffuse', 96, 64), before = pixels.data.slice();
  const stroke = new ProjectedStroke(pixels, [front, ...back], camera(), 320, 240);
  const original = StrokeVisibility.prototype.visible;
  let checks = 0;
  StrokeVisibility.prototype.visible = function (...args) { checks++; return original.apply(this, args); };
  try {
    const sweep = () => { for (let x = 130; x <= 190; x += 8) stroke.dab(x, 120, { ...brush, size: 40 }, false); };
    sweep();
    assert.ok(checks > 0, 'Fixture did not reach the hidden faces');
    checks = 0;
    sweep();
    assert.equal(checks, 0, 'Overlapping faces evicted each other between dabs');
    assert.deepEqual(pixels.data, before, 'Paint reached a hidden surface');
  } finally { StrokeVisibility.prototype.visible = original; }
});

test('row scanning preserves thin diagonal UVs and fractional texel edges', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -0.8, 0, 1, -0.4, -1, 0.2, 1, 0.2], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0.05, 0.05, 0.96, 0.94, 0.97, 0.93], 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  for (const tool of ['brush', 'pencil'] as const) {
    const expected = blankMap('diffuse', 127, 63), actual = copyPixels(expected), view = camera();
    const fast = new ProjectedStroke(actual, [mesh], view, 320, 240);
    const reference = new ReferenceStroke(expected, [mesh], view, 320, 240);
    for (let i = 0; i < 30; i++) {
      const x = 105 + i * 4.2, y = 120 + Math.sin(i * 0.6) * 45;
      const settings = { ...brush, tool, size: 40 };
      fast.dab(x, y, settings, false);
      reference.dab(x, y, settings, false);
    }
    assert.ok(fast.changed, 'Fixture did not paint');
    assert.deepEqual(actual.data, expected.data);
  }
});

for (const tool of ['pencil', 'brush', 'eraser'] as const) {
  for (const grayscale of [false, true]) {
    test(`${tool} ${grayscale ? 'mask' : 'diffuse'} keeps exact pixels across overlapping UVs and repeated fast dabs`, () => {
      const front = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 0.4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      front.rotation.y = 0.35;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      back.position.z = -0.3;
      for (const mesh of [front, back]) mesh.updateMatrixWorld();
      const source = blankMap('diffuse', 96, 64);
      for (let i = 0; i < source.data.length; i++) source.data[i] = (i * 37 + 91) % 256;
      const actual = copyPixels(source), expected = copyPixels(source), view = camera();
      const fast = new ProjectedStroke(actual, [front, back], view, 320, 240);
      const reference = new ReferenceStroke(expected, [front, back], view, 320, 240);
      for (let i = 0; i < 20; i++) {
        const x = 160 + Math.sin(i * 0.4) * 65, y = 120 + Math.cos(i * 0.6) * 50;
        fast.dab(x, y, { ...brush, tool }, grayscale);
        reference.dab(x, y, { ...brush, tool }, grayscale);
        assert.deepEqual(actual.data, expected.data, `Dab ${i} differs`);
      }
    });
  }
}

test('dense-mesh painting reduces exact triangle tests without changing the stroke', () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const original = THREE.Ray.prototype.intersectTriangle;
  const accelerated = Reflect.get(StrokeVisibility.prototype, 'intersectTriangle');
  let calls = 0;
  THREE.Ray.prototype.intersectTriangle = function (...args) { calls++; return original.apply(this, args); };
  Reflect.set(StrokeVisibility.prototype, 'intersectTriangle', function (...args: unknown[]) { calls++; return accelerated.apply(this, args); });
  try {
    const expected = blankMap('diffuse', 64, 64), actual = copyPixels(expected), view = camera();
    const reference = new ReferenceStroke(expected, [mesh], view, 320, 240);
    reference.dab(160, 120, brush, false);
    reference.dab(165, 125, brush, false);
    const before = calls;
    calls = 0;
    const fast = new ProjectedStroke(actual, [mesh], view, 320, 240);
    fast.dab(160, 120, brush, false);
    fast.dab(165, 125, brush, false);
    assert.deepEqual(actual.data, expected.data);
    assert.ok(before > 100_000, 'Dense fixture did not exercise ray visibility');
    assert.ok(calls > 0 && calls < before / 10, `${calls} triangle checks; previously ${before}`);
  } finally {
    THREE.Ray.prototype.intersectTriangle = original;
    Reflect.set(StrokeVisibility.prototype, 'intersectTriangle', accelerated);
  }
});
