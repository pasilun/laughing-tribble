import sharp from 'sharp'
import { getAsset } from '../store'
import type { Plan, Pt, Source, Underlay } from '../types'

// Server-side handling of source drawings: conversion to PNG and pixel
// access for the scan tools. Coordinates: plan mm ↔ image px through the
// source's mmPerPx and position (rotation 0 only).

export const PDF_DPI = 200

export type Converted = { png: Buffer; widthPx: number; heightPx: number; dpi?: number; kind: 'pdf' | 'tif' | 'image' }

export async function convertToPng(data: Buffer, filename: string): Promise<Converted> {
  if (/\.pdf$/i.test(filename) || data.subarray(0, 5).toString() === '%PDF-') return pdfToPng(data)
  // Archive TIFs often have sloppy headers (unterminated tags); read them anyway.
  const img = sharp(data, { limitInputPixels: 200_000_000, failOn: 'none' })
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error('kunde inte läsa bilden')
  // White background for transparent images; grayscale keeps files small.
  const png = await img.flatten({ background: '#ffffff' }).grayscale().png({ compressionLevel: 9 }).toBuffer()
  const rawDpi = meta.density && meta.density >= 100 && meta.density <= 2400 ? meta.density : undefined
  return { png, widthPx: meta.width, heightPx: meta.height, dpi: rawDpi, kind: meta.format === 'tiff' ? 'tif' : 'image' }
}

async function pdfToPng(data: Buffer): Promise<Converted> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: PDF_DPI / 72 })
  const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // pdf.js only needs the 2D context API, which @napi-rs/canvas provides.
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise
  const png = await sharp(canvas.toBuffer('image/png')).grayscale().png({ compressionLevel: 9 }).toBuffer()
  return { png, widthPx: canvas.width, heightPx: canvas.height, dpi: PDF_DPI, kind: 'pdf' }
}

// mm per pixel for a drawing at a known scale and resolution.
export function mmPerPxFor(dpi: number, scale: number): number {
  return (25.4 / dpi) * scale
}

export type Raster = { id: string; mmPerPx: number; x: number; y: number; widthPx: number; heightPx: number; src: string; rotation: number }

// The source a scan tool works on: a listed source, or the underlay.
export function resolveSource(plan: Plan, sourceId?: string): Raster {
  if (sourceId && sourceId !== 'underlay') {
    const s = plan.sources?.find((x) => x.id === sourceId)
    if (!s) throw new Error(`källan ${sourceId} finns inte`)
    return check(s)
  }
  if (!sourceId && plan.sources?.length === 1) return check(plan.sources[0])
  if (plan.underlay) return check({ id: 'underlay', ...plan.underlay } as Underlay & { id: string })
  if (plan.sources?.length) throw new Error(`ange source_id (${plan.sources.map((s) => s.id).join(', ')})`)
  throw new Error('planen har ingen källritning')
}

function check(s: Source | (Underlay & { id: string })): Raster {
  if (s.rotation) throw new Error('källritningen är roterad – skanningsverktygen kräver rotation 0')
  return { id: s.id, mmPerPx: s.mmPerPx, x: s.x, y: s.y, widthPx: s.widthPx, heightPx: s.heightPx, src: s.src, rotation: 0 }
}

export function toPx(r: Raster, p: Pt): Pt {
  return { x: (p.x - r.x) / r.mmPerPx, y: (p.y - r.y) / r.mmPerPx }
}

export function toMm(r: Raster, p: Pt): Pt {
  return { x: r.x + p.x * r.mmPerPx, y: r.y + p.y * r.mmPerPx }
}

export function assetName(src: string): string {
  return decodeURIComponent(src.split('/').pop() ?? '')
}

export type Gray = { data: Uint8Array; w: number; h: number }

// Small cache: scan tools are called many times on the same drawing.
const cache = new Map<string, Gray>()

export async function loadGray(planId: string, r: Raster): Promise<Gray> {
  const key = `${planId}/${r.src}`
  const hit = cache.get(key)
  if (hit) return hit
  const buf = await loadPng(planId, r)
  const { data, info } = await sharp(buf, { limitInputPixels: 200_000_000 }).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  cache.set(key, g)
  if (cache.size > 4) cache.delete(cache.keys().next().value!)
  return g
}

export async function loadPng(planId: string, r: Raster): Promise<Buffer> {
  if (r.src.startsWith('data:')) return Buffer.from(r.src.split(',')[1], 'base64')
  const buf = await getAsset(planId, assetName(r.src))
  if (!buf) throw new Error(`källbilden ${r.src} saknas`)
  return buf
}

export function dark(g: Gray, x: number, y: number, threshold = 128): boolean {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= g.w || yi >= g.h) return false
  return g.data[yi * g.w + xi] < threshold
}

// Bilinear grey value at a fractional pixel; outside the image is white.
export function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) return 255
  const fx = x - x0
  const fy = y - y0
  const i = y0 * g.w + x0
  const d = g.data
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.w] * (1 - fx) + d[i + g.w + 1] * fx) * fy
}
