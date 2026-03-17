# Runtime Migration Constraints (A0)

## Core migration decision

**Use branch-by-abstraction, not a big-bang rewrite.**

The current runtime terrain renderer already works. A0 should preserve that value while creating the seam that lets future editor-backed terrain sources replace the hardcoded procedural function incrementally.

## The key seam to introduce

The current renderer path conceptually looks like this:
- `TerrainApp` → `rebuildChunkSlot(...)` → `terrainHeight(x, z)`

A0 should move it toward this:
- `TerrainApp` → `TerrainSource` / `TerrainSampler` → current legacy procedural source *or* future field-backed source

## Required migration steps

### Step 1 — document-backed defaults
- Create `WorldDocumentV0`.
- Encode the current default world as a `legacyProceduralBase` layer/config block.
- Boot the app from that document.

### Step 2 — provider abstraction
- `TerrainApp` should depend on a sampler/provider interface.
- The legacy implementation should reproduce the current terrain exactly or within a tiny accepted tolerance.

### Step 3 — preserve renderer contracts
- Chunk geometry, materials, controls, screenshot flow, and current browser verification should remain intact.
- A0 is not the time to rewrite the renderer, only the terrain-source seam.

### Step 4 — add a field-backed path in parallel later
- Once the seam is in place, a future `FieldBackedTerrainSource` can coexist with `LegacyProceduralTerrainSource`.
- Feature flags or explicit document types can select the source path.

## Non-negotiable constraints
- No removal of the existing procedural terrain model in A0.
- No regression in default screenshot parity for the current world.
- No requirement that the entire terrain runtime become tile-field-driven before the seam lands.
- No renderer rewrite hidden inside migration work.

## Recommended compatibility policy

### URL / debug compatibility
- existing debug query params should keep working
- snapshot/state capture should keep working
- verification flows should continue to use the same browser path

### Visual parity policy
- compare the legacy path and new document-backed path through saved browser snapshots
- tolerate tiny numeric differences only if visually negligible

### Schema policy
- version every saved document
- reserve migration hooks from v0 onward
- keep the v0 shape minimal and explicit

## Browser-native techniques to prefer
- **Feature-flagged migration paths** rather than hidden rewrites.
- **Snapshot-based visual regression** as the practical browser-native guardrail: https://playwright.dev/docs/test-snapshots
- **Local-first save/load/autosave** so migration testing can happen against real project documents, not transient in-memory state only: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- **Capability-aware fallback logic** so document-driven startup still works on lower-tier browser devices.

## Recommendation

For A0, the migration rule should be:

> **make the existing runtime one valid terrain source inside the new document model before introducing any editor-native terrain source.**
