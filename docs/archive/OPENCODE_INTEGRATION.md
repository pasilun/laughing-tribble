# Opencode Integration Guide

## Overview

The autonomous AI dev loop now uses **opencode** instead of Anthropic/Claude for all AI agent execution.

## Architecture

```
GitHub Actions → npx opencode <agent> → Your Opencode Account → Result
   (orchestrator)     (CLI invocation)       (AI execution)      (output)
```

## Required GitHub Secrets

Add these in: **GitHub → Settings → Secrets and variables → Actions → New repository secret**

### AI Agent Secret
- `OPENCODE_API_KEY` — Your opencode account API key

### Deployment Secrets
- `VERCEL_TOKEN` — Vercel API token (get from vercel.com/tokens)
- `VERCEL_ORG_ID` — Your Vercel organization ID

### Email Secrets
- `EMAIL_USERNAME` — Your email for daily digest
- `EMAIL_PASSWORD` — Email app password

### Optional Secrets
- `SLACK_WEBHOOK_URL` — For Slack notifications

## Agent Commands

The workflows use these opencode CLI commands:

### Spec Agent
```bash
npx opencode spec-agent \
  --issue-number "${{ github.event.issue.number }}" \
  --issue-title "${{ github.event.issue.title }}" \
  --issue-body "${{ github.event.issue.body }}" \
  --spec-template "specs/_template.md" \
  --system-prompt "agents/spec/system-prompt.md"
```

### Dev Agent
```bash
npx opencode dev-agent \
  --spec-file "${{ steps.spec.outputs.file }}" \
  --spec-name "${{ steps.spec.outputs.name }}" \
  --pr-number "${{ steps.pr.outputs.number }}" \
  --system-prompt "agents/dev/system-prompt.md"
```

### Verification Agent
```bash
npx opencode verifier-agent \
  --spec-file "${{ steps.spec.outputs.file }}" \
  --preview-url "${{ steps.deploy.outputs.url }}" \
  --system-prompt "agents/verifier/system-prompt.md" \
  --output-file verification-result.json
```

## Getting Your Opencode API Key

1. Log in to your opencode account
2. Go to Settings → API Keys
3. Generate a new API key
4. Copy the key
5. Add it as `OPENCODE_API_KEY` in GitHub Secrets

## How Opencode Integrates

### What Opencode Does

1. **Receives the prompt** from GitHub Actions via CLI arguments
2. **Loads the system prompt** from the specified file (`agents/*/system-prompt.md`)
3. **Processes the request** using your opencode account's AI capabilities
4. **Returns the result** (for spec/dev agents: creates files/commits; for verifier: outputs JSON)

### What GitHub Actions Does

1. **Triggers on events** (issue labeled, PR merged, etc.)
2. **Sets up the environment** (checkout, install dependencies, deploy preview)
3. **Calls opencode** with appropriate arguments
4. **Processes the result** (comments on PR, merges, etc.)

## Testing the Integration

### 1. Add OPENCODE_API_KEY Secret
```bash
# Or add via GitHub web UI
gh secret set OPENCODE_API_KEY
# Paste your key when prompted
```

### 2. Create a Test Issue
```bash
# Create a simple feature request
gh issue create \
  --title "Test feature: Change greeting color" \
  --body "Add a button that changes the greeting text color to red when clicked." \
  --label "feature-request"
```

### 3. Watch the Workflow
- Go to the **Actions** tab in GitHub
- Watch the **Spec Agent** workflow run
- Verify it creates a spec file and opens a PR

### 4. Test the Full Loop
- Merge the spec PR
- Watch the **Dev Agent** implement the feature
- Watch the **Verification Agent** test it
- Watch **Auto-Merge** (if all checks pass)

## Troubleshooting

### Opencode Not Found
```bash
Error: command not found: opencode
```
**Solution:** The opencode CLI is called via `npx opencode`, which should work automatically. If not, add:
```yaml
- name: Install opencode
  run: npm install -g opencode
```

### API Key Not Found
```bash
Error: OPENCODE_API_KEY not set
```
**Solution:** Add `OPENCODE_API_KEY` as a GitHub secret

### Verification Result Parsing Failed
```bash
Error: Cannot parse verification result
```
**Solution:** Ensure opencode verifier-agent outputs valid JSON with `verdict` field

### Vercel Deployment Failed
```bash
Error: Vercel deployment failed
```
**Solution:** Check that `VERCEL_TOKEN` and `VERCEL_ORG_ID` are set correctly

## Agent-Specific Notes

### Spec Agent
- Must create a new file in `/specs/`
- Must follow the `_template.md` format
- Must open a draft PR with just the spec

### Dev Agent
- Must read the spec file
- Must implement the feature
- Must run typecheck and lint
- Must push changes to the PR

### Verification Agent
- Must read ONLY the spec (not the implementation)
- Must test the preview URL via Playwright
- Must output JSON with `verdict: pass` or `verdict: fail`
- Must include `criteria` array with test results

## Expected Output Format

### Verification Agent JSON
```json
{
  "verdict": "pass",
  "criteria": [
    {
      "id": "scenario-1-1",
      "status": "pass",
      "evidence": "URL changed from '/' to '/design'"
    }
  ]
}
```

## Next Steps

1. ✅ Add `OPENCODE_API_KEY` to GitHub Secrets
2. ✅ Test with a simple feature request
3. ✅ Verify the full loop works end-to-end
4. ✅ Begin Phase 1: Friggebod flow

## Questions?

If opencode CLI behaves differently than expected:
1. Check the opencode documentation for CLI usage
2. Update the workflow commands accordingly
3. Update this guide with the correct syntax
