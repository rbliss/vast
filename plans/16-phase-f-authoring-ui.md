# Phase F Authoring UI Plan

_Research compiled 2026-03-17 after milestone freeze `7f38272`_

## Why this phase exists

The runtime stack is now powerful, but it is still mostly controlled through:
- hardcoded presets
- URL params
- lightweight toolbar toggles
- code-level constants

That is enough for engineering validation, but not enough for a usable terrain authoring product.

Phase F2 should expose the existing capabilities through a **browser-native control surface** without turning the app into a bloated DCC clone.

This plan builds on the earlier constraints in:
- `09-ui-shell-constraints.md`
- `10-compute-infrastructure-constraints.md`
- `08-a0-foundation-work-package.md`

---

## F2 goals

### Primary goals
1. **Expose milestone parameters through a real editor shell**
2. **Make expensive changes explicit** with rebake/apply workflow
3. **Persist authoring state in the world document**
4. **Support reproducible terrain variants without URL surgery**
5. **Stay browser-native and lightweight**

### Secondary goals
- make debug/review workflows easier for Codex + Claude
- create a stable UI foundation for later tools/presets/layers
- keep the renderer/engine independent from the UI framework

### Explicitly out of scope
- full sculpt/paint/brush authoring
- node graph editor
- asset browser / marketplace
- collaborative multi-user editing
- full animation/camera sequencing
- giant panel docking system

---

## Current-state assessment

### What exists now
- a minimal world document with terrain + scene basics
- milestone-quality runtime systems across Phases A–E
- lightweight controls for clay, overlays, sun, presentation, etc.

### What is missing
1. **No coherent editing surface** for macro, erosion, materials, atmosphere, and presentation parameters
2. **No distinction between cheap live edits and expensive rebake edits**
3. **Document schema is too small** to represent the frozen milestone stack
4. **Query params are doing too much product work**
5. **No saveable named variants** for comparing terrain looks or lighting/material configurations

---

## Research findings: best browser-native techniques for F2

### 1. Lit remains the right shell choice
The earlier A0 shell decision still holds: **Lit + Web Components** is the best fit.

Why:
- native custom elements fit the current renderer-centric repo
- lightweight and framework-agnostic
- lets the UI grow around the engine instead of forcing the engine into a SPA architecture

Relevant references:
- Lit docs: https://lit.dev/docs/
- Lit Reactive Controllers: https://lit.dev/docs/composition/controllers/

### 2. Use async task controllers/patterns for bake-driven UI
The editor will frequently need to represent async states:
- rebaking terrain
- loading cached variants
- saving/opening documents

Lit’s task/controller patterns are a good fit for this.

Relevant reference:
- Lit async tasks: https://lit.dev/docs/data/task/

### 3. File System Access + OPFS should define the project workflow
F2 should preserve the local-first approach:
- OPFS autosave for drafts
- File System Access for open/save-as when available
- graceful fallback to JSON import/export otherwise

Relevant references:
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN OPFS: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system

### 4. BroadcastChannel is useful for draft/save coordination
If multiple tabs can open the same local project, the UI should at least surface state coherently.

Relevant reference:
- MDN Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API

### 5. Worker-aware UI is essential for expensive terrain editing
Because the terrain bake is heavy, the UI must not assume immediate synchronous updates. The authoring model needs:
- draft state
- pending state
- applying / rebaking state
- completed state
- failure/retry state

This is not optional; it should be part of the product model.

---

## Product stance for F2

The correct F2 product stance is:

> **parameterized terrain authoring with staged apply/rebake, not a full general-purpose terrain DCC.**

That means:
- strong parameter editing
- reproducible presets and variants
- clear preview/apply flow
- minimal shell complexity

It does **not** mean:
- freeform brush sculpting yet
- giant node graphs
- every control exposed at once

---

## Recommended UI architecture

## F2.1 — Shell structure

Use the shell pattern already chosen in `09-ui-shell-constraints.md`:
- **top bar** — project, save state, mode toggles, preset/variant controls
- **left pane** — stack/outliner
- **center** — viewport host
- **right pane** — inspector/property editing
- **bottom bar** — bake progress, cache state, perf/debug indicators

### Keep the current rule
The renderer stays embedded in the viewport region. UI components talk to stores/services; the renderer does not import UI components.

