# lib/ – the server and the shared domain

Imports go downwards only (nothing in `lib/` imports from `app/` or `components/`).

```
app/api/**/route.ts        HTTP: sign-in check, parse, status codes (secured(), fail(), doc-routes.ts)
lib/plan/mcp/              the Claude connector – a second way in to the same services. A tool is { name, description,
                           inputSchema, run } (tool.ts); they are grouped by what they do (tools-read, -edit, -trace,
                           -share), the scan tools are in scan/tools.ts and the site tools in site/mcp.ts, and
                           mcp-tools.ts lists them all and runs one by name
lib/plan/service.ts        use cases: createPlan, editPlan, replacePlan, loadPlan … (uploads.ts: getting a drawing in)
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

**What goes where.** A route reads the request, calls `lib/plan/service.ts` (or `uploads.ts`, `storage/admin.ts`) and
turns the answer into a status code. Rules – what is a valid plan, which files are allowed, how big – live below the
route, so the editor, Claude and the API all get the same answer. A route may call the storage layer directly only for a
plain read or pass-through (the list, the trash, assets, the backup stream); anything that checks or combines goes in a service.

The same rule holds for the Claude connector: a tool that changes something calls the same function as the route
does (editPlan, replacePlan, tagPlan, importPlan, addShare, deleteDoc …), so the two ways in cannot disagree.

A new kind of document (like site plans) gets sharing, trash, list and backup by adding a `DocKind` in
`storage/docs.ts`; the share/delete/restore routes are `app/api/plans/doc-routes.ts`, the UI `components/DocShare.tsx`
and `components/DocTrash.tsx`; for Claude, `mcp/tools-share.ts` (a share tool per kind, one `doc_trash` for all).
