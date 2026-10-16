# Design System: "Nordic Atelier" (Google Stitch)

- **Source:** Stitch project "BanAI Wardrobe Designer" (`projects/3881887321601714246`), generated 2026-10-14.
- **Implementation:** vanilla CSS in `frontend/src/styles/{tokens,layout,controls}.css`.

## Intent
This is a Scandinavian cabinetmaker's atelier turned into a precision desktop tool. It aims for calm, precise and uncluttered surfaces, with hairline structure instead of heavy shadows and one warm accent.

## Tokens (as implemented)

| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#F4F2EE` | Warm paper chrome |
| `--color-surface` | `#FFFFFF` | Panels, inputs, cards |
| `--color-ink` | `#1F2328` | Primary text |
| `--color-muted` | `#5B6470` | Labels, units, secondary text |
| `--color-border` | `#E3E0DA` | 1px hairlines |
| `--color-accent` | `#B4532A` (hover `#9C4420`) | Burnt Oak: selection, primary actions, focus |
| `--color-success` | `#4F7A5A` | Sage |
| `--color-danger` | `#A33A2B` | Brick: validation and destructive actions |

- **Type:** Inter. Numbers use `tabular-nums`. Section labels are 11px uppercase with letter spacing.
- **Shape:** 8px radius on inputs and cards, 6px on buttons, segmented controls, chips and swatches.
- **Spacing:** 8px grid with a 4px sub-grid.

## Component rules (from Stitch)
- **Inputs:** 32px high, numbers right-aligned, unit suffix in muted text. Focus shows an accent border plus a 1px inner ring.
- **Buttons:**
  - Primary: solid accent.
  - Secondary: white with a hairline border; the hover fills with the background colour.
  - Ghost: transparent.
  - Focus: 2px offset accent outline.
- **Segmented controls:** the active option is a solid accent fill with white text.
- **Swatches:** 40px squares, 6px radius. The selected swatch has a 2px accent border and a 2px white inner margin.
- **List rows:** hover fills with the background colour. The selected row gets an 8% accent tint and a 2px left bar.
- **Selection in 3D:** accent outline plus an accent label tag.

## Panel organization (added after Phase 4, same tokens)
- **Collapsible sections:** the 11px uppercase section title is a full-width toggle with a hairline chevron. While collapsed it shows a muted one-line summary (for appearances: a 12px colour dot plus `Material · Colour · Finish`). Materials starts collapsed; each appearance target (carcass, doors) is a collapsible sub-group with a dashed hairline divider.
- **Selected card:** the selected component is always first, framed by a 1px accent border on an 8% accent tint, with a × button to deselect. A new selection scrolls the panel to it.
- **Component tree:** each compartment row has a chevron that reveals its shelves, drawers and rails (top to bottom) on a hairline left rule. Rows reuse the list-row rules: hover fills with the background colour, selected gets the accent tint and a 2px left bar.
- **Sticky panel header:** the "Properties" title and hint stay pinned while the panel scrolls.
- **Chat rail:** the AI column collapses to a 48px rail (icon plus vertical label). Until the agent exists it starts collapsed.

## Deliberately not implemented
These parts of the Stitch output are outside the agreed MVP scope:
- **"Cutlist & cost estimation" bottom shelf:** pricing and manufacturing exports are excluded.
- **Project breadcrumb and "Save":** persistence arrives in Phase 7.
- **"Clearance verification" status:** feasibility checks are excluded.
- **"Export JSON" suggestion:** not requested.

The left chat panel shows an empty state only until the agent is built in Phase 5.
