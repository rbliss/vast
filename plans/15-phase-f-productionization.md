# Phase F Productionization Plan

_Research compiled 2026-03-17 after milestone freeze `7f38272`_

## Why this phase exists

The project now has a strong frozen visual stack:
- **A** shape / erosion / deposition
- **B** field-driven materials
- **C** field-aware scatter
- **D** atmosphere / lighting / water / clouds
- **E** presentation capture

The biggest remaining user-facing problems are no longer missing visuals. They are:
1. **blocking startup** from the synchronous bounded erosion bake (~5s)
2. **bounded-preview assumptions** scattered through the runtime
3. a few targeted correctness/polish issues
4. no durable production path for cached terrain bakes and local-first recovery

Phase F should therefore make the current stack **usable, resilient, and inspectable** before any new large visual phase.

---

## F1 goals

### Primary goals
1. **Move heavy terrain baking off the main thread**
2. **Cache bake artifacts locally** for fast warm reloads
3. **Make startup state visible** with progress/cancel/error reporting
4. **Centralize terrain/bake extents and shared config**
5. **Close known correctness bugs** that undermine confidence in the stack

### Secondary goals
- preserve visual parity with milestone `7f38272`
- make cold-start vs warm-start behavior measurable
- create clean seams for future WebGPU compute acceleration without requiring it now

### Explicitly out of scope
- replacing the CPU erosion stack with a WebGPU compute implementation
- solving infinite terrain erosion in F1
- building full authored river/lake/vector workflows
- major visual upgrades beyond targeted bugfixes
- full editor UI/parameter authoring (that is F2)

---

## Current-state assessment

### What is working now
- The erosion/material/scatter/atmosphere stack is coherent and validated.
- `ErodedTerrainSource` already documents itself honestly as a **bounded preview bake**.
- Presentation mode, screenshots, and terrain-field-driven shading are in place.

### What is not production-ready yet
1. **`ErodedTerrainSource` computes synchronously in its constructor**
   - this blocks startup on the main thread
   - it couples bake lifetime to object construction

2. **Bake artifacts are ephemeral**
   - every reload recomputes the erosion grid and derived field data
   - we are paying the most expensive cost on every session start

3. **Extents are duplicated implicitly**
   - erosion extent
   - field texture extent
   - water/height sampling extent
   - any future cache/window extent
   should come from one shared source of truth

4. **Known carry-forward issues remain open**
   - plateau escarpment skirt gaps
   - bounded-preview seam assumptions not surfaced clearly in app state
   - remaining rendering/config constants are not centralized enough

---

## Research findings: best browser-native techniques for F1

### 1. Dedicated module workers are the right first execution model
Heavy terrain bake work should move to a **dedicated module worker** instead of the UI thread.

Why:
- native browser threading model for CPU-heavy work
- compatible with Vite/ESM build flow
- keeps render/input responsive during bake
- allows clean progress/error/cancel protocol

Relevant references:
- MDN Web Workers API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- MDN `Worker()` constructor / module workers: https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
- web.dev module workers: https://web.dev/articles/module-workers

### 2. Transfer big typed-array buffers, do not clone them
Bake artifacts are large float grids. They should cross the worker boundary via **transferable `ArrayBuffer`s**, not structured-clone copies.

Why:
- avoids extra copies of height / area / deposition / field buffers
- reduces peak memory pressure during handoff
- makes warm-start cache upload cheaper

Relevant reference:
- MDN Transferable objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

### 3. OPFS is the right cache target; worker-side sync access is especially attractive
For productionized local-first storage, the best fit is the **Origin Private File System (OPFS)**.

Why:
- browser-managed, origin-scoped storage for binary artifacts
- better fit than `localStorage` or ad hoc JSON blobs for bake buffers
- works naturally with file-like cache artifacts and manifests
- **`FileSystemSyncAccessHandle` is available in workers**, which is a strong fit for writing cache files at the end of a bake job

Relevant references:
- MDN OPFS: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN `FileSystemSyncAccessHandle`: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle

### 4. Ask for persistent storage and measure quotas up front
The app should use `navigator.storage.persist()` and `navigator.storage.estimate()` as part of its cache policy.

Why:
- cache size is now meaningful
- the app needs to know whether it can retain bake artifacts reliably
- storage budget should inform cache eviction and diagnostics

Relevant references:
- MDN `StorageManager.persist()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN `StorageManager.estimate()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate

