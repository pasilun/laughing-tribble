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
  const scale = 50
  const scaleBarHeight = 50
  const scaleBarBottomPadding = 20

  const rectWidth = length * scale
  const rectHeight = width * scale

  const viewBoxWidth = rectWidth + padding * 2
  const viewBoxHeight = rectHeight + padding + scaleBarHeight + scaleBarBottomPadding

  const maxDimension = Math.max(length, width)
  const scaleBarLength = maxDimension <= 4 ? 1 : maxDimension <= 10 ? 2 : 5

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
          {length}m
        </text>

        <text
          data-testid="dim-label-width"
          x={padding - 10}
          y={padding + rectHeight / 2}
          textAnchor="end"
          dominantBaseline="middle"
          className="text-xs fill-zinc-700 dark:fill-zinc-300"
        >
          {width}m
        </text>

        <g transform={`translate(${viewBoxWidth / 2}, ${padding + rectHeight + 20})`}>
          <line
            x1={-(rectWidth / length) * scaleBarLength / 2}
            y1={0}
            x2={(rectWidth / length) * scaleBarLength / 2}
            y2={0}
            stroke="#71717a"
            strokeWidth={2}
          />
          <line
            x1={-(rectWidth / length) * scaleBarLength / 2}
            y1={-5}
            x2={-(rectWidth / length) * scaleBarLength / 2}
            y2={5}
            stroke="#71717a"
            strokeWidth={2}
          />
          <line
            x1={(rectWidth / length) * scaleBarLength / 2}
            y1={-5}
            x2={(rectWidth / length) * scaleBarLength / 2}
            y2={5}
            stroke="#71717a"
            strokeWidth={2}
          />
          <text
            data-testid="scale-bar-label"
            x={0}
            y={20}
            textAnchor="middle"
            className="text-xs fill-zinc-700 dark:fill-zinc-300"
          >
            {scaleBarLength} m
          </text>
        </g>
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
