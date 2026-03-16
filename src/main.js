import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { noise2D, fbm, ridgedFBM } from './engine/noise.js';
import { terrainHeight, MACRO_HEIGHT_SCALE } from './engine/terrainHeight.js';
import {
  CHUNK_SIZE, SKIRT_DEPTH, SKIRT_INSET, TEXTURE_WORLD_SIZE,
  ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE,
  LOD_NEAR, LOD_MID, LOD_FAR,
  GRID_RADIUS,
  GRASS_PER_CHUNK, ROCK_PER_CHUNK, SHRUB_PER_CHUNK,
} from './engine/config.js';
import { createDprController } from './engine/controls/dprController.js';

// ═══════════════════════════════════════════════════════
// Renderer, Scene, Camera
// ═══════════════════════════════════════════════════════
// preserveDrawingBuffer only when ?debug is in the URL (perf cost otherwise)
const debugMode = location.search.includes('debug');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: debugMode });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ═══════════════════════════════════════════════════════
// DPR controller (V8.3) — adaptive pixel ratio
// ═══════════════════════════════════════════════════════
// Parse ?dpr= from URL
const dprParam = new URLSearchParams(location.search).get('dpr');
let dprInitialMode = 'fixed';
let dprInitialValue = 2;
if (dprParam === 'auto') {
  dprInitialMode = 'auto';
  dprInitialValue = Math.min(window.devicePixelRatio, 2);
} else if (dprParam) {
  const v = parseFloat(dprParam);
  if (v >= 1.0 && v <= Math.min(window.devicePixelRatio, 2)) dprInitialValue = v;
}

const dpr = createDprController(renderer, { mode: dprInitialMode, initial: dprInitialValue });

// Initial setup
renderer.setSize(window.innerWidth, window.innerHeight);

// ── DPR UI buttons ──
const dprButtons = document.querySelectorAll('#dprRow button[data-dpr]');

function updateDprButtons() {
  dprButtons.forEach(btn => {
    const val = btn.dataset.dpr;
    if (val === 'auto') {
      btn.classList.toggle('active', dpr.ctrl.mode === 'auto');
    } else {
      btn.classList.toggle('active',
        dpr.ctrl.mode === 'fixed' && Math.abs(parseFloat(val) - dpr.ctrl.current) < 0.01);
    }
  });
}

function updateDprUrl() {
  const params = new URLSearchParams(location.search);
  params.set('dpr', dpr.ctrl.mode === 'auto' ? 'auto' : dpr.ctrl.current.toString());
  history.replaceState(null, '', '?' + params.toString());
}

function setDprMode(mode, value) {
  dpr.setMode(mode, value);
  updateDprButtons();
  updateDprUrl();
}

dprButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.dpr;
    if (val === 'auto') setDprMode('auto');
    else setDprMode('fixed', parseFloat(val));
  });
});

updateDprButtons();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);

const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 0.1, 800
);
camera.position.set(50, 30, 50);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 3;
controls.maxDistance = 300;
controls.update();

// ───── Lighting ─────
const sun = new THREE.DirectionalLight(0xfff4e6, 2.5);
sun.position.set(30, 50, 20);
scene.add(sun);

const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.6);
scene.add(hemi);

const fill = new THREE.DirectionalLight(0xadd8e6, 0.4);
fill.position.set(-20, 10, -20);
scene.add(fill);

// ═══════════════════════════════════════════════════════
// Textures — world-space UVs, repeat = 1
// ═══════════════════════════════════════════════════════
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

// Rock layer (aerial_rocks_04 — existing)
const rockDiff   = loadTex('/aerial_rocks_04_diff_1k.jpg', true);
const rockDisp   = loadTex('/aerial_rocks_04_disp_1k.jpg');
const rockNorm   = loadTex('/aerial_rocks_04_nor_gl_1k.jpg');
const rockRough  = loadTex('/aerial_rocks_04_rough_1k.jpg');
const rockAo     = loadTex('/aerial_rocks_04_ao_1k.jpg');

// Grass layer (aerial_grass_rock)
const grassDiff  = loadTex('/aerial_grass_rock_diff_1k.jpg', true);
const grassNorm  = loadTex('/aerial_grass_rock_nor_gl_1k.jpg');
const grassRough = loadTex('/aerial_grass_rock_rough_1k.jpg');

