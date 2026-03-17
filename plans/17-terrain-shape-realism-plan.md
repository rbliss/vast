# Terrain Shape Realism Plan

_Research compiled 2026-03-17 after operator redirect away from scatter presentation and back to clay-mode terrain realism._

## Priority reset

This plan **supersedes near-term scatter presentation work**.

The operator's priority is clear:
- **terrain shape realism is #1**
- **clay mode is the proving ground**
- ground cover, textures, and foliage come later
- success means the terrain looks believable as terrain, not just attractive after shading

So the next work should focus on:
- realistic mountains
- realistic basins and lowlands
- believable buttes / mesas / escarpments
- stronger channel networks and stream beds
- more credible erosion and deposition signatures
- mass-wasting / talus / slope-failure reads where appropriate

---

## Current state assessment in clay mode

The current shape stack is already much better than the original FBM terrain:
- macro presets now read as **chain / basin / plateau**
- stream-power incision gives some channel hierarchy
- fan/apron deposition is visible at some mountain fronts
- basin floors are organized instead of noisy
- plateau / mesa reads exist

But the realism bar is now higher than "better than noise."

### What still feels weak or incomplete

1. **Drainage hierarchy is still too subtle**
   - channels converge, but not strongly enough to read as a convincing watershed tree
   - current bounded 512 grid + D8 routing limits network richness

2. **Stream beds are implied, not fully shaped**
   - channels are mostly incision signals in the heightfield
   - bankfull width, inner channel bed, and valley-floor organization are still underdeveloped

3. **Mass-wasting signatures are weak**
   - slopes relax, but we do not yet get convincing talus aprons, slump scars, debris chutes, or steep-slope collapse patterns

4. **Buttes / mesas / escarpments are still mostly geometric presets**
   - they read compositionally, but not yet as strongly **differentially eroded landforms**
   - cliffs, caprock logic, and retreating escarpment behavior are weak

5. **Terraces are largely absent**
   - valley benches, incision terraces, and stepped fluvial history are not really present yet

6. **Low-gradient valleys and basin interiors are still simplified**
   - some are clean and organized, but still lack the structured stream-bed / floodplain / inset-channel read seen in strong reference terrain

7. **The current terrain is still too "single-process"**
   - fluvial incision is now the dominant readable process
   - realism needs a more explicit combination of:
     - fluvial incision
     - deposition
     - hillslope transport
     - threshold failure / debris motion
     - structural resistance

---

## The central realism principle

> **Believable terrain shape comes from multiple interacting geomorphic regimes, evaluated first in clay mode.**

That means:
- **watersheds and drainage trees** define large-scale organization
- **stream power** defines incision strength
- **hillslope transport** connects ridges to channels
- **deposition** creates aprons, fans, valley fill, and floodplain tendencies
- **material resistance / structural fields** create mesas, buttes, cliff bands, and escarpments
- **episodic incision / base-level change** creates terraces and benches

---

## Research findings: best-practice techniques for realistic terrain shape

### 1. Hydrology-first structure remains the strongest foundation

The most consistent result in both CG and geomorphology is that believable mountain terrain starts from **watershed organization**, not from noise plus local erosion.

- **Génevaux et al. 2013**: terrain generation from procedural hydrology models. The key lesson is that the drainage graph should constrain the terrain, not be an afterthought.
  - https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf

- **Cordonnier et al. 2016**: stream-power incision plus uplift gives controlled watersheds, ridges, and valley systems. This is still the strongest foundation for realistic mountain-scale form.
  - https://diglib.eg.org/items/13e52c36-0200-4652-aacf-17aa3098c5fd

- **Tzathas et al. 2024**: analytical terrain generation from stream-power and hillslope laws. Important because it emphasizes that large-scale realism comes from the governing fluvial/hillslope model, not just simulation texture.
  - https://www-sop.inria.fr/reves/Basilic/2024/TGSC24/

### 2. Flow routing quality matters more than extra noise detail

Our current D8 routing is acceptable as a first pass, but it is also one of the clearest realism bottlenecks.

- **FastFlow 2024** shows that modern flow routing can be made much faster and more scalable, which is relevant to future browser-native refinement.
  - https://www-sop.inria.fr/reves/Basilic/2024/JKGFC24/FastFlowPG2024_Author_Version.pdf

**Inference from the literature and current results:**
- D8 is fine for a prototype
- to get stronger drainage hierarchy, better fans, and less grid bias, we likely need **D∞ / multi-flow / improved routing** in the next realism pass

### 3. Deposition and debris motion are required for mountain realism

Stream-power incision alone improves channels, but realistic mountains also need **transport and failure regimes**.

- **r.sim.terrain (2019)** demonstrates how erosion/deposition regime modeling creates much more believable gullies, depositional zones, and lowland organization.
  - https://gmd.copernicus.org/articles/12/2837/2019/

- **Aryamaan et al. 2024** focuses on debris-flow erosion and deposition on steep terrain. The main relevance here is not exact method reuse, but the lesson that steep landscapes need a separate debris/landslide-like regime, not only fluvial incision.
  - https://www.cs.purdue.edu/cgvlab/www/resources/papers/Aryamaan-ToG-2024-efficient.pdf

