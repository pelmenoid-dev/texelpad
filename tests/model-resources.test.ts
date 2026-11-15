import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeModelResources } from '../src/model-resources.ts';

test('mixed imported geometry releases shared buffers, textures and skeletons once', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.PointsMaterial({ map: texture });
  root.add(new THREE.Points(geometry, material), new THREE.Points(geometry, material));
  const lineGeometry = new THREE.BufferGeometry(), lineMaterial = new THREE.LineBasicMaterial();
  root.add(new THREE.Line(lineGeometry, lineMaterial));
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  skeleton.computeBoneTexture();
  const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  skinned.skeleton = skeleton;
  root.add(skinned);
  const resources = [geometry, texture, material, lineGeometry, lineMaterial, skinned.geometry, skinned.material, skeleton.boneTexture!];
  const counts = resources.map(() => 0);
  resources.forEach((resource, i) => resource.addEventListener('dispose', () => counts[i]++));
  disposeModelResources(root);
  assert.deepEqual(counts, resources.map(() => 1));
});

test('replacing a model preserves the shared paint material and its texture maps', () => {
  const texture = new THREE.Texture();
  const paint = new THREE.MeshPhongMaterial({ map: texture });
  const geometry = new THREE.BufferGeometry();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, paint), new THREE.Points(geometry, new THREE.PointsMaterial({ map: texture })));
  let materialDisposals = 0, textureDisposals = 0, geometryDisposals = 0;
  paint.addEventListener('dispose', () => materialDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  geometry.addEventListener('dispose', () => geometryDisposals++);
  disposeModelResources(root, paint);
  assert.equal(materialDisposals, 0);
  assert.equal(textureDisposals, 0);
  assert.equal(geometryDisposals, 1);
});
