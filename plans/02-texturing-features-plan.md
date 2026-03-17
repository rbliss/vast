# Texturing Features Recreation Plan

## Intent

Recreate the World Creator texturing feature set using a **layered material-authoring system** that can drive both the live WebGPU viewport and downstream exports. The current repo already has a strong terrain shader, which makes this category one of the most achievable.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Displacement NEW | Keep a render-time displacement path for close-range preview, but make all export-critical displacement bake back into height data. | Phase 2 |
| Real World Color Mixer | Offer reference-driven palette extraction from uploaded images and curated presets, then map palettes onto biomes/material layers. | Phase 2 |
| Megascans Support NEW | Treat Quixel/Fab assets as an import adapter layer that normalizes texture sets into the engine’s material-recipe schema. | Phase 2 |
| Simple Colors | Support flat/albedo-only material layers for prototyping, stylized modes, and cartographic outputs. | Phase 1 |
| PBR Textures | Model terrain materials as reusable PBR recipes with albedo/normal/roughness/ao/height inputs plus shared tiling rules. | Phase 1 |
| Adobe Substance Materials | Integrate via imported baked PBR outputs first; defer live Substance graph evaluation to an external/offline adapter. | Phase 3 |
| Gradients | Expose curve/gradient assets as first-class color sources that can target altitude, slope, masks, or arbitrary scalar fields. | Phase 1 |
| Gradient Details NEW | Blend detail gradients at a smaller world scale to break up broad color bands without muddying the biome read. | Phase 2 |
| Gradient Sets Included | Ship curated preset gradients as data assets, not hardcoded shader branches. | Phase 1 |
| Cartography Coloring | Add a cartographic render/export mode driven by topo intervals, biome colors, and custom legend palettes. | Phase 2 |
| 140 Material Scans Included | Represent bundled scans as an asset-pack problem: metadata, previews, licensing notes, and ingestion tooling. | Asset-pack track |
| Emissive Materials NEW | Permit emissive channels in terrain materials and export them with bloom-aware intensity controls. | Phase 2 |
| Material Presets | Package multi-texture material recipes, distribution defaults, and shading knobs into shareable presets. | Phase 1 |
| Synthesize Gradients | Generate gradients procedurally from sampled palettes, terrain stats, and biome presets, then let artists refine them. | Phase 2 |
| Fluvial Advection / Color Erosion NEW | Advect color/material weights along precomputed flow vectors to mimic rain streaks, washout, and depositional staining. | Phase 3 |
| Noise Distributions | Drive material breakup from coherent noise masks with per-channel remap curves and seed control. | Phase 1 |
| Terrain Distributions | Use derived terrain metrics (height, slope, curvature, exposure, wetness) as the canonical material distribution inputs. | Phase 1 |
| Layer Distributions | Compose material layers with explicit stack order, masking, and blend operators so edits stay non-destructive. | Phase 1 |

## Best-fit architecture for this category

### 1. Material recipes, not one-off shaders
- Keep the runtime shader generation centralized, but change authoring to work in terms of **material recipes**:
  - albedo sources
  - normals
  - roughness / metalness / ao / emissive
  - detail/noise breakup
  - blend rules
  - export packing presets
- A recipe can be instanced inside multiple biomes and exported consistently.

### 2. Shared distribution inputs
Most World Creator texturing features become much easier if materials all read from the same canonical scalar fields:
- height
- slope / angle
- curvature
- flow / wetness
- cavity / occlusion-like masks
- biome weights
- manual masks
- noise fields

### 3. Viewport vs export split
- **Viewport:** NodeMaterial / TSL shading for immediate feedback.
- **Export:** baked texture sets, splat maps, gradients, biome maps, and engine-specific packing.
- This avoids trying to make every external engine reproduce the exact same runtime shader graph.

### 4. Third-party ecosystem support
- **Megascans:** import adapter that normalizes Fab/Quixel textures to local material recipes.
- **Substance:** first support baked outputs; later, optionally integrate a desktop/offline Substance evaluation path.
- **Bundled scans:** treat as content packs with metadata and previews.

