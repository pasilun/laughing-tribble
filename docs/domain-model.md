# domain-model.md

**Status:** living document. Schema-shaping changes require explicit Patrik approval.
**Consumed by:** Prisma schema generator, all API route handlers, the tjänsteman agent, the dev agent.

This document defines the core entities, their fields, their relationships, and the invariants that must hold. The Prisma schema is **derived from this doc**, not the other way around. When dev agent and this doc disagree, this doc wins; if a feature requires a model change, the spec must call it out and Patrik must approve the change to this doc before the dev agent touches the schema.

---

## Conventions

- IDs are CUIDs (string, 24 chars), generated client-side or by Prisma defaults. Never expose database integer IDs.
- All timestamps are stored as UTC (`DateTime`), rendered in user's timezone (default `Europe/Stockholm`) at the UI layer.
- Soft delete via `deleted_at` timestamp on user-facing entities. Hard delete on user GDPR request — handled separately, see "Data handling" below.
- `created_at` and `updated_at` on every entity. Prisma manages them via `@default(now())` and `@updatedAt`.
- Enums are stored as strings in the DB (Prisma `enum` maps to native enum on Postgres, falls back to text-with-CHECK on SQLite — both fine).
- JSONB-like fields use Prisma's `Json` type, with a TypeScript shape declared in `/lib/types/` and validated at the application boundary with Zod.
- All Swedish-language string content (descriptions, names) is `String` with no enforced charset constraint. Database collation must support `åäöÅÄÖ`.

---

## Enums

```ts
// Project flow types — matches triage-rules.md inputs
enum FlowType {
  KOMPLEMENTBYGGNAD
  KOMPLEMENTBOSTADSHUS
  TILLBYGGNAD
  ELDSTAD
  PLANK
  MUR
  OTHER
}

// Triage outcome — matches triage-rules.md buckets
enum Bucket {
  LOVFRI
  ANMALAN
  BYGGLOV
}

// Project lifecycle
enum ProjectStatus {
  DRAFT          // Created, no triage yet
  TRIAGED        // Triage complete, bucket assigned
  DESIGNING      // User working on parameters/3D model
  REVIEWED       // Tjänsteman has reviewed, findings present
  FINALIZED      // Packet locked for download/submission
  SUBMITTED      // User has submitted to kommun (where applicable)
  ARCHIVED       // User archived; not deleted
}

// Packet types — one Packet per Project, type matches Bucket
enum PacketType {
  BYGGHERRE_DOKUMENTATION  // Bucket = LOVFRI
  ANMALAN                  // Bucket = ANMALAN
  BYGGLOV                  // Bucket = BYGGLOV
}

// Document types within a Packet
enum DocumentType {
  SITUATIONSPLAN
  PLANRITNING
  FASADRITNING
  SEKTIONSRITNING
  KONTROLLPLAN
  TEKNISK_BESKRIVNING
  BRANDSKYDDSDOKUMENTATION
  ANSOKAN
  ANMALAN
  GRANNMEDGIVANDE
  UPLOADED_KARTA           // User-uploaded fastighetskarta/nybyggnadskarta
  UPLOADED_OTHER           // Catch-all for user uploads
  RULES_SUMMARY            // Generated rules-that-apply summary for byggherre-dok
}

// Installation triggers (for triage)
enum InstallationType {
  VATTEN
  AVLOPP
  ELDSTAD
  ROKKANAL
  VENTILATION
  ANDRAD_BARANDE_KONSTRUKTION
}

// Finding source — matches findings-contract.md
enum FindingSource {
  TRIAGE
  PACKET
}

// Finding lifecycle
enum FindingStatus {
  OPEN          // Active, requires user attention if blocking/warning
  ACKNOWLEDGED  // User has seen and acknowledged (warnings)
  RESOLVED      // User has fixed the underlying issue
  DISMISSED     // User explicitly chose to ignore (info/recommendation only)
}
```

---

## Entities

### User

```ts
model User {
  id              String    @id @default(cuid())
  email           String    @unique
  name            String?
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt
  last_login_at   DateTime?
  deleted_at      DateTime?

  properties      Property[]
  projects        Project[]
}
```

**Invariants:**
- `email` unique and non-null.
- On soft delete, related properties and projects are also soft-deleted (cascade soft delete in application logic, not DB).

**Auth fields are managed by the auth library** (NextAuth or similar) and live in adjacent tables (`Account`, `Session`, etc.) — those are protected paths, dev agent does not touch them.

---

### Property (Fastighet)

