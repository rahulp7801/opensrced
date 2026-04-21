"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { cn } from "@/lib/utils";

type QueryResult = {
  query: string;
  response: string;
  status: "loading" | "done" | "error";
  _id: number;
};

type BuildStatus = "idle" | "building" | "ready" | "error";

function parseRepo(
  url: string,
): { owner: string; name: string } | null {
  const m =
    /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
      url.trim().replace(/\.git$/i, ""),
    );
  const owner = m?.[1] ?? m?.[3];
  const name = m?.[2] ?? m?.[4];
  if (!owner || !name) return null;
  return { owner, name };
}

export default function GraphPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildMessages, setBuildMessages] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  // Persist repo URL to localStorage / read from ?repo= param
  useEffect(() => {
    const fromUrl = searchParams.get("repo");
    if (fromUrl) {
      setRepoUrl(fromUrl);
    } else {
      const saved = localStorage.getItem("opensrcer-graph-repo");
      if (saved) setRepoUrl(saved);
    }
  }, [searchParams]);

  useEffect(() => {
    if (repoUrl.trim())
      localStorage.setItem("opensrcer-graph-repo", repoUrl.trim());
  }, [repoUrl]);

  // Check if graph is already built when repo URL changes
  useEffect(() => {
    const m = parseRepo(repoUrl);
    if (!m) {
      setBuildStatus("idle");
      return;
    }
    setOwner(m.owner);
    setRepo(m.name);
    fetch(`/api/graph/${m.owner}/${m.name}/viz`, { method: "HEAD" })
      .then((r) => {
        if (r.ok) setBuildStatus("ready");
      })
      .catch(() => {});
  }, [repoUrl]);

  // Fetch connected org repos for autocomplete
  const suggestionsLoaded = useRef(false);
  function loadSuggestions() {
    if (suggestionsLoaded.current) return;
    suggestionsLoaded.current = true;
    const cached = sessionStorage.getItem("opensrcer-explore-repos");
    if (cached) {
      try {
        setSuggestions(JSON.parse(cached));
        return;
      } catch {
        /* ignore */
      }
    }
    fetch("/api/crucible/orgs")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: { orgs?: Array<{ github_org: string }> } | null,
        ) => {
          const orgs = data?.orgs ?? [];
          if (!orgs.length) return;
          Promise.all(
            orgs.map((o) =>
              fetch(`/api/crucible/orgs/${o.github_org}/repos`)
                .then((r) => (r.ok ? r.json() : { repos: [] }))
                .then(
                  (d: { repos?: Array<{ fullName: string }> }) =>
                    (d.repos ?? []).map((r) => r.fullName),
                )
                .catch(() => [] as string[]),
            ),
          ).then((lists) => {
            const all = lists.flat();
            setSuggestions(all);
            sessionStorage.setItem(
              "opensrcer-explore-repos",
              JSON.stringify(all),
            );
          });
        },
      )
      .catch(() => {});
  }

  // ── Build graph ─────────────────────────────────────────────────────

  async function handleBuild(force = false) {
    const m = parseRepo(repoUrl);
    if (!m) return;
    setOwner(m.owner);
    setRepo(m.name);
    setBuildStatus("building");
    setBuildMessages([]);
    setResults([]);

    try {
      const res = await fetch("/api/graph/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl.trim(), force }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as {
              status?: string;
              message?: string;
              error?: string;
            };
            if (payload.message) {
              setBuildMessages((prev) => [...prev, payload.message!]);
            }
            if (payload.status === "done") {
              setBuildStatus("ready");
            }
            if (payload.error) {
              setBuildMessages((prev) => [
                ...prev,
                `Error: ${payload.error}`,
              ]);
              setBuildStatus("error");
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch (err) {
      setBuildMessages((prev) => [
        ...prev,
        `Error: ${err instanceof Error ? err.message : "Network error"}`,
      ]);
      setBuildStatus("error");
    }
  }

  // ── Query graph ─────────────────────────────────────────────────────

  const submitQuery = useCallback(
    async (q: string) => {
      if (!q.trim() || !owner || !repo) return;

      const qid = Date.now();
      setResults((prev) => [
        ...prev,
        {
          query: q.trim(),
          response: "",
          status: "loading" as const,
          _id: qid,
        },
      ]);

      try {
        const res = await fetch("/api/graph/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner, repo, query: q.trim() }),
        });
        const data = (await res.json()) as {
          result?: string;
          error?: string;
        };
        setResults((prev) =>
          prev.map((r) =>
            r._id === qid
              ? {
                  ...r,
                  response:
                    data.result ?? data.error ?? "No response",
                  status: (data.error ? "error" : "done") as
                    | "error"
                    | "done",
                }
              : r,
          ),
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r) =>
            r._id === qid
              ? {
                  ...r,
                  response:
                    err instanceof Error
                      ? err.message
                      : "Network error",
                  status: "error" as const,
                }
              : r,
          ),
        );
      }
    },
    [owner, repo],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const q = query;
    setQuery("");
    submitQuery(q);
  }

  function quickQuery(q: string) {
    submitQuery(q);
  }

  // Scroll to bottom on new results
  useEffect(() => {
    if (resultRef.current)
      resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [results]);

  const isQuerying = results.some((r) => r.status === "loading");

  return (
    <div
      className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 py-6 flex flex-col"
      style={{ height: "calc(100vh - 56px)" }}
    >
      <PageHeading
        title={<>Graph</>}
        description="Visualize and query any codebase as an interactive knowledge graph. Powered by AST analysis — zero LLM cost."
      />

      {/* Repo input + build */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px] max-w-xl relative">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              setShowSuggestions(true);
              setBuildStatus("idle");
            }}
            onFocus={() => {
              setShowSuggestions(true);
              loadSuggestions();
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="github.com/owner/repo or owner/repo"
            className="w-full bg-surface border border-border px-3 py-2 text-[13px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 top-full left-0 right-0 mt-1 border border-border bg-ink max-h-48 overflow-y-auto">
              {suggestions
                .filter(
                  (s) =>
                    !repoUrl ||
                    s.toLowerCase().includes(repoUrl.toLowerCase()),
                )
                .slice(0, 8)
                .map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setRepoUrl(s);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[12px] text-paper-dim hover:bg-surface-2/60 hover:text-paper"
                    >
                      {s}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => handleBuild(buildStatus === "ready")}
          disabled={!parseRepo(repoUrl) || buildStatus === "building"}
          className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {buildStatus === "building"
            ? "building..."
            : buildStatus === "ready"
              ? "rebuild"
              : "build graph"}
        </button>
        {buildStatus === "ready" && (
          <span className="text-[10px] text-ok uppercase tracking-[0.1em] flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
            ready
          </span>
        )}
      </div>

      {/* Build progress */}
      {buildStatus === "building" && buildMessages.length > 0 && (
        <div className="mt-3 border border-border bg-surface/40 px-4 py-3 max-h-36 overflow-y-auto">
          {buildMessages.map((msg, i) => (
            <div key={i} className="text-[11px] text-paper-dim font-mono">
              <span className="text-paper-faint select-none">
                [{String(i + 1).padStart(2, "0")}]{" "}
              </span>
              {msg}
            </div>
          ))}
          <div className="text-[11px] text-signal animate-pulse-signal mt-1 font-mono">
            analyzing codebase...
          </div>
        </div>
      )}

      {/* Main content — split view when graph is ready */}
      {buildStatus === "ready" ? (
        <div className="mt-4 flex-1 min-h-0 flex flex-col xl:flex-row gap-4">
          {/* Left: Graph visualization */}
          <div className="xl:w-[55%] min-h-[300px] xl:min-h-0 border border-border bg-ink/30 relative flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-soft bg-ink/50">
              <span className="text-[10px] text-paper-faint uppercase tracking-[0.15em]">
                interactive graph — {owner}/{repo}
              </span>
              <a
                href={`/api/graph/${owner}/${repo}/viz`}
                target="_blank"
                rel="noopener"
                className="text-[10px] text-paper-muted hover:text-signal transition-colors"
              >
                open fullscreen
              </a>
            </div>
            <iframe
              src={`/api/graph/${owner}/${repo}/viz`}
              className="w-full flex-1 border-0"
              title="Codebase Knowledge Graph"
            />
          </div>

          {/* Right: Chat interface */}
          <div className="xl:w-[45%] flex flex-col min-h-[300px] xl:min-h-0">
            {/* Quick actions */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em] self-center mr-1">
                quick:
              </span>
              {[
                "stats",
                "god nodes",
                "explain src",
                "explain lib",
                "explain test",
              ].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => quickQuery(cmd)}
                  disabled={isQuerying}
                  className="text-[10px] text-paper-dim border border-border-soft hover:border-signal/40 hover:text-signal px-2 py-1 transition disabled:opacity-50"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {/* Results */}
            <div
              ref={resultRef}
              className="flex-1 overflow-y-auto min-h-0 space-y-3"
            >
              {results.length === 0 && (
                <div className="border border-border bg-surface/40 p-6 text-center">
                  <div className="serif text-[18px] text-paper">
                    Query the knowledge graph
                  </div>
                  <p className="mt-2 text-[11px] text-paper-muted max-w-md mx-auto">
                    Try: &quot;trace handlePayment&quot; or
                    &quot;impact UserService&quot; or &quot;explain
                    src/api&quot; or &quot;path auth to billing&quot;
                  </p>
                  <p className="mt-1 text-[10px] text-ok">
                    Every query is free — pure graph traversal, zero
                    LLM cost
                  </p>
                </div>
              )}

              {results.map((r, i) => (
                <div key={i} className="border border-border bg-surface/40">
                  <div className="px-3 py-2 border-b border-border-soft flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-signal">
                      Q
                    </span>
                    <span className="text-[12px] text-paper">
                      {r.query}
                    </span>
                    {r.status === "loading" && (
                      <span className="ml-auto text-[10px] text-signal animate-pulse-signal">
                        querying...
                      </span>
                    )}
                    {r.status === "done" && (
                      <span className="ml-auto text-[10px] text-ok tabular-nums">
                        $0.00
                      </span>
                    )}
                  </div>
                  <div className="px-3 py-3">
                    {r.status === "error" ? (
                      <pre className="text-[11px] text-alert whitespace-pre-wrap font-mono">
                        {r.response}
                      </pre>
                    ) : r.response ? (
                      <GraphResponse text={r.response} />
                    ) : (
                      <div className="text-[11px] text-paper-muted italic">
                        Traversing graph...
                      </div>
                    )}
                  </div>
                  {/* Follow-up suggestions */}
                  {r.status === "done" && !isQuerying && (
                    <div className="px-3 py-2 border-t border-border-soft flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">
                        follow up:
                      </span>
                      {generateFollowUps(r.query).map((q, qi) => (
                        <button
                          key={qi}
                          onClick={() => quickQuery(q)}
                          className="text-[10px] text-paper-dim border border-border-soft hover:border-signal/40 hover:text-signal px-2 py-1 transition"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Query input */}
            <form onSubmit={handleSubmit} className="mt-3 shrink-0">
              <div className="flex gap-2">
                <input
                  ref={queryInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="trace, impact, explain, path, stats, or any symbol name..."
                  disabled={isQuerying}
                  className="flex-1 bg-surface border border-border px-3 py-2.5 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isQuerying}
                  className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2.5 text-[12px] uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {isQuerying ? "..." : "query"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        buildStatus !== "building" && (
          /* Empty state */
          <div className="mt-8 flex-1 flex items-start justify-center">
            <div className="border border-border bg-surface/40 p-8 text-center max-w-lg">
              <div className="serif text-[22px] text-paper">
                Build a codebase knowledge graph
              </div>
              <p className="mt-3 text-[12px] text-paper-muted">
                Enter a GitHub repo above and click Build Graph.
                opensrcer will analyze the codebase with tree-sitter
                AST parsing across 25 languages and produce an
                interactive, queryable knowledge graph.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-paper-faint max-w-sm mx-auto">
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-paper-dim text-[11px]">
                    trace
                  </div>
                  <div>execution flows</div>
                </div>
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-paper-dim text-[11px]">
                    impact
                  </div>
                  <div>blast radius</div>
                </div>
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-paper-dim text-[11px]">
                    explain
                  </div>
                  <div>module overview</div>
                </div>
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-paper-dim text-[11px]">
                    path
                  </div>
                  <div>A connects to B</div>
                </div>
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-paper-dim text-[11px]">
                    god nodes
                  </div>
                  <div>key components</div>
                </div>
                <div className="border border-border-soft px-2 py-2 text-center">
                  <div className="text-ok text-[11px]">$0.00</div>
                  <div>per query</div>
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Graph response renderer ───────────────────────────────────────────
// Renders the structured plain-text output from graph queries with
// visual formatting (section headers, indentation, highlights).

function GraphResponse({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="text-[11.5px] leading-relaxed font-mono space-y-0">
      {lines.map((line, i) => {
        // Section headers (lines of ─)
        if (/^─+$/.test(line))
          return (
            <div
              key={i}
              className="border-b border-border-soft mb-1"
            />
          );

        // Title lines (all-caps like "GRAPH STATISTICS", "IMPACT ANALYSIS: ...")
        if (/^[A-Z][A-Z\s:]+/.test(line) && !line.startsWith("  "))
          return (
            <div
              key={i}
              className="text-paper font-medium text-[12px] mt-1"
            >
              {highlightLine(line)}
            </div>
          );

        // Indented items with arrows
        if (line.includes("->") || line.includes("<-"))
          return (
            <div key={i} className="text-paper-dim">
              {highlightLine(line)}
            </div>
          );

        // Lines with [relation] markers
        if (/\[.+\]/.test(line))
          return (
            <div key={i} className="text-paper-dim">
              {highlightBrackets(line)}
            </div>
          );

        // Risk indicators
        if (line.includes("RISK: HIGH"))
          return (
            <div key={i} className="text-alert font-medium">
              {line}
            </div>
          );
        if (line.includes("RISK: MEDIUM"))
          return (
            <div key={i} className="text-signal font-medium">
              {line}
            </div>
          );
        if (line.includes("RISK: LOW"))
          return (
            <div key={i} className="text-ok font-medium">
              {line}
            </div>
          );

        // Stats numbers
        if (/^\s*(Nodes|Edges|Communities|Hyperedges):/.test(line))
          return (
            <div key={i} className="text-paper-dim">
              {highlightNumbers(line)}
            </div>
          );

        // Percentage lines
        if (line.includes("%"))
          return (
            <div key={i} className="text-paper-dim">
              {highlightNumbers(line)}
            </div>
          );

        // Empty
        if (!line.trim()) return <div key={i} className="h-1" />;

        // Default
        return (
          <div key={i} className="text-paper-dim whitespace-pre">
            {line}
          </div>
        );
      })}
    </div>
  );
}

function highlightLine(line: string): React.ReactNode {
  // Highlight file paths (things with / or .ext)
  const parts: React.ReactNode[] = [];
  const regex =
    /(\([^)]+\.\w{1,5}(?::[^\s)]+)?\)|\b\w+\/[\w/.-]+\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(
      <span key={ki++} className="text-info">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <>{parts}</>;
}

function highlightBrackets(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(
      <span key={ki++} className="text-signal">
        [{m[1]}]
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <>{parts}</>;
}

function highlightNumbers(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\d+(?:\.\d+)?%?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(
      <span key={ki++} className="text-paper tabular-nums">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <>{parts}</>;
}

function generateFollowUps(query: string): string[] {
  const q = query.toLowerCase();
  if (q === "stats" || q === "statistics" || q === "overview")
    return ["god nodes", "explain src", "explain lib"];
  if (q.startsWith("god"))
    return ["stats", "explain src"];
  if (q.startsWith("trace"))
    return [
      `impact ${query.slice(6).trim()}`,
      "god nodes",
    ];
  if (q.startsWith("impact"))
    return [
      `trace ${query.slice(7).trim()}`,
      "stats",
    ];
  if (q.startsWith("explain"))
    return ["god nodes", "stats"];
  if (q.startsWith("path"))
    return ["god nodes", "stats"];
  return ["stats", "god nodes", "explain src"];
}
