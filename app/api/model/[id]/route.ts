import { list, put } from '@vercel/blob'
import { NextRequest } from 'next/server'

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
  const blob = blobs.find(b => b.pathname === `buildings/${id}.json`)

  if (!blob) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const res = await fetch(blob.url)
  const model = await res.json()
  return Response.json(model)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  await put(`buildings/${id}.json`, JSON.stringify(body), {
    access: 'public',
    token: blobToken(),
    allowOverwrite: true,
    contentType: 'application/json',
  })

  return Response.json({ ok: true })
}
