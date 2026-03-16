/**
 * Terrain material factory with biome blending shader.
 * Creates MeshStandardMaterial + onBeforeCompile patches for:
 * - 3-layer biome blend (grass/dirt/rock)
 * - Slope-masked tri-planar mapping (rock only)
 * - Whiteout normal blending (Golus method)
 * - Edge displacement fade at chunk borders
 * - AO correction per biome
 */

import * as THREE from 'three';
import { CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE } from '../config.js';

/**
 * Create terrain materials (with and without displacement).
 * @param {object} textures — texture set from loadTextureSet()
 * @returns {{ matDisp: Material, matNoDisp: Material }}
 */
export function createTerrainMaterials(textures) {
  function makeMat(useDisplacement) {
    const mat = new THREE.MeshStandardMaterial({
      map: textures.rockDiff,
      normalMap: textures.rockNorm,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: textures.rockRough,
      aoMap: textures.rockAo,
      aoMapIntensity: 1.0,
      envMapIntensity: 0.3,
    });
    if (useDisplacement) {
      mat.displacementMap = textures.rockDisp;
      mat.displacementScale = 0.25;
      mat.displacementBias = -0.1;
    }
    return mat;
  }

  const matDisp = makeMat(true);
  const matNoDisp = makeMat(false);

  applyBiomeShader(matDisp, textures);
  applyBiomeShader(matNoDisp, textures);

  return { matDisp, matNoDisp };
}

