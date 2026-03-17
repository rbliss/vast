# Phase A Detailed Plan — Shape Systems First

## Purpose

This plan defines the **first implementation phase** for achieving high-end browser-native terrain quality.

It is deliberately **not** a feature-parity plan for World Creator.
It is a plan for building the first part of a visual-quality stack that can produce terrain with strong photographic/cinematic foundations in the browser.

## Agreed goal of Phase A

Phase A should prove:

> the terrain looks compelling in a **clay/shape evaluation mode**, before premium materials, dense scattering, atmosphere, water, or capture polish are layered on top.

This phase is about **shape systems**, not general rendering polish.

---

## Agreed scope boundary

## In scope
1. **Directable macro landforms**
   - ranges
   - basins
   - ridge/valley structure
   - drainage corridors
   - plateau / escarpment / terrace support

2. **Derived terrain analysis maps**
   - slope
   - curvature
   - flow accumulation / drainage
   - erosion/deposition indicators
   - optional aspect / convexity / cavity later in the phase

3. **Erosion/refinement systems**
   - thermal and/or hydraulic erosion
   - GPU compute where practical
   - used as refinement on top of better base landforms

4. **Clay/shape debug render mode**
   - neutral surface, no texture-driven “cheating”
   - shape readability from wide, mid, and grazing views

5. **Minimal shadowed evaluation mode**
   - include early directional shadows / cascaded shadows
   - only as a readability aid for terrain evaluation

## Explicitly out of scope
- premium terrain material stack
- vegetation/rock/debris scattering systems
- atmosphere haze/fog/cloud layers
- water rendering
- cinematic capture pipeline
- advanced builder/editor parity features beyond what shape work needs

---

## Key strategic decision

**Phase A is not “hydraulic erosion first.”**

The correct order is:
1. **directable macro landforms first**
2. **terrain analysis maps second**
3. **erosion as a refinement layer third**
4. **clay-mode evaluation throughout**
5. **minimal shadows for readability**

### Why
Erosion can improve shape, but it cannot replace composition.
If the underlying landform layout is weak, erosion simply polishes weak structure.

This conclusion is consistent with both:
- review of World Creator feature-page imagery
- hydrology-based terrain generation literature

---

## What the reviewed imagery suggests

Representative images from the World Creator features page strongly suggest the highest-quality shots derive their visual credibility from:
- coherent mountain/ridge/valley hierarchy
- drainage-shaped terrain logic
- terrain masks that imply deposition, cliffs, terraces, sediment and flow
- readable light/shadow across strong macro shape

The material and atmosphere layers matter a lot later, but the underlying shape language is already doing most of the work in the best shots.

---

## Best techniques to use for the desired effects

## 1. Directable macro landforms

### Desired effect
Terrain should feel authored and geologically legible, not like generic fractal noise.

### Best approach
Use a **hybrid directable heightfield system**:
- low-frequency procedural base field
- explicit macro structure controls
- optional graph/spline/raster guides for ridges and drainage corridors
- downstream erosion-informed refinement

### Recommended ingredients
#### A. Mountain/range field primitives
Use parameterized large-scale primitives or fields for:
- mountain chains
- massif zones
- basin depressions
- plateau shelves
- escarpments
- coastal shelves

These should define the broad silhouette before erosion.

#### B. Ridge/valley guidance from skeletons or guide curves
Add guide structures that can shape:
- ridge spines
- valley corridors
- watershed separation
- river destination zones

This can be encoded as:
- spline guides
- raster masks
- low-resolution influence fields
- a future drainage graph

#### C. Multi-resolution layered heightfields
Macro structure should be built at lower frequency / larger scale, with detail introduced later through:
- erosion
- secondary noise
- ridge sharpening
- terrace/deposition modifiers

### Why this is the best fit
Hydrology-oriented procedural terrain work repeatedly shows that believable terrain comes from **drainage and structure**, not noise alone.

### Research anchors
- Genevaux et al., *Terrain Generation Using Procedural Models Based on Hydrology*: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf
- Peytavie et al., riverscape generation / river-driven terrain thinking: https://cs.purdue.edu/homes/bbenes/papers/Peytavie19CGF.pdf
- Gaillard et al., dendritic drainage pattern modeling: https://www.cs.purdue.edu/homes/bbenes/papers/Gaillard19I3D.pdf

---

## 2. Derived terrain analysis maps

### Desired effect
Terrain should expose the hidden structure needed for later materials, erosion, scattering, and debugging.

### Required maps
- **slope**
- **curvature** (mean / profile / plan or a practical approximation)
- **flow accumulation / drainage**
- **erosion/deposition indicators**
- optional later:
  - aspect
  - convexity/concavity
  - cavity
  - sediment thickness proxy

### Best approach
Treat these as **first-class field outputs**, not ad hoc debug calculations.

### Why this matters
These maps do three jobs:
1. validate whether the terrain shape is actually good
2. drive erosion and later material/scatter logic
3. allow a shape-first workflow with objective diagnostics instead of subjective guessing

### Browser-native technique
These maps are excellent candidates for:
- tiled CPU reference generation first
- WebGPU compute generation second

They are bounded, deterministic, and broadly useful.

### Research anchors
- World Creator documentation repeatedly emphasizes distributions and masks driven by height, slope, angle, flow, and filter changes: https://docs.world-creator.com/walkthrough/terrain-setup/understanding-terrains ; https://docs.world-creator.com/reference/terrain/distributions/layer/filter-change
- WebGPU API / compute model: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

---

## 3. Erosion and refinement

### Desired effect
Terrain should acquire the organized weathering seen in strong real-world landscapes:
- channels
- gullies
- fans
- talus/debris zones
- slope redistribution
- sediment placement

### Best approach
Use **erosion as refinement**, not as the sole generator.

