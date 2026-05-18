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
}

const FIXTURES: Record<string, { response: string; toolCall?: { name: string; args: BuildingModel } }> = {
  'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred': {
    response: 'Jag förstår att du vill bygga en komplementbyggnad. Jag har registrerat måtten: 4.5 meter i längd och 4.5 meter i bredd.',
    toolCall: {
      name: 'set_building',
      args: { flowType: 'komplementbyggnad', footprint: { length: 4.5, width: 4.5 } }
    }
  },
  'Ändra längden till 5 meter': {
    response: 'Jag har uppdaterat längden till 5 meter. Bredden och byggnadstypen är oförändrade.',
    toolCall: {
      name: 'set_building',
      args: { footprint: { length: 5 } }
    }
  }
}

function createFakeModel(userText: string) {
  const fixture = Object.entries(FIXTURES).find(([prompt]) => userText.includes(prompt))?.[1]
  const responseText = fixture?.response || 'Jag förstår inte din förfrågan. Kan du vara mer specifik?'

  return new MockLanguageModelV3({
    provider: 'fake-provider',
    modelId: 'fake-model',
    doStream: async () => {
      const chunks: LanguageModelV3StreamPart[] = [
        { type: 'text-delta', id: 'msg-1', delta: responseText }
      ]

      if (fixture?.toolCall) {
        const toolArgsString = JSON.stringify(fixture.toolCall.args)
        chunks.push(
          { type: 'tool-call', toolCallId: 'tc-1', toolName: fixture.toolCall.name, input: toolArgsString }
        )
      }

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
          }
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
