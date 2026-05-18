import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export const runtime = 'edge'

const CHAT_MODEL = 'claude-sonnet-4-5'

interface BuildingArgs {
  flowType?: string
  footprint?: { length?: number; width?: number }
}

const FIXTURES: Record<
  string,
  { toolCalls: BuildingArgs[]; response: string }
> = {
  'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred': {
    toolCalls: [
      {
        flowType: 'komplementbyggnad',
        footprint: { length: 4.5, width: 4.5 },
      },
    ],
    response:
      'Jag hjälper dig att bygga en komplementbyggnad med måtten 4,5 x 4,5 meter.',
  },
  'Ändra längden till 5 meter': {
    toolCalls: [
      {
        footprint: { length: 5 },
      },
    ],
    response: 'Uppfattat, jag ändrar längden till 5 meter.',
  },
}

function extractUserText(messages: unknown[]): string {
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined
  if (!last) return ''
  const parts = last.parts as Array<Record<string, unknown>> | undefined
  if (Array.isArray(parts)) {
    return parts
      .filter(
        (p) => p.type === 'text' && typeof p.text === 'string' && p.text,
      )
      .map((p) => p.text as string)
      .join('')
  }
  const content = last.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (c: Record<string, unknown>) =>
          c.type === 'text' && typeof c.text === 'string' && c.text,
      )
      .map((c: Record<string, unknown>) => c.text as string)
      .join('')
  }
  return ''
}

function createFakeResponse(prompt: string): Response {
  const fixture = FIXTURES[prompt]
  const responseText =
    fixture?.response ??
    'Jag förstår. Berätta gärna mer om ditt byggprojekt.'
  const toolCalls = fixture?.toolCalls ?? []

  const stream = createUIMessageStream({
    execute({ writer }) {
      for (let i = 0; i < toolCalls.length; i++) {
        writer.write({
          type: 'tool-input-available',
          toolCallId: `call_${i}_${Date.now()}`,
          toolName: 'set_building',
          input: toolCalls[i],
        })
      }

      const textId = `txt_${Date.now()}`
      writer.write({ type: 'text-start', id: textId })
      writer.write({ type: 'text-delta', delta: responseText, id: textId })
      writer.write({ type: 'text-end', id: textId })
    },
  })

  return createUIMessageStreamResponse({ stream })
}

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: unknown[] }
    const userPrompt = extractUserText(messages)

    if (process.env.VERCEL_ENV !== 'production') {
      return createFakeResponse(userPrompt)
    }

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system:
        'Du är en hjälpsam assistent för bygglovsfrågor. Svara på svenska.',
      messages: await convertToModelMessages(
        messages as Parameters<typeof convertToModelMessages>[0],
      ),
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
