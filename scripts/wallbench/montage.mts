// Three pictures side by side with a caption each. npx tsx scripts/wallbench/montage.mts out.png "cap1|file1" "cap2|file2" ...
import sharp from 'sharp'
const [out, ...items] = process.argv.slice(2)
const W = 760
const tiles = await Promise.all(items.map(async (it) => {
  const [cap, file] = it.split('|')
  const img = await sharp(file).resize({ width: W }).png().toBuffer()
  const meta = await sharp(img).metadata()
  return { cap, img, h: meta.height ?? 0 }
}))
const H = Math.max(...tiles.map((t) => t.h)) + 44
const svg = (t: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"><text x="${W / 2}" y="28" text-anchor="middle" font-size="24" font-family="sans-serif" font-weight="bold" fill="#111">${t.replace(/&/g, '&amp;')}</text></svg>`)
await sharp({ create: { width: tiles.length * W + (tiles.length - 1) * 10, height: H, channels: 3, background: '#ffffff' } })
  .composite(tiles.flatMap((t, i) => [{ input: svg(t.cap), left: i * (W + 10), top: 0 }, { input: t.img, left: i * (W + 10), top: 44 }]))
  .png().toFile(out)