// Dirt layer (brown_mud_leaves_01)
const dirtDiff   = loadTex('/brown_mud_leaves_01_diff_1k.jpg', true);
const dirtNorm   = loadTex('/brown_mud_leaves_01_nor_gl_1k.jpg');
const dirtRough  = loadTex('/brown_mud_leaves_01_rough_1k.jpg');

// ═══════════════════════════════════════════════════════
// Fixed-pool chunked LOD terrain (V7)
// 25 permanent slots, zero allocation during traversal
// ═══════════════════════════════════════════════════════

/** One-time slot creation: allocates geometry, topology, mesh. Never freed. */
function createChunkSlot(lod, dx, dz) {
  const seg = lod.segments;
  const gridW = seg + 1;
  const gridVertCount = gridW * gridW;

  // Build base plane for local X/Z coords
  const tmpGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, seg, seg);
  tmpGeo.rotateX(-Math.PI / 2);
  const tmpPos = tmpGeo.getAttribute('position');
  const tmpIdx = tmpGeo.getIndex();

  // Compute edge indices (4 edges, named for stitching + skirts)
  // -Z edge (row 0, left->right)
  const edgeMinZ = []; for (let c = 0; c < gridW; c++) edgeMinZ.push(c);
  // +X edge (last col, top->bottom)
  const edgePlusX = []; for (let r = 0; r < gridW; r++) edgePlusX.push(r * gridW + gridW - 1);
  // +Z edge (last row, right->left)
  const edgePlusZ = []; for (let c = gridW - 1; c >= 0; c--) edgePlusZ.push((gridW - 1) * gridW + c);
  // -X edge (first col, bottom->top)
  const edgeMinX = []; for (let r = gridW - 1; r >= 0; r--) edgeMinX.push(r * gridW);
  const edges = [edgeMinZ, edgePlusX, edgePlusZ, edgeMinX];

  // Flatten edge indices -> skirt vertex mapping
  const edgeIndices = [];
  for (const e of edges) edgeIndices.push(...e);
  const skirtVertCount = edgeIndices.length;
  const totalVertCount = gridVertCount + skirtVertCount;

  // Allocate permanent arrays
  const posArr  = new Float32Array(totalVertCount * 3);
  const uvArr   = new Float32Array(totalVertCount * 2);
  const normArr = new Float32Array(totalVertCount * 3);
  const uv2Arr  = new Float32Array(totalVertCount * 2);

  // Write fixed local X/Z for grid vertices
  for (let i = 0; i < gridVertCount; i++) {
    posArr[i * 3]     = tmpPos.getX(i);
    posArr[i * 3 + 1] = 0;
    posArr[i * 3 + 2] = tmpPos.getZ(i);
  }

  // Write fixed local X/Z for skirt vertices (inward-nudged)
  for (let i = 0; i < skirtVertCount; i++) {
    const ei = edgeIndices[i];
    const ex = tmpPos.getX(ei), ez = tmpPos.getZ(ei);
    const ndx = -ex, ndz = -ez; // toward center (0,0)
    const len = Math.sqrt(ndx * ndx + ndz * ndz) || 1;
    const ni = gridVertCount + i;
    posArr[ni * 3]     = ex + (ndx / len) * SKIRT_INSET;
    posArr[ni * 3 + 1] = 0;
    posArr[ni * 3 + 2] = ez + (ndz / len) * SKIRT_INSET;
  }

  // Build permanent index buffer: grid triangles + skirt quads
  let skirtTriCount = 0;
  for (const e of edges) skirtTriCount += (e.length - 1) * 2;
  const oldIdxArr = tmpIdx.array;
  const idxArr = new Uint32Array(oldIdxArr.length + skirtTriCount * 3);
  idxArr.set(oldIdxArr);

  let idxPtr = oldIdxArr.length;
  let skirtBase = gridVertCount;
  for (const edge of edges) {
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1];
      const c = skirtBase + i + 1, d = skirtBase + i;
      idxArr[idxPtr++] = a; idxArr[idxPtr++] = d; idxArr[idxPtr++] = c;
      idxArr[idxPtr++] = a; idxArr[idxPtr++] = c; idxArr[idxPtr++] = b;
    }
    skirtBase += edge.length;
  }

  // Create permanent geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvArr, 2));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normArr, 3));
  geo.setAttribute('uv2',      new THREE.BufferAttribute(uv2Arr, 2));
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));

  // Create permanent mesh
  const mat = lod.displacement ? matDisp : matNoDisp;
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  tmpGeo.dispose();

  return {
    dx, dz, lod, mesh, geo,
    gridW, gridVertCount, skirtVertCount, totalVertCount,
    edgeIndices,
    // Named edges for LOD stitching (in grid index order along each border)
    edgeMinZ, edgePlusZ, edgeMinX, edgePlusX,
    cx: Infinity, cz: Infinity,
  };
}

