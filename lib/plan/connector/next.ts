import { spaceGrid } from '../domain/rooms'
import type { Plan } from '../domain/types'
import type { Next } from './types'

// A value in angle brackets in `arguments` is a placeholder the caller must fill in (contract §6).
const FILL = '<mm>'

export type Steps = { done: string[]; next: Next[]; note?: string }

// Where a plan stands and what to do now, as calls ready to make. The same decision tree as `nextStep` in
// lib/plan/mcp/guided.ts, in the words of the new connector.
export function nextCalls(plan: Plan, revision: number, state: { openIssues?: number } = {}): Steps {
  const done: string[] = []
  const id = plan.id
  const sources = (plan.sources ?? []).filter((s) => s.view !== 'elevation')
  const hasSource = sources.length > 0 || !!plan.underlay
  const calibrated = sources.some((s) => s.calibration) || !!plan.underlay
  const printed = { printed_outer_mm: { width: FILL, length: FILL } }
  if (!hasSource && plan.walls.length === 0)
    return { done, next: [{ tool: 'source', arguments: { id, action: 'upload_link' }, why: 'Ge länken till användaren och vänta tills de säger att ritningen är uppladdad. Rita inget före det.' }] }
  if (hasSource) done.push(`källritning: ${sources.map((s) => s.id).join(', ') || 'underlag'}`)
  if (hasSource && !calibrated)
    return { done, next: [{ tool: 'source', arguments: { id, base_revision: revision, action: 'trace', args: printed }, why: 'Läs de tryckta yttermåtten i ritningen (view med vyn source). Kalibrerar mot dem och ger ett första utkast. Gissa inte skalan.' }] }
  if (calibrated) done.push('kalibrerad')
  if (plan.walls.length === 0)
    return { done, next: [{ tool: 'source', arguments: { id, base_revision: revision, action: 'trace', args: printed }, why: 'Ger ett utkast av väggar och öppningar från ritningen.' }] }
  done.push(`${plan.walls.length} väggar`)
  if (plan.openings.length === 0)
    return { done, next: [{ tool: 'source', arguments: { id, base_revision: revision, action: 'trace' }, why: 'Läser öppningar och dörrar mot väggarna som finns (rör inte väggarna).' }] }
  done.push(`${plan.openings.length} öppningar`)
  if (hasSource && (state.openIssues === undefined || state.openIssues > 0))
    return { done, next: [{ tool: 'check', arguments: { id, scope: ['audit'] }, why: state.openIssues ? `${state.openIssues} anmärkningar mot ritningen: jämför och rätta.` : 'Jämför planen med ritningen och lista vad som avviker.' }] }
  done.push('ingen avvikelse mot ritningen')
  if (plan.rooms.length === 0) {
    const sp = (spaceGrid(plan, 'fore')?.spaces ?? []).filter((s) => !s.open && s.area > 1.5e6)
    const where = sp.slice(0, 10).map((s) => `(${Math.round(s.at.x)},${Math.round(s.at.y)}) ${(s.area / 1e6).toFixed(1)} m²`).join('; ') || 'se view'
    return { done, next: [{ tool: 'edit', arguments: { id, base_revision: revision, ops: [{ op: 'add', kind: 'room', item: { id: '<id>', name: '<namn>', at: { x: FILL, y: FILL } } }] }, why: `Lägg in rummen, med de namn ritningen skriver. Utrymmen: ${where}.` }] }
  }
  done.push(`${plan.rooms.length} rum`)
  const tb = plan.sheet.titleBlock
  if (plan.dimensions.length === 0 || !tb.property.trim() || !tb.address.trim() || !tb.author.trim())
    return { done, next: [{ tool: 'check', arguments: { id, scope: ['finish'] }, why: 'Sätter blad och mått och säger vad användaren ska fylla i (ställ frågan en gång).' }] }
  return { done, next: [], note: 'Klart. Sammanfatta för användaren: vad som är uppmätt från ritningen, vad som är uppskattat, vad som inte gick att läsa och vad som bör kontrolleras på plats.' }
}
