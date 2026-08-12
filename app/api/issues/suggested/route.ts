// GET /api/issues/suggested?languages=python,typescript&limit=20&tags=strict|broad
// Fetches good-first-issues from popular repos matching the user's preferred languages.
// Uses GitHub search API via gh CLI — no API key cost.
// tags=strict (default) → only "good first issue" label
// tags=broad → also matches "beginner", "starter", "first-timers-only", "easy"

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";
import { ghEnv } from "@/lib/child-env";

const execFileAsync = promisify(execFile);

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
  const env = ghEnv(token);

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

    for (const q of plan) {
      try {
        const args = [
          "search",
          "issues",
          "--label",
          q.label,
          "--state",
          "open",
          "--sort",
          "updated",
          "--limit",
          String(perCall),
          "--json",
          "repository,title,number,url,labels,createdAt,updatedAt,commentsCount",
        ];
        if (q.language) {
          args.push("--language", q.language);
        }
        const { stdout } = await execFileAsync(
          "gh",
          args,
          { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15000 },
        );

        const raw = JSON.parse(stdout) as Array<{
          repository: { nameWithOwner: string; stargazerCount?: number; primaryLanguage?: { name: string } };
          title: string;
          number: number;
          url: string;
          labels: Array<{ name: string }>;
          createdAt: string;
          updatedAt: string;
          commentsCount: number;
        }>;

        for (const issue of raw) {
          allIssues.push({
            repo: issue.repository.nameWithOwner,
            title: issue.title,
            number: issue.number,
            url: issue.url,
            labels: issue.labels.map((l) => l.name),
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            comments: issue.commentsCount,
            language: issue.repository.primaryLanguage?.name ?? "",
            stars: issue.repository.stargazerCount ?? 0,
          });
        }
      } catch {
        // Individual language query failed — continue with others
      }
    }

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
