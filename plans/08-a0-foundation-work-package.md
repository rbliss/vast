# A0 Foundation Work Package

## Why this exists

Claude’s review on the World Creator plan set was correct: **Stage A is too large to attack as one milestone**. This A0 package is the deliberately smaller proving ground that establishes the editor foundations without boiling the ocean.

A0 is the first implementation package that should prove five things:
1. the terrain can be represented as a **versioned world document**
2. the current runtime can survive behind a **branch-by-abstraction migration**
3. we can stand up a **browser-native editor shell** without committing to a bloated framework
4. we can introduce the **first compute/job infrastructure slice** safely
5. we can hold the whole system inside explicit **memory budgets**

## Deliverables

This package depends on and is constrained by the companion docs:
- `09-ui-shell-constraints.md`
- `10-compute-infrastructure-constraints.md`
- `11-memory-budget-constraints.md`
- `12-runtime-migration-constraints.md`

## A0 scope

### In scope
1. **Minimal world document v0**
   - project metadata
   - schema version
   - scene settings needed by the current runtime (camera defaults, sun/IBL toggles, DPR defaults)
   - a single `legacyProceduralBase` terrain layer that reproduces the current terrain model
   - a placeholder layer stack structure so later terrain/material/object/scene layers have an obvious home

2. **Terrain source abstraction**
   - `TerrainApp` stops depending directly on the hardcoded `terrainHeight(x, z)` function
   - renderer/chunk rebuild path reads through a sampler/provider abstraction
   - the first provider is a `LegacyProceduralTerrainSource`

3. **Field tile cache v0**
   - tile address type
   - dirty/clean state
   - CPU-resident height tile generation from the legacy source
   - one derived-map pipeline (minimum: slope/normal helper map, or slope + min/max metadata)
   - explicit tile invalidation/rebuild API

4. **Compute/job slice v0**
   - a backend-agnostic job interface for field work
   - CPU reference path (required)
   - one experimental WebGPU-backed job behind a feature flag
   - timestamp-query/profiling hooks where available

5. **Editor shell v0**
   - app shell layout
   - viewport region that hosts the existing renderer
   - left layer list / outliner placeholder
   - right inspector placeholder
   - top tool strip / project controls placeholder
   - bottom status/perf bar
   - no full editing toolset yet

6. **Local-first persistence v0**
   - save/load world document JSON
   - OPFS autosave
   - File System Access “save as/open” if available
   - safe fallback download/upload flow

7. **Memory budget instrumentation v0**
   - active tile counts
   - tile cache memory estimate
   - GPU capability probe
   - budget tier assignment
   - clear warning when the app exceeds budget heuristics

### Explicitly out of scope
- full sculpt/brush tool suite
- polygon/vector authoring UI
- erosion/snow/sand/debris implementations
- material editor
- general scatter graph
- camera sequencer
- water/cloud renderer
- engine bridges/export packages beyond basic document persistence and existing snapshot/export tooling

## A0 success criteria

A0 is successful when all of the following are true:

1. **Parity survives**
   - the default world still renders through the current terrain runtime with no visible regression in the main browser verification path

2. **Document-driven startup works**
   - the app boots from a `WorldDocument` instead of ad hoc startup constants
   - a save/load round trip preserves the rendered scene for the legacy procedural world

3. **Migration seam is real**
   - `TerrainApp` depends on a terrain source/sampler abstraction, not the hardcoded terrain function directly
   - there is a clear location where future layer-backed/tile-backed terrain sources can plug in

4. **Compute/job infrastructure is proven**
   - one field job runs through CPU reference and one experimental GPU path
   - results match within a defined tolerance
   - failures fall back cleanly to CPU

5. **UI shell exists without destabilizing render performance**
   - shell panels render around the existing viewport
   - shell interactions do not break camera controls, snapshots, or resize handling

6. **Budgets are visible**
   - tile/cache/budget metrics are inspectable in debug mode
   - the app can classify itself into memory/perf tiers at runtime

## Recommended sequencing inside A0

### A0.1 — document + migration seam
- define `WorldDocumentV0`
- define `TerrainSource` / `TerrainSampler` abstraction
- implement `LegacyProceduralTerrainSource`
- boot the current runtime from document-backed defaults

### A0.2 — shell skeleton
- add the UI shell and panels
- keep the current renderer embedded in the viewport pane
- wire minimal project actions (new/open/save/autosave)

### A0.3 — field cache + CPU reference jobs
- add a tile cache structure and dirty-tile bookkeeping
- generate CPU-resident height tiles from the legacy source
- compute one derived helper map on CPU for validation

### A0.4 — first GPU/compute vertical slice
- add a WebGPU-backed version of the chosen field job behind a feature flag
- compare output/timing to CPU reference
- surface timing/budget info in debug mode

### A0.5 — persistence and diagnostics
- save/load document JSON
- OPFS autosave
- storage estimate + memory budget display

## Recommended first GPU-backed field job

The best A0 job is **derived-map generation from a height tile**, not full terrain editing.

Recommended candidate:
- input: one 256×256 or 512×512 height tile from the legacy procedural source
- output: slope/normal helper data + tile min/max metadata

Why this job first:
- no UI authoring complexity yet
- deterministic CPU reference is easy to build
- useful for later texturing/scattering/erosion
- proves resource binding, buffer lifetimes, and job scheduling without changing the live terrain model too early

## Acceptance checklist for Claude

- [ ] `WorldDocumentV0` exists and can round-trip through save/load
- [ ] current runtime terrain boots from a `legacyProceduralBase` layer
- [ ] terrain sampling path is abstracted behind a provider/sampler seam
- [ ] shell layout exists and hosts the current viewport cleanly
- [ ] OPFS autosave works (with fallback if unsupported)
- [ ] one CPU field job exists
- [ ] one GPU-backed experimental version of that job exists or is cleanly stubbed behind capability checks
- [ ] memory tier/budget info is surfaced in debug mode
- [ ] default visual verification still passes

## Browser-native rationale

A0 should deliberately prove that the future editor will be:
- **local-first** (OPFS/File System Access)
- **workerized** (heavy work leaves the main thread)
- **compute-ready** (WebGPU jobs have an explicit home)
- **capability-tiered** (the app knows when to fall back)
- **non-destructive and document-driven** (branch-by-abstraction instead of rewrite-and-pray)

## Sources / references
- WebGPU spec + MDN: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Lit docs: https://lit.dev/docs/
- File System API / OPFS: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- Storage estimate/device memory: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate ; https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- Transferables / OffscreenCanvas / WebAssembly: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects ; https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas ; https://developer.mozilla.org/en-US/docs/WebAssembly
