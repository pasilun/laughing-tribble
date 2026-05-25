# IFC Pipeline — Lessons Learned

Hard-won rules from building the IFC4 STEP generator and web-ifc 3D viewer
(sessions ending 2026-05-25). Apply these before writing any new IFC geometry code.

---

## 1. The Double-Placement Trap (the biggest gotcha)

**Rule:** Never reuse the same `IFCAXIS2PLACEMENT3D` entity for both an
element's `IFCLOCALPLACEMENT` *and* its geometry's `IFCEXTRUDEDAREASOLID.Position`.

**Why it breaks:** The element placement maps local space → world space. The solid
Position is expressed *in* that local space. If the same transform is used for both,
any non-zero origin offset is applied twice. For a (0,0,0) origin it's invisible; for
anything else the geometry ends up in the wrong place.

**Pattern that causes it:**
```typescript
const axisId = w.next()
w.add(axisId, 'IFCAXIS2PLACEMENT3D', `#${originId},#${zUp},#${xDir}`)

// ❌ same axisId for both:
w.add(localPlacementId, 'IFCLOCALPLACEMENT', `#${parentId},#${axisId}`)
w.add(solidId, 'IFCEXTRUDEDAREASOLID', `#${profileId},#${axisId},#${dir},${depth}`)
```

**Correct pattern:** give the solid an identity placement in element-local space:
```typescript
// Element world placement — uses the real origin/axes:
w.add(axisId, 'IFCAXIS2PLACEMENT3D', `#${originId},#${zUp},#${xDir}`)
w.add(localPlacementId, 'IFCLOCALPLACEMENT', `#${parentId},#${axisId}`)

// Solid position — fresh identity (origin 0,0,0, default axes):
const solidOriginId = w.next()
w.add(solidOriginId, 'IFCCARTESIANPOINT', `(0.,0.,0.)`)
const solidPlacementId = w.next()
w.add(solidPlacementId, 'IFCAXIS2PLACEMENT3D', `#${solidOriginId},$,$`)
w.add(solidId, 'IFCEXTRUDEDAREASOLID', `#${profileId},#${solidPlacementId},#${dir},${depth}`)
```

**Caught in:** roof (`IFCROOF`, commit 69b288f) and door/window voids
(`IFCOPENINGELEMENT`, commit 03af8d6). Walls were immune because their
origin was always (0,0,0) — doubling zero is zero.

---

## 2. IFC Coordinate Axes in IFCAXIS2PLACEMENT3D

`IFCAXIS2PLACEMENT3D(location, axis, refDir)`:
- `axis` = **local Z** direction
- `refDir` = **local X** direction (approximately; projected orthogonal to axis)
- **local Y** = axis × refDir (right-hand rule)

For a wall-aligned placement where the solid extrudes upward:
- `axis` = (0,0,1) = Z up → local Z = up = extrude direction
- `refDir` = wall direction (dirX, dirY, 0) → local X = along wall
- local Y = Z × wallDir = wall's inward normal (CCW perpendicular)

For the gable roof (extruded east-west):
- `axis` = (1,0,0) = east → local Z = east = extrude direction
- `refDir` = (0,1,0) = north → local X = north
- local Y = east × north = (0,0,1) = up

Profile 2D points live in local XY. Extrude direction (0,0,1) = local Z.

---

## 3. Void Geometry for IFCRELVOIDSELEMENT

For `IFCOPENINGELEMENT` voids to actually cut through walls, two conditions must hold:

**a) Profile must span the full wall thickness:**
Center the 2D profile at (0,0) in entity local XY. Make the Y dimension (through-wall
direction) `= wallThickness + 2 * tolerance`. The rectangle must straddle the wall
centerline, not sit on one side of it.

```typescript
// ✅ centered, full depth
const voidDepth = edge.thickness + 0.1   // 5cm tolerance each side
w.add(profileId, 'IFCRECTANGLEPROFILEDEF',
  `.AREA.,$,#${profilePlacementId},${fmt(opening.width)},${fmt(voidDepth)}`)
