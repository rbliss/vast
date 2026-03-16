import * as THREE from 'three';

/**
 * Load the full PBR texture set for terrain biome blending.
 * All paths use Vite publicDir (/ prefix).
 *
 * @param {THREE.WebGLRenderer} renderer - used for getMaxAnisotropy()
 * @returns {{ rockDiff, rockDisp, rockNorm, rockRough, rockAo, grassDiff, grassNorm, grassRough, dirtDiff, dirtNorm, dirtRough }}
 */
export function loadTextureSet(renderer) {
  const loader = new THREE.TextureLoader();

  function loadTex(path, srgb = false) {
    const tex = loader.load(
      path,
      () => console.log(`[tex] loaded ${path}`),
      undefined,
      (err) => console.error(`[tex] FAILED ${path}`, err)
    );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Rock layer (aerial_rocks_04)
  const rockDiff  = loadTex('/aerial_rocks_04_diff_1k.jpg', true);
  const rockDisp  = loadTex('/aerial_rocks_04_disp_1k.jpg');
  const rockNorm  = loadTex('/aerial_rocks_04_nor_gl_1k.jpg');
  const rockRough = loadTex('/aerial_rocks_04_rough_1k.jpg');
  const rockAo    = loadTex('/aerial_rocks_04_ao_1k.jpg');

  // Grass layer (aerial_grass_rock)
  const grassDiff  = loadTex('/aerial_grass_rock_diff_1k.jpg', true);
  const grassNorm  = loadTex('/aerial_grass_rock_nor_gl_1k.jpg');
  const grassRough = loadTex('/aerial_grass_rock_rough_1k.jpg');

  // Dirt layer (brown_mud_leaves_01)
  const dirtDiff  = loadTex('/brown_mud_leaves_01_diff_1k.jpg', true);
  const dirtNorm  = loadTex('/brown_mud_leaves_01_nor_gl_1k.jpg');
  const dirtRough = loadTex('/brown_mud_leaves_01_rough_1k.jpg');

  return {
    rockDiff, rockDisp, rockNorm, rockRough, rockAo,
    grassDiff, grassNorm, grassRough,
    dirtDiff, dirtNorm, dirtRough,
  };
}
