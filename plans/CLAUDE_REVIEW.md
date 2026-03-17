# Visual Quality Analysis: World Creator vs VAST

_Research compiled 2026-03-17 from reviewing ~40 images downloaded from https://www.world-creator.com/en/features.phtml_

## What makes their images look real

Looking across all images, the quality comes from **7 distinct systems working together**, not one magic technique:

### 1. Erosion-shaped terrain geometry
The single biggest quality difference. Their terrain isn't just noise — it has hydraulic erosion channels, thermal weathering, terrace formations, sediment deposits in valleys, and debris fans. These give terrain the branching drainage patterns visible in flow maps. Our terrain is smooth FBM noise — it looks procedural. Theirs looks geological.

### 2. High-density photoscanned asset scattering
Forest scenes have thousands of high-poly scanned trees, ferns, branches, rocks, and ground debris. Beach scenes have detailed palm trees, individual boulders, coral. Debris fields are thousands of scattered rock meshes. Our foliage is primitive geometry (crossed quads, squashed icosahedra).

### 3. PBR material quality with displacement
Close-up terrain surfaces show high-resolution photoscanned materials with real displacement, not just normal maps. Material transitions (rock to sand, snow to rock) use sophisticated blending driven by slope, height, curvature, and flow data.

### 4. Lighting and shadows
Strong directional sun with proper cascaded shadow maps creating long dramatic shadows (especially visible in forest floor scenes). Lava scenes show emissive materials with bloom. Atmospheric haze and aerial perspective create depth.

### 5. Water rendering
Beach/lagoon scenes show transparent shallow water with depth-based color, caustics, and shoreline foam. Lake scenes have reflections. These aren't trivial effects.

### 6. Volumetric atmosphere
Clouds wrapping mountains, fog in valleys, atmospheric scattering creating blue haze at distance. Snow scenes use volumetric snow/mist.

### 7. Post-processing
Depth of field (macro cactus shot), color grading/LUTs, bloom on emissives, tone mapping. These are the "cinematic polish" layer.

---

## The gap between us and them

| System | World Creator | VAST today |
|--------|-------------|-----------|
| Terrain shape | Erosion-carved, geologically plausible | Smooth FBM noise, no erosion |
| Materials | Photoscanned PBR with displacement | Tiled Polyhaven textures, no displacement |
| Material blending | Flow/curvature/erosion-driven | Slope-only biome blend |
| Vegetation | Thousands of scanned meshes | Primitive geometry placeholders |
| Shadows | Cascaded shadow maps | None |
| Water | Transparent, reflective, shoreline | None |
| Atmosphere | Volumetric clouds, haze, aerial perspective | Static sky cube + FogExp2 |
| Emissives | Lava flows, bloom | None |
| Post-processing | DOF, LUTs, bloom, tone mapping | Basic ACES tone mapping only |

---

## Plan: How to get there in the browser

Ordered by **visual impact per effort**:

### Phase 1 — Biggest visual wins
1. **Cascaded shadow maps** — Single biggest missing rendering feature. Three.js supports CSM. Dramatic improvement for pennies.
2. **Hydraulic erosion** — GPU compute erosion on the heightfield. Transforms terrain from "procedural noise" to "believable geology." This is the #1 content quality gap.
3. **Better atmosphere** — Replace static sky + FogExp2 with height-based fog, aerial perspective, and a procedural sky with sun disk. Bruneton-style or simpler approximation.

### Phase 2 — Material & surface quality
4. **Displacement mapping** — True vertex displacement from material heightmaps at close range (we have the LOD system for this — high-res chunks near camera).
5. **Derived-map material blending** — Use erosion/flow/curvature/cavity maps to drive material distribution instead of just slope. This is what makes their terrain surfaces look natural rather than banded.
6. **Higher-quality PBR textures** — Source better scan-based texture sets, use KTX2 compression. Increase tri-planar quality with detail maps.

### Phase 3 — Vegetation & objects
7. **Real vegetation meshes** — Replace placeholder geometry with actual tree/plant/rock models (GLB imports). This is mostly an asset problem, not a rendering problem.
8. **Dense GPU-instanced scattering** — Scale from hundreds to tens of thousands of instances per chunk. Frustum culling, LOD billboards for distant trees.
9. **Terrain blending at object bases** — Depth-based blending so objects don't float on terrain.

### Phase 4 — Water & advanced rendering
10. **Water bodies** — Planar reflections, depth-based transparency, shoreline foam, simple wave animation.
11. **Volumetric clouds** — Raymarched 3D noise volumes, or at minimum layered cloud planes with soft edges.
12. **Emissive materials + bloom** — For lava, snow glow, magical terrain types.

### Phase 5 — Cinematic polish
13. **Post-processing stack** — DOF, LUT color grading, vignette, chromatic aberration for captures.
14. **Camera sequencer** — Keyframed camera paths for video/screenshot capture.

## What NOT to chase
- **Ray tracing** — Not available in browser WebGPU. Their RT images are marketing captures, not the editing viewport.
- **Full DCC scene composition** — The furniture/checkerboard scene is a DCC showcase, not a terrain feature.
- **Literally copying their asset library** — We need a good asset pipeline, not 140 specific scans.

## Browser-specific constraints to respect
- WebGPU compute for erosion/flow simulation (not CPU)
- Texture memory budget (~320 MiB GPU for terrain+materials on mid-tier)
- Instance count limits (GPU-driven indirect draw when possible)
- No hardware RT — all reflections/GI must be raster or screen-space

---

## Bottom line

**Erosion + shadows + atmosphere** gets us 70% of the visual quality gap closed. Everything else is incremental polish on top of that foundation.
