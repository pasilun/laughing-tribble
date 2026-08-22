import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.VISUAL_PORT ?? 3123)
const BASE = process.env.VISUAL_BASE_URL ?? `http://localhost:${PORT}`
const CASES_DIR = resolve('fixtures', 'cases')
const OUT_DIR = resolve('.visual')
const TIMEOUT_MS = Number(process.env.VISUAL_TIMEOUT ?? 180000)

const cases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))

if (cases.length === 0) {
  console.error(`No fixtures found in ${CASES_DIR}`)
  process.exit(1)
}

function startServer() {
  const child = spawn('npx', ['next', 'dev', '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  })
  child.stdout.on('data', (d) => process.env.VISUAL_VERBOSE && process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', (d) => process.env.VISUAL_VERBOSE && process.stderr.write(`[server] ${d}`))
  return child
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Server did not become ready at ${BASE} within ${TIMEOUT_MS}ms`)
}

async function main() {
  let server
  if (!process.env.VISUAL_BASE_URL) {
    console.log(`Starting next dev on :${PORT} …`)
    server = startServer()
    await waitForServer()
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(resolve(OUT_DIR, 'actual'), { recursive: true })

  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  })

  const manifest = { generatedAt: new Date().toISOString(), base: BASE, cases: {} }
  let failed = false

  for (const caseId of cases) {
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    const entry = { url: `${BASE}/review/${caseId}`, renderState: null, shots: [], consoleErrors }
    manifest.cases[caseId] = entry

    try {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
      await page.waitForSelector('body[data-render-state="complete"]', { timeout: TIMEOUT_MS })
      entry.renderState = 'complete'
    } catch {
      entry.renderState = await page
        .locator('body')
        .getAttribute('data-render-state')
        .catch(() => null)
      failed = true
      console.error(`✗ ${caseId}: renderState=${entry.renderState} (see ${entry.url})`)
    }

    const shotDir = resolve(OUT_DIR, 'actual', caseId)
    mkdirSync(shotDir, { recursive: true })

    for (const [name, selector] of [
      ['plan', '[data-shot="plan"]'],
      ['iso-3d', '[data-shot="iso"]'],
      ['top-3d', '[data-shot="top"]'],
      ['north-3d', '[data-shot="north"]'],
      ['cutaway-3d', '[data-shot="cutaway"]'],
      ['page', 'body'],
    ]) {
      const locator =
        name === 'page' ? page.locator(selector).first() : page.locator(selector).first()
      try {
        const path = resolve(shotDir, `${name}.png`)
        if (name === 'page') await page.screenshot({ path, fullPage: true })
        else await locator.screenshot({ path })
        entry.shots.push(path)
      } catch (e) {
        entry.consoleErrors.push(`screenshot ${name} failed: ${e}`)
        failed = true
      }
    }

    console.log(
      `${entry.renderState === 'complete' ? '✓' : '✗'} ${caseId}: ${entry.shots.length} shots`
    )
    await page.close()
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nManifest: ${resolve(OUT_DIR, 'manifest.json')}`)

  await browser.close()
  if (server) server.kill('SIGTERM')

  if (existsSync(resolve('.visual', 'actual')) === false) process.exit(1)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
