import UTIF from 'utif'

// Archive drawings from Bygg- och plantjänsten come as TIF (often 1-bit
// CCITT G4), which browsers can't display, and people's own drawings come
// as PDF. Both are converted to PNG before upload.

// A PDF page is rendered at this resolution, so a drawing at a known scale
// gets an exact mm-per-pixel without calibration.
export const PDF_DPI = 200
const MAX_PIXELS = 40_000_000

export type Raster = { blob: Blob; width: number; height: number; name: string; dpi?: number }

export async function toPng(file: File): Promise<Raster> {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60) || 'ritning'
  if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
    const buf = await file.arrayBuffer()
    const ifds = UTIF.decode(buf)
    if (ifds.length === 0) throw new Error('TIF-filen innehåller ingen bild')
    // The largest page is the drawing; small ones are thumbnails.
    const page = ifds.reduce((a, b) => ((b.width as number) * (b.height as number) > (a.width as number) * (a.height as number) ? b : a))
    UTIF.decodeImage(buf, page)
    const rgba = UTIF.toRGBA8(page)
    const width = page.width as number
    const height = page.height as number
    return { blob: await rgbaToPng(rgba, width, height), width, height, name: `${base}.png`, dpi: tiffDpi(page) }
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfToPng(file, base)
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Välj en PDF-, TIF-, PNG- eller JPG-fil')
  const bmp = await createImageBitmap(file)
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  return { blob: file, width: bmp.width, height: bmp.height, name: `${base}.${ext}` }
}

async function rgbaToPng(rgba: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('kunde inte skapa canvas')
  const pixels = new Uint8ClampedArray(rgba.byteLength)
  pixels.set(rgba)
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG-konvertering misslyckades'))), 'image/png'))
}

// Scan resolution from the TIF header (XResolution + ResolutionUnit).
function tiffDpi(page: Record<string, unknown>): number | undefined {
  const res = (page.t282 as number[] | undefined)?.[0]
  const unit = (page.t296 as number[] | undefined)?.[0] ?? 2
  if (!res || !(res > 0)) return undefined
  const dpi = unit === 3 ? res * 2.54 : res
  // Headers without a real resolution (often 1 or 72) are ignored.
  return dpi >= 100 && dpi <= 2400 ? dpi : undefined
}

async function pdfToPng(file: File, base: string): Promise<Raster> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const page = await doc.getPage(1)
  const base1 = page.getViewport({ scale: 1 }) // 1 unit = 1 pt = 1/72 inch
  let dpi = PDF_DPI
  if (base1.width * base1.height * (dpi / 72) ** 2 > MAX_PIXELS) dpi = Math.floor(72 * Math.sqrt(MAX_PIXELS / (base1.width * base1.height)))
  const viewport = page.getViewport({ scale: dpi / 72 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('kunde inte skapa canvas')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG-konvertering misslyckades'))), 'image/png'))
  return { blob, width: canvas.width, height: canvas.height, name: `${base}.png`, dpi }
}
