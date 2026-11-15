import * as THREE from 'three';

// Imported scenes can include lines, points and skeletons as well as meshes.
// Shared resources are released once; the studio's paint material stays alive.
export function disposeModelResources(root: THREE.Object3D, preserve?: THREE.Material) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  const preservedTextures = new Set(Object.values(preserve ?? {}).filter(value => value instanceof THREE.Texture));
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material !== preserve) materials.add(material);
      }
    }
    if (object instanceof THREE.SkinnedMesh && object.skeleton) skeletons.add(object.skeleton);
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) object.shadow.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture && !preservedTextures.has(value)) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