```ts
model Property {
  id                       String    @id @default(cuid())
  user_id                  String
  user                     User      @relation(fields: [user_id], references: [id])

  fastighetsbeteckning     String    // Format validated; see below
  address_street           String?
  address_postal_code      String?
  address_city             String?
  kommun                   String    // E.g. "Strängnäs", "Stockholm"

  inom_detaljplan          Boolean?  // Null until determined
  detaljplan_id            String?   // Boverkets Planbestämmelsekatalog-ID or kommun-ref

  coordinates_lat          Float?
  coordinates_lng          Float?

  k_markning               Boolean   @default(false)
  strandskydd_within_100m  Boolean?  // Null until determined

  huvudbyggnad             Json?     // { type, taknockshojd_m, area_m2, year_built }
  existing_lovfri_buildings Json?    // Array of { type, area_m2, year_built }

  created_at               DateTime  @default(now())
  updated_at               DateTime  @updatedAt
  deleted_at               DateTime?

  projects                 Project[]
  documents                Document[]  // Property-level docs (uploaded fastighetskarta, etc.)

  @@index([user_id])
  @@index([fastighetsbeteckning])
}
```

**fastighetsbeteckning format:**

Standard form: `KOMMUN BLOCK:ENHET`. Examples:

- `STRÄNGNÄS BERGA 1:23` (rural)
- `STOCKHOLM KUNGSHOLMEN 1:1` (urban)
- `UPPSALA LUTHAGEN 17:9` (urban med flersifferblock)
- `MÖRBYLÅNGA SÖDRA SANDBY 5:12` (skifteslag — block can contain spaces)
- `STRÄNGNÄS BERGA 1:23>1` (skifteslag/lott suffix — separator `>`)

Regex (permissive, allows åäöÅÄÖ and spaces in kommun/block, with optional skifteslag suffix):

```
^[A-ZÅÄÖ][A-ZÅÄÖ \-]+ [A-ZÅÄÖ][A-ZÅÄÖ \-]+ \d+:\d+(>\d+)?$
```

**Validation strategy:**
- Reject inputs that don't match the regex at the API boundary with a clear Swedish error message.
- Display in UI with consistent uppercase formatting.
- Store as entered (uppercase enforced).
- Do **not** verify against Lantmäteriet at write time — beteckningar can be reorganized; verification is a separate flow.

**Invariants:**
- `kommun` must match the kommun part of `fastighetsbeteckning` (validated at write time, surfaced as a warning if mismatch).
- A property cannot be hard-deleted if it has non-archived projects.

---

### Project

```ts
model Project {
  id                            String         @id @default(cuid())
  property_id                   String
  property                      Property       @relation(fields: [property_id], references: [id])
  user_id                       String
  user                          User           @relation(fields: [user_id], references: [id])

  name                          String          // User-friendly: "Förråd vid garaget"
  description                   String          // Free text Swedish: "Jag vill bygga..."

  flow_type                     FlowType?       // Null until user picks/triage infers
  bucket                        Bucket?         // Null until triaged
  status                        ProjectStatus   @default(DRAFT)

  triage_completed_at           DateTime?
  triage_input_snapshot         Json?           // Frozen inputs at triage time, for re-runs/audit

  // Design parameters — shape varies by flow_type, validated per flow
  planned_dimensions            Json?           // { area_m2, nockhojd_m, langd_m, bredd_m, taklutning_grader }
  planned_position              Json?           // { distance_to_grans_m, distance_to_allman_plats_m, position_on_property }
  installations                 InstallationType[]

  created_at                    DateTime        @default(now())
  updated_at                    DateTime        @updatedAt
  archived_at                   DateTime?
  deleted_at                    DateTime?

  packet                        Packet?         // 0..1 Packet per Project
  findings                      Finding[]       // Includes both TRIAGE and PACKET findings
  grannmedgivanden              Grannmedgivande[]
  submission                    Submission?

  @@index([property_id])
  @@index([user_id])
  @@index([status])
}
```

**Invariants:**
- `bucket` must match `packet.type` once a Packet exists: LOVFRI↔BYGGHERRE_DOKUMENTATION, ANMALAN↔ANMALAN, BYGGLOV↔BYGGLOV.
- `status` transitions are forward-only with one exception: TRIAGED↔DESIGNING is bidirectional (user may revisit triage if inputs change).
- Once `status == FINALIZED`, `bucket`, `flow_type`, and `planned_dimensions` become immutable. The user must explicitly "unfinalize" (which transitions back to DESIGNING and clears `packet.finalized_at`).
- `triage_input_snapshot` is set when triage runs; it freezes the inputs so a re-run with current inputs can be diffed against historic.

**Status transitions:**

