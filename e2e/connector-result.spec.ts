import { test, expect } from '@playwright/test'
import { answer, finding } from '@/lib/plan/connector/answer'
import { toToolResult, type ImageBlock } from '@/lib/plan/connector/result'

test.describe('connector tool results', () => {
  test('text block holds summary, changes, notes and next calls in order', () => {
    const a = answer({
      ok: true,
      changed: [{ kind: 'wall', id: 'v1', what: 'ändrad' }],
      findings: [finding({ id: 'w:v1', code: 'w', level: 'warning', message: 'M', refs: ['v1'] })],
      next: [{ tool: 'check', arguments: { id: 'p' }, why: 'Se vad som återstår' }],
    })
    const r = toToolResult(a, { summary: 'Sparad.' })
    expect(r.content[0]).toEqual({
      type: 'text',
      text: 'Sparad.\n\nÄndrat:\n- wall v1: ändrad\n\nAnmärkningar:\n- [warning] M (w:v1)\n\nNästa:\n- check {"id":"p"} – Se vad som återstår',
    })
  })

  test('ok answer without lists is the summary only, with no isError and the answer plus the summary as structuredContent', () => {
    const a = answer({ ok: true })
    const r = toToolResult(a, { summary: 'Klart.' })
    expect(r.content).toEqual([{ type: 'text', text: 'Klart.' }])
    expect(Object.keys(r)).not.toContain('isError')
    expect(r.structuredContent).toEqual({ ...a, data: { text: 'Klart.' } })
  })

  test('a failed answer sets isError', () => {
    const r = toToolResult(answer({ ok: false }), { summary: 'Sparades inte.' })
    expect(r.isError).toBe(true)
  })

  test('images are appended after the text block in order', () => {
    const img1: ImageBlock = { type: 'image', data: 'AAA', mimeType: 'image/png' }
    const img2: ImageBlock = { type: 'image', data: 'BBB', mimeType: 'image/jpeg' }
    const r = toToolResult(answer({ ok: true }), { summary: 'Bild.', images: [img1, img2] })
    expect(r.content).toEqual([{ type: 'text', text: 'Bild.' }, img1, img2])
  })
})
