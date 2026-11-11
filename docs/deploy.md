# Deploying and sharing the app

The app runs on Vercel (project `laughing-tribble`): `main` deploys to
production. Other branches are not built: `vercel.json` has an `ignoreCommand` that skips every build whose branch is not `main` (decided 2026-11-11; the scheduled build runs push to `auto/v1-build` and need no preview). Several people can use it, each
with their own key, their own plans and their own storage.

## What lives where

| Thing | Where |
| --- | --- |
| Plans, revisions, scanned drawings | Vercel Blob (private), under `u/<person>/plans/…` |
| Who is who | `PLAN_USERS` in the Vercel project: `id:<hash of key>`, comma separated |
| The key itself | With the person only. It is never stored, only its hash is. |
| Deploys | Vercel's Git integration: `main` to production; other branches are skipped by `ignoreCommand` in `vercel.json` |

## One-time setup

1. **Blob store.** Vercel → project → Storage → create a Blob store with **private**
   access (a public store is refused by the app) and connect it with the custom
   prefix `PLANS`. That creates `PLANS_READ_WRITE_TOKEN` by itself; do not make one
   by hand. If the project holds several store tokens, the app tries them in turn and uses the first that is private.
   Give *Preview* its own store (or none) so a branch deploy never touches real plans.
2. **First person.** `npm run user:add <id>` prints a key, the line for `PLAN_USERS`
   and the connector URL. Put the line in Vercel → Settings → Environment
   Variables → `PLAN_USERS` (Production and Preview), redeploy.
3. **Existing plans.** Plans made before personal storage sit under `plans/…`. Move
   them to the first person, with the blob token in the environment:
   `npm run migrate:users -- --to <id> --dry-run`, then without `--dry-run`, check the
   plans in the app, then once more with `--delete-legacy`.
4. **`PLAN_PASSWORD` is gone.** The single shared password no longer exists in the app; delete
   the variable in Vercel if it is still there. The way in is a personal key (the people in
   `PLAN_USERS`, who are the administrators) or an invitation link plus OAuth for the Claude
   connector.
5. **Smoke users** (for the automatic check after each deploy): make two more people,
   `smoke` and `smoke2`, add them to `PLAN_USERS`, and put their keys in GitHub as
   secrets `SMOKE_KEY` and `SMOKE_KEY_OTHER`.

## Inviting people (no redeploy)

Friends can join with an invitation link instead of you editing `PLAN_USERS`.

1. **Once:** set `PLAN_ADMINS` in Vercel to your own id (the one in `PLAN_USERS`, e.g.
   `anna`), for Production, and redeploy. Without it nobody may invite.
2. Open `/plans/people` (there is a link on the plan list when you are an admin),
   write who it is for and press *Skapa länk*. The link is shown once.
3. Send it to the friend. They open it, choose a user name, and are signed in at once.
   The screen leads with connecting Claude: copy the connector address (no key in it;
   Claude signs them in with OAuth), add it in Claude, and approve. Their own key
   (shown once, never stored) is in a collapsed section for signing in on another
   device. A link works once and expires after 1, 7 or 30 days.
4. To remove someone, press *Ta bort* on the same page. They are signed out within
   half a minute (sign-ins are remembered for 30 s per server instance). Their
   plans stay in the store under `u/<id>/`.

5. **A lost key** is not shown again. Press *Ny nyckel* on the same page for that person: it makes
   a one-time link that gives them a new key (shown with a Copy button and, on phones, a share
   sheet; the way on is locked until they tick that they saved it). The old key stops working when
   the link is used, the plans stay. People in `PLAN_USERS` get a new key in Vercel instead.

People who joined this way are kept in the store under `system/` (hashes of keys and
links only), next to the plans. `PLAN_USERS` people still work as before and are
not shown on the page; they are removed in Vercel. Their ids cannot be reused.
The page only exists while `PLAN_USERS` is set.

## Sharing a plan

