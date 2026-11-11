# Rules for implementing a card (Planstudio app)

This is the Planstudio app: Next.js 16, React 19, TypeScript. It is the product; the Rust folder `v2/` is not part of it, leave it alone.

1. **Read first:** `AGENTS.md` (this Next.js differs from what you know: before writing anything that is specific to Next.js, read the matching guide in `node_modules/next/dist/docs/`), the card, the spec sections it names, and the files it lists. Read nothing else unless a card says so.
2. **Layers.** Imports go downwards only (`lib/README.md`): nothing in `lib/` imports from `app/` or `components/`. A route reads the request, calls a use case and turns the answer into a status code; rules live below the route. The new connector lives in `lib/plan/connector/`; the old one in `lib/plan/mcp/` and `app/api/mcp/` stays as it is unless a card says to change it.
3. **Language.** Messages that reach Claude or a person are Swedish, as in the existing tools. Tool descriptions, the guide, finding codes, code comments and card text are English.
4. **Style.** Follow the neighbouring code: no semicolons, single quotes, two-space indent, relative imports inside `lib/`, the `@/` alias in `e2e/` tests. Do not reformat files you only touch.
5. **Tests.** Tests are Playwright specs in `e2e/`. A pure test imports from `@/lib/...` and needs no browser; an API test uses the `request` fixture against the running app. Add the spec the card names. Never change, skip or delete an existing test or fixture unless the card says so.
6. **Check.** Run exactly the command in the card's "Done when". Typecheck and lint run on the whole project; the spec runs with `CI=1`, which builds and starts the app (about 40 s).
7. **Never** add a dependency a card does not name, touch `package-lock.json`, edit files outside those the card lists, change a public function signature the card does not mention, or push to `main`.
8. **Stage explicit paths** (`git add path …`), never `git add -A` or `git add .`.
9. **When the card is unclear or wrong,** say so in your report and stop. Do not guess and do not bend a test to pass.
