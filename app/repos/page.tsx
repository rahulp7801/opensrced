import { PageHeading } from "@/components/page-heading";
import { Panel } from "@/components/panel";
import { BarStrip } from "@/components/sparkline";
import { StatusDot } from "@/components/status-dot";
import { loadRepos, loadAllPRs } from "@/lib/data";
import { formatNumber, pad } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LANG_COLORS: Record<string, string> = {
  rust: "#dea584",
  python: "#3572a5",
  typescript: "#3178c6",
  javascript: "#f1e05a",
  go: "#00add8",
  "c++": "#f34b7d",
  java: "#b07219",
};

export default async function ReposPage() {
  const [repos, allPRs] = await Promise.all([loadRepos(20), loadAllPRs()]);

  // compute per-repo sparkline (last 14 days)
  function seriesFor(repo: string) {
    const buckets = new Array(14).fill(0);
    const now = Date.now();
    for (const pr of allPRs.filter((p) => p.repo === repo)) {
      const d = Math.floor((now - new Date(pr.created_at).getTime()) / 86_400_000);
      if (d >= 0 && d < 14) buckets[13 - d] += 1;
    }
    return buckets;
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow={`${repos.length} repositories`}
        title={<>Repositories</>}
        description="Every repo the agent has touched, ranked by PR count. Each row shows activity over the last 14 days and its merge rate."
      />

      <div className="mt-6 animate-fade-rise">
        <Panel code="R-01" label="repositories · sorted by PR count" dense>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y divide-border-soft md:divide-y-0 md:divide-x">
            <div>
              {repos.slice(0, 10).map((r, i) => (
                <RepoRow
                  key={r.repo}
                  rank={i + 1}
                  repo={r}
                  series={seriesFor(r.repo)}
                />
              ))}
            </div>
            <div>
              {repos.slice(10, 20).map((r, i) => (
                <RepoRow
                  key={r.repo}
                  rank={i + 11}
                  repo={r}
                  series={seriesFor(r.repo)}
                />
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function RepoRow({
  rank,
  repo,
  series,
}: {
  rank: number;
  repo: Awaited<ReturnType<typeof loadRepos>>[number];
  series: number[];
}) {
  const lang = LANG_COLORS[repo.language] ?? "var(--color-paper-muted)";
  const mergedPct = repo.merge_rate * 100;
  const tone = mergedPct >= 50 ? "ok" : mergedPct >= 25 ? "signal" : "muted";
  return (
    <div className="group flex items-center gap-4 px-4 py-4 border-b border-border-soft last:border-0 transition-colors hover:bg-surface-2/60">
      <span className="serif text-[32px] leading-none text-paper-muted w-10 text-right shrink-0 num-tabular">
        {pad(rank, 2)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: lang }}
          />
          <a
            href={`https://github.com/${repo.repo}`}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[14px] text-paper hover:text-signal"
          >
            {repo.repo}
          </a>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-paper-muted">
          <span>{repo.language}</span>
          <span className="text-paper-faint">·</span>
          <span>★ {formatNumber(repo.stars)}</span>
          <span className="text-paper-faint">·</span>
          <span className="flex items-center gap-1">
            <StatusDot tone={tone} /> {mergedPct.toFixed(0)}% merged
          </span>
        </div>
      </div>

      <div className="shrink-0 hidden sm:block">
        <BarStrip values={series} width={120} height={32} />
      </div>

      <div className="shrink-0 text-right tabular-nums">
        <div className="serif text-[24px] text-paper leading-none">{repo.pr_count}</div>
        <div className="mono-label text-paper-muted">prs</div>
      </div>
    </div>
  );
}
