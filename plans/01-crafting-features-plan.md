# Crafting Features Recreation Plan

## Intent

Recreate World Creator-style terrain authoring in a way that matches this repo’s direction: **WebGPU-first, layered, tile-streamed, and deterministic**. The current app already has a strong runtime terrain renderer, but almost none of the authoring/editor substrate exists yet.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Real-Time Terrain Generator HOT | Adopt a dirty-region field graph so edits only recompute affected tiles; keep a fast preview mode and a slower high-quality bake mode. | Foundation |
| Unlimited Terrain Size HOT | Move from a single local sandbox to a quadtree/clipmap world document with streamed terrain tiles and floating-origin camera logic. | Foundation |
| Unlimited Detail HOT | Support multires source fields plus export-time supersampling/baking instead of promising infinite runtime detail. | Foundation |
| River Generator | Build a spline-authored river network that carves height, writes flow/wetness masks, and optionally drives water rendering/export. | Phase 2 |
| 2D Terrain Stamping | Rasterize grayscale/SDF stamps into the heightfield as non-destructive shape layers with blend modes. | Phase 1 |
| Grid Based Sculpting HOT | Add snapped sculpt brushes and quantized placement modes for hand-authored, game-friendly terrain edits. | Phase 1 |
| 3D Terrain Stamping | Project imported meshes into heightfields via ray projection or SDF-to-height conversion, then bake into layer data. | Phase 2 |
| True Height Displacement NEW | Treat displacement as authoring-time height baking into terrain tiles, distinct from render-only material displacement. | Phase 2 |
| Polygon Tools for Lakes, Plateaus and Valleys | Introduce polygon layers that rasterize fill, falloff, flatten, raise/lower, and hole masks into the terrain field graph. | Phase 1 |
| Vector Tools for Paths, Rivers and Mountains | Create spline/vector layers that emit masks, height offsets, widths, falloffs, and downstream exports for roads/rivers/ridges. | Phase 1 |
| Filter Presets | Serialize reusable layer/filter parameter bundles with thumbnails and versioned schema migration. | Phase 1 |
| 2D Primitive Tools | Ship rectangle/circle/ellipse/polygon primitives as editable procedural layer nodes with transform handles. | Phase 1 |
| Real-World Data Streaming | Ingest DEM/GeoTIFF sources tile-by-tile with geospatial metadata, windowed reads, reprojection, and LOD-aware caching. | Phase 2 |
| Biome Painting NEW | Paint biome masks that can drive terrain filters, materials, simulations, and scatter rules from one shared mask set. | Phase 1 |
| Sediment Filters | Model deposition passes that consume slope/flow/erosion fields and write sediment thickness/material masks. | Phase 2 |
| Erosion Filters | Start with GPU/worker thermal + hydraulic erosion kernels; add cached flow maps and editable parameters per layer. | Phase 2 |
| Arid Filters | Implement dryness/wind exposure filters that bias dune masks, cracked-earth masks, sparse vegetation, and material variation. | Phase 2 |
| Terrace Filters NEW | Use stepped quantization plus blur/erosion controls to form terraces without destructive aliasing. | Phase 1 |
| Effect Filters | Reserve a generic library of post-heightfield kernels for blur, sharpen, bias, clamp, remap, and stylized effects. | Phase 1 |
| Drift Filters | Drive snow/sand drift accumulation from wind direction, slope break, and obstacle lee-side masks. | Phase 3 |
| Noise Filters | Expand the current noise stack into layered domain-warped, cellular, ridged, and masked noises with tile-safe seeds. | Phase 1 |
| Snow Simulation NEW | Approximate snow as a deposition-and-melt field derived from elevation, slope, exposure, and optional precipitation passes. | Phase 2 |
| Fluid Simulation NEW | Use a shallow-water / flow-routing heightfield solver first; defer full 3D fluids to the planned-features track. | Phase 3 |
| Debris Simulation NEW | Implement talus/slump/debris-flow solvers that move mass downhill and emit debris/rock placement masks. | Phase 3 |
| Sand Simulation NEW | Approximate dune formation with angle-of-repose relaxation plus wind transport over scalar sand-depth fields. | Phase 3 |
| Advanced Sculpting | Add pressure-aware brush ops, invert/smooth/flatten/terrace brushes, and robust undo/redo around non-destructive layers. | Phase 1 |
| Predefined Base Shapes | Provide starter shapes as preset stamps/parametric generators instead of baking custom meshes into the core. | Phase 1 |
| Data Map Filter Masking | Allow any imported or derived raster field to gate a filter’s influence, with remap/curve controls. | Phase 1 |
| Geological Map Filter Masking | Promote flow/slope/curvature/cavity/erosion outputs to first-class derived maps usable everywhere in the editor. | Phase 2 |
| Draw or Import Custom Masks | Support painted masks, imported grayscale rasters, and vector-to-mask conversion with per-layer blur/invert/levels. | Phase 1 |

## Best-fit architecture for this category

### 1. Canonical terrain field model
- Promote terrain from “procedural function sampled during chunk rebuild” to a **versioned terrain document**.
- Store editable source layers separately from derived maps:
  - source: stamps, spline layers, sculpt layers, masks, imported DEMs, biome masks
  - derived: height, slope, curvature, flow, sediment, snow, wetness, cavity, terraces
- Use a **tiled quadtree/clipmap layout** for large worlds so edits only invalidate the touched region.

