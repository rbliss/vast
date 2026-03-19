# CLAUDE.md

## Project
High-quality procedural terrain generation running purely in the browser with Three.js WebGPU.

## Architecture
- **Renderer:** WebGPU only (Three.js r183, TSL/NodeMaterial)
- **Terrain:** Composable macro field system + stream-power erosion + fan deposition
- **Materials:** Field-driven TSL materials (slope/altitude/curvature/deposition blending)
- **Scatter:** Field-aware foliage placement (altitude/slope/deposition-driven)
- **Atmosphere:** Per-material aerial perspective + procedural cloud dome
- **Water:** Terrain-depth-driven water bodies with shoreline foam
- **Post-processing:** RenderPipeline with bloom (presentation mode)
- **Chunk streaming:** 81-slot pool (9x9 grid) with angle-aware LOD coverage
- **Bake pipeline:** Workerized CPU bake with OPFS cache for instant warm reloads
- **Editor:** Lit shell + TypeScript stores + document-driven authoring

## Completed phases
- **A — Shape:** Macro landform primitives + stream-power erosion + fan/debris deposition
- **B — Materials:** Field texture drives 5-zone blending (snow/rock/grass/dirt/sediment) + anti-tiling
- **C — Scatter:** Altitude/deposition-aware rocks/grass/shrubs with procedural rock variants
- **D — Atmosphere:** Aerial perspective + sun controls + water bodies + cloud layer
- **E — Capture:** RenderPipeline + bloom + exposure + async presentation snapshots
- **F1 — Production:** Bake/runtime seam + worker bake + OPFS cache + startup UX + domain config
- **F2 — Authoring:** Lit shell + stores + document v1 + inspector + rebake workflow + persistence

## Key directories
- `src/engine/bake/` — bake pipeline, worker, cache, domain config
- `src/engine/terrain/` — terrain source, macro fields, erosion, stream-power, fan deposition, field textures
- `src/engine/materials/` — TSL terrain materials, feature model
- `src/engine/foliage/` — foliage system, rock geometry
- `src/engine/water/` — water body rendering
- `src/engine/sky/` — procedural cloud layer
- `src/engine/postprocess/` — presentation pipeline (bloom)
- `src/engine/backend/` — WebGPU renderer backend
- `src/stores/` — reactive stores (viewport, project, authoring, runtime)
- `src/ui/shell/` — Lit editor shell, toolbar, inspector
- `plans/` — architecture plans and research docs

## URL params
- Default `/` — benchmark terrain (analytical prepass + clay mode)
- `?blank` — blank canvas sculpt mode
- `?preset=chain|basin|plateau` — macro terrain preset
- `?testenv` — test environment (full bake pipeline)
- `?capture=label` — auto-capture all 4 benchmark views on load (saves to verification/)
- `?debug` — enable debug access (`window.__app`)
- `?clay` — clay/shape debug mode
- `?water=8` — water level in world units
- `?present` — presentation mode (bloom)
- `?exposure=1.2` — tone mapping exposure
- `?sunaz=210&sunel=35` — sun azimuth/elevation
- `?ibl=off` — disable image-based lighting
- `?dpr=auto|1|1.5|2` — device pixel ratio

## Verification & screenshots
- **Auto-capture**: Navigate to `/?capture=label` to automatically capture all 4 benchmark camera views (wide, oblique, escarpment, piedmont). Screenshots saved to `verification/` as JPEG. Page title shows completion time.
- **Manual capture**: Use `window.__benchmarkCapture('label')` from Chrome DevTools
- **CLI helper**: `./capture.sh label` — prints the URL and waits for files
- **Inspector**: "Snapshot" button in Actions section for single-view capture
- Screenshots are uploaded to the API server and stored in `verification/` with metadata JSON sidecars
- All visual changes MUST include verification screenshots before being considered complete

## Commands
- `npm run dev` — Vite dev server (port 8080, HTTPS)
- `npm run build` — production build
- `npm run typecheck` — TypeScript strict check
- `node api-server.cjs` — snapshot API server (port 8081)

## Services
- `vast-vite.service` — Vite dev server (systemd)
- `vast-api.service` — Express API server (systemd)

## Workflow
- Codex communicates plans and designs to @claude in Duet for implementation
- All work MUST be verified in the Chrome browser before it is considered complete
- Visual changes MUST include browser screenshots provided to claude as proof of verification
- To capture screenshots: navigate to `/?capture=label` and wait for title to show "Captured"
- URL: `https://beyond-all-reason:8080` (references: `/references.html`, docs: `/docs.html`)
- Upon completing work, notify @codex with a summary for confirmation
- Once approved by @codex, commit and push the changes

## Duet relay rules
- When sending a message intended for Codex in Duet, the message **must start at the beginning of a line** with `@codex`.
- Inline mentions of `@codex` do **not** trigger relay.
- Use line-start `@codex` even for short acknowledgements (for example: `@codex Hi back.`).
- If router auto-relay (`/watch`) is not enabled, the operator must relay manually with `@relay`.
- Correct: `@codex Hi back.`
- Incorrect: `Hi back, @codex.`
