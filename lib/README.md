# lib/ – the server and the shared domain

Imports go downwards only (nothing in `lib/` imports from `app/` or `components/`).

```
app/api/**/route.ts        HTTP: sign-in check, parse, status codes (secured(), fail(), doc-routes.ts)
lib/plan/mcp/              the Claude connector (JSON-RPC tools, instructions) – a second way in to the same services
lib/plan/service.ts        use cases: createPlan, editPlan, loadPlan …
lib/plan/export.ts         sheet → PDF/PNG
lib/plan/assist/           help for drawing from a source: trace, audit, review, compare, finish, clear
lib/plan/scan/             reading a scanned drawing (calibrate, walls, openings, doors …)
lib/plan/domain/           the model and its rules: types, geometry, ops, checks, sheet, rooms, structure, demo
                           – plain TypeScript, also used by the browser editor (components/plan-editor)
lib/plan/storage/          where data lives and who may see it
    storage.ts               Backend (files, Vercel Blob, Turso), Scoped, errors
    docs.ts                  documents of any kind: access, sharing, trash, list (PLANS, SITES)
    store.ts                 what is particular to a plan: revisions, tags, assets
    shares.ts, backup.ts, migrate-store.ts, turso.ts
lib/plan/auth/             keys, cookies, invitations, OAuth, accounts, the person of the current request
lib/site/                  site plans (tomter): same layers in one folder – doc, geometry, render, service, store
```

A new kind of document (like site plans) gets sharing, trash, list and backup by adding a `DocKind` in
`storage/docs.ts`; the share/delete/restore routes are `app/api/plans/doc-routes.ts`, the UI `components/DocShare.tsx`
and `components/DocTrash.tsx`.
