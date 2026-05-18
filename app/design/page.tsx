'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useRef, useState } from 'react'

type BuildingModel = {
  flowType?: string
  footprint?: {
    length?: number
    width?: number
  }
}

export default function DesignPage() {
  const [buildingModel, setBuildingModel] = useState<BuildingModel | null>(null)
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/design/chat' }),
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === 'set_building') {
        try {
          const args = typeof toolCall.input === 'string'
            ? JSON.parse(toolCall.input) as BuildingModel
            : toolCall.input as BuildingModel
          setBuildingModel((prev) => ({
            ...prev,
            ...args,
            footprint: {
              ...prev?.footprint,
              ...args.footprint
            }
          }))
        } catch (err) {
          console.error('Failed to parse tool args:', err)
        }
      }
    }
  })
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    sendMessage({ text })
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-black font-sans">
      <header className="flex-shrink-0 px-6 py-4 bg-white dark:bg-black border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Design
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Building Model</h2>
            <pre data-testid="model-state" className="text-xs bg-zinc-50 dark:bg-black p-2 rounded overflow-x-auto">
              {buildingModel ? JSON.stringify(buildingModel, null, 2) : 'null'}
            </pre>
          </div>

          {messages.length === 0 && (
            <p className="text-zinc-600 dark:text-zinc-400 text-center py-8">
              Beskriv ditt projekt så hjälper jag dig att komma igång
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              data-testid={message.role === 'assistant' ? 'assistant-message' : undefined}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                    : 'bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {message.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { type: 'text'; text: string }).text)
                    .join('')}
                </p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-900 rounded-2xl px-4 py-3 border border-zinc-200 dark:border-zinc-700">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce delay-200" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex-shrink-0 px-6 py-3 bg-red-50 dark:bg-red-950 text-sm text-red-700 dark:text-red-300 border-t border-red-200 dark:border-red-900"
        >
          Något gick fel. Försök igen.
        </div>
      )}

      <div className="flex-shrink-0 p-6 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Beskriv vad du vill bygga..."
              disabled={isLoading}
              className="flex-1 px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50"
              data-testid="chat-input"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 py-3 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="send-button"
            >
              Skicka
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
