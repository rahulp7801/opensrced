// Stats aggregator — derives fun totals from the real artifacts we already
// write: .dispatches/*.log for dispatches + PRs, and a small counter file
// for things we don't otherwise log (scans).
//
// Nothing lives in a database. Restart-safe (logs persist), HMR-safe.
//
// Counters maintained here:
//   scans         — /api/issues/scan + /api/discover each bump this
//   discoverRuns  — /api/discover increments both scans and discoverRuns
// Derived at read time from the filesystem:
//   dispatches    — count of .dispatches/*.log
//   prs           — logs containing a PR URL (agentic marker or upstream "Created PR")
//   bugsSquashed  — same as prs, tracked separately because in future we might
//                    count *merged* PRs via gh once we wire that poll
// Biggest contributions:
//   pick repos whose opened PRs live under org/name where stargazerCount >= 1000.
//   Stars are fetched via `gh api repos/:owner/:name` on first sight and
//   cached in .dispatches/repo-stars.json with a 7-day TTL.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DISPATCH_DIR = join(process.cwd(), ".dispatches");
const STATS_FILE = join(DISPATCH_DIR, "stats.json");
const STARS_FILE = join(DISPATCH_DIR, "repo-stars.json");
const STARS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StatsFile = {
  scans: number;
  discoverRuns: number;
  scanHistory: Array<{ ts: string; repo?: string; kind: "scan" | "discover" }>;
};

type StarsFile = Record<string, { stars: number; checkedAt: number }>;

function ghBin(): string {
  if (process.env.GH_CLI && existsSync(process.env.GH_CLI)) return process.env.GH_CLI;
  return "gh";
}

async function ensureDir() {
  if (!existsSync(DISPATCH_DIR)) await mkdir(DISPATCH_DIR, { recursive: true });
}

