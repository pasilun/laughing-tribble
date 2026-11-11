import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output — not application code
    "playwright-report/**",
    "test-results/**",
    // Bundled third-party worker files copied from node_modules
    "public/fragments-worker.mjs",
    // Throwaway spike code and the Rust folder: not part of the app
    "spikes/**",
    "v2/**",
  ]),
]);

export default eslintConfig;
