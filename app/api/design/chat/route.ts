import { streamText, convertToModelMessages, jsonSchema } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'

export const runtime = 'edge'

type BuildingModel = {
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

const FIXTURES: Record<string, { response: string; toolCall?: { name: string; args: BuildingModel } }> = {
  'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 4.5 meter i längd och 4.5 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 4.5, width: 4.5 } }
    }
  },
  'Jag vill bygga en komplementbyggnad, 8 meter lång och 6 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 8 meter i längd och 6 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 8, width: 6 } }
    }
  },
  'Jag vill bygga en komplementbyggnad, 12 meter lång och 8 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 12 meter i längd och 8 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 12, width: 8 } }
    }
  },
  'Jag vill bygga en komplementbyggnad, 10 meter lång och 3 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 10 meter i längd och 3 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 10, width: 3 } }
    }
  },
  'Jag vill bygga en komplementbyggnad, 4 meter lång och 4 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 4 meter i längd och 4 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 4, width: 4 } }
    }
  },
  'Ändra längden till 5 meter': {
    response: 'Jag har uppdaterat längden till 5 meter. Bredden och byggnadstypen är oförändrade.',
    toolCall: {
      name: 'set_building',
      args: { footprint: { length: 5 } }
    }
  },
  'Ändra längden till 8 meter': {
    response: 'Jag har uppdaterat längden till 8 meter. Bredden och byggnadstypen är oförändrade.',
    toolCall: {
      name: 'set_building',
      args: { footprint: { length: 8 } }
    }
  },
  'Sadeltak med 25 graders lutning': {
    response: 'Jag har registrerat att du vill ha ett sadeltak med 25 graders lutning.',
    toolCall: {
      name: 'set_building',
      args: { roof: { type: 'sadel', pitch: 25 } }
    }
  },
  'Vägghöjd 2.4 meter': {
    response: 'Jag har registrerat att vägghöjden är 2.4 meter.',
    toolCall: {
      name: 'set_building',
      args: { wallHeight: 2.4 }
    }
  },
  'Den ska ha dusch och avlopp': {
    response: 'Jag har registrerat att byggnaden ska ha vatten och avlopp.',
    toolCall: {
      name: 'set_building',
      args: { installations: ['vatten', 'avlopp'] }
    }
  },
  'Den ligger inom detaljplan, 4 meter från tomtgränsen': {
    response: 'Jag har registrerat att byggnaden ligger inom detaljplan, 4 meter från tomtgränsen.',
    toolCall: {
      name: 'set_building',
      args: { inomDetaljplan: true, distanceToGrans: 4 }
    }
  },
  'Jag vill bygga en komplementbyggnad, 4 meter lång och 4 meter bred, utanför detaljplan och utan installationer': {
    response: 'Jag har registrerat en komplementbyggnad 4×4 meter utanför detaljplan, utan installationer.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 4, width: 4 }, inomDetaljplan: false, installations: [] }
    }
  },
  'Den ska ha en eldstad': {
    response: 'Jag har registrerat att byggnaden ska ha en eldstad.',
    toolCall: {
      name: 'set_building',
      args: { installations: ['eldstad'] }
    }
  }
}

function createFakeModel(userText: string) {
  const fixture = Object.entries(FIXTURES).find(([prompt]) => prompt === userText)?.[1]
  const responseText = fixture?.response || 'Jag förstår inte din förfrågan. Kan du vara mer specifik?'

  return new MockLanguageModelV3({
    provider: 'fake-provider',
    modelId: 'fake-model',
    doStream: async () => {
      const chunks: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: 'msg-1' },
        { type: 'text-delta', id: 'msg-1', delta: responseText },
        { type: 'text-end', id: 'msg-1' }
      ]

      if (fixture?.toolCall) {
        const toolArgsString = JSON.stringify(fixture.toolCall.args)
        chunks.push({
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: fixture.toolCall.name,
          input: toolArgsString
        })
      }

      chunks.push({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined }
        }
      })

      return {
        stream: simulateReadableStream({
          chunks,
          initialDelayInMs: 100,
          chunkDelayInMs: 50
        }),
        request: { body: {} }
      }
    }
  })
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()
    const lastMessage = messages[messages.length - 1]
    const userText = lastMessage?.parts?.find((p: { type: string }) => p.type === 'text')?.text || ''

    const isProduction = process.env.VERCEL_ENV === 'production'
    const model = isProduction ? anthropic('claude-sonnet-4-5') : createFakeModel(userText)

    const setBuildingTool = {
      description: 'Set or update the building model based on user requirements',
      inputSchema: jsonSchema<BuildingModel>({
        type: 'object',
        properties: {
          flowType: { type: 'string', description: 'Type of building (e.g., komplementbyggnad)' },
          footprint: {
            type: 'object',
            properties: {
              length: { type: 'number' },
              width: { type: 'number' }
            }
          },
          roof: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['sadel', 'pulpet', 'flat'] },
              pitch: { type: 'number' }
            },
            required: ['type']
          },
          wallHeight: { type: 'number' },
          installations: {
            type: 'array',
            items: { type: 'string' }
          },
          inomDetaljplan: { type: 'boolean' },
          distanceToGrans: { type: 'number' }
        }
      }),
      execute: async (args: BuildingModel) => args
    }

    const result = streamText({
      model,
      system: 'Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.',
      messages: await convertToModelMessages(messages),
      tools: { set_building: setBuildingTool }
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