### Recommended order
#### A. Thermal / talus relaxation first
Why:
- simpler
- stable
- useful for cliffs, debris slopes, terraces, escarpment softening
- can improve realism early with relatively low complexity

#### B. Hydraulic / droplet or flow-based erosion second
Why:
- best for channels, drainage shaping, and flow realism
- gives strong valley language and sediment transport clues
- aligns with the “desired effect” in reviewed imagery

#### C. Multi-pass refinement strategy
Instead of one giant erosion pass:
- macro refinement pass
- channel/gully pass
- localized deposition pass
- optional widening/sediment smoothing pass

### Browser-native technique choice
#### Preferred
- **WebGPU compute** for tile-based erosion/refinement kernels

#### Required alongside it
- CPU reference path for correctness and validation

### Important caution
Do not start by building the most advanced possible erosion system.
Phase A only needs erosion strong enough to:
- improve structural plausibility
- generate diagnostic maps
- make clay-mode terrain visibly stronger

### Research anchors
- Nilles et al. 2024, real-time hydraulic erosion with multi-layered heightmaps: https://diglib.eg.org/items/deefa865-6a25-4463-adcd-d8de2b37507e
- World Creator’s simulation and erosion docs indicate particle/droplet-style and sediment-linked erosion workflows: https://docs.world-creator.com/reference/terrain/simulation-layers ; https://docs.world-creator.com/reference/terrain/biome/filters/advanced-erosion/wide-flows
- WebGPU compute fundamentals: https://www.w3.org/TR/webgpu/

---

## 4. Clay/shape debug render mode

### Desired effect
Terrain should be judged on form alone, without good materials hiding bad structure.

### Best approach
Provide a **dedicated clay mode** with:
- neutral albedo
- restrained roughness/specular response
- no terrain texture blending
- no vegetation clutter
- no atmospheric masking
- optional overlays for:
  - slope
  - curvature
  - flow
  - deposition

### Why this is essential
This is the cleanest way to answer the real Phase A question:

> “Is the terrain actually good, or does it only look good because of materials and post?”

### Best evaluation views
- wide landscape view
- mid-distance landscape view
- grazing-angle relief view
- top-down diagnostic view

---

## 5. Minimal shadowed evaluation

### Desired effect
Shape detail and relief should be readable during development.

### Recommended inclusion
**Include directional shadowing / cascaded shadow maps early**.

### Why
- terrain readability improves immediately
- erosion results become easier to judge
- this is a cheap, practical dev aid

### Scope limitation
This is **not** the start of the lighting/atmosphere phase.
It is strictly:
- evaluation lighting
- not final presentation lighting

### Keep out for now
- fog
- haze
- clouds
- water reflections
- cinematic grading

### Research anchors
- Three.js shadows / CSM path are mature and practical for early evaluation: https://threejs.org/docs/pages/DirectionalLight.html ; https://threejs.org/examples/?q=csm#webgl_shadowmap_csm

---

## Recommended implementation order inside Phase A

## Phase A1 — Shape evaluation baseline
- clay/shape mode
- minimal directional lighting
- early cascaded or improved directional shadows
- baseline terrain analysis views

## Phase A2 — Directable macro landform system
- mountain/range controls
- basin/plateau/escarpment controls
- ridge/valley/drainage guide structures
- multi-scale base heightfield design

## Phase A3 — Derived map system
- slope
- curvature
- flow accumulation
- erosion/deposition indicators
- debug overlays

## Phase A4 — Erosion refinement passes
- thermal relaxation / talus first
- hydraulic refinement second
- tile-based execution
- CPU reference + GPU compute acceleration where practical

## Phase A5 — Validation loop
- compare terrain before/after erosion in clay mode
- verify wide/mid/grazing readability
- confirm the terrain already feels strong without material assistance

---

## Success criteria

Phase A is successful if all of the following are true:

1. **Clay mode is compelling**
   - wide shots already feel intentional and believable

2. **Macro structure is directable**
   - terrain can be steered into ranges, basins, corridors, terraces, cliffs

3. **Analysis maps are useful**
   - slope/flow/curvature outputs are stable and visually meaningful

4. **Erosion improves shape rather than randomizing it**
   - channels, talus, flow lines, and deposition read better after refinement

5. **Shadows improve readability without expanding scope**
   - shadows help terrain evaluation, but Phase A is still clearly a shape phase, not a full lighting phase

---

## Risks and failure modes

### 1. Starting with erosion too early
Risk:
- polishing weak landforms

Mitigation:
- directable macro landforms first

### 2. Letting materials hide bad shape
Risk:
- false confidence

Mitigation:
- clay mode as a hard requirement

### 3. Scope creep into rendering polish
Risk:
- atmosphere/water/clouds hijack the phase

Mitigation:
- shadows allowed only as evaluation aid
- all other atmosphere/rendering polish deferred

### 4. Overbuilding compute too early
Risk:
- infrastructure work dominates terrain learning

Mitigation:
- bounded tile jobs
- CPU reference path first
- GPU compute only where it clearly helps

---

## Browser-native technique summary

For this phase, the strongest browser-native stack is:
- **WebGPU compute** for bounded erosion/derived-map jobs
- **CPU reference** for validation and fallback
- **heightfield-first terrain representation**
- **debuggable field outputs** instead of opaque procedural black boxes
- **minimal evaluation shadows** instead of early cinematic rendering complexity

This is the best balance of:
- realism
- performance
- browser compatibility
- development clarity

---

## Final recommendation

The first real build phase should be:

> **Directable macro terrain + derived terrain maps + erosion refinement + clay debug mode + minimal shadowed evaluation**

Not:
- erosion only
- atmosphere early
- materials first
- feature-clone parity

That is the scope boundary I recommend and would sign off on.
