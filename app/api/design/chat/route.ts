import { streamText, convertToModelMessages, jsonSchema } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

const CHAT_MODEL = 'claude-sonnet-4-5'

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  
  if (!apiKey) {
    console.error('[chat] ANTHROPIC_API_KEY is not configured')
    return new Response(
      JSON.stringify({ 
        error: 'AI service not configured. Please set ANTHROPIC_API_KEY environment variable.' 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
  
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: 'Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.',
      messages: await convertToModelMessages(messages),
      tools: {
        set_building: {
          description: 'Uppdatera parametrar för byggnaden baserat på vad användaren beskriver. Detta är en partiell uppdatering — uppdatera bara de fält som explicit nämns eller korrigeras.',
          inputSchema: jsonSchema({
            type: 'object',
            properties: {
              flowType: {
                type: 'string',
                description: 'Typ av byggnad (t.ex. "komplementbyggnad", "friggebod", "attefallshus")'
              },
              footprint: {
                type: 'object',
                properties: {
                  length: {
                    type: 'number',
                    description: 'Längd i meter'
                  },
                  width: {
                    type: 'number',
                    description: 'Bredd i meter'
                  }
                },
                required: ['length', 'width']
              }
            },
            required: []
          }),
          execute: async (args) => {
            return JSON.stringify(args)
          }
        }
      },
      toolChoice: 'auto'
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
