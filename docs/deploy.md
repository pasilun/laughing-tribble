# Deploying and sharing the app

The app runs on Vercel (project `laughing-tribble`): `main` deploys to
production, every other branch gets a preview. Several people can use it, each
with their own key, their own plans and their own storage.

## What lives where

| Thing | Where |
| --- | --- |
| Plans, revisions, scanned drawings | Vercel Blob (private), under `u/<person>/plans/…` |
| Who is who | `PLAN_USERS` in the Vercel project: `id:<hash of key>`, comma separated |
| The key itself | With the person only. It is never stored, only its hash is. |
| Deploy credentials | GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

## One-time setup

1. **Blob store.** Vercel → project → Storage → create a Blob store with **private**
   access (a public store is refused by the app) and connect it with the custom
   prefix `PLANS`. That creates `PLANS_READ_WRITE_TOKEN` by itself; do not make one
   by hand. It wins over `BLOB_`/`public_` tokens from stores connected earlier.
   Give *Preview* its own store (or none) so a branch deploy never touches real plans.
2. **First person.** `npm run user:add <id>` prints a key, the line for `PLAN_USERS`
   and the connector URL. Put the line in Vercel → Settings → Environment
   Variables → `PLAN_USERS` (Production and Preview), redeploy.
3. **Existing plans.** Plans made before personal storage sit under `plans/…`. Move
   them to the first person, with the blob token in the environment:
   `npm run migrate:users -- --to <id> --dry-run`, then without `--dry-run`, check the
   plans in the app, then once more with `--delete-legacy`.
4. **Remove `PLAN_PASSWORD`** once the migration is done (it is only the fallback
   when `PLAN_USERS` is missing).
5. **Smoke users** (for the automatic check after each deploy): make two more people,
   `smoke` and `smoke2`, add them to `PLAN_USERS`, and put their keys in GitHub as
   secrets `SMOKE_KEY` and `SMOKE_KEY_OTHER`.

## Adding or removing a person

- Add: `npm run user:add <id> https://<host>`, append the printed `id:hash` to
  `PLAN_USERS`, redeploy, give the person the key. They sign in at `/plans` with it,
  or add the connector URL (`https://<host>/api/mcp?key=<key>`) in Claude under
  Settings → Connectors → Add custom connector.
- Remove: delete their entry from `PLAN_USERS` and redeploy. Their sessions and
  connector stop working at once. Their files stay in the store under `u/<id>/`.
- A key was leaked: remove the entry, make a new one with `user:add`, redeploy.

The key in a connector URL can end up in logs and browser history. Treat the URL
as a password and share it only with the person it is for.

## Tokens

- `VERCEL_TOKEN` (vercel.com/account/tokens, scoped to the team, with an expiry)
  deploys from CI. To let Claude read build logs and environment variable names
  from a session, add the same kind of token as `VERCEL_TOKEN` in the session's
  environment settings, never in chat.
- `VERCEL_ORG_ID` = `team_JLz4qrIZ7bgOBGx6fCuMmKcY`,
  `VERCEL_PROJECT_ID` = `prj_MVMEK9eApm5ktc0cb7vlp3FcGbHi`. They identify, they do not grant.

## Is it working?

```
node scripts/smoke.mjs https://<host> <key> [<another person's key>]
```

runs a real login against the deployment: storage round trip, the image libraries,
PDF/PNG/DXF export, creating, editing and deleting a plan, the MCP endpoint, and with a
second key that the other person sees nothing of it. `GET /api/health` (with a key)
shows the same checks as JSON: build, storage, sharp, canvas, resvg and a PDF render.

## When a deploy or a request fails

1. `npm run build` locally, or the CI check on the pull request: it is the same build.
2. Vercel → Deployments → the failed one → build log; or `vercel inspect <url> --logs`.
3. Runtime errors: Vercel → project → Logs, or `vercel logs <url>`.
4. `/api/health` says which part is broken:
   - `storage` fails: the Blob token is missing or belongs to another project. "Cannot
     use private access on a public store" means the store the app picked is public:
     create a private one and connect it with the prefix `PLANS`.
   - `sharp` / `canvas` / `resvg` fail: a native module did not install for the
     platform; the Node version in the project settings must be 20 or newer.
   - `pdf` fails while the libraries work: a font did not get into the function; add its
     folder to `outputFileTracingIncludes` in `next.config.ts`.
5. `401` everywhere: wrong or missing key. `503 inloggning är inte konfigurerad`:
   `PLAN_USERS` is not set in that environment (preview and production are separate).

## CI and the smoke step (proposed, not yet in `.github/`)

`deploy.yml` currently deploys `main` and checks that `/plans/login` and `/api/mcp`
answer. Two additions would catch the rest earlier. Add them as-is.

`.github/workflows/ci.yml` – the same build Vercel runs, plus the tests that need no
browser, on every pull request:

```yaml
name: CI
on:
  pull_request:
  push:
    branches-ignore: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - run: npx playwright test e2e/plan-model.spec.ts e2e/plan-review.spec.ts e2e/plan-scan.spec.ts e2e/plan-snap.spec.ts e2e/plan-access.spec.ts e2e/plan-users.spec.ts --reporter=line
        env: { CI: 'true' }
```

A last step in `deploy.yml` – the signed-in smoke test (skipped until `SMOKE_KEY` exists):

```yaml
      - name: Production smoke (signed in)
        env:
          PROD_URL: ${{ vars.PROD_URL }}
          SMOKE_KEY: ${{ secrets.SMOKE_KEY }}
          SMOKE_KEY_OTHER: ${{ secrets.SMOKE_KEY_OTHER }}
        run: |
          if [ -z "$SMOKE_KEY" ]; then echo "SMOKE_KEY saknas – hoppar över"; exit 0; fi
          node scripts/smoke.mjs "$PROD_URL" "$SMOKE_KEY" "$SMOKE_KEY_OTHER"
```
