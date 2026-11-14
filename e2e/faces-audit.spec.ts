import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import sharp from 'sharp'
import { auditPlan } from '@/lib/plan/assist/audit'
import { hasFaceWalls } from '@/lib/plan/domain/faces'
import type { Opening, Plan, Source, Wall } from '@/lib/plan/domain/types'

// The audit's wall fixes are written from the centre-line view. A face-referenced wall (wall.ref) must not get one:
// the fix would put the stored wall half a thickness off. lgh154-face.json has every wall on a room face.

const face = () => JSON.parse(readFileSync('e2e/fixtures/faces/lgh154-face.json', 'utf8')) as Plan

test('no wall item of a face-referenced plan carries a fix', async () => {
  const plan = face()
  expect(hasFaceWalls(plan)).toBe(true)
  const items = await auditPlan('faces-audit', plan)
  const walls = items.filter((i) => i.id.startsWith('wall:'))
  for (const item of walls) {
    expect(item.fix, item.id).toBeUndefined()
  }
})

// A corner of two face walls, both on their right side: the centre line of A starts 50 mm further along A than its stored
// a-end (where B's centre line crosses it), so the view moves the opening stored at 500 to 550. The drawing is solid wall
// where the opening is, so the audit reports it, and the message must quote the stored 500.
test('the opening message quotes the stored offset, not the centre-line view', async () => {
  const mmPerPx = 10
  const x0 = -200
  const y0 = -300
  const widthPx = 440
  const heightPx = 360
  const inWall = (X: number, Y: number) =>
    (X >= 0 && X <= 100 && Y >= 0 && Y <= 3000) || (X >= 0 && X <= 4000 && Y >= -100 && Y <= 0)
  const raw = Buffer.alloc(widthPx * heightPx, 255)
  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < widthPx; px++) {
      if (inWall(x0 + px * mmPerPx, y0 + py * mmPerPx)) raw[py * widthPx + px] = 0
    }
  }
  const png = await sharp(raw, { raw: { width: widthPx, height: heightPx, channels: 1 } }).png().toBuffer()
  const source: Source = {
    id: 'S1', name: 'Ritning', role: 'archive', src: `data:image/png;base64,${png.toString('base64')}`,
    widthPx, heightPx, mmPerPx, x: x0, y: y0, rotation: 0, calibration: 'test', primary: true,
  }
  const walls: Wall[] = [
    { id: 'W:A', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 100, phase: 'existing', ref: 'right' },
    { id: 'W:B', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100, phase: 'existing', ref: 'right' },
  ]
  const openings: Opening[] = [{ id: 'O:A:1', wallId: 'W:A', kind: 'opening', offset: 500, width: 800, phase: 'existing' }]
  const base = face()
  const plan: Plan = { ...base, walls, openings, fixtures: [], rooms: [], dimensions: [], notes: [], sources: [source] }
  expect(hasFaceWalls(plan)).toBe(true)
  const items = await auditPlan('faces-audit-opening', plan)
  const item = items.find((i) => i.id === 'opening:O:A:1')
  expect(item?.text).toContain('(offset 500, bredd 800)')
  expect(item?.text).not.toContain('offset 550')
})
