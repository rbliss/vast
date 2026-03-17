# Application Features Recreation Plan

## Intent

Recreate the product-level strengths of World Creator—speed, approachability, documentation, localization, and stability—without losing the forward-looking WebGPU architecture already present in this repo.

## Feature-by-feature plan

| Feature | Best recreation idea for this repo | Suggested phase |
| --- | --- | --- |
| Everything is Real-Time | Use incremental recompute, preview-quality toggles, background jobs, and explicit dirty states to preserve responsiveness. | Foundation |
| Multilanguage Support | Adopt i18next-based string catalogs with lazy-loaded locale bundles and externalized UI copy. | Phase 1 |
| Fully Documented | Write docs alongside features, with plan docs, in-app tooltips, sample worlds, and public reference pages. | Phase 1 |
| Layer Based - No Nodes | Lean into a visible ordered layer stack with groups, masks, presets, and history rather than introducing a node editor. | Foundation |
| Easy to Learn | Provide opinionated presets, walkthrough projects, inline help, and sensible defaults instead of exposing every low-level knob up front. | Phase 1 |
| Stable and Reliable | Prioritize autosave, crash capture, deterministic tests, visual regression, schema migration, and conservative feature gating. | Foundation |

## Best-fit architecture for this category

### 1. Product shell around the renderer
The current repo is mainly a runtime/rendering sandbox. To support the application-level feature set, add a product shell that owns:
- project lifecycle (new/open/save/autosave/export)
- document schema/versioning
- history/undo/redo
- localization
- help/tooltips/docs links
- error handling + telemetry
- visual regression / browser verification harness

### 2. Layer-first UX, not node-first UX
World Creator’s promise here is specifically that the app stays layer based and easy to learn.
- Keep a visible left-to-right mental model:
  - terrain layers
  - materials
  - objects
  - scene
  - export
- Use grouped presets and inline previews to reduce complexity.

### 3. Reliability stack
- autosave / crash recovery
- deterministic document upgrades
- runtime error capture
- visual regression snapshots
- bounded memory caches
- aggressive feature gating for experimental systems

## Suggested execution path

### Phase A — make the app feel like an editor
- project document format
- autosave and restore
- undo/redo around layer operations
- clear pane structure
- keyboard shortcuts and onboarding hints

### Phase B — documentation and localization
- i18next integration
- string extraction discipline
- inline tooltips that deep-link to docs
- sample projects / walkthrough docs

### Phase C — stability and QA
- visual regression with Playwright screenshots
- crash/error reporting opt-in
- deterministic replay/snapshot tests for terrain documents
- browser capability diagnostics and compatibility messaging

## Risks / gotchas
- “Easy to learn” will be lost instantly if advanced simulations and export settings are dumped into the UI without presets or guided defaults.
- Localization should start before UI copy sprawls.
- Autosave and schema migration are much cheaper before multiple editor subsystems exist.

## Research notes that informed this plan
- World Creator’s page explicitly frames these as application-level selling points, not isolated features: https://www.world-creator.com/en/features.phtml
- i18next is the best-fit web localization baseline for a TypeScript/browser application: https://www.i18next.com/overview/getting-started
- Playwright’s screenshot comparison support is directly relevant for visual regression in this repo: https://playwright.dev/docs/test-snapshots
- Sentry’s browser support guidance is useful for deciding whether crash telemetry is practical on the same browsers the app targets: https://docs.sentry.io/platforms/javascript/guides/react/troubleshooting/supported-browsers

## Latest browser-native techniques to prefer

- **PWA/local-first shell:** this project is a strong candidate for installable PWA behavior, offline docs/help, and durable local state, especially once editing arrives. References: https://developer.mozilla.org/docs/Web/Progressive_web_apps ; https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- **OPFS + IndexedDB split:** keep large blobs/projects/cache data in OPFS and use IndexedDB for structured metadata, search indexes, and recent-project state. References: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system ; https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **Workerized UX:** thumbnails, imports, previews, autosaves, and validation should happen in workers with transferables; OffscreenCanvas is valuable for background previews. References: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects ; https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- **WASM where it actually helps:** schema migration helpers, image processing, compression, and CPU-only terrain filters can benefit from WASM + SIMD/threads without turning the entire app into a WASM-first codebase. Reference: https://developer.mozilla.org/en-US/docs/WebAssembly
- **Capability-tiered product UX:** detect WebGPU, worker features, OPFS availability, WebCodecs availability, etc., and expose feature tiers instead of assuming every browser can do everything. References: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API ; https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ; https://developer.mozilla.org/en-US/docs/Web/API/File_System_API

## Technique rationale

The browser-native way to make this feel like a real application is to embrace **local-first storage, installable shell behavior, workerized UI, and capability tiers** rather than chasing parity with desktop UX through blocking main-thread workflows.

## Recommendation

The best product move is:

> **treat the editor shell, documentation, localization, and reliability work as first-class milestones—not cleanup after the rendering work.**

That is how the tool becomes usable rather than merely impressive.
