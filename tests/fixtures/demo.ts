import * as THREE from 'three';
import { blankMap, canvasOf, pixelsOf } from '../../src/maps';
import type { MapKind, Pixels } from '../../src/maps';
import type { Studio } from '../../src/studio';
export function seedTestModel(studio: Studio) {
  studio.newProject();
  studio.setModel(demoModel());
  studio.maps = demoMaps();
  studio.modelName = 'Test model';
  studio.refresh();
  studio.frameModel();
  studio.dirty = false;
  studio.changed();
}

// A tiny authored test object: each box face gets a separate atlas tile.
export function demoModel() {
  const group = new THREE.Group();
  group.name = 'Pocket bot';
  let slot = 0;
  const part = (size: number[], position: number[]) => {
    const g = new THREE.BoxGeometry(...(size as [number, number, number]));
    const uv = g.getAttribute('uv');
    for (let face = 0; face < 6; face++) {
      const tile = slot++;
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        uv.setXY(i, (tile % 8 + .06 + uv.getX(i) * .88) / 8, 1 - (Math.floor(tile / 8) + .94 - uv.getY(i) * .88) / 8);
      }
    }
    const mesh = new THREE.Mesh(g);
    mesh.position.set(...(position as [number, number, number]));
    group.add(mesh);
  };
  part([1.65, 1.15, .85], [0, .62, 0]);
  part([1.25, 1, .7], [0, -.52, 0]);
  part([.42, .85, .5], [-.96, -.47, 0]);
  part([.42, .85, .5], [.96, -.47, 0]);
  part([.45, .45, .7], [-.38, -1.25, .1]);
  part([.45, .45, .7], [.38, -1.25, .1]);
  part([.12, .3, .12], [0, 1.35, 0]);
  part([.3, .2, .3], [0, 1.6, 0]);
  return group;
}
export function demoMaps(): Record<MapKind, Pixels> {
  const d = canvasOf(blankMap('diffuse')),
    s = canvasOf(blankMap('spec')),
    g = canvasOf(blankMap('glow'));
  const dc = d.getContext('2d')!,
    sc = s.getContext('2d')!,
    gc = g.getContext('2d')!;
  dc.fillStyle = '#9da99f';
  dc.fillRect(0, 0, 512, 512);
  sc.fillStyle = '#777';
  sc.fillRect(0, 0, 512, 512);
  const tileRect = (ctx: CanvasRenderingContext2D, tile: number, color: string, x = 0, y = 0, w = 64, h = 64) => {
    ctx.fillStyle = color;
    ctx.fillRect(tile % 8 * 64 + x, Math.floor(tile / 8) * 64 + y, w, h);
  };
  for (let i = 0; i < 48; i++) {
    tileRect(dc, i, i < 12 ? '#d9a45d' : i < 24 ? '#657f86' : i < 36 ? '#485b65' : '#d9a45d');
    tileRect(dc, i, '#ffffff30', 6, 6, 52, 5);
    tileRect(dc, i, '#2d344b33', 6, 53, 52, 5);
    for (let j = 0; j < 8; j++) tileRect(dc, i, j % 2 ? '#fff3' : '#25314625', 7 + (j * 13 + i * 7) % 45, 10 + (j * 19 + i) % 40, 3, 2);
  }
  tileRect(dc, 4, '#344952', 8, 16, 48, 30);
  tileRect(sc, 4, '#e6e6e6', 8, 16, 48, 30);
  for (const x of [16, 38]) {
    tileRect(dc, 4, '#a8f5c0', x, 23, 9, 10);
    tileRect(gc, 4, '#bbbbbb', x, 23, 9, 10);
  }
  tileRect(dc, 10, '#52646b', 18, 14, 28, 28);
  tileRect(dc, 10, '#edc78a', 23, 19, 18, 18);
  tileRect(dc, 10, '#eb8e68', 28, 23, 8, 8);
  tileRect(gc, 10, '#777', 28, 23, 8, 8);
  for (let i = 42; i < 48; i++) {
    tileRect(dc, i, '#b5edb3');
    tileRect(gc, i, '#666');
  }
  return {
    diffuse: pixelsOf(d),
    spec: pixelsOf(s),
    glow: pixelsOf(g)
  };
}