/** Compute vertex normals for grid vertices only, ignoring skirt faces. */
function computeGridNormals(geo, gridVertCount) {
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const idxArr = geo.getIndex().array;

  // Zero grid normals
  for (let i = 0; i < gridVertCount * 3; i++) norm.array[i] = 0;

  // Accumulate face normals — skip any face touching a skirt vertex
  for (let f = 0; f < idxArr.length; f += 3) {
    const a = idxArr[f], b = idxArr[f + 1], c = idxArr[f + 2];
    if (a >= gridVertCount || b >= gridVertCount || c >= gridVertCount) continue;

    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const e1x = pos.getX(b) - ax, e1y = pos.getY(b) - ay, e1z = pos.getZ(b) - az;
    const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    const na = norm.array;
    na[a*3] += nx; na[a*3+1] += ny; na[a*3+2] += nz;
    na[b*3] += nx; na[b*3+1] += ny; na[b*3+2] += nz;
    na[c*3] += nx; na[c*3+1] += ny; na[c*3+2] += nz;
  }

  // Normalize grid, set skirt normals to (0,-1,0)
  const na = norm.array;
  for (let i = 0; i < gridVertCount; i++) {
    const x = na[i*3], y = na[i*3+1], z = na[i*3+2];
    const len = Math.sqrt(x*x + y*y + z*z) || 1;
    na[i*3] = x/len; na[i*3+1] = y/len; na[i*3+2] = z/len;
  }
  for (let i = gridVertCount; i < pos.count; i++) {
    na[i*3] = 0; na[i*3+1] = -1; na[i*3+2] = 0;
  }
  norm.needsUpdate = true;
}

/** Constrain high-res edge vertices to match lower-res neighbor interpolation. */
function stitchEdge(pos, edgeVerts, ratio) {
  for (let i = 0; i < edgeVerts.length; i++) {
    if (i % ratio !== 0) {
      const prev = Math.floor(i / ratio) * ratio;
      const next = Math.min(prev + ratio, edgeVerts.length - 1);
      const t = (i - prev) / (next - prev);
      const y = pos.getY(edgeVerts[prev]) * (1 - t) + pos.getY(edgeVerts[next]) * t;
      pos.setY(edgeVerts[i], y);
    }
  }
}

/** Get LOD for a ring position (clamped to visible grid). */
function lodForRingPos(dx, dz) {
  const d = Math.max(Math.abs(dx), Math.abs(dz));
  return d === 0 ? LOD_NEAR : d === 1 ? LOD_MID : LOD_FAR;
}

