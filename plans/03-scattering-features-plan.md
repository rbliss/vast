# Scattering Features Recreation Plan

## Intent

Recreate World Creator-style object scattering as a **general scatter graph + asset registry**, not as special-purpose foliage logic. The existing repo’s deterministic foliage system is a useful proof of concept, but it is far too narrow to cover the requested feature surface.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Noise Distributions NEW | Use blue-noise/importance sampling seeded by coherent noise fields so object placement looks natural but stays deterministic. | Phase 1 |
| Terrain Distributions NEW | Gate placement with terrain metrics such as slope, height, aspect, wetness, snow depth, and biome membership. | Phase 1 |
| Layer Distributions NEW | Let scatter rules reference painted masks, material layers, and biome layers directly instead of duplicating data. | Phase 1 |
| Procedural Scattering NEW | Replace the current hardcoded foliage rebuild with a reusable scatter graph that outputs clustered instance cells. | Phase 1 |
| Collision Exclusion NEW | Add occupancy/collision masks plus radius-based rejection to avoid overlapping instances and conflicting categories. | Phase 2 |
| Emissive Materials NEW | Allow emissive-capable object materials and per-instance intensity variation for lanterns, lava plants, etc. | Phase 2 |
| Any Format NEW | Start with GLB/GLTF/OBJ imports; add FBX only if a stable browser-side pipeline proves worthwhile. | Phase 2 |
| Megascans Support NEW | Normalize imported scanned assets into a local asset registry with LODs, material remaps, and licensing metadata. | Phase 2 |
| Sub Object Scattering NEW | Support recursive scatter rules where an instance category can emit child scatter anchors or surface masks. | Phase 3 |
| Manual Placement NEW | Add a scene/object layer for hand-placed transforms plus brush-based object painting. | Phase 1 |
| Distribution Scaling NEW | Expose scale randomization and biome/metric-driven scale curves as first-class per-category attributes. | Phase 1 |
| Distribution Gradient NEW | Support per-instance hue/value/seasonal tint offsets sourced from gradients and scalar fields. | Phase 2 |
| Instancing NEW | Adopt cell-based GPU instancing with frustum/LOD culling and export compatibility with EXT_mesh_gpu_instancing. | Phase 1 |
| Terrain Blending NEW | Blend instance bases with terrain using depth/height/normal-aware material tricks, decals, or anchor masks. | Phase 2 |
| Custom Shading NEW | Allow category-level material variants (stylized, PBR, wind-reactive, emissive) while keeping a shared asset schema. | Phase 2 |
| Royalty Free Assets Included NEW | Treat included meshes as starter content packs; the editor should not depend on them for feature completeness. | Asset-pack track |
| Optional Alignment NEW | Let each scatter rule choose slope alignment, partial alignment, or strict upright placement. | Phase 1 |
| Scatter on other Objects NEW | Sample arbitrary meshes via BVH/surface area sampling so vines, moss, props, and decals can live on non-terrain surfaces. | Phase 3 |

## Best-fit architecture for this category

### 1. Canonical scatter rule model
Each scatter category should define:
- source asset(s)
- placement domain (terrain / mesh / spline / biome / mask)
- density function
- collision radius / exclusion class
- orientation/alignment policy
- scale/color variation
- material/shading override
- export category + metadata

### 2. Cell-based instance storage
- Store instances by spatial cells (terrain tiles / object cells), not one giant list.
- Each cell should be independently rebuildable, culled, and exportable.
- This matches both runtime performance and EXT_mesh_gpu_instancing guidance.

### 3. Asset ingestion order
- First-class browser path: **GLB/GLTF**, then OBJ.
- Optional later path: FBX via third-party loader if the workflow is worth the cost.
- Normalize every imported asset into a local registry entry containing:
  - mesh/LOD refs
  - material bindings
  - collision bounds
  - tags / biome suitability
  - licensing/source metadata

### 4. Placement algorithms
- Base placement: stratified / blue-noise / Poisson-like rejection sampling.
- Then weight by masks and terrain metrics.
- Then resolve collisions / exclusion.
- Then decorate with scale/gradient/orientation variation.
- Then batch into instanced cells.

