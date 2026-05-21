import { BuildingModel } from '@/types/building'

export interface TriageResult {
  bucket: 'LOVFRI' | 'ANMÄLAN' | 'BYGGLOV' | null
  reasons: string[]
  incomplete: boolean
}

export function runTriage(model: BuildingModel | null): TriageResult {
  if (!model || !model.flowType || model.inomDetaljplan === undefined) {
    return { bucket: null, reasons: [], incomplete: true }
  }

  const bya = (model.footprint?.length ?? 0) * (model.footprint?.width ?? 0)
  const installs = model.installations ?? []
  const has = (x: string) => installs.includes(x)

  let bucket: TriageResult['bucket'] = null
  const reasons: string[] = []

  if (model.flowType === 'komplementbyggnad' || model.flowType === 'komplementbostadshus') {
    if (model.inomDetaljplan === true && bya > 30) {
      bucket = 'BYGGLOV'
      reasons.push('Byggnadsarean överstiger 30 m² inom detaljplan — bygglov krävs (PBL 9 kap 4 a §)')
    } else if (model.inomDetaljplan === false && bya > 50) {
      bucket = 'BYGGLOV'
      reasons.push('Byggnadsarean överstiger 50 m² utanför detaljplan — bygglov krävs (PBL 9 kap 4 a §)')
    }
  }

  if (bucket !== 'BYGGLOV' && (has('eldstad') || has('rokkanal') || has('rökkanal'))) {
    bucket = 'ANMÄLAN'
    reasons.push('Eldstad eller rökkanal kräver anmälan (PBF 6 kap 5 §)')
  }

  if (bucket !== 'BYGGLOV' && (has('vatten') || has('avlopp'))) {
    bucket = 'ANMÄLAN'
    reasons.push('Vatten eller avlopp kräver anmälan (PBF 6 kap 5 §)')
  }

  if (bucket === null && model.flowType === 'komplementbyggnad') {
    bucket = 'LOVFRI'
    reasons.push('Komplementbyggnad inom lovfri pott — varken anmälan eller bygglov krävs (PBL 9 kap 4 a §)')
  }

  return { bucket, reasons, incomplete: false }
}
