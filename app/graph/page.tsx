"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { generateFollowUps, parseMarkdownBlocks } from "@/lib/graph-view";
import { cn } from "@/lib/utils";
import { sseEvents } from "@/lib/sse";
import { parseRunTarget } from "@/lib/run-target";

type QueryResult = {
  query: string;
  response: string;
  status: "loading" | "streaming" | "done" | "error";
  cost: number | null;
  mode: "graph" | "llm" | null;
  compression: string | null;
  _id: number;
};

type BuildStatus = "idle" | "building" | "ready" | "error";
type GraphEngine = "graphify" | "crg" | null;

type BuildMessage = {
  text: string;
  percent?: number;
  phase?: string;
};

function parseRepo(
  url: string,
): { owner: string; name: string } | null {
  try {
    const normalized = url.trim().replace(/^github\.com\//i, "https://github.com/").replace(/\.git$/i, "");
    const target = parseRunTarget(normalized);
    if (target.issue) return null;
    const [owner, name] = target.repo.split("/");
    return { owner, name };
  } catch { return null; }
}

export default function GraphPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildMessages, setBuildMessages] = useState<BuildMessage[]>([]);
  const [engine, setEngine] = useState<GraphEngine>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const queryIdRef = useRef(0);
  const buildSequence = useRef(0);
  const buildRequest = useRef<AbortController | null>(null);
  const queryRequest = useRef<AbortController | null>(null);
  // Auto-scroll follows the stream only while the reader is already at the
  // bottom; scrolling up to re-read an earlier answer used to be undone by the
  // next token.
  const atBottomRef = useRef(true);
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

  // Check whether a graph already exists whenever the repo changes.
  //
  // This owns buildStatus for repo changes, rather than the input's onChange:
  // the URL can also change from ?repo=, from localStorage, and from clicking
  // a suggestion, and only one of those four paths went through onChange. The
  // other three left the previous repo's "ready" standing while owner/repo
  // moved on — pointing the iframe at a graph that was never built and letting
  // queries run against it.
  useEffect(() => {
    const m = parseRepo(repoUrl);
    setResults([]);
    setBuildMessages([]);
    setOwner(m?.owner ?? "");
    setRepo(m?.name ?? "");
    setBuildStatus("idle");
    setEngine(null);
    if (!m) return;
    setOwner(m.owner);
    setRepo(m.name);

    // Two repos typed in quick succession leave two HEADs in flight; without
    // this the slower one wins and marks the wrong repo ready.
    let live = true;
    const probe = new AbortController();
    const sequence = buildSequence.current;
    fetch(`/api/graph/${m.owner}/${m.name}/viz`, { method: "HEAD", signal: AbortSignal.any([probe.signal, AbortSignal.timeout(30_000)]) })
      .then((r) => {
        if (!live || !r.ok || sequence !== buildSequence.current || buildRequest.current) return;
        setBuildStatus("ready");
        setEngine((r.headers.get("X-Graph-Engine") as GraphEngine) ?? "graphify");
      })
      .catch(() => {});
    return () => {
      live = false;
      probe.abort();
      buildRequest.current?.abort();
      queryRequest.current?.abort();
      buildRequest.current = null;
      queryRequest.current = null;
    };
  }, [repoUrl]);

  // This page is a fixed-height app view — the iframe and the answer list
  // scroll inside it, the window does not — so it needs to know how tall the
  // chrome above it is. That was hardcoded to the header's 56px, but the
  // API-key banner and the section tabs both sit above this too and both come
  // and go at runtime, so any constant is wrong some of the time: it was
  // pushing the query input off the bottom of the screen. Measure instead.
  const [shellHeight, setShellHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      // Document-relative, so a scrolled window still measures the chrome
      // rather than how far down the page we happen to be.
      const top = el.getBoundingClientRect().top + window.scrollY;
      setShellHeight(Math.max(360, window.innerHeight - top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

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
    if (!m || buildRequest.current) return;
    const controller = new AbortController();
    buildRequest.current = controller;
    buildSequence.current++;
    queryRequest.current?.abort();
    queryRequest.current = null;
    setOwner(m.owner);
    setRepo(m.name);
    setBuildStatus("building");
    setBuildMessages([]);
    setResults([]);

    try {
      const res = await fetch("/api/graph/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_url: `${m.owner}/${m.name}`, force }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(280_000)]),
      });

      for await (const payload of sseEvents<{
        status?: string;
        message?: string;
        error?: string;
        percent?: number;
        phase?: string;
        engine?: string;
      }>(res)) {
        if (buildRequest.current !== controller) return;
        if (payload.error) throw new Error(payload.error);
        if (payload.message) {
          setBuildMessages((prev) => [
            ...prev,
            {
              text: payload.message!,
              percent: payload.percent,
              phase: payload.phase,
            },
          ]);
        }
        if (payload.status === "done") {
          setBuildStatus("ready");
          setEngine((payload.engine as GraphEngine) ?? "graphify");
          return;
        }
      }
      throw new Error("The build stopped without finishing. Please retry.");
    } catch (err) {
      if (buildRequest.current !== controller) return;
      setBuildMessages((prev) => [
        ...prev,
        { text: `Error: ${err instanceof Error ? err.message : "Network error"}` },
      ]);
      setBuildStatus("error");
    } finally {
      if (buildRequest.current === controller) buildRequest.current = null;
    }
  }

  // ── Query graph ─────────────────────────────────────────────────────

  const submitQuery = useCallback(
    async (q: string) => {
      if (!q.trim() || !owner || !repo || queryRequest.current || buildRequest.current) return;
      const controller = new AbortController();
      queryRequest.current = controller;

      // A counter, not Date.now(): two quick-action chips clicked in the same
      // millisecond produced the same id, and every setResults update matched
      // both rows.
      const qid = ++queryIdRef.current;
      setResults((prev) => [
        ...prev,
        {
          query: q.trim(),
          response: "",
          status: "loading" as const,
          cost: null,
          mode: null,
          compression: null,
          _id: qid,
        },
      ]);

      try {
        const res = await fetch("/api/graph/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner, repo, query: q.trim() }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(130_000)]),
        });

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          // Instant graph response
          const data = (await res.json()) as {
            result?: string;
            error?: string;
            cost?: number;
          };
          if (queryRequest.current !== controller) return;
          if (!res.ok || data.error || !data.result?.trim()) throw new Error(data.error || "No response from the graph service");
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
                    cost: data.cost ?? 0,
                    mode: "graph" as const,
                  }
                : r,
            ),
          );
        } else {
          // SSE stream from LLM fallback
          setResults((prev) =>
            prev.map((r) =>
              r._id === qid
                ? { ...r, status: "streaming" as const, mode: "llm" as const }
                : r,
            ),
          );

          // One state update per event rather than one per field: a token, its
          // cost and the done flag often arrive in the same event, and that
          // used to map the whole result list three times over.
          let answer = "";
          for await (const payload of sseEvents<{
            text?: string;
            cost?: number;
            done?: boolean;
            error?: string;
            compression?: string;
          }>(res)) {
            if (queryRequest.current !== controller) return;
            if (payload.error) throw new Error(payload.error);
            answer += payload.text ?? "";
            if (payload.done && !answer.trim()) throw new Error("Empty response from the graph service");
            setResults((prev) =>
              prev.map((r) => {
                if (r._id !== qid) return r;
                return {
                  ...r,
                  response: payload.text ? r.response + payload.text : r.response,
                  cost: payload.cost ?? r.cost,
                  compression: payload.compression ?? r.compression,
                  status: payload.done ? "done" : r.status,
                };
              }),
            );
            if (payload.done) return;
          }
          throw new Error("The answer stream ended before completion. Please retry.");
        }
      } catch (err) {
        if (queryRequest.current !== controller) return;
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
      } finally {
        if (queryRequest.current === controller) queryRequest.current = null;
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

  // Follow the tail of a streaming answer, but only for a reader who is
  // already there.
  useEffect(() => {
    const el = resultRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [results]);

  function onResultsScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const isQuerying = results.some((r) => r.status === "loading" || r.status === "streaming");

  return (
    <div
      ref={shellRef}
      className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 py-6 flex flex-col"
      style={{ height: shellHeight ? `${shellHeight}px` : "calc(100dvh - 56px)" }}
    >
      <PageHeading
        title={<>Codebase map</>}
        description="Visualize and query any codebase as an interactive knowledge graph. Commands are free (AST-powered). Plain English questions use AI."
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
        {(buildStatus === "building" || isQuerying) && (
          <button type="button" onClick={() => {
            buildRequest.current?.abort(new Error("Build cancelled."));
            queryRequest.current?.abort(new Error("Query cancelled."));
          }} className="border border-border px-4 py-2 text-[12px]">Cancel</button>
        )}
        {buildStatus === "ready" && (
          <span className="text-[10px] text-ok uppercase tracking-[0.1em] flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
            ready
          </span>
        )}
      </div>

      {/* Build progress — kept on screen for a failed build too. Hiding it on
          error meant the log flashed past and the page fell back to the empty
          state, so a failure was indistinguishable from never having clicked. */}
      {(buildStatus === "building" || buildStatus === "error") &&
        buildMessages.length > 0 && (
        <div
          className={cn(
            "mt-3 border bg-surface/40 px-4 py-3",
            buildStatus === "error" ? "border-alert/40" : "border-border",
          )}
        >
          {/* Progress bar */}
          {buildStatus === "building" && (() => {
            const last = buildMessages[buildMessages.length - 1];
            const pct = last?.percent ?? null;
            const phase = last?.phase === "ast" ? "Parsing source files (tree-sitter AST)"
              : last?.phase === "complete" ? "Graph built"
              : last?.phase === "writing" ? "Writing output files"
              : last?.text.includes("Cloning") ? "Cloning repository"
              : last?.text.includes("cached") ? "Using cached clone"
              : "Building knowledge graph";
            return (
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-paper-dim">{phase}</span>
                  {pct !== null && (
                    <span className="text-[11px] text-signal tabular-nums">{pct}%</span>
                  )}
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-signal rounded-full transition-all duration-300"
                    style={{ width: `${pct ?? 5}%` }}
                  />
                </div>
              </div>
            );
          })()}
          <div className={cn("overflow-y-auto", buildStatus === "error" ? "max-h-32" : "max-h-20")}>
            {buildMessages.map((msg, i) => {
              // The failure reason is the one line here worth reading, so it
              // does not get the truncate treatment the progress chatter does.
              const failed = msg.text.startsWith("Error:");
              return (
                <div
                  key={i}
                  className={cn(
                    "text-[10px] font-mono",
                    failed
                      ? "text-alert whitespace-pre-wrap break-words"
                      : "text-paper-faint truncate",
                  )}
                >
                  {msg.text}
                </div>
              );
            })}
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
                {engine === "crg" ? "code-review-graph" : "interactive graph"} — {owner}/{repo}
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
              sandbox="allow-scripts"
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
                {engine === "crg" ? "ask:" : "quick:"}
              </span>
              {(engine === "crg"
                ? ["what is the architecture?", "what are the main modules?", "how is this codebase structured?"]
                : ["help", "stats", "god nodes", "recent", "explain src"]
              ).map((cmd) => (
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
              onScroll={onResultsScroll}
              className="flex-1 overflow-y-auto min-h-0 space-y-3"
            >
              {results.length === 0 && (
                <div className="border border-border bg-surface/40 p-6 text-center">
                  <div className="serif text-[18px] text-paper">
                    Query the knowledge graph
                  </div>
                  {engine === "crg" ? (
                    <>
                      <p className="mt-2 text-[11px] text-paper-muted max-w-md mx-auto">
                        This repo uses code-review-graph (large repo mode).
                        Ask any question in plain English about the codebase.
                      </p>
                      <p className="mt-1.5 text-[10px] text-signal">
                        All queries use AI (~$0.001 each). Free graph commands are not available for large repos.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-[11px] text-paper-muted max-w-md mx-auto">
                        Try: &quot;trace handlePayment&quot; or
                        &quot;impact UserService&quot; or &quot;explain
                        src/api&quot; or &quot;path auth to billing&quot;
                      </p>
                      <p className="mt-1.5 text-[10px] text-paper-faint">
                        Type{" "}
                        <button
                          onClick={() => quickQuery("help")}
                          className="text-signal hover:underline"
                        >
                          help
                        </button>
                        {" "}for all commands and examples (free). Plain English questions use AI (~$0.001).
                      </p>
                    </>
                  )}
                </div>
              )}

              {results.map((r) => (
                <div key={r._id} className="border border-border bg-surface/40">
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
                    {r.status === "streaming" && (
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-[10px] text-info">AI</span>
                        <span className="text-[10px] text-signal animate-pulse-signal">
                          streaming...
                        </span>
                      </span>
                    )}
                    {r.status === "done" && (
                      <span className="ml-auto flex items-center gap-2">
                        {r.mode === "llm" && (
                          <span className="text-[9px] text-info border border-info/30 px-1 py-0.5">
                            AI
                          </span>
                        )}
                        {r.compression && (
                          <span className="text-[9px] text-paper-faint" title={r.compression}>
                            compressed
                          </span>
                        )}
                        <span className="text-[10px] text-ok tabular-nums">
                          ${(r.cost ?? 0).toFixed(4)}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="px-3 py-3 overflow-x-auto">
                    {r.status === "error" ? (
                      <div className="text-[11px] text-alert whitespace-pre-wrap font-mono break-words">
                        {r.response}
                      </div>
                    ) : r.response ? (
                      r.mode === "llm" ? (
                        <MarkdownResponse text={r.response} />
                      ) : (
                        <GraphResponse text={r.response} />
                      )
                    ) : r.status === "done" ? (
                      // Finished with nothing to show. Without this it fell
                      // through to the in-progress placeholder and sat there
                      // claiming to still be working.
                      <div className="text-[11px] text-paper-muted italic">
                        The graph returned no output for this query.
                      </div>
                    ) : (
                      <div className="text-[11px] text-paper-muted italic">
                        {r.mode === "llm" ? "Asking AI..." : "Traversing graph..."}
                      </div>
                    )}
                  </div>
                  {/* Follow-up suggestions */}
                  {r.status === "done" && !isQuerying && (
                    <FollowUps result={r} onPick={quickQuery} />
                  )}
                </div>
              ))}
            </div>

            {/* Query input */}
            <form onSubmit={handleSubmit} className="mt-3 shrink-0">
              <div className="flex gap-2">
                <input
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
    <div className="text-[11.5px] leading-relaxed font-mono space-y-0 overflow-x-hidden">
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
        if (/^\s*(Nodes|Edges|Modules|Communities|Hyperedges):/.test(line))
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
          <div key={i} className="text-paper-dim whitespace-pre-wrap break-words">
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ── Markdown renderer for LLM responses ───────────────────────────────

function MarkdownResponse({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-2.5 text-[12px] leading-relaxed text-paper-dim break-words">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return (
            <div key={i} className="overflow-x-auto">
              <div className="flex items-center px-3 py-1 bg-ink/80 border border-border-soft border-b-0 text-[10px] text-paper-muted">
                <span className="font-mono">{block.lang || "code"}</span>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 bg-ink/60 border border-border-soft text-[11px] leading-snug font-mono whitespace-pre-wrap break-words">
                {block.content}
              </pre>
            </div>
          );
        }
        if (block.type === "heading") {
          return (
            <div key={i} className="text-[13px] text-paper font-medium mt-3 first:mt-0">
              <InlineMd text={block.content} />
            </div>
          );
        }
        if (block.type === "bullet") {
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-paper-faint shrink-0">-</span>
              <span className="break-words min-w-0"><InlineMd text={block.content} /></span>
            </div>
          );
        }
        return (
          <p key={i} className="break-words">
            <InlineMd text={block.content} />
          </p>
        );
      })}
    </div>
  );
}

// ── Follow-up chips ───────────────────────────────────────────────────
// Its own component so the suggestions are derived once per answer. Inline in
// the list they were recomputed on every render of the panel — two regex
// sweeps of the full response text per finished result, per keystroke in the
// query box.

function FollowUps({
  result,
  onPick,
}: {
  result: QueryResult;
  onPick: (q: string) => void;
}) {
  const followUps = useMemo(
    () => generateFollowUps(result.query, result.response),
    [result.query, result.response],
  );
  if (!followUps.length) return null;

  return (
    <div className="px-3 py-2 border-t border-border-soft flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">
        follow up:
      </span>
      {followUps.map((q) => (
        <button
          key={q}
          onClick={() => onPick(q)}
          className="text-[10px] text-paper-dim border border-border-soft hover:border-signal/40 hover:text-signal px-2 py-1 transition"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

function InlineMd({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={ki++} className="text-paper font-medium">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={ki++} className="text-signal bg-signal/10 px-1 py-0.5 text-[11px] break-all">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
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
