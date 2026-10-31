import { Resvg } from '@resvg/resvg-js'
import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import path from 'path'
import sharp from 'sharp'
import type { Mosaic } from './lantmateriet'

const FONT_DIR = path.join(process.cwd(), 'lib/plan/fonts')

export function svgToPng(svg: string, width = 2400): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      loadSystemFonts: false,
      fontFiles: [path.join(FONT_DIR, 'LiberationSans-Regular.ttf'), path.join(FONT_DIR, 'LiberationSans-Bold.ttf')],
      defaultFontFamily: 'Liberation Sans',
      sansSerifFamily: 'Liberation Sans',
    },
  })
    .render()
    .asPng()
}

// Vector PDF at the sheet's paper size (prints at true scale at 100 %).
export async function svgToPdf(svg: string, paperW: number, paperH: number, title: string): Promise<Buffer> {
  const pt = 72 / 25.4
  const size: [number, number] = [paperW * pt, paperH * pt]
  const doc = new PDFDocument({ size, margin: 0, autoFirstPage: false, info: { Title: title } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()))
  doc.addPage({ size, margin: 0 })
  SVGtoPDF(doc, svg, 0, 0, { width: size[0], height: size[1], assumePt: false, fontCallback: (_f: string, bold: boolean) => (bold ? 'Helvetica-Bold' : 'Helvetica') })
  doc.end()
  await done
  return Buffer.concat(chunks)
}

// The base map smoothed up for print: 0.5 m pixels become soft, not blocky, at 1:500.
export async function backgroundUri(map: Mosaic, factor = 4): Promise<string> {
  const png = await sharp(map.png).resize(map.width * factor, map.height * factor, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}
