'use client'

import { useRef, useState, useCallback } from 'react'

interface BuildingRect {
  x: number
  y: number
  width: number
  height: number
}

const BUILDING_DEFAULT_WIDTH = 120
const BUILDING_DEFAULT_HEIGHT = 120
const PIXELS_PER_METRE = 30

export default function SituationsplanPage() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [buildingRect, setBuildingRect] = useState<BuildingRect | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const distances = buildingRect && imageDimensions.width > 0 ? {
    north: buildingRect.y / PIXELS_PER_METRE,
    south: (imageDimensions.height - buildingRect.y - buildingRect.height) / PIXELS_PER_METRE,
    east: buildingRect.x / PIXELS_PER_METRE,
    west: (imageDimensions.width - buildingRect.x - buildingRect.width) / PIXELS_PER_METRE,
  } : null

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height })
        setUploadedImage(event.target?.result as string)
        setBuildingRect(null)
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }, [])

  const handleAddBuilding = useCallback(() => {
    if (!uploadedImage || imageDimensions.width === 0) return

    const centerX = imageDimensions.width / 2 - BUILDING_DEFAULT_WIDTH / 2
    const centerY = imageDimensions.height / 2 - BUILDING_DEFAULT_HEIGHT / 2

    setBuildingRect({
      x: centerX,
      y: centerY,
      width: BUILDING_DEFAULT_WIDTH,
      height: BUILDING_DEFAULT_HEIGHT,
    })
  }, [uploadedImage, imageDimensions])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!buildingRect) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (x >= buildingRect.x && x <= buildingRect.x + buildingRect.width &&
        y >= buildingRect.y && y <= buildingRect.y + buildingRect.height) {
      setIsDragging(true)
      setDragOffset({
        x: x - buildingRect.x,
        y: y - buildingRect.y,
      })
    }
  }, [buildingRect])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !buildingRect) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left - dragOffset.x
    const y = e.clientY - rect.top - dragOffset.y

    const maxX = imageDimensions.width - buildingRect.width
    const maxY = imageDimensions.height - buildingRect.height

    setBuildingRect({
      ...buildingRect,
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    })
  }, [isDragging, buildingRect, dragOffset, imageDimensions])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleExportPDF = useCallback(async () => {
    if (!uploadedImage || !buildingRect || !canvasRef.current) return

    try {
      // @ts-expect-error - jspdf will be installed via npm install
      const { jsPDF: JsPDF } = await import('jspdf')
      const pdf = new JsPDF('landscape', 'mm', 'a4')
      
      const pageWidth = 297
      const pageHeight = 210
      const margin = 20

      const availableWidth = pageWidth - 2 * margin
      const availableHeight = pageHeight - 2 * margin - 30
      
      const scaleX = availableWidth / imageDimensions.width
      const scaleY = availableHeight / imageDimensions.height
      const scale = Math.min(scaleX, scaleY, 1)

      const imageWidth = imageDimensions.width * scale
      const imageHeight = imageDimensions.height * scale

      const img = new Image()
      img.src = uploadedImage
      await new Promise((resolve) => {
        img.onload = resolve
        img.onerror = resolve
      })

      pdf.addImage(uploadedImage, 'PNG', margin, margin, imageWidth, imageHeight)

      const rectX = margin + buildingRect.x * scale
      const rectY = margin + buildingRect.y * scale
      const rectWidth = buildingRect.width * scale
      const rectHeight = buildingRect.height * scale

      pdf.setLineWidth(1.5)
      pdf.setDrawColor(200, 50, 50)
      pdf.rect(rectX, rectY, rectWidth, rectHeight)

      const labelY = margin + imageHeight + 10
      pdf.setFontSize(10)
      pdf.setTextColor(100, 100, 100)
      pdf.text('N', 15, labelY)
      pdf.text('S', 15, labelY + 8)
      pdf.text('E', 23, labelY + 4)
      pdf.text('W', 7, labelY + 4)
      
      pdf.setLineWidth(0.5)
      pdf.line(10, labelY, 10, labelY + 8)
      pdf.line(7, labelY + 4, 23, labelY + 4)
      pdf.line(15, labelY, 13, labelY + 2)
      pdf.line(15, labelY, 17, labelY + 2)

      pdf.line(pageWidth - 40, labelY + 6, pageWidth - 20, labelY + 6)
      pdf.line(pageWidth - 40, labelY + 3, pageWidth - 40, labelY + 9)
      pdf.line(pageWidth - 20, labelY + 3, pageWidth - 20, labelY + 9)
      pdf.text('0m', pageWidth - 42, labelY + 4)
      pdf.text(`${Math.round(imageWidth / 10)}m`, pageWidth - 20, labelY + 4)

      pdf.save('situationsplan.pdf')
    } catch (error) {
      console.error('Failed to export PDF:', error)
    }
  }, [uploadedImage, buildingRect, imageDimensions])

  const canAddBuilding = uploadedImage !== null
  const canExportPDF = uploadedImage !== null && buildingRect !== null

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-5xl flex-col items-center py-12 px-4 bg-white dark:bg-black">
        <h1 className="text-4xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50 mb-8">
          Situationsplan
        </h1>

        <div className="w-full max-w-3xl flex flex-col gap-6">
          {!uploadedImage ? (
            <div className="w-full">
              <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                Ladda upp fastighetskarta
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                data-testid="map-upload"
                className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500"
              />
            </div>
          ) : (
            <>
              <div className="flex gap-3 mb-2">
                <button
                  onClick={handleAddBuilding}
                  disabled={!canAddBuilding}
                  data-testid="add-building-btn"
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    canAddBuilding
                      ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100'
                      : 'bg-zinc-300 text-zinc-500 cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-500'
                  }`}
                >
                  Lägg till byggnad
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={!canExportPDF}
                  data-testid="export-pdf-btn"
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    canExportPDF
                      ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100'
                      : 'bg-zinc-300 text-zinc-500 cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-500'
                  }`}
                >
                  Exportera PDF
                </button>
              </div>

              <div
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                data-testid="map-canvas"
                className="relative w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden"
                style={{
                  aspectRatio: `${imageDimensions.width} / ${imageDimensions.height}`,
                  maxHeight: '70vh',
                }}
              >
                {uploadedImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={uploadedImage}
                    alt="Fastighetskarta"
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                )}
                
                {buildingRect && (
                  <>
                    <div
                      data-testid="building-rect"
                      className="absolute border-4 border-red-500 bg-red-500/20 cursor-move"
                      style={{
                        left: `${(buildingRect.x / imageDimensions.width) * 100}%`,
                        top: `${(buildingRect.y / imageDimensions.height) * 100}%`,
                        width: `${(buildingRect.width / imageDimensions.width) * 100}%`,
                        height: `${(buildingRect.height / imageDimensions.height) * 100}%`,
                      }}
                    />
                    <div className="absolute top-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {distances && `${distances.north.toFixed(1)}m`}
                    </div>
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {distances && `${distances.south.toFixed(1)}m`}
                    </div>
                    <div className="absolute top-1/2 right-2 -translate-y-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {distances && `${distances.east.toFixed(1)}m`}
                    </div>
                    <div className="absolute top-1/2 left-2 -translate-y-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {distances && `${distances.west.toFixed(1)}m`}
                    </div>
                  </>
                )}
              </div>

              {distances && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div
                    data-testid="dist-north"
                    className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg"
                  >
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Norra gräns</div>
                    <div className="text-2xl font-semibold text-black dark:text-zinc-50">
                      {distances.north.toFixed(1)} m
                    </div>
                  </div>
                  <div
                    data-testid="dist-south"
                    className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg"
                  >
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Södra gräns</div>
                    <div className="text-2xl font-semibold text-black dark:text-zinc-50">
                      {distances.south.toFixed(1)} m
                    </div>
                  </div>
                  <div
                    data-testid="dist-east"
                    className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg"
                  >
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Östra gräns</div>
                    <div className="text-2xl font-semibold text-black dark:text-zinc-50">
                      {distances.east.toFixed(1)} m
                    </div>
                  </div>
                  <div
                    data-testid="dist-west"
                    className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg"
                  >
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Västra gräns</div>
                    <div className="text-2xl font-semibold text-black dark:text-zinc-50">
                      {distances.west.toFixed(1)} m
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
