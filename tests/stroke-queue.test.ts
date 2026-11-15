import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ProjectedStroke } from '../src/projection.ts';
import type { Brush } from '../src/projection.ts';
import { StrokeQueue } from '../src/stroke-queue.ts';
import { blankMap, copyPixels } from '../src/maps.ts';
import { ReferenceStroke } from './fixtures/reference-stroke.ts';

const brush: Brush = { tool: 'brush', size: 40, color: '#b23d78', value: 0.35, opacity: 0.4, hardness: 0.35 };

function fixture(grayscale = false, size = 96) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.rotation.y = 0.35;
  mesh.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.01, 100);
  camera.position.set(0.4, 0.2, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const expected = blankMap(grayscale ? 'spec' : 'diffuse', size, size);
  const actual = copyPixels(expected);
  const stroke = new ProjectedStroke(actual, [mesh], camera, 320, 240);
  const queue = new StrokeQueue(stroke, grayscale);
  const reference = new ReferenceStroke(expected, [mesh], camera, 320, 240);
  let last: THREE.Vector2 | undefined;
  const add = (x: number, y: number, settings: Brush) => {
    queue.add(x, y, settings);
    const point = new THREE.Vector2(x, y), from = last ?? point;
    const steps = Math.max(1, Math.ceil(from.distanceTo(point) / Math.max(1, settings.size * .2)));
    for (let i = 1; i <= steps; i++) {
      const p = from.clone().lerp(point, i / steps);
      reference.dab(p.x, p.y, settings, grayscale);
    }
    last = point;
  };
  return { actual, expected, stroke, queue, add };
}

for (const tool of ['pencil', 'brush', 'eraser'] as const) {
  for (const grayscale of [false, true]) {
    test(`queued ${tool} ${grayscale ? 'mask' : 'diffuse'} preserves rapid input and brush snapshots`, t => {
      const f = fixture(grayscale);
      const before = f.actual.data.slice();
      const settings = { ...brush, tool };
      for (let i = 0; i < 20; i++) {
        settings.size = i % 3 === 0 ? 128 : 40;
        settings.opacity = 0.2 + i / 30;
        settings.color = i < 10 ? '#ff571a' : '#69bcfa';
        settings.value = i / 20;
        f.add(160 + Math.sin(i * 0.7) * 85, 120 + Math.cos(i * 0.9) * 65, settings);
      }
      // Later control changes cannot rewrite already recorded input.
      Object.assign(settings, { opacity: 0, size: 1, color: '#000000', value: 0 });
      assert.deepEqual(f.actual.data, before, 'Input handlers painted synchronously');
      let ticks = 0;
      t.mock.method(performance, 'now', () => ++ticks);
      assert.equal(f.queue.advance(0), false);
      assert.ok(f.queue.pending);
      let slices = 0, changed = false;
      while (f.queue.pending) {
        changed = f.queue.advance(ticks + 3) || changed;
        assert.ok(++slices < 20000, 'Queue stopped making progress');
      }
      assert.ok(slices > 1 && changed && f.stroke.changed, 'Fixture did not exercise sliced painting');
      assert.deepEqual(f.actual.data, f.expected.data);
      assert.equal(f.queue.advance(), false, 'Empty queue repainted a sample');
    });
  }
}

test('a partially painted dab can be drained immediately without losing pixels', t => {
  const f = fixture(false, 256);
  f.add(160, 120, { ...brush, size: 128 });
  let ticks = 0;
  t.mock.method(performance, 'now', () => ++ticks);
  let changed = false, slices = 0;
  while (!changed && f.queue.pending) {
    changed = f.queue.advance(ticks + 2);
    assert.ok(++slices < 10000);
  }
  assert.ok(changed && f.queue.pending, 'Fixture must pause inside a changed dab');
  assert.notDeepEqual(f.actual.data, f.expected.data);
  f.queue.advance();
  assert.equal(f.queue.pending, false);
  assert.deepEqual(f.actual.data, f.expected.data);
});

test('long strokes release consumed input and keep continuity after the queue empties', t => {
  const f = fixture(false, 24);
  const settings = { ...brush, size: 128 };
  for (let i = 0; i < 600; i++) f.add(110 + i % 60, 110, settings);
  let ticks = 0;
  t.mock.method(performance, 'now', () => ++ticks);
  f.queue.advance(1100);
  assert.ok(f.queue.pending, 'Fixture should retain unprocessed input');
  f.add(230, 150, { ...settings, opacity: 0.8 });
  f.queue.advance();
  assert.deepEqual(f.actual.data, f.expected.data);
  f.add(100, 100, { ...settings, opacity: 0.9 });
  f.queue.advance();
  assert.equal(f.queue.pending, false);
  assert.deepEqual(f.actual.data, f.expected.data);
});
