import type { Answer } from './types'

export type ImageBlock = { type: 'image'; data: string; mimeType: string }
export type ToolResult = {
  content: Array<{ type: 'text'; text: string } | ImageBlock>
  isError?: boolean
  structuredContent?: Answer
}

// Packs an answer for MCP. The text block holds everything Claude needs. Clients differ in which part they show:
// some read only the text, some only `structuredContent`. So the structured object is the answer with the summary
// (the listing, the reading, the guide text) also in `data.text`; the lists (changed, findings, next) are there anyway.
export function toToolResult(a: Answer, opts: { summary: string; images?: ImageBlock[] }): ToolResult {
  const parts: string[] = []
  if (opts.summary) parts.push(opts.summary)
  if (a.changed && a.changed.length > 0) {
    parts.push(['Ändrat:', ...a.changed.map((c) => `- ${c.kind} ${c.id}: ${c.what}`)].join('\n'))
  }
  if (a.findings && a.findings.length > 0) {
    parts.push(['Anmärkningar:', ...a.findings.map((f) => `- [${f.level}] ${f.message}${f.refs && f.refs.length ? ` (${f.id})` : ''}`)].join('\n'))
  }
  if (a.next && a.next.length > 0) {
    parts.push(['Nästa:', ...a.next.map((n) => `- ${n.tool} ${JSON.stringify(n.arguments)} – ${n.why}`)].join('\n'))
  }
  const content: ToolResult['content'] = [{ type: 'text', text: parts.join('\n\n') }]
  for (const img of opts.images ?? []) content.push(img)
  const result: ToolResult = { content }
  if (!a.ok) result.isError = true
  result.structuredContent = opts.summary ? { ...a, data: { ...(a.data ?? {}), text: opts.summary } } : a
  return result
}
