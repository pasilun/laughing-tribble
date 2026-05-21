'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useRef, useState } from 'react'
import { BuildingModel } from '@/types/building'
import { FloorPlanSVG } from '@/components/FloorPlanSVG'

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
      <header className="flex-shrink-0 px-6 py-4 bg-white dark:bg-black border-b border-zinc-200 dark:border-zinc-800" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Design
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-full mx-auto overflow-hidden">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            <div className="md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-theme(spacing.8))] md:overflow-y-auto overflow-hidden w-full md:w-80 flex-shrink-0 md:order-1">
              <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">Modellstatus</h2>
                <div data-testid="model-state-panel" className="space-y-2 text-sm">
                  <div data-testid="field-flowType" className={buildingModel?.flowType ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Byggnadstyp:</span>{' '}
                    {buildingModel?.flowType || <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-footprint" className={buildingModel?.footprint?.length && buildingModel?.footprint?.width ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Grundplan:</span>{' '}
                    {buildingModel?.footprint?.length && buildingModel?.footprint?.width
                      ? `${buildingModel.footprint.length} m × ${buildingModel.footprint.width} m`
                      : <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-roof-type" className={buildingModel?.roof ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Taktyp:</span>{' '}
                    {buildingModel?.roof?.type || <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-roof-pitch" className={buildingModel?.roof?.pitch ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Taklutning:</span>{' '}
                    {buildingModel?.roof?.pitch !== undefined && buildingModel.roof.pitch !== null
                      ? `${buildingModel.roof.pitch}°`
                      : <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-wallHeight" className={buildingModel?.wallHeight ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Vägghöjd:</span>{' '}
                    {buildingModel?.wallHeight ? `${buildingModel.wallHeight} m` : <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-installations" className={buildingModel?.installations && buildingModel.installations.length > 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Installationer:</span>{' '}
                    {buildingModel?.installations && buildingModel.installations.length > 0
                      ? buildingModel.installations.join(', ')
                      : <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-inomDetaljplan" className={buildingModel?.inomDetaljplan !== undefined ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Detaljplan:</span>{' '}
                    {buildingModel?.inomDetaljplan !== undefined
                      ? buildingModel.inomDetaljplan ? 'Ja' : 'Nej'
                      : <span className="italic">Ej angivet</span>}
                  </div>
                  <div data-testid="field-distanceToGrans" className={buildingModel?.distanceToGrans ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600'}>
                    <span className="font-medium">Avstånd till tomtgräns:</span>{' '}
                    {buildingModel?.distanceToGrans ? `${buildingModel.distanceToGrans} m` : <span className="italic">Ej angivet</span>}
                  </div>
                </div>
                <pre data-testid="model-state" className="mt-4 text-xs bg-zinc-50 dark:bg-black p-2 rounded overflow-x-auto max-w-full">
                  {buildingModel ? JSON.stringify(buildingModel, null, 2) : 'null'}
                </pre>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="w-full max-w-3xl mx-auto space-y-6 overflow-hidden flex-1 overflow-y-auto">
                <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Floor Plan</h2>
                  <FloorPlanSVG model={buildingModel} />
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
                      className={`max-w-[80%] rounded-2xl px-4 py-3 overflow-hidden ${
                        message.role === 'user'
                          ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                          : 'bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700'
                      }`}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap overflow-hidden">
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
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl px-4 py-3 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
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
          </div>
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

      <div className="flex-shrink-0 p-4 sm:p-6 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="w-full max-w-3xl mx-auto overflow-hidden">
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
