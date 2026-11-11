# Planstudio v2: deployment and the view-only mobile app

Proposal, written 2026-11-11. Nothing here is built or carded yet. Decisions that are the maintainer's are marked **Decide**.

## 1. Where things stand

- **v2 today** is a set of Rust crates on the branch `auto/v2-build`: the kernel (`plan-core`), drawings and PDF (`plan-render`), a command-line tool, and an MCP server that talks over stdio and keeps plans as files in a folder. It runs on one machine, for one person. Nothing is hosted.
- **v1 is hosted** on Vercel (project `laughing-tribble`, Next.js). It already has everything a hosted service needs (`docs/deploy.md`):
  - plans, revisions and scanned drawings in a private Vercel Blob store, per person;
  - personal keys, invitation links, and OAuth for the Claude connector;
  - an MCP endpoint (`/api/mcp`), upload links, sharing between accounts;
  - deploys from Git (`main` to production, branches to previews) and a smoke check after each deploy.
- **Checked 2026-11-11:** `plan-core` and `plan-render` compile for `wasm32-unknown-unknown` (release build). The kernel has no I/O, so it can run inside a Node function or a browser.

## 2. Where to deploy: three options

| | A. Inside the existing Vercel app | B. A separate Rust service | C. No hosting |
|---|---|---|---|
| How | The kernel is built to WebAssembly and called from new routes in the Next.js app | `axum` + MCP over HTTP on Fly.io or Cloud Run | The stdio server on your machine; drawings exported as files |
| Accounts, OAuth, invitations | v1's, used as they are | Built again, or an auth provider | None |
| Storage | v1's Blob store, a `v2/` folder per person | A new bucket or volume | Local files |
| Upload links, share links | v1's mechanism | Built again | Not available |
| Deploys | The pipeline that exists | A new one, with secrets and a domain | None |
| New work (estimate) | 20–25 cards | 35–45 cards | 4–6 cards for a viewer file |
| Running cost | Nothing new | About $5–30 a month | Nothing |
| Main drawback | A thin TypeScript layer around the kernel; the Vercel build must produce the WebAssembly file | Rebuilds what v1 already has | Only you can use it; no connector on claude.ai |

**Recommendation: C first, then A. Not B.**
- C costs a few cards and gives a viewer on the phone at once, with no deployment decision at all.
- A reuses every hosted part of v1 in place. The earlier plan said not to *port* v1's accounts to a new service; hosting v2 inside the same app means they are not ported, they are simply used.
- A also makes the cut-over from v1 simple: both engines read the same store, so a plan can move to v2 one at a time.

**Decide 1:** A or B for hosting.

## 3. The view-only mobile app

A web page, not an app-store app. It can be added to the phone's home screen and works offline once opened.

**What it shows**
- The plan, with pinch zoom and pan. The drawing is the kernel's SVG, so it is identical to the PDF.
- Layers to switch on and off: room names and areas, dimensions, fixtures, element ids, before and after.
- Tap a room, wall or opening: its name, clear size, area, wall thickness, and where each number comes from (laser, drawing, assumed).
- The open findings: conflicts, missing measurements, review notes. Read-only.
- A link to the PDF sheet.

**What it never has:** any way to change the plan. No edit code is shipped to it.

**Two steps**
1. **Viewer file (option C).** `plan export --format html` and the MCP `export` tool write one self-contained HTML file: the SVG, the element data, and a small script for zoom, layers and tap. Send it by AirDrop, mail or a message; it opens in any phone browser with no server.
2. **Hosted viewer (option A).** The same page at `/v/<token>`: an unguessable, read-only link that can be revoked and can expire. It shows the latest revision, or one pinned revision.

**Decide 2:** may a view link be opened by anyone who has it, without signing in? v1 shares only between accounts. A token link is what makes "send it to the board or the contractor" work; I recommend yes, with revoke and expiry.

## 4. How option A is built

1. **`plan-tools` crate.** Today the tool logic (check, get, apply, render, export, find, history) lives in the stdio server together with file access. Move it into a pure crate: JSON in, JSON out, with storage behind a small trait. The stdio server and the hosted routes then share one implementation, so the TypeScript layer stays thin.
2. **`plan-wasm` crate.** `wasm-bindgen` exports of `plan-tools`, plus SVG, PNG and PDF output. CI builds and tests it for `wasm32`.
3. **Build.** The WebAssembly file is produced by a GitHub Action and committed or attached to the deploy, or built in the Vercel build with a Rust toolchain. A short spike decides which; the Action is the safer default.
4. **Routes in the Next.js app.**
   - `/api/mcp2`: the v2 tools, behind v1's OAuth and personal keys.
   - Storage adapter: plan text, history and source images in the Blob store under `u/<person>/v2/`.
   - Upload link: v1's page. (The localhost upload page of card W6-04 is for the stdio server only.)
   - `/v/<token>`: the viewer.
5. **Previews and checks.** Every branch gets a preview deployment with its own store, as today; the smoke check gains a v2 round trip (apply, check, render).

## 5. Proposed order of work

| Step | Work | Needs |
|---|---|---|
| 1 | Row 7: source images, overlay, find, history (14 cards, written) | Nothing |
| 2 | Viewer file: one self-contained HTML export | Nothing |
| 3 | `plan-tools` and `plan-wasm`; CI for `wasm32` | Nothing |
| 4 | Hosted v2 in the Vercel app: storage, MCP endpoint, upload link, view links | Decide 1 and 2 |
| 5 | Import of v1 plans and cut-over | Angled walls for plans like Gnejsen 48 A/B |
| 6 | The editor | Decide 3 |
| 7 | Accounts and sharing | Nothing new if option A |

**Decide 3 (not urgent): what the editor is built with.** The plan of 2026-11-09 chose a Rust editor (egui) for desktop and browser. With the kernel running as WebAssembly inside the Next.js app, a browser editor in TypeScript that draws the kernel's SVG and sends it commands becomes a real alternative, and it could reuse parts of v1's editor. This can wait until step 4 is running.

## 6. Risks

- **WebAssembly size and cold start.** PNG and PDF output pull in font and rendering code; the file may be several MB. If a Vercel function starts too slowly, PNG and PDF move to their own function.
- **Two tool layers during the move.** Until `plan-tools` exists, the stdio server and any hosted route would drift. That is why step 3 comes before step 4.
- **The Vercel build.** Building Rust inside it is unverified; the GitHub Action route avoids the question.
- **Private data in view links.** A token link shows a home's layout to whoever holds it. Revoke and expiry are part of the first version, not an afterthought.
