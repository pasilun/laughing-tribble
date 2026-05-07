# Domain Model - Wiki Entry

## Overview

The core entities, fields, relationships, and invariants of the bygglov assistant. This is the **source of truth** for the data model.

The Prisma schema is **derived from this doc**, not the other way around. When dev agent and this doc disagree, this doc wins. Schema changes require explicit spec and Patrik approval.

## Conventions

- **IDs:** CUID strings (24 chars), generated client-side or by Prisma. Never expose database integer IDs.
- **Timestamps:** UTC (`DateTime`), rendered in user's timezone (default `Europe/Stockholm`) at UI layer.
- **Soft delete:** `deleted_at` timestamp on user-facing entities. Hard delete on GDPR request.
- **Auto-fields:** `created_at` (`@default(now())`), `updated_at` (`@updatedAt`) on every entity.
- **Enums:** Stored as strings in DB (Postgres: native enum, SQLite: text-with-CHECK).
- **JSONB fields:** Prisma `Json` type with TypeScript shape in `/lib/types/`, validated at boundary with Zod.
- **Swedish text:** `String` with no charset constraint. DB collation must support `åäöÅÄÖ`.

## Enums

```typescript
enum FlowType {
  KOMPLEMENTBYGGNAD
  KOMPLEMENTBOSTADSHUS
  TILLBYGGNAD
  ELDSTAD
  PLANK
  MUR
  OTHER
}

enum Bucket {
  LOVFRI
  ANMALAN
  BYGGLOV
}

enum ProjectStatus {
  DRAFT          // Created, no triage yet
  TRIAGED        // Triage complete, bucket assigned
  DESIGNING      // User working on parameters/3D model
  REVIEWED       // Tjänsteman reviewed, findings present
  FINALIZED      // Packet locked for download/submission
  SUBMITTED      // User submitted to kommun
  ARCHIVED       // User archived
}

enum PacketType {
  BYGGHERRE_DOKUMENTATION  // Bucket = LOVFRI
  ANMALAN                  // Bucket = ANMALAN
  BYGGLOV                  // Bucket = BYGGLOV
}

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
  UPLOADED_KARTA
  UPLOADED_OTHER
  RULES_SUMMARY
}

enum InstallationType {
  VATTEN
  AVLOPP
  ELDSTAD
  ROKKANAL
  VENTILATION
  ANDRAD_BARANDE_KONSTRUKTION
}

enum FindingSource {
  TRIAGE
  PACKET
}

enum FindingStatus {
  OPEN          // Active, requires attention if blocking/warning
  ACKNOWLEDGED  // User has seen (warnings)
  RESOLVED      // User fixed the issue
  DISMISSED     // User ignored (info/recommendation only)
}
```

## Entities

### User

