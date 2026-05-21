export type BuildingModel = {
  flowType?: string
  footprint?: {
    length?: number
    width?: number
  }
  roof?: {
    type: 'sadel' | 'pulpet' | 'flat'
    pitch?: number
  }
  wallHeight?: number
  installations?: string[]
  inomDetaljplan?: boolean
  distanceToGrans?: number
}
