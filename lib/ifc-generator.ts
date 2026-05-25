import { BuildingModelV2, Wall, Opening } from '@/types/building-v2'

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

function wallLength(w: Wall): number {
  const dx = w.end.x - w.start.x
  const dy = w.end.y - w.start.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Angle of wall in XY plane, radians, measured from +X axis */
function wallAngle(w: Wall): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
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

  for (const wall of model.walls) {
    const len = wallLength(wall)
    const angle = wallAngle(wall)
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    // Wall placement: origin at wall start, X-axis along wall direction
    const wallOriginId = w.next()
    w.add(
      wallOriginId,
      'IFCCARTESIANPOINT',
      `(${fmt(wall.start.x)},${fmt(wall.start.y)},${fmt(0.)})`
    )

    const wallXDirId = w.next()
    w.add(wallXDirId, 'IFCDIRECTION', `(${fmt(cosA)},${fmt(sinA)},${fmt(0.)})`)

    const wallZDirId = w.next()
    w.add(wallZDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)

    const wallAxis2p3dId = w.next()
    w.add(
      wallAxis2p3dId,
      'IFCAXIS2PLACEMENT3D',
      `#${wallOriginId},#${wallZDirId},#${wallXDirId}`
    )

    const wallLocalPlacementId = w.next()
    w.add(
      wallLocalPlacementId,
      'IFCLOCALPLACEMENT',
      `#${storeyLocalPlacementId},#${wallAxis2p3dId}`
    )

    // Profile: wall footprint rectangle in local XY plane (X=along wall, Y=perpendicular)
    // Centered along the wall at (len/2, 0)
    const profilePtId = w.next()
    w.add(profilePtId, 'IFCCARTESIANPOINT', `(${fmt(len / 2)},${fmt(0.)})`)

    const profilePlacementId = w.next()
    w.add(profilePlacementId, 'IFCAXIS2PLACEMENT2D', `#${profilePtId},$`)

    const profileId = w.next()
    w.add(
      profileId,
      'IFCRECTANGLEPROFILEDEF',
      `.AREA.,$,#${profilePlacementId},${fmt(len)},${fmt(wall.thickness)}`
    )

    // Extrude upward along local Z axis
    const extrudeDirId = w.next()
    w.add(extrudeDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(0.)},${fmt(1.)})`)

    const solidId = w.next()
    w.add(
      solidId,
      'IFCEXTRUDEDAREASOLID',
      `#${profileId},#${wallAxis2p3dId},#${extrudeDirId},${fmt(wall.height)}`
    )

    // Shape representation
    const shapeRepId = w.next()
    w.add(
      shapeRepId,
      'IFCSHAPEREPRESENTATION',
      `#${geomCtx3dId},'Body','SweptSolid',(#${solidId})`
    )

    const prodDefShapeId = w.next()
    w.add(prodDefShapeId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${shapeRepId})`)

    const wallEntityId = w.next()
    w.add(
      wallEntityId,
      'IFCWALLSTANDARDCASE',
      `'${wall.id}',#${ownerHistId},'Wall',$,$,#${wallLocalPlacementId},#${prodDefShapeId},$`
    )

    wallEntityIds.push(wallEntityId)

    // Add openings for this wall
    const wallOpenings = model.openings.filter((o: Opening) => o.wallId === wall.id)
    for (const opening of wallOpenings) {
      // Opening placement: positioned along the wall at offsetFromStart
      const openOriginId = w.next()
      // Opening is offset along wall X axis, sill height up Z axis
      const sillH = opening.sillHeight ?? (opening.type === 'door' ? 0 : 0.9)
      w.add(
        openOriginId,
        'IFCCARTESIANPOINT',
        `(${fmt(opening.offsetFromStart)},${fmt(0.)},${fmt(sillH)})`
      )

      const openAxis2p3dId = w.next()
      w.add(openAxis2p3dId, 'IFCAXIS2PLACEMENT3D', `#${openOriginId},$,$`)

      const openLocalPlacementId = w.next()
      w.add(
        openLocalPlacementId,
        'IFCLOCALPLACEMENT',
        `#${wallLocalPlacementId},#${openAxis2p3dId}`
      )

      // Opening shape
      const openPtId = w.next()
      w.add(openPtId, 'IFCCARTESIANPOINT', `(${fmt(0.)},${fmt(0.)})`)

      const openProfilePlacementId = w.next()
      w.add(openProfilePlacementId, 'IFCAXIS2PLACEMENT2D', `#${openPtId},$`)

      const openProfileId = w.next()
      w.add(
        openProfileId,
        'IFCRECTANGLEPROFILEDEF',
        `.AREA.,$,#${openProfilePlacementId},${fmt(opening.width)},${fmt(opening.height)}`
      )

      const openExtDirId = w.next()
      w.add(openExtDirId, 'IFCDIRECTION', `(${fmt(0.)},${fmt(1.)},${fmt(0.)})`)

      const openSolidId = w.next()
      w.add(
        openSolidId,
        'IFCEXTRUDEDAREASOLID',
        `#${openProfileId},#${openAxis2p3dId},#${openExtDirId},${fmt(wall.thickness + 0.1)}`
      )

      const openShapeRepId = w.next()
      w.add(
        openShapeRepId,
        'IFCSHAPEREPRESENTATION',
        `#${geomCtx3dId},'Body','SweptSolid',(#${openSolidId})`
      )

      const openProdDefId = w.next()
      w.add(openProdDefId, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${openShapeRepId})`)

      const openingElementId = w.next()
      w.add(
        openingElementId,
        'IFCOPENINGELEMENT',
        `'${opening.id}',#${ownerHistId},'${opening.type === 'door' ? 'Door' : 'Window'} Opening',$,$,#${openLocalPlacementId},#${openProdDefId},$`
      )

      // Void relationship
      const relVoidId = w.next()
      w.add(
        relVoidId,
        'IFCRELVOIDSELEMENT',
        `'rel-void-${opening.id}',#${ownerHistId},$,$,#${wallEntityId},#${openingElementId}`
      )

      // Door or window element filling the opening
      if (opening.type === 'door') {
        const doorId = w.next()
        w.add(
          doorId,
          'IFCDOOR',
          `'${opening.id}-door',#${ownerHistId},'Door',$,$,#${openLocalPlacementId},$,${fmt(opening.height)},${fmt(opening.width)}`
        )

        const relFillId = w.next()
        w.add(
          relFillId,
          'IFCRELFILLSELEMENT',
          `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${doorId}`
        )
      } else {
        const windowId = w.next()
        w.add(
          windowId,
          'IFCWINDOW',
          `'${opening.id}-window',#${ownerHistId},'Window',$,$,#${openLocalPlacementId},$,${fmt(opening.height)},${fmt(opening.width)}`
        )

        const relFillId = w.next()
        w.add(
          relFillId,
          'IFCRELFILLSELEMENT',
          `'rel-fill-${opening.id}',#${ownerHistId},$,$,#${openingElementId},#${windowId}`
        )
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
    const wallH = model.walls[0].height
    const halfSpan = 1.5 // 3m / 2
    const pitchRad = (pitch * Math.PI) / 180
    const ridgeH = wallH + halfSpan * Math.tan(pitchRad)
    const eaveH = wallH - overhang * Math.tan(pitchRad)
    const roofThickness = 0.15
    const extrudeLen = 4 + 2 * overhang

    // Profile placement: origin at (-overhang, 0, 0), axis=east(X), refDir=north(Y)
    const roofOriginId = w.next()
    w.add(roofOriginId, 'IFCCARTESIANPOINT', `(${fmt(-overhang)},${fmt(0.)},${fmt(0.)})`)

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

    // C = (3+overhang, eaveH)
    const ptCId = w.next()
    w.add(ptCId, 'IFCCARTESIANPOINT', `(${fmt(3 + overhang)},${fmt(eaveH)})`)

    // D = (3+overhang, eaveH-0.15)
    const ptDId = w.next()
    w.add(ptDId, 'IFCCARTESIANPOINT', `(${fmt(3 + overhang)},${fmt(eaveH - roofThickness)})`)

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

    const roofLocalPlacementId = w.next()
    w.add(
      roofLocalPlacementId,
      'IFCLOCALPLACEMENT',
      `#${storeyLocalPlacementId},#${roofPlacement3dId}`
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
  const now = new Date().toISOString().replace(/\.\d+Z$/, '')
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
