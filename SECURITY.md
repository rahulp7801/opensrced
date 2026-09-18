# Security policy

Security fixes are maintained on `main`. Production acceptance is still pending;
older releases, commits, and deployments are not maintained security branches.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/rahulp7801/opensrced/security/advisories/new). Please include the affected route or workflow, reproduction steps, and the impact you observed. Do not open a public issue for an unpatched vulnerability or include credentials in a report.

## Data and credentials

- Provider API keys and GitHub credentials belong in deployment environment variables or the encrypted account settings flow. They must never be committed.
- A user-initiated review may send bounded repository source, patch, issue, or review context to the provider that user configured.
- Draft pull request content is sent to GitHub with the requesting user or installation credential.
- Run logs may contain repository content and should be treated as private application data. Credential values are excluded from logs.
- Shared fix links are unlisted review artifacts, not a storage mechanism for secrets.
  They expire 30 days after creation, and expired records are deleted opportunistically.

If a credential is exposed, revoke it at the provider first, then remove it from the current tree and Git history as needed.

## Reviewed external data flows

Repository source and graphs may be sent to Anthropic for a user-requested
answer or patch. Generated diffs may be sent to Gemini for optional review;
PR content is published to GitHub with the requesting credential. These are
intentional data flows, not a claim that repository content is non-sensitive.

- Direct Anthropic text requests use a fixed HTTPS endpoint, reject redirects,
  and block recognized credential patterns in prompt/source content. Errors
  name the credential kind without echoing its value.
- Automatic publication scans both the final checkout and the full raw patch
  so deleted/context credentials cannot bypass the disclosure gate. The scan
  root is owned by the application; target `.gitleaksignore`, configuration,
  and inline allow comments do not control that gate.
- Gemini review requires a completed provider answer and reads its final verdict
  across all answer parts. Truncated, blocked, empty, or oversized answers are
  recorded as unavailable. Review remains optional; missing review is not a
  clean verdict or proof that a patch is safe.
- Provider responses and PR results are written to owner-scoped run logs;
  returned PR URLs and structured log values are validated before storage.

Five medium CodeQL data-flow findings remain open for visibility and continued
review as of September 17, 2026. Analysis success is not a finding-free audit.
Secret detection is incomplete by nature; users must review generated artifacts
and follow the target repository's validation process.