---

## F2.2 — State model

### Recommended store split
1. **Project store**
   - current document
   - dirty state
   - autosave status
   - active file handle / project identity

2. **Authoring store**
   - selected preset / variant
   - draft parameter edits
   - pending rebake state
   - last applied bake metadata

3. **Viewport store**
   - clay mode
   - overlay mode
   - presentation mode
   - sun / water / cloud / exposure controls

4. **Capabilities/runtime store**
   - storage persistence status
   - cache hit/miss
   - worker/bake progress
   - WebGPU/device tier

### Important rule
Do **not** make Lit components the source of truth for world state. The document and authoring state live in plain TS stores/services.

---

## F2.3 — Document evolution

### Problem
`WorldDocumentV0` is too small for the current stack.

### Decision
Introduce a richer document version (likely `WorldDocumentV1`) that can represent:

#### Terrain authoring
- terrain type / preset
- macro field parameters
- erosion config
- deposition/fan config
- bake domain config (extent/grid/field resolution)

#### Material authoring
- snow thresholds
- sediment/material thresholds
- anti-tiling / macro variation settings
- any field-texture material settings that are meant to be user-editable

#### Scene / atmosphere authoring
- sun azimuth / elevation
- exposure
- water level
- cloud coverage / speed / direction
- IBL toggle / presentation mode defaults if needed

#### Scatter authoring
- density multipliers
- alpine/deposition behavior thresholds
- per-class enable/disable flags

#### UI/editor metadata
- selected variant
- last used inspector section
- debug mode preference (optional)

### Migration requirement
Keep a migration path from the current `WorldDocumentV0` so old docs still open.

---

## F2.4 — Parameter classes: live vs rebake vs presentation

This is the most important authoring design rule.

### Class A — live runtime parameters
Can update immediately without a terrain rebake.
Examples:
- sun azimuth / elevation
- exposure
- cloud coverage
- water level
- clay mode / overlays / presentation mode

### Class B — material/scatter re-evaluation parameters
May require re-uploading field/material/scatter data but not a full erosion bake.
Examples:
- snow threshold
- sediment material threshold
- scatter density multipliers
- some material color/roughness controls

### Class C — terrain rebake parameters
Require a new bake.
Examples:
- macro field parameters
- erosion config
- deposition/fan config
- bake extent / resolution

### UX implication
The UI should clearly label these classes:
- **Live**
- **Apply**
- **Rebake**

Do not hide expensive operations behind innocent sliders.

---

## F2.5 — Recommended first inspector sections

### Section 1 — Terrain preset + macro composition
Goal: expose the shape system, not every math knob.

Start with:
- preset selector (`chain`, `basin`, `plateau`, future custom)
- high-level controls:
  - range strength
  - basin depth
  - plateau elevation
  - drainage emphasis
  - relief scale

### Section 2 — Erosion / deposition
Start with a carefully curated subset:
- stream-power iterations
- erosion strength
- diffusion strength
- fan/deposition strength
- detail erosion enable/disable

### Section 3 — Materials
Start with:
- snow amount / altitude threshold
- rock dominance on steep slopes
- sediment emphasis
- grass/dirt balance

### Section 4 — Atmosphere / presentation
Start with:
- sun azimuth
- sun elevation
- exposure
- water level
- cloud coverage
- presentation toggle / bloom toggle

### Section 5 — Scatter
Start with:
- grass density multiplier
- shrub density multiplier
- rock density multiplier
- alpine cutoff
- depositional debris emphasis

This sequence matches the project’s visual stack.

---

## F2.6 — Presets, variants, and comparison workflow

### Presets
A preset defines a baseline authored terrain family:
- chain
- basin
- plateau
- future custom templates

### Variants
A variant is a saveable parameter snapshot under a preset.
Examples:
- `chain / sharp winter dawn`
- `basin / green lake noon`
- `plateau / dry red sunset`

### Required variant features
- duplicate variant
- rename variant
- reset variant to preset defaults
- compare current draft vs last applied
- revert unapplied edits

This is a much better authoring workflow than query strings.

---

## F2.7 — Bake/apply workflow

