import UTIF from 'utif'

// Archive drawings from Bygg- och plantjänsten come as TIF (often 1-bit
// CCITT G4), which browsers can't display. Convert to PNG before upload.

export type Raster = { blob: Blob; width: number; height: number; name: string }

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
    return { blob: await rgbaToPng(rgba, width, height), width, height, name: `${base}.png` }
  }
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Välj en TIF-, PNG- eller JPG-fil')
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