### 2. Non-destructive ordered layer stack
- The closest match to World Creator’s layering is not a node graph; it is an ordered stack with:
  - enable/mute/solo
  - opacity/intensity
  - blend mode
  - mask slot
  - preset save/load
  - local transform for stamps/primitives
- Each layer should emit one or more fields into the field graph.

### 3. Authoring tools to prioritize first
1. primitives + 2D stamps
2. polygon/vector layers
3. brush sculpting
4. biome painting / mask painting
5. imported DEM/mask layers
6. erosion/simulation passes

### 4. Simulation strategy
- **Start with approximations that are controllable and cacheable**, not “perfect physics”.
- Recommended order:
  1. thermal erosion / talus redistribution
  2. simple hydraulic/flow-routing erosion
  3. snow deposition + melt approximation
  4. sand drift / dunes
  5. debris flow / slump
  6. shallow-water fluid behavior for rivers/lakes
- Keep each simulation layer deterministic and resumable from cached fields.

## Suggested execution path

### Phase A — enable editing at all
- Add document schema for terrain layers and masks.
- Add dirty-tile recompute and history/undo.
- Add brush + primitive + stamp tooling.
- Add export of debug masks/height tiles for validation.

### Phase B — vector/polygon-driven worlds
- Add spline/path/ridge/river layer type.
- Add polygon flatten/fill/cut/falloff tools.
- Add biome painting and mask painting.
- Add preset serialization.

### Phase C — imported data and geospatial workflows
- Add GeoTIFF/DEM import, clipping windows, reprojection metadata, scale normalization.
- Add imported grayscale mask layers.
- Add derived geology maps (slope, flow, cavity, etc.).

### Phase D — erosion and naturalization
- Add hydraulic + thermal erosion kernels.
- Add sediment, terrace, drift, snow, sand, and debris passes.
- Add river-aware terrain carving and shoreline generation.

## Risks / gotchas
- “Unlimited size” is a UX promise, not a literal guarantee; the editor needs explicit world-scale limits and quality tiers.
- Browser memory pressure will dominate if the field cache is not tile-based.
- 3D stamping into a heightfield can only represent one visible surface per XZ position; overhangs/caves need a later mesh/voxel path.
- Real-world streaming implies coordinate-system management, reprojection, and unit consistency from day one.

## Research notes that informed this plan
- World Creator features page + docs define the surface area and confirm a layer-centric workflow: https://www.world-creator.com/en/features.phtml ; https://docs.world-creator.com/reference/terrain/biome ; https://docs.world-creator.com/reference/terrain/biome-layers
- The procedural-world survey is useful for rivers, roads, and terrain authoring taxonomy: https://www.mdpi.com/2414-4088/1/4/27
- Genevaux et al. is a strong anchor for river-first terrain generation: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf
- Nilles et al. shows the direction for more advanced hydraulic erosion and why 2.5D heightfields eventually hit representation limits: https://diglib.eg.org/items/deefa865-6a25-4463-adcd-d8de2b37507e
- Houdini heightfield docs are a practical production reference for layered terrain fields, projection, and flow layers: https://www.sidefx.com/docs/houdini/heightfields/index.html ; https://www.sidefx.com/docs/houdini/heightfields/projection.html ; https://www.sidefx.com/docs/houdini/heightfields/flowfields.html
- geotiff.js provides the realistic browser-side ingestion path for DEM/GeoTIFF data: https://geotiffjs.github.io/geotiff.js/

## Latest browser-native techniques to prefer

- **WebGPU compute terrain kernels:** use storage buffers/textures and ping-pong compute passes for brush rasterization, masks, slope/curvature derivation, erosion previews, and simulation layers. This is the most browser-native path to keeping editing interactive at large terrain sizes. References: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- **WASM SIMD/threads + workers for fallbacks and preprocessing:** DEM decode, mask import, CPU erosion fallbacks, and heavy curve rasterization should run in workers, using transferables and SharedArrayBuffer where possible. References: https://developer.mozilla.org/en-US/docs/WebAssembly ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects ; https://developer.mozilla.org/en-US/docs/Web/API/SharedArrayBuffer
- **Range-based geospatial ingestion:** `geotiff.js` windowed reads, PMTiles archives, and FlatGeobuf spatial indexing are more realistic browser strategies than whole-file GIS imports. References: https://geotiffjs.github.io/geotiff.js/ ; https://docs.protomaps.com/pmtiles/ ; https://flatgeobuf.org/
- **GPU profiling for quality tiers:** use timestamp queries (where exposed) to decide when to drop from high-quality erosion previews to cheaper approximations. References: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet ; https://developer.chrome.com/docs/web-platform/webgpu/developer-features
- **Worker/Offscreen previews:** use workers and OffscreenCanvas for thumbnails, minimaps, and background-derived-map previews to keep the editing thread responsive. References: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

## Technique rationale

The browser advantage is not “do desktop GIS in JavaScript the old way”; it is combining **WebGPU compute for dense field math**, **workers/WASM for incompatible or preprocessing work**, and **HTTP-range-friendly data formats** so the editor behaves like a streaming, local-first tool instead of a monolithic terrain app.

## Recommendation

If this repo seriously wants to pursue World Creator-like crafting features, the single highest-value move is:

> **turn terrain generation into a tiled, serialized, layered field graph before adding any new terrain tools.**

Without that, every individual feature becomes bespoke and fragile.
