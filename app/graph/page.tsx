"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { Doodle } from "@/components/brand/doodles";
import { nodes } from "@/components/brand/doodle-data";

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
  const suggestionRequest = useRef<AbortController | null>(null);
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
      try {
        const saved = localStorage.getItem("opensrcer-graph-repo");
        if (saved) setRepoUrl(saved);
      } catch {
        // The graph still works when privacy settings disable browser storage.
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!repoUrl.trim()) return;
    try {
      localStorage.setItem("opensrcer-graph-repo", repoUrl.trim());
    } catch {
      // Persistence is optional; keep the current graph session usable.
    }
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
  async function loadSuggestions() {
    if (suggestionsLoaded.current) return;
    suggestionsLoaded.current = true;
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem("opensrcer-explore-repos");
    } catch {
      // Fetch suggestions normally when session storage is unavailable.
    }
    if (cached) {
      try {
        const parsed: unknown = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          setSuggestions(parsed);
          return;
        }
      } catch {
        try { sessionStorage.removeItem("opensrcer-explore-repos"); } catch { /* storage unavailable */ }
      }
    }
    const controller = new AbortController();
    suggestionRequest.current?.abort();
    suggestionRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetch("/api/crucible/orgs", { signal });
      if (!response.ok) throw new Error("Could not load connected organizations.");
      const data = (await response.json()) as { orgs?: Array<{ github_org: string }> };
      const orgs = data.orgs ?? [];
      const all: string[] = [];
      for (let index = 0; index < orgs.length; index += 4) {
        const batch = await Promise.all(orgs.slice(index, index + 4).map(async ({ github_org }) => {
          const reposResponse = await fetch(`/api/crucible/orgs/${encodeURIComponent(github_org)}/repos`, { signal });
          if (!reposResponse.ok) return [];
          const reposData = (await reposResponse.json()) as { repos?: Array<{ fullName: string }> };
          return (reposData.repos ?? []).map((repo) => repo.fullName);
        }));
        all.push(...batch.flat());
      }
      if (controller.signal.aborted) return;
      setSuggestions(all);
      try {
        sessionStorage.setItem("opensrcer-explore-repos", JSON.stringify(all));
      } catch {
        /* autocomplete still works when storage is unavailable or full */
      }
    } catch {
      if (!controller.signal.aborted) suggestionsLoaded.current = false;
    } finally {
      if (suggestionRequest.current === controller) suggestionRequest.current = null;
    }
  }

  useEffect(() => () => suggestionRequest.current?.abort(), []);

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
      className={cn(
        "mx-auto flex w-full flex-col",
        buildStatus === "ready"
          ? "max-w-[1800px] px-4 py-6 sm:px-6 xl:h-[var(--graph-shell-height)] xl:min-h-[560px]"
          : "max-w-[1200px] px-5 py-10 sm:px-8",
      )}
      style={{ "--graph-shell-height": shellHeight ? `${shellHeight}px` : "calc(100dvh - 56px)" } as React.CSSProperties}
    >
      <PageHeading
        title="Codebase map"
        description="Build an interactive map of a GitHub repository, then trace dependencies, inspect impact, and ask questions about the code."
      />

      {/* Repo input + build */}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleBuild(buildStatus === "ready");
        }}
      >
        <div className="relative w-full max-w-xl flex-1 sm:min-w-[280px]">
          <label htmlFor="graph-repository" className="field-label">
            GitHub repository
          </label>
          <input
            id="graph-repository"
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
            placeholder="owner/repository"
            autoComplete="off"
            className="field font-mono"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="card absolute top-full right-0 left-0 z-20 mt-2 max-h-56 overflow-y-auto py-1.5 shadow-[0_12px_32px_-12px_rgb(28_23_20/0.25),inset_0_0_0_1px_var(--color-border-soft)]">
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
                      className="w-full px-4 py-2.5 text-left font-mono text-[13px] text-paper-dim hover:bg-ink-2 hover:text-paper"
                    >
                      {s}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={!parseRepo(repoUrl) || buildStatus === "building"}
          className="btn-primary min-h-11 shrink-0 px-6"
        >
          {buildStatus === "building"
            ? "building..."
            : buildStatus === "ready"
              ? "Rebuild graph"
              : "Build graph"}
        </button>
        {(buildStatus === "building" || isQuerying) && (
          <button type="button" onClick={() => {
            buildRequest.current?.abort(new Error("Build cancelled."));
            queryRequest.current?.abort(new Error("Query cancelled."));
          }} className="btn-quiet min-h-11 px-5">Cancel</button>
        )}
        {buildStatus === "ready" && (
          <span className="chip chip-ok mb-2.5 self-end">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
            ready
          </span>
        )}
      </form>

      {/* Build progress — kept on screen for a failed build too. Hiding it on
          error meant the log flashed past and the page fell back to the empty
          state, so a failure was indistinguishable from never having clicked. */}
      {(buildStatus === "building" || buildStatus === "error") &&
        buildMessages.length > 0 && (
        <div
          className={cn(
            "card mt-4 px-5 py-4",
            buildStatus === "error" && "callout-alert",
          )}
        >
          {/* Progress bar */}
          {buildStatus === "building" && (() => {
            const last = buildMessages[buildMessages.length - 1];
            const pct = last?.percent ?? null;
            const phase = last?.phase === "ast" ? "Reading the source files"
              : last?.phase === "complete" ? "Graph built"
              : last?.phase === "writing" ? "Writing output files"
              : last?.text.includes("Cloning") ? "Cloning repository"
              : last?.text.includes("cached") ? "Using cached clone"
              : "Building the map";
            return (
              <div className="mb-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-paper">{phase}</span>
                  {pct !== null && (
                    <span className="font-mono text-[13px] text-signal tabular-nums">{pct}%</span>
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
                    "font-mono text-[12px] leading-relaxed",
                    failed
                      ? "text-alert whitespace-pre-wrap break-words"
                      : "text-paper-muted truncate",
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
          <div className="card relative flex min-h-[360px] flex-col overflow-hidden xl:min-h-0 xl:w-[58%]">
            <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3">
              <span className="text-[13px] text-paper-muted">
                <span className="kicker text-signal">{engine === "crg" ? "map of a large repository" : "interactive map"}</span> — <span className="font-mono text-paper-dim">{owner}/{repo}</span>
              </span>
              {/* No "open fullscreen" link: as its own tab the graph HTML (built
                  from repository content) could navigate that tab; inside this
                  sandboxed iframe it cannot. */}
            </div>
            <iframe
              sandbox="allow-scripts"
              src={`/api/graph/${owner}/${repo}/viz`}
              className="w-full flex-1 border-0"
              title="Codebase Knowledge Graph"
            />
          </div>

          {/* Right: Chat interface */}
          <div className="flex min-h-[300px] flex-col xl:min-h-0 xl:w-[42%]">
            {/* Quick actions */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              <span className="kicker mr-1 self-center text-paper-muted">
                Suggestions
              </span>
              {(engine === "crg"
                ? [["What does this repository do?", "what does this repository do?"], ["What are the main parts?", "what are the main modules?"], ["How is it structured?", "how is this codebase structured?"]]
                : [["What does this repository do?", "What does this repository do?"], ["Where would I start reading?", "Where would a new contributor start reading?"], ["Most-connected code", "god nodes"], ["Overview", "stats"], ["All commands", "help"]]
              ).map(([label, cmd]) => (
                <button
                  key={label}
                  onClick={() => quickQuery(cmd)}
                  disabled={isQuerying}
                  className="pill"
                  data-size="sm"
                >
                  {label}
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
                <div className="card px-6 py-8 sm:px-8">
                  <div className="display text-[28px] leading-none text-paper">
                    Ask about this code
                  </div>
                  {engine === "crg" ? (
                    <>
                      <p className="mt-3 max-w-md text-[16px] leading-[1.6] text-paper-muted">
                        This is a large repository, so questions are answered in plain English.
                        Ask anything about the code.
                      </p>
                      <p className="mt-2 max-w-md text-[13px] text-signal">
                        Answers use your AI provider key. The free map commands aren&apos;t available for repositories this large.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-3 max-w-md text-[16px] leading-[1.6] text-paper-muted">
                        Ask in plain English, like &quot;Where is the config read?&quot; Answers use your AI provider key and come from the code map: they point to the files involved, and say when the map can&apos;t answer.
                      </p>
                      <p className="mt-2 max-w-md text-[13px] leading-[1.6] text-paper-muted">
                        Free map commands, no AI: &quot;trace handlePayment&quot;, &quot;impact UserService&quot;, &quot;explain src/api&quot;, &quot;path auth to billing&quot;.
                      </p>
                      <p className="mt-2 text-[13px] text-paper-muted">
                        Type{" "}
                        <button
                          onClick={() => quickQuery("help")}
                          className="link font-mono"
                        >
                          help
                        </button>
                        {" "}for all commands and examples.
                      </p>
                    </>
                  )}
                </div>
              )}

              {results.map((r) => (
                <div key={r._id} className="card overflow-hidden">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-soft px-5 py-3.5">
                    <span className="kicker text-signal">
                      You asked
                    </span>
                    <span className="text-[16px] font-semibold text-paper">
                      {r.query}
                    </span>
                    {r.status === "loading" && (
                      <span className="ml-auto text-[12.5px] text-signal">
                        querying...
                      </span>
                    )}
                    {r.status === "streaming" && (
                      <span className="ml-auto flex items-center gap-2">
                        <span className="chip chip-info">AI</span>
                        <span className="text-[12.5px] text-signal">
                          streaming...
                        </span>
                      </span>
                    )}
                    {r.status === "done" && (
                      <span className="ml-auto flex items-center gap-2">
                        {r.mode === "llm" && (
                          <span className="chip chip-info">
                            AI
                          </span>
                        )}
                        {r.compression && (
                          <span className="text-[12px] text-paper-muted" title={r.compression}>
                            compressed
                          </span>
                        )}
                        <span className="font-mono text-[12.5px] text-ok tabular-nums">
                          {r.cost ? `${r.cost.toFixed(4)}` : "free"}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto px-5 py-4">
                    {r.status === "error" ? (
                      <div className="text-[15px] text-alert whitespace-pre-wrap break-words">
                        {r.response}
                        {/\b(key|provider)\b/i.test(r.response) && (
                          <a href="/crucible" className="row-cta mt-3 w-fit">Add a key in Settings →</a>
                        )}
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
                      <div className="text-[13px] text-paper-muted italic">
                        The graph returned no output for this query.
                      </div>
                    ) : (
                      <div className="text-[13px] text-paper-muted italic">
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
              <div className="flex gap-2 rounded-full bg-surface p-1.5 shadow-[inset_0_0_0_1px_var(--color-border)] focus-within:shadow-[inset_0_0_0_1.5px_var(--color-signal)]">
                <label htmlFor="graph-question" className="sr-only">Your question</label>
                <input
                  id="graph-question"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Ask a question in plain English, e.g. Where is the config read?"
                  disabled={isQuerying}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-[16px] text-paper placeholder:text-paper-muted focus:outline-none focus-visible:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isQuerying}
                  className="btn-primary shrink-0 px-5"
                >
                  {isQuerying ? "..." : "Ask"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        buildStatus !== "building" && (
          /* Empty state */
          <div className="mt-14 grid flex-1 gap-10 border-t-2 border-paper pt-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="relative">
              <p className="kicker text-signal">What you can inspect</p>
              <h2 className="display mt-4 text-[40px] leading-[0.95] text-paper sm:text-[52px]">Start with a repository</h2>
              <p className="mt-4 max-w-lg text-[16px] leading-[1.65] text-paper-muted">
                Enter a public repository or one your connected GitHub account can access. Building the map reads source structure and relationships without calling an AI model.
              </p>
              {/* The section's one hand-drawn mark: a little map of connected nodes. */}
              <Doodle doodle={nodes} draw="load" delay={250} className="doodle-thin mt-8 hidden h-20 w-32 lg:block" />
            </div>
            <div className="grid content-start gap-3 text-[16px] sm:grid-cols-2">
              {[
                ["trace Symbol", "Follow calls and dependencies."],
                ["impact Symbol", "Find affected callers and modules."],
                ["explain src/api", "Summarize one area of the repository."],
                ["path A to B", "Show how two symbols connect."],
              ].map(([command, description]) => (
                <div key={command} className="card px-5 py-5">
                  <code className="rounded-md bg-signal-faint px-2 py-1 font-mono text-[15px] text-signal">{command}</code>
                  <p className="mt-3 text-paper-dim">{description}</p>
                </div>
              ))}
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
    <div className="text-[12.5px] leading-relaxed font-mono space-y-0 overflow-x-hidden">
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
              className="text-paper font-semibold text-[13px] mt-1"
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
    <div className="space-y-3 text-[16px] leading-[1.65] text-paper-dim break-words">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return (
            <div key={i} className="overflow-x-auto">
              <div className="flex items-center rounded-t-xl bg-paper-2 px-3.5 py-1.5 text-[12px] text-ink/75">
                <span className="font-mono">{block.lang || "code"}</span>
              </div>
              <pre className="term overflow-x-auto rounded-t-none px-3.5 py-3 font-mono text-[12.5px] leading-snug whitespace-pre-wrap break-words">
                {block.content}
              </pre>
            </div>
          );
        }
        if (block.type === "heading") {
          return (
            <div key={i} className="mt-4 text-[16px] font-semibold text-paper first:mt-0">
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
    <div className="flex flex-wrap items-center gap-2 border-t border-border-soft bg-ink-2 px-5 py-3">
      <span className="kicker text-paper-muted">
        Follow up:
      </span>
      {followUps.map((q) => (
        <button
          key={q}
          onClick={() => onPick(q)}
          className="pill whitespace-normal text-left"
          data-size="sm"
          data-edge=""
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
        <code key={ki++} className="rounded bg-signal-faint px-1 py-0.5 font-mono text-[12.5px] text-signal break-all">
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
