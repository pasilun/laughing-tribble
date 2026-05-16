'use client'

import { BuildingModel, computeBYA, computeNockhjd } from '@/lib/building-model'

interface ModelSummaryPanelProps {
  model: BuildingModel
}

export default function ModelSummaryPanel({ model }: ModelSummaryPanelProps) {
  const bya = computeBYA(model)
  const nockhjd = computeNockhjd(model)

  return (
    <div className="h-full overflow-y-auto p-6 bg-white dark:bg-zinc-900">
      <h2 className="text-lg font-semibold mb-4 text-black dark:text-zinc-50">
        Byggnadsmodell
      </h2>

      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Byggnadstyp:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.flowType || '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Ändamål:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.purpose || '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Mått:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.footprint
              ? `${model.footprint.length} m × ${model.footprint.width} m`
              : '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Vägghöjd:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.wallHeight !== null ? `${model.wallHeight} m` : '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Tak:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.roof.type && model.roof.pitch !== null
              ? `${model.roof.type}, ${model.roof.pitch}°`
              : model.roof.type
              ? `${model.roof.type}, –`
              : '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">BYA:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {bya !== null ? `${bya} m²` : '–'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Nockhöjd:</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {nockhjd !== null ? `${nockhjd.toFixed(1)} m` : '–'}
          </span>
        </div>

        <div className="pt-2">
          <span className="text-zinc-600 dark:text-zinc-400 block mb-1">
            Installationer:
          </span>
          <span className="font-medium text-black dark:text-zinc-50">
            {model.installations.length > 0
              ? model.installations.join(', ')
              : '–'}
          </span>
        </div>
      </div>
    </div>
  )
}