### 4. High-frequency erosion detail should come last, not first

- **Grenier et al. 2024**: controlled procedural erosion patterns are valuable for surface breakup after the large-scale landforms are already correct.
  - https://diglib.eg.org/bitstream/handle/10.1111/cgf14992/v43i1_05_cgf14992.pdf

- **Nilles et al. 2024**: modern real-time hydraulic erosion is useful for detail refinement and is compute-friendly for future WebGPU use.
  - https://diglib.eg.org/items/deefa865-6a25-4463-adcd-d8de2b37507e

**Implication:**
- we should not spend the next iteration chasing prettier rills
- the bigger shape gains come from routing, channel geometry, hillslope transport, and structural controls

### 5. Buttes / mesas / terraces need more than generic erosion

This part is partly an inference from geomorphology and partly from our current results.

To get believable:
- **mesas / buttes**
- **retreating escarpments**
- **bench-and-cliff terrain**
- **valley terraces**

we need additional controls beyond plain stream-power:

1. **Resistance / lithology fields**
   - harder layers erode slower
   - softer layers undercut and retreat
   - creates caprock behavior, cliff bands, and stepped retreat

2. **Base-level / incision pulses**
   - terraces and benches often read as multiple incision epochs rather than one smooth equilibrium valley

3. **Threshold slope failure**
   - cliffs and steep scarps need collapse / talus / debris release behavior, not only diffusion

These are the shape systems most likely to make plateaus and buttes stop feeling like "nice presets" and start feeling geologically motivated in clay mode.

---

## What specific geomorphic features we should target next

### 1. Stronger watershed trees
**Current weakness:** channel hierarchy is present but subdued.

**Target:**
- obvious tributary-to-trunk organization
- clearer divides
- larger valleys receiving smaller branches

**Best technique:**
- improve routing from D8 toward **multi-flow / D∞-style accumulation**
- support depression handling / outlet definition explicitly
- optionally raise bake resolution or use multiscale solve for the drainage field

### 2. Explicit stream-bed shaping
**Current weakness:** channels read as incision grooves more than structured stream corridors.

**Target:**
- width/depth scaling with drainage area
- clearer bed vs bank
- transition from headwater cuts to broader valley floors downstream

**Best technique:**
- add a **channel geometry pass** after flow accumulation:
  - derive effective discharge from drainage area
  - scale bed width and carving radius with area
  - preserve steeper V-shaped headwaters, broaden downstream reaches

### 3. Hillslope transport and mass wasting
**Current weakness:** slopes are smoother, but do not show convincing talus or collapse signatures.

**Target:**
- talus cones below cliffs
- steep debris chutes
- slump / scar signatures on oversteepened faces
- stronger ridge-to-channel slope continuity

**Best technique:**
- replace pure diffusion-only thinking with **thresholded hillslope transport**:
  - nonlinear diffusion below threshold
  - debris/talus transfer above threshold
  - optional localized collapse events seeded by oversteepening

### 4. Differential erosion for buttes / mesas / escarpments
**Current weakness:** buttes and mesas are compositionally good but not strongly geologic.

**Target:**
- caprock mesas
- cliff bands
- undercut softer layers
- retreating escarpments
- isolated buttes left behind from retreat

**Best technique:**
- introduce a **resistance field** or layered structural field:
  - height-dependent or world-layer-based erodibility bands
  - harder cap layers protect mesa tops
  - softer mid-layers retreat faster
- apply erosion/deposition with resistance-aware coefficients

### 5. Terraces and benches
**Current weakness:** valleys are mostly smooth continuums.

**Target:**
- terrace levels in valleys
- stepped benches on basin margins
- inset channels / incision history

**Best technique:**
- a **terrace pass** driven by one of:
  - episodic incision / base-level lowering
  - uplift pulses
  - preserved former floodplain levels
- initially this can be a simplified procedural/geomorphic pass, not a full time-dependent Earth-science model

### 6. Better basin-floor and low-gradient organization
**Current weakness:** basin floors are organized, but still somewhat too smooth/simple.

**Target:**
- broad depositional floor
- inset channels or drainage threads
- subtle levees / shallow fans at inflows
- clearer outlet or ponded interior logic

**Best technique:**
- improve low-gradient routing and deposition handling
- allow broad shallow transport/deposition instead of only narrow receiver-driven flow

---

## Recommended implementation roadmap

## S1 — Clay-mode realism review harness

Before adding more erosion systems, tighten evaluation.

### Deliverables
- fixed same-camera clay review set for:
  - chain wide
  - chain grazing
  - mountain-front/channel-exit
  - basin wide + basin mid
  - plateau/butte grazing
- review checklist recorded with each packet:
  - drainage hierarchy
  - ridge/divide clarity
  - stream-bed readability
  - fan/apron readability
  - butte/mesa realism
  - basin-floor organization
  - mass-wasting signatures

### Why first
We should not continue shape work without a stricter clay-mode gate.

---

## S2 — Drainage realism upgrade