### 5. Multi-tab coordination should stay browser-native
If we add local autosave + cache management, multi-tab coordination matters. Prefer **BroadcastChannel** over custom polling.

Why:
- cheap cross-tab notifications for cache invalidation or project-save status
- no server dependency
- appropriate for local-first editor behavior

Relevant reference:
- MDN Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API

### 6. WebGPU compute is still a future acceleration path, not the F1 dependency
We already know future erosion/detail work may want compute. But the right productionization step now is:
- **workerized CPU first**
- **cache second**
- **optional GPU acceleration later**

This keeps correctness stable while still leaving the door open for future compute-backed stages.

---

## Recommended F1 architecture

## F1.1 — Split “bake” from `ErodedTerrainSource`

### Problem
Right now `ErodedTerrainSource` both:
- defines the runtime sampling interface
- performs the expensive synchronous bake immediately

### Decision
Refactor into:
- **`TerrainBakeRequest`** — pure inputs describing the bake
- **`TerrainBakeArtifacts`** — immutable outputs (height grid, deposition map, derived maps, metadata)
- **`TerrainBakeService`** — orchestrates worker jobs, cache, progress, cancellation
- **`BakedTerrainSource`** — lightweight runtime sampler over already-prepared artifacts
- **`Legacy/Eroded source adapters`** only as compatibility shims during migration

### Result
This separates:
- expensive preprocessing lifetime
- runtime terrain sampling lifetime
- cache lifetime

That is the core productionization seam.

---

## F1.2 — Workerized bake pipeline

### Recommended worker
Create a dedicated module worker, e.g.:
- `src/engine/bake/terrainBake.worker.ts`

### Main-thread orchestration
Add a manager/service, e.g.:
- `src/engine/bake/terrainBakeManager.ts`

Responsibilities:
- build `TerrainBakeRequest` from document + preset + config
- look up cache before computing
- launch/cancel worker jobs
- receive progress events
- convert worker result into runtime resources
- publish bake state to UI/debug systems

### Worker responsibilities
- sample macro terrain into grid
- run stream-power / fan / thermal / optional detail stages
- compute field maps needed by materials/scatter/water
- package results as transferables
- write successful artifacts to cache

### Suggested progress phases
Keep progress coarse and stable, not per-iteration noisy:
1. `sampling-base-terrain`
2. `stream-power`
3. `fan-and-debris`
4. `thermal`
5. `field-textures`
6. `cache-write`
7. `ready`

Progress should include:
- stage name
- stage index / total
- optional fractional progress within the stage
- elapsed ms so far

---

## F1.3 — Versioned bake cache

### Storage decision
Use **OPFS** as the primary cache.

Recommended structure:
- `/bakes/manifest.json`
- `/bakes/<cache-key>/height.f32`
- `/bakes/<cache-key>/deposition.f32`
- `/bakes/<cache-key>/fields.rgba16f-or-f32`
- `/bakes/<cache-key>/meta.json`

If OPFS is unavailable, fall back to:
- IndexedDB for blobs + manifest
- or no cache, but still workerized

### Cache key requirements
A cache key must include at minimum:
- document schema version
- terrain preset / terrain config
- erosion config
- bake extent + grid size
- field texture resolution
- algorithm version tag
- app build version / manual cache version string

Do **not** rely only on preset name.

### Cache policy
- warm hit → load artifacts directly
- cold miss → worker computes and stores
- config/version mismatch → invalidate and rebuild
- expose cache-hit / cache-miss in debug/status UI

### Eviction policy
Simple v1 policy is enough:
- keep most recent N bake entries
- evict oldest when over quota heuristic
- show “cache cleared” / “cache evicted” events in debug mode

---

## F1.4 — Startup UX / busy-state design

### What the user should experience
The app should no longer appear frozen during heavy bake startup.

Recommended states:
1. **booting** — renderer shell and viewport chrome appear
2. **checking cache**
3. **baking terrain** with visible stage + progress
4. **uploading assets** / applying bake
5. **ready**
6. **error with retry / safe fallback**

### UX rules
- viewport shell should mount immediately
- camera controls can remain disabled until terrain is ready
- existing document name / preset / tier info should still be visible during bake
- if a cached bake is used, report that clearly (“Loaded cached terrain bake”)

### Error handling
If bake fails:
- show error state in shell/status bar
- allow retry
- allow fallback to base macro terrain without erosion if necessary
- never leave the user with a blank hung screen and no explanation

