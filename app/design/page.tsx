'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useRef, useState } from 'react'
import { BuildingModel } from '@/types/building'
import { FloorPlanSVG } from '@/components/FloorPlanSVG'
import { runTriage } from '@/lib/triage'

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
  const triage = runTriage(buildingModel)
  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
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

      {/* Split panel body — flex-1 with min-h-0 so children can scroll independently.
          Outer overflow must be visible; each panel owns its own scroll. */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 sm:p-6">

        {/* Vis + model panel — collapsible, stuck to the top of its column.
            On mobile: order-first (pinned top bar). On desktop: right column. */}
        <div
          data-testid="model-state-panel-wrapper"
          className="order-first md:order-last w-full md:w-80 flex-shrink-0 max-h-[50vh] overflow-y-auto md:max-h-none md:overflow-y-auto"
        >
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              data-testid="panel-toggle"
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Modell &amp; ritning</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {panelOpen ? 'Dölj ▲' : 'Visa ▼'}
              </span>
            </button>

            {panelOpen && (
              <div data-testid="panel-body" className="px-4 pb-4 space-y-4">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Lovplikt</h3>
                  {triage.bucket && (
                    <div
                      data-testid="triage-bucket"
                      className={`flex items-center gap-2 text-sm font-semibold ${
                        triage.bucket === 'LOVFRI'
                          ? 'text-green-700 dark:text-green-400'
                          : triage.bucket === 'ANMÄLAN'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          triage.bucket === 'LOVFRI'
                            ? 'bg-green-500'
                            : triage.bucket === 'ANMÄLAN'
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                      />
                      {triage.bucket}
                    </div>
                  )}
                  {triage.reasons.length > 0 && (
                    <ul data-testid="triage-reasons" className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1 list-disc list-inside">
                      {triage.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  {triage.incomplete && (
                    <p data-testid="triage-incomplete" className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                      Mer information behövs för att bedöma lovplikt
                    </p>
                  )}
                </div>
                <FloorPlanSVG model={buildingModel} />

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
              </div>
            )}

            {/* Machine-readable model state for regression tests (not shown to users) */}
            <pre data-testid="model-state" className="sr-only">
              {buildingModel ? JSON.stringify(buildingModel, null, 2) : 'null'}
            </pre>
          </div>
        </div>

        {/* Chat panel — scrollable, fills remaining space */}
        <div className="flex-1 min-h-0 overflow-y-auto order-last md:order-first">
          <div className="w-full max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && (
              <p className="text-zinc-600 dark:text-zinc-400 text-center py-8">
                Beskriv ditt projekt så hjälper jag dig att komma igång
              </p>
            )}
            {messages.map((message) => {
              const text = message.parts
                .filter((p) => p.type === 'text')
                .map((p) => (p as { type: 'text'; text: string }).text)
                .join('')
              if (message.role === 'assistant' && !text.trim()) return null
              return (
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
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
                  </div>
                </div>
              )
            })}
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
