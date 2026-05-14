import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export const runtime = 'edge'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    system: 'Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.',
    messages,
  })

  return result.toTextStreamResponse()
}
