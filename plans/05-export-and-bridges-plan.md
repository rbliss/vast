# Export and Bridge Features Recreation Plan

## Intent

Recreate World Creator’s export story by standardizing on **canonical intermediate outputs** first, then layering target-specific bridge adapters on top. This is the safest path for a browser-first terrain tool.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Height Maps | Emit 16-bit/32-bit height exports from the canonical terrain tiles with deterministic normalization rules. | Phase 1 |
| Color Maps | Bake the current material stack into color/albedo maps at user-selected resolution and tiling. | Phase 1 |
| Splat Maps | Export packed material-weight channels from the same distribution layers that drive the live renderer. | Phase 1 |
| Normal Maps | Bake tangent/world-space normals from heightfields and material detail according to export target needs. | Phase 1 |
| 3D Mesh | Extract terrain meshes from selected LODs/tiles and export GLB/OBJ with optional decimation. | Phase 2 |
| Roughness Maps | Bake roughness from material recipes into engine-ready textures with configurable packing. | Phase 1 |
| Metalness Maps | Bake metalness only where material recipes need it; most terrain remains dielectric. | Phase 1 |
| Topo Maps | Generate contour/label-friendly topo renders from terrain elevation at export time. | Phase 2 |
| Geological Maps | Export derived scalar fields such as slope, flow, curvature, cavity, snow, sediment, and exposure. | Phase 2 |
| Ambient Occlusion Maps | Bake macro AO from heightfields/meshes for offline workflows; keep runtime AO separate. | Phase 2 |
| Biome Maps NEW | Export biome IDs/weights from painted/generated biome layers for downstream engine logic. | Phase 1 |
| Splines | Export curve networks as JSON/CSV/engine-specific payloads for roads, rivers, and paths. | Phase 2 |
| Simulation Maps | Persist snow, flow, sediment, debris, wetness, and similar simulation outputs as reusable rasters. | Phase 2 |
| Object Instance Maps NEW | Export scatter transforms and category IDs as JSON/CSV/GLTF instancing payloads. | Phase 2 |
| Unity Engine Mask Maps NEW | Provide Unity-specific channel packing templates and metadata manifests rather than ad hoc exports. | Phase 2 |
| Heat Maps | Export analytical overlays for gameplay/debugging/design review from any scalar field in the document. | Phase 1 |
| ASC and XYZ NEW | Add GIS-friendly point/raster export adapters for terrain data interchange with non-DCC tools. | Phase 2 |
| Gradients | Persist gradient assets as standalone files and optional rasterized exports. | Phase 1 |
| Bridge to Unity | Ship file-based manifests and export presets first; live sync should come only with a dedicated companion/plugin. | Phase 3 |
| Bridge to Unreal | Start with UE-friendly height/weight/spline/object-instance exports and defer real live-link behavior. | Phase 3 |
| Bridge to Houdini | Export heightfields/masks/splines/instances in formats Houdini already understands; add HAPI integration only later. | Phase 3 |
| Bridge to Godot NEW | Prefer Godot-friendly height/mesh/material exports and optional plugin glue over a custom runtime protocol. | Phase 3 |
| Bridge to Cinema 4D | Treat as a DCC package export + manifest problem, not a core rendering feature. | Phase 4 |
| Bridge to Blender | Use GLB/EXR/CSV manifests first; evolve toward a Blender add-on only once the canonical export set is stable. | Phase 3 |
| GTA 5 Modding Community NEW | Handle as a downstream community pipeline via Blender/custom converters, not as a core browser feature. | Phase 4 |

## Best-fit architecture for this category

### 1. Canonical outputs first
Everything should be derivable from one versioned world document into four families of outputs:
1. **Raster outputs** — height, albedo, weights, masks, derived maps
2. **Geometry outputs** — terrain mesh, object meshes, splines, instances
3. **Metadata/manifests** — units, normalization, coordinate transforms, asset refs
4. **Target presets** — Unity/Unreal/Houdini/Godot/etc. packaging rules

### 2. Export presets as data
- Resolution
- bit depth
- world-unit normalization
- channel packing
- naming conventions
- tile splitting
- coordinate handedness / axis remap
- color space rules