## Suggested execution path

### Phase A — replace hardcoded foliage with a general scatter graph
- Convert the current foliage system into asset categories + distribution rules.
- Keep instancing and cell rebuild logic.
- Add manual placement and paint placement.

### Phase B — robust scatter authoring
- Add biome/material/mask-linked distributions.
- Add collision exclusion, scale variation, tint variation, alignment options.
- Add imported asset registry with previews and tags.

### Phase C — advanced surface-aware scattering
- Scatter on arbitrary meshes.
- Sub-object scattering / recursive decoration.
- Terrain blending at object bases.
- Export instance maps and DCC/engine-ready manifests.

## Risks / gotchas
- The browser can display millions of instances only if culling and material batching are disciplined.
- “Any format” should not become a bottomless loader problem; a curated set of reliable formats is better.
- Terrain blending looks simple in screenshots but usually requires deliberate material tricks or decals.
- Recursive/sub-object scattering can explode rebuild costs if not cell-bounded and memoized.

## Research notes that informed this plan
- World Creator’s release notes are unusually explicit here: the product talks about millions of assets, collision exclusion, terrain blending, and biome integration as one system: https://docs.world-creator.com/release-notes/version-2025.x/world-creator-2025.1
- Three.js InstancedMesh is the immediate runtime building block: https://threejs.org/docs/pages/InstancedMesh.html
- Khronos’ EXT_mesh_gpu_instancing is the right export/interchange anchor for large instance sets: https://wallabyway.github.io/Khronos-glTF-repo-GHPages-test/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/
- Hierarchical / additive Poisson disk work supports the blue-noise placement direction for dense worlds: https://diglib.eg.org/handle/10.2312/vmv20181256
- Houdini’s flow-field and scattering docs reinforce the value of using derived terrain layers to drive placement, not bespoke per-category heuristics: https://www.sidefx.com/docs/houdini/heightfields/flowfields.html ; https://www.sidefx.com/docs/houdini/heightfields/scatterattribs.html

## Latest browser-native techniques to prefer

- **GPU-driven scatter evaluation:** move candidate generation, mask testing, and visible-instance compaction into WebGPU compute where practical, writing per-cell instance buffers instead of rebuilding everything on the CPU. References: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- **Modern instancing/export formats:** keep runtime rendering and export aligned around InstancedMesh/GLB/EXT_mesh_gpu_instancing rather than proprietary instance blobs. References: https://threejs.org/docs/pages/InstancedMesh.html ; https://wallabyway.github.io/Khronos-glTF-repo-GHPages-test/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/
- **GPU-driven rendering where engine support allows it:** raw WebGPU `drawIndirect` / `drawIndexedIndirect` is the long-term path for compacted per-cell draws once the renderer abstraction allows it; until then, cluster aggressively and stay within Three.js abstractions. References: https://gpuweb.github.io/types/interfaces/GPURenderPassEncoder.html ; https://www.w3.org/TR/webgpu/
- **Workerized import preprocessing:** mesh bounds, LOD metadata, collision radii, and material normalization should be prepared in workers using transferables. References: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- **Spatial structures that fit the browser:** use loose grids / tile cells first, then add CPU BVHs for imported-mesh surface sampling and, later, GPU-friendly compaction/culling data. For geospatial/vector-driven scatter masks, FlatGeobuf-style spatial indexing is attractive. Reference: https://flatgeobuf.org/
- **Measure heavy passes with GPU queries:** timestamp/occlusion queries help decide if terrain blending, occlusion culling, or recursive scatter rules are worth enabling on the current device. References: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet ; https://developer.chrome.com/docs/web-platform/webgpu/developer-features

## Technique rationale

The modern browser path is not “just more InstancedMesh objects”; it is **GPU-assisted candidate filtering + cell-based instance ownership + export-compatible instance formats**. That gets much closer to a serious PCG scatter pipeline without abandoning web portability.

## Recommendation

The right upgrade is:

> **generalize the foliage system into a reusable scatter graph and cell-based asset instancing system before adding more object categories.**

That one move unlocks most of the entire scattering section.