```

**b) Entity origin at opening midpoint, not start:**
Place the `IFCOPENINGELEMENT` origin at `offsetFromStart + width/2` along the wall.
Then a centered (0,0) profile naturally spans ±width/2 = exactly the opening.

```typescript
const midOffset = opening.offsetFromStart + opening.width / 2
const ox = vStart.x + dirX * midOffset
const oy = vStart.y + dirY * midOffset
```

**c) Apply the double-placement fix (rule 1) to the void solid as well.**

web-ifc's `LoadAllGeometry` *does* perform CSG subtraction for voids — but only when
the void geometry is valid and actually intersects the wall. A misplaced void silently
produces no cutout.

---

## 4. Wall Topology: Polygon Ring over Flat Segments

Independent wall segments (each defined by start/end centerline points) overlap at
corners when rendered as thick solids. The overlap is invisible in 2D but creates
interpenetrating geometry in 3D.

**Solution:** `WallLoop` — an ordered CCW polygon ring of N vertices + N edges, where
edge[i] runs vertex[i] → vertex[(i+1)%N]. Miter-trim each wall's footprint by
intersecting the offset lines of adjacent edges (2D line-line intersection). See
`lib/wall-geometry.ts` → `wallFootprint()`.

The miter corner point is found by intersecting:
- The offset line of edge[i] (shifted outward by thickness/2)
- The offset line of edge[i-1] (shifted outward by its thickness/2)

This works for any interior angle and variable wall thickness.

---

## 5. Roof-Wall Junction: Soffit Must Not Penetrate Walls

The roof solid's flat bottom (the `E-D` segment in the pentagon profile) must be at or
above `wallH`. If `eaveH - roofThickness < wallH`, the wall tops protrude inside the
roof solid, visible as z-fighting in the viewer.

**Original (broken):**
```typescript
const eaveH = wallH - overhang * Math.tan(pitchRad)  // drops below wallH
// E-D at eaveH - roofThickness = wallH - drop - 0.15  ← below wall top
```

**Fix:** anchor the soffit to `wallH` and push the outer eave face upward:
```typescript
const roofThickness = 0.15
const eaveH = wallH + roofThickness          // outer top of eave, above wall plate
const ridgeH = eaveH + (halfSpan + overhang) * Math.tan(pitchRad)
// E-D at eaveH - roofThickness = wallH  ✓
```

The slope no longer intersects the `E-D` segment within the building's Y span
(it would cross `wallH` at Y ≈ −0.67m for the friggebod, outside the ±overhang range).

---

## 6. WASM Loading: Absolute Path Flag

`web-ifc` requires the `.wasm` files to be served from `public/`. Without the absolute
flag, webpack prepends the chunk `scriptDirectory` (`/_next/static/chunks/`) to the
path, producing an invalid double-URL.

```typescript
// ❌ webpack corrupts this to /_next/static/chunks/http://...
ifcApi.SetWasmPath(window.location.origin + '/')

// ✅ second arg true = treat as absolute, bypass webpack
ifcApi.SetWasmPath(window.location.origin + '/', true)
```

Also: guard `geom.delete()` calls — webpack bundling strips emscripten bindings:
```typescript
if (typeof geom.delete === 'function') geom.delete()
```

---

## 7. SVG Floor Plan: Y-Axis Inversion

World coordinates: Y increases northward (up).
SVG coordinates: Y increases downward (down).

Transform:
```typescript
function ty(y: number): number {
  return offsetY + (maxY - y) * scale  // flips Y
}
```

When computing perpendicular offsets for window double-lines in SVG pixel space,
the correct displacement for a world-space unit vector `(dx, dy)` is:
- SVG X offset: `±dx * pixels` (same direction)
- SVG Y offset: `∓dy * pixels` (opposite — SVG Y is flipped)

The convention `x1={sx1 - dx * offset}, y1={sy1 + dy * offset}` for Line 1
and `x1={sx1 + dx * offset}, y1={sy1 - dy * offset}` for Line 2 achieves
"one line each side of the wall" correctly for all four cardinal directions.

---

## 8. Door Symbol in 2D Floor Plan

Standard architectural floor plan door:
1. White gap erasing the wall from `startPt` to `endPt` (the opening extent)
2. Panel line: `startPt` → `startPt + perpDir(wallAngle) * width` (door in open position)
3. Swing arc: `endPt` (latch side) sweeping to the panel tip, centered at `startPt` (hinge)

Using the opening midpoint as the hinge produces a degenerate arc (same X for start
and end when the wall is axis-aligned). Always use `startPt`.

SVG arc for CCW door swing (into building, sweep-flag=0 in SVG):
```tsx
<path d={`M ${ex1} ${ey1} A ${swingR} ${swingR} 0 0 0 ${openEndX} ${openEndY}`} />
```

---

## 9. Verify with a Real Screenshot Before Committing

web-ifc silently ignores invalid geometry — a misplaced void, a self-intersecting
profile, or a bad transform produces no cutout and no error. TypeScript compiling
cleanly tells you nothing about IFC geometric correctness.

**Workflow:**
1. Generate the IFC, load it in the browser via `LoadAllGeometry`
2. Take a Playwright screenshot
3. Visually confirm walls, roof, and openings look right
4. Only then commit

This caught the double-placement bug (void 2m off), the soffit penetration, and the
degenerate door arc — none of which surfaced in typecheck or lint.

---

*Added 2026-05-25. See [[log]] for session summary.*
