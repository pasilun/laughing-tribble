import { rmSync } from 'node:fs'
import { E2E_DATA } from '../playwright.config'

// A run starts with an empty data folder for the app under test.
export default function globalSetup() {
  rmSync(E2E_DATA, { recursive: true, force: true })
}
