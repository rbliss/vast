# Blank Canvas Sculpt Workflow Plan

_Compiled 2026-03-17 after operator redirect to a tighter terrain-shape experiment._

## Goal

When the app loads, it should open into a **blank sculpt canvas**:
- large flat plane
- clay mode on
- no textures
- no erosion
- no foliage
- no atmosphere clutter
- no water/clouds/presentation effects

From there, the user can **raise terrain by clicking**. Repeated clicks on the same area accumulate height.

The current milestone world should not disappear; it should move behind a top-level button named:
- **Test Environment**

This creates two explicit environments:

1. **Blank Canvas** — fast sculpt experiment, default startup
2. **Test Environment** — current full baked world, for comparison and regression checks

---

## Product stance

This is not a full terrain editor yet.

It is a **tight sculpt experiment** designed to answer one core question:

> Can we directly author terrain shape from an empty plane and evaluate it in clay mode before erosion/material dressing?

So the first version should optimize for:
- immediacy
- simplicity
- shape readability
- low startup cost
- low conceptual overhead

Not for:
- full brush suite
- erosion simulation from the brush path
- painting textures
- foliage workflows
- advanced layers

---

## User workflow

## Startup experience

### Default load
App opens into:
- flat terrain at height 0
- clay mode enabled
- sun at a readable angle (keep shadows)
- no textures
- no scatter
- no water/clouds
- no presentation mode
- no erosion bake

The first screen should feel like a neutral tabletop sculpt space.

### Top bar
Top bar should include:
- **Raise** tool active by default
- brush size control
- brush strength control
- optional falloff control
- **Reset Canvas** button
- **Test Environment** button

Optional but useful:
- **Blank Canvas** button when not already on it
- Undo / Redo

---

## Interaction model

### Primary interaction
- **Hover** shows a circular brush preview projected onto the terrain
- **Left click** applies one raise stamp
- **More clicks in the same area = higher terrain**
- Clicks nearby blend into a mound/ridge naturally via falloff

### Recommended first-version semantics
- one click = one additive height stamp
- holding mouse can be deferred; repeated clicking is enough for v1
- no lower/smooth/flatten tool in the first pass unless trivial

### Brush controls
#### Minimum controls
- **Size** — world-space radius of brush
- **Strength** — height added per click

#### Nice-to-have control
- **Falloff** — soft vs tighter mound profile

### Visual feedback
After each click:
- terrain updates immediately in the clicked region
- shadows update with the new shape
- no other systems distract from the form

---

## Environment switching

## Blank Canvas
This is the new default startup state.

### Characteristics
- terrain type: editable flat heightfield
- clay material only
- no erosion or channel generation
- no field-driven material logic needed
- no scatter
- no atmosphere clutter beyond minimal readable light/shadow

## Test Environment
This loads the current milestone world — the existing authored/baked scene.

### Characteristics
- current H1/B4 terrain and rendering stack
- existing materials/atmosphere/scatter as currently frozen
- used as a comparison world, not the default startup

### UX recommendation
Clicking **Test Environment** should:
- switch the document/runtime from blank canvas to the current authored test world
- preserve current blank-canvas session in memory if possible, so the user can switch back without losing sculpt work

If preserving both live sessions is too much for v1, acceptable fallback:
- prompt before replacing unsaved blank canvas work

---

## Recommended architecture

## 1. Add a new terrain path: editable blank canvas

### New terrain mode
Introduce a terrain mode distinct from the baked macro/erosion pipeline:
- `terrain.type = 'editable_heightfield'` (or similar)

This mode should:
- start as a flat grid
- support direct height edits
- **not** go through the heavy 8-stage erosion bake

### Why this should be separate from the current bake path
The current bake path is optimized for:
- procedural macro fields
- erosion passes
- caching expensive results

The blank sculpt canvas needs the opposite:
- immediate edits
- local updates
- no worker roundtrip for every click
- no mandatory erosion stage

So this should be a **fast path**, not a special case of the baked pipeline.

---

## 2. Use an editable heightfield backend

### Recommended representation
Use a world-space height grid, e.g.:
- extent: same as current terrain domain (or slightly larger if desired)
- resolution: 256² or 512² to start
- values: `Float32Array`

### Why a height grid is better than only storing clicks
A raw brush-stroke list is simple, but it makes runtime sampling and later editing workflows harder.

A direct heightfield grid gives:
- immediate local edits
- direct chunk rebuild from current heights
- easy future smoothing/lowering tools
- straightforward save/load

### Internal model
Suggested components:
- `EditableHeightfield`
  - owns height array
  - applies brush stamps
  - returns dirty region
- `EditableHeightfieldTerrainSource`
  - samples the current heightfield for chunk generation
- `BrushStamp`
  - center x/z
  - radius
  - strength
  - falloff type