A plan can be shared with another person (any account: `PLAN_USERS` or joined by invitation).
On the plan list press *Dela* on the plan and write their user name; Claude can do the same with
`plan_share`. Both then make new revisions of the same plan (the revision check stops one from
overwriting the other; the version list shows who saved what). Anyone who has the plan may share it
on; the owner may take a person out (`DELETE /api/plans/:id/share?user=…`), anyone may leave.

- **Delete only removes it for the one who deletes.** A member who deletes leaves the plan; an owner
  who deletes puts it in their trash while the others keep it (see Trash and backup). If someone shares
  it back with the owner, the owner has it again.
- **Storage:** the data stays under the owner (`u/<owner>/plans/<id>/`), together with
  `shares.json` (`{ members, ownerRemoved? }`). A member has a pointer `u/<member>/shared/<id>.json`.
  All reads and writes of `plans/<id>/…` go to the owner's folder for a member (lib/plan/storage/docs.ts).
  The access is remembered for 10 s per server instance.
- Tomter (site plans) are shared, deleted (to the trash) and restored in the same way, through the same code (`lib/plan/storage/docs.ts`); their pointers live in `u/<member>/shared-sites/<slug>.json`. Sharing needs personal keys (`PLAN_USERS`), and not local development without sign-in.

## Several people on one browser

Signing in (the key form or an invitation link) while someone else is signed in keeps the first person:
the menu at the top right of the list pages (*patrik ▾*) shows who is in use, switches to the others
(*Byt till …*, no key needed), signs in as someone else, and signs out. The browser holds the login
cookies in `plan_access` (in use) and `plan_accounts` (the others, up to four, httpOnly); a dead one is
dropped when read. Claude's connector is approved as the person in use when *Godkänn* is pressed, so switch first.

## Storage operations (Vercel Blob limits)

On the Hobby plan Blob allows 2 000 *advanced* operations and 10 000 *simple* ones a month. Advanced is
every write (`put`: each saved revision costs two, the revision and the head) and every folder listing;
simple is a read. The hot paths are kept cheap: the plan list and the trash come from one listing of the
person's plans (`GET /api/plans` returns `{ plans, trash }`); the plans shared with a person are found through
an index (`u/<person>/shared.json`, rebuilt from the pointers when missing or a day old); the admin check
(`Personer` in the menu) is answered from `GET /api/plans/accounts` without listing people. Watch
*Usage* in the Vercel dashboard; a store that hits a limit stops working until the next period.

## Moving the data to Turso (free, no operation caps that lock the store)

Vercel Blob on Hobby locks the store for 30 days when a monthly limit is hit. Turso (libSQL, SQLite over HTTP)
has a free plan with far higher limits (about 5 GB, 500 M row reads and 10 M row writes a month; check
turso.tech/pricing) and the app can use it instead of Blob. Nothing changes until `PLAN_STORE=turso` is set.

1. Make a free account at turso.tech and a database (a region near Stockholm, e.g. Frankfurt or Ireland).
   Copy its URL (`libsql://…turso.io`) and make a token (dashboard → the database → generate token).
