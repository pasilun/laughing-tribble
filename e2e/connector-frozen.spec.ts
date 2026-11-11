import { readFileSync } from 'fs'
import { expect, test } from '@playwright/test'
import { connectorTools } from '@/lib/plan/connector/tools'

type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, unknown>
}

const READ_ONLY = ['guide', 'list', 'get', 'check', 'view', 'scan']
const WRITING = ['edit', 'source', 'manage', 'export']
const NO_ID = ['guide', 'list', 'manage']

const tools: Tool[] = connectorTools()

function requiredOf(tool: Tool): unknown[] {
  const required = tool.inputSchema.required
  return Array.isArray(required) ? required : []
}

test('the connector tool list equals the frozen fixture', () => {
  const frozen: unknown = JSON.parse(readFileSync('e2e/fixtures/connector-tools.json', 'utf8'))
  expect(connectorTools(), 'The connector tool list changed. Read docs/mcp-contract.md §7 before running npm run freeze:connector.').toEqual(frozen)
})

test('the tool names are the ten contract tools, in order', () => {
  expect(tools.map((tool) => tool.name)).toEqual(['guide', 'list', 'get', 'check', 'view', 'scan', 'edit', 'source', 'manage', 'export'])
})

test('every description starts with Planstudio: and is at most 600 characters', () => {
  for (const tool of tools) {
    expect(tool.description.startsWith('Planstudio:'), tool.name).toBe(true)
    expect(tool.description.length, tool.name).toBeLessThanOrEqual(600)
  }
})

test('every inputSchema is an object schema', () => {
  for (const tool of tools) {
    expect(tool.inputSchema.type, tool.name).toBe('object')
  }
})

test('every tool has all three annotation hints as booleans', () => {
  for (const tool of tools) {
    expect(typeof tool.annotations.readOnlyHint, tool.name).toBe('boolean')
    expect(typeof tool.annotations.destructiveHint, tool.name).toBe('boolean')
    expect(typeof tool.annotations.idempotentHint, tool.name).toBe('boolean')
  }
})

test('read-only tools are read-only, the others are not, and only manage is destructive', () => {
  for (const tool of tools.filter((t) => READ_ONLY.includes(t.name))) {
    expect(tool.annotations.readOnlyHint, tool.name).toBe(true)
  }
  for (const tool of tools.filter((t) => WRITING.includes(t.name))) {
    expect(tool.annotations.readOnlyHint, tool.name).toBe(false)
  }
  expect(tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual(['manage'])
})

test('id is required by every tool except guide, list and manage', () => {
  for (const tool of tools.filter((t) => !NO_ID.includes(t.name))) {
    expect(requiredOf(tool), tool.name).toContain('id')
  }
})

test('no tool schema names an engine operation', () => {
  const json = JSON.stringify(connectorTools())
  expect(json).not.toContain('moveVertex')
  expect(json).not.toContain('setWallLength')
})