### Expensive-change UX
When Class C parameters change:
- UI enters **dirty / rebake required** state
- user can **Apply/Rebake** explicitly
- progress appears in bottom bar + inspector section
- previous terrain stays visible until new bake completes
- on success, runtime swaps to new artifacts
- on failure, previous terrain remains active and error is shown

### Why this is important
This preserves responsiveness and prevents “slider froze the app” behavior.

### Optional enhancement
Later, we can add debounced “auto-rebake after idle” for small parameter tweaks, but not in F2 v1.

---

## F2.8 — Save/load/autosave behavior

### Save model
1. **Autosave draft** to OPFS
2. **Open / Save As** with File System Access when supported
3. **Import / Export JSON** fallback always available

### Autosave rules
- autosave document edits quickly
- do not autosave huge binary bake artifacts into the document itself
- bake artifacts stay in cache, referenced by cache key/metadata

### Recovery UX
On reload:
- offer to restore the last autosaved draft if it differs from the saved project
- show whether the terrain bake was restored from cache or will rebake

---

## F2.9 — Recommended implementation order

### F2.1 — shell hardening
- formalize the Lit shell
- move ad hoc toolbar controls into structured components
- bottom status bar for bake/cache/save state

### F2.2 — store layer
- project store
- authoring store
- viewport store
- runtime/capabilities store

### F2.3 — document v1 + migration
- extend document schema for milestone parameters
- add migration from v0

### F2.4 — first inspector sections
- terrain/macro
- erosion/deposition
- atmosphere/presentation

### F2.5 — apply/rebake workflow
- dirty state
- explicit apply/rebake buttons
- progress/error/retry in UI

### F2.6 — variants + persistence polish
- saveable variants
- reset/revert/duplicate
- autosave + file integration

---

## Suggested implementation boundaries for Claude

### Good v1 boundary
A successful F2 v1 lets a user:
- open the app
- choose `chain`, `basin`, or `plateau`
- edit a curated set of terrain/erosion/material/scene parameters
- rebake safely when required
- save the result as a named variant in the document
- restore it later without manual URL params

### Avoid in v1
- exposing every low-level constant
- freeform user-defined macro field graph editor
- per-layer reorderable terrain stack
- general asset browser

The point is to make the current system **usable**, not infinitely configurable.

---

## Acceptance criteria

F2 is successful when all of the following are true:

1. **The current milestone look can be reproduced from UI controls**
   - not by hand-editing code or query strings

2. **Heavy edits are explicit and safe**
   - rebake-required changes do not silently freeze the app

3. **World documents carry the important authored state**
   - presets, variants, terrain/erosion/material/scene controls round-trip

4. **Autosave/recovery is credible**
   - the user can recover a recent draft after reload

5. **The renderer remains decoupled from the shell**
   - UI/store changes do not require renderer recreation

6. **The shell remains lightweight**
   - no heavy docking framework
   - no giant framework migration

---

## Risks and mitigations

### Risk: UI exposes too many knobs too early
Mitigation:
- curate controls by visual importance
- advanced controls can stay hidden or debug-only

### Risk: rebake/apply workflow feels clumsy
Mitigation:
- separate live vs rebake parameters clearly
- keep last good terrain visible during rebake
- show progress and expected cost

### Risk: document schema churn
Mitigation:
- version the schema explicitly
- add migration functions early
- keep derived/cache artifacts out of the main document payload

### Risk: shell and engine become entangled
Mitigation:
- store/service boundaries
- renderer only receives commands/state, not UI component imports

---

## What comes after F2

Once F2 lands, the project will have:
- a robust runtime stack
- a local-first save/load story
- a usable terrain authoring surface

Only then is it worth choosing between:
- more productized terrain tools
- deeper polish/backlog items
- broader world-building features

---

## Recommendation

The correct Phase F2 implementation strategy is:

> **build a Lit-based authoring shell around stores and a staged apply/rebake workflow, then serialize those authored states into a richer world document.**

That gives the current terrain system a real product surface without overcommitting to a heavyweight editor architecture.

---

## Sources / references
- Lit docs: https://lit.dev/docs/
- Lit Reactive Controllers: https://lit.dev/docs/composition/controllers/
- Lit async tasks: https://lit.dev/docs/data/task/
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN OPFS: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- MDN Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
