import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blankMap, processMap, gridSize, History, copyPixels } from '../src/maps.ts';
import { ProjectedStroke } from '../src/projection.ts';
test('shared grid stays aligned across maps with different resolutions; originals survive', () => {
  const a = blankMap('diffuse', 32, 16),
    b = blankMap('spec', 8, 8),
    before = a.data.slice();
  const settings = {
    enabled: true,
    texels: 3.2,
    dither: .7,
    levels: 8
  };
  const aa = processMap(a, 32, 16, settings),
    bb = processMap(b, 32, 16, settings);
  assert.deepEqual([aa.width, aa.height], [10, 5]);
  assert.deepEqual([bb.width, bb.height], [10, 5]);
  assert.deepEqual(a.data, before);
  assert.deepEqual(gridSize(4, 2, 100), [1, 1]);
});
test('native 256 levels retain color and alpha with any dither strength', () => {
  const p = blankMap('diffuse', 8, 8);
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = p.data[i + 1] = p.data[i + 2] = 128;
    p.data[i + 3] = 71;
  }
  const out = processMap(p, 8, 8, {
    enabled: true,
    texels: 1,
    dither: 1,
    levels: 256
  });
  assert.deepEqual(out.data, p.data);
  const other = processMap(p, 8, 8, {
    enabled: true,
    texels: 1,
    dither: .2,
    levels: 256
  });
  assert.deepEqual(other.data, out.data);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 71);
  const raw = processMap(p, 8, 8, {
    enabled: false,
    texels: 64,
    dither: 1,
    levels: 2
  });
  assert.deepEqual(raw.data, p.data);
  assert.notEqual(raw.data, p.data);
});
test('quantization changes processed colors without changing the source', () => {
  const p = blankMap('diffuse', 2, 2);
  p.data[0] = 123;
  const result = processMap(p, 2, 2, {
    enabled: true,
    texels: 1,
    dither: 0,
    levels: 2
  });
  assert.equal(result.data[0], 0);
  assert.equal(p.data[0], 123);
});
test('history restores map dimensions and clears redo when the edit branches', () => {
  const h = new History(),
    a = blankMap('spec', 16, 16),
    b = blankMap('spec', 32, 16);
  h.push({
    kind: 'spec',
    before: a,
    after: b,
    label: 'load'
  });
  assert.equal(h.undo()?.before.width, 16);
  assert.equal(h.redo()?.after.width, 32);
  h.undo();
  h.push({
    kind: 'glow',
    before: a,
    after: copyPixels(a),
    label: 'stroke'
  });
  assert.equal(h.future.length, 0);
  assert.equal(h.undo()?.kind, 'glow');
});
const camera = () => {
  const c = new THREE.PerspectiveCamera(45, 1, .1, 100);
  c.position.set(0, 0, 5);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
const brush = {
  tool: 'pencil' as const,
  size: 80,
  opacity: 1,
  color: '#ff0000',
  value: 1,
  hardness: 1
};
function plane(x: number, z: number, start: number, end: number) {
  const g = new THREE.PlaneGeometry(1.8, 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, start + uv.getX(i) * (end - start));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide
  }));
  m.position.set(x, 0, z);
  m.updateMatrixWorld();
  return m;
}
test('projection paints both UV islands across a seam without filling the atlas gap', () => {
  const p = blankMap('diffuse', 128, 128),
    meshes = [plane(-.9, 0, 0, .35), plane(.9, 0, .65, 1)];
  const stroke = new ProjectedStroke(p, meshes, camera(), 400, 400);
  stroke.dab(200, 200, brush, false);
  const painted = (x: number) => p.data[(64 * 128 + x) * 4] === 255 && p.data[(64 * 128 + x) * 4 + 1] === 0;
  assert.ok(painted(40));
  assert.ok(painted(86));
  assert.ok(!painted(64));
});
test('projection does not paint a fully occluded second surface', () => {
  const p = blankMap('diffuse', 128, 128),
    front = plane(0, 0, 0, .45),
    back = plane(0, -.8, .55, 1);
  const stroke = new ProjectedStroke(p, [front, back], camera(), 400, 400);
  stroke.dab(200, 200, brush, false);
  let frontCount = 0,
    backCount = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (p.data[(y * 128 + x) * 4] === 255) {
      if (x < 64) frontCount++;else backCount++;
    }
  }
  assert.ok(frontCount > 0);
  assert.equal(backCount, 0);
});
test('opacity is applied once per stroke and eraser preserves RGB under alpha', () => {
  const p = blankMap('diffuse', 64, 64),
    m = plane(0, 0, 0, 1),
    stroke = new ProjectedStroke(p, [m], camera(), 400, 400);
  stroke.dab(200, 200, {
    ...brush,
    opacity: .5
  }, false);
  const after = p.data.slice();
  stroke.dab(200, 200, {
    ...brush,
    opacity: .5
  }, false);
  assert.deepEqual(after, p.data);
  const eraser = new ProjectedStroke(p, [m], camera(), 400, 400);
  eraser.dab(200, 200, {
    ...brush,
    tool: 'eraser'
  }, false);
  const i = (32 * 64 + 32) * 4;
  assert.equal(p.data[i + 3], 0);
  assert.equal(p.data[i], after[i]);
});