/** Mutate existing buffers in-place. Zero allocation. */
function rebuildChunkSlot(slot, centerCX, centerCZ) {
  const cx = centerCX + slot.dx;
  const cz = centerCZ + slot.dz;
  if (cx === slot.cx && cz === slot.cz) return false;
  slot.cx = cx;
  slot.cz = cz;

  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  const pos  = slot.geo.getAttribute('position');
  const uv   = slot.geo.getAttribute('uv');
  const uv2  = slot.geo.getAttribute('uv2');

  // Update grid vertices: Y from heightfield, UVs from world pos
  for (let i = 0; i < slot.gridVertCount; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    const wx = lx + originX, wz = lz + originZ;
    pos.setY(i, terrainHeight(wx, wz) * MACRO_HEIGHT_SCALE);
    const u = wx / TEXTURE_WORLD_SIZE, v = wz / TEXTURE_WORLD_SIZE;
    uv.setXY(i, u, v);
    uv2.setXY(i, u, v);
  }

  // LOD edge stitching: constrain border vertices where neighbor is lower-res
  const mySegs = slot.lod.segments;
  const stitchDirs = [
    { ddx:  0, ddz: -1, edge: slot.edgeMinZ  },
    { ddx:  0, ddz:  1, edge: slot.edgePlusZ  },
    { ddx: -1, ddz:  0, edge: slot.edgeMinX   },
    { ddx:  1, ddz:  0, edge: slot.edgePlusX  },
  ];
  for (const s of stitchDirs) {
    const nSegs = lodForRingPos(slot.dx + s.ddx, slot.dz + s.ddz).segments;
    if (nSegs < mySegs) {
      stitchEdge(pos, s.edge, mySegs / nSegs);
    }
  }

  // Update skirt vertices: Y = edge Y - depth, UV = edge UV
  for (let i = 0; i < slot.skirtVertCount; i++) {
    const ei = slot.edgeIndices[i];
    const ni = slot.gridVertCount + i;
    pos.setY(ni, pos.getY(ei) - SKIRT_DEPTH);
    uv.setXY(ni, uv.getX(ei), uv.getY(ei));
    uv2.setXY(ni, uv.getX(ei), uv.getY(ei));
  }

  pos.needsUpdate = true;
  uv.needsUpdate = true;
  uv2.needsUpdate = true;

  // Compute normals for grid only — skirt faces excluded
  computeGridNormals(slot.geo, slot.gridVertCount);

  slot.mesh.position.set(originX, 0, originZ);
  slot.geo.computeBoundingSphere();
  return true;
}

// ───── Materials: near/mid share one, far has no displacement ─────
function createMaterial(useDisplacement) {
  // Base material uses rock as the "primary" layer for three.js internals
  const mat = new THREE.MeshStandardMaterial({
    map: rockDiff,
    normalMap: rockNorm,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: rockRough,
    aoMap: rockAo,
    aoMapIntensity: 1.0,
    envMapIntensity: 0.3,
  });
  if (useDisplacement) {
    mat.displacementMap = rockDisp;
    mat.displacementScale = 0.25;
    mat.displacementBias = -0.1;
  }
  return mat;
}

const matDisp   = createMaterial(true);
const matNoDisp = createMaterial(false);

// ═══════════════════════════════════════════════════════
// Biome blending shader (V5.1)
// 3 layers: grass (flat), dirt (transition), rock (steep/tri-planar)
// Per-layer world scales, height-biased rock, reduced dirt dominance
// ═══════════════════════════════════════════════════════

