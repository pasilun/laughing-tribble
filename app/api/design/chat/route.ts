import { streamText, convertToModelMessages, type Tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

export const runtime = 'edge'

const CHAT_MODEL = 'claude-sonnet-4-5'

const footprintSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
})

const roofSchema = z.object({
  type: z.enum(['sadel', 'pulpet', 'flat']).nullable(),
  pitch: z.number().nullable(),
})

interface BuildingModel {
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

interface SetBuildingInput {
  purpose?: string
  flowType?: 'komplementbyggnad' | 'komplementbostadshus' | 'tillbyggnad'
  footprint?: { length: number; width: number }
  wallHeight?: number
  roof?: { type: 'sadel' | 'pulpet' | 'flat' | null; pitch: number | null }
}

interface SetTriageContextInput {
  inomDetaljplan?: boolean
  distanceToGrans?: number
  existingPottM2?: number
}

interface InstallationInput {
  type: 'vatten' | 'avlopp' | 'eldstad' | 'rokkanal' | 'ventilation'
}

const createSetBuildingTool = (
  currentModel: BuildingModel,
): Tool<SetBuildingInput, { model: BuildingModel }> => ({
  description: 'Uppdatera byggnadsmodellen. Skicka bara de fält som ska ändras.',
  inputSchema: z.object({
    purpose: z.string().optional(),
    flowType: z
      .enum(['komplementbyggnad', 'komplementbostadshus', 'tillbyggnad'])
      .optional(),
    footprint: footprintSchema.optional(),
    wallHeight: z.number().optional(),
    roof: roofSchema.optional(),
  }),
  execute: async (input: SetBuildingInput) => {
    const { purpose, flowType, footprint, wallHeight, roof } = input
    if (purpose !== undefined) currentModel.purpose = purpose
    if (flowType !== undefined) currentModel.flowType = flowType
    if (footprint !== undefined) currentModel.footprint = footprint
    if (wallHeight !== undefined) currentModel.wallHeight = wallHeight
    if (roof !== undefined) currentModel.roof = roof
    return { model: currentModel }
  },
})

const createSetTriageContextTool = (
  currentModel: BuildingModel,
): Tool<SetTriageContextInput, { model: BuildingModel }> => ({
  description: 'Uppdatera kontext om fastigheten.',
  inputSchema: z.object({
    inomDetaljplan: z.boolean().optional(),
    distanceToGrans: z.number().optional(),
    existingPottM2: z.number().optional(),
  }),
  execute: async (input: SetTriageContextInput) => {
    const { inomDetaljplan, distanceToGrans, existingPottM2 } = input
    if (inomDetaljplan !== undefined)
      currentModel.inomDetaljplan = inomDetaljplan
    if (distanceToGrans !== undefined)
      currentModel.distanceToGrans = distanceToGrans
    if (existingPottM2 !== undefined)
      currentModel.existingPottM2 = existingPottM2
    return { model: currentModel }
  },
})

const createAddInstallationTool = (
  currentModel: BuildingModel,
): Tool<InstallationInput, { model: BuildingModel }> => ({
  description: 'Lägg till en installation.',
  inputSchema: z.object({
    type: z.enum(['vatten', 'avlopp', 'eldstad', 'rokkanal', 'ventilation']),
  }),
  execute: async (input: InstallationInput) => {
    if (!currentModel.installations.includes(input.type)) {
      currentModel.installations.push(input.type)
    }
    return { model: currentModel }
  },
})

const createRemoveInstallationTool = (
  currentModel: BuildingModel,
): Tool<InstallationInput, { model: BuildingModel }> => ({
  description: 'Ta bort en installation.',
  inputSchema: z.object({
    type: z.enum(['vatten', 'avlopp', 'eldstad', 'rokkanal', 'ventilation']),
  }),
  execute: async (input: InstallationInput) => {
    currentModel.installations = currentModel.installations.filter(
      (i) => i !== input.type,
    )
    return { model: currentModel }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const currentModel: BuildingModel = {
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

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: `Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.

När användaren beskriver byggnadens dimensioner, typ, tak eller installationer, använd verktygen för att uppdatera modellen. Använd alltid dessa verktyg när relevant information nämns — inte bara beskriv i text.`,
      messages: await convertToModelMessages(messages),
      tools: {
        set_building: createSetBuildingTool(currentModel),
        set_triage_context: createSetTriageContextTool(currentModel),
        add_installation: createAddInstallationTool(currentModel),
        remove_installation: createRemoveInstallationTool(currentModel),
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (err) {
    console.error('[chat] error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}