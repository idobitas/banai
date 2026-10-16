# Frontend Architecture (vanilla JS + Three.js)

```
main.js (boot) ── api/client.js ──► GET /api/catalog, /api/designs/default
   │
   └─ state/store.js  ← the single committed state { design, revision, catalog, selection, ui }
        ├─ dispatch(ops) → domain/applyOps (pure, validated) → new frozen snapshot → notify
        ├─ select(id)    → { id, kind } (interior selection auto-hides doors)
        └─ subscribe(fn)
             ├─ viewer/viewer.js   renders from state (never mutates it)
             ├─ editor/*           (Phase 4) builds ops from form input → dispatch
             └─ chat/*             (Phase 5) sends design + revision to the agent
```

## State rules
- The design changes **only** via `store.dispatch(ops)`. A `DomainError` returns `{ ok: false, error }`, and the state and subscribers are left untouched.
- Snapshots are deep-frozen and compared by reference. The viewer rebuilds geometry only when `design` or `ui.doorsVisible` changes. A selection change only updates the highlight and labels.
- When a component is removed, the selection is re-resolved and cleared if needed.

## Viewer (`src/viewer/`)

| Module | Role |
|---|---|
| `buildWardrobe.js` + `builders/*` | Pure `design → THREE.Group`, with no DOM or WebGL, so it is unit-tested in Node. Every mesh has `userData { componentId, kind }`. |
| `units.js` | mm → m (×0.001), plus **visual-only** prototype constants (back panel 6 mm, door thickness 18 mm, gaps, rail radius). These are not part of the design model. |
| `materials.js` | Appearance → `MeshStandardMaterial` (catalog hex, or custom hex; finish → roughness), cached per distinct appearance. |
| `viewer.js` | Renderer (`preserveDrawingBuffer` for the Phase 8 capture), camera, OrbitControls, store subscription, and `screenPointOf` / `meshOf` helpers. |
| `picking.js` | Click → raycast → `store.select`. A drag (>5 px) is an orbit, not a click. A hit on the back panel selects the compartment under the cursor. |
| `highlight.js` | Always-on-top accent outline. A compartment outlines its interior volume. |
| `dimensions.js`, `format.js` | CSS2D labels for W/H/D and the selected component. Text is written with `textContent` only. Units are shown in cm with 1 decimal. |

Coordinates: x = 0 at the outer left face, y = 0 at the floor, front face at z = 0, back at z = −depth. Doors sit in front (z > 0). Sliding doors use two depth tracks.

## Properties editor (`src/editor/`)

| Module | Role |
|---|---|
| `opsFromForm.js` | **Pure** form-to-ops mapping (unit-tested): cm text → integer mm (`parseCm`), door, material, hinge, add-item and add-compartment ops, and `friendlyError` (fixed messages that never echo input). |
| `fields.js` | DOM builders (`el`, `cmField`, `segmented`, `selectField`, `button`). Text goes only through `textContent` / `.value`. |
| `panel.js` | Re-renders from store state (only when the design or selection changed). The selected-component card comes first, then Wardrobe, Materials and Compartments. It also owns panel-only UI state (see below). |
| `summaries.js` | **Pure** summary text for collapsed sections (`appearanceSummary`) and the compartment tree (`compartmentItems`, `itemLabel`). Unit-tested. |
| `*Section.js`, `appearanceControls.js` | Section content per component kind. Catalog swatches and custom colours are visibly distinct ("Custom: name"). |

Editing rules:
- Inputs commit on **change or Enter**, never on every keystroke.
- An invalid number shows an inline message and nothing is dispatched.
- A rejected op (`DomainError`) shows a friendly inline message, and the state is unchanged.
- Buttons and selects report errors under their section.
- No LLM is involved in manual editing.

Panel-only UI state is **not** part of the store, because it is not part of the design:
- **Collapsed sections** live in `panel.js` and persist per viewer in `localStorage` (`banai.panel.collapsed`, only known section keys are accepted). Materials is collapsed by default.
- **Expanded compartments** (the component tree) live in memory only. A new selection auto-expands its compartment and scrolls the panel to the selected card; edits inside the card do not scroll.
- **The chat column** collapses to a rail (`main.js`, `banai.chat.collapsed`). It is collapsed by default until Phase 5. The viewer's `ResizeObserver` resizes the canvas.
- Every storage access is wrapped in try/catch; with storage blocked, the defaults apply.

The visual design follows the Stitch design system documented in `/.stitch/DESIGN.md`.

## Testing
- **Unit:** `npm test` (vitest). This covers the domain engine and parity fixtures, the store, the API client, and the builders.
- **E2E:** `npm run test:e2e` (Playwright, Chromium with SwiftShader WebGL). It starts uvicorn on :8010 and Vite on :5183. `window.__banai` exists only in dev builds (`import.meta.env.DEV`) and is stripped from production bundles.
- **Visual walkthrough:** Claude in Chrome on `localhost:5173`, with a GIF per phase.
