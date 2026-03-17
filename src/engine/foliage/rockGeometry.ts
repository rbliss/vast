/**
 * Procedural rock geometry generation.
 *
 * Creates varied, natural-looking rock meshes by deforming
 * icosahedra with layered noise displacement. Each rock variant
 * is deterministic from its seed, enabling instanced variety
 * without importing external assets.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Create a deformed rock geometry with natural-looking variation.
 *
 * @param seed Deterministic seed for shape variation
 * @param detail Icosahedron subdivision level (1-2)
 * @param squash Vertical squash factor (0.3 = flat slab, 0.8 = rounded)
 * @param roughness Amount of surface noise displacement (0-0.3)
 * @param baseRadius Base radius before deformation
 */
export function makeRockGeo(
  seed: number = 0,
  detail: number = 1,
  squash: number = 0.5,
  roughness: number = 0.15,
  baseRadius: number = 0.35,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(baseRadius, detail);
  const pos = geo.getAttribute('position');

  // Simple hash for deterministic noise
  function hash(x: number, y: number, z: number): number {
    let h = seed * 127.1 + x * 311.7 + y * 74.7 + z * 233.3;
    h = Math.sin(h) * 43758.5453;
    return h - Math.floor(h);
  }

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Normalize direction
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // Large-scale deformation (makes each rock unique)
    const largeDef = hash(
      Math.floor(nx * 3 + seed),
      Math.floor(ny * 3 + seed * 1.7),
      Math.floor(nz * 3 + seed * 2.3),
    ) * 0.3 - 0.15;

    // Medium-scale roughness
    const medDef = hash(
      Math.floor(nx * 7 + seed + 5),
      Math.floor(ny * 7 + seed + 11),
      Math.floor(nz * 7 + seed + 17),
    ) * roughness - roughness * 0.5;

    // Apply deformation along normal
    const deform = (1 + largeDef + medDef) * baseRadius;
    x = nx * deform;
    y = ny * deform * squash; // Vertical squash
    z = nz * deform;

    // Angular asymmetry (tilt one side higher)
    const tiltAngle = hash(seed * 3, seed * 7, 0) * Math.PI * 2;
    const tilt = (nx * Math.cos(tiltAngle) + nz * Math.sin(tiltAngle)) * 0.08 * baseRadius;
    y += tilt;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a set of rock geometry variants for instancing variety.
 * Returns an array of geometries, each with a different shape.
 */
export function makeRockVariants(count: number = 4): THREE.BufferGeometry[] {
  return [
    // Flat slab rock
    makeRockGeo(1, 1, 0.35, 0.12, 0.35),
    // Rounded boulder
    makeRockGeo(2, 1, 0.65, 0.18, 0.3),
    // Angular chunk
    makeRockGeo(3, 1, 0.5, 0.22, 0.32),
    // Tall wedge
    makeRockGeo(4, 1, 0.75, 0.15, 0.28),
  ].slice(0, count);
}

/**
 * Create a better shrub geometry — multi-sphere cluster.
 */
export function makeShrubGeo(seed: number = 0): THREE.BufferGeometry {
  const group = new THREE.BufferGeometry();
  const spheres: THREE.BufferGeometry[] = [];

  // 3-4 overlapping spheres at varied positions
  const count = 3 + (seed % 2);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + seed * 0.7;
    const radius = 0.12 + (seed * 17 + i * 31) % 7 * 0.02;
    const sphere = new THREE.IcosahedronGeometry(radius, 1);

    // Offset from center
    const ox = Math.cos(angle) * 0.08;
    const oz = Math.sin(angle) * 0.08;
    const oy = i * 0.04;
    const pos = sphere.getAttribute('position');
    for (let j = 0; j < pos.count; j++) {
      pos.setXYZ(j, pos.getX(j) + ox, pos.getY(j) + oy, pos.getZ(j) + oz);
    }
    spheres.push(sphere);
  }

  // Merge geometries
  const merged = mergeGeometries(spheres);
  if (merged) {
    merged.computeVertexNormals();
    return merged;
  }

  // Fallback
  return new THREE.IcosahedronGeometry(0.25, 1);
}
