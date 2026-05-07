# Laughing Tribble — Autonomous AI Dev Loop

A full-stack bygglov assistant built by an autonomous AI development loop. The AI ships features end-to-end: from spec to implementation to verification to auto-merge.

## What This Is

This project demonstrates an autonomous AI development loop that:
1. **Spec Agent** — Takes feature requests and writes detailed specs
2. **Dev Agent** — Implements features based on specs
3. **Verification Agent** — Tests implementations against specs (black-box)
4. **Auto-Merge** — Merges when all checks pass

The product being built is a **Swedish bygglov assistant** that helps users create building permit applications for small structures (friggebod, attefall, etc.).

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint

# Tests
npm test
```

## Project Structure

```
laughing-tribble/
├── agents/              # System prompts for AI agents
│   ├── spec/           # Spec agent prompt
│   ├── dev/            # Dev agent prompt
│   ├── verifier/       # Verification agent prompt
│   └── tjansteman/     # Tjänsteman agent (product feature)
├── specs/              # Feature specifications
│   └── _template.md    # Spec template
├── app/                # Next.js app directory
├── fixtures/           # Golden cases for tjänsteman testing
├── .github/workflows/  # GitHub Actions for the loop
├── CLAUDE.md          # Dev agent instructions
└── vercel.json        # Vercel configuration
```

## The Loop

### 1. Feature Request
Label an issue with `feature-request` to trigger the Spec Agent.

### 2. Spec Creation
The Spec Agent:
- Reads the issue
- Explores the repo
- Writes a detailed spec in `/specs/`
- Opens a draft PR

### 3. Implementation
The Dev Agent:
- Reads the spec
- Implements the feature
- Writes tests
- Pushes to the PR

### 4. Verification
The Verification Agent:
- Reads the spec (not the code)
- Tests the deployed preview
- Returns pass/fail per acceptance criterion

### 5. Auto-Merge
If all checks pass:
- Typecheck ✓
- Lint ✓
- Tests ✓
- Verification ✓
- Golden cases ✓ (if applicable)
- Diff < 400 lines
- No protected paths touched

The PR is automatically merged.

### 6. Daily Digest
Each morning at 8 AM UTC, you receive:
- List of yesterday's merges
- Any events (reverts, failures)
- Repository stats

## Protected Paths

These paths are NEVER edited by agents:
- `/fixtures/bygglov-cases/**` — Golden cases
- `/agents/tjansteman/corpus/**` — Legal corpus
- `/agents/tjansteman/system-prompt.md` — Tjänsteman prompt
- `CLAUDE.md` — Loop configuration
- Auth, payments, migrations, CI config

## Product: Bygglov Assistant

The app helps Swedish users create bygglov/anmälan packets for:

- **Friggebod** (15 m², bygglovsfri)
- **Attefallshus** (30 m², anmälan)
- **Attefallstillbyggnad** (15 m² BTA, anmälan)
- **Komplementbyggnad** (bygglov)
- **Liten tillbyggnad** (bygglov)

### Three Phases

1. **Design** — Parametric 3D modeling from Swedish text prompts
2. **Documentation** — Generate PDFs, situationsplaner, teknisk beskrivning
3. **Review** — Tjänsteman agent checks against PBL/BBR

## Deployment

This project is configured for Vercel with:
- Automatic preview deployments for PRs
- Production deployments on merge to main
- Environment-specific configuration

### Manual Deployment

```bash
npm run build
vercel --prod
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

Required for full functionality:
- `EMAIL_USERNAME` / `EMAIL_PASSWORD` — Daily digest
- `SLACK_WEBHOOK_URL` — Optional Slack notifications
- `DATABASE_URL` — For later phases
- `ANTHROPIC_API_KEY` — For AI agents
- `OPENAI_API_KEY` — Alternative AI provider

## Current Status

**Phase 0 — Loop Infrastructure** ✅

- [x] Next.js skeleton
- [x] Agent system prompts
- [x] GitHub Actions workflows
- [x] Trivial test feature (greeting)
- [x] Vercel configuration

**Phase 1 — Friggebod Flow** (Next)
- [ ] Parametric 3D modeling
- [ ] Situationsplan overlay
- [ ] PDF exports
- [ ] Tjänsteman checklist
- [ ] Golden cases

## Contributing

This project uses an autonomous AI loop. Humans:
- Write feature requests (as GitHub issues)
- Review and merge specs
- Handle edge cases and escalations
- Maintain legal correctness

## License

See LICENSE file.
