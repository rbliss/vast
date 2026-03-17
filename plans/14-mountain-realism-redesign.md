# Mountain Realism Redesign Plan

_Research compiled 2026-03-17 after A4 visual evaluation_

## Current state assessment

### What A4 erosion achieves
- Channels form on steep slopes (visible incision lines)
- Ridge breakdown at peaks (erosion carving between spires)
- Some depositional texture at slope bases
- Thermal relaxation prevents unrealistically steep faces
- The terrain reads as "eroded" rather than "pure noise"

### Where A4 falls short of the realism target
Evaluated in clay mode, the current result still reads as **eroded noise** rather than **landscape structure**:

1. **No hierarchical drainage** — channels don't merge into larger rivers downstream. Each droplet carves independently, producing parallel rills rather than branching networks.

2. **No convincing fans/aprons** — deposition at slope bases is noise-like pitting (scalloped dimples), not organized alluvial fan shapes. Real mountain fronts show smooth, wide fans radiating from channel exits.

3. **No downstream valley organization** — there's no sense of "many small channels feeding fewer large ones." The drainage doesn't converge.

4. **Lowlands remain unstructured** — flat areas between mountains have the same noise texture everywhere, rather than showing floodplain, alluvial fill, or organized channel-exit deposits.

5. **No mass-wasting signatures** — real mountains show landslide scars, talus aprons, and slump features. Our thermal erosion smooths slopes but doesn't create these recognizable forms.