The source samples the heightfield, not a procedural bake artifact.

---

## 3. Local rebuild only

Each click should:
1. raycast to terrain
2. compute brush influence in heightfield space
3. modify only affected cells
4. determine affected chunk bounds
5. rebuild only those chunks

This is the critical workflow difference from the heavy bake path.

### Acceptance target
- visible response within a frame or two
- no full terrain bake
- no full-scene reset

---

## 4. Clay-only render mode for this environment

For the blank canvas environment:
- force clay mode on
- disable textured terrain material path
- disable foliage entirely
- disable water/clouds/presentation effects
- keep directional shadows on for shape readability

This keeps the experiment honest.

---

## 5. Current world as a separate test document

The existing startup state should become a dedicated pre-authored document/profile:
- `createTestEnvironmentDocument()` or equivalent

The new default startup document becomes:
- `createBlankCanvasDocument()`

This keeps the two flows explicit and easy to compare.

---

## UI design

## Top bar layout
Recommended minimal toolbar:
- **Raise** (active tool)
- **Brush Size** slider
- **Brush Strength** slider
- **Reset Canvas**
- **Test Environment**

When in Test Environment:
- show **Blank Canvas** button to return

### Inspector
For v1, keep inspector minimal:
- Tool section
  - size
  - strength
  - falloff
- Session section
  - mode: Blank Canvas / Test Environment
  - resolution / extent (read-only at first)

Do not expose erosion/material/scatter controls in Blank Canvas mode.

---

## Brush behavior details

## Stamp profile
Recommended default brush shape:
- smooth radial falloff
- Gaussian or smoothstep dome

### Why
A hard-edged circular raise will create ugly stepped plateaus immediately.
A soft dome gives intuitive mound-building and is easy to reason about.

## Height accumulation
Each click adds:
- `height += strength * falloff(distance/radius)`

Repeated clicks at the same point naturally form a higher mound.

## Future tools, deferred
Not needed for v1, but this architecture supports later:
- lower
- smooth
- flatten
- terrace brush
- ridge brush
- erosion preview from edited terrain

---

## Persistence model

For the first pass, there are two acceptable options:

### Option A — Ephemeral session first (fastest)
- Blank canvas exists only in memory
- Reset clears it
- switching away may discard it unless explicitly preserved in session

### Option B — Persist editable heightfield (preferred if affordable)
- save heightfield as compact binary or quantized array in project storage
- restore blank-canvas state on reload

### Recommendation
Start with:
- **in-memory session persistence during app lifetime**
- optional autosave later once the interaction feels right

Do not let save format complexity block the experiment.

---

## Technical implementation phases

## Phase 1 — Blank Canvas startup mode
- add blank-canvas document/runtime path
- make it the default startup
- force clay mode and disable non-shape systems
- add **Test Environment** button to load current world

## Phase 2 — Raise brush MVP
- raycast + brush preview
- click-to-raise with size/strength
- local chunk rebuild
- Reset Canvas

## Phase 3 — Session quality improvements
- undo/redo
- hold-to-paint
- better brush preview
- optional in-session preservation when switching to Test Environment

## Phase 4 — Persistence if needed
- save/load editable blank-canvas heightfield
- autosave current canvas state

---

## Acceptance criteria

The workflow is successful when:

1. **Startup is immediate**
   - app opens to a flat clay plane without running erosion bake

2. **Raising terrain is direct**
   - clicking raises the terrain where clicked
   - repeated clicks accumulate height

3. **Feedback is local and fast**
   - only affected terrain updates
   - no full bake or disruptive reload

4. **Shape readability is high**
   - shadows + clay make the mound/terrain form easy to judge

5. **Test Environment remains accessible**
   - user can click a button and load the current milestone world

6. **The experiment is simpler than the current startup**
   - no textures
   - no erosion
   - no foliage
   - no visual clutter

---

## Key design decision

The most important architectural choice is:

> **Do not force click-based sculpting through the procedural erosion bake pipeline.**

Use a separate fast editable heightfield path for the blank-canvas experiment.

That keeps:
- startup simple
- sculpting immediate
- the experiment honest
- future shape tools possible

Meanwhile, **Test Environment** preserves the current full pipeline for comparison.

---

## Recommended first implementation order for Claude

1. **Blank Canvas becomes default startup**
2. **Current world moved behind `Test Environment` button**
3. **Editable heightfield backend**
4. **Raise brush MVP with local rebuild**
5. **Reset Canvas**
6. optional: **Undo**
7. optional: **preserve blank canvas session while switching to Test Environment**

---

## Bottom line

The right workflow is:

- start from **nothing but form**
- shape the land directly with clicks
- judge it in **clay mode**
- keep the current milestone world behind **Test Environment** for comparison

This is the simplest possible experiment that isolates terrain-shape authorship from every other visual system.