function applyBiomeShader(material) {
  material.onBeforeCompile = (shader) => {
    // Uniforms: biome textures + scale
    shader.uniforms.rockScale    = { value: 1.0 / ROCK_WORLD_SIZE };
    shader.uniforms.grassScale   = { value: 1.0 / GRASS_WORLD_SIZE };
    shader.uniforms.dirtScale    = { value: 1.0 / DIRT_WORLD_SIZE };
    shader.uniforms.chunkHalf    = { value: CHUNK_SIZE / 2 };
    shader.uniforms.grassDiffMap = { value: grassDiff };
    shader.uniforms.grassRoughMap = { value: grassRough };
    shader.uniforms.dirtDiffMap  = { value: dirtDiff };
    shader.uniforms.dirtRoughMap = { value: dirtRough };

    // ── Vertex: world-space varyings ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform float chunkHalf;`
    );
    // Edge displacement fade: reduce micro displacement near chunk borders
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

    // ── Fragment: declarations + biome noise + helpers ──
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

      // Simple hash-based noise for biome variation (no per-frag FBM)
      float biomeHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float biomeNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // smoothstep
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
      // ── Shared variables: per-layer UVs ──
      vec3 triWeights = pow(abs(vWorldNormal), vec3(4.0));
      triWeights /= (triWeights.x + triWeights.y + triWeights.z + 1e-6);
      float slope = 1.0 - abs(vWorldNormal.y);
      // Rock: tri-planar UVs at rock scale
      vec2 triUvX = vWorldPosition.zy * rockScale;
      vec2 triUvY = vWorldPosition.xz * rockScale;
      vec2 triUvZ = vWorldPosition.xy * rockScale;
      // Grass/dirt: flat planar UVs at their own scales
      vec2 grassUv = vWorldPosition.xz * grassScale;
      vec2 dirtUv  = vWorldPosition.xz * dirtScale;

      // ── Biome weights ──
      float bNoise = biomeNoise(vWorldPosition.xz * 0.03);
      // Height factor: rock dominates more at higher elevations
      float heightBias = smoothstep(4.0, 9.0, vWorldPosition.y) * 0.3;
      float wRock  = smoothstep(0.35, 0.65, slope + heightBias);
      // Grass dominates flat areas; dirt is a narrower transition
      float flatWeight = 1.0 - wRock;
      float wGrass = flatWeight * smoothstep(0.25, 0.6, bNoise);
      float wDirt  = flatWeight * (1.0 - smoothstep(0.2, 0.55, bNoise)) * 0.6;
      // Normalize
      float wSum = wRock + wGrass + wDirt + 1e-6;
      wRock /= wSum; wGrass /= wSum; wDirt /= wSum;

      #ifdef USE_MAP
        // Rock: tri-planar sampled (handles cliffs)
        vec4 rockCol = texture2D(map, triUvX) * triWeights.x
                     + texture2D(map, triUvY) * triWeights.y
                     + texture2D(map, triUvZ) * triWeights.z;
        // Grass & dirt: flat planar UV at per-layer scales
        vec4 grassCol = texture2D(grassDiffMap, grassUv);
        vec4 dirtCol  = texture2D(dirtDiffMap, dirtUv);

        vec4 sampledDiffuseColor = rockCol * wRock
                                 + grassCol * wGrass
                                 + dirtCol * wDirt;
        diffuseColor *= sampledDiffuseColor;
      #endif
      `
    );

    // ── Roughness: biome-blended ──
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

    // ── Normals: save geometry normal, then override per biome ──
    // Save geometry normal BEFORE standard chunk applies rock normal map
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      vec3 geoNormal = normal; // geometry normal in view space, pre-perturbation
      `
    );

    // After standard chunk runs rock normal map, replace with biome blend
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      #ifdef USE_NORMALMAP_TANGENTSPACE
      {
        // geoNormal = geometry normal (no rock perturbation)
        // normal = rock UV-perturbed (from standard chunk)
        vec3 flatNormal = geoNormal; // grass/dirt use clean geometry normal

        // Rock: tri-planar Whiteout (Golus) — only computed where needed
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

        // Blend: flat areas keep standard normal, steep areas use rock tri-planar
        normal = normalize(mix(flatNormal, rockNrmView, wRock));
      }
      #endif
      `
    );

    // ── AO: undo rock AO from standard chunk; reapply only for rock areas ──
    // Standard chunk applies rock AO to everything. We need to:
    // 1. Undo that (divide out stdAO)
    // 2. Reapply: rock gets tri-planar rock AO, grass/dirt get 1.0 (no AO)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      #ifdef USE_AOMAP
      {
        float uvAoVal = texture2D(aoMap, vAoMapUv).r;
        float stdAO = (uvAoVal - 1.0) * aoMapIntensity + 1.0;
        // Rock: tri-planar AO
        float triAoVal = texture2D(aoMap, triUvX).r * triWeights.x
                       + texture2D(aoMap, triUvY).r * triWeights.y
                       + texture2D(aoMap, triUvZ).r * triWeights.z;
        float rockAO = (triAoVal - 1.0) * aoMapIntensity + 1.0;
        // Grass/dirt: no AO darkening (1.0)
        float biomeAO = mix(1.0, rockAO, wRock);
        // Correct: undo standard, apply biome
        float aoCorrection = biomeAO / max(stdAO, 0.001);
        reflectedLight.indirectDiffuse *= aoCorrection;
      }
      #endif
      `
    );
  };
  material.customProgramCacheKey = () => 'biome_v6';
}

// Apply biome shader to both material variants
applyBiomeShader(matDisp);
applyBiomeShader(matNoDisp);

// ═══════════════════════════════════════════════════════
// Procedural foliage instancing (V8)
// 3 layers: grass clumps, small rocks, bushes
// Near + mid slots only, deterministic placement
// ═══════════════════════════════════════════════════════

