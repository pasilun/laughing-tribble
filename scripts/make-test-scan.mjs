// Generates e2e/fixtures/test-scan.tif: a tiny "scanned drawing" with a
// 250 px scale bar from (25, 175) to (275, 175) and a room outline.
import UTIF from 'utif'
import { writeFileSync } from 'fs'
const w = 300, h = 200
const rgba = new Uint8Array(w * h * 4).fill(255)
const ink = (x, y) => { const i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0 }
for (let x = 25; x <= 275; x++) for (let y = 173; y <= 177; y++) ink(x, y)
for (let x = 50; x <= 250; x++) for (const y of [25, 26, 125, 126]) ink(x, y)
for (let y = 25; y <= 126; y++) for (const x of [50, 51, 249, 250]) ink(x, y)
writeFileSync('e2e/fixtures/test-scan.tif', Buffer.from(UTIF.encodeImage(rgba, w, h)))
