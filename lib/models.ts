// Model IDs and API bases, in one place.
//
// These were previously hardcoded at each call site — `gemini-2.0-flash`
// was pinned in two separate files, so different parts of the pipeline
// reviewed patches with different models and nobody could tell from the logs.
//
// Bump here, not at the call site.

/** Gemini REST base. v1beta is where the flash models live. */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Patch self-review in the auto-PR pipeline. Wants speed + cheap tokens;
 *  the diff is already small by the time it gets here. */
export const GEMINI_REVIEW_MODEL = "gemini-2.5-flash";

/** Repo metadata enrichment — short, high-volume, latency-sensitive. */
export const GEMINI_ENRICH_MODEL = "gemini-2.5-flash";

// ── Anthropic ─────────────────────────────────────────────────────────
// Passed as `--model` to the Claude Code CLI (explore, deep fix) or as the
// `model` field to /v1/messages (quick fix, graph query, draft reply).
//
// Nothing here sends `thinking`, `temperature`, or an assistant prefill, so
// the Sonnet 4.5 → 5 breaking changes don't apply to these call sites — the
// swap is the model string alone.

/** Agentic exploration and deep fixes. Was claude-sonnet-4-5 (legacy).
 *
 *  Two cost notes for the budget-capped CLI paths: Sonnet 5 defaults to
 *  `effort: high`, and its tokenizer produces ~30% more tokens for the same
 *  text. The --max-budget-usd caps at each call site were tuned against 4.5,
 *  so watch for runs that now stop early on budget rather than on task
 *  completion. ponytail: bump the caps if that shows up; don't pre-tune. */
export const CLAUDE_AGENT_MODEL = "claude-sonnet-5";

/** Quick single-file fixes and short structured extractions — cheap and
 *  fast. Alias rather than the dated claude-haiku-4-5-20251001 pin; same
 *  model, and it won't silently rot when the snapshot rolls. */
export const CLAUDE_FAST_MODEL = "claude-haiku-4-5";
