# UI Shell Constraints (A0)

## Decision

**Use Lit + Web Components for the editor shell, with plain TypeScript state stores and CSS-grid/split-pane layout.**

## Why this is the right A0 choice

### Browser-native fit
- Lit is a thin layer over platform-native Web Components.
- It works well with Vite and the current non-framework codebase.
- It avoids a full-app framework migration before we know the editor’s long-term shape.
- It keeps the rendering engine independent from the UI shell.

### Why not React/Svelte/Vue first
- They would solve panel rendering, but they would also force an early app-wide framework decision before the domain model is stable.
- The current repo is small and renderer-centric; A0 needs a shell, not a full SPA architecture.
- We want the minimum abstraction that supports:
  - layer list
  - inspector panels
  - toolbar/status UI
  - modal/project dialogs
  - future asset browser panes

### Why not stay with ad hoc DOM only
- The editor shell will quickly need reusable components, reactive updates, and encapsulated styling.
- Plain DOM string/imperative wiring will become harder to maintain than a small component system.

## Layout constraints

### Required A0 layout
- **Top bar** — project actions, mode indicator, save status, feature-tier info
- **Left pane** — layer stack / outliner placeholder
- **Center** — viewport host (existing terrain renderer canvas)
- **Right pane** — inspector/property panel placeholder
- **Bottom bar** — perf/memory/status/debug readouts

### What to avoid in A0
- no docking framework
- no tabbed MDI workspace
- no node editor
- no theme system beyond basic tokens
- no UI animation system beyond minimal affordances

## State model constraints

### Keep domain state separate from component state
- `WorldDocument` and project state live in plain TypeScript stores/services.
- Lit components subscribe/render that state.
- The renderer should not import UI components.
- UI events dispatch commands or actions to stores/services.

### Recommended state split
- **Project store** — current document, save state, project metadata
- **Editor UI store** — pane visibility, selection, active tool, transient panel state
- **Runtime capabilities store** — WebGPU/device/storage/tier info
- **Viewport bridge** — selected terrain source, debug flags, camera sync hooks

## Interaction constraints
- Shell UI must never steal camera controls while the pointer is in the viewport unless a tool explicitly does so.
- UI updates must not trigger full renderer re-creation.
- Debug/perf overlays must be cheap enough to leave enabled during development.

## Browser-native techniques to prefer
- **Lit + Custom Elements** over framework lock-in: https://lit.dev/docs/
- **CSS Grid + native resize/split strategies** before pulling in a docking system.
- **OffscreenCanvas for thumbnails/previews** if/when background preview rendering is needed: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- **File System Access + OPFS integration** at the shell level for project/open/save UX: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- **Capability-aware UI** so unsupported features are downgraded cleanly instead of hidden behind broken buttons.

## Acceptance criteria
- A Lit-based shell wraps the current viewport successfully.
- The viewport remains responsive and resizable.
- Basic project actions can be surfaced without committing to full tool logic.
- The layer list and inspector can render placeholder document data from `WorldDocumentV0`.

## Recommendation

For A0, the correct UI decision is:

> **Lit + Web Components for shell/panels, plain TypeScript stores for domain state, no heavy docking/framework commitment yet.**
