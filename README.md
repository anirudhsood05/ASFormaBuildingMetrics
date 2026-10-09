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

## Deploying (GitHub Pages)

`.github/workflows/deploy.yml` type-checks and builds every pull request, and deploys `main` to GitHub Pages on each push (or when run manually from the Actions tab).

One-off setup:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Pages on a private repository needs a paid GitHub plan; on GitHub Free the repository must be public. Either way, the published site is publicly reachable (it contains only the panel code, no project data).
3. Once deployed, register the site URL (`https://anirudhsood05.github.io/ASFormaBuildingMetrics/`) as the extension URL in Forma instead of `http://localhost:5173/`.
