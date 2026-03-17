# Rendering Features Recreation Plan

## Intent

Recreate the World Creator rendering feature set in a way that respects the web platform: **raster-first for interactive editing, optional higher-quality capture paths for final stills/sequences**. The browser/WebGPU stack is capable, but some marketing-grade features (especially hardware RT) need careful scope control.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Ray Tracer | Keep raster rendering as the primary interactive mode; add an optional offline/high-quality compute/path-traced still renderer later. | Phase 3 |
| Volumetric Clouds | Start with sky + fog + cheap cloud layers, then graduate to 3D noise raymarching once the scene layer exists. | Phase 2 |
| Realistic Water | Implement heightfield-aware water bodies with shoreline depth fade, reflection strategy selection, and optional shallow-water animation. | Phase 2 |
| Reflections | Use a hybrid of env maps, SSR-like screen techniques, and optional planar reflections for large calm water bodies. | Phase 2 |
| Emissive Material and Objects NEW | Unify terrain and object emissive behavior so bloom and export paths consume the same emissive-intensity model. | Phase 2 |
| Scene Creation NEW | Introduce a scene layer containing cameras, lights, atmosphere, water, cloud layers, and placed hero props. | Phase 1 |
| Simple Video Creation NEW | Record camera paths/keyframes and export image sequences first; leave full video encoding to external tools or optional WASM later. | Phase 1 |
| LUTs | Apply post-LDR or post-tonemap color grading via 3D LUTs in a dedicated post stack. | Phase 2 |
| Atmosphere Haze and Fog | Adopt a physically inspired atmosphere/fog model with height falloff and aerial perspective over clipmapped terrain. | Phase 2 |
| Bloom | Use a modern post stack with emissive-threshold bloom rather than bespoke per-material hacks. | Phase 1 |
| HDRI Maps | Support environment maps as the default image-based-lighting source and couple them with sun extraction or manual sun override. | Phase 1 |
| Image Composition | Add viewport overlays (rule of thirds, safe areas, focal guides, horizon guide) without affecting exported data. | Phase 1 |
| Depth-of-Field | Provide a high-quality preview DOF pass for captures, not for everyday editing by default. | Phase 2 |
| Epic Shadows | Upgrade to cascaded directional shadows and shadow-quality tiers before chasing ray-traced shadows. | Phase 1 |
| Sun Lighting | Expose solar azimuth/elevation/intensity/color controls and optionally geolocation/time-of-day presets. | Phase 1 |
| Shape, Material and Cinematic Render Modes | Keep dedicated preview modes: terrain-shape debug, material debug, and cinematic capture. | Phase 1 |
| Tone Mapping | Use explicit tone-mapping selection and exposure controls shared by viewport and screenshot/export paths. | Phase 1 |
| Custom Viewport Resolution Setting NEW | Decouple internal render resolution from UI resolution so users can trade preview quality for speed. | Phase 1 |

## Best-fit architecture for this category

### 1. Two rendering modes, deliberately
1. **Interactive authoring renderer**
   - always-on, fast, stable, feature-tiered
   - terrain + scatter + atmosphere + water + shadows + post
2. **Capture renderer**
   - slower, optional, quality-biased
   - can afford more samples, larger shadow maps, stronger post, or even path-tracing experiments

### 2. Scene layer first
A credible recreation of scene creation, video, clouds, water, and lighting requires a **scene layer** that owns:
- cameras and camera paths
- sky / atmosphere / HDRI
- sun + future lights
- water bodies
- cloud layers
- capture presets

### 3. Atmosphere/water/clouds order of operations
- Step 1: sun + env map + fog/haze + bloom + tone mapping + resolution scaling
- Step 2: water body rendering + reflection strategy
- Step 3: volumetric clouds
- Step 4: cinematic capture tools and richer post stack
- Step 5: optional offline/path-traced still rendering

### 4. Ray tracing reality check
- Browser WebGPU still does **not** offer a mature, portable hardware ray tracing path for production use.
- Near-term “ray tracer” should be interpreted as:
  - compute/path-traced still renderer, or
  - hybrid raster + denoised reflection/refraction experiments,
  not “full browser hardware RT everywhere”.

## Suggested execution path

