import { streamText, convertToModelMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export const runtime = 'edge'

// Single place to change the chat model.
const CHAT_MODEL = 'claude-sonnet-4-5'

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: 'Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.',
      messages: await convertToModelMessages(messages),
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
