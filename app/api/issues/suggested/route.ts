// GET /api/issues/suggested?languages=python,typescript&limit=20&tags=strict|broad
// Fetches good-first-issues from popular repos matching the user's preferred languages.
// Uses GitHub search API via gh CLI — no API key cost.
// tags=strict (default) → only "good first issue" label
// tags=broad → also matches "beginner", "starter", "first-timers-only", "easy"

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { githubApi } from "@/lib/github-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const rawLanguages = req.nextUrl.searchParams.get("languages")?.split(",").filter(Boolean) ?? [];
  // Sanitize language names — only allow alphanumeric, hyphens, plus signs (e.g. "c++", "c#")
  const languages = rawLanguages
    .map((l) => l.replace(/[^a-zA-Z0-9+#-]/g, "").slice(0, 30))
    .filter((l) => l.length > 0)
    .slice(0, 10); // max 10 languages
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "20") || 20, 1), 50);
  const tagsMode = req.nextUrl.searchParams.get("tags") === "broad" ? "broad" : "strict";
  const labels = tagsMode === "broad"
    ? ["good first issue", "beginner", "starter", "first-timers-only", "easy"]
    : ["good first issue"];

  const token = await resolveGitHubToken();
  // gh acts as the requesting user or as nobody — never as whatever
  // credential the host happens to have on disk. See lib/child-env.ts.

  try {
    // Build query plan — one (label × language) pair per call. We use gh's
    // flag-based syntax (--label, --language, --state, --sort) instead of
    // an inline `label:"..." state:open language:...` query because the
    // inline form is parsed unreliably by gh search and silently returns
    // empty arrays. Capped at 12 calls to bound rate-limit usage.
    const langs = languages.length > 0 ? languages : [null];
    const queryPlan: Array<{ label: string; language: string | null }> = [];
    for (const label of labels) {
      for (const lang of langs) {
        queryPlan.push({ label, language: lang });
      }
    }
    const plan = queryPlan.slice(0, 12);

    const allIssues: Array<{
      repo: string;
      title: string;
      number: number;
      url: string;
      labels: string[];
      createdAt: string;
      updatedAt: string;
      comments: number;
      language: string;
      stars: number;
    }> = [];

    const perCall = Math.ceil(limit / Math.max(plan.length, 1));

    let failures = 0;
    for (const q of plan) {
      try {
        const query = [`is:issue`, `is:open`, `label:${JSON.stringify(q.label)}`];
        if (q.language) query.push(`language:${JSON.stringify(q.language)}`);
        const params = new URLSearchParams({ q: query.join(" "), sort: "updated", order: "desc", per_page: String(perCall) });
        const raw = await githubApi<{ items: Array<{
          repository_url: string;
          title: string;
          number: number;
          html_url: string;
          labels: Array<{ name: string }>;
          created_at: string;
          updated_at: string;
          comments: number;
        }> }>(`/search/issues?${params}`, token);

        for (const issue of raw.items) {
          allIssues.push({
            repo: new URL(issue.repository_url).pathname.replace(/^\/repos\//, ""),
            title: issue.title,
            number: issue.number,
            url: issue.html_url,
            labels: issue.labels.map((l) => l.name),
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            comments: issue.comments,
            language: q.language ?? "",
            stars: 0,
          });
        }
      } catch {
        failures++;
        // Individual language query failed — continue with others
      }
    }
    if (failures === plan.length) throw new Error("GitHub suggestions could not be loaded. Check access and rate limits.");

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allIssues.filter((i) => {
      if (seen.has(i.url)) return false;
      seen.add(i.url);
      return true;
    });

    // Strip bot-engagement spam — repos that abuse the "good first issue"
    // label for crypto bounties, token farming, social-engagement quests,
    // etc. The "good first issue" feed on GitHub is heavily polluted by a
    // handful of repos doing this; without a filter, real beginner issues
    // get buried.
    const filtered = deduped.filter((i) => !isBotEngagementIssue(i));

    // Sort: recently updated first, then by stars
    filtered.sort((a, b) => {
      const da = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (da !== 0) return da;
      return b.stars - a.stars;
    });

    return Response.json({
      issues: filtered.slice(0, limit),
      filteredOut: deduped.length - filtered.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── Bot-engagement spam filter ────────────────────────────────────────
// Many repos abuse the "good first issue" label for activities that have
// nothing to do with code: crypto bounty programs, social-media tasks,
// follow-and-star quests, airdrop farming. Each pattern below is a strong
// solo signal — any single match drops the issue. Patterns are tuned to
// avoid false positives on legitimate code issues (e.g. a real bug in a
// crypto wallet repo whose title doesn't contain reward syntax stays).

// Repo-name suffix: the project is a bounty/quest farm by definition.
const SPAM_REPO_PATTERNS = [
  /[-_](bounty|bounties|reward|rewards|airdrop|airdrops|quest|quests|task|tasks|gigs|farm|engagement)$/i,
];

// Title prefix: bracketed bounty/onboard tags are the classic format,
// e.g. "[BOUNTY: 5 RTC]", "[BOTTUBE: 1 RTC]", "[ONBOARD: 3 RTC]".
const SPAM_TITLE_PREFIX_PATTERNS = [
  /^\s*\[\s*(bounty|bottube|onboard|reward|stake|earn|quest|airdrop|task|farm|engage|tweet|share|tg|telegram|discord)\s*[:\]\s]/i,
];

// Token-reward syntax in the title: numeric amount followed by a token
// ticker. RTC, USDC, USDT, SOL, MATIC are the common offenders. We avoid
// "ETH"/"BTC" without a numeric prefix because they show up in legit bug
// titles ("ETH parser regression").
const TOKEN_REWARD_PATTERN =
  /\b\d+\s*(?:rtc|usdc|usdt|sol|matic|busd|dai|bnb|trx|xrp|ada|doge|shib)\b/i;

// Engagement-only actions: the issue asks the contributor to do social
// activity (upvote, follow, retweet, "leave thoughtful comments") rather
// than write code.
const SPAM_ACTION_PATTERNS = [
  /\b(upvote|retweet|reshare)\b/i,
  /\bleave\s+(?:a\s+|thoughtful\s+|some\s+|nice\s+)?comments?\b/i,
  /\bstar\s+(?:our|the|this|us|\+\s+)/i,
  /\bfollow\s+(?:us\s+)?on\s+(?:twitter|x|telegram|discord|tiktok|youtube|instagram)\b/i,
  /\bjoin\s+(?:our\s+|the\s+)?(?:discord|telegram|twitter|tg)\b/i,
  /\bsubscribe\s+to\s+(?:our|the|us)\b/i,
];

function isBotEngagementIssue(issue: { repo: string; title: string }): boolean {
  const repoName = issue.repo.split("/")[1] ?? issue.repo;
  if (SPAM_REPO_PATTERNS.some((p) => p.test(repoName))) return true;
  const title = issue.title ?? "";
  if (SPAM_TITLE_PREFIX_PATTERNS.some((p) => p.test(title))) return true;
  if (TOKEN_REWARD_PATTERN.test(title)) return true;
  if (SPAM_ACTION_PATTERNS.some((p) => p.test(title))) return true;
  return false;
}
