import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankMap, processMap } from '../src/maps.ts';

const settings = { enabled: true, texels: 1, levels: 4, dither: 1 };
test('four-level Bayer spreads midgray between adjacent levels with a balanced average', () => {
  const source = blankMap('spec', 8, 8);
  for (let i = 0; i < source.data.length; i += 4) source.data.set([128, 128, 128, i % 256], i);
  const before = source.data.slice();
  const result = processMap(source, 8, 8, settings);
  const red = result.data.filter((_, i) => i % 4 === 0);
  assert.equal(red.filter(v => v === 85).length, 32);
  assert.equal(red.filter(v => v === 170).length, 32);
  assert.equal(red.reduce((sum, v) => sum + v, 0) / 64, 127.5);
  assert.deepEqual(Array.from(red.slice(0, 8)), [85, 170, 85, 170, 85, 170, 85, 170]);
  for (let i = 0; i < result.data.length; i += 4) {
    assert.equal(result.data[i], result.data[i + 1]);
    assert.equal(result.data[i], result.data[i + 2]);
    assert.equal(result.data[i + 3], before[i + 3]);
  }
  assert.deepEqual(source.data, before);
});

test('zero dither still limits levels; black and white remain exact at every Bayer cell', () => {
  for (const levels of [2, 3, 4, 11, 255, 256]) {
    const source = blankMap('diffuse', 8, 8);
    for (let i = 0; i < source.data.length; i += 4) source.data.set([0, 128, 255, 71], i);
    for (const dither of [0, .3, 1]) {
      const result = processMap(source, 8, 8, { ...settings, levels, dither });
      for (let i = 0; i < result.data.length; i += 4) {
        assert.equal(result.data[i], 0);
        assert.equal(result.data[i + 2], 255);
        assert.equal(result.data[i + 3], 71);
        if (levels === 256) assert.equal(result.data[i + 1], 128);
        if (levels === 2 && dither === 0) assert.equal(result.data[i + 1], 255);
      }
    }
  }
});

test('Bayer uses output grid coordinates for differently sized maps; disabling is lossless', () => {
  const small = blankMap('spec', 8, 8), large = blankMap('glow', 32, 16);
  for (const map of [small, large]) for (let i = 0; i < map.data.length; i += 4) map.data.set([128, 128, 128, 255], i);
  assert.deepEqual(processMap(small, 16, 16, { ...settings, texels: 2 }), processMap(large, 16, 16, { ...settings, texels: 2 }));
  const disabled = processMap(large, 16, 16, { ...settings, enabled: false, texels: 8 });
  assert.deepEqual(disabled, large);
  assert.notEqual(disabled.data, large.data);
});
