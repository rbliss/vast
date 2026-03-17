# Memory Budget Constraints (A0)

## Why this matters now

Almost every World Creator-style feature in the browser eventually becomes a memory problem before it becomes an algorithm problem. The plans already lean on tiled caches; A0 needs explicit numbers so the implementation does not drift into “works on one machine” territory.

## A0 budget policy

### Inputs for tiering
Use a combination of:
- `navigator.deviceMemory`
- `navigator.storage.estimate()`
- `GPUAdapter.limits`
- explicit internal caps

Relevant references:
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
- https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter

## Recommended tier model

### Tier L (conservative / low-memory browser device)
- heuristic: `deviceMemory <= 4` or weak GPU limits
- CPU terrain-field cache target: **96 MiB**
- GPU terrain/material cache target: **96 MiB**
- instance/scatter cache target: **24 MiB**
- transient compute/export working set: **48 MiB**

### Tier M (default target for A0)
- heuristic: `deviceMemory ~ 8`
- CPU terrain-field cache target: **192 MiB**
- GPU terrain/material cache target: **160 MiB**
- instance/scatter cache target: **48 MiB**
- transient compute/export working set: **96 MiB**

### Tier H (high-end desktop browser)
- heuristic: `deviceMemory >= 16` and stronger GPU limits
- CPU terrain-field cache target: **384 MiB**
- GPU terrain/material cache target: **320 MiB**
- instance/scatter cache target: **96 MiB**
- transient compute/export working set: **160 MiB**

## Concrete A0 tile recommendation

### Authoring tile size
- default: **256×256** terrain field tiles
- optional high tier: **512×512** for selected derived maps / capture-oriented workflows
- do **not** make 512² the baseline A0 authoring tile everywhere

### Why 256² first
A single 256² float32 scalar field is about **0.25 MiB**.
That makes budgeting tractable:
- 6 scalar/vector-equivalent field channels per tile ≈ **1.5 MiB / tile**
- 24 resident tiles ≈ **36 MiB** per cache copy
- mirrored CPU + GPU copies stay manageable within A0 budgets

By contrast, 512² tiles multiply that pressure by 4× too early.

## Hard A0 working-set targets
- resident editable tile target: **24 tiles**
- soft ceiling: **32 tiles**
- hard ceiling before eviction pressure spikes: **48 tiles**
- only derived maps needed for the current viewport/document state should be resident

## Precision constraints
- CPU reference fields: float32
- GPU fields: float32 by default
- optional reduced precision only after output tolerance is validated
- never let “precision optimization” break deterministic save/load or export semantics in A0

## Monitoring requirements
A0 should expose, in debug mode:
- active tile count
- bytes per cache bucket
- estimated total CPU field memory
- estimated total GPU field/texture memory
- current tier
- eviction count / last eviction reason

## Browser-native techniques to prefer
- **Capability-derived tiering** instead of one-size-fits-all assumptions.
- **OPFS staging** for large project artifacts so RAM is not used as the only workspace: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- **Transferable buffers / workerized export jobs** so expensive bakes don’t duplicate memory unnecessarily: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- **Compressed assets (KTX2 / GLB)** wherever possible to reduce GPU residency pressure: https://threejs.org/docs/pages/KTX2Loader.html ; https://www.khronos.org/ktx

## Recommendation

For A0, memory discipline should be:

> **256² default authoring tiles, explicit device tiers, visible cache accounting, and aggressive eviction before feature growth.**
