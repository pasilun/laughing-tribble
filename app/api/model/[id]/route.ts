import { list } from '@vercel/blob'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const blobToken = process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
  // List blobs to find the one with this id
  const { blobs } = await list({ prefix: `buildings/${id}`, token: blobToken })
  const blob = blobs.find(b => b.pathname === `buildings/${id}.json`)

  if (!blob) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const res = await fetch(blob.url)
  const model = await res.json()
  return Response.json(model)
}
