import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankMap } from '../src/maps.ts';
import { TextureStroke, textureRect } from '../src/texture-stroke.ts';
import type { Brush } from '../src/projection.ts';
const brush: Brush = { tool: 'pencil', size: 20, opacity: .5, hardness: .65, color: '#ff0000', value: .8 };
function dab(s: TextureStroke, x: number, y: number, b = brush, mask = false) {
  for (const _ of s.dabSteps(x, y, b, mask)) { /* Complete a dab. */ }
}
test('direct painting respects letterboxing, source resolution and top-left orientation', () => {
  const rect = textureRect(200, 200, 400, 200);
  assert.deepEqual(rect, { left: 0, top: 50, width: 200, height: 100 });
  const p = blankMap('diffuse', 400, 200), s = new TextureStroke(p, rect);
  dab(s, 100, 20);
  assert.equal(s.changed, false);
  dab(s, 10, 60, { ...brush, opacity: 1 });
  assert.deepEqual([...p.data.slice((20 * 400 + 20) * 4, (20 * 400 + 20) * 4 + 4)], [255, 0, 0, 255]);
  assert.equal(p.data[(180 * 400 + 20) * 4], 212, 'Y axis was inverted');
});
test('direct painting applies opacity once per stroke and erases diffuse alpha or mask intensity', () => {
  for (const mask of [false, true]) {
    const p = blankMap('diffuse', 20, 20), rect = textureRect(20, 20, 20, 20), s = new TextureStroke(p, rect);
    dab(s, 10, 10, brush, mask);
    const once = p.data.slice();
    dab(s, 10, 10, brush, mask);
    assert.deepEqual(p.data, once);
    const erase = new TextureStroke(p, rect);
    dab(erase, 10, 10, { ...brush, tool: 'eraser', opacity: 1 }, mask);
    const i = (10 * 20 + 10) * 4;
    assert.deepEqual([...p.data.slice(i, i + 4)], mask ? [0, 0, 0, 255] : [...once.slice(i, i + 3), 0]);
  }
});
