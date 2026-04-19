"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { cn } from "@/lib/utils";

type ToolActivity = {
  tool: string;
  detail: string;
  timestamp: number;
};

type ExploreResult = {
  query: string;
  response: string;
  status: "streaming" | "done" | "error";
  tools: ToolActivity[];
  cost: number | null;
  _id: number;
};

export default function ExplorePage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("0.50");
  const [results, setResults] = useState<ExploreResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hasKey, setHasKey] = useState(true); // assume true until checked
  const resultRef = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  const searchParams = useSearchParams();

  // #1: Persist repo URL to localStorage, or read from ?repo= query param
  useEffect(() => {
    const fromUrl = searchParams.get("repo");
    if (fromUrl) {
      setRepoUrl(fromUrl);
    } else {
      const saved = localStorage.getItem("opensrcer-explore-repo");
      if (saved) setRepoUrl(saved);
    }
  }, [searchParams]);
  useEffect(() => {
    if (repoUrl.trim()) localStorage.setItem("opensrcer-explore-repo", repoUrl.trim());
  }, [repoUrl]);

  // Fetch connected org repos for suggestions — lazy, only on first focus
  const suggestionsLoaded = useRef(false);
  function loadSuggestions() {
    if (suggestionsLoaded.current) return;
    suggestionsLoaded.current = true;
    // Check sessionStorage cache first
    const cached = sessionStorage.getItem("opensrcer-explore-repos");
    if (cached) {
      try { setSuggestions(JSON.parse(cached)); return; } catch { /* ignore */ }
    }
    fetch("/api/crucible/orgs")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { orgs?: Array<{ github_org: string }> } | null) => {
        const orgs = data?.orgs ?? [];
        if (orgs.length === 0) return;
        const orgFetches = orgs.map((o) =>
          fetch(`/api/crucible/orgs/${o.github_org}/repos`)
            .then((r) => r.ok ? r.json() : { repos: [] })
            .then((d: { repos?: Array<{ fullName: string }> }) =>
              (d.repos ?? []).map((r) => r.fullName)
            )
            .catch(() => [] as string[])
        );
        Promise.all(orgFetches).then((lists) => {
          const all = lists.flat();
          setSuggestions(all);
          sessionStorage.setItem("opensrcer-explore-repos", JSON.stringify(all));
        });
      })
      .catch(() => {});
  }

  // Check if API key is set
  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d: { anthropic?: boolean; gemini?: boolean }) => setHasKey(Boolean(d.anthropic) && Boolean(d.gemini)))
      .catch(() => {});
  }, []);

  // #5: Auto-focus query input
  useEffect(() => {
    queryInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight;
    }
  }, [results]);

  const isStreaming = results.some((r) => r.status === "streaming");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim() || !query.trim() || isStreaming) return;

    const queryId = Date.now();
    setResults((prev) => {
      const next = [...prev, { query: query.trim(), response: "", status: "streaming" as const, tools: [] as ToolActivity[], cost: null, _id: queryId }];
      return next.slice(-3);
    });
    const currentQuery = query;
    setQuery("");

    try {
      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl.trim(),
          query: buildQueryWithContext(currentQuery, results),
          budget: parseFloat(budget) || 0.15,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setResults((prev) =>
          prev.map((r) =>
            r._id === queryId ? { ...r, response: err.error ?? "Request failed", status: "error" as const } : r,
          ),
        );
        return;
      }

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
              text?: string;
              done?: boolean;
              error?: string;
              tool?: string;
              detail?: string;
              cost?: number;
            };
            if (payload.tool) {
              setResults((prev) =>
                prev.map((r) =>
                  r._id === queryId
                    ? { ...r, tools: [...r.tools, { tool: payload.tool!, detail: payload.detail ?? "", timestamp: Date.now() }] }
                    : r,
                ),
              );
            }
            if (payload.text) {
              setResults((prev) =>
                prev.map((r) =>
                  r._id === queryId ? { ...r, response: r.response + payload.text } : r,
                ),
              );
            }
            if (payload.cost !== undefined) {
              setResults((prev) =>
                prev.map((r) =>
                  r._id === queryId ? { ...r, cost: payload.cost as number } : r,
                ),
              );
            }
            if (payload.done) {
              setResults((prev) =>
                prev.map((r) =>
                  r._id === queryId ? { ...r, status: "done" as const } : r,
                ),
              );
            }
            if (payload.error) {
              setResults((prev) =>
                prev.map((r) =>
                  r._id === queryId ? { ...r, response: payload.error!, status: "error" as const } : r,
                ),
              );
            }
          } catch {
            /* skip malformed SSE */
          }
        }
      }

      // If stream ended without a done event
      setResults((prev) =>
        prev.map((r) =>
          r._id === queryId && r.status === "streaming" ? { ...r, status: "done" as const } : r,
        ),
      );
    } catch (err) {
      setResults((prev) =>
        prev.map((r) =>
          r._id === queryId
            ? { ...r, response: err instanceof Error ? err.message : "Network error", status: "error" as const }
            : r,
        ),
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6 flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <PageHeading
        title={<>Explore</>}
        description="Ask plain-English questions about any GitHub codebase. Claude navigates the repo with tree-sitter indexing, grep, and AST tools to find and show you the relevant code."
      />

      {/* Repo input + budget */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 max-w-xl relative">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => { setRepoUrl(e.target.value); setShowSuggestions(true); }}
            onFocus={() => { setShowSuggestions(true); loadSuggestions(); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="github.com/owner/repo or owner/repo"
            className="w-full bg-surface border border-border px-3 py-2 text-[13px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 top-full left-0 right-0 mt-1 border border-border bg-ink max-h-48 overflow-y-auto">
              {suggestions
                .filter((s) => !repoUrl || s.toLowerCase().includes(repoUrl.toLowerCase()))
                .slice(0, 8)
                .map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setRepoUrl(s); setShowSuggestions(false); }}
                      className="w-full text-left px-3 py-2 text-[12px] text-paper-dim hover:bg-surface-2/60 hover:text-paper"
                    >
                      {s}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-paper-muted uppercase tracking-[0.1em]">budget</span>
          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="bg-surface border border-border px-2 py-2 text-[12px] text-paper tabular-nums focus:outline-none focus:border-signal/50"
          >
            <option value="0.05">$0.05</option>
            <option value="0.10">$0.10</option>
            <option value="0.15">$0.15</option>
            <option value="0.25">$0.25</option>
            <option value="0.50">$0.50</option>
            <option value="1.00">$1.00</option>
          </select>
          <span className="text-[9px] text-paper-faint">max cost per query</span>
        </div>
      </div>

      {/* Results area */}
      <div ref={resultRef} className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
        {results.length === 0 && (
          <div className="border border-border bg-surface/40 p-8 text-center">
            <div className="serif text-[22px] text-paper">Ask anything about a codebase</div>
            <p className="mt-2 text-[12px] text-paper-muted max-w-lg mx-auto">
              Try: &quot;where is the authentication middleware?&quot; or &quot;how does the test runner detect which ecosystem to use?&quot; or &quot;show me the API route handlers&quot;
            </p>
          </div>
        )}

        {results.map((r, i) => (
          <div key={i} className="border border-border bg-surface/40">
            {/* Query */}
            <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.15em] text-signal">Q</span>
              <span className="text-[13px] text-paper">{r.query}</span>
              {r.status === "streaming" && (
                <span className="ml-auto text-[10px] text-signal animate-pulse-signal">streaming...</span>
              )}
              {r.status === "done" && r.cost !== null && (
                <span className="ml-auto text-[10px] text-paper-muted tabular-nums">${r.cost.toFixed(4)}</span>
              )}
            </div>

            {/* Tool activity feed */}
            {r.tools.length > 0 && (
              <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
                <div className="flex flex-wrap gap-1.5">
                  {r.tools.map((t, ti) => (
                    <span
                      key={ti}
                      className={cn(
                        "inline-flex items-center gap-1 text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none",
                        t.tool === "grep" && "border-signal/30 text-signal",
                        t.tool === "read_file" && "border-info/30 text-info",
                        t.tool === "find_definition" && "border-ok/30 text-ok",
                        t.tool === "find_references" && "border-ok/30 text-ok",
                        t.tool === "list_files" && "border-paper-faint/30 text-paper-muted",
                        t.tool === "repo_info" && "border-paper-faint/30 text-paper-muted",
                      )}
                      title={t.detail || t.tool}
                    >
                      <ToolIcon tool={t.tool} />
                      {t.detail ? truncateDetail(t.detail) : t.tool}
                    </span>
                  ))}
                  {r.status === "streaming" && (
                    <span className="text-[9.5px] text-paper-faint animate-pulse-signal">analyzing...</span>
                  )}
                </div>
              </div>
            )}

            {/* Response */}
            <div className="px-4 py-4">
              {r.status === "error" ? (
                <div className="text-[12.5px] text-alert">{r.response}</div>
              ) : r.response ? (
                <ExploreResponse text={r.response} />
              ) : (
                <div className="text-[12px] text-paper-muted italic">Exploring the codebase...</div>
              )}
            </div>
            {/* Follow-up suggestions */}
            {r.status === "done" && !isStreaming && (
              <div className="px-4 py-2.5 border-t border-border-soft flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">follow up:</span>
                {generateFollowUps(r.query).map((q, qi) => (
                  <button
                    key={qi}
                    onClick={() => { setQuery(q); queryInputRef.current?.focus(); }}
                    className="text-[11px] text-paper-dim border border-border-soft hover:border-signal/40 hover:text-signal px-2 py-1 transition"
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
      <form onSubmit={handleSubmit} className="mt-4 shrink-0 pb-2">
        <div className="flex gap-2">
          <input
            ref={queryInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }}
            placeholder={repoUrl ? "Ask about this codebase..." : "Enter a repo URL above first"}
            disabled={!repoUrl.trim() || isStreaming}
            className="flex-1 bg-surface border border-border px-3 py-2.5 text-[13px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!repoUrl.trim() || !query.trim() || isStreaming || !hasKey}
            className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2.5 text-[12px] uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {!hasKey ? "no API key" : isStreaming ? "exploring..." : "explore"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Response renderer ─────────────────────────────────────────────────
// Parses Claude's markdown response into styled blocks with syntax-
// highlighted code snippets. Handles: paragraphs, headers, code blocks,
// bullet lists, bold/code inline.

function ExploreResponse({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed text-paper-dim">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return (
            <div key={i} className="relative group">
              <div className="flex items-center justify-between px-3 py-1.5 bg-ink/80 border border-border-soft border-b-0 text-[10px] text-paper-muted">
                <span className="font-mono">{block.lang || "code"}</span>
                <CopyButton text={block.content} />
              </div>
              <pre className="overflow-x-auto px-3 py-3 bg-ink/60 border border-border-soft text-[11.5px] leading-snug font-mono">
                {block.content.split("\n").map((line, li) => (
                  <CodeLine key={li} line={line} lang={block.lang} />
                ))}
              </pre>
            </div>
          );
        }

        if (block.type === "heading") {
          return (
            <div key={i} className="text-[13px] text-paper font-medium mt-4 first:mt-0">
              <InlineMd text={block.content} />
            </div>
          );
        }

        if (block.type === "bullet") {
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-paper-faint shrink-0">-</span>
              <span><InlineMd text={block.content} /></span>
            </div>
          );
        }

        return (
          <p key={i}>
            <InlineMd text={block.content} />
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "paragraph"; content: string }
  | { type: "heading"; content: string }
  | { type: "bullet"; content: string }
  | { type: "code"; content: string; lang: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: "code", content: codeLines.join("\n"), lang });
      continue;
    }

    // Heading
    if (/^#{1,4}\s/.test(line)) {
      blocks.push({ type: "heading", content: line.replace(/^#+\s*/, "") });
      i++;
      continue;
    }

    // Bullet
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^\s*[-*]\s+/, "") });
      i++;
      continue;
    }

    // Numbered list item
    if (/^\s*\d+[.)]\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^\s*\d+[.)]\s+/, "") });
      i++;
      continue;
    }

    // Empty line — skip
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph — collect contiguous non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,4}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: paraLines.join(" ") });
  }

  return blocks;
}

