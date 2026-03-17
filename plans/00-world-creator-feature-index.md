# World Creator Feature Recreation Research Index

_Research compiled on 2026-03-17 for the current WebGPU-first terrain sandbox in this repo._

## Scope and assumptions

- The source feature inventory comes from https://www.world-creator.com/en/features.phtml and related official World Creator docs.
- These plans are **research + architecture plans only**. They intentionally avoid implementation work.
- The goal is not to clone World Creator literally, but to chart the most credible path to recreate comparable capabilities in a browser-first, Three.js + WebGPU terrain editor/runtime.
- Every feature listed on the World Creator feature page is covered below by category, plus the product-level asset-library section is addressed as an asset-pack concern.

## Cross-cutting architecture that nearly every feature depends on

1. **World document + layer stack**
   - Terrain layers, biome layers, mask layers, material layers, object layers, scene layers, and export presets must be serialized as a versioned document.
2. **Field graph**
   - Height, mask, flow, wetness, sediment, snow, biome weight, material weight, density, and shading fields should be represented as tiled scalar/vector fields, recomputed incrementally.
3. **Tile/clipmap streaming**
   - “Unlimited size” and “unlimited detail” are only believable with quadtree/clipmap terrain storage, floating origins, and selective recomputation.
4. **Deterministic job system**
   - Expensive terrain kernels need background workers or WebGPU compute, explicit quality tiers, caching, and cancelation.
5. **Unified asset registry**
   - Materials, gradients, object packs, presets, scans, and exports should flow through one metadata layer.
6. **Exporter/bridge layer**
   - File exporters come first; live bridges should sit on top of the stable exported intermediates.
7. **Scene layer**
   - Cameras, lights, clouds, water, hero props, atmosphere, and capture settings belong in scene layers instead of being scattered across ad hoc toggles.

## Recommended delivery ladder

- **Stage A – editor foundation:** layer stack, document schema, tiled fields, brush system, undo/redo, presets, basic exports.
- **Stage B – terrain authoring:** stamps, splines, masks, noise library, biome painting, derived terrain metrics.
- **Stage C – materials + scattering:** layered material recipes, scatter graph, instancing, asset ingestion, object painting.
- **Stage D – scene + rendering:** cameras, atmosphere, water, post stack, clouds, capture/export refinement.
- **Stage E – bridges + advanced sims:** engine-specific packaging, erosion/debris/snow/sand/fluid sophistication, sequencer, online asset sources.

## Browser-native technique baseline to prefer across the entire plan set

- **WebGPU-first field and render work:** prefer WebGPU compute/storage buffers/textures for terrain derivation, scatter evaluation, particle systems, and high-end capture paths; use raw WebGPU passes if the Three.js abstraction becomes the limiting factor. Relevant references: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API ; https://threejs.org/manual/en/webgpurenderer ; https://threejs.org/examples/webgpu_compute_particles.html
- **Workerized heavy work:** move imports, bakes, mesh conversion, and CPU fallbacks to Web Workers; use transferable ArrayBuffers and SharedArrayBuffer/WASM threads where security constraints allow. References: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects ; https://developer.mozilla.org/en-US/docs/WebAssembly ; https://developer.mozilla.org/en-US/docs/Web/API/SharedArrayBuffer
- **Local-first storage:** use OPFS for caches/autosaves/temp bakes, File System Access for user-visible projects/exports, and IndexedDB for structured metadata/search indexes. References: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system ; https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **Compressed, streamable assets:** prefer GLB + KTX2/Basis + EXT_mesh_gpu_instancing where possible to keep browser download and memory costs reasonable. References: https://threejs.org/docs/pages/KTX2Loader.html ; https://www.khronos.org/ktx ; https://www.khronos.org/gltf/pbr ; https://wallabyway.github.io/Khronos-glTF-repo-GHPages-test/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/
- **Browser-native geospatial streaming:** use HTTP range-friendly formats and windowed reads (GeoTIFF, PMTiles, FlatGeobuf) rather than giant whole-file downloads. References: https://geotiffjs.github.io/geotiff.js/ ; https://docs.protomaps.com/pmtiles/ ; https://flatgeobuf.org/
- **Capture/export pragmatism:** prefer image sequences plus optional WebCodecs encoding when supported; avoid building the product around assumptions of universal in-browser muxing or hardware RT. References: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ; https://github.com/gpuweb/gpuweb/issues/535
- **Measure, don’t guess:** use GPUQuerySet timestamp/occlusion queries where available to tune quality tiers and expensive passes. References: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet ; https://developer.chrome.com/docs/web-platform/webgpu/developer-features

