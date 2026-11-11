import { checkPlan } from '../../domain/checks'
import type { Plan } from '../../domain/types'
import type { Entry } from '../names'
import type { Finding } from '../types'
import { fromCheck } from '../findings'

export type CheckContext = { id: string; plan: Plan; revision: number; against: Record<string, unknown> }
export type CheckOutput = { findings: Finding[]; text?: string }
export type CheckEntry = Entry & { run: (c: CheckContext) => Promise<CheckOutput> }

export const permit: CheckEntry = { name: 'permit', summary: 'What an application for interior work needs to show (title block, scale, load-bearing, fire, ventilation)',
  run: async (c) => ({ findings: checkPlan(c.plan).map(fromCheck) }) }
