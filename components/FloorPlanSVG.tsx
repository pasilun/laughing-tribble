'use client'

import { BuildingModel } from '@/types/building'

interface FloorPlanSVGProps {
  model: BuildingModel | null
}

export function FloorPlanSVG({ model }: FloorPlanSVGProps) {
  const length = model?.footprint?.length
  const width = model?.footprint?.width

  if (!length || !width) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Beskriv dimensioner för att se ritning
        </p>
      </div>
    )
  }

  const padding = 60
  const aspectRatio = length / width

  const viewBoxWidth = 600
  const viewBoxHeight = 600 / aspectRatio

  const rectWidth = viewBoxWidth - padding * 2
  const rectHeight = viewBoxHeight - padding * 2

  const area = length * width

  return (
    <div className="w-full overflow-hidden">
      <svg
        data-testid="floor-plan-svg"
        width="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        className="w-full max-w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <rect
          x={padding}
          y={padding}
          width={rectWidth}
          height={rectHeight}
          fill="none"
          stroke="#71717a"
          strokeWidth={2}
          data-testid="floor-plan-rect"
        />

        <text
          x={padding + rectWidth / 2}
          y={padding + rectHeight / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-xs fill-zinc-600 dark:fill-zinc-400 font-medium"
        >
          {length}m × {width}m
        </text>

        <text
          data-testid="dim-label-length"
          x={padding + rectWidth / 2}
          y={padding - 10}
          textAnchor="middle"
          className="text-xs fill-zinc-700 dark:fill-zinc-300"
        >
          {length}
        </text>

        <text
          data-testid="dim-label-width"
          x={padding - 10}
          y={padding + rectHeight / 2}
          textAnchor="end"
          dominantBaseline="middle"
          className="text-xs fill-zinc-700 dark:fill-zinc-300"
        >
          {width}
        </text>
      </svg>

      <div className="mt-4 text-center overflow-hidden">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Byggnadsarea: {area}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400 ml-1">
          m²
        </span>
      </div>
    </div>
  )
}
