import { list } from '@vercel/blob'
import { NextRequest } from 'next/server'
import { generateFloorPlanSVG } from '@/lib/floor-plan-svg'
import { Resvg } from '@resvg/resvg-js'
import type { BuildingModelV2 } from '@/types/building-v2'

export const runtime = 'nodejs'

function blobToken() {
  return process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { blobs } = await list({ prefix: `buildings/${id}`, token: blobToken() })
  const blob = blobs.find((b) => b.pathname === `buildings/${id}.json`)

  if (!blob) {
    return new Response('Not found', { status: 404 })
  }

  const res = await fetch(blob.url)
  const model = (await res.json()) as BuildingModelV2

  const svg = generateFloorPlanSVG(model)
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  const png = resvg.render().asPng()

  return new Response(png.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  })
}
