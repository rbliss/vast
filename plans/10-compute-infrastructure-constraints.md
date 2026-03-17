# Compute Infrastructure Constraints (A0)

## Decision

**Introduce a backend-agnostic field-job system with a mandatory CPU reference path and one experimental WebGPU backend slice.**

## Why this is the right A0 choice

We need to acknowledge two facts at once:
1. many future features want WebGPU compute
2. the current repo has **no compute infrastructure** and still depends on Three.js’ render stack

A0 should therefore establish the seams, not attempt a full compute-driven terrain editor all at once.

## A0 compute goals
- define what a field job is
- define job inputs/outputs and tile addressing
- schedule jobs off the main UI path
- make CPU the correctness oracle
- prove one GPU-backed job in a feature-gated way

## Recommended architecture

### Core interfaces
- `FieldTileId`
- `FieldDescriptor` (height, slope, biome weight, etc.)
- `FieldJob<Input, Output>`
- `FieldJobBackend` (`cpu`, `webgpu`)
- `FieldJobScheduler`
- `TileBufferPool`
- `GpuCapabilityProbe`

### Execution model
- Main thread owns orchestration and visible state.
- Workers own CPU-heavy preprocessing/reference computation where possible.
- GPU jobs run only when capability checks pass.
- Each job must declare:
  - deterministic inputs
  - precision expectations
  - fallback availability
  - memory footprint estimate
  - timing hooks

## First GPU slice: what it should be

### Recommended job
**Height-tile derived-map generation**
- input: generated height tile
- output: slope/normal helper map + min/max statistics

### Why this job first
- no destructive editing yet
- useful to texturing/scattering later
- easy CPU reference
- bounded input/output sizes
- no need to rewrite renderer ownership of terrain data immediately

## Important constraints

### Do not tie A0 to an all-GPU future immediately
- CPU reference must exist first.
- GPU path is optional in A0.
- If device/resource sharing with Three.js becomes awkward, keep the GPU path behind an experimental flag rather than forcing a bad abstraction.

### Prefer mixed backend design
- CPU/WASM backend for correctness and broad compatibility
- WebGPU backend for acceleration on supported browsers
- identical job contract for both

### Precision policy
- CPU reference can use `Float32Array`.
- GPU path defaults to `f32`.
- optional `shader-f16` can be a later perf tier, not an A0 dependency.

### Profiling policy
- use timestamp queries where available
- otherwise fall back to CPU timing around dispatch/submit completion
- surface timing in debug mode

## Browser-native techniques to prefer
- **WebGPU compute/storage buffers** for bounded field jobs: https://www.w3.org/TR/webgpu/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- **Workers + transferables** for CPU preprocessing and reference jobs: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- **WebAssembly/SIMD/threads** for CPU fallback acceleration where worth it: https://developer.mozilla.org/en-US/docs/WebAssembly
- **GPUQuerySet/timestamp queries** for capability-aware profiling: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet ; https://developer.chrome.com/docs/web-platform/webgpu/developer-features

## Acceptance criteria
- `FieldJob` and `FieldJobBackend` abstractions exist.
- One CPU reference job exists and is testable in isolation.
- One optional GPU-backed version exists or is cleanly stubbed behind capability checks.
- CPU and GPU outputs can be compared against a tolerance.
- Timing data is inspectable in debug mode.

## Recommendation

For A0, the correct compute decision is:

> **prove one small, valuable, bounded field job end-to-end, with CPU correctness first and GPU acceleration second.**