## Plan files

### Crafting Features → `01-crafting-features-plan.md`

- Real-Time Terrain Generator HOT
- Unlimited Terrain Size HOT
- Unlimited Detail HOT
- River Generator
- 2D Terrain Stamping
- Grid Based Sculpting HOT
- 3D Terrain Stamping
- True Height Displacement NEW
- Polygon Tools for Lakes, Plateaus and Valleys
- Vector Tools for Paths, Rivers and Mountains
- Filter Presets
- 2D Primitive Tools
- Real-World Data Streaming
- Biome Painting NEW
- Sediment Filters
- Erosion Filters
- Arid Filters
- Terrace Filters NEW
- Effect Filters
- Drift Filters
- Noise Filters
- Snow Simulation NEW
- Fluid Simulation NEW
- Debris Simulation NEW
- Sand Simulation NEW
- Advanced Sculpting
- Predefined Base Shapes
- Data Map Filter Masking
- Geological Map Filter Masking
- Draw or Import Custom Masks

### Texturing Features → `02-texturing-features-plan.md`

- Displacement NEW
- Real World Color Mixer
- Megascans Support NEW
- Simple Colors
- PBR Textures
- Adobe Substance Materials
- Gradients
- Gradient Details NEW
- Gradient Sets Included
- Cartography Coloring
- 140 Material Scans Included
- Emissive Materials NEW
- Material Presets
- Synthesize Gradients
- Fluvial Advection / Color Erosion NEW
- Noise Distributions
- Terrain Distributions
- Layer Distributions

### Scattering Features → `03-scattering-features-plan.md`

- Noise Distributions NEW
- Terrain Distributions NEW
- Layer Distributions NEW
- Procedural Scattering NEW
- Collision Exclusion NEW
- Emissive Materials NEW
- Any Format NEW
- Megascans Support NEW
- Sub Object Scattering NEW
- Manual Placement NEW
- Distribution Scaling NEW
- Distribution Gradient NEW
- Instancing NEW
- Terrain Blending NEW
- Custom Shading NEW
- Royalty Free Assets Included NEW
- Optional Alignment NEW
- Scatter on other Objects NEW

### Rendering Features → `04-rendering-features-plan.md`

- Ray Tracer
- Volumetric Clouds
- Realistic Water
- Reflections
- Emissive Material and Objects NEW
- Scene Creation NEW
- Simple Video Creation NEW
- LUTs
- Atmosphere Haze and Fog
- Bloom
- HDRI Maps
- Image Composition
- Depth-of-Field
- Epic Shadows
- Sun Lighting
- Shape, Material and Cinematic Render Modes
- Tone Mapping
- Custom Viewport Resolution Setting NEW

### Export Features → `05-export-and-bridges-plan.md`

- Height Maps
- Color Maps
- Splat Maps
- Normal Maps
- 3D Mesh
- Roughness Maps
- Metalness Maps
- Topo Maps
- Geological Maps
- Ambient Occlusion Maps
- Biome Maps NEW
- Splines
- Simulation Maps
- Object Instance Maps NEW
- Unity Engine Mask Maps NEW
- Heat Maps
- ASC and XYZ NEW
- Gradients
- Bridge to Unity
- Bridge to Unreal
- Bridge to Houdini
- Bridge to Godot NEW
- Bridge to Cinema 4D
- Bridge to Blender
- GTA 5 Modding Community NEW