```
DRAFT → TRIAGED          (triage runs, bucket assigned)
TRIAGED → DESIGNING      (user starts working on parameters/drawings)
DESIGNING → TRIAGED      (user changes inputs, triage re-runs)
DESIGNING → REVIEWED     (tjänsteman reviewed packet, findings exist)
REVIEWED → DESIGNING     (user makes changes after review)
REVIEWED → FINALIZED     (user finalizes; only allowed if no blocking findings)
FINALIZED → DESIGNING    (user unfinalizes to make changes)
FINALIZED → SUBMITTED    (user marks as submitted)
ANY → ARCHIVED           (user archives)
```

---

### Packet

```ts
model Packet {
  id                  String       @id @default(cuid())
  project_id          String       @unique  // 1:1 with Project
  project             Project      @relation(fields: [project_id], references: [id])

  type                PacketType
  finalized           Boolean      @default(false)
  finalized_at        DateTime?

  last_review_at      DateTime?
  last_review_pinned_at DateTime?  // When findings were last regenerated

  documents           Document[]
  findings            Finding[]    // Findings with source = PACKET

  created_at          DateTime     @default(now())
  updated_at          DateTime     @updatedAt
}
```

**Invariants:**
- `type` matches `project.bucket` (enforced in application; on bucket change, packet is regenerated, not mutated).
- When `finalized == true`: documents become immutable (any document edit transitions Project back to DESIGNING and sets `finalized = false`, with a warning).
- A Packet cannot be finalized if any Finding linked to it has `severity == BLOCKING and status == OPEN`.

---

### Document

```ts
model Document {
  id              String        @id @default(cuid())
  packet_id       String?       // Null when document is property-level (uploaded karta etc.)
  packet          Packet?       @relation(fields: [packet_id], references: [id])
  property_id     String?       // Set for property-level documents
  property        Property?     @relation(fields: [property_id], references: [id])

  type            DocumentType
  subtype         String?       // E.g. "NORTH" for FASADRITNING; "v1.0" for ANSOKAN-template

  // Content storage strategy: file_path for binary, content_md for generated structured text
  file_path       String?       // Object storage path (Vercel Blob / S3-compatible)
  content_md      String?       // Markdown for generated text artifacts
  mime_type       String?       // E.g. "application/pdf"
  bytes           Int?

  generated       Boolean       @default(false)  // True if produced by app, false if user upload
  generated_from  Json?         // Snapshot of parameters used; for regeneration

  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt
  deleted_at      DateTime?

  @@index([packet_id])
  @@index([property_id])
}
```

**Invariants:**
- Exactly one of `packet_id` or `property_id` is non-null (document belongs to either a packet or a property, not both).
- Exactly one of `file_path` or `content_md` is non-null.
- `subtype` is required for `type == FASADRITNING` (must be one of NORTH/SOUTH/EAST/WEST or a named direction).
- File naming convention for downloaded packets: `<type>.pdf` (e.g. `situationsplan.pdf`, `kontrollplan.pdf`) per kommunens e-tjänst-konvention.

---

### Finding

```ts
model Finding {
  id                String         @id @default(cuid())
  project_id        String         // Always set (TRIAGE findings link via project)
  project           Project        @relation(fields: [project_id], references: [id])
  packet_id         String?        // Set when source = PACKET
  packet            Packet?        @relation(fields: [packet_id], references: [id])

  finding_id        String         // From closed enum in findings-contract.md
  variables         Json           // Fills the message_template

  source            FindingSource
  status            FindingStatus  @default(OPEN)

  acknowledged_at   DateTime?
  resolved_at       DateTime?
  dismissed_at      DateTime?
  resolution_note   String?

  created_at        DateTime       @default(now())
  updated_at        DateTime       @updatedAt

  @@index([project_id])
  @@index([packet_id])
  @@index([finding_id])
  @@index([status])
}
```

**Invariants:**
- `finding_id` must match an active (non-deprecated) entry in `findings-contract.md`. Validated at write time. Deprecated IDs may exist on historic Findings — those render but cannot be created new.
- `variables` must contain all `required_variables` for that `finding_id`. Validated at write time using the contract.
- Severity, category, message template, källa, suggested_fix are **never stored on the Finding** — they are looked up from the contract at render time. Reason: when wording or severity changes in the contract, all historic findings reflect the new wording immediately. The Finding only stores what the agent emitted.
- `source = TRIAGE` findings have `packet_id == null`. `source = PACKET` findings must have `packet_id != null`.

---

### Grannmedgivande

