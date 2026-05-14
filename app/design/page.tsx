'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function DesignPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/design/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMessage] }),
      })

      if (!response.ok) throw new Error('Failed to send message')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      }

      setMessages((prev) => [...prev, assistantMessage])

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break

            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: msg.content + parsed.content }
                      : msg
                  )
                )
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: 'Ett fel uppstod. Försök igen senare.',
        },
      ])
    } finally {
      setIsLoading(false)
    }
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
                  {message.content}
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