### Application Features → `06-application-features-plan.md`

- Everything is Real-Time
- Multilanguage Support
- Fully Documented
- Layer Based - No Nodes
- Easy to Learn
- Stable and Reliable

### Planned Features → `07-planned-features-roadmap.md`

- Hardware Ray Tracing
- Camera Animations and Video Capturing
- Integrated Online Asset Browser
- Volumetric Cloud Layers
- Water Layers
- Different Light Sources
- Translucency
- Fluid Simulation Engine
- Particle Engine

### A0 foundation follow-ups

- `08-a0-foundation-work-package.md`
- `09-ui-shell-constraints.md`
- `10-compute-infrastructure-constraints.md`
- `11-memory-budget-constraints.md`
- `12-runtime-migration-constraints.md`

## Product-level / licensing-oriented items from the World Creator page

- **Royalty Free Assets / 140 Material Scans Included / Royalty Free Assets Included** are treated as asset-pack ingestion, preview, licensing, and packaging work rather than rendering-core features.
- **Bridge to specific DCC/engine targets** are treated as downstream packaging/integration layers, not the canonical terrain model.

## Primary research anchors used across the plan set

- World Creator features page: https://www.world-creator.com/en/features.phtml
- World Creator docs overview / release notes / reference: https://docs.world-creator.com/ ; https://docs.world-creator.com/release-notes/version-2025.x/world-creator-2025.1 ; https://docs.world-creator.com/reference/terrain/biome ; https://docs.world-creator.com/reference/terrain/biome-layers ; https://docs.world-creator.com/walkthrough/introduction/toolbar
- Three.js WebGPURenderer docs: https://threejs.org/docs/pages/WebGPURenderer.html
- Three.js InstancedMesh docs: https://threejs.org/docs/pages/InstancedMesh.html
- Three.js GLTFExporter docs: https://threejs.org/docs/pages/GLTFExporter.html
- glTF PBR guide + EXT_mesh_gpu_instancing: https://www.khronos.org/gltf/pbr ; https://wallabyway.github.io/Khronos-glTF-repo-GHPages-test/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/
- Procedural-world survey: https://www.mdpi.com/2414-4088/1/4/27
- Terrain generation using hydrology: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf
- Real-time 3D hydraulic erosion with multi-layered heightmaps: https://diglib.eg.org/items/deefa865-6a25-4463-adcd-d8de2b37507e
- Houdini heightfield docs: https://www.sidefx.com/docs/houdini/heightfields/index.html ; https://www.sidefx.com/docs/houdini/heightfields/projection.html ; https://www.sidefx.com/docs/houdini/heightfields/flowfields.html
- GeoTIFF ingestion: https://geotiffjs.github.io/geotiff.js/
- Unreal/Unity/Godot terrain docs: https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine?application_version=5.6 ; https://docs.unity3d.com/es/2020.1/Manual/terrain-Heightmaps.html ; https://docs.godotengine.org/en/stable/classes/class_heightmapshape3d.html
- Browser UX/support docs: https://playwright.dev/docs/test-snapshots ; https://www.i18next.com/overview/getting-started ; https://docs.sentry.io/platforms/javascript/guides/react/troubleshooting/supported-browsers
- Atmosphere / water / clouds / RT references: https://ebruneton.github.io/precomputed_atmospheric_scattering/ ; https://advances.realtimerendering.com/s2017/ ; https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-NubisEvolved-NoVideos.pdf ; https://www.sciencedirect.com/science/article/pii/S2096579620300164 ; https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/rtwave.pdf ; https://github.com/gpuweb/gpuweb/issues/535

## Important non-goals for the first implementation waves

- Do **not** attempt a giant monolithic editor rewrite up front.
- Do **not** promise browser-side hardware ray tracing until the platform story is real.
- Do **not** make live DCC/engine sync the first export step; canonical file exports must come first.
- Do **not** couple bundled assets to core editor features.

