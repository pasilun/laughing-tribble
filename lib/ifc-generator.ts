import { BuildingModelV2 } from '@/types/building-v2'
import { wallFootprint } from '@/lib/wall-geometry'

/**
 * Generates a minimal valid IFC4 STEP file from a BuildingModelV2.
 * Writes STEP text directly without any IFC libraries.
 */

interface Entity {
  id: number
  line: string
}

class StepWriter {
  private entities: Entity[] = []
  private counter = 1

  next(): number {
    return this.counter++
  }

  add(id: number, type: string, attrs: string): void {
    this.entities.push({ id, line: `#${id}=${type}(${attrs});` })
  }

  serialize(): string {
    return this.entities.map((e) => e.line).join('\n')
  }
}

function fmt(v: number): string {
  // IFC real numbers must have a decimal point
  return Number.isInteger(v) ? `${v}.` : `${v}`
}

export function generateIFC(model: BuildingModelV2): string {
  const w = new StepWriter()

  function styleItem(solidId: number, r: number, g: number, b: number, transparency: number): void {
    const colorId = w.next()
    w.add(colorId, 'IFCCOLOURRGB', `$,${fmt(r)},${fmt(g)},${fmt(b)}`)
    const renderingId = w.next()
    w.add(renderingId, 'IFCSURFACESTYLERENDERING',
      `#${colorId},${fmt(transparency)},$,$,$,$,$,$,.FLAT.`)
    const surfStyleId = w.next()
    w.add(surfStyleId, 'IFCSURFACESTYLE', `$,.BOTH.,(#${renderingId})`)
    const pStyleId = w.next()
    w.add(pStyleId, 'IFCPRESENTATIONSTYLEASSIGNMENT', `(#${surfStyleId})`)
    w.add(w.next(), 'IFCSTYLEDITEM', `#${solidId},(#${pStyleId}),$`)
  }

  // ── Boilerplate owner/app entities ──────────────────────────────────────
  const orgId = w.next()
  w.add(orgId, 'IFCORGANIZATION', `$,'CustomGenerator',$,$,$`)

  const appId = w.next()
  w.add(appId, 'IFCAPPLICATION', `#${orgId},'1.0','IFC Spike Generator','custom-ifc-gen'`)

  const personId = w.next()
  w.add(personId, 'IFCPERSON', `$,$,$,$,$,$,$,$`)

  const pOrgId = w.next()
  w.add(pOrgId, 'IFCPERSONANDORGANIZATION', `#${personId},#${orgId},$`)

  const ownerHistId = w.next()
  w.add(
    ownerHistId,
    'IFCOWNERHISTORY',
    `#${pOrgId},#${appId},$,.ADDED.,$,#${pOrgId},#${appId},0`
  )

  // ── Units ────────────────────────────────────────────────────────────────
  const dimExp0Id = w.next()
  w.add(dimExp0Id, 'IFCDIMENSIONALEXPONENTS', `0,0,0,0,0,0,0`)

  const dimExpLenId = w.next()
  w.add(dimExpLenId, 'IFCDIMENSIONALEXPONENTS', `1,0,0,0,0,0,0`)

  const dimExpAreaId = w.next()
  w.add(dimExpAreaId, 'IFCDIMENSIONALEXPONENTS', `2,0,0,0,0,0,0`)

  const dimExpVolId = w.next()
  w.add(dimExpVolId, 'IFCDIMENSIONALEXPONENTS', `3,0,0,0,0,0,0`)

  const dimExpAngleId = w.next()
  w.add(dimExpAngleId, 'IFCDIMENSIONALEXPONENTS', `0,0,0,0,0,0,0`)

  const siLenId = w.next()
  w.add(siLenId, 'IFCSIUNIT', `*,.LENGTHUNIT.,$,.METRE.`)

  const siAreaId = w.next()
  w.add(siAreaId, 'IFCSIUNIT', `*,.AREAUNIT.,$,.SQUARE_METRE.`)

  const siVolId = w.next()
  w.add(siVolId, 'IFCSIUNIT', `*,.VOLUMEUNIT.,$,.CUBIC_METRE.`)

  const siAngleId = w.next()
  w.add(siAngleId, 'IFCSIUNIT', `*,.PLANEANGLEUNIT.,$,.RADIAN.`)

  const unitAssignId = w.next()
  w.add(
    unitAssignId,
    'IFCUNITASSIGNMENT',
    `(#${siLenId},#${siAreaId},#${siVolId},#${siAngleId})`
  )

  // ── Geometric representation context ────────────────────────────────────
  const worldOriginId = w.next()
  w.add(worldOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)

  const worldXAxisId = w.next()
  w.add(worldXAxisId, 'IFCDIRECTION', `(${fmt(1.)},${fmt(0.)},${fmt(0.)})`)

  const worldZAxisId = w.next()
  w.add(worldZAxisId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)

  const worldPlacementId = w.next()
  w.add(
    worldPlacementId,
    'IFCAXIS2PLACEMENT3D',
    `#${worldOriginId},#${worldZAxisId},#${worldXAxisId}`
  )

  const geomCtx3dId = w.next()
  w.add(
    geomCtx3dId,
    'IFCGEOMETRICREPRESENTATIONCONTEXT',
    `$,'Model',3,1.0E-5,#${worldPlacementId},$`
  )

  const geomCtx2dId = w.next()
  w.add(
    geomCtx2dId,
    'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
    `'FootPrint','Model',*,*,*,*,#${geomCtx3dId},$,.PLAN_VIEW.,$`
  )

  // ── Project hierarchy ────────────────────────────────────────────────────
  const projectId = w.next()
  w.add(
    projectId,
    'IFCPROJECT',
    `'${model.id}',#${ownerHistId},'${model.name}',$,$,$,$,(#${geomCtx3dId},#${geomCtx2dId}),#${unitAssignId}`
  )

  // Site placement
  const siteOriginId = w.next()
  const sx = model.site?.buildingOffsetX ?? 0
  const sy = model.site?.buildingOffsetY ?? 0
  w.add(siteOriginId, 'IFCCARTESIANPOINT', `(${fmt(sx)},${fmt(sy)},${fmt(0.)})`)

  const sitePlacement3dId = w.next()
  w.add(sitePlacement3dId, 'IFCAXIS2PLACEMENT3D', `#${siteOriginId},$,$`)

  const siteLocalPlacementId = w.next()
  w.add(siteLocalPlacementId, 'IFCLOCALPLACEMENT', `$,#${sitePlacement3dId}`)

  const siteId = w.next()
  w.add(
    siteId,
    'IFCSITE',
    `'site-01',#${ownerHistId},'Site',$,$,#${siteLocalPlacementId},$,$,.ELEMENT.,$,$,$,$,$`
  )

  // Building placement (at origin relative to site)
  const bldgOriginId = w.next()
  w.add(bldgOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)

  const bldgPlacement3dId = w.next()
  w.add(bldgPlacement3dId, 'IFCAXIS2PLACEMENT3D', `#${bldgOriginId},$,$`)

  const bldgLocalPlacementId = w.next()
  w.add(bldgLocalPlacementId, 'IFCLOCALPLACEMENT', `#${siteLocalPlacementId},#${bldgPlacement3dId}`)

  const buildingId = w.next()
  w.add(
    buildingId,
    'IFCBUILDING',
    `'building-01',#${ownerHistId},'${model.name}',$,$,#${bldgLocalPlacementId},$,$,.ELEMENT.,$,$,$`
  )

  // Building storey
  const storeyOriginId = w.next()
  w.add(storeyOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)

  const storeyPlacement3dId = w.next()
  w.add(storeyPlacement3dId, 'IFCAXIS2PLACEMENT3D', `#${storeyOriginId},$,$`)

  const storeyLocalPlacementId = w.next()
  w.add(
    storeyLocalPlacementId,
    'IFCLOCALPLACEMENT',
    `#${bldgLocalPlacementId},#${storeyPlacement3dId}`
  )

  const storeyId = w.next()
  w.add(
    storeyId,
    'IFCBUILDINGSTOREY',
    `'storey-01',#${ownerHistId},'Bottenvåning',$,$,#${storeyLocalPlacementId},$,$,.ELEMENT.,${fmt(0.)}`
  )

  // ── IFCRELAGGREGATES hierarchy links ────────────────────────────────────
  const rel1Id = w.next()
  w.add(
    rel1Id,
    'IFCRELAGGREGATES',
    `'rel-project-site',#${ownerHistId},$,$,#${projectId},(#${siteId})`
  )

  const rel2Id = w.next()
  w.add(
    rel2Id,
    'IFCRELAGGREGATES',
    `'rel-site-building',#${ownerHistId},$,$,#${siteId},(#${buildingId})`
  )

  const rel3Id = w.next()
  w.add(
    rel3Id,
    'IFCRELAGGREGATES',
    `'rel-building-storey',#${ownerHistId},$,$,#${buildingId},(#${storeyId})`
  )

  // ── Walls ────────────────────────────────────────────────────────────────
  const wallEntityIds: number[] = []
  const fillerIds: number[] = []

  for (const loop of model.walls) {
    for (let edgeIdx = 0; edgeIdx < loop.edges.length; edgeIdx++) {
      const edge = loop.edges[edgeIdx]
      const footprint = wallFootprint(loop, edgeIdx)  // [outerStart, outerEnd, innerEnd, innerStart]

      // Shared world-space placement (origin at 0,0,0, Z up, X east)
      const originId = w.next()
      w.add(originId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
      const zUpId = w.next()
      w.add(zUpId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
      const xEastId = w.next()
      w.add(xEastId, 'IFCDIRECTION', `(${fmt(1.)},${fmt(0.)},${fmt(0.)})`)
      const axis3dId = w.next()
      w.add(axis3dId, 'IFCAXIS2PLACEMENT3D', `#${originId},#${zUpId},#${xEastId}`)
      const wallLocalPlacementId = w.next()
      w.add(wallLocalPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${axis3dId}`)

      // Profile: IFCARBITRARYCLOSEDPROFILEDEF with the 4-corner miter footprint
      const ptIds = footprint.map(pt => {
        const id = w.next()
        w.add(id, 'IFCCARTESIANPOINT', `(${fmt(pt.x)},${fmt(pt.y)})`)
        return id
      })
      // Close the polyline by repeating first point
      const closePtId = w.next()
      w.add(closePtId, 'IFCCARTESIANPOINT', `(${fmt(footprint[0].x)},${fmt(footprint[0].y)})`)
      const polylineId = w.next()
      w.add(polylineId, 'IFCPOLYLINE', `(${[...ptIds, closePtId].map(id => `#${id}`).join(',')})`)
      const profileId = w.next()
      w.add(profileId, 'IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,$,#${polylineId}`)

      // Extrude upward
      const extrudeDirId = w.next()
      w.add(extrudeDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
      const solidId = w.next()
      w.add(solidId, 'IFCEXTRUDEDAREASOLID', `#${profileId},#${axis3dId},#${extrudeDirId},${fmt(edge.height)}`)

      // Shape representation
      const shapeRepId = w.next()
      w.add(shapeRepId, 'IFCSHAPEREPRESENTATION', `#${geomCtx3dId},'Body','SweptSolid',(#${solidId})`)
      const prodDefShapeId = w.next()
      w.add(prodDefShapeId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${shapeRepId})`)

      const wallEntityId = w.next()
      w.add(wallEntityId, 'IFCWALLSTANDARDCASE',
        `'${edge.id}',#${ownerHistId},'Wall',$,$,#${wallLocalPlacementId},#${prodDefShapeId},$`)
      wallEntityIds.push(wallEntityId)

      // Openings for this edge
      const edgeOpenings = model.openings.filter(o => o.wallId === edge.id && !o.partitionId)
      for (const opening of edgeOpenings) {
        const vStart = loop.vertices[edgeIdx]
        const vEnd = loop.vertices[(edgeIdx + 1) % loop.vertices.length]
        const dx = vEnd.x - vStart.x, dy = vEnd.y - vStart.y
        const len = Math.sqrt(dx * dx + dy * dy)
        const dirX = dx / len, dirY = dy / len

        const sillH = opening.sillHeight ?? (opening.type === 'door' ? 0 : 0.9)
        // Entity origin at MIDPOINT of opening along wall
        const midOffset = opening.offsetFromStart + opening.width / 2
        const ox = vStart.x + dirX * midOffset
        const oy = vStart.y + dirY * midOffset

        // Entity placement
        const openOriginId = w.next()
        w.add(openOriginId, 'IFCCARTESIANPOINT', `(${fmt(ox)},${fmt(oy)},${fmt(sillH)})`)
        const openZUpId = w.next()
        w.add(openZUpId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
        const openXDirId = w.next()
        w.add(openXDirId, 'IFCDIRECTION', `(${fmt(dirX)},${fmt(dirY)},${fmt(0.)})`)
        const openAxis3dId = w.next()
        w.add(openAxis3dId, 'IFCAXIS2PLACEMENT3D', `#${openOriginId},#${openZUpId},#${openXDirId}`)
        const openLocalPlacementId = w.next()
        w.add(openLocalPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${openAxis3dId}`)

        // Void solid: centered at entity origin, full wall thickness + tolerance
        const voidDepth = edge.thickness + 0.1
        const profileOriginId = w.next()
        w.add(profileOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
        const profilePlacementId = w.next()
        w.add(profilePlacementId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`)
        const voidProfileId = w.next()
        w.add(voidProfileId, 'IFCRECTANGLEPROFILEDEF',
          `.AREA.,$,#${profilePlacementId},${fmt(opening.width)},${fmt(voidDepth)}`)

        // Solid placement: identity in entity local space (fixes double-placement)
        const solidOriginId = w.next()
        w.add(solidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
        const solidPlacementId = w.next()
        w.add(solidPlacementId, 'IFCAXIS2PLACEMENT3D', `#${solidOriginId},$,$`)

        const openExtDirId = w.next()
        w.add(openExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
        const openSolidId = w.next()
        w.add(openSolidId, 'IFCEXTRUDEDAREASOLID',
          `#${voidProfileId},#${solidPlacementId},#${openExtDirId},${fmt(opening.height)}`)

        const openShapeRepId = w.next()
        w.add(openShapeRepId, 'IFCSHAPEREPRESENTATION',
          `#${geomCtx3dId},'Body','SweptSolid',(#${openSolidId})`)
        const openProdDefId = w.next()
        w.add(openProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${openShapeRepId})`)

        const openingElementId = w.next()
        w.add(openingElementId, 'IFCOPENINGELEMENT',
          `'${opening.id}',#${ownerHistId},'Opening',$,$,#${openLocalPlacementId},#${openProdDefId},$`)

        const relVoidId = w.next()
        w.add(relVoidId, 'IFCRELVOIDSELEMENT',
          `'rel-void-${opening.id}',#${ownerHistId},$,$,#${wallEntityId},#${openingElementId}`)

        if (opening.type === 'door') {
          // Panel geometry: width × panelDepth rectangle extruded upward for height
          const panelDepth = 0.045
          const dProfOriginId = w.next()
          w.add(dProfOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
          const dProfPlacId = w.next()
          w.add(dProfPlacId, 'IFCAXIS2PLACEMENT2D', `#${dProfOriginId},$`)
          const dProfId = w.next()
          w.add(dProfId, 'IFCRECTANGLEPROFILEDEF',
            `.AREA.,$,#${dProfPlacId},${fmt(opening.width)},${fmt(panelDepth)}`)
          const dSolidOriginId = w.next()
          w.add(dSolidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
          const dSolidPlacId = w.next()
          w.add(dSolidPlacId, 'IFCAXIS2PLACEMENT3D', `#${dSolidOriginId},$,$`)
          const dExtDirId = w.next()
          w.add(dExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
          const dSolidId = w.next()
          w.add(dSolidId, 'IFCEXTRUDEDAREASOLID',
            `#${dProfId},#${dSolidPlacId},#${dExtDirId},${fmt(opening.height)}`)
          styleItem(dSolidId, 0.55, 0.35, 0.15, 0.)   // wood brown, opaque

          const dShapeRepId = w.next()
          w.add(dShapeRepId, 'IFCSHAPEREPRESENTATION',
            `#${geomCtx3dId},'Body','SweptSolid',(#${dSolidId})`)
          const dProdDefId = w.next()
          w.add(dProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${dShapeRepId})`)

          const doorId = w.next()
          w.add(doorId, 'IFCDOOR',
            `'${opening.id}-door',#${ownerHistId},'Door',$,$,#${openLocalPlacementId},#${dProdDefId},${fmt(opening.height)},${fmt(opening.width)}`)
          fillerIds.push(doorId)
          const relFillId = w.next()
          w.add(relFillId, 'IFCRELFILLSELEMENT',
            `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${doorId}`)
        } else {
          // Pane geometry: width × paneDepth rectangle extruded upward for height
          const paneDepth = 0.02
          const wProfOriginId = w.next()
          w.add(wProfOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
          const wProfPlacId = w.next()
          w.add(wProfPlacId, 'IFCAXIS2PLACEMENT2D', `#${wProfOriginId},$`)
          const wProfId = w.next()
          w.add(wProfId, 'IFCRECTANGLEPROFILEDEF',
            `.AREA.,$,#${wProfPlacId},${fmt(opening.width)},${fmt(paneDepth)}`)
          const wSolidOriginId = w.next()
          w.add(wSolidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
          const wSolidPlacId = w.next()
          w.add(wSolidPlacId, 'IFCAXIS2PLACEMENT3D', `#${wSolidOriginId},$,$`)
          const wExtDirId = w.next()
          w.add(wExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
          const wSolidId = w.next()
          w.add(wSolidId, 'IFCEXTRUDEDAREASOLID',
            `#${wProfId},#${wSolidPlacId},#${wExtDirId},${fmt(opening.height)}`)
          styleItem(wSolidId, 0.6, 0.85, 1.0, 0.55)   // glass blue, 45% opaque

          const wShapeRepId = w.next()
          w.add(wShapeRepId, 'IFCSHAPEREPRESENTATION',
            `#${geomCtx3dId},'Body','SweptSolid',(#${wSolidId})`)
          const wProdDefId = w.next()
          w.add(wProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${wShapeRepId})`)

          const windowId = w.next()
          w.add(windowId, 'IFCWINDOW',
            `'${opening.id}-window',#${ownerHistId},'Window',$,$,#${openLocalPlacementId},#${wProdDefId},${fmt(opening.height)},${fmt(opening.width)}`)
          fillerIds.push(windowId)
          const relFillId = w.next()
          w.add(relFillId, 'IFCRELFILLSELEMENT',
            `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${windowId}`)
        }
      }
    }
  }

  // ── Interior partition walls ─────────────────────────────────────────────
  const partitionEntityIds: number[] = []

  for (const part of (model.partitions ?? [])) {
    const dx = part.end.x - part.start.x
    const dy = part.end.y - part.start.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 0.01) continue

    const dirX = dx / len
    const dirY = dy / len
    const partH = part.height ?? (model.walls[0]?.edges[0]?.height ?? 2.4)
    const t = part.thickness ?? 0.1

    // Place entity at start point, refDir = wall direction, axis = Z up
    const partOriginId = w.next()
    w.add(partOriginId, 'IFCCARTESIANPOINT', `(${fmt(part.start.x)},${fmt(part.start.y)},${fmt(0.)})`)
    const zUpId = w.next()
    w.add(zUpId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
    const xDirId = w.next()
    w.add(xDirId, 'IFCDIRECTION', `(${fmt(dirX)},${fmt(dirY)},${fmt(0.)})`)
    const axis3dId = w.next()
    w.add(axis3dId, 'IFCAXIS2PLACEMENT3D', `#${partOriginId},#${zUpId},#${xDirId}`)
    const localPlacementId = w.next()
    w.add(localPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${axis3dId}`)

    // Profile: rectangle len × t, centered at (len/2, 0) in local XY
    const profOriginId = w.next()
    w.add(profOriginId, 'IFCCARTESIANPOINT', `(${fmt(len / 2)},${fmt(0.)})`)
    const profPlacId = w.next()
    w.add(profPlacId, 'IFCAXIS2PLACEMENT2D', `#${profOriginId},$`)
    const profId = w.next()
    w.add(profId, 'IFCRECTANGLEPROFILEDEF', `.AREA.,$,#${profPlacId},${fmt(len)},${fmt(t)}`)

    // Solid: identity placement + extrude upward
    const solidOriginId = w.next()
    w.add(solidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
    const solidPlacId = w.next()
    w.add(solidPlacId, 'IFCAXIS2PLACEMENT3D', `#${solidOriginId},$,$`)
    const extDirId = w.next()
    w.add(extDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
    const solidId = w.next()
    w.add(solidId, 'IFCEXTRUDEDAREASOLID', `#${profId},#${solidPlacId},#${extDirId},${fmt(partH)}`)

    const shapeRepId = w.next()
    w.add(shapeRepId, 'IFCSHAPEREPRESENTATION',
      `#${geomCtx3dId},'Body','SweptSolid',(#${solidId})`)
    const prodDefId = w.next()
    w.add(prodDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${shapeRepId})`)

    const wallId = w.next()
    w.add(wallId, 'IFCWALLSTANDARDCASE',
      `'${part.id}',#${ownerHistId},'${part.id}',$,$,#${localPlacementId},#${prodDefId},$`)

    partitionEntityIds.push(wallId)

    // Openings for this partition
    const partOpenings = model.openings.filter(o => o.partitionId === part.id)
    for (const opening of partOpenings) {
      const sillH = opening.sillHeight ?? (opening.type === 'door' ? 0 : 0.9)
      // Entity origin at MIDPOINT of opening along partition
      const midOffset = opening.offsetFromStart + opening.width / 2
      const ox = part.start.x + dirX * midOffset
      const oy = part.start.y + dirY * midOffset

      // Entity placement
      const openOriginId = w.next()
      w.add(openOriginId, 'IFCCARTESIANPOINT', `(${fmt(ox)},${fmt(oy)},${fmt(sillH)})`)
      const openZUpId = w.next()
      w.add(openZUpId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
      const openXDirId = w.next()
      w.add(openXDirId, 'IFCDIRECTION', `(${fmt(dirX)},${fmt(dirY)},${fmt(0.)})`)
      const openAxis3dId = w.next()
      w.add(openAxis3dId, 'IFCAXIS2PLACEMENT3D', `#${openOriginId},#${openZUpId},#${openXDirId}`)
      const openLocalPlacementId = w.next()
      w.add(openLocalPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${openAxis3dId}`)

      // Void solid: centered at entity origin, full partition thickness + tolerance
      const voidDepth = (part.thickness ?? 0.1) + 0.1
      const profileOriginId = w.next()
      w.add(profileOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
      const profilePlacementId = w.next()
      w.add(profilePlacementId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`)
      const voidProfileId = w.next()
      w.add(voidProfileId, 'IFCRECTANGLEPROFILEDEF',
        `.AREA.,$,#${profilePlacementId},${fmt(opening.width)},${fmt(voidDepth)}`)

      // Solid placement: identity in entity local space
      const solidOriginId2 = w.next()
      w.add(solidOriginId2, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
      const solidPlacementId2 = w.next()
      w.add(solidPlacementId2, 'IFCAXIS2PLACEMENT3D', `#${solidOriginId2},$,$`)

      const openExtDirId = w.next()
      w.add(openExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
      const openSolidId = w.next()
      w.add(openSolidId, 'IFCEXTRUDEDAREASOLID',
        `#${voidProfileId},#${solidPlacementId2},#${openExtDirId},${fmt(opening.height)}`)

      const openShapeRepId = w.next()
      w.add(openShapeRepId, 'IFCSHAPEREPRESENTATION',
        `#${geomCtx3dId},'Body','SweptSolid',(#${openSolidId})`)
      const openProdDefId = w.next()
      w.add(openProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${openShapeRepId})`)

      const openingElementId = w.next()
      w.add(openingElementId, 'IFCOPENINGELEMENT',
        `'${opening.id}',#${ownerHistId},'Opening',$,$,#${openLocalPlacementId},#${openProdDefId},$`)

      const relVoidId = w.next()
      w.add(relVoidId, 'IFCRELVOIDSELEMENT',
        `'rel-void-${opening.id}',#${ownerHistId},$,$,#${wallId},#${openingElementId}`)

      if (opening.type === 'door') {
        const panelDepth = 0.045
        const dProfOriginId = w.next()
        w.add(dProfOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
        const dProfPlacId = w.next()
        w.add(dProfPlacId, 'IFCAXIS2PLACEMENT2D', `#${dProfOriginId},$`)
        const dProfId = w.next()
        w.add(dProfId, 'IFCRECTANGLEPROFILEDEF',
          `.AREA.,$,#${dProfPlacId},${fmt(opening.width)},${fmt(panelDepth)}`)
        const dSolidOriginId = w.next()
        w.add(dSolidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
        const dSolidPlacId = w.next()
        w.add(dSolidPlacId, 'IFCAXIS2PLACEMENT3D', `#${dSolidOriginId},$,$`)
        const dExtDirId = w.next()
        w.add(dExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
        const dSolidId = w.next()
        w.add(dSolidId, 'IFCEXTRUDEDAREASOLID',
          `#${dProfId},#${dSolidPlacId},#${dExtDirId},${fmt(opening.height)}`)
        styleItem(dSolidId, 0.55, 0.35, 0.15, 0.)   // wood brown, opaque

        const dShapeRepId = w.next()
        w.add(dShapeRepId, 'IFCSHAPEREPRESENTATION',
          `#${geomCtx3dId},'Body','SweptSolid',(#${dSolidId})`)
        const dProdDefId = w.next()
        w.add(dProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${dShapeRepId})`)

        const doorId = w.next()
        w.add(doorId, 'IFCDOOR',
          `'${opening.id}-door',#${ownerHistId},'Door',$,$,#${openLocalPlacementId},#${dProdDefId},${fmt(opening.height)},${fmt(opening.width)}`)
        fillerIds.push(doorId)
        const relFillId = w.next()
        w.add(relFillId, 'IFCRELFILLSELEMENT',
          `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${doorId}`)
      } else {
        const paneDepth = 0.02
        const wProfOriginId = w.next()
        w.add(wProfOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)
        const wProfPlacId = w.next()
        w.add(wProfPlacId, 'IFCAXIS2PLACEMENT2D', `#${wProfOriginId},$`)
        const wProfId = w.next()
        w.add(wProfId, 'IFCRECTANGLEPROFILEDEF',
          `.AREA.,$,#${wProfPlacId},${fmt(opening.width)},${fmt(paneDepth)}`)
        const wSolidOriginId = w.next()
        w.add(wSolidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
        const wSolidPlacId = w.next()
        w.add(wSolidPlacId, 'IFCAXIS2PLACEMENT3D', `#${wSolidOriginId},$,$`)
        const wExtDirId = w.next()
        w.add(wExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
        const wSolidId = w.next()
        w.add(wSolidId, 'IFCEXTRUDEDAREASOLID',
          `#${wProfId},#${wSolidPlacId},#${wExtDirId},${fmt(opening.height)}`)
        styleItem(wSolidId, 0.6, 0.85, 1.0, 0.55)   // glass blue, 45% opaque

        const wShapeRepId = w.next()
        w.add(wShapeRepId, 'IFCSHAPEREPRESENTATION',
          `#${geomCtx3dId},'Body','SweptSolid',(#${wSolidId})`)
        const wProdDefId = w.next()
        w.add(wProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${wShapeRepId})`)

        const windowId = w.next()
        w.add(windowId, 'IFCWINDOW',
          `'${opening.id}-window',#${ownerHistId},'Window',$,$,#${openLocalPlacementId},#${wProdDefId},${fmt(opening.height)},${fmt(opening.width)}`)
        fillerIds.push(windowId)
        const relFillId = w.next()
        w.add(relFillId, 'IFCRELFILLSELEMENT',
          `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${windowId}`)
      }
    }
  }

  // ── Fixtures (IFCBUILDINGELEMENTPROXY) ──────────────────────────────────
  const fixtureIds: number[] = []

  for (const fixture of (model.fixtures ?? [])) {
    const defaultHeight = fixture.type === 'sauna_heater' ? 0.6 : fixture.type === 'bench' ? 0.45 : 0.9
    const h = fixture.height ?? defaultHeight
    const cx = fixture.x + fixture.width / 2
    const cy = fixture.y + fixture.depth / 2

    const fixOriginId = w.next()
    w.add(fixOriginId, 'IFCCARTESIANPOINT', `(${fmt(fixture.x)},${fmt(fixture.y)},${fmt(0.)})`)
    const fixZUpId = w.next()
    w.add(fixZUpId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
    const fixXDirId = w.next()
    w.add(fixXDirId, 'IFCDIRECTION', `(${fmt(1.)},${fmt(0.)},${fmt(0.)})`)
    const fixAxis3dId = w.next()
    w.add(fixAxis3dId, 'IFCAXIS2PLACEMENT3D', `#${fixOriginId},#${fixZUpId},#${fixXDirId}`)
    const fixLocalPlacementId = w.next()
    w.add(fixLocalPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${fixAxis3dId}`)

    // Rectangle profile centred at (width/2, depth/2) in local XY
    const fixProfOriginId = w.next()
    w.add(fixProfOriginId, 'IFCCARTESIANPOINT', `(${fmt(cx - fixture.x)},${fmt(cy - fixture.y)})`)
    const fixProfPlacId = w.next()
    w.add(fixProfPlacId, 'IFCAXIS2PLACEMENT2D', `#${fixProfOriginId},$`)
    const fixProfId = w.next()
    w.add(fixProfId, 'IFCRECTANGLEPROFILEDEF', `.AREA.,$,#${fixProfPlacId},${fmt(fixture.width)},${fmt(fixture.depth)}`)

    const fixSolidOriginId = w.next()
    w.add(fixSolidOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
    const fixSolidPlacId = w.next()
    w.add(fixSolidPlacId, 'IFCAXIS2PLACEMENT3D', `#${fixSolidOriginId},$,$`)
    const fixExtDirId = w.next()
    w.add(fixExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
    const fixSolidId = w.next()
    w.add(fixSolidId, 'IFCEXTRUDEDAREASOLID', `#${fixProfId},#${fixSolidPlacId},#${fixExtDirId},${fmt(h)}`)

    // Distinct material per type — forces IfcConvert to keep adjacent fixtures as separate meshes
    if (fixture.type === 'bench')             styleItem(fixSolidId, 0.72, 0.53, 0.30, 0.)
    else if (fixture.type === 'sauna_heater') styleItem(fixSolidId, 0.25, 0.25, 0.28, 0.)
    else if (fixture.type === 'stove')        styleItem(fixSolidId, 0.30, 0.30, 0.30, 0.)
    else if (fixture.type === 'toilet')       styleItem(fixSolidId, 0.92, 0.92, 0.92, 0.)
    else if (fixture.type === 'sink')         styleItem(fixSolidId, 0.85, 0.88, 0.92, 0.)
    else                                      styleItem(fixSolidId, 0.60, 0.70, 0.60, 0.)

    const fixShapeRepId = w.next()
    w.add(fixShapeRepId, 'IFCSHAPEREPRESENTATION', `#${geomCtx3dId},'Body','SweptSolid',(#${fixSolidId})`)
    const fixProdDefId = w.next()
    w.add(fixProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${fixShapeRepId})`)

    const fixEntityId = w.next()
    w.add(fixEntityId, 'IFCBUILDINGELEMENTPROXY',
      `'${fixture.id}',#${ownerHistId},'${fixture.label ?? fixture.type}',$,$,#${fixLocalPlacementId},#${fixProdDefId},$,$`)
    fixtureIds.push(fixEntityId)
  }

  // ── Rooms (IFCSPACE) ─────────────────────────────────────────────────────
  const spaceIds: number[] = []

  for (const room of model.rooms) {
    const roomOriginId = w.next()
    w.add(roomOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)

    const roomPlacement3dId = w.next()
    w.add(roomPlacement3dId, 'IFCAXIS2PLACEMENT3D', `#${roomOriginId},$,$`)

    const roomLocalPlacementId = w.next()
    w.add(
      roomLocalPlacementId,
      'IFCLOCALPLACEMENT',
      `#${storeyLocalPlacementId},#${roomPlacement3dId}`
    )

    // Floor outline as polyline for footprint shape
    const polyPtIds: number[] = []
    for (const pt of room.polygon) {
      const ptId = w.next()
      w.add(ptId, 'IFCCARTESIANPOINT', `(${fmt(pt.x)},${fmt(pt.y)})`)
      polyPtIds.push(ptId)
    }

    const polylineId = w.next()
    w.add(polylineId, 'IFCPOLYLINE', `(${polyPtIds.map((id) => `#${id}`).join(',')})`)

    const curveRepId = w.next()
    w.add(
      curveRepId,
      'IFCSHAPEREPRESENTATION',
      `#${geomCtx2dId},'FootPrint','Curve2D',(#${polylineId})`
    )

    const roomProdDefId = w.next()
    w.add(roomProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${curveRepId})`)

    const spaceId = w.next()
    w.add(
      spaceId,
      'IFCSPACE',
      `'${room.id}',#${ownerHistId},'${room.name}',$,$,#${roomLocalPlacementId},#${roomProdDefId},$,.ELEMENT.,.INTERNAL.`
    )

    spaceIds.push(spaceId)
  }

  // ── Sadel (gable) roof ───────────────────────────────────────────────────
  let roofId: number | null = null

  if (model.roof.type === 'sadel') {
    const pitch = model.roof.pitch
    const overhang = model.roof.overhang
    const ridgeDir = model.roof.ridgeDirection ?? 'ew'
    const wallH = model.walls[0]?.edges[0]?.height ?? 2.4
    const vertices = model.walls[0]?.vertices ?? []
    const xs = vertices.map(v => v.x)
    const ys = vertices.map(v => v.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const buildingWidth = Math.max(...ys) - minY
    const buildingLength = maxX - minX
    const pitchRad = (pitch * Math.PI) / 180
    const roofThickness = 0.15
    const eaveH = wallH + roofThickness

    let roofSolidId: number

    if (ridgeDir === 'ns') {
      // NS ridge: ridge runs north-south, pitches east-west
      const halfSpan = buildingLength / 2
      const extrudeLen = buildingWidth + 2 * overhang
      const ridgeH = eaveH + (halfSpan + overhang) * Math.tan(pitchRad)

      // Profile placement: origin at (maxX + overhang, minY - overhang, 0)
      // axis (local Z = extrude direction) = (0, 1, 0) north
      // refDir (local X) = (-1, 0, 0) west
      const roofOriginId = w.next()
      w.add(roofOriginId, 'IFCCARTESIANPOINT', `(${fmt(maxX + overhang)},${fmt(minY - overhang)},${fmt(0.)})`)

      const roofAxisDirId = w.next() // local Z = extrude direction = global Y (north)
      w.add(roofAxisDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(1.)},${fmt(0.)})`)

      const roofRefDirId = w.next() // local X = global -X (west)
      w.add(roofRefDirId, 'IFCDIRECTION', `(${fmt(-1.)},${fmt(0.)},${fmt(0.)})`)

      const roofPlacement3dId = w.next()
      w.add(
        roofPlacement3dId,
        'IFCAXIS2PLACEMENT3D',
        `#${roofOriginId},#${roofAxisDirId},#${roofRefDirId}`
      )

      // Pentagon profile vertices (local XY: local X = west, local Y = up)
      // P1 = (0, eaveH) — east eave top
      const ptP1Id = w.next()
      w.add(ptP1Id, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(eaveH)})`)

      // P2 = (buildingLength/2 + overhang, ridgeH) — ridge center
      const ptP2Id = w.next()
      w.add(ptP2Id, 'IFCCARTESIANPOINT', `(${fmt(buildingLength / 2 + overhang)},${fmt(ridgeH)})`)

      // P3 = (buildingLength + 2*overhang, eaveH) — west eave top
      const ptP3Id = w.next()
      w.add(ptP3Id, 'IFCCARTESIANPOINT', `(${fmt(buildingLength + 2 * overhang)},${fmt(eaveH)})`)

      // P4 = (buildingLength + 2*overhang, eaveH - roofThickness) — west eave bottom
      const ptP4Id = w.next()
      w.add(ptP4Id, 'IFCCARTESIANPOINT', `(${fmt(buildingLength + 2 * overhang)},${fmt(eaveH - roofThickness)})`)

      // P5 = (0, eaveH - roofThickness) — east eave bottom
      const ptP5Id = w.next()
      w.add(ptP5Id, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(eaveH - roofThickness)})`)

      // P1_close to close the polyline
      const ptP1CloseId = w.next()
      w.add(ptP1CloseId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(eaveH)})`)

      const roofPolylineId = w.next()
      w.add(
        roofPolylineId,
        'IFCPOLYLINE',
        `(#${ptP1Id},#${ptP2Id},#${ptP3Id},#${ptP4Id},#${ptP5Id},#${ptP1CloseId})`
      )

      const roofProfileId = w.next()
      w.add(roofProfileId, 'IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,$,#${roofPolylineId}`)

      // Extrude along local Z = global Y (north)
      const roofExtrudeDirId = w.next()
      w.add(roofExtrudeDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)

      roofSolidId = w.next()
      w.add(
        roofSolidId,
        'IFCEXTRUDEDAREASOLID',
        `#${roofProfileId},#${roofPlacement3dId},#${roofExtrudeDirId},${fmt(extrudeLen)}`
      )
    } else {
      // EW ridge (default): ridge runs east-west, pitches north-south
      const halfSpan = buildingWidth / 2
      const extrudeLen = buildingLength + 2 * overhang
      const ridgeH = eaveH + (halfSpan + overhang) * Math.tan(pitchRad)

      // Profile placement: origin at (-overhang, minY, 0), axis=east(X), refDir=north(Y)
      const roofOriginId = w.next()
      w.add(roofOriginId, 'IFCCARTESIANPOINT', `(${fmt(-overhang)},${fmt(minY)},${fmt(0.)})`)

      const roofAxisDirId = w.next() // local Z = extrude direction = global X (east)
      w.add(roofAxisDirId, 'IFCDIRECTION', `(${fmt(1.)},${fmt(0.)},${fmt(0.)})`)

      const roofRefDirId = w.next() // local X = global Y (north)
      w.add(roofRefDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(1.)},${fmt(0.)})`)

      const roofPlacement3dId = w.next()
      w.add(
        roofPlacement3dId,
        'IFCAXIS2PLACEMENT3D',
        `#${roofOriginId},#${roofAxisDirId},#${roofRefDirId}`
      )

      // Pentagon profile vertices (2D in local XY = global YZ plane)
      // A = (-overhang, eaveH)
      const ptAId = w.next()
      w.add(ptAId, 'IFCCARTESIANPOINT', `(${fmt(-overhang)},${fmt(eaveH)})`)

      // B = (halfSpan, ridgeH)
      const ptBId = w.next()
      w.add(ptBId, 'IFCCARTESIANPOINT', `(${fmt(halfSpan)},${fmt(ridgeH)})`)

      // C = (buildingWidth+overhang, eaveH)
      const ptCId = w.next()
      w.add(ptCId, 'IFCCARTESIANPOINT', `(${fmt(buildingWidth + overhang)},${fmt(eaveH)})`)

      // D = (buildingWidth+overhang, eaveH-0.15)
      const ptDId = w.next()
      w.add(ptDId, 'IFCCARTESIANPOINT', `(${fmt(buildingWidth + overhang)},${fmt(eaveH - roofThickness)})`)

      // E = (-overhang, eaveH-0.15)
      const ptEId = w.next()
      w.add(ptEId, 'IFCCARTESIANPOINT', `(${fmt(-overhang)},${fmt(eaveH - roofThickness)})`)

      // A_copy to close the polyline
      const ptACloseId = w.next()
      w.add(ptACloseId, 'IFCCARTESIANPOINT', `(${fmt(-overhang)},${fmt(eaveH)})`)

      const roofPolylineId = w.next()
      w.add(
        roofPolylineId,
        'IFCPOLYLINE',
        `(#${ptAId},#${ptBId},#${ptCId},#${ptDId},#${ptEId},#${ptACloseId})`
      )

      const roofProfileId = w.next()
      w.add(roofProfileId, 'IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,$,#${roofPolylineId}`)

      // Extrude along local Z = global X (east)
      const roofExtrudeDirId = w.next()
      w.add(roofExtrudeDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)

      roofSolidId = w.next()
      w.add(
        roofSolidId,
        'IFCEXTRUDEDAREASOLID',
        `#${roofProfileId},#${roofPlacement3dId},#${roofExtrudeDirId},${fmt(extrudeLen)}`
      )
    }

    const roofShapeRepId = w.next()
    w.add(
      roofShapeRepId,
      'IFCSHAPEREPRESENTATION',
      `#${geomCtx3dId},'Body','SweptSolid',(#${roofSolidId})`
    )

    const roofProdDefShapeId = w.next()
    w.add(roofProdDefShapeId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${roofShapeRepId})`)

    const roofEntityOriginId = w.next()
    w.add(roofEntityOriginId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)},${fmt(0.)})`)
    const roofEntityPlacement3dId = w.next()
    w.add(roofEntityPlacement3dId, 'IFCAXIS2PLACEMENT3D', `#${roofEntityOriginId},$,$`)
    const roofLocalPlacementId = w.next()
    w.add(
      roofLocalPlacementId,
      'IFCLOCALPLACEMENT',
      `#${storeyLocalPlacementId},#${roofEntityPlacement3dId}`
    )

    roofId = w.next()
    w.add(
      roofId,
      'IFCROOF',
      `'roof-sadel',#${ownerHistId},'Sadel tak',$,$,#${roofLocalPlacementId},#${roofProdDefShapeId},$,.GABLE_ROOF.`
    )
  }

  // ── Containment relationships ────────────────────────────────────────────
  const allElements = [...wallEntityIds, ...partitionEntityIds, ...fillerIds, ...fixtureIds, ...spaceIds]
  if (roofId !== null) allElements.push(roofId)
  if (allElements.length > 0) {
    const relContainsId = w.next()
    w.add(
      relContainsId,
      'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      `'rel-storey-elements',#${ownerHistId},$,$,(${allElements.map((id) => `#${id}`).join(',')}),#${storeyId}`
    )
  }

  // ── Assemble the STEP file ───────────────────────────────────────────────
  const now = '2025-01-01T00:00:00'
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
    `FILE_NAME('${model.name}.ifc','${now}',(''),(''),'custom-ifc-generator','','');`,
    `FILE_SCHEMA(('IFC4'));`,
    'ENDSEC;',
    'DATA;',
  ].join('\n')

  const footer = ['ENDSEC;', 'END-ISO-10303-21;'].join('\n')

  return [header, w.serialize(), footer].join('\n')
}