### Root cause
Droplet-based hydraulic erosion is fundamentally a **local incision tool**. It carves where individual particles flow, but it doesn't understand:
- watershed structure
- stream-power relationships (bigger catchments = stronger erosion)
- transport-limited vs detachment-limited regimes
- sediment budget (where material goes when it's removed)

---

## Research findings

### The strongest published direction

The literature converges on a **hybrid stack** for believable mountain terrain:

#### 1. Hydrology-first macro structure
Believable mountains start from **drainage and watershed structure**, not noise + erosion.

- **Génevaux et al. 2013** — construct terrain around a hydrology graph (river network first, then terrain interpolated to satisfy drainage constraints)
  - https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf

- **Cordonnier et al. 2016** — uplift + stream-power erosion law produces controlled watersheds, ridges, and dendritic structure. The stream-power law (E ∝ A^m × S^n where A = drainage area, S = slope) is the key physical model.
  - https://diglib.eg.org/items/13e52c36-0200-4652-aacf-17aa3098c5fd

- **Tzathas et al. 2024** — analytical stream-power terrain generation with hillslope diffusion. Fast, consistent, produces large-scale mountain structure without iterative simulation.
  - https://www-sop.inria.fr/reves/Basilic/2024/TGSC24/

#### 2. Deposition-aware erosion
Fans and aprons require **transport-limited deposition**, not just incision.

- **r.sim.terrain (2019)** — explicitly models erosion/deposition regimes. Shows widened gullies with depositional levees and fan structures.
  - https://gmd.copernicus.org/articles/12/2837/2019/

- **Št'ava et al. 2008** — interactive tiled erosion. Useful for workflow, but not sufficient alone for macro realism.
  - https://diglib.eg.org/items/60afda0c-a666-4df8-90dd-9b80afc554c2

#### 3. High-frequency erosion detail (post-macro)
For near/mid-scale surface breakup after the main landforms are correct:

- **Grenier et al. 2024** — controlled procedural erosion patterns, GPU-friendly, slope/flow-oriented
  - https://diglib.eg.org/bitstream/handle/10.1111/cgf14992/v43i1_05_cgf14992.pdf

- **Nilles et al. 2024** — real-time hydraulic erosion on multi-layered heightmaps, standard compute shader compatible (relevant to WebGPU)
  - https://diglib.eg.org/items/deefa865-6a25-4463-adcd-d8de2b37507e

---

## Proposed architecture: hybrid mountain pipeline

### Stage 1 — Macro drainage graph
- Generate or specify a drainage network (river tree / watershed boundaries)
- Could be computed from the existing macro landform fields, or specified as guide data
- The drainage graph defines: where rivers are, how catchments partition, where divides sit

### Stage 2 — Stream-power terrain shaping
- Use the stream-power law (E ∝ A^m × S^n) to carve the terrain along the drainage network
- Larger catchment areas produce deeper, wider valleys
- This creates the hierarchical channel structure that droplet erosion cannot
- Cordonnier 2016 and Tzathas 2024 are the strongest references here

### Stage 3 — Hillslope diffusion / mass wasting
- Smooth hillslopes between channels using diffusion (like thermal erosion but physics-informed)
- Model landslide/talus events on slopes exceeding critical angle
- This connects ridges to valleys with realistic slope profiles

### Stage 4 — Transport and deposition
- Compute sediment transport along the drainage network
- Deposit sediment where channels widen, slope decreases, or flow exits mountain front
- This creates fans, aprons, floodplains, and depositional fill
- r.sim.terrain is the strongest reference for this regime

### Stage 5 — Local detail refinement
- High-frequency erosion detail (rills, gullies, surface breakup)
- Can use the existing droplet erosion or Grenier 2024 procedural patterns
- This is the last pass, not the foundation

### The key insight
> **The current pipeline has Stage 5 only. Stages 1-4 are where the realism actually comes from.**

---

## Browser-native execution strategy

### CPU worker path (recommended first)
- Drainage graph computation: Web Worker with transferable buffers
- Stream-power iteration: bounded iteration count, predictable memory
- Cache results in OPFS for reload

### WebGPU compute path (later)
- Stream-power and diffusion are parallelizable over the heightfield grid
- Drainage graph construction is harder to parallelize (topological sort dependency)
- Best used for the detail refinement pass (Stage 5)

### Memory budget
- 512x512 float32 grid ≈ 1 MB
- With 4-6 auxiliary fields (drainage area, slope, sediment, etc.) ≈ 4-6 MB
- Well within Tier M budget (192 MiB CPU terrain cache)

---

## Recommended implementation order

### Phase A4.1 — Drainage area computation
- Compute D8/D-infinity flow accumulation over the full macro terrain grid
- This gives us catchment area (A) at every cell — the key input for stream-power
- CPU reference, same grid as current erosion bake

### Phase A4.2 — Stream-power incision
- Apply E ∝ A^m × S^n iteratively to carve channels
- Larger A = deeper/wider channels = hierarchical drainage
- This replaces droplet erosion as the primary channel generator

### Phase A4.3 — Hillslope diffusion
- Smooth slopes between channels using linear/nonlinear diffusion
- Replaces thermal erosion with a physics-informed version
- Adds realistic concave-up slope profiles

### Phase A4.4 — Deposition and fan formation
- Track sediment transport capacity along flow paths
- Deposit where capacity drops (slope decrease, channel widening)
- Creates fans, aprons, valley fill

### Phase A4.5 — Detail refinement
- Keep existing droplet erosion or add procedural detail patterns
- Apply only after Stages 1-4 produce the macro structure
- Lower iteration count, focused on surface texture

---

## Success criteria for the redesign

In clay mode, the terrain should show:

1. **Hierarchical drainage** — visible channel branching (many small → fewer large)
2. **Organized valleys** — channels converge downstream
3. **Fan/apron formation** — smooth depositional shapes at mountain fronts
4. **Realistic slope profiles** — concave-up hillslopes between ridges and valleys
5. **Ridge/divide clarity** — sharp ridges where watersheds meet
6. **Scale-appropriate detail** — fine rills near camera, broad valleys at distance

---

## What this means for Phase A

Phase A was originally scoped as:
> directable macro terrain + terrain analysis maps + erosion refinement + clay debug mode + minimal shadowed evaluation

The current A4 satisfies "erosion refinement" as a prototype, but the mountain realism target requires replacing the erosion foundation with a stream-power/hydrology-based approach. This is a substantial architectural change — it's closer to an **A4 redesign** than tuning.

### Recommendation
Treat the current A4 as **erosion v1 (prototype)**. The stream-power redesign becomes **erosion v2**, which should be the target before declaring Phase A complete and moving to Phase B (materials).
