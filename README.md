# Building Metrics for Autodesk Forma

A side-panel extension for Autodesk Forma. It reads the buildings in the open proposal, estimates height, floors, footprint, volume and façade orientation, and colours buildings in the 3D view by the chosen metric.

Area figures already reported by Forma's own Area Metrics panel (gross floor area, site area, building coverage, FAR) are deliberately not duplicated here.

> All figures are massing-stage estimates for draft use only. They must be reviewed by a suitably qualified professional before use in any deliverable.

## Using it

1. Open the panel in Forma. All buildings load into the list.
2. Pick a colour mode and click **Apply colours**. Every building in the proposal is coloured.
3. Click a building in the list to move the camera to it.
4. Click **Reset** to remove the colours.

Estimates and assumptions:

- Height = top minus bottom of the building mesh.
- Floors = height ÷ 3.5 m (assumed floor-to-floor height).
- Volume = height × footprint area (overstates stepped buildings).
- Façade orientation assumes the model's +Y axis points north.

## Developing

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # dev server at http://localhost:5173/
npm run typecheck  # TypeScript check only
npm run build      # type-check, then production build to dist/
```

The app only works inside Forma: load `http://localhost:5173/` as an embedded view in Forma's extension settings. Opening it in a normal browser tab will fail because the `Forma.*` API calls have no host.
