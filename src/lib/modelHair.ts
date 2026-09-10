import * as THREE from 'three';

/** Original decorative geometry, in centimeters relative to the head rig at
 * world (0,151,-1). Attach directly to `head`; show in muscle mode only.
 * Approximate local bounds: x ±8.3, y 8–24.5, z -11.5–10.5.
 * No textures or global/shared resources: dispose meshes by normal traversal. */
export function createModelHair(): THREE.Group {
  const hair = new THREE.Group();
  hair.name = 'Decorative midnight quiff';
  hair.userData.decorative = true;
  const midnight = new THREE.MeshStandardMaterial({ color: 0x17252c, roughness: .44, metalness: .12 });
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x23363e, roughness: .42, metalness: .12 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x35b6a7, roughness: .36, metalness: .16 });

  // A shaped scalp shell follows the broad crown of the anatomical skull.
  // Higher front hairline leaves the brows, eyes and frontalis visible;
  // the back and sides descend farther to avoid a floating toupee silhouette.
  const positions: number[] = [];
  const indices: number[] = [];
  const around = 40, rings = 14;
  for (let ring = 0; ring <= rings; ring++) {
    for (let segment = 0; segment <= around; segment++) {
      const phi = segment / around * Math.PI * 2;
      const front = (Math.cos(phi) + 1) / 2;
      const bottom = 8 + 5.6 * Math.pow(front, 2);
      const theta = ring / rings * Math.acos((bottom - 11) / 9.8);
      positions.push(8.12 * Math.sin(theta) * Math.sin(phi), 11 + 9.8 * Math.cos(theta), -.5 + 10.6 * Math.sin(theta) * Math.cos(phi));
      if (ring < rings && segment < around) {
        const a = ring * (around + 1) + segment, b = a + around + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cap.setIndex(indices); cap.computeVertexNormals();
  hair.add(new THREE.Mesh(cap, midnight));

  const lock = (points: number[][], thickness: number, material: THREE.Material, flatten = .72) => {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point as [number, number, number])));
    const steps = 24, sides = 8;
    const frames = curve.computeFrenetFrames(steps, false);
    const vertices: number[] = [], triangles: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const center = curve.getPointAt(t);
      // Both ends taper into the shell. A broad midsection gives each swept
      // lock a sculpted, ribbon-like crest instead of a bundle of cylinders.
      const radius = thickness * (.05 + .95 * Math.pow(Math.sin(Math.PI * t), .55));
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const vertex = center.clone().addScaledVector(frames.normals[i], Math.cos(angle) * radius).addScaledVector(frames.binormals[i], Math.sin(angle) * radius * flatten);
        vertices.push(vertex.x, vertex.y, vertex.z);
        if (i < steps && j < sides) {
          const a = i * (sides + 1) + j, b = a + sides + 1;
          triangles.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(triangles); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material === teal ? 'Teal accent lock' : 'Swept quiff lock';
    hair.add(mesh);
  };

  // Offset crests sweep from the forehead up and toward the wearer's left.
  // Individual broad locks stay legible at the small app panel size.
  for (let i = 0; i < 9; i++) {
    const x = -5.5 + i * 1.3;
    const edge = Math.abs(x) / 6;
    lock([
      [x, 14.7 + (1 - edge) * .7, 9.0 - edge * 1.1],
      [x + .5, 19.5 + (1 - edge) * 2.3, 8.3 - edge],
      [x + 1.25, 21.1 + (1 - edge) * 2, 3.1],
      [x + .9, 20.4 - edge * 1.5, -3.2],
      [x * .85, 16.3 - edge, -8.5],
    ], .98, i === 6 ? teal : i % 3 === 1 ? charcoal : midnight);
  }
  // Short combed side locks connect the crown to the lower rear hairline.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      lock([
        [side * 6.6, 12.6 + i * 1.1, 5.9 - i],
        [side * 7.9, 14.3 + i * .9, 1.8 - i],
        [side * 7.5, 13.4 + i, -4.6],
        [side * 5.2, 9.3 + i, -8.8],
      ], .42, i === 1 ? charcoal : midnight, .7);
    }
  }
  return hair;
}