2. In Vercel (Production) add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, redeploy. The app keeps using Blob.
3. Open `/plans/people` → *Lagring* → *Kopiera lagringen till Turso*. It copies every file a stretch at a time and
   says when it is done and how many files Turso holds. It only reads from Blob, and can be repeated (it overwrites).
   It reads each file once (a few thousand reads and a few dozen listings, well inside Hobby's monthly limits).
4. Stop editing, press the copy once more (it picks up what changed), then set `PLAN_STORE=turso` in Vercel and
   redeploy. `/api/health` and the *Lagring* box now say Turso.
5. Keep the Blob store for a while as a copy; delete it when everything has been checked. The backup download
   (see below) works the same on either store.

## Trash and backup

- **Trash.** Deleting a plan moves it to the trash: hidden for the owner, kept 30 days, restorable from
  *Papperskorgen* at the bottom of the plan list (`POST /api/plans/:id/restore`). *Radera för alltid* there
  (`DELETE /api/plans/:id?permanent=1`) removes it at once, but not while someone else still has the plan.
  After 30 days a plan nobody else has is removed when the trash or the list is next read. A member who
  deletes a shared plan only leaves it.
- **Backup.** *Ladda ner alla mina planer (zip)* at the bottom of the plan list (`GET /api/plans/backup`)
  streams a zip: every revision, the drawings, the latest revision as PDF, plans in the trash, plans shared
  with the person, site plans. Administrators get everyone's data (`?all=1`, linked on `/plans/people`, no PDFs).
  Keep the file somewhere outside the app.
- **Restore.** With the store's token in the environment (or against `.data`):
  `npm run restore:backup -- <file.zip> --to <person> [--overwrite] [--dry-run]`. Plans that already exist are
  skipped without `--overwrite`; sharing, the trash marker and PDFs are not put back.

## Connecting Claude with sign-in (OAuth)

The connector no longer needs a key in the URL. Add the plain address
`https://<host>/api/mcp` in Claude (Settings → Connectors → Add custom connector). Claude
answers the 401 by registering itself and opening `/oauth/authorize` in the browser:
the person signs in with their key (or is already signed in), presses *Godkänn*, and Claude
gets a token that lasts an hour and renews itself (90 days, rotating). A key in the address
(`?key=`) is not accepted any more: it ends up in logs and history.

- Endpoints: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
  `/oauth/register` (Dynamic Client Registration), `/oauth/authorize`, `/oauth/token`.
- Public clients with PKCE (S256) only. Registration accepts Claude's callbacks
  (`https://claude.ai/api/mcp/auth_callback`, the `claude.com` one) and `localhost` addresses
  (Claude Code); other addresses can be allowed with `PLAN_OAUTH_REDIRECTS` (comma separated).
- Tokens are random, kept hashed under `system/oauth/` next to the people. Removing someone
  from `/plans/people` (or from `PLAN_USERS`) ends their tokens within about 30 seconds.
- Needs `PLAN_USERS`; with sign-in off, nobody can authorize.
- A connector entered with a URL that has `?tools=basic` is a different resource than the one
  the discovery document names. If Claude refuses that, use the plain address and keep the key
  form for the short tool list.

## Adding or removing a person by hand

- Add: `npm run user:add <id> https://<host>`, append the printed `id:hash` to
  `PLAN_USERS`, redeploy, give the person the key. They sign in at `/plans` with it,
  or add the connector URL (`https://<host>/api/mcp`) in Claude under
  Settings → Connectors → Add custom connector.
- Remove: delete their entry from `PLAN_USERS` and redeploy. Their sessions and
  connector stop working at once. Their files stay in the store under `u/<id>/`.
- A key was leaked: remove the entry, make a new one with `user:add`, redeploy.

The key in a connector URL can end up in logs and browser history. Treat the URL
as a password and share it only with the person it is for.

## Tokens

Vercel deploys by itself, so no token is needed for that. To let Claude read build
logs and environment variable names from a session, create a token at
vercel.com/account/tokens (scoped to the team, with an expiry) and add it as
`VERCEL_TOKEN` in the session's environment settings, never in chat.
Team `team_JLz4qrIZ7bgOBGx6fCuMmKcY`, project `prj_MVMEK9eApm5ktc0cb7vlp3FcGbHi`
identify the project; they do not grant anything.

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

## CI and the smoke test

Vercel runs the build on every push. The signed-in smoke test is run by hand after
a deploy (and by Claude from a session):

```
node scripts/smoke.mjs https://<host> <key> [<other person's key>]
```

A pull-request check that runs typecheck, lint and the tests that need no browser
would catch the rest earlier; it is not set up. If you want it, add this as
`.github/workflows/ci.yml`:

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
