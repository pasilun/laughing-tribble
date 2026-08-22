'use client'

import React, { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
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

type CasePayload = {
  id: string
  description?: string
  model: BuildingModelV2
}

export default function ReviewCasePage() {
  const params = useParams<{ case: string }>()
  const caseId = params?.case ?? ''
  const [payload, setPayload] = useState<CasePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planReady, setPlanReady] = useState(false)
  const [isoReady, setIsoReady] = useState(false)
  const [topReady, setTopReady] = useState(false)
  const [northReady, setNorthReady] = useState(false)
  const [cutawayReady, setCutawayReady] = useState(false)

  useEffect(() => {
    if (!caseId) {
      const t = setTimeout(() => setError('No case id in URL'), 0)
      return () => clearTimeout(t)
    }
    let alive = true
    fetch(`/api/review-model/${encodeURIComponent(caseId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<CasePayload>
      })
      .then((data) => {
        if (alive) setPayload(data)
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
  }, [caseId])

  const model = payload?.model ?? null

  useEffect(() => {
    if (!model) return
    const raf = requestAnimationFrame(() => setPlanReady(true))
    return () => cancelAnimationFrame(raf)
  }, [model])

  useEffect(() => {
    document.body.dataset.renderState = error
      ? 'error'
      : planReady && isoReady && topReady && northReady && cutawayReady
        ? 'complete'
        : 'loading'
  }, [planReady, isoReady, topReady, northReady, cutawayReady, error])

  const [glbUrl, setGlbUrl] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
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
        setError(String(e))
      })

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ifcContent])

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 font-sans p-6 flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100" data-shot="case-title">
          {payload ? payload.model.name : caseId}
        </h1>
        {payload?.description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl mt-1" data-shot="description">
            {payload.description}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2" data-shot="error">
            Fel: {error}
          </p>
        )}
      </header>

      {model && (
        <>
          <section className="max-w-4xl">
            <div data-shot="plan">
              <FloorPlanV2 model={model} />
            </div>
          </section>

          <section className="max-w-4xl">
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-2">3D — sydost, fågelperspektiv</h2>
            <div data-shot="iso">
              <GLTFViewer
                glbUrl={glbUrl ?? ''}
                deterministic
                onReady={() => setIsoReady(true)}
                onError={() => setIsoReady(false)}
              />
            </div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mt-4 mb-2">3D — uppifrån</h2>
            <div data-shot="top">
              <GLTFViewer
                glbUrl={glbUrl ?? ''}
                deterministic
                pose="top"
                onReady={() => setTopReady(true)}
              />
            </div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mt-4 mb-2">3D — norr</h2>
            <div data-shot="north">
              <GLTFViewer
                glbUrl={glbUrl ?? ''}
                deterministic
                pose="n"
                onReady={() => setNorthReady(true)}
              />
            </div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mt-4 mb-2">3D — genomskärning (utan tak)</h2>
            <div data-shot="cutaway">
              <GLTFViewer
                glbUrl={glbUrl ?? ''}
                deterministic
                pose="top"
                hideAboveZ={model.walls[0]?.edges[0]?.height ?? 2.5}
                onReady={() => setCutawayReady(true)}
              />
            </div>
            {convertError && (
              <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-2 py-1">
                {convertError}
              </p>
            )}
          </section>

          <section className="max-w-4xl bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5" data-shot="stats">
            <StatsPanel model={model} />
          </section>
        </>
      )}
    </div>
  )
}
