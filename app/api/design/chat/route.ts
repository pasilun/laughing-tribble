import { streamText, convertToModelMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export const runtime = 'edge'

const CHAT_MODEL = 'claude-sonnet-4-5'

const FIXTURES: Record<
  string,
  { toolCalls: { args: { flowType?: string; footprint?: { length?: number; width?: number } } }[]; response: string }
> = {
  'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred': {
    toolCalls: [
      {
        args: {
          flowType: 'komplementbyggnad',
          footprint: { length: 4.5, width: 4.5 },
        },
      },
    ],
    response: 'Jag hjälper dig att bygga en komplementbyggnad med måtten 4,5 x 4,5 meter.',
  },
  'Ändra längden till 5 meter': {
    toolCalls: [
      {
        args: {
          footprint: { length: 5 },
        },
      },
    ],
    response: 'Uppfattat, jag ändrar längden till 5 meter.',
  },
}

async function createFakeStream(prompt: string, signal?: AbortSignal) {
  const fixture = FIXTURES[prompt]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      if (signal?.aborted) {
        controller.close()
        return
      }

      if (fixture) {
        for (const call of fixture.toolCalls) {
          const toolCallData = JSON.stringify({
            type: 'tool-input-available',
            toolCallId: `call_${Math.random().toString(36).substring(7)}`,
            toolName: 'set_building',
            input: call.args,
          })
          controller.enqueue(encoder.encode(`data: ${toolCallData}\n\n`))
        }

        const messageId = `msg_${Math.random().toString(36).substring(7)}`
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-start', id: messageId })}\n\n`))

        for (const char of fixture.response) {
          if (signal?.aborted) {
            controller.close()
            return
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: char, id: messageId })}\n\n`),
          )
          await new Promise((resolve) => setTimeout(resolve, 30))
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-end', id: messageId })}\n\n`))
      } else {
        const fallbackResponse =
          'Jag förstår. Berätta gärna mer om ditt byggprojekt så hjälper jag dig vidare.'
        const messageId = `msg_${Math.random().toString(36).substring(7)}`
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-start', id: messageId })}\n\n`))

        for (const char of fallbackResponse) {
          if (signal?.aborted) {
            controller.close()
            return
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: char, id: messageId })}\n\n`),
          )
          await new Promise((resolve) => setTimeout(resolve, 30))
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-end', id: messageId })}\n\n`))
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return stream
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const lastMessage = messages[messages.length - 1]
    let userPrompt = ''

    if (lastMessage?.content) {
      if (typeof lastMessage.content === 'string') {
        userPrompt = lastMessage.content
      } else if (Array.isArray(lastMessage.content)) {
        userPrompt = lastMessage.content
          .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
          .map((c: { type: string; text?: string }) => c.text || '')
          .join('')
      }
    }

    if (process.env.VERCEL_ENV !== 'production') {
      const stream = await createFakeStream(userPrompt, req.signal)
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

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
