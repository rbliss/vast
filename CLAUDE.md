# CLAUDE.md

## Project
Procedural terrain playground — infinite streaming terrain rendered in the browser with Three.js WebGPU.

## Architecture
- **Renderer:** WebGPU only (Three.js r183, TSL/NodeMaterial)
- **Materials:** `MeshStandardNodeMaterial` with TSL shaders (`three/tsl`)
- **Terrain:** Infinite streaming via fixed chunk pool (81 slots, 9x9 grid) with angle-aware LOD coverage
- **Heightfield:** 4-layer model (base + mountain range + secondary peaks + relief) — silhouette-safe
- **Biome blending:** Rock (tri-planar), grass (planar XZ), dirt (planar XZ) with per-biome normals
- **Environment:** Precomputed static sky cube map (no runtime WebGL)

## Key directories
- `src/engine/` — core engine (TerrainApp facade, backend, materials, terrain, foliage, controls)
- `src/ui/` — HUD, snapshot UI, DPR buttons
- `src/utils/` — runtime error buffer
- `textures/` — Polyhaven PBR textures + sky cube map (served as publicDir)
- `verification/` — snapshot images + JSON sidecars
- `scripts/` — asset generation tools

## Commands
- `npm run dev` — Vite dev server (port 8080, HTTPS)
- `npm run build` — production build
- `npm run typecheck` — TypeScript strict check
- `node api-server.cjs` — snapshot API server (port 8081)

## Services
- `vast-vite.service` — Vite dev server (systemd)
- `vast-api.service` — Express API server (systemd)

## Browser verification
- URL: `https://beyond-all-reason:8080`
- Always verify rendering changes visually in Chrome
- Use `window.__snapshot()` for programmatic snapshot capture

## Workflow
- Codex communicates plans and designs to @claude in Duet for implementation
- Upon completing work, notify @codex with a summary for confirmation
- Once approved by @codex, commit and push the changes
