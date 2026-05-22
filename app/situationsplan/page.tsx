'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { jsPDF } from 'jspdf'
import { Suspense } from 'react'

type ImageDims = {
  naturalWidth: number
  naturalHeight: number
  renderedWidth: number
  renderedHeight: number
}

type RectPos = {
  x: number
  y: number
}

const MIN_SETBACK = 4.5

function SituationsplanContent() {
  const searchParams = useSearchParams()

  const urlLength = searchParams.get('l') ? parseFloat(searchParams.get('l')!) : null
  const urlWidth = searchParams.get('w') ? parseFloat(searchParams.get('w')!) : null
  const hasUrlParams = urlLength !== null && urlWidth !== null

  const [mapSrc, setMapSrc] = useState<string | null>(null)
  const [imageDims, setImageDims] = useState<ImageDims | null>(null)
  const [propertyWidthM, setPropertyWidthM] = useState<number>(30)
  const [footprintLength, setFootprintLength] = useState<number | null>(urlLength)
  const [footprintWidth, setFootprintWidth] = useState<number | null>(urlWidth)
  const [showBuilding, setShowBuilding] = useState(hasUrlParams)
  const [rectPos, setRectPos] = useState<RectPos | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null)

  const pxPerM = imageDims ? imageDims.naturalWidth / propertyWidthM : null

  const scaleX = imageDims ? imageDims.renderedWidth / imageDims.naturalWidth : 1
  const scaleY = imageDims ? imageDims.renderedHeight / imageDims.naturalHeight : 1

  const rectW = pxPerM && footprintLength ? footprintLength * pxPerM : null
  const rectH = pxPerM && footprintWidth ? footprintWidth * pxPerM : null

  const buildingRect = useMemo(() => {
    if (!showBuilding || !rectW || !rectH || !imageDims) return null
    return {
      x: rectPos?.x ?? (imageDims.naturalWidth - rectW) / 2,
      y: rectPos?.y ?? (imageDims.naturalHeight - rectH) / 2,
      w: rectW,
      h: rectH,
    }
  }, [showBuilding, rectW, rectH, imageDims, rectPos])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setMapSrc(url)
    setRectPos(null)
  }

  function handleImageLoad() {
    const img = imgRef.current
    if (!img) return
    setImageDims({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: img.clientWidth,
      renderedHeight: img.clientHeight,
    })
  }

  function handleAddBuilding() {
    if (!imageDims || !pxPerM) return
    if (!footprintLength) setFootprintLength(10)
    if (!footprintWidth) setFootprintWidth(5)
    setRectPos(null)
    setShowBuilding(true)
  }

  const dragState = useRef<{
    startMouseX: number
    startMouseY: number
    startRectX: number
    startRectY: number
  } | null>(null)

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    if (!buildingRect) return
    dragState.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startRectX: buildingRect.x,
      startRectY: buildingRect.y,
    }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current || !buildingRect || !imageDims) return
    const dx = (e.clientX - dragState.current.startMouseX) / scaleX
    const dy = (e.clientY - dragState.current.startMouseY) / scaleY
    const newX = Math.max(0, Math.min(imageDims.naturalWidth - buildingRect.w, dragState.current.startRectX + dx))
    const newY = Math.max(0, Math.min(imageDims.naturalHeight - buildingRect.h, dragState.current.startRectY + dy))
    setRectPos({ x: newX, y: newY })
  }, [buildingRect, imageDims, scaleX, scaleY])

  const handleMouseUp = useCallback(() => {
    dragState.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const distances = buildingRect && imageDims && pxPerM ? {
    north: buildingRect.y / pxPerM,
    south: (imageDims.naturalHeight - buildingRect.y - buildingRect.h) / pxPerM,
    west: buildingRect.x / pxPerM,
    east: (imageDims.naturalWidth - buildingRect.x - buildingRect.w) / pxPerM,
  } : null

  function fmt(v: number) {
    return `${v.toFixed(1)} m`
  }

  async function handleExportPDF() {
    if (!mapSrc || !buildingRect || !imageDims || !pxPerM) return

    const canvas = hiddenCanvasRef.current
    if (!canvas) return

    canvas.width = imageDims.naturalWidth
    canvas.height = imageDims.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = mapSrc
    await new Promise<void>((resolve) => { img.onload = () => resolve() })

    ctx.drawImage(img, 0, 0, imageDims.naturalWidth, imageDims.naturalHeight)

    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = 3
    ctx.strokeRect(buildingRect.x, buildingRect.y, buildingRect.w, buildingRect.h)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'
    ctx.fillRect(buildingRect.x, buildingRect.y, buildingRect.w, buildingRect.h)

    if (distances) {
      const fs = Math.max(14, imageDims.naturalWidth / 40)
      ctx.fillStyle = '#000'
      ctx.font = `${fs}px sans-serif`

      const cx = buildingRect.x + buildingRect.w / 2
      const cy = buildingRect.y + buildingRect.h / 2

      ctx.fillText(fmt(distances.north), cx, buildingRect.y - 5)
      ctx.fillText(fmt(distances.south), cx, buildingRect.y + buildingRect.h + fs + 5)
      ctx.fillText(fmt(distances.west), 5, cy)
      ctx.fillText(fmt(distances.east), buildingRect.x + buildingRect.w + 5, cy)
    }

    const scaleBarPx = 10 * pxPerM
    const barX = 20
    const barY = imageDims.naturalHeight - 40
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(barX, barY)
    ctx.lineTo(barX + scaleBarPx, barY)
    ctx.stroke()
    ctx.fillStyle = '#000'
    ctx.font = '14px sans-serif'
    ctx.fillText('10 m', barX, barY - 5)

    const arrowX = imageDims.naturalWidth - 60
    const arrowY = 40
    ctx.fillStyle = '#000'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('N ↑', arrowX, arrowY)

    ctx.font = '12px sans-serif'
    const dateStr = new Date().toLocaleDateString('sv-SE')
    ctx.fillText(dateStr, imageDims.naturalWidth / 2 - 30, imageDims.naturalHeight - 10)

    const dataUrl = canvas.toDataURL('image/png')

    const aspectRatio = imageDims.naturalWidth / imageDims.naturalHeight
    const pageW = 297
    const pageH = pageW / aspectRatio
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, Math.max(pageH, 100)] })
    doc.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH)
    doc.save('situationsplan.pdf')
  }

  const renderedRectStyle = buildingRect && imageDims ? {
    position: 'absolute' as const,
    left: `${buildingRect.x * scaleX}px`,
    top: `${buildingRect.y * scaleY}px`,
    width: `${buildingRect.w * scaleX}px`,
    height: `${buildingRect.h * scaleY}px`,
    border: '2px solid #ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    cursor: 'move',
    boxSizing: 'border-box' as const,
  } : {}

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans">
      <div
        data-testid="desktop-notice"
        className="md:hidden bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm"
      >
        Situationsplanen är optimerad för datorer. På smala skärmar kan det vara svårt att använda drag-funktionen.
      </div>

      <header className="px-6 py-4 bg-white dark:bg-black border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Situationsplan</h1>
      </header>

      <main className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="map-upload-input">
                Fastighetskarta (PNG/JPEG)
              </label>
              <input
                id="map-upload-input"
                data-testid="map-upload"
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleFileChange}
                className="block text-sm text-zinc-600 dark:text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="property-width-input">
                Fastighetens bredd (m)
              </label>
              <input
                id="property-width-input"
                data-testid="property-width-input"
                type="number"
                min="1"
                step="0.1"
                value={propertyWidthM}
                onChange={(e) => setPropertyWidthM(parseFloat(e.target.value) || 1)}
                className="w-32 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </div>

            {!hasUrlParams && (
              <button
                data-testid="add-building-btn"
                type="button"
                onClick={handleAddBuilding}
                disabled={!mapSrc || !imageDims}
                className="px-4 py-2 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 rounded font-medium text-sm hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Lägg till byggnad
              </button>
            )}

            {buildingRect && (
              <button
                data-testid="export-pdf-btn"
                type="button"
                onClick={handleExportPDF}
                className="px-4 py-2 bg-blue-700 text-white rounded font-medium text-sm hover:bg-blue-800"
              >
                Exportera PDF
              </button>
            )}
          </div>
        </div>

        {distances && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Avstånd till fastighetsgränser</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['north', 'south', 'east', 'west'] as const).map((dir) => {
                const val = distances[dir]
                const isTooClose = val < MIN_SETBACK
                const label = { north: 'Norr', south: 'Söder', east: 'Öster', west: 'Väster' }[dir]
                return (
                  <div key={dir} className="space-y-1 text-center">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
                    <div
                      data-testid={`dist-${dir}`}
                      className={`text-base font-semibold ${isTooClose ? 'text-red-600' : 'text-zinc-900 dark:text-zinc-50'}`}
                    >
                      {fmt(val)}
                    </div>
                    {isTooClose && (
                      <div
                        data-testid="dist-warning"
                        className="text-xs text-red-600 font-medium"
                      >
                        &lt; 4.5 m
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div
          data-testid="map-canvas"
          ref={canvasRef}
          className="relative bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
          style={{ minHeight: mapSrc ? undefined : '300px' }}
        >
          {!mapSrc && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-sm">
              Ladda upp en fastighetskarta för att börja
            </div>
          )}
          {mapSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={mapSrc}
              alt="Fastighetskarta"
              onLoad={handleImageLoad}
              className="block w-full h-auto"
            />
          )}
          {buildingRect && imageDims && (
            <div
              data-testid="building-rect"
              style={renderedRectStyle}
              onMouseDown={handleMouseDown}
            />
          )}
        </div>
      </main>

      <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
    </div>
  )
}

export default function SituationsplanPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-400">Laddar...</div>}>
      <SituationsplanContent />
    </Suspense>
  )
}
