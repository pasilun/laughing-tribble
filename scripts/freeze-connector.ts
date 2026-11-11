// Writes e2e/fixtures/connector-tools.json from the tool definitions. Run it only on purpose: a change to this file is
// a change to the connector contract (docs/mcp-contract.md §7) and needs the maintainer's decision.
import { writeFileSync } from 'fs'
import { connectorTools } from '../lib/plan/connector/tools'

writeFileSync('e2e/fixtures/connector-tools.json', JSON.stringify(connectorTools(), null, 2) + '\n')
console.log('wrote e2e/fixtures/connector-tools.json')
