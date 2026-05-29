'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { BuildingModelV2, Opening, Vector2, Fixture } from '@/types/building-v2'
import { generateIFC } from '@/lib/ifc-generator'

const GLTFViewer = dynamic(() => import('@/components/GLTFViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-400 text-sm">
      Laddar 3D-visare…
    </div>
  ),
})

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

/** Point along wall at offset metres from start */
function pointAlongWall(wall: EdgeRecord, offset: number): Vector2 {
  const len = wallLength(wall)
  const t = offset / len
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  }
}

/** Perpendicular direction (90° CCW) */
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

// ── SVG Floor Plan ──────────────────────────────────────────────────────────

interface FloorPlanProps {
  model: BuildingModelV2
}

function FloorPlanV2({ model }: FloorPlanProps) {
  const viewBoxW = 600
  const padding = 60

  const annotations = model.annotations ?? []
  const annCount = annotations.length
  const viewBoxH = 400 + Math.ceil(annCount / 2) * 22 + (annCount > 0 ? 28 : 0)

  const edges = allEdges(model)
  // Compute bounding box of all wall endpoints
  const allX = edges.flatMap((e) => [e.start.x, e.end.x])
  const allY = edges.flatMap((e) => [e.start.y, e.end.y])
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minY = Math.min(...allY)
  const maxY = Math.max(...allY)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const drawW = viewBoxW - padding * 2
  const drawH = 400 - padding * 2
  const scale = Math.min(drawW / rangeX, drawH / rangeY)

  // Offset to centre the building in the drawing area
  const offsetX = padding + (drawW - rangeX * scale) / 2
  const offsetY = padding + (drawH - rangeY * scale) / 2

  // SVG Y is inverted (down = positive), so flip Y axis
  function tx(x: number): number {
    return offsetX + (x - minX) * scale
  }
  function ty(y: number): number {
    return offsetY + (maxY - y) * scale
  }

  // ── Dimension annotation helpers ────────────────────────────────────────
  // NS partitions (vertical walls): x is constant → split south/north walls
  const nsXs = (model.partitions ?? [])
    .filter((p) => Math.abs(p.start.x - p.end.x) < 1e-4)
    .map((p) => p.start.x)
    .sort((a, b) => a - b)

  // EW partitions (horizontal walls): y is constant → split east/west walls
  const ewYs = (model.partitions ?? [])
    .filter((p) => Math.abs(p.start.y - p.end.y) < 1e-4)
    .map((p) => p.start.y)
    .sort((a, b) => a - b)

  // Scale bar: pick a nice metre value
  const targetBarWidthPx = 80
  const rawMetres = targetBarWidthPx / scale
  const niceDivisions = [0.5, 1, 2, 5, 10]
  const barMetres =
    niceDivisions.find((d) => d >= rawMetres * 0.5) ?? niceDivisions[niceDivisions.length - 1]
  const barPx = barMetres * scale

  const firstWallThickness = model.walls[0]?.edges[0]?.thickness ?? 0.12
  const wallStrokeW = Math.max(2, firstWallThickness * scale)

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      width="100%"
      height={viewBoxH}
      className="w-full max-w-full h-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Floor plan"
    >
      {/* ── Walls ────────────────────────────────────────────────────────── */}
      {edges.map((edge) => (
        <line
          key={edge.id}
          x1={tx(edge.start.x)}
          y1={ty(edge.start.y)}
          x2={tx(edge.end.x)}
          y2={ty(edge.end.y)}
          stroke="#27272a"
          strokeWidth={wallStrokeW}
          strokeLinecap="square"
        />
      ))}

      {/* ── Openings (doors & windows) ───────────────────────────────────── */}
      {model.openings.map((opening: Opening) => {
        if (!opening.wallId) return null
        const wall = edges.find((e) => e.id === opening.wallId)
        if (!wall) return null

        const angle = wallAngle(wall)
        const startPt = pointAlongWall(wall, opening.offsetFromStart)
        const endPt = pointAlongWall(wall, opening.offsetFromStart + opening.width)

        const sx1 = tx(startPt.x)
        const sy1 = ty(startPt.y)
        const ex1 = tx(endPt.x)
        const ey1 = ty(endPt.y)

        if (opening.type === 'door') {
          // Door: gap in wall + door swing arc
          const hinge = opening.hinge ?? 'start'
          const swingDir = opening.swing ?? 'ccw'

          // hingePoint is where the hinge is; latchPoint is the other end
          const hingePoint = hinge === 'start' ? startPt : endPt
          const latchPoint = hinge === 'start' ? endPt : startPt

          const { dx, dy } = perpDir(angle)
          const sign = swingDir === 'ccw' ? 1 : -1
          const swingR = opening.width * scale

          // open position of the latch end (door panel swings from hingePoint)
          const openEndX = tx(hingePoint.x + dx * sign * opening.width)
          const openEndY = ty(hingePoint.y + dy * sign * opening.width)

          const hx = tx(hingePoint.x), hy = ty(hingePoint.y)
          const lx = tx(latchPoint.x), ly = ty(latchPoint.y)

          return (
            <g key={opening.id}>
              {/* White gap to erase wall */}
              <line
                x1={sx1}
                y1={sy1}
                x2={ex1}
                y2={ey1}
                stroke="white"
                strokeWidth={wallStrokeW + 2}
                className="dark:stroke-zinc-900"
              />
              {/* Door panel: hinge → open position */}
              <line
                x1={hx}
                y1={hy}
                x2={openEndX}
                y2={openEndY}
                stroke="#3b82f6"
                strokeWidth={1.5}
              />
              {/* Swing arc: latch end sweeps to door-open position */}
              <path
                d={`M ${lx} ${ly} A ${swingR} ${swingR} 0 0 ${swingDir === 'cw' ? 1 : 0} ${openEndX} ${openEndY}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
            </g>
          )
        } else {
          // Window: thin double line
          const { dx, dy } = perpDir(angle)
          const offset = (wallStrokeW / 2 + 1)
          return (
            <g key={opening.id}>
              {/* White gap */}
              <line
                x1={sx1}
                y1={sy1}
                x2={ex1}
                y2={ey1}
                stroke="white"
                strokeWidth={wallStrokeW + 2}
                className="dark:stroke-zinc-900"
              />
              {/* Window lines */}
              <line
                x1={sx1 - dx * offset}
                y1={sy1 + dy * offset}
                x2={ex1 - dx * offset}
                y2={ey1 + dy * offset}
                stroke="#f59e0b"
                strokeWidth={1.5}
              />
              <line
                x1={sx1 + dx * offset}
                y1={sy1 - dy * offset}
                x2={ex1 + dx * offset}
                y2={ey1 - dy * offset}
                stroke="#f59e0b"
                strokeWidth={1.5}
              />
            </g>
          )
        }
      })}

      {/* ── Partition walls ──────────────────────────────────────────────────── */}
      {(model.partitions ?? []).map((part) => (
        <line
          key={part.id}
          x1={tx(part.start.x)}
          y1={ty(part.start.y)}
          x2={tx(part.end.x)}
          y2={ty(part.end.y)}
          stroke="#27272a"
          strokeWidth={Math.max(2, (part.thickness ?? 0.1) * scale)}
          strokeLinecap="square"
        />
      ))}

      {/* ── Partition openings (doors & windows in interior walls) ───────────── */}
      {model.openings.map((opening: Opening) => {
        if (!opening.partitionId) return null
        const part = (model.partitions ?? []).find((p) => p.id === opening.partitionId)
        if (!part) return null

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
          const hinge = opening.hinge ?? 'start'
          const swingDir = opening.swing ?? 'ccw'

          const hingePoint = hinge === 'start' ? startPt : endPt
          const latchPoint = hinge === 'start' ? endPt : startPt

          const { dx, dy } = perpDir(angle)
          const sign = swingDir === 'ccw' ? 1 : -1
          const swingR = opening.width * scale

          const openEndX = tx(hingePoint.x + dx * sign * opening.width)
          const openEndY = ty(hingePoint.y + dy * sign * opening.width)

          const hx = tx(hingePoint.x), hy = ty(hingePoint.y)
          const lx = tx(latchPoint.x), ly = ty(latchPoint.y)

          return (
            <g key={opening.id}>
              {/* White gap to erase partition line */}
              <line
                x1={sx1}
                y1={sy1}
                x2={ex1}
                y2={ey1}
                stroke="white"
                strokeWidth={partStrokeW + 2}
                className="dark:stroke-zinc-900"
              />
              {/* Door panel: hinge → open position */}
              <line
                x1={hx}
                y1={hy}
                x2={openEndX}
                y2={openEndY}
                stroke="#3b82f6"
                strokeWidth={1.5}
              />
              {/* Swing arc */}
              <path
                d={`M ${lx} ${ly} A ${swingR} ${swingR} 0 0 ${swingDir === 'cw' ? 1 : 0} ${openEndX} ${openEndY}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
            </g>
          )
        } else {
          const { dx, dy } = perpDir(angle)
          const offset = (partStrokeW / 2 + 1)
          return (
            <g key={opening.id}>
              {/* White gap */}
              <line
                x1={sx1}
                y1={sy1}
                x2={ex1}
                y2={ey1}
                stroke="white"
                strokeWidth={partStrokeW + 2}
                className="dark:stroke-zinc-900"
              />
              {/* Window lines */}
              <line
                x1={sx1 - dx * offset}
                y1={sy1 + dy * offset}
                x2={ex1 - dx * offset}
                y2={ey1 + dy * offset}
                stroke="#f59e0b"
                strokeWidth={1.5}
              />
              <line
                x1={sx1 + dx * offset}
                y1={sy1 - dy * offset}
                x2={ex1 + dx * offset}
                y2={ey1 - dy * offset}
                stroke="#f59e0b"
                strokeWidth={1.5}
              />
            </g>
          )
        }
      })}

      {/* ── Fixtures ─────────────────────────────────────────────────────── */}
      {(() => {
        const sortedFixtures = [...((model.fixtures ?? []) as Fixture[])].sort(
          (a, b) => a.y - b.y
        )
        let prevLabelBottom = -Infinity
        const fixtureElems: React.ReactNode[] = []

        for (const fixture of sortedFixtures) {
          const svgX = tx(fixture.x)
          const svgY = ty(fixture.y + fixture.depth)
          const svgW = fixture.width * scale
          const svgH = fixture.depth * scale
          const cxSvg = tx(fixture.x + fixture.width / 2)
          const cySvg = ty(fixture.y + fixture.depth / 2)
          const rot = fixture.rotation ?? 0
          const rawLabel = fixture.label ?? fixture.type.replace('_', ' ')
          const label = rawLabel.length > 14 ? rawLabel.slice(0, 13) + '…' : rawLabel

          const fontSize = 8
          const approxLabelH = fontSize + 4
          let labelY = cySvg
          if (labelY - approxLabelH / 2 < prevLabelBottom + 12) {
            labelY = prevLabelBottom + 12 + approxLabelH / 2
          }
          prevLabelBottom = labelY + approxLabelH / 2

          const approxLabelW = label.length * fontSize * 0.6
          const bgX = cxSvg - approxLabelW / 2 - 2
          const bgY = labelY - fontSize - 1
          const bgW = approxLabelW + 4
          const bgH = fontSize + 4

          fixtureElems.push(
            <g key={fixture.id} transform={rot !== 0 ? `rotate(${rot}, ${cxSvg}, ${cySvg})` : undefined}>
              <rect x={svgX} y={svgY} width={svgW} height={svgH} fill="none" stroke="#a78bfa" strokeWidth={1.5} rx={2} />
              {(fixture.type === 'bench' || fixture.type === 'sauna_heater') && (
                <>
                  <line x1={svgX} y1={svgY} x2={svgX + svgW} y2={svgY + svgH} stroke="#a78bfa" strokeWidth={0.75} />
                  <line x1={svgX} y1={svgY + svgH} x2={svgX + svgW} y2={svgY} stroke="#a78bfa" strokeWidth={0.75} />
                </>
              )}
              <rect x={bgX} y={bgY} width={bgW} height={bgH} fill="rgba(0,0,0,0.55)" stroke="none" rx={2} />
              <text x={cxSvg} y={labelY} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fill="#7c3aed" fontFamily="sans-serif">
                {label}
              </text>
            </g>
          )
        }
        return <>{fixtureElems}</>
      })()}

      {/* ── Annotations → numbered markers in plan ───────────────────────── */}
      {annotations.map((ann, i) => {
        const cx = tx(ann.x)
        const cy = ty(ann.y)
        return (
          <g key={`ann-${i}`}>
            <circle cx={cx} cy={cy} r={7} fill="#f59e0b" opacity={0.9} />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight="bold" fill="white" fontFamily="sans-serif">
              {i + 1}
            </text>
          </g>
        )
      })}

      {/* ── Dimension annotations ── */}
      {(() => {
        const dimColor = '#9ca3af'
        const textColor = '#6b7280'

        // South wall (bottom): dim line below, split by NS partitions
        const southXBreaks = [minX, ...nsXs, maxX]
        const southWallY = minY
        const svgSouthY = ty(southWallY)
        const dimSouthY = svgSouthY + 20

        // North wall (top): dim line above, split by NS partitions
        const northXBreaks = [minX, ...nsXs, maxX]
        const northWallY = maxY
        const svgNorthY = ty(northWallY)
        const dimNorthY = svgNorthY - 20

        // East wall (right): dim line to right, split by EW partitions
        const eastYBreaks = [minY, ...ewYs, maxY]
        const eastWallX = maxX
        const svgEastX = tx(eastWallX)
        const dimEastX = svgEastX + 20

        // West wall (left): dim line to left, split by EW partitions
        const westYBreaks = [minY, ...ewYs, maxY]
        const westWallX = minX
        const svgWestX = tx(westWallX)
        const dimWestX = svgWestX - 20

        const elements: React.ReactNode[] = []

        // Helper: horizontal dim segments (south or north)
        function hSegments(
          xBreaks: number[],
          dimY: number,
          wallY: number,
          above: boolean,
          keyPrefix: string
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

            elements.push(
              <g key={`${keyPrefix}-seg-${i}`}>
                {/* Tick at x1 */}
                <line x1={svgX1} y1={svgWY} x2={svgX1} y2={tickExtend} stroke={dimColor} strokeWidth={0.75} />
                {/* Tick at x2 */}
                <line x1={svgX2} y1={svgWY} x2={svgX2} y2={tickExtend} stroke={dimColor} strokeWidth={0.75} />
                {/* Dim line */}
                <line x1={svgX1} y1={dimY} x2={svgX2} y2={dimY} stroke={dimColor} strokeWidth={0.75} />
                {/* Left arrow (pointing right) */}
                <polygon
                  points={`${svgX1},${dimY} ${svgX1 + 5},${dimY - 2} ${svgX1 + 5},${dimY + 2}`}
                  fill={dimColor}
                />
                {/* Right arrow (pointing left) */}
                <polygon
                  points={`${svgX2},${dimY} ${svgX2 - 5},${dimY - 2} ${svgX2 - 5},${dimY + 2}`}
                  fill={dimColor}
                />
                {/* Label */}
                <text
                  x={midX}
                  y={textY}
                  textAnchor="middle"
                  fontSize={9}
                  fill={textColor}
                  fontFamily="sans-serif"
                >
                  {segLen.toFixed(2)} m
                </text>
              </g>
            )
          }
        }

        // Helper: vertical dim segments (east or west)
        function vSegments(
          yBreaks: number[],
          dimX: number,
          wallX: number,
          toRight: boolean,
          keyPrefix: string
        ) {
          for (let i = 0; i < yBreaks.length - 1; i++) {
            const yFrom = yBreaks[i]
            const yTo = yBreaks[i + 1]
            const svgY1 = ty(yFrom)   // bottom in SVG (larger y value)
            const svgY2 = ty(yTo)     // top in SVG (smaller y value)
            const midY = (svgY1 + svgY2) / 2
            const segLen = yTo - yFrom
            const svgWX = tx(wallX)
            const tickExtend = toRight ? dimX + 3 : dimX - 3
            const textX = toRight ? dimX + 10 : dimX - 10

            elements.push(
              <g key={`${keyPrefix}-seg-${i}`}>
                {/* Tick at y1 (bottom) */}
                <line x1={svgWX} y1={svgY1} x2={tickExtend} y2={svgY1} stroke={dimColor} strokeWidth={0.75} />
                {/* Tick at y2 (top) */}
                <line x1={svgWX} y1={svgY2} x2={tickExtend} y2={svgY2} stroke={dimColor} strokeWidth={0.75} />
                {/* Dim line */}
                <line x1={dimX} y1={svgY1} x2={dimX} y2={svgY2} stroke={dimColor} strokeWidth={0.75} />
                {/* Bottom arrow (pointing up) */}
                <polygon
                  points={`${dimX},${svgY1} ${dimX - 2},${svgY1 - 5} ${dimX + 2},${svgY1 - 5}`}
                  fill={dimColor}
                />
                {/* Top arrow (pointing down) */}
                <polygon
                  points={`${dimX},${svgY2} ${dimX - 2},${svgY2 + 5} ${dimX + 2},${svgY2 + 5}`}
                  fill={dimColor}
                />
                {/* Label (rotated -90°) */}
                <text
                  x={textX}
                  y={midY}
                  textAnchor="middle"
                  fontSize={9}
                  fill={textColor}
                  fontFamily="sans-serif"
                  transform={`rotate(-90, ${textX}, ${midY})`}
                >
                  {segLen.toFixed(2)} m
                </text>
              </g>
            )
          }
        }

        hSegments(southXBreaks, dimSouthY, southWallY, false, 'south')
        hSegments(northXBreaks, dimNorthY, northWallY, true, 'north')
        vSegments(eastYBreaks, dimEastX, eastWallX, true, 'east')
        vSegments(westYBreaks, dimWestX, westWallX, false, 'west')

        return <>{elements}</>
      })()}

      {/* ── Room labels ──────────────────────────────────────────────────── */}
      {model.rooms.map((room) => {
        // Centroid of polygon
        const pts = room.polygon.filter(
          (_, i, arr) =>
            !(i === arr.length - 1 && arr[i].x === arr[0].x && arr[i].y === arr[0].y)
        )
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        const area = polygonArea(pts)
        const roomW = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
        const roomD = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))

        const nameX = tx(cx)
        const nameY = ty(cy) - 12
        const dimX = tx(cx)
        const dimY = ty(cy)
        const areaX = tx(cx)
        const areaY = ty(cy) + 12

        const nameText = room.name
        const dimText = `${roomW.toFixed(1)} × ${roomD.toFixed(1)} m`
        const areaText = `${area.toFixed(1)} m²`

        const nameFontSize = 11
        const dimFontSize = 10
        const areaFontSize = 10

        const nameApproxW = nameText.length * nameFontSize * 0.6
        const dimApproxW = dimText.length * dimFontSize * 0.6
        const areaApproxW = areaText.length * areaFontSize * 0.6

        return (
          <g key={room.id}>
            <rect
              x={nameX - nameApproxW / 2 - 2}
              y={nameY - nameFontSize - 1}
              width={nameApproxW + 4}
              height={nameFontSize + 4}
              fill="rgba(0,0,0,0.55)"
              stroke="none"
              rx={2}
            />
            <text x={nameX} y={nameY} textAnchor="middle" fontSize={nameFontSize} fill="#52525b" fontFamily="sans-serif">
              {nameText}
            </text>
            <rect
              x={dimX - dimApproxW / 2 - 2}
              y={dimY - dimFontSize - 1}
              width={dimApproxW + 4}
              height={dimFontSize + 4}
              fill="rgba(0,0,0,0.55)"
              stroke="none"
              rx={2}
            />
            <text x={dimX} y={dimY} textAnchor="middle" fontSize={dimFontSize} fill="#71717a" fontFamily="sans-serif">
              {dimText}
            </text>
            <rect
              x={areaX - areaApproxW / 2 - 2}
              y={areaY - areaFontSize - 1}
              width={areaApproxW + 4}
              height={areaFontSize + 4}
              fill="rgba(0,0,0,0.55)"
              stroke="none"
              rx={2}
            />
            <text x={areaX} y={areaY} textAnchor="middle" fontSize={areaFontSize} fill="#71717a" fontFamily="sans-serif">
              {areaText}
            </text>
          </g>
        )
      })}

      {/* ── Compass rose ─────────────────────────────────────────────────── */}
      <g transform={`translate(${viewBoxW - 36}, 36)`}>
        <circle cx={0} cy={0} r={26} fill="rgba(255,255,255,0.85)" stroke="#d4d4d8" strokeWidth={1}/>
        {/* N needle (red) */}
        <polygon points="0,-18 -5,-6 0,-10 5,-6" fill="#e05555"/>
        {/* S needle (grey) */}
        <polygon points="0,18 -5,6 0,10 5,6" fill="#a1a1aa"/>
        {/* Labels */}
        <text x={0} y={-20} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#e05555" fontFamily="sans-serif">N</text>
        <text x={0} y={27}  textAnchor="middle" fontSize={7} fill="#71717a" fontFamily="sans-serif">S</text>
        <text x={23} y={3}  textAnchor="middle" fontSize={7} fill="#71717a" fontFamily="sans-serif">E</text>
        <text x={-23} y={3} textAnchor="middle" fontSize={7} fill="#71717a" fontFamily="sans-serif">W</text>
      </g>

      {/* ── Scale bar ────────────────────────────────────────────────────── */}
      <g transform={`translate(${padding}, ${400 - 24})`}>
        <line x1={0} y1={0} x2={barPx} y2={0} stroke="#52525b" strokeWidth={2} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke="#52525b" strokeWidth={2} />
        <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="#52525b" strokeWidth={2} />
        {(() => {
          const scaleBarText = `${barMetres} m`
          const sbFontSize = 10
          const sbApproxW = scaleBarText.length * sbFontSize * 0.6
          return (
            <>
              <rect
                x={barPx / 2 - sbApproxW / 2 - 2}
                y={-8 - sbFontSize - 1}
                width={sbApproxW + 4}
                height={sbFontSize + 4}
                fill="rgba(0,0,0,0.55)"
                stroke="none"
                rx={2}
              />
              <text x={barPx / 2} y={-8} textAnchor="middle" fontSize={sbFontSize} fill="#52525b" fontFamily="sans-serif">
                {scaleBarText}
              </text>
            </>
          )
        })()}
      </g>

      {/* ── Annotation footer ─────────────────────────────────────────────── */}
      {annCount > 0 && (() => {
        const footerElems: React.ReactNode[] = []
        footerElems.push(
          <line
            key="footer-rule"
            x1={padding}
            y1={404}
            x2={viewBoxW - padding}
            y2={404}
            stroke="#52525b"
            strokeWidth={0.5}
            strokeDasharray="4 2"
          />
        )

        const leftColX = padding + 4
        const rightColX = viewBoxW / 2 + 4
        let rowY = 416

        for (let i = 0; i < annotations.length; i++) {
          const ann = annotations[i]
          const isRight = i % 2 === 1
          const colX = isRight ? rightColX : leftColX
          if (!isRight && i > 0) rowY += 22

          const text = ann.text
          const lastSpaceBefore55 = text.lastIndexOf(' ', 55)
          const breakAt = lastSpaceBefore55 > 0 ? lastSpaceBefore55 : 55
          const needsWrap = text.length > 55
          const line1 = needsWrap ? text.slice(0, breakAt) : text
          const line2 = needsWrap ? text.slice(breakAt + 1) : null

          footerElems.push(
            <g key={`footer-ann-${i}`}>
              <circle cx={colX + 6} cy={rowY - 2} r={6} fill="#f59e0b" opacity={0.9} />
              <text x={colX + 6} y={rowY - 2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fontWeight="bold" fill="white" fontFamily="sans-serif">
                {i + 1}
              </text>
              <text x={colX + 16} y={rowY} fontSize={8} fill="#d97706" fontFamily="sans-serif">
                {line1}
              </text>
              {line2 && (
                <text x={colX + 16} y={rowY + 12} fontSize={8} fill="#d97706" fontFamily="sans-serif">
                  {line2}
                </text>
              )}
            </g>
          )

          if (isRight) rowY += 22
        }

        return <>{footerElems}</>
      })()}
    </svg>
  )
}