```typescript
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
- `email` unique and non-null
- Soft delete cascades to properties and projects in application logic (not DB)

**Auth fields** managed by auth library (NextAuth, etc.) in adjacent tables (`Account`, `Session`) - these are protected paths.

---

### Property (Fastighet)

```typescript
model Property {
  id                       String    @id @default(cuid())
  user_id                  String
  user                     User      @relation(fields: [user_id], references: [id])

  fastighetsbeteckning     String    // Format validated
  address_street           String?
  address_postal_code      String?
  address_city             String?
  kommun                   String    // e.g. "Strängnäs", "Stockholm"

  inom_detaljplan          Boolean?  // Null until determined
  detaljplan_id            String?   // Boverket Planbestämmelsekatalog-ID or kommun-ref

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
  documents                Document[]

  @@index([user_id])
  @@index([fastighetsbeteckning])
}
```

**fastighetsbeteckning format:** `KOMMUN BLOCK:ENHET`

Examples:
- `STRÄNGNÄS BERGA 1:23`
- `STOCKHOLM KUNGSHOLMEN 1:1`
- `UPPSALA LUTHAGEN 17:9`
- `STRÄNGNÄS BERGA 1:23>1` (skifteslag suffix)

**Regex:** `^[A-ZÅÄÖ][A-ZÅÄÖ \-]+ [A-ZÅÄÖ][A-ZÅÄÖ \-]+ \d+:\d+(>\d+)?$`

**Validation strategy:**
- Reject non-matching at API boundary with Swedish error message
- Display in UI with uppercase formatting
- Store as entered (uppercase enforced)
- **Do NOT verify against Lantmäteriet at write time** - verification is separate flow

**Invariants:**
- `kommun` must match kommun part of `fastighetsbeteckning` (validated at write, warning if mismatch)
- Cannot hard-delete if non-archived projects exist

---

### Project

```typescript
model Project {
  id                            String         @id @default(cuid())
  property_id                   String
  property                      Property       @relation(fields: [property_id], references: [id])
  user_id                       String
  user                          User           @relation(fields: [user_id], references: [id])

  name                          String          // User-friendly: "Förråd vid garaget"
  description                   String          // Free text: "Jag vill bygga..."

  flow_type                     FlowType?       // Null until user picks/triage infers
  bucket                        Bucket?         // Null until triaged
  status                        ProjectStatus   @default(DRAFT)

  triage_completed_at           DateTime?
  triage_input_snapshot         Json?           // Frozen inputs for re-runs/audit

  // Design parameters - shape varies by flow_type
  planned_dimensions            Json?           // { area_m2, nockhojd_m, langd_m, bredd_m, taklutning_grader }
  planned_position              Json?           // { distance_to_grans_m, distance_to_allman_plats_m, position_on_property }
  installations                 InstallationType[]

  created_at                    DateTime        @default(now())
  updated_at                    DateTime        @updatedAt
  archived_at                   DateTime?
  deleted_at                    DateTime?

  packet                        Packet?
  findings                      Finding[]
  grannmedgivanden              Grannmedgivande[]
  submission                    Submission?

  @@index([property_id])
  @@index([user_id])
  @@index([status])
}
```

**Invariants:**
- `bucket` must match `packet.type` once Packet exists: LOVFRI↔BYGGHERRE_DOKUMENTATION, ANMALAN↔ANMALAN, BYGGLOV↔BYGGLOV
- Status transitions are forward-only **except** TRIAGED↔DESIGNING is bidirectional
- Once `status == FINALIZED`: `bucket`, `flow_type`, `planned_dimensions` become immutable. User must explicitly "unfinalize" (transitions back to DESIGNING, clears `packet.finalized_at`)
- `triage_input_snapshot` set when triage runs; freezes inputs for diff against historic

**Status transitions:**
```
DRAFT → TRIAGED          (triage runs, bucket assigned)
TRIAGED → DESIGNING      (user starts working on parameters/drawings)
DESIGNING → TRIAGED      (user changes inputs, triage re-runs)
DESIGNING → REVIEWED     (tjänsteman reviewed, findings exist)
REVIEWED → DESIGNING     (user makes changes after review)
REVIEWED → FINALIZED     (user finalizes; only if no blocking findings)
FINALIZED → DESIGNING    (user unfinalizes to make changes)
FINALIZED → SUBMITTED    (user marks as submitted)
ANY → ARCHIVED           (user archives)
```

---

### Packet

```typescript
model Packet {
  id                  String       @id @default(cuid())
  project_id          String       @unique  // 1:1 with Project
  project             Project      @relation(fields: [project_id], references: [id])

  type                PacketType
  finalized           Boolean      @default(false)
  finalized_at        DateTime?

  last_review_at      DateTime?
  last_review_pinned_at DateTime?  // When findings last regenerated

  documents           Document[]
  findings            Finding[]    // source = PACKET only

  created_at          DateTime     @default(now())
  updated_at          DateTime     @updatedAt
}
```

**Invariants:**
- `type` matches `project.bucket` (enforced in application; on bucket change, packet is regenerated, not mutated)
- When `finalized == true`: documents become immutable (any edit transitions Project back to DESIGNING, sets `finalized = false` with warning)
- Cannot finalize if any Finding linked has `severity == BLOCKING and status == OPEN`

---

### Document

```typescript
model Document {
  id              String        @id @default(cuid())
  packet_id       String?       // Null for property-level docs
  packet          Packet?       @relation(fields: [packet_id], references: [id])
  property_id     String?       // Set for property-level docs
  property        Property?     @relation(fields: [property_id], references: [id])

  type            DocumentType
  subtype         String?       // e.g. "NORTH" for FASADRITNING

  file_path       String?       // Object storage path
  content_md      String?       // Markdown for generated text
  mime_type       String?       // e.g. "application/pdf"
  bytes           Int?

  generated       Boolean       @default(false)
  generated_from  Json?         // Snapshot of parameters used

  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt
  deleted_at      DateTime?

  @@index([packet_id])
  @@index([property_id])
}
```

**Invariants:**
- Exactly one of `packet_id` or `property_id` is non-null
- Exactly one of `file_path` or `content_md` is non-null
- `subtype` required for `type == FASADRITNING` (NORTH/SOUTH/EAST/WEST or named direction)
- File naming convention: `<type>.pdf` (e.g. `situationsplan.pdf`) per kommun e-tjänst convention

---

### Finding

```typescript
model Finding {
  id                String         @id @default(cuid())
  project_id        String         // Always set
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

  created_at        DateTime        @default(now())
  updated_at        DateTime        @updatedAt

  @@index([project_id])
  @@index([packet_id])
  @@index([finding_id])
  @@index([status])
}
```

**Invariants:**
- `finding_id` must match active (non-deprecated) entry in [[findings-contract]]. Validated at write time
- `variables` must contain all `required_variables` for that `finding_id`. Validated at write time
- **Severity, category, message template, källa, suggested_fix are NEVER stored** - looked up from contract at render time. Reason: when wording/severity changes in contract, all historic findings reflect new wording immediately
- `source = TRIAGE` findings have `packet_id == null`. `source = PACKET` findings must have `packet_id != null`

---

### Grannmedgivande

```typescript
model Grannmedgivande {
  id                  String     @id @default(cuid())
  project_id          String
  project             Project    @relation(fields: [project_id], references: [id])

  granne_namn         String
  granne_fastighet    String     // Validated like Property.fastighetsbeteckning
  signed_at           DateTime?
  file_path           String?    // Signed PDF upload

  created_at          DateTime   @default(now())
  updated_at          DateTime   @updatedAt
}
```

**Invariants:**
- `granne_fastighet` follows same regex as `Property.fastighetsbeteckning`
- "Complete" when both `signed_at` and `file_path` are set

---

### Submission

```typescript
model Submission {
  id                String     @id @default(cuid())
  project_id        String     @unique
  project           Project    @relation(fields: [project_id], references: [id])

  kommun            String
  e_tjanst          String?    // e.g. "Mittbygge", "Stockholm bygglov"
  submitted_at      DateTime
  reference_number  String?    // Kommunens diarienr
  status            String?    // "Inlämnad", "Under handläggning", "Beviljad", "Avslagen"
  status_updated_at DateTime?
  notes             String?    // User notes

  created_at        DateTime   @default(now())
  updated_at        DateTime   @updatedAt
}
```

**Invariants:**
- Cannot be created unless `project.status == FINALIZED` and `project.packet.finalized == true`

---

## Cross-Cutting Concerns

### Data Handling (GDPR)

**Personal data:**
- `User.email`, `User.name`
- `Property.fastighetsbeteckning`, `address_*`, `coordinates_*`
- Uploaded documents (may contain personal data)
- `Grannmedgivande.granne_namn`, `granne_fastighet`

**Posture:**
- Encryption at rest: delegated to Turso (libSQL) and Vercel Blob
- Soft delete retention: 30 days, then hard-delete by scheduled job
- User can request immediate hard-delete (separate flow, audited)
- Access logging: requests with `user_id` and resource ID only
- No analytics on user content. Aggregate counts only.

### Validation Strategy

1. **API boundary:** Zod schemas in `/lib/types/` mirror Prisma model. Every route handler validates with Zod before touching Prisma.
2. **DB layer:** Prisma enforces type and required/optional.
3. **Agent boundary:** Before persisting agent-emitted Finding, validate `finding_id` exists in contract and `variables` includes all required keys.

### Testability

- Every model has factory in `/lib/test-factories/` for fixture and test seeding
- `Property` factory includes Patrik's actual Strängnäs property as named export for end-to-end dogfood testing
- `Finding` factory accepts `finding_id` and produces matching `variables` object

### What Dev Agent Does NOT Do

- Add fields to entities without spec calling them out and referencing this doc
- Add/extend enums without spec
- Touch auth-adjacent tables (`Account`, `Session`, `VerificationToken`)
- Touch migration history files directly (migrations generated by `prisma migrate`)
- Cascade-delete via DB constraints (all cascades are application-level for auditability)

## Open Questions for Patrik

1. **Multi-property projects** - Can project span two adjacent fastigheter? MVP: no
2. **Project sharing / multi-user** - Should property/project be shareable with spouse/co-owner? MVP: no, single-user
3. **Document versioning** - Keep history of document edits? MVP proposal: last N=5
4. **Grannmedgivande as separate model** - Justified if specific structure needed. Recommend keeping separate.
5. **Submission tracking depth** - `Submission.status`: free text or closed enum? MVP: free text
6. **Hard-delete trigger** - UI button with 7-day grace period? Or email request only?

## Related Wiki Entries

- [[findings-contract]] - Finding entity uses finding_id from this contract
- [[triage-rules]] - Project.bucket and triage_input_snapshot relate to triage
- [[regulatory-version]] - Version pinning for källa references
- [[packet-contract]] - Packet.document structure per type

## Source Document

This wiki entry is derived from: `/docs/domain-model.md`

**Last updated:** 2026-05-03
**Status:** Living document - schema-shaping changes require explicit Patrik approval
