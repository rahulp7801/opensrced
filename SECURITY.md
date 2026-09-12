# Security policy

Security fixes are maintained on `main`. This project is still pre-1.0, so older commits and deployments are not supported.

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
