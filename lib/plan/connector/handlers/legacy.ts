import type { Result } from '../../scan/kit'
import { modernWords } from '../wording'
import type { ImageBlock } from '../result'

// A result of one of the scan tools as text and pictures, in the words of the new connector.
export function unpack(res: Result): { text: string; images: ImageBlock[]; isError: boolean } {
  const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n')
  const images = res.content.flatMap((c) => (c.type === 'image' ? [{ type: 'image' as const, data: c.data, mimeType: c.mimeType }] : []))
  return { text: modernWords(text), images, isError: res.isError === true }
}

// The arguments the caller may pass on to a scan tool: the document and the saving are the connector's, not the caller's.
export function passed(args: unknown): Record<string, unknown> | undefined {
  if (args === undefined) return {}
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const rest = { ...(args as Record<string, unknown>) }
  for (const key of ['plan_id', 'base_revision', 'apply', 'message']) delete rest[key]
  return rest
}
