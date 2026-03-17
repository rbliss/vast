# Procedural Terrain Playground

A browser-based terrain rendering playground built with **three.js WebGPU** for experimenting with **realistic, performant, procedurally generated 3D terrain**.

## Goals

- Build a terrain system that looks good both up close and at distance
- Keep performance high in the browser with scalable LOD and shading
- Separate **engine logic** from **UI/app wiring** so the terrain core can be reused with any frontend framework
- Support rapid visual iteration with screenshot capture and browser verification

## Current Features

- **Procedural macro terrain** using layered FBM + ridged noise
- **PBR terrain shading** using tiled Poly Haven materials
- **Slope-aware tri-planar mapping** for rock on steep surfaces
- **Biome blending** for grass / dirt / rock
- **Chunked terrain LOD** with:
  - fixed 81-slot pool (9×9 grid)
  - zero-allocation traversal
  - edge stitching
  - skirts
  - displacement fade at chunk borders
- **Infinite streaming terrain**
- **Deterministic foliage instancing** (grass, shrubs, rocks)
- **WASD / arrow movement** plus mouse orbit controls
- **Screenshot upload flow** for visual verification
- **Manual + adaptive DPR controls** for performance testing

## Design

The project is organized around a few core systems:

- **Terrain heightfield**
  Generates the large-scale landform from procedural noise.

- **Material / shader pipeline**
  Applies biome blending, normal mapping, roughness, AO, and tri-planar rock projection.

- **Chunk streaming + LOD**
  Maintains a fixed pool of terrain slots around the camera and rebuilds them in place as the center cell changes.

- **Foliage instancing**
  Places deterministic detail meshes from world-space rules tied to terrain and biome conditions.

- **UI / tooling**
  HUD, DPR controls, movement bindings, and screenshot upload are kept separate from the engine logic.

## Tech Stack

- **three.js** (WebGPU renderer, TSL/NodeMaterial)
- **Express** API server for screenshot upload / verification
- **Poly Haven** terrain textures
- **Vite** for modular ES module builds and dev server

## Running

### Production / this host

The app runs as two systemd services:

- **vast-vite** — frontend on `https://beyond-all-reason:8080/`
- **vast-api** — screenshot API on `:8081`, proxied through Vite at `/api/*`

Useful commands:

```bash
sudo systemctl status vast-vite vast-api
sudo systemctl restart vast-vite vast-api
```

### Local dev

```bash
PORT=8081 node api-server.cjs &
npm run dev
```

Then open:

- `https://localhost:8080/` — Vite app
- `https://localhost:8080/api/screenshots` — proxied screenshot API

### Legacy standalone fallback

The old non-Vite page is preserved as `standalone.html` and can be served
directly by any static file server.

### Query params

- `?debug` — enable debug helpers / screenshot-oriented behavior
- `?dpr=auto`
- `?dpr=1`
- `?dpr=1.5`
- `?dpr=2`
- `?ibl=off` — disable image-based lighting

## Project Direction

This is not intended to be a full game engine. It is a focused terrain rendering sandbox for exploring:

- terrain generation
- material blending
- streaming / LOD
- foliage placement
- browser performance tradeoffs
- modular engine architecture