---

## F1.5 — Centralized terrain-space config

### Problem
Multiple systems currently infer or duplicate terrain extents:
- erosion extent
- field texture extent
- water/height extent
- debug overlays / future masks

### Decision
Introduce a shared terrain-space config object, e.g.:
- `TerrainDomainConfig`

Fields should include:
- world extent / bake extent
- bake grid size
- field texture resolution
- water sampling extent
- preview blend region
- any downsample ratios used for runtime field textures

### Rule
Every system that currently reaches into private erosion-source internals (or hardcodes extent assumptions) should instead read from the shared domain config / bake metadata.

This is both a correctness and maintainability fix.

---

## F1.6 — Targeted bugfix / robustness pass

### Must-fix items in F1
1. **Plateau escarpment skirt gaps**
   - treat this as a correctness bug, not a later polish note
   - likely solution space: slope-aware skirt depth or more robust escarpment-edge handling

2. **Bounded-preview state visibility**
   - status/debug UI should state when terrain is using a bounded preview bake
   - extent should be inspectable, not implicit

3. **Config plumbing cleanup**
   - stop reaching into private erosion-source fields from unrelated systems
   - expose formal bake metadata instead

### Nice-to-have if cheap
- cache clear button in debug UI
- stale-cache detection messaging
- warm/cool startup timing comparison in debug mode

---

## Suggested implementation order

### F1.1 — bake contracts + runtime seam
- define `TerrainBakeRequest`, `TerrainBakeArtifacts`, `TerrainBakeMetadata`
- add `BakedTerrainSource`
- move synchronous bake logic into a callable pure-ish pipeline module

### F1.2 — worker execution
- create dedicated module worker
- move CPU bake into worker
- main-thread manager + progress events
- integrate startup busy state

### F1.3 — OPFS cache
- manifest + artifact files
- cache-key versioning
- warm-start load path

### F1.4 — shared config + metadata cleanup
- centralized domain config
- replace private-field reach-through with metadata

### F1.5 — targeted bugfixes
- plateau skirt gap
- bounded-preview diagnostics
- failure/retry polish

---

## Acceptance criteria

F1 is successful when all of the following are true:

1. **Cold start no longer blocks the UI thread**
   - shell remains responsive
   - user sees staged progress

2. **Warm reload is materially faster**
   - cached bakes avoid recomputing the full erosion stack
   - cache hit/miss is inspectable

3. **Visual parity is preserved**
   - milestone terrain/material/scatter/atmosphere output remains materially unchanged

4. **Bake metadata is formalized**
   - extent, resolution, timings, cache key/version are inspectable

5. **Known correctness issues are reduced**
   - plateau skirt gap fixed or explicitly split out with justification
   - systems no longer depend on ad hoc private-field access

6. **Failure path is credible**
   - bake/caching errors surface clearly
   - app can retry or fall back safely

---

## Risks and mitigations

### Risk: cache corruption or stale artifacts
Mitigation:
- versioned manifest
- explicit algorithm version string
- metadata validation before reuse

### Risk: worker/main-thread data copies become expensive
Mitigation:
- use transferables for large buffers
- avoid repeated postMessage churn during progress

### Risk: cache storage gets evicted or denied
Mitigation:
- request persistence
- surface storage estimate / persistence status
- degrade gracefully to worker-only no-cache mode

### Risk: F1 turns into a hidden compute rewrite
Mitigation:
- keep the bake math identical first
- workerize + cache before any algorithm changes

---

## What comes after F1

Once F1 lands, the project should be ready for:
- **F2 authoring UI / parameter editing**
- later worker/WASM optimization
- later optional WebGPU compute acceleration for expensive terrain stages

But F1 should intentionally stop short of a new rendering/erosion algorithm phase.

---

## Recommendation

The correct Phase F1 implementation strategy is:

> **workerized CPU bake first, OPFS cache second, progress/error UX third, then targeted bugfix/metadata cleanup.**

That path gives the project the biggest real-world quality-of-life gain without destabilizing the validated visual stack.

---

## Sources / references
- MDN Web Workers API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- MDN `Worker()` constructor: https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
- web.dev module workers: https://web.dev/articles/module-workers
- MDN Transferable objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- MDN OPFS: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN `FileSystemSyncAccessHandle`: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
- MDN `StorageManager.persist()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN `StorageManager.estimate()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
- MDN Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
