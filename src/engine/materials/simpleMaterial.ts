/**
 * Simplified terrain material for WebGPU mode.
 * Plain MeshStandardMaterial without onBeforeCompile shader patching.
 * No biome blending or tri-planar — just tiled rock texture.
 */

import * as THREE from 'three';
import type { MeshStandardMaterial } from 'three';
import type { TextureSet, TerrainMaterials } from '../types';

export function createSimpleTerrainMaterials(textures: TextureSet): TerrainMaterials {
  function makeMat(useDisplacement: boolean): MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      map: textures.rockDiff,
      normalMap: textures.rockNorm,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: textures.rockRough,
      aoMap: textures.rockAo,
      aoMapIntensity: 1.0,
      envMapIntensity: 0.08,
    });
    if (useDisplacement) {
      mat.displacementMap = textures.rockDisp;
      mat.displacementScale = 0.25;
      mat.displacementBias = -0.1;
    }
    return mat;
  }

  return {
    matDisp: makeMat(true),
    matNoDisp: makeMat(false),
  };
}
