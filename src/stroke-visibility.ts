import * as THREE from 'three';

type Triangle = {
  mesh: THREE.Mesh;
  offset: number;
  a: THREE.Vector3;
  edge1: THREE.Vector3;
  edge2: THREE.Vector3;
  normal: THREE.Vector3;
  cross1: THREE.Vector3;
  cross2: THREE.Vector3;
  originDotNormal: number;
  side: THREE.Side;
  bounds: THREE.Box3;
  center: THREE.Vector3;
};

type Node = {
  bounds: THREE.Box3;
  left?: Node;
  right?: Node;
  triangles?: Triangle[];
};

// Geometry is stationary while a stroke owns the pointer. A small BVH avoids
// scanning every mesh triangle for every painted texel, without a screen-depth
// approximation that would miss thin surfaces or introduce UV seam gaps.
export class StrokeVisibility {
  private root?: Node;
  private stack: Node[] = [];
  private hit = new THREE.Vector3();
  private triangles: Triangle[] = [];
  private origin = new THREE.Vector3(NaN, NaN, NaN);
  private offset = new THREE.Vector3();

  constructor(meshes: THREE.Mesh[]) {
    const triangles: Triangle[] = [];
    for (const mesh of meshes) {
      if (!(mesh.layers.mask & 1)) continue;
      mesh.updateWorldMatrix(true, false);
      const geometry = mesh.geometry;
      const index = geometry.index;
      const count = index?.count ?? geometry.getAttribute('position').count;
      const mirrored = mesh.matrixWorld.determinant() < 0;
      const ranges = Array.isArray(mesh.material)
        ? geometry.groups.map(group => ({
          start: group.start,
          count: group.count,
          material: (mesh.material as THREE.Material[])[group.materialIndex ?? 0],
        }))
        : [{ start: 0, count, material: mesh.material }];

      for (const range of ranges) {
        if (!range.material) continue;
        const start = Math.max(range.start, geometry.drawRange.start);
        const end = Math.min(count, range.start + range.count, geometry.drawRange.start + geometry.drawRange.count);
        for (let i = start; i < end; i += 3) {
          const a = mesh.getVertexPosition(index ? index.getX(i) : i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          const b = mesh.getVertexPosition(index ? index.getX(i + 1) : i + 1, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          const c = mesh.getVertexPosition(index ? index.getX(i + 2) : i + 2, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          // Three tests material sidedness in local space, including mirrored meshes.
          if (mirrored) { const point = b.clone(); b.copy(c); c.copy(point); }
          // Match Three's reversed vertex order for BackSide materials before
          // caching edges; changing that order can change edge rounding.
          if (range.material.side === THREE.BackSide) { const point = a.clone(); a.copy(c); c.copy(point); }
          const bounds = new THREE.Box3().setFromPoints([a, b, c]);
          const edge1 = b.clone().sub(a), edge2 = c.clone().sub(a);
          triangles.push({
            mesh, offset: i,
            a, edge1, edge2, normal: new THREE.Vector3().crossVectors(edge1, edge2),
            cross1: new THREE.Vector3(), cross2: new THREE.Vector3(), originDotNormal: 0,
            side: range.material.side, bounds, center: bounds.getCenter(new THREE.Vector3()),
          });
        }
      }
    }
    this.triangles = triangles;
    if (triangles.length) this.root = this.build(triangles);
  }

  private build(triangles: Triangle[]): Node {
    const bounds = new THREE.Box3();
    for (const triangle of triangles) bounds.union(triangle.bounds);
    if (triangles.length <= 8) return { bounds, triangles };
    const size = bounds.getSize(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    triangles.sort((a, b) => a.center[axis] - b.center[axis]);
    const middle = Math.floor(triangles.length / 2);
    return { bounds, left: this.build(triangles.slice(0, middle)), right: this.build(triangles.slice(middle)) };
  }

  // Stackless BVH for the GPU. Camera-relative coordinates keep ray arithmetic
  // well conditioned even when imported meshes use large world coordinates.
  gpuData(eye: THREE.Vector3) {
    const nodes: number[] = [], triangles: number[] = [];
    const indices = new Map<THREE.Mesh, Map<number, number>>();
    const visit = (node: Node) => {
      const offset = nodes.length;
      nodes.push(node.bounds.min.x - eye.x, node.bounds.min.y - eye.y, node.bounds.min.z - eye.z, 0,
        node.bounds.max.x - eye.x, node.bounds.max.y - eye.y, node.bounds.max.z - eye.z, 0);
      if (node.triangles) {
        const first = triangles.length / 12;
        nodes[offset + 7] = first * 8 + node.triangles.length;
        for (const t of node.triangles) {
          let meshIndices = indices.get(t.mesh);
          if (!meshIndices) {
            meshIndices = new Map();
            indices.set(t.mesh, meshIndices);
          }
          meshIndices.set(t.offset, triangles.length / 12);
          const delta = eye.clone().sub(t.a);
          const c1 = new THREE.Vector3().crossVectors(delta, t.edge2);
          const c2 = new THREE.Vector3().crossVectors(t.edge1, delta);
          triangles.push(...t.normal.toArray(), delta.dot(t.normal), ...c1.toArray(), t.side === THREE.DoubleSide ? 1 : 0, ...c2.toArray(), 0);
        }
      } else { visit(node.left!); visit(node.right!); }
      nodes[offset + 3] = nodes.length / 8;
    };
    if (this.root) visit(this.root);
    return { nodes: new Float32Array(nodes), triangles: new Float32Array(triangles), indices };
  }

  distance(ray: THREE.Ray): number {
    return this.intersect(ray, 0);
  }

  visible(ray: THREE.Ray, distance: number): boolean {
    const tolerance = Math.max(1e-6, distance * 1e-6);
    const front = this.intersect(ray, Math.max(0, distance - tolerance));
    return Number.isFinite(front) && distance <= front + tolerance;
  }

  private intersect(ray: THREE.Ray, occludedBefore: number): number {
    if (!this.root) return Infinity;
    if (!this.origin.equals(ray.origin)) {
      this.origin.copy(ray.origin);
      // All paint rays share the camera origin. Cache the origin-dependent
      // terms as well as edges/normals, keeping the same arithmetic as Three.
      for (const triangle of this.triangles) {
        this.offset.subVectors(ray.origin, triangle.a);
        triangle.cross1.crossVectors(this.offset, triangle.edge2);
        triangle.cross2.crossVectors(triangle.edge1, this.offset);
        triangle.originDotNormal = this.offset.dot(triangle.normal);
      }
    }
    let closest = Infinity;
    this.stack.length = 0;
    this.stack.push(this.root);
    while (this.stack.length) {
      const node = this.stack.pop()!;
      if (!ray.intersectBox(node.bounds, this.hit)) continue;
      if (!node.bounds.containsPoint(ray.origin) && ray.origin.distanceToSquared(this.hit) > closest) continue;
      if (node.triangles) {
        for (const triangle of node.triangles) {
          const distance = this.intersectTriangle(ray, triangle);
          if (distance < closest) {
            closest = distance;
            // Any closer surface is enough to reject a painted texel. Finding
            // the very nearest one adds work without changing its visibility.
            if (closest < occludedBefore * occludedBefore) return Math.sqrt(closest);
          }
        }
      } else {
        this.stack.push(node.left!, node.right!);
      }
    }
    return Math.sqrt(closest);
  }

  private intersectTriangle(ray: THREE.Ray, triangle: Triangle): number {
    let determinant = ray.direction.dot(triangle.normal);
    const sign = determinant > 0 ? 1 : -1;
    if (determinant === 0 || (sign > 0 && triangle.side !== THREE.DoubleSide)) return Infinity;
    determinant *= sign;
    const b1 = sign * ray.direction.dot(triangle.cross1);
    if (b1 < 0) return Infinity;
    const b2 = sign * ray.direction.dot(triangle.cross2);
    if (b2 < 0 || b1 + b2 > determinant) return Infinity;
    const numerator = -sign * triangle.originDotNormal;
    if (numerator < 0) return Infinity;
    const t = numerator / determinant;
    // Preserve Ray.at() followed by distanceToSquared(), including rounding at
    // large world coordinates, instead of assuming t is the world distance.
    const x = ray.origin.x - (ray.direction.x * t + ray.origin.x);
    const y = ray.origin.y - (ray.direction.y * t + ray.origin.y);
    const z = ray.origin.z - (ray.direction.z * t + ray.origin.z);
    return x * x + y * y + z * z;
  }
}