// Deterministic hash for placement
function placeHash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ── Grass clump geometry: 2 crossed quads ──
function makeGrassGeo() {
  const g = new THREE.BufferGeometry();
  const hw = 0.3, hh = 0.5;
  const verts = new Float32Array([
    -hw,0,0, hw,0,0, hw,hh,0, -hw,hh,0,
    0,0,-hw, 0,0,hw, 0,hh,hw, 0,hh,-hw,
  ]);
  const idx = [0,1,2, 0,2,3, 4,5,6, 4,6,7];
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Rock geometry: squashed icosahedron ──
function makeRockGeo() {
  const g = new THREE.IcosahedronGeometry(0.3, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.5);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ── Shrub geometry: small sphere-ish cluster ──
function makeShrubGeo() {
  return new THREE.IcosahedronGeometry(0.25, 1);
}

const grassGeo = makeGrassGeo();
const rockGeo  = makeRockGeo();
const shrubGeo = makeShrubGeo();

const grassMat = new THREE.MeshLambertMaterial({ color: 0x4a7a2e, side: THREE.DoubleSide });
const rockMat  = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.9 });
const shrubMat = new THREE.MeshLambertMaterial({ color: 0x3d6b2e });

const _dummy = new THREE.Object3D();

/** Create persistent InstancedMesh for a slot. Returns instance payload. */
function createFoliageInstances(maxGrass, maxRock, maxShrub) {
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, maxGrass);
  const rock  = new THREE.InstancedMesh(rockGeo, rockMat, maxRock);
  const shrub = new THREE.InstancedMesh(shrubGeo, shrubMat, maxShrub);
  grass.frustumCulled = false;
  rock.frustumCulled = false;
  shrub.frustumCulled = false;
  scene.add(grass); scene.add(rock); scene.add(shrub);
  return { grass, rock, shrub };
}

/** Regenerate foliage transforms for a slot. Deterministic from (cx, cz). */
function rebuildFoliage(foliage, cx, cz, isFar) {
  if (isFar) {
    foliage.grass.count = 0;
    foliage.rock.count = 0;
    foliage.shrub.count = 0;
    return;
  }

  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const half = CHUNK_SIZE / 2;
  let gi = 0, ri = 0, si = 0;

  // Scatter points using deterministic grid + jitter
  const step = 1.6; // ~1.6m spacing for grass candidates
  const seed = cx * 7919 + cz * 104729;

  for (let lz = -half + 1; lz < half - 1; lz += step) {
    for (let lx = -half + 1; lx < half - 1; lx += step) {
      const wx = lx + originX, wz = lz + originZ;
      // Jitter
      const jx = (placeHash(wx * 13.7, wz * 29.3) - 0.5) * step * 0.8;
      const jz = (placeHash(wx * 41.1, wz * 7.9) - 0.5) * step * 0.8;
      const px = wx + jx, pz = wz + jz;

      const h = terrainHeight(px, pz) * MACRO_HEIGHT_SCALE;

      // Compute slope from finite differences
      const eps = 0.5;
      const hx = terrainHeight(px + eps, pz) * MACRO_HEIGHT_SCALE;
      const hz = terrainHeight(px, pz + eps) * MACRO_HEIGHT_SCALE;
      const fdx = (hx - h) / eps, fdz = (hz - h) / eps;
      const slope = Math.sqrt(fdx * fdx + fdz * fdz);
      const flatness = Math.max(0, 1 - slope * 1.5);

      // Biome noise (must match shader)
      const bn = placeHash(Math.floor(px * 0.03) + 0.5, Math.floor(pz * 0.03) + 0.5);

      // Placement probability from hash
      const prob = placeHash(px * 97.1 + seed, pz * 53.7 + seed);

      // ── Grass: high flatness, high grass weight ──
      const wGrass = flatness * Math.max(0, Math.min(1, (bn - 0.25) / 0.35));
      if (prob < wGrass * 0.5 && gi < GRASS_PER_CHUNK) {
        _dummy.position.set(px - originX, h, pz - originZ);
        const sc = 0.7 + placeHash(px * 3.1, pz * 5.7) * 0.8;
        _dummy.scale.set(sc, sc + placeHash(px * 11.3, pz * 2.1) * 0.5, sc);
        _dummy.rotation.y = placeHash(px * 7.7, pz * 13.3) * Math.PI * 2;
        _dummy.updateMatrix();
        foliage.grass.setMatrixAt(gi++, _dummy.matrix);
      }

      // ── Rock: steeper or rockier areas ──
      const wRock = Math.min(1, slope * 2);
      if (prob > 0.85 && wRock > 0.2 && ri < ROCK_PER_CHUNK) {
        _dummy.position.set(px - originX, h - 0.05, pz - originZ);
        const sc = 0.4 + placeHash(px * 17.3, pz * 23.1) * 1.2;
        _dummy.scale.set(sc, sc * 0.6, sc);
        _dummy.rotation.set(
          placeHash(px * 2.3, pz * 9.1) * 0.3,
          placeHash(px * 5.1, pz * 3.7) * Math.PI * 2,
          placeHash(px * 8.9, pz * 1.3) * 0.3
        );
        _dummy.updateMatrix();
        foliage.rock.setMatrixAt(ri++, _dummy.matrix);
      }

      // ── Shrub: transition zones (moderate grass) ──
      const wShrub = flatness * Math.max(0, 1 - Math.abs(bn - 0.45) * 4);
      if (prob > 0.7 && prob < 0.85 && wShrub > 0.2 && si < SHRUB_PER_CHUNK) {
        _dummy.position.set(px - originX, h, pz - originZ);
        const sc = 0.5 + placeHash(px * 19.7, pz * 31.3) * 0.7;
        _dummy.scale.set(sc, sc * 1.2, sc);
        _dummy.rotation.y = placeHash(px * 43.1, pz * 17.9) * Math.PI * 2;
        _dummy.updateMatrix();
        foliage.shrub.setMatrixAt(si++, _dummy.matrix);
      }
    }
  }

  foliage.grass.count = gi;
  foliage.rock.count = ri;
  foliage.shrub.count = si;
  foliage.grass.instanceMatrix.needsUpdate = true;
  foliage.rock.instanceMatrix.needsUpdate = true;
  foliage.shrub.instanceMatrix.needsUpdate = true;

  // Position instance meshes at chunk world origin
  foliage.grass.position.set(originX, 0, originZ);
  foliage.rock.position.set(originX, 0, originZ);
  foliage.shrub.position.set(originX, 0, originZ);
}

