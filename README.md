# Procedural Terrain Playground

A browser-based terrain rendering playground built with **three.js** for experimenting with **realistic, performant, procedurally generated 3D terrain**.

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
  - fixed 25-slot pool
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

- **three.js**
- **Python server** for screenshot upload / verification API
- **Poly Haven** terrain textures
- **Vite migration in progress** to split the engine into reusable modules and keep the frontend framework-agnostic

## Running

Both services run as systemd units and start on boot:

```bash
# Services are already enabled. To restart manually:
sudo systemctl restart terrain-api terrain-vite
```

- **Vite frontend** on `:8080` — `http://beyond-all-reason:8080/`
- **Screenshot API** on `:8081` — proxied through Vite at `/api/*`

### Manual dev (without systemd)

```bash
PORT=8081 python3 server.py &   # screenshot API on 8081
npm run dev                      # Vite on 8080, proxies /api/* to 8081
```

### Standalone fallback (no Vite)

```bash
PORT=8080 python3 server.py    # serves standalone.html on :8080
```

Then open `http://localhost:8080/standalone.html`.

Useful query params:

- `?debug` — enable debug helpers / screenshot-oriented behavior
- `?dpr=auto`
- `?dpr=1`
- `?dpr=1.5`
- `?dpr=2`

## Project Direction

This is not intended to be a full game engine. It is a focused terrain rendering sandbox for exploring:

- terrain generation
- material blending
- streaming / LOD
- foliage placement
- browser performance tradeoffs
- modular engine architecture
