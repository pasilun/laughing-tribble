export const runtime = 'nodejs'

export async function GET() {
  return Response.json({
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    VERCEL_URL: process.env.VERCEL_URL ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
  })
}