async function loadStatsFile(): Promise<StatsFile> {
  try {
    const raw = await readFile(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StatsFile>;
    return {
      scans: parsed.scans ?? 0,
      discoverRuns: parsed.discoverRuns ?? 0,
      scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : [],
    };
  } catch {
    return { scans: 0, discoverRuns: 0, scanHistory: [] };
  }
}

async function saveStatsFile(s: StatsFile) {
  await ensureDir();
  // Cap history to 200 entries — plenty for a "recent" feed, bounded size.
  if (s.scanHistory.length > 200) {
    s.scanHistory = s.scanHistory.slice(-200);
  }
  await writeFile(STATS_FILE, JSON.stringify(s));
}

/** Called from /api/issues/scan. */
export async function recordScan(repo: string | null): Promise<void> {
  const s = await loadStatsFile();
  s.scans += 1;
  s.scanHistory.push({ ts: new Date().toISOString(), repo: repo ?? undefined, kind: "scan" });
  await saveStatsFile(s);
}

/** Called from /api/discover. */
export async function recordDiscoverRun(): Promise<void> {
  const s = await loadStatsFile();
  s.scans += 1;
  s.discoverRuns += 1;
  s.scanHistory.push({ ts: new Date().toISOString(), kind: "discover" });
  await saveStatsFile(s);
}

// ── Log scrape ───────────────────────────────────────────────────────────

type LogRecord = {
  id: string;           // dispatch id (filename w/o .log)
  repoFull: string | null;
  issueNumber: number | null;
  prUrl: string | null;
  status: "running" | "succeeded" | "failed" | "killed" | "unknown";
  startedAt: string | null;
  costUsd: number | null;
  hasDiff: boolean;
};

// Regexes for the markers we drop into the log.
// Pick up *any* GitHub PR URL as a fallback for the deterministic (contribai)
// path, which prints them with varied wording.
const PR_URL_RE = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const REPO_RE = /repo:\s*(\S+)\s/;
const ISSUE_RE = /issue:\s*#?(\d+)/;
const EXIT_RE = /exited at\s+(\S+)\s+·\s+status=(\w+)/;
const STARTED_RE = /^\[(?:agentic-)?dispatcher\]\s+(\d{4}-\d{2}-\d{2}T[^\s]+)/;
const COST_RE = /total_cost_usd=([\d.]+)/;

async function scanLogs(): Promise<LogRecord[]> {
  if (!existsSync(DISPATCH_DIR)) return [];
  const files = readdirSync(DISPATCH_DIR).filter((f) => f.endsWith(".log"));
  const records = await Promise.all(
    files.map(async (f): Promise<LogRecord> => {
      const id = f.replace(/\.log$/, "");
      let text = "";
      try {
        text = await readFile(join(DISPATCH_DIR, f), "utf8");
      } catch {
        // Unreadable log — skip.
      }
      const repoM = REPO_RE.exec(text);
      const issueM = ISSUE_RE.exec(text);
      const prM = PR_URL_RE.exec(text);
      const exitM = EXIT_RE.exec(text);
      const startM = STARTED_RE.exec(text);
      let status: LogRecord["status"] = "running";
      if (exitM) {
        const s = exitM[2];
        if (s === "succeeded" || s === "failed" || s === "killed") status = s;
      }
      if (!exitM) status = "running";
      const costM = COST_RE.exec(text);
      return {
        id,
        repoFull: repoM ? repoM[1].replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "") : null,
        issueNumber: issueM ? Number(issueM[1]) : null,
        prUrl: prM ? `https://github.com/${prM[1]}/pull/${prM[2]}` : null,
        status,
        startedAt: startM ? startM[1] : null,
        costUsd: costM ? parseFloat(costM[1]) : null,
        hasDiff: /```(?:diff|patch)/.test(text),
      };
    }),
  );
  return records;
}

// ── Star fetcher (cached) ───────────────────────────────────────────────

async function loadStars(): Promise<StarsFile> {
  try {
    return JSON.parse(await readFile(STARS_FILE, "utf8")) as StarsFile;
  } catch {
    return {};
  }
}

async function saveStars(s: StarsFile) {
  await ensureDir();
  await writeFile(STARS_FILE, JSON.stringify(s));
}

async function starsForRepos(
  repos: string[],
): Promise<Record<string, number>> {
  const cache = await loadStars();
  const now = Date.now();
  const out: Record<string, number> = {};
  const toFetch: string[] = [];
  for (const r of repos) {
    const hit = cache[r];
    if (hit && now - hit.checkedAt < STARS_TTL_MS) {
      out[r] = hit.stars;
    } else {
      toFetch.push(r);
    }
  }
  // Fetch missing/stale, capped at 3-way concurrency; each call is fast but
  // rate limits are polite to respect.
  const MAX_PARALLEL = 3;
  const queue = [...toFetch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      if (!r) break;
      try {
        const { stdout } = await execFileAsync(
          ghBin(),
          ["api", `repos/${r}`, "--jq", ".stargazers_count"],
          { maxBuffer: 1 * 1024 * 1024, timeout: 15_000 },
        );
        const n = Number(stdout.trim());
        if (Number.isFinite(n)) {
          out[r] = n;
          cache[r] = { stars: n, checkedAt: now };
        }
      } catch {
        // Repo gone / private / rate-limited: just omit.
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  if (toFetch.length > 0) await saveStars(cache);
  return out;
}

// Non-blocking star lookup — returns cached data immediately, triggers
// background fetch for stale/missing repos. Never blocks the response.
async function starsForReposCached(
  repos: string[],
): Promise<Record<string, number>> {
  const cache = await loadStars();
  const now = Date.now();
  const out: Record<string, number> = {};
  const stale: string[] = [];
  for (const r of repos) {
    const hit = cache[r];
    if (hit) {
      out[r] = hit.stars;
      if (now - hit.checkedAt >= STARS_TTL_MS) stale.push(r);
    } else {
      stale.push(r);
    }
  }
  // Fire-and-forget background fetch for stale/missing repos
  if (stale.length > 0) {
    starsForRepos(stale).catch(() => {});
  }
  return out;
}

// ── Public aggregator ───────────────────────────────────────────────────

export type StatsSummary = {
  scans: number;
  discoverRuns: number;
  dispatches: number;
  prsCreated: number;
  bugsSquashed: number;
  totalCostUsd: number;
  patchesGenerated: number;
  successRate: number;
  prRate: number;
  biggestContributions: Array<{
    prUrl: string;
    repoFull: string;
    stars: number;
    issueNumber: number | null;
    dispatchId: string;
    startedAt: string | null;
  }>;
  recentActivity: Array<{
    kind: "scan" | "discover" | "dispatch";
    ts: string;
    repo?: string;
    issueNumber?: number;
    prUrl?: string;
  }>;
};

/** One-stop aggregate for /api/stats. */
export async function getStatsSummary(): Promise<StatsSummary> {
  const [file, logs] = await Promise.all([loadStatsFile(), scanLogs()]);

  const dispatches = logs.length;
  const prLogs = logs.filter((l) => l.prUrl);
  const prsCreated = prLogs.length;
  const bugsSquashed = prsCreated;
  const totalCostUsd = logs.reduce((sum, l) => sum + (l.costUsd ?? 0), 0);
  const patchesGenerated = logs.filter((l) => l.hasDiff).length;
  const completed = logs.filter((l) => l.status === "succeeded" || l.status === "failed").length;
  const successRate = completed > 0 ? patchesGenerated / completed : 0;
  const prRate = completed > 0 ? prsCreated / completed : 0;

  // Gather unique repos that produced a PR. Use cached stars only —
  // never block the stats page on GitHub API calls. Stale/missing stars
  // are fetched in the background for the next request.
  const prRepos = Array.from(new Set(prLogs.map((l) => l.repoFull).filter((r): r is string => !!r)));
  const stars = prRepos.length > 0 ? await starsForReposCached(prRepos) : {};
  const biggestContributions = prLogs
    .map((l) => ({
      prUrl: l.prUrl!,
      repoFull: l.repoFull!,
      stars: stars[l.repoFull!] ?? 0,
      issueNumber: l.issueNumber,
      dispatchId: l.id,
      startedAt: l.startedAt,
    }))
    .filter((c) => c.stars >= 1000)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 10);

  // Recent activity: merge scan history + dispatch starts, newest-first.
  const hist = file.scanHistory.map((h) => ({
    kind: h.kind as "scan" | "discover",
    ts: h.ts,
    repo: h.repo,
  }));
  const dispActivity = logs
    .filter((l) => l.startedAt)
    .map((l) => ({
      kind: "dispatch" as const,
      ts: l.startedAt!,
      repo: l.repoFull ?? undefined,
      issueNumber: l.issueNumber ?? undefined,
      prUrl: l.prUrl ?? undefined,
    }));
  const recentActivity = [...hist, ...dispActivity]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 20);

  return {
    scans: file.scans,
    discoverRuns: file.discoverRuns,
    dispatches,
    prsCreated,
    bugsSquashed,
    totalCostUsd,
    patchesGenerated,
    successRate,
    prRate,
    biggestContributions,
    recentActivity,
  };
}
