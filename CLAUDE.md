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

**Deployment**: `.github/workflows/deploy.yml` builds every PR and deploys `main` to GitHub Pages. `vite.config.ts` uses `base: './'` so the build works from the Pages sub-path.

## Architecture

Almost everything lives in `src/index.tsx` (~1,090 lines, Preact). `src/categories.ts` holds the user-defined category model and its storage. There is no routing, no state management library and no component folder.

**Forma SDK integration** (`forma-embedded-view-sdk/auto`):
- `Forma.geometry.getPathsByCategory({ category: "building" })` — enumerate building paths in the scene
- `Forma.geometry.getTriangles({ path })` — raw vertex positions as a flat `Float32Array` (every 9 floats = one triangle, XYZ per vertex)
- `Forma.geometry.getFootprint({ path })` — 2D polygon coordinates for footprint area
- `Forma.selection.getSelection()` — scene selection (read-only; the SDK has no `setSelection`)
- `Forma.camera.move({ position, target })` — row click frames the building
- `Forma.render.elementColors.set({ pathsToColor })` / `.clearAll()` — one hex colour per building (all modes except Façade (Mixed))
- `Forma.render.updateMesh({ id, geometryData: { position, color } })` — per-face overlay mesh, used only for Façade (Mixed) (RGBA `Uint8Array`, 4 bytes × 3 vertices per triangle)
- `Forma.render.cleanup()` — remove custom color overlays
- `Forma.extensions.storage.getTextObject` / `setObject` — category storage, scoped to the current project: `categories.json` (definitions, project-wide) and `assignments-<proposalId>.json` (categoryId → building path → valueId). Writes to one key are queued so they land in order
- `Forma.udm.getRootUrn()` — proposal identity; its last segment is a revision that changes on every edit, so `getProposalId` keeps only the `<id>` segment
- `Forma.getCanEdit()` — category editing is hidden for view-only users

**Key derived metrics** (computed client-side, no backend):
- Height = maxZ − minZ from triangle vertices
- Footprint area = Shoelace formula on `getFootprint` coordinates
- Volume = height × footprint area
- Floor count = `round(height / 3.5)`
- GFA, site area, coverage and FAR are deliberately not calculated: Forma's Area Metrics panel already provides them
- Facade orientation = surface normal of each triangle projected onto the XY plane

**State flow**: One `useEffect` fetches building geometry on mount; a second loads categories and assignments from project storage. Category edits update state and save immediately. Colour application ("Apply Colours to All Buildings") colours every building, with no Forma selection needed; when the category being shown is edited after colours were applied, they re-apply automatically. Only category assignment reads the Forma selection (a selected child element counts as its building).

**UI structure**:
- `SummaryStrip` — always-visible aggregate stats (building count, avg height, max height, total façade area)
- Single screen, no tabs: `BuildingList` with `SortControls` (each building has a stable `number` in load order, shown as "#3" / "Building 3"), `BuildingDetail` for the clicked building, colour mode buttons (built-in modes plus one per category, ColorMode `category:<id>`), `CategoryPanel` for the active category, context-sensitive legend, colour action buttons, then Export
- Export: `buildExportRows` → `toCsv` (download via Blob, with a UTF-8 BOM for Excel) or `toTsv` (clipboard, with an `execCommand` fallback because the Clipboard API is often blocked in iframes)
- `style.css` — design-token–based CSS (CSS custom properties for light/dark mode, no CSS framework)

**Important constraint**: The app cannot be meaningfully tested in a standalone browser — `Forma.*` API calls will fail without the Forma host environment. Development and testing requires loading the dev server URL inside Forma's embedded view panel.