function InlineMd({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let ki = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={ki++} className="text-paper font-medium">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={ki++} className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CodeLine({ line, lang }: { line: string; lang: string }) {
  // Diff-style coloring for diff blocks
  if (lang === "diff" || lang === "patch") {
    let cls = "text-paper-dim";
    let bg = "";
    if (line.startsWith("+") && !line.startsWith("+++")) { cls = "text-ok"; bg = "bg-ok/10"; }
    else if (line.startsWith("-") && !line.startsWith("---")) { cls = "text-alert"; bg = "bg-alert/10"; }
    else if (line.startsWith("@@")) { cls = "text-info"; bg = "bg-info/10"; }
    return <div className={cn("whitespace-pre", cls, bg)}>{line || "\u00a0"}</div>;
  }

  // Basic keyword highlighting for common languages
  if (/^(\s*\d+)[│|](.*)/.test(line)) {
    // Line-numbered output from read_file
    const m = line.match(/^(\s*\d+)([│|])(.*)/)!;
    return (
      <div className="whitespace-pre">
        <span className="text-paper-faint">{m[1]}{m[2]}</span>
        <HighlightedCode text={m[3]} />
      </div>
    );
  }

  return <div className="whitespace-pre text-paper-dim">{line || "\u00a0"}</div>;
}

function HighlightedCode({ text }: { text: string }) {
  // Very lightweight keyword highlighting
  const kwRegex = /\b(function|const|let|var|return|import|export|from|class|def|fn|pub|async|await|if|else|for|while|match|struct|enum|trait|impl|type|interface|self|this|new|throw|try|catch|finally|yield|extends|super|null|undefined|true|false|None|True|False)\b/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = kwRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={ki++} className="text-paper-dim">{text.slice(last, m.index)}</span>);
    parts.push(<span key={ki++} className="text-info">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={ki++} className="text-paper-dim">{text.slice(last)}</span>);
  return <>{parts}</>;
}

// Generate contextual follow-up questions based on the user's query
function generateFollowUps(query: string): string[] {
  const q = query.toLowerCase();
  const suggestions: string[] = [];

  if (q.includes("auth") || q.includes("login") || q.includes("session")) {
    suggestions.push("What permissions does it check?", "How are tokens stored?", "Show me the logout flow");
  } else if (q.includes("test") || q.includes("spec")) {
    suggestions.push("What test framework is used?", "Show me a test example", "How do I run the tests?");
  } else if (q.includes("api") || q.includes("route") || q.includes("endpoint")) {
    suggestions.push("What middleware do the routes use?", "Show me the error handling", "How is auth enforced on routes?");
  } else if (q.includes("database") || q.includes("schema") || q.includes("model")) {
    suggestions.push("What ORM is used?", "Show me the migrations", "How are queries structured?");
  } else if (q.includes("deploy") || q.includes("ci") || q.includes("docker")) {
    suggestions.push("What does the CI pipeline do?", "Show me the Dockerfile", "What env vars are needed?");
  } else {
    suggestions.push("How are tests structured?", "Show me the main entry point", "What dependencies does it use?");
  }

  return suggestions.slice(0, 3);
}

// #9: Build query with previous Q&A context for follow-ups
function buildQueryWithContext(query: string, results: ExploreResult[]): string {
  const prev = results
    .filter((r) => r.status === "done" && r.response)
    .slice(-2)
    .map((r) => `Q: ${r.query}\nA: ${r.response.slice(0, 500)}`)
    .join("\n\n");
  if (!prev) return query;
  return `Previous context:\n${prev}\n\nNew question: ${query}`;
}

function ToolIcon({ tool }: { tool: string }) {
  const icons: Record<string, string> = {
    grep: "/",
    read_file: "#",
    find_definition: "@",
    find_references: "&",
    list_files: ">",
    repo_info: "i",
  };
  return (
    <span className="font-mono font-bold text-[9px] opacity-70">
      {icons[tool] ?? "?"}
    </span>
  );
}

function truncateDetail(s: string): string {
  if (s.length <= 35) return s;
  return s.slice(0, 32) + "...";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  }

  return (
    <button
      onClick={copy}
      className="text-paper-faint hover:text-paper text-[10px] transition-colors"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
