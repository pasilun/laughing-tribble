export interface BuildingModel {
  purpose: string | null
  flowType: 'komplementbyggnad' | 'komplementbostadshus' | 'tillbyggnad' | null
  footprint: { length: number; width: number } | null
  wallHeight: number | null
  roof: { type: 'sadel' | 'pulpet' | 'flat' | null; pitch: number | null }
  inomDetaljplan: boolean | null
  distanceToGrans: number | null
  installations: Array<'vatten' | 'avlopp' | 'eldstad' | 'rokkanal' | 'ventilation'>
  existingPottM2: number | null
}

export const emptyBuildingModel: BuildingModel = {
  purpose: null,
  flowType: null,
  footprint: null,
  wallHeight: null,
  roof: { type: null, pitch: null },
  inomDetaljplan: null,
  distanceToGrans: null,
  installations: [],
  existingPottM2: null,
}

export function computeBYA(model: BuildingModel): number | null {
  if (!model.footprint) return null
  return model.footprint.length * model.footprint.width
}

export function computeNockhjd(model: BuildingModel): number | null {
  if (!model.wallHeight || !model.roof.type || !model.footprint) return null
  if (model.roof.type === 'flat') return model.wallHeight
  if (model.roof.pitch === null) return model.wallHeight
  
  const pitchRad = (model.roof.pitch * Math.PI) / 180
  const length = model.footprint.length
  
  if (model.roof.type === 'sadel') {
    return model.wallHeight + (length / 2) * Math.tan(pitchRad)
  }
  if (model.roof.type === 'pulpet') {
    return model.wallHeight + length * Math.tan(pitchRad)
  }
  
  return model.wallHeight
}