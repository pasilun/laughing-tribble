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
      const edgeOpenings = model.openings.filter(o => o.wallId === edge.id)
      for (const opening of edgeOpenings) {
        // Wall edge direction vector (for placing opening along wall)
        const vStart = loop.vertices[edgeIdx]
        const vEnd = loop.vertices[(edgeIdx + 1) % loop.vertices.length]
        const dx = vEnd.x - vStart.x, dy = vEnd.y - vStart.y
        const len = Math.sqrt(dx * dx + dy * dy)
        const dirX = dx / len, dirY = dy / len

        // Opening origin in world space: walk along edge from start by offsetFromStart, up by sillHeight
        const sillH = opening.sillHeight ?? (opening.type === 'door' ? 0 : 0.9)
        const ox = vStart.x + dirX * opening.offsetFromStart
        const oy = vStart.y + dirY * opening.offsetFromStart

        const openOriginId = w.next()
        w.add(openOriginId, 'IFCCARTESIANPOINT', `(${fmt(ox)},${fmt(oy)},${fmt(sillH)})`)

        // Opening X axis = wall direction, Z axis = up
        const openXId = w.next()
        w.add(openXId, 'IFCDIRECTION', `(${fmt(dirX)},${fmt(dirY)},${fmt(0.)})`)
        const openAxis3dId = w.next()
        w.add(openAxis3dId, 'IFCAXIS2PLACEMENT3D', `#${openOriginId},#${zUpId},#${openXId}`)
        const openLocalPlacementId = w.next()
        w.add(openLocalPlacementId, 'IFCLOCALPLACEMENT', `#${storeyLocalPlacementId},#${openAxis3dId}`)

        // Opening void: width along wall (local X), height up (local Z), depth through wall (local Y)
        // Profile in local XY: width × depth (wall thickness + tolerance)
        const openPtId = w.next()
        w.add(openPtId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(-(edge.thickness / 2 + 0.05))})`)
        const openProfilePlacementId = w.next()
        w.add(openProfilePlacementId, 'IFCAXIS2PLACEMENT2D', `#${openPtId},$`)
        const openProfileId = w.next()
        w.add(openProfileId, 'IFCRECTANGLEPROFILEDEF',
          `.AREA.,$,#${openProfilePlacementId},${fmt(opening.width)},${fmt(edge.thickness + 0.1)}`)
        const openExtDirId = w.next()
        w.add(openExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)
        const openSolidId = w.next()
        w.add(openSolidId, 'IFCEXTRUDEDAREASOLID',
          `#${openProfileId},#${openAxis3dId},#${openExtDirId},${fmt(opening.height)}`)

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
          const doorId = w.next()
          w.add(doorId, 'IFCDOOR',
            `'${opening.id}-door',#${ownerHistId},'Door',$,$,#${openLocalPlacementId},$,${fmt(opening.height)},${fmt(opening.width)}`)
          const relFillId = w.next()
          w.add(relFillId, 'IFCRELFILLSELEMENT',
            `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${doorId}`)
        } else {
          const windowId = w.next()
          w.add(windowId, 'IFCWINDOW',
            `'${opening.id}-window',#${ownerHistId},'Window',$,$,#${openLocalPlacementId},$,${fmt(opening.height)},${fmt(opening.width)}`)
          const relFillId = w.next()
          w.add(relFillId, 'IFCRELFILLSELEMENT',
            `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${windowId}`)
        }
      }
    }
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
    const wallH = model.walls[0]?.edges[0]?.height ?? 2.4
    const vertices = model.walls[0]?.vertices ?? []
    const xs = vertices.map(v => v.x)
    const ys = vertices.map(v => v.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const buildingWidth = maxY - minY
    const buildingLength = maxX - minX
    const halfSpan = buildingWidth / 2
    const extrudeLen = buildingLength + 2 * overhang
    const pitchRad = (pitch * Math.PI) / 180
    const roofThickness = 0.15
    const eaveH = wallH + roofThickness
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

    const roofSolidId = w.next()
    w.add(
      roofSolidId,
      'IFCEXTRUDEDAREASOLID',
      `#${roofProfileId},#${roofPlacement3dId},#${roofExtrudeDirId},${fmt(extrudeLen)}`
    )

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
  const allElements = [...wallEntityIds, ...spaceIds]
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
