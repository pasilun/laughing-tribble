import type { BuildingModelV2, Opening } from '@/types/building-v2'

export function validateBuilding(model: BuildingModelV2): string[] {
  const warnings: string[] = []

  const wallH = model.walls[0]?.edges[0]?.height ?? 2.4
  const wallT = model.walls[0]?.edges[0]?.thickness ?? 0.12
  const length = (model.walls[0]?.vertices[1]?.x ?? 0) - (model.walls[0]?.vertices[0]?.x ?? 0)
  const width  = (model.walls[0]?.vertices[2]?.y ?? 0) - (model.walls[0]?.vertices[1]?.y ?? 0)

  const wallLength: Record<string, number> = {
    'wall-south': length, 'wall-north': length,
    'wall-east': width,   'wall-west': width,
  }

  for (const op of model.openings) {
    const sillH = op.sillHeight ?? (op.type === 'door' ? 0 : 0.9)

    // Check A — opening taller than wall
    if (sillH + op.height > wallH + 0.001) {
      warnings.push(
        `Öppning '${op.id}': sillHeight (${sillH}) + height (${op.height}) = ${(sillH + op.height).toFixed(2)} m > väggshöjd (${wallH}) m`
      )
    }

    // Check B — opening extends past wall end (exterior walls only)
    if (op.wallId) {
      const wl = wallLength[op.wallId] ?? 0
      if (op.offsetFromStart + op.width > wl - wallT + 0.001) {
        warnings.push(
          `Öppning '${op.id}': sträcker sig förbi väggens slut (offset ${op.offsetFromStart.toFixed(2)} + bredd ${op.width.toFixed(2)} > ${(wl - wallT).toFixed(2)} m)`
        )
      }
    }
  }

  // Check C — two openings overlap on the same wall/partition
  const groupKey = (op: Opening) => op.partitionId ?? op.wallId ?? ''
  const byWall = new Map<string, Opening[]>()
  for (const op of model.openings) {
    const key = groupKey(op)
    if (!byWall.has(key)) byWall.set(key, [])
    byWall.get(key)!.push(op)
  }
  for (const ops of byWall.values()) {
    for (let i = 0; i < ops.length; i++) {
      for (let j = i + 1; j < ops.length; j++) {
        const a = ops[i], b = ops[j]
        const aEnd = a.offsetFromStart + a.width
        const bEnd = b.offsetFromStart + b.width
        if (a.offsetFromStart < bEnd && b.offsetFromStart < aEnd) {
          warnings.push(`Öppningar '${a.id}' och '${b.id}' överlappar på samma vägg`)
        }
      }
    }
  }

  // Check D — door swing overlaps another opening (approximate bounding-box check)
  const doors = model.openings.filter(op => op.type === 'door')
  for (const door of doors) {
    const key = groupKey(door)
    const peers = byWall.get(key) ?? []
    // Swing region: along-wall span is the same as the door opening.
    // Perpendicular extent ≈ door.width. We flag if any other opening's
    // along-wall interval overlaps the door's interval (same axis check).
    for (const other of peers) {
      if (other.id === door.id) continue
      const dEnd = door.offsetFromStart + door.width
      const oEnd = other.offsetFromStart + other.width
      if (door.offsetFromStart < oEnd && other.offsetFromStart < dEnd) {
        // They share the same stretch of wall — swing likely clashes
        if (other.type === 'door') {
          warnings.push(`Dörrsvingar '${door.id}' och '${other.id}' kan kollidera (överlappande position på väggen)`)
        } else {
          warnings.push(`Dörr '${door.id}' svingriktning kan kollidera med öppning '${other.id}'`)
        }
      }
    }
  }

  return warnings
}
