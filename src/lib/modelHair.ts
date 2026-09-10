import * as THREE from 'three';

/** Original procedural textures: individual swept fibers, no downloaded images. */
function createHairTextures() {
  const width = 2048, height = 1024;
  const colorCanvas = document.createElement('canvas');
  const reliefCanvas = document.createElement('canvas');
  for (const canvas of [colorCanvas, reliefCanvas]) { canvas.width = width; canvas.height = height; }
  const color = colorCanvas.getContext('2d')!;
  const relief = reliefCanvas.getContext('2d')!;
  color.fillStyle = '#182125'; color.fillRect(0, 0, width, height - 20);
  relief.fillStyle = '#777777'; relief.fillRect(0, 0, width, height);
  const edge = color.createLinearGradient(0, height - 28, 0, height);
  edge.addColorStop(0, '#182125'); edge.addColorStop(1, '#18212500');
  color.fillStyle = edge; color.fillRect(0, height - 28, width, 28);
  let seed = 210819;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Dense fine fibers carry the detail; sparse lighter fibers stay legible at
  // panel size. Wrapped paths keep the back-of-head UV seam continuous.
  for (let i = 0; i < 6800; i++) {
    const root = random() * width;
    const start = random() * height * .4;
    const end = height - random() * 23;
    const variation = random();
    const accent = Math.exp(-Math.pow((root / width - .59) / .028, 2));
    const light = 25 + variation * 38;
    const highlighted = i % 13 === 0;
    color.strokeStyle = `rgb(${light * .72 + accent * 6} ${light * .89 + accent * 39} ${light + accent * 31})`;
    color.lineWidth = highlighted ? 1.5 : .4 + random() * .65;
    color.globalAlpha = highlighted ? .85 : .4 + random() * .4;
    relief.strokeStyle = variation > .45 ? '#c1c1c1' : '#343434';
    relief.lineWidth = color.lineWidth;
    relief.globalAlpha = .6;
    const drift = 75 + random() * 100;
    for (const wrap of [-width, 0, width]) {
      for (const context of [color, relief]) {
        context.beginPath();
        for (let step = 0; step <= 24; step++) {
          const y = start + (end - start) * step / 24;
          const t = y / height;
          const x = root + wrap + drift * Math.sin(Math.PI * t * .9) + Math.sin(t * 9 + root * .03) * 3;
          if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(reliefCanvas);
  for (const texture of [map, bump]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, bump };
}

/** One UV-mapped swept scalp shell, in cm relative to head rig (0,151,-1).
 * Fine strands are baked into color and relief textures, not individual meshes.
 * Call disposeModelHairTextures(hair) in addition to normal mesh cleanup. */
export function createModelHair(): THREE.Group {
  const hair = new THREE.Group();
  hair.name = 'Textured swept midnight hairstyle';
  hair.userData.decorative = true;
  const { map, bump } = createHairTextures();
  const material = new THREE.MeshStandardMaterial({
    map, bumpMap: bump, bumpScale: .07, roughnessMap: bump,
    color: 0xffffff, roughness: .84, metalness: .04,
    alphaTest: .18, side: THREE.DoubleSide,
  });
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const around = 96, rings = 36;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    for (let segment = 0; segment <= around; segment++) {
      const u = segment / around;
      const phi = (u - .5) * Math.PI * 2;
      const front = (Math.cos(phi) + 1) / 2;
      const bottom = 8 + 6.1 * Math.pow(front, 2);
      const theta = t * Math.acos((bottom - 11) / 10.2);
      // A single smooth asymmetrical quiff gives volume without tube-like locks.
      const crest = 2.6 * Math.pow(front, 2) * Math.sin(Math.PI * t) * (1 + .15 * Math.sin(phi));
      const sway = .95 * Math.sin(Math.PI * t) * front;
      positions.push(
        8.18 * Math.sin(theta) * Math.sin(phi) + sway,
        11 + 10.2 * Math.cos(theta) + crest,
        -.5 + 10.7 * Math.sin(theta) * Math.cos(phi) + crest * .14,
      );
      uvs.push(u, 1 - t);
      if (ring < rings && segment < around) {
        const a = ring * (around + 1) + segment, b = a + around + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const scalp = new THREE.Mesh(geometry, material);
  scalp.name = '6800 textured hair fibers';
  hair.add(scalp);
  return hair;
}

/** Dispose GPU textures; caller's existing traversal disposes geometry/material. */
export function disposeModelHairTextures(hair: THREE.Group): void {
  const textures = new Set<THREE.Texture>();
  hair.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      for (const texture of [material.map, material.bumpMap, material.roughnessMap]) if (texture) textures.add(texture);
    }
  });
  textures.forEach(texture => texture.dispose());
}
