import * as THREE from 'three';
import type { WebGLRenderer, Texture } from 'three';
import type { TextureSet } from '../types';

export function loadTextureSet(renderer: WebGLRenderer): TextureSet {
  const loader = new THREE.TextureLoader();

  function loadTex(path: string, srgb = false): Texture {
    const tex = loader.load(
      path,
      () => console.log(`[tex] loaded ${path}`),
      undefined,
      (err) => console.error(`[tex] FAILED ${path}`, err),
    );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  return {
    rockDiff:  loadTex('/aerial_rocks_04_diff_1k.jpg', true),
    rockDisp:  loadTex('/aerial_rocks_04_disp_1k.jpg'),
    rockNorm:  loadTex('/aerial_rocks_04_nor_gl_1k.jpg'),
    rockRough: loadTex('/aerial_rocks_04_rough_1k.jpg'),
    rockAo:    loadTex('/aerial_rocks_04_ao_1k.jpg'),
    grassDiff:  loadTex('/aerial_grass_rock_diff_1k.jpg', true),
    grassNorm:  loadTex('/aerial_grass_rock_nor_gl_1k.jpg'),
    grassRough: loadTex('/aerial_grass_rock_rough_1k.jpg'),
    dirtDiff:  loadTex('/brown_mud_leaves_01_diff_1k.jpg', true),
    dirtNorm:  loadTex('/brown_mud_leaves_01_nor_gl_1k.jpg'),
    dirtRough: loadTex('/brown_mud_leaves_01_rough_1k.jpg'),
  };
}
