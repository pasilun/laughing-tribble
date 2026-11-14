// Scores a plan of the 1999 survey against the locked fixture, counting only the area of flats 152-154.
// Usage: npx tsx scripts/score-1999.ts <plan.json> [clip|both]  (the plan, or a get answer with format json)
import { readFileSync } from 'fs'
import type { Opening, Plan, Wall } from '../lib/plan/domain/types'
import { scorePlan } from '../lib/plan/bench/score'
import { wallLength } from '../lib/plan/domain/geometry'
const ref = JSON.parse(readFileSync('e2e/fixtures/flat/drawing-1999.json', 'utf8'))
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const got: Plan = raw.data?.plan ?? raw.plan ?? raw
const inside = (p: { x: number; y: number }) => p.x >= 19000 && p.x <= 30100 && p.y >= 7500 && p.y <= 21300
const mode = process.argv[3] ?? 'clip'
const B = { x0: 19000, x1: 30100, y0: 7500, y1: 21300 }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
// clip: cut each wall to the area (a wall running on past the flats counts only inside); both: only walls with both ends inside (the earlier trial's rule)
const walls = mode === 'both' ? got.walls.filter((w: Wall) => inside(w.a) && inside(w.b)) : got.walls
  .filter((w: Wall) => !(Math.max(w.a.x, w.b.x) < B.x0 || Math.min(w.a.x, w.b.x) > B.x1 || Math.max(w.a.y, w.b.y) < B.y0 || Math.min(w.a.y, w.b.y) > B.y1))
  .map((w: Wall) => Math.abs(w.a.x - w.b.x) < 1 || Math.abs(w.a.y - w.b.y) < 1 ? { ...w, a: { x: clamp(w.a.x, B.x0, B.x1), y: clamp(w.a.y, B.y0, B.y1) }, b: { x: clamp(w.b.x, B.x0, B.x1), y: clamp(w.b.y, B.y0, B.y1) } } : w)
const ids = new Set(walls.map((w: Wall) => w.id))
const plan = { ...got, walls, openings: (got.openings ?? []).filter((o: Opening) => ids.has(o.wallId)) }
const s = scorePlan(ref, plan)
console.log(JSON.stringify(s, null, 1))
console.log(`walls in area ${walls.length} (of ${got.walls.length}), ${(walls.reduce((t: number, w: Wall) => t + wallLength(w), 0) / 1000).toFixed(1)} m; openings ${plan.openings.length}`)
