# Planned Features Roadmap

## Intent

Chart the most credible path for the features World Creator itself labels as “coming in 2026”, while staying honest about which ones are realistic in a browser-first WebGPU product and which ones remain research tracks.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Hardware Ray Tracing | Do not assume browser availability; keep this behind a long-range research gate until GPUWeb gains a practical RT extension or a native wrapper is adopted. | Blocked / Research |
| Camera Animations and Video Capturing | Extend the simple video path into a real camera sequencer with keyframes, easing, rails, and batch image export. | Near-term |
| Integrated Online Asset Browser | Build a provider-agnostic asset browser with explicit licensing/auth rules; start with local packs and optional provider adapters. | Near-term |
| Volumetric Cloud Layers | After single-volume clouds work, support multiple cloud strata with independent density/noise/weather settings. | Mid-term |
| Water Layers | Represent water as ordered water-body layers (sea level, lakes, rivers, wetlands) with priority/boolean rules. | Mid-term |
| Different Light Sources | Once a scene layer exists, add punctual/area light authoring with explicit performance tiers. | Near-term |
| Translucency | Add foliage/ice/leaf translucency and simple subsurface approximations through dedicated material models. | Mid-term |
| Fluid Simulation Engine | Unify shallow-water terrain flow, water-body animation, and later volumetric fluid experiments under one simulation service. | Long-term |
| Particle Engine | Adopt WebGPU compute-driven particles for weather, dust, foam, pollen, sparks, and capture FX once scene layers are stable. | Near-term |

## Roadmap judgment by feature

### Best near-term candidates
1. **Camera Animations and Video Capturing**
   - Depends mostly on a scene layer and capture/export polish.
2. **Integrated Online Asset Browser**
   - Realistic if provider support is abstracted and licensing is explicit.
3. **Different Light Sources**
   - Straightforward once the scene layer exists.
4. **Particle Engine**
   - WebGPU compute makes this genuinely plausible in the browser.

### Good mid-term candidates
1. **Volumetric Cloud Layers**
   - Needs the base cloud renderer first.
2. **Water Layers**
   - Needs a real water-body representation and scene-layer integration.
3. **Translucency**
   - Needs a broader material model, especially for foliage and ice.

### Long-term / research-track candidates
1. **Fluid Simulation Engine**
   - The practical first step is 2D terrain flow and water-body animation, not full volumetric fluids.
2. **Hardware Ray Tracing**
   - Remains blocked by the current browser/platform story.

## Recommended implementation order

### Wave 1
- scene layer
- camera keyframes / rails / image-sequence export
- extra lights
- local asset browser + metadata registry

### Wave 2
- single-layer clouds → layered clouds
- water-body system → layered water bodies
- compute particle framework for weather/dust/foam

### Wave 3
- translucency and richer material models
- fluid simulation experiments
- optional native-wrapper / desktop path if hardware RT becomes strategically important

## Asset-browser guidance
- Do not hard-wire the UI to one provider.
- Build provider adapters with explicit auth/licensing rules.
- Start with:
  - local asset packs
  - user folders
  - optional provider APIs with legal download rights
- Sketchfab’s Download API is a useful example of what a provider adapter looks like, but licensing must stay front-and-center: https://sketchfab.com/developers/download-api

## Camera-animation guidance
- The current repo already has orbit controls and snapshot tooling, so camera sequencing is mostly an **editor/state-management problem**.
- Use keyframes, rails/splines, easing, bookmarks, and export-to-image-sequence first.
- Three.js’ animation system and mature camera-control libraries are helpful references for the conceptual split between control, sequencing, and playback: https://threejs.org/manual/en/animation-system.html ; https://yomotsu.github.io/camera-controls/

## Particle guidance
- WebGPU compute makes browser particles much more credible than they used to be.
- A practical first target is weather and ambient FX: snow, dust, pollen, foam, sparks.
- Relevant examples: https://threejs.org/examples/webgpu_compute_particles.html ; https://threejs.org/examples/webgpu_compute_particles_snow.html ; https://threejs.org/examples/webgpu_tsl_compute_attractors_particles.html

## Hardware RT reality check
- GPUWeb’s ray tracing extension remains an open, long-running issue rather than a portable baseline: https://github.com/gpuweb/gpuweb/issues/535
- That means “hardware ray tracing” should stay a research placeholder unless the product strategy changes to include a native shell/runtime.

## Latest browser-native techniques to prefer

- **Hardware RT fallback plan:** until browser hardware RT is real, use compute/path-traced still rendering and hybrid raster techniques for reflections/shadows. References: https://github.com/gpuweb/gpuweb/issues/535 ; https://arxiv.org/abs/2407.19977
- **Sequencer + capture on web standards:** camera animation should target image-sequence export first, with optional WebCodecs encoding on supported browsers. Reference: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- **Asset browser as a local-first cache + provider abstraction:** use OPFS/IndexedDB for previews/metadata and keep provider-specific APIs behind adapters. References: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system ; https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API ; https://sketchfab.com/developers/download-api
- **Particles and fluids on compute:** WebGPU compute is the modern browser-native route for particles, shallow-water simulation, and eventually fluid approximations. References: https://threejs.org/examples/webgpu_compute_particles.html ; https://threejs.org/examples/webgpu_compute_particles_snow.html ; https://www.w3.org/TR/webgpu/
- **Scene-light growth via clustered/forward+ thinking:** once multiple light sources matter, prefer clustered/forward+ style budgeting and clear quality tiers over unbounded light counts. Reference baseline: https://www.w3.org/TR/webgpu/
- **Translucency via targeted approximations:** foliage/ice translucency should start with half-resolution thickness/transmission approximations and material-specific hacks, not a broad physically perfect transmission system.

## Technique rationale

For the planned-features bucket, the browser-native rule is simple: **lean into compute, caching, streaming, and capability tiers; avoid betting the roadmap on missing platform primitives.**

## Recommendation

The healthiest roadmap is:

> **ship scene/camera/light/asset/particle features before betting on hardware RT or a full fluid engine.**

Those wins are more achievable and unlock more visible creator value.