### Goal
Make the watershed tree more obvious and less grid-biased.

### Recommended work
- upgrade flow routing from pure D8 toward **D∞ or multi-flow accumulation**
- add explicit depression handling / outlet enforcement where needed
- preserve basin behavior intentionally rather than accidentally
- if needed, raise bake resolution or add multiscale accumulation for the routing field

### Expected clay-mode win
- clearer tributary trees
- fewer parallel scratch-like channels
- stronger downstream organization

---

## S3 — Channel geometry pass

### Goal
Turn incision lines into more believable stream corridors.

### Recommended work
- derive channel class from drainage area and slope
- scale bed width / incision kernel by drainage area
- create narrower headwaters, broader downstream beds
- shape banks differently from bed centerline
- preserve basin-floor inset channels where appropriate

### Expected clay-mode win
- stream beds become readable, not just etched lines
- wider valleys make sense downstream

---

## S4 — Threshold hillslope transport / mass wasting

### Goal
Add slope-failure signatures and better ridge-to-valley slope transitions.

### Recommended work
- retain gentle nonlinear diffusion for subcritical slopes
- add thresholded debris transfer when slope exceeds critical angle
- accumulate talus/debris below scarps and cliffs
- optionally stamp sparse slump scars / chute features on oversteepened walls

### Expected clay-mode win
- more convincing cliff bases
- talus aprons below steep faces
- less purely smoothed slope behavior

---

## S5 — Structural resistance field for mesas / buttes

### Goal
Make plateaus, buttes, and escarpments feel geologically caused, not only artistically placed.

### Recommended work
- introduce a resistance/lithology field:
  - layered erodibility bands
  - optional noise/warp to break perfect horizontality
- let stream-power, thermal, and debris transport all respect resistance
- protect caprock zones and accelerate softer underlayers

### Expected clay-mode win
- stronger cliff-band identity
- more believable escarpment retreat
- isolated buttes that feel left behind by erosion, not manually stamped

---

## S6 — Terrace / bench formation pass

### Goal
Create visible fluvial history in valleys and basin margins.

### Recommended work
- simplified terrace generation via:
  - episodic incision levels
  - base-level pulse history
  - preserved former valley floors on selected reaches
- begin with a constrained pass on suitable low-gradient valleys only

### Expected clay-mode win
- valleys gain stepped benches
- basin margins feel less uniformly smooth
- more visual evidence of long-term incision history

---

## Scope guidance: what to do first

### Highest-value next work
If we only do one more major shape push, it should be:

1. **S2 drainage realism upgrade**
2. **S3 channel geometry pass**
3. **S4 threshold hillslope / mass wasting**

Why:
- these give the largest broad realism gains across mountains, basins, and channel networks
- they improve clay mode immediately
- they do not depend on textures or foliage

### Second wave
4. **S5 resistance field for buttes/mesas**
5. **S6 terraces/benches**

Why second:
- these are important for high-end realism
- but they are more specialized and easier to over-design before watershed/channel realism is fully strong

---

## What not to prioritize right now

Do **not** prioritize yet:
- foliage assets
- rock scatter presentation
- material polish
- close-range texture work
- extra post-processing
- cloud/water refinements

Those can all make screenshots prettier, but they do not solve the operator's core request:

> **realistic terrain shape first, validated in clay mode**

---

## Acceptance criteria for the next terrain-shape milestone

In clay mode, across chain / basin / plateau-butte cases, the terrain should show:

1. **Stronger drainage hierarchy**
   - obvious tributaries feeding larger valleys

2. **Readable stream beds**
   - channels that have bed/bank character, not just incision scratches

3. **More believable mountain fronts**
   - fans / aprons / debris bases visible without explanation

4. **Mass-wasting signatures**
   - talus, collapse, chute, or slump reads on steep terrain where appropriate

5. **More geologic plateaus/buttes**
   - escarpments and isolated remnants feel resistance-driven, not only procedurally stamped

6. **Valley/basin history**
   - some benches, terraces, or inset drainage organization instead of uniformly smoothed lowlands

If the terrain still looks convincing only after materials, this phase has not succeeded.

---

## Recommended next implementation order for Claude

### Phase H0 — shape realism revisit

#### H0.1
- formal clay-mode review harness
- no algorithm change yet

#### H0.2
- drainage routing upgrade
- better accumulation / outlet handling

#### H0.3
- explicit channel geometry pass

#### H0.4
- threshold hillslope transport / talus / mass wasting

#### H0.5
- structural resistance field for buttes / escarpments

#### H0.6
- optional terrace/bench pass

---

## Bottom line

The current terrain stack is good enough to support materials and atmosphere, but the operator is asking for a higher clay-mode realism bar.

The next realism gains will **not** come from scatter or shader polish.
They will come from improving the shape stack in this order:

1. **better watershed / routing realism**
2. **better channel geometry**
3. **better hillslope + mass-wasting behavior**
4. **resistance-driven mesas / buttes / escarpments**
5. **terraces / incision history where useful**

That is the path most likely to make the terrain read as believable geomorphology before any surface dressing.