```ts
model Grannmedgivande {
  id                  String     @id @default(cuid())
  project_id          String
  project             Project    @relation(fields: [project_id], references: [id])

  granne_namn         String
  granne_fastighet    String     // Fastighetsbeteckning, validated like Property.fastighetsbeteckning
  signed_at           DateTime?
  file_path           String?    // Signed PDF upload

  created_at          DateTime   @default(now())
  updated_at          DateTime   @updatedAt
}
```

**Invariants:**
- `granne_fastighet` follows the same regex as `Property.fastighetsbeteckning`.
- A Grannmedgivande is "complete" when both `signed_at` and `file_path` are set.

---

### Submission

```ts
model Submission {
  id                String     @id @default(cuid())
  project_id        String     @unique
  project           Project    @relation(fields: [project_id], references: [id])

  kommun            String
  e_tjanst          String?    // E.g. "Mittbygge", "Stockholm bygglov"
  submitted_at      DateTime
  reference_number  String?    // Kommunens diarienr if known
  status            String?    // "Inlämnad", "Under handläggning", "Beviljad", "Avslagen", etc.
  status_updated_at DateTime?
  notes             String?    // Free-text user notes about the submission

  created_at        DateTime   @default(now())
  updated_at        DateTime   @updatedAt
}
```

**Invariants:**
- A Submission cannot be created unless `project.status == FINALIZED` and `project.packet.finalized == true`.

---

## Cross-cutting concerns

### Data handling (GDPR posture)

- **Personal data** in this model: `User.email`, `User.name`, `Property.fastighetsbeteckning`, `Property.address_*`, `Property.coordinates_*`, uploaded documents (which may contain personal data in image form), `Grannmedgivande.granne_namn` and `granne_fastighet`.
- **Encryption at rest:** delegated to Turso (libSQL) and Vercel Blob storage; no app-level encryption beyond what the platform provides.
- **Soft delete retention:** `deleted_at` records held for 30 days, then hard-deleted by a scheduled job. User can request immediate hard delete (separate flow, audited).
- **Access logging:** application logs requests with `user_id` and resource ID; no logging of message bodies or document contents.
- **Analytics:** no analytics on user content. Aggregate counts only (number of projects per bucket, etc.).
- See `disclaimer-policy.md` and `data-handling-policy.md` (TBD) for the user-facing version of this.

### Validation strategy

- **At the API boundary:** Zod schemas in `/lib/types/` mirror the Prisma model exactly. Every route handler validates input with Zod before touching Prisma.
- **At the DB layer:** Prisma enforces type and required/optional. Foreign keys cascade on delete only via application logic (no DB-level cascades), to keep deletes auditable.
- **In the agent boundary:** before persisting an agent-emitted Finding, validate `finding_id` exists in contract and `variables` includes all required keys.

### Testability requirements

- Every model has a corresponding factory in `/lib/test-factories/` for fixture and test seeding.
- The `Property` factory includes Patrik's actual Strängnäs property as a named export for end-to-end dogfood testing.
- The `Finding` factory accepts the `finding_id` and produces a matching `variables` object with placeholder values matching the contract's `required_variables`.

### What the dev agent does NOT do

- Add fields to entities without a spec that calls them out and references this doc.
- Add new enums or extend existing enums without a spec.
- Touch auth-adjacent tables (`Account`, `Session`, `VerificationToken`).
- Touch the migration history files directly (migrations are generated by `prisma migrate`; reviewing the generated migration is part of the merge-gate).
- Cascade-delete via DB constraints — all cascades are application-level so they are auditable and reversible.

---

## Open questions for Patrik

1. **Multi-property projects.** Can a project span two adjacent fastigheter (sammanslagning under handläggning)? MVP: no. Worth confirming.
2. **Project sharing / multi-user.** Should a property/project be shareable with a spouse/co-owner? MVP: no, single-user. Worth confirming.
3. **Document versioning.** Do we keep history of document edits (e.g. ten generations of the same situationsplan as user iterates)? MVP proposal: keep last N=5 with timestamps; only the latest is rendered in the UI by default. Worth confirming.
4. **Grannmedgivande as separate model.** Justified if there's specific structure (signed_at, granne identity). If we keep them as `DocumentType.GRANNMEDGIVANDE`, we lose the structured granne fields. Recommend keeping as separate model — adds value to the UI flow.
5. **Submission tracking depth.** Is `Submission.status` user-entered free text, or a closed enum? MVP: free text. Closed enum requires kommun-by-kommun status mapping.
6. **Hard-delete trigger.** User self-service hard delete via UI button? Or email request only? MVP recommendation: UI button with confirmation dialog plus 7-day grace period, then permanent.
