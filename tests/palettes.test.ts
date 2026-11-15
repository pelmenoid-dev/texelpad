import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDiffusePalette } from '../src/palettes.ts';
import type { Pixels } from '../src/maps.ts';
function pixels(rows: number[][]): Pixels {
  return {
    width: rows.length,
    height: 1,
    data: new Uint8ClampedArray(rows.flat())
  };
}
test('palette extraction ignores invisible RGB and leaves all source bytes intact', () => {
  const p = pixels([[255, 0, 255, 0], [255, 0, 255, 0], [30, 70, 120, 255], [220, 180, 40, 128]]),
    before = p.data.slice();
  assert.deepEqual(new Set(extractDiffusePalette(p)), new Set(['#1e4678', '#dcb428']));
  assert.deepEqual(p.data, before);
  assert.deepEqual(extractDiffusePalette(pixels([[100, 80, 255, 0]])), []);
});
test('flat fills and nearby shades produce a compact palette of real colors', () => {
  assert.deepEqual(extractDiffusePalette(pixels([[123, 45, 67, 255], [123, 45, 67, 255]])), ['#7b2d43']);
  const rows = [[96, 96, 96, 255], [100, 100, 100, 255], [103, 103, 103, 255], [250, 240, 10, 255]],
    result = extractDiffusePalette(pixels(rows));
  assert.equal(result.length, 2);
  assert.ok(result.includes('#faf00a'));
  assert.ok(result.some(c => ['#606060', '#646464', '#676767'].includes(c)));
});
test('coverage includes alpha, so faint fringe pixels do not displace an opaque fill', () => {
  const rows = [...Array.from({
    length: 100
  }, () => [96, 96, 96, 1]), [104, 104, 104, 255]];
  assert.deepEqual(extractDiffusePalette(pixels(rows)), ['#686868']);
});
test('small accents survive alongside a broad ramp without exceeding eleven colors', () => {
  const rows: number[][] = [];
  for (let shade = 40; shade <= 220; shade += 5) for (let n = 0; n < 40; n++) rows.push([shade, shade, shade, 255]);
  for (let n = 0; n < 12; n++) rows.push([220, 35, 45, 255], [20, 160, 220, 255]);
  const result = extractDiffusePalette(pixels(rows));
  assert.ok(result.includes('#dc232d') && result.includes('#14a0dc'));
  assert.ok(result.length <= 11 && result.length > 2);
  assert.equal(new Set(result).size, result.length);
  assert.deepEqual(extractDiffusePalette(pixels(rows.toReversed())), result);
});
test('a colorful image yields eleven deterministic source colors', () => {
  const rows: number[][] = [];
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) rows.push([r, g, b, 255]);
  const p = pixels(rows),
    result = extractDiffusePalette(p),
    source = new Set(rows.map(([r, g, b]) => '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0')));
  assert.equal(result.length, 11);
  assert.equal(new Set(result).size, 11);
  assert.ok(result.every(c => source.has(c)));
  assert.deepEqual(extractDiffusePalette(p), result);
});