## Suggested execution path

### Phase A — make the current shader authorable
- Split the current terrain material constants into editable material assets/presets.
- Add layered material weights and preview controls.
- Support simple colors, gradients, presets, and distribution rules.

### Phase B — proper PBR authoring
- Material library UI for texture-set import and tagging.
- Per-biome material stacks.
- Emissive support and cartographic mode.
- Export baking for albedo/normal/roughness/metalness.

### Phase C — advanced surface logic
- Flow-driven color advection.
- Gradient synthesis and palette extraction.
- Megascans import normalization.
- Substance baked-output ingestion pipeline.

## Risks / gotchas
- “Displacement” means two different things on the feature page: render-time surface detail and authoring-time heightfield modification. The plan must keep those separate.
- Live Substance evaluation inside a browser-first editor is a poor first milestone; baked outputs are the right first step.
- Emissive terrain needs consistent bloom/tone-map policy or it will look wrong between viewport and export.
- Cartography mode should be a deliberate alternate render/export path, not a pile of special cases in the main shader.

## Research notes that informed this plan
- World Creator’s docs and release notes confirm the category is really a combined material + gradient + distribution system: https://www.world-creator.com/en/features.phtml ; https://docs.world-creator.com/ ; https://docs.world-creator.com/release-notes/version-2025.x/world-creator-2025.1
- Three.js MeshStandardMaterial / PBR practice still anchors the expected texture semantics: https://threejs.org/docs/pages/MeshStandardMaterial.html
- Khronos’ glTF PBR guide is useful for defining export semantics, especially emissive strength and metallic/roughness packing: https://www.khronos.org/gltf/pbr
- Adobe’s developer pages clarify that Substance integration should be treated as an external ecosystem problem, not a tiny inline parser: https://developer.adobe.com/substance3d-sdk/ ; https://developer.adobe.com/substance-3d-automation/docs/
- World Creator’s own reference emphasizes biome + material + simulation grouping, which suggests keeping texturing tied to higher-level biome recipes: https://docs.world-creator.com/reference/terrain/biome

## Latest browser-native techniques to prefer

- **TSL/WebGPU authoring path:** keep terrain materials in TSL/NodeMaterial so the same authored recipes can stay backend-agnostic inside Three.js’ WebGPU path. References: https://threejs.org/manual/en/webgpurenderer ; https://threejs.org/docs/pages/WebGPURenderer.html
- **GPU-compressed source assets:** prefer KTX2/Basis textures for bundled scans, Megascans-like imports, and exported preview assets to reduce transfer and GPU memory pressure. References: https://threejs.org/docs/pages/KTX2Loader.html ; https://www.khronos.org/ktx ; https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
- **Compute-baked distribution maps:** derive material weights, slope bands, cavity/flow masks, and fluvial streak maps via WebGPU compute, then feed compact atlases/textures into the live shader. References: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- **Material indirection tables over naive sampler explosion:** WebGPU has explicit binding limits, so plan for material indirection tables, texture arrays, and tile-baked caches rather than assuming desktop-style bindless texturing. Reference baseline: https://www.w3.org/TR/webgpu/
- **Worker-side palette extraction and texture preprocessing:** color analysis, gradient synthesis, and import transcoding belong in workers and/or WASM helpers rather than the main UI thread. References: https://developer.mozilla.org/en-US/docs/WebAssembly ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

## Technique rationale

For browser-native texturing, the winning pattern is: **compressed assets in, compute-derived masks in the middle, compact material recipes at runtime, and baked outputs for export**. That plays to WebGPU’s strengths without pretending the browser is a desktop DCC host with unlimited texture bindings.

## Recommendation

The best path is:

> **build a data-driven material recipe system that feeds both the live terrain shader and the exporter, instead of trying to bolt lots of per-feature toggles onto the current shader file.**

That keeps texturing scalable and export-friendly.
