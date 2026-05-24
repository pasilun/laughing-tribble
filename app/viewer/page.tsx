'use client'

import { useMemo, useCallback } from 'react'
import Link from 'next/link'
import { friggebodFixture } from '@/lib/friggebod-fixture'
import { generateIFC } from '@/lib/ifc-generator'
import { BuildingModelV2, Wall, Opening, Vector2 } from '@/types/building-v2'

// ── Geometry helpers ────────────────────────────────────────────────────────

function wallLength(w: Wall): number {
  const dx = w.end.x - w.start.x
  const dy = w.end.y - w.start.y
  return Math.sqrt(dx * dx + dy * dy)
}

function wallAngle(w: Wall): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
}

/** Point along wall at offset metres from start */
function pointAlongWall(wall: Wall, offset: number): Vector2 {
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
  const viewBoxH = 400
  const padding = 60

  // Compute bounding box of all wall endpoints
  const allX = model.walls.flatMap((w) => [w.start.x, w.end.x])
  const allY = model.walls.flatMap((w) => [w.start.y, w.end.y])
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minY = Math.min(...allY)
  const maxY = Math.max(...allY)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const drawW = viewBoxW - padding * 2
  const drawH = viewBoxH - padding * 2
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

  // Scale bar: pick a nice metre value
  const targetBarWidthPx = 80
  const rawMetres = targetBarWidthPx / scale
  const niceDivisions = [0.5, 1, 2, 5, 10]
  const barMetres =
    niceDivisions.find((d) => d >= rawMetres * 0.5) ?? niceDivisions[niceDivisions.length - 1]
  const barPx = barMetres * scale

  const firstWallThickness = model.walls[0]?.thickness ?? 0.12
  const wallStrokeW = Math.max(2, firstWallThickness * scale)

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      width="100%"
      className="w-full max-w-full h-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Floor plan"
    >
      {/* ── Walls ────────────────────────────────────────────────────────── */}
      {model.walls.map((wall) => {
        const x1 = tx(wall.start.x)
        const y1 = ty(wall.start.y)
        const x2 = tx(wall.end.x)
        const y2 = ty(wall.end.y)
        return (
          <line
            key={wall.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#27272a"
            strokeWidth={wallStrokeW}
            strokeLinecap="square"
          />
        )
      })}

      {/* ── Openings (doors & windows) ───────────────────────────────────── */}
      {model.openings.map((opening: Opening) => {
        const wall = model.walls.find((wl) => wl.id === opening.wallId)
        if (!wall) return null

        const angle = wallAngle(wall)
        const mid = pointAlongWall(wall, opening.offsetFromStart + opening.width / 2)
        const startPt = pointAlongWall(wall, opening.offsetFromStart)
        const endPt = pointAlongWall(wall, opening.offsetFromStart + opening.width)

        const sx1 = tx(startPt.x)
        const sy1 = ty(startPt.y)
        const ex1 = tx(endPt.x)
        const ey1 = ty(endPt.y)

        if (opening.type === 'door') {
          // Door: gap in wall + door swing arc
          const { dx, dy } = perpDir(angle)
          const swingR = opening.width * scale
          const arcEndX = tx(mid.x + dx * opening.width)
          const arcEndY = ty(mid.y + dy * opening.width)

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
              {/* Door panel line */}
              <line
                x1={tx(mid.x)}
                y1={ty(mid.y)}
                x2={arcEndX}
                y2={arcEndY}
                stroke="#3b82f6"
                strokeWidth={1.5}
              />
              {/* Swing arc */}
              <path
                d={`M ${tx(mid.x)} ${ty(mid.y)} A ${swingR} ${swingR} 0 0 1 ${arcEndX} ${arcEndY}`}
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

        return (
          <g key={room.id}>
            <text
              x={tx(cx)}
              y={ty(cy) - 8}
              textAnchor="middle"
              fontSize={12}
              fill="#52525b"
              fontFamily="sans-serif"
            >
              {room.name}
            </text>
            <text
              x={tx(cx)}
              y={ty(cy) + 8}
              textAnchor="middle"
              fontSize={10}
              fill="#71717a"
              fontFamily="sans-serif"
            >
              {area.toFixed(1)} m²
            </text>
          </g>
        )
      })}

      {/* ── North arrow ──────────────────────────────────────────────────── */}
      <g transform={`translate(${viewBoxW - 40}, 36)`}>
        <line x1={0} y1={12} x2={0} y2={-12} stroke="#27272a" strokeWidth={2} />
        <polygon points="0,-14 -5,-4 5,-4" fill="#27272a" />
        <text
          x={0}
          y={24}
          textAnchor="middle"
          fontSize={11}
          fill="#27272a"
          fontFamily="sans-serif"
          fontWeight="bold"
        >
          N
        </text>
      </g>

      {/* ── Scale bar ────────────────────────────────────────────────────── */}
      <g transform={`translate(${padding}, ${viewBoxH - 24})`}>
        <line x1={0} y1={0} x2={barPx} y2={0} stroke="#52525b" strokeWidth={2} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke="#52525b" strokeWidth={2} />
        <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="#52525b" strokeWidth={2} />
        <text
          x={barPx / 2}
          y={-8}
          textAnchor="middle"
          fontSize={10}
          fill="#52525b"
          fontFamily="sans-serif"
        >
          {barMetres} m
        </text>
      </g>
    </svg>
  )
}

// ── Stats panel ─────────────────────────────────────────────────────────────

function StatsPanel({ model }: { model: BuildingModelV2 }) {
  const allX = model.walls.flatMap((w) => [w.start.x, w.end.x])
  const allY = model.walls.flatMap((w) => [w.start.y, w.end.y])
  const width = Math.max(...allX) - Math.min(...allX)
  const depth = Math.max(...allY) - Math.min(...allY)
  const footprintArea = width * depth
  const totalWallLength = model.walls.reduce((s, w) => s + wallLength(w), 0)
  const doorCount = model.openings.filter((o) => o.type === 'door').length
  const windowCount = model.openings.filter((o) => o.type === 'window').length

  const stats = [
    { label: 'Dimensioner', value: `${width.toFixed(1)} × ${depth.toFixed(1)} m` },
    { label: 'Byggnadsarea (BYA)', value: `${footprintArea.toFixed(1)} m²` },
    { label: 'Väggars totallängd', value: `${totalWallLength.toFixed(1)} m` },
    { label: 'Antal väggar', value: `${model.walls.length}` },
    { label: 'Dörrar', value: `${doorCount}` },
    { label: 'Fönster', value: `${windowCount}` },
    { label: 'Rumshöjd', value: `${model.walls[0]?.height ?? 0} m` },
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

export default function ViewerPage() {
  const model: BuildingModelV2 = friggebodFixture

  const ifcContent = useMemo(() => generateIFC(model), [model])

  const handleDownload = useCallback(() => {
    const blob = new Blob([ifcContent], { type: 'application/x-step' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'friggebod.ifc'
    a.click()
    URL.revokeObjectURL(url)
  }, [ifcContent])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            ← Tillbaka
          </Link>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            IFC Viewer (spike) — {model.name}
          </h1>
          <span className="ml-auto text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded font-medium">
            Spike
          </span>
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
              {(ifcContent.length / 1024).toFixed(1)} KB · IFC4 STEP · {model.walls.length} väggar ·{' '}
              {model.openings.length} öppningar
            </div>
          </div>

          {/* Preview of IFC content */}
          <details className="mt-4">
            <summary className="text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none">
              Visa IFC-innehåll (förhandsvisning)
            </summary>
            <pre className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded p-3 overflow-auto max-h-64 font-mono leading-relaxed">
              {ifcContent.slice(0, 2000)}
              {ifcContent.length > 2000 ? '\n…[trunkerad]' : ''}
            </pre>
          </details>
        </section>
      </main>
    </div>
  )
}