// ═══════════════════════════════════════════════════════
// Fixed 25-slot ring — zero allocation during traversal
// ═══════════════════════════════════════════════════════
const slots = [];
let centerCX = Infinity, centerCZ = Infinity;

// Build ring offsets: near(1) + mid(8) + far(16) = 25 slots
function buildSlots() {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      const lod = d === 0 ? LOD_NEAR : d === 1 ? LOD_MID : LOD_FAR;
      const slot = createChunkSlot(lod, dx, dz);
      // Attach foliage instances (near + mid only, far gets empty)
      slot.foliage = createFoliageInstances(GRASS_PER_CHUNK, ROCK_PER_CHUNK, SHRUB_PER_CHUNK);
      slots.push(slot);
    }
  }
  console.log(`[terrain] ${slots.length} permanent slots + foliage created`);
}

function updateChunks() {
  const camCX = Math.round(controls.target.x / CHUNK_SIZE);
  const camCZ = Math.round(controls.target.z / CHUNK_SIZE);
  if (camCX === centerCX && camCZ === centerCZ) return;
  centerCX = camCX;
  centerCZ = camCZ;

  let rebuilt = 0;
  for (const slot of slots) {
    if (rebuildChunkSlot(slot, centerCX, centerCZ)) {
      const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
      rebuildFoliage(slot.foliage, slot.cx, slot.cz, d >= 2);
      rebuilt++;
    }
  }
  if (rebuilt > 0) {
    console.log(`[terrain] rebuilt ${rebuilt} slots, center: (${centerCX}, ${centerCZ})`);
  }
}

buildSlots();
updateChunks();

// ═══════════════════════════════════════════════════════
// WASD / arrow-key movement
// ═══════════════════════════════════════════════════════
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _delta = new THREE.Vector3();
const moveState = { forward: false, back: false, left: false, right: false, fast: false };

