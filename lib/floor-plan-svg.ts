import type { BuildingModelV2, Opening, Vector2 } from '@/types/building-v2'

// ── Geometry helpers ────────────────────────────────────────────────────────

type EdgeRecord = { id: string; start: Vector2; end: Vector2; thickness: number; height: number }

function allEdges(model: BuildingModelV2): EdgeRecord[] {
  return model.walls.flatMap((loop) =>
    loop.edges.map((edge, i) => ({
      id: edge.id,
      thickness: edge.thickness,
      height: edge.height,
      start: loop.vertices[i],
      end: loop.vertices[(i + 1) % loop.vertices.length],
    }))
  )
}

function wallLength(w: EdgeRecord): number {
  const dx = w.end.x - w.start.x
  const dy = w.end.y - w.start.y
  return Math.sqrt(dx * dx + dy * dy)
}

function wallAngle(w: EdgeRecord): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
}

function pointAlongWall(wall: EdgeRecord, offset: number): Vector2 {
  const len = wallLength(wall)
  const t = offset / len
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  }
}

function perpDir(angle: number): { dx: number; dy: number } {
  return { dx: -Math.sin(angle), dy: Math.cos(angle) }
}

function polygonArea(pts: Vector2[]): number {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y
    area -= pts[j].x * pts[i].y
  }
  return Math.abs(area / 2)
}

// ── SVG generator ────────────────────────────────────────────────────────────