// ── Stats panel ─────────────────────────────────────────────────────────────

function StatsPanel({ model }: { model: BuildingModelV2 }) {
  const edges = allEdges(model)
  const allX = edges.flatMap((e) => [e.start.x, e.end.x])
  const allY = edges.flatMap((e) => [e.start.y, e.end.y])
  const width = Math.max(...allX) - Math.min(...allX)
  const depth = Math.max(...allY) - Math.min(...allY)
  const footprintArea = width * depth
  const totalWallLength = edges.reduce((s, e) => s + wallLength(e), 0)
  const doorCount = model.openings.filter((o) => o.type === 'door').length
  const windowCount = model.openings.filter((o) => o.type === 'window').length

  const stats = [
    { label: 'Dimensioner', value: `${width.toFixed(1)} × ${depth.toFixed(1)} m` },
    { label: 'Byggnadsarea (BYA)', value: `${footprintArea.toFixed(1)} m²` },
    { label: 'Väggars totallängd', value: `${totalWallLength.toFixed(1)} m` },
    { label: 'Antal väggar', value: `${edges.length}` },
    { label: 'Dörrar', value: `${doorCount}` },
    { label: 'Fönster', value: `${windowCount}` },
    { label: 'Rumshöjd', value: `${model.walls[0]?.edges[0]?.height ?? 0} m` },
    { label: 'Taktyp', value: model.roof.type },
    { label: 'Takvinkel', value: `${model.roof.pitch}°` },
  ]

  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col">
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            {s.label}
          </dt>
          <dd className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ViewPage() {
  const [model, setModel] = useState<BuildingModelV2 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [glbUrl, setGlbUrl] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // ?file=<name> takes precedence over #hash
      const params = new URLSearchParams(window.location.search)
      const file = params.get('file')

      if (file) {
        const res = await fetch(`/models/${file}.json`)
        if (!res.ok) throw new Error(`Model not found: ${file}`)
        const model = await res.json() as BuildingModelV2
        setModel(model)
        return
      }

      const id = params.get('id')
      if (id) {
        const res = await fetch(`/api/model/${id}`)
        if (!res.ok) throw new Error(`Model not found: ${id}`)
        const model = await res.json() as BuildingModelV2
        setModel(model)
        return
      }

      // Strip any trailing chars that aren't valid base64url (e.g. punctuation added by renderers)
      const hash = window.location.hash.slice(1).replace(/[^A-Za-z0-9\-_]+$/, '')
      if (!hash) {
        setError('Ingen byggnadsmodell i URL')
        return
      }

      // base64url → Uint8Array
      const b64 = hash.replace(/-/g, '+').replace(/_/g, '/')
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // DecompressionStream (browser native, no pako needed)
      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      writer.write(bytes)
      writer.close()

      const buf = await new Response(ds.readable).arrayBuffer()
      const text = new TextDecoder().decode(buf)
      setModel(JSON.parse(text) as BuildingModelV2)
    }
    load().catch((e) => setError(String(e)))
  }, [])

  const ifcContent = useMemo(() => (model ? generateIFC(model) : ''), [model])

  useEffect(() => {
    if (!ifcContent) return
    let objectUrl: string | null = null

    fetch('/api/convert', {
      method: 'POST',
      body: ifcContent,
      headers: { 'Content-Type': 'text/plain' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText)
          throw new Error(`Convert failed (${res.status}): ${msg}`)
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setConvertError(null)
        setGlbUrl(objectUrl)
      })
      .catch((e) => {
        setConvertError(String(e))
      })

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ifcContent])

  const handleDownload = useCallback(() => {
    if (!model) return
    const blob = new Blob([ifcContent], { type: 'application/x-step' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${model.name ?? 'byggnad'}.ifc`
    a.click()
    URL.revokeObjectURL(url)
  }, [ifcContent, model])

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-red-600 dark:text-red-400 text-sm font-medium mb-2">Fel vid laddning</p>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans flex items-center justify-center">
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">Laddar byggnadsmodell…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {model.name}
          </h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* Floor plan */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
            2D Planritning
          </h2>
          <FloorPlanV2 model={model} />
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Blå = dörr (öppningsriktning), Gult = fönster
          </p>
        </section>

        {/* 3D model */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            3D-modell
          </h2>
          <GLTFViewer glbUrl={glbUrl ?? ''} />
          {convertError && (
            <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-2 py-1">
              {convertError}
            </p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Renderas via IfcConvert + three.js GLTFLoader — konverteras server-side.
          </p>
        </section>

        {/* Stats */}
        <section className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">
            Byggnadsdata
          </h2>
          <StatsPanel model={model} />
        </section>

        {/* Download */}
        <section className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
            IFC-fil
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            Genererar ett IFC4 STEP-format direkt i webbläsaren. Filen kan öppnas i IFC-visare som
            BIMvision, Solibri eller IFC.js.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
            >
              Ladda ned .ifc
            </button>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 self-center">
              {(ifcContent.length / 1024).toFixed(1)} KB · IFC4 STEP ·{' '}
              {model.walls.reduce((s, l) => s + l.edges.length, 0)} väggar ·{' '}
              {model.openings.length} öppningar
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
