// GET /api/issues/suggested?languages=python,typescript&limit=20
// Fetches good-first-issues from popular repos matching the user's preferred languages.
// Uses GitHub search API via gh CLI — no API key cost.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawLanguages = req.nextUrl.searchParams.get("languages")?.split(",").filter(Boolean) ?? [];
  // Sanitize language names — only allow alphanumeric, hyphens, plus signs (e.g. "c++", "c#")
  const languages = rawLanguages
    .map((l) => l.replace(/[^a-zA-Z0-9+#-]/g, "").slice(0, 30))
    .filter((l) => l.length > 0)
    .slice(0, 10); // max 10 languages
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "20") || 20, 1), 50);

  const token = await resolveGitHubToken();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) env.GH_TOKEN = token;

  try {
    // Build search queries — one per language for better results
    const queries = languages.length > 0
      ? languages.map((lang) => `label:"good first issue" state:open language:${lang} sort:updated`)
      : [`label:"good first issue" state:open sort:updated`];

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

    const perLang = Math.ceil(limit / Math.max(queries.length, 1));

    for (const q of queries) {
      try {
        const { stdout } = await execFileAsync(
          "gh",
          [
            "search",
            "issues",
            q,
            "--limit",
            String(perLang),
            "--json",
            "repository,title,number,url,labels,createdAt,updatedAt,commentsCount",
          ],
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

    // Sort: recently updated first, then by stars
    deduped.sort((a, b) => {
      const da = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (da !== 0) return da;
      return b.stars - a.stars;
    });

    return Response.json({ issues: deduped.slice(0, limit) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