### 3. Bridge philosophy
- **Phase 1:** one-click export package for each target
- **Phase 2:** optional target-side import plugin / script
- **Phase 3:** optional live-link or push-sync if the file formats and manifests have stabilized

## Suggested execution path

### Phase A — get the fundamentals right
- Height, color, splat, biome, heat, and gradient exports.
- Target presets for bit depth, tile sizing, and normalization.
- JSON manifest describing world scale and channel semantics.

### Phase B — geometry and instances
- Terrain mesh export.
- Spline export.
- Object instance export.
- Simulation/geology map export.

### Phase C — target-specific packaging
- Unity mask/control map preset.
- Unreal-friendly height/weight/spline bundle.
- Houdini heightfield-friendly raster package.
- Godot-compatible terrain + collision-friendly outputs.
- Blender/C4D scene package with GLB/EXR/CSV manifests.

### Phase D — optional live bridges
- Only after the file-based pipeline is trusted.
- Likely requires desktop helpers/plugins, not pure browser logic.

## Risks / gotchas
- Every engine uses slightly different assumptions about height scaling, channel packing, and coordinate handedness.
- Live bridges are seductive but brittle; they should not define the canonical data model.
- ASC/XYZ and GIS-style outputs are not just “another image export”; they need unit correctness and metadata discipline.
- GTA 5 / FiveM workflows are community-specific and are best handled as downstream exporters or plugin ecosystems.

## Research notes that informed this plan
- World Creator’s feature list clearly mixes pure exporters with downstream bridge promises; separating those concerns is key: https://www.world-creator.com/en/features.phtml
- Three.js GLTFExporter is the obvious in-repo mesh export starting point and already supports EXT_mesh_gpu_instancing: https://threejs.org/docs/pages/GLTFExporter.html
- Unity’s terrain docs confirm RAW is still the baseline terrain interchange format there: https://docs.unity3d.com/es/2020.1/Manual/terrain-Heightmaps.html
- Unreal’s heightmap import/export docs confirm 16-bit grayscale landscape workflows remain central: https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine?application_version=5.6
- Houdini’s heightfield docs and HAPI volume docs are the right model for a Houdini bridge/export path: https://www.sidefx.com/docs/houdini/heightfields/index.html ; https://www.sidefx.com/docs/hengine/_h_a_p_i__volumes.html
- Godot’s HeightMapShape3D docs are a useful reminder that bit depth matters and 8-bit terrain inputs are not acceptable for serious workflows: https://docs.godotengine.org/en/stable/classes/class_heightmapshape3d.html

## Latest browser-native techniques to prefer

- **Local-first export staging:** use OPFS for temporary bakes and large intermediate files, then File System Access for user-approved save destinations. References: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system ; https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- **Workerized baking and transferable buffers:** large texture bakes, mesh extraction, ZIP/package assembly, and GIS conversions should run off the main thread and pass ArrayBuffers by transfer. References: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects ; https://developer.mozilla.org/en-US/docs/WebAssembly
- **Modern portable asset formats:** GLB + KTX2 + EXT_mesh_gpu_instancing should be first-class export targets because they map well to browser delivery and downstream tools. References: https://threejs.org/docs/pages/GLTFExporter.html ; https://www.khronos.org/ktx ; https://wallabyway.github.io/Khronos-glTF-repo-GHPages-test/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/
- **Streaming geospatial interop:** for DEM/GIS workflows, keep GeoTIFF/ASC/XYZ/PMTiles/FlatGeobuf in mind so the tool can participate in modern browser geospatial pipelines rather than only game-engine pipelines. References: https://geotiffjs.github.io/geotiff.js/ ; https://docs.protomaps.com/pmtiles/ ; https://flatgeobuf.org/
- **Capability-aware packaging:** because browser storage and memory budgets vary widely, export presets should know when to tile outputs, stream chunks, or fall back to lighter packaging. References: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

## Technique rationale

A browser-native exporter should behave like a **local-first packaging pipeline**—workerized, chunked, and format-aware—rather than like a synchronous desktop “save as” dialog that assumes infinite RAM and blocking I/O.

## Recommendation

The highest-leverage move is:

> **define a canonical export manifest and a small set of high-quality generic exporters before promising any “bridge” feature.**

That keeps the ecosystem expandable without locking the editor to one engine.