function applyBiomeShader(material, tex) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockScale    = { value: 1.0 / ROCK_WORLD_SIZE };
    shader.uniforms.grassScale   = { value: 1.0 / GRASS_WORLD_SIZE };
    shader.uniforms.dirtScale    = { value: 1.0 / DIRT_WORLD_SIZE };
    shader.uniforms.chunkHalf    = { value: CHUNK_SIZE / 2 };
    shader.uniforms.grassDiffMap = { value: tex.grassDiff };
    shader.uniforms.grassRoughMap = { value: tex.grassRough };
    shader.uniforms.dirtDiffMap  = { value: tex.dirtDiff };
    shader.uniforms.dirtRoughMap = { value: tex.dirtRough };

    // ── Vertex: world-space varyings + edge displacement fade ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform float chunkHalf;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <displacementmap_vertex>',
      `#ifdef USE_DISPLACEMENTMAP
        float edgeDist = min(
          min(transformed.x + chunkHalf, chunkHalf - transformed.x),
          min(transformed.z + chunkHalf, chunkHalf - transformed.z)
        );
        float dispFade = smoothstep(0.0, 3.0, edgeDist);
        transformed += normalize(objectNormal) * (
          texture2D(displacementMap, vDisplacementMapUv).x * displacementScale * dispFade
          + displacementBias * dispFade
        );
      #endif`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
    );

    // ── Fragment: declarations + biome noise ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform float rockScale;
      uniform float grassScale;
      uniform float dirtScale;
      uniform sampler2D grassDiffMap;
      uniform sampler2D grassRoughMap;
      uniform sampler2D dirtDiffMap;
      uniform sampler2D dirtRoughMap;

      float biomeHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float biomeNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = biomeHash(i);
        float b = biomeHash(i + vec2(1.0, 0.0));
        float c = biomeHash(i + vec2(0.0, 1.0));
        float d = biomeHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      `
    );

    // ── Diffuse: 3-layer biome blend ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      vec3 triWeights = pow(abs(vWorldNormal), vec3(4.0));
      triWeights /= (triWeights.x + triWeights.y + triWeights.z + 1e-6);
      float slope = 1.0 - abs(vWorldNormal.y);
      vec2 triUvX = vWorldPosition.zy * rockScale;
      vec2 triUvY = vWorldPosition.xz * rockScale;
      vec2 triUvZ = vWorldPosition.xy * rockScale;
      vec2 grassUv = vWorldPosition.xz * grassScale;
      vec2 dirtUv  = vWorldPosition.xz * dirtScale;

      float bNoise = biomeNoise(vWorldPosition.xz * 0.03);
      float heightBias = smoothstep(4.0, 9.0, vWorldPosition.y) * 0.3;
      float wRock  = smoothstep(0.35, 0.65, slope + heightBias);
      float flatWeight = 1.0 - wRock;
      float wGrass = flatWeight * smoothstep(0.25, 0.6, bNoise);
      float wDirt  = flatWeight * (1.0 - smoothstep(0.2, 0.55, bNoise)) * 0.6;
      float wSum = wRock + wGrass + wDirt + 1e-6;
      wRock /= wSum; wGrass /= wSum; wDirt /= wSum;

      #ifdef USE_MAP
        vec4 rockCol = texture2D(map, triUvX) * triWeights.x
                     + texture2D(map, triUvY) * triWeights.y
                     + texture2D(map, triUvZ) * triWeights.z;
        vec4 grassCol = texture2D(grassDiffMap, grassUv);
        vec4 dirtCol  = texture2D(dirtDiffMap, dirtUv);
        vec4 sampledDiffuseColor = rockCol * wRock + grassCol * wGrass + dirtCol * wDirt;
        diffuseColor *= sampledDiffuseColor;
      #endif
      `
    );

    // ── Roughness ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      #ifdef USE_ROUGHNESSMAP
      {
        float rockRgh  = texture2D(roughnessMap, triUvX).g * triWeights.x
                       + texture2D(roughnessMap, triUvY).g * triWeights.y
                       + texture2D(roughnessMap, triUvZ).g * triWeights.z;
        float grassRgh = texture2D(grassRoughMap, grassUv).g;
        float dirtRgh  = texture2D(dirtRoughMap, dirtUv).g;
        roughnessFactor = roughness * (rockRgh * wRock + grassRgh * wGrass + dirtRgh * wDirt);
      }
      #endif
      `
    );

    // ── Normals: geometry normal for flat, tri-planar Whiteout for rock ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      vec3 geoNormal = normal;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      #ifdef USE_NORMALMAP_TANGENTSPACE
      {
        vec3 flatNormal = geoNormal;
        vec3 axisSign = sign(vWorldNormal);
        vec3 tnX = texture2D(normalMap, triUvX).xyz * 2.0 - 1.0;
        vec3 tnY = texture2D(normalMap, triUvY).xyz * 2.0 - 1.0;
        vec3 tnZ = texture2D(normalMap, triUvZ).xyz * 2.0 - 1.0;
        tnX.xy *= normalScale; tnY.xy *= normalScale; tnZ.xy *= normalScale;
        tnX.x *= axisSign.x; tnY.x *= axisSign.y; tnZ.x *= -axisSign.z;
        tnX = vec3(tnX.xy + vWorldNormal.zy, abs(vWorldNormal.x));
        tnY = vec3(tnY.xy + vWorldNormal.xz, abs(vWorldNormal.y));
        tnZ = vec3(tnZ.xy + vWorldNormal.xy, abs(vWorldNormal.z));
        vec3 rockNrmWorld = normalize(
          tnX.zyx * triWeights.x + tnY.xzy * triWeights.y + tnZ.xyz * triWeights.z
        );
        vec3 rockNrmView = normalize(mat3(viewMatrix) * rockNrmWorld);
        normal = normalize(mix(flatNormal, rockNrmView, wRock));
      }
      #endif
      `
    );

    // ── AO: rock-only, grass/dirt get 1.0 ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      #ifdef USE_AOMAP
      {
        float uvAoVal = texture2D(aoMap, vAoMapUv).r;
        float stdAO = (uvAoVal - 1.0) * aoMapIntensity + 1.0;
        float triAoVal = texture2D(aoMap, triUvX).r * triWeights.x
                       + texture2D(aoMap, triUvY).r * triWeights.y
                       + texture2D(aoMap, triUvZ).r * triWeights.z;
        float rockAO = (triAoVal - 1.0) * aoMapIntensity + 1.0;
        float biomeAO = mix(1.0, rockAO, wRock);
        float aoCorrection = biomeAO / max(stdAO, 0.001);
        reflectedLight.indirectDiffuse *= aoCorrection;
      }
      #endif
      `
    );
  };
  material.customProgramCacheKey = () => 'biome_v6';
}