export function generateFloorPlanSVG(model: BuildingModelV2): string {
  const viewBoxW = 600
  const viewBoxH = 400
  const padding = 60

  const edges = allEdges(model)
  const allX = edges.flatMap((e) => [e.start.x, e.end.x])
  const allY = edges.flatMap((e) => [e.start.y, e.end.y])
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minY = Math.min(...allY)
  const maxY = Math.max(...allY)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const drawW = viewBoxW - padding * 2
  const drawH = viewBoxH - padding * 2
  const scale = Math.min(drawW / rangeX, drawH / rangeY)

  const offsetX = padding + (drawW - rangeX * scale) / 2
  const offsetY = padding + (drawH - rangeY * scale) / 2

  function tx(x: number): number {
    return offsetX + (x - minX) * scale
  }
  function ty(y: number): number {
    return offsetY + (maxY - y) * scale
  }

  const nsXs = (model.partitions ?? [])
    .filter((p) => Math.abs(p.start.x - p.end.x) < 1e-4)
    .map((p) => p.start.x)
    .sort((a, b) => a - b)

  const ewYs = (model.partitions ?? [])
    .filter((p) => Math.abs(p.start.y - p.end.y) < 1e-4)
    .map((p) => p.start.y)
    .sort((a, b) => a - b)

  const targetBarWidthPx = 80
  const rawMetres = targetBarWidthPx / scale
  const niceDivisions = [0.5, 1, 2, 5, 10]
  const barMetres =
    niceDivisions.find((d) => d >= rawMetres * 0.5) ?? niceDivisions[niceDivisions.length - 1]
  const barPx = barMetres * scale

  const firstWallThickness = model.walls[0]?.edges[0]?.thickness ?? 0.12
  const wallStrokeW = Math.max(2, firstWallThickness * scale)

  const parts: string[] = []

  // ── SVG root ──────────────────────────────────────────────────────────────
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxW} ${viewBoxH}" width="600" height="400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floor plan">`
  )

  // White background
  parts.push(`<rect x="0" y="0" width="${viewBoxW}" height="${viewBoxH}" fill="white"/>`)

  // ── Walls ─────────────────────────────────────────────────────────────────
  for (const edge of edges) {
    parts.push(
      `<line x1="${tx(edge.start.x)}" y1="${ty(edge.start.y)}" x2="${tx(edge.end.x)}" y2="${ty(edge.end.y)}" stroke="#27272a" stroke-width="${wallStrokeW}" stroke-linecap="square"/>`
    )
  }

  // ── Openings (doors & windows on exterior walls) ──────────────────────────
  for (const opening of model.openings as Opening[]) {
    if (!opening.wallId) continue
    const wall = edges.find((e) => e.id === opening.wallId)
    if (!wall) continue

    const angle = wallAngle(wall)
    const startPt = pointAlongWall(wall, opening.offsetFromStart)
    const endPt = pointAlongWall(wall, opening.offsetFromStart + opening.width)

    const sx1 = tx(startPt.x)
    const sy1 = ty(startPt.y)
    const ex1 = tx(endPt.x)
    const ey1 = ty(endPt.y)

    if (opening.type === 'door') {
      const { dx, dy } = perpDir(angle)
      const swingR = opening.width * scale
      const openEndX = tx(startPt.x + dx * opening.width)
      const openEndY = ty(startPt.y + dy * opening.width)

      // White gap to erase wall
      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${ex1}" y2="${ey1}" stroke="white" stroke-width="${wallStrokeW + 2}"/>`
      )
      // Door panel
      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${openEndX}" y2="${openEndY}" stroke="#3b82f6" stroke-width="1.5"/>`
      )
      // Swing arc
      parts.push(
        `<path d="M ${ex1} ${ey1} A ${swingR} ${swingR} 0 0 0 ${openEndX} ${openEndY}" fill="none" stroke="#3b82f6" stroke-width="1" stroke-dasharray="4 2"/>`
      )
    } else {
      // Window
      const { dx, dy } = perpDir(angle)
      const offset = wallStrokeW / 2 + 1
      // White gap
      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${ex1}" y2="${ey1}" stroke="white" stroke-width="${wallStrokeW + 2}"/>`
      )
      // Window lines
      parts.push(
        `<line x1="${sx1 - dx * offset}" y1="${sy1 + dy * offset}" x2="${ex1 - dx * offset}" y2="${ey1 + dy * offset}" stroke="#f59e0b" stroke-width="1.5"/>`
      )
      parts.push(
        `<line x1="${sx1 + dx * offset}" y1="${sy1 - dy * offset}" x2="${ex1 + dx * offset}" y2="${ey1 - dy * offset}" stroke="#f59e0b" stroke-width="1.5"/>`
      )
    }
  }

  // ── Partition walls ───────────────────────────────────────────────────────
  for (const part of model.partitions ?? []) {
    const partStrokeW = Math.max(2, (part.thickness ?? 0.1) * scale)
    parts.push(
      `<line x1="${tx(part.start.x)}" y1="${ty(part.start.y)}" x2="${tx(part.end.x)}" y2="${ty(part.end.y)}" stroke="#27272a" stroke-width="${partStrokeW}" stroke-linecap="square"/>`
    )
  }

  // ── Partition openings ────────────────────────────────────────────────────
  for (const opening of model.openings as Opening[]) {
    if (!opening.partitionId) continue
    const part = (model.partitions ?? []).find((p) => p.id === opening.partitionId)
    if (!part) continue

    const partEdge: EdgeRecord = {
      id: part.id,
      start: part.start,
      end: part.end,
      thickness: part.thickness ?? 0.1,
      height: part.height ?? (model.walls[0]?.edges[0]?.height ?? 2.4),
    }

    const angle = wallAngle(partEdge)
    const startPt = pointAlongWall(partEdge, opening.offsetFromStart)
    const endPt = pointAlongWall(partEdge, opening.offsetFromStart + opening.width)

    const sx1 = tx(startPt.x)
    const sy1 = ty(startPt.y)
    const ex1 = tx(endPt.x)
    const ey1 = ty(endPt.y)

    const partStrokeW = Math.max(2, (part.thickness ?? 0.1) * scale)

    if (opening.type === 'door') {
      const { dx, dy } = perpDir(angle)
      const swingR = opening.width * scale
      const openEndX = tx(startPt.x + dx * opening.width)
      const openEndY = ty(startPt.y + dy * opening.width)

      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${ex1}" y2="${ey1}" stroke="white" stroke-width="${partStrokeW + 2}"/>`
      )
      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${openEndX}" y2="${openEndY}" stroke="#3b82f6" stroke-width="1.5"/>`
      )
      parts.push(
        `<path d="M ${ex1} ${ey1} A ${swingR} ${swingR} 0 0 0 ${openEndX} ${openEndY}" fill="none" stroke="#3b82f6" stroke-width="1" stroke-dasharray="4 2"/>`
      )
    } else {
      const { dx, dy } = perpDir(angle)
      const offset = partStrokeW / 2 + 1
      parts.push(
        `<line x1="${sx1}" y1="${sy1}" x2="${ex1}" y2="${ey1}" stroke="white" stroke-width="${partStrokeW + 2}"/>`
      )
      parts.push(
        `<line x1="${sx1 - dx * offset}" y1="${sy1 + dy * offset}" x2="${ex1 - dx * offset}" y2="${ey1 + dy * offset}" stroke="#f59e0b" stroke-width="1.5"/>`
      )
      parts.push(
        `<line x1="${sx1 + dx * offset}" y1="${sy1 - dy * offset}" x2="${ex1 + dx * offset}" y2="${ey1 - dy * offset}" stroke="#f59e0b" stroke-width="1.5"/>`
      )
    }
  }

  // ── Dimension annotations ─────────────────────────────────────────────────
  const dimColor = '#9ca3af'
  const textColor = '#6b7280'

  const southXBreaks = [minX, ...nsXs, maxX]
  const southWallY = minY
  const svgSouthY = ty(southWallY)
  const dimSouthY = svgSouthY + 20

  const northXBreaks = [minX, ...nsXs, maxX]
  const northWallY = maxY
  const svgNorthY = ty(northWallY)
  const dimNorthY = svgNorthY - 20

  const eastYBreaks = [minY, ...ewYs, maxY]
  const eastWallX = maxX
  const svgEastX = tx(eastWallX)
  const dimEastX = svgEastX + 20

  const westYBreaks = [minY, ...ewYs, maxY]
  const westWallX = minX
  const svgWestX = tx(westWallX)
  const dimWestX = svgWestX - 20

  // Helper: horizontal dim segments
  function hSegments(
    xBreaks: number[],
    dimY: number,
    wallY: number,
    above: boolean
  ) {
    for (let i = 0; i < xBreaks.length - 1; i++) {
      const xFrom = xBreaks[i]
      const xTo = xBreaks[i + 1]
      const svgX1 = tx(xFrom)
      const svgX2 = tx(xTo)
      const midX = (svgX1 + svgX2) / 2
      const segLen = xTo - xFrom
      const svgWY = ty(wallY)
      const tickExtend = above ? dimY - 3 : dimY + 3
      const textY = above ? dimY - 3 : dimY + 10

      // Tick at x1
      parts.push(
        `<line x1="${svgX1}" y1="${svgWY}" x2="${svgX1}" y2="${tickExtend}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Tick at x2
      parts.push(
        `<line x1="${svgX2}" y1="${svgWY}" x2="${svgX2}" y2="${tickExtend}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Dim line
      parts.push(
        `<line x1="${svgX1}" y1="${dimY}" x2="${svgX2}" y2="${dimY}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Left arrow
      parts.push(
        `<polygon points="${svgX1},${dimY} ${svgX1 + 5},${dimY - 2} ${svgX1 + 5},${dimY + 2}" fill="${dimColor}"/>`
      )
      // Right arrow
      parts.push(
        `<polygon points="${svgX2},${dimY} ${svgX2 - 5},${dimY - 2} ${svgX2 - 5},${dimY + 2}" fill="${dimColor}"/>`
      )
      // Label
      parts.push(
        `<text x="${midX}" y="${textY}" text-anchor="middle" font-size="9" fill="${textColor}" font-family="sans-serif">${segLen.toFixed(2)} m</text>`
      )
    }
  }

  // Helper: vertical dim segments
  function vSegments(
    yBreaks: number[],
    dimX: number,
    wallX: number,
    toRight: boolean
  ) {
    for (let i = 0; i < yBreaks.length - 1; i++) {
      const yFrom = yBreaks[i]
      const yTo = yBreaks[i + 1]
      const svgY1 = ty(yFrom)
      const svgY2 = ty(yTo)
      const midY = (svgY1 + svgY2) / 2
      const segLen = yTo - yFrom
      const svgWX = tx(wallX)
      const tickExtend = toRight ? dimX + 3 : dimX - 3
      const textX = toRight ? dimX + 10 : dimX - 10

      // Tick at y1 (bottom)
      parts.push(
        `<line x1="${svgWX}" y1="${svgY1}" x2="${tickExtend}" y2="${svgY1}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Tick at y2 (top)
      parts.push(
        `<line x1="${svgWX}" y1="${svgY2}" x2="${tickExtend}" y2="${svgY2}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Dim line
      parts.push(
        `<line x1="${dimX}" y1="${svgY1}" x2="${dimX}" y2="${svgY2}" stroke="${dimColor}" stroke-width="0.75"/>`
      )
      // Bottom arrow (pointing up)
      parts.push(
        `<polygon points="${dimX},${svgY1} ${dimX - 2},${svgY1 - 5} ${dimX + 2},${svgY1 - 5}" fill="${dimColor}"/>`
      )
      // Top arrow (pointing down)
      parts.push(
        `<polygon points="${dimX},${svgY2} ${dimX - 2},${svgY2 + 5} ${dimX + 2},${svgY2 + 5}" fill="${dimColor}"/>`
      )
      // Label (rotated -90°)
      parts.push(
        `<text x="${textX}" y="${midY}" text-anchor="middle" font-size="9" fill="${textColor}" font-family="sans-serif" transform="rotate(-90, ${textX}, ${midY})">${segLen.toFixed(2)} m</text>`
      )
    }
  }

  hSegments(southXBreaks, dimSouthY, southWallY, false)
  hSegments(northXBreaks, dimNorthY, northWallY, true)
  vSegments(eastYBreaks, dimEastX, eastWallX, true)
  vSegments(westYBreaks, dimWestX, westWallX, false)

  // ── Room labels ───────────────────────────────────────────────────────────
  for (const room of model.rooms) {
    const pts = room.polygon.filter(
      (_, i, arr) =>
        !(i === arr.length - 1 && arr[i].x === arr[0].x && arr[i].y === arr[0].y)
    )
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const area = polygonArea(pts)
    const roomW = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
    const roomD = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))

    parts.push(
      `<text x="${tx(cx)}" y="${ty(cy) - 12}" text-anchor="middle" font-size="11" fill="#52525b" font-family="sans-serif">${room.name}</text>`
    )
    parts.push(
      `<text x="${tx(cx)}" y="${ty(cy)}" text-anchor="middle" font-size="10" fill="#71717a" font-family="sans-serif">${roomW.toFixed(1)} × ${roomD.toFixed(1)} m</text>`
    )
    parts.push(
      `<text x="${tx(cx)}" y="${ty(cy) + 12}" text-anchor="middle" font-size="10" fill="#71717a" font-family="sans-serif">${area.toFixed(1)} m²</text>`
    )
  }

  // ── Compass rose ──────────────────────────────────────────────────────────
  const cX = viewBoxW - 36
  const cY = 36
  parts.push(`<g transform="translate(${cX}, ${cY})">`)
  parts.push(`<circle cx="0" cy="0" r="26" fill="rgba(255,255,255,0.85)" stroke="#d4d4d8" stroke-width="1"/>`)
  // N needle (red)
  parts.push(`<polygon points="0,-18 -5,-6 0,-10 5,-6" fill="#e05555"/>`)
  // S needle (grey)
  parts.push(`<polygon points="0,18 -5,6 0,10 5,6" fill="#a1a1aa"/>`)
  // Labels
  parts.push(`<text x="0" y="-20" text-anchor="middle" font-size="8" font-weight="bold" fill="#e05555" font-family="sans-serif">N</text>`)
  parts.push(`<text x="0" y="27" text-anchor="middle" font-size="7" fill="#71717a" font-family="sans-serif">S</text>`)
  parts.push(`<text x="23" y="3" text-anchor="middle" font-size="7" fill="#71717a" font-family="sans-serif">E</text>`)
  parts.push(`<text x="-23" y="3" text-anchor="middle" font-size="7" fill="#71717a" font-family="sans-serif">W</text>`)
  parts.push(`</g>`)

  // ── Scale bar ─────────────────────────────────────────────────────────────
  parts.push(`<g transform="translate(${padding}, ${viewBoxH - 24})">`)
  parts.push(`<line x1="0" y1="0" x2="${barPx}" y2="0" stroke="#52525b" stroke-width="2"/>`)
  parts.push(`<line x1="0" y1="-4" x2="0" y2="4" stroke="#52525b" stroke-width="2"/>`)
  parts.push(`<line x1="${barPx}" y1="-4" x2="${barPx}" y2="4" stroke="#52525b" stroke-width="2"/>`)
  parts.push(
    `<text x="${barPx / 2}" y="-8" text-anchor="middle" font-size="10" fill="#52525b" font-family="sans-serif">${barMetres} m</text>`
  )
  parts.push(`</g>`)

  parts.push(`</svg>`)

  return parts.join('\n')
}