### Phase A — strong raster viewport
- explicit sun/env/fog/bloom/tone-mapping stack
- cascaded sun shadows
- render modes (shape/material/cinematic)
- resolution scaling for preview
- screenshot/capture preset support

### Phase B — scene-layer features
- cameras + composition guides
- camera path capture / image sequence export
- HDRI selection + sun sync
- water bodies with shoreline/depth controls

### Phase C — advanced atmosphere
- layered atmosphere haze
- volumetric clouds (single volume first)
- depth-of-field and LUT grading for captures

### Phase D — optional high-quality renderer
- path-traced still renderer or compute-based high-quality mode
- denoiser path for captures
- research-track experiments for richer reflections/refractions

## Risks / gotchas
- Mixing heavy post, offscreen passes, and custom WebGPU material pipelines can destabilize the renderer if not designed together.
- Water and clouds are notorious feature sinks; they should come after the scene layer exists.
- Capture/video features become much easier if the app exports image sequences instead of trying to encode compressed video in-browser on day one.
- “Ray tracer” without a hardware RT path needs careful messaging so expectations stay grounded.

## Research notes that informed this plan
- Three.js WebGPURenderer docs confirm the current runtime base and its backend model: https://threejs.org/docs/pages/WebGPURenderer.html
- World Creator’s release notes and toolbar docs show the category is fundamentally scene-layer driven (water/cloud toggles, denoiser, render modes, simple video): https://docs.world-creator.com/ ; https://docs.world-creator.com/walkthrough/introduction/toolbar ; https://docs.world-creator.com/release-notes/version-2025.x/world-creator-2025.1
- Bruneton remains a strong practical anchor for atmosphere work: https://ebruneton.github.io/precomputed_atmospheric_scattering/
- Nubis / Advances in Real-Time Rendering remains the best public high-level direction for volumetric cloud layering: https://advances.realtimerendering.com/s2017/ ; https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-NubisEvolved-NoVideos.pdf
- Water rendering references worth adapting in stages: https://www.sciencedirect.com/science/article/pii/S2096579620300164 ; https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/rtwave.pdf
- GPUWeb ray tracing remains an open issue rather than a deployed browser baseline: https://github.com/gpuweb/gpuweb/issues/535

## Latest browser-native techniques to prefer

- **Raster-first WebGPU renderer:** use WebGPURenderer/TSL for the main viewport, reserving raw WebGPU or specialized passes for the heaviest effects only when needed. References: https://threejs.org/manual/en/webgpurenderer ; https://threejs.org/docs/pages/WebGPURenderer.html
- **Compute-assisted volumes and particles:** clouds, fog volumes, snow, dust, and other cinematic FX should lean on compute-generated noise/particles and half/quarter-resolution volume passes with temporal reprojection. References: https://threejs.org/examples/webgpu_compute_particles.html ; https://threejs.org/examples/webgpu_compute_particles_snow.html ; https://www.w3.org/TR/webgpu/
- **Dynamic resolution + GPU timing:** use custom viewport resolution controls plus timestamp queries to keep the scene responsive under expensive passes. References: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet ; https://developer.chrome.com/docs/web-platform/webgpu/developer-features
- **Hybrid reflection/water strategy:** prefer env maps, screen-space reflections, and planar reflections before any ray-based approach. This is the strongest browser-native quality/perf tradeoff today. References: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/rtwave.pdf ; https://www.sciencedirect.com/science/article/pii/S2096579620300164
- **Capture via image sequences + WebCodecs where available:** image-sequence export is the stable baseline; WebCodecs can optionally encode browser-side when supported, but the product should not depend on universal in-browser muxing. Reference: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- **Browser-native RT honesty:** compute/path-traced still renderers are plausible; portable hardware RT in the browser is still not. References: https://github.com/gpuweb/gpuweb/issues/535 ; https://arxiv.org/abs/2407.19977

## Technique rationale

The latest browser-native rendering stack is **WebGPU raster plus selective compute acceleration**, not a blind port of desktop engine features. Clouds, water, particles, and capture all benefit from compute and temporal techniques; hardware RT does not yet have the same browser-native maturity.

## Recommendation

The best path is:

> **finish a production-worthy raster scene renderer first, then layer on clouds/water/capture, and treat ray tracing as an optional high-quality capture path—not the default editor renderer.**
