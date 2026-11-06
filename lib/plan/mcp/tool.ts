// What a Claude tool is: a name, a description and an input schema (what Claude sees), and the function that runs it.
// The tools are grouped in files by what they do (tools-*.ts) and listed in mcp-tools.ts.

export type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
export type ToolResult = { content: Content; isError?: boolean }
export type Args = Record<string, unknown>
export type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (args: Args) => Promise<ToolResult> }

export const text = (t: string): { type: 'text'; text: string } => ({ type: 'text', text: t })
export const refuse = (t: string): ToolResult => ({ content: [text(t)], isError: true })

// Tools that come with their own handler (the scan and site tools) as registry entries.
export const adapt = (defs: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }>, handle: (name: string, args: Args) => Promise<ToolResult | null>): Tool[] =>
  defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema as Record<string, unknown>, run: async (args) => (await handle(d.name, args)) ?? refuse(`Okänt verktyg ${d.name}`) }))
