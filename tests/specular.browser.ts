import * as THREE from 'three';
import { Studio } from '../src/studio';
import { blankMap, copyPixels } from '../src/maps';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';

const tests: BrowserResult[] = [];
const studio = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});
const renderer = studio.renderer;
const geometry = new THREE.PlaneGeometry(2, 2);
const scene = new THREE.Scene();
scene.add(new THREE.Mesh(geometry, studio.material));
const key = new THREE.DirectionalLight(0xffffff, .01);
key.position.set(0, 0, 3);
const ambient = new THREE.AmbientLight(0xffffff, 0);
scene.add(key, ambient);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
camera.position.z = 3;
const target = new THREE.WebGLRenderTarget(32, 32, { type: THREE.FloatType, depthBuffer: false });
const darkEnvironment = new THREE.WebGLCubeRenderTarget(4);
const emptyScene = new THREE.Scene();
emptyScene.background = new THREE.Color(0);
new THREE.CubeCamera(.1, 10, darkEnvironment).update(renderer, emptyScene);
const environment = studio.material.envMap;

function expect(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); tests.push({ name, pass: true }); }
  catch (error) { tests.push({ name, pass: false, detail: String(error) }); }
}
function fill(kind: 'diffuse' | 'spec' | 'glow', rgb: number[]) {
  const map = studio.maps[kind];
  for (let i = 0; i < map.data.length; i += 4) map.data.set([...rgb, 255], i);
}
function read(mask: number, strength = 1) {
  fill('spec', [mask, mask, mask]);
  studio.specStrength = strength;
  studio.refresh();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Float32Array(32 * 32 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
  renderer.setRenderTarget(null);
  expect(renderer.getContext().getError() === 0 && pixels.every(Number.isFinite), 'Invalid GPU output');
  return pixels;
}
function same(a: Float32Array, b: Float32Array, tolerance = 1e-6) {
  return a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
}
async function run() {
  studio.maps = { diffuse: blankMap('diffuse', 32, 32), spec: blankMap('spec', 32, 32), glow: blankMap('glow', 32, 32) };
  fill('diffuse', [0, 0, 0]); fill('glow', [0, 0, 0]);
  studio.setProcessing({ enabled: false });
  studio.material.envMap = null;
  studio.material.needsUpdate = true;
  await check('Black removes specular, gray is linear intensity, white produces a highlight', () => {
    const black = read(0), gray = read(128), white = read(255);
    expect(white[0] > .01, 'White mask did not produce a highlight');
    expect(black[0] === 0, 'Black mask still has specular');
    expect(Math.abs(gray[0] / white[0] - 128 / 255) < .0001, 'Mask was gamma-corrected or inverted');
  });
  await check('Specular strength is a multiplier and zero removes the entire response', () => {
    const black = read(0), zero = read(255, 0), half = read(255, .5), full = read(255, 1), double = read(255, 2);
    expect(same(black, zero), 'Strength zero leaves a Fresnel highlight');
    expect(Math.abs(half[0] * 2 - full[0]) < 1e-6 && Math.abs(full[0] * 2 - double[0]) < 1e-6, 'Strength is not proportional');
  });
  await check('Dark reflections do not replace or tint diffuse color', () => {
    key.intensity = 0; ambient.intensity = 1;
    fill('diffuse', [178, 75, 38]);
    studio.material.envMap = darkEnvironment.texture;
    studio.material.needsUpdate = true;
    const source = studio.maps.diffuse.data.slice();
    const black = read(0, 2), white = read(255, 2);
    expect(black[0] > .05 && same(black, white), 'Specular mask changed diffuse without any reflected light');
    expect(studio.maps.diffuse.data.every((value, i) => value === source[i]), 'Specular altered source color bytes');
  });
  await check('Unlit ignores the mask and strength', () => {
    studio.material.envMap = environment;
    studio.material.needsUpdate = true;
    studio.setRenderMode('unlit');
    expect(same(read(0, 0), read(255, 2)), 'Specular affects Unlit');
    studio.setRenderMode('lit');
  });
  await check('Reflection on a cylinder has a broad smooth falloff instead of a hard panel edge', () => {
    const cylinder = new THREE.CylinderGeometry(1, 1, 2, 128, 1, true);
    const probe = new THREE.Scene();
    probe.add(new THREE.Mesh(cylinder, studio.material));
    const view = new THREE.OrthographicCamera(-1.2, 1.2, .8, -.8, .1, 10);
    view.position.z = 3;
    const image = new THREE.WebGLRenderTarget(256, 64, { type: THREE.FloatType, depthBuffer: false });
    try {
      fill('diffuse', [0, 0, 0]); fill('spec', [255, 255, 255]); fill('glow', [0, 0, 0]);
      studio.specStrength = 1; studio.lightAngle = 35; studio.refresh();
      renderer.setRenderTarget(image); renderer.render(probe, view);
      const pixels = new Float32Array(256 * 64 * 4);
      renderer.readRenderTargetPixels(image, 0, 0, 256, 64, pixels);
      // Exclude the silhouette: its discontinuity is the model boundary,
      // not a reflection edge. The interior must retain a smooth bright lobe.
      const profile = Array.from({ length: 196 }, (_, x) => pixels[(32 * 256 + x + 30) * 4]);
      const peak = Math.max(...profile);
      const jump = Math.max(...profile.slice(1).map((value, i) => Math.abs(value - profile[i])));
      expect(peak > .08, 'Reflection was removed instead of softened');
      expect(jump / peak < .18, `Hard reflection edge remains: ${jump / peak}`);
      expect(renderer.getContext().getError() === 0, 'Reflection probe left a WebGL error');
    } finally { renderer.setRenderTarget(null); image.dispose(); cylinder.dispose(); }
  });
  await check('Studio reflections create visible highlights on a flat model and follow light rotation', () => {
    studio.setModel(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
    studio.frameModel();
    studio.lightAngle = 35;
    fill('diffuse', [90, 90, 90]);
    const frame = (mask: number) => {
      fill('spec', [mask, mask, mask]); studio.specStrength = 2; studio.refresh();
      renderer.setRenderTarget(target); renderer.render(studio.scene, studio.camera);
      const data = new Float32Array(32 * 32 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 32, 32, data);
      renderer.setRenderTarget(null);
      return data;
    };
    const black = frame(0), white = frame(255);
    expect(white.some((value, i) => i % 4 !== 3 && value - black[i] > .15), 'Flat model has no readable highlight');
    studio.lightAngle = 125;
    const rotatedBlack = frame(0), rotatedWhite = frame(255);
    expect(white.some((value, i) => i % 4 !== 3 && Math.abs((value - black[i]) - (rotatedWhite[i] - rotatedBlack[i])) > .1), 'Specular did not move with lighting');
  });
  await check('Painting white on Specular changes the rendered model before pointerup and survives undo/redo', async () => {
    studio.selectMap('spec'); studio.lightAngle = 35;
    fill('spec', [0, 0, 0]); studio.refresh(); studio.history.clear();
    Object.assign(studio.brush, { tool: 'pencil', size: 128, opacity: 1, value: 1 });
    const canvas = renderer.domElement;
    const capture = new Set<number>();
    canvas.setPointerCapture = id => { capture.add(id); };
    canvas.hasPointerCapture = id => capture.has(id);
    canvas.releasePointerCapture = id => { capture.delete(id); };
    const frame = () => {
      renderer.setRenderTarget(target); renderer.render(studio.scene, studio.camera);
      const data = new Float32Array(32 * 32 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 32, 32, data);
      renderer.setRenderTarget(null);
      return data;
    };
    const before = frame(), source = copyPixels(studio.maps.spec);
    const pointer = (type: string, x: number, y: number) => {
      const box = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: box.left + x, clientY: box.top + y, bubbles: true }));
    };
    pointer('pointerdown', 280, 240);
    pointer('pointermove', 360, 240);
    await new Promise(requestAnimationFrame);
    const live = frame();
    expect(!same(live, before), 'White paint is missing from the live rendered specular');
    expect(studio.maps.spec.data.every((value, i) => value === source.data[i]), 'Live test did not exercise GPU ownership');
    pointer('pointerup', 360, 240);
    const committed = frame();
    expect(same(live, committed, .005), 'Specular changed on commit');
    studio.undo(); expect(same(before, frame()), 'Undo did not remove the highlight');
    studio.redo(); expect(same(committed, frame()), 'Redo did not restore the highlight');
  });
}
void run().catch(error => tests.push({ name: 'Specular suite', pass: false, detail: String(error) })).finally(() => {
  target.dispose(); darkEnvironment.dispose(); geometry.dispose(); studio.dispose();
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2);
  reportResults({ suite: 'specular', tests });
});
