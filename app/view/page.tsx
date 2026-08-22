'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { BuildingModelV2 } from '@/types/building-v2'
import { generateIFC } from '@/lib/ifc-generator'
import { FloorPlanV2, StatsPanel } from '@/components/floor-plan-v2'

const GLTFViewer = dynamic(() => import('@/components/GLTFViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-400 text-sm">
      Laddar 3D-visare…
    </div>
  ),
})

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ViewPage() {
  const [model, setModel] = useState<BuildingModelV2 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [glbUrl, setGlbUrl] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // ?file=<name> takes precedence over #hash
      const params = new URLSearchParams(window.location.search)
      const file = params.get('file')

      if (file) {
        const res = await fetch(`/models/${file}.json`)
        if (!res.ok) throw new Error(`Model not found: ${file}`)
        const model = await res.json() as BuildingModelV2
        setModel(model)
        return
      }

      const id = params.get('id')
      if (id) {
        const res = await fetch(`/api/model/${id}`)
        if (!res.ok) throw new Error(`Model not found: ${id}`)
        const model = await res.json() as BuildingModelV2
        setModel(model)
        return
      }

      // Strip any trailing chars that aren't valid base64url (e.g. punctuation added by renderers)
      const hash = window.location.hash.slice(1).replace(/[^A-Za-z0-9\-_]+$/, '')
      if (!hash) {
        setError('Ingen byggnadsmodell i URL')
        return
      }

      // base64url → Uint8Array
      const b64 = hash.replace(/-/g, '+').replace(/_/g, '/')
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // DecompressionStream (browser native, no pako needed)
      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      writer.write(bytes)
      writer.close()

      const buf = await new Response(ds.readable).arrayBuffer()
      const text = new TextDecoder().decode(buf)
      setModel(JSON.parse(text) as BuildingModelV2)
    }
    load().catch((e) => setError(String(e)))
  }, [])

  const ifcContent = useMemo(() => (model ? generateIFC(model) : ''), [model])

  useEffect(() => {
    if (!ifcContent) return
    let objectUrl: string | null = null

    fetch('/api/convert', {
      method: 'POST',
      body: ifcContent,
      headers: { 'Content-Type': 'text/plain' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText)
          throw new Error(`Convert failed (${res.status}): ${msg}`)
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setConvertError(null)
        setGlbUrl(objectUrl)
      })
      .catch((e) => {
        setConvertError(String(e))
      })

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ifcContent])

  const handleDownload = useCallback(() => {
    if (!model) return
    const blob = new Blob([ifcContent], { type: 'application/x-step' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${model.name ?? 'byggnad'}.ifc`
    a.click()
    URL.revokeObjectURL(url)
  }, [ifcContent, model])

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-red-600 dark:text-red-400 text-sm font-medium mb-2">Fel vid laddning</p>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans flex items-center justify-center">
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">Laddar byggnadsmodell…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {model.name}
          </h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* Floor plan */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
            2D Planritning
          </h2>
          <FloorPlanV2 model={model} />
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Blå = dörr (öppningsriktning), Gult = fönster
          </p>
        </section>

        {/* 3D model */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            3D-modell
          </h2>
          <GLTFViewer glbUrl={glbUrl ?? ''} />
          {convertError && (
            <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-2 py-1">
              {convertError}
            </p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Renderas via IfcConvert + three.js GLTFLoader — konverteras server-side.
          </p>
        </section>

        {/* Stats */}
        <section className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">
            Byggnadsdata
          </h2>
          <StatsPanel model={model} />
        </section>

        {/* Download */}
        <section className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
            IFC-fil
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            Genererar ett IFC4 STEP-format direkt i webbläsaren. Filen kan öppnas i IFC-visare som
            BIMvision, Solibri eller IFC.js.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
            >
              Ladda ned .ifc
            </button>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 self-center">
              {(ifcContent.length / 1024).toFixed(1)} KB · IFC4 STEP ·{' '}
              {model.walls.reduce((s, l) => s + l.edges.length, 0)} väggar ·{' '}
              {model.openings.length} öppningar
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
