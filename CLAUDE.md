# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Autodesk Forma embedded panel** — a Preact + Vite + TypeScript app that runs inside the Forma urban design tool as a side panel. It reads building geometry from the active Forma scene, computes metrics, and applies per-building color overlays.


## Commands

All commands run from the repository root:

```bash
npm run dev       # Dev server at http://localhost:5173/
npm run typecheck # tsc --noEmit
npm run build     # Type-check, then production build → dist/
npm run preview   # Preview production build at http://localhost:4173/
```

There is no test runner or linter configured. `npm run build` fails on TypeScript errors.

## Architecture

Everything lives in a single file: `src/index.tsx`. There is no routing, no state management library, and no component folder — the entire application is one ~770-line file rendered with Preact.

**Forma SDK integration** (`forma-embedded-view-sdk/auto`):
- `Forma.geometry.getPathsByCategory({ category: "building" })` — enumerate building paths in the scene
- `Forma.geometry.getTriangles({ path })` — raw vertex positions as a flat `Float32Array` (every 9 floats = one triangle, XYZ per vertex)
- `Forma.geometry.getFootprint({ path })` — 2D polygon coordinates for footprint area
- `Forma.selection.getSelection()` — scene selection (read-only; the SDK has no `setSelection`)
- `Forma.camera.move({ position, target })` — row click frames the building
- `Forma.render.elementColors.set({ pathsToColor })` / `.clearAll()` — one hex colour per building (all modes except Façade (Mixed))
- `Forma.render.updateMesh({ id, geometryData: { position, color } })` — per-face overlay mesh, used only for Façade (Mixed) (RGBA `Uint8Array`, 4 bytes × 3 vertices per triangle)
- `Forma.render.cleanup()` — remove custom color overlays

**Key derived metrics** (computed client-side, no backend):
- Height = maxZ − minZ from triangle vertices
- Footprint area = Shoelace formula on `getFootprint` coordinates
- Volume = height × footprint area
- Floor count = `round(height / 3.5)`
- GFA, site area, coverage and FAR are deliberately not calculated: Forma's Area Metrics panel already provides them
- Facade orientation = surface normal of each triangle projected onto the XY plane

**State flow**: A single `useEffect` dependent on `buildingUseTags` fetches all building data from Forma on mount and whenever use-type tags change. Colour application is a separate async action ("Apply Colours to All Buildings") that colours every building — no Forma selection needed. Only use tagging reads the Forma selection.

**UI structure**:
- `SummaryStrip` — always-visible aggregate stats (building count, avg height, max height, total façade area)
- `TabBar` — switches between Metrics / Analysis / Export tabs (Analysis and Export are placeholders)
- Metrics tab: `BuildingList` with `SortControls`, then visualization mode selector buttons, context-sensitive legend, and color action buttons
- `style.css` — design-token–based CSS (CSS custom properties for light/dark mode, no CSS framework)

**Important constraint**: The app cannot be meaningfully tested in a standalone browser — `Forma.*` API calls will fail without the Forma host environment. Development and testing requires loading the dev server URL inside Forma's embedded view panel.