function setMoveKey(code, down) {
  if (code === 'KeyW' || code === 'ArrowUp')        moveState.forward = down;
  else if (code === 'KeyS' || code === 'ArrowDown')  moveState.back = down;
  else if (code === 'KeyA' || code === 'ArrowLeft')  moveState.left = down;
  else if (code === 'KeyD' || code === 'ArrowRight') moveState.right = down;
  else if (code === 'ShiftLeft' || code === 'ShiftRight') moveState.fast = down;
  else return false;
  return true;
}

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (setMoveKey(e.code, true)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { setMoveKey(e.code, false); });

function applyMovement(dt) {
  _fwd.copy(controls.target).sub(camera.position);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) return;
  _fwd.normalize();
  _right.crossVectors(_fwd, camera.up).normalize();

  _delta.set(0, 0, 0);
  if (moveState.forward) _delta.add(_fwd);
  if (moveState.back)    _delta.sub(_fwd);
  if (moveState.right)   _delta.add(_right);
  if (moveState.left)    _delta.sub(_right);
  if (_delta.lengthSq() === 0) return;

  const speed = moveState.fast ? 55 : 28;
  _delta.normalize().multiplyScalar(speed * dt);
  camera.position.add(_delta);
  controls.target.add(_delta);
}

// ═══════════════════════════════════════════════════════
// Screenshot button (render-to-target, no preserveDrawingBuffer)
// ═══════════════════════════════════════════════════════
const screenshotBtn = document.getElementById('screenshotBtn');
const shotStatusEl  = document.getElementById('shotStatus');
let screenshotBusy = false;

function setShotStatus(msg, err = false) {
  shotStatusEl.textContent = msg;
  shotStatusEl.classList.toggle('error', err);
}

function captureToDataURL() {
  const sz = new THREE.Vector2();
  renderer.getDrawingBufferSize(sz);
  const w = Math.max(1, Math.floor(sz.x));
  const h = Math.max(1, Math.floor(sz.y));
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  if (renderer.capabilities.isWebGL2) rt.samples = 4;

  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);

  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(prev);
  rt.dispose();

  // Flip Y into temp canvas
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    img.data.set(px.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

async function takeScreenshot() {
  if (screenshotBusy) return;
  screenshotBusy = true;
  screenshotBtn.disabled = true;
  setShotStatus('Capturing...');
  try {
    controls.update(); updateChunks();
    renderer.render(scene, camera);

    const image = captureToDataURL();
    const label = `terrain_${centerCX}_${centerCZ}`;
    const resp = await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, label, format: 'png' }),
    });
    if (!resp.ok) throw new Error(`upload ${resp.status}`);
    const result = await resp.json();
    const copied = await copyToClipboard(result.filename);
    const url = new URL(result.path, location.href).href;
    setShotStatus(`${result.filename}${copied ? ' (copied)' : ''} — ${url}`);
  } catch (err) {
    console.error('[screenshot]', err);
    setShotStatus(`Failed: ${err.message}`, true);
  } finally {
    screenshotBusy = false;
    screenshotBtn.disabled = false;
  }
}

screenshotBtn.addEventListener('click', takeScreenshot);

// ───── Resize (preserve current DPR) ─────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr.ctrl.current);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Expose for debug console access
if (debugMode) {
  window.__controls = controls;
  window.__camera = camera;
  window.__scene = scene;
}

// ───── FPS ─────
const fpsEl = document.getElementById('fps');
let frameCount = 0, lastTime = performance.now();
let prevTime = performance.now();

// ───── Animate ─────
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevTime) / 1000);
  prevTime = now;

  applyMovement(dt);
  controls.update();
  updateChunks();
  renderer.render(scene, camera);

  frameCount++;
  if (now - lastTime >= 500) {
    const fps = frameCount / ((now - lastTime) / 1000);
    const dprInfo = dpr.ctrl.mode === 'auto'
      ? ` | dpr ${dpr.ctrl.current.toFixed(2)} | auto`
      : ` | dpr ${dpr.ctrl.current.toFixed(2)}`;
    fpsEl.textContent = `${fps.toFixed(0)} fps${dprInfo}`;
    dpr.update(fps, now - lastTime);
    updateDprButtons();
    frameCount = 0;
    lastTime = now;
  }
}

animate();
console.log(`[terrain] v8.3 — adaptive DPR (mode: ${dpr.ctrl.mode}, initial: ${dpr.ctrl.current})`);
