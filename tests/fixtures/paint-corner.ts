import * as THREE from 'three';

// Two UV islands meeting at a concave seam. A tiny overlap represents the
// precision mismatch in imported meshes: an edge ray hits the neighbouring
// face, while the visible interior of the texel is still paintable.
export function paintCorner() {
  const group = new THREE.Group();
  for (const shift of [0, .5]) {
    const geometry = new THREE.PlaneGeometry(2, 2), uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, .08 + shift + .28 * u + .1 * v, .12 + .07 * u + .69 * v);
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    if (shift) { mesh.rotation.y = -Math.PI / 2; mesh.position.set(.99999, 0, 1); }
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  camera.position.set(.3, .3, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { group, meshes: group.children as THREE.Mesh[], camera };
}
